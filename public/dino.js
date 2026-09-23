// Minijuego del dinosaurio — "para joda", como el de Chrome sin internet.
// Sin ningun efecto en cuota, plan ni logros. El unico dato que se guarda en
// la cuenta es el record maximo (ver /api/dino-score), igual que en la
// serpiente, para que se vea igual en cualquier dispositivo.

const dinoCanvas = document.getElementById('dinoCanvas');
const dinoScoreEl = document.getElementById('dinoScore');
const dinoHighScoreEl = document.getElementById('dinoHighScore');
const dinoOverlay = document.getElementById('dinoOverlay');
const dinoOverlayText = document.getElementById('dinoOverlayText');
const dinoStartBtn = document.getElementById('dinoStartBtn');

const GROUND_Y = 190;
const GRAVITY = 0.6;
const JUMP_VELOCITY = -11.5;
const DINO_X = 60;
const DINO_W = 34;
const DINO_H = 42;
const DUCK_W = 46;
const DUCK_H = 24;
const FRAME_MS = 1000 / 60; // los px/frame de abajo estan calibrados a 60fps
const NIGHT_CYCLE_SCORE = 350; // cada tantos puntos alterna dia/noche, como el original

const DIFFICULTIES = {
  easy: { base: 2.4, max: 6, ramp: 340, label: 'Fácil' },
  medium: { base: 3.2, max: 7.5, ramp: 260, label: 'Medio' },
  hard: { base: 4.2, max: 9.5, ramp: 200, label: 'Difícil' },
};

const NIGHT_PALETTE = {
  sky1: '#05060a',
  sky2: '#0d0f1a',
  ground: '#4a4f61',
  dino: '#eef0f6',
  dinoDark: '#c7cad6',
  cactus: '#4fae7c',
  bird: '#e08a99',
};

let dctx = null;
let dinoY = GROUND_Y - DINO_H;
let dinoVY = 0;
let onGround = true;
let ducking = false;
let obstacles = [];
let distanceToNext = 260;
let distance = 0;
let dScore = 0;
let dHighScore = 0;
let dRunning = false;
let dLoopHandle = null;
let dInitialized = false;
let animFrame = 0;
let lastTimestamp = 0;
let difficulty = 'medium';
let nightAmount = 0;
// Colores por defecto (skin "Clasico") hasta que responda /api/dino-skins.
let currentSkin = { key: 'classic', color: '#6c5ce7', colorDark: '#8272f0' };

function dinoThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    sky1: styles.getPropertyValue('--panel').trim() || '#181b24',
    sky2: styles.getPropertyValue('--input-bg').trim() || '#1f2330',
    ground: styles.getPropertyValue('--panel-border').trim() || '#2a2e38',
    dino: styles.getPropertyValue('--accent').trim() || '#6c5ce7',
    dinoDark: styles.getPropertyValue('--accent-hover').trim() || '#8272f0',
    cactus: '#2ecc71',
    bird: '#e63946',
    sun: 'rgba(255, 255, 255, 0.08)',
  };
}

function dinoRoundedRect(x, y, w, h, r) {
  dctx.beginPath();
  dctx.moveTo(x + r, y);
  dctx.arcTo(x + w, y, x + w, y + h, r);
  dctx.arcTo(x + w, y + h, x, y + h, r);
  dctx.arcTo(x, y + h, x, y, r);
  dctx.arcTo(x, y, x + w, y, r);
  dctx.closePath();
}

function currentSpeed() {
  const d = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  return Math.min(d.max, d.base + dScore / d.ramp);
}

function setDifficulty(key) {
  if (!DIFFICULTIES[key]) return;
  difficulty = key;
  try {
    localStorage.setItem('dinoDifficulty', key);
  } catch (err) {
    // si no hay localStorage disponible, no pasa nada: solo no se recuerda
  }
  updateDifficultyButtons();
}

