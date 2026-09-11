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

// ---- Feedback rapido despues de un resultado (👍/👎) ----
// Un mismo widget reutilizado por el Optimizador, el Mini Editor y Extraer
// Audio (cada uno le pasa su propio contenedor y jobId). El backend valida
// que jobId sea un video que de verdad termino bien y sea del usuario
// logueado, y que no haya votado ya ese mismo trabajo (ver /api/feedback).
const FEEDBACK_REASONS_LOCAL = [
  'Perdió demasiada calidad',
  'El archivo sigue siendo muy pesado',
  'Problema con el audio',
  'Problema con la resolución',
  'El video no funciona correctamente',
  'Otro',
];

window.initFeedbackCard = function initFeedbackCard(container, jobId, source) {
  if (!container || !jobId) return;
  container.classList.remove('hidden');
  container.innerHTML = `
    <p class="feedback-question">¿El resultado quedó bien?</p>
    <div class="feedback-actions">
      <button type="button" class="feedback-btn" data-vote="up">👍 Sí</button>
      <button type="button" class="feedback-btn" data-vote="down">👎 No</button>
    </div>
  `;

  const send = async (rating, reason, comment) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, source, rating, reason, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar tu opinión.');
      container.innerHTML = `<p class="feedback-thanks">✅ ¡Gracias por tu feedback!</p>`;
    } catch (err) {
      container.innerHTML = `<p class="feedback-thanks">❌ ${err.message}</p>`;
    }
  };

  container.querySelector('[data-vote="up"]').addEventListener('click', () => send('up'));
  container.querySelector('[data-vote="down"]').addEventListener('click', () => {
    container.innerHTML = `
      <p class="feedback-question">¿Qué estuvo mal?</p>
      <div class="feedback-reasons">
        ${FEEDBACK_REASONS_LOCAL.map((r) => `<button type="button" class="feedback-reason-btn" data-reason="${r}">${r}</button>`).join('')}
      </div>
    `;
    container.querySelectorAll('.feedback-reason-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.reason === 'Otro') {
          container.innerHTML = `
            <p class="feedback-question">Contanos qué pasó (opcional)</p>
            <textarea id="feedbackCommentInput" maxlength="500" rows="2" placeholder="Escribí acá..."></textarea>
            <button type="button" class="btn-secondary" id="feedbackSendCommentBtn" style="margin-top:8px;">Enviar</button>
          `;
          container.querySelector('#feedbackSendCommentBtn').addEventListener('click', () => {
            send('down', 'Otro', container.querySelector('#feedbackCommentInput').value);
          });
        } else {
          send('down', btn.dataset.reason, '');
        }
      });
    });
  });
};

// ---- Modal de logro/recompensa desbloqueada ----
// newAchievements/newReward vienen del polling de /api/status (ver
// script.js/editor.js/audio.js): el backend los calcula UNA sola vez, en el
// momento exacto en que el video termina bien, asi que este modal solo se
// muestra la primera vez que se ven (el polling se corta apenas el job
// pasa a 'done', no se vuelve a pedir el mismo estado despues).
window.showAchievementModal = function showAchievementModal(newAchievements, newReward) {
  const overlay = document.getElementById('achievementModalOverlay');
  if (!overlay) return;
  const queue = [];
  (newAchievements || []).forEach((a) => queue.push({ kind: 'achievement', ...a }));
  if (newReward) queue.push({ kind: 'reward', ...newReward });
  if (queue.length === 0) return;

  const iconEl = document.getElementById('achievementModalIcon');
  const eyebrowEl = document.getElementById('achievementModalEyebrow');
  const titleEl = document.getElementById('achievementModalTitle');
  const descEl = document.getElementById('achievementModalDesc');
  const nextBtn = document.getElementById('achievementModalNextBtn');

  let i = 0;
  const showNext = () => {
    if (i >= queue.length) {
      overlay.classList.add('hidden');
      return;
    }
    const item = queue[i++];
    if (item.kind === 'achievement') {
      eyebrowEl.textContent = '🏆 ¡Nuevo logro desbloqueado!';
      iconEl.textContent = item.icon;
      titleEl.textContent = item.name;
      descEl.textContent = item.desc;
    } else {
      eyebrowEl.textContent = item.title;
      iconEl.textContent = item.level === 2 ? '👑' : '🎁';
      titleEl.textContent = `${item.dailyLimit} videos gratis por día`;
      descEl.textContent = item.message;
    }
    overlay.classList.remove('hidden');
    if (window.fireConfetti) {
      window.fireConfetti();
      setTimeout(() => window.fireConfetti(), 350);
    }
  };
  nextBtn.onclick = showNext;
  showNext();
};

