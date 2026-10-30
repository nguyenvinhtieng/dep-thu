type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** Tạo phần tử DOM gọn: h('button', { class: 'primary', onclick }, 'Chơi'). Text luôn qua textContent (không innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function mount(root: HTMLElement, ...kids: Child[]) {
  root.replaceChildren();
  for (const c of kids) if (c !== null && c !== undefined && c !== false) root.append(c instanceof Node ? c : String(c));
}

let toastTimer = 0;
export function toast(text: string, ms = 2600) {
  let el = document.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = h('div', { class: 'toast' });
    document.body.append(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.style.display = 'none', ms);
}

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
