import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../core/mapfile.js';
import { toJSON, toContext, contextSections, SIGNATURE } from '../core/export.js';
import { SPEC_MAP, GAMES } from './fixtures.js';

test('JSON answers have exactly the shape the spec gives', () => {
  const json = toJSON(SPEC_MAP, GAMES);
  assert.deepEqual(json.answers[0], {
    question: 'forgiving_hits',
    domain: 'games',
    topic: 'controls',
    line: 'гра не прощає промаху: влучання рівно таке, як виглядає',
    on: '2026-09-24',
    source: 'option',
  });
  assert.deepEqual(json.marks.map((m) => [m.question, m.asked]), [['reward_size', null], ['unlock_pace', null]]);
  assert.equal(json.title, 'Як я бачу ігри');
});

test('hand-written lines reach JSON as notes', () => {
  const text = SPEC_MAP.replace('## Не знаю', 'Рукою: пікселі мають бути чесні.\n\n## Не знаю');
  assert.deepEqual(toJSON(text, GAMES).notes, [{ topic: 'controls', text: 'Рукою: пікселі мають бути чесні.' }]);
});

test('agent context: signed, only the asked topics, no brackets, no "Не знаю"', () => {
  let text = apply(SPEC_MAP, GAMES, { type: 'answer', id: 'blame', section: 'Провал', line: 'після програшу гравець бачить власну помилку', on: '2026-09-25', source: 'own' });
  text = text.replace('- керований', 'Абзац рукою.\n- керований');
  const out = toContext(text, GAMES, ['controls']);
  assert.equal(out, [
    ...SIGNATURE,
    '',
    '# Як я бачу ігри',
    '',
    '## Керування',
    '- гра не прощає промаху: влучання рівно таке, як виглядає',
    'Абзац рукою.',
    "- керований об'єкт має інерцію: розганяється й гальмує",
    '',
  ].join('\n'));
  assert.doesNotMatch(out.slice(SIGNATURE.join('\n').length), /\[|Не знаю|Провал/);
  assert.match(toContext(text, GAMES, ['Провал']), /## Провал\n- після програшу гравець бачить власну помилку\n$/);
});

test('sections on offer for an agent skip "Не знаю"', () => {
  assert.deepEqual(contextSections(SPEC_MAP, GAMES), [{ title: 'Керування', topic: 'controls', lines: 2 }]);
});
