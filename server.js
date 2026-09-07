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

// In-memory job tracking (single-instance MVP)
const jobs = new Map();

function cleanupFile(filePath) {
  fs.unlink(filePath, () => {});
}

// Rotation degrees -> ffmpeg video filter
function rotationFilter(rotation) {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 90:
      return 'transpose=1'; // 90 deg clockwise
    case 180:
      return 'transpose=1,transpose=1'; // 180
    case 270:
      return 'transpose=2'; // 90 deg counter-clockwise
    default:
      return null; // 0 deg, no rotation
  }
}

const AUDIO_CODECS = {
  aac: { codec: 'aac', ext: 'aac' },
  mp3: { codec: 'libmp3lame', ext: 'mp3' },
  opus: { codec: 'libopus', ext: 'opus' },
  copy: { codec: 'copy', ext: null },
};

// Formatos que pide Meta para Feed/Reels/Stories (specs oficiales de Meta Ads).
// width/height ya vienen en la relación de aspecto que Meta recomienda por placement.
const META_PRESETS = {
  reels: { width: 1080, height: 1920, label: 'Reels / Stories 9:16' },
  square: { width: 1080, height: 1080, label: 'Feed cuadrado 1:1' },
  feed_vertical: { width: 1080, height: 1350, label: 'Feed vertical 4:5' },
  none: null, // manual: no se fuerza relación de aspecto
};

// Bitrate de video (maxrate/bufsize) recomendado por Meta según calidad elegida.
const QUALITY_BITRATE = {
  high: { maxrateMbps: 10, crf: 18, preset: 'slow' },
  balanced: { maxrateMbps: 6, crf: 23, preset: 'veryfast' },
  small: { maxrateMbps: 3, crf: 28, preset: 'veryfast' },
};

app.post('/api/process', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ningun video.' });

  const rotation = parseInt(req.body.rotation || '0', 10);
  const audioCodecKey = req.body.audioCodec || 'aac';
  const audioBitrate = req.body.audioBitrate || '128k';
  const quality = req.body.quality || 'balanced'; // high | balanced | small
  const metaPresetKey = req.body.metaPreset || 'none'; // reels | square | feed_vertical | none

  const audioCfg = AUDIO_CODECS[audioCodecKey] || AUDIO_CODECS.aac;
  const metaPreset = META_PRESETS[metaPresetKey] || null;
  const q = QUALITY_BITRATE[quality] || QUALITY_BITRATE.balanced;

  const jobId = randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);

  jobs.set(jobId, { status: 'processing', progress: 0 });

  const command = ffmpeg(inputPath)
    .videoCodec('libx264')
    .outputOptions([
      `-crf ${q.crf}`,
      `-preset ${q.preset}`,
      `-maxrate ${q.maxrateMbps}M`,
      `-bufsize ${q.maxrateMbps * 2}M`,
      '-movflags +faststart',
      '-pix_fmt yuv420p',
      // En contenedores el runtime suele reportar el total de CPUs del host
      // (a veces decenas), y libx264 arranca un thread de encoding por cada
      // una si no se lo limitamos -> pico de memoria/CPU que el contenedor
      // mata con SIGKILL. Lo acotamos a algo razonable y fijo.
      '-threads', '2',
      '-x264-params', 'threads=2:lookahead_threads=1:sliced_threads=0',
    ]);

  const rotFilter = rotationFilter(rotation);

  if (metaPreset) {
    // Modo "optimizado para Meta": encaja el video en la relación de aspecto exacta
    // que pide el placement (Reels/Stories 9:16, Feed 1:1 o 4:5), sin recortar el
    // contenido: lo centra sobre un fondo desenfocado que rellena todo el cuadro
    // (mismo criterio que usa Instagram al convertir horizontal -> vertical).
    const { width: W, height: H } = metaPreset;
    const src = rotFilter ? `[0:v]${rotFilter}[rot];[rot]` : '[0:v]';
    // El fondo se desenfoca a baja resolución y recién ahí se escala al tamaño
    // final: hacer gblur directo sobre 1080x1920 es carísimo en CPU/memoria y
    // puede tirar abajo el proceso (SIGKILL) en un contenedor chico.
    const bw = Math.round(W / 4);
    const bh = Math.round(H / 4);
    const filterGraph =
      `${src}split=2[bg][fg];` +
      `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=6,scale=${W}:${H}[bg];` +
      `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,fps=30[vout]`;

    command.outputOptions(['-filter_complex', filterGraph, '-map', '[vout]', '-map', '0:a?']);

    // Meta recomienda AAC 48kHz estéreo para el audio de los anuncios.
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
    // Modo manual: solo se aplica la rotación elegida, sin forzar relación de aspecto.
    if (rotFilter) command.videoFilters(rotFilter);
    if (audioCfg.codec === 'copy') {
      command.outputOptions(['-c:a', 'copy']);
    } else {
      command.audioCodec(audioCfg.codec).audioBitrate(audioBitrate);
    }
  }

  let stderrTail = [];
  command
    .on('start', (cmdLine) => console.log(`[ffmpeg:${jobId}] start: ${cmdLine}`))
    .on('stderr', (line) => {
      stderrTail.push(line);
      if (stderrTail.length > 40) stderrTail.shift();
      console.log(`[ffmpeg:${jobId}] ${line}`);
    })
    .on('progress', (p) => {
      const job = jobs.get(jobId);
      if (job) job.progress = Math.min(99, Math.round(p.percent || 0));
    })
    .on('error', (err) => {
      console.error(`[ffmpeg:${jobId}] ERROR: ${err.message}`);
      console.error(`[ffmpeg:${jobId}] last stderr lines:\n${stderrTail.join('\n')}`);
      jobs.set(jobId, { status: 'error', error: err.message });
      cleanupFile(inputPath);
    })
    .on('end', () => {
      jobs.set(jobId, { status: 'done', progress: 100, outputPath });
      cleanupFile(inputPath);
    })
    .save(outputPath);

  res.json({ jobId });
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json({ status: job.status, progress: job.progress || 0, error: job.error });
});

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'No disponible todavia.' });
  res.download(job.outputPath, 'video-editado.mp4', (err) => {
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
