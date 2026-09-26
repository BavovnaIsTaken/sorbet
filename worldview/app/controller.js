/**
 * The app's state and every way it can change. Views read `state` and call
 * these methods; nothing else writes.
 *
 * Each change is an Op (core/mapfile.js). It is applied to what is on screen
 * at once, then persisted on top of a fresh read of the store, so a hand edit
 * or another device is never overwritten. Every tap saves: there is no
 * "Done", because there is no end.
 */

import { readMap, apply, inverse, blankMap, sectionFor, today, oneLine } from '../core/mapfile.js';
import { queue, questionKey } from '../core/queue.js';
import { lineFor } from '../core/kinds.js';
import { toJSON, contextBlock } from '../core/export.js';

/** @typedef {import('./stores.js').Store} Store */
/** @typedef {import('./stores.js').Saver} Saver */
/** @typedef {import('../core/bank.js').Domain} Domain */
/** @typedef {import('../core/bank.js').Question} Question */
/** @typedef {import('../core/mapfile.js').Op} Op */

/** Questions quick enough to answer on a timer: one tap, nothing to read first. */
export const blitzable = (q) => q.kind === 'one_of' && (q.show === 'buttons' || q.show === 'scale');
export const BLITZ_ROUND = 10;
export const BLITZ_SECONDS = 8;

/**
 * @param {{domains: Domain[], notes: {domain: string, text: string}[], store: Store, saver: Saver|null}} deps
 */
