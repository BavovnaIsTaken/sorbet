/**
 * The one screen: three tabs over the same files. "Питання" asks, "Відповіді"
 * shows the maps rendered, "Файл" shows one raw. Only the part of the page
 * whose inputs changed is rebuilt, so a toast never resets what is typed.
 */

import { h, replaceChildren } from './dom.js';
import { legend, markState, questionKey, topicKey } from '../core/queue.js';
import { contextSections } from '../core/export.js';
import { sameText } from '../core/mapfile.js';
import { CARD_VIEWS } from './cards.js';
import { BLITZ_KINDS, BLITZ_ROUND, BLITZ_SECONDS } from './controller.js';

const STORE = {
  claude: { label: 'claude.ai', title: 'Мапа лежить у сховищі цієї сторінки на claude.ai. Твою бачиш лише ти.' },
  server: { label: 'диск', title: 'Мапа лежить у файлах на диску: map/<сфера>.md і .json.' },
  browser: { label: 'цей браузер', title: 'Мапа лежить лише в цьому браузері.' },
};

const MARK_STATE = {
  waiting: 'питання чекає, поки його перепишуть',
  rewritten: 'банк уже питає інакше, і питання знову в черзі',
  gone: 'питання знято з банку, лишився запис',
};

const AUTHOR = { claude: 'Claude' };

