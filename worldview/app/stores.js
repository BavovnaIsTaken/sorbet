/**
 * Where map files live. The file text is the whole state, so a store keeps
 * one text blob per domain and knows nothing about its format.
 *
 * @typedef {Object} Store
 * @property {'claude'|'server'|'browser'} kind
 * @property {(domain: string) => Promise<string|null>} read
 *   Latest text of the domain's map file; null when there is none yet.
 * @property {(domain: string, text: string) => Promise<void>} write
 *   Replaces the file. The caller serialises writes and always writes on
 *   top of a fresh read, so a hand edit or another device is never clobbered.
 * @property {(domain: string, onText: (text: string|null) => void) => () => void} watch
 *   Reports changes made elsewhere: another device, another tab, a hand
 *   edit on disk. Returns an unsubscribe function.
 *
 * @typedef {(filename: string, data: string) => Promise<boolean>} Saver
 *   Offers a file to the person; false when they decline.
 */

/**
 * Picks the most durable store this page can reach: the claude.ai page's own
 * storage, the local server's files, or, as a last resort, this browser.
 * @returns {Promise<Store>}
 */
export async function pickStore() {
  const claude = globalThis.claude;
  if (claude?.use) {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    const uid = db && user ? await user.id() : null;
    if (db && uid) return claudeStore(db, uid);
  }
  if (await hasServer()) return serverStore();
  return browserStore();
}

/** @returns {Promise<Saver|null>} null when this page cannot hand out files. */
export async function pickSaver() {
  const claude = globalThis.claude;
  if (claude?.use) {
    const downloads = await claude.use('downloads');
    if (!downloads) return null;
    return async (filename, data) => {
      try {
        await downloads.save({ filename, data });
        return true;
      } catch (e) {
        if (e?.code === 'declined') return false;
        throw e;
      }
    };
  }
  return async (filename, data) => {
    const type = filename.endsWith('.json') ? 'application/json' : 'text/markdown';
    const url = URL.createObjectURL(new Blob([data], { type: `${type};charset=utf-8` }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  };
}

/**
 * The page's storage on claude.ai. Each viewer's map sits in their own
 * private subtree, so a shared link never mixes two people's maps.
 * @returns {Store}
 */
export function claudeStore(db, uid) {
  const doc = (domain) => db.doc(`data/users/${uid}/map_${domain}`);
  const textOf = (snap) => (snap.exists ? String(snap.data()?.text ?? '') : null);
  return {
    kind: 'claude',
    read: (domain) => retry(() => doc(domain).get()).then(textOf),
    write: (domain, text) => retry(() => doc(domain).set({ text })),
    watch: (domain, onText) => doc(domain).onSnapshot(
      (snap) => onText(textOf(snap)),
      (e) => console.warn('map: live updates stopped', e?.code),
    ),
  };
}

/**
 * The local server (server.js): map/<domain>.md on disk. Picks up hand
 * edits whenever the page comes back into view, and every few seconds
 * while it is visible.
 * @returns {Store}
 */
export function serverStore(base = 'api/map/') {
  const read = async (domain) => {
    const res = await fetch(base + domain, { cache: 'no-store' });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`сервер відповів ${res.status}`);
    return res.text();
  };
  return {
    kind: 'server',
    read,
    async write(domain, text) {
      const res = await fetch(base + domain, {
        method: 'PUT',
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
        body: text,
      });
      if (!res.ok) throw new Error(`сервер відповів ${res.status}`);
    },
    watch(domain, onText) {
      const check = () => {
        if (document.visibilityState === 'visible') read(domain).then(onText, () => {});
      };
      const timer = setInterval(check, 5000);
      document.addEventListener('visibilitychange', check);
      window.addEventListener('focus', check);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', check);
        window.removeEventListener('focus', check);
      };
    },
  };
}

/**
 * This browser only. One copy is no copy: the page says so and asks for an export.
 * @returns {Store}
 */
export function browserStore(prefix = 'worldview:map:') {
  return {
    kind: 'browser',
    async read(domain) {
      try {
        return localStorage.getItem(prefix + domain);
      } catch {
        return null;
      }
    },
    async write(domain, text) {
      localStorage.setItem(prefix + domain, text);
    },
    watch(domain, onText) {
      const onStorage = (e) => {
        if (e.key === prefix + domain) onText(e.newValue);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

async function hasServer() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    return res.ok && (await res.json())?.app === 'worldview';
  } catch {
    return false;
  }
}

async function retry(call) {
  try {
    return await call();
  } catch (e) {
    if (e?.code !== 'unavailable') throw e;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
    return call();
  }
}
