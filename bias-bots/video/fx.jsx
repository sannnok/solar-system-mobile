// Эффекты для динамичного ролика. Всё на CSS/SVG — без WebGL, чтобы рендер
// работал на любом сервере с headless-браузером.
import { useEffect, useState } from 'react';
import {
  AbsoluteFill, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { noise2D } from '@remotion/noise';

export const BG = '#0b0f17';
export const INK = '#f5f7fb';
export const MUTED = 'rgba(245,247,251,0.6)';
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
export const BODY = 'Manrope, sans-serif';
export const TITLE = 'Unbounded, sans-serif';

export const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// Ждём, пока подгрузятся кириллические шрифты, — иначе первые кадры уйдут с запасным шрифтом
export function useFonts() {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const sample = 'Ошибка ЭФФЕКТ abc 0123';
    Promise.all([
      document.fonts.load(`800 80px Unbounded`, sample),
      document.fonts.load(`600 60px Manrope`, sample),
      document.fonts.load(`700 60px Manrope`, sample),
      document.fonts.load(`800 60px Manrope`, sample),
    ]).then(() => document.fonts.ready).then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
}

// Фон: тёмная база, плавающие световые пятна цвета ветки кодекса, зерно, виньетка
export function Background({ accent }) {
  const frame = useCurrentFrame();
  const blobs = [
    { seed: 'a', size: 1100, color: rgba(accent, 0.33), x: 0.75, y: 0.15 },
    { seed: 'b', size: 900, color: 'rgba(96,165,250,0.18)', x: 0.15, y: 0.7 },
    { seed: 'c', size: 700, color: rgba(accent, 0.18), x: 0.6, y: 0.85 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: BG, overflow: 'hidden' }}>
      {blobs.map((b) => {
        const dx = noise2D(b.seed, frame / 140, 0) * 160;
        const dy = noise2D(b.seed, 0, frame / 160) * 200;
        const s = 1 + noise2D(b.seed + 's', frame / 90, 1) * 0.12;
        return (
          <div key={b.seed} style={{
            position: 'absolute', width: b.size, height: b.size, borderRadius: '50%',
            left: b.x * 1080 - b.size / 2 + dx, top: b.y * 1920 - b.size / 2 + dy,
            background: `radial-gradient(circle, ${b.color} 0%, rgba(0,0,0,0) 65%)`,
            transform: `scale(${s})`,
          }} />
        );
      })}
      <Particles accent={accent} />
      <Grain />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
    </AbsoluteFill>
  );
}

// Парящие частицы — медленно поднимаются, мерцают; дают глубину фону
function Particles({ accent, count = 36 }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => {
        const sx = (noise2D('px', i, 0) + 1) / 2;
        const speed = 0.6 + ((noise2D('ps', i, 1) + 1) / 2) * 1.4;
        const y = (((1 - ((frame * speed + i * 97) % 2100) / 2100) * 2100) - 90);
        const x = sx * 1080 + noise2D('pw', i, frame / 80) * 40;
        const size = 3 + ((noise2D('pz', i, 2) + 1) / 2) * 6;
        const tw = 0.25 + 0.35 * ((noise2D('pt', i, frame / 25) + 1) / 2);
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%', background: i % 3 ? accent : '#ffffff', opacity: tw, boxShadow: `0 0 ${size * 2}px ${accent}` }} />;
      })}
    </AbsoluteFill>
  );
}

