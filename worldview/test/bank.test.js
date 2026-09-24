import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDomain, LABEL_MAX } from '../core/bank.js';

const q = (id, extra = {}) => ({
  id,
  topic: 'controls',
  text: 'Гравець промахнувся на волосину. Що робить гра?',
  options: [
    { label: 'прощає промах', line: 'гра прощає дрібний промах: влучання трохи щедріше, ніж виглядає' },
    { label: 'що видно, те й є', line: 'гра не прощає промаху: влучання рівно таке, як виглядає' },
  ],
  ...extra,
});

test('a clean bank has no notes', () => {
  const { domain, notes } = parseDomain({
    domain: 'games', title: 'Як я бачу ігри', topics: [{ id: 'controls', title: 'Керування' }], questions: [q('forgiving_hits')],
  }, 'x');
  assert.deepEqual(notes, []);
  assert.equal(domain.id, 'games');
  assert.equal(domain.name, 'games');
  assert.deepEqual(domain.topics, [{ id: 'controls', title: 'Керування' }]);
  assert.equal(domain.questions[0].options.length, 2);
});

test('a bare array of spec-shaped questions is a bank too', () => {
  const { domain, notes } = parseDomain([q('forgiving_hits', { domain: 'games' })], 'games');
  assert.equal(domain.questions.length, 1);
  assert.deepEqual(domain.topics, [{ id: 'controls', title: 'controls' }]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /controls/);
});

test('questions that cannot be asked are left out, with a reason', () => {
  const { domain, notes } = parseDomain({
    topics: [{ id: 'controls', title: 'Керування' }],
    questions: [
      q('Bad-Id'),
      q('one_option', { options: [{ label: 'так', line: 'так, завжди і скрізь' }] }),
      q('no_text', { text: '  ' }),
      q('dup'),
      q('dup'),
    ],
  }, 'games');
  assert.deepEqual(domain.questions.map((x) => x.id), ['dup']);
  assert.equal(notes.length, 4);
});

test('the §3 rules turn into notes for the author', () => {
  const long = 'x'.repeat(LABEL_MAX + 1);
  const { domain, notes } = parseDomain({
    topics: [{ id: 'controls', title: 'Керування' }],
    questions: [
      q('long_label', { options: [{ label: long, line: `${long} і ще трохи` }, q('a').options[1]] }),
      q('echo', { options: [{ label: 'прощає', line: 'прощає' }, q('a').options[1]] }),
      q('how_often', { text: 'Як часто гра зберігає прогрес?' }),
      q('rare_label', {
        text: 'Нагорода: яка?',
        options: [{ label: 'часті й дрібні', line: 'нагорода приходить часто, але дрібна' }, { label: 'рідкісні й великі', line: 'нагорода приходить рідко, зате велика' }],
      }),
      q('five', { options: [1, 2, 3, 4, 5].map((n) => ({ label: `варіант ${n}`, line: `варіант номер ${n} і пояснення` })) }),
    ],
  }, 'games');
  assert.equal(domain.questions.length, 5, 'these are still asked');
  const about = (id) => notes.filter((n) => n.startsWith(`${id}:`)).length;
  assert.equal(about('long_label'), 1);
  assert.equal(about('echo'), 1);
  assert.equal(about('how_often'), 1);
  assert.equal(about('rare_label'), 1);
  assert.equal(about('five'), 1);
});

test('the frequency check does not fire on look-alike words', () => {
  const { notes } = parseDomain({
    topics: [{ id: 'controls', title: 'Керування' }],
    questions: [q('part', { text: 'Яка частина рівня лишається прихованою?' })],
  }, 'games');
  assert.deepEqual(notes, []);
});
