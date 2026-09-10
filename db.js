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

  // Gamificacion: total_videos cuenta todos los videos procesados alguna vez
  // (no se resetea nunca, a diferencia de daily_count); streak_count/
  // last_active_date llevan la racha de dias consecutivos usando la app
  // (ver recordVideoCompletion en users.js).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date TEXT NOT NULL DEFAULT '';`);

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