// Киношное зерно: шум с новым «семенем» каждые 2 кадра
function Grain() {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 50;
  return (
    <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: 'overlay' }}>
      <svg width="1080" height="1920">
        <filter id={`g${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  );
}

// Слова влетают по одному: пружина, подъём, размытие → резкость.
// Слова из highlight получают маркер, который «прокрашивается» следом.
export function Words({ text, start = 0, stagger = 2.4, style, accent, highlight = '', font = BODY, weight = 700 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(/\s+/);
  const hl = highlight ? highlight.split(/\s+/) : [];
  const hlStart = hl.length ? words.length - hl.length : Infinity;
  const lastWordFrame = start + (words.length - 1) * stagger;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.27em', rowGap: '0.08em', fontFamily: font, fontWeight: weight, ...style }}>
      {words.map((w, i) => {
        const f = frame - start - i * stagger;
        const p = spring({ frame: f, fps, config: { damping: 13, stiffness: 170, mass: 0.55 } });
        const opacity = interpolate(f, [0, 5], [0, 1], clamp);
        const blur = interpolate(f, [0, 9], [14, 0], clamp);
        const isHl = i >= hlStart;
        const isFirstHl = i === hlStart;
        const isLastHl = i === words.length - 1;
        // маркер прокрашивает выделенные слова подряд, без разрывов между словами
        const hlFrom = lastWordFrame + 6 + (i - hlStart) * 3;
        const sweep = isHl ? interpolate(frame, [hlFrom, hlFrom + 5], [0, 100], clamp) : 0;
        const pad = 0.14;
        return (
          <span key={i} style={{
            display: 'inline-block', opacity, filter: `blur(${blur}px)`,
            transform: `translateY(${(1 - p) * 46}px) scale(${0.82 + 0.18 * p})`,
            color: isHl && sweep >= 100 ? BG : undefined,
            backgroundImage: isHl ? `linear-gradient(${accent}, ${accent})` : undefined,
            backgroundRepeat: 'no-repeat',
            backgroundSize: isHl ? `${sweep}% 100%` : undefined,
            paddingLeft: isHl ? `${pad}em` : undefined,
            marginLeft: isHl ? `-${pad}em` : undefined,
            // до следующего выделенного слова фон тянется через межсловный пробел
            paddingRight: isHl ? `${isLastHl ? pad : pad + 0.3}em` : undefined,
            marginRight: isHl ? `-${isLastHl ? pad : pad + 0.3}em` : undefined,
            borderRadius: isHl ? `${isFirstHl ? 10 : 0}px ${isLastHl ? 10 : 0}px ${isLastHl ? 10 : 0}px ${isFirstHl ? 10 : 0}px` : undefined,
          }}>{w}</span>
        );
      })}
    </div>
  );
}

// Подпись раздела: полоска растёт, буквы проявляются
export function Label({ text, accent, start = 0 }) {
  const frame = useCurrentFrame();
  const w = interpolate(frame - start, [0, 10], [0, 80], clamp);
  const o = interpolate(frame - start, [3, 10], [0, 1], clamp);
  const ls = interpolate(frame - start, [3, 16], [16, 6], clamp);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 34 }}>
      <div style={{ width: w, height: 8, borderRadius: 4, background: accent, boxShadow: `0 0 24px ${accent}` }} />
      <div style={{ opacity: o, letterSpacing: ls, fontFamily: BODY, fontWeight: 800, fontSize: 34, color: accent, textTransform: 'uppercase' }}>{text}</div>
    </div>
  );
}

// Блик, пробегающий по блоку
export function Shine({ start, duration = 18, width = 1080, height = 400 }) {
  const frame = useCurrentFrame();
  const x = interpolate(frame - start, [0, duration], [-0.4 * width, 1.2 * width], clamp);
  if (frame < start || frame > start + duration) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', mixBlendMode: 'overlay' }}>
      <div style={{ position: 'absolute', top: -height, left: x, width: 160, height: height * 3, transform: 'rotate(18deg)', background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.85), rgba(255,255,255,0))' }} />
    </div>
  );
}

// Колесо кодекса: точки собираются по кругу, колесо медленно вращается,
// к искажению прорисовывается луч, точка пульсирует кольцами.
export function Wheel({ dots, accent, size = 620, start = 0 }) {
  const frame = useCurrentFrame() - start;
  const c = size / 2;
  const r = size * 0.42;
  const rot = interpolate(frame, [0, 120], [-24, 0], { extrapolateRight: 'extend' }) * 1;
  const target = dots.find((d) => d.on);
  const order = (a) => ((a + 90 + 360) % 360) / 360; // по часовой от 12 часов
  const ray = interpolate(frame, [26, 40], [0, 1], clamp);
  const pos = (a, rr = r) => [c + rr * Math.cos((a * Math.PI) / 180), c + rr * Math.sin((a * Math.PI) / 180)];
  const [tx, ty] = target ? pos(target.a) : [c, c];
  const ringT = ((frame - 40) % 30) / 30;
  return (
    <svg width={size} height={size} style={{ transform: `rotate(${rot}deg)`, overflow: 'visible' }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={2} />
      {dots.map((d, i) => {
        const p = interpolate(frame, [order(d.a) * 22, order(d.a) * 22 + 6], [0, 1], clamp);
        const [x, y] = pos(d.a, r * (0.7 + 0.3 * p));
        return <circle key={i} cx={x} cy={y} r={d.on ? 0 : 4.2 * p} fill={d.c} fillOpacity={0.75} />;
      })}
      {target && (
        <>
          <line x1={c} y1={c} x2={c + (tx - c) * ray} y2={c + (ty - c) * ray} stroke={accent} strokeWidth={5} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 10px ${accent})` }} />
          <circle cx={c} cy={c} r={interpolate(frame, [22, 30], [0, 11], clamp)} fill={accent} />
          {frame > 40 && [0, 0.5].map((off) => {
            const t = (ringT + off) % 1;
            return <circle key={off} cx={tx} cy={ty} r={14 + t * 46} fill="none" stroke={accent} strokeWidth={3} strokeOpacity={1 - t} />;
          })}
          <circle cx={tx} cy={ty} r={interpolate(frame, [36, 44], [0, 16], clamp)} fill={accent} style={{ filter: `drop-shadow(0 0 18px ${accent})` }} />
        </>
      )}
    </svg>
  );
}

