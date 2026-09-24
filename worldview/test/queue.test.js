import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMap, apply, blankMap } from '../core/mapfile.js';
import { parseDomain } from '../core/bank.js';
import { status, queue, legend, markState } from '../core/queue.js';
import { GAMES } from './fixtures.js';

const question = (id) => GAMES.questions.find((q) => q.id === id);
const mark = (id, text) => ({ type: 'mark', id, text, on: '2026-09-24' });
const answer = (id, section) => ({ type: 'answer', id, section, line: 'рядок, що стоїть сам', on: '2026-09-24', source: 'option' });
const ids = (items) => items.map(({ domain, question: q }) => `${domain.id}/${q.id}`);

const { domain: CODE } = parseDomain({
  domain: 'code',
  topics: [{ id: 'errors', title: 'Помилки' }],
  questions: ['fail_fast', 'error_owner'].map((id) => ({
    id,
    topic: 'errors',
    text: `Питання ${id}?`,
    options: [{ label: 'так', line: `так, і це рядок про ${id}` }, { label: 'ні', line: `ні, і це рядок про ${id}` }],
  })),
}, 'code');

test('answered, open and "не знаю"', () => {
  let text = apply(blankMap(GAMES), GAMES, answer('inertia', 'Керування'));
  text = apply(text, GAMES, mark('blame', question('blame').text));
  const view = readMap(text);
  assert.equal(status(question('inertia'), view), 'answered');
  assert.equal(status(question('blame'), view), 'unknown');
  assert.equal(status(question('who_picks'), view), 'open');
});

test('a question rewritten under the same id comes back', () => {
  const view = readMap(apply(null, GAMES, mark('blame', 'Старе формулювання, яке не влучило')));
  assert.equal(status(question('blame'), view), 'open');
  assert.equal(markState(view.marks.get('blame'), GAMES), 'rewritten');
});

test('a bare legacy mark keeps the question away until it is erased', () => {
  const view = readMap('## Не знаю\n\n- blame\n- gone_question\n');
  assert.equal(status(question('blame'), view), 'unknown');
  assert.equal(markState(view.marks.get('blame'), GAMES), 'waiting');
  assert.equal(markState(view.marks.get('gone_question'), GAMES), 'gone');
});

test('the queue deals topics out round-robin, and keeps doing it as the map fills', () => {
  const empty = [{ domain: GAMES, view: readMap(null) }];
  assert.deepEqual(ids(queue(empty)), ['games/forgiving_hits', 'games/who_picks', 'games/blame', 'games/inertia']);
  const oneSaid = [{ domain: GAMES, view: readMap(apply(null, GAMES, answer('forgiving_hits', 'Керування'))) }];
  assert.deepEqual(ids(queue(oneSaid)), ['games/who_picks', 'games/blame', 'games/inertia']);
});

test('the queue mixes domains', () => {
  const maps = [{ domain: GAMES, view: readMap(null) }, { domain: CODE, view: readMap(null) }];
  assert.deepEqual(ids(queue(maps)).slice(0, 4), ['games/forgiving_hits', 'code/fail_fast', 'games/who_picks', 'games/blame']);
});

test('a focused topic goes first, put-off questions go last', () => {
  const maps = [{ domain: GAMES, view: readMap(null) }, { domain: CODE, view: readMap(null) }];
  assert.deepEqual(ids(queue(maps, { focus: 'code/errors' })).slice(0, 2), ['code/fail_fast', 'code/error_owner']);
  const put = ids(queue(maps, { skipped: ['games/who_picks', 'games/forgiving_hits'] }));
  assert.deepEqual(put.slice(-2), ['games/who_picks', 'games/forgiving_hits']);
  assert.equal(ids(queue(maps, { skipped: ['code/fail_fast'], focus: 'code/errors' }))[0], 'code/error_owner');
});

test('legend: one row per topic, one cell per question', () => {
  const text = apply(null, GAMES, answer('inertia', 'Керування'));
  const rows = legend(GAMES, readMap(text));
  assert.deepEqual(rows.map((r) => [r.topic.id, r.cells.map((c) => c.status)]), [
    ['controls', ['open', 'answered']],
    ['difficulty', ['open']],
    ['failure', ['open']],
  ]);
});
