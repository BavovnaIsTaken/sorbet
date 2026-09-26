import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBank } from '../core/bank.js';
import { KINDS, SHOWS, lineFor } from '../core/kinds.js';

const read = async (p) => JSON.parse(await readFile(new URL(`../bank/${p}`, import.meta.url), 'utf8'));
const bank = await loadBank(read);
const domain = (id) => bank.domains.find((d) => d.id === id);
const OWNED_HERE = ['code', 'agent'];

test('the domains this app owns pass their own rules', () => {
  for (const id of OWNED_HERE) {
    assert.deepEqual(bank.notes.filter((n) => n.domain === id), [], id);
  }
});

test('the games registry arrives whole: every question and every retired id', async () => {
  const registry = await read('games.json');
  const games = domain('games');
  assert.equal(games.questions.length, registry.questions.length, 'a registry question was dropped');
  assert.deepEqual(games.retired.map((r) => r.id).sort(), registry.retired.map((r) => r.id).sort());
  assert.deepEqual(games.topics.map((t) => t.id), registry.topics.map((t) => t.key));
});

test('every show layered on the registry still fits its question', async () => {
  const overlay = await read('games.show.json');
  const games = domain('games');
  for (const [id, show] of Object.entries(overlay.questions)) {
    const q = games.questions.find((x) => x.id === id);
    assert.ok(q, `${id} left the registry; drop it from games.show.json`);
    assert.equal(q.show, show.show, `${id}: the show did not apply (options changed?)`);
  }
});

test('the questions this app shows cover every form and every show', () => {
  const all = bank.domains.flatMap((d) => d.questions);
  assert.deepEqual([...new Set(all.map((q) => q.kind))].sort(), [...KINDS].sort());
  assert.deepEqual([...new Set(all.filter((q) => q.kind === 'one_of').map((q) => q.show))].sort(), [...SHOWS].sort());
});

test('the spec example is kept word for word, and it is the owner’s', () => {
  const q = domain('games').questions.find((x) => x.id === 'forgiving_hits');
  assert.equal(q.text, 'Гравець промахнувся на волосину. Що робить гра?');
  assert.equal(q.author, '');
});

test('every composed or typed line comes out whole', () => {
  for (const d of bank.domains) {
    for (const q of d.questions) {
      if (q.kind === 'ranking') assert.doesNotMatch(lineFor(q, q.items.map((_, i) => i)).line, /\{\d+\}/, q.id);
      if (q.kind === 'taboo') assert.doesNotMatch(lineFor(q, [0, 1]).line, /\{list\}/, q.id);
      if (q.kind === 'ranking' || q.kind === 'taboo') assert.ok(q.example, `${q.id} has no example`);
    }
  }
});
