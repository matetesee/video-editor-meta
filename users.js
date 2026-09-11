const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./db');

const ADMIN_EMAIL = 'matetesee@gmail.com';
const DAILY_LIMIT = 3;
const REFERRAL_BONUS_USES = 3;
// El dia "de hoy" se calcula en huso horario de Argentina (no UTC ni el del
// servidor) para que el limite se resetee a la medianoche que el usuario
// realmente ve en su reloj.
const ARG_TZ = 'America/Argentina/Buenos_Aires';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAdminEmail(email) {
  return normalizeEmail(email) === ADMIN_EMAIL;
}

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  return rows[0] || null;
}

async function findByGoogleId(googleId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByReferralCode(code) {
  if (!code) return null;
  const { rows } = await pool.query('SELECT * FROM users WHERE referral_code = $1', [String(code).trim().toUpperCase()]);
  return rows[0] || null;
}

async function setAvatar(userId, dataUrl) {
  await pool.query('UPDATE users SET avatar_data_url = $1 WHERE id = $2', [dataUrl, userId]);
}

// 8 caracteres en base32-ish (sin 0/O/1/I para que no se confundan al
// tipearlo a mano). Con este largo la chance de choque es despreciable para
// la escala de esta app, asi que no hace falta reintentar en un loop.
function generateReferralCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function todayInArgentina() {
  // en-CA da formato YYYY-MM-DD, comodo para comparar como texto.
  return new Date().toLocaleDateString('en-CA', { timeZone: ARG_TZ });
}

function isUnlimitedNow(user) {
  if (user.unlimited) return true;
  if (user.unlimited_until && new Date(user.unlimited_until).getTime() > Date.now()) return true;
  return false;
}

// ---- Planes y suscripciones ----
// Catalogo unico: el backend es la fuente de verdad de precios/limites/
// caracteristicas, el frontend (pagina de precios, modal de limite, "Mi
// plan") solo lo pinta via GET /api/plans. dailyLimit null = sin limite.
//
// Todavia NO hay una pasarela de pago conectada (Stripe/Mercado Pago/etc):
// "elegir" un plan pago desde la pagina de precios llama a
// requestPlanUpgrade, que solo deja constancia del interes
// (requested_plan/requested_plan_at) sin activar nada — activar el plan de
// verdad lo hace un admin a mano (adminSetPlan, desde /admin) hasta que se
// integre un proveedor real. Ver notas en server.js sobre donde enganchar
// el webhook del proveedor cuando este listo.
const PLANS = {
  free: {
    key: 'free',
    name: 'Gratis',
    priceUsd: 0,
    dailyLimit: 3,
    tagline: null,
    features: ['Hasta 3 videos procesados por día', 'Acceso a las funciones básicas', 'No requiere tarjeta'],
    cta: 'Comenzar gratis',
  },
  intermedio: {
    key: 'intermedio',
    name: 'Intermedio',
    priceUsd: 3.99,
    dailyLimit: 15,
    tagline: 'MEJOR RELACIÓN PRECIO/BENEFICIO',
    features: [
      'Hasta 15 videos procesados por día',
      'Todas las herramientas de edición y optimización',
      'Mayor prioridad de procesamiento que el plan gratis',
    ],
    cta: 'Elegir Intermedio',
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    priceUsd: 10.99,
    dailyLimit: null,
    tagline: 'MÁS COMPLETO',
    features: [
      'Videos ilimitados, sin límite diario',
      'Acceso completo a todas las herramientas',
      'Procesamiento prioritario',
      'Acceso a futuras funciones premium',
    ],
    cta: 'Obtener Pro',
  },
};
const PLAN_ORDER = ['free', 'intermedio', 'pro'];
const UPGRADABLE_PLANS = ['intermedio', 'pro'];

function getPlanInfo(planKey) {
  return PLANS[planKey] || PLANS.free;
}

// El limite diario EFECTIVO: un cupon de ilimitado (isUnlimitedNow, ver
// applyCoupon) pisa cualquier plan, igual que ya pisaba el limite fijo de
// 3 antes de que existieran los planes — asi el cupon "dematiu" del equipo
// sigue funcionando igual que siempre. En el plan Gratis, ademas, se aplica
// la recompensa PERMANENTE por buen uso (free_reward_level, ver mas abajo
// "Progreso, logros y recompensas"): 3 normal -> 5 con la primera
// recompensa -> 7 como tope absoluto. Esto NUNCA se calcula ni se confia en
// nada que mande el cliente: free_reward_level vive en la base y solo lo
// escribe updateProgressionOnSuccess, en el propio servidor.
function effectiveDailyLimit(user) {
  if (isUnlimitedNow(user)) return null;
  const plan = getPlanInfo(user.plan);
  if (plan.dailyLimit === null) return null; // Pro: ilimitado, sin importar la gamificacion
  if (user.plan !== 'free') return plan.dailyLimit; // Intermedio: fijo en 15, la recompensa es solo para Gratis
  if (user.free_reward_level >= 2) return 7;
  if (user.free_reward_level >= 1) return 5;
  return plan.dailyLimit; // Gratis sin recompensa: 3
}

// Devuelve el estado de cuota SIN consumir nada (para mostrar en el
// frontend, y para que requireQuota en server.js solo VERIFIQUE que queda
// cupo antes de subir el archivo). El descuento real de un uso pasa recien
// cuando el video termina de procesarse bien, en consumeQuotaOnSuccess.
async function getQuotaStatus(userId) {
  const user = await findById(userId);
  if (!user) return null;
  const plan = getPlanInfo(user.plan);
  const limit = effectiveDailyLimit(user);

  if (limit === null) {
    return {
      unlimited: true,
      until: user.unlimited && !user.unlimited_until ? null : user.unlimited_until,
      used: 0,
      limit: null,
      remaining: null,
      bonus: user.bonus_uses,
      plan: user.plan,
      planName: plan.name,
      requestedPlan: user.requested_plan,
      freeRewardLevel: user.free_reward_level,
    };
  }
  const today = todayInArgentina();
  const used = user.daily_reset_date === today ? user.daily_count : 0;
  const remaining = Math.max(0, limit - used) + user.bonus_uses;
  return {
    unlimited: false,
    used,
    limit,
    remaining,
    bonus: user.bonus_uses,
    plan: user.plan,
    planName: plan.name,
    requestedPlan: user.requested_plan,
    freeRewardLevel: user.free_reward_level,
  };
}

// Descuenta 1 uso: primero del limite diario del plan, y si ya se gasto, de
// los usos extra (bonus_uses) que no vencen solos. Se llama SOLO cuando un
// job termina en 'done' (ver runJob en server.js) — subir un archivo,
// cancelarlo o que falle no gastan cupo, a pedido explicito del dueño de la
// app. Si el usuario tiene plan ilimitado o un cupon de ilimitado, no hace
// nada (no hay nada que descontar).
async function consumeQuotaOnSuccess(userId) {
  const user = await findById(userId);
  if (!user) return;
  const limit = effectiveDailyLimit(user);
  if (limit === null) return;

  const today = todayInArgentina();
  const used = user.daily_reset_date === today ? user.daily_count : 0;

  if (used < limit) {
    await pool.query('UPDATE users SET daily_count = $1, daily_reset_date = $2 WHERE id = $3', [used + 1, today, userId]);
  } else if (user.bonus_uses > 0) {
    await pool.query('UPDATE users SET bonus_uses = bonus_uses - 1, daily_reset_date = $1 WHERE id = $2', [today, userId]);
  }
  // si por una carrera entre dos procesos ya no quedaba cupo (raro, dos
  // videos terminando en el mismo instante), no rompe nada: el contador
  // simplemente no baja de 0 bonus ni se descuenta de mas.
}

// Alguien eligio un plan pago desde la pagina de precios. Como todavia no
// hay pasarela de pago conectada, esto NO activa el plan: solo deja
// constancia de que lo pidio, para que un admin lo confirme a mano (ver
// adminSetPlan) una vez que reciba el pago por fuera (transferencia, link de
// Mercado Pago, etc.) o hasta que se integre un proveedor real.
async function requestPlanUpgrade(userId, planKey) {
  if (!UPGRADABLE_PLANS.includes(planKey)) return { ok: false, error: 'Plan inválido.' };
  const user = await findById(userId);
  if (!user) return { ok: false, error: 'Usuario no encontrado.' };
  if (user.plan === planKey) return { ok: false, error: `Ya tenés el plan ${getPlanInfo(planKey).name}.` };
  await pool.query('UPDATE users SET requested_plan = $1, requested_plan_at = now() WHERE id = $2', [planKey, userId]);
  return {
    ok: true,
    message: `¡Listo! Registramos tu interés en el plan ${getPlanInfo(planKey).name}. En breve lo activamos y te avisamos.`,
  };
}

// Activa (o quita) un plan de verdad. Hoy lo llama solo el panel de admin a
// mano; el dia que se conecte Stripe/Mercado Pago, el webhook de "pago
// confirmado" de ese proveedor deberia llamar a esta misma funcion en vez
// de necesitar que un admin lo apruete uno por uno.
async function adminSetPlan(userId, planKey) {
  if (!PLAN_ORDER.includes(planKey)) return { ok: false, error: 'Plan inválido.' };
  await pool.query(
    'UPDATE users SET plan = $1, requested_plan = NULL, requested_plan_at = NULL, plan_updated_at = now() WHERE id = $2',
    [planKey, userId]
  );
  return { ok: true };
}

// Aplica un cupon del catalogo. Devuelve {ok:true, message} o {ok:false,
// error}. No revela si el codigo "no existe" vs "ya vencio" vs "ya lo
// usaste" con demasiado detalle para no dar pistas, pero si lo suficiente
// para que la persona entienda que paso.
async function applyCoupon(userId, code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return { ok: false, error: 'Ingresá un código.' };

  const { rows: couponRows } = await pool.query(
    `SELECT * FROM coupons WHERE lower(code) = $1 AND active = true
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)`,
    [normalized]
  );
  const coupon = couponRows[0];
  if (!coupon) return { ok: false, error: 'Cupón inválido o vencido.' };

  const already = await pool.query('SELECT 1 FROM coupon_redemptions WHERE user_id = $1 AND coupon_id = $2', [
    userId,
    coupon.id,
  ]);
  if (already.rows.length > 0) return { ok: false, error: 'Ya usaste este cupón antes.' };

  let message;
  if (coupon.type === 'unlimited_permanent') {
    await pool.query('UPDATE users SET unlimited = true WHERE id = $1', [userId]);
    message = '¡Activaste el plan ilimitado en esta cuenta!';
  } else if (coupon.type === 'unlimited_days') {
    await pool.query(
      `UPDATE users SET unlimited_until = GREATEST(COALESCE(unlimited_until, now()), now()) + ($1 || ' days')::interval WHERE id = $2`,
      [coupon.value, userId]
    );
    message = `¡Activaste ${coupon.value} días de carga ilimitada!`;
  } else if (coupon.type === 'extra_uses') {
    await pool.query('UPDATE users SET bonus_uses = bonus_uses + $1 WHERE id = $2', [coupon.value, userId]);
    message = `¡Sumaste ${coupon.value} videos extra a tu cuenta!`;
  } else {
    return { ok: false, error: 'Cupón inválido.' };
  }

  await pool.query('INSERT INTO coupon_redemptions (user_id, coupon_id) VALUES ($1, $2)', [userId, coupon.id]);
  await pool.query('UPDATE coupons SET redemptions_count = redemptions_count + 1 WHERE id = $1', [coupon.id]);

  return { ok: true, message };
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

// Genera un token de recuperacion para el email dado. Devuelve {user, token}
// o null si no existe ninguna cuenta con ese email (el endpoint HTTP igual
// responde "ok" en ambos casos, para no revelar que emails existen).
async function createResetToken(email) {
  const user = await findByEmail(email);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await pool.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [token, expires, user.id]);
  return { user, token };
}

// Busca un usuario por token de recuperacion, solo si todavia no vencio.
async function findByValidResetToken(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > now()',
    [token]
  );
  return rows[0] || null;
}

