/* 통합 업무관리: 리스트·칸반, 분야별·상태별 묶기, 상태 변경(자동저장) */
(function () {
  const MW = (window.MW = window.MW || {});
  const STATUS = ['미분류', '할 일', '진행 중', '보류', '완료', '취소'];
  const PRIO = ['미확인', '높음', '보통', '낮음'];
  const F = { view: 'list', group: '', category: '', status: '', q: '', todo: false, page: '', limit: 50 };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function filtered() {
    const sq = MW.search.words(F.q).map(MW.search.squash);
    return MW.state.tasks.filter(t => (!F.category || t.category === F.category) && (!F.status || t.status === F.status) &&
      (!F.todo || t.hadTodoTag) && (!F.page || t.occurrences.includes(F.page)) && sq.every(k => t._s.includes(k)))
      .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || b.count - a.count);
  }
  const sel = (t, cls) => `<select class="${cls || ''}" data-status="${t.id}" aria-label="업무 상태">${STATUS.map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  function rowHtml(t) {
    const { esc } = MW.ui;
    return `<div class="task" data-id="${t.id}">${sel(t)}<div><button class="ttl" data-open="${t.id}">${t.fav ? '★ ' : ''}${esc(MW.sec.show(t.title))}</button>
      <div class="small muted"><span class="chip">${esc(t.category)}</span> 원본 기재 ${esc(t.firstSeen || '미확인')}${t.lastSeen && t.lastSeen !== t.firstSeen ? ' ~ ' + esc(t.lastSeen) : ''} · ${t.count}회 등장${t.due ? ' · 기한 ' + esc(t.due) : ''}</div></div>
      <span class="small muted">${t.hadTodoTag ? '☐ 태그' : ''}</span></div>`;
  }
  function listHtml(ts) {
    if (!ts.length) return '<p class="muted">조건에 맞는 업무 항목이 없습니다.</p>';
    const more = n => n > F.limit ? `<div style="text-align:center;margin-top:12px"><button class="btn" id="t-more">더 보기 (${F.limit}/${n})</button></div>` : '';
    if (!F.group) return ts.slice(0, F.limit).map(rowHtml).join('') + more(ts.length);
    const key = F.group === 'status' ? 'status' : 'category', groups = new Map();
    ts.forEach(t => { if (!groups.has(t[key])) groups.set(t[key], []); groups.get(t[key]).push(t); });
    const order = F.group === 'status' ? STATUS.filter(s => groups.has(s)) : [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);
    return order.map(g => `<details class="card" style="margin-bottom:10px"><summary><b>${MW.ui.esc(g)}</b> <span class="muted">${groups.get(g).length}건</span></summary>${groups.get(g).slice(0, F.limit).map(rowHtml).join('')}${groups.get(g).length > F.limit ? `<p class="small muted">처음 ${F.limit}건만 표시했습니다. 위 조건으로 좁혀 보세요.</p>` : ''}</details>`).join('');
  }
  function kanbanHtml(ts) {
    const { esc } = MW.ui;
    return `<div class="kanban">${STATUS.map(s => { const g = ts.filter(t => t.status === s); return `<div class="kcol" data-col="${s}"><h3><span>${s}</span><span class="muted">${g.length}</span></h3>${g.slice(0, 30).map(t => `<div class="kcard" draggable="true" data-id="${t.id}"><button class="ttl" data-open="${t.id}" style="background:none;border:0;color:inherit;font:inherit;text-align:left;padding:0;cursor:pointer">${esc(MW.sec.show(t.title))}</button><div class="small muted">${esc(t.category)}</div>${sel(t)}</div>`).join('')}${g.length > 30 ? `<p class="small muted">외 ${g.length - 30}건 (조건으로 좁혀 보세요)</p>` : ''}</div>`; }).join('')}</div>`;
  }
  async function setStatus(id, status) {
    const t = MW.state.tasks.find(x => x.id === id); if (!t || t.status === status) return;
    t.status = status; t.updatedAt = new Date().toISOString();
    if (status === '완료' && !t.doneDate) t.doneDate = today();
    if (status !== '완료') t.doneDate = null;
    await MW.app.save('tasks', t);
  }
  function openDetail(id) {
    const t = MW.state.tasks.find(x => x.id === id); if (!t) return;
    const { esc } = MW.ui, cats = [...new Set(MW.state.tasks.map(x => x.category))].sort();
    const pages = t.occurrences.map(pid => MW.state.pages.find(p => p.id === pid)).filter(Boolean);
    MW.app.touchRecent('task', t.id);
    MW.ui.modal(`<h2>업무 항목</h2>
      <div class="doc" style="padding:14px;margin-bottom:14px"><p class="para">${esc(MW.sec.show(t.detail))}</p></div>
      <div class="form">
        <label for="d-status">업무 상태</label><select id="d-status">${STATUS.map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <label for="d-cat">업무 분야</label><select id="d-cat">${cats.map(c => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <label for="d-prio">우선순위</label><select id="d-prio">${PRIO.map(s => `<option ${s === t.priority ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <label for="d-due">실제 기한</label><div class="row"><input id="d-due" type="date" value="${esc(t.due || '')}"><span class="small muted">${t.due ? '' : '미확인 (직접 입력)'}</span></div>
        <label>완료일</label><div>${esc(t.doneDate || '미확인')}</div>
        <label for="d-tags">태그</label><input id="d-tags" value="${esc((t.tags || []).join(', '))}" placeholder="쉼표로 구분">
        <label for="d-memo">메모</label><textarea id="d-memo">${esc(t.memo || '')}</textarea>
      </div>
      <h3 style="margin-top:16px">원본 정보 <span class="chip">자동 추출</span></h3>
      <p class="small muted">자동 분류: ${esc(t.origCategory)} · 원본 최초 기재 ${esc(t.firstSeen || '미확인')} · 마지막 기재 ${esc(t.lastSeen || '미확인')} · ${t.count}회 등장 · 원본 「할 일」 태그 ${t.hadTodoTag ? '있음(완료 여부 미확인)' : '없음'}<br>
      ※ 기재일은 일지에 적혀 있던 날짜일 뿐, 실제 기한이나 완료일이 아닙니다.</p>
      <h3>원본 등장 페이지 (${pages.length})</h3>
      ${pages.length ? `<ul class="list" style="max-height:180px;overflow:auto">${pages.map(p => `<li><a href="#/archive/${p.id}?q=${encodeURIComponent(t.detail.slice(0, 20))}" data-close>${esc(p.section)} / ${esc(p.title || '(제목없음)')}</a></li>`).join('')}</ul>` : '<p class="small muted">원본 페이지와 자동으로 연결되지 않았습니다(미확인).</p>'}
      <div class="row" style="margin-top:14px"><button class="btn" id="d-fav">${t.fav ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'}</button><span class="small muted" id="d-saved"></span></div>`);
    const save = async () => { t.updatedAt = new Date().toISOString(); await MW.app.save('tasks', t); MW.search.index({ pages: [], tasks: [t] }); const el = document.getElementById('d-saved'); if (el) el.textContent = '자동 저장됨 ' + new Date().toLocaleTimeString('ko-KR'); MW.app.refreshSoon(); };
    document.getElementById('d-status').onchange = async e => { await setStatus(t.id, e.target.value); save(); };
    document.getElementById('d-cat').onchange = e => { t.category = e.target.value; save(); };
    document.getElementById('d-prio').onchange = e => { t.priority = e.target.value; save(); };
    document.getElementById('d-due').onchange = e => { t.due = e.target.value || null; save(); };
    document.getElementById('d-tags').onchange = e => { t.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); save(); };
    document.getElementById('d-memo').oninput = MW.ui.debounce(e => { t.memo = e.target.value; save(); }, 500);
    document.getElementById('d-fav').onclick = () => { t.fav = !t.fav; save().then(() => openDetail(t.id)); };
  }
  MW.tasks = {
    STATUS, today, setStatus, openDetail,
    render(view, r) {
      const { esc } = MW.ui, st = MW.state;
      if (!st.tasks.length) { view.innerHTML = MW.ui.empty('업무 항목'); return; }
      if (r.fresh) { F.page = r.page || ''; if (r.status !== undefined) F.status = r.status; if (r.category !== undefined) F.category = r.category; F.limit = 50; }
      const cats = [...new Set(st.tasks.map(t => t.category))].sort(), ts = filtered();
      const opt = (v, l, s) => `<option value="${esc(v)}" ${s === v ? 'selected' : ''}>${esc(l)}</option>`;
      const pg = F.page && st.pages.find(p => p.id === F.page);
      view.innerHTML = `<h1>통합 업무관리</h1>
        <div class="notice info small">과거 원노트에서 가져온 항목은 모두 <b>미분류</b>로 시작합니다. 원본의 체크 여부·기재일만으로 완료 여부나 기한을 판단하지 않았습니다. 직접 확인한 뒤 상태를 바꿔 주세요.</div>
        <div class="toolbar">
          <div class="seg" role="group" aria-label="보기 방식"><button class="btn ${F.view === 'list' ? 'on' : ''}" data-view="list">리스트</button><button class="btn ${F.view === 'kanban' ? 'on' : ''}" data-view="kanban">칸반 보드</button></div>
          <select id="t-group" aria-label="묶어 보기">${opt('', '묶지 않음', F.group)}${opt('category', '업무 분야별', F.group)}${opt('status', '상태별', F.group)}</select>
          <select id="t-cat" aria-label="업무 분야">${opt('', '전체 분야', F.category)}${cats.map(c => opt(c, c, F.category)).join('')}</select>
          <select id="t-status" aria-label="상태">${opt('', '전체 상태', F.status)}${STATUS.map(s => opt(s, s, F.status)).join('')}</select>
          <input id="t-q" type="search" placeholder="업무 내용 찾기" value="${esc(F.q)}" aria-label="업무 내용 찾기">
          <label class="row small"><input type="checkbox" id="t-todo" ${F.todo ? 'checked' : ''}> 원본 「할 일」 태그만</label>
        </div>
        ${pg ? `<div class="notice small">「${esc(pg.title)}」 페이지에 등장한 항목만 표시 중 <button class="btn sm" id="t-clearpage">해제</button></div>` : ''}
        <p class="small muted" id="t-count">${ts.length}건 / 전체 ${st.tasks.length}건 · 달력 보기는 다음 단계에서 제공됩니다.</p>
        <div id="t-body">${F.view === 'kanban' ? kanbanHtml(ts) : listHtml(ts)}</div>`;
      const re = () => MW.tasks.render(view, {});
      view.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { F.view = b.dataset.view; re(); });
      document.getElementById('t-group').onchange = e => { F.group = e.target.value; re(); };
      document.getElementById('t-cat').onchange = e => { F.category = e.target.value; F.limit = 50; re(); };
      document.getElementById('t-status').onchange = e => { F.status = e.target.value; F.limit = 50; re(); };
      document.getElementById('t-todo').onchange = e => { F.todo = e.target.checked; re(); };
      document.getElementById('t-q').oninput = MW.ui.debounce(e => { F.q = e.target.value; F.limit = 50; re(); const i = document.getElementById('t-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
      const cp = document.getElementById('t-clearpage'); if (cp) cp.onclick = () => { F.page = ''; re(); };
      const more = document.getElementById('t-more'); if (more) more.onclick = () => { F.limit += 100; re(); };
      const body = document.getElementById('t-body');
      body.onchange = async e => { const id = e.target.dataset.status; if (id) { await setStatus(id, e.target.value); MW.ui.toast('상태를 「' + e.target.value + '」(으)로 저장했습니다.'); if (F.view === 'kanban' || F.status || F.group === 'status') re(); } };
      body.onclick = e => { const b = e.target.closest('[data-open]'); if (b) openDetail(b.dataset.open); };
      if (F.view === 'kanban') {
        body.addEventListener('dragstart', e => { const c = e.target.closest('.kcard'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
        body.querySelectorAll('.kcol').forEach(col => {
          col.ondragover = e => { e.preventDefault(); col.classList.add('over'); };
          col.ondragleave = () => col.classList.remove('over');
          col.ondrop = async e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) { await setStatus(id, col.dataset.col); re(); } };
        });
      }
    }
  };
})();
