/* 앱 뼈대: 상태 불러오기 · 화면 전환 · 홈 대시보드 · 검색 · 가져오기 · 설정 */
(function () {
  const MW = (window.MW = window.MW || {});
  const $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WIDGETS = [['pcal', '오늘의 개인 일정'], ['ptask', '오늘의 개인 할 일'], ['todo', '오늘 할 일'], ['doing', '진행 중인 업무'], ['done', '완료한 업무'], ['due', '기한 임박 항목'], ['routine', '정기 점검 체크리스트'], ['recent', '최근 열람한 문서'], ['fav', '즐겨찾기'], ['edited', '최근 편집 내용'], ['memo', '최근 메모'], ['shortcuts', '업무별 바로가기']];
  const DEFAULTS = { company: '[회사명]', theme: 'dark', mask: true, fs: '16px', widgets: WIDGETS.map(w => ({ id: w[0], on: true })) };
  const NAV = [['home', '🏠', '홈'], ['cal', '📅', '개인 일정'], ['docs', '📄', '문서'], ['memo', '📝', '빠른 메모'], ['tasks', '✅', '업무'], ['routine', '🔁', '정기 업무'], ['manual', '📘', '업무 매뉴얼'], ['archive', '📚', '아카이브'], ['search', '🔎', '검색'], ['import', '📥', '가져오기'], ['trash', '🗑', '휴지통'], ['settings', '⚙️', '설정']];
  const BOTTOM = [['home', '🏠', '홈'], ['cal', '📅', '일정'], ['tasks', '✅', '업무'], ['search', '🔎', '검색'], ['more', '☰', '더보기']];
  const BOTTOM_P = [['home', '🏠', '홈'], ['cal?v=today', '📅', '오늘'], ['cal?v=month', '🗓', '달력'], ['search', '🔎', '검색'], ['more', '☰', '더보기']];
  const P_ONLY = ['home', 'cal', 'search', 'settings'];
  const pOnly = () => !!MW.state.settings.personalOnly;
  const navList = () => pOnly() ? NAV.filter(n => P_ONLY.includes(n[0])) : NAV;
  MW.state = { pages: [], tasks: [], docs: [], routines: [], rlog: new Map(), settings: JSON.parse(JSON.stringify(DEFAULTS)), recent: [], checks: {} };
  let dirty = false, lastImport = null;

  /* ---------- 공통 UI ---------- */
  MW.ui = {
    esc,
    toast(msg, err) { const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = msg; $('toasts').appendChild(d); setTimeout(() => d.remove(), err ? 8000 : 3200); },
    modal(html) { $('modal-body').innerHTML = html; $('modal').hidden = false; const f = $('modal-body').querySelector('select,input,button,textarea'); if (f) f.focus(); },
    closeModal() { if ($('modal').hidden) return; $('modal').hidden = true; $('modal-body').innerHTML = ''; $('modal-body').onchange = null; MW.docs.flush(); if (dirty) { dirty = false; const n = parse().name; if (n !== 'docs' || !parse().id) route(); } },
    debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (!ok) return MW.ui.toast('복사하지 못했습니다.', true); }
      MW.ui.toast('원본 텍스트를 복사했습니다. (가리지 않은 원문이 복사됩니다)');
    },
    empty: name => `<h1>${esc(name)}</h1><div class="card"><p>아직 가져온 자료가 없습니다.</p><p class="muted">원노트에서 추출한 파일을 가져오거나, 가상의 샘플 데이터로 먼저 살펴볼 수 있습니다.</p><a class="btn primary" href="#/import">자료 가져오기</a></div>`
  };
  MW.onSaveState = (pending, ok, err) => {
    const el = $('save-state'); if (!el) return;
    if (pending > 0) el.textContent = '저장 중…';
    else if (ok === false) { el.textContent = '⚠ 저장 실패'; MW.ui.toast('저장하지 못했습니다. 저장 공간이나 브라우저 설정을 확인해 주세요. (' + (err && err.message || err) + ')', true); }
    else el.textContent = '저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  /* ---------- 앱 기능 ---------- */
  MW.app = {
    async save(store, obj) { const { _s, ...clean } = obj; try { await MW.db.put(store, clean); } catch (e) { /* 경고는 onSaveState에서 표시 */ throw e; } },
    async saveSettings() { await MW.db.put('meta', MW.state.settings, 'settings'); applySettings(); },
    touchRecent(kind, id) { const r = MW.state.recent.filter(x => !(x.kind === kind && x.id === id)); r.unshift({ kind, id, at: Date.now() }); MW.state.recent = r.slice(0, 15); MW.db.put('meta', MW.state.recent, 'recent').catch(() => {}); },
    refreshSoon() { dirty = true; },
    route: () => route(),
    async reload() { const st = MW.state; st.pages = await MW.db.all('pages'); st.tasks = await MW.db.all('tasks'); st.docs = await MW.db.all('docs'); st.routines = await MW.db.all('routines'); st.rlog = new Map((await MW.db.all('rlog')).map(r => [r.id, r])); MW.search.index(st); }
  };
  function applySettings() {
    const s = MW.state.settings;
    document.documentElement.dataset.theme = s.theme; document.documentElement.style.setProperty('--fs', s.fs);
    $('btn-theme').textContent = s.theme === 'dark' ? '☀ 라이트' : '🌙 다크';
    $('btn-mask').textContent = s.mask ? '🙈 가림 켬' : '👁 가림 끔';
    $('footer').textContent = `© 2026 ${s.company || '[회사명]'}. All Rights Reserved.`;
  }
  function navHtml(items, cur) { return items.map(n => `<a href="#/${n[0]}" class="${cur === n[0] ? 'on' : ''}" ${cur === n[0] ? 'aria-current="page"' : ''}><span class="ico" aria-hidden="true">${n[1]}</span><span>${n[2]}</span></a>`).join(''); }

  /* ---------- 라우터 ---------- */
  function parse() {
    const h = location.hash.replace(/^#\/?/, ''), [path, qs] = h.split('?'), parts = path.split('/').filter(Boolean), q = {};
    new URLSearchParams(qs || '').forEach((v, k) => q[k] = v);
    return { name: parts[0] || 'home', id: parts[1] || '', q };
  }
  function route() {
    const r = parse(), view = $('view');
    let cur = r.name; if (r.name === 'docs' && r.id) { const d = MW.state.docs.find(x => x.id === r.id); if (d && d.kind !== 'doc') cur = d.kind; }
    if (pOnly() && !P_ONLY.includes(r.name) && r.name !== 'more') { location.replace('#/cal'); return; }
    $('nav-side').innerHTML = navHtml(navList(), cur);
    if (pOnly()) { const v = r.q.v || 'today', k = r.name === 'cal' ? (v === 'month' ? 'cal?v=month' : 'cal?v=today') : r.name; $('nav-bottom').innerHTML = navHtml(BOTTOM_P, ['home', 'search'].includes(k) || k.startsWith('cal') ? k : 'more'); }
    else $('nav-bottom').innerHTML = navHtml(BOTTOM, ['home', 'cal', 'tasks', 'search'].includes(r.name) ? r.name : 'more');
    const fabEvent = r.name === 'cal' || pOnly();
    $('fab').hidden = r.name === 'memo'; $('fab').dataset.mode = fabEvent ? 'event' : 'memo';
    $('fab').innerHTML = fabEvent ? '<span aria-hidden="true">＋</span> 일정' : '<span aria-hidden="true">＋</span> 메모'; $('fab').setAttribute('aria-label', fabEvent ? '새 개인 일정 등록' : '빠른 메모 쓰기');
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    const V = { home, search: searchView, import: importView, settings, more,
      archive: v => MW.archive.render(v, { id: r.id, q: r.q.q }), tasks: v => MW.tasks.render(v, { fresh: true, page: r.q.page, status: r.q.status, category: r.q.category }),
      docs: v => MW.docs.render(v, r), trash: v => MW.docs.renderTrash(v), manual: v => MW.docs.renderManual(v, r), memo: v => MW.docs.renderMemo(v), routine: v => MW.routine.render(v), cal: v => MW.personal.render(v, r) };
    try { const out = (V[r.name] || home)(view, r); if (out && out.catch) out.catch(e => { console.error(e); MW.ui.toast('화면을 표시하는 중 오류가 났습니다: ' + e.message, true); }); } catch (e) { console.error(e); view.innerHTML = `<div class="notice bad">화면을 표시하는 중 오류가 났습니다: ${esc(e.message)}</div>`; }
    if (r.name !== 'archive' || !r.id) window.scrollTo(0, 0);
  }
  function more(view) { view.innerHTML = `<h1>더보기</h1><div class="card"><nav class="nav">${navHtml(navList().filter(n => !(pOnly() ? ['home', 'search'] : ['home', 'cal', 'tasks', 'search']).includes(n[0])), '')}</nav></div>`; }

  /* ---------- 홈 대시보드 ---------- */
  function home(view) {
    const st = MW.state, T = st.tasks, today = MW.tasks.today(), by = s => T.filter(t => t.status === s);
    const d = new Date(), hr = d.getHours(), hello = hr < 12 ? '좋은 아침입니다' : hr < 18 ? '오늘도 수고 많으십니다' : '오늘 하루도 고생하셨습니다';
    const tl = (arr, emptyMsg) => arr.length ? `<ul class="list">${arr.slice(0, 6).map(t => `<li><button class="ttl" data-open="${t.id}" style="background:none;border:0;color:var(--text);font:inherit;font-weight:600;text-align:left;padding:0;cursor:pointer">${esc(MW.sec.show(t.title))}</button><div class="small muted">${esc(t.category)}${t.due ? ' · 기한 ' + esc(t.due) : ''}</div></li>`).join('')}</ul>${arr.length > 6 ? `<p class="small muted">외 ${arr.length - 6}건</p>` : ''}` : `<p class="muted small">${emptyMsg}</p>`;
    const W = {
      pcal: () => MW.personal.widget('pcal'), ptask: () => MW.personal.widget('ptask'),
      todo: () => tl(by('할 일'), '「할 일」로 표시한 업무가 없습니다. 업무 메뉴에서 상태를 바꿔 보세요.'),
      doing: () => tl(by('진행 중'), '진행 중인 업무가 없습니다.'),
      done: () => tl(by('완료').sort((a, b) => String(b.doneDate).localeCompare(String(a.doneDate))), '완료로 표시한 업무가 없습니다.'),
      due: () => { const lim = new Date(d.getTime() + 7 * 864e5).toISOString().slice(0, 10); return tl(T.filter(t => t.due && t.due <= lim && !['완료', '취소'].includes(t.status)).sort((a, b) => a.due.localeCompare(b.due)), '기한을 직접 입력한 항목 중 7일 이내인 것이 없습니다. (원본 기재일은 기한으로 쓰지 않습니다)'); },
      routine: () => { if (!st.routines.length) return `<p class="muted small">등록된 정기 업무가 없습니다.</p>${MW.routine.sourcePage() ? '<button class="btn sm" id="h-rimport">원노트 점검표에서 가져오기</button> ' : ''}<a class="btn sm" href="#/routine">정기 업무 열기</a>`;
        const pn = MW.routine.pendingNow(); return (pn.length ? `<div id="h-routine">${pn.slice(0, 8).map(x => `<label class="row" style="padding:4px 0;font-weight:400;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" data-rdone="${x.r.id}" style="flex:none;margin-top:4px"> <span>${esc(x.r.title)} <span class="chip">${MW.routine.FREQ[x.r.freq]}</span>${x.r.verified ? '' : ' <span class="chip c-warn">주기 검토 필요</span>'}${x.due && x.r.freq !== 'daily' ? ` <span class="small muted">기한 ${x.due}</span>` : ''}</span></label>`).join('')}</div>${pn.length > 8 ? `<p class="small muted">외 ${pn.length - 8}건</p>` : ''}` : '<p class="muted small">이번 기간의 정기 업무를 모두 완료했습니다.</p>') + '<a class="small" href="#/routine">정기 업무 전체 보기</a>'; },
      recent: () => { const items = st.recent.map(r => [r, (r.kind === 'page' ? st.pages : r.kind === 'doc' ? st.docs.filter(x => !x.deletedAt) : st.tasks).find(o => o.id === r.id)]).filter(x => x[1]).slice(0, 6);
        return items.length ? `<ul class="list">${items.map(([r, o]) => r.kind === 'page' ? `<li><a href="#/archive/${o.id}">📚 ${esc(o.title || '(제목없음)')}</a> <span class="small muted">${esc(o.section)}</span></li>` : r.kind === 'doc' ? `<li><a href="#/docs/${o.id}">📄 ${esc(MW.sec.show(o.title || '제목 없음'))}</a> <span class="small muted">${MW.docs.KIND[o.kind]}</span></li>` : `<li><a href="#" data-open="${o.id}">✅ ${esc(MW.sec.show(o.title))}</a></li>`).join('')}</ul>` : '<p class="muted small">최근에 연 문서가 없습니다.</p>'; },
      fav: () => { const ps = st.pages.filter(p => p.fav), ts = T.filter(t => t.fav), ds = MW.docs.live().filter(x => x.fav); return ps.length + ts.length + ds.length ? `<ul class="list">${ds.map(o => `<li><a href="#/docs/${o.id}">★ ${esc(MW.sec.show(o.title || '제목 없음'))}</a></li>`).join('')}${ps.map(o => `<li><a href="#/archive/${o.id}">★ ${esc(o.title || '(제목없음)')}</a></li>`).join('')}${ts.map(o => `<li><a href="#" data-open="${o.id}">★ ${esc(MW.sec.show(o.title))}</a></li>`).join('')}</ul>` : '<p class="muted small">즐겨찾기한 문서가 없습니다.</p>'; },
      edited: () => { const xs = MW.docs.live().map(x => ({ at: x.updatedAt, h: `<li><a href="#/docs/${x.id}">📄 ${esc(MW.sec.show(x.title || '제목 없음'))}</a> <span class="small muted">${MW.docs.KIND[x.kind]} · ${esc(MW.docs.fmt(x.updatedAt))}</span></li>` })).concat(T.filter(t => t.updatedAt).map(t => ({ at: t.updatedAt, h: `<li><a href="#" data-open="${t.id}">✅ ${esc(MW.sec.show(t.title))}</a> <span class="small muted">${esc(MW.docs.fmt(t.updatedAt))}</span></li>` }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
        return xs.length ? `<ul class="list">${xs.map(x => x.h).join('')}</ul>` : '<p class="muted small">아직 편집한 내용이 없습니다.</p>'; },
      memo: () => { const ms = MW.docs.live('memo').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4); return (ms.length ? `<ul class="list">${ms.map(m => `<li><a href="#/docs/${m.id}">📝 ${esc(MW.sec.show(m.title || '내용 없음'))}</a> <span class="small muted">${esc(MW.docs.fmt(m.updatedAt))}</span></li>`).join('')}</ul>` : '<p class="muted small">메모가 없습니다.</p>') + '<button class="btn sm" id="h-memo">＋ 빠른 메모</button>'; },
      shortcuts: () => { const m = {}; T.forEach(t => m[t.category] = (m[t.category] || 0) + 1); return `<div class="row">${Object.keys(m).sort((a, b) => m[b] - m[a]).map(c => `<a class="chip" style="padding:6px 12px;text-decoration:none;color:var(--text)" href="#/tasks?category=${encodeURIComponent(c)}">${esc(c)} <b>${m[c]}</b></a>`).join('')}</div>`; }
    };
    const names = Object.fromEntries(WIDGETS);
    view.innerHTML = `<div class="grid">
      <section class="card hero"><p class="muted" style="margin:0">${esc(d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }))}</p><h1>${hello}</h1>
        ${pOnly() ? '<p class="muted" style="margin:0">개인 일정 전용으로 사용 중입니다.</p>' : st.pages.length || T.length || st.docs.length ? `<div class="stats"><a class="stat" href="#/tasks?status=${encodeURIComponent('할 일')}"><b>${by('할 일').length}</b>할 일</a><a class="stat" href="#/tasks?status=${encodeURIComponent('진행 중')}"><b>${by('진행 중').length}</b>진행 중</a><a class="stat" href="#/tasks?status=${encodeURIComponent('완료')}"><b>${by('완료').length}</b>완료</a><a class="stat" href="#/tasks?status=${encodeURIComponent('미분류')}"><b>${by('미분류').length}</b>미분류</a><a class="stat" href="#/docs"><b>${MW.docs.live('doc').length}</b>문서</a><a class="stat" href="#/archive"><b>${st.pages.length}</b>원본 페이지</a></div>` : `<p>아직 가져온 자료가 없습니다.</p><a class="btn" href="#/import" style="background:#fff;color:#222">자료 가져오기</a>`}</section>
      ${st.settings.widgets.filter(w => w.on && W[w.id] && (!pOnly() || ['pcal', 'ptask'].includes(w.id))).map(w => `<section class="card" data-widget="${w.id}"><h2>${esc(names[w.id])}</h2>${W[w.id]()}</section>`).join('')}
    </div><p class="small muted" style="margin-top:14px">위젯 순서와 표시 여부는 <a href="#/settings">설정</a>에서 바꿀 수 있습니다.</p>`;
    view.onclick = async e => { if (await MW.personal.widgetClick(e)) return; const b = e.target.closest('[data-open]'); if (b) { e.preventDefault(); return MW.tasks.openDetail(b.dataset.open); } if (e.target.id === 'h-memo') return MW.docs.quickMemo(); if (e.target.id === 'h-rimport') { const x = await MW.routine.importFromOneNote(); MW.ui.toast(`원노트 점검표에서 ${x.added}건을 가져왔습니다. 주기는 「검토 필요」 상태입니다.`); home(view); } };
    view.onchange = async e => { if (await MW.personal.widgetChange(e)) return home(view); const rd = e.target.dataset.rdone; if (rd) { const r = st.routines.find(x => x.id === rd); await MW.routine.setDone(r, MW.routine.periodKey(r.freq, MW.routine.now()), true); MW.ui.toast('완료로 기록했습니다.'); return home(view); } const k = e.target.dataset.check; if (k) { st.checks[today] = st.checks[today] || {}; st.checks[today][k] = e.target.checked; MW.db.put('meta', st.checks, 'checks').catch(() => {}); } };
  }

  /* ---------- 통합 검색 ---------- */
  const SF = { q: '', kind: 'all', category: '', status: '', from: '', to: '', tag: '' };
  function searchView(view, r) {
    if (r.q.q !== undefined) SF.q = r.q.q;
    const st = MW.state, cats = [...new Set(st.tasks.map(t => t.category).concat(MW.CATS))].sort(), tags = [...new Set(st.tasks.flatMap(t => t.tags || []).concat(MW.docs.live().flatMap(d => d.tags || [])))].sort();
    const ICON = { page: '📚', task: '✅', doc: '📄', manual: '📘', memo: '📝', routine: '🔁', personal: '📅' }, cnt = k => res.filter(x => x.kind === k).length;
    const opt = (v, l, s) => `<option value="${esc(v)}" ${s === v ? 'selected' : ''}>${esc(l)}</option>`;
    const any = SF.q.trim() || SF.category || SF.status || SF.from || SF.to || SF.tag;
    const res = any ? MW.search.run(st, SF).concat(['all', 'personal'].includes(SF.kind) && !SF.status && !SF.tag && !SF.category && !SF.from && !SF.to ? MW.personal.searchItems(SF.q) : []) : [];
    view.innerHTML = `<h1>통합 검색</h1>
      <p class="small muted">이 기기 안에서만 검색합니다(외부 전송 없음). 띄어쓰기가 달라도 찾고, 여러 단어를 쓰면 모두 들어 있는 자료를 찾습니다.</p>
      <form class="toolbar" id="s-form">
        <input id="s-q" type="search" value="${esc(SF.q)}" placeholder="예: 해체 완료신고" aria-label="검색어" style="flex:1;min-width:180px">
        <select id="s-kind" aria-label="문서 종류">${opt('all', '전체 종류', SF.kind)}${opt('page', '원노트 원본 페이지', SF.kind)}${opt('task', '업무 항목', SF.kind)}${opt('doc', '문서', SF.kind)}${opt('manual', '업무 매뉴얼', SF.kind)}${opt('memo', '빠른 메모', SF.kind)}${opt('routine', '정기 업무', SF.kind)}${opt('personal', '개인 일정', SF.kind)}</select>
        <select id="s-cat" aria-label="업무 분야">${opt('', '전체 분야', SF.category)}${cats.map(c => opt(c, c, SF.category)).join('')}</select>
        <select id="s-status" aria-label="상태">${opt('', '전체 상태', SF.status)}${MW.tasks.STATUS.map(s => opt(s, s, SF.status)).join('')}</select>
        <select id="s-tag" aria-label="태그">${opt('', '전체 태그', SF.tag)}${tags.map(s => opt(s, s, SF.tag)).join('')}</select>
        <label class="small row">기간 <input id="s-from" type="month" value="${esc(SF.from)}" aria-label="시작 월"> ~ <input id="s-to" type="month" value="${esc(SF.to)}" aria-label="끝 월"></label>
        <button class="btn primary" type="submit">검색</button>
      </form>
      ${any ? `<p id="s-count"><b>${res.length}</b>건 (원본 페이지 ${cnt('page')} · 업무 항목 ${cnt('task')} · 문서 ${cnt('doc')} · 매뉴얼 ${cnt('manual')} · 메모 ${cnt('memo')} · 정기 업무 ${cnt('routine')} · 개인 일정 ${cnt('personal')})</p>` : '<p class="muted">검색어나 조건을 입력하세요.</p>'}
      <div class="card" ${res.length ? '' : 'hidden'}><ul class="list" id="s-results">${res.slice(0, 200).map(x => `<li data-kind="${x.kind}">${x.kind === 'page' ? `<a href="#/archive/${x.id}?q=${encodeURIComponent(SF.q)}">📚 ${esc(x.title)}</a>` : x.kind === 'task' ? `<a href="#" data-open="${x.id}">✅ ${MW.search.mark(MW.sec.show(x.title), SF.q, esc)}</a>` : x.kind === 'personal' ? `<a href="#/cal?open=${x.id}">📅 ${MW.search.mark(MW.sec.show(x.title), SF.q, esc)}</a>` : x.kind === 'routine' ? `<a href="#/routine">🔁 ${MW.search.mark(x.title, SF.q, esc)}</a>` : `<a href="#/docs/${x.id}">${ICON[x.kind]} ${MW.search.mark(MW.sec.show(x.title), SF.q, esc)}</a>`} <span class="chip">${esc(x.sub)}</span> <span class="small muted">${esc(x.date || '')}</span><div class="small muted">${MW.search.mark(MW.sec.show(x.snippet), SF.q, esc)}</div></li>`).join('')}</ul>${res.length > 200 ? '<p class="small muted">처음 200건만 표시했습니다. 조건을 좁혀 보세요.</p>' : ''}</div>`;
    $('s-form').onsubmit = e => { e.preventDefault(); SF.q = $('s-q').value; SF.kind = $('s-kind').value; SF.category = $('s-cat').value; SF.status = $('s-status').value; SF.tag = $('s-tag').value; SF.from = $('s-from').value; SF.to = $('s-to').value; $('q').value = SF.q; searchView(view, { q: {} }); };
    view.onclick = e => { const b = e.target.closest('[data-open]'); if (b) { e.preventDefault(); MW.tasks.openDetail(b.dataset.open); } };
  }

  /* ---------- 가져오기 ---------- */
  function importView(view) {
    view.innerHTML = `<h1>자료 가져오기</h1>
      <div class="notice bad"><b>가져오기 전에 확인하세요</b><ul style="margin:6px 0 0;padding-left:20px">
        <li>자료는 <b>이 기기의 이 브라우저 안(IndexedDB)</b>에만 저장되며 외부로 전송되지 않습니다.</li>
        <li>IndexedDB는 암호화된 보안 저장소가 아닙니다. 같은 PC 계정을 쓰는 사람은 볼 수 있습니다.</li>
        <li>가림 처리된 파일에도 민원인 이름·연락처·주소·내부 업무 정보가 남아 있을 수 있습니다.</li>
        <li>기관에서 반출을 승인하지 않은 업무자료는 개인 기기에 가져오지 마세요.</li></ul></div>
      <div class="card"><h2>1. 파일 선택</h2>
        <div class="form"><label for="i-json">블록 JSON</label><input id="i-json" type="file" accept=".json,application/json">
        <label for="i-csv">업무 항목 CSV</label><input id="i-csv" type="file" accept=".csv,text/csv"></div>
        <p class="small muted">onenote_blocks_masked.json 과 work_items_by_category.csv 를 선택합니다. 원본 파일은 읽기만 하고 수정하지 않습니다.</p>
        <div class="row"><button class="btn primary" id="i-check">검사하기</button><button class="btn" id="i-demo">가상의 샘플 데이터로 체험</button></div></div>
      <div id="i-result"></div>`;
    const out = $('i-result');
    const show = (j, c, label) => {
      const vj = MW.importer.validateJson(j.obj), vc = MW.importer.validateCsv(c.rows), errs = [...(j.err ? [j.err] : []), ...(c.err ? [c.err] : []), ...vj.errors, ...vc.errors], warns = [...vj.warnings, ...vc.warnings];
      let html = `<div class="card" style="margin-top:16px"><h2>2. 검사 결과 ${label ? '<span class="chip">' + esc(label) + '</span>' : ''}</h2>
        <table class="t"><tbody><tr><th>인코딩</th><td>JSON: ${j.enc} · CSV: ${c.enc}</td></tr>
        <tr><th>JSON 구조</th><td>섹션 ${vj.stats.sections} · 페이지 <b id="i-pages">${vj.stats.pages}</b> (${Object.entries(vj.stats.types).map(([k, v]) => (MW.archive.TYPE[k] || k) + ' ' + v).join(', ')}) · 블록 ${vj.stats.blocks} · 단락 ${vj.stats.paragraph} · 표 ${vj.stats.table} · 이미지 ${vj.stats.image} · 첨부 ${vj.stats.attachment}</td></tr>
        <tr><th>CSV 구조</th><td>업무 항목 <b id="i-tasks">${vc.count}</b>건 · 열: ${esc(MW.importer.CSV_HEAD.join(', '))}</td></tr></tbody></table>
        ${errs.length ? `<div class="notice bad"><b>오류 ${errs.length}건 — 가져올 수 없습니다</b><ul>${errs.slice(0, 20).map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '<div class="notice ok">구조 오류가 없습니다.</div>'}
        ${warns.length ? `<details class="notice"><summary>확인이 필요한 사항 ${warns.length}건</summary><ul>${warns.slice(0, 50).map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}</div>`;
      if (errs.length) { out.innerHTML = html; return; }
      let built; try { built = MW.importer.build(j.obj, c.rows); } catch (e) { console.error(e); out.innerHTML = html + `<div class="notice bad">자료를 변환하는 중 오류가 나서 가져오지 않았습니다: ${esc(e.message)}<br>기존에 저장된 자료는 바뀌지 않았습니다.</div>`; return; }
      const rp = built.report;
      html += `<div class="card" style="margin-top:16px"><h2>3. 변환 결과 비교</h2><table class="t"><tbody>
        <tr><th>페이지</th><td>원본 ${rp.pagesIn} → 변환 ${rp.pagesOut} ${rp.pagesIn === rp.pagesOut && rp.pageIdUnique ? '✅ 일치' : '⚠ 불일치'}</td></tr>
        <tr><th>업무 항목</th><td>원본 ${rp.tasksIn} → 변환 ${rp.tasksOut} ${rp.tasksIn === rp.tasksOut && rp.taskIdUnique ? '✅ 일치' : '⚠ 불일치(같은 내용 중복 가능)'}</td></tr>
        <tr><th>원본 페이지 연결</th><td>${rp.tasksLinked}건 연결 · ${rp.tasksUnlinked}건은 자동 연결 안 됨(미확인으로 표시)</td></tr></tbody></table></div>
        <div class="card" style="margin-top:16px"><h2>4. 민감정보 탐지 결과</h2><p class="small muted">자동 탐지는 일부만 찾아냅니다. 여기 없다고 안전한 것은 아닙니다. 이름처럼 규칙으로 찾을 수 없는 정보는 표시되지 않습니다.</p>
        <div class="scroll-x"><table class="t" id="i-sens"><thead><tr><th>유형</th><th>건수</th><th>해당 문서 수</th><th>예시(가림)</th></tr></thead><tbody>${built.sensitive.map(s => `<tr><td>${esc(s.name)}</td><td>${s.count}</td><td>${s.places}</td><td class="small">${esc(s.samples.join(' / '))}</td></tr>`).join('')}</tbody></table></div>
        <label class="row" style="margin:14px 0"><input type="checkbox" id="i-agree"> <span>위 내용을 확인했으며, 이 자료를 이 기기의 브라우저에 저장해도 되는 자료입니다.</span></label>
        <button class="btn primary" id="i-save" disabled>이 기기에 저장</button> <span id="i-done" class="small"></span></div>`;
      out.innerHTML = html;
      $('i-agree').onchange = e => { $('i-save').disabled = !e.target.checked; };
      $('i-save').onclick = async () => {
        $('i-save').disabled = true; $('i-done').textContent = '저장하는 중…';
        try { const rep = await MW.importer.commit(built); await MW.app.reload(); lastImport = rep;
          $('i-done').innerHTML = `✅ 저장 완료: 페이지 ${MW.state.pages.length}개, 업무 항목 ${MW.state.tasks.length}건${rep.reimportKept ? ` (기존 ${rep.reimportKept}건의 상태·메모 유지)` : ''}. <a href="#/home">홈으로</a>`; MW.ui.toast('가져오기를 마쳤습니다.'); }
        catch (e) { console.error(e); $('i-done').innerHTML = '<span class="chip c-bad">저장 실패</span> ' + esc(e.message) + ' — 기존에 저장된 자료는 바뀌지 않았습니다.'; MW.ui.toast('저장 실패: ' + e.message, true); $('i-save').disabled = false; try { await MW.app.reload(); } catch (_) { /* 저장소를 다시 읽지 못함 */ } }
      };
    };
    $('i-check').onclick = async () => {
      const fj = $('i-json').files[0], fc = $('i-csv').files[0];
      if (!fj || !fc) return MW.ui.toast('JSON과 CSV 파일을 모두 선택해 주세요.', true);
      out.innerHTML = '<div class="loading">검사하는 중…</div>';
      try {
        const dj = await MW.importer.readFile(fj), dc = await MW.importer.readFile(fc), j = { enc: dj.ok ? 'UTF-8 정상' + (dj.bom ? '(BOM)' : '') : '오류', obj: null }, c = { enc: dc.ok ? 'UTF-8 정상' + (dc.bom ? '(BOM)' : '') : '오류', rows: [] };
        if (!dj.ok) j.err = 'JSON: ' + dj.error; else { try { j.obj = JSON.parse(dj.text.replace(/^﻿/, '')); } catch (e) { j.err = 'JSON 형식 오류: ' + e.message; } }
        if (!dc.ok) c.err = 'CSV: ' + dc.error; else c.rows = MW.importer.parseCsv(dc.text.replace(/^﻿/, ''));
        show(j, c, '');
      } catch (e) { console.error(e); out.innerHTML = `<div class="notice bad">파일을 검사하지 못했습니다: ${esc(e.message)}<br>기존에 저장된 자료는 바뀌지 않았습니다.</div>`; }
    };
    $('i-demo').onclick = () => { const D = window.MW_DEMO; if (!D) return MW.ui.toast('샘플 데이터 파일이 없습니다.', true); show({ enc: '내장 샘플', obj: D.json }, { enc: '내장 샘플', rows: MW.importer.parseCsv(D.csv) }, '가상의 샘플 데이터'); };
  }

  /* ---------- 설정 ---------- */
  function settings(view) {
    const s = MW.state.settings, names = Object.fromEntries(WIDGETS), http = /^https?:/.test(location.protocol);
    view.innerHTML = `<h1>설정</h1><div class="grid">
      <section class="card"><h2>화면</h2><div class="form">
        <label for="st-theme">테마</label><select id="st-theme"><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>다크</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>라이트</option></select>
        <label for="st-fs">글자 크기</label><select id="st-fs">${[['15px', '작게'], ['16px', '보통'], ['18px', '크게'], ['20px', '아주 크게']].map(o => `<option value="${o[0]}" ${s.fs === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
        <label for="st-company">푸터 회사명</label><input id="st-company" value="${esc(s.company)}">
        <label for="st-mask">민감정보 가리기</label><label class="row" style="font-weight:400"><input type="checkbox" id="st-mask" ${s.mask ? 'checked' : ''}> 화면에서 전화번호·이메일·주민번호·계정정보를 가립니다(완전하지 않음)</label></div></section>
      <section class="card"><h2>홈 위젯</h2><div id="st-widgets">${s.widgets.map((w, i) => `<div class="wrow"><input type="checkbox" data-won="${i}" ${w.on ? 'checked' : ''} aria-label="${esc(names[w.id])} 표시"><span>${esc(names[w.id])}</span><button class="btn sm" data-wup="${i}" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button><button class="btn sm" data-wdn="${i}" ${i === s.widgets.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button></div>`).join('')}</div></section>
      ${MW.personal.settingsCard()}<section class="card"><h2>업무 자료 백업·복원</h2><p class="small muted"><b>개인 일정은 이 백업에 들어가지 않습니다(따로 백업).</b> 백업 파일에는 가져온 자료 전체가 그대로 들어갑니다. 공개 저장소·메신저·외부 클라우드에 올리지 마세요. 다른 기기와 자동으로 동기화되지 않습니다.</p>
        <div class="row"><button class="btn primary" id="st-export">백업 파일 내보내기</button><label class="btn" for="st-restore" style="display:inline-flex;align-items:center">백업에서 복원</label><input id="st-restore" type="file" accept=".json" hidden></div>
        <p class="small muted" id="st-counts">현재: 원본 페이지 ${MW.state.pages.length}개 · 업무 항목 ${MW.state.tasks.length}건 · 문서·매뉴얼·메모 ${MW.state.docs.length}건 · 정기 업무 ${MW.state.routines.length}건</p><p class="small muted">복원할 때는 백업 파일 전체를 먼저 검사하고, 문제가 없을 때만 현재 자료를 바꿉니다. 검사나 교체에 실패하면 현재 자료는 그대로 남습니다.</p></section>
      <section class="card"><h2>이 기기의 자료 삭제</h2><p class="small muted">브라우저에 저장된 업무 자료(페이지·업무·문서·설정)를 지웁니다. 개인 일정은 「개인 일정」 칸에서 따로 지웁니다. 되돌릴 수 없으니 먼저 백업하세요.</p><button class="btn danger" id="st-wipe">모든 자료 삭제</button></section>
      <section class="card"><h2>앱 설치(PWA)·연결 상태</h2><p class="small">${http ? '주소창의 설치 아이콘 또는 브라우저 메뉴의 「앱 설치 / 홈 화면에 추가」로 설치할 수 있습니다.' : '지금은 파일을 직접 연 상태(file://)입니다. 모든 기능은 쓸 수 있지만, 앱 설치와 오프라인 캐시는 http(s) 주소로 열었을 때만 작동합니다.'}</p><p class="small muted">네트워크: ${navigator.onLine ? '온라인' : '오프라인'} · 클라우드 동기화: 구현되지 않음(자리만 마련됨). 「동기화 대상」으로 표시한 문서 ${MW.sync.status(MW.state).eligible}건 — 지금은 어디로도 전송되지 않습니다.</p></section>
      <section class="card"><h2>최근 가져오기 기록</h2><pre class="small" style="white-space:pre-wrap;margin:0" id="st-report">${lastImport ? esc(JSON.stringify(lastImport, null, 1)) : '기록 없음'}</pre></section></div>`;
    MW.personal.bindSettings(() => settings(view));
    const sv = async () => { await MW.app.saveSettings(); };
    $('st-theme').onchange = e => { s.theme = e.target.value; sv(); };
    $('st-fs').onchange = e => { s.fs = e.target.value; sv(); };
    $('st-company').onchange = e => { s.company = e.target.value.trim() || '[회사명]'; sv(); };
    $('st-mask').onchange = e => { s.mask = e.target.checked; sv(); };
    $('st-widgets').onclick = async e => { const u = e.target.dataset.wup, dn = e.target.dataset.wdn; if (u === undefined && dn === undefined) return; const i = Number(u !== undefined ? u : dn), j = u !== undefined ? i - 1 : i + 1; [s.widgets[i], s.widgets[j]] = [s.widgets[j], s.widgets[i]]; await sv(); settings(view); };
    $('st-widgets').onchange = e => { const i = e.target.dataset.won; if (i !== undefined) { s.widgets[i].on = e.target.checked; sv(); } };
    $('st-export').onclick = async () => {
      if (!confirm('백업 파일에는 민감할 수 있는 자료가 그대로 들어갑니다.\n승인된 저장 위치에만 보관하세요. 계속할까요?')) return;
      try { const data = await MW.db.exportAll(), blob = new Blob([JSON.stringify(data)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-workspace-backup-' + MW.tasks.today() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); MW.ui.toast('백업 파일을 내보냈습니다.'); }
      catch (e) { MW.ui.toast('백업 실패: ' + e.message, true); }
    };
    $('st-restore').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const d = await MW.importer.readFile(f); if (!d.ok) throw new Error(d.error);
        let obj; try { obj = JSON.parse(d.text.replace(/^\ufeff/, '')); } catch (x) { throw new Error('백업 파일을 읽을 수 없습니다(JSON 형식 오류).'); }
        const v = MW.db.validateBackup(obj);                 // ① 전체 검증 (아직 아무것도 바꾸지 않음)
        if (v.errors.length) throw new Error('백업 파일 검증 실패: ' + v.errors.slice(0, 3).join(' / '));
        const c = v.counts;
        if (!confirm(`백업 파일 검사를 통과했습니다.\n원본 페이지 ${c.pages} · 업무 ${c.tasks} · 문서 ${c.docs} · 정기 업무 ${c.routines}\n\n현재 자료를 이 백업의 내용으로 바꿉니다. 계속할까요?`)) return;
        await MW.docs.flush();
        await MW.db.importAll(obj);                          // ② 임시 저장 → ③ 확인 → ④ 한 번에 교체
        await boot(true); MW.ui.toast('백업에서 복원했습니다.'); location.hash = '#/home'; route();
      } catch (err) { console.error(err); MW.ui.toast('복원 실패: ' + err.message + ' — 현재 자료는 그대로 유지됩니다.', true); try { await MW.app.reload(); } catch (_) { /* 무시 */ } }
    };
    $('st-wipe').onclick = async () => { if (!confirm('이 브라우저에 저장된 모든 자료를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return; try { await MW.db.wipe(); await boot(true); MW.ui.toast('모든 자료를 삭제했습니다.'); settings(view); } catch (e) { MW.ui.toast('삭제 실패: ' + e.message, true); } };
  }

  /* ---------- 시작 ---------- */
  async function boot(again) {
    const st = MW.state, saved = await MW.db.get('meta', 'settings');
    st.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), saved || {});
    WIDGETS.forEach(w => { if (!st.settings.widgets.some(x => x.id === w[0])) st.settings.widgets.push({ id: w[0], on: true }); });
    try { await MW.db.clear('staging'); } catch (_) { /* 이전 복원 시도의 임시 자료 정리 */ }
    st.recent = (await MW.db.get('meta', 'recent')) || []; st.checks = (await MW.db.get('meta', 'checks')) || {}; lastImport = (await MW.db.get('meta', 'importReport')) || null;
    await MW.app.reload(); applySettings();
    if (!again) { await MW.personal.load(); route(); }
  }
  function help() { MW.ui.modal(`<h2>키보드 단축키</h2><table class="t"><tbody><tr><td><kbd>/</kbd></td><td>통합 검색창으로 이동</td></tr><tr><td><kbd>Alt</kbd>+<kbd>1</kbd>~<kbd>4</kbd></td><td>홈 · 아카이브 · 업무 · 검색</td></tr><tr><td><kbd>Alt</kbd>+<kbd>5</kbd></td><td>개인 일정</td></tr><tr><td><kbd>Alt</kbd>+<kbd>E</kbd></td><td>새 개인 일정</td></tr><tr><td><kbd>Alt</kbd>+<kbd>N</kbd></td><td>빠른 메모</td></tr><tr><td><kbd>Alt</kbd>+<kbd>D</kbd></td><td>새 문서</td></tr><tr><td><kbd>Alt</kbd>+<kbd>T</kbd></td><td>다크·라이트 전환</td></tr><tr><td><kbd>Esc</kbd></td><td>창 닫기</td></tr><tr><td><kbd>?</kbd></td><td>이 도움말</td></tr></tbody></table>`); }
  function net() { $('offline-bar').hidden = navigator.onLine; $('net-side').textContent = (navigator.onLine ? '● 온라인' : '○ 오프라인') + ' · 이 기기에만 저장'; }
  window.addEventListener('DOMContentLoaded', async () => {
    window.addEventListener('hashchange', () => { MW.docs.flush(); MW.ui.closeModal(); route(); });
    $('fab').onclick = () => $('fab').dataset.mode === 'event' ? MW.personal.openEditor({ type: 'event' }) : MW.docs.quickMemo();
    document.addEventListener('visibilitychange', () => { if (document.hidden) MW.docs.flush(); });
    window.addEventListener('pagehide', () => { MW.docs.flush(); });
    $('top-search').onsubmit = e => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent($('q').value); };
    $('btn-theme').onclick = () => { MW.state.settings.theme = MW.state.settings.theme === 'dark' ? 'light' : 'dark'; MW.app.saveSettings(); };
    $('btn-mask').onclick = () => { MW.state.settings.mask = !MW.state.settings.mask; MW.app.saveSettings().then(route); };
    $('btn-help').onclick = help;
    $('modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) MW.ui.closeModal(); });
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
      if (e.key === 'Escape') return MW.ui.closeModal();
      if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); location.hash = '#/' + ['home', 'archive', 'tasks', 'search'][e.key - 1]; return; }
      if (e.altKey && e.key === '5') { e.preventDefault(); location.hash = '#/cal'; return; }
      if (e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); return MW.personal.openEditor({ type: 'event' }); }
      if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); return $('btn-theme').click(); }
      if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); return MW.docs.quickMemo(); }
      if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); const d = MW.docs.create('doc'); return MW.docs.persist(d).then(() => { location.hash = '#/docs/' + d.id; }); }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); $('q').focus(); } else if (e.key === '?') help();
    });
    window.addEventListener('beforeunload', e => { const unsaved = MW.docs.hasDirty(); if (unsaved) MW.docs.flush(); if (unsaved || MW.db.pending() > 0 || MW.pdb.pending() > 0) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('online', net); window.addEventListener('offline', net); net();
    try { await boot(); } catch (e) { console.error(e); $('view').innerHTML = `<div class="notice bad">저장소를 열지 못했습니다: ${esc(e.message)}<br>시크릿 창이거나 브라우저 저장이 꺼져 있으면 사용할 수 없습니다.</div>`; applySettings(); }
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(e => console.warn('서비스 워커 등록 실패', e));
  });
})();