// Cambia la contraseña y invalida el token (de un solo uso).
async function resetPassword(userId, newPassword) {
  const passwordHash = bcrypt.hashSync(String(newPassword), 10);
  await pool.query(
    'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
    [passwordHash, userId]
  );
}

// referralCodeInput: el codigo de OTRA persona que esta nueva cuenta esta
// canjeando (opcional). Si es valido, se le suma el bono de referido a
// ambas cuentas.
async function createUser(email, password, referralCodeInput) {
  const passwordHash = bcrypt.hashSync(String(password), 10);
  const referrer = referralCodeInput ? await findByReferralCode(referralCodeInput) : null;
  const myReferralCode = generateReferralCode();

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, referral_code, referred_by, bonus_uses)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [normalizeEmail(email), passwordHash, myReferralCode, referrer ? referrer.id : null, referrer ? REFERRAL_BONUS_USES : 0]
  );

  if (referrer) {
    await pool.query('UPDATE users SET bonus_uses = bonus_uses + $1 WHERE id = $2', [REFERRAL_BONUS_USES, referrer.id]);
  }

  return rows[0];
}

// Devuelve el usuario si la contraseña es correcta, o null si no.
async function verifyPassword(email, password) {
  const user = await findByEmail(email);
  if (!user || !user.password_hash) return null;
  const ok = bcrypt.compareSync(String(password || ''), user.password_hash);
  return ok ? user : null;
}

