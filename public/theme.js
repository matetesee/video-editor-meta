// Se carga como el PRIMER script del <head> en todas las paginas: aplica el
// tema guardado antes de que se pinte nada, para que no se vea un flash del
// tema equivocado. `toggleTheme()` la usa el boton de la barra de sesion
// (solo existe en las paginas logueadas), pero cualquier pagina respeta el
// tema ya elegido.
(function () {
  try {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  } catch (err) {
    // localStorage puede fallar en modo privado; seguimos con el default oscuro
  }
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch (err) {
    // sin persistencia, pero al menos cambia para esta visita
  }
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = next === 'light' ? '🌙' : '☀️';
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  btn.textContent = current === 'light' ? '🌙' : '☀️';
  btn.addEventListener('click', toggleTheme);
});
