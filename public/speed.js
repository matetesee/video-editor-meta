// Speed Tool: sube UN video y devuelve el mismo video a otra velocidad
// (presets de 0.25x a 4x, o un valor personalizado), con opcion de
// silenciar el audio. Mismo patron de jobs que el resto de las herramientas.

const speedDropzone = document.getElementById('speedDropzone');
const speedFileInput = document.getElementById('speedFileInput');
const speedUploadPanel = document.getElementById('speedUploadPanel');
const speedEditPanel = document.getElementById('speedEditPanel');
const speedPreviewVideo = document.getElementById('speedPreviewVideo');
const speedPresetBtns = document.querySelectorAll('.speed-preset-btn');
const speedCustomInput = document.getElementById('speedCustomInput');
const speedMuteCheckbox = document.getElementById('speedMuteCheckbox');
const speedHint = document.getElementById('speedHint');
const speedTitleInput = document.getElementById('speedTitleInput');
const speedExportBtn = document.getElementById('speedExportBtn');
const speedResetBtn = document.getElementById('speedResetBtn');
const speedProgressWrap = document.getElementById('speedProgressWrap');
const speedProgressFill = document.getElementById('speedProgressFill');
const speedProgressText = document.getElementById('speedProgressText');
const speedElapsedText = document.getElementById('speedElapsedText');
const speedCancelBtn = document.getElementById('speedCancelBtn');
const speedResultPanel = document.getElementById('speedResultPanel');
const speedResultMeta = document.getElementById('speedResultMeta');
const speedDownloadLink = document.getElementById('speedDownloadLink');
const speedErrorPanel = document.getElementById('speedErrorPanel');

let speedCurrentFile = null;
let speedJobId = null;
let speedPollTimer = null;
let speedElapsedTimer = null;
let speedElapsedStart = 0;
let speedValue = 1;

function formatBytesSpeed(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function loadSpeedFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  speedCurrentFile = file;
  if (!speedTitleInput.value) {
    speedTitleInput.value = file.name.replace(/\.[^/.]+$/, '') + ' - velocidad';
  }
  speedPreviewVideo.src = URL.createObjectURL(file);
  speedUploadPanel.classList.add('hidden');
  speedEditPanel.classList.remove('hidden');
  speedResultPanel.classList.add('hidden');
  speedErrorPanel.classList.add('hidden');
}

speedDropzone.addEventListener('click', () => speedFileInput.click());
speedFileInput.addEventListener('change', () => loadSpeedFile(speedFileInput.files[0]));
['dragover', 'dragenter'].forEach((evt) =>
  speedDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    speedDropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  speedDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    speedDropzone.classList.remove('dragover');
  })
);
speedDropzone.addEventListener('drop', (e) => loadSpeedFile(e.dataTransfer.files[0]));

function setSpeedValue(val) {
  speedValue = Math.min(4, Math.max(0.25, val));
  speedCustomInput.value = speedValue;
  speedPresetBtns.forEach((btn) => btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speedValue));
  speedHint.textContent =
    speedValue === 1
      ? 'Velocidad normal.'
      : speedValue > 1
      ? `El video queda ${speedValue}x más rápido. El audio se sincroniza automáticamente.`
      : `El video queda ${speedValue}x (más lento). El audio se sincroniza automáticamente.`;
}

speedPresetBtns.forEach((btn) => {
  btn.addEventListener('click', () => setSpeedValue(parseFloat(btn.dataset.speed)));
});
speedCustomInput.addEventListener('change', () => setSpeedValue(parseFloat(speedCustomInput.value) || 1));

function stopSpeedTimers() {
  if (speedPollTimer) clearInterval(speedPollTimer);
  if (speedElapsedTimer) clearInterval(speedElapsedTimer);
  speedPollTimer = null;
  speedElapsedTimer = null;
}

function resetSpeedEditor() {
  stopSpeedTimers();
  speedCurrentFile = null;
  speedJobId = null;
  speedFileInput.value = '';
  speedTitleInput.value = '';
  speedPreviewVideo.src = '';
  setSpeedValue(1);
  speedMuteCheckbox.checked = false;
  speedEditPanel.classList.add('hidden');
  speedUploadPanel.classList.remove('hidden');
  speedProgressWrap.classList.add('hidden');
  speedResultPanel.classList.add('hidden');
  speedErrorPanel.classList.add('hidden');
  speedProgressFill.classList.remove('indeterminate');
  speedExportBtn.disabled = false;
  speedExportBtn.textContent = '⚡ Cambiar velocidad';
}
speedResetBtn.addEventListener('click', resetSpeedEditor);

function startSpeedElapsedTimer() {
  speedElapsedStart = Date.now();
  speedElapsedText.textContent = '0s';
  speedElapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - speedElapsedStart) / 1000);
    speedElapsedText.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }, 1000);
}

