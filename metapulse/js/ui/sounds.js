/* 設定頁：自訂斷食開始／結束音效（選檔、試聽、移除）。檔案只存在這台裝置。 */
import { L } from '../state.js';
import { h, toast, tip } from './common.js';
import { SLOTS, saveSound, removeSound, hasSound, playSound } from '../sounds.js';

export function soundSettings() {
  const box = h('div');
  const draw = () => {
    box.textContent = '';
    for (const slot of Object.keys(SLOTS)) {
      const meta = (L.sounds || {})[slot];
      const file = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.wav,.ogg', style: { display: 'none' } });
      file.onchange = async () => {
        const f = file.files && file.files[0]; file.value = ''; if (!f) return;
        try { await saveSound(slot, f); toast('已設定' + SLOTS[slot] + '音效'); draw(); } catch (e) { toast(e.message || '設定失敗', true); }
      };
      const pick = h('button.ghost', { type: 'button', style: { padding: '8px 10px' }, onclick: () => file.click() }, meta ? '換檔案' : '選擇音效檔');
      const play = h('button.ghost', { type: 'button', style: { padding: '8px 10px' }, disabled: !hasSound(slot), onclick: () => playSound(slot) }, '試聽');
      const del = h('button.ghost', { type: 'button', style: { padding: '8px 10px' }, disabled: !meta, onclick: async () => { await removeSound(slot); toast('已改回內建聲音'); draw(); } }, '移除');
      box.append(h('div', { style: { marginTop: '10px' } },
        h('div.row.between', h('span.small', { style: { fontWeight: 650 } }, SLOTS[slot] + '音效'), h('span.mu.tiny.one', { style: { maxWidth: '60%' } }, meta ? meta.name : '內建聲音')),
        h('div.grid3', { style: { marginTop: '6px', gap: '6px' } }, pick, play, del), file));
    }
  };
  draw();
  return h('div', box, tip('可以換成你自己的音效檔（mp3、m4a 等，2 MB 以內）。檔案只存在這台裝置，不會上傳、也不會放進 Google Drive 備份；Chrome 和 MetaPulse app 要各選一次。沒有設定時用內建聲音。特效會等音效播完才接下一段。'));
}
