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
 *   - гра не прощає промаху: влучання рівно таке, як виглядає [власник, 2026-09-24, forgiving_hits]
 *   - гравця тягне те, що він сам зламав у грі [власник, 2026-09-20, своє, what_pulls]
 *
 *   ## Не знаю
 *
 *   - Як часто гра зберігає прогрес? [власник, 2026-09-24, checkpoint_density]
 *
 * A line under "Не знаю" keeps the wording the question failed on. It is a
 * snapshot of what was asked that day, not a reference to the bank: once the
 * question is rewritten the two differ, and the snapshot is the record.
 *
 * The format is the one AIGameIDE's TasteMap reads and writes, so a file moves
 * between the two apps unchanged. Service fields are the *last* bracket group
 * on a line (a sentence may carry brackets of its own), split on commas and told
 * apart by shape, in any order: `власник` (for the human reader; dropped on the
 * way in), the day, `своє` when the line was typed rather than picked, the question id
 * (ASCII lower case, digits, `_`), and anything else, which is kept as it was.
 * `своє` is Cyrillic so that no parser can take it for an id.
 *
 * This module is the only place that knows the format. Edits touch only the
 * lines they are about; whatever the parser does not recognise stays verbatim
 * where it was.
 */

export const DONT_KNOW = 'Не знаю';
/** What the same section was called before 2026-09-24. Read, never written. */
const DONT_KNOW_BEFORE = 'Пропущені';
const AUTHOR = 'власник';
const OWN = 'своє';

export const PREAMBLE = [
  'Що власник вирішив загалом, а не про якусь одну роботу.',
  'Конкретне завдання старше за цей файл.',
];

const ITEM = /^[-*+][ \t]+(.*\S)[ \t]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9_]+$/;
// `own` is how this app spelled the flag for its first hours. Next to a real id
// it is read as `своє` and renamed on the next save; alone it is an id, as it is
// to TasteMap.
const LEGACY_OWN = /,[ \t]*own\][ \t]*$/;
const H1 = /^#[ \t]+(.*\S)[ \t]*$/;
const H2 = /^##[ \t]+(.*\S)[ \t]*$/;
const LIST_ITEM = /^[-*+][ \t]/;

/**
 * @typedef {Object} Entry  A recognised line: an answer, or a "не знаю" mark.
 * @property {string} id              Question id: the identity the entry hangs on.
 * @property {string|null} text       The answer line; for a mark, the wording the question
 *                                    failed on (a snapshot, never the bank's current text).
 *                                    Null only for a bare legacy mark ("- reward_size").
 * @property {string|null} on         Day it was written, YYYY-MM-DD. Null for a bare mark.
 * @property {'option'|'own'} source  Tapped a ready sentence, or wrote their own.
 * @property {string[]} extras        Bracket fields this version does not know, kept.
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
 * @typedef {{type: 'answer', id: string, section: string, line: string, on: string|null, source: 'option'|'own', extras?: string[]}
 *         | {type: 'unanswer', id: string}
 *         | {type: 'mark', id: string, text: string|null, on: string|null}
 *         | {type: 'unmark', id: string}
 *         | {type: 'replace', text: string}
 *         | {type: 'batch', ops: Op[]}} Op  One change to a map file.
 *
 * @typedef {{title: string, preamble?: string[], topics: {id: string, title: string}[], questions: {id: string, topic: string}[]}} Layout
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
  return [`# ${layout.title}`, '', ...(layout.preamble?.length ? layout.preamble : PREAMBLE), ''].join('\n');
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
  if (op.type === 'batch') return op.ops.reduce((t, o) => apply(t, layout, o), text);
  const removal = op.type === 'unanswer' || op.type === 'unmark';
  if (removal && !text?.trim()) return text;
  const doc = split(text?.trim() ? text : blankMap(layout));
  switch (op.type) {
    case 'answer':
      // an answer replaces whatever the question said before, and a question
      // answered on a later pass landed, whatever it did the first time
      put(doc.lines, layout, 'answer', op.id, formatAnswer(op), op.section);
      drop(doc.lines, 'mark', op.id);
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
  renameLegacyOwn(doc.lines);
  return join(doc);
}

/**
 * The op that takes the file back to `before` after `op` was applied to it.
 * @param {string|null} before @param {Layout} layout @param {Op} op @returns {Op}
 */
