const resetForm = document.getElementById('resetForm');
const resetBtn = document.getElementById('resetBtn');
const resetError = document.getElementById('resetError');
const resetSuccess = document.getElementById('resetSuccess');

const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
  resetForm.classList.add('hidden');
  resetError.textContent = '❌ Este link no es válido. Pedí uno nuevo desde la pantalla de inicio de sesión.';
  resetError.classList.remove('hidden');
}

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetError.classList.add('hidden');

  const password = document.getElementById('newPassword').value;
  const password2 = document.getElementById('newPassword2').value;

  if (password !== password2) {
    resetError.textContent = '❌ Las contraseñas no coinciden.';
    resetError.classList.remove('hidden');
    return;
  }

  resetBtn.disabled = true;
  resetBtn.textContent = 'Guardando...';

  try {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cambiar la contraseña.');

    resetForm.classList.add('hidden');
    resetSuccess.textContent = '✅ ¡Listo! Tu contraseña se actualizó. Entrando...';
    resetSuccess.classList.remove('hidden');
    setTimeout(() => (window.location.href = '/'), 1200);
  } catch (err) {
    resetError.textContent = '❌ ' + err.message;
    resetError.classList.remove('hidden');
    resetBtn.disabled = false;
    resetBtn.textContent = 'Guardar y entrar';
  }
});
