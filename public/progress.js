// Pagina "Mi Progreso": nivel, racha, logros y recompensas. Todo sale de
// GET /api/progress (calculado 100% en el servidor a partir de la base) —
// esta pagina solo lo pinta, no calcula ni confia en nada localmente.

function formatBytesProgress(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function renderProgressLevel(level) {
  const badge = document.getElementById('progressLevelBadge');
  const pct = document.getElementById('progressLevelPct');
  const bar = document.getElementById('progressLevelBar');
  const hint = document.getElementById('progressLevelHint');
  if (!badge) return;
  badge.textContent = `Nivel ${level.level}`;
  pct.textContent = level.maxLevel ? '¡Nivel máximo!' : `${level.progressPct}%`;
  bar.style.width = level.progressPct + '%';
  hint.textContent = level.maxLevel
    ? 'Llegaste al nivel máximo. ¡Gracias por tu uso constante!'
    : `${level.videosToNext} video(s) para el próximo nivel`;
}

function renderProgressStats(stats) {
  const grid = document.getElementById('progressStatsGrid');
  if (!grid) return;
  const items = [
    { icon: '🎬', label: 'Videos procesados', value: stats.totalVideos },
    { icon: '🔥', label: 'Racha actual', value: `${stats.streak} día(s)` },
    { icon: '🥇', label: 'Récord de racha', value: `${stats.longestStreak} día(s)` },
    { icon: '🏆', label: 'Logros desbloqueados', value: `${stats.achievementsUnlocked} / ${stats.achievementsTotal}` },
    { icon: '📅', label: 'Días activos', value: stats.activeDays },
    { icon: '💾', label: 'Espacio ahorrado', value: formatBytesProgress(stats.bytesSaved) },
  ];
  grid.innerHTML = items
    .map(
      (it) => `
      <div class="progress-stat-card">
        <div class="progress-stat-icon">${it.icon}</div>
        <div class="progress-stat-value">${it.value}</div>
        <div class="progress-stat-label">${it.label}</div>
      </div>`
    )
    .join('');
}

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

window.renderProgress = async function renderProgress() {
  try {
    const res = await fetch('/api/progress');
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    renderProgressLevel(data.level);
    renderProgressStats(data.stats);
    renderAchievementsGrid(data.achievements);
    renderRewardsSection(data.nextRewards, data.freeRewardLevel);
  } catch (err) {
    // si falla, la seccion se queda con lo ultimo que tenia (o vacia); no
    // bloqueamos el resto de la app por esto.
  }
};
