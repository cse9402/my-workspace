/* 블록 편집기 (Vanilla JS). 블록 = { id, type, text, ... }
   글 블록: p(본문) h2(제목) h3(소제목) ul(글머리표) ol(번호 목록) todo(체크박스) quote(인용) code(코드)
   그 외: table(표: rows) toggle(접기/펼치기: text, body, open) link(링크: text, url) hr(구분선) */
(function () {
  const MW = (window.MW = window.MW || {});
  const TYPES = [['p', '본문'], ['h2', '제목'], ['h3', '소제목'], ['ul', '글머리표'], ['ol', '번호 목록'], ['todo', '체크박스'], ['quote', '인용'], ['code', '코드'], ['table', '표'], ['toggle', '접기/펼치기'], ['link', '링크'], ['hr', '구분선']];
  const NAME = Object.fromEntries(TYPES);
  const TEXT = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'code']);
  const LISTY = new Set(['ul', 'ol', 'todo']);
  const PH = { p: '내용을 입력하세요', h2: '제목', h3: '소제목', ul: '목록', ol: '목록', todo: '할 일', quote: '인용', code: '코드' };
  const SHORT = { '#': 'h2', '##': 'h3', '-': 'ul', '*': 'ul', '1.': 'ol', '[]': 'todo', '>': 'quote' };
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'b' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function make(type, init) {
    const b = Object.assign({ id: uid(), type, text: '' }, init || {});
    if (type === 'todo') b.checked = !!b.checked;
    if (type === 'table' && !Array.isArray(b.rows)) b.rows = [['', ''], ['', '']];
    if (type === 'toggle') { b.open = b.open !== false; b.body = b.body || ''; }
    if (type === 'link') b.url = b.url || '';
    return b;
  }
  const blocksText = blocks => (blocks || []).map(b => b.type === 'table' ? (b.rows || []).map(r => r.join(' ')).join('\n') : [b.text, b.body, b.url].filter(Boolean).join('\n')).filter(Boolean).join('\n');
  const txt = el => { const t = el.textContent.replace(/ /g, ' '); return t === '\n' ? '' : t; };
  const okUrl = u => /^https?:\/\//i.test(u || '');
  function caret(el) {
    const s = window.getSelection();
    if (!s.rangeCount || !el.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0), pre = document.createRange();
    pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
    return { start: pre.toString().length, collapsed: r.collapsed };
  }
  function setCaret(el, off) {
    el.focus();
    const s = window.getSelection(), r = document.createRange(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, left = off;
    while ((n = w.nextNode())) { if (left <= n.length) { r.setStart(n, left); r.collapse(true); s.removeAllRanges(); s.addRange(r); return; } left -= n.length; }
    r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r);
  }
  document.addEventListener('click', e => { if (!e.target.closest('.eb-menu') && !e.target.closest('.eb-h')) document.querySelectorAll('.eb-menu').forEach(m => m.remove()); });

  /* root: 편집기를 넣을 요소, doc.blocks를 직접 고칩니다. 바뀔 때마다 onChange() 호출 */
  function mount(root, doc, onChange) {
    if (!Array.isArray(doc.blocks) || !doc.blocks.length) doc.blocks = [make('p')];
    const ADD = [['p', '＋ 본문'], ['h2', '제목'], ['h3', '소제목'], ['ul', '• 목록'], ['ol', '1. 번호'], ['todo', '☑ 체크'], ['table', '표'], ['toggle', '▸ 접기'], ['link', '🔗 링크'], ['quote', '인용'], ['code', '코드'], ['hr', '구분선']];
    root.innerHTML = `<div class="ed-bar" role="toolbar" aria-label="블록 추가">${ADD.map(a => `<button type="button" class="btn sm" data-add="${a[0]}">${a[1]}</button>`).join('')}</div>
      <div class="ed" aria-label="문서 본문"></div><button type="button" class="btn sm ed-end" data-add-end="p">＋ 맨 아래에 본문 추가</button>
      <p class="small muted ed-help">줄 맨 앞에 <kbd>#</kbd> <kbd>##</kbd> <kbd>-</kbd> <kbd>1.</kbd> <kbd>[]</kbd> <kbd>&gt;</kbd> 를 쓰고 띄어쓰기를 하면 제목·목록·체크박스로 바뀝니다. 블록 왼쪽 <b>⋮</b> 에서 종류 변경·이동·삭제를 할 수 있습니다.</p>`;
    const ed = root.querySelector('.ed');
    let last = null;
    const find = id => doc.blocks.find(b => b.id === id), idx = b => doc.blocks.indexOf(b);
    const elOf = b => ed.querySelector(`.eb[data-id="${b.id}"]`);
    const changed = () => { if (onChange) onChange(); };

    function blockEl(b) {
      const d = document.createElement('div'); d.className = 'eb eb-' + b.type; d.dataset.id = b.id;
      const edit = (cls, ph, label) => `<div class="${cls}" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="${label}" data-ph="${ph}" spellcheck="false"></div>`;
      let inner = '';
      if (TEXT.has(b.type)) {
        const pre = b.type === 'ul' ? '<span class="eb-pre" aria-hidden="true">•</span>' : b.type === 'ol' ? '<span class="eb-pre eb-num" aria-hidden="true"></span>' : b.type === 'todo' ? `<input type="checkbox" class="eb-chk" ${b.checked ? 'checked' : ''} aria-label="완료 표시">` : '';
        inner = pre + edit('eb-t', PH[b.type], NAME[b.type]);
      } else if (b.type === 'hr') inner = '<hr>';
      else if (b.type === 'table') inner = `<div class="eb-wide"><div class="scroll-x"><table class="t eb-tbl"><tbody>${b.rows.map((r, ri) => '<tr>' + r.map((c, ci) => `<td contenteditable="plaintext-only" data-r="${ri}" data-c="${ci}" aria-label="${ri + 1}행 ${ci + 1}열">${esc(c)}</td>`).join('') + '</tr>').join('')}</tbody></table></div>
          <div class="row eb-tools"><button type="button" class="btn sm" data-tb="row+">행 추가</button><button type="button" class="btn sm" data-tb="col+">열 추가</button><button type="button" class="btn sm" data-tb="row-">행 삭제</button><button type="button" class="btn sm" data-tb="col-">열 삭제</button></div></div>`;
      else if (b.type === 'toggle') inner = `<button type="button" class="eb-tg" aria-expanded="${b.open}" aria-label="접기/펼치기">${b.open ? '▼' : '▶'}</button><div class="eb-wide">${edit('eb-t', '접는 제목', '접기 제목')}${b.open ? edit('eb-body', '펼쳤을 때 보일 내용', '접기 내용') : ''}</div>`;
      else if (b.type === 'link') inner = `<div class="eb-wide row"><input class="eb-ll" placeholder="링크 이름" value="${esc(b.text)}" aria-label="링크 이름"><input class="eb-lu" type="url" inputmode="url" placeholder="https://" value="${esc(b.url)}" aria-label="링크 주소"><a class="btn sm eb-lo" target="_blank" rel="noopener noreferrer" ${okUrl(b.url) ? `href="${esc(b.url)}"` : 'aria-disabled="true"'}>열기 ↗</a></div>`;
      d.innerHTML = `<button type="button" class="eb-h" aria-label="블록 메뉴" aria-haspopup="true">⋮</button><div class="eb-c">${inner}</div>`;
      const t = d.querySelector('.eb-t'); if (t) t.textContent = b.text || '';
      const bd = d.querySelector('.eb-body'); if (bd) bd.textContent = b.body || '';
      return d;
    }
    function focusBlock(b, off) {
      const be = elOf(b); if (!be) return;
      const t = be.querySelector('.eb-t');
      if (t) return setCaret(t, off === undefined ? (b.text || '').length : off);
      const o = be.querySelector('td, input'); if (o) o.focus();
    }
    const rerender = b => { const o = elOf(b); if (o) o.replaceWith(blockEl(b)); };
    function insertAfter(ref, nb) {
      const i = ref ? idx(ref) : doc.blocks.length - 1; doc.blocks.splice(i + 1, 0, nb);
      const re = ref && elOf(ref); if (re) re.after(blockEl(nb)); else ed.appendChild(blockEl(nb));
    }
    function removeBlock(b) {
      const i = idx(b); doc.blocks.splice(i, 1); const e = elOf(b); if (e) e.remove();
      if (!doc.blocks.length) { const nb = make('p'); doc.blocks.push(nb); ed.appendChild(blockEl(nb)); }
      return doc.blocks[Math.max(0, i - 1)];
    }
    function convert(b, type) { b.type = type; if (type === 'todo') b.checked = !!b.checked; rerender(b); focusBlock(b); changed(); }
    function openMenu(be, b) {
      const had = be.querySelector('.eb-menu'); document.querySelectorAll('.eb-menu').forEach(m => m.remove()); if (had) return;
      const m = document.createElement('div'); m.className = 'eb-menu'; m.setAttribute('role', 'menu');
      m.innerHTML = (TEXT.has(b.type) ? `<div class="eb-menu-t">종류 바꾸기</div><div class="eb-menu-g">${TYPES.filter(t => TEXT.has(t[0])).map(t => `<button type="button" role="menuitem" data-conv="${t[0]}" class="${t[0] === b.type ? 'on' : ''}">${t[1]}</button>`).join('')}</div>` : '') +
        `<div class="eb-menu-g"><button type="button" role="menuitem" data-act="up">▲ 위로</button><button type="button" role="menuitem" data-act="down">▼ 아래로</button><button type="button" role="menuitem" data-act="dup">복제</button><button type="button" role="menuitem" data-act="del">삭제</button></div>`;
      be.appendChild(m);
    }
    ed.replaceChildren(...doc.blocks.map(blockEl));

    root.onfocusin = e => { const be = e.target.closest('.eb'); if (be) last = be.dataset.id; };
    root.oninput = e => {
      const el = e.target, be = el.closest('.eb'); if (!be) return;
      const b = find(be.dataset.id); if (!b) return;
      if (el.classList.contains('eb-t')) {
        b.text = txt(el); if (!b.text && el.firstChild) el.textContent = '';
        if (b.type === 'p' && !e.isComposing) { const m = /^(##|#|-|\*|1\.|\[\]|>) $/.exec(b.text); if (m) { b.text = ''; return convert(b, SHORT[m[1]]); } }
      } else if (el.classList.contains('eb-body')) { b.body = txt(el); if (!b.body && el.firstChild) el.textContent = ''; }
      else if (el.tagName === 'TD') b.rows[+el.dataset.r][+el.dataset.c] = txt(el);
      else if (el.classList.contains('eb-ll')) b.text = el.value;
      else if (el.classList.contains('eb-lu')) { b.url = el.value.trim(); const a = be.querySelector('.eb-lo'); if (okUrl(b.url)) { a.href = b.url; a.removeAttribute('aria-disabled'); } else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); } }
      changed();
    };
    root.onchange = e => { if (e.target.classList.contains('eb-chk')) { const b = find(e.target.closest('.eb').dataset.id); b.checked = e.target.checked; e.target.closest('.eb').classList.toggle('done', b.checked); changed(); } };
    root.onkeydown = e => {
      if (e.isComposing || e.keyCode === 229) return;          // 한글 조합 중에는 건드리지 않음
      const el = e.target; if (!el.classList || !el.classList.contains('eb-t')) return;
      const b = find(el.closest('.eb').dataset.id); if (!b) return;
      if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code') {
        e.preventDefault();
        if (b.type === 'toggle') { if (!b.open) { b.open = true; rerender(b); changed(); } const bd = elOf(b).querySelector('.eb-body'); if (bd) setCaret(bd, (b.body || '').length); return; }
        if (!b.text && b.type !== 'p') return convert(b, 'p');
        const c = caret(el) || { start: b.text.length }, after = b.text.slice(c.start);
        b.text = b.text.slice(0, c.start); el.textContent = b.text;
        const nb = make(LISTY.has(b.type) ? b.type : 'p', { text: after }); insertAfter(b, nb); focusBlock(nb, 0); changed();
      } else if (e.key === 'Backspace' && b.type !== 'toggle') {
        const c = caret(el); if (!c || !c.collapsed || c.start !== 0) return;
        if (b.type !== 'p') { e.preventDefault(); return convert(b, 'p'), setCaret(elOf(b).querySelector('.eb-t'), 0); }
        const prev = doc.blocks[idx(b) - 1]; if (!prev) return;
        e.preventDefault();
        if (TEXT.has(prev.type)) { const at = prev.text.length; prev.text += b.text; removeBlock(b); rerender(prev); focusBlock(prev, at); }
        else if (!b.text) { removeBlock(b); focusBlock(prev); } else return;
        changed();
      }
    };
    root.onpaste = e => {
      const el = e.target; if (!el.classList || !el.classList.contains('eb-t')) return;
      const b = find(el.closest('.eb').dataset.id); if (!b || b.type === 'code' || b.type === 'toggle') return;
      const t = ((e.clipboardData && e.clipboardData.getData('text/plain')) || '').replace(/\r/g, ''); if (!t.includes('\n')) return;
      e.preventDefault();                                       // 여러 줄을 붙여 넣으면 줄마다 블록으로 나눔
      const lines = t.split('\n'), c = caret(el) || { start: b.text.length }, tail = b.text.slice(c.start);
      b.text = b.text.slice(0, c.start) + lines[0]; rerender(b);
      let ref = b; lines.slice(1).forEach((ln, i, a) => { const nb = make(LISTY.has(b.type) ? b.type : 'p', { text: ln + (i === a.length - 1 ? tail : '') }); insertAfter(ref, nb); ref = nb; });
      focusBlock(ref, ref.text.length - tail.length); changed();
    };
    root.onclick = e => {
      const add = e.target.closest('[data-add]'), addEnd = e.target.closest('[data-add-end]');
      if (add || addEnd) {
        const nb = make((add || addEnd).dataset.add || addEnd.dataset.addEnd), ref = add && last && find(last);
        insertAfter(ref || doc.blocks[doc.blocks.length - 1], nb); const ne = elOf(nb); if (ne.scrollIntoView) ne.scrollIntoView({ block: 'nearest' });
        focusBlock(nb); last = nb.id; return changed();
      }
      const be = e.target.closest('.eb'); if (!be) return;
      const b = find(be.dataset.id); if (!b) return;
      if (e.target.closest('.eb-h')) return openMenu(be, b);
      const conv = e.target.closest('[data-conv]'); if (conv) return convert(b, conv.dataset.conv);
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act, i = idx(b);
        if (a === 'del') { const p = removeBlock(b); focusBlock(p); }
        else if (a === 'dup') { const nb = JSON.parse(JSON.stringify(b)); nb.id = uid(); insertAfter(b, nb); }
        else { const j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= doc.blocks.length) return; doc.blocks.splice(i, 1); doc.blocks.splice(j, 0, b); const me = elOf(b), other = ed.children[j]; if (a === 'up') other.before(me); else other.after(me); }
        document.querySelectorAll('.eb-menu').forEach(m => m.remove()); return changed();
      }
      if (e.target.closest('.eb-tg')) { b.open = !b.open; rerender(b); return changed(); }
      const tb = e.target.closest('[data-tb]');
      if (tb) {
        const op = tb.dataset.tb, cols = b.rows[0].length;
        if (op === 'row+') b.rows.push(Array(cols).fill(''));
        else if (op === 'col+') b.rows.forEach(r => r.push(''));
        else if (op === 'row-' && b.rows.length > 1) b.rows.pop();
        else if (op === 'col-' && cols > 1) b.rows.forEach(r => r.pop());
        else return;
        rerender(b); return changed();
      }
    };
    return { focusFirst: () => focusBlock(doc.blocks[0]), focusLast: () => focusBlock(doc.blocks[doc.blocks.length - 1]) };
  }
  MW.editor = { TYPES, TEXT, make, uid, mount, text: blocksText };
})();