// Usado por el login con Google: busca por google_id; si no existe pero hay
// una cuenta con ese email (creada por registro manual), la vincula en vez
// de duplicarla; si no existe ninguna, crea una cuenta nueva.
async function linkOrCreateGoogleUser({ googleId, email, displayName }) {
  let user = await findByGoogleId(googleId);
  if (user) return user;

  if (email) {
    user = await findByEmail(email);
    if (user) {
      await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]);
      user.google_id = googleId;
      return user;
    }
  }

  const fallbackEmail = email ? normalizeEmail(email) : `google-${googleId}@sin-email.local`;
  const { rows } = await pool.query(
    'INSERT INTO users (email, google_id, display_name, referral_code) VALUES ($1, $2, $3, $4) RETURNING *',
    [fallbackEmail, googleId, displayName || null, generateReferralCode()]
  );
  // isNew: para que el callback de /auth/google en server.js sepa si mandar
  // a esta cuenta recien creada al selector de planes (igual que el
  // registro manual), en vez de derivarla siempre a "/".
  return { ...rows[0], isNew: true };
}

// Cuantas cuentas trajo este usuario con su codigo de referido.
async function countReferrals(userId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE referred_by = $1', [userId]);
  return rows[0].n;
}

// ---- Progreso, niveles, logros y recompensas ----
// Todo lo de aca abajo se actualiza UNA sola vez por video: desde
// updateProgressionOnSuccess, llamada exclusivamente por el 'end' de runJob
// en server.js (el mismo evento de "ffmpeg termino bien" que ya dispara
// consumeQuotaOnSuccess y recordVideoHistory). No hay ningun endpoint que
// reciba de un cliente "sumame un video" — el unico lugar que incrementa
// estos contadores es este, disparado por el propio proceso de ffmpeg en el
// servidor. Asi es imposible manipularlo desde la consola del navegador: no
// hay ningun valor de progreso que el frontend le mande al backend, todo se
// lee siempre desde la base.

