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
  consumeQuota,
  applyCoupon,
} = require('./users');
const { requireAuthPage, requireAuthApi } = require('./auth');

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
  const { email, password } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingresá un email válido.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
  }
  try {
    const existing = await findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    const user = await createUser(email, password);
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
    res.json({ email: req.session.user.email, avatarUrl: (user && user.avatar_data_url) || null, quota });
  } catch (err) {
    res.json({ email: req.session.user.email, avatarUrl: null, quota: null });
  }
});

app.post('/api/coupon', requireAuthApi, async (req, res) => {
  try {
    const ok = await applyCoupon(req.session.user.id, req.body && req.body.code);
    if (!ok) return res.status(400).json({ error: 'Cupón inválido.' });
    const quota = await getQuotaStatus(req.session.user.id);
    res.json({ ok: true, quota });
  } catch (err) {
    console.error('[coupon]', err.message);
    res.status(500).json({ error: 'No se pudo aplicar el cupón. Probá de nuevo.' });
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
      res.redirect('/');
    }
  );
}

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
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
function runJob(jobId, command, inputPaths, outputPath, progressFrom = 0) {
  // progressFrom: para jobs con una fase previa (ej. normalizar clips en el
  // mini editor antes de este encode final), asi la barra sigue subiendo en
  // vez de saltar de vuelta a 0%.
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
      let outputSize = 0;
      try { outputSize = fs.statSync(outputPath).size; } catch {}
      setJob(jobId, { status: 'done', progress: 100, outputPath, outputSize });
      cleanupInputs();
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
      resolve({
        width: vStream.width,
        height: vStream.height,
        fps: parseFps(vStream.r_frame_rate),
        durationSec: parseFloat(data.format && data.format.duration) || 0,
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

// Se corre ANTES de multer para no gastar ancho de banda/tiempo subiendo un
// archivo si la persona ya se quedó sin cupo hoy. Consume 1 uso apenas se
// acepta el envío (no cuando termina de procesar): asi "cargar un video"
// cuenta como 1 uso tanto para el optimizador como para el mini editor.
async function requireQuota(req, res, next) {
  try {
    const result = await consumeQuota(req.session.user.id);
    if (!result.allowed) {
      return res.status(429).json({
        error: `Ya usaste tus ${result.limit} videos gratis de hoy. Se resetea a la medianoche, o activá el plan ilimitado con un cupón en ⚙️ Configuración.`,
        quota: result,
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

  runJob(jobId, command, [inputPath], outputPath);
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

  const overlayText = (req.body.overlayText || '').trim().slice(0, 200);
  const overlayEnabled = req.body.overlayEnabled === 'true' && overlayText.length > 0;
  const overlayPosition = ['top', 'center', 'bottom'].includes(req.body.overlayPosition)
    ? req.body.overlayPosition
    : 'bottom';
  const overlayColor = /^#?[0-9a-fA-F]{6}$/.test(req.body.overlayColor || '')
    ? req.body.overlayColor.replace('#', '')
    : 'FFFFFF';

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

    if (overlayEnabled) {
      // OJO: se usa -filter_complex + -map en vez de -vf/-filter:v a
      // proposito. Con este build de ffmpeg, fluent-ffmpeg reordena las
      // opciones y termina poniendo "-acodec/-vcodec" ANTES del filtro; con
      // -vf eso hace que el texto se pierda en silencio (sin ningun error),
      // algo que se detecto probando esto a mano por SSH. Con
      // -filter_complex + -map el orden no afecta y funciona siempre.
      const yExpr = overlayPosition === 'top' ? 'h*0.08' : overlayPosition === 'center' ? '(h-text_h)/2' : 'h*0.85';
      const fontSize = Math.round(H * 0.055);
      const drawtextFilter = `[0:v]drawtext=fontfile='${DRAWTEXT_FONT_FILE}':text='${escapeDrawtext(overlayText)}':fontcolor=0x${overlayColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=${yExpr}:box=1:boxcolor=black@0.45:boxborderw=16[vout]`;
      command.outputOptions(['-filter_complex', drawtextFilter, '-map', '[vout]', '-map', '0:a?']);
    }

    runJob(jobId, command, [...intermediatePaths, listPath], outputPath, 40);
  })();
});

app.get('/api/status/:jobId', requireAuthApi, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json({
    status: job.status,
    progress: job.progress || 0,
    error: job.error,
    outputSize: job.outputSize || 0,
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
  res.download(job.outputPath, job.downloadName || 'video-editado.mp4', (err) => {
    if (!err) {
      cleanupFile(job.outputPath);
      jobs.delete(req.params.jobId);
    }
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Video editor corriendo en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });
