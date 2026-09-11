// Pagina "Mi Progreso": dashboard con cards reordenables (drag & drop en
// desktop, ↑/↓ en mobile), logros, recompensas y records. Todos los NUMEROS
// salen del backend (/api/progress, /api/records, /api/favorites,
// /api/history) — esta pagina solo los pinta y guarda el ORDEN elegido
// (que es la unica preferencia puramente visual de esta pantalla).

const CARD_TITLES = {
  level: '📈 Tu progreso',
  quota: '📅 Uso diario',
  nextAchievement: '🏆 Próximo logro',
  stats: '📊 Estadísticas',
  favorites: '⭐ Herramientas favoritas',
  recentActivity: '🕘 Actividad reciente',
  streak: '🔥 Racha',
  records: '🥇 Récords personales',
};

let progressData = null;
let recordsData = null;

function formatBytesProgress(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatRecordDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ---- Contenido de cada card ----
function cardBodyLevel(data) {
  const level = data.level;
  return `
    <div class="progress-level-head">
      <span class="progress-level-badge">Nivel ${level.level}</span>
      <span class="progress-level-pct">${level.maxLevel ? '¡Máximo!' : level.progressPct + '%'}</span>
    </div>
    <div class="level-bar-wrap"><div class="level-bar" style="width:${level.progressPct}%"></div></div>
    <p class="meta-hint" style="margin:8px 0 0;">${level.maxLevel ? 'Llegaste al nivel máximo. ¡Gracias por tu uso constante!' : `${level.videosToNext} video(s) para el próximo nivel`}</p>
  `;
}

function cardBodyQuota(quota) {
  if (!quota) return `<p class="meta-hint" style="margin:0;">No se pudo cargar.</p>`;
  if (quota.unlimited) {
    return `<p class="meta-hint" style="margin:0;">✨ Videos ilimitados hoy.</p>`;
  }
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  return `
    <p class="meta-hint" style="margin:0 0 6px;">${quota.used} de ${quota.limit} videos usados hoy${quota.bonus > 0 ? ` (+${quota.bonus} extra)` : ''}</p>
    <div class="reward-bar-wrap"><div class="reward-bar" style="width:${pct}%"></div></div>
    <p class="meta-hint" style="margin:6px 0 0;font-size:0.72rem;">Se reinicia a medianoche (hora Argentina)</p>
  `;
}

function cardBodyNextAchievement(achievements) {
  const next = (achievements || []).find((a) => !a.unlocked);
  if (!next) return `<p class="meta-hint" style="margin:0;">🎉 ¡Desbloqueaste todos los logros disponibles!</p>`;
  return `
    <div class="next-achievement-row">
      <span class="next-achievement-icon">🔒</span>
      <div>
        <p class="next-achievement-name">${next.name}</p>
        <p class="meta-hint" style="margin:2px 0 0;">${next.desc}</p>
      </div>
    </div>
  `;
}

function cardBodyStats(stats) {
  const items = [
    { icon: '🎬', label: 'Videos procesados', value: stats.totalVideos },
    { icon: '📅', label: 'Días activos', value: stats.activeDays },
    { icon: '🏆', label: 'Logros', value: `${stats.achievementsUnlocked}/${stats.achievementsTotal}` },
    { icon: '💾', label: 'Espacio ahorrado', value: formatBytesProgress(stats.bytesSaved) },
  ];
  return `<div class="progress-stats-grid progress-stats-grid-compact">${items
    .map((it) => `<div class="progress-stat-card"><div class="progress-stat-icon">${it.icon}</div><div class="progress-stat-value">${it.value}</div><div class="progress-stat-label">${it.label}</div></div>`)
    .join('')}</div>`;
}

function cardBodyFavorites(favData) {
  const favTools = (favData.tools || []).filter((t) => (favData.favorites || []).includes(t.key));
  if (favTools.length === 0) {
    return `<p class="meta-hint" style="margin:0;">Marcá tus herramientas favoritas con ★ en el menú para tenerlas siempre a mano.</p>`;
  }
  return `
    <div class="favorite-tools-list">
      ${favTools
        .map(
          (t) => `<button type="button" class="favorite-tool-btn" data-section="${t.section}">${t.icon} ${t.name}</button>`
        )
        .join('')}
    </div>
  `;
}

function cardBodyRecentActivity(historyItems) {
  if (!historyItems || historyItems.length === 0) {
    return `<p class="meta-hint" style="margin:0;">Todavía no procesaste ningún video.</p>`;
  }
  const SOURCE_LABELS = { optimizer: 'Optimizador', editor: 'Mini Editor', audio: 'Extraer Audio' };
  return `
    <div class="recent-activity-list">
      ${historyItems
        .slice(0, 4)
        .map(
          (item) => `
        <div class="recent-activity-row">
          <span class="recent-activity-title">${item.title}</span>
          <span class="recent-activity-meta">${SOURCE_LABELS[item.source] || item.source}</span>
        </div>`
        )
        .join('')}
    </div>
  `;
}

function cardBodyStreak(stats) {
  return `
    <div class="streak-card-body">
      <div class="streak-number">🔥 ${stats.streak}</div>
      <p class="meta-hint" style="margin:4px 0 0;">día(s) seguidos</p>
      <p class="meta-hint" style="margin:8px 0 0;">Récord: ${stats.longestStreak} día(s)</p>
    </div>
  `;
}

function cardBodyRecords(records) {
  if (!records) return `<p class="meta-hint" style="margin:0;">No se pudo cargar.</p>`;
  const items = [
    { icon: '🎬', label: 'Mejor día', value: `${records.bestDay.count} video(s)` },
    { icon: '🔥', label: 'Mejor racha', value: `${records.longestStreak} día(s)` },
    { icon: '📦', label: 'Mejor compresión', value: records.bestCompression.pct > 0 ? `${records.bestCompression.pct}% menos` : '—' },
  ];
  return `
    <div class="progress-stats-grid progress-stats-grid-compact">
      ${items.map((it) => `<div class="progress-stat-card"><div class="progress-stat-icon">${it.icon}</div><div class="progress-stat-value">${it.value}</div><div class="progress-stat-label">${it.label}</div></div>`).join('')}
    </div>
    <button type="button" class="btn-secondary" id="viewAllRecordsBtn" style="width:100%;margin-top:10px;">Ver todos</button>
  `;
}

function cardBody(key) {
  if (!progressData) return '';
  switch (key) {
    case 'level':
      return cardBodyLevel(progressData);
    case 'quota':
      return progressData.__quota ? cardBodyQuota(progressData.__quota) : '<p class="meta-hint" style="margin:0;">Cargando…</p>';
    case 'nextAchievement':
      return cardBodyNextAchievement(progressData.achievements);
    case 'stats':
      return cardBodyStats(progressData.stats);
    case 'favorites':
      return progressData.__favorites ? cardBodyFavorites(progressData.__favorites) : '<p class="meta-hint" style="margin:0;">Cargando…</p>';
    case 'recentActivity':
      return progressData.__history ? cardBodyRecentActivity(progressData.__history) : '<p class="meta-hint" style="margin:0;">Cargando…</p>';
    case 'streak':
      return cardBodyStreak(progressData.stats);
    case 'records':
      return cardBodyRecords(recordsData);
    default:
      return '';
  }
}

function cardWrapperHtml(key) {
  return `
    <div class="dashboard-card" draggable="true" data-card-key="${key}">
      <div class="dashboard-card-head">
        <span class="dashboard-card-handle" title="Arrastrá para mover">⠿</span>
        <span class="dashboard-card-title">${CARD_TITLES[key] || key}</span>
        <div class="dashboard-card-move">
          <button type="button" class="dashboard-move-btn" data-dir="up" title="Subir">↑</button>
          <button type="button" class="dashboard-move-btn" data-dir="down" title="Bajar">↓</button>
        </div>
      </div>
      <div class="dashboard-card-body" data-card-body="${key}">${cardBody(key)}</div>
    </div>
  `;
}

function refreshCardBody(key) {
  const el = document.querySelector(`[data-card-body="${key}"]`);
  if (el) el.innerHTML = cardBody(key);
  wireCardInteractions();
}

function wireCardInteractions() {
  document.querySelectorAll('.favorite-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.goToSectionFromProgress) window.goToSectionFromProgress(btn.dataset.section);
    });
  });
  const viewAllBtn = document.getElementById('viewAllRecordsBtn');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      renderRecordsDetail();
      document.getElementById('recordsDetailSection').classList.remove('hidden');
      document.getElementById('recordsDetailSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function renderRecordsDetail() {
  const grid = document.getElementById('recordsDetailGrid');
  if (!grid || !recordsData) return;
  const r = recordsData;
  const items = [
    { icon: '🎬', label: 'Mayor cantidad en un día', value: `${r.bestDay.count} video(s)${r.bestDay.date ? ' · ' + formatRecordDate(r.bestDay.date) : ''}` },
    { icon: '🔥', label: 'Mayor racha histórica', value: `${r.longestStreak} día(s) consecutivos` },
    {
      icon: '📦',
      label: 'Mayor compresión conseguida',
      value:
        r.bestCompression.pct > 0
          ? `${r.bestCompression.pct}% menos (${formatBytesProgress(r.bestCompression.originalSize)} → ${formatBytesProgress(r.bestCompression.finalSize)})`
          : 'Todavía no hay ninguna',
    },
    { icon: '⚡', label: 'Día con mayor actividad', value: r.bestDay.date ? `${formatRecordDate(r.bestDay.date)} · ${r.bestDay.count} video(s)` : '—' },
    { icon: '🎞️', label: 'Total histórico de videos', value: `${r.totalVideos} video(s)` },
    { icon: '📅', label: 'Total de días activos', value: `${r.activeDays} día(s)` },
  ];
  grid.innerHTML = items
    .map((it) => `<div class="progress-stat-card"><div class="progress-stat-icon">${it.icon}</div><div class="progress-stat-value">${it.value}</div><div class="progress-stat-label">${it.label}</div></div>`)
    .join('');
}

