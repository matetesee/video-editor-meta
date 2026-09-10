const bcrypt = require('bcryptjs');
const { pool } = require('./db');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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

async function setAvatar(userId, dataUrl) {
  await pool.query('UPDATE users SET avatar_data_url = $1 WHERE id = $2', [dataUrl, userId]);
}

const DAILY_LIMIT = 3;
const COUPON_CODE = 'dematiu';
// El dia "de hoy" se calcula en huso horario de Argentina (no UTC ni el del
// servidor) para que el limite se resetee a la medianoche que el usuario
// realmente ve en su reloj.
const ARG_TZ = 'America/Argentina/Buenos_Aires';

function todayInArgentina() {
  // en-CA da formato YYYY-MM-DD, comodo para comparar como texto.
  return new Date().toLocaleDateString('en-CA', { timeZone: ARG_TZ });
}

// Devuelve el estado de cuota SIN consumir nada (para mostrar en el
// frontend). Si cambio el dia respecto a lo guardado, lo informa como si ya
// estuviera reseteado (el reseteo real en la base se hace recien al
// consumir, en consumeQuota, para no pisar concurrencia sin necesidad).
async function getQuotaStatus(userId) {
  const user = await findById(userId);
  if (!user) return null;
  if (user.unlimited) return { unlimited: true, used: 0, limit: DAILY_LIMIT, remaining: null };
  const today = todayInArgentina();
  const used = user.daily_reset_date === today ? user.daily_count : 0;
  return { unlimited: false, used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) };
}

// Intenta consumir 1 uso del limite diario. Devuelve {allowed, ...}. Si el
// usuario tiene el cupon aplicado (unlimited), siempre permite.
async function consumeQuota(userId) {
  const user = await findById(userId);
  if (!user) return { allowed: false, reason: 'Usuario no encontrado.' };
  if (user.unlimited) return { allowed: true, unlimited: true };

  const today = todayInArgentina();
  const used = user.daily_reset_date === today ? user.daily_count : 0;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used, limit: DAILY_LIMIT, remaining: 0 };
  }

  const newUsed = used + 1;
  await pool.query('UPDATE users SET daily_count = $1, daily_reset_date = $2 WHERE id = $3', [newUsed, today, userId]);
  return { allowed: true, used: newUsed, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - newUsed };
}

// Aplica el cupon de carga ilimitada. Devuelve true/false segun si el
// codigo era correcto (no revela el codigo real en el mensaje de error).
async function applyCoupon(userId, code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (normalized !== COUPON_CODE) return false;
  await pool.query('UPDATE users SET unlimited = true WHERE id = $1', [userId]);
  return true;
}

async function createUser(email, password, displayName) {
  const passwordHash = bcrypt.hashSync(String(password), 10);
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *',
    [normalizeEmail(email), passwordHash, displayName || null]
  );
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
    'INSERT INTO users (email, google_id, display_name) VALUES ($1, $2, $3) RETURNING *',
    [fallbackEmail, googleId, displayName || null]
  );
  return rows[0];
}

module.exports = {
  findByEmail,
  findByGoogleId,
  findById,
  createUser,
  verifyPassword,
  linkOrCreateGoogleUser,
  setAvatar,
  getQuotaStatus,
  consumeQuota,
  applyCoupon,
  DAILY_LIMIT,
};
