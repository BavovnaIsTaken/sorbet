import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBank } from '../core/bank.js';
import { KINDS, lineFor } from '../core/kinds.js';

const bank = await loadBank(async (p) => JSON.parse(await readFile(new URL(`../bank/${p}`, import.meta.url), 'utf8')));

test('the shipped bank passes its own rules', () => {
  assert.deepEqual(bank.notes, []);
  assert.ok(bank.domains.length >= 1);
});

test('the shipped bank exercises every kind', () => {
  const kinds = new Set(bank.domains.flatMap((d) => d.questions.map((q) => q.kind)));
  assert.deepEqual([...kinds].sort(), [...KINDS].sort());
});

test('the spec example is kept word for word', () => {
  const q = bank.domains.find((d) => d.id === 'games').questions.find((x) => x.id === 'forgiving_hits');
  assert.equal(q.text, 'Гравець промахнувся на волосину. Що робить гра?');
  assert.equal(q.author, '', 'written by the owner, not by Claude');
});

test('every assembled line comes out whole', () => {
  for (const d of bank.domains) {
    for (const q of d.questions) {
      if (q.kind === 'rank') {
        const { line } = lineFor(q, q.items.map((_, i) => i));
        assert.doesNotMatch(line, /\{\d+\}/, q.id);
      }
      if (q.kind === 'taboo') assert.doesNotMatch(lineFor(q, [0, 1]).line, /\{list\}/, q.id);
      if (q.kind === 'open') assert.doesNotMatch(lineFor(q, 'щось своє').line, /\{text\}/, q.id);
    }
  }
});
