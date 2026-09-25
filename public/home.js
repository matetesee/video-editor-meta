// Pantalla "Inicio": dashboard que REUSA datos y funciones que ya existen en
// el resto de la app (progress.js, updates.js, script.js) en vez de duplicar
// nada — ver los comentarios de cada bloque para saber de donde viene cada
// pieza. Lo unico nuevo de verdad acá es: saludo, buscador, menu "+Nuevo",
// Quick Drop y Modo Foco.

const HOME_TOOL_ICONS = {
  optimizer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  editor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  gif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 9v6M11 9v6M11 12h2M17 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v-3"/></svg>',
  speed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>',
};
const HOME_TOOL_BADGE_CLASS = { optimizer: 'icon-badge-blue', editor: 'icon-badge-violet', audio: 'icon-badge-orange', gif: 'icon-badge-orange', speed: 'icon-badge-green' };

// ---- Greeting: reusa /api/me (le agregamos "displayName" al endpoint, que
// ya existia en la base para cuentas de Google pero nunca se exponia). Si no
// hay nombre guardado, se arma uno a partir del email — no se inventa nada.
async function renderHomeGreeting() {
  try {
    const res = await fetch('/api/me');
    const me = await res.json();
    const name = me.displayName || (me.email ? me.email.split('@')[0].replace(/[._-]+/g, ' ') : '');
    const pretty = name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
    document.getElementById('homeGreeting').textContent = pretty ? `Hola, ${pretty} 👋` : 'Hola 👋';
  } catch (err) {
    // se queda con el saludo generico del HTML
  }
}

// ---- Stats: totalVideos y bytesSaved salen de /api/progress (mismos datos
// que usa Mi Progreso). "GIFs creados" y "Exportaciones recientes" se
// calculan contando el /api/history ya existente — no son un contador nuevo
// en la base, por eso reflejan solo lo que dura el historial (24hs).
function renderHomeStats(progressData, historyItems) {
  const grid = document.getElementById('homeStatsGrid');
  const gifCount = historyItems.filter((h) => h.source === 'gif').length;
  const items = [
    { icon: '🎬', label: 'Videos procesados', value: progressData.stats.totalVideos },
    { icon: '💾', label: 'Espacio ahorrado', value: formatBytesProgress(progressData.stats.bytesSaved) },
    { icon: '📤', label: 'Exportaciones (24hs)', value: historyItems.length },
    { icon: '🖼️', label: 'GIFs creados (24hs)', value: gifCount },
  ];
  grid.innerHTML = items
    .map((it) => `<div class="progress-stat-card"><div class="progress-stat-icon">${it.icon}</div><div class="progress-stat-value">${it.value}</div><div class="progress-stat-label">${it.label}</div></div>`)
    .join('');
}

// ---- Continuar trabajando: los ultimos 2-3 items de /api/history. No hay
// thumbnails guardados en la base (ver video_history), asi que se usa el
// icono de la herramienta en vez de inventar una imagen que no existe.
function renderHomeRecentWork(historyItems) {
  const el = document.getElementById('homeRecentWork');
  const recent = historyItems.slice(0, 3);
  if (!recent.length) {
    el.innerHTML = `<p class="empty-hint">Todavía no procesaste ningún video. ¡Arrancá con alguna herramienta de abajo!</p>`;
    return;
  }
  el.innerHTML = `<div class="home-recent-grid">${recent
    .map(
      (item) => `
      <div class="home-recent-card">
        <span class="icon-badge ${HOME_TOOL_BADGE_CLASS[item.source] || 'icon-badge-blue'} home-recent-icon">${HOME_TOOL_ICONS[item.source] || HOME_TOOL_ICONS.optimizer}</span>
        <div class="home-recent-body">
          <div class="home-recent-title">${item.title}</div>
          <div class="home-recent-meta">${HISTORY_SOURCE_LABELS[item.source] || 'Optimizador'} · ${formatHistoryDate(item.created_at)}</div>
        </div>
        ${item.available ? `<button type="button" class="btn-secondary" data-download="${item.id}">Abrir</button>` : ''}
      </div>`
    )
    .join('')}</div>`;
  el.querySelectorAll('[data-download]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.href = `/api/history/${btn.dataset.download}/download`;
    });
  });
}

// ---- Favoritos y Actividad reciente: llaman DIRECTO a las funciones de
// progress.js (cardBodyFavorites / cardBodyRecentActivity) — mismo sistema
// de estrellas, cero duplicacion.
async function renderHomeFavoritesAndActivity(historyItems) {
  const favBody = document.getElementById('homeFavoritesBody');
  try {
    const favData = await (await fetch('/api/favorites')).json();
    favBody.innerHTML = window.cardBodyFavorites ? cardBodyFavorites(favData) : '';
    favBody.querySelectorAll('.favorite-tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => goToSection(btn.dataset.section));
    });
  } catch (err) {
    favBody.innerHTML = `<p class="empty-hint">No se pudo cargar.</p>`;
  }

  const activityBody = document.getElementById('homeActivityBody');
  activityBody.innerHTML = window.cardBodyRecentActivity ? cardBodyRecentActivity(historyItems) : '';
}

// Para que el ⭐ del sidebar tambien actualice esta seccion sin recargar.
window.renderHomeFavorites = function renderHomeFavorites() {
  const favBody = document.getElementById('homeFavoritesBody');
  if (!favBody || document.getElementById('homeSection').classList.contains('hidden')) return;
  fetch('/api/favorites')
    .then((r) => r.json())
    .then((favData) => {
      favBody.innerHTML = window.cardBodyFavorites ? cardBodyFavorites(favData) : '';
      favBody.querySelectorAll('.favorite-tool-btn').forEach((btn) => {
        btn.addEventListener('click', () => goToSection(btn.dataset.section));
      });
    })
    .catch(() => {});
};

