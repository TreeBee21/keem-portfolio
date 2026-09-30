# AGENTS.md — keem-portfolio

Photography portfolio for Keem (@kastronomic). This folder is standalone.

- The Astryx rules in the parent `Mociip/AGENTS.md` do NOT apply here (the user explicitly opted out). Plain HTML/CSS/TS; no component kit.
- Design direction: "Darkroom contact sheet". Warm near-black, bone text, one safelight-red accent used sparingly.
- Fonts: Instrument Serif (regular only), Geist, Geist Mono. **Never use italics** — user request. Keep `font-synthesis: none` and `font-style: normal` resets.
- Photos are the hero: no decorative chrome over images, no rounded corners beyond 2px, grain only behind content.
- Motion spec lives in `site/app.js` (ripple-zoom lightbox). Reuse those timings when porting.
- In-page links use `smoothScrollTo` (own ease-in-out, 450–1100 ms by distance, cancels on wheel/touch/key, instant under reduced motion); `#work` targets `.work` so the sticky filter bar doesn't cover row one. The ↑ button (`.to-top`) shows once `.intro` is scrolled past and jumps instantly.
- Ambient glow behind the open photo is painted once into a ~120px canvas (`paintGlow`) and stretched. Do NOT move it back to CSS `filter: blur()` + `mask-image` on a large layer.

## Photos pipeline
- Originals go in `photos-src/` (currently Instagram exports: 1080–1440px, no EXIF). `captions.json` there controls title / place / date / series / order / hidden per file.
- `npm run photos` → WebP sizes in `site/photos/` + `site/photos.js` (`window.KEEM_PHOTOS`). Reads EXIF + Fujifilm film simulation when present.
- Series keys: streets, machines, places, people, land. Without `photos.js` the page falls back to Unsplash placeholders.
- Reels: `reels-src/` holds Instagram reel MP4s + covers + `_instagram.json`; `captions.json` there controls title / place / order / hidden (7 hidden: memes, text-hook BTS, podcast clip). `npm run reels` (ffmpeg-static + sharp) → `site/reels/` (faststart MP4, 8 s silent hover preview, posters) + `site/reels.js` (`window.KEEM_REELS`). `npm run media` runs both pipelines.
- The lightbox shows a "set" (`cur`): the filtered photo list or `REELS`. Reel frames get a `<video>`, a scrubber (click to jump, drag to scrub, hover time tip, ←/→ ±5 s when focused), a centred "Paused" mark, Play/Sound chips and a live glow re-sampled from the video every 200 ms. Deep links: `?p=014` photo, `?m=03` reel.
- Preview: `npm run dev` (tools/serve.mjs supports HTTP Range — required for video seeking; any real host does too) → http://localhost:5188 (relative photo paths need a server; file:// won't load them in every browser).
