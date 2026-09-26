/**
 * Question forms. The form is part of the contract shared with AIGameIDE and is
 * named, never guessed from which keys are present:
 *
 *   one_of     2–4 options, each with a line written by the question's author
 *   ranking    3–5 items put in order; the line is a template with positional
 *              slots {1}, {2}, …
 *   taboo      items the owner would never have; the line is a template with one
 *              {list} slot, and `none` is the line for an empty selection
 *   own_words  no options: the line is exactly what the owner typed, and it goes
 *              into the map flagged `своє`
 *
 * Lists read as Ukrainian: «A», «A і B», «A, B і C». That is part of the contract
 * too, not a renderer's taste. Because a ranking or taboo line is computed rather
 * than written, each such question carries one `example`: a concrete pick and the
 * exact sentence it gives. Rendering the example is what pins the renderer.
 *
 * How a one_of is shown is this app's business and changes nothing in the map:
 * `show` is `buttons` (the default), `duel` (each option shows a sample), `scale`
 * (options sit between two poles) or `feel` (options are variants of a tiny game,
 * tried blind).
 */

import { oneLine, sameText } from './mapfile.js';

export const KINDS = ['one_of', 'ranking', 'taboo', 'own_words'];
export const SHOWS = ['buttons', 'duel', 'scale', 'feel'];

export const LABEL_MAX = 36;

// "Як часто" is a number dressed up as a direction (spec §3): the only
// questions the owner could not answer all asked about frequency.
const FREQUENCY = /(^|[^\p{L}])(часто|часті|частий|частіше|рідко|рідкісн\p{L}*|постійно)(?=$|[^\p{L}])/iu;

/**
 * @typedef {{label: string, line: string, sample?: string, params?: object}} Option
 * @typedef {{label: string, word: string}} Item
 * @typedef {{kind: 'one_of', options: Option[], show: 'buttons'|'duel'|'scale'|'feel', format?: 'code'|'prose', poles?: string[], demo?: string}
 *         | {kind: 'ranking', items: Item[], line: string, example: {pick: string[], line: string}}
 *         | {kind: 'taboo', items: Item[], line: string, none: string, example: {pick: string[], line: string}}
 *         | {kind: 'own_words'}} Body
 */

/**
 * The form-specific part of a bank question. Returns null, with a note, when the
 * question cannot be asked.
 * @returns {Body|null}
 */
