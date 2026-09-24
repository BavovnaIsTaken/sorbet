/**
 * The question bank: one hand-edited JSON file per domain.
 *
 *   {
 *     "domain": "games",
 *     "name": "Ігри",
 *     "title": "Як я бачу ігри",
 *     "topics": [{ "id": "controls", "title": "Керування" }],
 *     "questions": [{
 *       "id": "forgiving_hits",
 *       "topic": "controls",
 *       "text": "Гравець промахнувся на волосину. Що робить гра?",
 *       "options": [{ "label": "прощає промах", "line": "гра прощає дрібний промах: …" }]
 *     }]
 *   }
 *
 * A question may also carry "kind" (see kinds.js), "setup" (a scene shown
 * before the question) and "author" (who wrote it, when it was not the
 * owner). A bare array of questions is accepted too, in the shape the spec
 * gives. Nothing here throws: a question that cannot be asked is left out,
 * and everything else the author should fix comes back as a note.
 */

import { oneLine } from './mapfile.js';
import { parseBody } from './kinds.js';

export { LABEL_MAX } from './kinds.js';

const ID = /^[a-z0-9_]+$/;

/**
 * @typedef {import('./kinds.js').Body & {id: string, topic: string, text: string, setup: string, author: string}} Question
 * @typedef {{id: string, title: string}} Topic
 * @typedef {Object} Domain
 * @property {string} id
 * @property {string} name     Short name for the switcher.
 * @property {string} title    Heading of the map file.
 * @property {Topic[]} topics  In display order; new map sections follow it.
 * @property {Question[]} questions
 */

/**
 * Loads every domain listed in bank/index.json ({"domains": ["games", …]}).
 * A broken domain file becomes a note instead of taking the others down.
 * @param {(path: string) => Promise<unknown>} readJSON  Reads a file relative to the bank directory.
 * @returns {Promise<{domains: Domain[], notes: {domain: string, text: string}[]}>}
 */
export async function loadBank(readJSON) {
  const index = await readJSON('index.json');
  const domains = [];
  const notes = [];
  for (const id of list(index?.domains).filter((d) => ID.test(str(d)))) {
    try {
      const parsed = parseDomain(await readJSON(`${id}.json`), id);
      domains.push(parsed.domain);
      notes.push(...parsed.notes.map((text) => ({ domain: parsed.domain.id, text })));
    } catch (e) {
      notes.push({ domain: id, text: `bank/${id}.json не читається: ${e?.message ?? e}` });
    }
  }
  return { domains, notes };
}

/**
 * @param {unknown} raw         Parsed JSON of one bank file.
 * @param {string} fallbackId   Domain id to use when the file names none.
 * @returns {{domain: Domain, notes: string[]}}
 */
export function parseDomain(raw, fallbackId) {
  const notes = [];
  const src = Array.isArray(raw) ? { questions: raw } : isObject(raw) ? raw : {};
  const id = ID.test(str(src.domain)) ? str(src.domain) : fallbackId;
  const name = oneLine(src.name) || id;
  const title = oneLine(src.title) || name;

  const topics = [];
  for (const t of list(src.topics)) {
    const tid = str(t?.id);
    if (!ID.test(tid)) {
      notes.push(`Тема ${JSON.stringify(t?.id ?? null)}: id пишеться a–z, 0–9 і _.`);
      continue;
    }
    if (topics.some((x) => x.id === tid)) {
      notes.push(`Тема ${tid} описана двічі.`);
      continue;
    }
    topics.push({ id: tid, title: oneLine(t.title) || tid });
  }

  const questions = [];
  const undeclared = new Set();
  for (const q of list(src.questions)) {
    const question = parseQuestion(q, id, notes, questions);
    if (!question) continue;
    if (!topics.some((t) => t.id === question.topic)) {
      topics.push({ id: question.topic, title: question.topic });
      undeclared.add(question.topic);
    }
    questions.push(question);
  }
  if (undeclared.size) {
    notes.push(`Теми без назви в "topics": ${[...undeclared].join(', ')}. У мапі їхні розділи називатимуться так само, як id.`);
  }
  return { domain: { id, name, title, topics, questions }, notes };
}

function parseQuestion(q, domainId, notes, taken) {
  const id = str(q?.id);
  if (!ID.test(id)) {
    notes.push(`Питання ${JSON.stringify(q?.id ?? null)}: id пишеться a–z, 0–9 і _, бо під ним лежить відповідь. Пропущено.`);
    return null;
  }
  if (taken.some((t) => t.id === id)) {
    notes.push(`${id}: такий id уже є. Друге питання пропущено.`);
    return null;
  }
  const text = oneLine(q.text);
  if (!text) {
    notes.push(`${id}: немає тексту питання. Пропущено.`);
    return null;
  }
  if (q.domain != null && q.domain !== domainId) {
    notes.push(`${id}: у питанні domain «${q.domain}», а файл належить до «${domainId}».`);
  }
  const body = parseBody(q, id, text, notes);
  if (!body) return null;
  let topic = str(q.topic);
  if (!ID.test(topic)) {
    notes.push(`${id}: немає теми, тож питання пішло в «other».`);
    topic = 'other';
  }
  return { id, topic, text, setup: oneLine(q.setup), author: oneLine(q.author), ...body };
}

const isObject = (v) => v !== null && typeof v === 'object';
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