// ---- Logros y recompensas (secciones fijas, no forman parte del drag & drop) ----
function renderAchievementsGrid(achievements) {
  const grid = document.getElementById('achievementsGrid');
  if (!grid) return;
  grid.innerHTML = achievements
    .map(
      (a) => `
      <div class="achievement-card${a.unlocked ? ' unlocked' : ''}" title="${a.desc}">
        <div class="achievement-icon">${a.unlocked ? a.icon : '🔒'}</div>
        <div class="achievement-name">${a.name}</div>
        <div class="achievement-desc">${a.desc}</div>
      </div>`
    )
    .join('');
}

function progressBarHtml(label, value, max) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  return `
    <p class="meta-hint" style="margin:10px 0 2px;">${label}</p>
    <div class="reward-bar-wrap"><div class="reward-bar" style="width:${pct}%"></div></div>
    <p class="meta-hint" style="margin:2px 0 0;font-size:0.72rem;">${value} / ${max}</p>
  `;
}

function renderRewardsSection(nextRewards, freeRewardLevel) {
  const grid = document.getElementById('rewardsGrid');
  const label = document.getElementById('rewardsLabel');
  if (!grid || !label) return;
  if (!nextRewards.length) {
    label.textContent = 'Recompensas';
    grid.innerHTML = `<p class="empty-hint">👑 Ya alcanzaste el máximo del plan Gratis: 7 videos por día.</p>`;
    return;
  }
  label.textContent = freeRewardLevel > 0 ? 'Próxima recompensa' : 'Próximas recompensas';
  grid.innerHTML = nextRewards
    .map((r) => {
      const isMax = r.level === 2;
      return `
      <div class="reward-card${isMax ? ' reward-card-max' : ''}">
        <div class="reward-card-head">
          <span class="reward-icon">${isMax ? '👑' : '🎁'}</span>
          <div>
            <p class="reward-title">${isMax ? 'RECOMPENSA MÁXIMA' : 'PRÓXIMA RECOMPENSA'}</p>
            <p class="reward-subtitle">${r.dailyLimit} videos gratis por día</p>
          </div>
        </div>
        ${progressBarHtml('Videos procesados', r.videosProgress, r.videos)}
        ${progressBarHtml('Días activos', r.activeDaysProgress, r.activeDays)}
        ${r.streak > 0 ? progressBarHtml('Racha histórica mínima', r.streakProgress, r.streak) : ''}
      </div>
    `;
    })
    .join('');
}

