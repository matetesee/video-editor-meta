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

app.post('/api/process', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ningun video.' });

  const rotation = parseInt(req.body.rotation || '0', 10);
  const audioCodecKey = req.body.audioCodec || 'aac';
  const audioBitrate = req.body.audioBitrate || '128k';
  const quality = req.body.quality || 'balanced'; // balanced | high | small

  const audioCfg = AUDIO_CODECS[audioCodecKey] || AUDIO_CODECS.aac;
  const jobId = randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);

  jobs.set(jobId, { status: 'processing', progress: 0 });

  let crf = 23;
  let preset = 'veryfast';
  if (quality === 'high') { crf = 18; preset = 'slow'; }
  if (quality === 'small') { crf = 28; preset = 'veryfast'; }

  const command = ffmpeg(inputPath)
    .videoCodec('libx264')
    .outputOptions([
      `-crf ${crf}`,
      `-preset ${preset}`,
      '-movflags +faststart',
      '-pix_fmt yuv420p',
    ]);

  const vf = rotationFilter(rotation);
  if (vf) command.videoFilters(vf);

  if (audioCfg.codec === 'copy') {
    command.outputOptions(['-c:a copy']);
  } else {
    command.audioCodec(audioCfg.codec).audioBitrate(audioBitrate);
  }

  command
    .on('progress', (p) => {
      const job = jobs.get(jobId);
      if (job) job.progress = Math.min(99, Math.round(p.percent || 0));
    })
    .on('error', (err) => {
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
