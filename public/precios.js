// Pagina de precios: el catalogo de planes sale de /api/plans (backend =
// fuente de verdad). Si hay sesion, /api/me dice que plan tiene hoy cada
// quien y si ya pidio pasarse a otro, para adaptar los botones.

const pricingGrid = document.getElementById('pricingGrid');
const pricingMessage = document.getElementById('pricingMessage');

let session = null; // null = no logueado

function fmtPrice(usd) {
  if (usd === 0) return '$0';
  return '$' + usd.toFixed(2).replace(/\.00$/, '');
}

function planCardHtml(plan, session) {
  const isCurrent = session && session.plan === plan.key;
  const isPending = session && session.requestedPlan === plan.key && !isCurrent;
  const highlight = plan.key === 'pro' ? ' pricing-card-highlight' : '';

  let buttonHtml;
  if (!session) {
    buttonHtml = `<a href="/login" class="btn-primary pricing-cta">${plan.cta}</a>`;
  } else if (isCurrent) {
    buttonHtml = `<button type="button" class="btn-secondary pricing-cta" disabled>Tu plan actual</button>`;
  } else if (isPending) {
    buttonHtml = `<button type="button" class="btn-secondary pricing-cta" disabled>Pedido enviado ✅</button>`;
  } else if (plan.key === 'free') {
    buttonHtml = `<button type="button" class="btn-secondary pricing-cta" data-action="downgrade">${plan.cta}</button>`;
  } else {
    buttonHtml = `<button type="button" class="btn-primary pricing-cta" data-action="upgrade" data-plan="${plan.key}">${plan.cta}</button>`;
  }

  return `
    <div class="pricing-card${highlight}">
      ${plan.tagline ? `<div class="pricing-tag">${plan.tagline}</div>` : ''}
      <h2 class="pricing-name">${plan.name}</h2>
      <div class="pricing-price">
        <span class="pricing-amount">${fmtPrice(plan.priceUsd)}</span>
        ${plan.priceUsd > 0 ? '<span class="pricing-period">USD / mes</span>' : ''}
      </div>
      <p class="pricing-limit">${plan.dailyLimit ? `Hasta ${plan.dailyLimit} videos/día` : 'Videos ilimitados'}</p>
      <ul class="pricing-features">
        ${plan.features.map((f) => `<li>✓ ${f}</li>`).join('')}
      </ul>
      ${buttonHtml}
    </div>
  `;
}

async function loadPricing() {
  try {
    const [plansRes, meRes] = await Promise.all([fetch('/api/plans'), fetch('/api/me')]);
    const plansData = await plansRes.json();
    if (meRes.ok) {
      const me = await meRes.json();
      session = {
        plan: me.quota && me.quota.plan,
        requestedPlan: me.quota && me.quota.requestedPlan,
      };
    }
    pricingGrid.innerHTML = plansData.plans.map((p) => planCardHtml(p, session)).join('');
    wireButtons();
  } catch (err) {
    pricingGrid.innerHTML = '<p class="empty-hint">No se pudieron cargar los planes. Recargá la página.</p>';
  }
}

function wireButtons() {
  pricingGrid.querySelectorAll('[data-action="upgrade"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Enviando...';
      try {
        const res = await fetch('/api/plan/upgrade-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: btn.dataset.plan }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo registrar tu pedido.');
        pricingMessage.textContent = '✅ ' + data.message;
        pricingMessage.classList.remove('hidden');
        pricingMessage.style.color = 'var(--success)';
        session.requestedPlan = btn.dataset.plan;
        pricingGrid.innerHTML = (await (await fetch('/api/plans')).json()).plans.map((p) => planCardHtml(p, session)).join('');
        wireButtons();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        pricingMessage.textContent = '❌ ' + err.message;
        pricingMessage.classList.remove('hidden');
        pricingMessage.style.color = 'var(--error)';
      }
    });
  });

  pricingGrid.querySelectorAll('[data-action="downgrade"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Volver al plan Gratis (3 videos/día)?')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/plan/downgrade-free', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cambiar el plan.');
        session.plan = 'free';
        loadPricing();
      } catch (err) {
        btn.disabled = false;
        alert('❌ ' + err.message);
      }
    });
  });
}

loadPricing();