// ---- Dashboard: orden, drag & drop, mobile ↑/↓, restaurar ----
async function renderDashboard() {
  const grid = document.getElementById('dashboardGrid');
  if (!grid) return;
  let order = progressData.__layout || Object.keys(CARD_TITLES);
  grid.innerHTML = order.map((key) => cardWrapperHtml(key)).join('');
  wireCardInteractions();
  wireDragAndDrop();
  wireMoveButtons();
}

async function persistCurrentOrder() {
  const grid = document.getElementById('dashboardGrid');
  const order = [...grid.children].map((c) => c.dataset.cardKey);
  try {
    await fetch('/api/dashboard-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
  } catch (err) {
    // si falla el guardado, el orden visual igual queda (se reintentara la
    // proxima vez que se reordene o se recargue la pagina)
  }
}

function wireDragAndDrop() {
  const grid = document.getElementById('dashboardGrid');
  grid.querySelectorAll('.dashboard-card').forEach((card) => {
    card.addEventListener('dragstart', () => {
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      persistCurrentOrder();
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = grid.querySelector('.dragging');
      if (!dragging || dragging === card) return;
      const rect = card.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      grid.insertBefore(dragging, before ? card : card.nextSibling);
    });
  });
}

function wireMoveButtons() {
  document.querySelectorAll('.dashboard-move-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.dashboard-card');
      const grid = document.getElementById('dashboardGrid');
      if (btn.dataset.dir === 'up' && card.previousElementSibling) {
        grid.insertBefore(card, card.previousElementSibling);
      } else if (btn.dataset.dir === 'down' && card.nextElementSibling) {
        grid.insertBefore(card.nextElementSibling, card);
      }
      persistCurrentOrder();
    });
  });
}

