/**
 * The match sheet: both athletes' techniques and the opponent's strength,
 * the verdict, and two tabs — the grip (three sliders, each over a curve of
 * how the margin changes along it) and every athlete's weakest links. The
 * physics is in data/match.js; this only draws it and reports choices.
 */

const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
const num = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
const SVG = 'http://www.w3.org/2000/svg';

/** A native select: compact on a phone, and Telegram shows the system picker. */
function picker(select, items, active, onPick) {
  select.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      option.selected = item.id === active;
      return option;
    }),
  );
  select.addEventListener('change', () => onPick(select.value));
}

/** What a grip value means, in words. */
const DEPTHS = [
  [0.15, 'на пальцах', 'хват на пальцах'],
  [0.4, 'мелкий', 'мелкий хват'],
  [0.65, 'средний', 'средний хват'],
  [0.9, 'глубокий', 'глубокий хват'],
  [Infinity, 'ладонь в ладонь', 'хват ладонь в ладонь'],
];
const depthWords = (d) => DEPTHS.find(([upTo]) => d < upTo);
const DESCRIBE = {
  depth: (d) => depthWords(d)[1],
  height: (h) => (Math.abs(h) < 0.125 ? 'ровно' : h > 0 ? `ты выше ${num(h)} см` : `он выше ${num(-h)} см`),
  rotation: (r) => (Math.abs(r) < 3 ? 'ровно' : r < 0 ? `к крюку ${Math.round(-r)}°` : `к верху ${Math.round(r)}°`),
};

