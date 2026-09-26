import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMap, apply, inverse, blankMap, sectionFor, today } from '../core/mapfile.js';
import { SPEC_MAP, GAMES } from './fixtures.js';

const answer = (id, line, extra = {}) => ({
  type: 'answer', id, section: sectionFor(GAMES, id), line, on: '2026-09-25', source: 'option', ...extra,
});

test('reads the map file exactly as the spec shows it', () => {
  const view = readMap(SPEC_MAP);
  assert.equal(view.title, 'Як я бачу ігри');
  assert.deepEqual(view.preamble, [
    'Що власник вирішив загалом, а не про якусь одну роботу.',
    'Конкретне завдання старше за цей файл.',
  ]);
  assert.deepEqual([...view.answers.keys()], ['forgiving_hits', 'inertia']);
  const inertia = view.answers.get('inertia');
  assert.equal(inertia.text, "керований об'єкт має інерцію: розганяється й гальмує");
  assert.equal(inertia.on, '2026-09-24');
  assert.equal(inertia.source, 'option');
  assert.equal(inertia.section, 'Керування');
  assert.deepEqual([...view.marks.keys()], ['reward_size', 'unlock_pace']);
  assert.equal(view.marks.get('reward_size').text, null);
  assert.deepEqual(view.sections.map((s) => [s.title, s.dontKnow]), [['Керування', false], ['Не знаю', true]]);
});

test('a new answer lands at the end of its section and nothing else moves', () => {
  const text = SPEC_MAP.replace("- керований об'єкт має інерцію: розганяється й гальмує   [2026-09-24, inertia]\n", '');
  const out = apply(text, GAMES, answer('inertia', 'рушає миттєво'));
  assert.equal(out, text.replace(
    '[2026-09-24, forgiving_hits]\n',
    '[2026-09-24, forgiving_hits]\n- рушає миттєво [власник, 2026-09-25, inertia]\n',
  ));
});

test('an answer to the same question replaces the line in place', () => {
  const out = apply(SPEC_MAP, GAMES, answer('forgiving_hits', 'гра прощає дрібний промах'));
  const lines = out.split('\n');
  assert.equal(lines[7], '- гра прощає дрібний промах [власник, 2026-09-25, forgiving_hits]');
  assert.equal(out.replace(lines[7], ''), SPEC_MAP.replace(SPEC_MAP.split('\n')[7], ''));
});

test('new sections follow the bank topic order and stay above "Не знаю"', () => {
  let text = apply(SPEC_MAP, GAMES, answer('blame', 'після програшу гравець бачить власну помилку'));
  text = apply(text, GAMES, answer('who_picks', 'складність вибирає гравець'));
  const heads = text.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, ['## Керування', '## Складність', '## Провал', '## Не знаю']);
  assert.match(text, /\n\n## Складність\n\n- складність вибирає гравець \[власник, 2026-09-25, who_picks\]\n\n## Провал\n\n/);
});

test('a blank map is created with the title and the preamble', () => {
  const out = apply(null, GAMES, answer('forgiving_hits', 'гра не прощає промаху'));
  assert.equal(out, `${blankMap(GAMES)}\n## Керування\n\n- гра не прощає промаху [власник, 2026-09-25, forgiving_hits]\n`);
});

test('lines the parser does not understand survive every edit verbatim', () => {
  const hand = `# Як я бачу ігри

Моя передмова, написана рукою.

## Керування

Абзац про керування, без дужок.
- керування має бути чесним
- гра не прощає промаху [2026-09-24, forgiving_hits]
* зірочка замість мінуса   [2026-09-20, inertia, своє]
  - вкладений пункт

## Мої нотатки

щось без формату [не дата, не id]
`;
  const view = readMap(hand);
  assert.equal(view.answers.get('inertia').source, 'own');
  assert.equal(view.answers.get('inertia').text, 'зірочка замість мінуса');
  let out = apply(hand, GAMES, answer('blame', 'після програшу гравець бачить власну помилку'));
  out = apply(out, GAMES, { type: 'unanswer', id: 'forgiving_hits' });
  out = apply(out, GAMES, { type: 'mark', id: 'who_picks', text: 'Складність вибирає гравець, гра чи ніхто?', on: '2026-09-25' });
  for (const line of hand.split('\n')) {
    if (line.includes('forgiving_hits') || !line.trim()) continue;
    assert.ok(out.split('\n').includes(line), `lost: ${line}`);
  }
  assert.equal(out.indexOf('## Провал') > out.indexOf('## Мої нотатки'), true);
});

test('erasing the last entry removes its section and leaves tidy spacing', () => {
  let out = apply(SPEC_MAP, GAMES, { type: 'unanswer', id: 'forgiving_hits' });
  out = apply(out, GAMES, { type: 'unanswer', id: 'inertia' });
  assert.equal(out, `${blankMap(GAMES)}\n## Не знаю\n\n- reward_size\n- unlock_pace\n`);
  out = apply(out, GAMES, { type: 'unmark', id: 'reward_size' });
  out = apply(out, GAMES, { type: 'unmark', id: 'unlock_pace' });
  assert.equal(out, blankMap(GAMES));
});

