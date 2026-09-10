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
        <td><button type="button" class="btn-secondary impersonate-btn" data-id="${u.id}" data-email="${u.email}">🔎 Entrar</button></td>
        <td><button type="button" class="btn-secondary revoke-btn" data-id="${u.id}" data-email="${u.email}">🎟️❌ Quitar plan</button></td>
        <td><button type="button" class="btn-danger delete-btn" data-id="${u.id}" data-email="${u.email}">🗑️ Eliminar</button></td>
      </tr>`
    )
    .join('');

  usersBody.querySelectorAll('.impersonate-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (!confirm(`¿Entrar a la cuenta de ${email}? Vas a ver la app como esa persona la ve. Podés volver con un botón desde ahí.`)) return;
      btn.disabled = true;
      btn.textContent = 'Entrando...';
      try {
        const r = await fetch(`/api/admin/impersonate/${btn.dataset.id}`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'No se pudo entrar a esa cuenta.');
        window.location.href = '/';
      } catch (err) {
        alert('❌ ' + err.message);
        btn.disabled = false;
        btn.textContent = '🔎 Entrar';
      }
    });
  });

  usersBody.querySelectorAll('.revoke-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (!confirm(`¿Quitarle el plan ilimitado y los usos extra a ${email}? Vuelve al plan gratis de 3 videos/día. No borra la cuenta.`)) return;
      btn.disabled = true;
      btn.textContent = 'Quitando...';
      try {
        const r = await fetch(`/api/admin/users/${btn.dataset.id}/revoke-plan`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'No se pudo quitar el plan.');
        loadUsers();
        loadStats();
      } catch (err) {
        alert('❌ ' + err.message);
        btn.disabled = false;
        btn.textContent = '🎟️❌ Quitar plan';
      }
    });
  });

  usersBody.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (!confirm(`¿ELIMINAR la cuenta de ${email}? Se borra para siempre junto con su historial de videos. Esto no se puede deshacer.`)) return;
      btn.disabled = true;
      btn.textContent = 'Eliminando...';
      try {
        const r = await fetch(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta.');
        loadUsers();
        loadStats();
      } catch (err) {
        alert('❌ ' + err.message);
        btn.disabled = false;
        btn.textContent = '🗑️ Eliminar';
      }
    });
  });
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
