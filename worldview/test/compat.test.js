// The map file is shared with AIGameIDE (AIGameIDE/Taste/TasteMap.swift). These
// fixtures are ported from its WhatTheOwnerThinksSurvivesTests: what that app writes,
// this one must read the same way, and what this one writes, that one must too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMap, apply, blankMap, splitRow } from '../core/mapfile.js';
import { GAMES } from './fixtures.js';

const map = (body) => readMap(`# Як я бачу ігри\n\n${body}\n`);

test('a typed sentence is still marked as the owner’s own', () => {
  const v = map('## Прогресія\n\n- гравця тягне те, що він сам зламав у грі [власник, 2026-09-20, своє, what_pulls]');
  const e = v.answers.get('what_pulls');
  assert.equal(e.text, 'гравця тягне те, що він сам зламав у грі');
  assert.equal(e.on, '2026-09-20');
  assert.equal(e.source, 'own');
});

test('the old «Пропущені» heading is still read as «Не знаю»', () => {
  const v = map('## Пропущені\n\n- haptics');
  assert.deepEqual([...v.marks.keys()], ['haptics']);
});

test('an answer to a question nobody asks any more is kept', () => {
  const v = map('## Нагорода\n\n- нагорода — це тиша після бою [власник, 2026-05-01, a_question_long_gone]');
  assert.equal(v.answers.get('a_question_long_gone').on, '2026-05-01');
});

test('an unknown bracket field is carried, not eaten', () => {
  const text = map('## Керування\n\n- керування миттєве, без інерції [власник, 2026-09-24, inertia, терміново]\n\n## Музика\n\n- гра має мовчати, поки гравець думає [власник, 2026-09-24]');
  const v = text;
  assert.deepEqual(v.answers.get('inertia').extras, ['терміново']);
  assert.equal(v.answers.size, 1, 'a line with no id is not an answer here');
  assert.ok(v.sections.some((s) => s.title === 'Музика'));
});

test('brackets inside the sentence are the owner’s, not the parser’s', () => {
  const v = map('## Нагорода\n\n- лут [рідкісний] завжди випадає [власник, 2026-09-24, reward_shape]');
  assert.equal(v.answers.get('reward_shape').text, 'лут [рідкісний] завжди випадає');
  assert.deepEqual(splitRow('лут [рідкісний]'), { text: 'лут', fields: ['рідкісний'] });
});

test('rows are written in the order TasteMap writes them', () => {
  const answer = { type: 'answer', id: 'breathing_room', section: 'Керування', line: 'паузи в дії потрібні: гра дихає між сплесками', on: '2026-09-24', source: 'option' };
  assert.match(apply(null, GAMES, answer), /\n- паузи в дії потрібні: гра дихає між сплесками \[власник, 2026-09-24, breathing_room\]\n$/);
  const own = apply(null, GAMES, { ...answer, source: 'own' });
  assert.match(own, /\[власник, 2026-09-24, своє, breathing_room\]\n$/);
});

test('answering a question marked earlier clears the mark', () => {
  let text = apply(blankMap(GAMES), GAMES, { type: 'mark', id: 'inertia', text: 'Що відчуває рука?', on: '2026-09-24' });
  text = apply(text, GAMES, { type: 'answer', id: 'inertia', section: 'Керування', line: 'керований об’єкт має інерцію', on: '2026-09-25', source: 'option' });
  const v = readMap(text);
  assert.equal(v.marks.size, 0);
  assert.equal(v.answers.get('inertia').on, '2026-09-25');
  assert.doesNotMatch(text, /Не знаю/);
});

test('an empty file is an empty map and not a failure', () => {
  const v = readMap('');
  assert.equal(v.answers.size + v.marks.size, 0);
});
