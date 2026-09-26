#!/usr/bin/env node
/**
 * Copies AIGameIDE's registry of the games domain into bank/games.json, byte for
 * byte, and records the commit it came from in bank/games.show.json.
 *
 *   node sync-registry.js ../AIGameIDE
 *
 * The registry is read-only here: AIGameIDE owns the games domain and mints its
 * ids. What this app adds (the name, the file header, how some questions are
 * shown) lives in bank/games.show.json, and `npm test` fails if a question shown
 * there has left the registry or changed its number of options.
 */

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const repo = process.argv[2];
if (!repo) {
  process.stderr.write('usage: node sync-registry.js <path to an AIGameIDE checkout>\n');
  process.exit(2);
}

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const showPath = join(ROOT, 'bank/games.show.json');
const show = JSON.parse(await readFile(showPath, 'utf8'));
const source = join(repo, show.registry.path);

JSON.parse(await readFile(source, 'utf8'));
await copyFile(source, join(ROOT, 'bank/games.json'));
show.registry = { ...show.registry, branch: git('rev-parse', '--abbrev-ref', 'HEAD'), commit: git('rev-parse', '--short', 'HEAD') };
await writeFile(showPath, `${JSON.stringify(show, null, 2)}\n`);
process.stdout.write(`bank/games.json ← ${show.registry.repo}@${show.registry.commit} (${show.registry.branch})\nнаступний крок: npm test\n`);