// ---- Toast chico (records nuevos, personalizacion desbloqueada) ----
// A proposito NO es un modal: records/personalizaciones son mas frecuentes
// que logros, y el pedido explicito es "evitar spam" — se apila abajo a la
// derecha, se va solo a los pocos segundos.
window.showToast = function showToast(title, message) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast-card';
  el.innerHTML = `<p class="toast-title">${title}</p><p class="toast-message">${message}</p>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 400);
  }, 4200);
};

// newRecords/newPersonalizations vienen del polling de /api/status, igual
// que newAchievements/newReward — se muestran como toasts chicos en vez de
// modal para no ser invasivos.
window.showRecordToasts = function showRecordToasts(newRecords) {
  (newRecords || []).forEach((r) => window.showToast(r.title, r.message));
};
window.showPersonalizationToasts = function showPersonalizationToasts(newPersonalizations) {
  (newPersonalizations || []).forEach((p) => {
    window.showToast('🎨 Nueva personalización desbloqueada', `Desbloqueaste: ${p.name}.`);
  });
};

// ---- Insignias al lado del nombre ----
// badges = { levelBadge: {level,label}|null, planBadge: 'pro'|'intermedio'|null, crown: bool }
// Orden a proposito (de mas a menos llamativo) para no saturar: corona,
// plan, nivel. El resto (logros, etc.) vive solo dentro de Mi Progreso.
window.renderNameBadges = function renderNameBadges(el, badges) {
  if (!el || !badges) return;
  const parts = [];
  if (badges.crown) parts.push(`<span class="name-badge name-badge-crown" title="1.000 videos procesados">👑</span>`);
  if (badges.planBadge === 'pro') parts.push(`<span class="name-badge name-badge-pro" title="Plan Pro">PRO</span>`);
  else if (badges.planBadge === 'intermedio') parts.push(`<span class="name-badge name-badge-intermedio" title="Plan Intermedio">INT</span>`);
  if (badges.levelBadge) parts.push(`<span class="name-badge name-badge-level" title="${badges.levelBadge.label}">Nv.${badges.levelBadge.level}</span>`);
  el.innerHTML = parts.join('');
};

// ---- Tema de color desbloqueable (accent) ----
// Independiente del claro/oscuro (theme.js): esto solo cambia el color de
// acento, guardado como atributo aparte para no pisar esa logica.
window.applyAccentTheme = function applyAccentTheme(themeKey) {
  if (!themeKey || themeKey === 'default') {
    document.documentElement.removeAttribute('data-accent-theme');
  } else {
    document.documentElement.setAttribute('data-accent-theme', themeKey);
  }
};

// ---- Aplicar avatar/borde seleccionados sobre el circulo de avatar ----
window.applyAvatarPersonalization = function applyAvatarPersonalization(personalization) {
  if (!personalization) return;
  const fallback = document.getElementById('avatarFallback');
  const upload = document.getElementById('avatarUpload');
  if (fallback && personalization.avatar) {
    const AVATAR_EMOJI = { default: '🧑', coder: '😎', rocket: '🚀', director: '🎬', gem: '💎', crownav: '👑' };
    fallback.textContent = AVATAR_EMOJI[personalization.avatar] || '🧑';
  }
  if (upload) {
    upload.classList.remove('border-ring5', 'border-ring10', 'border-ring20', 'border-ring30');
    if (personalization.border && personalization.border !== 'default') {
      upload.classList.add('border-' + personalization.border);
    }
  }
};
