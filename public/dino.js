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
const BASE_SPEED = 3.2;
const MAX_SPEED = 7.5;
const FRAME_MS = 1000 / 60; // los px/frame de abajo estan calibrados a 60fps

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
  return Math.min(MAX_SPEED, BASE_SPEED + dScore / 260);
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
  const colors = dinoThemeColors();
  const w = dinoCanvas.width;
  const h = dinoCanvas.height;

  const skyGrad = dctx.createLinearGradient(0, 0, 0, h);
  skyGrad.addColorStop(0, colors.sky1);
  skyGrad.addColorStop(1, colors.sky2);
  dctx.fillStyle = skyGrad;
  dctx.fillRect(0, 0, w, h);

  // Sol/luna decorativo, quieto en la esquina
  dctx.fillStyle = colors.sun;
  dctx.beginPath();
  dctx.arc(w - 60, 45, 26, 0, Math.PI * 2);
  dctx.fill();

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
  dctx.shadowColor = colors.dinoDark;
  dctx.shadowBlur = 5;
  dctx.fillStyle = colors.dino;
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
    dctx.fillStyle = colors.dinoDark;
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
    }
  } catch (err) {
    // si falla el guardado, no pasa nada grave — es solo un juego
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
  if (!dInitialized) {
    dctx = dinoCanvas.getContext('2d');
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
    dInitialized = true;
  }
  document.addEventListener('keydown', handleDinoKeydown);
  document.addEventListener('keyup', handleDinoKeyup);
};

window.pauseDinoGame = function pauseDinoGame() {
  dRunning = false;
  cancelAnimationFrame(dLoopHandle);
  document.removeEventListener('keydown', handleDinoKeydown);
  document.removeEventListener('keyup', handleDinoKeyup);
};