// Cuantos videos hacen falta para CADA nivel (indice 0 = nivel 1). Los
// primeros niveles son rapidos a proposito; llegar a los ultimos requiere
// meses de uso real.
const LEVEL_THRESHOLDS = [0, 10, 25, 50, 100, 175, 275, 400, 600, 1000];

function computeLevel(totalVideos) {
  let levelIdx = 0;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (totalVideos >= LEVEL_THRESHOLDS[i]) levelIdx = i;
  }
  const current = LEVEL_THRESHOLDS[levelIdx];
  const next = LEVEL_THRESHOLDS[levelIdx + 1];
  const isMax = next === undefined;
  return {
    level: levelIdx + 1,
    maxLevel: isMax,
    currentThreshold: current,
    nextThreshold: isMax ? null : next,
    videosToNext: isMax ? 0 : next - totalVideos,
    progressPct: isMax ? 100 : Math.max(0, Math.min(100, Math.round(((totalVideos - current) / (next - current)) * 100))),
  };
}

// Catalogo de logros. "check" recibe {totalVideos, activeDays, longestStreak}
// (el estado YA actualizado, en la misma transaccion logica que el video que
// se acaba de contar). Los primeros son faciles a proposito para dar un
// primer empujon; los ultimos piden meses de uso constante, no se
// desbloquean "de arranque".
const ACHIEVEMENTS = [
  { key: 'first_video', icon: '🎬', name: 'Primer paso', desc: 'Procesá tu primer video.', check: (s) => s.totalVideos >= 1 },
  { key: 'starting_25', icon: '🎬', name: 'Arrancando', desc: 'Procesá 25 videos.', check: (s) => s.totalVideos >= 25 },
  { key: 'active_7', icon: '🔥', name: 'En racha', desc: 'Usá la aplicación 7 días diferentes.', check: (s) => s.activeDays >= 7 },
  { key: 'frequent_100', icon: '🎞️', name: 'Editor frecuente', desc: 'Procesá 100 videos.', check: (s) => s.totalVideos >= 100 },
  { key: 'expert_250', icon: '🏆', name: 'Editor experto', desc: 'Procesá 250 videos.', check: (s) => s.totalVideos >= 250 },
  { key: 'active_15', icon: '💪', name: 'Constancia', desc: 'Procesá al menos un video durante 15 días diferentes.', check: (s) => s.activeDays >= 15 },
  { key: 'streak_30', icon: '🔥', name: 'Imparable', desc: 'Alcanzá una racha de 30 días.', check: (s) => s.longestStreak >= 30 },
  { key: 'club_500', icon: '🎬', name: '500 Club', desc: 'Procesá 500 videos.', check: (s) => s.totalVideos >= 500 },
  { key: 'master_1000', icon: '👑', name: 'Maestro del video', desc: 'Procesá 1.000 videos.', check: (s) => s.totalVideos >= 1000 },
];

