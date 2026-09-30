// GIF Maker: sube UN video, elegis un fragmento (inicio/fin en segundos,
// tope de 15s), FPS, resolucion y calidad de color, y devuelve un GIF.
// Mismo patron de jobs que el resto de las herramientas.

const gifDropzone = document.getElementById('gifDropzone');
const gifFileInput = document.getElementById('gifFileInput');
const gifUploadPanel = document.getElementById('gifUploadPanel');
const gifEditPanel = document.getElementById('gifEditPanel');
const gifPreviewVideo = document.getElementById('gifPreviewVideo');
const gifStartInput = document.getElementById('gifStartInput');
const gifEndInput = document.getElementById('gifEndInput');
const gifUseStartBtn = document.getElementById('gifUseStartBtn');
const gifUseEndBtn = document.getElementById('gifUseEndBtn');
const gifDurationHint = document.getElementById('gifDurationHint');
const gifFpsSelect = document.getElementById('gifFpsSelect');
const gifWidthSelect = document.getElementById('gifWidthSelect');
const gifQualitySelect = document.getElementById('gifQualitySelect');
const gifTitleInput = document.getElementById('gifTitleInput');
const gifExportBtn = document.getElementById('gifExportBtn');
const gifResetBtn = document.getElementById('gifResetBtn');
const gifProgressWrap = document.getElementById('gifProgressWrap');
const gifProgressFill = document.getElementById('gifProgressFill');
const gifProgressText = document.getElementById('gifProgressText');
const gifElapsedText = document.getElementById('gifElapsedText');
const gifCancelBtn = document.getElementById('gifCancelBtn');
const gifResultPanel = document.getElementById('gifResultPanel');
const gifResultPreview = document.getElementById('gifResultPreview');
const gifResultMeta = document.getElementById('gifResultMeta');
const gifDownloadLink = document.getElementById('gifDownloadLink');
const gifErrorPanel = document.getElementById('gifErrorPanel');

let gifCurrentFile = null;
let gifJobId = null;
let gifPollTimer = null;
let gifElapsedTimer = null;
let gifElapsedStart = 0;

function formatBytesGif(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function updateGifDurationHint() {
  const start = parseFloat(gifStartInput.value) || 0;
  const end = parseFloat(gifEndInput.value) || 0;
  const dur = Math.max(0, end - start);
  const capped = Math.min(15, dur);
  gifDurationHint.textContent =
    dur > 15
      ? `Fragmento de ${dur.toFixed(1)}s — se recorta a los primeros 15s (tope máximo).`
      : `Fragmento de ${capped.toFixed(1)}s.`;
}

function loadGifFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  gifCurrentFile = file;
  if (!gifTitleInput.value) {
    gifTitleInput.value = file.name.replace(/\.[^/.]+$/, '') + '-gif';
  }
  gifPreviewVideo.src = URL.createObjectURL(file);
  gifPreviewVideo.addEventListener(
    'loadedmetadata',
    () => {
      gifStartInput.value = '0';
      gifEndInput.value = Math.min(3, gifPreviewVideo.duration || 3).toFixed(1);
      updateGifDurationHint();
    },
    { once: true }
  );
  gifUploadPanel.classList.add('hidden');
  gifEditPanel.classList.remove('hidden');
  gifResultPanel.classList.add('hidden');
  gifErrorPanel.classList.add('hidden');
}

gifDropzone.addEventListener('click', () => gifFileInput.click());
gifFileInput.addEventListener('change', () => loadGifFile(gifFileInput.files[0]));
['dragover', 'dragenter'].forEach((evt) =>
  gifDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    gifDropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  gifDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    gifDropzone.classList.remove('dragover');
  })
);
gifDropzone.addEventListener('drop', (e) => loadGifFile(e.dataTransfer.files[0]));

gifUseStartBtn.addEventListener('click', () => {
  gifStartInput.value = gifPreviewVideo.currentTime.toFixed(1);
  updateGifDurationHint();
});
gifUseEndBtn.addEventListener('click', () => {
  gifEndInput.value = gifPreviewVideo.currentTime.toFixed(1);
  updateGifDurationHint();
});
gifStartInput.addEventListener('input', updateGifDurationHint);
gifEndInput.addEventListener('input', updateGifDurationHint);

function stopGifTimers() {
  if (gifPollTimer) clearInterval(gifPollTimer);
  if (gifElapsedTimer) clearInterval(gifElapsedTimer);
  gifPollTimer = null;
  gifElapsedTimer = null;
}

function resetGifEditor() {
  stopGifTimers();
  gifCurrentFile = null;
  gifJobId = null;
  gifFileInput.value = '';
  gifTitleInput.value = '';
  gifPreviewVideo.src = '';
  gifStartInput.value = '0';
  gifEndInput.value = '3';
  gifEditPanel.classList.add('hidden');
  gifUploadPanel.classList.remove('hidden');
  gifProgressWrap.classList.add('hidden');
  gifResultPanel.classList.add('hidden');
  gifErrorPanel.classList.add('hidden');
  gifProgressFill.classList.remove('indeterminate');
  gifExportBtn.disabled = false;
  gifExportBtn.textContent = '🖼️ Crear GIF';
}
gifResetBtn.addEventListener('click', resetGifEditor);

function startGifElapsedTimer() {
  gifElapsedStart = Date.now();
  gifElapsedText.textContent = '0s';
  gifElapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - gifElapsedStart) / 1000);
    gifElapsedText.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }, 1000);
}

