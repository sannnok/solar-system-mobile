// Динамичный ролик про одно искажение: крючок → название на колесе кодекса →
// что это → пример → как не попасться → карточка из бота и призыв.
import { AbsoluteFill, Img, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  Background, Camera, Label, Scene, Shine, Wheel, Words, useFonts,
  BODY, TITLE, INK, MUTED, BG, clamp, rgba,
} from './fx.jsx';
import { OVERLAP } from './timeline.mjs';

const PAD = 90;
const SAFE_TOP = 300; // ниже интерфейса площадок и полосы прогресса

function Hook({ hook, accent }) {
  return (
    <AbsoluteFill style={{ padding: `${SAFE_TOP}px ${PAD}px 420px`, justifyContent: 'center' }}>
      <Words text={hook} start={OVERLAP * 0.3} stagger={3} accent={accent} highlight={hook.split(/\s+/).slice(-2).join(' ')}
        font={TITLE} weight={800} style={{ fontSize: 96, lineHeight: 1.12, color: INK, justifyContent: 'center', textAlign: 'center' }} />
    </AbsoluteFill>
  );
}

function Term({ bias, dots }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.round(interpolate(frame, [6, 30], [0, bias.n], clamp));
  const pill = spring({ frame: frame - 4, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ padding: `${SAFE_TOP - 60}px ${PAD}px 360px`, alignItems: 'center' }}>
      <div style={{ transform: `scale(${pill})`, opacity: pill, display: 'flex', gap: 18, alignItems: 'center', padding: '14px 28px', borderRadius: 999, border: `3px solid ${rgba(bias.accent, 0.5)}`, background: rgba(bias.accent, 0.14), marginBottom: 40 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: bias.accent, boxShadow: `0 0 16px ${bias.accent}` }} />
        <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 30, letterSpacing: 3, color: bias.accent, textTransform: 'uppercase' }}>{bias.quadrantTitle}</div>
      </div>
      <Wheel dots={dots} accent={bias.accent} size={600} start={0} />
      <div style={{ position: 'relative', marginTop: 40, width: '100%' }}>
        <Words text={bias.name} start={30} stagger={3} accent={bias.accent} font={TITLE} weight={800}
          style={{ fontSize: bias.name.length > 26 ? 74 : 88, lineHeight: 1.1, color: INK, justifyContent: 'center', textAlign: 'center' }} />
        <Shine start={58} duration={20} height={260} />
      </div>
      <div style={{ marginTop: 26, fontFamily: BODY, fontWeight: 700, fontSize: 34, color: MUTED, opacity: interpolate(frame, [8, 16], [0, 1], clamp) }}>
        ловушка № {n} из {bias.total}
      </div>
    </AbsoluteFill>
  );
}

function TextScene({ label, text, accent, highlight, children }) {
  return (
    <AbsoluteFill style={{ padding: `${SAFE_TOP}px ${PAD}px 420px`, justifyContent: 'center' }}>
      <Label text={label} accent={accent} start={OVERLAP * 0.4} />
      {children}
      <Words text={text} start={OVERLAP * 0.6 + 4} stagger={2.2} accent={accent} highlight={highlight}
        style={{ fontSize: text.length > 90 ? 62 : 72, lineHeight: 1.24, color: INK }} />
    </AbsoluteFill>
  );
}

// Пример — на «карточке», которая переворачивается в 3D
function Example({ text, accent }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flip = spring({ frame: frame - 3, fps, config: { damping: 14, stiffness: 90 } });
  return (
    <AbsoluteFill style={{ padding: `${SAFE_TOP}px ${PAD - 20}px 420px`, justifyContent: 'center', perspective: 1600 }}>
      <Label text="Пример из жизни" accent={accent} start={2} />
      <div style={{
        transform: `rotateX(${(1 - flip) * -75}deg) translateY(${(1 - flip) * 120}px)`, transformOrigin: '50% 0%',
        background: 'rgba(255,255,255,0.06)', border: `2px solid ${rgba(accent, 0.35)}`, borderRadius: 40,
        padding: '120px 52px 60px', boxShadow: `0 40px 120px rgba(0,0,0,0.5), 0 0 60px ${rgba(accent, 0.15)}`, position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 18, left: 44, fontFamily: TITLE, fontSize: 170, lineHeight: 1, color: accent, opacity: interpolate(frame, [8, 16], [0, 0.9], clamp), transform: `scale(${interpolate(frame, [8, 18], [1.6, 1], clamp)})`, transformOrigin: '20% 30%' }}>“</div>
        <Words text={text} start={10} stagger={2.2} accent={accent} style={{ fontSize: text.length > 90 ? 58 : 66, lineHeight: 1.26, color: INK }} />
      </div>
    </AbsoluteFill>
  );
}

