/**
 * One view per way of asking: ranking, taboo, and for one_of the four ways of
 * showing it. Every view ends in ctx.pick(...), and the controller turns that
 * into the one line that lands in the map. Where the line is assembled (ranking,
 * taboo), the view shows it before it lands: the button and the line are two
 * different things. Nothing here asks for typing: the owner does not type.
 *
 * @typedef {Object} CardContext
 * @property {import('../core/bank.js').Question} q
 * @property {string} key                              Unique across domains.
 * @property {(pick: unknown) => void} pick            Records the answer.
 * @property {() => unknown} draft                     Work in progress on this card.
 * @property {(value: unknown) => void} setDraft
 * @property {(fn: () => void) => void} onDispose      Runs when the card leaves the screen.
 */

import { h } from './dom.js';
import { lineFor } from '../core/kinds.js';
import { DEMOS } from './demos.js';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @type {Record<string, (ctx: CardContext) => Node[]>} */
const VIEWS = { buttons: choice, duel, scale, feel, ranking: rank, taboo };

/** The view for a question: its form, or for a one_of, how it is shown. */
export const viewFor = (q) => VIEWS[q.kind === 'one_of' ? q.show : q.kind] ?? choice;

const LETTERS = 'АБВГ';

/** Buttons that plot on tap. The chosen one fills in the plotter's ink first. */
function optionButtons(ctx, body = (o) => [h('span.option-label', null, o.label)]) {
  let busy = false;
  return ctx.q.options.map((o, i) => {
    const button = h('button.option', {
      type: 'button',
      'data-key': i + 1,
      onclick: () => {
        if (busy) return;
        busy = true;
        button.classList.add('is-chosen');
        setTimeout(() => ctx.pick(i), reducedMotion() ? 0 : 170);
      },
    }, h('span.pin', { 'aria-hidden': 'true' }), body(o, i), h('kbd', { 'aria-hidden': 'true' }, String(i + 1)));
    return button;
  });
}

function choice(ctx) {
  return [h('div.options', { role: 'group', 'aria-label': 'Варіанти відповіді' }, optionButtons(ctx))];
}

function duel(ctx) {
  const code = ctx.q.format === 'code';
  return [h('div.options.is-duel', { role: 'group', 'aria-label': 'Два зразки: обери свій' }, optionButtons(ctx, (o) => [
    h('span.option-label', null, o.label),
    h(`span.sample${code ? '.is-code' : ''}`, null, o.sample),
  ]))];
}

function scale(ctx) {
  const { q } = ctx;
  let busy = false;
  const stops = q.options.map((o, i) => {
    const edge = i === 0 || i === q.options.length - 1;
    const button = h(`button.stop${edge ? '.is-edge' : ''}`, {
      type: 'button',
      'data-key': i + 1,
      onclick: () => {
        if (busy) return;
        busy = true;
        button.classList.add('is-chosen');
        setTimeout(() => ctx.pick(i), reducedMotion() ? 0 : 170);
      },
    }, h('span.stop-dot', { 'aria-hidden': 'true' }), h('span.stop-label', null, o.label));
    return button;
  });
  return [h('div.scale', null,
    h('div.scale-poles', { 'aria-hidden': 'true' }, h('span', null, q.poles[0]), h('span', null, q.poles[1])),
    h('div.scale-track', { role: 'group', 'aria-label': `Від «${q.poles[0]}» до «${q.poles[1]}»`, style: `--stops: ${q.options.length}` }, stops))];
}

/** Where an assembled line is shown before it lands. */
function lands(line, hint) {
  return line
    ? h('p.lands', { 'aria-live': 'polite' }, h('span.lands-label', null, 'У мапу ляже'), h('span.lands-line', null, line))
    : h('p.lands.is-empty', { 'aria-live': 'polite' }, h('span.lands-hint', null, hint));
}

