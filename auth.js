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

module.exports = { requireAuthPage, requireAuthApi };
