const { Pool } = require('pg');
const crypto = require('crypto');

// En Railway la conexion a Postgres va por su red privada; el certificado
// no es de una CA publica, asi que hay que aceptar el self-signed.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.RAILWAY_ENVIRONMENT ? { rejectUnauthorized: false } : false,
});

// Duplicado a proposito de generateReferralCode() en users.js: si lo
// importaramos de alla se armaria una dependencia circular (users.js ya
// importa el pool desde aca). Es una funcion chiquita, no vale la pena
// reorganizar los modulos solo por esto.
function generateReferralCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

// Las cuentas creadas antes de que existiera la columna referral_code se
// quedan con NULL (el ALTER TABLE no rellena datos existentes); esto les
// asigna un codigo la primera vez que el server arranca despues del cambio.
async function backfillReferralCodes() {
  const { rows } = await pool.query('SELECT id FROM users WHERE referral_code IS NULL');
  for (const row of rows) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [generateReferralCode(), row.id]);
        break;
      } catch (err) {
        if (attempt === 4) console.error(`[backfill-referral] no se pudo asignar codigo al usuario ${row.id}:`, err.message);
      }
    }
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // ALTER ... IF NOT EXISTS en vez de meterla en el CREATE TABLE de arriba:
  // asi las cuentas que ya existian antes de esta columna no rompen nada.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;`);

  // Limite diario de videos: "unlimited" lo desbloquea un cupon permanente;
  // unlimited_until, uno temporal (ej. "7 dias ilimitados"); daily_count y
  // daily_reset_date llevan la cuenta de cuantos uso hoy (dia calendario de
  // Argentina, ver ARG_TZ en users.js) para poder resetear a medianoche;
  // bonus_uses son usos extra de regalo (cupon o referidos) que no se
  // resetean solos, se van gastando hasta que se acaban.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unlimited BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unlimited_until TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_reset_date TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_uses INTEGER NOT NULL DEFAULT 0;`);

  // Recuperar contraseña: token temporal + su vencimiento.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;`);

  // Planes y suscripciones: "plan" es 'free' | 'intermedio' | 'pro' (ver
  // PLANS en users.js, que es la fuente de verdad de precios/limites).
  // requested_plan/requested_plan_at quedan seteados cuando alguien elige
  // un plan pago desde la pagina de precios pero TODAVIA no hay pasarela de
  // pago conectada: es un "quiero esto" que un admin confirma a mano (ver
  // adminSetPlan) hasta que se integre Stripe/Mercado Pago de verdad.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_plan TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_plan_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);

  // Gamificacion: total_videos cuenta todos los videos procesados alguna vez
  // (no se resetea nunca, a diferencia de daily_count); streak_count/
  // last_active_date llevan la racha de dias consecutivos usando la app;
  // longest_streak es el record historico (la racha actual puede cortarse,
  // el record no se pierde nunca); active_days_count son dias DISTINTOS
  // (no necesariamente seguidos) con al menos un video procesado bien.
  // free_reward_level (0/1/2) es la recompensa PERMANENTE que sube el limite
  // diario del plan Gratis (3 -> 5 -> 7) por buen uso constante; una vez
  // otorgada no se pierde ni si el usuario cambia de plan y vuelve a Gratis.
  // Todo esto se actualiza EXCLUSIVAMENTE desde el hook de "job termino
  // bien" en server.js (updateProgressionOnSuccess, users.js) — nunca a
  // partir de nada que mande el cliente.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_days_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_reward_level INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_reward1_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_reward2_at TIMESTAMPTZ;`);
  // Bytes ahorrados acumulados (solo se suma en el Optimizador Meta, que es
  // el unico flujo donde "tamaño de entrada vs tamaño de salida" es una
  // comparacion que tiene sentido real; el mini editor une clips, no
  // "optimiza" un tamaño original).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_bytes_saved BIGINT NOT NULL DEFAULT 0;`);

  // Record del minijuego de la serpiente (🐍, "para joda"). No tiene ningun
  // efecto en cuota/plan/logros — es solo un numerito guardado por cuenta
  // en vez de en localStorage, para que se vea igual en cualquier dispositivo.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS snake_high_score INTEGER NOT NULL DEFAULT 0;`);

  // Personalizacion (100% cosmetica, ver ACCENT_THEMES/AVATARS/AVATAR_BORDERS
  // en users.js): que desbloquea cada nivel se CALCULA siempre a partir de
  // total_videos (no se guarda "esto ya lo desbloqueo" en ningun lado,
  // porque el nivel nunca baja); lo unico que hay que persistir es CUAL
  // eligio el usuario para mostrar. set*Personalization en users.js valida
  // contra el nivel real antes de guardar la eleccion.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_avatar TEXT NOT NULL DEFAULT 'default';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_border TEXT NOT NULL DEFAULT 'default';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_accent_theme TEXT NOT NULL DEFAULT 'default';`);

  // Dashboard personalizable ("Mi Progreso"): orden de las cards, guardado
  // como JSON (array de claves). NULL = usar el orden por defecto.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_layout TEXT;`);

  // Records personales. stats_today_count/stats_today_date son un contador
  // de "videos hoy" APARTE de daily_count (que es del sistema de cuota):
  // este cuenta SIEMPRE, incluso para cuentas Pro/ilimitadas donde
  // daily_count no se toca — si no, esas cuentas nunca podrian tener un
  // record de "mejor dia". best_day_* y best_compression_* son el record en
  // si, actualizado en el momento (updateProgressionOnSuccess), nunca
  // recorriendo el historial completo.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stats_today_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stats_today_date TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_day_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_day_date TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_compression_pct INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_compression_original_size BIGINT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_compression_final_size BIGINT NOT NULL DEFAULT 0;`);

  // Herramientas favoritas: una fila por (usuario, herramienta marcada).
  // Se sincroniza sola entre dispositivos porque vive en la cuenta, no en
  // localStorage.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_favorite_tools (
      user_id INTEGER NOT NULL REFERENCES users(id),
      tool_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, tool_key)
    );
  `);

  // Referidos: cada cuenta tiene su propio codigo para invitar, y guarda
  // quien la invito a ella (si vino de un link de invitacion).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);`);

  // Cupones: catalogo de codigos validos y que otorgan. "type" es
  // 'unlimited_permanent' | 'unlimited_days' | 'extra_uses'; "value" es la
  // cantidad de dias o de usos extra segun corresponda (no se usa en
  // unlimited_permanent). max_redemptions null = sin limite de canjes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      max_redemptions INTEGER,
      redemptions_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT true,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Un registro por canje: evita que la misma persona use dos veces un
  // cupon que deberia canjearse una sola vez por cuenta.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      coupon_id INTEGER NOT NULL REFERENCES coupons(id),
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, coupon_id)
    );
  `);

  // Historial de videos procesados. El archivo en si vive en disco (mismo
  // filesystem del contenedor) y se borra solo despues de expires_at (ver
  // el barrido periodico en server.js); la fila igual queda de registro por
  // un rato mas y despues tambien se elimina.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_history (
      id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      output_size BIGINT NOT NULL DEFAULT 0,
      file_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  // Un registro por (usuario, dia calendario en el que proceso algo bien).
  // La clave primaria compuesta es lo que evita contar el mismo dia dos
  // veces aunque el hook de progreso se dispare mas de una vez ese dia.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_active_days (
      user_id INTEGER NOT NULL REFERENCES users(id),
      activity_date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, activity_date)
    );
  `);

  // Logros desbloqueados. La lista de logros posibles (ACHIEVEMENTS) vive en
  // codigo (users.js), no en la base — esta tabla solo guarda CUALES ya
  // desbloqueo cada usuario y cuando. La clave primaria compuesta evita
  // duplicados si el hook se dispara mas de una vez.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id INTEGER NOT NULL REFERENCES users(id),
      achievement_key TEXT NOT NULL,
      unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, achievement_key)
    );
  `);

  // Feedback (👍/👎) sobre un video ya procesado. job_id es el mismo id que
  // video_history.id (el jobId que ya se usa en toda la app). UNIQUE en
  // (user_id, job_id) para que un mismo resultado no reciba dos votos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      job_id UUID NOT NULL,
      source TEXT NOT NULL,
      rating TEXT NOT NULL,
      reason TEXT,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, job_id)
    );
  `);

  // Ideas de nuevas funciones que proponen los usuarios. "status" lo cambia
  // un admin desde /admin (recibida | en_revision | planeada | implementada
  // | descartada).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_ideas (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recibida',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Cupones de ejemplo, precargados. ON CONFLICT DO NOTHING: si ya existen
  // (o alguien los edito a mano), no se pisan en cada arranque.
  await pool.query(`
    INSERT INTO coupons (code, type, value, max_redemptions, description) VALUES
      ('dematiu', 'unlimited_permanent', 0, NULL, 'Cupón del equipo: carga ilimitada para siempre'),
      ('bienvenida', 'extra_uses', 5, NULL, 'Regalo de bienvenida: 5 videos extra'),
      ('verano2026', 'unlimited_days', 7, NULL, 'Promo de temporada: 7 días de carga ilimitada'),
      ('equipo', 'unlimited_permanent', 0, 10, 'Cupón interno para el equipo (hasta 10 personas)')
    ON CONFLICT (code) DO NOTHING;
  `);

  await backfillReferralCodes();
}

module.exports = { pool, initDb };