// Сцена с переходом: въезд/выезд «вжиком» с размытием в движении (или зумом)
export function Scene({ dur, overlap, enter = 'left', exit = 'left', children, punch = true }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inP = enter === 'none' ? 1 : interpolate(frame, [0, overlap], [0, 1], clamp);
  const outP = exit === 'none' ? 0 : interpolate(frame, [dur - overlap, dur], [0, 1], clamp);
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  let tx = 0, ty = 0, sc = 1, blur = 0, op = 1;
  const dist = (dir) => (dir === 'up' ? [0, 1920] : dir === 'right' ? [-1080, 0] : [1080, 0]);
  if (inP < 1) {
    if (enter === 'zoom') { sc = 1.6 - 0.6 * ease(inP); op = inP; blur = (1 - inP) * 30; }
    else { const [dx, dy] = dist(enter); tx = dx * (1 - ease(inP)); ty = dy * (1 - ease(inP)); blur = (1 - inP) * 34; }
  }
  if (outP > 0) {
    if (exit === 'zoom') { sc *= 1 + 0.8 * easeIn(outP); op *= 1 - outP; blur += outP * 30; }
    else { const [dx, dy] = dist(exit); tx -= dx * easeIn(outP); ty -= dy * easeIn(outP); blur += outP * 34; }
  }
  // «удар» при появлении — лёгкое переувеличение и возврат
  const pop = punch ? 1 + 0.05 * (1 - spring({ frame: frame - overlap * 0.6, fps, config: { damping: 9, stiffness: 140 } })) * (frame > overlap * 0.6 ? 1 : 0) : 1;
  const flash = enter === 'zoom' ? interpolate(frame, [overlap - 2, overlap + 6], [0.35, 0], clamp) * (frame >= overlap - 2 ? 1 : 0) : 0;
  return (
    <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${sc * pop})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined, opacity: op }}>
      {children}
      {flash > 0 && <AbsoluteFill style={{ background: '#ffffff', opacity: flash, mixBlendMode: 'screen' }} />}
    </AbsoluteFill>
  );
}

// Лёгкая «ручная» камера: дрейф и микротряска
export function Camera({ children, shakeAt = [] }) {
  const frame = useCurrentFrame();
  let x = noise2D('cx', frame / 70, 0) * 6;
  let y = noise2D('cy', 0, frame / 70) * 8;
  for (const s of shakeAt) {
    const k = interpolate(frame - s, [0, 12], [1, 0], clamp) * (frame >= s ? 1 : 0);
    x += noise2D('sx', frame / 2, s) * 18 * k;
    y += noise2D('sy', s, frame / 2) * 18 * k;
  }
  return <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px)` }}>{children}</AbsoluteFill>;
}
