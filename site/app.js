/* Keem — photography portfolio
 *
 * Reads the manifests written by the media pipeline (photos.js → window.KEEM_PHOTOS,
 * reels.js → window.KEEM_REELS) and builds:
 *   1. the photo contact sheet (justified rows + series filters)
 *   2. the Motion section (reels, silent previews on hover)
 *   3. the viewer: ripple-zoom open/close, ambient glow, video controls, zoom, gestures
 *   4. the reel feed on phones: full-screen reels, swipe up / down between them
 *   5. page navigation (eased section scrolling, back to top, deep links, back button)
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
  const phone = matchMedia('(max-width: 760px)');

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
      sizes: x.sizes,
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
  let isOpen = false, feedOpen = false; // viewer / reel feed showing

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
    p.el.addEventListener('click', () => (phone.matches ? openFeed(REELS.indexOf(p)) : open(REELS.indexOf(p), { set: 'reels' })));
    p.el.addEventListener('pointerenter', () => startPreview(p));
    p.el.addEventListener('pointerleave', () => stopPreview(p));
  });
  countEl.textContent = pad(list.length);
  $('[data-reel-count]').textContent = pad(REELS.length, 2);
  if (!canHover.matches) $('[data-reel-hint]').textContent = 'tap to watch with sound';
  if (!REELS.length) {
    $('.motion').hidden = true;
    $('[data-motion-link]').hidden = true;
  }

  // Silent 8-second preview on hover (desktop), or for the reel in the middle of the screen
  // (phones, `auto`). Fetched the first time it's needed.
  function startPreview(p, auto = false) {
    if ((!auto && !canHover.matches) || reduce.matches || isOpen || feedOpen || p.want) return;
    p.want = true;
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
      v.addEventListener('playing', () => { if (p.want) p.el.classList.add('is-previewing'); });
      p.img.after(v);
      p.el._pv = v;
    }
    v.currentTime = 0;
    v.play().catch(() => {});
  }
  function stopPreview(p) {
    p.want = false;
    if (!p.el._pv) return;
    p.el.classList.remove('is-previewing');
    p.el._pv.pause();
  }

  // Phones have no hover, so the reel nearest the middle of the screen previews itself while scrolling
  if (!canHover.matches && !navigator.connection?.saveData) {
    let raf = 0, near = false;
    const pickPreview = () => {
      raf = 0;
      let best = null, bestD = Infinity;
      if (near && !isOpen && !feedOpen) {
        REELS.forEach((p) => {
          const r = p.el.getBoundingClientRect();
          const seen = (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height;
          const d = Math.abs(r.top + r.height / 2 - innerHeight / 2);
          if (seen > 0.7 && d < bestD) { best = p; bestD = d; }
        });
      }
      REELS.forEach((p) => (p === best ? startPreview(p, true) : stopPreview(p)));
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(pickPreview); };
    new IntersectionObserver(([e]) => { near = e.isIntersecting; queue(); }).observe(reelsEl);
    addEventListener('scroll', queue, { passive: true });
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
  let cur = list, idx = -1, frame = null, closing = false;
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
    f.className = p.kind === 'reel' ? 'lb-frame' : 'lb-frame is-photo';
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
      f._sync = () => { if (f === frame) syncControls(); };
      f._onTime = () => { if (f === frame) ctl.time.textContent = `${fmtDur(v.currentTime)} / ${fmtDur(v.duration)}`; };
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
    f._photo = photo;
    f._hi = hi;
    f._p = p;
    f._r = p.r;
    f._z = Z1;
    lb.append(f);
    const r = place(f, p);
    if (hi) hi.src = p.src(hiWidth(r));
    if (f._video) wireVideo(f);
    return f;
  }

  // Stop a frame's playback and timers when it leaves the viewer
  function retire(f) {
    if (!f) return;
    f._quiet = true; // don't flash the "Paused" mark on the way out
    f._video?.pause();
    clearInterval(f._glowTimer);
    f._glowTimer = null;
    if (f._fling) cancelAnimationFrame(f._fling);
  }

  /* ── Viewer: ambient glow ──────────────────────────────── */
  // Painted at ~96 px: the photo in the middle 66% of a darkroom-coloured box (the glow box is 190%
  // of the photo), blurred and saturated, then faded out with an elliptical gradient so it melts
  // into the black. The blur is done by hand (three box-blur passes, close to a gaussian) because
  // Safari ignores the canvas `filter` property, which left iPhones with a sharp, pixelated copy.
  // `alpha` < 1 blends a new sample over the previous ones (used for live video).
  const sampler = document.createElement('canvas');
  const sctx = sampler.getContext('2d', { willReadFrequently: true });

  function paintGlow(canvas, src, r, alpha = 1) {
    const W = 96, H = Math.max(20, Math.round(W / r)), N = W * H;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; canvas._px = null; }
    sampler.width = W;
    sampler.height = H;
    sctx.fillStyle = '#0d0c0b';
    sctx.fillRect(0, 0, W, H);
    const k = 0.17;
    let img;
    try {
      sctx.drawImage(src, W * k, H * k, W * (1 - 2 * k), H * (1 - 2 * k));
      img = sctx.getImageData(0, 0, W, H);
    } catch { return; } // source not decodable yet

    const d = img.data;
    let px = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { px[i * 3] = d[i * 4]; px[i * 3 + 1] = d[i * 4 + 1]; px[i * 3 + 2] = d[i * 4 + 2]; }
    const tmp = new Float32Array(N * 3);
    for (let pass = 0; pass < 3; pass++) boxBlur(px, tmp, W, H, 6);
    for (let i = 0; i < N * 3; i += 3) { // saturate ×1.9
      const l = 0.213 * px[i] + 0.715 * px[i + 1] + 0.072 * px[i + 2];
      px[i] = l + (px[i] - l) * 1.9;
      px[i + 1] = l + (px[i + 1] - l) * 1.9;
      px[i + 2] = l + (px[i + 2] - l) * 1.9;
    }
    const prev = canvas._px;
    if (alpha < 1 && prev) for (let i = 0; i < N * 3; i++) px[i] = prev[i] + (px[i] - prev[i]) * alpha;
    canvas._px = px;
    for (let i = 0; i < N; i++) { d[i * 4] = px[i * 3]; d[i * 4 + 1] = px[i * 3 + 1]; d[i * 4 + 2] = px[i * 3 + 2]; d[i * 4 + 3] = 255; }

    const ctx = canvas.getContext('2d');
    ctx.putImageData(img, 0, 0);
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

  // One box-blur pass over interleaved RGB floats: rows into `t`, then columns back into `a`
  function boxBlur(a, t, W, H, R) {
    const n = 2 * R + 1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = -R; i <= R; i++) sum += a[(row + Math.min(W - 1, Math.max(0, i))) * 3 + c];
        for (let x = 0; x < W; x++) {
          t[(row + x) * 3 + c] = sum / n;
          sum += a[(row + Math.min(W - 1, x + R + 1)) * 3 + c] - a[(row + Math.max(0, x - R)) * 3 + c];
        }
      }
    }
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = -R; i <= R; i++) sum += t[(Math.min(H - 1, Math.max(0, i)) * W + x) * 3 + c];
        for (let y = 0; y < H; y++) {
          a[(y * W + x) * 3 + c] = sum / n;
          sum += t[(Math.min(H - 1, y + R + 1) * W + x) * 3 + c] - t[(Math.max(0, y - R) * W + x) * 3 + c];
        }
      }
    }
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
  // Works for any "frame" element that carries _video, _bar, _glow and _r: viewer frames, and the
  // reel feed (whose one video moves from slide to slide). _sync / _onTime are optional hooks.
  function wireVideo(f) {
    const v = f._video, bar = f._bar, tip = $('.lb-tip', bar);

    // Playhead: driven every frame while playing so the line moves smoothly, not in 250 ms steps
    const showTime = () => {
      if (!v.duration) return;
      bar.style.setProperty('--p', v.currentTime / v.duration);
      bar.setAttribute('aria-valuenow', String(Math.round(v.currentTime)));
      bar.setAttribute('aria-valuetext', `${fmtDur(v.currentTime)} of ${fmtDur(v.duration)}`);
      f._onTime?.();
    };
    const loop = () => {
      showTime();
      f._raf = !v.paused && f.isConnected ? requestAnimationFrame(loop) : null;
    };
    ['timeupdate', 'seeked', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, showTime));
    ['play', 'pause', 'volumechange'].forEach((ev) => v.addEventListener(ev, () => f._sync?.()));

    v.addEventListener('play', () => {
      f.classList.remove('is-paused');
      if (!f._raf) f._raf = requestAnimationFrame(loop);
      // Live ambient light: re-sample the playing frame a few times a second, blended over the
      // previous samples so the glow drifts with the footage instead of flickering
      f._glowTimer ??= setInterval(() => {
        if (!v.paused && v.readyState >= 2 && f._glow) paintGlow(f._glow, v, f._r, 0.35);
      }, 200);
    });
    v.addEventListener('pause', () => { if (!f._quiet) f.classList.add('is-paused'); });

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
    v.play().catch((err) => {
      if (err?.name === 'AbortError' || f._quiet) return; // interrupted by a pause / new source, not refused
      // Autoplay with sound refused (e.g. opened from a link, no click yet): fall back to muted
      v.muted = true;
      soundOn = false;
      f._sync?.();
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
      const rows = lb.classList.contains('strip-open') ? [info.firstElementChild] : [info.firstElementChild, reel ? ctl.wrap : el.exif];
      rows.forEach((n, i) => n.animate(
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
    lb.classList.toggle('strip-open', open); // the chips row steps aside; the title stays
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
    lb.classList.remove('strip-open');
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

  /* ── History: ?p= / ?m= links, and the back button closes the viewer or feed ── */
  // Opening pushes a history entry, so the phone's back gesture closes instead of leaving the site.
  // Moving between frames replaces it. Closing from the UI steps back over it (and ignores that pop).
  const query = (p) => (p.kind === 'reel' ? `?m=${pad(p.no, 2)}` : `?p=${pad(p.no)}`);
  let pushed = false, skipPops = 0;
  function showURL(p, push) {
    try { // file:// can refuse
      if (push) { history.pushState({ keem: 1 }, '', query(p)); pushed = true; }
      else history.replaceState(history.state, '', query(p));
    } catch {}
  }
  function leaveURL() {
    if (pushed) { pushed = false; skipPops++; history.back(); return; }
    try { history.replaceState(null, '', location.pathname); } catch {}
  }
  addEventListener('popstate', () => {
    if (skipPops) { skipPops--; return; }
    if (!pushed) return;
    pushed = false;
    if (feedOpen) closeFeed(true);
    else if (isOpen) close(true);
  });

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
    showURL(p, true);
  }

  function go(i, dir) {
    if (!isOpen || closing || !frame) return;
    const n = cur.length;
    i = (i + n) % n;
    if (i === idx) return;
    if (zoomed()) setZoom(frame, Z1);
    clearTimeout(tapTimer);
    lastTap = null;
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
    showURL(p, false);
  }

  function close(fromHistory = false) {
    if (!isOpen || closing || !frame) return;
    closing = true;
    const p = cur[idx];
    const t = p.el;
    const still = reduce.matches;
    retire(frame);
    clearTimeout(tapTimer);
    if (!fromHistory) leaveURL();

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
    if (f._z.s !== 1 || f._z.x || f._z.y) { // zoomed in: settle back while flying home
      haltZoom(f);
      zoomTo(f, Z1, still ? 0 : 480);
    }
    lb.classList.remove('is-zoomed');
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
      lb.classList.remove('is-open', 'is-clean', 'is-dragging', 'is-panning');
      lb.setAttribute('aria-hidden', 'true');
      root.classList.remove('is-locked');
      page.inert = false;
      isOpen = false;
      closing = false;
      t.focus({ preventScroll: true });
    };
  }

  /* ── Viewer: zoom (photos) ─────────────────────────────── */
  // Click, double-tap or pinch to zoom; drag to pan (with a little momentum); ctrl + wheel or a
  // trackpad pinch on desktop; + / − / 0 keys. The photo layer (.lb-photo) is transformed inside its
  // frame and the full-size file loads on the first zoom. While zoomed, swipe and drag-to-dismiss
  // are off and the chrome steps aside (except Close).
  const ZMAX = 4, ZSTEP = 2.5;
  const Z1 = { s: 1, x: 0, y: 0 };
  const tf = (z) => `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
  const zoomed = () => !!frame && frame._z.s > 1.01;

  function setZoom(f, z) {
    f._z = z;
    f._photo.style.transform = z.s === 1 && !z.x && !z.y ? '' : tf(z);
    if (f === frame) zoomMode(z.s > 1.01);
  }

  function zoomMode(on) {
    if (lb.classList.contains('is-zoomed') === on) return;
    lb.classList.toggle('is-zoomed', on);
    const gl = frame._glow; // the glow can't follow a zoomed photo around, so it bows out
    const from = getComputedStyle(gl).opacity;
    gl._z?.cancel();
    if (on) {
      gl._z = gl.animate([{ opacity: from }, { opacity: 0 }], { duration: 250, easing: EASE_FADE, fill: 'forwards' });
      loadFull(frame);
      clearTimeout(tapTimer);
    } else {
      gl._z = gl.animate([{ opacity: 0 }, { opacity: getComputedStyle(gl).opacity }], { duration: 420, easing: EASE_FADE });
    }
  }

  // The largest file we have, layered over the screen-sized one
  function loadFull(f) {
    const p = f._p;
    if (f._full || f._video || !p.sizes || pick(p.sizes, 9999) === pick(p.sizes, hiWidth(f._rect))) return;
    const im = document.createElement('img');
    im.className = 'lb-hi';
    im.alt = '';
    im.decoding = 'async';
    im.addEventListener('load', () => im.classList.add('is-loaded'), { once: true });
    im.src = p.src(9999);
    f._photo.append(im);
    f._full = im;
  }

  // Allowed translate range at scale s: where the photo is bigger than the screen it must cover it,
  // where it's smaller it must stay fully on screen
  function bounds(f, s) {
    const r = f._rect;
    const ax = -r.x, bx = innerWidth - s * r.w - r.x;
    const ay = -r.y, by = innerHeight - s * r.h - r.y;
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };
  }
  // Clamp a zoom state. `give` > 0 lets it overshoot with resistance (while a finger holds it).
  function clampZ(f, z, give = 0) {
    let { s, x, y } = z;
    if (!give && (s < 1 || s > ZMAX)) { // bring the scale into range around the screen centre
      const r = f._rect, cx = innerWidth / 2 - r.x, cy = innerHeight / 2 - r.y;
      const s2 = Math.min(ZMAX, Math.max(1, s));
      x = cx - ((cx - x) / s) * s2;
      y = cy - ((cy - y) / s) * s2;
      s = s2;
    }
    const b = bounds(f, s);
    const lim = (v, lo, hi) => (v < lo ? lo - (lo - v) * give : v > hi ? hi + (v - hi) * give : v);
    return { s, x: lim(x, b.x0, b.x1), y: lim(y, b.y0, b.y1) };
  }
  // Zoom so the photo point under screen point (px, py) stays put
  function zoomAround(f, s, px, py, from = f._z) {
    const r = f._rect;
    return { s, x: px - r.x - (s * (px - r.x - from.x)) / from.s, y: py - r.y - (s * (py - r.y - from.y)) / from.s };
  }

  function zoomTo(f, z, duration = 420) {
    const now = getComputedStyle(f._photo).transform;
    f._zA?.cancel();
    setZoom(f, z);
    if (!duration || reduce.matches) { f._photo.style.willChange = ''; return; }
    f._zA = f._photo.animate([{ transform: now }, { transform: tf(z) }], { duration, easing: EASE_OUT });
    f._zA.onfinish = () => { f._photo.style.willChange = ''; f._zA = null; };
  }
  function toggleZoom(px, py) {
    const f = frame;
    if (!f || f._video) return;
    haltZoom(f);
    zoomTo(f, zoomed() ? Z1 : clampZ(f, zoomAround(f, ZSTEP, px, py)));
  }
  function zoomBy(k) {
    const f = frame;
    if (!f || f._video) return;
    haltZoom(f);
    const r = f._rect;
    const s = Math.min(ZMAX, Math.max(1, f._z.s * k));
    zoomTo(f, s <= 1.01 ? Z1 : clampZ(f, zoomAround(f, s, r.x + r.w / 2, r.y + r.h / 2)), 300);
  }
  // Stop any zoom animation or fling where it is, so a new gesture starts from what's on screen
  function haltZoom(f) {
    if (!f || f._video) return;
    if (f._fling) { cancelAnimationFrame(f._fling); f._fling = null; }
    if (f._zA) {
      const t = getComputedStyle(f._photo).transform;
      f._zA.cancel();
      f._zA = null;
      if (t !== 'none') { const m = new DOMMatrixReadOnly(t); setZoom(f, { s: m.a, x: m.e, y: m.f }); }
    }
  }
  // After a gesture: spring back inside the bounds, drop to 1× if it's barely zoomed
  function settleZoom(f) {
    const z = f._z;
    if (z.s < 1.05) return zoomTo(f, Z1, 360);
    const c = clampZ(f, z);
    if (c.s !== z.s || c.x !== z.x || c.y !== z.y) zoomTo(f, c, 360);
    else f._photo.style.willChange = '';
  }
  function releasePan(f, vx, vy) {
    const c = clampZ(f, f._z);
    if (c.x !== f._z.x || c.y !== f._z.y) return zoomTo(f, c, 360);
    if (reduce.matches || Math.hypot(vx, vy) < 0.25) { f._photo.style.willChange = ''; return; }
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - last);
      last = now;
      const b = bounds(f, f._z.s);
      let x = f._z.x + vx * dt, y = f._z.y + vy * dt;
      if (x < b.x0 || x > b.x1) { x = Math.min(b.x1, Math.max(b.x0, x)); vx = 0; }
      if (y < b.y0 || y > b.y1) { y = Math.min(b.y1, Math.max(b.y0, y)); vy = 0; }
      setZoom(f, { s: f._z.s, x, y });
      const k = 0.994 ** dt;
      vx *= k;
      vy *= k;
      if (Math.hypot(vx, vy) > 0.02 && f === frame) f._fling = requestAnimationFrame(step);
      else { f._fling = null; f._photo.style.willChange = ''; }
    };
    f._fling = requestAnimationFrame(step);
  }

  // Trackpad pinch (arrives as ctrl + wheel) zooms; two-finger scroll pans while zoomed
  lb.addEventListener('wheel', (e) => {
    const f = frame;
    if (!isOpen || closing || !f || f._video || (!e.ctrlKey && !zoomed())) return;
    e.preventDefault();
    haltZoom(f);
    if (e.ctrlKey) {
      const s = Math.min(ZMAX, Math.max(1, f._z.s * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01))));
      setZoom(f, s <= 1.001 ? Z1 : clampZ(f, zoomAround(f, s, e.clientX, e.clientY)));
    } else {
      setZoom(f, clampZ(f, { ...f._z, x: f._z.x - e.deltaX, y: f._z.y - e.deltaY }));
    }
  }, { passive: false });
  // iOS Safari: keep its own page pinch-zoom out of the viewer and the feed
  document.addEventListener('gesturestart', (e) => { if (isOpen || feedOpen) e.preventDefault(); });

  /* ── Viewer: buttons, keys, resize ─────────────────────── */
  closeBtn.addEventListener('click', () => close());
  $('.lb-prev', lb).addEventListener('click', () => go(idx - 1, -1));
  $('.lb-next', lb).addEventListener('click', () => go(idx + 1, 1));

  // Keep keyboard focus inside a dialog
  function trapFocus(box, e) {
    const f = [...box.querySelectorAll('button, a[href]')].filter((b) => b.offsetParent !== null && b.tabIndex > -1);
    const first = f[0], last = f[f.length - 1];
    if (!first) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  document.addEventListener('keydown', (e) => {
    if (feedOpen) return feedKey(e);
    if (!isOpen) return;
    const photo = frame && !frame._video;
    const pan = { ArrowRight: [-120, 0], ArrowLeft: [120, 0], ArrowDown: [0, -120], ArrowUp: [0, 120] }[e.key];
    if (e.key === 'Escape') { e.preventDefault(); if (zoomed()) zoomTo(frame, Z1); else close(); }
    else if (pan && zoomed()) { e.preventDefault(); haltZoom(frame); zoomTo(frame, clampZ(frame, { ...frame._z, x: frame._z.x + pan[0], y: frame._z.y + pan[1] }), 260); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1, -1); }
    else if (photo && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomBy(1.6); }
    else if (photo && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(1 / 1.6); }
    else if (photo && e.key === '0') { e.preventDefault(); haltZoom(frame); zoomTo(frame, Z1, 300); }
    else if (frame?._video && (e.key === ' ' || e.key === 'k')) { e.preventDefault(); togglePlay(); }
    else if (frame?._video && e.key === 'm') { e.preventDefault(); toggleSound(); }
    else if (e.key === 'Tab') trapFocus(lb, e);
  });

  let viewW = innerWidth;
  addEventListener('resize', () => {
    if (!isOpen || !frame || closing) return;
    if (innerWidth !== viewW && frame._p.kind !== 'reel') { haltZoom(frame); setZoom(frame, Z1); }
    viewW = innerWidth;
    place(frame, cur[idx]);
    if (zoomed()) setZoom(frame, clampZ(frame, frame._z));
  });

  /* ── Viewer: gestures ──────────────────────────────────── */
  // One finger or the mouse: drag down to dismiss, swipe sideways to change, tap a reel to pause.
  // Photos: a tap hides the chrome (touch) or zooms (mouse), double-tap zooms, two fingers pinch,
  // and while zoomed a drag pans instead.
  const pts = new Map(); // pointers down on the photo / backdrop
  let g = null, pinch = null, lastTap = null, tapTimer;

  lb.addEventListener('pointerdown', (e) => {
    if (!isOpen || closing || !frame || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const onFrame = !!e.target.closest('.lb-frame:not(.is-leaving)');
    const onBackdrop = e.target === stage || e.target === scrim;
    if (!onFrame && !onBackdrop) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && !frame._video) return startPinch();
    if (pts.size > 1) return;
    haltZoom(frame);
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: null, onFrame, z0: frame._z, hist: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
  });

  lb.addEventListener('pointermove', (e) => {
    const pt = pts.get(e.pointerId);
    if (!pt || !frame) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (pinch) return movePinch();
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.hist.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (g.hist.length > 6) g.hist.shift();
    if (!g.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      g.mode = zoomed() ? 'pan' : Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'dismiss' : null) : 'swipe';
      if (!g.mode) { g = null; return; }
      try { lb.setPointerCapture(e.pointerId); } catch {}
      if (g.mode === 'pan') {
        lb.classList.add('is-panning');
        frame._photo.style.willChange = 'transform';
      } else {
        frame._anim?.finish();
        scrim._a?.finish();
        frame._glow.getAnimations().forEach((a) => a.finish());
        g.glowO = +getComputedStyle(frame._glow).opacity;
        lb.classList.add('is-dragging');
      }
    }
    if (g.mode === 'pan') {
      setZoom(frame, clampZ(frame, { s: g.z0.s, x: g.z0.x + dx, y: g.z0.y + dy }, 0.35));
    } else if (g.mode === 'dismiss') {
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

  function startPinch() {
    const f = frame;
    if (g) { // a second finger turns a swipe / dismiss into a pinch
      if (g.mode === 'swipe' || g.mode === 'dismiss') settleFrame(g.glowO);
      g = null;
      lb.classList.remove('is-dragging', 'is-panning');
    }
    clearTimeout(tapTimer);
    lastTap = null;
    f._anim?.finish();
    haltZoom(f);
    const [a, b] = [...pts.values()];
    pinch = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z0: f._z };
    f._photo.style.willChange = 'transform';
    loadFull(f);
  }
  function movePinch() {
    const [a, b] = [...pts.values()];
    let s = (pinch.z0.s * Math.hypot(b.x - a.x, b.y - a.y)) / pinch.d0;
    if (s < 1) s = 1 - (1 - s) * 0.45; // rubber band past the limits
    if (s > ZMAX) s = ZMAX + (s - ZMAX) * 0.3;
    const z = zoomAround(frame, s, pinch.m0.x, pinch.m0.y, pinch.z0); // anchor where the fingers started…
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    setZoom(frame, { s, x: z.x + m.x - pinch.m0.x, y: z.y + m.y - pinch.m0.y }); // …and follow them
  }

  // A swipe or dismiss that didn't go far enough glides back
  function settleFrame(glowO) {
    const from = getComputedStyle(frame).transform;
    frame.style.transform = '';
    frame.animate([{ transform: from }, { transform: 'none' }], { duration: 380, easing: EASE_OUT });
    scrimTo(1, 280);
    const glowNow = frame._glow.style.opacity;
    if (glowNow) {
      frame._glow.style.opacity = '';
      frame._glow.animate([{ opacity: glowNow }, { opacity: glowO }], { duration: 380, easing: EASE_FADE });
    }
  }

  // Touch: wait a beat to tell a single tap (hide the chrome) from a double tap (zoom)
  function tapPhoto(e) {
    if (e.pointerType === 'mouse') return toggleZoom(e.clientX, e.clientY);
    if (lastTap && e.timeStamp - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      clearTimeout(tapTimer);
      lastTap = null;
      return toggleZoom(e.clientX, e.clientY);
    }
    lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { lastTap = null; if (!zoomed()) lb.classList.toggle('is-clean'); }, 300);
  }

  function endDrag(e) {
    const had = pts.delete(e.pointerId);
    if (pinch) {
      if (had && pts.size < 2) { pinch = null; settleZoom(frame); } // a finger left behind doesn't pan
      return;
    }
    if (!g || e.pointerId !== g.id) return;
    const G = g;
    g = null;
    lb.classList.remove('is-dragging', 'is-panning');
    if (!frame) return;
    if (!G.mode) {
      if (e.type !== 'pointerup') return;
      if (!G.onFrame) return zoomed() ? zoomTo(frame, Z1) : close();
      if (frame._video) return togglePlay();
      return tapPhoto(e);
    }
    const h0 = G.hist[0], h1 = G.hist[G.hist.length - 1];
    const dt = Math.max(1, h1.t - h0.t);
    const vx = (h1.x - h0.x) / dt, vy = (h1.y - h0.y) / dt;
    if (G.mode === 'pan') return releasePan(frame, e.timeStamp - h1.t > 80 ? 0 : vx, e.timeStamp - h1.t > 80 ? 0 : vy);
    const dx = e.clientX - G.x, dy = e.clientY - G.y;
    if (G.mode === 'dismiss' && (dy > 110 || vy > 0.55)) return close();
    if (G.mode === 'swipe' && (Math.abs(dx) > 70 || Math.abs(vx) > 0.45)) {
      const dir = dx < 0 ? 1 : -1;
      return go(idx + dir, dir);
    }
    settleFrame(G.glowO);
  }
  lb.addEventListener('pointerup', endDrag);
  lb.addEventListener('pointercancel', endDrag);

  /* ── Reel feed (phones) ────────────────────────────────── */
  // On phones the reels open as a full-screen vertical feed: swipe up / down between them, tap to
  // pause. One <video> travels with the active slide, so the tap that opened the feed keeps sound
  // allowed all the way down (iOS only lets a video that was started by a tap play audio).
  const feed = $('.feed');
  const feedTrack = $('.feed-track', feed);
  const feedScrim = $('.feed-scrim', feed);
  const feedPos = $('[data-feed-pos]', feed);
  const feedSound = $('[data-feed-sound]', feed);
  const feedClose = $('.feed-close', feed);
  const slides = [];
  let feedIdx = -1, feedClosing = false, feedBusy = false, feedTile = null;

  const fv = document.createElement('video');
  fv.className = 'lb-video';
  fv.playsInline = true;
  fv.loop = true;
  fv.preload = 'auto';
  fv.addEventListener('playing', () => fv.classList.add('is-ready'));
  const fbar = document.createElement('div');
  fbar.className = 'lb-progress';
  fbar.tabIndex = 0;
  fbar.setAttribute('role', 'slider');
  fbar.setAttribute('aria-label', 'Seek');
  fbar.setAttribute('aria-valuemin', '0');
  fbar.innerHTML = '<span class="lb-track-bg"></span><span class="lb-track-fill"></span><span class="lb-knob"></span><span class="lb-tip">0:00</span>';
  $('.feed-bar', feed).append(fbar);
  feed._video = fv;
  feed._bar = fbar;
  feed._sync = syncFeed;
  wireVideo(feed);

  function syncFeed() {
    feedSound.textContent = fv.muted ? 'Sound off' : 'Sound on';
    feedSound.classList.toggle('is-on', !fv.muted);
    feedSound.setAttribute('aria-pressed', String(!fv.muted));
  }
  feedSound.addEventListener('click', () => {
    soundOn = fv.muted;
    fv.muted = !soundOn;
    if (fv.paused) playFrame(feed);
  });
  feedClose.addEventListener('click', () => closeFeed());

  function buildFeed() {
    if (slides.length) return;
    REELS.forEach((p) => {
      const s = document.createElement('section');
      s.className = 'feed-slide';
      s.style.setProperty('--r', p.r);
      s.style.setProperty('--c', p.c);
      s.style.setProperty('--glow-o', glowStrength(p.c));
      s.setAttribute('aria-label', `Reel ${label(p)}: ${p.title}`);
      s.innerHTML = `
        <div class="feed-media">
          <canvas class="lb-glow" aria-hidden="true"></canvas>
          <div class="lb-photo">
            <img alt="" decoding="async">
            <span class="lb-paused" aria-hidden="true"><svg viewBox="0 0 22 22"><rect x="5" y="4" width="4" height="14" rx="1" fill="currentColor"/><rect x="13" y="4" width="4" height="14" rx="1" fill="currentColor"/></svg></span>
          </div>
        </div>
        <div class="feed-cap lb-chrome">
          <p class="label feed-no"><span class="tile-no">${label(p)}</span> · ${fmtDur(p.dur)}</p>
          <h2 class="feed-title"></h2>
          <p class="label feed-meta"></p>
          ${p.code ? `<a class="chip chip-btn feed-ig" href="https://www.instagram.com/reel/${p.code}/" target="_blank" rel="noopener" tabindex="-1">Instagram ↗</a>` : ''}
        </div>`;
      $('.feed-title', s).textContent = p.title;
      const meta = [p.place, p.date && fmtDate(p.date)].filter(Boolean).join(' · ');
      $('.feed-meta', s).textContent = meta;
      $('.feed-meta', s).hidden = !meta;
      const img = $('img', s), glow = $('.lb-glow', s);
      img.addEventListener('load', () => { if (!glow._px) paintGlow(glow, img, p.r); }, { once: true });
      s._img = img;
      s._glow = glow;
      feedTrack.append(s);
      slides.push(s);
    });
  }
  // Posters load for the slide in view and its neighbours
  function feedPosters(i) {
    for (let j = i - 1; j <= i + 1; j++) {
      const s = slides[j];
      if (s && !s._img.src) { s._img.srcset = REELS[j].srcset; s._img.sizes = '100vw'; s._img.src = REELS[j].src(800); }
    }
  }

  function activate(i) {
    if (i === feedIdx || !slides[i]) return;
    const prev = slides[feedIdx];
    if (prev) {
      prev.classList.remove('is-active');
      prev.querySelectorAll('a').forEach((a) => { a.tabIndex = -1; });
      feed.classList.add('has-swiped');
    }
    feedIdx = i;
    const s = slides[i], p = REELS[i];
    s.classList.add('is-active');
    s.querySelectorAll('a').forEach((a) => { a.tabIndex = 0; });
    feedPosters(i);

    // Hand the video over to this slide
    fv.classList.remove('is-ready');
    fbar.style.setProperty('--p', 0);
    fbar.setAttribute('aria-valuemax', String(Math.round(p.dur)));
    feed.classList.remove('is-paused');
    $('.lb-paused', s).before(fv);
    fv.setAttribute('aria-label', p.title);
    fv.src = p.video;
    feed._glow = s._glow;
    feed._r = p.r;
    feed._quiet = false;
    playFrame(feed);
    syncFeed();
    feedPos.textContent = `${pad(i + 1, 2)} / ${pad(REELS.length, 2)}`;
    if (feedOpen) showURL(p, false);
  }

  feedTrack.addEventListener('scroll', () => {
    if (!feedOpen || feedBusy || feedClosing) return;
    const i = Math.round(feedTrack.scrollTop / feedTrack.clientHeight);
    if (i !== feedIdx) activate(i);
  }, { passive: true });
  // Tap to pause / play (a scroll never fires a click)
  feedTrack.addEventListener('click', (e) => {
    if (!feedOpen || feedClosing || e.target.closest('a, button')) return;
    if (fv.paused) playFrame(feed); else fv.pause();
  });
  new ResizeObserver(() => { // rotation: stay on the same reel
    if (!feedOpen) return;
    feedBusy = true;
    feedTrack.scrollTop = feedIdx * feedTrack.clientHeight;
    requestAnimationFrame(() => { feedBusy = false; });
  }).observe(feedTrack);

  function feedStep(d) {
    const i = Math.min(REELS.length - 1, Math.max(0, feedIdx + d));
    feedTrack.scrollTo({ top: i * feedTrack.clientHeight, behavior: reduce.matches ? 'auto' : 'smooth' });
  }
  function feedKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeFeed(); }
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); feedStep(1); }
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); feedStep(-1); }
    else if (e.key === ' ' && !e.target.closest('button, a, [role="slider"]')) { e.preventDefault(); if (fv.paused) playFrame(feed); else fv.pause(); }
    else if (e.key === 'm') { e.preventDefault(); feedSound.click(); }
    else if (e.key === 'Tab') trapFocus(feed, e);
  }

  function openFeed(i, { instant = false } = {}) {
    if (feedOpen || isOpen || !REELS[i]) return;
    buildFeed();
    const p = REELS[i];
    REELS.forEach(stopPreview);
    feedOpen = true;
    showURL(p, true);
    root.classList.add('is-locked');
    page.inert = true;
    feed.classList.remove('has-swiped');
    feed.classList.add('is-open');
    feed.setAttribute('aria-hidden', 'false');
    feedIdx = -1;
    feedBusy = true;
    feedTrack.scrollTop = i * feedTrack.clientHeight;
    requestAnimationFrame(() => { feedBusy = false; });
    activate(i); // still inside the tap, so sound is allowed

    const s = slides[i], media = $('.feed-media', s);
    feedTile = p.el;
    feedTile.style.visibility = 'hidden';
    if (instant || reduce.matches) {
      feed.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_FADE });
    } else {
      media.animate([{ transform: flip(rectOf(p.el), rectOf(media)) }, { transform: 'none' }], { duration: 520, easing: EASE_OUT });
      feedScrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE_FADE });
      glowIn({ _glow: s._glow }, 1000, 240);
    }
    requestAnimationFrame(() => feed.classList.add('show-chrome'));
    feedClose.focus({ preventScroll: true });
  }

  function closeFeed(fromHistory = false) {
    if (!feedOpen || feedClosing) return;
    feedClosing = true;
    const p = REELS[feedIdx], s = slides[feedIdx], media = $('.feed-media', s);
    if (!fromHistory) leaveURL();
    feed._quiet = true;
    fv.pause();
    clearInterval(feed._glowTimer);
    feed._glowTimer = null;

    // Land on the current reel's tile — scroll it into view first (hidden under the feed)
    feedTile.style.visibility = '';
    const t = p.el;
    t.style.visibility = 'hidden';
    let r = rectOf(t);
    if (r.y < 12 || r.y + r.h > innerHeight - 12) {
      scrollTo({ top: scrollY + r.y - (innerHeight - r.h) / 2, behavior: 'instant' });
      r = rectOf(t);
    }
    feed.classList.remove('show-chrome');

    const done = () => {
      feed.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      feed.classList.remove('is-open', 'is-paused');
      feed.setAttribute('aria-hidden', 'true');
      slides[feedIdx].classList.remove('is-active');
      fv.removeAttribute('src');
      fv.load();
      fv.remove();
      feedIdx = -1;
      t.style.visibility = '';
      root.classList.remove('is-locked');
      page.inert = false;
      feedOpen = false;
      feedClosing = false;
      t.focus({ preventScroll: true });
    };
    if (reduce.matches) {
      feed.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE_FADE, fill: 'forwards' }).onfinish = done;
      return;
    }
    glowOut({ _glow: s._glow }, 240);
    feedScrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 60, easing: EASE_FADE, fill: 'forwards' });
    media.animate([{ transform: 'none' }, { transform: flip(r, rectOf(media)) }], { duration: 480, easing: EASE_OUT, fill: 'forwards' })
      .onfinish = () => { s._glow.style.opacity = ''; done(); };
  }

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

  // Deep links: ?p=014 opens a photo, ?m=03 a reel (in the feed on phones). The link's own history
  // entry becomes the plain page, so Back closes the viewer and stays on the site.
  const params = new URLSearchParams(location.search);
  const qp = +params.get('p'), qm = +params.get('m');
  const ip = qp ? list.findIndex((p) => p.no === qp) : -1;
  const im = qm ? REELS.findIndex((p) => p.no === qm) : -1;
  if (ip > -1 || im > -1) {
    try { history.replaceState(null, '', location.pathname); } catch {}
    requestAnimationFrame(() => {
      if (ip > -1) open(ip, { instant: true });
      else if (phone.matches) openFeed(im, { instant: true });
      else open(im, { instant: true, set: 'reels' });
    });
  }
})();