// ---- Novedades: la MISMA fuente que la pestaña Actualizaciones (UPDATES[]
// de updates.js), no un texto aparte que haya que mantener sincronizado a mano.
function renderHomeNews() {
  const el = document.getElementById('homeNewsBody');
  if (typeof UPDATES === 'undefined' || !UPDATES.length) {
    el.innerHTML = `<p class="empty-hint">Sin novedades por ahora.</p>`;
    return;
  }
  const latest = UPDATES[0];
  const badge = UPDATE_TYPE_LABELS[latest.type] || UPDATE_TYPE_LABELS.improvement;
  el.innerHTML = `
    <div class="update-card-head" style="margin-bottom:8px;">
      <span class="update-badge ${badge.className}">${badge.label}</span>
    </div>
    <p style="margin:0 0 4px;font-weight:700;">${latest.title}</p>
    <p class="meta-hint" style="margin:0 0 10px;">${latest.description}</p>
    <button type="button" class="btn-secondary" id="homeSeeUpdatesBtn">Ver todas las novedades</button>
  `;
  document.getElementById('homeSeeUpdatesBtn').addEventListener('click', () => goToSection('updatesSection'));
}

// ---- Buscador de herramientas: filtra las cards que ya existen en la
// grilla (no se toca la grilla en si, solo se muestran/ocultan sus items).
function wireHomeSearch() {
  const input = document.getElementById('homeToolSearch');
  const grid = document.getElementById('homeGrid');
  const emptyMsg = document.getElementById('homeSearchEmpty');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let visibleCount = 0;
    grid.querySelectorAll('.home-card').forEach((card) => {
      const match = card.textContent.toLowerCase().includes(q);
      card.classList.toggle('hidden', !match);
      if (match) visibleCount++;
    });
    emptyMsg.classList.toggle('hidden', visibleCount > 0);
  });
}

// ---- "+ Nuevo": menu chico con accesos directos a las herramientas de subida.
function wireHomeNewMenu() {
  const btn = document.getElementById('homeNewBtn');
  const menu = document.getElementById('homeNewMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  menu.querySelectorAll('[data-go]').forEach((item) => {
    item.addEventListener('click', () => {
      menu.classList.add('hidden');
      goToSection(item.dataset.go);
    });
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) menu.classList.add('hidden');
  });
}

// ---- Modo Foco: oculta sidebar + header, mismo boton para entrar y salir.
function wireFocusMode() {
  const btn = document.getElementById('focusModeBtn');
  btn.addEventListener('click', () => {
    document.body.classList.toggle('focus-mode');
  });
}

// ---- Quick Drop: arrastrar un video sobre Inicio abre un selector chico de
// "a donde lo mando", y reusa la funcion load*File() que cada herramienta YA
// tiene (loadFile / loadGifFile / loadSpeedFile / loadAudioFile) — no se
// reimplementa la subida.
const QUICK_DROP_TARGETS = [
  { section: 'optimizerSection', label: '🎯 Optimizador Meta', loader: () => window.loadFile },
  { section: 'gifSection', label: '🖼️ GIF Maker', loader: () => window.loadGifFile },
  { section: 'speedSection', label: '⚡ Velocidad', loader: () => window.loadSpeedFile },
  { section: 'audioSection', label: '🎧 Extraer Audio', loader: () => window.loadAudioFile },
];

function wireQuickDrop() {
  const home = document.getElementById('homeSection');
  let overlay = null;
  let dragDepth = 0;

  function showOverlay(file) {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'quick-drop-overlay';
    overlay.innerHTML = `
      <div class="quick-drop-picker">
        <h3>¿A dónde mandamos "${file.name}"?</h3>
        <div class="quick-drop-picker-grid">
          ${QUICK_DROP_TARGETS.map((t, i) => `<button type="button" data-i="${i}">${t.label}</button>`).join('')}
        </div>
        <button type="button" class="btn-secondary" id="quickDropCancel" style="margin-top:14px;width:100%;">Cancelar</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = QUICK_DROP_TARGETS[parseInt(btn.dataset.i, 10)];
        goToSection(target.section);
        const loadFn = target.loader();
        if (loadFn) loadFn(file);
        hideOverlay();
      });
    });
    document.getElementById('quickDropCancel').addEventListener('click', hideOverlay);
  }

  function hideOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
    dragDepth = 0;
  }

  home.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
  });
  home.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  });
  home.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
  });
  home.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files || !e.dataTransfer.files[0]) return;
    e.preventDefault();
    dragDepth = 0;
    const file = e.dataTransfer.files[0];
    if (!file.type.startsWith('video/')) return;
    showOverlay(file);
  });
}

let homeWired = false;
window.renderHome = async function renderHome() {
  renderHomeGreeting();
  if (!homeWired) {
    wireHomeSearch();
    wireHomeNewMenu();
    wireFocusMode();
    wireQuickDrop();
    homeWired = true;
  }
  try {
    const [progressRes, historyRes] = await Promise.all([fetch('/api/progress'), fetch('/api/history')]);
    if (progressRes.status === 401) return (window.location.href = '/login');
    const progressData = await progressRes.json();
    const historyItems = await historyRes.json();
    renderHomeStats(progressData, historyItems);
    renderHomeRecentWork(historyItems);
    renderHomeFavoritesAndActivity(historyItems);
    renderHomeNews();
  } catch (err) {
    // si falla, las secciones se quedan con "Cargando..." — no bloquea el resto
  }
};
