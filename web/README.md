# Phantom — landing page

Single-file marketing page (`index.html`) matching the Agent Hub style
(Inter font, indigo→purple→pink on slate-950, glassmorphism, radial glows).

## What it does
- **Animated hero demo** — a mock Zoom call where the Phantom panel *phases out* under a
  sweeping "screen-capture beam," with a label flipping **Visible to you → Hidden in screen
  share**. Demonstrates the core feature instead of using a (copyrighted) game clip.
- **OS detection** — `detectOS()` reads the platform and shows the matching download as the
  primary button (macOS / Windows / Linux); the others appear as secondary cards.
- **Scroll-reveal** animations (IntersectionObserver) + drifting "ghost" particle canvas.
- **Responsible-use disclaimer** in the download section.

## Customize before shipping
All in the `<script>` at the bottom of `index.html`:

1. **Name** — change `const BRAND = 'Phantom'` (alternatives: Wraith, Veil, Umbra, Spectre).
2. **Download links** — `DOWNLOADS.{mac,windows,linux}.url` currently point to a placeholder
   `https://github.com/your-org/phantom/releases/latest/download/...`. Wire these to the real
   artifacts once `electron-builder` produces them (`.dmg`, `Setup.exe`, `.AppImage`).
3. **VERSION** / size string in `dlNote`.

## Build the installers these links point to
From the app root (`../`):

```bash
npm i -D electron-builder
# add a "build" block + "dist" script to package.json, then:
npm run dist
```
That produces the `.dmg` / `.exe` you upload to a GitHub Release (or your CDN), which is what
the download buttons fetch.

## Deploy
Static page — drop `web/` on Vercel/Netlify/GitHub Pages, or `vercel --prod` to match the
hub's deploy flow.