function updateDifficultyButtons() {
  document.querySelectorAll('[data-difficulty]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.difficulty === difficulty);
  });
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string' || hex[0] !== '#') return null;
  const clean = hex.slice(1);
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6) return null;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return null;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function blendColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return t < 0.5 ? hexA : hexB;
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function dinoBox() {
  if (!onGround) return { x: DINO_X, y: dinoY, w: DINO_W, h: DINO_H };
  if (ducking) return { x: DINO_X - 4, y: GROUND_Y - DUCK_H, w: DUCK_W, h: DUCK_H };
  return { x: DINO_X, y: GROUND_Y - DINO_H, w: DINO_W, h: DINO_H };
}

function resetDino() {
  dinoY = GROUND_Y - DINO_H;
  dinoVY = 0;
  onGround = true;
  ducking = false;
  obstacles = [];
  distanceToNext = 260;
  distance = 0;
  dScore = 0;
  dinoScoreEl.textContent = '0';
  animFrame = 0;
  nightAmount = 0;
}

function spawnObstacle() {
  const speed = currentSpeed();
  const isBird = dScore > 15 && Math.random() < 0.32;
  if (isBird) {
    // Altura calculada para que choque con el dino parado (obliga a
    // agacharse) pero pase limpio por encima del dino agachado.
    const birdH = 22;
    const birdBottom = GROUND_Y - DUCK_H - 6;
    obstacles.push({
      type: 'bird',
      x: dinoCanvas.width + 10,
      w: 34,
      h: birdH,
      y: birdBottom - birdH,
    });
  } else {
    const clusters = 1 + Math.floor(Math.random() * 2);
    const w = 16 + clusters * 12;
    const h = 30 + Math.floor(Math.random() * 16);
    obstacles.push({ type: 'cactus', x: dinoCanvas.width + 10, w, h, y: GROUND_Y - h, clusters });
  }
  distanceToNext = 220 + Math.random() * 180 + speed * 8;
}

function overlaps(a, b) {
  const pad = 4;
  return (
    a.x + pad < b.x + b.w - pad &&
    a.x + a.w - pad > b.x + pad &&
    a.y + pad < b.y + b.h - pad &&
    a.y + a.h - pad > b.y + pad
  );
}

