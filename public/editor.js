// Mini editor: varios clips que se unen en uno, con una vista previa
// "estilo CapCut" (reproduce los clips ya recortados en secuencia, sin
// esperar al servidor), una linea de tiempo donde tocás/arrastrás para
// recortar, dividir un clip en dos, y agregar textos que aparecen solo en
// el tramo de tiempo que quieras. Vive completamente aparte de script.js
// (el optimizador) para no arriesgar romper nada de esa parte.

const editorDropzone = document.getElementById('editorDropzone');
const editorFileInput = document.getElementById('editorFileInput');
const editorUploadPanel = document.getElementById('editorUploadPanel');
const editorEditPanel = document.getElementById('editorEditPanel');
const editorPresetSel = document.getElementById('editorPreset');
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

// Vista previa + linea de tiempo
const editorPreviewWrap = document.getElementById('editorPreviewWrap');
const editorPreviewVideo = document.getElementById('editorPreviewVideo');
const editorCaptionLayer = document.getElementById('editorCaptionLayer');
const editorPlayBtn = document.getElementById('editorPlayBtn');
const editorTimeLabel = document.getElementById('editorTimeLabel');
const timelineRuler = document.getElementById('timelineRuler');
const timelineClipsEl = document.getElementById('timelineClips');
const timelineTextTrackEl = document.getElementById('timelineTextTrack');
const timelinePlayhead = document.getElementById('timelinePlayhead');
const splitBtn = document.getElementById('splitBtn');
const addTextBtn = document.getElementById('addTextBtn');
const clipUpBtn = document.getElementById('clipUpBtn');
const clipDownBtn = document.getElementById('clipDownBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const clipInspector = document.getElementById('clipInspector');
const clipInspectorName = document.getElementById('clipInspectorName');
const clipStartInput = document.getElementById('clipStartInput');
const clipEndInput = document.getElementById('clipEndInput');
const textInspector = document.getElementById('textInspector');
const textInspectorText = document.getElementById('textInspectorText');
const textInspectorBox = document.getElementById('textInspectorBox');
const textInspectorColor = document.getElementById('textInspectorColor');
const textStartInput = document.getElementById('textStartInput');
const textEndInput = document.getElementById('textEndInput');

let clips = []; // { id, file, objectUrl, duration, start, end }
let textOverlays = []; // { id, text, start, end (tiempo GLOBAL, ya unido), xPct, yPct (posicion libre 0-100), box, color (sin '#') }
let selectedClipId = null;
let selectedTextId = null;
let clipRangesCache = []; // [{ clip, globalStart, globalEnd }]
let activeClipIndex = -1;
let playheadTime = 0;
let editorPollTimer = null;
let editorElapsedTimer = null;
let editorElapsedStart = 0;
let editorJobId = null;

function uid() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now();
}

