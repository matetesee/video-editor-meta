const bcrypt = require('bcryptjs');

// Los usuarios se definen por variable de entorno APP_USERS (no se guardan
// en el codigo ni en un archivo, para que agregar/sacar gente del equipo no
// requiera tocar el repo). Formato esperado:
//   APP_USERS = [{"username":"dematiu","passwordHash":"$2a$..."}]
// El hash se genera con bcrypt (ver README para el comando).
function loadUsers() {
  const raw = process.env.APP_USERS;
  if (!raw) {
    console.warn(
      '[auth] APP_USERS no esta configurada: usando usuario por defecto "admin"/"admin" ' +
      '(SOLO para probar en local, no usar asi en producción).'
    );
    return [{ username: 'admin', passwordHash: bcrypt.hashSync('admin', 8) }];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('APP_USERS debe ser un array JSON');
    return parsed;
  } catch (err) {
    console.error('[auth] APP_USERS tiene un JSON invalido:', err.message);
    return [];
  }
}

const USERS = loadUsers();

function findUser(username) {
  const name = String(username || '').toLowerCase();
  return USERS.find((u) => u.username.toLowerCase() === name);
}

function verifyPassword(username, password) {
  const user = findUser(username);
  if (!user) return false;
  return bcrypt.compareSync(String(password || ''), user.passwordHash);
}

// Para paginas normales (GET /): si no hay sesion, redirige al login.
function requireAuthPage(req, res, next) {
  if (req.session && req.session.username) return next();
  return res.redirect('/login');
}

// Para rutas de API: si no hay sesion, responde 401 JSON (el frontend
// redirige el mismo al login).
function requireAuthApi(req, res, next) {
  if (req.session && req.session.username) return next();
  return res.status(401).json({ error: 'No autenticado. Iniciá sesión de nuevo.' });
}

module.exports = { verifyPassword, findUser, requireAuthPage, requireAuthApi };
