const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadPanel = document.getElementById('uploadPanel');
const editPanel = document.getElementById('editPanel');
const previewVideo = document.getElementById('previewVideo');
const fileInfo = document.getElementById('fileInfo');
const rotateBtn = document.getElementById('rotateBtn');
const rotationLabel = document.getElementById('rotationLabel');
const processBtn = document.getElementById('processBtn');
const resetBtn = document.getElementById('resetBtn');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const elapsedText = document.getElementById('elapsedText');
const cancelBtn = document.getElementById('cancelBtn');
const resultPanel = document.getElementById('resultPanel');
const resultMeta = document.getElementById('resultMeta');
const downloadLink = document.getElementById('downloadLink');
const errorPanel = document.getElementById('errorPanel');
const audioCodecSel = document.getElementById('audioCodec');
const audioBitrateSel = document.getElementById('audioBitrate');
const qualitySel = document.getElementById('quality');
const metaPresetSel = document.getElementById('metaPreset');
const metaHint = document.getElementById('metaHint');
const videoTitleInput = document.getElementById('videoTitle');
const sessionUser = document.getElementById('sessionUser');
const logoutBtn = document.getElementById('logoutBtn');

(async function initSession() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) return window.location.href = '/login';
    const data = await res.json();
    sessionUser.textContent = `👤 ${data.username}`;
  } catch (err) {
    // si falla la consulta, no bloqueamos el uso de la pagina
  }
})();

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (err) {
    // igual redirigimos
  }
  window.location.href = '/login';
});

const META_HINTS = {
  reels: 'Se ajusta automáticamente a 1080x1920 (9:16), códec H.264 + AAC 48kHz y bitrate dentro de lo que pide Meta para Reels/Stories. El contenido se centra sobre un fondo relleno, sin recortarlo.',
  square: 'Se ajusta automáticamente a 1080x1080 (1:1), códec H.264 + AAC 48kHz y bitrate recomendado por Meta para Feed.',
  feed_vertical: 'Se ajusta automáticamente a 1080x1350 (4:5), códec H.264 + AAC 48kHz y bitrate recomendado por Meta para Feed.',
  none: 'No se fuerza ninguna proporción: solo se aplican la rotación y las opciones manuales de abajo tal cual las dejaste.',
};

metaPresetSel.addEventListener('change', () => {
  metaHint.textContent = META_HINTS[metaPresetSel.value] || '';
});

let currentFile = null;
let rotation = 0;
let naturalW = 0;
let naturalH = 0;
let pollTimer = null;
let elapsedTimer = null;
let elapsedStart = 0;
let currentJobId = null;

const BOX_MAX_W = 640;
const BOX_MAX_H = 420;

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function applyPreviewTransform() {
  if (!naturalW || !naturalH) return;
  const swapped = rotation === 90 || rotation === 270;
  const effW = swapped ? naturalH : naturalW;
  const effH = swapped ? naturalW : naturalH;
  const scale = Math.min(BOX_MAX_W / effW, BOX_MAX_H / effH, 1);
  const displayW = effW * scale;
  const displayH = effH * scale;

  const wrap = previewVideo.parentElement;
  wrap.style.width = displayW + 'px';
  wrap.style.height = displayH + 'px';

  const preW = swapped ? displayH : displayW;
  const preH = swapped ? displayW : displayH;
  previewVideo.style.width = preW + 'px';
  previewVideo.style.height = preH + 'px';
  previewVideo.style.transform = `rotate(${rotation}deg)`;
  previewVideo.style.transformOrigin = 'center center';
}

function stopTimers() {
  if (pollTimer) clearInterval(pollTimer);
  if (elapsedTimer) clearInterval(elapsedTimer);
  pollTimer = null;
  elapsedTimer = null;
}

function resetAll() {
  stopTimers();
  currentFile = null;
  currentJobId = null;
  rotation = 0;
  naturalW = 0;
  naturalH = 0;
  fileInput.value = '';
  previewVideo.src = '';
  previewVideo.style.transform = 'none';
  fileInfo.textContent = '';
  videoTitleInput.value = '';
  editPanel.classList.add('hidden');
  uploadPanel.classList.remove('hidden');
  progressWrap.classList.add('hidden');
  resultPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
  progressFill.classList.remove('indeterminate');
  processBtn.disabled = false;
  processBtn.textContent = '⚙️ Procesar video';
  rotationLabel.textContent = '0°';
  metaPresetSel.value = 'reels';
  metaHint.textContent = META_HINTS.reels;
}

function loadFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    alert('Por favor elegí un archivo de video.');
    return;
  }
  currentFile = file;
  rotation = 0;
  rotationLabel.textContent = '0°';
  const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
  videoTitleInput.value = nameWithoutExt;
  const url = URL.createObjectURL(file);
  previewVideo.src = url;
  previewVideo.onloadedmetadata = () => {
    naturalW = previewVideo.videoWidth;
    naturalH = previewVideo.videoHeight;
    applyPreviewTransform();
    const durMin = Math.floor(previewVideo.duration / 60);
    const durSec = Math.round(previewVideo.duration % 60).toString().padStart(2, '0');
    fileInfo.textContent = `${file.name} · ${formatBytes(file.size)} · ${naturalW}×${naturalH} · ${durMin}:${durSec}`;
  };
  uploadPanel.classList.add('hidden');
  editPanel.classList.remove('hidden');
  resultPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
  progressWrap.classList.add('hidden');
}

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));

['dragover', 'dragenter'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  loadFile(file);
});

rotateBtn.addEventListener('click', () => {
  rotation = (rotation + 90) % 360;
  rotationLabel.textContent = rotation + '°';
  applyPreviewTransform();
});

resetBtn.addEventListener('click', resetAll);

processBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  processBtn.disabled = true;
  processBtn.textContent = 'Subiendo...';
  errorPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressFill.classList.add('indeterminate');
  progressText.textContent = 'Subiendo video...';
  startElapsedTimer();

  const formData = new FormData();
  formData.append('video', currentFile);
  formData.append('rotation', rotation);
  formData.append('audioCodec', audioCodecSel.value);
  formData.append('audioBitrate', audioBitrateSel.value);
  formData.append('quality', qualitySel.value);
  formData.append('metaPreset', metaPresetSel.value);
  formData.append('title', videoTitleInput.value.trim());

  try {
    const res = await fetch('/api/process', { method: 'POST', body: formData });
    if (res.status === 401) return window.location.href = '/login';
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar el video.');

    currentJobId = data.jobId;
    processBtn.textContent = 'Procesando...';
    progressText.textContent = 'Analizando video...';
    pollStatus(data.jobId);
  } catch (err) {
    showError(err.message);
  }
});

cancelBtn.addEventListener('click', async () => {
  if (!currentJobId) return;
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Cancelando...';
  try {
    await fetch(`/api/cancel/${currentJobId}`, { method: 'POST' });
  } catch (err) {
    // si falla el pedido de cancelar, el polling lo va a resolver igual
  }
});

function startElapsedTimer() {
  elapsedStart = Date.now();
  elapsedText.textContent = '0s';
  elapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - elapsedStart) / 1000);
    elapsedText.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }, 1000);
}

function pollStatus(jobId) {
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 401) { stopTimers(); return window.location.href = '/login'; }
      const data = await res.json();

      if (data.status === 'analyzing') {
        progressText.textContent = 'Analizando video...';
      } else if (data.status === 'processing') {
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = data.progress + '%';
        progressText.textContent = `Procesando... ${data.progress}%`;
      } else if (data.status === 'done') {
        stopTimers();
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = '100%';
        downloadLink.href = `/api/download/${jobId}`;
        const savedPct = currentFile && data.outputSize
          ? Math.round((1 - data.outputSize / currentFile.size) * 100)
          : null;
        resultMeta.textContent = data.outputSize
          ? `Tamaño final: ${formatBytes(data.outputSize)}` + (savedPct && savedPct > 0 ? ` (${savedPct}% más liviano)` : '')
          : '';
        resultPanel.classList.remove('hidden');
        progressWrap.classList.add('hidden');
        processBtn.disabled = false;
        processBtn.textContent = '⚙️ Procesar video';
      } else if (data.status === 'cancelled') {
        stopTimers();
        showError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopTimers();
        showError(data.error || 'Ocurrió un error al procesar el video.');
      }
    } catch (err) {
      stopTimers();
      showError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}

function showError(msg) {
  errorPanel.textContent = '❌ ' + msg;
  errorPanel.classList.remove('hidden');
  progressWrap.classList.add('hidden');
  progressFill.classList.remove('indeterminate');
  cancelBtn.disabled = false;
  cancelBtn.textContent = '✕ Cancelar';
  processBtn.disabled = false;
  processBtn.textContent = '⚙️ Procesar video';
}