function showSpeedError(msg) {
  speedErrorPanel.textContent = '❌ ' + msg;
  speedErrorPanel.classList.remove('hidden');
  speedProgressWrap.classList.add('hidden');
  speedProgressFill.classList.remove('indeterminate');
  speedExportBtn.disabled = false;
  speedExportBtn.textContent = '⚡ Cambiar velocidad';
}

speedExportBtn.addEventListener('click', async () => {
  if (!speedCurrentFile) return;
  if (window.requestNotifyPermission) window.requestNotifyPermission();
  speedExportBtn.disabled = true;
  speedExportBtn.textContent = 'Subiendo...';
  speedErrorPanel.classList.add('hidden');
  speedResultPanel.classList.add('hidden');
  document.getElementById('speedFeedbackCard').classList.add('hidden');
  speedProgressWrap.classList.remove('hidden');
  speedProgressFill.classList.add('indeterminate');
  speedProgressText.textContent = 'Subiendo video...';
  delete speedProgressText.dataset.rotating;
  startSpeedElapsedTimer();

  const formData = new FormData();
  formData.append('video', speedCurrentFile);
  formData.append('speed', String(speedValue));
  formData.append('mute', speedMuteCheckbox.checked ? '1' : '0');
  formData.append('title', speedTitleInput.value.trim());

  try {
    const res = await fetch('/api/speed', { method: 'POST', body: formData });
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    if (res.status === 429) {
      speedProgressWrap.classList.add('hidden');
      speedProgressFill.classList.remove('indeterminate');
      speedExportBtn.disabled = false;
      speedExportBtn.textContent = '⚡ Cambiar velocidad';
      if (window.showLimitModal) window.showLimitModal(data);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Error al cambiar la velocidad.');

    speedJobId = data.jobId;
    speedExportBtn.textContent = 'Procesando...';
    speedProgressText.textContent = 'Analizando video...';
    pollSpeedStatus(data.jobId);
  } catch (err) {
    showSpeedError(err.message);
  }
});

speedCancelBtn.addEventListener('click', async () => {
  if (!speedJobId) return;
  speedCancelBtn.disabled = true;
  speedCancelBtn.textContent = 'Cancelando...';
  try {
    await fetch(`/api/cancel/${speedJobId}`, { method: 'POST' });
  } catch (err) {
    // el polling lo resuelve igual
  }
});

function pollSpeedStatus(jobId) {
  speedPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 401) {
        stopSpeedTimers();
        return (window.location.href = '/login');
      }
      const data = await res.json();

      if (data.status === 'analyzing') {
        if (window.startPhraseRotation && !speedProgressText.dataset.rotating) {
          speedProgressText.dataset.rotating = '1';
          window.startPhraseRotation(speedProgressText);
        }
      } else if (data.status === 'processing') {
        speedProgressFill.classList.remove('indeterminate');
        speedProgressFill.style.width = data.progress + '%';
        if (!speedProgressText.dataset.rotating) {
          speedProgressText.dataset.rotating = '1';
          if (window.startPhraseRotation) window.startPhraseRotation(speedProgressText);
        }
      } else if (data.status === 'done') {
        stopSpeedTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete speedProgressText.dataset.rotating;
        speedProgressFill.classList.remove('indeterminate');
        speedProgressFill.style.width = '100%';
        speedDownloadLink.href = `/api/download/${jobId}`;
        speedResultMeta.textContent = data.outputSize ? `Tamaño final: ${formatBytesSpeed(data.outputSize)}` : '';
        speedResultPanel.classList.remove('hidden');
        speedProgressWrap.classList.add('hidden');
        speedExportBtn.disabled = false;
        speedExportBtn.textContent = '⚡ Cambiar velocidad';
        if (window.fireConfetti) window.fireConfetti();
        if (window.notifyVideoReady) window.notifyVideoReady('Tu video ya está listo para descargar.');
        if (window.initFeedbackCard) window.initFeedbackCard(document.getElementById('speedFeedbackCard'), jobId, 'speed');
        if (window.showAchievementModal) window.showAchievementModal(data.newAchievements, data.newReward);
        if (window.showRecordToasts) window.showRecordToasts(data.newRecords);
        if (window.showPersonalizationToasts) window.showPersonalizationToasts(data.newPersonalizations);
      } else if (data.status === 'cancelled') {
        stopSpeedTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete speedProgressText.dataset.rotating;
        showSpeedError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopSpeedTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete speedProgressText.dataset.rotating;
        showSpeedError(data.error || 'Ocurrió un error al cambiar la velocidad.');
      }
    } catch (err) {
      stopSpeedTimers();
      showSpeedError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}
