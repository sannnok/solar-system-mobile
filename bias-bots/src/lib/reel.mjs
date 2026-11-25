// Динамичный ролик на Remotion (шаблон в video/): кинетический текст, анимация
// колеса кодекса, переходы с размытием, финальная карточка из бота в 3D.
// Remotion рендерит беззвучное видео в headless-браузере, звук (озвучка, музыка
// или тишина) подмешивается ffmpeg — так же, как в простом генераторе video.mjs.
//
// Браузер: REMOTION_BROWSER, иначе chrome-headless-shell из Playwright, если он
// установлен, иначе Remotion скачает свой при первом запуске.
// Лицензия Remotion бесплатна для частных лиц и компаний до 3 человек.
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, biases, getQuadrant } from './data.mjs';
import { renderCard } from './cards.mjs';
import { audioDuration } from './video.mjs';
import { buildTimeline, defaultHighlight } from '../../video/timeline.mjs';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const PW_SHELL = '/opt/pw-browsers/chromium_headless_shell';

export const browserExecutable = () =>
  process.env.REMOTION_BROWSER || (existsSync(PW_SHELL) ? PW_SHELL : null);

let bundlePromise = null;
async function serveUrl() {
  if (!bundlePromise) {
    const { bundle } = await import('@remotion/bundler');
    bundlePromise = bundle({ entryPoint: path.join(ROOT, 'video', 'index.jsx'), onProgress: () => {} })
      .catch((e) => { bundlePromise = null; throw e; });
  }
  return bundlePromise;
}

export async function reelProps(bias, { hook, cta = '', handle = '', audioDuration: audioDur = null, highlight = null } = {}) {
  const q = getQuadrant(bias.quadrant);
  const card = await renderCard(bias, { format: 'post', handle });
  const data = {
    n: bias.n, total: biases.length, name: bias.name_ru, accent: q.accent, quadrantTitle: q.title_ru,
    summary: bias.summary_ru, example: bias.example_ru, tip: bias.tip_ru,
  };
  return {
    bias: data,
    hook: hook || `Почему мы так делаем? ${bias.name_ru}`,
    cta: cta || `Ещё ${biases.length - 1} ловушек мышления — в боте`,
    handle,
    wheel: biases.map((b) => ({ a: b.angle, c: getQuadrant(b.quadrant).accent, on: b.id === bias.id })),
    card: `data:image/png;base64,${card.toString('base64')}`,
    timeline: buildTimeline({ hook: hook || bias.name_ru, ...data }, { audioDuration: audioDur }),
    highlight: highlight ?? { what: defaultHighlight(data.summary), tip: data.tip ? defaultHighlight(data.tip) : '' },
  };
}

// Один кадр ролика в PNG — обложка для Reels/Shorts или быстрый предпросмотр
export async function renderReelStill(bias, { outFile, frame = null, hook = '', cta = '', handle = '' } = {}) {
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const inputProps = await reelProps(bias, { hook, cta, handle });
  const url = await serveUrl();
  const browser = browserExecutable();
  const common = { serveUrl: url, inputProps, ...(browser ? { browserExecutable: browser } : {}), logLevel: 'error' };
  const composition = await selectComposition({ ...common, id: 'BiasReel' });
  // по умолчанию — момент, когда название уже на колесе и луч дошёл до точки
  const term = inputProps.timeline.scenes.find((s) => s.id === 'term');
  await renderStill({ ...common, composition, output: outFile, frame: frame ?? Math.min(composition.durationInFrames - 1, term.from + 79), imageFormat: 'png' });
  return { outFile };
}

async function muxAudio(silent, { audio, music, duration, outFile }) {
  const T = duration.toFixed(3);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', silent];
  const f = [];
  if (audio && music) {
    args.push('-i', audio, '-stream_loop', '-1', '-i', music);
    f.push('[1:a]adelay=300|300,apad[voice]', `[2:a]volume=0.12,afade=t=out:st=${(duration - 1.5).toFixed(3)}:d=1.5[bg]`, `[voice][bg]amix=inputs=2:duration=longest:normalize=0,atrim=0:${T}[aout]`);
  } else if (audio) {
    args.push('-i', audio);
    f.push(`[1:a]adelay=300|300,apad,atrim=0:${T}[aout]`);
  } else if (music) {
    args.push('-stream_loop', '-1', '-i', music);
    f.push(`[1:a]volume=0.5,atrim=0:${T},afade=t=out:st=${(duration - 1.5).toFixed(3)}:d=1.5[aout]`);
  } else {
    args.push('-f', 'lavfi', '-t', T, '-i', 'anullsrc=r=44100:cl=stereo');
    f.push('[1:a]anull[aout]');
  }
  args.push('-filter_complex', f.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-t', T, '-movflags', '+faststart', outFile);
  await run(FFMPEG, args, { maxBuffer: 16 * 1024 * 1024 });
}

/**
 * @param {object} bias  запись из data/biases.json
 * @param {object} o     outFile, hook, cta, handle, audio (путь), music (путь), highlight, onProgress
 */
export async function renderReel(bias, { outFile, hook = '', cta = '', handle = '', audio = null, music = process.env.MUSIC_FILE || null, highlight = null, onProgress } = {}) {
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  const dir = await mkdtemp(path.join(tmpdir(), 'reel-'));
  try {
    const voice = audio ? await audioDuration(audio) : null;
    const inputProps = await reelProps(bias, { hook, cta, handle, audioDuration: voice, highlight });
    const url = await serveUrl();
    const browser = browserExecutable();
    const common = { serveUrl: url, inputProps, ...(browser ? { browserExecutable: browser } : {}), logLevel: 'error' };
    const composition = await selectComposition({ ...common, id: 'BiasReel' });
    const silent = path.join(dir, 'silent.mp4');
    await renderMedia({
      ...common, composition, codec: 'h264', crf: 20, muted: true, outputLocation: silent,
      concurrency: Math.max(1, Math.min(8, Math.floor(cpus().length * 0.75))),
      onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
    });
    const duration = composition.durationInFrames / composition.fps;
    await muxAudio(silent, { audio, music, duration, outFile });
    return { outFile, duration, frames: composition.durationInFrames, scenes: inputProps.timeline.scenes };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