function dinoDraw() {
  if (!dctx) return;
  const base = dinoThemeColors();
  const t = nightAmount;
  const colors = {
    sky1: blendColor(base.sky1, NIGHT_PALETTE.sky1, t),
    sky2: blendColor(base.sky2, NIGHT_PALETTE.sky2, t),
    ground: blendColor(base.ground, NIGHT_PALETTE.ground, t),
    cactus: blendColor(base.cactus, NIGHT_PALETTE.cactus, t),
    bird: blendColor(base.bird, NIGHT_PALETTE.bird, t),
  };
  const skinDay = currentSkin.color === 'rainbow' ? `hsl(${(animFrame * 2) % 360}, 75%, 60%)` : currentSkin.color;
  const skinDayDark = currentSkin.colorDark === 'rainbow' ? `hsl(${(animFrame * 2 + 40) % 360}, 75%, 55%)` : currentSkin.colorDark;
  const dinoColor = currentSkin.color === 'rainbow' ? skinDay : blendColor(skinDay, NIGHT_PALETTE.dino, t);
  const dinoDarkColor = currentSkin.colorDark === 'rainbow' ? skinDayDark : blendColor(skinDayDark, NIGHT_PALETTE.dinoDark, t);
  const w = dinoCanvas.width;
  const h = dinoCanvas.height;

  const skyGrad = dctx.createLinearGradient(0, 0, 0, h);
  skyGrad.addColorStop(0, colors.sky1);
  skyGrad.addColorStop(1, colors.sky2);
  dctx.fillStyle = skyGrad;
  dctx.fillRect(0, 0, w, h);

  // Sol (de dia) que se desvanece en luna con crateres (de noche)
  dctx.save();
  dctx.globalAlpha = 1 - t;
  dctx.fillStyle = base.sun;
  dctx.beginPath();
  dctx.arc(w - 60, 45, 26, 0, Math.PI * 2);
  dctx.fill();
  dctx.restore();

  if (t > 0.01) {
    dctx.save();
    dctx.globalAlpha = t;
    dctx.fillStyle = '#eef0f6';
    dctx.beginPath();
    dctx.arc(w - 60, 45, 16, 0, Math.PI * 2);
    dctx.fill();
    dctx.fillStyle = 'rgba(0,0,0,0.15)';
    dctx.beginPath();
    dctx.arc(w - 66, 39, 3, 0, Math.PI * 2);
    dctx.fill();
    dctx.beginPath();
    dctx.arc(w - 56, 50, 2.4, 0, Math.PI * 2);
    dctx.fill();
    dctx.restore();
  }

  // Piso con textura de guiones que se mueven (sensacion de movimiento)
  dctx.strokeStyle = colors.ground;
  dctx.lineWidth = 2;
  dctx.beginPath();
  dctx.moveTo(0, GROUND_Y + 2);
  dctx.lineTo(w, GROUND_Y + 2);
  dctx.stroke();
  dctx.globalAlpha = 0.6;
  const dashPeriod = 36;
  const offset = -(distance % dashPeriod);
  for (let dx = offset; dx < w; dx += dashPeriod) {
    dctx.fillRect(dx, GROUND_Y + 8, 16, 3);
  }
  dctx.globalAlpha = 1;

  // Obstaculos
  obstacles.forEach((ob) => {
    if (ob.type === 'cactus') {
      dctx.fillStyle = colors.cactus;
      dinoRoundedRect(ob.x, ob.y, ob.w, ob.h, 4);
      dctx.fill();
      for (let i = 0; i < ob.clusters; i++) {
        const armY = ob.y + 8 + i * 12;
        dctx.fillRect(ob.x - 5, armY, 6, 5);
        dctx.fillRect(ob.x + ob.w - 1, armY + 4, 6, 5);
      }
    } else {
      dctx.fillStyle = colors.bird;
      dctx.beginPath();
      dctx.ellipse(ob.x + ob.w / 2, ob.y + ob.h / 2, ob.w / 2, ob.h / 2 - 3, 0, 0, Math.PI * 2);
      dctx.fill();
      const flap = Math.sin(animFrame / 4) * 8;
      dctx.strokeStyle = colors.bird;
      dctx.lineWidth = 3;
      dctx.beginPath();
      dctx.moveTo(ob.x + ob.w / 2 - 6, ob.y + ob.h / 2);
      dctx.lineTo(ob.x + ob.w / 2 - 16, ob.y + ob.h / 2 - flap);
      dctx.moveTo(ob.x + ob.w / 2 + 6, ob.y + ob.h / 2);
      dctx.lineTo(ob.x + ob.w / 2 + 16, ob.y + ob.h / 2 - flap);
      dctx.stroke();
    }
  });

  // Dino
  const box = dinoBox();
  dctx.save();
  dctx.shadowColor = dinoDarkColor;
  dctx.shadowBlur = 5;
  dctx.fillStyle = dinoColor;
  dinoRoundedRect(box.x, box.y, box.w, box.h, 6);
  dctx.fill();
  dctx.restore();

  // Ojo
  dctx.fillStyle = '#fff';
  dctx.beginPath();
  dctx.arc(box.x + box.w - 8, box.y + 9, 2.4, 0, Math.PI * 2);
  dctx.fill();

  // Patitas animadas (solo visual, no afecta la hitbox)
  if (onGround) {
    dctx.fillStyle = dinoDarkColor;
    const legFrame = Math.floor(animFrame / 6) % 2;
    if (!ducking) {
      if (legFrame === 0) {
        dctx.fillRect(box.x + 4, box.y + box.h - 4, 6, 6);
        dctx.fillRect(box.x + box.w - 12, box.y + box.h - 8, 6, 10);
      } else {
        dctx.fillRect(box.x + 4, box.y + box.h - 8, 6, 10);
        dctx.fillRect(box.x + box.w - 12, box.y + box.h - 4, 6, 6);
      }
    }
  }
}

