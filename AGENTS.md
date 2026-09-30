# AGENTS.md — keem-portfolio

Photography portfolio for Keem (@kastronomic). This folder is standalone (its own git repo). See README.md for structure and commands.

## Design rules
- The Astryx rules in the parent `Mociip/AGENTS.md` do NOT apply here (the user explicitly opted out). Plain HTML/CSS/JS; no component kit, no framework, no build step.
- Design direction: "Darkroom contact sheet". Warm near-black, bone text, one safelight-red accent used sparingly.
- Fonts: Instrument Serif (regular only), Geist, Geist Mono. **Never use italics** — user request. Keep `font-synthesis: none` and the `font-style: normal` resets.
- Photos are the hero: no decorative chrome over images, no rounded corners beyond 2px, grain only behind content.

## Code map (`site/`)
- `index.html` markup only · `styles.css` all styles · `app.js` all behaviour (one IIFE, sectioned) · `photos.js` / `reels.js` generated manifests, loaded (deferred) before `app.js`.
- Viewer motion spec is at the top of `app.js`; reuse those timings.
- Photos zoom in the viewer: click / double-tap / pinch / ctrl+wheel, drag pans, `+ − 0` keys. The `.lb-photo` layer gets `translate() scale()` (state in `frame._z`); swipe and dismiss are off while zoomed.
- On phones (≤ 760 px) reels open in the swipe feed (`.feed`, scroll-snap), not the viewer. One shared `<video>` moves between slides so iOS keeps sound unlocked. Opening the viewer or feed pushes a history entry, so Back closes it.
- The viewer shows a "set" (`cur`): the filtered photo list or `REELS`. Reel frames get a `<video>`, a scrubber (click / drag / hover time tip, ←/→ ±5 s when focused), a centred "Paused" mark, Play/Sound chips and a live glow re-sampled from the video every 200 ms. Deep links: `?p=014` photo, `?m=03` reel.
- Ambient glow is painted into a ~96 px canvas (`paintGlow`) with a hand-rolled box blur and stretched. Do NOT use canvas `ctx.filter` (Safari ignores it, which showed a pixelated copy on iPhones) or CSS `filter: blur()` + `mask-image` on a large layer.
- In-page links use `smoothScrollTo` (own ease-in-out, 450–1100 ms by distance, cancels on wheel/touch/key, instant under reduced motion); `#work` targets `.work` so the sticky filter bar doesn't cover row one. The ↑ button (`.to-top`) shows once `.intro` is scrolled past and jumps instantly.

## Media pipeline
- `photos-src/` and `reels-src/` hold source media (gitignored; currently Instagram exports: photos 1080–1440 px without EXIF, reels 720p/1080p). Only their `captions.json` + `_instagram.json` are committed.
- `captions.json` controls title / place / date / series / order / hidden. Photo series keys: streets, machines, places, people, land. 7 reels are hidden on purpose (memes, text-hook BTS, podcast clip).
- `npm run media` (or `photos` / `reels`) → `site/photos/`, `site/reels/`, `site/photos.js`, `site/reels.js`. Reels are re-encoded to H.264 ≤ 720p (Instagram serves VP9, which iPhones can't play); lean 720p H.264 sources are kept as-is. Bumping `ENCODE` in `prepare-reels.mjs` re-encodes all. Reads EXIF + Fujifilm film simulation when present. Extracted reel frames go to `reels-src/.frames/`, not `site/`.
- Preview: `npm run dev` → http://localhost:5188 (`tools/serve.mjs` supports HTTP Range, which video seeking needs).

## Deploy
- GitHub: https://github.com/TreeBee21/keem-portfolio (public). `gh` can't store its token on this PC (Windows Credential Manager write fails); `git push` works through Git Credential Manager.
- Vercel: project `keem-portfolio`, team `hydroone030-5468s-projects`, Git-connected — every push to `main` deploys production to https://keem-portfolio.vercel.app.
- `vercel.json` serves `site/` as-is with no install/build (build takes ~1 s). Keep it that way; the media tools are dev-only.
