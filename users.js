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

// Devuelve el estado de cuota SIN consumir nada (para mostrar en el
// frontend). Si cambio el dia respecto a lo guardado, lo informa como si ya
// estuviera reseteado (el reseteo real en la base se hace recien al
// consumir, en consumeQuota, para no pisar concurrencia sin necesidad).
async function getQuotaStatus(userId) {
  const user = await findById(userId);
  if (!user) return null;
  if (isUnlimitedNow(user)) {
    return {
      unlimited: true,
      until: user.unlimited && !user.unlimited_until ? null : user.unlimited_until,
      used: 0,
      limit: DAILY_LIMIT,
      remaining: null,
      bonus: user.bonus_uses,
    };
  }
  const today = todayInArgentina();
  const used = user.daily_reset_date === today ? user.daily_count : 0;
  const remaining = Math.max(0, DAILY_LIMIT - used) + user.bonus_uses;
  return { unlimited: false, used, limit: DAILY_LIMIT, remaining, bonus: user.bonus_uses };
}

// Intenta consumir 1 uso: primero del limite diario, y si ya se gasto, de
// los usos extra (bonus_uses) que no vencen solos. Devuelve {allowed, ...}.
async function consumeQuota(userId) {
  const user = await findById(userId);
  if (!user) return { allowed: false, reason: 'Usuario no encontrado.' };
  if (isUnlimitedNow(user)) return { allowed: true, unlimited: true };

  const today = todayInArgentina();
  const used = user.daily_reset_date === today ? user.daily_count : 0;

  if (used < DAILY_LIMIT) {
    const newUsed = used + 1;
    await pool.query('UPDATE users SET daily_count = $1, daily_reset_date = $2 WHERE id = $3', [newUsed, today, userId]);
    return { allowed: true, used: newUsed, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - newUsed + user.bonus_uses };
  }

  if (user.bonus_uses > 0) {
    await pool.query('UPDATE users SET bonus_uses = bonus_uses - 1, daily_reset_date = $1 WHERE id = $2', [today, userId]);
    return { allowed: true, used: DAILY_LIMIT, limit: DAILY_LIMIT, remaining: user.bonus_uses - 1 };
  }

  return { allowed: false, used, limit: DAILY_LIMIT, remaining: 0 };
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
  return rows[0];
}

// Cuantas cuentas trajo este usuario con su codigo de referido.
async function countReferrals(userId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE referred_by = $1', [userId]);
  return rows[0].n;
}

// ---- Gamificacion: racha de uso + insignias ----

// Se llama cada vez que un job termina bien (ver el 'end' de runJob en
// server.js). Suma 1 al contador total (para las insignias de cantidad) y
// actualiza la racha de dias consecutivos: si hoy ya estaba contado no
// vuelve a subir la racha, si el ultimo dia activo fue ayer la extiende, y
// si hubo un salto de mas de un dia la reinicia en 1.
async function recordVideoCompletion(userId) {
  const user = await findById(userId);
  if (!user) return;
  const today = todayInArgentina();
  if (user.last_active_date === today) {
    await pool.query('UPDATE users SET total_videos = total_videos + 1 WHERE id = $1', [userId]);
    return;
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: ARG_TZ });
  const newStreak = user.last_active_date === yesterday ? user.streak_count + 1 : 1;
  await pool.query(
    'UPDATE users SET total_videos = total_videos + 1, streak_count = $1, last_active_date = $2 WHERE id = $3',
    [newStreak, today, userId]
  );
}

// Insignias calculadas al vuelo a partir de datos que ya tenemos (no hace
// falta una tabla aparte: no se "otorgan" una vez y quedan, se recalculan
// segun el estado actual de la cuenta cada vez que se piden).
async function getBadges(userId) {
  const user = await findById(userId);
  if (!user) return [];
  const referrals = await countReferrals(userId);
  const unlimited = isUnlimitedNow(user);
  return [
    { id: 'first_video', icon: '🎬', label: 'Primer video', unlocked: user.total_videos >= 1 },
    { id: 'ten_videos', icon: '📼', label: '10 videos procesados', unlocked: user.total_videos >= 10 },
    { id: 'fifty_videos', icon: '🚀', label: '50 videos procesados', unlocked: user.total_videos >= 50 },
    { id: 'streak_3', icon: '🔥', label: 'Racha de 3 días', unlocked: user.streak_count >= 3 },
    { id: 'streak_7', icon: '🔥', label: 'Racha de 7 días', unlocked: user.streak_count >= 7 },
    { id: 'first_referral', icon: '🤝', label: 'Primer referido', unlocked: referrals >= 1 },
    { id: 'five_referrals', icon: '🌟', label: '5 referidos', unlocked: referrals >= 5 },
    { id: 'unlimited', icon: '✨', label: 'Cuenta ilimitada', unlocked: unlimited },
  ];
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

// ---- Panel de admin ----
async function getAdminStats() {
  const [{ rows: totalUsersRows }, { rows: unlimitedRows }, { rows: todayRows }, { rows: historyRows }, { rows: referralRows }] =
    await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM users'),
      pool.query('SELECT count(*)::int AS n FROM users WHERE unlimited = true OR (unlimited_until IS NOT NULL AND unlimited_until > now())'),
      pool.query(
        `SELECT COALESCE(sum(daily_count), 0)::int AS n FROM users WHERE daily_reset_date = to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`
      ),
      pool.query('SELECT count(*)::int AS n FROM video_history'),
      pool.query('SELECT count(*)::int AS n FROM users WHERE referred_by IS NOT NULL'),
    ]);
  return {
    totalUsers: totalUsersRows[0].n,
    unlimitedUsers: unlimitedRows[0].n,
    videosToday: todayRows[0].n,
    videosInHistory: historyRows[0].n,
    totalReferrals: referralRows[0].n,
  };
}

async function getAdminUsers(limit = 200) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.created_at, u.unlimited, u.unlimited_until, u.daily_count, u.daily_reset_date,
            u.bonus_uses, u.referral_code,
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
  consumeQuota,
  applyCoupon,
  DAILY_LIMIT,
  createResetToken,
  findByValidResetToken,
  resetPassword,
  countReferrals,
  recordVideoCompletion,
  getBadges,
  recordVideoHistory,
  getVideoHistory,
  getHistoryItem,
  cleanupExpiredHistory,
  isAdminEmail,
  getAdminStats,
  getAdminUsers,
  getAdminCoupons,
  ADMIN_EMAIL,
};
