/**
 * The match sheet: both athletes' techniques, the grip, whose hand is higher,
 * the opponent's strength profile — and the verdict. The physics is in
 * data/match.js; this only draws it and reports choices.
 */

const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round(x * 100)}%`;

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

export function createMatchPanel({ techniques, grips, heights, profiles, initial, on }) {
  const el = {
    root: $('match'),
    verdict: $('m-verdict'),
    detail: $('m-detail'),
    me: $('m-links-me'),
    opp: $('m-links-opp'),
  };
  picker($('m-me'), techniques, initial.me, (id) => on.change({ me: id }));
  picker($('m-opp'), techniques, initial.opp, (id) => on.change({ opp: id }));
  picker($('m-grip'), grips, initial.grip, (id) => on.change({ grip: id }));
  picker($('m-height'), heights, initial.height, (id) => on.change({ height: id }));
  picker($('m-profile'), profiles, initial.profile, (id) => on.change({ profile: id }));

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

  return {
    set hidden(v) {
      el.root.hidden = v;
    },

    render(result) {
      const { winner, margin, kg } = result;
      const kgText = `${Math.round(kg)} кг`;
      if (winner === 'even') {
        el.verdict.textContent = 'Равная схватка';
        el.detail.textContent = `Оба упираются в ${kgText}: первым сдаётся тот, кто дрогнет в «${result.me[0].action.name.toLowerCase()}».`;
      } else if (winner === 'me') {
        el.verdict.textContent = `Ты держишь на ${pct(margin)} больше`;
        el.detail.textContent = `Соперник ломается первым на ${kgText}: ${result.opp[0].action.name.toLowerCase()}.`;
      } else {
        el.verdict.textContent = `Тебе не хватает ${pct(1 / (1 + margin) - 1)}`;
        el.detail.textContent = `Первым сдаёшься ты на ${kgText}: ${result.me[0].action.name.toLowerCase()}.`;
      }
      el.verdict.dataset.winner = winner;
      list(el.me, result.me, winner !== 'me');
      list(el.opp, result.opp, winner !== 'opp');
    },
  };
}
