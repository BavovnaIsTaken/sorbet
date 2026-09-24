import { loadBank } from '../core/bank.js';
import { pickStore, pickSaver } from './stores.js';
import { createController } from './controller.js';
import { mount } from './render.js';

document.documentElement.lang = 'uk';

const readJSON = async (path) => {
  const res = await fetch(`bank/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`bank/${path}: ${res.status}`);
  return res.json();
};

try {
  const [{ domains, notes }, store, saver] = await Promise.all([loadBank(readJSON), pickStore(), pickSaver()]);
  if (!domains.length) throw new Error('у bank/index.json не названо жодної сфери');
  const ctl = createController({ domains, notes, store, saver });
  try {
    const remembered = localStorage.getItem('worldview:scope');
    if (remembered) ctl.state.scope = remembered === 'all' || domains.some((d) => d.id === remembered) ? remembered : ctl.state.scope;
    if (ctl.state.scope !== 'all') ctl.state.fileDomain = ctl.state.scope;
  } catch {
    // no storage: start mixed
  }
  mount(document.getElementById('app'), ctl);
  await ctl.start();
} catch (e) {
  const error = document.getElementById('error');
  error.textContent = `Мапа не відкрилась: ${e?.message ?? e}`;
  error.hidden = false;
  document.getElementById('view').replaceChildren();
}