// Галочка прорисовывается линией
function Check({ accent, start }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame - start, [0, 14], [0, 1], clamp);
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ marginBottom: 26, filter: `drop-shadow(0 0 18px ${accent})` }}>
      <circle cx="60" cy="60" r="54" fill="none" stroke={accent} strokeWidth="6" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p} transform="rotate(-90 60 60)" />
      <path d="M36 62 L54 80 L86 44" fill="none" stroke={accent} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"
        pathLength="1" strokeDasharray="1" strokeDashoffset={1 - interpolate(frame - start, [10, 22], [0, 1], clamp)} />
    </svg>
  );
}

// Финал: та же карточка, что в боте, выезжает в 3D, кнопка пульсирует
function Cta({ bias, card, cta, handle }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inP = spring({ frame: frame - 2, fps, config: { damping: 15, stiffness: 80 } });
  const pulse = 1 + 0.035 * Math.sin(frame / 4);
  const btn = spring({ frame: frame - 22, fps, config: { damping: 11 } });
  return (
    <AbsoluteFill style={{ padding: `${SAFE_TOP - 80}px ${PAD}px 420px`, alignItems: 'center', perspective: 1800 }}>
      <Words text={cta} start={4} stagger={2.4} accent={bias.accent} highlight="" font={TITLE} weight={800}
        style={{ fontSize: 60, lineHeight: 1.15, color: INK, justifyContent: 'center', textAlign: 'center', marginBottom: 46 }} />
      {card && (
        <div style={{ position: 'relative', transform: `rotateY(${(1 - inP) * 28}deg) rotateX(${(1 - inP) * 14}deg) translateY(${(1 - inP) * 260}px) scale(${0.8 + 0.2 * inP})`, opacity: interpolate(frame, [0, 8], [0, 1], clamp) }}>
          <Img src={card} style={{ width: 660, borderRadius: 34, boxShadow: `0 50px 140px rgba(0,0,0,0.6), 0 0 90px ${rgba(bias.accent, 0.35)}` }} />
          <Shine start={26} duration={22} width={660} height={825} />
        </div>
      )}
      <div style={{
        marginTop: 44, transform: `scale(${btn * pulse})`, opacity: btn, padding: '30px 58px', borderRadius: 999,
        background: bias.accent, color: BG, fontFamily: BODY, fontWeight: 800, fontSize: 48, boxShadow: `0 0 ${30 + 20 * Math.sin(frame / 4)}px ${bias.accent}`,
      }}>{handle || 'Ссылка в профиле'}</div>
    </AbsoluteFill>
  );
}

function Progress({ total, accent, n, all, handle }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: `150px ${PAD}px 0` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: BODY, fontWeight: 800, fontSize: 26, letterSpacing: 2, color: MUTED, marginBottom: 16 }}>
        <span>КОДЕКС ИСКАЖЕНИЙ · {n}/{all}</span><span>{handle}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
        <div style={{ width: `${(frame / total) * 100}%`, height: '100%', background: accent, boxShadow: `0 0 14px ${accent}` }} />
      </div>
    </AbsoluteFill>
  );
}

export function BiasReel({ bias, hook, cta, handle, wheel, card, timeline, highlight }) {
  useFonts();
  const scene = Object.fromEntries(timeline.scenes.map((s) => [s.id, s]));
  const order = timeline.scenes.map((s) => s.id);
  const dirs = { hook: ['none', 'left'], term: ['left', 'up'], what: ['up', 'left'], example: ['left', 'up'], tip: ['up', 'zoom'], cta: ['zoom', 'none'] };
  const wrap = (id, el) => {
    const s = scene[id];
    if (!s) return null;
    const [enter, exit] = dirs[id];
    return (
      <Sequence key={id} from={s.from} durationInFrames={s.dur} name={id}>
        <Scene dur={s.dur} overlap={OVERLAP} enter={id === order[0] ? 'none' : enter} exit={id === order.at(-1) ? 'none' : exit}>{el}</Scene>
      </Sequence>
    );
  };
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Background accent={bias.accent} />
      <Camera shakeAt={[scene.term?.from + 44].filter(Boolean)}>
        {wrap('hook', <Hook hook={hook} accent={bias.accent} />)}
        {wrap('term', <Term bias={bias} dots={wheel} />)}
        {wrap('what', <TextScene label="Что это" text={bias.summary} accent={bias.accent} highlight={highlight?.what} />)}
        {wrap('example', <Example text={bias.example ?? ''} accent={bias.accent} />)}
        {wrap('tip', <TextScene label="Как не попасться" text={bias.tip ?? ''} accent={bias.accent} highlight={highlight?.tip}>
          <Check accent={bias.accent} start={OVERLAP} />
        </TextScene>)}
        {wrap('cta', <Cta bias={bias} card={card} cta={cta} handle={handle} />)}
      </Camera>
      <Progress total={timeline.total} accent={bias.accent} n={bias.n} all={bias.total} handle={handle} />
    </AbsoluteFill>
  );
}
