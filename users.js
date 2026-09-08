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

module.exports = { findByEmail, findByGoogleId, createUser, verifyPassword, linkOrCreateGoogleUser };