export function inverse(before, layout, op) {
  if (op.type === 'replace') return { type: 'replace', text: before ?? '' };
  if (op.type === 'batch') {
    const steps = [];
    let text = before;
    for (const o of op.ops) {
      steps.unshift(inverse(text, layout, o));
      text = apply(text, layout, o);
    }
    return { type: 'batch', ops: steps };
  }
  const view = readMap(before);
  const answerBack = () => {
    const prev = view.answers.get(op.id);
    if (!prev) return { type: 'unanswer', id: op.id };
    const section = prev.section ?? sectionFor(layout, op.id);
    return { type: 'answer', id: op.id, section, line: prev.text, on: prev.on, source: prev.source, extras: prev.extras };
  };
  const markBack = () => {
    const prev = view.marks.get(op.id);
    return prev ? { type: 'mark', id: op.id, text: prev.text, on: prev.on } : { type: 'unmark', id: op.id };
  };
  if (op.type === 'unanswer') return answerBack();
  if (op.type === 'answer') return view.marks.has(op.id) ? { type: 'batch', ops: [answerBack(), markBack()] } : answerBack();
  return markBack();
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
      section = { title: h2[1], at, dontKnow: sameText(h2[1], DONT_KNOW) || sameText(h2[1], DONT_KNOW_BEFORE) };
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

/**
 * Splits a row into its sentence and its service fields: the *last* bracket group
 * only, and only when it ends the line.
 */
export function splitRow(body) {
  const open = body.lastIndexOf('[');
  if (!body.endsWith(']') || open < 0) return { text: body, fields: [] };
  const text = body.slice(0, open).trim();
  if (!text) return { text: body, fields: [] };
  const fields = body.slice(open + 1, -1).split(',').map((f) => f.trim()).filter(Boolean);
  return { text, fields };
}

function parseEntry(line, section) {
  const item = ITEM.exec(line);
  if (!item) return null;
  const body = item[1];
  const { text, fields } = splitRow(body);
  let on = null;
  let own = false;
  const ids = [];
  const extras = [];
  for (const field of fields) {
    if (field === AUTHOR) continue;
    if (DAY.test(field)) on = field;
    else if (field === OWN) own = true;
    else if (ID.test(field)) ids.push(field);
    else extras.push(field);
  }
  if (ids.length > 1 && ids.includes('own')) {
    ids.splice(ids.indexOf('own'), 1);
    own = true;
  }
  const id = ids.pop();
  if (id) {
    extras.unshift(...ids);
    return { id, text, on, source: own ? 'own' : 'option', extras };
  }
  if (section?.dontKnow && !fields.length && ID.test(body)) return { id: body, text: null, on: null, source: 'option', extras: [] };
  return null;
}

function renameLegacyOwn(lines) {
  lines.forEach((line, i) => {
    if (LEGACY_OWN.test(line) && parseEntry(line, null)?.source === 'own') lines[i] = line.replace(LEGACY_OWN, ', своє]');
  });
}

/** The field order TasteMap writes: author, day, own-words flag, id, the rest. */
function formatAnswer({ line, on, id, source, extras = [] }) {
  const fields = [AUTHOR, on, source === 'own' ? OWN : null, id, ...extras].filter(Boolean);
  return `- ${oneLine(line)} [${fields.join(', ')}]`;
}

function formatMark({ text, on, id }) {
  return text == null ? `- ${id}` : `- ${oneLine(text)} [${[AUTHOR, on, id].filter(Boolean).join(', ')}]`;
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
