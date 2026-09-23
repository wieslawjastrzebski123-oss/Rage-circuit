/** Minimal DOM helpers for the HTML overlay UI (menus + HUD). */

export function uiRoot(): HTMLElement {
  return document.getElementById('ui')!;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

/** Creates a full-screen layer inside #ui and returns it. */
export function layer(cls: string): HTMLElement {
  return h('div', `layer ${cls}`, undefined, uiRoot());
}

export function button(label: string, parent: HTMLElement, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', `btn ${cls}`, label, parent);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

export function setCrosshair(visible: boolean): void {
  const c = document.getElementById('crosshair');
  if (c) c.classList.toggle('hidden', !visible);
  document.body.classList.toggle('in-race', visible);
}