test('a removal that finds nothing returns the text untouched', () => {
  assert.equal(apply(SPEC_MAP, GAMES, { type: 'unanswer', id: 'nope' }), SPEC_MAP);
  assert.equal(apply(null, GAMES, { type: 'unmark', id: 'nope' }), null);
});

test('marks carry the question text, go last, and replace the previous mark', () => {
  let out = apply(blankMap(GAMES), GAMES, { type: 'mark', id: 'blame', text: 'Після програшу гравець має подумати…', on: '2026-09-24' });
  out = apply(out, GAMES, answer('forgiving_hits', 'гра не прощає промаху'));
  out = apply(out, GAMES, { type: 'mark', id: 'blame', text: 'Нове формулювання?', on: '2026-09-26' });
  assert.match(out, /## Керування[\s\S]*## Не знаю\n\n- Нове формулювання\? \[власник, 2026-09-26, blame\]\n$/);
  assert.equal(readMap(out).marks.get('blame').text, 'Нове формулювання?');
});

test('own answers are flagged and the flag round-trips', () => {
  const out = apply(null, GAMES, answer('inertia', 'рука відчуває вагу', { source: 'own' }));
  assert.match(out, /- рука відчуває вагу \[власник, 2026-09-25, своє, inertia\]\n$/);
  assert.equal(readMap(out).answers.get('inertia').source, 'own');
});

test('the flag is Cyrillic, so it can never be read as an id', () => {
  const view = readMap('## Керування\n\n- рядок [2026-09-24, своє]\n- рядок [2026-09-24, own]\n');
  assert.equal(view.answers.size, 1, 'only the line whose last field could be an id');
  assert.equal(view.answers.has('своє'), false);
});

test('the legacy own flag is read, and the next save renames it and nothing else', () => {
  const legacy = `${blankMap(GAMES)}\n## Керування\n\n- рука відчуває вагу [2026-09-24, inertia, own]\n- гра не прощає промаху [2026-09-24, forgiving_hits]\n`;
  assert.equal(readMap(legacy).answers.get('inertia').source, 'own');
  const out = apply(legacy, GAMES, answer('blame', 'після програшу гравець бачить власну помилку'));
  assert.doesNotMatch(out, /, own\]/);
  assert.equal(
    out,
    legacy.replace(', own]', ', своє]') + '\n## Провал\n\n- після програшу гравець бачить власну помилку [власник, 2026-09-25, blame]\n',
  );
});

test('a line is always one line, and brackets inside it are text', () => {
  const out = apply(null, GAMES, answer('inertia', '  два\nрядки [2026-01-01, x]  ', { source: 'own' }));
  const entry = readMap(out).answers.get('inertia');
  assert.equal(entry.text, 'два рядки [2026-01-01, x]');
  assert.equal(readMap(out).answers.has('x'), false);
});

test('CRLF files stay CRLF', () => {
  const crlf = SPEC_MAP.replace(/\n/g, '\r\n');
  const out = apply(crlf, GAMES, answer('blame', 'після програшу гравець бачить власну помилку'));
  assert.equal(out.includes('\n') && !/[^\r]\n/.test(out), true);
});

test('undo restores the file for every kind of change', () => {
  const ops = [
    answer('forgiving_hits', 'інший рядок'),
    answer('blame', 'після програшу гравець бачить власну помилку'),
    { type: 'unanswer', id: 'forgiving_hits' },
    { type: 'mark', id: 'who_picks', text: 'Складність вибирає гравець, гра чи ніхто?', on: '2026-09-25' },
    { type: 'unmark', id: 'reward_size' },
    { type: 'replace', text: 'щось зовсім інше\n' },
  ];
  const entries = (map) => [...map.values()].map((e) => [e.id, e.text, e.on, e.source]).sort();
  for (const op of ops) {
    const after = apply(SPEC_MAP, GAMES, op);
    const back = apply(after, GAMES, inverse(SPEC_MAP, GAMES, op));
    if (op.type === 'unanswer' || op.type === 'unmark' || op.id === 'forgiving_hits') {
      // a restored entry goes back in this app's own spelling, at the end of its
      // section when it had been removed; the content is what matters
      assert.deepEqual(entries(readMap(back).answers), entries(readMap(SPEC_MAP).answers), op.type);
      assert.deepEqual(entries(readMap(back).marks), entries(readMap(SPEC_MAP).marks), op.type);
    } else {
      assert.equal(back, SPEC_MAP, op.type);
    }
  }
});

test('today() is a local calendar day', () => {
  assert.equal(today(new Date(2026, 8, 4, 23, 59)), '2026-09-04');
});
