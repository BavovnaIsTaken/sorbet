/**
 * The map file: the human-readable .md that is the source of truth.
 *
 *   # Як я бачу ігри
 *
 *   Що власник вирішив загалом, а не про якусь одну роботу.
 *   Конкретне завдання старше за цей файл.
 *
 *   ## Керування
 *
 *   - гра не прощає промаху: влучання рівно таке, як виглядає [2026-09-24, forgiving_hits]
 *   - руку видно до пікселя [2026-09-24, aim_assist, own]
 *
 *   ## Не знаю
 *
 *   - Як часто гра зберігає прогрес? [2026-09-24, checkpoint_density]
 *
 * Service fields sit in brackets at the end of a line. This module is the only
 * place that knows the format. Edits touch only the lines they are about;
 * whatever the parser does not recognise stays verbatim where it was.
 */

export const DONT_KNOW = 'Не знаю';

export const PREAMBLE = [
  'Що власник вирішив загалом, а не про якусь одну роботу.',
  'Конкретне завдання старше за цей файл.',
];

const ENTRY = /^[-*+][ \t]+(\S.*?)[ \t]+\[(\d{4}-\d{2}-\d{2}),[ \t]*([a-z0-9_]+)(?:,[ \t]*(own|option))?\][ \t]*$/;
const BARE_MARK = /^[-*+][ \t]+([a-z0-9_]+)[ \t]*$/;
const H1 = /^#[ \t]+(.*\S)[ \t]*$/;
const H2 = /^##[ \t]+(.*\S)[ \t]*$/;
const LIST_ITEM = /^[-*+][ \t]/;

/**
 * @typedef {Object} Entry  A recognised line: an answer, or a "не знаю" mark.
 * @property {string} id              Question id: the identity the entry hangs on.
 * @property {string|null} text       The answer line, or the question text of a mark.
 *                                    Null only for a bare legacy mark ("- reward_size").
 * @property {string|null} on         Day it was written, YYYY-MM-DD. Null for a bare mark.
 * @property {'option'|'own'} source  Tapped a ready sentence, or wrote their own.
 * @property {string|null} section    Heading of the section the entry sits in.
 * @property {number} at              Line index in the file.
 *
 * @typedef {{kind: 'answer'|'mark', entry: Entry} | {kind: 'note', text: string, at: number}} Item
 *
 * @typedef {Object} Section
 * @property {string} title
 * @property {number} at        Line index of the heading.
 * @property {boolean} dontKnow The "## Не знаю" section.
 * @property {Item[]} items     Everything under the heading, in file order.
 *
 * @typedef {Object} MapView  A read-only picture of one map file.
 * @property {string|null} title
 * @property {string[]} preamble          Lines between the title and the first section.
 * @property {Item[]} lead                Entries and notes before the first section.
 * @property {Section[]} sections
 * @property {Map<string, Entry>} answers By question id; a later duplicate wins.
 * @property {Map<string, Entry>} marks   By question id.
 *
 * @typedef {{type: 'answer', id: string, section: string, line: string, on: string, source: 'option'|'own'}
 *         | {type: 'unanswer', id: string}
 *         | {type: 'mark', id: string, text: string|null, on: string|null}
 *         | {type: 'unmark', id: string}
 *         | {type: 'replace', text: string}} Op  One change to a map file.
 *
 * @typedef {{title: string, topics: {id: string, title: string}[], questions: {id: string, topic: string}[]}} Layout
 *   The part of a bank domain the file layout depends on.
 */

/** A map line is always one line. */
export const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const sameText = (a, b) => oneLine(a).toLowerCase() === oneLine(b).toLowerCase();

