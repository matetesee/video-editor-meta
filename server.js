const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { randomUUID } = crypto;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { pool, initDb } = require('./db');
const {
  createUser,
  findByEmail,
  findById,
  verifyPassword,
  linkOrCreateGoogleUser,
  setAvatar,
  getQuotaStatus,
  consumeQuotaOnSuccess,
  PLANS,
  PLAN_ORDER,
  getPlanInfo,
  requestPlanUpgrade,
  adminSetPlan,
  applyCoupon,
  createResetToken,
  findByValidResetToken,
  resetPassword,
  countReferrals,
  updateProgressionOnSuccess,
  getProgressSummary,
  computeBadges,
  getPersonalization,
  setPersonalization,
  TOOLS,
  getFavoriteTools,
  toggleFavoriteTool,
  getDashboardLayout,
  setDashboardLayout,
  resetDashboardLayout,
  getPersonalRecords,
  getSnakeHighScore,
  submitSnakeScore,
  getDinoHighScore,
  submitDinoScore,
  getDinoSkins,
  setDinoSkin,
  isDinoAllSkinsUnlocked,
  setDinoAllSkinsUnlocked,
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
} = require('./users');
const { requireAuthPage, requireAuthApi, requireAdminPage, requireAdminApi } = require('./auth');
const { sendResetPasswordEmail } = require('./mailer');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();
const PORT = process.env.PORT || 3000;

const TMP_DIR = path.join(os.tmpdir(), 'video-editor-meta');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max
});

