import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDomain } from '../core/bank.js';
import { lineFor, listOf } from '../core/kinds.js';

const domainWith = (...questions) => parseDomain({ topics: [{ id: 't', title: 'Тема' }], questions }, 'd');
const opts = (a, b) => [{ label: a, line: `${a}: і ще пояснення, щоб рядок стояв сам` }, { label: b, line: `${b}: і ще пояснення, щоб рядок стояв сам` }];
const items = (...labels) => labels.map((label) => ({ label, word: label }));

const ranking = (example) => ({
  id: 'r', topic: 't', kind: 'ranking', text: 'Що важливіше?',
  items: [{ label: 'швидкість', word: 'швидкість' }, { label: 'точність', word: 'точність' }, { label: 'ясність', word: 'ясність' }],
  line: 'найважливіше {1}, потім {2}, а {3} — в останню чергу',
  example,
});
const taboo = (extra = {}) => ({
  id: 'x', topic: 't', kind: 'taboo', text: 'Чого не буде?',
  items: [{ label: 'лутбокси', word: 'лутбоксів' }, { label: 'реклама', word: 'реклами' }, { label: 'таймери', word: 'таймерів' }],
  line: 'у грі не буде {list}',
  none: 'табу нема: усе вирішує задум',
  example: { pick: ['лутбокси', 'реклама', 'таймери'], line: 'у грі не буде лутбоксів, реклами і таймерів' },
  ...extra,
});

test('the four forms parse, and each turns a pick into one line', () => {
  const { domain, notes } = domainWith(
    { id: 'c', topic: 't', text: 'Вибір?', options: opts('а', 'б') },
    ranking({ pick: ['ясність', 'швидкість', 'точність'], line: 'найважливіше ясність, потім швидкість, а точність — в останню чергу' }),
    taboo(),
    { id: 'o', topic: 't', kind: 'own_words', text: 'Своїми словами?' },
  );
  assert.deepEqual(notes, []);
  const q = Object.fromEntries(domain.questions.map((x) => [x.id, x]));
  assert.equal(q.c.kind, 'one_of');
  assert.equal(q.c.show, 'buttons', 'a one_of is buttons unless told otherwise');

  assert.deepEqual(lineFor(q.c, 1), { line: 'б: і ще пояснення, щоб рядок стояв сам', source: 'option' });
  assert.deepEqual(lineFor(q.r, [2, 0, 1]), { line: 'найважливіше ясність, потім швидкість, а точність — в останню чергу', source: 'option' });
  assert.equal(lineFor(q.r, [2, 0]), null, 'an unfinished order is not an answer');
  assert.equal(lineFor(q.r, [2, 2, 1]), null, 'nor is an order that repeats an item');
  assert.deepEqual(lineFor(q.x, [0, 2]), { line: 'у грі не буде лутбоксів і таймерів', source: 'option' });
  assert.deepEqual(lineFor(q.x, []), { line: 'табу нема: усе вирішує задум', source: 'option' });
});

test('own words are exactly what was typed, flagged as the owner’s', () => {
  const { domain } = domainWith({ id: 'o', topic: 't', kind: 'own_words', text: '?' });
  assert.deepEqual(lineFor(domain.questions[0], '  Кожна спроба\nтрохи інша. '), { line: 'Кожна спроба трохи інша.', source: 'own' });
  assert.equal(lineFor(domain.questions[0], '   '), null);
});

test('a composed question is only asked when its example renders exactly', () => {
  const good = { pick: ['ясність', 'швидкість', 'точність'], line: 'найважливіше ясність, потім швидкість, а точність — в останню чергу' };
  const cases = [
    [undefined, /зразок/],
    [{ ...good, line: 'найважливіше ясність, потім швидкість і точність' }, /рендериться як/],
    [{ ...good, pick: ['ясність', 'щастя', 'точність'] }, /нема серед items/],
    [{ pick: [], line: '' }, /порожній вибір/],
  ];
  for (const [example, why] of cases) {
    const { domain, notes } = domainWith(ranking(example));
    assert.equal(domain.questions.length, 0);
    assert.match(notes[0], why);
  }
});

