/**
 * The two other forms of a map file: JSON for programs, and the block that
 * goes into an agent's task (spec §5).
 */

import { readMap, scan, split, oneLine, sameText } from './mapfile.js';

/**
 * Says where the block comes from, what authority it has and what beats it.
 * Without it the model spends its reasoning working out why the note is there.
 */
export const SIGNATURE = [
  '[app] Що власник вирішив загалом. Читати не треба — це воно і є.',
  '      Конкретне завдання старше за це.',
];

/** @typedef {import('./bank.js').Domain} Domain */

/**
 * @param {string|null} text @param {Domain} domain
 * @returns {{domain: string, title: string, answers: object[], marks: object[], notes: object[]}}
 */
export function toJSON(text, domain) {
  const view = readMap(text);
  const bankTopic = (id) => domain.questions.find((q) => q.id === id)?.topic ?? null;
  const notes = [];
  for (const s of view.sections) {
    for (const item of s.items) {
      if (item.kind === 'note') notes.push({ topic: topicOf(domain, s.title), text: item.text });
    }
  }
  return {
    domain: domain.id,
    title: view.title ?? domain.title,
    answers: [...view.answers.values()].map((e) => ({
      question: e.id,
      domain: domain.id,
      topic: (e.section && topicOf(domain, e.section)) ?? bankTopic(e.id),
      line: e.text,
      on: e.on,
      source: e.source,
    })),
    marks: [...view.marks.values()].map((e) => ({
      question: e.id,
      domain: domain.id,
      topic: bankTopic(e.id),
      text: e.text,
      on: e.on,
    })),
    notes,
  };
}

/**
 * Sections a task can ask for: every section with something in it, except
 * "Не знаю", which says nothing about the owner.
 * @param {string|null} text @param {Domain} domain
 * @returns {{title: string, topic: string|null, lines: number}[]}
 */
export function contextSections(text, domain) {
  return readMap(text).sections
    .filter((s) => !s.dontKnow && s.items.length > 0)
    .map((s) => ({ title: s.title, topic: topicOf(domain, s.title), lines: s.items.length }));
}

/**
 * Only the sections a task touches, never the whole map. Service fields are
 * stripped (the model never sees the brackets); hand-written lines go as is.
 * @param {string|null} text @param {Domain} domain
 * @param {string[]} wanted  Topic ids or section titles.
 */
export function toContext(text, domain, wanted) {
  return contextBlock([{ text, domain, wanted }]);
}

/**
 * The same for several domains at once, under one signature.
 * @param {{text: string|null, domain: Domain, wanted: string[]}[]} parts
 */
export function contextBlock(parts) {
  const out = [...SIGNATURE];
  for (const { text, domain, wanted } of parts) {
    out.push('', `# ${readMap(text).title ?? domain.title}`);
    let taking = false;
    for (const t of scan(split(text).lines)) {
      if (t.kind === 'section') {
        const topic = topicOf(domain, t.section.title);
        taking = !t.section.dontKnow
          && wanted.some((w) => sameText(w, t.section.title) || (topic !== null && w === topic));
        if (taking) out.push('', `## ${t.section.title}`);
        continue;
      }
      if (!taking || t.kind === 'blank') continue;
      out.push(t.kind === 'answer' ? `- ${oneLine(t.entry.text)}` : t.line);
    }
  }
  return `${out.join('\n')}\n`;
}

/** Topic id for a section heading, when the bank knows it. */
export function topicOf(domain, sectionTitle) {
  return domain.topics.find((t) => sameText(t.title, sectionTitle))?.id ?? null;
}
