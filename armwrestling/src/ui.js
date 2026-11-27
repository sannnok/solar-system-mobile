/** DOM side of the app: builds the chips and sheet, and reports what the user does. */

const $ = (id) => document.getElementById(id);

const LAYERS = [
  { id: 'muscles', label: 'Мышцы' },
  { id: 'bones', label: 'Кости' },
  { id: 'skin', label: 'Кожа' },
  { id: 'vectors', label: 'Векторы' },
];

const SPEEDS = [1, 0.5, 0.25];

function chip(label, pressed) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', String(pressed));
  return b;
}

export function createUI({ exercises, views, layers, on }) {
  const el = {
    top: $('top'),
    sheet: $('sheet'),
    exercises: $('exercises'),
    views: $('views'),
    layers: $('layers'),
    phaseName: $('phase-name'),
    phaseCue: $('phase-cue'),
    phases: $('track-phases'),
    scrub: $('scrub'),
    play: $('play'),
    speed: $('speed'),
    mode: $('mode'),
    variants: $('variants'),
    errorCard: $('error-card'),
    errorTitle: $('error-title'),
    errorText: $('error-text'),
    errorRisk: $('error-risk'),
    nowList: $('now-list'),
    card: $('muscle-card'),
    hello: $('hello'),
    badge: $('badge'),
    fullscreen: $('fullscreen'),
  };

  const exerciseChips = exercises.map((ex) => {
    const b = chip(ex.chip, false);
    b.addEventListener('click', () => on.exercise(ex.id));
    el.exercises.append(b);
    return b;
  });
  const matchChip = chip('⚔ Схватка', false);
  matchChip.classList.add('chip--match');
  matchChip.addEventListener('click', () => on.match());
  el.exercises.append(matchChip);

  // Parts of the sheet that belong to a single-arm exercise, not to a match.
  const exerciseOnly = ['.phase', '.timeline', '#mode', '#weak-open'].map((sel) => el.sheet.querySelector(sel));

  const viewChips = views.map((v) => {
    const b = chip(v.label, false);
    b.addEventListener('click', () => on.view(v.id));
    el.views.append(b);
    return [v.id, b];
  });

  for (const layer of LAYERS) {
    const b = chip(layer.label, layers[layer.id]);
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(next));
      on.layer(layer.id, next);
    });
    el.layers.append(b);
  }

  el.play.addEventListener('click', () => on.togglePlay());
  let speedIndex = 0;
  el.speed.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    el.speed.textContent = `${SPEEDS[speedIndex] === 1 ? '1' : SPEEDS[speedIndex] === 0.5 ? '½' : '¼'}×`;
    on.speed(SPEEDS[speedIndex]);
  });

  let scrubbing = false;
  el.scrub.addEventListener('pointerdown', () => (scrubbing = true));
  window.addEventListener('pointerup', () => (scrubbing = false));
  el.scrub.addEventListener('input', () => on.scrub(Number(el.scrub.value) / 1000));

  for (const button of el.mode.querySelectorAll('button')) {
    button.addEventListener('click', () => on.mode(button.dataset.mode));
  }

  $('card-close').addEventListener('click', () => on.closeMuscle());
  $('weak-open').addEventListener('click', () => on.weak());
  el.fullscreen.addEventListener('click', () => on.fullscreen());

  let nowKey = '';

  return {
    el,

    /** Switch the sheet between an exercise and the match. */
    setMatchMode(on) {
      for (const node of exerciseOnly) node.hidden = on;
      if (on) {
        el.variants.hidden = true;
        el.errorCard.hidden = true;
      }
      exerciseChips.forEach((b) => b.setAttribute('aria-pressed', String(false)));
      matchChip.setAttribute('aria-pressed', String(on));
      if (on) matchChip.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    },

    setExercise(ex, index) {
      matchChip.setAttribute('aria-pressed', 'false');
      exerciseChips.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
      exerciseChips[index].scrollIntoView({ inline: 'nearest', block: 'nearest' });
      el.phases.replaceChildren(
        ...ex.phases.map((phase, i) => {
          const next = ex.phases[i + 1]?.at ?? 1;
          const d = document.createElement('div');
          d.className = 'track__phase';
          d.style.flex = String(next - phase.at);
          d.textContent = phase.name;
          return d;
        }),
      );
      el.errorTitle.textContent = ex.error.title;
      el.errorText.textContent = ex.error.text;
      el.errorRisk.textContent = ex.error.risk;
      el.errorCard.classList.toggle('error-card--danger', Boolean(ex.error.danger));
    },

    setView(id) {
      for (const [viewId, b] of viewChips) b.setAttribute('aria-pressed', String(viewId === id));
    },

    setPhase(ex, index) {
      const phase = ex.phases[index];
      el.phaseName.textContent = `${ex.title} · ${phase.name}`;
      el.phaseCue.textContent = phase.cue;
      [...el.phases.children].forEach((d, i) => d.classList.toggle('is-on', i === index));
    },

    setProgress(u) {
      if (!scrubbing) el.scrub.value = String(Math.round(u * 1000));
    },

    setPlaying(playing) {
      el.play.classList.toggle('is-paused', !playing);
      el.play.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    },

    /** What resists: a segmented switch, shown only when there is a choice. */
    setVariants(variants, activeId) {
      el.variants.hidden = variants.length < 2;
      el.variants.style.setProperty('--n', String(variants.length));
      el.variants.replaceChildren(
        ...variants.map((v) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.dataset.variant = v.id;
          b.textContent = v.label;
          b.setAttribute('aria-checked', String(v.id === activeId));
          b.addEventListener('click', () => on.variant(v.id));
          return b;
        }),
      );
    },

    setVariant(activeId) {
      for (const b of el.variants.children) b.setAttribute('aria-checked', String(b.dataset.variant === activeId));
    },

    setMode(mode) {
      for (const button of el.mode.querySelectorAll('button')) {
        button.setAttribute('aria-checked', String(button.dataset.mode === mode));
      }
      el.errorCard.hidden = mode !== 'error';
    },

    /** Top three working muscles; rebuilt only when the order changes. */
    setNow(items, onPick) {
      const key = items.map((i) => i.id).join();
      if (key !== nowKey) {
        nowKey = key;
        el.nowList.replaceChildren(
          ...items.map((item) => {
            const li = document.createElement('li');
            li.className = 'now__item';
            li.innerHTML = '<span class="now__name"></span><span class="now__pct"></span>';
            li.querySelector('.now__name').textContent = item.name;
            li.addEventListener('click', () => onPick(item.id));
            return li;
          }),
        );
      }
      [...el.nowList.children].forEach((li, i) => {
        const pct = Math.round(items[i].value * 100);
        li.querySelector('.now__pct').textContent = `${pct}%`;
        li.style.setProperty('--v', `${pct}%`);
      });
    },

    openMuscle(info) {
      $('card-latin').textContent = info.latin;
      $('card-name').textContent = info.name;
      $('card-role').textContent = info.role;
      $('card-train').textContent = info.train;
      const note = $('card-note');
      note.hidden = !info.note;
      note.textContent = info.note ?? '';
      el.card.hidden = false;
    },

    setMuscleLoad(value) {
      const pct = Math.round(value * 100);
      $('card-meter').style.setProperty('--v', `${pct}%`);
      $('card-pct').textContent = `Усилие сейчас: ${pct}% от максимума этой мышцы`;
    },

    closeMuscle() {
      el.card.hidden = true;
    },

    /** How much of the canvas the chrome covers, for framing the camera. */
    covers() {
      const h = window.innerHeight;
      const sheetTop = el.sheet.getBoundingClientRect().top;
      const header = el.top.getBoundingClientRect().bottom;
      // The live-muscles panel sits just under the header; keep the arm below it.
      const panel = $('now').offsetHeight;
      return { header, top: header + 2 + panel, bottom: Math.max(h - sheetTop, 0) };
    },
  };
}
