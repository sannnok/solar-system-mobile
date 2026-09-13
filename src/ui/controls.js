/**
 * The dock: play/pause, the speed slider, the layer toggles and the body chips.
 *
 * The slider is logarithmic — a linear one would spend most of its travel in
 * speeds nobody wants, and the useful range here spans six orders of magnitude.
 */

import { MAX_RATE, MIN_RATE } from '../core/simulation.js';
import { formatDate, formatRate, formatTime } from '../util/time.js';

const SLIDER_STEPS = 1000;
const LOG_RANGE = Math.log(MAX_RATE / MIN_RATE);

function sliderToRate(value) {
  return MIN_RATE * Math.exp((value / SLIDER_STEPS) * LOG_RANGE);
}

function rateToSlider(rate) {
  return Math.round((Math.log(rate / MIN_RATE) / LOG_RANGE) * SLIDER_STEPS);
}

export function createControls({ simulation, system, actions }) {
  const playButton = document.getElementById('play');
  const speedSlider = document.getElementById('speed');
  const speedValue = document.getElementById('speed-value');
  const chipsContainer = document.getElementById('chips');
  const clockDate = document.getElementById('clock-date');
  const clockTime = document.getElementById('clock-time');

  const toggles = {
    labels: document.getElementById('toggle-labels'),
    orbits: document.getElementById('toggle-orbits'),
    trails: document.getElementById('toggle-trails'),
  };

  const chips = new Map();
  for (const body of system.all) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', 'false');
    chip.style.setProperty('--chip-color', `#${body.data.color.toString(16).padStart(6, '0')}`);
    chip.innerHTML = `<span class="chip__dot"></span>${body.name}`;
    chip.addEventListener('click', () => actions.focus(body));
    chipsContainer.append(chip);
    chips.set(body.id, chip);
  }

  playButton.addEventListener('click', () => simulation.togglePaused());

  function paintSliderFill() {
    speedSlider.style.setProperty('--fill', `${(Number(speedSlider.value) / SLIDER_STEPS) * 100}%`);
  }

  speedSlider.addEventListener('input', () => {
    simulation.setRate(sliderToRate(Number(speedSlider.value)));
    paintSliderFill();
  });

  toggles.labels.addEventListener('click', () => actions.toggleLabels());
  toggles.orbits.addEventListener('click', () => actions.toggleOrbits());
  toggles.trails.addEventListener('click', () => actions.toggleTrails());
  document.getElementById('reset-view').addEventListener('click', () => actions.resetView());
  document.getElementById('now').addEventListener('click', () => actions.jumpToNow());

  speedSlider.value = String(rateToSlider(simulation.targetRate));

  function syncSimulation() {
    const paused = simulation.paused;
    playButton.setAttribute('aria-pressed', String(paused));
    playButton.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    speedValue.textContent = paused ? 'Paused' : formatRate(simulation.targetRate);
    const slider = String(rateToSlider(simulation.targetRate));
    if (speedSlider.value !== slider) speedSlider.value = slider;
    paintSliderFill();
  }

  simulation.onChange(syncSimulation);
  syncSimulation();

  return {
    setToggleState(name, on) {
      toggles[name].setAttribute('aria-pressed', String(on));
    },

    setFocus(body) {
      for (const [id, chip] of chips) {
        chip.setAttribute('aria-pressed', String(body?.id === id));
      }
    },

    /** Clock readout; only touches the DOM when the rendered string changes. */
    updateClock(julianDay) {
      const date = formatDate(julianDay);
      if (clockDate.textContent !== date) clockDate.textContent = date;
      const time = formatTime(julianDay);
      if (clockTime.textContent !== time) clockTime.textContent = time;
    },
  };
}
