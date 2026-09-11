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
const avatarImg = document.getElementById('avatarImg');
const avatarFallback = document.getElementById('avatarFallback');
const avatarInput = document.getElementById('avatarInput');
const quotaPill = document.getElementById('quotaPill');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsEmail = document.getElementById('settingsEmail');
const planSummary = document.getElementById('planSummary');
const planUsageBarWrap = document.getElementById('planUsageBarWrap');
const planUsageBar = document.getElementById('planUsageBar');
const planUsageText = document.getElementById('planUsageText');
const manageSubBtn = document.getElementById('manageSubBtn');
const manageSubNote = document.getElementById('manageSubNote');
const couponBox = document.getElementById('couponBox');
const couponInput = document.getElementById('couponInput');
const couponApplyBtn = document.getElementById('couponApplyBtn');
const couponError = document.getElementById('couponError');
const celebrationOverlay = document.getElementById('celebrationOverlay');
const celebrationCloseBtn = document.getElementById('celebrationCloseBtn');
const celebrationMessage = document.getElementById('celebrationMessage');
const adminLink = document.getElementById('adminLink');
const referralCodeDisplay = document.getElementById('referralCodeDisplay');
const referralCopyBtn = document.getElementById('referralCopyBtn');
const referralCount = document.getElementById('referralCount');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const clockPill = document.getElementById('clockPill');
const streakPill = document.getElementById('streakPill');
const badgesGrid = document.getElementById('badgesGrid');
const badgesSummary = document.getElementById('badgesSummary');
const impersonationBanner = document.getElementById('impersonationBanner');
const impersonationEmail = document.getElementById('impersonationEmail');
const stopImpersonateBtn = document.getElementById('stopImpersonateBtn');

let currentEmail = '';
let planCatalog = {}; // { free: {...}, intermedio: {...}, pro: {...} } — via /api/plans

function setAvatar(url) {
  if (url) {
    avatarImg.src = url;
    avatarImg.hidden = false;
    avatarFallback.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
  }
}

function fmtPlanPrice(usd) {
  if (!usd) return 'Gratis';
  return `$${usd.toFixed(2).replace(/\.00$/, '')} USD/mes`;
}

function renderQuota(quota) {
  if (!quota) {
    quotaPill.textContent = '';
    quotaPill.className = 'quota-pill hidden';
    if (planSummary) planSummary.textContent = '';
    return;
  }
  const planInfo = planCatalog[quota.plan];
  const priceLabel = planInfo ? fmtPlanPrice(planInfo.priceUsd) : '';
  const isPaid = quota.plan && quota.plan !== 'free';

  if (quota.unlimited) {
    quotaPill.textContent = '✨ Ilimitado';
    quotaPill.className = 'quota-pill unlimited';
    if (planSummary) {
      // Si el plan formal ya es pago (Pro) se muestra ese; si el ilimitado
      // viene solo de un cupón (plan sigue siendo Gratis), se aclara aparte
      // para no confundirlo con haber pagado el plan Pro.
      const base = isPaid ? `Plan ${quota.planName}${priceLabel ? ' — ' + priceLabel : ''}` : '✨ Cupón activo';
      planSummary.textContent = base + (quota.until ? ` (ilimitado hasta ${new Date(quota.until).toLocaleDateString('es-AR')})` : ' — carga ilimitada');
    }
    if (planUsageBarWrap) planUsageBarWrap.classList.add('hidden');
    if (planUsageText) planUsageText.textContent = 'Videos ilimitados. Sin límite diario.';
  } else {
    quotaPill.textContent = `${quota.remaining}/${quota.limit} hoy`;
    quotaPill.className = 'quota-pill' + (quota.remaining === 0 ? ' low' : '');
    if (planSummary) planSummary.textContent = `Plan ${quota.planName || 'Gratis'} — ${priceLabel}`;
    if (planUsageBarWrap) {
      planUsageBarWrap.classList.remove('hidden');
      const pct = Math.min(100, Math.round((quota.used / quota.limit) * 100));
      planUsageBar.style.width = pct + '%';
      planUsageBar.classList.toggle('low', quota.used >= quota.limit);
    }
    if (planUsageText) {
      planUsageText.textContent =
        `${quota.used} de ${quota.limit} videos usados hoy` +
        (quota.bonus > 0 ? ` (+${quota.bonus} extra)` : '') +
        ' · se reinicia a medianoche (hora Argentina)';
    }
  }
  if (manageSubBtn) manageSubBtn.classList.toggle('hidden', !isPaid);
}

if (manageSubBtn) {
  manageSubBtn.addEventListener('click', () => {
    if (manageSubNote) manageSubNote.classList.toggle('hidden');
  });
}

