// Mini editor: varios clips en fila, recorte por clip, texto quemado
// opcional. Vive completamente aparte de script.js (el optimizador) para no
// arriesgar romper nada de esa parte, que ya funciona bien.

const editorDropzone = document.getElementById('editorDropzone');
const editorFileInput = document.getElementById('editorFileInput');
const editorUploadPanel = document.getElementById('editorUploadPanel');
const editorEditPanel = document.getElementById('editorEditPanel');
const clipsList = document.getElementById('clipsList');
const editorPresetSel = document.getElementById('editorPreset');
const overlayEnabledChk = document.getElementById('overlayEnabled');
const overlayControls = document.getElementById('overlayControls');
const overlayTextInput = document.getElementById('overlayText');
const overlayPositionSel = document.getElementById('overlayPosition');
const overlayColorInput = document.getElementById('overlayColor');
const editorTitleInput = document.getElementById('editorTitle');
const editorQualitySel = document.getElementById('editorQuality');
const editorExportBtn = document.getElementById('editorExportBtn');
const editorResetBtn = document.getElementById('editorResetBtn');
const editorProgressWrap = document.getElementById('editorProgressWrap');
const editorProgressFill = document.getElementById('editorProgressFill');
const editorProgressText = document.getElementById('editorProgressText');
const editorElapsedText = document.getElementById('editorElapsedText');
const editorCancelBtn = document.getElementById('editorCancelBtn');
const editorResultPanel = document.getElementById('editorResultPanel');
const editorResultMeta = document.getElementById('editorResultMeta');
const editorDownloadLink = document.getElementById('editorDownloadLink');
const editorErrorPanel = document.getElementById('editorErrorPanel');

let clips = []; // { file, duration, start, end }
let editorPollTimer = null;
let editorElapsedTimer = null;
let editorElapsedStart = 0;
let editorJobId = null;

function formatBytesEditor(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(v.duration || 10);
    };
    v.onerror = () => resolve(10);
    v.src = URL.createObjectURL(file);
  });
}

function renderClips() {
  clipsList.innerHTML = '';
  clips.forEach((clip, i) => {
    const row = document.createElement('div');
    row.className = 'clip-row';
    row.innerHTML = `
      <div class="clip-num">${i + 1}</div>
      <div class="clip-info">
        <div class="clip-name">${clip.file.name}</div>
        <div class="clip-trim">
          Desde <input type="number" min="0" step="0.1" value="${clip.start.toFixed(1)}" data-role="start"> s
          hasta <input type="number" min="0" step="0.1" value="${clip.end.toFixed(1)}" data-role="end"> s
          (dura ${clip.duration.toFixed(1)}s)
        </div>
      </div>
      <div class="clip-actions">
        <button type="button" data-role="up" title="Mover arriba">↑</button>
        <button type="button" data-role="down" title="Mover abajo">↓</button>
        <button type="button" data-role="remove" class="remove" title="Quitar">✕</button>
      </div>
    `;

    row.querySelector('[data-role="start"]').addEventListener('change', (e) => {
      const val = Math.max(0, Math.min(clip.duration - 0.1, parseFloat(e.target.value) || 0));
      clip.start = val;
      if (clip.end <= clip.start) clip.end = Math.min(clip.duration, clip.start + 1);
      renderClips();
    });
    row.querySelector('[data-role="end"]').addEventListener('change', (e) => {
      const val = Math.max(clip.start + 0.1, Math.min(clip.duration, parseFloat(e.target.value) || clip.duration));
      clip.end = val;
      renderClips();
    });
    row.querySelector('[data-role="up"]').addEventListener('click', () => {
      if (i === 0) return;
      [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
      renderClips();
    });
    row.querySelector('[data-role="down"]').addEventListener('click', () => {
      if (i === clips.length - 1) return;
      [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]];
      renderClips();
    });
    row.querySelector('[data-role="remove"]').addEventListener('click', () => {
      clips.splice(i, 1);
      if (clips.length === 0) {
        resetEditor();
      } else {
        renderClips();
      }
    });

    clipsList.appendChild(row);
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('video/'));
  if (files.length === 0) return;

  for (const file of files) {
    const duration = await probeDuration(file);
    clips.push({ file, duration, start: 0, end: duration });
  }

  if (!editorTitleInput.value) {
    editorTitleInput.value = clips[0].file.name.replace(/\.[^/.]+$/, '') + ' - editado';
  }

  editorUploadPanel.classList.add('hidden');
  editorEditPanel.classList.remove('hidden');
  editorResultPanel.classList.add('hidden');
  editorErrorPanel.classList.add('hidden');
  renderClips();
}

editorDropzone.addEventListener('click', () => editorFileInput.click());
editorFileInput.addEventListener('change', (e) => addFiles(e.target.files));

['dragover', 'dragenter'].forEach((evt) =>
  editorDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    editorDropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  editorDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    editorDropzone.classList.remove('dragover');
  })
);
editorDropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

overlayEnabledChk.addEventListener('change', () => {
  overlayControls.classList.toggle('hidden', !overlayEnabledChk.checked);
});

