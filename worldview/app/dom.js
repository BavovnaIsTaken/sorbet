/**
 * h('p.lead.quiet', {onclick, 'aria-label': '…'}, 'text', child, [more])
 * Strings become text nodes, so bank and map text never reaches innerHTML.
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/** Re-renders `root` while keeping focus and caret on the element with the same id. */
export function replaceChildren(root, nodes) {
  const active = document.activeElement;
  const id = active && root.contains(active) ? active.id : '';
  const caret = id && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  root.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  if (!id) return;
  const again = document.getElementById(id);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (caret && 'setSelectionRange' in again) again.setSelectionRange(...caret);
}
