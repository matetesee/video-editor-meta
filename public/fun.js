// Frases que van rotando mientras ffmpeg procesa, para que la espera se
// sienta menos como una barra pelada. Compartido por el Optimizador
// (script.js) y el Mini Editor (editor.js).
const PROCESSING_PHRASES = [
  'Puliendo píxeles...',
  'Espantando al algoritmo de Meta...',
  'Achicando el video sin que se note...',
  'Convenciendo a los fotogramas de portarse bien...',
  'Ajustando el audio para que suene prolijo...',
  'Comprimiendo sin perder calidad...',
  'Charlando con el códec...',
  'Casi, casi...',
];

let phraseTimer = null;

// Arranca la rotación en el elemento dado. El llamador puede seguir
// pisando su textContent con el % real (ej. "Procesando... 43%") cuando
// quiera; esto solo se encarga de variar el texto cada tanto para no
// dejarlo clavado en "Procesando..." todo el tiempo.
window.startPhraseRotation = function startPhraseRotation(el) {
  window.stopPhraseRotation();
  if (!el) return;
  let i = -1;
  const tick = () => {
    i = (i + 1) % PROCESSING_PHRASES.length;
    el.textContent = PROCESSING_PHRASES[i];
  };
  tick();
  phraseTimer = setInterval(tick, 2200);
};

window.stopPhraseRotation = function stopPhraseRotation() {
  if (phraseTimer) clearInterval(phraseTimer);
  phraseTimer = null;
};

// ---- Aviso del navegador cuando termina un video ----
// El permiso se pide recien cuando el usuario aprieta procesar/exportar (los
// navegadores ignoran el pedido si no vino de un gesto del usuario, y
// pedirlo antes de tiempo solo genera un popup molesto sin motivo).
window.requestNotifyPermission = function requestNotifyPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
};

// Solo notifica si el usuario ya dio permiso Y no está mirando la pestaña en
// este momento (si la tiene al frente, ya va a ver el resultado solo).
window.notifyVideoReady = function notifyVideoReady(body) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const n = new Notification('🎬 Tu video está listo', { body: body || 'Ya podés descargarlo desde la página.' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (err) {
    // algunos navegadores/entornos bloquean Notification silenciosamente
  }
};