function stopEditorTimers() {
  if (editorPollTimer) clearInterval(editorPollTimer);
  if (editorElapsedTimer) clearInterval(editorElapsedTimer);
  editorPollTimer = null;
  editorElapsedTimer = null;
}

function resetEditor() {
  stopEditorTimers();
  clips = [];
  editorJobId = null;
  editorFileInput.value = '';
  editorTitleInput.value = '';
  overlayEnabledChk.checked = false;
  overlayControls.classList.add('hidden');
  overlayTextInput.value = '';
  editorEditPanel.classList.add('hidden');
  editorUploadPanel.classList.remove('hidden');
  editorProgressWrap.classList.add('hidden');
  editorResultPanel.classList.add('hidden');
  editorErrorPanel.classList.add('hidden');
  editorProgressFill.classList.remove('indeterminate');
  editorExportBtn.disabled = false;
  editorExportBtn.textContent = '🎬 Exportar video';
}

editorResetBtn.addEventListener('click', resetEditor);

function startEditorElapsedTimer() {
  editorElapsedStart = Date.now();
  editorElapsedText.textContent = '0s';
  editorElapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - editorElapsedStart) / 1000);
    editorElapsedText.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }, 1000);
}

function showEditorError(msg) {
  editorErrorPanel.textContent = '❌ ' + msg;
  editorErrorPanel.classList.remove('hidden');
  editorProgressWrap.classList.add('hidden');
  editorProgressFill.classList.remove('indeterminate');
  editorCancelBtn.disabled = false;
  editorCancelBtn.textContent = '✕ Cancelar';
  editorExportBtn.disabled = false;
  editorExportBtn.textContent = '🎬 Exportar video';
}

editorExportBtn.addEventListener('click', async () => {
  if (clips.length === 0) return;
  for (const clip of clips) {
    if (clip.end <= clip.start) {
      showEditorError(`El clip "${clip.file.name}" tiene un recorte inválido.`);
      return;
    }
  }

  editorExportBtn.disabled = true;
  editorExportBtn.textContent = 'Subiendo...';
  editorErrorPanel.classList.add('hidden');
  editorResultPanel.classList.add('hidden');
  editorProgressWrap.classList.remove('hidden');
  editorProgressFill.classList.add('indeterminate');
  editorProgressText.textContent = 'Subiendo clips...';
  startEditorElapsedTimer();

  const formData = new FormData();
  clips.forEach((clip) => formData.append('clips', clip.file));
  formData.append('clipsMeta', JSON.stringify(clips.map((c) => ({ start: c.start, end: c.end }))));
  formData.append('metaPreset', editorPresetSel.value);
  formData.append('quality', editorQualitySel.value);
  formData.append('title', editorTitleInput.value.trim());
  formData.append('overlayEnabled', overlayEnabledChk.checked ? 'true' : 'false');
  formData.append('overlayText', overlayTextInput.value.trim());
  formData.append('overlayPosition', overlayPositionSel.value);
  formData.append('overlayColor', overlayColorInput.value);

  try {
    const res = await fetch('/api/edit', { method: 'POST', body: formData });
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al exportar el video.');

    editorJobId = data.jobId;
    editorExportBtn.textContent = 'Procesando...';
    editorProgressText.textContent = 'Analizando clips...';
    pollEditorStatus(data.jobId);
  } catch (err) {
    showEditorError(err.message);
  }
});

editorCancelBtn.addEventListener('click', async () => {
  if (!editorJobId) return;
  editorCancelBtn.disabled = true;
  editorCancelBtn.textContent = 'Cancelando...';
  try {
    await fetch(`/api/cancel/${editorJobId}`, { method: 'POST' });
  } catch (err) {
    // el polling lo resuelve igual
  }
});

function pollEditorStatus(jobId) {
  editorPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 401) {
        stopEditorTimers();
        return (window.location.href = '/login');
      }
      const data = await res.json();

      if (data.status === 'analyzing') {
        editorProgressText.textContent = 'Analizando clips...';
      } else if (data.status === 'processing') {
        editorProgressFill.classList.remove('indeterminate');
        editorProgressFill.style.width = data.progress + '%';
        editorProgressText.textContent = `Procesando... ${data.progress}%`;
      } else if (data.status === 'done') {
        stopEditorTimers();
        editorProgressFill.classList.remove('indeterminate');
        editorProgressFill.style.width = '100%';
        editorDownloadLink.href = `/api/download/${jobId}`;
        editorResultMeta.textContent = data.outputSize ? `Tamaño final: ${formatBytesEditor(data.outputSize)}` : '';
        editorResultPanel.classList.remove('hidden');
        editorProgressWrap.classList.add('hidden');
        editorExportBtn.disabled = false;
        editorExportBtn.textContent = '🎬 Exportar video';
        if (window.fireConfetti) window.fireConfetti();
      } else if (data.status === 'cancelled') {
        stopEditorTimers();
        showEditorError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopEditorTimers();
        showEditorError(data.error || 'Ocurrió un error al exportar el video.');
      }
    } catch (err) {
      stopEditorTimers();
      showEditorError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}
