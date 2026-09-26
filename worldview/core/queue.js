/**
 * What to ask next, and how far each topic has got.
 *
 * A question is open while the map holds neither an answer nor a live
 * "не знаю" mark for it. A mark stays live only while the question reads the
 * same: once the author rewrites the text under the same id, it comes back.
 */

import { sameText } from './mapfile.js';

/** @typedef {import('./bank.js').Domain} Domain */
/** @typedef {import('./bank.js').Question} Question */
/** @typedef {import('./mapfile.js').MapView} MapView */
/** @typedef {import('./mapfile.js').Entry} Entry */

/** @typedef {'answered'|'unknown'|'open'} Status */

/** Keys that stay unique across domains. */
export const questionKey = (domain, question) => `${domain.id}/${question.id}`;
export const topicKey = (domain, topicId) => `${domain.id}/${topicId}`;

/** @param {Question} question @param {MapView} view @returns {Status} */
export function status(question, view) {
  if (view.answers.has(question.id)) return 'answered';
  const mark = view.marks.get(question.id);
  if (mark && (mark.text === null || sameText(mark.text, question.text))) return 'unknown';
  return 'open';
}

/**
 * Open questions in the order to ask them. A mix by default: the topic with
 * the least said so far goes first, so consecutive cards change topic, kind
 * and domain, and the map fills evenly instead of one corner at a time.
 * A focused topic goes before everything; what was put off in this sitting
 * goes after everything else.
 *
 * @param {{domain: Domain, view: MapView}[]} maps
 * @param {{skipped?: string[], focus?: string|null}} [options]  Question keys; a topic key.
 * @returns {{domain: Domain, question: Question}[]}
 */
export function queue(maps, { skipped = [], focus = null } = {}) {
  const later = new Map(skipped.map((key, i) => [key, i]));
  const items = [];
  maps.forEach(({ domain, view }, d) => {
    // depth: how many questions of this topic would come before this one,
    // answered ones included. Sorting by it deals the topics out round-robin.
    const depth = new Map();
    for (const q of domain.questions) {
      if (status(q, view) !== 'open') depth.set(q.topic, (depth.get(q.topic) ?? 0) + 1);
    }
    domain.questions.forEach((question, i) => {
      if (status(question, view) !== 'open') return;
      const key = questionKey(domain, question);
      const k = depth.get(question.topic) ?? 0;
      depth.set(question.topic, k + 1);
      items.push({
        domain,
        question,
        rank: [
          focus && topicKey(domain, question.topic) !== focus ? 1 : 0,
          later.has(key) ? 1 : 0,
          later.get(key) ?? 0,
          k,
          domain.topics.findIndex((t) => t.id === question.topic),
          d,
          i,
        ],
      });
    });
  });
  return items
    .sort((a, b) => a.rank.reduce((diff, v, i) => diff || v - b.rank[i], 0))
    .map(({ domain, question }) => ({ domain, question }));
}

/**
 * Progress by topic, one cell per question in bank order. There is no grand
 * total on purpose: a denominator on a screen with no end reads as reproach.
 * @param {Domain} domain @param {MapView} view
 */
export function legend(domain, view) {
  return domain.topics
    .map((topic) => ({
      topic,
      cells: domain.questions
        .filter((q) => q.topic === topic.id)
        .map((q) => ({ id: q.id, status: status(q, view) })),
    }))
    .filter((row) => row.cells.length > 0);
}

/**
 * Where a "не знаю" mark stands for the author: still waiting for a rewrite,
 * already rewritten under the same id (the question is back in the queue),
 * replaced by a different question under a new id, or simply gone from the bank.
 * Only a waiting mark asks anyone for work; the others are records.
 * @param {Entry} mark @param {Domain} domain @returns {'waiting'|'rewritten'|'replaced'|'gone'}
 */
export function markState(mark, domain) {
  const question = domain.questions.find((q) => q.id === mark.id);
  if (!question) return domain.retired?.some((r) => r.id === mark.id && r.replacedBy) ? 'replaced' : 'gone';
  return mark.text === null || sameText(mark.text, question.text) ? 'waiting' : 'rewritten';
}