export function createController({ domains, notes, store, saver }) {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const state = {
    /** 'all' mixes every domain into one stream; otherwise a domain id. */
    scope: domains.length > 1 ? 'all' : domains[0].id,
    /** @type {Record<string, {text: string|null, view: import('../core/mapfile.js').MapView}>} */
    maps: Object.fromEntries(domains.map((d) => [d.id, { text: null, view: readMap(null) }])),
    loading: true,
    tab: 'ask',
    /** Question keys put off in this sitting; they come back the same. */
    skipped: /** @type {string[]} */ ([]),
    /** @type {string|null} topic key */ focus: null,
    /** Work in progress on the card on screen (a rank order, taboo picks, open text). */
    draft: /** @type {{key: string, value: unknown}|null} */ (null),
    /** "Своє…": the owner's own sentence for the card on screen. */
    own: /** @type {{key: string, text: string}|null} */ (null),
    /** A quick round on a timer. */
    blitz: /** @type {{shown: number, plotted: {domain: string, id: string, line: string}[], done: boolean}|null} */ (null),
    fileDomain: domains[0].id,
    /** Unsaved edit on the "Файл" tab. */
    file: /** @type {{domain: string, base: string|null, text: string}|null} */ (null),
    /** `${domain}/${section title}` picked for an agent. */
    agentPick: /** @type {string[]} */ ([]),
    /** @type {{text: string, quote?: string, undo?: (() => void)|null, id: number}|null} */ toast: null,
    /** @type {string|null} */ error: null,
  };

  const listeners = new Set();
  const pending = new Map();
  let chain = Promise.resolve();
  let toastTimer = 0;

  const failure = (e) => e?.message ?? e?.code ?? String(e);
  const inScope = () => (state.scope === 'all' ? domains : [byId.get(state.scope)]);
  const maps = () => inScope().map((domain) => ({ domain, view: state.maps[domain.id].view }));
  const setText = (id, text) => {
    state.maps[id] = { text, view: readMap(text) };
  };
  const emit = () => {
    if (state.focus && !queue(maps()).some(({ domain, question }) => `${domain.id}/${question.topic}` === state.focus)) {
      state.focus = null;
    }
    listeners.forEach((fn) => fn(state));
  };

  async function start() {
    await Promise.all(domains.map(async (d) => {
      try {
        setText(d.id, await store.read(d.id));
      } catch (e) {
        state.error = `Мапа «${d.name}» не прочиталась: ${failure(e)}`;
      }
    }));
    state.loading = false;
    emit();
    for (const d of domains) {
      store.watch(d.id, (text) => {
        if (pending.get(d.id) || text === state.maps[d.id].text) return;
        setText(d.id, text);
        emit();
      });
    }
  }

  /**
   * @param {string} id  Domain id.
   * @param {Op} op
   * @param {{text: string, quote?: string}|null} toast  What to tell the person; offers undo.
   */
  function commit(id, op, toast, { undoable = true } = {}) {
    const domain = byId.get(id);
    const undo = inverse(state.maps[id].text, domain, op);
    setText(id, apply(state.maps[id].text, domain, op));
    state.error = null;
    if (toast) showToast({ ...toast, undo: undoable ? () => commit(id, undo, { text: 'Відмінено' }, { undoable: false }) : null });
    emit();

    pending.set(id, (pending.get(id) ?? 0) + 1);
    const run = chain.then(async () => {
      const latest = await store.read(id);
      const next = apply(latest, domain, op);
      if (next != null && next !== latest) await store.write(id, next);
      return next;
    });
    chain = run.then(
      (next) => {
        pending.set(id, pending.get(id) - 1);
        if (!pending.get(id) && next !== state.maps[id].text) {
          setText(id, next);
          emit();
        }
      },
      async (e) => {
        pending.set(id, pending.get(id) - 1);
        hideToast();
        state.error = `Не записалось: ${failure(e)}. На екрані те, що справді збережено.`;
        try {
          setText(id, await store.read(id));
        } catch {
          // keep what is on screen; the error says it may be off
        }
        emit();
      },
    );
    return run;
  }

  function showToast(toast) {
    clearTimeout(toastTimer);
    state.toast = { ...toast, id: Date.now() };
    toastTimer = setTimeout(hideToast, toast.undo ? 7000 : 3500);
    emit();
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (!state.toast) return;
    state.toast = null;
    emit();
  }

  /** One card is done with, whichever way: moves a blitz round along. */
  function leaveCard() {
    state.draft = null;
    state.own = null;
    if (!state.blitz) return;
    state.blitz.shown += 1;
    if (state.blitz.shown >= BLITZ_ROUND) state.blitz.done = true;
  }

  function record(domain, question, { line, source }) {
    leaveCard();
    state.blitz?.plotted.push({ domain: domain.id, id: question.id, line });
    return commit(
      domain.id,
      { type: 'answer', id: question.id, section: sectionFor(domain, question.id), line, on: today(), source },
      { text: source === 'own' ? 'Нанесено своє' : 'Нанесено', quote: line },
    );
  }

  const textOrBlank = (d) => (state.maps[d.id].text?.trim() ? state.maps[d.id].text : blankMap(d));

  return {
    state,
    domains,
    store,
    canExport: Boolean(saver),
    start,
    inScope,

    /** @param {(s: typeof state) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    setScope(scope) {
      state.scope = scope === 'all' || byId.has(scope) ? scope : state.scope;
      if (state.scope !== 'all') state.fileDomain = state.scope;
      Object.assign(state, { focus: null, draft: null, own: null, file: null, agentPick: [], blitz: null });
      emit();
    },

    /** Bank notes for the author, for the domains on screen. */
    bankNotes: () => notes.filter((n) => inScope().some((d) => d.id === n.domain)),

    /** @returns {{domain: Domain, question: Question}|null} */
    current() {
      const items = queue(maps(), { skipped: state.skipped, focus: state.focus });
      const pool = state.blitz ? items.filter(({ question }) => blitzable(question)) : items;
      return pool[0] ?? null;
    },

    /** Records what the owner did on a card: an option, an order, picks or text. */
    answer(domain, question, pick) {
      const result = lineFor(question, pick);
      return result ? record(domain, question, result) : null;
    },

    /** An answer in the owner's own words, on any card. */
    ownAnswer(domain, question, text) {
      const line = oneLine(text);
      return line ? record(domain, question, { line, source: 'own' }) : null;
    },

    /** "The question missed": a report on the question, not an answer. */
    dontKnow(domain, question) {
      leaveCard();
      return commit(
        domain.id,
        { type: 'mark', id: question.id, text: question.text, on: today() },
        { text: 'Позначено «не знаю». Питання повернеться, коли його перепишуть' },
      );
    },

    /** Not now: the question comes back the same, after the others. */
    later(domain, question) {
      const key = questionKey(domain, question);
      leaveCard();
      state.skipped = [...state.skipped.filter((k) => k !== key), key];
      emit();
    },

    erase: (id, questionId) => commit(id, { type: 'unanswer', id: questionId }, { text: 'Стерто. Питання повернеться' }),
    unmark: (id, questionId) => commit(id, { type: 'unmark', id: questionId }, { text: 'Позначку знято. Питання повернеться' }),

    draftFor: (key) => (state.draft?.key === key ? state.draft.value : undefined),
    /** Keeps work in progress on a card; never re-renders. */
    setDraft(key, value) {
      state.draft = { key, value };
    },

    openOwn(key) {
      state.own = { key, text: '' };
      emit();
    },
    closeOwn() {
      state.own = null;
      emit();
    },
    draftOwn(text) {
      if (state.own) state.own.text = text;
    },

    startBlitz() {
      Object.assign(state, { blitz: { shown: 0, plotted: [], done: false }, tab: 'ask', focus: null, draft: null, own: null });
      emit();
    },
    stopBlitz() {
      state.blitz = null;
      emit();
    },

    setTab(tab) {
      state.tab = tab;
      emit();
    },

    focusTopic(key) {
      state.focus = state.focus === key ? null : key;
      state.tab = 'ask';
      state.draft = null;
      state.own = null;
      emit();
    },

    setFileDomain(id) {
      if (!byId.has(id)) return;
      state.fileDomain = id;
      state.file = null;
      emit();
    },
    /** Starts or updates an edit of the raw file; never re-renders mid-typing. */
    draftFile(text) {
      const id = state.fileDomain;
      state.file = { domain: id, base: state.file?.domain === id ? state.file.base : state.maps[id].text, text };
    },
    saveFile() {
      if (!state.file) return null;
      const { domain, text } = state.file;
      state.file = null;
      return commit(domain, { type: 'replace', text }, { text: 'Файл збережено' });
    },
    dropFileDraft() {
      state.file = null;
      emit();
    },

    toggleAgent(key) {
      state.agentPick = state.agentPick.includes(key) ? state.agentPick.filter((k) => k !== key) : [...state.agentPick, key];
      emit();
    },
    agentContext() {
      const parts = inScope()
        .map((domain) => ({
          domain,
          text: state.maps[domain.id].text,
          wanted: state.agentPick.filter((k) => k.startsWith(`${domain.id}/`)).map((k) => k.slice(domain.id.length + 1)),
        }))
        .filter((p) => p.wanted.length);
      return parts.length ? contextBlock(parts) : '';
    },

    async exportFiles() {
      if (!saver) return;
      const list = inScope();
      const files = list.length > 1
        ? [
          ['worldview.md', `${list.map((d) => textOrBlank(d).trimEnd()).join('\n\n')}\n`],
          ['worldview.json', `${JSON.stringify({ domains: list.map((d) => toJSON(textOrBlank(d), d)) }, null, 2)}\n`],
        ]
        : [
          [`${list[0].id}.md`, textOrBlank(list[0])],
          [`${list[0].id}.json`, `${JSON.stringify(toJSON(textOrBlank(list[0]), list[0]), null, 2)}\n`],
        ];
      try {
        for (const [i, [name, data]] of files.entries()) {
          if (i) await new Promise((r) => setTimeout(r, 400));
          if (!(await saver(name, data))) {
            return showToast({ text: i ? `Збережено лише ${files[0][0]}` : 'Експорт скасовано' });
          }
        }
        showToast({ text: `Збережено ${files.map(([name]) => name).join(' і ')}` });
      } catch (e) {
        state.error = `Експорт не вдався: ${failure(e)}`;
        emit();
      }
      return undefined;
    },

    showToast,
    hideToast,
  };
}
