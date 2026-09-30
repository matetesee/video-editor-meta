// Changelog de la app: lista a mano, ordenada de mas reciente a mas
// antigua. Cada vez que se agrega o arregla algo de verdad, suma una
// entrada acá arriba de todo — asi los usuarios ven que la app se sigue
// mejorando sin tener que preguntar.
const UPDATES = [
  {
    type: 'feature',
    date: '2026-09-30',
    title: 'Historial con cuadrícula, búsqueda, filtros y preview',
    description: 'Elegí vista lista o cuadrícula, buscá por nombre, filtrá por herramienta y ordená por fecha o tamaño. En la cuadrícula, pasá el mouse sobre un video para verlo unos segundos antes de descargarlo.',
    tags: ['Historial'],
  },
  {
    type: 'feature',
    date: '2026-09-30',
    title: '¿Qué querés hacer ahora? (Quick Actions)',
    description: 'Al terminar de procesar un video, ahora te ofrecemos seguir con otra herramienta (crear un GIF, cambiar la velocidad, extraer el audio, abrir en el Mini Editor) sin tener que volver a subir el archivo.',
    tags: ['Optimizador Meta', 'Velocidad', 'GIF Maker', 'Mini Editor'],
  },
  {
    type: 'feature',
    date: '2026-09-30',
    title: 'Historial: fijar, renombrar, duplicar y reprocesar',
    description: 'Ahora podés fijar un resultado para que no venza a las 24hs, renombrarlo, duplicarlo (queda una copia independiente) y reprocesarlo con la misma configuración que usaste la primera vez, sin tener que volver a subir el archivo.',
    tags: ['Historial'],
  },
  {
    type: 'feature',
    date: '2026-09-30',
    title: 'Presets en el Optimizador Meta',
    description: 'Guardá tus combinaciones favoritas de formato, códec de audio y calidad como un preset con nombre propio, y aplicalas en un click la próxima vez.',
    tags: ['Optimizador Meta'],
  },
  {
    type: 'feature',
    date: '2026-09-25',
    title: 'Inicio rediseñado: estadísticas, favoritos y trabajo reciente',
    description: 'La pantalla de Inicio ahora es un dashboard de verdad: saludo, tus números reales, tus últimos archivos para retomar, tus herramientas favoritas y un buscador para encontrar cualquier función al toque.',
    tags: ['Inicio'],
  },
  {
    type: 'feature',
    date: '2026-09-25',
    title: 'GIF Maker',
    description: 'Nueva herramienta: convertí cualquier fragmento de tu video en un GIF. Elegís inicio y fin, FPS, resolución y calidad de color.',
    tags: ['Nueva herramienta'],
  },
  {
    type: 'feature',
    date: '2026-09-25',
    title: 'Herramienta de Velocidad',
    description: 'Acelerá o ralentizá tus videos (de 0.25x a 4x, o un valor a medida), con el audio sincronizado automáticamente o silenciado si preferís.',
    tags: ['Nueva herramienta'],
  },
  {
    type: 'fix',
    date: '2026-09-10',
    title: 'Arrastrar clips y texto ya no se traba',
    description: 'Los bordes de los clips y los bloques de texto del Mini Editor a veces apenas se movían al intentar recortarlos o estirarlos. Ya se puede arrastrar todo con normalidad.',
    tags: ['Mini Editor'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Texto con posición libre y sin fondo',
    description: 'Ahora podés arrastrar el texto directo sobre el video para ubicarlo donde quieras, y elegir si querés un fondo detrás o solo el texto.',
    tags: ['Mini Editor'],
  },
  {
    type: 'fix',
    date: '2026-09-10',
    title: 'Audio en la vista previa del Mini Editor',
    description: 'La vista previa venía silenciada por error. Ahora se escucha el audio real de los clips al reproducir.',
    tags: ['Mini Editor'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Sistema de planes y suscripciones',
    description: 'Nuevos planes Gratis, Intermedio y Pro, con página de precios propia, límite diario según el plan y un aviso claro cuando lo alcanzás.',
    tags: ['Cuenta', 'Planes'],
  },
  {
    type: 'improvement',
    date: '2026-09-10',
    title: 'El cupo se descuenta solo si el video sale bien',
    description: 'Subir un archivo o cancelar una edición ya no gasta un uso del plan. Solo se descuenta cuando el video termina de procesarse correctamente.',
    tags: ['Cuenta'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Mini Editor estilo CapCut',
    description: 'Vista previa en vivo de los clips ya unidos, línea de tiempo para recortar, y la posibilidad de dividir un clip en dos para sacar un pedazo del medio.',
    tags: ['Mini Editor'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Extraer Audio',
    description: 'Nueva pestaña para sacarle el audio a cualquier video y descargarlo en MP3, M4A o WAV.',
    tags: ['Herramientas'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Panel de admin: soporte y control de cuentas',
    description: 'Entrar a la cuenta de un usuario para ver exactamente qué le pasa, cambiarle el plan o eliminar su cuenta si hace falta.',
    tags: ['Admin'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Racha, insignias y sorpresas',
    description: 'Racha de días seguidos usando la app, insignias por uso, frases graciosas mientras se procesa un video, y un aviso del navegador cuando termina.',
    tags: ['Cuenta'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Historial de videos (24 horas)',
    description: 'Los videos que procesás quedan disponibles para volver a descargarlos durante 24 horas.',
    tags: ['Herramientas'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Sistema de referidos',
    description: 'Invitá gente con tu código y, cuando se registren, ambos ganan videos extra de regalo.',
    tags: ['Cuenta'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Recuperar contraseña',
    description: 'Ahora se puede pedir un link por email para elegir una contraseña nueva si te la olvidaste.',
    tags: ['Cuenta'],
  },
  {
    type: 'improvement',
    date: '2026-09-10',
    title: 'Modo claro y oscuro',
    description: 'Se puede cambiar el tema de toda la app desde el botón de sol/luna, y queda guardado para la próxima vez.',
    tags: ['Diseño'],
  },
  {
    type: 'improvement',
    date: '2026-09-10',
    title: 'Reloj con la hora local',
    description: 'Muestra la hora del dispositivo de cada persona automáticamente, sin importar en qué país esté.',
    tags: ['Diseño'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Registro con email y contraseña',
    description: 'Cada persona puede crear su propia cuenta (con opción de invitación), en vez de compartir un solo login.',
    tags: ['Cuenta'],
  },
  {
    type: 'feature',
    date: '2026-09-10',
    title: 'Optimización automática para Meta Ads',
    description: 'El video se ajusta solo a la resolución, códec y bitrate que pide Meta, para que no lo rechace ni lo entregue mal.',
    tags: ['Herramientas'],
  },
];

const UPDATE_TYPE_LABELS = {
  feature: { label: '✨ Nueva función', className: 'update-badge-feature' },
  improvement: { label: '📈 Mejora', className: 'update-badge-improvement' },
  fix: { label: '🔧 Corrección', className: 'update-badge-fix' },
};

function formatUpdateDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatUpdateMonth(iso) {
  const d = new Date(iso + 'T12:00:00');
  const label = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function updateCardHtml(u) {
  const badge = UPDATE_TYPE_LABELS[u.type] || UPDATE_TYPE_LABELS.improvement;
  return `
    <div class="update-card">
      <div class="update-card-head">
        <span class="update-badge ${badge.className}">${badge.label}</span>
        <span class="update-date">${formatUpdateDate(u.date)}</span>
      </div>
      <h3 class="update-title">${u.title}</h3>
      <p class="update-desc">${u.description}</p>
      <div class="update-tags">${u.tags.map((t) => `<span class="update-tag">${t}</span>`).join('')}</div>
    </div>
  `;
}

window.renderUpdates = function renderUpdates() {
  const featuredEl = document.getElementById('updatesFeatured');
  const timelineEl = document.getElementById('updatesTimeline');
  if (!featuredEl || !timelineEl || featuredEl.dataset.rendered) return;
  featuredEl.dataset.rendered = '1';

  const [latest, ...rest] = UPDATES;
  featuredEl.innerHTML = `
    <div class="update-featured">
      <div class="update-featured-icon">✨</div>
      <div class="update-featured-body">
        <div class="update-card-head">
          <span class="update-eyebrow">ÚLTIMA ACTUALIZACIÓN</span>
          <span class="update-badge ${UPDATE_TYPE_LABELS[latest.type].className}">${UPDATE_TYPE_LABELS[latest.type].label}</span>
        </div>
        <h2 class="update-featured-title">${latest.title}</h2>
        <p class="update-desc">${latest.description}</p>
        <div class="update-card-foot">
          <span class="update-date">📅 ${formatUpdateDate(latest.date)}</span>
          <span class="update-tag">Editor de Video de Dematiu</span>
        </div>
      </div>
    </div>
  `;

  let html = '';
  let lastMonth = '';
  rest.forEach((u) => {
    const month = formatUpdateMonth(u.date);
    if (month !== lastMonth) {
      html += `<p class="updates-month-label">${month}</p>`;
      lastMonth = month;
    }
    const badge = UPDATE_TYPE_LABELS[u.type] || UPDATE_TYPE_LABELS.improvement;
    html += `
      <div class="update-row scroll-reveal">
        <div class="update-row-dot ${badge.className}"></div>
        ${updateCardHtml(u)}
      </div>
    `;
  });
  timelineEl.innerHTML = html;

  // Animacion de scroll: cada actualizacion anterior aparece (fade + subida
  // suave) recien cuando entra en pantalla, en vez de estar todas visibles
  // de entrada. Se desconecta sola una vez que ya se revelo (no hace falta
  // seguir observando algo que ya se mostro).
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    timelineEl.querySelectorAll('.scroll-reveal').forEach((el) => observer.observe(el));
  } else {
    // Navegador viejo sin soporte: mejor mostrar todo de una que no mostrar nada.
    timelineEl.querySelectorAll('.scroll-reveal').forEach((el) => el.classList.add('revealed'));
  }
};