// Recompensas PERMANENTES para el plan Gratis. level 1 sube el limite a 5,
// level 2 (el tope absoluto) lo sube a 7 — nunca mas alla, sin importar
// cuantos logros junte despues. Requieren uso real y sostenido (no solo
// "cantidad", tambien "dias distintos" y, para la maxima, una racha
// historica minima) para que no se puedan farmear rapido.
const FREE_REWARDS = [
  { level: 1, dailyLimit: 5, videos: 100, activeDays: 20, streak: 0, title: '🎁 ¡Desbloqueaste una recompensa permanente!', message: 'Tu límite gratuito aumentó de 3 a 5 videos por día.' },
  { level: 2, dailyLimit: 7, videos: 500, activeDays: 60, streak: 15, title: '👑 Recompensa máxima del plan Gratis', message: 'Por tu constancia, ahora podés procesar hasta 7 videos por día gratis.' },
];

// El corazon del sistema: se llama UNA vez por cada video que termina bien.
// Actualiza total_videos, la racha (+record historico), los dias activos
// distintos, chequea que logros nuevos se desbloquean, y si corresponde
// otorga (para siempre) la siguiente recompensa de plan Gratis. Devuelve lo
// que se desbloqueo recien AHORA, para que el frontend pueda festejarlo una
// sola vez (se guarda en el job en memoria, ver server.js).
async function updateProgressionOnSuccess(userId, { bytesSaved } = {}) {
  const user = await findById(userId);
  if (!user) return { newAchievements: [], newReward: null };

  const today = todayInArgentina();

  // Dia activo: PRIMARY KEY (user_id, activity_date) hace que un insert
  // repetido el mismo dia no haga nada — asi "dias activos" nunca se cuenta
  // dos veces así se dispare este hook mas de una vez el mismo dia.
  const inserted = await pool.query(
    'INSERT INTO user_active_days (user_id, activity_date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING activity_date',
    [userId, today]
  );
  const isNewActiveDay = inserted.rows.length > 0;

  let newStreak = user.streak_count;
  if (user.last_active_date !== today) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: ARG_TZ });
    newStreak = user.last_active_date === yesterday ? user.streak_count + 1 : 1;
  }
  const newLongestStreak = Math.max(user.longest_streak, newStreak);
  const newTotalVideos = user.total_videos + 1;
  const newActiveDaysCount = isNewActiveDay ? user.active_days_count + 1 : user.active_days_count;
  const bytesToAdd = Number(bytesSaved) > 0 ? Math.round(Number(bytesSaved)) : 0;

  await pool.query(
    `UPDATE users SET total_videos = $1, streak_count = $2, longest_streak = $3, last_active_date = $4,
            active_days_count = $5, total_bytes_saved = total_bytes_saved + $6
     WHERE id = $7`,
    [newTotalVideos, newStreak, newLongestStreak, today, newActiveDaysCount, bytesToAdd, userId]
  );

  const stats = { totalVideos: newTotalVideos, activeDays: newActiveDaysCount, longestStreak: newLongestStreak };

  const { rows: existingRows } = await pool.query('SELECT achievement_key FROM user_achievements WHERE user_id = $1', [userId]);
  const already = new Set(existingRows.map((r) => r.achievement_key));
  const newAchievements = [];
  for (const ach of ACHIEVEMENTS) {
    if (!already.has(ach.key) && ach.check(stats)) {
      await pool.query(
        'INSERT INTO user_achievements (user_id, achievement_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, ach.key]
      );
      newAchievements.push({ key: ach.key, icon: ach.icon, name: ach.name, desc: ach.desc });
    }
  }

  let newReward = null;
  let rewardLevel = user.free_reward_level;
  for (const r of FREE_REWARDS) {
    if (rewardLevel < r.level && stats.totalVideos >= r.videos && stats.activeDays >= r.activeDays && stats.longestStreak >= r.streak) {
      rewardLevel = r.level;
      newReward = r;
    }
  }
  if (newReward) {
    const col = newReward.level === 1 ? 'free_reward1_at' : 'free_reward2_at';
    await pool.query(`UPDATE users SET free_reward_level = $1, ${col} = now() WHERE id = $2`, [rewardLevel, userId]);
  }

  return { newAchievements, newReward, stats };
}

