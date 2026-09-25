// Minijuego de la serpiente — "para joda", sin ningun efecto en cuota, plan
// ni logros. El unico dato que se guarda en la cuenta es el record maximo
// (ver /api/snake-score), asi se ve igual en cualquier dispositivo en vez
// de vivir solo en localStorage.

const snakeCanvas = document.getElementById('snakeCanvas');
const snakeScoreEl = document.getElementById('snakeScore');
const snakeHighScoreEl = document.getElementById('snakeHighScore');
const snakeOverlay = document.getElementById('snakeOverlay');
const snakeOverlayText = document.getElementById('snakeOverlayText');
const snakeStartBtn = document.getElementById('snakeStartBtn');

const GRID_SIZE = 18; // celdas de 18px sobre un canvas de 360x360 = 20x20
const GRID_COUNT = snakeCanvas ? snakeCanvas.width / GRID_SIZE : 20;
// Mas lento que un snake "clasico" a proposito: da tiempo real a reaccionar
// antes de comerse una pared, y la dificultad sube mas gradual con el puntaje.
const BASE_SPEED_MS = 200;
const MIN_SPEED_MS = 100;

let ctx = null;
let snake = [];
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };
let apple = { x: 5, y: 5 };
let score = 0;
let highScore = 0;
let loopHandle = null;
let running = false;
let initialized = false;
let awaitingInput = false;

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bg: styles.getPropertyValue('--input-bg').trim() || '#1f2330',
    bg2: styles.getPropertyValue('--panel').trim() || '#181b24',
    snake: styles.getPropertyValue('--accent').trim() || '#6c5ce7',
    snakeHead: styles.getPropertyValue('--accent-hover').trim() || '#8272f0',
    apple: '#e63946',
    appleShine: '#ff8fa3',
    grid: styles.getPropertyValue('--panel-border').trim() || '#2a2e38',
  };
}

function roundedRect(ctx2, x, y, w, h, r) {
  ctx2.beginPath();
  ctx2.moveTo(x + r, y);
  ctx2.arcTo(x + w, y, x + w, y + h, r);
  ctx2.arcTo(x + w, y + h, x, y + h, r);
  ctx2.arcTo(x, y + h, x, y, r);
  ctx2.arcTo(x, y, x + w, y, r);
  ctx2.closePath();
}

