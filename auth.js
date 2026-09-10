const { isAdminEmail } = require('./users');

// Para paginas normales (GET /): si no hay sesion, redirige al login.
function requireAuthPage(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

// Para rutas de API: si no hay sesion, responde 401 JSON (el frontend
// redirige el mismo al login).
function requireAuthApi(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'No autenticado. Iniciá sesión de nuevo.' });
}

// Solo para la cuenta admin (matetesee@gmail.com, ver ADMIN_EMAIL en
// users.js). Se asume que ya paso por requireAuthPage/requireAuthApi antes.
function requireAdminPage(req, res, next) {
  if (req.session && req.session.user && isAdminEmail(req.session.user.email)) return next();
  return res.redirect('/');
}

function requireAdminApi(req, res, next) {
  if (req.session && req.session.user && isAdminEmail(req.session.user.email)) return next();
  return res.status(403).json({ error: 'No autorizado.' });
}

module.exports = { requireAuthPage, requireAuthApi, requireAdminPage, requireAdminApi };