// Todo lo que necesita la pagina "Mi Progreso": nivel, estadisticas, la
// lista completa de logros (bloqueados incluidos, para que sean objetivos
// visibles) y el detalle de cuanto falta para cada proxima recompensa.
async function getProgressSummary(userId) {
  const user = await findById(userId);
  if (!user) return null;

  const level = computeLevel(user.total_videos);
  const { rows } = await pool.query('SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = $1', [userId]);
  const unlockedMap = {};
  rows.forEach((r) => { unlockedMap[r.achievement_key] = r.unlocked_at; });
  const achievements = ACHIEVEMENTS.map((a) => ({
    key: a.key,
    icon: a.icon,
    name: a.name,
    desc: a.desc,
    unlocked: !!unlockedMap[a.key],
    unlockedAt: unlockedMap[a.key] || null,
  }));

  const stats = {
    totalVideos: user.total_videos,
    activeDays: user.active_days_count,
    streak: user.streak_count,
    longestStreak: user.longest_streak,
    bytesSaved: Number(user.total_bytes_saved) || 0,
    achievementsUnlocked: achievements.filter((a) => a.unlocked).length,
    achievementsTotal: achievements.length,
  };

  const nextRewards = FREE_REWARDS.filter((r) => user.free_reward_level < r.level).map((r) => ({
    level: r.level,
    dailyLimit: r.dailyLimit,
    videos: r.videos,
    activeDays: r.activeDays,
    streak: r.streak,
    videosProgress: Math.min(stats.totalVideos, r.videos),
    activeDaysProgress: Math.min(stats.activeDays, r.activeDays),
    streakProgress: Math.min(stats.longestStreak, r.streak),
  }));

  return {
    level,
    stats,
    plan: user.plan,
    freeRewardLevel: user.free_reward_level,
    effectiveDailyLimit: effectiveDailyLimit(user),
    achievements,
    nextRewards,
  };
}

// ---- Historial de videos ----
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