test('each form insists on its own template', () => {
  const { domain, notes } = domainWith(
    ranking({ pick: [], line: '' }),
    { ...ranking(null), id: 'r_list', line: 'усе: {list}' },
    taboo({ id: 'x_slots', line: 'не буде {1} і {2}' }),
    taboo({ id: 'x_none', none: undefined }),
    { id: 'o_template', topic: 't', kind: 'own_words', text: '?', line: 'хороша гра — це гра, де {text}' },
    { id: 'poll', topic: 't', kind: 'poll', text: '?', options: opts('а', 'б') },
  );
  assert.deepEqual(domain.questions.map((q) => q.id), ['o_template'], 'own words still asked, the template ignored');
  assert.equal(notes.length, 6);
});

test('how a one_of is shown is checked too', () => {
  const { domain, notes } = domainWith(
    { id: 'no_sample', topic: 't', show: 'duel', text: '?', options: opts('а', 'б') },
    { id: 'one_pole', topic: 't', show: 'scale', poles: ['рано'], text: '?', options: opts('а', 'б') },
    { id: 'no_demo', topic: 't', show: 'feel', text: '?', options: opts('а', 'б') },
    { id: 'code', topic: 't', show: 'duel', format: 'code', text: '?', options: [
      { label: 'падає', line: 'код падає одразу, щойно стан неможливий', sample: 'requireNotNull(x)\n' },
      { label: 'обходить', line: 'код обходить неможливий стан і йде далі', sample: 'x ?: return' },
    ] },
  );
  assert.deepEqual(domain.questions.map((q) => [q.id, q.format, q.options[0].sample]), [['code', 'code', 'requireNotNull(x)']]);
  assert.equal(notes.length, 3);
});

test('a registry owned elsewhere: its shape, its retired ids, and a show layered on top', () => {
  const registry = {
    topics: [{ key: 'controls', heading: 'Керування' }],
    questions: [
      { id: 'inertia', topic: 'controls', text: 'Як рухається те, чим керує гравець?', options: opts('з інерцією', 'миттєво') },
      { id: 'reward_size', topic: 'controls', text: 'Нагорода: яка?', options: opts('а', 'б') },
    ],
    retired: [{ id: 'reward_size', replacedBy: 'reward_weight', on: '2026-09-25' }],
  };
  const overlay = {
    name: 'Ігри', title: 'Як я бачу ігри', preamble: ['Що власник вирішив про ігри взагалі.'],
    questions: {
      inertia: { show: 'feel', demo: 'move', params: [{ inertia: 0.85 }, { inertia: 0 }] },
      nowhere: { show: 'feel', demo: 'move', params: [{}, {}] },
    },
  };
  const { domain, notes } = parseDomain(registry, 'games', overlay);
  assert.deepEqual(domain.topics, [{ id: 'controls', title: 'Керування' }]);
  assert.deepEqual(domain.retired, [{ id: 'reward_size', replacedBy: 'reward_weight', on: '2026-09-25' }]);
  assert.deepEqual(domain.questions.map((q) => q.id), ['inertia'], 'a retired id is never asked again');
  assert.equal(domain.name, 'Ігри');
  assert.deepEqual(domain.preamble, ['Що власник вирішив про ігри взагалі.']);
  const inertia = domain.questions[0];
  assert.equal(inertia.show, 'feel');
  assert.deepEqual(inertia.options.map((o) => o.params), [{ inertia: 0.85 }, { inertia: 0 }]);
  assert.equal(inertia.options[0].line, registry.questions[0].options[0].line, 'the show never touches a line');
  assert.equal(notes.length, 2, 'the retired id and the show for a question that is not there');

  const wrong = parseDomain(registry, 'games', { questions: { inertia: { show: 'feel', demo: 'move', params: [{}] } } });
  assert.equal(wrong.domain.questions[0].show, 'buttons');
  assert.match(wrong.notes.at(-1), /params/);
});

test('the frequency trap is reported once per question, wherever it hides', () => {
  const { notes } = domainWith({
    id: 'reward_size', topic: 't', text: 'Нагорода: яка?',
    options: [{ label: 'часті й дрібні', line: 'нагорода приходить часто, але дрібна' }, { label: 'рідкісні й великі', line: 'нагорода приходить рідко, зате велика' }],
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^reward_size: частота/);
});

test('lists read like Ukrainian, and that is part of the contract', () => {
  assert.equal(listOf(['а']), 'а');
  assert.equal(listOf(['а', 'б']), 'а і б');
  assert.equal(listOf(['а', 'б', 'в']), 'а, б і в');
  assert.equal(items('а').length, 1);
});
