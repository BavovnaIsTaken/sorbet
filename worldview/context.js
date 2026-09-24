#!/usr/bin/env node
/**
 * Prints the part of the map a task touches, signed, for an agent (spec §5).
 * Never the whole map: name the topics the task is about.
 *
 *   node context.js games controls failure        topics by id or by heading
 *   node context.js games                         lists the topics there are
 *   node context.js games controls --file ~/Downloads/games.md
 *   node context.js games controls --map ../private-map
 *
 * Paste the output into the task itself. Not into a system prompt or
 * CLAUDE.md: those are cached, and a personal block there invalidates the
 * cache on every change.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBank, parseDomain } from './core/bank.js';
import { toContext, contextSections } from './core/export.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

const positional = [];
const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
  if (m) flags[m[1]] = m[2] ?? argv[++i];
  else positional.push(argv[i]);
}

const [domainId, ...wanted] = positional;
if (!domainId) fail('usage: node context.js <domain> [topic …] [--file map.md] [--map dir]');

const readJSON = async (p) => JSON.parse(await readFile(join(ROOT, 'bank', p), 'utf8'));
const { domains } = await loadBank(readJSON).catch(() => ({ domains: [] }));
const domain = domains.find((d) => d.id === domainId) ?? parseDomain({}, domainId).domain;

const file = flags.file ? resolve(flags.file) : join(resolve(flags.map ?? join(ROOT, 'map')), `${domainId}.md`);
const text = await readFile(file, 'utf8').catch(() => fail(`no map file at ${file}`));

const sections = contextSections(text, domain);
const width = Math.max(0, ...sections.map((s) => (s.topic ?? '').length));
const listing = sections.map((s) => `  ${(s.topic ?? '').padEnd(width)}  ${s.title} (${s.lines})`).join('\n');

if (!wanted.length) fail(`Name the topics the task touches:\n${listing}`);
const unknown = wanted.filter((w) => !sections.some((s) => s.topic === w || s.title.toLowerCase() === w.toLowerCase()));
if (unknown.length) fail(`Not in the map: ${unknown.join(', ')}\n${listing}`);

process.stdout.write(toContext(text, domain, wanted));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
