const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadPanel = document.getElementById('uploadPanel');
const editPanel = document.getElementById('editPanel');
const previewVideo = document.getElementById('previewVideo');
const rotateBtn = document.getElementById('rotateBtn');
const rotationLabel = document.getElementById('rotationLabel');
const processBtn = document.getElementById('processBtn');
const resetBtn = document.getElementById('resetBtn');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultPanel = document.getElementById('resultPanel');
const downloadLink = document.getElementById('downloadLink');
const errorPanel = document.getElementById('errorPanel');
const audioCodecSel = document.getElementById('audioCodec');
const audioBitrateSel = document.getElementById('audioBitrate');
const qualitySel = document.getElementById('quality');
const metaPresetSel = document.getElementById('metaPreset');
const metaHint = document.getElementById('metaHint');

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

const BOX_MAX_W = 640;
const BOX_MAX_H = 420;

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

function resetAll() {
  currentFile = null;
  rotation = 0;
  naturalW = 0;
  naturalH = 0;
  fileInput.value = '';
  previewVideo.src = '';
  previewVideo.style.transform = 'none';
  editPanel.classList.add('hidden');
  uploadPanel.classList.remove('hidden');
  progressWrap.classList.add('hidden');
  resultPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
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
  const url = URL.createObjectURL(file);
  previewVideo.src = url;
  previewVideo.onloadedmetadata = () => {
    naturalW = previewVideo.videoWidth;
    naturalH = previewVideo.videoHeight;
    applyPreviewTransform();
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
  progressFill.style.width = '0%';
  progressText.textContent = 'Subiendo video...';

  const formData = new FormData();
  formData.append('video', currentFile);
  formData.append('rotation', rotation);
  formData.append('audioCodec', audioCodecSel.value);
  formData.append('audioBitrate', audioBitrateSel.value);
  formData.append('quality', qualitySel.value);
  formData.append('metaPreset', metaPresetSel.value);

  try {
    const res = await fetch('/api/process', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar el video.');

    processBtn.textContent = 'Procesando...';
    pollStatus(data.jobId);
  } catch (err) {
    showError(err.message);
  }
});

function pollStatus(jobId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();
      if (data.status === 'processing') {
        progressFill.style.width = data.progress + '%';
        progressText.textContent = `Procesando... ${data.progress}%`;
      } else if (data.status === 'done') {
        clearInterval(interval);
        progressFill.style.width = '100%';
        progressText.textContent = 'Procesando... 100%';
        downloadLink.href = `/api/download/${jobId}`;
        resultPanel.classList.remove('hidden');
        progressWrap.classList.add('hidden');
        processBtn.disabled = false;
        processBtn.textContent = '⚙️ Procesar video';
      } else if (data.status === 'error') {
        clearInterval(interval);
        showError(data.error || 'Ocurrió un error al procesar el video.');
      }
    } catch (err) {
      clearInterval(interval);
      showError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}

function showError(msg) {
  errorPanel.textContent = '❌ ' + msg;
  errorPanel.classList.remove('hidden');
  progressWrap.classList.add('hidden');
  processBtn.disabled = false;
  processBtn.textContent = '⚙️ Procesar video';
}