const GOOGLE_ENABLED = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const PUBLIC_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${PORT}`;

if (GOOGLE_ENABLED) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${PUBLIC_URL}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          const user = await linkOrCreateGoogleUser({
            googleId: profile.id,
            email,
            displayName: profile.displayName,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

// Railway sirve HTTPS desde su proxy: hay que confiar en el header
// X-Forwarded-Proto para que la cookie "secure" funcione bien.
app.set('trust proxy', 1);

app.use(express.json());
app.use(
  session({
    // Las sesiones se guardan en Postgres (no en memoria): sobreviven a
    // los redeploys, y no se pierden si hay mas de una instancia corriendo.
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: !!process.env.RAILWAY_ENVIRONMENT,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    },
  })
);
app.use(passport.initialize());

// login.html, script.js, style.css, etc. quedan accesibles sin sesion (no
// tienen nada sensible); app.html NO esta en esta carpeta con ese nombre
// "index" para que no se sirva solo con /: se manda explicitamente mas
// abajo, ya protegido por requireAuthPage.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/api/auth-config', (req, res) => {
  res.json({ googleEnabled: GOOGLE_ENABLED });
});

app.post('/api/register', async (req, res) => {
  const { email, password, referralCode } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingresá un email válido.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
  }
  try {
    const existing = await findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    const user = await createUser(email, password, referralCode);
    req.session.user = { id: user.id, email: user.email };
    res.json({ ok: true });
  } catch (err) {
    console.error('[register]', err.message);
    res.status(500).json({ error: 'No se pudo crear la cuenta. Probá de nuevo.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await verifyPassword(email, password);
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    req.session.user = { id: user.id, email: user.email };
    res.json({ ok: true });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'No se pudo iniciar sesión. Probá de nuevo.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuthApi, async (req, res) => {
  try {
    const user = await findById(req.session.user.id);
    const quota = await getQuotaStatus(req.session.user.id);
    const referrals = await countReferrals(req.session.user.id);
    res.json({
      email: req.session.user.email,
      displayName: (user && user.display_name) || null,
      avatarUrl: (user && user.avatar_data_url) || null,
      quota,
      referralCode: user && user.referral_code,
      referrals,
      isAdmin: isAdminEmail(req.session.user.email),
      streak: (user && user.streak_count) || 0,
      totalVideos: (user && user.total_videos) || 0,
      badges: user ? computeBadges(user) : null,
      personalization: user
        ? { avatar: user.selected_avatar, border: user.selected_border, accentTheme: user.selected_accent_theme }
        : null,
      impersonating: !!(req.session.impersonator),
      impersonatorEmail: req.session.impersonator ? req.session.impersonator.email : null,
    });
  } catch (err) {
    res.json({ email: req.session.user.email, avatarUrl: null, quota: null });
  }
});

// ---- Soporte: el admin puede "entrar" a la cuenta de un usuario para ver
// exactamente lo que esa persona ve, sin pedirle la contraseña. Guarda quien
// era el admin original en session.impersonator para poder volver despues.
app.post('/api/admin/impersonate/:userId', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    if (req.session.impersonator) {
      return res.status(400).json({ error: 'Ya estás viendo la cuenta de otra persona. Volvé a admin primero.' });
    }
    const targetId = parseInt(req.params.userId, 10);
    if (targetId === req.session.user.id) {
      return res.status(400).json({ error: 'Esa es tu propia cuenta.' });
    }
    const target = await findById(targetId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

    req.session.impersonator = { id: req.session.user.id, email: req.session.user.email };
    req.session.user = { id: target.id, email: target.email };
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/impersonate]', err.message);
    res.status(500).json({ error: 'No se pudo entrar a esa cuenta.' });
  }
});

app.post('/api/admin/stop-impersonate', requireAuthApi, (req, res) => {
  if (!req.session.impersonator) return res.status(400).json({ error: 'No estás viendo la cuenta de otra persona.' });
  req.session.user = req.session.impersonator;
  req.session.impersonator = null;
  res.json({ ok: true });
});

app.post('/api/coupon', requireAuthApi, async (req, res) => {
  try {
    const result = await applyCoupon(req.session.user.id, req.body && req.body.code);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const quota = await getQuotaStatus(req.session.user.id);
    res.json({ ok: true, message: result.message, quota });
  } catch (err) {
    console.error('[coupon]', err.message);
    res.status(500).json({ error: 'No se pudo aplicar el cupón. Probá de nuevo.' });
  }
});

// Catalogo de planes (publico: lo usa tanto la pagina de precios como el
// modal de "llegaste al limite", este ultimo ya autenticado pero no hace
// falta requireAuthApi para pedir precios). El backend es la unica fuente
// de verdad: si el dia de mañana cambian precios/limites, se edita PLANS en
// users.js y toda la UI (precios.html, el modal de limite, "Mi plan") se
// actualiza sola.
app.get('/api/plans', (req, res) => {
  res.json({ plans: PLAN_ORDER.map((k) => PLANS[k]) });
});

// El usuario eligio un plan pago desde la pagina de precios. Todavia no hay
// pasarela de pago conectada (ver nota en requestPlanUpgrade, users.js):
// esto NO activa el plan, solo deja constancia del interes para que un
// admin lo confirme a mano desde /admin una vez que reciba el pago.
app.post('/api/plan/upgrade-request', requireAuthApi, async (req, res) => {
  try {
    const result = await requestPlanUpgrade(req.session.user.id, req.body && req.body.plan);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, message: result.message });
  } catch (err) {
    console.error('[plan-upgrade-request]', err.message);
    res.status(500).json({ error: 'No se pudo registrar tu pedido. Probá de nuevo.' });
  }
});

// Volver al plan Gratis es siempre autoservicio e inmediato (no hay pago
// de por medio, asi que no necesita confirmacion de un admin).
app.post('/api/plan/downgrade-free', requireAuthApi, async (req, res) => {
  try {
    const result = await adminSetPlan(req.session.user.id, 'free');
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[plan-downgrade]', err.message);
    res.status(500).json({ error: 'No se pudo cambiar el plan.' });
  }
});

// Admin: activa (o quita) un plan de verdad para una cuenta. Hoy es manual;
// el dia que se conecte Stripe/Mercado Pago, su webhook deberia llamar a
// adminSetPlan directamente en vez de necesitar este endpoint a mano.
app.post('/api/admin/users/:id/set-plan', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = await findById(targetId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const result = await adminSetPlan(targetId, req.body && req.body.plan);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/set-plan]', err.message);
    res.status(500).json({ error: 'No se pudo cambiar el plan.' });
  }
});

app.post('/api/me/avatar', requireAuthApi, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
  const inputPath = req.file.path;
  const outputPath = path.join(TMP_DIR, `avatar-${randomUUID()}.jpg`);
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vf', 'scale=256:256:force_original_aspect_ratio=increase,crop=256:256', '-frames:v', '1', '-q:v', '4'])
        .on('error', reject)
        .on('end', resolve)
        .save(outputPath);
    });
    const buffer = fs.readFileSync(outputPath);
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    await setAvatar(req.session.user.id, dataUrl);
    res.json({ avatarUrl: dataUrl });
  } catch (err) {
    console.error('[avatar]', err.message);
    res.status(500).json({ error: 'No se pudo procesar la imagen. Probá con otra foto.' });
  } finally {
    fs.unlink(inputPath, () => {});
    fs.unlink(outputPath, () => {});
  }
});

if (GOOGLE_ENABLED) {
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/login' }),
    (req, res) => {
      req.session.user = { id: req.user.id, email: req.user.email };
      // Cuenta nueva (primer login con Google) -> selector de planes, igual
      // que el registro manual con email/contraseña.
      res.redirect(req.user.isNew ? '/precios?bienvenida=1' : '/');
    }
  );
}

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Publica a proposito (sin requireAuthPage): sirve tanto de landing de
// precios para gente sin cuenta todavia como de "cambiar plan" para quien
// ya esta logueado (precios.js se adapta segun haya sesion o no).
app.get('/precios', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'precios.html'));
});

app.post('/api/forgot-password', async (req, res) => {
  // Siempre responde "ok", exista o no la cuenta: asi nadie puede usar este
  // endpoint para averiguar que emails estan registrados.
  try {
    const result = await createResetToken(req.body && req.body.email);
    if (result) {
      const resetUrl = `${PUBLIC_URL}/reset-password?token=${result.token}`;
      await sendResetPasswordEmail(result.user.email, resetUrl);
    }
  } catch (err) {
    console.error('[forgot-password]', err.message);
  }
  res.json({ ok: true });
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
  }
  try {
    const user = await findByValidResetToken(token);
    if (!user) return res.status(400).json({ error: 'El link venció o ya se usó. Pedí uno nuevo.' });
    await resetPassword(user.id, password);
    req.session.user = { id: user.id, email: user.email }; // ya queda logueado
    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña. Probá de nuevo.' });
  }
});

// Sin sesion: landing publica (marketing). Con sesion: la app de una.
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.sendFile(path.join(__dirname, 'public', 'app.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/admin', requireAuthPage, requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/stats', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    res.json(await getAdminStats());
  } catch (err) {
    console.error('[admin/stats]', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las estadísticas.' });
  }
});

app.get('/api/admin/users', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    res.json(await getAdminUsers());
  } catch (err) {
    console.error('[admin/users]', err.message);
    res.status(500).json({ error: 'No se pudo cargar la lista de usuarios.' });
  }
});

app.get('/api/admin/dino-settings', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    res.json({ allSkinsUnlocked: await isDinoAllSkinsUnlocked() });
  } catch (err) {
    console.error('[admin/dino-settings]', err.message);
    res.status(500).json({ error: 'No se pudo cargar la configuración.' });
  }
});

app.post('/api/admin/dino-settings', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    await setDinoAllSkinsUnlocked(!!(req.body && req.body.allSkinsUnlocked));
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/dino-settings-save]', err.message);
    res.status(500).json({ error: 'No se pudo guardar la configuración.' });
  }
});

app.get('/api/admin/coupons', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    res.json(await getAdminCoupons());
  } catch (err) {
    console.error('[admin/coupons]', err.message);
    res.status(500).json({ error: 'No se pudieron cargar los cupones.' });
  }
});

// Le saca a la cuenta el plan ilimitado (permanente o por dias) y los usos
// extra acumulados, sin borrar la cuenta. Util cuando alguien abuso de un
// cupon o pidio que le cancelen el beneficio.
app.post('/api/admin/users/:id/revoke-plan', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = await findById(targetId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
    await revokePlan(targetId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/revoke-plan]', err.message);
    res.status(500).json({ error: 'No se pudo quitar el plan.' });
  }
});

// Elimina una cuenta por completo (datos, historial y canjes de cupones).
// No se puede borrar la propia cuenta admin ni a uno mismo desde acá.
app.delete('/api/admin/users/:id', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.session.user.id) {
      return res.status(400).json({ error: 'No podés eliminar tu propia cuenta desde acá.' });
    }
    const target = await findById(targetId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (isAdminEmail(target.email)) {
      return res.status(400).json({ error: 'No se puede eliminar la cuenta de administrador.' });
    }
    await deleteUser(targetId, cleanupFile);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/delete-user]', err.message);
    res.status(500).json({ error: 'No se pudo eliminar la cuenta.' });
  }
});

// ---- Progreso, logros y recompensas ("Mi Progreso") ----
// Todo lo que devuelve sale de la base (nivel, logros, dias activos,
// racha, recompensa de plan gratis): no hay ningun campo de progreso que
// este endpoint lea del cliente, asi que no hay nada que un usuario pueda
// mandar manipulado para "adelantarse" — ver updateProgressionOnSuccess en
// users.js, el unico lugar que escribe estos valores.
app.get('/api/progress', requireAuthApi, async (req, res) => {
  try {
    const data = await getProgressSummary(req.session.user.id);
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(data);
  } catch (err) {
    console.error('[progress]', err.message);
    res.status(500).json({ error: 'No se pudo cargar tu progreso.' });
  }
});

// ---- Records personales ----
// Todo sale de columnas que ya se actualizan solas en cada video (ver
// updateProgressionOnSuccess) — no se recorre el historial completo aca.
app.get('/api/records', requireAuthApi, async (req, res) => {
  try {
    const data = await getPersonalRecords(req.session.user.id);
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(data);
  } catch (err) {
    console.error('[records]', err.message);
    res.status(500).json({ error: 'No se pudieron cargar tus récords.' });
  }
});

// ---- Minijuego de la serpiente (🐍, "para joda") ----
// Sin ninguna conexion con cuota/plan/logros: es solo un puntaje guardado
// por cuenta en vez de en localStorage, para que se vea igual en cualquier
// dispositivo.
app.get('/api/snake-score', requireAuthApi, async (req, res) => {
  try {
    res.json({ highScore: await getSnakeHighScore(req.session.user.id) });
  } catch (err) {
    console.error('[snake-score]', err.message);
    res.status(500).json({ error: 'No se pudo cargar el récord.' });
  }
});

app.post('/api/snake-score', requireAuthApi, async (req, res) => {
  try {
    const result = await submitSnakeScore(req.session.user.id, req.body && req.body.score);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[snake-score-save]', err.message);
    res.status(500).json({ error: 'No se pudo guardar el récord.' });
  }
});

// ---- Minijuego del dinosaurio (🦖, "para joda", mismo espiritu que la serpiente) ----
app.get('/api/dino-score', requireAuthApi, async (req, res) => {
  try {
    res.json({ highScore: await getDinoHighScore(req.session.user.id) });
  } catch (err) {
    console.error('[dino-score]', err.message);
    res.status(500).json({ error: 'No se pudo cargar el récord.' });
  }
});

app.post('/api/dino-score', requireAuthApi, async (req, res) => {
  try {
    const result = await submitDinoScore(req.session.user.id, req.body && req.body.score);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[dino-score-save]', err.message);
    res.status(500).json({ error: 'No se pudo guardar el récord.' });
  }
});

app.get('/api/dino-skins', requireAuthApi, async (req, res) => {
  try {
    const data = await getDinoSkins(req.session.user.id);
    res.json(data);
  } catch (err) {
    console.error('[dino-skins]', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las skins.' });
  }
});

app.post('/api/dino-skin', requireAuthApi, async (req, res) => {
  try {
    const result = await setDinoSkin(req.session.user.id, req.body && req.body.skin);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[dino-skin-save]', err.message);
    res.status(500).json({ error: 'No se pudo guardar la skin.' });
  }
});

// ---- Personalizacion (avatares/bordes/temas, 100% cosmetica) ----
// setPersonalization valida el nivel REAL (calculado del total_videos que
// guarda el servidor) antes de aceptar una eleccion — nada de esto confia
// en un "level" que mande el cliente.
app.get('/api/personalization', requireAuthApi, async (req, res) => {
  try {
    const data = await getPersonalization(req.session.user.id);
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(data);
  } catch (err) {
    console.error('[personalization]', err.message);
    res.status(500).json({ error: 'No se pudo cargar la personalización.' });
  }
});

app.post('/api/personalization', requireAuthApi, async (req, res) => {
  try {
    const { avatar, border, accentTheme } = req.body || {};
    const result = await setPersonalization(req.session.user.id, { avatar, border, accentTheme });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[personalization-save]', err.message);
    res.status(500).json({ error: 'No se pudo guardar tu elección.' });
  }
});

// ---- Herramientas favoritas ----
app.get('/api/favorites', requireAuthApi, async (req, res) => {
  try {
    res.json({ tools: TOOLS, favorites: await getFavoriteTools(req.session.user.id) });
  } catch (err) {
    console.error('[favorites]', err.message);
    res.status(500).json({ error: 'No se pudieron cargar tus favoritos.' });
  }
});

app.post('/api/favorites/:toolKey', requireAuthApi, async (req, res) => {
  try {
    const result = await toggleFavoriteTool(req.session.user.id, req.params.toolKey);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[favorites-toggle]', err.message);
    res.status(500).json({ error: 'No se pudo actualizar el favorito.' });
  }
});

// ---- Dashboard personalizable (orden de cards de "Mi Progreso") ----
app.get('/api/dashboard-layout', requireAuthApi, async (req, res) => {
  try {
    res.json({ layout: await getDashboardLayout(req.session.user.id) });
  } catch (err) {
    console.error('[dashboard-layout]', err.message);
    res.status(500).json({ error: 'No se pudo cargar el orden del dashboard.' });
  }
});

app.post('/api/dashboard-layout', requireAuthApi, async (req, res) => {
  try {
    const result = await setDashboardLayout(req.session.user.id, (req.body || {}).order);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[dashboard-layout-save]', err.message);
    res.status(500).json({ error: 'No se pudo guardar el orden.' });
  }
});

app.post('/api/dashboard-layout/reset', requireAuthApi, async (req, res) => {
  try {
    await resetDashboardLayout(req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[dashboard-layout-reset]', err.message);
    res.status(500).json({ error: 'No se pudo restaurar el orden.' });
  }
});

// ---- Feedback sobre un video ya procesado ----
app.get('/api/feedback/reasons', (req, res) => res.json({ reasons: FEEDBACK_REASONS }));

app.post('/api/feedback', requireAuthApi, async (req, res) => {
  try {
    const { jobId, source, rating, reason, comment } = req.body || {};
    // El jobId tiene que ser un video que de verdad termino bien para ESTE
    // usuario (no cualquier UUID inventado): se valida contra el historial,
    // que es lo unico que escribe el propio backend al terminar un job.
    const item = await getHistoryItem(jobId, req.session.user.id);
    if (!item) return res.status(404).json({ error: 'Ese video no existe o no es tuyo.' });
    const result = await submitJobFeedback(req.session.user.id, { jobId, source, rating, reason, comment });
    if (!result.ok) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[feedback]', err.message);
    res.status(500).json({ error: 'No se pudo guardar tu opinión.' });
  }
});

// ---- Ideas de nuevas funciones ----
app.get('/api/feature-ideas/categories', (req, res) => res.json({ categories: FEATURE_CATEGORIES }));

app.post('/api/feature-ideas', requireAuthApi, async (req, res) => {
  try {
    const { title, description, category } = req.body || {};
    const result = await submitFeatureIdea(req.session.user.id, { title, description, category });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[feature-idea]', err.message);
    res.status(500).json({ error: 'No se pudo enviar tu idea.' });
  }
});

app.get('/api/admin/feedback', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    res.json(await getAdminFeedback());
  } catch (err) {
    console.error('[admin/feedback]', err.message);
    res.status(500).json({ error: 'No se pudo cargar el feedback.' });
  }
});

app.get('/api/admin/feature-ideas', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    res.json(await getAdminFeatureIdeas());
  } catch (err) {
    console.error('[admin/feature-ideas]', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las ideas.' });
  }
});

app.post('/api/admin/feature-ideas/:id/status', requireAuthApi, requireAdminApi, async (req, res) => {
  try {
    const result = await setFeatureIdeaStatus(parseInt(req.params.id, 10), req.body && req.body.status);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/feature-idea-status]', err.message);
    res.status(500).json({ error: 'No se pudo cambiar el estado.' });
  }
});

app.get('/api/history', requireAuthApi, async (req, res) => {
  try {
    res.json(await getVideoHistory(req.session.user.id));
  } catch (err) {
    console.error('[history]', err.message);
    res.status(500).json({ error: 'No se pudo cargar el historial.' });
  }
});

app.get('/api/history/:id/download', requireAuthApi, async (req, res) => {
  try {
    const item = await getHistoryItem(req.params.id, req.session.user.id);
    if (!item) return res.status(404).json({ error: 'No encontrado.' });
    if (!item.file_path || !fs.existsSync(item.file_path)) {
      return res.status(410).json({ error: 'Este video ya venció (se guardan por 24 horas). Procesalo de nuevo.' });
    }
    res.download(item.file_path, item.title);
  } catch (err) {
    console.error('[history-download]', err.message);
    res.status(500).json({ error: 'No se pudo descargar el video.' });
  }
});

// Jobs en memoria (instancia unica - MVP). Sirve tanto para el optimizador
// como para el mini editor: ambos comparten el mismo ciclo de vida
// (analizando -> procesando -> listo/error/cancelado).
const jobs = new Map();

// Si ffmpeg se cuelga (video corrupto, filtro raro, contenedor sin CPU) lo
// matamos despues de este tiempo en vez de dejar al usuario esperando para
// siempre con la barra trabada.
const MAX_PROCESS_MS = 8 * 60 * 1000; // 8 minutos

function cleanupFile(filePath) {
  if (filePath) fs.unlink(filePath, () => {});
}

function setJob(jobId, patch) {
  jobs.set(jobId, { ...jobs.get(jobId), ...patch });
}

// Conecta los eventos de un FfmpegCommand ya armado con el ciclo de vida del
// job (progreso, timeout de seguridad, cancelacion, limpieza de temporales).
// Lo usan tanto /api/process como /api/edit.
// meta: { progressFrom, userId, downloadName, source, inputSize } —
// progressFrom es para jobs con una fase previa (ej. normalizar clips en el
// mini editor antes de este encode final), asi la barra sigue subiendo en
// vez de saltar de vuelta a 0%; inputSize (opcional, solo el Optimizador la
// manda) sirve para calcular cuanto se "ahorro" de tamaño; el resto es para
// poder guardar el resultado en el historial del usuario cuando termina.
function runJob(jobId, command, inputPaths, outputPath, meta = {}) {
  const { progressFrom = 0, userId, downloadName, source, inputSize } = meta;
  let stderrTail = [];
  let killedForTimeout = false;
  const timeoutHandle = setTimeout(() => {
    killedForTimeout = true;
    try { command.kill('SIGKILL'); } catch {}
  }, MAX_PROCESS_MS);

  const cleanupInputs = () => inputPaths.forEach(cleanupFile);

  command
    .on('start', (cmdLine) => {
      console.log(`[ffmpeg:${jobId}] start: ${cmdLine}`);
      setJob(jobId, { status: 'processing' });
    })
    .on('stderr', (line) => {
      stderrTail.push(line);
      if (stderrTail.length > 40) stderrTail.shift();
    })
    .on('progress', (p) => {
      const scaled = progressFrom + ((p.percent || 0) / 100) * (100 - progressFrom);
      setJob(jobId, { progress: Math.min(99, Math.round(scaled)) });
    })
    .on('error', (err) => {
      clearTimeout(timeoutHandle);
      if (jobs.get(jobId)?.status === 'cancelled') {
        cleanupInputs();
        return; // ya se informo al frontend, no pisar el mensaje
      }
      const message = killedForTimeout
        ? 'El proceso tardó demasiado y se canceló. Probá con archivos más cortos, más livianos, o con menor calidad.'
        : err.message;
      console.error(`[ffmpeg:${jobId}] ERROR: ${message}`);
      if (!killedForTimeout) console.error(`[ffmpeg:${jobId}] last stderr:\n${stderrTail.join('\n')}`);
      setJob(jobId, { status: 'error', error: message });
      cleanupInputs();
    })
    .on('end', () => {
      clearTimeout(timeoutHandle);
      // Defensa extra: si por algun motivo 'end' se disparara mas de una
      // vez para el mismo job, no volver a contar el video ni a descontar
      // cupo dos veces (fluent-ffmpeg no deberia hacerlo, pero el costo de
      // este chequeo es minimo y el de un doble conteo no).
      if (jobs.get(jobId)?.status === 'done') return;
      let outputSize = 0;
      try { outputSize = fs.statSync(outputPath).size; } catch {}
      cleanupInputs();

      // OJO con el orden: el status pasa a 'done' recien DESPUES de tener
      // resueltos los logros/recompensas nuevos, en el mismo setJob. Si se
      // marcara 'done' antes y newAchievements se agregara despues (via un
      // segundo setJob async), el polling del frontend podria ver 'done',
      // dejar de preguntar, y perderse el aviso de logro desbloqueado.
      (async () => {
        let newAchievements = [];
        let newReward = null;
        let newRecords = [];
        let newPersonalizations = [];
        if (userId) {
          recordVideoHistory(userId, {
            id: jobId,
            title: downloadName || 'video-editado.mp4',
            source: source || 'optimizer',
            outputSize,
            filePath: outputPath,
          }).catch((err) => console.error(`[history:${jobId}]`, err.message));

          // El cupo se descuenta recien aca (job terminado con exito), no al
          // subir el archivo: asi cancelar o que falle el proceso no gasta
          // un uso del plan (ver requireQuota mas arriba).
          consumeQuotaOnSuccess(userId).catch((err) => console.error(`[quota:${jobId}]`, err.message));

          // Progreso/logros/recompensas/records: unico lugar de todo el
          // backend que suma un video al contador de gamificacion,
          // disparado por el propio ffmpeg terminando bien (no por nada que
          // mande el frontend).
          try {
            const bytesSaved = inputSize && outputSize && inputSize > outputSize ? inputSize - outputSize : 0;
            const result = await updateProgressionOnSuccess(userId, { bytesSaved, inputSize, outputSize });
            newAchievements = result.newAchievements;
            newReward = result.newReward;
            newRecords = result.newRecords;
            newPersonalizations = result.newPersonalizations;
          } catch (err) {
            console.error(`[progress:${jobId}]`, err.message);
          }
        }
        setJob(jobId, {
          status: 'done', progress: 100, outputPath, outputSize,
          newAchievements, newReward, newRecords, newPersonalizations,
        });
      })();
    })
    .save(outputPath);

  setJob(jobId, { command, inputPaths });
}

// Rotacion en grados -> filtro de ffmpeg
function rotationFilter(rotation) {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 90:
      return 'transpose=1'; // 90 grados horario
    case 180:
      return 'transpose=1,transpose=1';
    case 270:
      return 'transpose=2'; // 90 grados antihorario
    default:
      return null;
  }
}

function parseFps(rFrameRate) {
  if (!rFrameRate) return 30;
  const [num, den] = rFrameRate.split('/').map(Number);
  if (!den) return num || 30;
  return num / den || 30;
}

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const vStream = (data.streams || []).find((s) => s.codec_type === 'video');
      if (!vStream) return reject(new Error('El archivo no tiene ninguna pista de video valida.'));
      const hasAudio = (data.streams || []).some((s) => s.codec_type === 'audio');
      resolve({
        width: vStream.width,
        height: vStream.height,
        fps: parseFps(vStream.r_frame_rate),
        durationSec: parseFloat(data.format && data.format.duration) || 0,
        hasAudio,
      });
    });
  });
}

const AUDIO_CODECS = {
  aac: { codec: 'aac' },
  mp3: { codec: 'libmp3lame' },
  opus: { codec: 'libopus' },
  copy: { codec: 'copy' },
};

// Formatos que pide Meta para Feed/Reels/Stories (specs oficiales de Meta Ads).
const META_PRESETS = {
  reels: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  feed_vertical: { width: 1080, height: 1350 },
  none: null,
};

// La mayor parte del tiempo de proceso se va en los filtros de video (blur,
// escalado), no en el codec en si mismo, asi que estos presets priorizan
// velocidad: el tamano final ya queda acotado por -maxrate/-bufsize.
const QUALITY_BITRATE = {
  high: { maxrateMbps: 10, crf: 20, preset: 'faster' },
  balanced: { maxrateMbps: 6, crf: 23, preset: 'veryfast' },
  small: { maxrateMbps: 3, crf: 28, preset: 'ultrafast' },
};

// Resolucion maxima de trabajo antes de entrar al filtro de "fondo
// desenfocado". Procesar un 4K de celular a traves de split+blur+overlay es
// carisimo y es la causa mas comun de que el proceso se sienta trabado; como
// el destino final nunca supera 1080 de ancho, bajarlo antes no pierde
// calidad visible.
const MAX_WORK_DIMENSION = 1920;

// Tipografia para el texto quemado del mini editor. Viene empaquetada en el
// propio repo (fonts/DejaVuSans-Bold.ttf) y se referencia directo por
// archivo (via "fontfile", no "font"): asi no depende de fontconfig ni de
// que el contenedor tenga alguna fuente de sistema instalada.
const DRAWTEXT_FONT_FILE = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '’') // comilla tipografica: evita el quilombo de escapar comillas simples
    .replace(/%/g, '\\%');
}

// Caracteres invalidos como nombre de archivo en Windows/Mac/Linux. No se
// tocan espacios, guiones ni acentos: esos son validos en cualquier SO.
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

// Convierte el titulo que puso el usuario en un nombre de archivo valido.
function sanitizeFilename(title) {
  const cleaned = (title || '')
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'video-editado';
}

// uid tiene que ser unico dentro del filtergraph completo: cuando se
// concatenan varios clips en un solo -filter_complex (mini editor), cada
// llamada a esta funcion agrega sus propias etiquetas intermedias, y si dos
// llamadas usaran el mismo nombre (ej. "[bg]") ffmpeg tira error porque
// quedarian dos filtros distintos escribiendo a la misma etiqueta.
function buildBlurFitFilter(srcLabel, W, H, extraSuffix, uid) {
  const bw = Math.max(2, Math.round(W / 6));
  const bh = Math.max(2, Math.round(H / 6));
  return (
    `${srcLabel}scale='min(${MAX_WORK_DIMENSION},iw)':'min(${MAX_WORK_DIMENSION},ih)':force_original_aspect_ratio=decrease:flags=fast_bilinear,split=2[bg${uid}][fg${uid}];` +
    `[bg${uid}]scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${bw}:${bh},gblur=sigma=5,scale=${W}:${H}:flags=fast_bilinear[bg2${uid}];` +
    `[fg${uid}]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=fast_bilinear[fg2${uid}];` +
    `[bg2${uid}][fg2${uid}]overlay=(W-w)/2:(H-h)/2:format=auto${extraSuffix}`
  );
}

// Se corre ANTES de multer, para no gastar ancho de banda/tiempo subiendo un
// archivo si la persona ya se quedó sin cupo hoy. Solo VERIFICA que quede
// cupo, no descuenta nada todavia — el descuento real pasa recien cuando el
// video termina de procesarse bien (ver consumeQuotaOnSuccess en el 'end'
// de runJob), asi que subir un archivo y despues cancelarlo, o que el
// procesamiento falle, no gastan un uso.
async function requireQuota(req, res, next) {
  try {
    const quota = await getQuotaStatus(req.session.user.id);
    if (!quota) return res.status(500).json({ error: 'No se pudo verificar tu cuota. Probá de nuevo.' });
    if (!quota.unlimited && quota.remaining <= 0) {
      const upsell = PLAN_ORDER.filter((k) => k !== 'free' && k !== quota.plan).map((k) => PLANS[k]);
      return res.status(429).json({
        error: `Ya usaste tus ${quota.limit} videos de hoy con el plan ${quota.planName}. Se resetea a la medianoche, o mejorá tu plan para seguir creando.`,
        quota,
        upsell,
      });
    }
    next();
  } catch (err) {
    console.error('[quota]', err.message);
    res.status(500).json({ error: 'No se pudo verificar tu cuota. Probá de nuevo.' });
  }
}

app.post('/api/process', requireAuthApi, requireQuota, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ningun video.' });

  const rotation = parseInt(req.body.rotation || '0', 10);
  const audioCodecKey = req.body.audioCodec || 'aac';
  const audioBitrate = req.body.audioBitrate || '128k';
  const quality = req.body.quality || 'balanced';
  const metaPresetKey = req.body.metaPreset || 'none';
  const downloadName = sanitizeFilename(req.body.title).slice(0, 150) + '.mp4';

  const audioCfg = AUDIO_CODECS[audioCodecKey] || AUDIO_CODECS.aac;
  const metaPreset = META_PRESETS[metaPresetKey] || null;
  const q = QUALITY_BITRATE[quality] || QUALITY_BITRATE.balanced;

  const jobId = randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);

  jobs.set(jobId, { status: 'analyzing', progress: 0, startedAt: Date.now(), downloadName });
  // Responder ya: el analisis y la codificacion siguen en background y el
  // frontend hace polling de /api/status. Asi la subida no se siente trabada
  // esperando a que termine TODO el proceso.
  res.json({ jobId });

  let sourceInfo;
  try {
    sourceInfo = await probeVideo(inputPath);
  } catch (err) {
    setJob(jobId, {
      status: 'error',
      error: 'No se pudo leer el video (¿está corrupto o en un formato no soportado?).',
    });
    cleanupFile(inputPath);
    return;
  }

  // Si cancelaron mientras analizabamos, no arrancamos ffmpeg.
  if (jobs.get(jobId)?.status === 'cancelled') {
    cleanupFile(inputPath);
    return;
  }

  const rotFilter = rotationFilter(rotation);
  const rotated = rotation === 90 || rotation === 270;
  const srcW = rotated ? sourceInfo.height : sourceInfo.width;
  const srcH = rotated ? sourceInfo.width : sourceInfo.height;
  const srcAspect = srcW / srcH;
  const fpsSuffix = sourceInfo.fps > 30.5 ? ',fps=30' : '';

  const command = ffmpeg(inputPath)
    .videoCodec('libx264')
    .outputOptions([
      `-crf ${q.crf}`,
      `-preset ${q.preset}`,
      `-maxrate ${q.maxrateMbps}M`,
      `-bufsize ${q.maxrateMbps * 2}M`,
      '-movflags +faststart',
      '-pix_fmt yuv420p',
      // En contenedores el runtime a veces reporta el total de CPUs del host
      // (decenas), y libx264 arranca un thread de encoding por cada una si
      // no se lo limitamos -> pico de memoria/CPU que termina en SIGKILL.
      '-threads', '2',
      '-x264-params', 'threads=2:lookahead_threads=1:sliced_threads=0',
    ]);

  if (metaPreset) {
    const { width: W, height: H } = metaPreset;
    const targetAspect = W / H;
    const aspectMatches = Math.abs(srcAspect - targetAspect) / targetAspect < 0.02;
    const src = rotFilter ? `[0:v]${rotFilter}[rot];[rot]` : '[0:v]';

    let filterGraph;
    if (aspectMatches) {
      // Ya viene en la proporcion correcta: alcanza con escalar, sin pasar
      // por el desenfoque de fondo (mucho mas rapido).
      filterGraph = `${src}scale=${W}:${H}:flags=fast_bilinear${fpsSuffix}[vout]`;
    } else {
      // No calza: se centra sobre un fondo desenfocado que rellena todo el
      // cuadro, sin recortar el contenido (igual criterio que usa Instagram
      // al convertir horizontal -> vertical).
      filterGraph = buildBlurFitFilter(src, W, H, `,setsar=1${fpsSuffix}[vout]`, '_p');
    }

    command.outputOptions(['-filter_complex', filterGraph, '-map', '[vout]', '-map', '0:a?']);

    // Meta recomienda AAC 48kHz estereo para el audio de los anuncios.
    if (audioCfg.codec === 'copy') {
      command.outputOptions(['-c:a', 'copy']);
    } else {
      command
        .audioCodec(audioCfg.codec)
        .audioBitrate(audioBitrate)
        .audioFrequency(48000)
        .audioChannels(2);
    }
    command.outputOptions(['-profile:v', 'main', '-level', '4.0']);
  } else {
    // Modo manual: solo se aplica la rotacion elegida, sin forzar proporcion.
    if (rotFilter) command.videoFilters(rotFilter);
    if (audioCfg.codec === 'copy') {
      command.outputOptions(['-c:a', 'copy']);
    } else {
      command.audioCodec(audioCfg.codec).audioBitrate(audioBitrate);
    }
  }

  runJob(jobId, command, [inputPath], outputPath, {
    userId: req.session.user.id,
    downloadName,
    source: 'optimizer',
    inputSize: req.file.size,
  });
});

// Descompone cualquier factor de velocidad en una cadena de filtros "atempo"
// (cada uno solo admite entre 0.5x y 2x) para poder sincronizar el audio con
// velocidades como 4x o 0.25x que estan fuera de ese rango.
function buildAtempoChain(speed) {
  const filters = [];
  let remaining = speed;
  if (remaining < 0.5) {
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
  } else if (remaining > 2.0) {
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
  }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(',');
}

// --- Speed Tool: cambia la velocidad de reproduccion (0.25x a 4x, o custom) ---
app.post('/api/speed', requireAuthApi, requireQuota, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ningun video.' });

  const speed = Math.min(4, Math.max(0.25, parseFloat(req.body.speed) || 1));
  const mute = req.body.mute === 'true' || req.body.mute === '1';
  const downloadName = sanitizeFilename(req.body.title).slice(0, 150) + '.mp4';

  const jobId = randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);

  jobs.set(jobId, { status: 'analyzing', progress: 0, startedAt: Date.now(), downloadName });
  res.json({ jobId });

  let sourceInfo;
  try {
    sourceInfo = await probeVideo(inputPath);
  } catch (err) {
    setJob(jobId, { status: 'error', error: 'No se pudo leer el video (¿está corrupto o en un formato no soportado?).' });
    cleanupFile(inputPath);
    return;
  }
  if (jobs.get(jobId)?.status === 'cancelled') {
    cleanupFile(inputPath);
    return;
  }

  const videoFilter = `setpts=${(1 / speed).toFixed(6)}*PTS`;
  const command = ffmpeg(inputPath)
    .videoCodec('libx264')
    .outputOptions([
      '-crf 23',
      '-preset veryfast',
      '-movflags +faststart',
      '-pix_fmt yuv420p',
      '-threads', '2',
      '-x264-params', 'threads=2:lookahead_threads=1:sliced_threads=0',
    ]);

  if (mute || !sourceInfo.hasAudio) {
    command.videoFilters(videoFilter).outputOptions(['-an']);
  } else {
    const atempo = buildAtempoChain(speed);
    command.outputOptions(['-filter_complex', `[0:v]${videoFilter}[v];[0:a]${atempo}[a]`, '-map', '[v]', '-map', '[a]']);
  }

  runJob(jobId, command, [inputPath], outputPath, {
    userId: req.session.user.id,
    downloadName,
    source: 'speed',
    inputSize: req.file.size,
  });
});

const GIF_QUALITY = {
  high: { maxColors: 256, dither: 'bayer:bayer_scale=1' },
  medium: { maxColors: 128, dither: 'bayer:bayer_scale=3' },
  low: { maxColors: 64, dither: 'bayer:bayer_scale=5' },
};

// --- GIF Maker: recorta un fragmento del video y lo exporta como GIF ---
app.post('/api/gif', requireAuthApi, requireQuota, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ningun video.' });

  const fps = Math.min(30, Math.max(5, parseInt(req.body.fps, 10) || 10));
  const width = Math.min(720, Math.max(120, parseInt(req.body.width, 10) || 480));
  const quality = GIF_QUALITY[req.body.quality] || GIF_QUALITY.medium;
  const downloadName = sanitizeFilename(req.body.title).slice(0, 150) + '.gif';

  const jobId = randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(TMP_DIR, `${jobId}.gif`);

  jobs.set(jobId, { status: 'analyzing', progress: 0, startedAt: Date.now(), downloadName });
  res.json({ jobId });

  let sourceInfo;
  try {
    sourceInfo = await probeVideo(inputPath);
  } catch (err) {
    setJob(jobId, { status: 'error', error: 'No se pudo leer el video (¿está corrupto o en un formato no soportado?).' });
    cleanupFile(inputPath);
    return;
  }
  if (jobs.get(jobId)?.status === 'cancelled') {
    cleanupFile(inputPath);
    return;
  }

  const maxDuration = sourceInfo.durationSec || 0;
  const start = Math.max(0, parseFloat(req.body.start) || 0);
  let end = parseFloat(req.body.end);
  if (!Number.isFinite(end) || end <= start) end = maxDuration || start + 5;
  end = Math.min(end, maxDuration || end);
  // Tope duro de 15s de fragmento: que nadie se mande un GIF de un video
  // entero de 10 minutos y termine pesando un disparate (o tardando una
  // eternidad en generarse).
  const clipDuration = Math.min(15, Math.max(0.2, end - start));

  const command = ffmpeg(inputPath)
    .seekInput(start)
    .duration(clipDuration)
    .outputOptions([
      '-filter_complex',
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${quality.maxColors}[p];[s1][p]paletteuse=dither=${quality.dither}`,
    ]);

  runJob(jobId, command, [inputPath], outputPath, {
    userId: req.session.user.id,
    downloadName,
    source: 'gif',
    inputSize: req.file.size,
  });
});

