const statGrid = document.getElementById('statGrid');
const usersBody = document.getElementById('usersBody');
const couponsBody = document.getElementById('couponsBody');

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}

const PLAN_LABELS = { free: 'Gratis', intermedio: 'Intermedio', pro: 'Pro' };

function planLabel(user) {
  const base = PLAN_LABELS[user.plan] || user.plan;
  // El cupon de ilimitado (equipo) pisa cualquier plan formal, igual que en
  // el resto de la app — se muestra aparte para no confundirlo con el plan
  // Pro pago.
  if (user.unlimited) return `${base} + 🎟️✨ ilimitado (cupón)`;
  if (user.unlimited_until && new Date(user.unlimited_until).getTime() > Date.now()) {
    return `${base} + 🎟️✨ hasta ${fmtDate(user.unlimited_until)}`;
  }
  return base;
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
    { label: 'Plan Gratis', value: (s.planCounts && s.planCounts.free) || 0 },
    { label: 'Plan Intermedio', value: (s.planCounts && s.planCounts.intermedio) || 0 },
    { label: 'Plan Pro', value: (s.planCounts && s.planCounts.pro) || 0 },
    { label: 'Pedidos de upgrade pendientes', value: s.pendingUpgrades || 0 },
    { label: 'Con cupón ilimitado', value: s.unlimitedUsers },
    { label: 'Videos hoy', value: s.videosToday },
    { label: 'Videos en historial (24h)', value: s.videosInHistory },
    { label: 'Referidos totales', value: s.totalReferrals },
    { label: '👍 Feedback positivo', value: (s.feedbackCounts && s.feedbackCounts.up) || 0 },
    { label: '👎 Feedback negativo', value: (s.feedbackCounts && s.feedbackCounts.down) || 0 },
    { label: 'Ideas por revisar', value: s.pendingIdeas || 0 },
    { label: 'Con recompensa de plan Gratis', value: s.usersWithFreeReward || 0 },
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
        <td>
          ${u.requested_plan ? `<div style="margin-bottom:6px;font-size:0.72rem;color:var(--accent-hover);">Pidió: ${PLAN_LABELS[u.requested_plan] || u.requested_plan}</div>` : ''}
          <div style="display:flex;gap:6px;">
            <select class="plan-select" data-id="${u.id}" data-email="${u.email}">
              <option value="free" ${u.plan === 'free' ? 'selected' : ''}>Gratis</option>
              <option value="intermedio" ${u.plan === 'intermedio' || u.requested_plan === 'intermedio' ? 'selected' : ''}>Intermedio</option>
              <option value="pro" ${u.plan === 'pro' || u.requested_plan === 'pro' ? 'selected' : ''}>Pro</option>
            </select>
            <button type="button" class="btn-secondary set-plan-btn" data-id="${u.id}" data-email="${u.email}">Guardar</button>
          </div>
        </td>
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

  usersBody.querySelectorAll('.set-plan-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('td');
      const select = row.querySelector('.plan-select');
      const plan = select.value;
      const email = btn.dataset.email;
      if (!confirm(`¿Poner a ${email} en el plan ${PLAN_LABELS[plan]}?`)) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const r = await fetch(`/api/admin/users/${btn.dataset.id}/set-plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'No se pudo cambiar el plan.');
        loadUsers();
        loadStats();
      } catch (err) {
        alert('❌ ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Guardar';
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

const feedbackBody = document.getElementById('feedbackBody');
const ideasBody = document.getElementById('ideasBody');

const SOURCE_LABELS = { optimizer: 'Optimizador', editor: 'Mini Editor', audio: 'Extraer Audio' };

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function loadFeedback() {
  const res = await fetch('/api/admin/feedback');
  const rows = await res.json();
  if (!rows.length) {
    feedbackBody.innerHTML = '<tr><td colspan="6">Todavía no hay feedback.</td></tr>';
    return;
  }
  feedbackBody.innerHTML = rows
    .map(
      (f) => `
      <tr>
        <td>${f.email}</td>
        <td>${SOURCE_LABELS[f.source] || f.source}</td>
        <td>${f.rating === 'up' ? '👍' : '👎'}</td>
        <td>${f.reason || '—'}</td>
        <td>${f.comment || '—'}</td>
        <td>${fmtDateTime(f.created_at)}</td>
      </tr>`
    )
    .join('');
}

const IDEA_STATUS_LABELS = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  planeada: 'Planeada',
  implementada: 'Implementada',
  descartada: 'Descartada',
};

async function loadIdeas() {
  const res = await fetch('/api/admin/feature-ideas');
  const rows = await res.json();
  if (!rows.length) {
    ideasBody.innerHTML = '<tr><td colspan="6">Todavía no hay ideas propuestas.</td></tr>';
    return;
  }
  ideasBody.innerHTML = rows
    .map(
      (idea) => `
      <tr>
        <td>${idea.email}</td>
        <td>${idea.title}</td>
        <td>${idea.description || '—'}</td>
        <td>${idea.category}</td>
        <td>${fmtDateTime(idea.created_at)}</td>
        <td>
          <select class="idea-status-select" data-id="${idea.id}">
            ${Object.entries(IDEA_STATUS_LABELS)
              .map(([value, label]) => `<option value="${value}" ${idea.status === value ? 'selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </td>
      </tr>`
    )
    .join('');

  ideasBody.querySelectorAll('.idea-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const prevValue = sel.dataset.prevValue || sel.value;
      sel.disabled = true;
      try {
        const r = await fetch(`/api/admin/feature-ideas/${sel.dataset.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: sel.value }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'No se pudo cambiar el estado.');
        sel.dataset.prevValue = sel.value;
      } catch (err) {
        alert('❌ ' + err.message);
        sel.value = prevValue;
      } finally {
        sel.disabled = false;
      }
    });
  });
}

async function loadDinoSettings() {
  const checkbox = document.getElementById('dinoAllSkinsCheckbox');
  if (!checkbox) return;
  const res = await fetch('/api/admin/dino-settings');
  const data = await res.json();
  checkbox.checked = !!data.allSkinsUnlocked;
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true;
    try {
      await fetch('/api/admin/dino-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allSkinsUnlocked: checkbox.checked }),
      });
    } catch (err) {
      alert('❌ No se pudo guardar la configuración.');
      checkbox.checked = !checkbox.checked;
    } finally {
      checkbox.disabled = false;
    }
  });
}

loadStats();
loadUsers();
loadCoupons();
loadFeedback();
loadIdeas();
loadDinoSettings();
