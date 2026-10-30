import { ACTIONS, Input, keyName } from '../input/input';
import { sfx } from '../audio';
import { h } from './dom';

export const prefs = {
  get shake() { return localStorage.getItem('dep.shake') !== '0'; },
  set shake(v: boolean) { try { localStorage.setItem('dep.shake', v ? '1' : '0'); } catch { /* bỏ qua */ } },
};

/** Bảng phím (vẽ bằng hình phím). editable = bấm vào phím để đổi. */
export function keysTable(input: Input, editable: boolean, onChange?: () => void): HTMLElement {
  const table = h('table', { class: 'keys' });
  const render = () => {
    table.replaceChildren(
      ...ACTIONS.map((a) => {
        const keys = input.binds[a.id];
        const cells = [0, 1, 2].slice(0, editable ? Math.max(keys.length + 1, 2) : keys.length).map((i) => {
          const code = keys[i];
          if (!editable) return h('kbd', null, keyName(code));
          return h('kbd', {
            style: 'cursor:pointer' + (code ? '' : ';opacity:.45'),
            title: 'Bấm để đổi phím',
            onclick: (e: Event) => {
              const el = e.currentTarget as HTMLElement;
              el.textContent = '…';
              input.capture((c) => {
                if (c) input.setBind(a.id, i, c);
                render();
                onChange?.();
              });
            },
          }, code ? keyName(code) : '+');
        });
        return h('tr', null, h('td', null, a.label), h('td', null, ...cells));
      }),
    );
  };
  render();
  return table;
}

export function helpModal(input: Input, onClose?: () => void) {
  const close = () => { modal.remove(); onClose?.(); };
  const shake = h('input', { type: 'checkbox', checked: prefs.shake, onchange: (e: Event) => prefs.shake = (e.target as HTMLInputElement).checked });
  const mute = h('input', { type: 'checkbox', checked: sfx.muted, onchange: (e: Event) => sfx.setMuted((e.target as HTMLInputElement).checked) });
  let table = keysTable(input, true);
  const box = h('div', { class: 'card narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cài đặt & phím tắt' },
    h('h2', null, 'Cài đặt & phím tắt'),
    h('p', { class: 'sub' }, 'Mỗi người 2 chiếc dép. Giữ nút ném để gồng. Thả nút sẽ lấy đà một nhịp rồi mới ra dép, khóa hướng ném; gồng càng mạnh, hồi càng lâu. Giữ khoảng cách để canh né, nhảy hoặc lăn để đổi bên. Bắt đúng lúc dép bay tới để cướp dép. Dép rơi dưới đất phải đứng gần và bấm Nhặt (cúi mất một nhịp). Lăn né có i-frame: né sát dép thì hồi chiêu gần như ngay. Trúng 3 lần là gục.'),
    table,
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'small', onclick: () => { input.reset(); const next = keysTable(input, true); table.replaceWith(next); table = next; } }, 'Phím mặc định'),
      h('label', null, shake, ' Rung màn hình'),
      h('label', null, mute, ' Tắt tiếng'),
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: close }, 'Đóng'),
    ),
    h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:0' }, 'Bấm vào ô phím để đổi (Esc để hủy). F3: bảng thông số mạng.'),
  );
  const modal = h('div', { class: 'modal', onclick: (e: Event) => e.target === modal && close() }, box);
  document.body.append(modal);
}