function renderStreak(streak) {
  if (!streakPill) return;
  if (streak && streak > 0) {
    streakPill.textContent = `🔥 ${streak}`;
    streakPill.title = `Racha de ${streak} día(s) seguido(s) usando la app`;
    streakPill.classList.remove('hidden');
  } else {
    streakPill.classList.add('hidden');
  }
}

function renderBadges(badges) {
  if (!badgesGrid) return;
  const list = badges || [];
  const unlockedCount = list.filter((b) => b.unlocked).length;
  if (badgesSummary) badgesSummary.textContent = `Desbloqueaste ${unlockedCount} de ${list.length}.`;
  badgesGrid.innerHTML = list
    .map(
      (b) => `
      <div class="badge${b.unlocked ? ' unlocked' : ''}" title="${b.label}${b.unlocked ? '' : ' (todavía no)'}">
        <span class="badge-icon">${b.icon}</span>
        <span class="badge-label">${b.label}</span>
      </div>`
    )
    .join('');
}

// ---- Reloj con la hora local ----
// Usa la zona horaria del propio navegador (Intl), no hace falta geolocalizar
// por IP: el sistema operativo ya sabe en que huso horario/pais esta el
// dispositivo, y es mas confiable que una IP (que puede estar detras de VPN,
// proxy, etc.).
if (clockPill) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const place = tz.includes('/') ? tz.split('/').pop().replace(/_/g, ' ') : tz;
  clockPill.title = place ? `Hora local — ${place}` : 'Hora local';
  const updateClock = () => {
    const now = new Date();
    clockPill.textContent = `🕐 ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  updateClock();
  setInterval(updateClock, 15000);
}

(async function initSession() {
  try {
    const [res, plansRes] = await Promise.all([fetch('/api/me'), fetch('/api/plans')]);
    if (res.status === 401) return window.location.href = '/login';
    const data = await res.json();
    try {
      const plansData = await plansRes.json();
      (plansData.plans || []).forEach((p) => { planCatalog[p.key] = p; });
    } catch (err) {
      // si falla, renderQuota simplemente no muestra el precio del plan
    }
    currentEmail = data.email;
    sessionUser.textContent = `👤 ${data.email}`;
    settingsEmail.textContent = data.email;
    setAvatar(data.avatarUrl);
    renderQuota(data.quota);
    renderStreak(data.streak);
    renderBadges(data.badges);
    if (referralCodeDisplay) referralCodeDisplay.value = data.referralCode || '';
    if (referralCount) referralCount.textContent = `Ya invitaste a ${data.referrals || 0} persona(s).`;
    if (data.isAdmin && adminLink) adminLink.classList.remove('hidden');
    if (data.impersonating && impersonationBanner) {
      impersonationEmail.textContent = data.email;
      impersonationBanner.classList.remove('hidden');
    }
  } catch (err) {
    // si falla la consulta, no bloqueamos el uso de la pagina
  }
})();

if (stopImpersonateBtn) {
  stopImpersonateBtn.addEventListener('click', async () => {
    stopImpersonateBtn.disabled = true;
    try {
      const res = await fetch('/api/admin/stop-impersonate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo volver a admin.');
      window.location.href = '/admin';
    } catch (err) {
      alert('❌ ' + err.message);
      stopImpersonateBtn.disabled = false;
    }
  });
}

if (referralCopyBtn) {
  referralCopyBtn.addEventListener('click', async () => {
    const link = `${window.location.origin}/login?ref=${referralCodeDisplay.value}`;
    try {
      await navigator.clipboard.writeText(link);
      referralCopyBtn.textContent = '¡Copiado!';
    } catch (err) {
      referralCodeDisplay.select();
      referralCopyBtn.textContent = 'Seleccionado';
    }
    setTimeout(() => (referralCopyBtn.textContent = 'Copiar'), 1500);
  });
}

const supportCopyBtn = document.getElementById('supportCopyBtn');
if (supportCopyBtn) {
  supportCopyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('matetesee@gmail.com');
      supportCopyBtn.textContent = '¡Copiado!';
    } catch (err) {
      supportCopyBtn.textContent = 'matetesee@gmail.com';
    }
    setTimeout(() => (supportCopyBtn.textContent = 'Copiar'), 1500);
  });
}

settingsBtn.addEventListener('click', () => {
  couponError.classList.add('hidden');
  couponInput.value = '';
  settingsOverlay.classList.remove('hidden');
});
settingsCloseBtn.addEventListener('click', () => settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});

couponApplyBtn.addEventListener('click', async () => {
  const code = couponInput.value.trim();
  if (!code) return;
  couponApplyBtn.disabled = true;
  couponApplyBtn.textContent = 'Aplicando...';
  couponError.classList.add('hidden');
  try {
    const res = await fetch('/api/coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cupón inválido.');
    renderQuota(data.quota);
    settingsOverlay.classList.add('hidden');
    showCelebration(data.message);
  } catch (err) {
    couponError.textContent = '❌ ' + err.message;
    couponError.classList.remove('hidden');
  } finally {
    couponApplyBtn.disabled = false;
    couponApplyBtn.textContent = 'Aplicar';
  }
});

function showCelebration(message) {
  celebrationMessage.textContent = message || 'Activaste una mejora en tu cuenta.';
  celebrationOverlay.classList.remove('hidden');
  if (window.fireConfetti) {
    window.fireConfetti();
    setTimeout(() => window.fireConfetti(), 350);
    setTimeout(() => window.fireConfetti(), 700);
  }
}
celebrationCloseBtn.addEventListener('click', () => celebrationOverlay.classList.add('hidden'));

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  try {
    const res = await fetch('/api/me/avatar', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la foto.');
    setAvatar(data.avatarUrl);
  } catch (err) {
    alert('❌ ' + err.message);
  } finally {
    avatarInput.value = '';
  }
});

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
  if (window.requestNotifyPermission) window.requestNotifyPermission();
  processBtn.disabled = true;
  processBtn.textContent = 'Subiendo...';
  errorPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressFill.classList.add('indeterminate');
  progressText.textContent = 'Subiendo video...';
  delete progressText.dataset.rotating;
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
    if (res.status === 429) {
      progressWrap.classList.add('hidden');
      progressFill.classList.remove('indeterminate');
      processBtn.disabled = false;
      processBtn.textContent = '⚙️ Procesar video';
      if (window.showLimitModal) window.showLimitModal(data);
      return;
    }
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
        if (window.startPhraseRotation && !progressText.dataset.rotating) {
          progressText.dataset.rotating = '1';
          window.startPhraseRotation(progressText);
        }
      } else if (data.status === 'processing') {
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = data.progress + '%';
        if (!progressText.dataset.rotating) {
          progressText.dataset.rotating = '1';
          if (window.startPhraseRotation) window.startPhraseRotation(progressText);
        }
      } else if (data.status === 'done') {
        stopTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete progressText.dataset.rotating;
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
        if (window.fireConfetti) window.fireConfetti();
        if (window.notifyVideoReady) window.notifyVideoReady('Tu video optimizado ya está listo para descargar.');
      } else if (data.status === 'cancelled') {
        stopTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete progressText.dataset.rotating;
        showError(data.error || 'Proceso cancelado.');
      } else if (data.status === 'error') {
        stopTimers();
        if (window.stopPhraseRotation) window.stopPhraseRotation();
        delete progressText.dataset.rotating;
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

// ---- Navegación entre secciones (Optimizador / Mini Editor / Historial) ----
document.querySelectorAll('.section-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.section-tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('#optimizerSection, #editorSection, #audioSection, #historySection, #updatesSection, #supportSection').forEach((section) => {
      section.classList.toggle('hidden', section.id !== tab.dataset.section);
    });
    if (tab.dataset.section === 'historySection' && window.loadHistory) window.loadHistory();
    if (tab.dataset.section === 'updatesSection' && window.renderUpdates) window.renderUpdates();
  });
});

// ---- Chiche: un puñado de emojis cayendo cuando algo termina bien ----
window.fireConfetti = function fireConfetti() {
  const emojis = ['🎉', '✨', '🎬', '🔥', '👏', '🚀'];
  for (let i = 0; i < 18; i++) {
    const el = document.createElement('div');
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.cssText = `
      position: fixed; top: -30px; left: ${Math.random() * 100}vw;
      font-size: ${16 + Math.random() * 16}px; z-index: 9999; pointer-events: none;
      animation: confetti-fall ${1.6 + Math.random() * 1.2}s ease-in forwards;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
};

// ---- Historial de videos ----
function formatHistoryDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

window.loadHistory = async function loadHistory() {
  historyList.innerHTML = '<p class="empty-hint">Cargando...</p>';
  historyEmpty.classList.add('hidden');
  try {
    const res = await fetch('/api/history');
    if (res.status === 401) return (window.location.href = '/login');
    const items = await res.json();
    historyList.innerHTML = '';
    if (!items.length) {
      historyEmpty.classList.remove('hidden');
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'history-row' + (item.available ? '' : ' expired');
      const sourceLabel = item.source === 'editor' ? 'Mini Editor' : 'Optimizador';
      row.innerHTML = `
        <div class="history-info">
          <div class="history-title">${item.title}</div>
          <div class="history-meta">${sourceLabel} · ${formatBytes(item.output_size)} · ${formatHistoryDate(item.created_at)}</div>
        </div>
        <button type="button" class="btn-primary" data-id="${item.id}">⬇️ Descargar</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        window.location.href = `/api/history/${item.id}/download`;
      });
      historyList.appendChild(row);
    });
  } catch (err) {
    historyList.innerHTML = '';
    historyEmpty.textContent = 'No se pudo cargar el historial.';
    historyEmpty.classList.remove('hidden');
  }
};
