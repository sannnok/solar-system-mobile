/**
 * The per-body info panel: a short blurb, a fact table, and one live figure
 * that keeps ticking as the simulation runs.
 */

const KM_PER_AU = 149.597871;

export function createInfoPanel({ onClose }) {
  const panel = document.getElementById('info-panel');
  const typeEl = document.getElementById('info-type');
  const nameEl = document.getElementById('info-name');
  const blurbEl = document.getElementById('info-blurb');
  const factsEl = document.getElementById('info-facts');
  const liveEl = document.getElementById('info-live');

  document.getElementById('info-close').addEventListener('click', () => onClose());

  let current = null;

  function renderFacts(facts) {
    factsEl.replaceChildren();
    for (const [term, value] of facts ?? []) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      factsEl.append(dt, dd);
    }
  }

  return {
    get current() {
      return current;
    },

    show(body) {
      current = body;
      const data = body.data;
      typeEl.textContent = data.type ?? '';
      nameEl.textContent = data.name;
      blurbEl.textContent = data.description ?? '';
      renderFacts(data.facts);
      liveEl.textContent = '';
      panel.hidden = false;
    },

    hide() {
      current = null;
      panel.hidden = true;
    },

    /** Called every frame while the panel is open. */
    updateLive(system) {
      if (!current) return;

      if (current.kind === 'moon') {
        const period = current.data.facts.find(([term]) => term === 'Orbital period');
        liveEl.innerHTML = period
          ? `Orbiting <b>${current.parent.name}</b> · one lap every ${period[1]}`
          : `Orbiting <b>${current.parent.name}</b>`;
        return;
      }

      if (current.kind === 'star') {
        const earth = system.planets.find((planet) => planet.id === 'earth');
        if (!earth) {
          liveEl.textContent = '';
          return;
        }
        const minutes = (earth.distanceAu * KM_PER_AU * 1e6) / 299792.458 / 60;
        liveEl.innerHTML = `Sunlight reaches Earth in <b>${minutes.toFixed(
          1
        )} minutes</b> right now`;
        return;
      }

      const au = current.distanceAu;
      liveEl.innerHTML = `Currently <b>${au.toFixed(3)} AU</b> from the Sun · ${(
        au * KM_PER_AU
      ).toFixed(1)} million km`;
    },
  };
}
