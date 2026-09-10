// Extraer audio: sube UN video (archivo local, no links externos) y
// devuelve solo el audio en el formato elegido. Mismo patron de jobs
// (analizando -> procesando -> listo) que el optimizador y el mini editor.

const audioDropzone = document.getElementById('audioDropzone');
const audioFileInput = document.getElementById('audioFileInput');
const audioUploadPanel = document.getElementById('audioUploadPanel');
const audioEditPanel = document.getElementById('audioEditPanel');
const audioFormatSel = document.getElementById('audioFormat');
const audioBitrateWrap = document.getElementById('audioBitrateWrap');
const audioBitrateSel = document.getElementById('audioBitrate');
const audioTitleInput = document.getElementById('audioTitle');
const audioExportBtn = document.getElementById('audioExportBtn');
const audioResetBtn = document.getElementById('audioResetBtn');
const audioProgressWrap = document.getElementById('audioProgressWrap');
const audioProgressFill = document.getElementById('audioProgressFill');
const audioProgressText = document.getElementById('audioProgressText');
const audioElapsedText = document.getElementById('audioElapsedText');
const audioCancelBtn = document.getElementById('audioCancelBtn');
const audioResultPanel = document.getElementById('audioResultPanel');
const audioResultMeta = document.getElementById('audioResultMeta');
const audioDownloadLink = document.getElementById('audioDownloadLink');
const audioErrorPanel = document.getElementById('audioErrorPanel');

let audioCurrentFile = null;
let audioJobId = null;
let audioPollTimer = null;
let audioElapsedTimer = null;
let audioElapsedStart = 0;

function formatBytesAudio(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function loadAudioFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  audioCurrentFile = file;
  if (!audioTitleInput.value) {
    audioTitleInput.value = file.name.replace(/\.[^/.]+$/, '') + ' - audio';
  }
  audioUploadPanel.classList.add('hidden');
  audioEditPanel.classList.remove('hidden');
  audioResultPanel.classList.add('hidden');
  audioErrorPanel.classList.add('hidden');
}

audioDropzone.addEventListener('click', () => audioFileInput.click());
audioFileInput.addEventListener('change', () => loadAudioFile(audioFileInput.files[0]));
['dragover', 'dragenter'].forEach((evt) =>
  audioDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    audioDropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  audioDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    audioDropzone.classList.remove('dragover');
  })
);
audioDropzone.addEventListener('drop', (e) => loadAudioFile(e.dataTransfer.files[0]));

audioFormatSel.addEventListener('change', () => {
  audioBitrateWrap.classList.toggle('hidden', audioFormatSel.value === 'wav');
});

function stopAudioTimers() {
  if (audioPollTimer) clearInterval(audioPollTimer);
  if (audioElapsedTimer) clearInterval(audioElapsedTimer);
  audioPollTimer = null;
  audioElapsedTimer = null;
}

function resetAudioEditor() {
  stopAudioTimers();
  audioCurrentFile = null;
  audioJobId = null;
  audioFileInput.value = '';
  audioTitleInput.value = '';
  audioEditPanel.classList.add('hidden');
  audioUploadPanel.classList.remove('hidden');
  audioProgressWrap.classList.add('hidden');
  audioResultPanel.classList.add('hidden');
  audioErrorPanel.classList.add('hidden');
  audioProgressFill.classList.remove('indeterminate');
  audioExportBtn.disabled = false;
  audioExportBtn.textContent = '🎧 Extraer audio';
}
audioResetBtn.addEventListener('click', resetAudioEditor);

function startAudioElapsedTimer() {
  audioElapsedStart = Date.now();
  audioElapsedText.textContent = '0s';
  audioElapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - audioElapsedStart) / 1000);
    audioElapsedText.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }, 1000);
}

function showAudioError(msg) {
  audioErrorPanel.textContent = '❌ ' + msg;
  audioErrorPanel.classList.remove('hidden');
  audioProgressWrap.classList.add('hidden');
  audioProgressFill.classList.remove('indeterminate');
  audioExportBtn.disabled = false;
  audioExportBtn.textContent = '🎧 Extraer audio';
}

audioExportBtn.addEventListener('click', async () => {
  if (!audioCurrentFile) return;
  if (window.requestNotifyPermission) window.requestNotifyPermission();
  audioExportBtn.disabled = true;
  audioExportBtn.textContent = 'Subiendo...';
  audioErrorPanel.classList.add('hidden');
  audioResultPanel.classList.add('hidden');
  audioProgressWrap.classList.remove('hidden');
  audioProgressFill.classList.add('indeterminate');
  audioProgressText.textContent = 'Subiendo video...';
  delete audioProgressText.dataset.rotating;
  startAudioElapsedTimer();

  const formData = new FormData();
  formData.append('video', audioCurrentFile);
  formData.append('format', audioFormatSel.value);
  formData.append('bitrate', audioBitrateSel.value);
  formData.append('title', audioTitleInput.value.trim());

  try {
    const res = await fetch('/api/extract-audio', { method: 'POST', body: formData });
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al extraer el audio.');

    audioJobId = data.jobId;
    audioExportBtn.textContent = 'Procesando...';
    audioProgressText.textContent = 'Analizando video...';
    pollAudioStatus(data.jobId);
  } catch (err) {
    showAudioError(err.message);
  }
});

audioCancelBtn.addEventListener('click', async () => {
  if (!audioJobId) return;
  audioCancelBtn.disabled = true;
  audioCancelBtn.textContent = 'Cancelando...';
  try {
    await fetch(`/api/cancel/${audioJobId}`, { method: 'POST' });
  } catch (err) {
    // el polling lo resuelve igual
  }
});

function pollAudioStatus(jobId) {
  audioPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 401) {
        stopAudioTimers();
        return (window.location.href = '/login');
      }
      const data = await res.json();

      if (data.status === 'analyzing') {
        if (window.startPhraseRotation && !audioProgressText.dataset.rotating) {
          audioProgressText.dataset.rotating = '1';
          window.startPhraseRotation(audioProgressText);
        }
      } else if (data.status === 'processing') {
        audioProgressFill.classList.remove('indeterminate');
        audioProgressFill.style.width = data.progress + '%';
        if (!audioProgressText.dataset.rotating) {
          audioProgressText.dataset.rotating = '1';
          if (window.startPhraseRotation) window.startPhraseRotation(audioProgressText);
        }
      } else if (data.status === 'done') {
        stopAudioTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete audioProgressText.dataset.rotating;
        audioProgressFill.classList.remove('indeterminate');
        audioProgressFill.style.width = '100%';
        audioDownloadLink.href = `/api/download/${jobId}`;
        audioResultMeta.textContent = data.outputSize ? `Tamaño final: ${formatBytesAudio(data.outputSize)}` : '';
        audioResultPanel.classList.remove('hidden');
        audioProgressWrap.classList.add('hidden');
        audioExportBtn.disabled = false;
        audioExportBtn.textContent = '🎧 Extraer audio';
        if (window.fireConfetti) window.fireConfetti();
        if (window.notifyVideoReady) window.notifyVideoReady('Tu audio ya está listo para descargar.');
      } else if (data.status === 'cancelled') {
        stopAudioTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete audioProgressText.dataset.rotating;
        showAudioError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopAudioTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete audioProgressText.dataset.rotating;
        showAudioError(data.error || 'Ocurrió un error al extraer el audio.');
      }
    } catch (err) {
      stopAudioTimers();
      showAudioError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}
