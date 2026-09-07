# Video Editor - Meta Ads

App para subir videos y ajustarlos antes de usarlos en campañas de Meta:

- **Rotación en pasos de 90°**: cada click al botón "Rotar" gira el video 90° más (0° → 90° → 180° → 270° → 0°), útil para convertir un video horizontal en vertical (formato Reels/Stories).
- **Codec de audio**: AAC, MP3, Opus o mantener el original.
- **Optimización**: presets de calidad (alta / balanceada / liviana) usando H.264 + `faststart` para reproducción rápida.
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