/** @param {HTMLElement} root @param {ReturnType<import('./controller.js').createController>} ctl */
export function mount(root, ctl) {
  const $ = (sel) => root.querySelector(sel);
  const els = {
    domain: $('#domain-slot'),
    store: $('#store'),
    tabs: [...root.querySelectorAll('[data-tab]')],
    banner: $('#banner'),
    error: $('#error'),
    main: $('#view'),
    toast: document.getElementById('toast'),
  };
  const many = ctl.domains.length > 1;
  let mainKey = '';
  let lastCard = null;
  let disposers = [];
  const onDispose = (fn) => disposers.push(fn);

  const hueOf = (domain, topicId) => {
    const i = domain.topics.findIndex((t) => t.id === topicId);
    return i < 0 ? null : `--hue: var(--t${i % 8})`;
  };
  const mixed = (s) => many && s.scope === 'all';

  for (const tab of els.tabs) tab.addEventListener('click', () => ctl.setTab(tab.dataset.tab));

  document.addEventListener('keydown', (e) => {
    if (ctl.state.tab !== 'ask' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, canvas, [contenteditable]')) return;
    const target = els.main.querySelector(`.card [data-key="${e.key}"]`);
    if (target) {
      e.preventDefault();
      target.click();
    }
  });

  function render(s) {
    renderHeader(s);
    const key = JSON.stringify([
      s.tab, s.scope, s.loading, s.skipped, s.focus, s.agentPick, s.fileDomain, Boolean(s.file),
      s.own?.key, s.draft?.key, s.blitz && [s.blitz.shown, s.blitz.done],
      ctl.inScope().map((d) => s.maps[d.id].text),
    ]);
    if (key !== mainKey) {
      mainKey = key;
      disposers.forEach((fn) => fn());
      disposers = [];
      els.main.setAttribute('aria-labelledby', `tab-${s.tab}`);
      replaceChildren(els.main, s.loading ? [h('p.status', null, 'Розгортаю мапу…')] : VIEWS[s.tab](s));
    }
    renderToast(s);
  }

  function renderHeader(s) {
    for (const tab of els.tabs) tab.setAttribute('aria-selected', String(tab.dataset.tab === s.tab));
    const store = STORE[ctl.store.kind];
    els.store.hidden = false;
    els.store.textContent = store.label;
    els.store.title = store.title;
    els.store.classList.toggle('is-browser', ctl.store.kind === 'browser');
    els.banner.hidden = ctl.store.kind !== 'browser';
    els.error.hidden = !s.error;
    els.error.textContent = s.error ?? '';
    if (els.domain.firstElementChild?.dataset.scope === s.scope) return;
    const node = many
      ? h('select.domain-select', {
        'aria-label': 'Сфера',
        onchange: (e) => {
          try {
            localStorage.setItem('worldview:scope', e.target.value);
          } catch {
            // a remembered choice is a convenience
          }
          ctl.setScope(e.target.value);
        },
      },
      h('option', { value: 'all', selected: s.scope === 'all' }, 'Усе впереміш'),
      ctl.domains.map((d) => h('option', { value: d.id, selected: d.id === s.scope }, d.name)))
      : h('span.domain-name', null, ctl.domains[0].name);
    node.dataset.scope = s.scope;
    els.domain.replaceChildren(node);
  }

  function renderToast(s) {
    const t = s.toast;
    if (!t) {
      els.toast.hidden = true;
      delete els.toast.dataset.id;
      return;
    }
    if (els.toast.dataset.id === String(t.id)) return;
    els.toast.dataset.id = String(t.id);
    els.toast.replaceChildren(...[
      h('p.toast-text', null, h('span', null, t.text), t.quote ? h('span.toast-quote', null, `«${t.quote}»`) : null),
      t.undo ? h('button.toast-undo', { type: 'button', onclick: () => { ctl.hideToast(); t.undo(); } }, 'Відмінити') : null,
    ].filter(Boolean));
    els.toast.hidden = false;
  }

  // ---- Питання ----

  function askView(s) {
    const next = ctl.current();
    if (s.blitz && (s.blitz.done || !next)) return [blitzSummary(s)];
    const eligible = !s.blitz && countBlitzable(s) >= 3;
    return [
      next ? card(s, next.domain, next.question) : done(s),
      eligible ? blitzInvite() : null,
      s.blitz ? null : legendView(s),
    ];
  }

  function card(s, domain, q) {
    const key = questionKey(domain, q);
    const topic = domain.topics.find((t) => t.id === q.topic);
    const fresh = key !== lastCard;
    lastCard = key;
    const ctx = {
      q,
      key,
      pick: (pick) => ctl.answer(domain, q, pick),
      draft: () => ctl.draftFor(key),
      setDraft: (value) => ctl.setDraft(key, value),
      onDispose,
    };
    const owning = s.own?.key === key;
    const region = [mixed(s) ? `${domain.name} · ` : '', topic?.title ?? q.topic];
    const counter = s.blitz ? h('span.round', null, `${s.blitz.shown + 1} з ${BLITZ_ROUND}`) : null;
    if (s.blitz) {
      const timer = setTimeout(() => ctl.later(domain, q), BLITZ_SECONDS * 1000);
      onDispose(() => clearTimeout(timer));
    }
    return h(`section.card${fresh ? '.is-new' : ''}${s.blitz ? '.is-blitz' : ''}`, { style: hueOf(domain, q.topic), 'aria-labelledby': 'question' },
      s.blitz ? h('div.timer', { style: `--seconds: ${BLITZ_SECONDS}s`, 'aria-hidden': 'true' }) : null,
      h('p.region', null, h('span.swatch', { 'aria-hidden': 'true' }), h('span', null, region), counter),
      q.setup ? h('p.setup', null, q.setup) : null,
      h('h2.question', { id: 'question' }, q.text),
      (CARD_VIEWS[q.kind] ?? CARD_VIEWS.choice)(ctx),
      owning ? ownForm(s, domain, q) : h('div.aside', null,
        h('button.quiet', { type: 'button', title: 'Питання не влучило: його треба переписати', onclick: () => ctl.dontKnow(domain, q) }, 'Не знаю'),
        h('button.quiet', { type: 'button', title: 'Не зараз: питання повернеться таким самим', onclick: () => ctl.later(domain, q) }, s.blitz ? 'Далі' : 'Пізніше'),
        q.kind === 'open' || s.blitz ? null
          : h('button.quiet', { type: 'button', title: 'Написати позицію своїми словами', onclick: () => ctl.openOwn(key) }, 'Своє…')),
      h('p.qid', null, q.id, q.author ? h('span.author', null, ` · питання від ${AUTHOR[q.author] ?? q.author}`) : null),
    );
  }

  function ownForm(s, domain, q) {
    const submit = () => ctl.ownAnswer(domain, q, s.own?.text ?? '');
    const text = h('textarea.own-text', {
      id: 'own-text',
      rows: 3,
      placeholder: 'Одне речення, зрозуміле без питання перед очима',
      value: s.own?.text ?? '',
      oninput: (e) => ctl.draftOwn(e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape') ctl.closeOwn();
      },
    });
    requestAnimationFrame(() => {
      if (text.isConnected && document.activeElement !== text) text.focus({ preventScroll: true });
    });
    return h('form.own', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('label.own-label', { for: 'own-text' }, 'Своїми словами'),
      text,
      h('div.card-actions', null,
        h('button.primary', { type: 'button', onclick: submit }, 'Нанести на мапу'),
        h('button.quiet', { type: 'button', onclick: () => ctl.closeOwn() }, 'Скасувати')));
  }

  function done(s) {
    lastCard = null;
    const scope = ctl.inScope();
    const waiting = scope.reduce((n, d) => n + [...s.maps[d.id].view.marks.values()].filter((m) => markState(m, d) === 'waiting').length, 0);
    const empty = scope.every((d) => d.questions.length === 0);
    const files = scope.map((d) => `bank/${d.id}.json`).join(', ');
    return h('section.card', null,
      h('p.region', null, h('span.swatch', { 'aria-hidden': 'true' }), empty ? 'Банк порожній' : 'Усе нанесено'),
      h('h2.question', null, empty ? 'Питань поки нема.' : 'На кожне питання з банку вже є позиція.'),
      h('p.hint', null, 'Нові питання дописуються в ', h('code', null, files),
        '. Два–чотири варіанти; у кожного — рядок, що читається без питання.'),
      waiting ? h('p.hint', null, `Позначок «не знаю», які чекають переписаного питання: ${waiting}. Вони внизу «Відповідей».`) : null);
  }

  function countBlitzable(s) {
    return ctl.inScope().reduce((n, d) => n + d.questions.filter((q) => BLITZ_KINDS.includes(q.kind)
      && !s.maps[d.id].view.answers.has(q.id) && !s.maps[d.id].view.marks.has(q.id)).length, 0);
  }

  function blitzInvite() {
    return h('section.blitz-invite', null,
      h('div', null,
        h('h3.panel-title', null, 'Бліц'),
        h('p.panel-text', null, `${BLITZ_ROUND} коротких питань, ${BLITZ_SECONDS} секунд на кожне. Відповідай з першого відчуття; не встиг — питання повернеться пізніше.`)),
      h('button.primary', { type: 'button', onclick: () => ctl.startBlitz() }, 'Почати бліц'));
  }

  function blitzSummary(s) {
    lastCard = null;
    const kept = s.blitz.plotted.filter((p) => s.maps[p.domain].view.answers.get(p.id)?.text === p.line);
    const domainOf = (id) => ctl.domains.find((d) => d.id === id);
    return h('section.card.blitz-summary', null,
      h('p.region', null, h('span.swatch', { 'aria-hidden': 'true' }), 'Бліц завершено'),
      h('h2.question', null, kept.length ? 'Ось що лягло на мапу за раунд' : 'За цей раунд на мапі нічого не з’явилось'),
      kept.length ? h('p.hint', null, 'Перечитай тверезим оком. Що сказалось поспіхом — зітри, і питання повернеться.') : null,
      h('ul.lines', null, kept.map((p) => h('li.line', null,
        h('span.md', { 'aria-hidden': 'true' }, '-'),
        h('div.line-body', null, h('span.line-text', null, p.line), mixed(s) ? h('span.service', null, domainOf(p.domain)?.name ?? p.domain) : null),
        h('button.erase', { type: 'button', title: 'Стерти: питання повернеться', 'aria-label': `Стерти «${p.line}»`, onclick: () => ctl.erase(p.domain, p.id) }, '×')))),
      h('div.card-actions', null,
        h('button.primary', { type: 'button', onclick: () => ctl.startBlitz() }, 'Ще раунд'),
        h('button.quiet', { type: 'button', onclick: () => ctl.stopBlitz() }, 'Повернутися до звичайних питань')));
  }

  function legendView(s) {
    const groups = ctl.inScope().map((d) => ({ domain: d, rows: legend(d, s.maps[d.id].view) })).filter((g) => g.rows.length);
    if (!groups.length) return null;
    const said = (cells) => {
      const n = (st) => cells.filter((c) => c.status === st).length;
      return `є позиція: ${n('answered')}, відкритих: ${n('open')}, «не знаю»: ${n('unknown')}`;
    };
    return h('section.legend', { 'aria-labelledby': 'legend-title' },
      h('h3.legend-title', { id: 'legend-title' }, 'Легенда'),
      groups.map(({ domain, rows }) => [
        mixed(s) ? h('p.legend-domain', null, domain.name) : null,
        h('ul.legend-rows', null, rows.map(({ topic, cells }) => h('li', null,
          h('button.legend-row', {
            type: 'button',
            style: hueOf(domain, topic.id),
            'aria-pressed': String(s.focus === topicKey(domain, topic.id)),
            title: 'Питати спершу з цієї теми',
            onclick: () => ctl.focusTopic(topicKey(domain, topic.id)),
          },
          h('span.swatch', { 'aria-hidden': 'true' }),
          h('span.legend-name', null, topic.title),
          h('span.dots', { role: 'img', 'aria-label': said(cells) }, cells.map((c) => h(`i.dot.is-${c.status}`))))))),
      ]),
      h('p.legend-key', { 'aria-hidden': 'true' },
        h('span', null, h('i.dot.is-answered'), 'є позиція'),
        h('span', null, h('i.dot.is-open'), 'відкрите'),
        h('span', null, h('i.dot.is-unknown'), 'не знаю')),
      h('p.legend-hint', null, 'Торкнись теми, щоб питати спершу з неї.'));
  }

  // ---- Відповіді ----

  function mapView(s) {
    return [
      ctl.inScope().map((d) => mapArticle(s, d)),
      agentPanel(s),
      exportPanel(s),
      notesPanel(),
    ];
  }

  function mapArticle(s, domain) {
    const v = s.maps[domain.id].view;
    const filled = v.lead.length > 0 || v.sections.some((sec) => sec.items.length > 0);
    return h('article.mapview', null,
      h('h2.map-title', null, h('span.md', { 'aria-hidden': 'true' }, '# '), v.title ?? domain.title),
      v.preamble.length ? h('p.preamble', null, v.preamble.join(' ')) : null,
      v.lead.length ? h('ul.lines', null, v.lead.map((item) => lineView(domain, item))) : null,
      v.sections.map((sec) => sectionView(domain, sec)),
      filled ? null : h('p.empty', null, 'Ще порожньо. Кожна відповідь ляже сюди рядком, який читається без питання.'));
  }

  function sectionView(domain, sec) {
    const topic = domain.topics.find((t) => sameText(t.title, sec.title));
    return h(`section.map-section${sec.dontKnow ? '.is-unknown' : ''}`, { style: topic ? hueOf(domain, topic.id) : null },
      h('h3.map-head', null,
        h('span.md', { 'aria-hidden': 'true' }, '##'),
        sec.dontKnow ? null : h('span.swatch', { 'aria-hidden': 'true' }),
        sec.title),
      sec.dontKnow && sec.items.length ? h('p.section-hint', null, 'Формулювання, на яких питання не влучили. Це знімок того, що питали того дня, а не те, що банк питає зараз.') : null,
      h('ul.lines', null, sec.items.map((item) => lineView(domain, item))));
  }

  function lineView(domain, item) {
    const bullet = h('span.md', { 'aria-hidden': 'true' }, '-');
    if (item.kind === 'note') {
      return h('li.line.is-note', null, bullet,
        h('div.line-body', null, h('span.line-text', null, item.text), h('span.service', null, 'рукою, без службових полів')));
    }
    const e = item.entry;
    const service = e.on ? h('span.service', null, `[${[e.on, e.id, e.source === 'own' ? 'своє' : null].filter(Boolean).join(', ')}]`) : null;
    if (item.kind === 'answer') {
      return h('li.line', null, bullet,
        h('div.line-body', null, h('span.line-text', null, e.text), service),
        h('button.erase', { type: 'button', title: 'Стерти: питання повернеться', 'aria-label': `Стерти «${e.text}»`, onclick: () => ctl.erase(domain.id, e.id) }, '×'));
    }
    const st = markState(e, domain);
    return h(`li.line.is-mark.is-${st}`, null, bullet,
      h('div.line-body', null,
        h('span.line-text', null, e.text ? `«${e.text}»` : e.id),
        service ?? h('span.service', null, e.id),
        h('span.mark-state', null, MARK_STATE[st])),
      h('button.erase', { type: 'button', title: 'Зняти позначку: питання повернеться', 'aria-label': `Зняти позначку з ${e.id}`, onclick: () => ctl.unmark(domain.id, e.id) }, '×'));
  }

  function agentPanel(s) {
    const groups = ctl.inScope()
      .map((d) => ({ domain: d, sections: contextSections(s.maps[d.id].text, d) }))
      .filter((g) => g.sections.length);
    if (!groups.length) return null;
    const keyOf = (d, title) => `${d.id}/${title}`;
    const text = ctl.agentContext();
    const picked = s.agentPick.length > 0 && text !== '';
    const preview = h('pre.preview', { tabindex: '0' }, text);
    const box = h('details.preview-box', null, h('summary', null, 'Що саме піде агентові'), preview);
    const copy = () => {
      navigator.clipboard.writeText(text).then(
        () => ctl.showToast({ text: 'Скопійовано для агента' }),
        () => {
          box.open = true;
          window.getSelection()?.selectAllChildren(preview);
          ctl.showToast({ text: 'Текст виділено: скопіюй його вручну' });
        },
      );
    };
    return h('section.panel', { 'aria-labelledby': 'agent-title' },
      h('h3.panel-title', { id: 'agent-title' }, 'Для агента'),
      h('p.panel-text', null, 'Лише теми, яких торкається задача, ніколи вся мапа. Блок підписаний: звідки він, яка в нього влада і що його б’є. Клади його в саму задачу, а не в системний промпт.'),
      groups.map(({ domain, sections }) => [
        mixed(s) ? h('p.legend-domain', null, domain.name) : null,
        h('div.chips', { role: 'group', 'aria-label': `Теми: ${domain.name}` }, sections.map((sec) => h('button.chip', {
          type: 'button',
          'aria-pressed': String(s.agentPick.includes(keyOf(domain, sec.title))),
          onclick: () => ctl.toggleAgent(keyOf(domain, sec.title)),
        }, sec.title, h('span.chip-count', { 'aria-label': `рядків: ${sec.lines}` }, String(sec.lines))))),
      ]),
      h('div.panel-actions', null,
        h('button.primary', { type: 'button', disabled: !picked, onclick: copy }, 'Скопіювати'),
        picked ? box : null));
  }

  function exportPanel(s) {
    const scope = ctl.inScope();
    const lead = scope.length > 1
      ? 'Усі сфери одним рухом: worldview.md, щоб читати, і worldview.json для програм.'
      : `Дві форми одним рухом: ${scope[0].id}.md, щоб читати, і ${scope[0].id}.json для програм.`;
    const disk = ctl.store.kind === 'server' ? ' Файли кожної сфери вже лежать на диску в map/.' : '';
    return h('section.panel', { 'aria-labelledby': 'export-title' },
      h('h3.panel-title', { id: 'export-title' }, 'Експорт'),
      ctl.canExport
        ? [h('p.panel-text', null, lead + disk),
          h('div.panel-actions', null, h('button.primary', { type: 'button', onclick: () => ctl.exportFiles() }, 'Зберегти .md і .json'))]
        : h('p.panel-text', null, 'Ця сторінка не може віддати файл. Увесь текст мапи є на вкладці «Файл», звідти його можна скопіювати.'));
  }

  function notesPanel() {
    const notes = ctl.bankNotes();
    if (!notes.length) return null;
    return h('details.panel.notes', null,
      h('summary', null, `Зауваги до банку питань: ${notes.length}`),
      h('ul.note-list', null, notes.map((n) => h('li', null,
        many ? h('span.service', null, `${ctl.domains.find((d) => d.id === n.domain)?.name ?? n.domain} · `) : null,
        n.text))));
  }

  // ---- Файл ----

  function fileView(s) {
    const id = s.fileDomain;
    const domain = ctl.domains.find((d) => d.id === id);
    const text = s.maps[id].text;
    const where = {
      claude: 'Лежить у сховищі цієї сторінки на claude.ai. Твою мапу бачиш лише ти.',
      server: `Лежить на диску як map/${id}.md. Правки, зроблені у файлі, з’являються тут самі.`,
      browser: 'Лежить лише в цьому браузері.',
    }[ctl.store.kind];
    const dirty = s.file?.domain === id;
    const save = h('button.primary', { type: 'button', disabled: !dirty, onclick: () => ctl.saveFile() }, 'Зберегти');
    const revert = h('button.quiet', { type: 'button', disabled: !dirty, onclick: () => ctl.dropFileDraft() }, 'Скасувати правки');
    const edited = (value) => {
      ctl.draftFile(value);
      save.disabled = false;
      revert.disabled = false;
    };
    const area = h('textarea.file-text', {
      id: 'file-text',
      spellcheck: 'false',
      autocapitalize: 'off',
      'aria-label': `Файл ${id}.md`,
      value: dirty ? s.file.text : text ?? '',
      oninput: (e) => edited(e.target.value),
    });
    const picker = h('input.visually-hidden', {
      id: 'file-open',
      type: 'file',
      accept: '.md,.markdown,.txt,text/markdown,text/plain',
      onchange: async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        area.value = await file.text();
        edited(area.value);
      },
    });
    const copy = () => {
      navigator.clipboard.writeText(area.value).then(
        () => ctl.showToast({ text: 'Файл скопійовано' }),
        () => {
          area.select();
          ctl.showToast({ text: 'Текст виділено: скопіюй його вручну' });
        },
      );
    };
    const files = ctl.inScope();
    return [h('section.file', null,
      files.length > 1 ? h('div.variants.file-tabs', { role: 'tablist', 'aria-label': 'Файли' }, files.map((d) => h('button.variant', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(d.id === id),
        onclick: () => ctl.setFileDomain(d.id),
      }, `${d.id}.md`))) : null,
      h('p.file-lead', null, `Це і є мапа «${domain.name}», той самий текст, що йде в .md. Рядки, яких програма не розуміє, лишаються на своїх місцях.`),
      h('p.file-where', null, where),
      dirty && s.file.base !== text
        ? h('p.stale', null, 'Поки ти редагував, мапа змінилась. «Зберегти» замінить ці зміни твоїм текстом.')
        : null,
      area,
      h('div.file-actions', null,
        save,
        revert,
        h('button.quiet', { type: 'button', onclick: copy }, 'Копіювати'),
        h('label.quiet.file-open', { for: 'file-open' }, 'Відкрити .md…'),
        picker))];
  }

  const VIEWS = { ask: askView, map: mapView, file: fileView };

  ctl.subscribe(render);
  render(ctl.state);
}