/** Local calendar day as YYYY-MM-DD. */
export function today(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A new, empty map for a domain. */
export function blankMap(layout) {
  return [`# ${layout.title}`, '', ...PREAMBLE, ''].join('\n');
}

/** Heading a new answer to this question goes under. */
export function sectionFor(layout, questionId) {
  const topic = layout.questions.find((q) => q.id === questionId)?.topic;
  return layout.topics.find((t) => t.id === topic)?.title ?? 'Інше';
}

/** @param {string|null|undefined} text @returns {MapView} */
export function readMap(text) {
  /** @type {MapView} */
  const view = { title: null, preamble: [], lead: [], sections: [], answers: new Map(), marks: new Map() };
  let current = null;
  for (const t of scan(split(text).lines)) {
    const items = current ? current.items : view.lead;
    switch (t.kind) {
      case 'title': view.title = t.title; break;
      case 'preamble': view.preamble.push(t.line); break;
      case 'section':
        current = { ...t.section, items: [] };
        view.sections.push(current);
        break;
      case 'answer':
        view.answers.set(t.entry.id, t.entry);
        items.push({ kind: 'answer', entry: t.entry });
        break;
      case 'mark':
        view.marks.set(t.entry.id, t.entry);
        items.push({ kind: 'mark', entry: t.entry });
        break;
      case 'note': items.push({ kind: 'note', text: t.line, at: t.at }); break;
    }
  }
  return view;
}

/**
 * Applies one change and returns the new file text. A removal that finds
 * nothing returns the text untouched.
 * @param {string|null} text @param {Layout} layout @param {Op} op @returns {string|null}
 */
export function apply(text, layout, op) {
  if (op.type === 'replace') return op.text;
  const removal = op.type === 'unanswer' || op.type === 'unmark';
  if (removal && !text?.trim()) return text;
  const doc = split(text?.trim() ? text : blankMap(layout));
  switch (op.type) {
    case 'answer':
      put(doc.lines, layout, 'answer', op.id, formatAnswer(op), op.section);
      break;
    case 'mark':
      put(doc.lines, layout, 'mark', op.id, formatMark(op), DONT_KNOW);
      break;
    case 'unanswer':
    case 'unmark':
      if (!drop(doc.lines, op.type === 'unanswer' ? 'answer' : 'mark', op.id)) return text;
      break;
    default:
      throw new TypeError(`Unknown op: ${op.type}`);
  }
  return join(doc);
}

/**
 * The op that takes the file back to `before` after `op` was applied to it.
 * @param {string|null} before @param {Layout} layout @param {Op} op @returns {Op}
 */
export function inverse(before, layout, op) {
  if (op.type === 'replace') return { type: 'replace', text: before ?? '' };
  const view = readMap(before);
  if (op.type === 'answer' || op.type === 'unanswer') {
    const prev = view.answers.get(op.id);
    if (!prev) return { type: 'unanswer', id: op.id };
    const section = prev.section ?? sectionFor(layout, op.id);
    return { type: 'answer', id: op.id, section, line: prev.text, on: prev.on, source: prev.source };
  }
  const prev = view.marks.get(op.id);
  return prev ? { type: 'mark', id: op.id, text: prev.text, on: prev.on } : { type: 'unmark', id: op.id };
}

/**
 * Walks the file line by line. Exported for readers that need file order,
 * such as the agent context.
 * @param {string[]} lines
 */
export function* scan(lines) {
  let section = null;
  let titled = false;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    if (!line.trim()) {
      yield { at, kind: 'blank', line, section };
      continue;
    }
    const h2 = H2.exec(line);
    if (h2) {
      section = { title: h2[1], at, dontKnow: sameText(h2[1], DONT_KNOW) };
      yield { at, kind: 'section', line, section };
      continue;
    }
    const h1 = !section && !titled ? H1.exec(line) : null;
    if (h1) {
      titled = true;
      yield { at, kind: 'title', line, section, title: h1[1] };
      continue;
    }
    const entry = parseEntry(line, section);
    if (entry) {
      yield { at, kind: section?.dontKnow ? 'mark' : 'answer', line, section, entry: { ...entry, section: section?.title ?? null, at } };
      continue;
    }
    yield { at, kind: section ? 'note' : 'preamble', line, section };
  }
}

/** Splits file text into lines, remembering line endings so a write keeps them. */
export function split(text) {
  const s = text ?? '';
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  if (s === '') return { lines: [], eol, final: true };
  const lines = s.split(/\r?\n/);
  const final = lines[lines.length - 1] === '';
  if (final) lines.pop();
  return { lines, eol, final };
}

