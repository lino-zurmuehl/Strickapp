# Strickzähler (React + Vite)

Mobile-first knitting web app with Easy-Knitty-style core features:

- Hauptzähler + Nebenzähler
- Schrittweite, Undo, Reset mit Bestätigung
- Stoppuhr (persistiert über Reload)
- Projektverwaltung (mehrere Projekte)
- Notizen pro Projekt (Autosave)
- Deutsche Sprachsteuerung (wenn vom Browser unterstützt)
- PWA-Basis (installierbar + offline cache)

## Theme

- Baby Blue: `#9EC9FF`
- Bordeaux Red: `#7A1E3A`

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## iOS Safari voice support

The app is built for iOS Safari, including German speech commands via `SpeechRecognition` / `webkitSpeechRecognition`.

- Best case: open directly in Safari browser.
- Installed Home Screen web app (standalone mode) can behave differently depending on iOS/Safari version.
- If speech recognition is unavailable, voice controls are disabled and all features still work by touch.

Example commands (German):

- `plus eins`
- `minus eins`
- `nebenzähler plus zwei`
- `timer starten`
- `timer stoppen`
- `zurück`

## Deploy to GitHub Pages

This repo includes `.github/workflows/deploy.yml`.

1. Push to `main`.
2. In GitHub repo settings, enable **Pages** with **GitHub Actions** as source.
3. The workflow builds and deploys automatically.

### Base path

Vite base path is configured automatically for GitHub Pages:

- CI uses `/${{ github.event.repository.name }}/`
- Local production fallback defaults to `/Strickapp/`

If your repository name changes, CI still works automatically.

## Main files

- `src/App.jsx`: app logic + UI
- `src/index.css`: mobile styling and theme
- `public/manifest.webmanifest`: PWA manifest
- `public/sw.js`: service worker
- `.github/workflows/deploy.yml`: GitHub Pages deployment
