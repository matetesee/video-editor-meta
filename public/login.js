const loginTabs = document.querySelectorAll('.login-tab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginSub = document.getElementById('loginSub');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const loginError = document.getElementById('loginError');
const googleBtn = document.getElementById('googleBtn');
const googleDivider = document.getElementById('googleDivider');

function showError(msg) {
  loginError.textContent = '❌ ' + msg;
  loginError.classList.remove('hidden');
}

function setTab(tab) {
  loginTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  loginForm.classList.toggle('hidden', tab !== 'login');
  registerForm.classList.toggle('hidden', tab !== 'register');
  loginSub.textContent = tab === 'login' ? 'Ingresá con tu cuenta' : 'Creá tu cuenta para empezar';
  loginError.classList.add('hidden');
}

loginTabs.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

// El botón de Google solo se muestra si el servidor tiene las credenciales
// configuradas (si no, quedaría un botón roto).
fetch('/api/auth-config')
  .then((r) => r.json())
  .then((data) => {
    if (data.googleEnabled) {
      googleBtn.classList.remove('hidden');
      googleDivider.classList.remove('hidden');
    }
  })
  .catch(() => {});

googleBtn.addEventListener('click', () => {
  window.location.href = '/auth/google';
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginBtn.textContent = 'Ingresando...';
  loginError.classList.add('hidden');

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
    window.location.href = '/';
  } catch (err) {
    showError(err.message);
    loginBtn.disabled = false;
    loginBtn.textContent = 'Ingresar';
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');

  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const password2 = document.getElementById('registerPassword2').value;

  if (password !== password2) {
    showError('Las contraseñas no coinciden.');
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = 'Creando cuenta...';

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear la cuenta.');
    window.location.href = '/';
  } catch (err) {
    showError(err.message);
    registerBtn.disabled = false;
    registerBtn.textContent = 'Crear cuenta';
  }
});
