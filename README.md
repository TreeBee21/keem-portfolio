# Keem — Photography

Portfolio for Keem ([@kastronomic](https://www.instagram.com/kastronomic/)): night streets, machines, places and people across Oman.

A static site — no framework, no build step. The page is plain HTML, CSS and JS in `site/`; a small Node pipeline turns source media into web-ready files and manifests the page reads.

## Structure

```
site/                 ← deployed as-is
  index.html          markup
  styles.css          "darkroom" design system + all component styles
  app.js              contact sheet, filters, Motion section, viewer, navigation
  photos.js           generated manifest → window.KEEM_PHOTOS
  reels.js            generated manifest → window.KEEM_REELS
  photos/  reels/     generated WebP / MP4 files
tools/
  prepare-photos.mjs  photos-src/ → site/photos + site/photos.js (sizes, colour, EXIF, Fuji film sim)
  prepare-reels.mjs   reels-src/  → site/reels  + site/reels.js  (faststart MP4, hover preview, posters)
  serve.mjs           local preview server (with HTTP Range, needed for video seeking)
photos-src/  reels-src/   source media (not committed) + captions.json you edit
```

## Working on it

```bash
npm install          # sharp, exifr, ffmpeg-static — only needed for the media pipeline
npm run dev          # http://localhost:5188
```

### Adding or editing photos and reels

1. Drop originals into `photos-src/` (JPEG / PNG / WebP / TIFF) or reels into `reels-src/` (MP4, optional same-name `.jpg` cover).
2. Run `npm run media` (or `npm run photos` / `npm run reels`). New files get a stub entry in that folder's `captions.json`.
3. Edit `captions.json` — `title`, `place`, `date`, `series` (photos: `streets`, `machines`, `places`, `people`, `land`), `order`, `hidden` — and run the command again.

Camera chips (including the Fujifilm film simulation) appear automatically for originals that still carry EXIF; Instagram exports don't.

### Deep links

- `?p=014` opens photo 14, `?m=03` opens reel 3
- `#work`, `#motion`, `#about`, `#contact` scroll to a section

## Deploying

Vercel serves `site/` directly (see `vercel.json`: no install, no build). Pushing to `main` deploys production.