function formatBytesEditor(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatTimeShort(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function totalDuration() {
  return clips.reduce((sum, c) => sum + Math.max(0, c.end - c.start), 0);
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

// ---- Seleccion ----
function selectClip(id) {
  selectedClipId = id;
  selectedTextId = null;
  renderTimeline();
}
function selectText(id) {
  selectedTextId = id;
  selectedClipId = null;
  renderTimeline();
}

// ---- Arrastre generico con Pointer Events ----
// callback onMove recibe (deltaX en px desde que arranco el drag, evento)
function wireDrag(el, onStart, onMove, onEnd) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== el && !el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch {}
    const ctx = onStart ? onStart(e) : {};
    const startX = e.clientX;
    const move = (ev) => onMove(ev.clientX - startX, ctx, ev);
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (onEnd) onEnd(ctx);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

// IMPORTANTE: mientras se arrastra un handle NO se puede llamar a
// renderTimeline() en cada movimiento, porque esa funcion hace
// innerHTML='' y recrea todos los bloques (incluido el handle que tiene el
// pointer capture activo en este momento) — el navegador pierde la captura
// apenas el elemento se saca del DOM, y el arrastre se corta a los pocos
// pixeles ("se mueve apenas"). Por eso durante el drag solo se reposicionan
// los bloques ya existentes (updateClipAndTextPositions), y el
// renderTimeline() completo se hace recien al soltar.
function wireClipTrimHandle(handleEl, clip, edge) {
  wireDrag(
    handleEl,
    () => ({
      total: totalDuration(),
      widthPx: timelineClipsEl.getBoundingClientRect().width || 1,
      start: clip.start,
      end: clip.end,
    }),
    (deltaX, ctx) => {
      const deltaTime = (deltaX / ctx.widthPx) * ctx.total;
      if (edge === 'start') {
        clip.start = Math.max(0, Math.min(ctx.start + deltaTime, clip.end - 0.2));
      } else {
        clip.end = Math.min(clip.duration, Math.max(ctx.end + deltaTime, clip.start + 0.2));
      }
      updateClipAndTextPositions();
    },
    () => {
      renderTimeline();
      seekGlobal(playheadTime);
    }
  );
}

// Selecciona un texto SIN pasar por renderTimeline() (que hace innerHTML=''
// y recrearia el bloque/el globo que se esta por arrastrar, matando el
// arrastre en el primer frame). Solo toca las clases "selected" a mano; el
// renderTimeline() completo se hace igual al soltar (onEnd), que ya
// resincroniza todo (inspector, etc.).
function selectTextNoRender(id) {
  selectedTextId = id;
  selectedClipId = null;
  document.querySelectorAll('.timeline-text-block.selected, .editor-caption.selected').forEach((el) => el.classList.remove('selected'));
  const idx = textOverlays.findIndex((o) => o.id === id);
  const blockEl = timelineTextTrackEl.children[idx];
  if (blockEl) blockEl.classList.add('selected');
  const capEl = editorCaptionLayer.querySelector(`[data-id="${id}"]`);
  if (capEl) capEl.classList.add('selected');
}

function wireTextBlockDrag(blockEl, overlay) {
  wireDrag(
    blockEl,
    (e) => {
      if (e.target.classList.contains('trim-handle')) return { skip: true };
      selectTextNoRender(overlay.id);
      return {
        skip: false,
        total: totalDuration(),
        widthPx: timelineTextTrackEl.getBoundingClientRect().width || 1,
        dur: overlay.end - overlay.start,
        start: overlay.start,
      };
    },
    (deltaX, ctx) => {
      if (ctx.skip) return;
      const deltaTime = (deltaX / ctx.widthPx) * ctx.total;
      const newStart = Math.max(0, Math.min(ctx.total - ctx.dur, ctx.start + deltaTime));
      overlay.start = newStart;
      overlay.end = newStart + ctx.dur;
      updateClipAndTextPositions();
    },
    () => renderTimeline()
  );
}

function wireTextHandle(handleEl, overlay, edge) {
  wireDrag(
    handleEl,
    () => ({
      total: totalDuration(),
      widthPx: timelineTextTrackEl.getBoundingClientRect().width || 1,
      start: overlay.start,
      end: overlay.end,
    }),
    (deltaX, ctx) => {
      const deltaTime = (deltaX / ctx.widthPx) * ctx.total;
      if (edge === 'start') {
        overlay.start = Math.max(0, Math.min(ctx.start + deltaTime, overlay.end - 0.3));
      } else {
        overlay.end = Math.min(ctx.total, Math.max(ctx.end + deltaTime, overlay.start + 0.3));
      }
      updateClipAndTextPositions();
    },
    () => renderTimeline()
  );
}

// Reposiciona (sin recrear) los bloques de clips/texto ya existentes en el
// DOM durante un drag, y de paso recalcula clipRangesCache. Mucho mas barato
// que un renderTimeline() completo y no rompe el pointer capture activo.
function updateClipAndTextPositions() {
  const total = totalDuration() || 1;
  let cursor = 0;
  clipRangesCache = clips.map((clip) => {
    const dur = Math.max(0, clip.end - clip.start);
    const r = { clip, globalStart: cursor, globalEnd: cursor + dur };
    cursor += dur;
    return r;
  });
  const clipEls = timelineClipsEl.children;
  clipRangesCache.forEach((r, i) => {
    const el = clipEls[i];
    if (!el) return;
    el.style.left = ((r.globalStart / total) * 100) + '%';
    el.style.width = (((r.globalEnd - r.globalStart) / total) * 100) + '%';
  });
  const textEls = timelineTextTrackEl.children;
  textOverlays.forEach((ov, i) => {
    const el = textEls[i];
    if (!el) return;
    el.style.left = ((ov.start / total) * 100) + '%';
    el.style.width = (((ov.end - ov.start) / total) * 100) + '%';
  });
  updatePlayheadPosition();
  updateTimeLabel();
}

function wireRulerScrub() {
  const seekFromEvent = (e) => {
    const rect = timelineRuler.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    seekGlobal(pct * totalDuration());
  };
  timelineRuler.addEventListener('pointerdown', (e) => {
    try { timelineRuler.setPointerCapture(e.pointerId); } catch {}
    seekFromEvent(e);
    const move = (ev) => seekFromEvent(ev);
    const up = () => {
      timelineRuler.removeEventListener('pointermove', move);
      timelineRuler.removeEventListener('pointerup', up);
    };
    timelineRuler.addEventListener('pointermove', move);
    timelineRuler.addEventListener('pointerup', up);
  });
}
wireRulerScrub();

// ---- Render de la linea de tiempo ----
function renderClipBlocks(total) {
  timelineClipsEl.innerHTML = '';
  clipRangesCache = [];
  let cursor = 0;
  clips.forEach((clip) => {
    const dur = Math.max(0, clip.end - clip.start);
    const globalStart = cursor;
    const globalEnd = cursor + dur;
    clipRangesCache.push({ clip, globalStart, globalEnd });
    cursor = globalEnd;

    const el = document.createElement('div');
    el.className = 'timeline-clip' + (clip.id === selectedClipId ? ' selected' : '');
    el.style.left = (total > 0 ? (globalStart / total) * 100 : 0) + '%';
    el.style.width = (total > 0 ? (dur / total) * 100 : 100 / Math.max(1, clips.length)) + '%';
    el.innerHTML = `
      <span class="timeline-clip-label">${clip.file.name}</span>
      <div class="trim-handle trim-handle-left"></div>
      <div class="trim-handle trim-handle-right"></div>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('trim-handle')) return;
      selectClip(clip.id);
    });
    wireClipTrimHandle(el.querySelector('.trim-handle-left'), clip, 'start');
    wireClipTrimHandle(el.querySelector('.trim-handle-right'), clip, 'end');
    timelineClipsEl.appendChild(el);
  });
  timelineClipsEl.addEventListener('click', (e) => {
    if (e.target === timelineClipsEl) {
      selectedClipId = null;
      selectedTextId = null;
      renderTimeline();
    }
  });
}

function renderTextTrack(total) {
  timelineTextTrackEl.innerHTML = '';
  textOverlays.forEach((ov) => {
    const el = document.createElement('div');
    el.className = 'timeline-text-block' + (ov.id === selectedTextId ? ' selected' : '');
    el.style.left = (total > 0 ? (ov.start / total) * 100 : 0) + '%';
    el.style.width = (total > 0 ? ((ov.end - ov.start) / total) * 100 : 10) + '%';
    el.innerHTML = `
      <span class="timeline-text-label">🔤 ${(ov.text || '').slice(0, 24)}</span>
      <div class="trim-handle trim-handle-left"></div>
      <div class="trim-handle trim-handle-right"></div>
    `;
    wireTextBlockDrag(el, ov);
    wireTextHandle(el.querySelector('.trim-handle-left'), ov, 'start');
    wireTextHandle(el.querySelector('.trim-handle-right'), ov, 'end');
    timelineTextTrackEl.appendChild(el);
  });
}

function renderCaptionLayer() {
  editorCaptionLayer.innerHTML = '';
  textOverlays.forEach((ov) => {
    const el = document.createElement('div');
    el.className = 'editor-caption' + (ov.box ? ' has-box' : '') + (ov.id === selectedTextId ? ' selected' : '');
    el.style.left = ov.xPct + '%';
    el.style.top = ov.yPct + '%';
    el.style.color = '#' + ov.color;
    el.textContent = ov.text;
    el.dataset.id = ov.id;
    el.hidden = true;
    wireCaptionDrag(el, ov);
    editorCaptionLayer.appendChild(el);
  });
}

// Arrastrar el texto directo sobre la vista previa para ubicarlo donde
// quieras (coordenadas libres, no solo arriba/centro/abajo). OJO: antes esto
// llamaba a selectText(), que dispara un renderTimeline() completo — eso
// hace innerHTML='' sobre editorCaptionLayer y recrea este mismo "el" en el
// momento exacto en que se lo esta por arrastrar, matando el drag antes de
// que arranque (por eso no se movia nunca). Ahora selecciona "en frio" con
// selectTextNoRender y recien renderiza todo al soltar.
function wireCaptionDrag(el, overlay) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectTextNoRender(overlay.id);
    try { el.setPointerCapture(e.pointerId); } catch {}
    const rect = editorPreviewWrap.getBoundingClientRect();
    const move = (ev) => {
      const xPct = Math.max(4, Math.min(96, ((ev.clientX - rect.left) / rect.width) * 100));
      const yPct = Math.max(4, Math.min(96, ((ev.clientY - rect.top) / rect.height) * 100));
      overlay.xPct = xPct;
      overlay.yPct = yPct;
      el.style.left = xPct + '%';
      el.style.top = yPct + '%';
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      renderTimeline();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

function updateCaptionVisibility(t) {
  editorCaptionLayer.querySelectorAll('.editor-caption').forEach((el) => {
    const ov = textOverlays.find((o) => o.id === el.dataset.id);
    el.hidden = !(ov && t >= ov.start && t < ov.end);
  });
}

function updatePlayheadPosition() {
  const total = totalDuration() || 1;
  const pct = Math.max(0, Math.min(1, playheadTime / total)) * 100;
  timelinePlayhead.style.left = pct + '%';
}

function updateTimeLabel() {
  editorTimeLabel.textContent = `${formatTimeShort(playheadTime)} / ${formatTimeShort(totalDuration())}`;
}

function updateInspectors() {
  const clip = clips.find((c) => c.id === selectedClipId);
  const text = textOverlays.find((t) => t.id === selectedTextId);
  clipInspector.classList.toggle('hidden', !clip);
  textInspector.classList.toggle('hidden', !text);
  splitBtn.disabled = !clip;
  clipUpBtn.disabled = !clip || clips.indexOf(clip) === 0;
  clipDownBtn.disabled = !clip || clips.indexOf(clip) === clips.length - 1;
  deleteSelectedBtn.disabled = !clip && !text;

  if (clip) {
    clipInspectorName.textContent = clip.file.name;
    if (document.activeElement !== clipStartInput) clipStartInput.value = clip.start.toFixed(1);
    if (document.activeElement !== clipEndInput) clipEndInput.value = clip.end.toFixed(1);
  }
  if (text) {
    if (document.activeElement !== textInspectorText) textInspectorText.value = text.text;
    textInspectorBox.checked = !!text.box;
    textInspectorColor.value = '#' + text.color;
    if (document.activeElement !== textStartInput) textStartInput.value = text.start.toFixed(1);
    if (document.activeElement !== textEndInput) textEndInput.value = text.end.toFixed(1);
  }
}

function renderTimeline() {
  const total = totalDuration();
  renderClipBlocks(total);
  renderTextTrack(total || 1);
  renderCaptionLayer();
  updateInspectors();
  updatePlayheadPosition();
  updateTimeLabel();
  updateCaptionVisibility(playheadTime);
}

// ---- Reproductor "secuencia" (varios clips como si ya estuvieran unidos) ----
function findClipRangeAtTime(t) {
  for (const r of clipRangesCache) {
    if (t >= r.globalStart && t < r.globalEnd) return r;
  }
  return clipRangesCache.length ? clipRangesCache[clipRangesCache.length - 1] : null;
}

function seekGlobal(t, opts) {
  const autoplay = opts && opts.autoplay;
  const total = totalDuration();
  t = Math.max(0, Math.min(total, t));
  playheadTime = t;
  updatePlayheadPosition();
  updateTimeLabel();
  updateCaptionVisibility(t);

  const range = findClipRangeAtTime(t);
  if (!range) return;
  const idx = clipRangesCache.indexOf(range);
  const localTime = range.clip.start + (t - range.globalStart);

  const applyTime = () => {
    editorPreviewVideo.currentTime = localTime;
    if (autoplay) editorPreviewVideo.play().catch(() => {});
  };

  if (idx !== activeClipIndex || editorPreviewVideo.src !== range.clip.objectUrl) {
    activeClipIndex = idx;
    editorPreviewVideo.src = range.clip.objectUrl;
    editorPreviewVideo.onloadedmetadata = applyTime;
    editorPreviewVideo.load();
  } else {
    applyTime();
  }
}

editorPreviewVideo.addEventListener('timeupdate', () => {
  if (activeClipIndex === -1 || !clipRangesCache[activeClipIndex]) return;
  const range = clipRangesCache[activeClipIndex];
  const globalT = range.globalStart + (editorPreviewVideo.currentTime - range.clip.start);
  playheadTime = globalT;
  updatePlayheadPosition();
  updateTimeLabel();
  updateCaptionVisibility(globalT);

  if (editorPreviewVideo.currentTime >= range.clip.end - 0.05) {
    if (activeClipIndex < clipRangesCache.length - 1) {
      const wasPlaying = !editorPreviewVideo.paused;
      seekGlobal(range.globalEnd, { autoplay: wasPlaying });
    } else {
      editorPreviewVideo.pause();
    }
  }
});
editorPreviewVideo.addEventListener('play', () => { editorPlayBtn.textContent = '⏸️'; });
editorPreviewVideo.addEventListener('pause', () => { editorPlayBtn.textContent = '▶️'; });

editorPlayBtn.addEventListener('click', () => {
  if (clips.length === 0) return;
  if (editorPreviewVideo.paused) {
    const total = totalDuration();
    if (playheadTime >= total - 0.05) seekGlobal(0);
    seekGlobal(playheadTime, { autoplay: true });
  } else {
    editorPreviewVideo.pause();
  }
});

// ---- Agregar clips ----
async function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('video/'));
  if (files.length === 0) return;
  const wasEmpty = clips.length === 0;

  for (const file of files) {
    const duration = await probeDuration(file);
    clips.push({ id: uid(), file, objectUrl: URL.createObjectURL(file), duration, start: 0, end: duration });
  }

  if (!editorTitleInput.value) {
    editorTitleInput.value = clips[0].file.name.replace(/\.[^/.]+$/, '') + ' - editado';
  }

  editorUploadPanel.classList.add('hidden');
  editorEditPanel.classList.remove('hidden');
  editorResultPanel.classList.add('hidden');
  editorErrorPanel.classList.add('hidden');

  if (wasEmpty) selectedClipId = clips[0].id;
  renderTimeline();
  if (wasEmpty) seekGlobal(0);
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

// ---- Barra de herramientas: dividir / mover / eliminar / agregar texto ----
splitBtn.addEventListener('click', () => {
  const idx = clips.findIndex((c) => c.id === selectedClipId);
  if (idx === -1) return;
  const range = clipRangesCache[idx];
  if (!range) return;
  const localSplit = range.clip.start + (playheadTime - range.globalStart);
  if (localSplit <= range.clip.start + 0.15 || localSplit >= range.clip.end - 0.15) {
    alert('Movete con la reglita a un punto DENTRO del clip seleccionado para poder dividirlo ahí.');
    return;
  }
  const original = clips[idx];
  const first = { ...original, id: uid(), end: localSplit };
  const second = { ...original, id: uid(), start: localSplit };
  clips.splice(idx, 1, first, second);
  selectedClipId = second.id;
  renderTimeline();
  seekGlobal(playheadTime);
});

clipUpBtn.addEventListener('click', () => {
  const idx = clips.findIndex((c) => c.id === selectedClipId);
  if (idx <= 0) return;
  [clips[idx - 1], clips[idx]] = [clips[idx], clips[idx - 1]];
  renderTimeline();
  seekGlobal(playheadTime);
});
clipDownBtn.addEventListener('click', () => {
  const idx = clips.findIndex((c) => c.id === selectedClipId);
  if (idx === -1 || idx >= clips.length - 1) return;
  [clips[idx + 1], clips[idx]] = [clips[idx], clips[idx + 1]];
  renderTimeline();
  seekGlobal(playheadTime);
});

deleteSelectedBtn.addEventListener('click', () => {
  if (selectedClipId) {
    clips = clips.filter((c) => c.id !== selectedClipId);
    selectedClipId = null;
    if (clips.length === 0) {
      resetEditor();
      return;
    }
    renderTimeline();
    seekGlobal(Math.min(playheadTime, totalDuration()));
  } else if (selectedTextId) {
    textOverlays = textOverlays.filter((t) => t.id !== selectedTextId);
    selectedTextId = null;
    renderTimeline();
  }
});

addTextBtn.addEventListener('click', () => {
  const total = totalDuration();
  if (total <= 0) return;
  const start = Math.max(0, Math.min(playheadTime, total - 0.5));
  const end = Math.min(total, start + 2);
  const overlay = { id: uid(), text: 'Tu texto acá', start, end, xPct: 50, yPct: 85, box: false, color: 'ffffff' };
  textOverlays.push(overlay);
  selectedTextId = overlay.id;
  selectedClipId = null;
  renderTimeline();
  textInspectorText.focus();
  textInspectorText.select();
});

// ---- Inspectores (edicion fina por numero) ----
clipStartInput.addEventListener('change', () => {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return;
  clip.start = Math.max(0, Math.min(clip.end - 0.2, parseFloat(clipStartInput.value) || 0));
  renderTimeline();
  seekGlobal(playheadTime);
});
clipEndInput.addEventListener('change', () => {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return;
  clip.end = Math.max(clip.start + 0.2, Math.min(clip.duration, parseFloat(clipEndInput.value) || clip.duration));
  renderTimeline();
  seekGlobal(playheadTime);
});

textInspectorText.addEventListener('input', () => {
  const text = textOverlays.find((t) => t.id === selectedTextId);
  if (!text) return;
  text.text = textInspectorText.value.slice(0, 200);
  renderTimeline();
});
textInspectorBox.addEventListener('change', () => {
  const text = textOverlays.find((t) => t.id === selectedTextId);
  if (!text) return;
  text.box = textInspectorBox.checked;
  renderTimeline();
});
textInspectorColor.addEventListener('input', () => {
  const text = textOverlays.find((t) => t.id === selectedTextId);
  if (!text) return;
  text.color = textInspectorColor.value.replace('#', '');
  renderTimeline();
});
textStartInput.addEventListener('change', () => {
  const text = textOverlays.find((t) => t.id === selectedTextId);
  if (!text) return;
  text.start = Math.max(0, Math.min(text.end - 0.2, parseFloat(textStartInput.value) || 0));
  renderTimeline();
});
textEndInput.addEventListener('change', () => {
  const text = textOverlays.find((t) => t.id === selectedTextId);
  if (!text) return;
  text.end = Math.max(text.start + 0.2, Math.min(totalDuration(), parseFloat(textEndInput.value) || text.end));
  renderTimeline();
});

// ---- Reset ----
function stopEditorTimers() {
  if (editorPollTimer) clearInterval(editorPollTimer);
  if (editorElapsedTimer) clearInterval(editorElapsedTimer);
  editorPollTimer = null;
  editorElapsedTimer = null;
}

function resetEditor() {
  stopEditorTimers();
  const seen = new Set();
  clips.forEach((c) => {
    if (!seen.has(c.objectUrl)) {
      seen.add(c.objectUrl);
      URL.revokeObjectURL(c.objectUrl);
    }
  });
  clips = [];
  textOverlays = [];
  selectedClipId = null;
  selectedTextId = null;
  activeClipIndex = -1;
  playheadTime = 0;
  editorJobId = null;
  editorFileInput.value = '';
  editorTitleInput.value = '';
  editorPreviewVideo.pause();
  editorPreviewVideo.removeAttribute('src');
  editorPreviewVideo.load();
  editorEditPanel.classList.add('hidden');
  editorUploadPanel.classList.remove('hidden');
  editorProgressWrap.classList.add('hidden');
  editorResultPanel.classList.add('hidden');
  editorErrorPanel.classList.add('hidden');
  editorProgressFill.classList.remove('indeterminate');
  editorExportBtn.disabled = false;
  editorExportBtn.textContent = '🎬 Exportar video';
  renderTimeline();
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

// ---- Exportar ----
editorExportBtn.addEventListener('click', async () => {
  if (clips.length === 0) return;
  for (const clip of clips) {
    if (clip.end <= clip.start) {
      showEditorError('Uno de los clips tiene un recorte inválido.');
      return;
    }
  }

  if (window.requestNotifyPermission) window.requestNotifyPermission();
  editorPreviewVideo.pause();
  editorExportBtn.disabled = true;
  editorExportBtn.textContent = 'Subiendo...';
  editorErrorPanel.classList.add('hidden');
  editorResultPanel.classList.add('hidden');
  document.getElementById('editorFeedbackCard').classList.add('hidden');
  editorProgressWrap.classList.remove('hidden');
  editorProgressFill.classList.add('indeterminate');
  editorProgressText.textContent = 'Subiendo clips...';
  delete editorProgressText.dataset.rotating;
  startEditorElapsedTimer();

  const formData = new FormData();
  clips.forEach((clip) => formData.append('clips', clip.file));
  formData.append('clipsMeta', JSON.stringify(clips.map((c) => ({ start: c.start, end: c.end }))));
  formData.append('metaPreset', editorPresetSel.value);
  formData.append('quality', editorQualitySel.value);
  formData.append('title', editorTitleInput.value.trim());
  formData.append(
    'textOverlays',
    JSON.stringify(
      textOverlays.map((o) => ({ text: o.text, start: o.start, end: o.end, xPct: o.xPct, yPct: o.yPct, box: o.box, color: o.color }))
    )
  );

  try {
    const res = await fetch('/api/edit', { method: 'POST', body: formData });
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    if (res.status === 429) {
      editorProgressWrap.classList.add('hidden');
      editorProgressFill.classList.remove('indeterminate');
      editorExportBtn.disabled = false;
      editorExportBtn.textContent = '🎬 Exportar video';
      if (window.showLimitModal) window.showLimitModal(data);
      return;
    }
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
        if (window.startPhraseRotation && !editorProgressText.dataset.rotating) {
          editorProgressText.dataset.rotating = '1';
          window.startPhraseRotation(editorProgressText);
        }
      } else if (data.status === 'processing') {
        editorProgressFill.classList.remove('indeterminate');
        editorProgressFill.style.width = data.progress + '%';
        if (!editorProgressText.dataset.rotating) {
          editorProgressText.dataset.rotating = '1';
          if (window.startPhraseRotation) window.startPhraseRotation(editorProgressText);
        }
      } else if (data.status === 'done') {
        stopEditorTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete editorProgressText.dataset.rotating;
        editorProgressFill.classList.remove('indeterminate');
        editorProgressFill.style.width = '100%';
        editorDownloadLink.href = `/api/download/${jobId}`;
        editorResultMeta.textContent = data.outputSize ? `Tamaño final: ${formatBytesEditor(data.outputSize)}` : '';
        editorResultPanel.classList.remove('hidden');
        editorProgressWrap.classList.add('hidden');
        editorExportBtn.disabled = false;
        editorExportBtn.textContent = '🎬 Exportar video';
        if (window.fireConfetti) window.fireConfetti();
        if (window.notifyVideoReady) window.notifyVideoReady('Tu video del Mini Editor ya está listo para descargar.');
        if (window.initFeedbackCard) window.initFeedbackCard(document.getElementById('editorFeedbackCard'), jobId, 'editor');
        if (window.showAchievementModal) window.showAchievementModal(data.newAchievements, data.newReward);
        if (window.showRecordToasts) window.showRecordToasts(data.newRecords);
        if (window.showPersonalizationToasts) window.showPersonalizationToasts(data.newPersonalizations);
        if (window.renderQuickActions) {
          window.renderQuickActions(document.getElementById('editorQuickActions'), {
            currentTool: 'editor',
            downloadUrl: `/api/download/${jobId}`,
            title: 'video-editado.mp4',
            mimeType: 'video/mp4',
          });
        }
      } else if (data.status === 'cancelled') {
        stopEditorTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete editorProgressText.dataset.rotating;
        showEditorError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopEditorTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete editorProgressText.dataset.rotating;
        showEditorError(data.error || 'Ocurrió un error al exportar el video.');
      }
    } catch (err) {
      stopEditorTimers();
      showEditorError('Se perdió la conexión con el servidor.');
    }
  }, 800);
}

renderTimeline();
