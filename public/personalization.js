// Modal de "Personalización": avatares, bordes y temas de color que se
// desbloquean por nivel. Todo lo que llega de /api/personalization ya viene
// con "unlocked" calculado en el servidor (a partir del nivel REAL) — acá
// solo se pinta y, al elegir, se manda al backend para que vuelva a validar
// antes de guardar (nunca se confía en un click para "desbloquear" nada).

const AVATAR_EMOJI_MAP = { default: '🧑', coder: '😎', rocket: '🚀', director: '🎬', gem: '💎', crownav: '👑' };

const personalizationOverlay = document.getElementById('personalizationOverlay');
const personalizationCloseBtn = document.getElementById('personalizationCloseBtn');
const openPersonalizationBtn = document.getElementById('openPersonalizationBtn');
const personalizationLevelHint = document.getElementById('personalizationLevelHint');
const avatarGallery = document.getElementById('avatarGallery');
const borderGallery = document.getElementById('borderGallery');
const themeGallery = document.getElementById('themeGallery');

function galleryItemHtml(item, kind, selectedKey) {
  const isSelected = item.key === selectedKey;
  const locked = !item.unlocked;
  let preview;
  if (kind === 'avatar') {
    preview = `<div class="personalization-preview">${AVATAR_EMOJI_MAP[item.key] || '🧑'}</div>`;
  } else if (kind === 'border') {
    const ringStyle = item.key === 'default' ? '' : `class="border-${item.key}"`;
    preview = `<div class="personalization-preview avatar-upload-preview" ${ringStyle}>🧑</div>`;
  } else {
    preview = `<div class="personalization-preview theme-swatch" style="background:${item.accent}"></div>`;
  }
  return `
    <button type="button" class="personalization-item${isSelected ? ' selected' : ''}${locked ? ' locked' : ''}" data-kind="${kind}" data-key="${item.key}" ${locked ? 'disabled' : ''}>
      ${preview}
      <span class="personalization-name">${item.name}</span>
      ${locked ? `<span class="personalization-lock">🔒 Nivel ${item.unlockLevel}</span>` : ''}
    </button>
  `;
}

async function loadPersonalization() {
  try {
    const res = await fetch('/api/personalization');
    if (res.status === 401) return (window.location.href = '/login');
    const data = await res.json();
    personalizationLevelHint.textContent = `Estás en el nivel ${data.level}. Cuanto más uses la app, más opciones desbloqueás.`;
    avatarGallery.innerHTML = data.avatars.map((a) => galleryItemHtml(a, 'avatar', data.selected.avatar)).join('');
    borderGallery.innerHTML = data.borders.map((b) => galleryItemHtml(b, 'border', data.selected.border)).join('');
    themeGallery.innerHTML = data.themes.map((t) => galleryItemHtml(t, 'theme', data.selected.accentTheme)).join('');
    wirePersonalizationButtons();
  } catch (err) {
    personalizationLevelHint.textContent = 'No se pudo cargar la personalización.';
  }
}

function wirePersonalizationButtons() {
  document.querySelectorAll('.personalization-item:not(.locked)').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.kind;
      const key = btn.dataset.key;
      const body = {};
      if (kind === 'avatar') body.avatar = key;
      else if (kind === 'border') body.border = key;
      else body.accentTheme = key;

      btn.disabled = true;
      try {
        const res = await fetch('/api/personalization', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar.');
        if (kind === 'avatar' && window.applyAvatarPersonalization) window.applyAvatarPersonalization({ avatar: key });
        if (kind === 'border' && window.applyAvatarPersonalization) window.applyAvatarPersonalization({ border: key });
        if (kind === 'theme' && window.applyAccentTheme) window.applyAccentTheme(key);
        loadPersonalization();
      } catch (err) {
        alert('❌ ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

if (openPersonalizationBtn) {
  openPersonalizationBtn.addEventListener('click', () => {
    document.getElementById('settingsOverlay').classList.add('hidden');
    personalizationOverlay.classList.remove('hidden');
    loadPersonalization();
  });
}
if (personalizationCloseBtn) {
  personalizationCloseBtn.addEventListener('click', () => personalizationOverlay.classList.add('hidden'));
}
if (personalizationOverlay) {
  personalizationOverlay.addEventListener('click', (e) => {
    if (e.target === personalizationOverlay) personalizationOverlay.classList.add('hidden');
  });
}