function resetGame() {
  const mid = Math.floor(GRID_COUNT / 2);
  snake = [
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
    { x: mid - 3, y: mid },
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0;
  snakeScoreEl.textContent = '0';
  placeApple();
}

function placeApple() {
  let candidate;
  do {
    candidate = { x: Math.floor(Math.random() * GRID_COUNT), y: Math.floor(Math.random() * GRID_COUNT) };
  } while (snake.some((s) => s.x === candidate.x && s.y === candidate.y));
  apple = candidate;
}

function draw() {
  if (!ctx) return;
  const colors = themeColors();
  const w = snakeCanvas.width;
  const h = snakeCanvas.height;

  // Fondo con un leve degrade para que no sea un color plano
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, colors.bg);
  bgGrad.addColorStop(1, colors.bg2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Grilla sutil (puntitos en cada celda, no lineas duras)
  ctx.fillStyle = colors.grid;
  ctx.globalAlpha = 0.35;
  for (let gx = 0; gx < GRID_COUNT; gx++) {
    for (let gy = 0; gy < GRID_COUNT; gy++) {
      ctx.beginPath();
      ctx.arc(gx * GRID_SIZE + GRID_SIZE / 2, gy * GRID_SIZE + GRID_SIZE / 2, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Manzana con brillito
  const ax = apple.x * GRID_SIZE + GRID_SIZE / 2;
  const ay = apple.y * GRID_SIZE + GRID_SIZE / 2;
  ctx.save();
  ctx.shadowColor = colors.apple;
  ctx.shadowBlur = 10;
  ctx.fillStyle = colors.apple;
  ctx.beginPath();
  ctx.arc(ax, ay, GRID_SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = colors.appleShine;
  ctx.beginPath();
  ctx.arc(ax - 3, ay - 3, 2, 0, Math.PI * 2);
  ctx.fill();
  // Hojita
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay - GRID_SIZE / 2 + 2);
  ctx.lineTo(ax + 4, ay - GRID_SIZE / 2 - 3);
  ctx.stroke();

  // Serpiente: segmentos redondeados con degrade del cuerpo hacia la cola
  snake.forEach((seg, i) => {
    const x = seg.x * GRID_SIZE + 1;
    const y = seg.y * GRID_SIZE + 1;
    const size = GRID_SIZE - 2;
    if (i === 0) {
      ctx.save();
      ctx.shadowColor = colors.snakeHead;
      ctx.shadowBlur = 6;
      ctx.fillStyle = colors.snakeHead;
      roundedRect(ctx, x, y, size, size, 6);
      ctx.fill();
      ctx.restore();
      // Ojitos, orientados segun la direccion actual
      ctx.fillStyle = '#fff';
      const cx = x + size / 2;
      const cy = y + size / 2;
      const perpX = -direction.y;
      const perpY = direction.x;
      const ex1 = cx + direction.x * 3 + perpX * 3;
      const ey1 = cy + direction.y * 3 + perpY * 3;
      const ex2 = cx + direction.x * 3 - perpX * 3;
      const ey2 = cy + direction.y * 3 - perpY * 3;
      ctx.beginPath();
      ctx.arc(ex1, ey1, 1.6, 0, Math.PI * 2);
      ctx.arc(ex2, ey2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const fade = Math.max(0.55, 1 - i / snake.length);
      ctx.globalAlpha = fade;
      ctx.fillStyle = colors.snake;
      roundedRect(ctx, x, y, size, size, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });
}

function currentSpeed() {
  return Math.max(MIN_SPEED_MS, BASE_SPEED_MS - score * 2);
}

function tick() {
  direction = nextDirection;
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

  const hitsWall = head.x < 0 || head.x >= GRID_COUNT || head.y < 0 || head.y >= GRID_COUNT;
  const hitsSelf = snake.some((s) => s.x === head.x && s.y === head.y);
  if (hitsWall || hitsSelf) {
    gameOver();
    return;
  }

  snake.unshift(head);
  if (head.x === apple.x && head.y === apple.y) {
    score += 1;
    snakeScoreEl.textContent = String(score);
    placeApple();
  } else {
    snake.pop();
  }

  draw();
  loopHandle = setTimeout(tick, currentSpeed());
}

function gameOver() {
  running = false;
  clearTimeout(loopHandle);
  snakeOverlayText.textContent = `💀 Perdiste — ${score} punto(s)`;
  snakeStartBtn.textContent = '🔄 Jugar de nuevo';
  snakeOverlay.classList.remove('hidden');
  saveScoreIfHigher();
}

async function saveScoreIfHigher() {
  if (score <= 0) return;
  try {
    const res = await fetch('/api/snake-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    });
    const data = await res.json();
    if (res.ok) {
      highScore = data.highScore;
      snakeHighScoreEl.textContent = String(highScore);
      if (data.isNewRecord && window.showToast) {
        window.showToast('🐍 ¡Nuevo récord!', `Llegaste a ${score} punto(s) en La Serpiente.`);
      }
    }
  } catch (err) {
    // si falla el guardado, no pasa nada grave — es solo un juego
  }
}

const MOVES = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function startGame() {
  resetGame();
  snakeOverlay.classList.add('hidden');
  running = true;
  // La serpiente arranca QUIETA (sin ir para ningun lado sola) hasta que el
  // jugador elige una direccion — antes arrancaba derecho automaticamente
  // apenas se apretaba "Jugar" y se comia la pared si no reaccionabas a
  // tiempo. Ahora no hay tick programado todavia: lo dispara beginMovement().
  awaitingInput = true;
  clearTimeout(loopHandle);
  draw();
}

function setDirection(dir) {
  const next = MOVES[dir];
  if (!next) return;
  // No dejar girar 180° sobre si misma (perderia al toque sin sentido).
  if (next.x === -direction.x && next.y === -direction.y) return;
  nextDirection = next;
}

// Primer movimiento elegido por el jugador: recien ahi arranca el loop de
// ticks. Antes de esto la serpiente no se mueve ni un pixel.
//
// BUG REAL que estaba ahi desde el principio: el cuerpo arranca en horizontal
// mirando a la derecha (los 3 segmentos iniciales ocupan x=7,8,9 en la misma
// fila). Si el PRIMER movimiento elegido era "izquierda" (el opuesto exacto),
// este codigo lo dejaba pasar sin chequear nada — la cabeza chocaba contra su
// propio segundo segmento en el primerisimo tick, y el jugador veia "toco la
// flecha y se muere al toque" pase lo que pase. El chequeo anti-reversa de
// setDirection() tiene que aplicar SIEMPRE, incluso en el primer movimiento.
function beginMovement(dir) {
  const next = MOVES[dir];
  if (!next) return;
  if (next.x === -direction.x && next.y === -direction.y) return;
  nextDirection = next;
  if (awaitingInput) {
    awaitingInput = false;
    clearTimeout(loopHandle);
    loopHandle = setTimeout(tick, currentSpeed());
  }
}

const KEY_DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

function handleKeydown(e) {
  const dir = KEY_DIRS[e.key];
  if (!dir) return;
  e.preventDefault();
  if (!running) startGame();
  beginMovement(dir);
}

window.initSnakeGame = async function initSnakeGame() {
  if (!snakeCanvas) return;
  // El listener va primero y sin esperar nada: si esto quedara despues del
  // fetch de abajo, una tecla apretada justo al entrar a la pestaña (antes
  // de que responda el servidor) se perdia sin que la serpiente reaccionara.
  document.addEventListener('keydown', handleKeydown);
  if (!initialized) {
    ctx = snakeCanvas.getContext('2d');
    resetGame();
    draw();
    document.querySelectorAll('.snake-btn[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!running) startGame();
        beginMovement(btn.dataset.dir);
      });
    });
    snakeStartBtn.addEventListener('click', startGame);
    try {
      const res = await fetch('/api/snake-score');
      if (res.ok) {
        const data = await res.json();
        highScore = data.highScore || 0;
        snakeHighScoreEl.textContent = String(highScore);
      }
    } catch (err) {
      // sin record previo visible, no bloquea el juego
    }
    initialized = true;
  }
};

window.pauseSnakeGame = function pauseSnakeGame() {
  running = false;
  clearTimeout(loopHandle);
  document.removeEventListener('keydown', handleKeydown);
};
