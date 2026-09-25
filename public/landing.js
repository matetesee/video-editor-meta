// Mascota que recorre la seccion "Que incluye" mientras se scrollea, subiendo
// y bajando por la guia vertical e iluminando la funcion mas cercana al medio
// de la pantalla. Puramente decorativo — si no encuentra los elementos (por
// ejemplo, esta pagina cambio de estructura) no rompe nada, solo no hace nada.
(function () {
  const track = document.getElementById('featureTimeline');
  const mascot = document.getElementById('featureMascot');
  const steps = document.querySelectorAll('.feature-step');
  if (!track || !mascot || !steps.length) return;

  let ticking = false;

  function update() {
    ticking = false;
    const rect = track.getBoundingClientRect();
    const viewMid = window.innerHeight * 0.5;
    const progress = Math.min(1, Math.max(0, (viewMid - rect.top) / rect.height));
    const maxTop = Math.max(0, rect.height - mascot.offsetHeight);
    mascot.style.top = progress * maxTop + 'px';

    let closest = null;
    let closestDist = Infinity;
    steps.forEach((step) => {
      const r = step.getBoundingClientRect();
      const center = r.top + r.height / 2;
      const dist = Math.abs(center - viewMid);
      if (dist < closestDist) {
        closestDist = dist;
        closest = step;
      }
    });
    steps.forEach((step) => step.classList.toggle('active', step === closest));
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();