// --- Mini editor: varios clips, recorte por clip, texto quemado opcional ---
app.post('/api/edit', requireAuthApi, requireQuota, upload.array('clips', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No se recibió ningún clip.' });
  }

  let clipsMeta;
  try {
    clipsMeta = JSON.parse(req.body.clipsMeta || '[]');
  } catch {
    clipsMeta = [];
  }
  if (!Array.isArray(clipsMeta) || clipsMeta.length !== req.files.length) {
    req.files.forEach((f) => cleanupFile(f.path));
    return res.status(400).json({ error: 'Los datos de recorte no coinciden con los clips subidos.' });
  }

  const metaPreset = META_PRESETS[req.body.metaPreset] || META_PRESETS.reels;
  const quality = req.body.quality || 'balanced';
  const q = QUALITY_BITRATE[quality] || QUALITY_BITRATE.balanced;
  const downloadName = sanitizeFilename(req.body.title).slice(0, 150) + '.mp4';

  // Textos con su propio tramo de tiempo en la linea de tiempo FINAL (ya
  // unida): el frontend (editor.js) calcula esos tiempos sumando la duracion
  // recortada de cada clip anterior, que es exactamente lo que este pipeline
  // termina produciendo (cada clip se normaliza a 30fps antes de concatenar,
  // asi que el resultado coincide con esa cuenta). Hasta 10 textos, cada uno
  // con su rango [start,end) valido.
  let textOverlays = [];
  try {
    textOverlays = JSON.parse(req.body.textOverlays || '[]');
  } catch {
    textOverlays = [];
  }
  if (!Array.isArray(textOverlays)) textOverlays = [];
  textOverlays = textOverlays
    .map((o) => ({
      text: String((o && o.text) || '').trim().slice(0, 200),
      start: Math.max(0, Number(o && o.start) || 0),
      end: Number(o && o.end),
      // xPct/yPct: posicion libre (0-100) elegida arrastrando el texto sobre
      // la vista previa, en vez de un preset fijo arriba/centro/abajo.
      xPct: Math.max(0, Math.min(100, Number(o && o.xPct))) || 50,
      yPct: Math.max(0, Math.min(100, Number(o && o.yPct))) || 85,
      box: !!(o && o.box),
      color: /^#?[0-9a-fA-F]{6}$/.test((o && o.color) || '') ? String(o.color).replace('#', '') : 'FFFFFF',
    }))
    .filter((o) => o.text.length > 0 && o.end > o.start)
    .slice(0, 10);

  const { width: W, height: H } = metaPreset;
  const jobId = randomUUID();
  const uploadedPaths = req.files.map((f) => f.path);
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);

  jobs.set(jobId, { status: 'analyzing', progress: 0, startedAt: Date.now(), downloadName });
  res.json({ jobId });

  // Normalizar cada clip a un archivo intermedio (mismo tamaño/fps/codec)
  // ANTES de concatenar. El filtro "concat" de ffmpeg no siempre negocia
  // bien clips que entran con distinta resolucion/framerate original: en
  // este build llegamos a ver que silenciosamente perdia el drawtext final
  // sin tirar ningun error. Concatenar clips ya uniformes (via el demuxer
  // de concat, mucho mas simple) evita ese problema por completo.
  const intermediatePaths = [];

  function encodeClipToIntermediate(inputPath, outIndex, start, end) {
    return new Promise((resolve, reject) => {
      const outPath = path.join(TMP_DIR, `${jobId}_clip${outIndex}.mp4`);
      const filterGraph =
        buildBlurFitFilter(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,`, W, H, ',setsar=1,fps=30[vout]', '_c') +
        `;[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[aout]`;

      ffmpeg(inputPath)
        .videoCodec('libx264')
        .outputOptions([
          '-crf', '20',
          '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p',
          '-threads', '2',
          '-x264-params', 'threads=2:lookahead_threads=1:sliced_threads=0',
          '-filter_complex', filterGraph,
          '-map', '[vout]',
          '-map', '[aout]',
          '-profile:v', 'main',
          '-level', '4.0',
        ])
        .audioCodec('aac')
        .audioBitrate('128k')
        .on('error', reject)
        .on('end', () => resolve(outPath))
        .save(outPath);
    });
  }

  (async () => {
    try {
      for (let i = 0; i < req.files.length; i++) {
        if (jobs.get(jobId)?.status === 'cancelled') {
          intermediatePaths.forEach(cleanupFile);
          uploadedPaths.forEach(cleanupFile);
          return;
        }
        const meta = clipsMeta[i] || {};
        const start = Math.max(0, Number(meta.start) || 0);
        const endRaw = Number(meta.end);
        const end = endRaw > start ? endRaw : start + 1; // por si llega algo invalido, no rompe el proceso

        const outPath = await encodeClipToIntermediate(req.files[i].path, i, start, end);
        intermediatePaths.push(outPath);
        cleanupFile(req.files[i].path); // ya no hace falta el original subido
        setJob(jobId, { progress: Math.round(((i + 1) / req.files.length) * 40) }); // 0-40%: normalizando clips
      }
    } catch (err) {
      console.error(`[edit:${jobId}] error normalizando clips:`, err.message);
      intermediatePaths.forEach(cleanupFile);
      uploadedPaths.forEach(cleanupFile);
      setJob(jobId, { status: 'error', error: 'No se pudo procesar alguno de los clips (¿está corrupto o en un formato no soportado?).' });
      return;
    }

    if (jobs.get(jobId)?.status === 'cancelled') {
      intermediatePaths.forEach(cleanupFile);
      return;
    }

    const listPath = path.join(TMP_DIR, `${jobId}_list.txt`);
    const listContent = intermediatePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const command = ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .videoCodec('libx264')
      .outputOptions([
        `-crf ${q.crf}`,
        `-preset ${q.preset}`,
        `-maxrate ${q.maxrateMbps}M`,
        `-bufsize ${q.maxrateMbps * 2}M`,
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-threads', '2',
        '-x264-params', 'threads=2:lookahead_threads=1:sliced_threads=0',
        '-profile:v', 'main',
        '-level', '4.0',
      ])
      .audioCodec('aac')
      .audioBitrate('128k');

    if (textOverlays.length > 0) {
      // OJO: se usa -filter_complex + -map en vez de -vf/-filter:v a
      // proposito. Con este build de ffmpeg, fluent-ffmpeg reordena las
      // opciones y termina poniendo "-acodec/-vcodec" ANTES del filtro; con
      // -vf eso hace que el texto se pierda en silencio (sin ningun error),
      // algo que se detecto probando esto a mano por SSH. Con
      // -filter_complex + -map el orden no afecta y funciona siempre.
      // Cada texto es un drawtext encadenado al anterior, cada uno con su
      // propio "enable=between(t,start,end)" para que solo se vea en su
      // tramo de tiempo (en vez de un unico texto fijo para todo el video).
      // x/y salen de la posicion libre (xPct/yPct) que se eligio arrastrando
      // el texto sobre la vista previa, centrado en ese punto; el fondo
      // (box) es opcional, por defecto no lleva (solo el texto, con una
      // sombra para que se lea igual sobre fondos claros).
      let lastLabel = '0:v';
      const parts = textOverlays.map((o, i) => {
        const xExpr = `(w*${(o.xPct / 100).toFixed(4)})-text_w/2`;
        const yExpr = `(h*${(o.yPct / 100).toFixed(4)})-text_h/2`;
        const fontSize = Math.round(H * 0.055);
        const outLabel = `vt${i}`;
        const boxPart = o.box ? ':box=1:boxcolor=black@0.45:boxborderw=16' : ':shadowcolor=black@0.7:shadowx=2:shadowy=2';
        const part = `[${lastLabel}]drawtext=fontfile='${DRAWTEXT_FONT_FILE}':text='${escapeDrawtext(o.text)}':fontcolor=0x${o.color}:fontsize=${fontSize}:x=${xExpr}:y=${yExpr}${boxPart}:enable='between(t,${o.start},${o.end})'[${outLabel}]`;
        lastLabel = outLabel;
        return part;
      });
      command.outputOptions(['-filter_complex', parts.join(';'), '-map', `[${lastLabel}]`, '-map', '0:a?']);
    }

    runJob(jobId, command, [...intermediatePaths, listPath], outputPath, {
      progressFrom: 40,
      userId: req.session.user.id,
      downloadName,
      source: 'editor',
    });
  })();
});

// --- Extraer audio: sube un video y devuelve solo el audio en el formato
// elegido. Comparte el mismo ciclo de jobs (progreso/cancelar/descargar) que
// el resto de la app; NO acepta links de YouTube/TikTok/etc, solo archivos
// que el usuario ya tiene en su dispositivo (ver nota en README/chat sobre
// por que no se agrego eso).
app.post('/api/extract-audio', requireAuthApi, requireQuota, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún video.' });

  const format = ['mp3', 'wav', 'm4a'].includes(req.body.format) ? req.body.format : 'mp3';
  const bitrate = ['128k', '192k', '320k'].includes(req.body.bitrate) ? req.body.bitrate : '192k';
  const inputPath = req.file.path;
  const jobId = randomUUID();
  const downloadName = sanitizeFilename(req.body.title).slice(0, 150) + '.' + format;
  const outputPath = path.join(TMP_DIR, `${jobId}.${format}`);

  jobs.set(jobId, { status: 'analyzing', progress: 0, startedAt: Date.now(), downloadName });
  res.json({ jobId });

  const command = ffmpeg(inputPath).noVideo();
  if (format === 'mp3') {
    command.audioCodec('libmp3lame').audioBitrate(bitrate);
  } else if (format === 'wav') {
    command.audioCodec('pcm_s16le');
  } else {
    command.audioCodec('aac').audioBitrate(bitrate);
  }
  command.audioFrequency(48000).audioChannels(2);

  runJob(jobId, command, [inputPath], outputPath, {
    userId: req.session.user.id,
    downloadName,
    source: 'audio',
  });
});

app.get('/api/status/:jobId', requireAuthApi, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json({
    status: job.status,
    progress: job.progress || 0,
    error: job.error,
    outputSize: job.outputSize || 0,
    newAchievements: job.newAchievements || [],
    newReward: job.newReward || null,
    newRecords: job.newRecords || [],
    newPersonalizations: job.newPersonalizations || [],
  });
});

app.post('/api/cancel/:jobId', requireAuthApi, (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  if (job.command) {
    try { job.command.kill('SIGKILL'); } catch {}
  }
  if (job.inputPaths) job.inputPaths.forEach(cleanupFile);
  setJob(jobId, { status: 'cancelled', error: 'Cancelado por el usuario.' });
  res.json({ ok: true });
});

app.get('/api/download/:jobId', requireAuthApi, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'No disponible todavia.' });
  // No se borra el archivo despues de servirlo: el mismo jobId queda
  // disponible para re-descargar desde el Historial durante 24hs (ver
  // recordVideoHistory / cleanupExpiredHistory), en vez de perderse apenas
  // se baja una vez.
  res.download(job.outputPath, job.downloadName || 'video-editado.mp4');
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Barrido periodico: borra del disco los videos del historial que ya
// pasaron sus 24hs de vida, y su fila en la base.
const HISTORY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
function runHistoryCleanup() {
  cleanupExpiredHistory(cleanupFile)
    .then((n) => {
      if (n > 0) console.log(`[history-cleanup] se borraron ${n} video(s) vencido(s).`);
    })
    .catch((err) => console.error('[history-cleanup]', err.message));
}

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Video editor corriendo en puerto ${PORT}`);
    });
    runHistoryCleanup();
    setInterval(runHistoryCleanup, HISTORY_CLEANUP_INTERVAL_MS);
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });
