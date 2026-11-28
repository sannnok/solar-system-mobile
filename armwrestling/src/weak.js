/**
 * The "weak link" sheet: torque on every joint against the athlete's maximum
 * for that action, live through the rep, and a form for the athlete's own
 * maximums. The maths is in data/mechanics.js; this file only draws it.
 */

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n < 10 ? n.toFixed(1) : Math.round(n).toString()).replace('.', ',');

export function createWeakPanel({ actions, typical, on }) {
  const el = {
    card: $('weak-card'),
    context: $('weak-context'),
    verdict: $('weak-verdict'),
    force: $('weak-force'),
    forceLabel: $('weak-force-label'),
    forceOut: $('weak-force-out'),
    list: $('weak-list'),
    form: $('weak-form'),
    fields: $('weak-fields'),
    source: $('weak-source'),
  };

  // One row per joint, reused between updates.
  const rows = Array.from({ length: 5 }, () => {
    const li = document.createElement('li');
    li.className = 'weak__row';
    li.innerHTML = '<span class="weak__name"></span><span class="weak__val"></span><span class="weak__bar"><i></i></span>';
    el.list.append(li);
    return li;
  });

  // Own-maximum inputs, one per action.
  const inputs = new Map(
    actions.map((a) => {
      const label = document.createElement('label');
      label.className = 'weak__field';
      label.innerHTML = '<span></span><input type="number" inputmode="decimal" min="1" max="500" step="0.5" /><small></small>';
      label.querySelector('span').textContent = a.field ?? a.name;
      label.querySelector('small').textContent = a.unit ?? 'Н·м';
      el.fields.append(label);
      return [a.id, label.querySelector('input')];
    }),
  );

  el.force.addEventListener('input', () => on.force(Number(el.force.value)));
  $('weak-close').addEventListener('click', () => on.close());
  $('weak-edit').addEventListener('click', () => {
    el.form.hidden = !el.form.hidden;
  });
  $('weak-reset').addEventListener('click', () => {
    for (const [id, input] of inputs) input.value = String(typical[id]);
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const caps = {};
    for (const [id, input] of inputs) {
      const v = Number(String(input.value).replace(',', '.'));
      caps[id] = Number.isFinite(v) && v > 0 ? v : typical[id];
    }
    el.form.hidden = true;
    on.save(caps);
  });

  return {
    get open() {
      return !el.card.hidden;
    },
    show() {
      el.card.hidden = false;
    },
    hide() {
      el.card.hidden = true;
      el.form.hidden = true;
    },

    setCapacities(caps, own) {
      for (const [id, input] of inputs) input.value = String(caps[id]);
      el.source.textContent = own
        ? 'Максимумы — твои. Изменить можно в «Мои максимумы».'
        : 'Максимумы — порядок величин для нетренированного мужчины. Введи свои — и расчёт станет твоим.';
    },

    setForce(kg, cable) {
      el.force.value = String(kg);
      el.forceLabel.textContent = cable ? 'Вес на тросе' : 'Сила соперника';
      el.forceOut.textContent = `${kg} кг`;
    },

    /** `demands` from jointDemands(), weakest first. */
    render(context, demands) {
      el.context.textContent = context;
      const top = demands[0];
      el.verdict.textContent =
        top.share >= 1
          ? `Не держится: ${top.action.name.toLowerCase()} — ${Math.round(top.share * 100)}% от максимума`
          : `Сейчас решает: ${top.action.name.toLowerCase()} — ${Math.round(top.share * 100)}% от максимума`;
      el.verdict.classList.toggle('is-over', top.share >= 1);
      demands.forEach((d, i) => {
        const li = rows[i];
        const pct = Math.round(d.share * 100);
        li.classList.toggle('is-top', i === 0);
        li.classList.toggle('is-over', d.share >= 1);
        li.querySelector('.weak__name').textContent = d.action.name;
        li.querySelector('.weak__val').textContent = `${fmt(d.torque)} из ${fmt(d.max)} Н·м · ${pct}%`;
        li.querySelector('i').style.width = `${Math.min(pct, 100)}%`;
      });
    },
  };
}