async function recordVideoHistory(userId, { id, title, source, outputSize, filePath }) {
  const expiresAt = new Date(Date.now() + HISTORY_TTL_MS);
  await pool.query(
    `INSERT INTO video_history (id, user_id, title, source, output_size, file_path, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, title, source, outputSize, filePath, expiresAt]
  );
}

async function getVideoHistory(userId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, title, source, output_size, created_at, expires_at, (file_path IS NOT NULL) AS available
     FROM video_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function getHistoryItem(id, userId) {
  const { rows } = await pool.query('SELECT * FROM video_history WHERE id = $1 AND user_id = $2', [id, userId]);
  return rows[0] || null;
}

// Barrido periodico: borra del disco los archivos vencidos y elimina la
// fila. Devuelve cuantos borro (para loguearlo).
async function cleanupExpiredHistory(deleteFileFn) {
  const { rows } = await pool.query('SELECT id, file_path FROM video_history WHERE expires_at < now()');
  for (const row of rows) {
    if (row.file_path) deleteFileFn(row.file_path);
  }
  await pool.query('DELETE FROM video_history WHERE expires_at < now()');
  return rows.length;
}

// Le saca a una cuenta el plan ilimitado (permanente o por dias, de cupon),
// los usos extra que tuviera acumulados (de cupon o de referidos), y la
// vuelve al plan Gratis. Deja el historial de canjes como esta (asi queda
// registro de que en algun momento uso tal cupon), simplemente anula el
// beneficio que le habia dado.
async function revokePlan(userId) {
  await pool.query(
    `UPDATE users SET unlimited = false, unlimited_until = NULL, bonus_uses = 0,
            plan = 'free', requested_plan = NULL, requested_plan_at = NULL, plan_updated_at = now()
     WHERE id = $1`,
    [userId]
  );
}

// Elimina una cuenta por completo. Hay que sacar antes las referencias que
// apuntan a este usuario (si no, la base rechaza el DELETE por las foreign
// keys): a quien invito no se le borra su cuenta, solo se le limpia
// referred_by; el historial de videos se borra (junto con los archivos en
// disco, via deleteFileFn) y tambien sus canjes de cupones.
async function deleteUser(userId, deleteFileFn) {
  await pool.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1', [userId]);

  const { rows: historyRows } = await pool.query('SELECT file_path FROM video_history WHERE user_id = $1', [userId]);
  for (const row of historyRows) {
    if (row.file_path && deleteFileFn) deleteFileFn(row.file_path);
  }
  await pool.query('DELETE FROM video_history WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM coupon_redemptions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_active_days WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_achievements WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM job_feedback WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM feature_ideas WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ---- Feedback sobre un video ya procesado ----
const FEEDBACK_REASONS = [
  'Perdió demasiada calidad',
  'El archivo sigue siendo muy pesado',
  'Problema con el audio',
  'Problema con la resolución',
  'El video no funciona correctamente',
  'Otro',
];

// jobId = el mismo id que video_history.id. El UNIQUE (user_id, job_id) de
// la tabla es lo que de verdad evita el doble voto (no alcanza con
// controlarlo en el frontend): si llega dos veces, la segunda choca contra
// la restriccion y se informa como "ya opinaste", no se duplica nada.
async function submitJobFeedback(userId, { jobId, source, rating, reason, comment }) {
  if (!jobId || !['up', 'down'].includes(rating)) return { ok: false, error: 'Feedback inválido.' };
  const cleanReason = rating === 'down' ? String(reason || '').slice(0, 200) : null;
  const cleanComment = String(comment || '').trim().slice(0, 500) || null;
  try {
    await pool.query(
      `INSERT INTO job_feedback (user_id, job_id, source, rating, reason, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, jobId, source || 'optimizer', rating, cleanReason, cleanComment]
    );
    return { ok: true };
  } catch (err) {
    if (err.code === '23505') return { ok: false, error: 'Ya nos dijiste qué te pareció este video.' };
    throw err;
  }
}