function dinoTick(timestamp) {
  if (!dRunning) return;
  // Escalamos todo por delta-time: sin esto, en una pantalla de 120/144Hz
  // requestAnimationFrame llama al doble de seguido y el juego corre
  // el doble de rapido. Con esto corre igual de "tranqui" en cualquier monitor.
  if (!lastTimestamp) lastTimestamp = timestamp;
  const scale = Math.min(3, (timestamp - lastTimestamp) / FRAME_MS) || 1;
  lastTimestamp = timestamp;

  animFrame += scale;
  const speed = currentSpeed() * scale;
  distance += speed;
  dScore = Math.floor(distance / 8);
  dinoScoreEl.textContent = String(dScore);

  // Ciclo dia/noche tipo el original: alterna cada NIGHT_CYCLE_SCORE puntos,
  // con una transicion suave en vez de un corte brusco.
  const nightTarget = Math.floor(dScore / NIGHT_CYCLE_SCORE) % 2 === 1 ? 1 : 0;
  nightAmount += (nightTarget - nightAmount) * Math.min(1, 0.06 * scale);

  if (!onGround) {
    dinoVY += GRAVITY * scale;
    dinoY += dinoVY * scale;
    if (dinoY >= GROUND_Y - DINO_H) {
      dinoY = GROUND_Y - DINO_H;
      dinoVY = 0;
      onGround = true;
    }
  }

  distanceToNext -= speed;
  if (distanceToNext <= 0) spawnObstacle();

  const box = dinoBox();
  let hit = false;
  obstacles.forEach((ob) => {
    ob.x -= speed;
    if (overlaps(box, ob)) hit = true;
  });
  obstacles = obstacles.filter((ob) => ob.x + ob.w > -10);

  dinoDraw();

  if (hit) {
    dinoGameOver();
    return;
  }
  dLoopHandle = requestAnimationFrame(dinoTick);
}

function dinoJump() {
  if (!dRunning) {
    startDinoGame();
    return;
  }
  if (onGround && !ducking) {
    onGround = false;
    dinoVY = JUMP_VELOCITY;
  }
}

function setDucking(val) {
  ducking = val;
}

function dinoGameOver() {
  dRunning = false;
  cancelAnimationFrame(dLoopHandle);
  dinoOverlayText.textContent = `💀 Perdiste — ${dScore} punto(s)`;
  dinoStartBtn.textContent = '🔄 Jugar de nuevo';
  dinoOverlay.classList.remove('hidden');
  saveDinoScoreIfHigher();
}

async function saveDinoScoreIfHigher() {
  if (dScore <= 0) return;
  try {
    const res = await fetch('/api/dino-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: dScore }),
    });
    const data = await res.json();
    if (res.ok) {
      dHighScore = data.highScore;
      dinoHighScoreEl.textContent = String(dHighScore);
      if (data.isNewRecord && window.showToast) {
        window.showToast('🦖 ¡Nuevo récord!', `Llegaste a ${dScore} punto(s) en Dino Runner.`);
      }
      if (data.isNewRecord) loadDinoSkins();
    }
  } catch (err) {
    // si falla el guardado, no pasa nada grave — es solo un juego
  }
}

let knownUnlockedSkins = null;

async function loadDinoSkins() {
  const dinoSkinsEl = document.getElementById('dinoSkins');
  if (!dinoSkinsEl) return;
  try {
    const res = await fetch('/api/dino-skins');
    if (!res.ok) return;
    const data = await res.json();
    renderDinoSkins(data, dinoSkinsEl);
  } catch (err) {
    // si falla, se queda con la skin por defecto — no bloquea el juego
  }
}

