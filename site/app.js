/* Keem — photography portfolio
 *
 * Reads the manifests written by the media pipeline (photos.js → window.KEEM_PHOTOS,
 * reels.js → window.KEEM_REELS) and builds:
 *   1. the photo contact sheet (justified rows + series filters)
 *   2. the Motion section (reels, silent previews on hover)
 *   3. the viewer: ripple-zoom open/close, ambient glow, video controls, gestures
 *   4. page navigation (eased section scrolling, back to top, deep links)
 *
 * Motion spec for the viewer
 *   Open:  the clicked frame flies to centre (520 ms, ease-out-quint). Every other tile pushes
 *          away from the click, scales to .9, blurs 6 px and fades (460 ms transform / 380 ms
 *          fade), staggered by distance (≤ 70 ms).
 *   Close: the reverse, converging on whichever frame is current.
 */
(() => {
  'use strict';

  /* ── Constants ─────────────────────────────────────────── */
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const EASE_FADE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const canHover = matchMedia('(hover: hover) and (pointer: fine)');

  const CATS = { all: 'All', streets: 'Streets', machines: 'Machines', places: 'Food & Places', people: 'People', land: 'Land' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ── Helpers ───────────────────────────────────────────── */
  const $ = (s, el = document) => el.querySelector(s);
  const pad = (n, l = 3) => String(n).padStart(l, '0');
  const label = (p) => (p.kind === 'reel' ? `M${pad(p.no, 2)}` : pad(p.no));
  const fmtDur = (s) => { const t = Math.round(s || 0); return `${Math.floor(t / 60)}:${pad(t % 60, 2)}`; };
  const fmtDate = (d) => { const [y, m, day] = d.split('-'); return `${+day} ${MONTHS[+m - 1]} ${y}`; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  // "#work" lands on the filter bar (not the grid under it), everything else on its own element
  const sectionFor = (id) => (id === 'work' ? $('.work') : document.getElementById(id));
  const pick = (sizes, w) => sizes.find((s) => s >= w) ?? sizes[sizes.length - 1];

  /* ── Data ──────────────────────────────────────────────── */
  const PM = window.KEEM_PHOTOS;
  const PHOTOS = (PM?.items || []).map((x, i) => {
    const file = (s) => `${PM.base}${x.id}-${s}.webp`;
    return {
      kind: 'photo', no: i + 1, id: x.id, r: x.w / x.h, c: x.c, cat: x.cat,
      title: x.title, place: x.place, date: x.date, chips: x.chips, sim: x.sim,
      src: (w) => file(pick(x.sizes, w)),
      srcset: x.sizes.map((s) => `${file(s)} ${s}w`).join(', '),
      wall: (kind) => `${PM.base}${x.id}-wall-${kind}.jpg`,
    };
  });

  const RM = window.KEEM_REELS;
  const REELS = (RM?.items || []).map((x, i) => {
    const file = (s) => `${RM.base}${x.id}-poster-${s}.webp`;
    return {
      kind: 'reel', no: i + 1, id: x.id, r: x.w / x.h, c: x.c,
      title: x.title, place: x.place, date: x.date, dur: x.dur, code: x.code,
      video: `${RM.base}${x.id}.mp4`, preview: `${RM.base}${x.id}-preview.mp4`,
      src: (w) => file(pick(x.posters, w)),
      srcset: x.posters.map((s) => `${file(s)} ${s}w`).join(', '),
    };
  });

  /* ── Page elements & state ─────────────────────────────── */
  const root = document.documentElement;
  const page = $('.page');
  const sheet = $('.sheet');
  const reelsEl = $('.reels');
  const filtersBar = $('.filters');
  const filtersEl = $('.filters-list');
  const countEl = $('[data-count]');

  let filter = 'all';
  let list = PHOTOS.slice(); // photos in the current filter, in grid order

  /* ── Tiles ─────────────────────────────────────────────── */
  function makeTile(p, host) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.style.setProperty('--c', p.c);
    b.setAttribute('aria-label', p.kind === 'reel'
      ? `Play reel ${label(p)}: ${p.title}, ${fmtDur(p.dur)}`
      : `Open frame ${label(p)}: ${p.title}${p.place ? `, ${p.place}` : ''}`);

    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    img.addEventListener('transitionend', (e) => { if (e.propertyName === 'filter') img.classList.add('is-developed'); });

    const cap = document.createElement('span');
    cap.className = 'tile-cap';
    cap.innerHTML = `<span class="tile-no">${label(p)}</span><span></span>`;
    cap.lastChild.textContent = p.title;
    b.append(img, cap);

    if (p.kind === 'reel') {
      const dur = document.createElement('span');
      dur.className = 'reel-dur';
      dur.innerHTML = `<svg viewBox="0 0 7 8" aria-hidden="true"><path d="M0 0l7 4-7 4z"/></svg>${fmtDur(p.dur)}`;
      b.append(dur);
    }
    host.append(b);
    p.el = b;
    p.img = img;
  }

  PHOTOS.forEach((p) => {
    makeTile(p, sheet);
    p.el.addEventListener('click', () => open(list.indexOf(p), { set: 'photos' }));
  });
  REELS.forEach((p) => {
    makeTile(p, reelsEl);
    p.el.addEventListener('click', () => open(REELS.indexOf(p), { set: 'reels' }));
    p.el.addEventListener('pointerenter', () => startPreview(p));
    p.el.addEventListener('pointerleave', () => stopPreview(p));
  });
  countEl.textContent = pad(list.length);
  $('[data-reel-count]').textContent = pad(REELS.length, 2);
  if (!REELS.length) {
    $('.motion').hidden = true;
    $('[data-motion-link]').hidden = true;
  }

  // Silent 8-second preview on hover (desktop only), fetched the first time a tile is hovered
  function startPreview(p) {
    if (!canHover.matches || reduce.matches || isOpen) return;
    let v = p.el._pv;
    if (!v) {
      v = document.createElement('video');
      v.className = 'reel-preview';
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true');
      v.src = p.preview;
      v.addEventListener('playing', () => { if (p.el.matches(':hover')) p.el.classList.add('is-previewing'); });
      p.img.after(v);
      p.el._pv = v;
    }
    v.currentTime = 0;
    v.play().catch(() => {});
  }
  function stopPreview(p) {
    if (!p.el._pv) return;
    p.el.classList.remove('is-previewing');
    p.el._pv.pause();
  }

  /* ── Justified rows ────────────────────────────────────── */
  function metrics(W) {
    if (W >= 1400) return { T: 340, g: 6 };
    if (W >= 1000) return { T: 300, g: 6 };
    if (W >= 640) return { T: 230, g: 5 };
    return { T: 160, g: 4 };
  }

  // Optimal row breaks (DP): every row lands as close to the target height as possible,
  // and a sparse, un-justified last row is penalised so we never strand one lonely frame.
  function buildRows(rs, W, T, g) {
    const N = rs.length;
    const best = new Array(N + 1).fill(Infinity);
    const from = new Array(N + 1).fill(0);
    best[0] = 0;
    for (let j = 1; j <= N; j++) {
      let sum = 0;
      for (let i = j - 1; i >= 0 && j - i <= 12; i--) {
        sum += rs[i];
        const n = j - i;
        const h = (W - g * (n - 1)) / sum;
        let cost;
        if (j === N && h > T * 1.15) {
          const fill = (sum * T + g * (n - 1)) / W;
          cost = 0.6 * (1 - fill) ** 2;
        } else {
          if (h < T * 0.55 && n > 1) break; // rows only get shorter as more frames join
          cost = ((h - T) / T) ** 2;
        }
        if (best[i] + cost < best[j]) { best[j] = best[i] + cost; from[j] = i; }
      }
    }
    const rows = [];
    for (let j = N; j > 0; j = from[j]) {
      const i = from[j];
      let sum = 0;
      for (let k = i; k < j; k++) sum += rs[k];
      const h = (W - g * (j - i - 1)) / sum;
      rows.unshift({ s: i, e: j, h: j === N && h > T * 1.15 ? T : h });
    }
    return rows;
  }

  function layoutInto(host, items, scale) {
    const W = host.clientWidth;
    if (!W || !items.length) return;
    const m = metrics(W);
    const T = m.T * scale, g = m.g;
    let y = 0;
    for (const row of buildRows(items.map((p) => p.r), W, T, g)) {
      let x = 0;
      for (let i = row.s; i < row.e; i++) {
        const p = items[i];
        const w = p.r * row.h;
        const L = Math.round(x), R = Math.round(x + w);
        const Tp = Math.round(y), B = Math.round(y + row.h);
        Object.assign(p.el.style, { left: `${L}px`, top: `${Tp}px`, width: `${R - L}px`, height: `${B - Tp}px` });
        p.img.sizes = `${R - L}px`;
        x += w + g;
      }
      y += row.h + g;
    }
    host.style.height = `${Math.max(0, Math.round(y - g))}px`;
  }
  const layout = () => layoutInto(sheet, list, 1);
  const layoutReels = () => layoutInto(reelsEl, REELS, 1.35); // reels are mostly tall 9:16, so rows run taller

  layout();
  layoutReels();

  // Assign sources after the first layout so `sizes` is already correct
  [...PHOTOS, ...REELS].forEach((p, i) => {
    if (i < 8) p.img.setAttribute('fetchpriority', i < 4 ? 'high' : 'auto');
    else p.img.loading = 'lazy';
    p.img.srcset = p.srcset;
    p.img.src = p.src(800);
    if (p.img.complete && p.img.naturalWidth) p.img.classList.add('is-loaded');
  });

  // The browser jumps to #motion etc. before the grids have their height — redo it now they do
  if (location.hash.length > 1) sectionFor(location.hash.slice(1))?.scrollIntoView();

  let lastW = sheet.clientWidth;
  new ResizeObserver(() => {
    const w = sheet.clientWidth;
    if (w !== lastW) { lastW = w; layout(); layoutReels(); }
  }).observe(sheet);

  /* ── Filters ───────────────────────────────────────────── */
  const counts = { all: PHOTOS.length };
  PHOTOS.forEach((p) => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
  filtersEl.innerHTML = Object.entries(CATS).filter(([k]) => counts[k]).map(([k, v]) =>
    `<button type="button" class="filter" data-cat="${k}" aria-pressed="${k === 'all'}">${v.replace('&', '&amp;')}<span class="filter-n">${pad(counts[k], 2)}</span></button>`
  ).join('');
  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('.filter');
    if (b) setFilter(b.dataset.cat);
  });

  new IntersectionObserver(([e]) => filtersBar.classList.toggle('is-stuck', !e.isIntersecting))
    .observe($('.stick-sentinel'));

  let reflowTimer;
  function setFilter(cat) {
    if (cat === filter) return;
    filter = cat;
    filtersEl.querySelectorAll('.filter').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));

    const next = PHOTOS.filter((p) => cat === 'all' || p.cat === cat);
    const nextSet = new Set(next);
    const prevSet = new Set(list);
    list = next;
    countEl.textContent = pad(list.length);
    const still = reduce.matches;

    // Leaving: fade out, then drop from the layout
    prevSet.forEach((p) => {
      if (nextSet.has(p)) return;
      const t = p.el;
      t.tabIndex = -1;
      t.style.pointerEvents = 'none';
      if (still) { t.hidden = true; return; }
      p.exit = t.animate(
        [{ opacity: 1, scale: 1, filter: 'blur(0px)' }, { opacity: 0, scale: 0.96, filter: 'blur(4px)' }],
        { duration: 240, easing: EASE_FADE, fill: 'forwards' }
      );
      p.exit.onfinish = () => { t.hidden = true; p.exit.cancel(); p.exit = null; };
    });

    // Entering: place without transition, then fade in
    const entering = next.filter((p) => !prevSet.has(p));
    entering.forEach((p) => {
      if (p.exit) { p.exit.onfinish = null; p.exit.cancel(); p.exit = null; }
      p.el.hidden = false;
      p.el.tabIndex = 0;
      p.el.style.pointerEvents = '';
      p.el.classList.add('is-placing');
    });

    // Staying tiles glide to their new spots (CSS transitions on left/top/width/height)
    if (!still) sheet.classList.add('is-reflowing');
    layout();
    void sheet.offsetWidth;
    entering.forEach((p, i) => {
      p.el.classList.remove('is-placing');
      if (!still) {
        p.el.animate(
          [{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)' }],
          { duration: 480, delay: 140 + Math.min(i * 22, 260), easing: EASE_OUT, fill: 'backwards' }
        );
      }
    });
    clearTimeout(reflowTimer);
    reflowTimer = setTimeout(() => sheet.classList.remove('is-reflowing'), 700);

    // Keep the sheet in view if the user had scrolled deep into a longer set
    const top = sheet.getBoundingClientRect().top + scrollY - filtersBar.offsetHeight - 8;
    if (scrollY > top) smoothScrollTo(top);
  }

  /* ── Viewer: elements & state ──────────────────────────── */
  const lb = $('.lb');
  const scrim = $('.lb-scrim', lb);
  const stage = $('.lb-stage', lb);
  const closeBtn = $('.lb-close', lb);
  const stripEl = $('.lb-strip', lb);
  const track = $('.lb-track', lb);
  const info = $('.lb-info', lb);
  const el = {
    kind: $('[data-lb-kind]', lb), no: $('[data-lb-no]', lb), series: $('[data-lb-series]', lb), pos: $('[data-lb-pos]', lb),
    title: $('[data-lb-title]', lb), meta: $('[data-lb-meta]', lb), exif: $('[data-lb-exif]', lb),
  };
  const ctl = {
    wrap: $('[data-lb-controls]', lb), play: $('[data-act="play"]', lb), sound: $('[data-act="sound"]', lb),
    time: $('[data-lb-time]', lb), ig: $('[data-lb-ig]', lb),
  };

  // `cur` is whichever set the viewer is showing: the (filtered) photo list or the reels
  let cur = list, idx = -1, frame = null, isOpen = false, closing = false;
  let soundOn = true; // remembered while browsing reels

  /* ── Viewer: frame geometry ────────────────────────────── */
  function fitRect(p) {
    const s = rectOf(stage);
    let w = s.w, h = w / p.r;
    if (h > s.h) { h = s.h; w = h * p.r; }
    return { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h };
  }
  function place(f, p) {
    const r = fitRect(p);
    Object.assign(f.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    f._rect = r;
    return r;
  }
  // Transform that maps frame rect `b` onto rect `a` (transform-origin: 0 0)
  const flip = (a, b) => `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${a.w / b.w}, ${a.h / b.h})`;
  const hiWidth = (r) => Math.min(2400, Math.ceil((r.w * Math.min(devicePixelRatio || 1, 2)) / 200) * 200);

  /* ── Viewer: frames ────────────────────────────────────── */
  function makeFrame(p) {
    const f = document.createElement('div');
    f.className = 'lb-frame';
    f.style.setProperty('--c', p.c);
    f.style.setProperty('--glow-o', glowStrength(p.c));

    // Ambient light: the photo's own colours spill into the darkroom around it
    const glow = document.createElement('canvas');
    glow.className = 'lb-glow';
    glow.setAttribute('aria-hidden', 'true');
    if (p.img.complete && p.img.naturalWidth) paintGlow(glow, p.img, p.r);
    else p.img.addEventListener('load', () => paintGlow(glow, p.img, p.r), { once: true });

    // The tile's already-loaded image shows instantly; the sharp version (or the video) fades in over it
    const photo = document.createElement('div');
    photo.className = 'lb-photo';
    const lo = document.createElement('img');
    lo.alt = '';
    lo.src = p.img.currentSrc || p.src(800);
    photo.append(lo);

    let hi = null;
    if (p.kind === 'reel') {
      const v = document.createElement('video');
      v.className = 'lb-video';
      v.playsInline = true;
      v.loop = true;
      v.preload = 'auto';
      v.setAttribute('aria-label', p.title);
      v.addEventListener('playing', () => v.classList.add('is-ready'), { once: true });
      v.src = p.video;

      const paused = document.createElement('span');
      paused.className = 'lb-paused';
      paused.setAttribute('aria-hidden', 'true');
      paused.innerHTML = '<svg viewBox="0 0 22 22"><rect x="5" y="4" width="4" height="14" rx="1" fill="currentColor"/><rect x="13" y="4" width="4" height="14" rx="1" fill="currentColor"/></svg>';

      const bar = document.createElement('div');
      bar.className = 'lb-progress';
      bar.tabIndex = 0;
      bar.setAttribute('role', 'slider');
      bar.setAttribute('aria-label', 'Seek');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(Math.round(p.dur)));
      bar.innerHTML = '<span class="lb-track-bg"></span><span class="lb-track-fill"></span><span class="lb-knob"></span><span class="lb-tip">0:00</span>';

      photo.append(v, paused, bar);
      f._video = v;
      f._bar = bar;
    } else {
      hi = document.createElement('img');
      hi.className = 'lb-hi';
      hi.alt = p.place ? `${p.title}, ${p.place}` : p.title;
      hi.decoding = 'async';
      hi.addEventListener('load', () => hi.classList.add('is-loaded'), { once: true });
      photo.append(hi);
    }

    f.append(glow, photo);
    f._glow = glow;
    f._r = p.r;
    lb.append(f);
    const r = place(f, p);
    if (hi) hi.src = p.src(hiWidth(r));
    if (f._video) wireVideo(f);
    return f;
  }

  // Stop a frame's playback and timers when it leaves the viewer
  function retire(f) {
    if (!f) return;
    f._retired = true; // don't flash the "Paused" mark on the way out
    f._video?.pause();
    clearInterval(f._glowTimer);
  }

  /* ── Viewer: ambient glow ──────────────────────────────── */
  // Paint at ~120 px: the photo in the middle 66% (the glow box is 190% of the photo), blurred and
  // saturated into an accumulation canvas, then faded out with an elliptical gradient so it melts
  // into black. `alpha` < 1 blends a new sample over the previous ones (used for live video).
  function paintGlow(canvas, src, r, alpha = 1) {
    const W = 120, H = Math.max(24, Math.round(W / r));
    let acc = canvas._acc;
    if (!acc) {
      canvas.width = W;
      canvas.height = H;
      acc = canvas._acc = document.createElement('canvas');
      acc.width = W;
      acc.height = H;
    }
    const a = acc.getContext('2d');
    const k = 0.17;
    a.globalAlpha = alpha;
    a.filter = `blur(${Math.round(W * 0.07)}px) saturate(1.9)`;
    a.drawImage(src, W * k, H * k, W * (1 - 2 * k), H * (1 - 2 * k));
    a.filter = 'none';
    a.globalAlpha = 1;

    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(acc, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, H / W);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
    g.addColorStop(0, '#000');
    g.addColorStop(0.62, '#000');             // full strength right up to the photo's edge…
    g.addColorStop(0.82, 'rgba(0,0,0,0.35)'); // …then a long, soft falloff into the black
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-W / 2, -W / 2, W, W);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Dark photos get a stronger glow so they still lift off the background; bright ones stay subtle
  function glowStrength(c) {
    const n = parseInt(c.slice(1), 16);
    const L = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return Math.min(0.75, 0.95 - L * 0.6).toFixed(2);
  }
  function glowIn(f, duration, delay) {
    const g = f._glow;
    g.animate([{ opacity: 0 }, { opacity: getComputedStyle(g).opacity }], { duration, delay, easing: EASE_FADE, fill: 'backwards' });
  }
  function glowOut(f, duration) {
    const g = f._glow;
    const from = getComputedStyle(g).opacity;
    g.getAnimations().forEach((a) => a.cancel());
    g.style.opacity = '0';
    g.animate([{ opacity: from }, { opacity: 0 }], { duration, easing: EASE_FADE });
  }

  /* ── Viewer: video ─────────────────────────────────────── */
  function wireVideo(f) {
    const v = f._video, bar = f._bar, tip = $('.lb-tip', bar);

    // Playhead: driven every frame while playing so the line moves smoothly, not in 250 ms steps
    const showTime = () => {
      if (!v.duration) return;
      bar.style.setProperty('--p', v.currentTime / v.duration);
      bar.setAttribute('aria-valuenow', String(Math.round(v.currentTime)));
      bar.setAttribute('aria-valuetext', `${fmtDur(v.currentTime)} of ${fmtDur(v.duration)}`);
      if (f === frame) ctl.time.textContent = `${fmtDur(v.currentTime)} / ${fmtDur(v.duration)}`;
    };
    const loop = () => {
      showTime();
      f._raf = !v.paused && f.isConnected ? requestAnimationFrame(loop) : null;
    };
    ['timeupdate', 'seeked', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, showTime));
    ['play', 'pause', 'volumechange'].forEach((ev) => v.addEventListener(ev, () => { if (f === frame) syncControls(); }));

    v.addEventListener('play', () => {
      f.classList.remove('is-paused');
      if (!f._raf) f._raf = requestAnimationFrame(loop);
      // Live ambient light: re-sample the playing frame a few times a second, blended over the
      // previous samples so the glow drifts with the footage instead of flickering
      f._glowTimer ??= setInterval(() => {
        if (!v.paused && v.readyState >= 2) paintGlow(f._glow, v, f._r, 0.35);
      }, 200);
    });
    v.addEventListener('pause', () => { if (!f._retired) f.classList.add('is-paused'); });

    // Scrubbing: click to jump, drag to scrub, hover to read the time under the cursor
    const hover = (e) => {
      const r = bar.getBoundingClientRect();
      const x = e.clientX - r.left;
      const k = Math.min(1, Math.max(0, x / r.width));
      bar.style.setProperty('--h', k);
      bar.style.setProperty('--tip-x', `${Math.min(r.width - 24, Math.max(24, x))}px`); // keep the tip inside the frame
      tip.textContent = fmtDur(k * (v.duration || 0));
      return k;
    };
    const seek = (k) => {
      if (!v.duration) return;
      v.currentTime = k * v.duration;
      showTime();
    };
    let scrubbing = false;
    bar.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // seeking, not dragging or tapping the frame
      e.preventDefault();
      scrubbing = true;
      bar.classList.add('is-scrubbing');
      seek(hover(e));
      try { bar.setPointerCapture(e.pointerId); } catch {} // keep scrubbing if the pointer leaves the bar
    });
    bar.addEventListener('pointermove', (e) => {
      const k = hover(e);
      if (scrubbing) seek(k);
    });
    const endScrub = (e) => {
      e.stopPropagation();
      scrubbing = false;
      try { bar.releasePointerCapture(e.pointerId); } catch {}
      bar.classList.remove('is-scrubbing');
    };
    bar.addEventListener('pointerup', endScrub);
    bar.addEventListener('pointercancel', endScrub);
    bar.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 5, ArrowLeft: -5, ArrowUp: 5, ArrowDown: -5 }[e.key];
      if (step == null && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      e.stopPropagation(); // arrows seek here instead of changing reel
      if (e.key === 'Home') v.currentTime = 0;
      else if (e.key === 'End') v.currentTime = Math.max(0, (v.duration || 0) - 0.5);
      else v.currentTime = Math.min(v.duration || 0, Math.max(0, v.currentTime + step));
      showTime();
    });
  }

  function playFrame(f) {
    const v = f?._video;
    if (!v) return;
    v.muted = !soundOn;
    v.play().catch(() => {
      // Autoplay with sound refused (e.g. opened from a link, no click yet): fall back to muted
      v.muted = true;
      soundOn = false;
      syncControls();
      v.play().catch(() => f.classList.add('is-paused')); // can't autoplay at all: show it's waiting for a tap
    });
  }
  function togglePlay() {
    const v = frame?._video;
    if (!v) return;
    if (v.paused) playFrame(frame); else v.pause();
  }
  function toggleSound() {
    const v = frame?._video;
    if (!v) return;
    soundOn = v.muted;
    v.muted = !soundOn;
  }
  function syncControls() {
    const v = frame?._video;
    if (!v) return;
    ctl.play.textContent = v.paused ? 'Play' : 'Pause';
    ctl.play.setAttribute('aria-label', v.paused ? 'Play reel' : 'Pause reel');
    ctl.sound.textContent = v.muted ? 'Sound off' : 'Sound on';
    ctl.sound.classList.toggle('is-on', !v.muted);
    ctl.sound.setAttribute('aria-pressed', String(!v.muted));
  }
  ctl.play.addEventListener('click', togglePlay);
  ctl.sound.addEventListener('click', toggleSound);

  /* ── Viewer: save as wallpaper ─────────────────────────── */
  // Pre-cropped at build time on the photo's point of interest: a tall crop for phones, 16:9 for
  // desktops. Phones get the native share sheet ("Save Image" → Photos); desktops a download.
  // Sharing needs a fresh tap, so if fetching took too long the button asks for one more tap.
  const wallWrap = $('[data-lb-actions]', lb);
  const wallBtn = $('[data-act="wallpaper"]', lb);
  const handheld = matchMedia('(max-width: 760px), (pointer: coarse)');
  let wallBlob = null;

  wallBtn.addEventListener('click', async () => {
    const p = cur[idx];
    if (!p?.wall) return;
    const kind = handheld.matches ? 'phone' : 'desktop';
    const name = `keem-${p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-wallpaper.jpg`;
    try {
      if (!wallBlob || wallBlob.kind !== kind) {
        wallBtn.textContent = 'Preparing…';
        const blob = await fetch(p.wall(kind)).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
        if (cur[idx] !== p) return; // moved on while it loaded
        wallBlob = { kind, blob };
      }
      const file = new File([wallBlob.blob], name, { type: 'image/jpeg' });
      if (kind === 'phone' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: p.title });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(wallBlob.blob);
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      wallBtn.textContent = '✓ Saved';
    } catch (err) {
      if (err?.name === 'AbortError') { wallBtn.textContent = '↓ Wallpaper'; return; } // share sheet dismissed
      wallBtn.textContent = err?.name === 'NotAllowedError' && wallBlob ? 'Tap to save' : 'Try again';
    }
  });

  /* ── Viewer: ripple, scrim, caption, strip ─────────────── */
  function scrimTo(v, duration, delay = 0) {
    const from = getComputedStyle(scrim).opacity;
    scrim._a?.cancel();
    scrim.style.opacity = v;
    scrim._a = scrim.animate([{ opacity: from }, { opacity: v }], { duration, delay, easing: EASE_FADE, fill: 'backwards' });
  }

  const GONE = { scale: 0.9, filter: 'blur(6px)', opacity: 0 };
  function setGone(t) {
    t._rip?.forEach((a) => a.cancel());
    const k = { translate: '0px 0px', ...GONE };
    t._rip = [t.animate([k, k], { duration: 1, fill: 'forwards' })];
  }

  function ripple(origin, dir, instant) {
    const o = centre(rectOf(origin.el));
    const vh = innerHeight;
    cur.forEach((p) => {
      if (p === origin) return;
      const t = p.el;
      const r = rectOf(t);
      const c = centre(r);
      const dx = c.x - o.x, dy = c.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const push = 64 * Math.max(0.45, 1 - d / 1600);
      const off = `${((dx / d) * push).toFixed(1)}px ${((dy / d) * push).toFixed(1)}px`;
      const k = instant || r.y + r.h < -80 || r.y > vh + 80 ? 0 : 1; // off-screen tiles jump straight to the end state
      const old = t._rip || [];

      if (dir === 'out') {
        const delay = Math.min(d * 0.045, 70) * k;
        t._rip = [
          t.animate([{ translate: '0px 0px', scale: 1 }, { translate: off, scale: GONE.scale }],
            { duration: 460 * k, delay, easing: EASE_OUT, fill: 'both' }),
          t.animate([{ filter: 'blur(0px)', opacity: 1 }, { filter: GONE.filter, opacity: 0 }],
            { duration: 380 * k, delay, easing: EASE_FADE, fill: 'both' }),
        ];
      } else {
        // Start from wherever the tile is now; if it is fully gone, re-aim it relative to the landing frame
        const cs = getComputedStyle(t);
        const gone = +cs.opacity < 0.05;
        const fromT = gone ? { translate: off, scale: GONE.scale }
          : { translate: cs.translate === 'none' ? '0px 0px' : cs.translate, scale: cs.scale === 'none' ? 1 : cs.scale };
        const fromF = gone ? { filter: GONE.filter, opacity: 0 }
          : { filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter, opacity: cs.opacity };
        const delay = Math.min(d * 0.035, 60) * k;
        t._rip = [
          t.animate([fromT, { translate: '0px 0px', scale: 1 }], { duration: 420 * k, delay, easing: EASE_OUT, fill: 'backwards' }),
          t.animate([fromF, { filter: 'blur(0px)', opacity: 1 }], { duration: 340 * k, delay, easing: EASE_FADE, fill: 'backwards' }),
        ];
      }
      old.forEach((a) => a.cancel());
    });
  }

  function setInfo(p, animate) {
    const reel = p.kind === 'reel';
    el.kind.textContent = reel ? 'Reel' : 'Frame';
    el.no.textContent = reel ? pad(p.no, 2) : pad(p.no);
    el.series.textContent = reel ? 'Motion' : CATS[p.cat] || 'Unsorted';
    el.pos.textContent = `${pad(idx + 1, 2)} / ${pad(cur.length, 2)}`;
    el.title.textContent = p.title;
    el.meta.textContent = [p.place, p.date && fmtDate(p.date)].filter(Boolean).join(' · ');

    // Camera settings (only when the original file carried EXIF)
    el.exif.replaceChildren(...(p.chips || []).map((t) => Object.assign(document.createElement('li'), { className: 'chip', textContent: t })));
    if (p.sim) el.exif.append(Object.assign(document.createElement('li'), { className: 'chip chip-sim', textContent: p.sim }));
    el.exif.hidden = !el.exif.children.length;
    el.exif.scrollLeft = 0;

    ctl.wrap.hidden = !reel;
    wallWrap.hidden = reel;
    wallBtn.textContent = '↓ Wallpaper';
    wallBlob = null;
    if (reel) {
      ctl.time.textContent = `0:00 / ${fmtDur(p.dur)}`;
      ctl.ig.hidden = !p.code;
      if (p.code) ctl.ig.href = `https://www.instagram.com/reel/${p.code}/`;
    }
    if (animate && !reduce.matches) {
      [info.firstElementChild, reel ? ctl.wrap : el.exif].forEach((n, i) => n.animate(
        [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }],
        { duration: 360, delay: i * 40, easing: EASE_OUT, fill: 'backwards' }
      ));
    }
    markStrip();
  }

  function buildStrip() {
    track.replaceChildren(...cur.map((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb';
      b.style.setProperty('--r', p.r);
      b.style.setProperty('--c', p.c);
      b.setAttribute('aria-label', `${p.kind === 'reel' ? 'Reel' : 'Frame'} ${label(p)}: ${p.title}`);
      const im = document.createElement('img');
      im.alt = '';
      im.loading = 'lazy';
      im.src = p.src(200);
      b.append(im);
      b.addEventListener('click', () => go(i));
      return b;
    }));
  }
  function markStrip() {
    [...track.children].forEach((b, i) => {
      const on = i === idx;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    // Mid-resize the thumbnails are still changing width, so follow the active one frame by frame
    if (stripHold) stripHold.target = centreActive;
    else if (track.children[idx]) stripEl.scrollTo({ left: centreActive(), behavior: reduce.matches ? 'auto' : 'smooth' });
  }
  const centreActive = () => {
    const a = track.children[idx];
    return a ? a.offsetLeft - (stripEl.clientWidth - a.offsetWidth) / 2 : stripEl.scrollLeft;
  };

  /* ── Viewer: thumbnail strip grows while it's used (phones) ── */
  // Touching or swiping the strip enlarges the thumbnails so they're easy to see and hit; it
  // shrinks back a moment after the last touch / scroll. While the size animates, the thumbnail
  // under the finger (or the active one, after a tap) is held in place.
  const compact = matchMedia('(max-width: 760px), (hover: none)');
  let stripHold = null, stripTimer;

  function holdStrip(target, ms = 380) {
    if (stripHold) cancelAnimationFrame(stripHold.raf);
    const t0 = performance.now();
    const hold = stripHold = { target };
    const tick = (now) => {
      if (stripHold !== hold) return;
      stripEl.scrollLeft = hold.target();
      if (now - t0 < ms) hold.raf = requestAnimationFrame(tick);
      else stripHold = null;
    };
    hold.raf = requestAnimationFrame(tick);
  }
  function releaseStrip() {
    if (stripHold) cancelAnimationFrame(stripHold.raf);
    stripHold = null;
  }
  function sizeStrip(open, anchorX = stripEl.clientWidth / 2) {
    if (open === stripEl.classList.contains('is-expanded')) return;
    const k = (stripEl.scrollLeft + anchorX) / stripEl.scrollWidth; // point that stays put
    stripEl.classList.toggle('is-expanded', open);
    if (reduce.matches) return;
    holdStrip(() => k * stripEl.scrollWidth - anchorX);
  }
  function shrinkStripSoon() {
    clearTimeout(stripTimer);
    stripTimer = setTimeout(() => sizeStrip(false), 1600);
  }
  function resetStrip() {
    clearTimeout(stripTimer);
    releaseStrip();
    stripEl.classList.remove('is-expanded');
  }

  stripEl.addEventListener('pointerdown', (e) => {
    if (!compact.matches) return;
    clearTimeout(stripTimer);
    sizeStrip(true, e.clientX - stripEl.getBoundingClientRect().left);
  });
  stripEl.addEventListener('touchmove', releaseStrip, { passive: true }); // the finger takes over scrolling
  ['pointerup', 'pointercancel'].forEach((ev) => stripEl.addEventListener(ev, () => {
    if (stripEl.classList.contains('is-expanded')) shrinkStripSoon();
  }));
  stripEl.addEventListener('scroll', () => {
    if (stripEl.classList.contains('is-expanded') && !stripHold) shrinkStripSoon(); // momentum keeps it open
  }, { passive: true });

  function preload(i) {
    [1, -1].forEach((d) => {
      const p = cur[(i + d + cur.length) % cur.length];
      if (p) new Image().src = p.src(hiWidth(fitRect(p)));
    });
  }

  const setURL = (p) => {
    const q = p ? (p.kind === 'reel' ? `?m=${pad(p.no, 2)}` : `?p=${pad(p.no)}`) : location.pathname;
    try { history.replaceState(null, '', q); } catch {} // file:// can refuse
  };

  /* ── Viewer: open / navigate / close ───────────────────── */
  function open(i, { instant = false, set = 'photos' } = {}) {
    if (isOpen || i < 0) return;
    cur = set === 'reels' ? REELS : list;
    const p = cur[i];
    if (!p) return;
    isOpen = true;
    idx = i;
    if (p.kind === 'reel') stopPreview(p);
    const still = instant || reduce.matches;

    root.classList.add('is-locked');
    page.inert = true;
    lb.classList.add('is-open');
    lb.setAttribute('aria-hidden', 'false');
    resetStrip();
    buildStrip();
    setInfo(p, false);

    const from = rectOf(p.el);
    frame = makeFrame(p);
    p.el.style.visibility = 'hidden';

    if (still) {
      frame._anim = frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_FADE });
      scrimTo(1, 220);
      ripple(p, 'out', true);
      glowIn(frame, 300, 0);
    } else {
      frame._anim = frame.animate([{ transform: flip(from, frame._rect) }, { transform: 'none' }], { duration: 520, easing: EASE_OUT });
      scrimTo(1, 400);
      ripple(p, 'out', false);
      glowIn(frame, 1000, 240); // light "warms up" as the photo lands
    }
    requestAnimationFrame(() => lb.classList.add('show-chrome'));
    closeBtn.focus({ preventScroll: true });
    playFrame(frame); // still inside the click, so sound is allowed
    syncControls();
    preload(i);
    setURL(p);
  }

  function go(i, dir) {
    if (!isOpen || closing || !frame) return;
    const n = cur.length;
    i = (i + n) % n;
    if (i === idx) return;
    dir = dir || (i > idx ? 1 : -1);
    const still = reduce.matches;
    const prev = cur[idx], p = cur[i];

    // The tile we are leaving goes back into the (hidden) grid
    prev.el.style.visibility = '';
    setGone(prev.el);

    const old = frame;
    retire(old);
    const from = getComputedStyle(old).transform;
    old._anim?.cancel();
    old.style.transform = '';
    old.classList.add('is-leaving');
    const shift = still ? 0 : 80;
    old.animate(
      [{ transform: from === 'none' ? 'translateX(0px)' : from, opacity: 1, filter: 'blur(0px)' },
       { transform: `translateX(${-dir * shift}px)`, opacity: 0, filter: 'blur(6px)' }],
      { duration: still ? 160 : 320, easing: EASE_FADE, fill: 'forwards' }
    ).onfinish = () => old.remove();

    idx = i;
    frame = makeFrame(p);
    frame._anim = frame.animate(
      [{ transform: `translateX(${dir * shift}px)`, opacity: 0, filter: 'blur(6px)' },
       { transform: 'none', opacity: 1, filter: 'blur(0px)' }],
      { duration: still ? 160 : 520, easing: EASE_OUT }
    );
    glowIn(frame, still ? 160 : 900, still ? 0 : 100);
    setInfo(p, true);
    playFrame(frame);
    syncControls();
    preload(i);
    setURL(p);
  }

  function close() {
    if (!isOpen || closing || !frame) return;
    closing = true;
    const p = cur[idx];
    const t = p.el;
    const still = reduce.matches;
    retire(frame);

    // Land on the current frame's tile — scroll it into view first (invisible under the scrim)
    t._rip?.forEach((a) => a.cancel());
    t._rip = null;
    t.style.visibility = 'hidden';
    let r = rectOf(t);
    const topSafe = (cur === REELS ? 0 : filtersBar.offsetHeight) + 12; // the filter bar only sticks over photos
    if (r.y < topSafe || r.y + r.h > innerHeight - 12) {
      scrollTo({ top: scrollY + r.y - Math.max(topSafe, (innerHeight - r.h) / 2), behavior: 'instant' });
      r = rectOf(t);
    }

    lb.classList.remove('show-chrome');
    resetStrip();
    lb.querySelectorAll('.lb-frame.is-leaving').forEach((x) => x.remove());

    const f = frame;
    const from = getComputedStyle(f).transform;
    f._anim?.cancel();
    f.style.transform = '';
    glowOut(f, 240); // the glow belongs to the darkroom, not the grid
    ripple(p, 'in', still);
    scrimTo(0, still ? 200 : 420, still ? 0 : 60);

    const a = still
      ? f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE_FADE, fill: 'forwards' })
      : f.animate([{ transform: from === 'none' ? 'none' : from }, { transform: flip(r, f._rect) }], { duration: 480, easing: EASE_OUT, fill: 'forwards' });
    a.onfinish = () => {
      t.style.visibility = '';
      f.remove();
      frame = null;
      lb.classList.remove('is-open', 'is-clean', 'is-dragging');
      lb.setAttribute('aria-hidden', 'true');
      root.classList.remove('is-locked');
      page.inert = false;
      isOpen = false;
      closing = false;
      t.focus({ preventScroll: true });
      setURL(null);
    };
  }

  /* ── Viewer: buttons, keys, resize ─────────────────────── */
  closeBtn.addEventListener('click', close);
  $('.lb-prev', lb).addEventListener('click', () => go(idx - 1, -1));
  $('.lb-next', lb).addEventListener('click', () => go(idx + 1, 1));

  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1, -1); }
    else if (frame?._video && (e.key === ' ' || e.key === 'k')) { e.preventDefault(); togglePlay(); }
    else if (frame?._video && e.key === 'm') { e.preventDefault(); toggleSound(); }
    else if (e.key === 'Tab') {
      // Keep focus inside the dialog
      const f = [...lb.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  addEventListener('resize', () => { if (isOpen && frame) place(frame, cur[idx]); });

  /* ── Viewer: gestures ──────────────────────────────────── */
  // Drag down to dismiss, swipe sideways to change, tap a photo to hide the chrome, tap a reel to pause
  let g = null;
  lb.addEventListener('pointerdown', (e) => {
    if (!isOpen || closing || e.button !== 0) return;
    const onFrame = e.target.closest('.lb-frame:not(.is-leaving)');
    const onBackdrop = e.target === stage || e.target === scrim;
    if (!onFrame && !onBackdrop) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: null, onFrame: !!onFrame, hist: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
  });

  lb.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id || !frame) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.hist.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (g.hist.length > 6) g.hist.shift();
    if (!g.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      g.mode = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'dismiss' : null) : 'swipe';
      if (!g.mode) { g = null; return; }
      frame._anim?.finish();
      scrim._a?.finish();
      frame._glow.getAnimations().forEach((a) => a.finish());
      g.glowO = +getComputedStyle(frame._glow).opacity;
      lb.classList.add('is-dragging');
      try { lb.setPointerCapture(e.pointerId); } catch {}
    }
    if (g.mode === 'dismiss') {
      const d = Math.max(0, dy);
      const s = 1 - Math.min(d, 500) / 1400;
      const r = frame._rect;
      frame.style.transform = `translate(${dx * 0.5 + (r.w * (1 - s)) / 2}px, ${d + (r.h * (1 - s)) / 2}px) scale(${s})`;
      scrim.style.opacity = String(1 - Math.min(d / 420, 0.85));
      frame._glow.style.opacity = String(g.glowO * (1 - Math.min(d / 280, 1)));
    } else {
      frame.style.transform = `translateX(${dx}px)`;
    }
  });

  function endDrag(e) {
    if (!g || e.pointerId !== g.id) return;
    const G = g;
    g = null;
    lb.classList.remove('is-dragging');
    if (!G.mode) {
      if (e.type === 'pointerup') {
        if (!G.onFrame) close();
        else if (frame?._video) togglePlay();
        else lb.classList.toggle('is-clean');
      }
      return;
    }
    const h0 = G.hist[0], h1 = G.hist[G.hist.length - 1];
    const dt = Math.max(1, h1.t - h0.t);
    const vx = (h1.x - h0.x) / dt, vy = (h1.y - h0.y) / dt;
    const dx = e.clientX - G.x, dy = e.clientY - G.y;
    if (G.mode === 'dismiss' && (dy > 110 || vy > 0.55)) return close();
    if (G.mode === 'swipe' && (Math.abs(dx) > 70 || Math.abs(vx) > 0.45)) {
      const dir = dx < 0 ? 1 : -1;
      return go(idx + dir, dir);
    }
    // Not far enough — settle back
    const from = getComputedStyle(frame).transform;
    frame.style.transform = '';
    frame.animate([{ transform: from }, { transform: 'none' }], { duration: 380, easing: EASE_OUT });
    scrimTo(1, 280);
    const glowNow = frame._glow.style.opacity;
    if (glowNow) {
      frame._glow.style.opacity = '';
      frame._glow.animate([{ opacity: glowNow }, { opacity: G.glowO }], { duration: 380, easing: EASE_FADE });
    }
  }
  lb.addEventListener('pointerup', endDrag);
  lb.addEventListener('pointercancel', endDrag);

  /* ── Page navigation ───────────────────────────────────── */
  // Our own eased scroll instead of CSS `scroll-behavior`, so long jumps (top → Contact) don't
  // crawl and short ones don't snap. Any wheel / touch / key input hands control straight back.
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let scrollRaf = null;
  const cancelScroll = () => { if (scrollRaf) cancelAnimationFrame(scrollRaf); scrollRaf = null; };
  ['wheel', 'touchstart', 'keydown'].forEach((ev) => addEventListener(ev, cancelScroll, { passive: true }));

  function smoothScrollTo(y) {
    cancelScroll();
    y = Math.max(0, Math.min(y, root.scrollHeight - innerHeight));
    const start = scrollY, dist = y - start;
    if (reduce.matches || Math.abs(dist) < 2) { scrollTo({ top: y, behavior: 'instant' }); return; }
    const duration = Math.min(1100, Math.max(450, Math.abs(dist) * 0.3));
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      scrollTo({ top: start + dist * easeInOut(k), behavior: 'instant' });
      scrollRaf = k < 1 ? requestAnimationFrame(step) : null;
    };
    scrollRaf = requestAnimationFrame(step);
  }

  // In-page links (menu, skip link) glide to their section
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = a.getAttribute('href').slice(1);
    const target = id && sectionFor(id);
    if (!target) return;
    e.preventDefault();
    smoothScrollTo(target.getBoundingClientRect().top + scrollY);
    try { history.replaceState(null, '', `#${id}`); } catch {}
    // Move keyboard / screen-reader focus to the section without a second jump
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  // Back to top: appears once the intro is scrolled past, jumps instantly
  const toTop = $('.to-top');
  new IntersectionObserver(([e]) => toTop.classList.toggle('is-visible', !e.isIntersecting && e.boundingClientRect.top < 0))
    .observe($('.intro'));
  toTop.addEventListener('click', () => {
    cancelScroll();
    scrollTo({ top: 0, behavior: 'instant' });
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    $('.brand').focus({ preventScroll: true });
  });

  // Deep links: ?p=014 opens a photo, ?m=03 a reel
  const params = new URLSearchParams(location.search);
  const qp = +params.get('p'), qm = +params.get('m');
  if (qp) {
    const i = list.findIndex((p) => p.no === qp);
    if (i > -1) requestAnimationFrame(() => open(i, { instant: true }));
  } else if (qm) {
    const i = REELS.findIndex((p) => p.no === qm);
    if (i > -1) requestAnimationFrame(() => open(i, { instant: true, set: 'reels' }));
  }
})();
