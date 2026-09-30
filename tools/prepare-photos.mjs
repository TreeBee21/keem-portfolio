// Turns whatever is in photos-src/ into web-ready files + a manifest the site reads.
//
//   npm run photos
//
// - Resizes every image to WebP at several widths  -> site/photos/<slug>-<w>.webp
// - Crops phone + desktop wallpapers on the point of interest -> site/photos/<slug>-wall-<kind>.jpg
// - Reads size, average colour and camera EXIF (incl. Fujifilm film simulation)
// - Keeps photos-src/captions.json in sync: new files get a stub you can edit
//   (title, place, date, series, order, hidden). Re-run after editing.
// - Writes site/photos.js (a plain <script>, loaded before app.js)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'photos-src');
const OUT = path.join(ROOT, 'site', 'photos');
const MANIFEST = path.join(ROOT, 'site', 'photos.js');
const CAPTIONS = path.join(SRC, 'captions.json');

const WIDTHS = [400, 800, 1200, 1600, 2400];
const WALLPAPERS = [['phone', 9 / 19.5], ['desktop', 16 / 9]];
const SERIES = ['streets', 'machines', 'places', 'people', 'land'];
const EXT = /\.(jpe?g|png|webp|tiff?|avif)$/i;

// Fujifilm MakerNote tags (see ExifTool FujiFilm tables)
const FILM_MODE = {
  0x000: 'Provia', 0x100: 'Studio Portrait', 0x110: 'Studio Portrait Ex', 0x120: 'Astia',
  0x130: 'Studio Portrait', 0x200: 'Velvia', 0x300: 'Studio Portrait Ex', 0x400: 'Velvia',
  0x500: 'Pro Neg. Std', 0x501: 'Pro Neg. Hi', 0x600: 'Classic Chrome', 0x700: 'Eterna',
  0x800: 'Classic Neg.', 0x900: 'Eterna Bleach Bypass', 0xa00: 'Nostalgic Neg.', 0xb00: 'Reala Ace',
};
const MONO = {
  0x300: 'Monochrome', 0x301: 'Monochrome + R', 0x302: 'Monochrome + Ye', 0x303: 'Monochrome + G',
  0x310: 'Sepia', 0x500: 'Acros', 0x501: 'Acros + R', 0x502: 'Acros + Ye', 0x503: 'Acros + G',
};

function fujiFilmSim(raw) {
  if (!raw) return null;
  const b = Buffer.from(raw);
  if (b.length < 14 || b.toString('ascii', 0, 8) !== 'FUJIFILM') return null;
  const ifd = b.readUInt32LE(8);
  const n = b.readUInt16LE(ifd);
  let film = null, sat = null;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = b.readUInt16LE(e);
    if (tag === 0x1401) film = b.readUInt16LE(e + 8);
    if (tag === 0x1003) sat = b.readUInt16LE(e + 8);
  }
  if (sat != null && MONO[sat]) return MONO[sat];
  return film != null ? FILM_MODE[film] ?? null : null;
}

const slugify = (s) => s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const isoDate = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '');

function shutter(t) {
  if (!t) return null;
  return t >= 1 ? `${+t.toFixed(1)}` : `1/${Math.round(1 / t)}`;
}

function cameraName(make = '', model = '') {
  make = make.trim(); model = model.trim();
  if (!model) return null;
  if (/^fujifilm/i.test(make)) return `Fujifilm ${model}`;
  if (/^sony/i.test(make)) return model.replace(/^ILCE-7RM3A?$/, 'Sony A7R III').replace(/^ILCE-/, 'Sony α');
  return model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? model : `${make} ${model}`;
}

