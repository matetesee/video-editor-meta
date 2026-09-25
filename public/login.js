const loginTabs = document.querySelectorAll('.login-tab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotForm = document.getElementById('forgotForm');
const loginSub = document.getElementById('loginSub');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const forgotBtn = document.getElementById('forgotBtn');
const forgotLink = document.getElementById('forgotLink');
const backToLoginLink = document.getElementById('backToLoginLink');
const forgotSuccess = document.getElementById('forgotSuccess');
const loginError = document.getElementById('loginError');
const googleBtn = document.getElementById('googleBtn');
const googleDivider = document.getElementById('googleDivider');
let googleEnabled = false;

function showError(msg) {
  loginError.textContent = '❌ ' + msg;
  loginError.classList.remove('hidden');
}

function setTab(tab) {
  loginTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  loginTabs.forEach((t) => t.parentElement.classList.remove('hidden'));
  loginForm.classList.toggle('hidden', tab !== 'login');
  registerForm.classList.toggle('hidden', tab !== 'register');
  forgotForm.classList.add('hidden');
  loginSub.textContent = tab === 'login' ? 'Ingresá con tu cuenta' : 'Creá tu cuenta para empezar';
  loginError.classList.add('hidden');
  if (googleEnabled) {
    googleBtn.classList.remove('hidden');
    googleDivider.classList.remove('hidden');
  }
}

loginTabs.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

// Si vino de un link de invitacion (?ref=CODIGO), precarga el codigo y
// abre directo la pestaña de registro para no hacerle buscar nada.
const urlParams = new URLSearchParams(window.location.search);
const refCode = urlParams.get('ref');
if (refCode) {
  document.getElementById('registerReferral').value = refCode;
  setTab('register');
} else if (urlParams.get('tab') === 'register') {
  // Viene del boton "Registrarse" de la landing publica.
  setTab('register');
}

// El botón de Google solo se muestra si el servidor tiene las credenciales
// configuradas (si no, quedaría un botón roto).
fetch('/api/auth-config')
  .then((r) => r.json())
  .then((data) => {
    googleEnabled = !!data.googleEnabled;
    if (googleEnabled) {
      googleBtn.classList.remove('hidden');
      googleDivider.classList.remove('hidden');
    }
  })
  .catch(() => {});

forgotLink.addEventListener('click', () => {
  loginTabs.forEach((t) => t.parentElement.classList.add('hidden'));
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  forgotForm.classList.remove('hidden');
  googleBtn.classList.add('hidden');
  googleDivider.classList.add('hidden');
  loginSub.textContent = 'Recuperar contraseña';
  loginError.classList.add('hidden');
  forgotSuccess.classList.add('hidden');
});

backToLoginLink.addEventListener('click', () => setTab('login'));

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
  const referralCode = document.getElementById('registerReferral').value.trim();

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
      body: JSON.stringify({ email, password, referralCode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear la cuenta.');
    // Cuenta nueva -> selector de planes, para que elija Gratis/Intermedio/Pro
    // antes de entrar a la app (ya queda logueada con plan Gratis por
    // defecto, asi que puede volver a "/" cuando quiera sin perder nada).
    window.location.href = '/precios?bienvenida=1';
  } catch (err) {
    showError(err.message);
    registerBtn.disabled = false;
    registerBtn.textContent = 'Crear cuenta';
  }
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  forgotSuccess.classList.add('hidden');
  const email = document.getElementById('forgotEmail').value.trim();

  forgotBtn.disabled = true;
  forgotBtn.textContent = 'Enviando...';

  try {
    await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Siempre mostramos el mismo mensaje, exista o no la cuenta: asi no se
    // puede usar este formulario para adivinar que emails estan registrados.
    forgotSuccess.textContent = '✅ Si ese email está registrado, te mandamos un link para recuperar tu contraseña.';
    forgotSuccess.classList.remove('hidden');
    forgotBtn.textContent = 'Enviar link';
  } catch (err) {
    forgotSuccess.textContent = '✅ Si ese email está registrado, te mandamos un link para recuperar tu contraseña.';
    forgotSuccess.classList.remove('hidden');
    forgotBtn.textContent = 'Enviar link';
  } finally {
    forgotBtn.disabled = false;
  }
});