async function getAdminFeedback(limit = 200) {
  const { rows } = await pool.query(
    `SELECT f.id, f.job_id, f.source, f.rating, f.reason, f.comment, f.created_at, u.email
     FROM job_feedback f JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// ---- Ideas de nuevas funciones ----
const FEATURE_CATEGORIES = ['Edición', 'Audio', 'Conversión', 'Exportación', 'Interfaz', 'Nueva herramienta', 'Otro'];
const FEATURE_STATUSES = ['recibida', 'en_revision', 'planeada', 'implementada', 'descartada'];

async function submitFeatureIdea(userId, { title, description, category }) {
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) return { ok: false, error: 'Ponele un título a tu idea.' };
  const cleanCategory = FEATURE_CATEGORIES.includes(category) ? category : 'Otro';
  const cleanDescription = String(description || '').trim().slice(0, 1000) || null;
  await pool.query(
    'INSERT INTO feature_ideas (user_id, title, description, category) VALUES ($1, $2, $3, $4)',
    [userId, cleanTitle, cleanDescription, cleanCategory]
  );
  return { ok: true };
}

async function getAdminFeatureIdeas(limit = 200) {
  const { rows } = await pool.query(
    `SELECT i.id, i.title, i.description, i.category, i.status, i.created_at, u.email
     FROM feature_ideas i JOIN users u ON u.id = i.user_id
     ORDER BY i.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function setFeatureIdeaStatus(ideaId, status) {
  if (!FEATURE_STATUSES.includes(status)) return { ok: false, error: 'Estado inválido.' };
  await pool.query('UPDATE feature_ideas SET status = $1 WHERE id = $2', [status, ideaId]);
  return { ok: true };
}

// ---- Panel de admin ----
async function getAdminStats() {
  const [
    { rows: totalUsersRows },
    { rows: unlimitedRows },
    { rows: todayRows },
    { rows: historyRows },
    { rows: referralRows },
    { rows: planRows },
    { rows: pendingRows },
    { rows: feedbackRows },
    { rows: ideasRows },
    { rows: rewardsRows },
  ] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM users'),
    pool.query('SELECT count(*)::int AS n FROM users WHERE unlimited = true OR (unlimited_until IS NOT NULL AND unlimited_until > now())'),
    pool.query(
      `SELECT COALESCE(sum(daily_count), 0)::int AS n FROM users WHERE daily_reset_date = to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`
    ),
    pool.query('SELECT count(*)::int AS n FROM video_history'),
    pool.query('SELECT count(*)::int AS n FROM users WHERE referred_by IS NOT NULL'),
    pool.query("SELECT plan, count(*)::int AS n FROM users GROUP BY plan"),
    pool.query('SELECT count(*)::int AS n FROM users WHERE requested_plan IS NOT NULL'),
    pool.query("SELECT rating, count(*)::int AS n FROM job_feedback GROUP BY rating"),
    pool.query("SELECT count(*)::int AS n FROM feature_ideas WHERE status = 'recibida'"),
    pool.query('SELECT count(*)::int AS n FROM users WHERE free_reward_level > 0'),
  ]);
  const planCounts = { free: 0, intermedio: 0, pro: 0 };
  planRows.forEach((r) => { planCounts[r.plan] = r.n; });
  const feedbackCounts = { up: 0, down: 0 };
  feedbackRows.forEach((r) => { feedbackCounts[r.rating] = r.n; });
  return {
    totalUsers: totalUsersRows[0].n,
    unlimitedUsers: unlimitedRows[0].n,
    videosToday: todayRows[0].n,
    videosInHistory: historyRows[0].n,
    totalReferrals: referralRows[0].n,
    planCounts,
    pendingUpgrades: pendingRows[0].n,
    feedbackCounts,
    pendingIdeas: ideasRows[0].n,
    usersWithFreeReward: rewardsRows[0].n,
  };
}

async function getAdminUsers(limit = 200) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.created_at, u.unlimited, u.unlimited_until, u.daily_count, u.daily_reset_date,
            u.bonus_uses, u.referral_code, u.plan, u.requested_plan, u.requested_plan_at,
            (SELECT count(*)::int FROM users r WHERE r.referred_by = u.id) AS referrals_made
     FROM users u ORDER BY u.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getAdminCoupons() {
  const { rows } = await pool.query('SELECT * FROM coupons ORDER BY created_at ASC');
  return rows;
}

module.exports = {
  findByEmail,
  findByGoogleId,
  findById,
  findByReferralCode,
  createUser,
  verifyPassword,
  linkOrCreateGoogleUser,
  setAvatar,
  getQuotaStatus,
  consumeQuotaOnSuccess,
  applyCoupon,
  DAILY_LIMIT,
  PLANS,
  PLAN_ORDER,
  getPlanInfo,
  requestPlanUpgrade,
  adminSetPlan,
  createResetToken,
  findByValidResetToken,
  resetPassword,
  countReferrals,
  updateProgressionOnSuccess,
  getProgressSummary,
  computeLevel,
  ACHIEVEMENTS,
  FREE_REWARDS,
  revokePlan,
  deleteUser,
  recordVideoHistory,
  getVideoHistory,
  getHistoryItem,
  cleanupExpiredHistory,
  FEEDBACK_REASONS,
  submitJobFeedback,
  getAdminFeedback,
  FEATURE_CATEGORIES,
  FEATURE_STATUSES,
  submitFeatureIdea,
  getAdminFeatureIdeas,
  setFeatureIdeaStatus,
  isAdminEmail,
  getAdminStats,
  getAdminUsers,
  getAdminCoupons,
  ADMIN_EMAIL,
};
