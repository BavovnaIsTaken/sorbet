/**
 * Question kinds. Every kind ends the same way: one line that lands in the
 * map and reads without the question in front of you. Only the way there
 * differs, so the file format never has to know about kinds.
 *
 *   choice  2–4 buttons, each with its line (the spec's card)
 *   duel    two concrete samples (code, a reply, a scene): pick the one that is yours
 *   scale   two poles and 2–4 stops between them: the side to err on, not a number
 *   rank    put 3–5 things in order; the line is written from a template
 *   taboo   tick what you would never do; the line lists it
 *   open    your own words, dropped into a sentence that frames them
 *   feel    try two variants of a tiny game blind, keep the one that felt right
 */

import { oneLine, sameText } from './mapfile.js';

export const KINDS = ['choice', 'duel', 'scale', 'rank', 'taboo', 'open', 'feel'];

/** Kinds answered by tapping one option. */
export const OPTION_KINDS = ['choice', 'duel', 'scale', 'feel'];

export const LABEL_MAX = 36;

// "Як часто" is a number dressed up as a direction (spec §3): the only
// questions the owner could not answer all asked about frequency.
const FREQUENCY = /(^|[^\p{L}])(часто|часті|частий|частіше|рідко|рідкісн\p{L}*|постійно)(?=$|[^\p{L}])/iu;

/**
 * @typedef {{label: string, line: string, sample?: string, params?: object}} Option
 * @typedef {{label: string, word: string}} Item
 * @typedef {{kind: 'choice'|'duel'|'scale'|'feel', options: Option[], format?: 'code'|'prose', poles?: string[], demo?: string}
 *         | {kind: 'rank', items: Item[], line: string}
 *         | {kind: 'taboo', items: Item[], line: string, none: string}
 *         | {kind: 'open', line: string, placeholder: string}} Body
 */

/**
 * The kind-specific part of a bank question. Returns null, with a note,
 * when the question cannot be asked.
 * @returns {Body|null}
 */
export function parseBody(raw, id, text, notes) {
  const kind = raw.kind == null ? 'choice' : String(raw.kind);
  if (!KINDS.includes(kind)) {
    notes.push(`${id}: невідомий kind «${kind}». Є: ${KINDS.join(', ')}. Пропущено.`);
    return null;
  }
  if (FREQUENCY.test(text)) noteFrequency(id, notes);
  if (OPTION_KINDS.includes(kind)) return parseOptionKind(raw, id, kind, notes);
  if (kind === 'open') {
    const line = oneLine(raw.line) || '{text}';
    if (!line.includes('{text}')) {
      notes.push(`${id}: у шаблоні line немає {text}, тож слова власника нікуди не ляжуть. Пропущено.`);
      return null;
    }
    return { kind, line, placeholder: oneLine(raw.placeholder) };
  }
  const items = parseItems(raw, id, kind, notes);
  if (!items) return null;
  const line = oneLine(raw.line);
  if (kind === 'rank') {
    if (!/\{1\}/.test(line)) {
      notes.push(`${id}: rank потребує шаблону line з {1}, {2}… Пропущено.`);
      return null;
    }
    const beyond = [...line.matchAll(/\{(\d+)\}/g)].filter((m) => Number(m[1]) > items.length);
    if (beyond.length) notes.push(`${id}: у шаблоні є {${beyond[0][1]}}, а пунктів лише ${items.length}.`);
    return { kind, items, line };
  }
  const none = oneLine(raw.none);
  if (!line.includes('{list}') || !none) {
    notes.push(`${id}: taboo потребує line з {list} і рядка none на випадок, коли нічого не вибрано. Пропущено.`);
    return null;
  }
  return { kind, items, line, none };
}

/**
 * Turns what the owner did on a card into the line for the map.
 * `pick` is an option index, an order or a selection of item indices, or text.
 * @returns {{line: string, source: 'option'|'own'}|null}
 */
export function lineFor(question, pick) {
  switch (question.kind) {
    case 'rank': {
      const order = Array.isArray(pick) ? pick : [];
      if (order.length !== question.items.length) return null;
      const line = question.line.replace(/\{(\d+)\}/g, (m, n) => question.items[order[Number(n) - 1]]?.word ?? m);
      return { line, source: 'option' };
    }
    case 'taboo': {
      const chosen = (Array.isArray(pick) ? pick : []).map((i) => question.items[i]?.word).filter(Boolean);
      return { line: chosen.length ? question.line.replace('{list}', listOf(chosen)) : question.none, source: 'option' };
    }
    case 'open': {
      const text = oneLine(pick).replace(/[.!]+$/, '');
      return text ? { line: question.line.replace('{text}', text), source: 'own' } : null;
    }
    default: {
      const option = question.options[pick];
      return option ? { line: option.line, source: 'option' } : null;
    }
  }
}

/** "а", "а і б", "а, б і в". */
export function listOf(words) {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} і ${words[words.length - 1]}`;
}

function parseOptionKind(raw, id, kind, notes) {
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
  const body = { kind, options };
  if (kind === 'duel') {
    if (options.some((o) => !o.sample)) {
      notes.push(`${id}: у duel кожен варіант показує зразок (sample). Пропущено.`);
      return null;
    }
    body.format = raw.format === 'code' ? 'code' : 'prose';
  }
  if (kind === 'scale') {
    const poles = (Array.isArray(raw.poles) ? raw.poles : []).map(oneLine).filter(Boolean);
    if (poles.length !== 2) {
      notes.push(`${id}: scale потребує двох полюсів (poles). Пропущено.`);
      return null;
    }
    body.poles = poles;
  }
  if (kind === 'feel') {
    body.demo = oneLine(raw.demo);
    if (!body.demo) {
      notes.push(`${id}: feel потребує demo. Пропущено.`);
      return null;
    }
  }
  return body;
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
  const [min, max] = kind === 'rank' ? [3, 5] : [2, 8];
  if (items.length < min) {
    notes.push(`${id}: ${kind} потребує щонайменше ${min} пунктів (items). Пропущено.`);
    return null;
  }
  if (items.length > max) notes.push(`${id}: ${items.length} пунктів забагато для ${kind}; до ${max} читається легше.`);
  return items;
}

function noteFrequency(id, notes) {
  const note = `${id}: частота — це число, перевдягнене в напрям. Спитай про наслідок, якого хочеш, а частота з нього виведеться.`;
  if (!notes.includes(note)) notes.push(note);
}
