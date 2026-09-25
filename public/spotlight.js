// Efecto "linterna": un brillo suave que sigue al mouse por toda la pagina,
// incluso sobre zonas vacias (inspirado en markanamedia.com). Puramente
// decorativo, no interactua con nada — por eso pointer-events:none y por eso
// se desactiva en touch (no hay cursor que seguir).
(function () {
  if (window.matchMedia('(pointer: coarse)').matches) return;
  const glow = document.createElement('div');
  glow.id = 'cursorGlow';
  document.body.insertBefore(glow, document.body.firstChild);
  window.addEventListener('mousemove', (e) => {
    glow.style.setProperty('--gx', e.clientX + 'px');
    glow.style.setProperty('--gy', e.clientY + 'px');
  });
})();