async function readExif(file) {
  try {
    const x = await exifr.parse(file, { makerNote: true, tiff: true, exif: true, gps: false });
    if (!x) return null;
    const nb = ' ';
    const chips = [];
    const cam = cameraName(x.Make, x.Model);
    if (cam) chips.push(cam);
    if (x.LensModel && !/X100/i.test(x.Model || '')) chips.push(String(x.LensModel).trim());
    else if (x.FocalLength) chips.push(`${Math.round(x.FocalLength)}${nb}mm`);
    if (x.FNumber) chips.push(`f/${+x.FNumber.toFixed(1)}`);
    const ss = shutter(x.ExposureTime);
    if (ss) chips.push(`${ss}${nb}s`);
    if (x.ISO) chips.push(`ISO${nb}${x.ISO}`);
    return {
      chips: chips.length ? chips : null,
      sim: fujiFilmSim(x.MakerNote ?? x.makerNote),
      date: isoDate(x.DateTimeOriginal || x.CreateDate),
    };
  } catch {
    return null;
  }
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const files = (await fs.readdir(SRC)).filter((f) => EXT.test(f)).sort();
  if (!files.length) {
    console.log('No images in photos-src/. Drop JPEG/PNG/WebP/TIFF files there and run again.');
    return;
  }

  let captions = {};
  try { captions = JSON.parse(await fs.readFile(CAPTIONS, 'utf8')); } catch {}

  const items = [];
  for (const [i, file] of files.entries()) {
    const abs = path.join(SRC, file);
    const id = slugify(file);
    const cap = (captions[file] ??= {
      title: '', place: '', date: '', series: 'uncategorised', order: (i + 1) * 10, hidden: false,
    });
    if (cap.hidden) continue;

    const base = sharp(abs).rotate(); // respect EXIF orientation
    const { data, info } = await base.clone().resize({ width: 64 }).raw().toBuffer({ resolveWithObject: true });
    const meta = await sharp(abs).metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    const w = swap ? meta.height : meta.width;
    const h = swap ? meta.width : meta.height;
    const { channels } = await sharp(data, { raw: info }).stats(); // average colour: tile placeholder + glow strength

    const sizes = WIDTHS.filter((s) => s < w);
    sizes.push(Math.min(w, WIDTHS[WIDTHS.length - 1]));
    const srcStat = await fs.stat(abs);
    for (const s of [...new Set(sizes)]) {
      const out = path.join(OUT, `${id}-${s}.webp`);
      const outStat = await fs.stat(out).catch(() => null);
      if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) continue; // already up to date
      await base.clone().resize({ width: s, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
    }

    // Wallpapers: the largest phone (19.5:9) and desktop (16:9) crop the photo allows, placed on its
    // point of interest. Override placement with "wallpaper": "left" | "right" | "top" | … in captions.json.
    for (const [kind, ar] of WALLPAPERS) {
      const out = path.join(OUT, `${id}-wall-${kind}.jpg`);
      const outStat = await fs.stat(out).catch(() => null);
      if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) continue;
      let cw = w, ch = Math.round(w / ar);
      if (ch > h) { ch = h; cw = Math.round(h * ar); }
      await base.clone()
        .resize(cw, ch, { fit: 'cover', position: cap.wallpaper || 'attention' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toFile(out);
    }

    const exif = await readExif(abs);
    items.push({
      id,
      file,
      w, h,
      c: hex({ r: Math.round(channels[0].mean), g: Math.round(channels[1].mean), b: Math.round(channels[2].mean) }),
      sizes: [...new Set(sizes)].sort((a, b) => a - b),
      cat: SERIES.includes(cap.series) ? cap.series : 'uncategorised',
      title: cap.title || file.replace(/\.[^.]+$/, ''),
      place: cap.place || '',
      date: cap.date || exif?.date || '',
      chips: exif?.chips ?? null,
      sim: exif?.sim ?? null,
      order: cap.order ?? (i + 1) * 10,
    });
    process.stdout.write(`\r${items.length}/${files.length} ${file.padEnd(40)}`);
  }

  items.sort((a, b) => a.order - b.order);
  await fs.writeFile(CAPTIONS, JSON.stringify(captions, null, 2) + '\n');
  await fs.writeFile(
    MANIFEST,
    `// Generated by tools/prepare-photos.mjs — edit photos-src/captions.json, then \`npm run photos\`.\n` +
    `window.KEEM_PHOTOS = ${JSON.stringify({ base: 'photos/', items }, null, 2)};\n`
  );
  console.log(`\nWrote ${items.length} photos → site/photos.js`);
}

main().catch((e) => { console.error(e); process.exit(1); });
