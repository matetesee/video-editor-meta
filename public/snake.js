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
const BASE_SPEED_MS = 130;
const MIN_SPEED_MS = 70;

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

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bg: styles.getPropertyValue('--input-bg').trim() || '#1f2330',
    snake: styles.getPropertyValue('--accent').trim() || '#6c5ce7',
    snakeHead: styles.getPropertyValue('--accent-hover').trim() || '#8272f0',
    apple: '#e63946',
    grid: styles.getPropertyValue('--panel-border').trim() || '#2a2e38',
  };
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
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);

  // Manzana
  ctx.fillStyle = colors.apple;
  ctx.beginPath();
  ctx.arc(
    apple.x * GRID_SIZE + GRID_SIZE / 2,
    apple.y * GRID_SIZE + GRID_SIZE / 2,
    GRID_SIZE / 2 - 2,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Serpiente
  snake.forEach((seg, i) => {
    ctx.fillStyle = i === 0 ? colors.snakeHead : colors.snake;
    ctx.fillRect(seg.x * GRID_SIZE + 1, seg.y * GRID_SIZE + 1, GRID_SIZE - 2, GRID_SIZE - 2);
  });
}

function currentSpeed() {
  return Math.max(MIN_SPEED_MS, BASE_SPEED_MS - score * 3);
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

function startGame() {
  resetGame();
  snakeOverlay.classList.add('hidden');
  running = true;
  draw();
  clearTimeout(loopHandle);
  loopHandle = setTimeout(tick, currentSpeed());
}

function setDirection(dir) {
  const moves = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const next = moves[dir];
  if (!next) return;
  // No dejar girar 180° sobre si misma (perderia al toque sin sentido).
  if (next.x === -direction.x && next.y === -direction.y) return;
  nextDirection = next;
}

function handleKeydown(e) {
  const KEY_DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const dir = KEY_DIRS[e.key];
  if (!dir) return;
  e.preventDefault();
  setDirection(dir);
}

window.initSnakeGame = async function initSnakeGame() {
  if (!snakeCanvas) return;
  if (!initialized) {
    ctx = snakeCanvas.getContext('2d');
    resetGame();
    draw();
    document.querySelectorAll('.snake-btn').forEach((btn) => {
      btn.addEventListener('click', () => setDirection(btn.dataset.dir));
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
  document.addEventListener('keydown', handleKeydown);
};

window.pauseSnakeGame = function pauseSnakeGame() {
  running = false;
  clearTimeout(loopHandle);
  document.removeEventListener('keydown', handleKeydown);
};