function renderDinoSkins(data, container) {
  const nowUnlocked = new Set(data.skins.filter((s) => s.unlocked).map((s) => s.key));
  if (knownUnlockedSkins) {
    const newlyUnlocked = data.skins.filter((s) => s.unlocked && !knownUnlockedSkins.has(s.key));
    newlyUnlocked.forEach((s) => {
      if (window.showToast) window.showToast('🦖 ¡Nueva skin desbloqueada!', `"${s.label}" ya está disponible para tu Dino.`);
    });
  }
  knownUnlockedSkins = nowUnlocked;

  const selected = data.skins.find((s) => s.key === data.selected) || data.skins[0];
  if (selected) currentSkin = selected;

  container.innerHTML = data.skins
    .map((s) => {
      const swatchColor = s.color === 'rainbow' ? 'linear-gradient(135deg,#f43f5e,#eab308,#22c55e,#3b82f6,#a855f7)' : s.color;
      const locked = !s.unlocked;
      return `
        <button type="button" class="dino-skin-swatch ${s.key === data.selected ? 'selected' : ''} ${locked ? 'locked' : ''}" data-skin="${s.key}" title="${s.label}${locked ? ` — desbloquea a los ${s.unlockScore} puntos` : ''}">
          <span class="dino-skin-color" style="background:${swatchColor};"></span>
          ${locked ? '<span class="dino-skin-lock">🔒</span>' : ''}
          <span class="dino-skin-label">${s.label}${locked ? `<br>${s.unlockScore}pts` : ''}</span>
        </button>`;
    })
    .join('');

  container.querySelectorAll('.dino-skin-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('locked')) return;
      selectDinoSkin(btn.dataset.skin);
    });
  });
}

async function selectDinoSkin(key) {
  try {
    const res = await fetch('/api/dino-skin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skin: key }),
    });
    if (!res.ok) return;
    loadDinoSkins();
  } catch (err) {
    // si falla, se mantiene la skin actual
  }
}

function startDinoGame() {
  resetDino();
  dinoOverlay.classList.add('hidden');
  dRunning = true;
  lastTimestamp = 0;
  dinoDraw();
  cancelAnimationFrame(dLoopHandle);
  dLoopHandle = requestAnimationFrame(dinoTick);
}

function handleDinoKeydown(e) {
  if (['ArrowUp', ' ', 'Spacebar', 'w', 'W'].includes(e.key)) {
    e.preventDefault();
    dinoJump();
  } else if (['ArrowDown', 's', 'S'].includes(e.key)) {
    e.preventDefault();
    setDucking(true);
  }
}

function handleDinoKeyup(e) {
  if (['ArrowDown', 's', 'S'].includes(e.key)) {
    setDucking(false);
  }
}

window.initDinoGame = async function initDinoGame() {
  if (!dinoCanvas) return;
  // Igual que en la serpiente: el listener va antes que cualquier await, asi
  // una tecla apretada apenas se entra a la pestaña no se pierde.
  document.addEventListener('keydown', handleDinoKeydown);
  document.addEventListener('keyup', handleDinoKeyup);
  if (!dInitialized) {
    dctx = dinoCanvas.getContext('2d');
    try {
      const saved = localStorage.getItem('dinoDifficulty');
      if (saved && DIFFICULTIES[saved]) difficulty = saved;
    } catch (err) {
      // sin localStorage disponible, se queda en "medium"
    }
    resetDino();
    dinoDraw();
    dinoStartBtn.addEventListener('click', startDinoGame);
    document.querySelectorAll('[data-dino]').forEach((btn) => {
      const isDuck = btn.dataset.dino === 'duck';
      if (isDuck) {
        btn.addEventListener('pointerdown', () => setDucking(true));
        btn.addEventListener('pointerup', () => setDucking(false));
        btn.addEventListener('pointerleave', () => setDucking(false));
      } else {
        btn.addEventListener('click', dinoJump);
      }
    });
    document.querySelectorAll('[data-difficulty]').forEach((btn) => {
      btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty));
    });
    updateDifficultyButtons();
    try {
      const res = await fetch('/api/dino-score');
      if (res.ok) {
        const data = await res.json();
        dHighScore = data.highScore || 0;
        dinoHighScoreEl.textContent = String(dHighScore);
      }
    } catch (err) {
      // sin record previo visible, no bloquea el juego
    }
    loadDinoSkins();
    dInitialized = true;
  }
};

window.pauseDinoGame = function pauseDinoGame() {
  dRunning = false;
  cancelAnimationFrame(dLoopHandle);
  document.removeEventListener('keydown', handleDinoKeydown);
  document.removeEventListener('keyup', handleDinoKeyup);
};