function rank(ctx) {
  const { q } = ctx;
  const root = h('div.rank');
  const order = () => (Array.isArray(ctx.draft()) ? ctx.draft() : []);
  const tap = (i) => {
    let next = order().filter((x) => x !== i);
    if (next.length === order().length) {
      next = [...next, i];
      if (next.length === q.items.length - 1) next.push(q.items.findIndex((_, j) => !next.includes(j)));
    }
    ctx.setDraft(next);
    paint();
  };
  const paint = () => {
    const o = order();
    const complete = o.length === q.items.length;
    root.replaceChildren(
      h('ol.rank-items', { 'aria-label': 'Пункти: торкайся в порядку важливості' }, q.items.map((item, i) => {
        const at = o.indexOf(i);
        return h('li', null, h('button.rank-item', {
          type: 'button',
          'aria-pressed': String(at >= 0),
          'aria-label': at >= 0 ? `${item.label}, місце ${at + 1}` : item.label,
          onclick: () => tap(i),
        }, h('span.rank-place', { 'aria-hidden': 'true' }, at >= 0 ? String(at + 1) : ''), h('span', null, item.label)));
      })),
      lands(complete ? lineFor(q, o).line : '', 'Торкайся в порядку важливості: перше — найважливіше. Ще раз торкнешся — прибереш.'),
      h('div.card-actions', null,
        h('button.primary', { type: 'button', disabled: !complete, onclick: () => ctx.pick(o) }, 'Нанести на мапу'),
        o.length ? h('button.quiet', { type: 'button', onclick: () => { ctx.setDraft([]); paint(); } }, 'Почати спочатку') : null),
    );
  };
  paint();
  return [root];
}

function taboo(ctx) {
  const { q } = ctx;
  const root = h('div.taboo');
  const picked = () => (Array.isArray(ctx.draft()) ? ctx.draft() : []);
  const paint = () => {
    const p = picked();
    root.replaceChildren(
      h('div.chips', { role: 'group', 'aria-label': 'Познач усе, чого не буде' }, q.items.map((item, i) => h('button.chip.is-taboo', {
        type: 'button',
        'aria-pressed': String(p.includes(i)),
        onclick: () => {
          ctx.setDraft(p.includes(i) ? p.filter((x) => x !== i) : [...p, i].sort((a, b) => a - b));
          paint();
        },
      }, item.label))),
      lands(lineFor(q, p).line),
      h('div.card-actions', null,
        h('button.primary', { type: 'button', onclick: () => ctx.pick(p) }, p.length ? 'Нанести на мапу' : 'Нічого з цього не табу')),
    );
  };
  paint();
  return [root];
}

function feel(ctx) {
  const { q } = ctx;
  const demo = DEMOS[q.demo];
  if (!demo) return [h('p.hint', null, `Демо «${q.demo}» у цій версії нема. Обери за підписами.`), ...choice(ctx)];
  const stage = h('div.stage');
  let stop = null;
  // blind: the labels would give the answer away, so variants are letters
  const tabs = q.options.map((o, i) => h('button.variant', {
    type: 'button',
    role: 'tab',
    'aria-selected': String(i === 0),
    onclick: () => show(i),
  }, `Варіант ${LETTERS[i]}`));
  const show = (i) => {
    tabs.forEach((t, j) => t.setAttribute('aria-selected', String(j === i)));
    stop?.();
    stop = demo.mount(stage, q.options[i].params ?? {});
  };
  ctx.onDispose(() => stop?.());
  requestAnimationFrame(() => {
    if (stage.isConnected && !stop) show(0);
  });
  return [
    h('div.feel', null,
      h('div.variants', { role: 'tablist', 'aria-label': 'Що пробувати' }, tabs),
      stage,
      h('p.feel-hint', null, demo.hint)),
    h('p.pick-caption', null, 'Спробуй обидва. Котрий твій?'),
    h('div.options.is-pair', { role: 'group', 'aria-label': 'Вибір' }, optionButtons(ctx, (o, i) => h('span.option-label', null, `Варіант ${LETTERS[i]}`))),
  ];
}