export function parseBody(raw, id, text, notes) {
  const kind = raw.kind == null ? 'one_of' : String(raw.kind);
  if (!KINDS.includes(kind)) {
    notes.push(`${id}: невідома форма «${kind}». Є: ${KINDS.join(', ')}. Пропущено.`);
    return null;
  }
  if (FREQUENCY.test(text)) noteFrequency(id, notes);
  if (kind === 'one_of') return parseOneOf(raw, id, notes);
  if (kind === 'own_words') {
    if (raw.line != null || raw.items != null) notes.push(`${id}: own_words не має ні шаблону, ні пунктів: рядок — це рівно введений текст.`);
    return { kind };
  }
  const items = parseItems(raw, id, kind, notes);
  if (!items) return null;
  const line = oneLine(raw.line);
  const body = { kind, items, line };
  if (kind === 'ranking') {
    const slots = [...line.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    if (!slots.length || slots.some((n) => n < 1 || n > items.length) || line.includes('{list}')) {
      notes.push(`${id}: ranking потребує шаблону з позиційними гніздами {1}…{${items.length}}. Пропущено.`);
      return null;
    }
  } else {
    if ((line.match(/\{list\}/g) ?? []).length !== 1 || /\{\d+\}/.test(line)) {
      notes.push(`${id}: taboo потребує шаблону з одним гніздом {list}. Пропущено.`);
      return null;
    }
    body.none = oneLine(raw.none);
    if (!body.none) {
      notes.push(`${id}: форма з вибором кількох потребує рядка none на порожній вибір. Пропущено.`);
      return null;
    }
  }
  body.example = parseExample(raw.example, body, id, notes);
  return body.example ? body : null;
}

/**
 * Turns what the owner did on a card into the line for the map.
 * `pick` is an option index, an order or a selection of item indices, or text.
 * @returns {{line: string, source: 'option'|'own'}|null}
 */
export function lineFor(question, pick) {
  switch (question.kind) {
    case 'ranking': {
      const order = Array.isArray(pick) ? pick : [];
      if (order.length !== question.items.length || new Set(order).size !== order.length) return null;
      const line = question.line.replace(/\{(\d+)\}/g, (m, n) => question.items[order[Number(n) - 1]]?.word ?? m);
      return { line, source: 'option' };
    }
    case 'taboo': {
      const chosen = (Array.isArray(pick) ? pick : []).map((i) => question.items[i]?.word).filter(Boolean);
      return { line: chosen.length ? question.line.replace('{list}', listOf(chosen)) : question.none, source: 'option' };
    }
    case 'own_words': {
      const line = oneLine(pick);
      return line ? { line, source: 'own' } : null;
    }
    default: {
      const option = question.options[pick];
      return option ? { line: option.line, source: 'option' } : null;
    }
  }
}

/** «A», «A і B», «A, B і C». */
export function listOf(words) {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} і ${words[words.length - 1]}`;
}

/**
 * Presentation for a one_of that someone else owns: keeps the question's meaning
 * (text, options, lines) and changes only how it is shown.
 * @returns {boolean} whether the overlay was applied
 */
export function applyShow(question, show, notes) {
  const id = question.id;
  if (question.kind !== 'one_of') {
    notes.push(`${id}: показ задається лише для one_of.`);
    return false;
  }
  const options = question.options.map((o, i) => ({
    ...o,
    ...(show.samples?.[i] != null ? { sample: String(show.samples[i]).replace(/\s+$/, '') } : {}),
    ...(show.params?.[i] != null ? { params: show.params[i] } : {}),
  }));
  for (const key of ['samples', 'params']) {
    if (show[key] != null && (!Array.isArray(show[key]) || show[key].length !== options.length)) {
      notes.push(`${id}: ${key} у показі має ${Array.isArray(show[key]) ? show[key].length : 'не список'}, а варіантів ${options.length}.`);
      return false;
    }
  }
  const parsed = parseShow({ ...show, options }, id, options, notes);
  if (!parsed) return false;
  Object.assign(question, parsed, { options });
  return true;
}

function parseOneOf(raw, id, notes) {
  const options = [];
  for (const o of Array.isArray(raw.options) ? raw.options : []) {
    const label = oneLine(o?.label);
    const line = oneLine(o?.line);
    if (!label || !line) {
      notes.push(`${id}: варіант без label чи line не показано.`);
      continue;
    }
    const option = { label, line };
    if (typeof o.sample === 'string' && o.sample.trim()) option.sample = o.sample.replace(/\s+$/, '');
    if (o.params && typeof o.params === 'object') option.params = o.params;
    options.push(option);
  }
  if (options.length < 2) {
    notes.push(`${id}: варіантів ${options.length}, а один нічого не записує. Пропущено.`);
    return null;
  }
  if (options.length > 4) notes.push(`${id}: ${options.length} варіантів — це вже список, а не вибір. Лиши 2–4.`);
  for (const o of options) {
    if (o.label.length > LABEL_MAX) notes.push(`${id}: кнопка «${o.label}» довша за ${LABEL_MAX} символів і не влізе в ряд на телефоні.`);
    if (sameText(o.line, o.label) || o.line.length <= o.label.length) {
      notes.push(`${id}: рядок «${o.line}» не каже більше за кнопку. Без питання перед очима він нічого не означатиме.`);
    }
    if (FREQUENCY.test(o.label)) noteFrequency(id, notes);
  }
  if (new Set(options.map((o) => o.line.toLowerCase())).size < options.length) {
    notes.push(`${id}: два варіанти записують однаковий рядок.`);
  }
  const shown = parseShow(raw, id, options, notes);
  return shown ? { kind: 'one_of', options, ...shown } : null;
}

function parseShow(raw, id, options, notes) {
  const show = raw.show == null ? 'buttons' : String(raw.show);
  if (!SHOWS.includes(show)) {
    notes.push(`${id}: невідомий показ «${show}». Є: ${SHOWS.join(', ')}.`);
    return null;
  }
  const out = { show };
  if (show === 'duel') {
    if (options.some((o) => !o.sample)) {
      notes.push(`${id}: у дуелі кожен варіант показує зразок (sample).`);
      return null;
    }
    out.format = raw.format === 'code' ? 'code' : 'prose';
  }
  if (show === 'scale') {
    const poles = (Array.isArray(raw.poles) ? raw.poles : []).map(oneLine).filter(Boolean);
    if (poles.length !== 2) {
      notes.push(`${id}: шкала потребує двох полюсів (poles).`);
      return null;
    }
    out.poles = poles;
  }
  if (show === 'feel') {
    out.demo = oneLine(raw.demo);
    if (!out.demo) {
      notes.push(`${id}: feel потребує demo.`);
      return null;
    }
  }
  return out;
}

function parseItems(raw, id, kind, notes) {
  const items = [];
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    const label = oneLine(it?.label);
    if (!label) continue;
    const word = oneLine(it.word) || label;
    items.push({ label, word });
    if (label.length > LABEL_MAX) notes.push(`${id}: пункт «${label}» довший за ${LABEL_MAX} символів.`);
    if (word.includes(',')) notes.push(`${id}: у «${word}» є кома, і в зібраному списку вона зіб’є розділові знаки. Краще іменник без підрядного речення.`);
    if (FREQUENCY.test(label)) noteFrequency(id, notes);
  }
  const [min, max] = kind === 'ranking' ? [3, 5] : [2, 8];
  if (items.length < min) {
    notes.push(`${id}: ${kind} потребує щонайменше ${min} пунктів (items). Пропущено.`);
    return null;
  }
  if (items.length > max) notes.push(`${id}: ${items.length} пунктів забагато для ${kind}; до ${max} читається легше.`);
  return items;
}

/** The one example that pins how a composed line is rendered. */
function parseExample(raw, question, id, notes) {
  if (!raw || !Array.isArray(raw.pick) || typeof raw.line !== 'string') {
    notes.push(`${id}: складене питання несе зразок "example": {"pick": [...], "line": "..."}, інакше ніщо не пильнує, що рендерер пише те саме речення. Пропущено.`);
    return null;
  }
  const pick = raw.pick.map((label) => question.items.findIndex((it) => sameText(it.label, label)));
  if (pick.some((i) => i < 0)) {
    notes.push(`${id}: у зразку є пункт, якого нема серед items. Пропущено.`);
    return null;
  }
  if (!pick.length) {
    notes.push(`${id}: зразок має щось вибрати; порожній вибір — це рядок none. Пропущено.`);
    return null;
  }
  const rendered = lineFor(question, pick)?.line;
  if (rendered !== oneLine(raw.line)) {
    notes.push(`${id}: зразок рендериться як «${rendered ?? '—'}», а в банку записано «${oneLine(raw.line)}». Пропущено.`);
    return null;
  }
  return { pick: raw.pick.map(oneLine), line: oneLine(raw.line) };
}

function noteFrequency(id, notes) {
  const note = `${id}: частота — це число, перевдягнене в напрям. Спитай про наслідок, якого хочеш, а частота з нього виведеться.`;
  if (!notes.includes(note)) notes.push(note);
}
