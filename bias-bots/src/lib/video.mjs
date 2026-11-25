// Вертикальный ролик 1080×1920 из четырёх кадров (крючок → что это → пример →
// как не попасться + призыв в бот) с лёгким панорамированием и плавными переходами.
// Озвучка (mp3/wav) и фоновая музыка — по желанию; длительность кадров подгоняется
// под длину озвучки. Нужен ffmpeg в PATH (или FFMPEG_PATH).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderSlide, SLIDE_KINDS } from './cards.mjs';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FADE = 0.45;
const FPS = 30;

export async function audioDuration(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`не удалось узнать длительность ${file}`);
  return d;
}

// Время на кадр — по объёму текста (читаем ~15 знаков в секунду), 3–7 с.
export function slideDurations(bias, { hook = '', total = null } = {}) {
  const texts = [hook || bias.name_ru, bias.summary_ru, bias.example_ru ?? '', bias.tip_ru ?? ''];
  const base = texts.map((t, i) => Math.min(7, Math.max(3, 1.6 + t.length / 15 + (i === 3 ? 1.5 : 0))));
  if (!total) return base;
  const k = total / base.reduce((a, b) => a + b, 0);
  return base.map((d) => Math.max(2.2, d * k));
}

/**
 * @param {object} bias
 * @param {object} o
 * @param {string} o.outFile        куда сохранить .mp4
 * @param {string} [o.hook]         подзаголовок на первом кадре
 * @param {string} [o.cta]          текст кнопки на последнем кадре
 * @param {string} [o.handle]       @имя_бота
 * @param {string} [o.audio]        путь к озвучке
 * @param {string} [o.music]        путь к фоновой музыке
 */
export async function makeVideo(bias, { outFile, hook = '', cta = '', handle = '', audio = null, music = process.env.MUSIC_FILE || null } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'reel-'));
  try {
    const slides = [];
    for (const kind of SLIDE_KINDS) {
      const file = path.join(dir, `${kind}.png`);
      await writeFile(file, await renderSlide(bias, kind, { handle, hook, cta }));
      slides.push(file);
    }

    const voice = audio ? await audioDuration(audio) : 0;
    const D = slideDurations(bias, { hook, total: voice ? voice + 1.2 : null });
    const total = D.reduce((a, b) => a + b, 0);

    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    slides.forEach((file, i) => {
      const len = D[i] + (i < slides.length - 1 ? FADE : 0);
      args.push('-loop', '1', '-framerate', String(FPS), '-t', len.toFixed(3), '-i', file);
    });

    const filters = [];
    slides.forEach((_, i) => {
      const len = D[i] + (i < slides.length - 1 ? FADE : 0);
      // кадр чуть крупнее экрана и медленно едет — статичная картинка в ленте «умирает»
      const x = i % 2 ? `(in_w-out_w)*(1-t/${len.toFixed(3)})` : `(in_w-out_w)*t/${len.toFixed(3)}`;
      filters.push(`[${i}:v]scale=1146:2038,crop=1080:1920:x='${x}':y='(in_h-out_h)/2',setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
    });
    let prev = 'v0';
    let offset = 0;
    for (let i = 1; i < slides.length; i++) {
      offset += D[i - 1];
      const out = i === slides.length - 1 ? 'vout' : `x${i}`;
      filters.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[${out}]`);
      prev = out;
    }

    let next = slides.length;
    const T = total.toFixed(3);
    if (audio && music) {
      args.push('-i', audio, '-stream_loop', '-1', '-i', music);
      filters.push(`[${next}:a]adelay=300|300,apad[voice]`);
      filters.push(`[${next + 1}:a]volume=0.12,afade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5[bg]`);
      filters.push(`[voice][bg]amix=inputs=2:duration=longest:normalize=0,atrim=0:${T}[aout]`);
    } else if (audio) {
      args.push('-i', audio);
      filters.push(`[${next}:a]adelay=300|300,apad,atrim=0:${T}[aout]`);
    } else if (music) {
      args.push('-stream_loop', '-1', '-i', music);
      filters.push(`[${next}:a]volume=0.5,atrim=0:${T},afade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5[aout]`);
    } else {
      // Без звука ролик в соцсетях часто ставят ниже — кладём тишину, но дорожку держим
      args.push('-f', 'lavfi', '-t', T, '-i', 'anullsrc=r=44100:cl=stereo');
      filters.push(`[${next}:a]anull[aout]`);
    }

    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-t', T, '-movflags', '+faststart', outFile);
    await run(FFMPEG, args, { maxBuffer: 16 * 1024 * 1024 });
    return { outFile, duration: total, slides: D };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
