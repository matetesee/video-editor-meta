const statGrid = document.getElementById('statGrid');
const usersBody = document.getElementById('usersBody');
const couponsBody = document.getElementById('couponsBody');

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}

function planLabel(user) {
  if (user.unlimited) return '✨ Ilimitado';
  if (user.unlimited_until && new Date(user.unlimited_until).getTime() > Date.now()) {
    return `✨ Hasta ${fmtDate(user.unlimited_until)}`;
  }
  return 'Gratis (3/día)';
}

async function loadStats() {
  const res = await fetch('/api/admin/stats');
  if (res.status === 403) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center;">No autorizado.</p>';
    return;
  }
  const s = await res.json();
  const cards = [
    { label: 'Usuarios totales', value: s.totalUsers },
    { label: 'Con plan ilimitado', value: s.unlimitedUsers },
    { label: 'Videos hoy', value: s.videosToday },
    { label: 'Videos en historial (24h)', value: s.videosInHistory },
    { label: 'Referidos totales', value: s.totalReferrals },
  ];
  statGrid.innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>`)
    .join('');
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  const users = await res.json();
  usersBody.innerHTML = users
    .map(
      (u) => `
      <tr>
        <td>${u.email}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td>${planLabel(u)}</td>
        <td>${u.daily_count}</td>
        <td>${u.bonus_uses}</td>
        <td><code>${u.referral_code || '—'}</code></td>
        <td>${u.referrals_made}</td>
      </tr>`
    )
    .join('');
}

async function loadCoupons() {
  const res = await fetch('/api/admin/coupons');
  const coupons = await res.json();
  const typeLabels = { unlimited_permanent: 'Ilimitado permanente', unlimited_days: 'Ilimitado por días', extra_uses: 'Videos extra' };
  couponsBody.innerHTML = coupons
    .map(
      (c) => `
      <tr>
        <td><code>${c.code}</code></td>
        <td>${typeLabels[c.type] || c.type}</td>
        <td>${c.type === 'unlimited_permanent' ? '—' : c.value}</td>
        <td>${c.redemptions_count}${c.max_redemptions ? ' / ' + c.max_redemptions : ''}</td>
        <td>${c.active ? '✅ Activo' : '⛔ Inactivo'}</td>
      </tr>`
    )
    .join('');
}

loadStats();
loadUsers();
loadCoupons();
