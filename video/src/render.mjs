// Render the film page frame by frame in headless Chrome and mux it with one voice take.
// usage: node render.mjs <chrome> <take> <out.mp4> [stills: t1,t2,...]   (always 1920x1080, 30 fps)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const [chrome, take, out, stills] = process.argv.slice(2);
const W = 1920, H = 1080, FPS = 30;
const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + '?take=' + take, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))].join(','));
const duration = await page.evaluate(() => window.DURATION);
console.log(take, '| fonts:', fonts || 'NONE', '| duration', duration, errors.length ? '| PAGE ERRORS: ' + errors.join(' ; ') : '');
if (!duration) { await browser.close(); process.exit(1); }

if (stills) {
  for (const t of stills.split(',')) {
    await page.evaluate(t => window.renderAt(t), +t);
    await page.screenshot({ path: path.join(dir, `still_${take}_${(+t).toFixed(2).padStart(6, '0')}.png`) });
  }
  if (errors.length) console.log('PAGE ERRORS:', errors.join(' ; '));
  await browser.close();
  process.exit(0);
}

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-i', path.join(dir, `voice_${take}.mp3`), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,apad', '-t', String(duration), '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.round(duration * FPS);
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  await page.evaluate(t => window.renderAt(t), i / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
console.log(`${take}: rendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`, errors.length ? '| PAGE ERRORS: ' + errors.join(' ; ') : '');