const restoreDashboardBtn = document.getElementById('restoreDashboardBtn');
if (restoreDashboardBtn) {
  restoreDashboardBtn.addEventListener('click', async () => {
    if (!confirm('¿Querés restaurar el orden original del dashboard? Esto no borra tus estadísticas, favoritos ni personalización — solo el orden visual.')) return;
    try {
      await fetch('/api/dashboard-layout/reset', { method: 'POST' });
      progressData.__layout = Object.keys(CARD_TITLES);
      renderDashboard();
    } catch (err) {
      alert('❌ No se pudo restaurar el diseño.');
    }
  });
}

// Usado por la card de favoritos para saltar a esa herramienta sin recargar.
window.goToSectionFromProgress = function goToSectionFromProgress(sectionId) {
  const tab = document.querySelector(`.section-tab[data-section="${sectionId}"]`);
  if (tab) tab.click();
};

// Para que el ⭐ del sidebar actualice la card de favoritos sin recargar todo.
window.renderFavoritesCard = async function renderFavoritesCard() {
  try {
    const res = await fetch('/api/favorites');
    progressData.__favorites = await res.json();
    refreshCardBody('favorites');
  } catch (err) {
    // no hay card de favoritos visible ahora mismo, no pasa nada
  }
};

window.renderProgress = async function renderProgress() {
  try {
    const [progressRes, meRes, favRes, historyRes, recordsRes, layoutRes] = await Promise.all([
      fetch('/api/progress'),
      fetch('/api/me'),
      fetch('/api/favorites'),
      fetch('/api/history'),
      fetch('/api/records'),
      fetch('/api/dashboard-layout'),
    ]);
    if (progressRes.status === 401) return (window.location.href = '/login');

    progressData = await progressRes.json();
    try { progressData.__quota = (await meRes.json()).quota; } catch { progressData.__quota = null; }
    try { progressData.__favorites = await favRes.json(); } catch { progressData.__favorites = null; }
    try { progressData.__history = await historyRes.json(); } catch { progressData.__history = []; }
    try { progressData.__layout = (await layoutRes.json()).layout; } catch { progressData.__layout = null; }
    try { recordsData = await recordsRes.json(); } catch { recordsData = null; }

    renderDashboard();
    renderAchievementsGrid(progressData.achievements);
    renderRewardsSection(progressData.nextRewards, progressData.freeRewardLevel);
  } catch (err) {
    // si falla, la seccion se queda con lo ultimo que tenia (o vacia); no
    // bloqueamos el resto de la app por esto.
  }
};
