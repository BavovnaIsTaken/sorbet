import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDomain } from '../core/bank.js';
import { lineFor, listOf } from '../core/kinds.js';

const domainWith = (...questions) => parseDomain({ topics: [{ id: 't', title: 'Тема' }], questions }, 'd');
const opts = (a, b) => [{ label: a, line: `${a}: і ще пояснення, щоб рядок стояв сам` }, { label: b, line: `${b}: і ще пояснення, щоб рядок стояв сам` }];

test('every kind parses and turns a pick into one line', () => {
  const { domain, notes } = domainWith(
    { id: 'c', topic: 't', text: 'Вибір?', options: opts('а', 'б') },
    { id: 'd', topic: 't', kind: 'duel', format: 'code', text: 'Який код твій?', options: [
      { label: 'падає', line: 'код падає одразу, щойно стан неможливий', sample: 'requireNotNull(x)\n' },
      { label: 'обходить', line: 'код обходить неможливий стан і йде далі', sample: 'x ?: return' },
    ] },
    { id: 's', topic: 't', kind: 'scale', text: 'Коли вибирати?', poles: ['рано', 'пізно'], options: opts('радше рано', 'радше пізно') },
    { id: 'r', topic: 't', kind: 'rank', text: 'Що важливіше?', line: 'найважливіше {1}, потім {2}, а {3} — в останню чергу',
      items: [{ label: 'швидкість', word: 'швидкість' }, { label: 'точність', word: 'точність' }, { label: 'ясність', word: 'ясність' }] },
    { id: 'x', topic: 't', kind: 'taboo', text: 'Чого не буде?', line: 'у грі не буде {list}', none: 'табу нема: усе вирішує задум',
      items: [{ label: 'лутбокси', word: 'лутбоксів' }, { label: 'реклама', word: 'реклами' }, { label: 'таймери', word: 'таймерів' }] },
    { id: 'o', topic: 't', kind: 'open', text: 'Своїми словами?', line: 'хороша гра — це гра, де {text}' },
    { id: 'f', topic: 't', kind: 'feel', demo: 'move', text: 'Що ближче?', options: [
      { label: 'А', line: 'керований об’єкт має вагу', params: { inertia: 0.8 } },
      { label: 'Б', line: 'керований об’єкт слухається миттєво', params: { inertia: 0 } },
    ] },
  );
  assert.deepEqual(notes, []);
  const q = Object.fromEntries(domain.questions.map((x) => [x.id, x]));
  assert.equal(q.d.format, 'code');
  assert.equal(q.d.options[0].sample, 'requireNotNull(x)');
  assert.deepEqual(q.s.poles, ['рано', 'пізно']);
  assert.deepEqual(q.f.options[0].params, { inertia: 0.8 });

  assert.deepEqual(lineFor(q.c, 1), { line: 'б: і ще пояснення, щоб рядок стояв сам', source: 'option' });
  assert.deepEqual(lineFor(q.r, [2, 0, 1]), { line: 'найважливіше ясність, потім швидкість, а точність — в останню чергу', source: 'option' });
  assert.equal(lineFor(q.r, [2, 0]), null, 'an unfinished order is not an answer');
  assert.deepEqual(lineFor(q.x, [0, 2]), { line: 'у грі не буде лутбоксів і таймерів', source: 'option' });
  assert.deepEqual(lineFor(q.x, []), { line: 'табу нема: усе вирішує задум', source: 'option' });
  assert.deepEqual(lineFor(q.o, '  кожна спроба\nтрохи інша. '), { line: 'хороша гра — це гра, де кожна спроба трохи інша', source: 'own' });
  assert.equal(lineFor(q.o, '   '), null);
  assert.equal(lineFor(q.f, 0).line, 'керований об’єкт має вагу');
});

test('questions a kind cannot ask are left out, with a reason', () => {
  const { domain, notes } = domainWith(
    { id: 'no_kind', topic: 't', kind: 'poll', text: '?', options: opts('а', 'б') },
    { id: 'no_sample', topic: 't', kind: 'duel', text: '?', options: opts('а', 'б') },
    { id: 'one_pole', topic: 't', kind: 'scale', text: '?', poles: ['рано'], options: opts('а', 'б') },
    { id: 'no_slot', topic: 't', kind: 'rank', text: '?', line: 'без місць', items: [{ label: 'а' }, { label: 'б' }, { label: 'в' }] },
    { id: 'no_none', topic: 't', kind: 'taboo', text: '?', line: 'не буде {list}', items: [{ label: 'а' }, { label: 'б' }] },
    { id: 'open_no_text', topic: 't', kind: 'open', text: '?', line: 'рядок без місця' },
  );
  assert.deepEqual(domain.questions, []);
  assert.equal(notes.length, 6);
});

test('the frequency trap is reported once per question, wherever it hides', () => {
  const { notes } = domainWith({
    id: 'reward_size', topic: 't', text: 'Нагорода: яка?',
    options: [{ label: 'часті й дрібні', line: 'нагорода приходить часто, але дрібна' }, { label: 'рідкісні й великі', line: 'нагорода приходить рідко, зате велика' }],
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^reward_size: частота/);
});

test('lists read like Ukrainian', () => {
  assert.equal(listOf(['а']), 'а');
  assert.equal(listOf(['а', 'б']), 'а і б');
  assert.equal(listOf(['а', 'б', 'в']), 'а, б і в');
});
