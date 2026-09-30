// Turns reels-src/ into web-ready video for the Motion section.
//
//   npm run reels
//
// For every <name>.mp4 in reels-src/ (optionally with a <name>.jpg cover):
// - site/reels/<id>.mp4           full reel, re-encoded to H.264/AAC at up to 720p (plays everywhere, incl.
//                                  iPhones, which can't play the VP9 Instagram serves) with +faststart
// - site/reels/<id>-preview.mp4   first 8 s, silent, small — plays on hover in the grid
// - site/reels/<id>-poster-<w>.webp  poster frames (the Instagram cover when its shape matches, else a frame at 1 s)
// Keeps reels-src/captions.json in sync (title, place, date, order, hidden) and writes site/reels.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'reels-src');
const OUT = path.join(ROOT, 'site', 'reels');
const MANIFEST = path.join(ROOT, 'site', 'reels.js');
const CAPTIONS = path.join(SRC, 'captions.json');
const META = path.join(SRC, '_instagram.json');
const POSTERS = [400, 800];
// Full-reel encode. Changing this string re-encodes every reel on the next run.
const ENCODE = 'h264 crf26 slow max720 maxrate1.6M aac96k';
const ENCODED = path.join(SRC, '.frames', 'encoded.json'); // which settings each output was made with

const slugify = (s) => s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const exists = (p) => fs.stat(p).then(() => true, () => false);

// First line of an Instagram caption, without hashtags, emoji or trailing dots
function titleFrom(caption = '') {
  const line = caption.split('\n')[0]
    .replace(/#\S+/g, '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️]/gu, '')
    .replace(/[.…\s]+$/u, '')
    .trim();
  return line.length > 48 ? line.slice(0, 46).replace(/\s+\S*$/, '') + '…' : line;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited ${code}`))));
  });
}

// Width/height/duration straight from ffmpeg's stream info (ffmpeg-static ships without ffprobe)
function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-i', file]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const dim = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      const codec = err.match(/Video: (\w+)/)?.[1] ?? '';
      const dur = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
      const rot = err.match(/rotate\s*:\s*(-?\d+)|rotation of (-?[\d.]+)/);
      let w = dim ? +dim[1] : 0, h = dim ? +dim[2] : 0;
      if (rot && Math.abs(+(rot[1] ?? rot[2])) % 180 === 90) [w, h] = [h, w];
      resolve({ w, h, codec, dur: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0, audio: /Audio:/.test(err) });
    });
  });
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const files = (await fs.readdir(SRC)).filter((f) => /\.mp4$/i.test(f)).sort().reverse(); // newest first
  if (!files.length) return console.log('No .mp4 files in reels-src/.');

  let captions = {}, meta = {}, encoded = {};
  try { captions = JSON.parse(await fs.readFile(CAPTIONS, 'utf8')); } catch {}
  try { meta = JSON.parse(await fs.readFile(META, 'utf8')); } catch {}
  try { encoded = JSON.parse(await fs.readFile(ENCODED, 'utf8')); } catch {}
  await fs.mkdir(path.dirname(ENCODED), { recursive: true });

  const items = [];
  for (const [i, file] of files.entries()) {
    const base = file.replace(/\.mp4$/i, '');
    const id = slugify(base);
    const m = meta[base] ?? {};
    const cap = (captions[file] ??= {
      title: titleFrom(m.caption), place: '', date: m.date || '', order: (i + 1) * 10, hidden: false,
    });
    if (cap.hidden) continue;

    const src = path.join(SRC, file);
    const info = await probe(src);
    const full = path.join(OUT, `${id}.mp4`);
    const preview = path.join(OUT, `${id}-preview.mp4`);

    if (!(await exists(full)) || encoded[id] !== ENCODE) {
      // Short side capped at 720 px: sharp on phones and in the desktop viewer, a fraction of the 1080p size
      await run(['-y', '-i', src,
        '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-maxrate', '1600k', '-bufsize', '3200k',
        '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', full]);
      // Already a lean 720p H.264 file? Re-encoding would only cost quality, so keep the original stream
      const [a, b] = await Promise.all([fs.stat(src), fs.stat(full)]);
      if (info.codec === 'h264' && Math.min(info.w, info.h) <= 720 && b.size > a.size * 0.9) {
        await run(['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', full]);
      }
      encoded[id] = ENCODE;
      await fs.writeFile(ENCODED, JSON.stringify(encoded, null, 2) + '\n');
    }
    if (!(await exists(preview))) {
      await run(['-y', '-i', src, '-t', '8', '-an', '-vf', "scale='if(gt(iw,ih),-2,360)':'if(gt(iw,ih),360,-2)'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', preview]);
    }

    // Poster: the Instagram cover if it has the video's shape, otherwise a frame from 1 s in
    const coverPath = path.join(SRC, `${base}.jpg`);
    let posterSrc = null;
    if (await exists(coverPath)) {
      const c = await sharp(coverPath).metadata();
      if (Math.abs(c.width / c.height - info.w / info.h) < 0.03) posterSrc = coverPath;
    }
    if (!posterSrc) {
      posterSrc = path.join(SRC, '.frames', `${id}.jpg`); // build intermediate, kept out of site/
      if (!(await exists(posterSrc))) {
        await fs.mkdir(path.dirname(posterSrc), { recursive: true });
        await run(['-y', '-ss', '1', '-i', src, '-frames:v', '1', '-q:v', '3', posterSrc]);
      }
    }
    const sizes = POSTERS.filter((s) => s < info.w).concat(Math.min(info.w, POSTERS[POSTERS.length - 1]));
    for (const s of [...new Set(sizes)]) {
      const out = path.join(OUT, `${id}-poster-${s}.webp`);
      if (!(await exists(out))) await sharp(posterSrc).resize({ width: s }).webp({ quality: 78 }).toFile(out);
    }
    const { channels } = await sharp(posterSrc).resize({ width: 64 }).stats();

    items.push({
      id, code: m.code || '', w: info.w, h: info.h, dur: Math.round(info.dur * 10) / 10, audio: info.audio,
      c: hex(channels[0].mean, channels[1].mean, channels[2].mean),
      posters: [...new Set(sizes)].sort((a, b) => a - b),
      title: cap.title || base, place: cap.place || '', date: cap.date || m.date || '', order: cap.order ?? (i + 1) * 10,
    });
    process.stdout.write(`\r${items.length} ${file.padEnd(36)}`);
  }

  items.sort((a, b) => a.order - b.order);
  await fs.writeFile(CAPTIONS, JSON.stringify(captions, null, 2) + '\n');
  await fs.writeFile(MANIFEST,
    `// Generated by tools/prepare-reels.mjs — edit reels-src/captions.json, then \`npm run reels\`.\n` +
    `window.KEEM_REELS = ${JSON.stringify({ base: 'reels/', items }, null, 2)};\n`);
  console.log(`\nWrote ${items.length} reels → site/reels.js`);
}

main().catch((e) => { console.error(e); process.exit(1); });
