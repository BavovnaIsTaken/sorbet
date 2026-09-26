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
 * A question may also carry "kind" (the form; see kinds.js), "setup" (a scene
 * shown before the question) and "author" (who wrote it, when it was not the
 * owner). A bare array of questions is accepted too, in the shape the spec
 * gives, and so is AIGameIDE's registry (docs/taste-registry.json): topics as
 * {key, heading} and a "retired" list of ids that must never be reused.
 *
 * Every domain has one owner who mints its ids. For a domain this app does not
 * own, bank/<id>.json is that owner's registry, copied as is, and
 * bank/<id>.show.json holds only what is ours: the name on the switcher, the
 * file's title and preamble, and how some questions are shown.
 *
 * Nothing here throws: a question that cannot be asked is left out, and
 * everything else the author should fix comes back as a note.
 */

import { oneLine } from './mapfile.js';
import { parseBody, applyShow } from './kinds.js';

export { LABEL_MAX } from './kinds.js';

const ID = /^[a-z0-9_]+$/;

/**
 * @typedef {import('./kinds.js').Body & {id: string, topic: string, text: string, setup: string, author: string}} Question
 * @typedef {{id: string, title: string}} Topic
 * @typedef {{id: string, replacedBy: string|null, on: string|null}} Retired
 * @typedef {Object} Domain
 * @property {string} id
 * @property {string} name        Short name for the switcher.
 * @property {string} title       Heading of the map file.
 * @property {string[]} preamble  Lines under the heading of a new map file.
 * @property {Topic[]} topics     In display order; new map sections follow it.
 * @property {Question[]} questions
 * @property {Retired[]} retired  Ids that were asked once and never will be again.
 */

/**
 * Loads every domain listed in bank/index.json:
 *   {"domains": ["games", "code", …], "shows": ["games"]}
 * `shows` names the domains that have a bank/<id>.show.json. A broken domain
 * file becomes a note instead of taking the others down.
 * @param {(path: string) => Promise<unknown>} readJSON  Reads a file relative to the bank directory.
 * @returns {Promise<{domains: Domain[], notes: {domain: string, text: string}[]}>}
 */
export async function loadBank(readJSON) {
  const index = await readJSON('index.json');
  const domains = [];
  const notes = [];
  const shows = new Set(list(index?.shows));
  for (const id of list(index?.domains).filter((d) => ID.test(str(d)))) {
    try {
      const overlay = shows.has(id) ? await readJSON(`${id}.show.json`) : null;
      const parsed = parseDomain(await readJSON(`${id}.json`), id, overlay);
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
 * @param {unknown} [overlay]   Parsed bank/<id>.show.json, when there is one.
 * @returns {{domain: Domain, notes: string[]}}
 */
export function parseDomain(raw, fallbackId, overlay = null) {
  const notes = [];
  const src = Array.isArray(raw) ? { questions: raw } : isObject(raw) ? raw : {};
  const own = isObject(overlay) ? overlay : {};
  const id = ID.test(str(src.domain)) ? str(src.domain) : fallbackId;
  const name = oneLine(src.name ?? own.name) || id;
  const title = oneLine(src.title ?? own.title) || name;
  const preamble = list(src.preamble ?? own.preamble).map(oneLine).filter(Boolean);

  const topics = [];
  for (const t of list(src.topics)) {
    const tid = str(t?.id ?? t?.key);
    if (!ID.test(tid)) {
      notes.push(`Тема ${JSON.stringify(t?.id ?? t?.key ?? null)}: id пишеться a–z, 0–9 і _.`);
      continue;
    }
    if (topics.some((x) => x.id === tid)) {
      notes.push(`Тема ${tid} описана двічі.`);
      continue;
    }
    topics.push({ id: tid, title: oneLine(t.title ?? t.heading) || tid });
  }

  const retired = list(src.retired)
    .filter((r) => ID.test(str(r?.id)))
    .map((r) => ({ id: str(r.id), replacedBy: str(r.replacedBy) || null, on: str(r.on) || null }));

  const questions = [];
  const undeclared = new Set();
  for (const q of list(src.questions)) {
    const question = parseQuestion(q, id, notes, questions);
    if (!question) continue;
    if (retired.some((r) => r.id === question.id)) {
      notes.push(`${question.id}: цей id знято з банку; під ним лежать старі відповіді, тож під нове питання його не беруть. Пропущено.`);
      continue;
    }
    if (!topics.some((t) => t.id === question.topic)) {
      topics.push({ id: question.topic, title: question.topic });
      undeclared.add(question.topic);
    }
    questions.push(question);
  }
  if (undeclared.size) {
    notes.push(`Теми без назви в "topics": ${[...undeclared].join(', ')}. У мапі їхні розділи називатимуться так само, як id.`);
  }
  const shows = isObject(own.questions) ? own.questions : {};
  for (const [qid, show] of Object.entries(shows)) {
    const question = questions.find((q) => q.id === qid);
    if (!question) notes.push(`${qid}: показ задано для питання, якого в банку нема.`);
    else if (isObject(show)) applyShow(question, show, notes);
  }
  return { domain: { id, name, title, preamble, topics, questions, retired }, notes };
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
