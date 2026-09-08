const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Jobs en memoria (instancia unica - MVP).
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

app.post('/api/process', upload.single('video'), async (req, res) => {
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
      // al convertir horizontal -> vertical). Para que sea rapido:
      //  1) primero se baja el video de trabajo a una resolucion razonable
      //     (evita procesar 4K a traves de todo el grafo de filtros),
      //  2) el desenfoque se aplica sobre una copia chica y recien despues
      //     se escala arriba (gblur a resolucion completa es carisimo),
      //  3) se usa el algoritmo de escalado mas rapido (fast_bilinear).
      const bw = Math.max(2, Math.round(W / 6));
      const bh = Math.max(2, Math.round(H / 6));
      filterGraph =
        `${src}scale='min(${MAX_WORK_DIMENSION},iw)':'min(${MAX_WORK_DIMENSION},ih)':force_original_aspect_ratio=decrease:flags=fast_bilinear[work];` +
        `[work]split=2[bg][fg];` +
        `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${bw}:${bh},gblur=sigma=5,scale=${W}:${H}:flags=fast_bilinear[bg];` +
        `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=fast_bilinear[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto${fpsSuffix}[vout]`;
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

  let stderrTail = [];
  let killedForTimeout = false;
  const timeoutHandle = setTimeout(() => {
    killedForTimeout = true;
    try { command.kill('SIGKILL'); } catch {}
  }, MAX_PROCESS_MS);

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
      setJob(jobId, { progress: Math.min(99, Math.round(p.percent || 0)) });
    })
    .on('error', (err) => {
      clearTimeout(timeoutHandle);
      if (jobs.get(jobId)?.status === 'cancelled') {
        cleanupFile(inputPath);
        return; // ya se informo al frontend, no pisar el mensaje
      }
      const message = killedForTimeout
        ? 'El video tardó demasiado en procesarse y se canceló. Probá con un archivo más corto, más liviano, o con menor calidad.'
        : err.message;
      console.error(`[ffmpeg:${jobId}] ERROR: ${message}`);
      if (!killedForTimeout) console.error(`[ffmpeg:${jobId}] last stderr:\n${stderrTail.join('\n')}`);
      setJob(jobId, { status: 'error', error: message });
      cleanupFile(inputPath);
    })
    .on('end', () => {
      clearTimeout(timeoutHandle);
      let outputSize = 0;
      try { outputSize = fs.statSync(outputPath).size; } catch {}
      setJob(jobId, { status: 'done', progress: 100, outputPath, outputSize });
      cleanupFile(inputPath);
    })
    .save(outputPath);

  setJob(jobId, { command, inputPath });
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json({
    status: job.status,
    progress: job.progress || 0,
    error: job.error,
    outputSize: job.outputSize || 0,
  });
});

app.post('/api/cancel/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  if (job.command) {
    try { job.command.kill('SIGKILL'); } catch {}
  }
  if (job.inputPath) cleanupFile(job.inputPath);
  setJob(jobId, { status: 'cancelled', error: 'Cancelado por el usuario.' });
  res.json({ ok: true });
});

app.get('/api/download/:jobId', (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Video editor corriendo en puerto ${PORT}`);
});