function showGifError(msg) {
  gifErrorPanel.textContent = '❌ ' + msg;
  gifErrorPanel.classList.remove('hidden');
  gifProgressWrap.classList.add('hidden');
  gifProgressFill.classList.remove('indeterminate');
  gifExportBtn.disabled = false;
  gifExportBtn.textContent = '🖼️ Crear GIF';
}

gifExportBtn.addEventListener('click', async () => {
  if (!gifCurrentFile) return;
  const start = parseFloat(gifStartInput.value) || 0;
  const end = parseFloat(gifEndInput.value) || 0;
  if (end <= start) {
    showGifError('El fin del fragmento tiene que ser mayor al inicio.');
    return;
  }
  if (window.requestNotifyPermission) window.requestNotifyPermission();
  gifExportBtn.disabled = true;
  gifExportBtn.textContent = 'Subiendo...';
  gifErrorPanel.classList.add('hidden');
  gifResultPanel.classList.add('hidden');
  document.getElementById('gifFeedbackCard').classList.add('hidden');
  gifProgressWrap.classList.remove('hidden');
  gifProgressFill.classList.add('indeterminate');
  gifProgressText.textContent = 'Subiendo video...';
  delete gifProgressText.dataset.rotating;
  startGifElapsedTimer();

  const formData = new FormData();
  formData.append('video', gifCurrentFile);
  formData.append('start', String(start));
  formData.append('end', String(end));
  formData.append('fps', gifFpsSelect.value);
  formData.append('width', gifWidthSelect.value);
  formData.append('quality', gifQualitySelect.value);
  formData.append('title', gifTitleInput.value.trim());

  try {
    const res = await fetch('/api/gif', { method: 'POST', body: formData });
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    if (res.status === 429) {
      gifProgressWrap.classList.add('hidden');
      gifProgressFill.classList.remove('indeterminate');
      gifExportBtn.disabled = false;
      gifExportBtn.textContent = '🖼️ Crear GIF';
      if (window.showLimitModal) window.showLimitModal(data);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Error al crear el GIF.');

    gifJobId = data.jobId;
    gifExportBtn.textContent = 'Procesando...';
    gifProgressText.textContent = 'Analizando video...';
    pollGifStatus(data.jobId);
  } catch (err) {
    showGifError(err.message);
  }
});

gifCancelBtn.addEventListener('click', async () => {
  if (!gifJobId) return;
  gifCancelBtn.disabled = true;
  gifCancelBtn.textContent = 'Cancelando...';
  try {
    await fetch(`/api/cancel/${gifJobId}`, { method: 'POST' });
  } catch (err) {
    // el polling lo resuelve igual
  }
});

function pollGifStatus(jobId) {
  gifPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 401) {
        stopGifTimers();
        return (window.location.href = '/login');
      }
      const data = await res.json();

      if (data.status === 'analyzing') {
        if (window.startPhraseRotation && !gifProgressText.dataset.rotating) {
          gifProgressText.dataset.rotating = '1';
          window.startPhraseRotation(gifProgressText);
        }
      } else if (data.status === 'processing') {
        gifProgressFill.classList.remove('indeterminate');
        gifProgressFill.style.width = data.progress + '%';
        if (!gifProgressText.dataset.rotating) {
          gifProgressText.dataset.rotating = '1';
          if (window.startPhraseRotation) window.startPhraseRotation(gifProgressText);
        }
      } else if (data.status === 'done') {
        stopGifTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete gifProgressText.dataset.rotating;
        gifProgressFill.classList.remove('indeterminate');
        gifProgressFill.style.width = '100%';
        gifDownloadLink.href = `/api/download/${jobId}`;
        gifResultPreview.src = `/api/download/${jobId}`;
        gifResultMeta.textContent = data.outputSize ? `Tamaño final: ${formatBytesGif(data.outputSize)}` : '';
        gifResultPanel.classList.remove('hidden');
        gifProgressWrap.classList.add('hidden');
        gifExportBtn.disabled = false;
        gifExportBtn.textContent = '🖼️ Crear GIF';
        if (window.fireConfetti) window.fireConfetti();
        if (window.notifyVideoReady) window.notifyVideoReady('Tu GIF ya está listo para descargar.');
        if (window.initFeedbackCard) window.initFeedbackCard(document.getElementById('gifFeedbackCard'), jobId, 'gif');
        if (window.showAchievementModal) window.showAchievementModal(data.newAchievements, data.newReward);
        if (window.showRecordToasts) window.showRecordToasts(data.newRecords);
        if (window.showPersonalizationToasts) window.showPersonalizationToasts(data.newPersonalizations);
        if (window.renderQuickActions) {
          window.renderQuickActions(document.getElementById('gifQuickActions'), {
            currentTool: 'gif',
            downloadUrl: `/api/download/${jobId}`,
            title: 'animacion.gif',
            mimeType: 'image/gif',
            excludeTargets: ['audio'],
          });
        }
      } else if (data.status === 'cancelled') {
        stopGifTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete gifProgressText.dataset.rotating;
        showGifError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopGifTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete gifProgressText.dataset.rotating;
        showGifError(data.error || 'Ocurrió un error al crear el GIF.');
      }
    } catch (err) {
      stopGifTimers();
      showGifError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}