function join({ lines, eol, final }) {
  return lines.length ? lines.join(eol) + (final ? eol : '') : '';
}

function parseEntry(line, section) {
  const m = ENTRY.exec(line);
  if (m) return { id: m[3], text: m[1], on: m[2], source: m[4] === 'own' ? 'own' : 'option' };
  if (section?.dontKnow) {
    const bare = BARE_MARK.exec(line);
    if (bare) return { id: bare[1], text: null, on: null, source: 'option' };
  }
  return null;
}

function formatAnswer({ line, on, id, source }) {
  return `- ${oneLine(line)} [${on}, ${id}${source === 'own' ? ', own' : ''}]`;
}

function formatMark({ text, on, id }) {
  return text == null ? `- ${id}` : `- ${oneLine(text)} [${on}, ${id}]`;
}

/** Replaces the entry in place, or adds it at the end of its section. */
function put(lines, layout, kind, id, entryLine, sectionTitle) {
  const found = [...scan(lines)].filter((t) => t.kind === kind && t.entry.id === id);
  if (found.length) {
    for (const t of found.slice(1).reverse()) removeEntry(lines, t);
    lines[found[0].at] = entryLine;
    return;
  }
  const head = [...scan(lines)].find((t) => t.kind === 'section'
    && (kind === 'mark' ? t.section.dontKnow : !t.section.dontKnow && sameText(t.section.title, sectionTitle)));
  if (head) appendToSection(lines, head.at, entryLine);
  else insertSection(lines, layout, sectionTitle, entryLine);
}

function drop(lines, kind, id) {
  const found = [...scan(lines)].filter((t) => t.kind === kind && t.entry.id === id);
  for (const t of found.reverse()) removeEntry(lines, t);
  return found.length > 0;
}

function removeEntry(lines, token) {
  lines.splice(token.at, 1);
  collapseBlank(lines, token.at);
  if (token.section) dropIfEmpty(lines, token.section.at);
}

function sectionEnd(lines, at) {
  for (let i = at + 1; i < lines.length; i++) if (H2.test(lines[i])) return i;
  return lines.length;
}

function appendToSection(lines, at, entryLine) {
  const end = sectionEnd(lines, at);
  let last = at;
  for (let i = end - 1; i > at; i--) {
    if (lines[i].trim()) {
      last = i;
      break;
    }
  }
  const block = last !== at && LIST_ITEM.test(lines[last]) ? [entryLine] : ['', entryLine];
  lines.splice(last + 1, 0, ...block);
  const after = last + 1 + block.length;
  if (after < lines.length && lines[after].trim()) lines.splice(after, 0, '');
}

/** New sections follow the bank's topic order; "Не знаю" stays last. */
function insertSection(lines, layout, title, entryLine) {
  const mine = rank(layout, title) ?? Number.MAX_SAFE_INTEGER;
  let at = lines.length;
  for (const t of scan(lines)) {
    if (t.kind !== 'section') continue;
    const r = rank(layout, t.section.title);
    if (r !== null && r > mine) {
      at = t.at;
      break;
    }
  }
  const block = [`## ${title}`, '', entryLine];
  if (at === lines.length) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push('');
    lines.push(...block);
  } else {
    const gap = at > 0 && lines[at - 1].trim() ? [''] : [];
    lines.splice(at, 0, ...gap, ...block, '');
  }
}

function rank(layout, title) {
  if (sameText(title, DONT_KNOW)) return Infinity;
  const i = layout.topics.findIndex((t) => sameText(t.title, title));
  return i < 0 ? null : i;
}

function collapseBlank(lines, i) {
  const blank = (j) => j >= 0 && j < lines.length && !lines[j].trim();
  if (i >= lines.length) trimEnd(lines);
  else if (blank(i) && (i === 0 || blank(i - 1))) lines.splice(i, 1);
}

function dropIfEmpty(lines, at) {
  const end = sectionEnd(lines, at);
  for (let i = at + 1; i < end; i++) if (lines[i].trim()) return;
  lines.splice(at, end - at);
  if (at >= lines.length) trimEnd(lines);
}

function trimEnd(lines) {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
}