export function createMatchPanel({ techniques, profiles, params, initial, on }) {
  const el = {
    root: $('match'),
    verdict: $('m-verdict'),
    detail: $('m-detail'),
    play: $('m-play'),
    grip: $('m-grip'),
    links: $('m-links'),
    me: $('m-links-me'),
    opp: $('m-links-opp'),
  };
  picker($('m-me'), techniques, initial.me, (id) => on.change({ me: id }));
  picker($('m-opp'), techniques, initial.opp, (id) => on.change({ opp: id }));
  picker($('m-profile'), profiles, initial.profile, (id) => on.change({ profile: id }));
  el.play.addEventListener('click', () => on.play());

  // Tabs: the grip or the links.
  const tabs = [...$('m-tabs').querySelectorAll('button')];
  for (const b of tabs) {
    b.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-checked', String(t === b));
      el.grip.hidden = b.dataset.tab !== 'grip';
      el.links.hidden = b.dataset.tab !== 'links';
      on.tab();
    });
  }

  // One slider per grip parameter, drawn over its margin curve.
  const rows = new Map(
    params.map((p) => {
      const row = document.createElement('div');
      row.className = 'grip__row';
      row.innerHTML =
        '<span class="grip__name"></span>' +
        '<div class="grip__track"><svg class="grip__curve" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"></svg>' +
        '<input type="range" /></div>' +
        '<output class="grip__val"></output>';
      row.querySelector('.grip__name').textContent = p.label;
      const input = row.querySelector('input');
      Object.assign(input, { min: String(p.min), max: String(p.max), step: String(p.step) });
      input.setAttribute('aria-label', p.label);
      input.addEventListener('input', () => on.grip({ [p.key]: Number(input.value) }, false));
      input.addEventListener('change', () => on.grip({ [p.key]: Number(input.value) }, true));
      el.grip.append(row);
      return [p.key, { p, row, input, out: row.querySelector('output'), svg: row.querySelector('svg') }];
    }),
  );

  const foot = document.createElement('div');
  foot.className = 'grip__foot';
  foot.innerHTML =
    '<button class="chip grip__straps" type="button" aria-pressed="false">Ремни</button>' +
    '<p class="grip__hint"><span class="grip__sense"></span><span class="grip__best"></span></p>' +
    '<button class="chip chip--accent grip__set" type="button" hidden>Поставить</button>';
  el.grip.append(foot);
  const straps = foot.querySelector('.grip__straps');
  const sense = foot.querySelector('.grip__sense');
  const best = foot.querySelector('.grip__best');
  const setBest = foot.querySelector('.grip__set');
  straps.addEventListener('click', () => on.grip({ straps: straps.getAttribute('aria-pressed') !== 'true' }, true));
  let bestDepth = null;
  setBest.addEventListener('click', () => bestDepth !== null && on.grip({ depth: bestDepth }, true));

  const list = (ol, demands, broke) => {
    ol.replaceChildren(
      ...demands.slice(0, 3).map((d, i) => {
        const li = document.createElement('li');
        li.className = `m-link${i === 0 && broke ? ' is-broke' : ''}`;
        li.innerHTML = '<span></span><b></b><i><s></s></i>';
        li.querySelector('span').textContent = d.action.name;
        li.querySelector('b').textContent = pct(Math.min(d.share, 9.99));
        li.querySelector('s').style.width = pct(Math.min(d.share, 1));
        return li;
      }),
    );
  };
  const failure = (d) => d.action.failure ?? d.action.name.toLowerCase();

  /** A margin curve: green where you hold more, red where he does, on a shared scale. */
  const curve = (svg, margins, scale) => {
    const n = margins.length;
    const y = (m) => 12 - (11 * Math.max(-scale, Math.min(scale, m))) / scale;
    const line = margins.map((m, i) => `${((100 * i) / (n - 1)).toFixed(2)},${y(m).toFixed(2)}`).join(' L');
    const area = `M0,12 L${line} L100,12 Z`;
    const id = svg.dataset.id ?? (svg.dataset.id = `c${Math.random().toString(36).slice(2, 8)}`);
    svg.innerHTML =
      `<defs><clipPath id="${id}u"><rect x="0" y="0" width="100" height="12"/></clipPath>` +
      `<clipPath id="${id}d"><rect x="0" y="12" width="100" height="12"/></clipPath></defs>` +
      `<path d="${area}" class="grip__win" clip-path="url(#${id}u)"/>` +
      `<path d="${area}" class="grip__lose" clip-path="url(#${id}d)"/>` +
      `<path d="M0,12 L100,12" class="grip__zero"/>` +
      `<path d="M${line}" class="grip__line" fill="none"/>`;
    svg.setAttribute('xmlns', SVG);
  };

  return {
    set hidden(v) {
      el.root.hidden = v;
    },

    /** Put the sliders where the grip is (after a reset or "Поставить"). */
    setGrip(grip) {
      for (const [key, r] of rows) {
        r.input.value = String(grip[key]);
        r.out.textContent = DESCRIBE[key](grip[key]);
      }
      straps.setAttribute('aria-pressed', String(grip.straps));
      rows.get('depth').row.classList.toggle('is-off', grip.straps);
      rows.get('depth').input.disabled = grip.straps;
    },

    setPlaying(playing) {
      el.play.disabled = playing;
      el.play.textContent = playing ? '…' : '▶ Срыв';
    },

    render(result) {
      const { winner, margin, kg } = result;
      const kgText = `${Math.round(kg)} кг`;
      if (winner === 'even') {
        el.verdict.textContent = 'Равная схватка';
        el.detail.textContent = `Оба упираются в ${kgText}: первым сдаётся тот, кто дрогнет — «${failure(result.me[0])}».`;
      } else if (winner === 'me') {
        el.verdict.textContent = `Ты держишь на ${pct(margin)} больше`;
        el.detail.textContent = `Соперник ломается первым на ${kgText}: ${failure(result.opp[0])}.`;
      } else {
        el.verdict.textContent = `Тебе не хватает ${pct(1 / (1 + margin) - 1)}`;
        el.detail.textContent = `Первым сдаёшься ты на ${kgText}: ${failure(result.me[0])}.`;
      }
      el.verdict.dataset.winner = winner;
      list(el.me, result.me, winner !== 'me');
      list(el.opp, result.opp, winner !== 'opp');
    },

    /**
     * `sweeps` — { depth, height, rotation }: { values, margins } from
     * MatchSolver.sweep(); `margin` — the current one. Draws the curves and
     * says what each parameter is worth and which depth suits you.
     */
    renderSweeps(sweeps, grip, margin) {
      const all = Object.values(sweeps).flatMap((s) => s.margins);
      const scale = Math.min(1, Math.max(0.1, ...all.map(Math.abs)));
      for (const [key, r] of rows) if (sweeps[key]) curve(r.svg, sweeps[key].margins, scale);

      // Worth of each parameter around where the grip is now.
      const at = (s, v) => {
        const i = Math.max(0, Math.min(s.values.length - 2, Math.floor(((v - s.values[0]) / (s.values.at(-1) - s.values[0])) * (s.values.length - 1))));
        const f = (v - s.values[i]) / (s.values[i + 1] - s.values[i]);
        return s.margins[i] + (s.margins[i + 1] - s.margins[i]) * Math.max(0, Math.min(1, f));
      };
      const perCm = (at(sweeps.height, grip.height + 0.5) - at(sweeps.height, grip.height - 0.5)) / 1;
      const per10 = (at(sweeps.rotation, grip.rotation + 5) - at(sweeps.rotation, grip.rotation - 5)) / 1;
      const turn = per10 >= 0 ? 'к верху' : 'к крюку';
      sense.textContent = `1 см высоты: ${signed(perCm)} · 10° ${turn}: ${signed(Math.abs(per10))}.`;

      // The depth that suits you, all else as it is.
      const d = sweeps.depth;
      const i = d.margins.indexOf(Math.max(...d.margins));
      const gain = d.margins[i] - margin;
      bestDepth = null;
      if (grip.straps) best.textContent = 'С ремнями глубина почти не важна.';
      else if (gain > 0.02 && Math.abs(d.values[i] - grip.depth) > 0.08) {
        bestDepth = Math.round(d.values[i] * 20) / 20;
        best.textContent = `Тебе выгоднее ${depthWords(bestDepth)[2]}: ${signed(gain)}.`;
      } else best.textContent = 'Глубина уже лучшая для тебя.';
      setBest.hidden = bestDepth === null;
    },
  };
}
