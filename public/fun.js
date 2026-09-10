// Frases que van rotando mientras ffmpeg procesa, para que la espera se
// sienta menos como una barra pelada. Compartido por el Optimizador
// (script.js) y el Mini Editor (editor.js).
const PROCESSING_PHRASES = [
  'Puliendo píxeles...',
  'Espantando al algoritmo de Meta...',
  'Achicando el video sin que se note...',
  'Convenciendo a los fotogramas de portarse bien...',
  'Ajustando el audio para que suene prolijo...',
  'Comprimiendo sin perder calidad...',
  'Charlando con el códec...',
  'Casi, casi...',
];

let phraseTimer = null;

// Arranca la rotación en el elemento dado. El llamador puede seguir
// pisando su textContent con el % real (ej. "Procesando... 43%") cuando
// quiera; esto solo se encarga de variar el texto cada tanto para no
// dejarlo clavado en "Procesando..." todo el tiempo.
window.startPhraseRotation = function startPhraseRotation(el) {
  window.stopPhraseRotation();
  if (!el) return;
  let i = -1;
  const tick = () => {
    i = (i + 1) % PROCESSING_PHRASES.length;
    el.textContent = PROCESSING_PHRASES[i];
  };
  tick();
  phraseTimer = setInterval(tick, 2200);
};

window.stopPhraseRotation = function stopPhraseRotation() {
  if (phraseTimer) clearInterval(phraseTimer);
  phraseTimer = null;
};

// ---- Aviso del navegador cuando termina un video ----
// El permiso se pide recien cuando el usuario aprieta procesar/exportar (los
// navegadores ignoran el pedido si no vino de un gesto del usuario, y
// pedirlo antes de tiempo solo genera un popup molesto sin motivo).
window.requestNotifyPermission = function requestNotifyPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
};

// Solo notifica si el usuario ya dio permiso Y no está mirando la pestaña en
// este momento (si la tiene al frente, ya va a ver el resultado solo).
window.notifyVideoReady = function notifyVideoReady(body) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const n = new Notification('🎬 Tu video está listo', { body: body || 'Ya podés descargarlo desde la página.' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (err) {
    // algunos navegadores/entornos bloquean Notification silenciosamente
  }
};

// ---- Modal de "llegaste a tu límite diario" ----
// Lo dispara cualquier fetch a /api/process, /api/edit o /api/extract-audio
// que devuelva 429 (requireQuota en server.js). data = { error, quota,
// upsell } tal cual lo manda el servidor; upsell es la lista de planes
// (de users.js PLANS) que tiene sentido ofrecerle a esta cuenta.
window.showLimitModal = function showLimitModal(data) {
  const overlay = document.getElementById('limitModalOverlay');
  if (!overlay) return; // pagina que no tiene el modal (no deberia pasar en la app)
  const messageEl = document.getElementById('limitModalMessage');
  const plansEl = document.getElementById('limitModalPlans');
  if (messageEl) messageEl.textContent = (data && data.error) || 'Alcanzaste tu límite diario.';

  const upsell = (data && data.upsell) || [];
  if (plansEl) {
    plansEl.innerHTML = upsell
      .map(
        (p) => `
        <div class="mini-plan-card${p.key === 'pro' ? ' highlight' : ''}">
          ${p.tagline ? `<div class="pricing-tag" style="position:static;transform:none;display:inline-block;margin-bottom:8px;">${p.tagline}</div>` : ''}
          <h4>${p.name}</h4>
          <div class="mini-plan-price">$${p.priceUsd.toFixed(2).replace(/\.00$/, '')}<span style="font-size:0.65rem;color:var(--text-dim);"> USD/mes</span></div>
          <button type="button" class="btn-primary" data-upgrade-plan="${p.key}">${p.cta}</button>
        </div>`
      )
      .join('');
    plansEl.querySelectorAll('[data-upgrade-plan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Enviando...';
        try {
          const res = await fetch('/api/plan/upgrade-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: btn.dataset.upgradePlan }),
          });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error || 'No se pudo registrar tu pedido.');
          btn.textContent = '✅ Pedido enviado';
        } catch (err) {
          btn.disabled = false;
          btn.textContent = original;
          alert('❌ ' + err.message);
        }
      });
    });
  }
  overlay.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('limitModalCloseBtn');
  const overlay = document.getElementById('limitModalOverlay');
  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  }
});
