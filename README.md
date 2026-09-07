# Video Editor - Meta Ads

App para subir videos y ajustarlos antes de usarlos en campañas de Meta:

- **Optimizado para Meta (automático)**: ajusta el video a la resolución/relación de aspecto exacta que pide cada placement (Reels/Stories 9:16, Feed 1:1 o 4:5), códec H.264 perfil `main`, audio AAC 48kHz estéreo y bitrate dentro de los rangos recomendados por Meta, para evitar el rechazo o el "no se entregará en esta ubicación". El contenido no se recorta: se centra sobre un fondo desenfocado que rellena todo el cuadro.
- **Rotación en pasos de 90°**: cada click al botón "Rotar" gira el video 90° más (0° → 90° → 180° → 270° → 0°), útil para convertir un video horizontal en vertical.
- **Codec de audio**: AAC, MP3, Opus o mantener el original (control manual, además del modo automático).
- **Calidad / tamaño**: presets manuales (alta / balanceada / liviana) usando H.264 + `faststart` para reproducción rápida.
- **Descarga** del archivo final ya procesado.

## Stack

- Node.js + Express (backend)
- `fluent-ffmpeg` + binarios estáticos de ffmpeg/ffprobe (no requiere instalar ffmpeg en el sistema)
- HTML/CSS/JS plano (frontend)

## Desarrollo local

```bash
npm install
npm start
```

Abrir `http://localhost:3000`.

## Deploy

Pensado para desplegarse en Railway (Nixpacks detecta Node automáticamente). Variable `PORT` la provee la plataforma.
