/* 개인 일정 화면 · 입력 · ICS 내보내기 · 리마인더 공유 · 백업
   저장은 MW.pdb(개인 일정 전용 저장소)만 사용합니다. 업무 자료 저장소에는 쓰지 않습니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  const C = () => MW.cal;
  const esc = s => MW.ui.esc(s);
  const CATS = ['개인 약속', '가족 일정', '자녀 교육', '개인 할 일', '반복 생활', '개인 메모', '정기 알림'];
  const PRIO = ['낮음', '보통', '높음'];
  const COLORS = [['#4f7cff', '파랑'], ['#9b5cff', '보라'], ['#ec4899', '분홍'], ['#f59e0b', '주황'], ['#10b981', '초록'], ['#06b6d4', '청록'], ['#64748b', '회색'], ['#e11d48', '빨강']];
  const AL_TIMED = [[0, '정해진 시간'], [5, '5분 전'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [1440, '하루 전']];
  const AL_ALLDAY = [[-540, '당일 오전 9시'], [900, '전날 오전 9시'], [0, '당일 0시']];
  const VIEWS = [['today', '오늘'], ['month', '월간'], ['week', '주간'], ['day', '일간'], ['upcoming', '다가오는 일정'], ['tasks', '할 일'], ['recurring', '반복 일정'], ['search', '검색'], ['export', '휴대폰으로 보내기'], ['trash', '휴지통']];
  const S = { v: 'today', d: null, sel: null, q: '' };
  const st = (MW.pstate = { items: [], exports: [], meta: { deviceRole: '' }, loaded: false, error: null });
  const live = () => st.items.filter(i => !i.deletedAt);
  const rid = () => 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowIso = () => new Date().toISOString();
  const clone = o => JSON.parse(JSON.stringify(o));
  const timeOf = o => o.allDay ? '종일' : (o.startTime || '') + (o.endTime ? '~' + o.endTime : '');

  /* ---------- 불러오기 · 저장 ---------- */
  async function load() {
    try {
      try { await MW.pdb.clear('staging'); } catch (_) { /* 무시 */ }
      st.items = await MW.pdb.all('items'); st.exports = await MW.pdb.all('exports');
      st.meta = Object.assign({ deviceRole: '' }, (await MW.pdb.get('meta', 'settings')) || {});
      st.gsync = (await MW.pdb.get('meta', 'gsync')) || null;
      st.loaded = true; st.error = null;
    } catch (e) { st.error = e.message; st.loaded = false; console.error(e); }
  }
  /* 일정 1건 저장: 일정 + 변경 이력(이전 상태) + 자동화 이벤트 기록을 한 번에 저장(하나라도 실패하면 모두 취소) */
  async function save(next) {
    const prev = st.items.find(x => x.id === next.id) || null;
    await MW.pdb.saveItem(prev, next);
    if (prev) st.items[st.items.indexOf(prev)] = next; else st.items.push(next);
    trimLater(next.id);
    return next;
  }
  let trimT = null;
  function trimLater(id) {
    clearTimeout(trimT);
    trimT = setTimeout(async () => {
      try {
        const hs = (await MW.pdb.all('history')).filter(h => h.itemId === id).sort((a, b) => a.version - b.version);
        for (const h of hs.slice(0, Math.max(0, hs.length - 20))) await MW.pdb.del('history', h.id);
        const ob = (await MW.pdb.all('outbox')).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        for (const e of ob.slice(0, Math.max(0, ob.length - 300))) await MW.pdb.del('outbox', e.idempotencyKey);
      } catch (_) { /* 정리는 다음 저장 때 다시 시도 */ }
    }, 400);
  }
  const saveMeta = () => MW.pdb.put('meta', st.meta, 'settings');

  /* ---------- 공통 조각 ---------- */
  const occBtn = (o, extra) => `<button type="button" class="pchip ${o.done ? 'done' : ''}" data-occ="${esc(o.key)}" style="--c:${esc(o.color || COLORS[0][0])}" title="${esc(o.title)}">${extra || ''}<span class="pt">${o.allDay ? '' : esc(o.startTime || '')}</span> ${esc(MW.sec.show(o.title))}</button>`;
  function occRow(o, opt) {
    opt = opt || {};
    const chk = o.type === 'task' ? `<input type="checkbox" class="pdone" data-done="${esc(o.key)}" ${o.done ? 'checked' : ''} aria-label="${esc(o.title)} 완료">` : `<span class="pdot" style="background:${esc(o.color || COLORS[0][0])}" aria-hidden="true"></span>`;
    return `<li class="prow ${o.done ? 'done' : ''}">${chk}<button type="button" class="ttl" data-occ="${esc(o.key)}"><span class="ptime">${opt.date ? esc(C().label(o.start)) + ' ' : ''}${esc(timeOf(o))}</span> ${esc(MW.sec.show(o.title))}</button>
      <span class="small muted">${o.location ? '📍' + esc(MW.sec.show(o.location)) + ' ' : ''}${o.recurring ? '🔁 ' : ''}${o.changed ? '(이 회차 수정됨) ' : ''}${o.type === 'task' ? '할 일' : esc(o.category || '')}${o.priority === '높음' ? ' · <b>중요</b>' : ''}</span></li>`;
  }
  const occList = (os, empty, opt) => os.length ? `<ul class="list plist">${os.map(o => occRow(o, opt)).join('')}</ul>` : `<p class="muted small">${empty}</p>`;
  const findOcc = key => { const i = key.lastIndexOf('|'), id = key.slice(0, i), orig = key.slice(i + 1), it = st.items.find(x => x.id === id); return it ? (C().expand(it, orig, C().addDays(orig, 400)).find(o => o.orig === orig) || C().expand(it, '0000-01-01', '9999-12-31').find(o => o.orig === orig) || null) : null; };
  function banner() {
    if (!st.loaded) return `<div class="notice bad">개인 일정 저장소를 열지 못했습니다: ${esc(st.error || '')}</div>`;
    const role = st.meta.deviceRole;
    const chip = role === 'admin-pc' ? '<span class="chip c-warn">행정 PC</span>' : role === 'personal' ? '<span class="chip c-ok">개인 기기</span>' : '';
    return `<div class="row spread pbar"><div class="row"><span class="chip">이 기기에만 저장 · 다른 기기와 동기화 안 됨</span>${chip}</div>
      <div class="row"><button class="btn primary" id="pc-add">＋ 일정</button><button class="btn" id="pc-addtask">＋ 할 일</button>${role === 'personal' && onlineOk() ? '<a class="btn" href="sync.html" id="pc-gsync" style="white-space:nowrap">Google 동기화</a>' : ''}</div></div>
      ${role ? '' : `<div class="notice small" id="pc-role">이 기기는 어떤 기기인가요? 행정 PC에서는 휴대폰으로 파일을 옮기기 전에 기관 보안정책을 확인하라는 안내가 표시됩니다.
        <div class="row" style="margin-top:6px"><button class="btn sm" data-role="admin-pc">행정 PC</button><button class="btn sm" data-role="personal">개인 휴대폰·PC</button></div></div>`}`;
  }
  const tabs = () => `<nav class="ptabs" aria-label="개인 일정 보기">${VIEWS.map(v => `<a href="#/cal?v=${v[0]}${S.d && ['month', 'week', 'day'].includes(v[0]) ? '&d=' + S.d : ''}" class="${S.v === v[0] ? 'on' : ''}" ${S.v === v[0] ? 'aria-current="page"' : ''}>${v[1]}</a>`).join('')}${hasCandidates() ? `<a href="#/cal?v=onenote" class="${S.v === 'onenote' ? 'on' : ''}">원노트 후보</a>` : ''}</nav>`;
  const navBar = (title, unit) => `<div class="row spread pnav"><div class="row"><button class="btn sm" data-nav="-1" aria-label="이전 ${unit}">◀</button><button class="btn sm" data-nav="0">오늘</button><button class="btn sm" data-nav="1" aria-label="다음 ${unit}">▶</button></div><h2 style="margin:0">${esc(title)}</h2><input type="date" id="pc-jump" value="${S.d}" aria-label="날짜로 이동"></div>`;

  /* ---------- 보기별 화면 ---------- */
  function vToday() {
    const t = C().today(), os = C().occurrences(st.items, t, t), ev = os.filter(o => o.type === 'event'), soon = C().occurrences(st.items, C().addDays(t, 1), C().addDays(t, 3)).filter(o => o.type === 'event');
    return pendingCard() + `<div class="grid pgrid"><section class="card"><h2>오늘의 일정 <span class="small muted">${esc(C().label(t, { year: 1 }))}</span></h2>${occList(ev, '오늘 일정이 없습니다.')}</section>
      <section class="card"><h2>오늘의 할 일</h2>${occList(tasksDue(t), '오늘까지 할 일이 없습니다.', { date: 1 })}</section>
      <section class="card"><h2>앞으로 3일</h2>${occList(soon, '예정된 일정이 없습니다.', { date: 1 })}</section></div>`;
  }
  function tasksDue(t) {
    const past = C().occurrences(st.items.filter(i => i.type === 'task'), C().addDays(t, -60), C().addDays(t, -1)).filter(o => !o.done);
    return past.concat(C().occurrences(st.items.filter(i => i.type === 'task'), t, t));
  }
  function vMonth() {
    const a = S.d.split('-').map(Number), first = `${a[0]}-${C().pad(a[1])}-01`, g0 = C().addDays(first, -C().wd(first)), g1 = C().addDays(g0, 41), t = C().today();
    const os = C().occurrences(st.items, g0, g1), by = {};
    os.forEach(o => { for (let d = o.start < g0 ? g0 : o.start, i = 0; d <= o.end && d <= g1 && i < 42; d = C().addDays(d, 1), i++) (by[d] = by[d] || []).push(o); });
    const sel = S.sel && S.sel >= g0 && S.sel <= g1 ? S.sel : (t >= g0 && t <= g1 && t.slice(0, 7) === first.slice(0, 7) ? t : first);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = C().addDays(g0, i), list = by[d] || [], other = d.slice(0, 7) !== first.slice(0, 7), w = C().wd(d);
      cells += `<div class="mcell ${other ? 'dim' : ''} ${d === t ? 'today' : ''} ${d === sel ? 'sel' : ''} ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}" data-day="${d}" role="gridcell" tabindex="0" aria-label="${esc(C().label(d))} 일정 ${list.length}건">
        <span class="mnum">${+d.slice(8)}</span><div class="mchips">${list.slice(0, 3).map(o => occBtn(o)).join('')}${list.length > 3 ? `<span class="more small">+${list.length - 3}</span>` : ''}</div>
        <div class="mdots" aria-hidden="true">${list.slice(0, 4).map(o => `<i style="background:${esc(o.color || COLORS[0][0])}"></i>`).join('')}${list.length > 4 ? '<b>+</b>' : ''}</div></div>`;
    }
    return navBar(`${a[0]}년 ${a[1]}월`, '달') + `<div class="mgrid" role="grid">${C().WD_KO.map((w, i) => `<div class="mhead ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}${cells}</div>
      <section class="card" style="margin-top:12px" id="pc-dayl"><h2>${esc(C().label(sel))}</h2>${occList(C().occurrences(st.items, sel, sel), '일정이 없습니다.')}<button class="btn sm" data-addon="${sel}">＋ 이 날 일정 추가</button></section>`;
  }
  function vWeek() {
    const w0 = C().addDays(S.d, -C().wd(S.d)), w1 = C().addDays(w0, 6), t = C().today(), os = C().occurrences(st.items, w0, w1);
    return navBar(`${C().label(w0)} ~ ${C().label(w1)}`, '주') + `<div class="wgrid">${Array.from({ length: 7 }, (_, i) => { const d = C().addDays(w0, i), list = os.filter(o => o.start <= d && o.end >= d);
      return `<section class="wcol ${d === t ? 'today' : ''}" data-day="${d}"><h3><button type="button" class="ttl" data-goday="${d}">${esc(C().label(d))}</button></h3>${list.map(o => occBtn(o)).join('') || '<p class="small muted">-</p>'}<button type="button" class="btn sm wadd" data-addon="${d}" aria-label="${esc(C().label(d))} 일정 추가">＋</button></section>`; }).join('')}</div>`;
  }
  function vDay() {
    const os = C().occurrences(st.items, S.d, S.d);
    return navBar(C().label(S.d, { year: 1 }), '날') + `<section class="card"><h3>종일</h3>${occList(os.filter(o => o.allDay), '종일 일정이 없습니다.')}<h3 style="margin-top:12px">시간별</h3>${occList(os.filter(o => !o.allDay), '시간이 정해진 일정이 없습니다.')}<button class="btn sm" data-addon="${S.d}">＋ 이 날 일정 추가</button></section>`;
  }
  function vUpcoming() {
    const t = C().today(), os = C().occurrences(st.items, t, C().addDays(t, 30)), by = {};
    os.forEach(o => (by[o.start] = by[o.start] || []).push(o));
    const days = Object.keys(by).sort();
    return `<p class="small muted">오늘부터 30일 동안의 일정입니다. (${os.length}건)</p>` + (days.map(d => `<section class="card" style="margin-bottom:10px"><h3>${esc(C().label(d))}${d === t ? ' <span class="chip c-acc">오늘</span>' : ''}</h3>${occList(by[d], '')}</section>`).join('') || '<div class="card muted">다가오는 일정이 없습니다.</div>');
  }
  function vTasks() {
    const t = C().today(), tk = st.items.filter(i => i.type === 'task' && !i.deletedAt);
    const over = C().occurrences(tk, C().addDays(t, -365), C().addDays(t, -1)).filter(o => !o.done), now = C().occurrences(tk, t, t), soon = C().occurrences(tk, C().addDays(t, 1), C().addDays(t, 30));
    const done = tk.filter(i => !i.rule && i.done).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 20).map(i => C().expand(i, i.start, i.end || i.start)[0]).filter(Boolean);
    return `<p class="small muted">할 일은 마감 날짜에 표시됩니다. 휴대폰 알림은 「휴대폰으로 보내기」(캘린더) 또는 리마인더 공유로 등록합니다.</p><div class="grid pgrid">
      <section class="card"><h2>지난 마감 <span class="small muted">${over.length}</span></h2>${occList(over, '지난 마감 중 미완료가 없습니다.', { date: 1 })}</section>
      <section class="card"><h2>오늘</h2>${occList(now, '오늘 마감인 할 일이 없습니다.')}</section>
      <section class="card"><h2>30일 이내</h2>${occList(soon, '예정된 할 일이 없습니다.', { date: 1 })}</section>
      <section class="card"><h2>완료</h2>${occList(done, '완료한 할 일이 없습니다.', { date: 1 })}</section></div>`;
  }
  function vRecurring() {
    const rs = live().filter(i => i.rule && i.rule.freq).sort((a, b) => a.title.localeCompare(b.title));
    return `<p class="small muted">반복 규칙 전체를 바꾸려면 「규칙 수정」, 하루만 바꾸려면 달력에서 그 날의 일정을 눌러 「이 회차만」을 고르세요.</p>
      <div class="card"><ul class="list" id="pc-rlist">${rs.map(i => { const n = C().next(i); return `<li><span class="pdot" style="background:${esc(i.color)}"></span> <b>${esc(MW.sec.show(i.title))}</b> <span class="chip">${esc(C().ruleText(i))}</span>
        <div class="small muted">${i.allDay ? '종일' : esc(i.startTime)} · 시작 ${esc(i.start)} · 다음 ${n ? esc(C().label(n.start)) : '없음(종료됨)'}${(i.exdates || []).length ? ` · 뺀 날 ${i.exdates.length}` : ''}${Object.keys(i.overrides || {}).length ? ` · 따로 고친 날 ${Object.keys(i.overrides).length}` : ''} · 알림 ${(i.alarms || []).map(m => C().alarmText(m, i.allDay)).join(', ') || '없음'}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-edit="${i.id}">규칙 수정</button><button class="btn sm danger" data-delall="${i.id}">반복 전체 삭제</button></div></li>`; }).join('') || '<li class="muted">반복 일정이 없습니다.</li>'}</ul></div>`;
  }
  function vSearch() {
    const sq = MW.search.words(S.q).map(MW.search.squash);
    const res = sq.length ? live().filter(i => { const s = MW.search.squash([i.title, i.desc, i.location, i.memo, i.category].join(' ')); return sq.every(k => s.includes(k)); }) : [];
    return `<form class="toolbar" id="pc-sform"><input type="search" id="pc-q" value="${esc(S.q)}" placeholder="일정명·장소·설명·메모" aria-label="일정 검색" style="flex:1"><button class="btn primary">검색</button></form>
      ${sq.length ? `<p id="pc-scount"><b>${res.length}</b>건</p>` : '<p class="muted small">검색어를 입력하세요. 띄어쓰기가 달라도 찾습니다.</p>'}
      <div class="card" ${res.length ? '' : 'hidden'}><ul class="list" id="pc-sres">${res.map(i => { const n = C().next(i) || C().expand(i, i.start, i.end || i.start)[0]; return `<li><button type="button" class="ttl" data-occ="${esc(n ? n.key : i.id + '|' + i.start)}">${MW.search.mark(MW.sec.show(i.title), S.q, esc)}</button> <span class="small muted">${n ? esc(C().label(n.start, { year: 1 })) + ' ' + esc(timeOf(n)) : ''}${i.rule && i.rule.freq ? ' · 🔁 ' + esc(C().ruleText(i)) : ''}</span>${i.location || i.desc ? `<div class="small muted">${MW.search.mark(MW.sec.show([i.location, i.desc].filter(Boolean).join(' · ')).slice(0, 120), S.q, esc)}</div>` : ''}</li>`; }).join('')}</ul></div>`;
  }
  function vTrash() {
    const ds = st.items.filter(i => i.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return `<p class="small muted">삭제한 개인 일정입니다. 복구하거나 영구 삭제할 수 있습니다.</p><div class="card"><ul class="list" id="pc-trash">${ds.map(i => `<li><b>${esc(MW.sec.show(i.title))}</b> <span class="small muted">${esc(i.start)} · 삭제 ${esc(MW.docs.fmt(i.deletedAt))}</span><div class="row" style="margin-top:6px"><button class="btn sm" data-restore="${i.id}">복구</button><button class="btn sm danger" data-purge="${i.id}">영구 삭제</button></div></li>`).join('') || '<li class="muted">휴지통이 비어 있습니다.</li>'}</ul></div>`;
  }

  /* ---------- 휴대폰으로 보내기 (ICS) ---------- */
  const lastExport = () => { const m = {}; st.exports.filter(x => x.method !== 'intent').sort((a, b) => a.at.localeCompare(b.at)).forEach(x => x.items.forEach(r => { m[r.id] = { version: r.version, at: x.at }; })); return m; };
  const gLinked = it => !!(it.sync && it.sync.google && it.sync.google.eventId && !it.sync.google.remoteDeleted);
  const exportState = it => {
    if (gLinked(it)) return it.version === it.sync.google.syncedVersion ? 'google' : 'google-pending';   // Google 동기화로 휴대폰에 들어가는 일정
    const h = lastExport()[it.id]; return !h ? 'never' : h.version === it.version ? 'same' : 'modified';
  };
  const isAndroid = () => MW.personal._forceAndroid || /Android/i.test(navigator.userAgent);
  const onlineOk = () => /^https:$/.test(location.protocol) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  /* 아직 휴대폰 캘린더에 넣지 않은 일정(오늘 이후 회차가 있는 것): 보낸 적 없음 + 보낸 뒤 수정됨 */
  function pendingPhone() {
    const t = C().today();
    return live().filter(i => !blocked(i) && ['never', 'modified'].includes(exportState(i)) && !(i.type === 'task' && !(i.rule && i.rule.freq) && i.done) && C().expand(i, t, C().addDays(t, 400)).length)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  const pendingCard = () => {
    if (st.meta.deviceRole === 'admin-pc') return '';
    const n = pendingPhone().length;
    return n ? `<div class="notice info small ppend"><span>휴대폰 캘린더에 아직 넣지 않은 일정 <b class="pp-n">${n}</b>건</span> <button type="button" class="btn sm primary" data-sendall="1">한 번에 보내기</button></div>` : '';
  };
  function sendPending() { const l = pendingPhone(); if (!l.length) return MW.ui.toast('휴대폰 캘린더에 보낼 일정이 없습니다.'); exportFlow(l, '아직 휴대폰에 넣지 않은 일정'); }
  async function recordExport(list, method, label, filename) {
    const rec = { id: 'x_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: nowIso(), filename: filename || '', method, label, items: list.map(i => ({ id: i.id, version: i.version })) };
    try { await MW.pdb.put('exports', rec); st.exports.push(rec); } catch (e) { MW.ui.toast('내보내기 이력을 저장하지 못했습니다: ' + e.message, true); }
  }
  const blocked = it => it.origin === 'onenote' && !it.exportConfirmed;
  const EF = { from: '', to: '' };
  function vExport() {
    const t = C().today(); EF.from = EF.from || t; EF.to = EF.to || C().addDays(t, 30);
    const its = live().filter(i => C().expand(i, EF.from, EF.to).length).sort((a, b) => a.start.localeCompare(b.start));
    const lab = { never: '<span class="chip">보낸 적 없음</span>', same: '<span class="chip c-ok">보냄</span>', modified: '<span class="chip c-warn">보낸 뒤 수정됨</span>', google: '<span class="chip c-ok">Google 동기화됨</span>', 'google-pending': '<span class="chip c-warn">Google 동기화 대기</span>' };
    return `<div class="notice info small"><b>갤럭시 알림 받는 방법</b>
      <ol style="margin:6px 0 0;padding-left:20px"><li>아래에서 일정을 골라 「ICS 파일 만들기」를 누릅니다.</li><li>휴대폰에서 받은 <b>.ics 파일을 열고 삼성 캘린더를 선택</b>합니다.</li><li>저장할 캘린더로 <b>개인 Google 계정 캘린더</b>를 고르면 Google 캘린더에도 함께 저장됩니다(삼성 계정·내 휴대폰 캘린더에 저장하면 Google에는 가지 않습니다).</li><li>삼성 캘린더에서 일정과 알림 시간이 맞게 들어왔는지 확인합니다.</li></ol>
      파일을 만드는 것만으로는 휴대폰에 등록되지 않습니다. 기종·삼성 캘린더 버전에 따라 가져오기 방법이 다를 수 있어 <b>실기기 확인이 필요</b>합니다.</div>
      ${st.meta.deviceRole === 'admin-pc' ? '<div class="notice bad small">이 기기는 <b>행정 PC</b>로 설정되어 있습니다. 행정 PC에서 만든 파일을 개인 휴대폰으로 옮기는 것은 기관 보안정책에 따라 제한될 수 있습니다. 가능하면 휴대폰에서 직접 일정을 입력하고 내보내세요.</div>' : ''}
      ${pendingCard()}
      <div class="toolbar"><label class="small">기간 <input type="date" id="ex-from" value="${EF.from}"> ~ <input type="date" id="ex-to" value="${EF.to}"></label><button class="btn" id="ex-all">이 기간 일정 모두 선택</button><button class="btn" id="ex-none">선택 해제</button></div>
      <div class="card"><ul class="list" id="ex-list">${its.map(i => `<li class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" data-ex="${i.id}" ${blocked(i) ? 'disabled' : ''} style="flex:none;margin-top:4px" aria-label="${esc(i.title)} 선택">
        <div><b>${esc(MW.sec.show(i.title))}</b> ${lab[exportState(i)]} ${blocked(i) ? '<span class="chip c-bad">원노트 자료 · 내보내기 확인 전</span>' : ''}<div class="small muted">${esc(i.start)} ${esc(i.allDay ? '종일' : i.startTime)}${i.rule && i.rule.freq ? ' · 🔁 ' + esc(C().ruleText(i)) + ' (반복 규칙 전체가 들어감)' : ''} · 알림 ${(i.alarms || []).length}개</div></div></li>`).join('') || '<li class="muted">이 기간에 일정이 없습니다.</li>'}</ul>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="ex-go">선택한 일정 ICS 파일 만들기</button><span class="small muted" id="ex-n">선택 0건</span></div></div>
      <h2 style="margin-top:18px">내보내기 이력</h2><div class="card"><ul class="list" id="ex-hist">${st.exports.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20).map(x => `<li>${esc(MW.docs.fmt(x.at))} · ${x.items.length}건 · <span class="small muted">${esc(x.filename)}</span></li>`).join('') || '<li class="muted">아직 없습니다.</li>'}</ul>
        <p class="small muted">「보냄」은 파일을 만들었다는 기록일 뿐, 휴대폰에 등록됐는지는 앱이 알 수 없습니다.</p></div>`;
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  /* 내보낼 일정을 확인하는 창: 이미 보낸 일정·수정된 일정·제외된 일정을 알려 주고 사용자가 고르게 함 */
  function exportFlow(items, label) {
    const ok = items.filter(i => !i.deletedAt && !blocked(i)), excl = items.length - ok.length;
    const same = ok.filter(i => exportState(i) === 'same'), mod = ok.filter(i => exportState(i) === 'modified');
    if (!ok.length) return MW.ui.toast(excl ? '원노트에서 가져온 일정은 「내보내기 확인」을 한 뒤에만 보낼 수 있습니다.' : '내보낼 일정이 없습니다.', true);
    MW.ui.modal(`<h2>ICS 파일 만들기</h2><p>${esc(label)} <b id="xf-count">${ok.length}</b>건</p>
      ${excl ? `<div class="notice small">원노트에서 가져와 아직 확인하지 않은 일정 ${excl}건은 제외했습니다.</div>` : ''}
      ${same.length ? `<div class="notice small"><b>이미 보낸 일정 ${same.length}건</b>이 들어 있습니다. 같은 파일을 휴대폰에서 다시 가져오면 일정이 <b>두 번 등록</b>될 수 있습니다.<label class="row" style="margin-top:6px;font-weight:400"><input type="checkbox" id="xf-same"> 이미 보낸 일정도 다시 포함</label></div>` : ''}
      ${mod.length ? `<div class="notice small"><b>보낸 뒤 수정한 일정 ${mod.length}건</b>: 휴대폰에 있는 이전 일정이 자동으로 바뀌는지는 삼성 캘린더 버전에 따라 다릅니다(실기기 확인 필요). 중복을 피하려면 휴대폰에서 이전 일정을 지운 뒤 새 파일을 가져오세요.</div>` : ''}
      ${st.meta.deviceRole === 'admin-pc' ? '<label class="row notice bad small" style="font-weight:400"><input type="checkbox" id="xf-admin"> 행정 PC에서 만든 파일을 휴대폰으로 옮겨도 되는지 기관 보안정책을 확인했습니다.</label>' : ''}
      <p class="small muted">파일에는 일정명·시간·장소·설명·메모·알림이 들어갑니다. 업무 자료는 들어가지 않습니다.</p>
      <div class="row"><button class="btn primary" id="xf-go">파일 내려받기</button><button class="btn" id="xf-share" hidden>공유하기</button><button class="btn" id="xf-intent" hidden>Google 캘린더에 바로 추가</button></div>
      <p class="small muted" id="xf-tip" hidden>내려받은 파일은 화면 위 알림창이나 「내 파일 › 다운로드」에서 눌러 열고 삼성 캘린더를 고르면 됩니다.</p>`);
    const $ = id => document.getElementById(id), final = () => ok.filter(i => exportState(i) !== 'same' || ($('xf-same') && $('xf-same').checked));
    const canIntent = isAndroid() && st.meta.deviceRole !== 'admin-pc';
    const upd = () => { const n = final().length; $('xf-count').textContent = n; $('xf-intent').hidden = !(canIntent && n === 1); };
    if ($('xf-same')) $('xf-same').onchange = upd; upd();
    const go = async share => {
      if ($('xf-admin') && !$('xf-admin').checked) return MW.ui.toast('행정 PC 확인란을 먼저 체크해 주세요. 확인 전에는 파일을 만들지 않습니다.', true);
      const list = final();
      if (!list.length) return MW.ui.toast('내보낼 일정이 없습니다. (이미 보낸 일정만 남았습니다)', true);
      const now = C().now(), name = `my-personal-${now.date.replace(/-/g, '')}-${now.time.replace(':', '')}.ics`, text = C().toICS(list);
      let method = share ? 'share' : 'ics', fellBack = false;
      try {
        if (share) await navigator.share({ files: [new File([text], name, { type: 'text/calendar' })], title: 'MY WORKSPACE 개인 일정' });
        else download(name, text, 'text/calendar;charset=utf-8');
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        if (!share) return MW.ui.toast('파일을 만들지 못했습니다: ' + e.message, true);
        /* 일부 브라우저(삼성 인터넷 등)는 .ics 파일 공유를 막음 → 이 기기에서는 공유 버튼을 숨기고 내려받기로 대신함 */
        try { localStorage.setItem('mw-noshare-ics', '1'); } catch (_) { /* 저장 불가 */ }
        try { download(name, text, 'text/calendar;charset=utf-8'); } catch (e2) { return MW.ui.toast('파일을 만들지 못했습니다: ' + e2.message, true); }
        method = 'ics'; fellBack = true;
      }
      await recordExport(list, method, label, name);
      MW.ui.closeModal();
      MW.ui.toast(fellBack
        ? `이 브라우저는 일정 파일 공유를 지원하지 않아 대신 파일(${list.length}건)을 내려받았습니다. 알림창이나 「내 파일 › 다운로드」에서 파일을 열고 삼성 캘린더를 골라야 등록됩니다.`
        : `ICS 파일(${list.length}건)을 만들었습니다. 휴대폰에서 파일을 열어 삼성 캘린더로 가져와야 일정과 알림이 등록됩니다.`);
      MW.app.refreshSoon(); if (location.hash.startsWith('#/cal')) render(document.getElementById('view'), { q: { v: S.v } });
    };
    $('xf-go').onclick = () => go(false);
    let noShare = false; try { noShare = localStorage.getItem('mw-noshare-ics') === '1'; } catch (_) { /* 저장소 불가 */ }
    try { const f = new File(['x'], 'a.ics', { type: 'text/calendar' }); if (!noShare && navigator.canShare && navigator.canShare({ files: [f] })) { $('xf-share').hidden = false; $('xf-share').onclick = () => go(true); } } catch (_) { /* 공유 미지원 */ }
    if (isAndroid()) $('xf-tip').hidden = false;
    $('xf-intent').onclick = () => {
      if ($('xf-admin') && !$('xf-admin').checked) return MW.ui.toast('행정 PC 확인란을 먼저 체크해 주세요.', true);
      const cur = final()[0]; if (cur) quickAdd(cur);
    };
  }
  /* Google 캘린더 바로 추가: 링크를 열기만 하고, 사용자가 「저장했습니다」를 눌러야 보냄으로 기록 */
  function quickAdd(cur) {
    const url = C().gcalUrl(cur);
    MW.personal._lastLink = url;
    if (!MW.personal._noNavigate) window.open(url, '_blank', 'noopener');
    MW.ui.modal(`<h2>Google 캘린더에 추가</h2>
      <p>Google 캘린더 화면에서 <b>계정(개인 Google)</b>을 확인하고 <b>저장</b>을 누른 뒤 돌아와 주세요.</p>
      <p class="small muted">저장했는지는 앱이 알 수 없으므로, 아래 버튼을 눌러야 「보냄」으로 기록됩니다. 알림은 Google 캘린더 기본 알림이 적용됩니다.</p>
      <div class="row"><button class="btn primary" id="qa-yes">저장했습니다</button><button class="btn" id="qa-no">저장하지 않았습니다</button></div>
      <p class="small muted">화면이 열리지 않았으면 <a href="${esc(url)}" target="_blank" rel="noopener" id="qa-open">여기를 눌러 다시 열기</a></p>`);
    document.getElementById('qa-yes').onclick = async () => {
      await recordExport([cur], 'gcal-link', 'Google 캘린더 바로 추가 1건');
      MW.ui.closeModal(); MW.ui.toast('「보냄」으로 기록했습니다. 삼성 캘린더에 일정이 들어왔는지 확인해 주세요.');
      MW.app.refreshSoon(); if (location.hash.startsWith('#/cal')) render(document.getElementById('view'), { q: { v: S.v } });
    };
    document.getElementById('qa-no').onclick = () => { MW.ui.closeModal(); MW.ui.toast('기록하지 않았습니다. 「보낸 적 없음」으로 남아 있습니다.'); };
  }
  /* 삼성 리마인더: 공개 API가 없어 직접 등록하지 않음. 휴대폰의 「공유」로 리마인더 앱에 보내거나 글을 복사 */
  async function shareReminder(o) {
    const text = [o.title, (o.allDay ? C().label(o.start, { year: 1 }) : C().label(o.start, { year: 1 }) + ' ' + o.startTime), o.location ? '장소: ' + o.location : '', o.desc || ''].filter(Boolean).join('\n');
    if (navigator.share) { try { await navigator.share({ title: o.title, text }); return MW.ui.toast('공유 창에서 「Reminder(리마인더)」를 고르면 리마인더가 만들어집니다. 알림 시간은 리마인더 앱에서 정해 주세요.'); } catch (e) { if (e && e.name === 'AbortError') return; } }
    await MW.ui.copy(text); MW.ui.toast('내용을 복사했습니다. 삼성 리마인더 앱에 붙여 넣으세요.');
  }

  /* ---------- 원노트 월간 일정에서 개인 일정 후보 ---------- */
  const monthlyPages = () => ((MW.state && MW.state.pages) || []).filter(p => p.type === 'monthly' && /^\d{4}-\d{2}$/.test(p.date || ''));
  const hasCandidates = () => monthlyPages().length > 0;
  function candidates() {
    const out = [], seen = new Map();
    monthlyPages().forEach(p => p.blocks.forEach(b => b.children.forEach(c => {
      if (c.type !== 'table' || !c.rows.length || c.rows[0][0] !== '일') return;
      c.rows.slice(1).forEach(r => r.forEach(cell => {
        const lines = String(cell).split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return;
        const m = /^(\d{1,2})\s*(.*)$/.exec(lines[0]); if (!m) return;
        const day = +m[1], [y, mo] = p.date.split('-').map(Number); if (day < 1 || day > C().daysIn(y, mo)) return;
        const texts = (m[2] ? [m[2]] : []).concat(lines.slice(1));
        texts.forEach(tx => {
          const date = `${y}-${C().pad(mo)}-${C().pad(day)}`, k = date + '|' + MW.search.squash(tx);
          if (seen.has(k)) { seen.get(k).pages.push(p.section + ' / ' + p.title); return; }   // 같은 달 페이지가 두 개인 경우 중복 후보 제거
          const c = { id: 'e_on_' + MW.importer.hash('onenote-cal|' + k), date, text: tx, pageId: p.id, pageTitle: p.section + ' / ' + p.title, pages: [p.section + ' / ' + p.title] };
          seen.set(k, c); out.push(c);
        });
      }));
    })));
    return out;
  }
  function vOnenote() {
    const cs = candidates(), have = new Set(st.items.map(i => i.id)), by = {};
    cs.forEach(c => (by[c.date.slice(0, 7)] = by[c.date.slice(0, 7)] || []).push(c));
    return `<div class="notice small">원노트 「월간 일정」 표에서 찾은 개인 일정 후보입니다(${cs.length}건). <b>이 기기 안에서만</b> 개인 일정으로 추가됩니다.
      원노트는 업무 기록이므로, 추가한 일정은 「내보내기 확인」을 직접 체크하기 전에는 휴대폰용 파일에 들어가지 않습니다. 당직 등 업무 일정은 추가하지 않는 것을 권장합니다.</div>
      ${Object.keys(by).sort().reverse().map(m => `<details class="card" style="margin-bottom:10px"><summary><b>${esc(m)}</b> <span class="muted small">${by[m].length}건</span></summary><ul class="list" id="on-${m}">${by[m].map(c => `<li class="row" style="flex-wrap:nowrap"><span style="flex:1"><span class="small muted">${esc(c.date.slice(5))}</span> ${esc(MW.sec.show(c.text))}</span>${have.has(c.id) ? '<span class="chip c-ok">추가됨</span>' : `<button class="btn sm" data-cand="${c.id}">추가</button>`}</li>`).join('')}</ul></details>`).join('') || '<div class="card muted">월간 일정 후보가 없습니다.</div>'}`;
  }

  /* ---------- 일정 입력·수정 창 ---------- */
  const PRESETS = [['none', '반복 없음'], ['daily', '매일'], ['weekdays', '평일(월~금)'], ['weekly', '매주'], ['weekly-days', '매주 특정 요일'], ['monthly', '매월 특정 날짜'], ['yearly', '매년'], ['custom', '사용자 지정']];
  const presetOf = it => { const r = it.rule; if (!r || !r.freq) return 'none'; if (r.preset) return r.preset; return r.interval > 1 ? 'custom' : r.freq === 'weekly' ? 'weekly-days' : r.freq; };
  function blank(type, date) {
    const t = C().now(), h = Math.min(23, +t.time.slice(0, 2) + 1);
    return { id: rid(), type: type || 'event', title: '', desc: '', location: '', memo: '', allDay: type === 'task', start: date || t.date, startTime: type === 'task' ? '' : C().pad(h) + ':00', end: date || t.date, endTime: type === 'task' ? '' : C().pad(Math.min(23, h + 1)) + ':00',
      category: type === 'task' ? '개인 할 일' : '개인 약속', priority: '보통', color: COLORS[0][0], rule: null, exdates: [], overrides: {}, alarms: type === 'task' ? [-540] : [10], done: false, origin: 'user', exportConfirmed: true, sync: { google: null, error: null }, deletedAt: null };
  }
  function openEditor(arg) {
    const isNew = !arg.id, base = isNew ? blank(arg.type, arg.date) : st.items.find(x => x.id === arg.id);
    if (!base) return MW.ui.toast('일정을 찾을 수 없습니다.', true);
    const it = clone(base), occ = arg.orig && it.rule && it.rule.freq ? findOcc(it.id + '|' + arg.orig) : null;
    const v = occ ? Object.assign({}, it, { title: occ.title, start: occ.start, end: occ.end, startTime: occ.startTime, endTime: occ.endTime, location: occ.location, desc: occ.desc, done: occ.done }) : it;
    const h = !isNew && exportState(it), hist = lastExport()[it.id];
    const opt = (arr, cur) => arr.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(cur) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('');
    MW.ui.modal(`<h2>${isNew ? (it.type === 'task' ? '새 할 일' : '새 일정') : (it.type === 'task' ? '할 일' : '일정')} ${!isNew && it.origin === 'onenote' ? '<span class="chip">원노트 후보</span>' : ''}</h2>
      ${occ ? `<div class="notice small" id="pe-scopebox"><b>반복 일정입니다.</b> 어디까지 바꿀까요?<div class="row" style="margin-top:6px"><label class="row" style="font-weight:400"><input type="radio" name="pe-scope" value="one" checked> 이 회차만 (${esc(C().label(arg.orig))})</label><label class="row" style="font-weight:400"><input type="radio" name="pe-scope" value="all"> 반복 전체</label></div></div>` : ''}
      <div id="pe-err" class="notice bad small" hidden></div><div id="pe-warn" class="notice small" hidden></div>
      <div class="pform">
        <div class="seg" role="radiogroup" aria-label="종류"><button type="button" class="btn ${it.type === 'event' ? 'on' : ''}" data-type="event">일정</button><button type="button" class="btn ${it.type === 'task' ? 'on' : ''}" data-type="task">할 일</button></div>
        <label for="pe-title">${it.type === 'task' ? '할 일' : '일정명'}</label><input id="pe-title" value="${esc(v.title)}" placeholder="예: 치과 예약" autocomplete="off">
        <div class="pdt"><label class="row" style="font-weight:400"><input type="checkbox" id="pe-allday" ${it.allDay ? 'checked' : ''}> 종일</label>
          <div class="pdt-row"><span class="pdt-l">${it.type === 'task' ? '마감' : '시작'}</span><input type="date" id="pe-sd" value="${esc(v.start)}" aria-label="시작 날짜"><input type="time" id="pe-st" value="${esc(v.startTime || '')}" aria-label="시작 시간" ${it.allDay ? 'hidden' : ''}></div>
          <div class="row pquick">${[['0', '오늘'], ['1', '내일'], ['2', '모레'], ['7', '다음 주']].map(q => `<button type="button" class="chip" data-qd="${q[0]}">${q[1]}</button>`).join('')}<span class="ptq" ${it.allDay ? 'hidden' : ''}>${['09:00', '12:00', '14:00', '18:00'].map(q => `<button type="button" class="chip" data-qt="${q}">${q}</button>`).join('')}</span></div>
          <div class="pdt-row" ${it.type === 'task' ? 'hidden' : ''} id="pe-endrow"><span class="pdt-l">종료</span><input type="date" id="pe-ed" value="${esc(v.end || v.start)}" aria-label="종료 날짜"><input type="time" id="pe-et" value="${esc(v.endTime || '')}" aria-label="종료 시간" ${it.allDay ? 'hidden' : ''}></div></div>
        <label for="pe-loc">장소</label><input id="pe-loc" value="${esc(v.location || '')}" autocomplete="off">
        <label for="pe-desc">상세 설명</label><textarea id="pe-desc" rows="2">${esc(v.desc || '')}</textarea>
        <div class="row pmeta"><label class="small">카테고리 <select id="pe-cat">${opt(CATS, it.category)}</select></label><label class="small">중요도 <select id="pe-prio">${opt(PRIO, it.priority)}</select></label></div>
        <div class="pcolors" role="radiogroup" aria-label="색상">${COLORS.map(c => `<label title="${c[1]}"><input type="radio" name="pe-color" value="${c[0]}" ${it.color === c[0] ? 'checked' : ''}><span style="background:${c[0]}"></span><b class="sr">${c[1]}</b></label>`).join('')}</div>
        <div id="pe-allonly">
          <label for="pe-rule">반복</label><select id="pe-rule">${opt(PRESETS, presetOf(it))}</select>
          <div id="pe-rulebox" class="mbox" hidden></div>
          <label>알림 <span class="small muted">(최대 5개)</span></label><div id="pe-alarms" class="row"></div>
          <div class="row"><select id="pe-aladd" aria-label="알림 추가"></select><button type="button" class="btn sm" id="pe-aladdbtn">추가</button><input type="number" id="pe-alcustom" min="1" max="40320" placeholder="분 전" style="width:92px" aria-label="사용자 지정 알림(분 전)"><button type="button" class="btn sm" id="pe-alcustombtn">직접 추가</button></div>
        </div>
        <label for="pe-memo">메모</label><textarea id="pe-memo" rows="2">${esc(it.memo || '')}</textarea>
        <label class="row" style="font-weight:400"><input type="checkbox" id="pe-done" ${v.done ? 'checked' : ''}> 완료</label>
        ${it.origin === 'onenote' ? `<label class="row notice small" style="font-weight:400"><input type="checkbox" id="pe-expok" ${it.exportConfirmed ? 'checked' : ''}> 업무 자료가 아닌 개인 일정임을 확인했고, 휴대폰용 파일로 내보내도 됩니다.</label>` : ''}
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="pe-save">저장</button>${isNew ? '' : (occ ? '<button class="btn danger" id="pe-delone">이 회차만 삭제</button><button class="btn danger" id="pe-delall">반복 전체 삭제</button>' : '<button class="btn danger" id="pe-del">삭제</button>')}</div>
      ${isNew ? '' : `<details class="mbox" id="pe-phone" ${['never', 'modified'].includes(h) && st.meta.deviceRole !== 'admin-pc' ? 'open' : ''}><summary><b>휴대폰으로 보내기 · 공유</b> <span class="small muted">${h === 'never' ? '보낸 적 없음' : h === 'same' ? '보냄 ' + esc(MW.docs.fmt(hist.at)) : h === 'google' ? 'Google 동기화됨' : h === 'google-pending' ? 'Google 동기화 대기(다음 동기화 때 반영)' : '보낸 뒤 수정됨 — 다시 보내기 필요'}</span></summary>
        ${isAndroid() && st.meta.deviceRole !== 'admin-pc' ? `<div style="margin-top:8px"><button class="btn primary" id="pe-intent">Google 캘린더에 바로 추가</button>
          <p class="small muted" style="margin:6px 0 0">Google 캘린더의 새 일정 화면이 내용이 채워진 채로 열립니다. 개인 Google 계정으로 저장하면 같은 계정을 쓰는 삼성 캘린더에도 들어옵니다(실기기 확인 필요).${C().linkLimits(it).length ? ' <b>넘어가지 않는 내용:</b> ' + esc(C().linkLimits(it).join(', ')) + ' — 모두 넘기려면 아래 ICS 파일을 쓰세요.' : ''}</p></div>` : '<p class="small muted" style="margin:8px 0 0">「Google 캘린더에 바로 추가」 버튼은 개인 안드로이드 휴대폰에서 보입니다.</p>'}
        <div class="row" style="margin-top:8px"><button class="btn" id="pe-ics">이 일정 ICS 파일 만들기</button><button class="btn" id="pe-rem">리마인더로 공유·복사</button></div>
        <p class="small muted">리마인더: 삼성 리마인더는 공개 연동 기능이 없어 직접 등록하지 않습니다. 휴대폰에서 「공유」 → Reminder를 고르거나 복사해서 붙여 넣으세요(실기기 확인 필요).</p></details>
        <details class="mbox"><summary><b>변경 이력</b></summary><div id="pe-hist" class="small muted">불러오는 중…</div></details>
        <p class="small muted">만든 날 ${esc(MW.docs.fmt(it.createdAt))} · 고친 날 ${esc(MW.docs.fmt(it.updatedAt))} · 버전 ${it.version} · Google 동기화: 연결 안 됨</p>`}`);
    const $ = id => document.getElementById(id), box = $('modal-body');
    let alarms = (it.alarms || []).slice();
    const scope = () => { const r = document.querySelector('input[name=pe-scope]:checked'); return r ? r.value : 'all'; };
    const allDay = () => $('pe-allday').checked;
    function drawAlarms() {
      $('pe-alarms').innerHTML = alarms.slice().sort((a, b) => a - b).map(m => `<span class="chip">${esc(C().alarmText(m, allDay()))} <button type="button" class="alx" data-alx="${m}" aria-label="${esc(C().alarmText(m, allDay()))} 알림 삭제">×</button></span>`).join('') || '<span class="small muted">알림 없음</span>';
      $('pe-aladd').innerHTML = (allDay() ? AL_ALLDAY : AL_TIMED).filter(a => !alarms.includes(a[0])).map(a => `<option value="${a[0]}">${a[1]}</option>`).join('');
    }
    function ruleBox() {
      const p = $('pe-rule').value, rb = $('pe-rulebox'), r = it.rule || {}, sd = $('pe-sd').value, w = C().isDate(sd) ? C().wd(sd) : 1;
      if (p === 'none') { rb.hidden = true; rb.innerHTML = ''; return; }
      const days = r.byDay && r.byDay.length ? r.byDay : [w], md = r.monthDay || (C().isDate(sd) ? +sd.slice(8) : 1);
      const dayBoxes = `<div class="row" role="group" aria-label="요일">${[1, 2, 3, 4, 5, 6, 0].map(i => `<label class="row" style="font-weight:400"><input type="checkbox" data-bd="${i}" ${days.includes(i) ? 'checked' : ''}> ${C().WD_KO[i]}</label>`).join('')}</div>`;
      const unit = r.freq && ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : 'weekly';
      rb.hidden = false;
      rb.innerHTML = (p === 'custom' ? `<div class="row"><input type="number" id="pr-iv" min="1" max="99" value="${r.interval || 1}" style="width:72px" aria-label="간격"><select id="pr-unit" aria-label="단위">${opt([['daily', '일마다'], ['weekly', '주마다'], ['monthly', '개월마다'], ['yearly', '년마다']], unit)}</select></div>` : '') +
        (p === 'weekly-days' || (p === 'custom' && unit === 'weekly') ? dayBoxes : '') +
        (p === 'monthly' || (p === 'custom' && unit === 'monthly') ? `<label class="small">매월 <input type="number" id="pr-md" min="1" max="31" value="${md}" style="width:72px"> 일</label>` : '') +
        `<div class="row" style="margin-top:6px"><label class="row small" style="font-weight:400"><input type="radio" name="pr-end" value="never" ${!r.until && !r.count ? 'checked' : ''}> 계속</label>
          <label class="row small" style="font-weight:400"><input type="radio" name="pr-end" value="until" ${r.until ? 'checked' : ''}> 날짜까지 <input type="date" id="pr-until" value="${esc(r.until || '')}"></label>
          <label class="row small" style="font-weight:400"><input type="radio" name="pr-end" value="count" ${r.count ? 'checked' : ''}> <input type="number" id="pr-count" min="1" max="999" value="${r.count || 10}" style="width:72px"> 회</label></div>`;
      const pu = $('pr-unit'); if (pu) pu.onchange = () => { it.rule = Object.assign({}, readRule() || {}, { freq: pu.value }); ruleBox(); };
    }
    function readRule() {
      const p = $('pe-rule').value; if (p === 'none') return null;
      const sd = $('pe-sd').value, w = C().isDate(sd) ? C().wd(sd) : 1, bd = [...box.querySelectorAll('[data-bd]:checked')].map(x => +x.dataset.bd);
      const r = { preset: p, interval: 1 };
      if (p === 'daily' || p === 'weekdays' || p === 'yearly') r.freq = p;
      else if (p === 'weekly') { r.freq = 'weekly'; r.byDay = [w]; }
      else if (p === 'weekly-days') { r.freq = 'weekly'; r.byDay = bd; }
      else if (p === 'monthly') { r.freq = 'monthly'; r.monthDay = +($('pr-md') ? $('pr-md').value : sd.slice(8)); }
      else { r.freq = $('pr-unit') ? $('pr-unit').value : 'weekly'; r.interval = parseInt($('pr-iv') ? $('pr-iv').value : 1, 10) || 0; if (r.freq === 'weekly') r.byDay = bd; if (r.freq === 'monthly') r.monthDay = +($('pr-md') ? $('pr-md').value : sd.slice(8)); }
      const end = box.querySelector('input[name=pr-end]:checked'), ev = end ? end.value : 'never';
      if (ev === 'until') r.until = $('pr-until').value || 'invalid';
      if (ev === 'count') r.count = parseInt($('pr-count').value, 10) || 0;
      return r;
    }
    function applyType(t) {
      it.type = t; box.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('on', b.dataset.type === t));
      $('pe-endrow').hidden = t === 'task'; box.querySelector('label[for=pe-title]').textContent = t === 'task' ? '할 일' : '일정명';
      box.querySelector('.pdt-l').textContent = t === 'task' ? '마감' : '시작';
    }
    const scopeUi = () => { const one = scope() === 'one'; $('pe-allonly').hidden = one; $('pe-allday').disabled = one; box.querySelectorAll('[data-type]').forEach(b => { b.disabled = one; }); };
    drawAlarms(); ruleBox(); if (occ) { scopeUi(); box.querySelectorAll('input[name=pe-scope]').forEach(r => { r.onchange = scopeUi; }); }
    $('pe-rule').onchange = () => { it.rule = null; ruleBox(); };
    /* 시작 날짜·시간을 바꾸면 종료 날짜·시간도 같은 간격만큼 옮겨 일정 길이를 유지 (다른 캘린더 앱과 같은 방식) */
    const absM = (d, t) => C().dn(d) * 1440 + (C().isTime(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : 0);
    let lastS = { d: $('pe-sd').value, t: $('pe-st').value };
    function followEnd() {
      const sd = $('pe-sd').value, stt = $('pe-st').value, ed = $('pe-ed').value, et = $('pe-et').value, ad = allDay();
      if (!C().isDate(sd)) return;
      if (C().isDate(lastS.d) && C().isDate(ed)) {
        if (!ad && C().isTime(stt) && C().isTime(lastS.t) && C().isTime(et)) {
          const m = absM(ed, et) + absM(sd, stt) - absM(lastS.d, lastS.t), d0 = Math.floor(m / 1440), mm = m - d0 * 1440;
          $('pe-ed').value = C().ds(d0); $('pe-et').value = C().pad(Math.floor(mm / 60)) + ':' + C().pad(mm % 60);
        } else $('pe-ed').value = C().addDays(ed, C().dn(sd) - C().dn(lastS.d));
      }
      if (!C().isDate($('pe-ed').value) || $('pe-ed').value < sd) $('pe-ed').value = sd;
      if (!ad && C().isTime(stt) && $('pe-ed').value === sd && (!C().isTime($('pe-et').value) || $('pe-et').value <= stt)) {
        const m = Math.min(23 * 60 + 59, absM(sd, stt) - C().dn(sd) * 1440 + 60); $('pe-et').value = C().pad(Math.floor(m / 60)) + ':' + C().pad(m % 60);
      }
      lastS = { d: sd, t: stt };
    }
    $('pe-sd').onchange = () => { followEnd(); if (['weekly', 'monthly'].includes($('pe-rule').value)) { it.rule = null; ruleBox(); } };
    $('pe-st').onchange = followEnd;
    $('pe-allday').onchange = () => { const a = allDay(); $('pe-st').hidden = a; $('pe-et').hidden = a; box.querySelector('.ptq').hidden = a; alarms = a ? [-540] : [10]; drawAlarms(); lastS = { d: $('pe-sd').value, t: $('pe-st').value }; };
    box.onclick = async e => {
      const t = e.target;
      if (t.dataset.type && !t.disabled) return applyType(t.dataset.type);
      if (t.dataset.qd !== undefined) { $('pe-sd').value = C().addDays(C().today(), +t.dataset.qd); $('pe-sd').onchange(); return; }
      if (t.dataset.qt) { $('pe-st').value = t.dataset.qt; $('pe-st').onchange(); return; }
      if (t.dataset.alx !== undefined) { alarms = alarms.filter(m => m !== +t.dataset.alx); return drawAlarms(); }
      if (t.id === 'pe-aladdbtn') { const v2 = $('pe-aladd').value; if (v2 === '') return; if (alarms.length >= 5) return MW.ui.toast('알림은 5개까지 설정할 수 있습니다.', true); alarms.push(+v2); return drawAlarms(); }
      if (t.id === 'pe-alcustombtn') { const n = parseInt($('pe-alcustom').value, 10); if (!(n >= 1 && n <= 40320)) return MW.ui.toast('1~40320분(4주) 사이로 입력해 주세요.', true); if (alarms.length >= 5) return MW.ui.toast('알림은 5개까지 설정할 수 있습니다.', true); if (!alarms.includes(n)) alarms.push(n); $('pe-alcustom').value = ''; return drawAlarms(); }
    };
    const showErr = arr => { $('pe-err').hidden = !arr.length; $('pe-err').innerHTML = arr.map(x => esc(x)).join('<br>'); if (arr.length) $('pe-err').scrollIntoView({ block: 'nearest' }); };
    $('pe-save').onclick = async () => {
      const f = { title: $('pe-title').value.trim(), start: $('pe-sd').value, startTime: allDay() ? '' : $('pe-st').value, end: it.type === 'task' ? $('pe-sd').value : $('pe-ed').value, endTime: allDay() || it.type === 'task' ? '' : $('pe-et').value, location: $('pe-loc').value.trim(), desc: $('pe-desc').value, done: $('pe-done').checked };
      if (occ && scope() === 'one') {
        const chk = C().validate(Object.assign({}, it, f, { rule: null, alarms: [] }));
        if (chk.length) return showErr(chk);
        const o = {}; ['title', 'start', 'startTime', 'end', 'endTime', 'location', 'desc'].forEach(k => { const orig = k === 'start' ? arg.orig : k === 'end' ? C().addDays(arg.orig, C().dn(it.end || it.start) - C().dn(it.start)) : it[k]; if ((f[k] || '') !== (orig || '')) o[k] = f[k]; });
        if (f.done !== false) o.done = f.done;
        it.overrides = Object.assign({}, it.overrides); if (Object.keys(o).length) it.overrides[arg.orig] = o; else delete it.overrides[arg.orig];
      } else {
        Object.assign(it, f, { allDay: allDay(), category: $('pe-cat').value, priority: $('pe-prio').value, color: (box.querySelector('input[name=pe-color]:checked') || {}).value || COLORS[0][0], memo: $('pe-memo').value, alarms: alarms.slice().sort((a, b) => a - b), rule: readRule() });
        if (occ) {                                                  // 반복 전체: 날짜를 바꾸면 전체 회차를 같은 날수만큼 옮김
          const base0 = st.items.find(x => x.id === it.id), delta = C().dn(f.start) - C().dn(occ.start);
          it.start = C().addDays(base0.start, delta); it.end = C().addDays(it.start, Math.max(0, C().dn(f.end || f.start) - C().dn(f.start)));
          if (delta) { it.exdates = (it.exdates || []).map(d => C().addDays(d, delta)); const ov = {}; Object.keys(it.overrides || {}).forEach(k => { ov[C().addDays(k, delta)] = it.overrides[k]; }); it.overrides = ov; }
        }
        if ($('pe-expok')) it.exportConfirmed = $('pe-expok').checked;
        if (it.rule && it.rule.freq && it.type === 'task') it.done = false;
        const chk = C().validate(it); if (chk.length) return showErr(chk);
        const ns = C().normalizeStart(it);
        if (ns) { const shift = C().dn(ns) - C().dn(it.start); it.start = ns; it.end = C().addDays(it.end || ns, shift); MW.ui.toast(`반복 규칙에 맞게 시작 날짜를 ${C().label(ns)}(으)로 맞췄습니다.`); }
        if (isNew) {
          const sq = MW.search.squash(it.title), dup = live().find(x => MW.search.squash(x.title) === sq && x.start === it.start && (x.startTime || '') === (it.startTime || ''));
          if (dup && !confirm(`같은 날·같은 시간에 「${dup.title}」 일정이 이미 있습니다. 그래도 저장할까요?`)) return;
        }
      }
      const warn = (occ && scope() === 'one') ? [] : C().warnings(it);
      try { await save(it); } catch (e) { return showErr(['저장하지 못했습니다: ' + e.message + ' (입력한 내용은 창에 그대로 있습니다)']); }
      MW.ui.closeModal(); MW.ui.toast((isNew ? '등록했습니다.' : '저장했습니다.') + (warn.length ? ' ' + warn[0] : ''));
      if (location.hash.startsWith('#/cal')) { if (isNew && it.start) { S.d = it.start; S.sel = it.start; } render(document.getElementById('view'), { q: { v: S.v } }); } else MW.app.refreshSoon();
    };
    const del = async (mode) => {
      if (mode === 'one') { it.exdates = [...new Set((it.exdates || []).concat(arg.orig))]; if (it.overrides) delete it.overrides[arg.orig]; }
      else it.deletedAt = nowIso();
      try { await save(it); } catch (e) { return showErr(['삭제하지 못했습니다: ' + e.message]); }
      MW.ui.closeModal(); MW.ui.toast(mode === 'one' ? '이 회차를 뺐습니다.' : '휴지통으로 옮겼습니다. 「휴지통」에서 복구할 수 있습니다.');
      if (location.hash.startsWith('#/cal')) render(document.getElementById('view'), { q: { v: S.v } }); else MW.app.refreshSoon();
    };
    if ($('pe-del')) $('pe-del').onclick = () => del('all');
    if ($('pe-delall')) $('pe-delall').onclick = () => { if (confirm('반복 일정 전체를 휴지통으로 옮깁니다. 계속할까요?')) del('all'); };
    if ($('pe-delone')) $('pe-delone').onclick = () => del('one');
    if ($('pe-ics')) $('pe-ics').onclick = () => exportFlow([st.items.find(x => x.id === it.id)], '이 일정');
    if ($('pe-intent')) $('pe-intent').onclick = () => {
      const cur = st.items.find(x => x.id === it.id); if (!cur) return;
      if (blocked(cur)) return MW.ui.toast('원노트에서 가져온 일정은 「내보내기 확인」을 체크한 뒤에 보낼 수 있습니다.', true);
      quickAdd(cur);
    };
    if ($('pe-rem')) $('pe-rem').onclick = () => shareReminder(occ || C().expand(it, it.start, it.end || it.start)[0] || it);
    if ($('pe-hist')) MW.pdb.all('history').then(hs => {
      hs = hs.filter(x => x.itemId === it.id).sort((a, b) => b.version - a.version);
      $('pe-hist').innerHTML = hs.length ? `<ul class="list">${hs.map(x => `<li>버전 ${x.version} · ${esc(MW.docs.fmt(x.at))}까지 · ${esc(MW.sec.show(x.snapshot.title))} ${esc(x.snapshot.start)} ${esc(x.snapshot.allDay ? '종일' : x.snapshot.startTime)} <button class="btn sm" data-hrest="${x.id}">이 상태로 되돌리기</button></li>`).join('')}</ul>` : '변경 이력이 없습니다.';
      $('pe-hist').onclick = async e => { const id = e.target.dataset.hrest; if (!id) return; const x = hs.find(y => y.id === id); const back = Object.assign(clone(x.snapshot), { deletedAt: null }); try { await save(back); MW.ui.closeModal(); MW.ui.toast(`버전 ${x.version} 상태로 되돌렸습니다.`); if (location.hash.startsWith('#/cal')) render(document.getElementById('view'), { q: { v: S.v } }); } catch (er) { MW.ui.toast('되돌리지 못했습니다: ' + er.message, true); } };
    }).catch(() => { $('pe-hist').textContent = '변경 이력을 불러오지 못했습니다.'; });
    setTimeout(() => { const el = $('pe-title'); if (isNew && el) el.focus(); }, 30);
  }

  /* ---------- 완료 표시 (회차별) ---------- */
  async function toggleDone(key, done) {
    const o = findOcc(key); if (!o) return;
    const it = clone(o.item);
    if (it.rule && it.rule.freq) { it.overrides = Object.assign({}, it.overrides); it.overrides[o.orig] = Object.assign({}, it.overrides[o.orig], { done }); }
    else it.done = done;
    try { await save(it); } catch (e) { MW.ui.toast('저장하지 못했습니다: ' + e.message, true); }
  }

  /* ---------- 화면 그리기 ---------- */
  function render(view, r) {
    const q = r.q || {};
    if (q.v) S.v = VIEWS.some(v => v[0] === q.v) || q.v === 'onenote' ? q.v : 'today';
    if (q.d && C().isDate(q.d)) { S.d = q.d; if (S.v === 'month') S.sel = q.d; }
    if (!S.d) S.d = C().today();
    if (q.q !== undefined && S.v === 'search') S.q = q.q;
    const body = { today: vToday, month: vMonth, week: vWeek, day: vDay, upcoming: vUpcoming, tasks: vTasks, recurring: vRecurring, search: vSearch, export: vExport, trash: vTrash, onenote: vOnenote }[S.v] || vToday;
    view.innerHTML = `<h1>개인 일정</h1>${banner()}${st.loaded ? tabs() + `<div id="pc-body" class="pc-${S.v}">${body()}</div>` : ''}`;
    if (!st.loaded) return;
    if (q.open) { const it = st.items.find(x => x.id === q.open); if (it) { const n = C().next(it) || C().expand(it, it.start, it.end || it.start)[0]; openEditor({ id: it.id, orig: n && it.rule && it.rule.freq ? n.orig : null }); } }
    const $ = id => document.getElementById(id), re = () => render(view, { q: {} });
    $('pc-add').onclick = () => openEditor({ type: 'event', date: ['month', 'week', 'day'].includes(S.v) ? (S.v === 'month' ? S.sel || S.d : S.d) : null });
    $('pc-addtask').onclick = () => openEditor({ type: 'task', date: S.v === 'day' ? S.d : null });
    const ro = $('pc-role'); if (ro) ro.onclick = async e => { const v = e.target.dataset.role; if (!v) return; st.meta.deviceRole = v; try { await saveMeta(); } catch (er) { MW.ui.toast(er.message, true); } re(); };
    const jump = $('pc-jump'); if (jump) jump.onchange = () => { if (C().isDate(jump.value)) { S.d = jump.value; S.sel = jump.value; re(); } };
    const pb = $('pc-body');
    pb.onclick = async e => {
      const t = e.target, nv = t.closest('[data-nav]');
      if (nv) { const k = +nv.dataset.nav; S.d = k === 0 ? C().today() : S.v === 'month' ? C().addMonths(S.d.slice(0, 8) + '01', k) : C().addDays(S.d, (S.v === 'week' ? 7 : 1) * k); S.sel = k === 0 ? C().today() : null; return re(); }
      const oc = t.closest('[data-occ]'); if (oc) { e.stopPropagation(); const o = findOcc(oc.dataset.occ); if (o) openEditor({ id: o.id, orig: o.recurring ? o.orig : null }); return; }
      if (t.dataset.done) return;
      if (t.closest('[data-sendall]')) return sendPending();
      const ad = t.closest('[data-addon]'); if (ad) return openEditor({ type: 'event', date: ad.dataset.addon });
      const gd = t.closest('[data-goday]'); if (gd) { S.v = 'day'; S.d = gd.dataset.goday; location.hash = '#/cal?v=day&d=' + S.d; return; }
      const cell = t.closest('.mcell'); if (cell) { S.sel = cell.dataset.day; const html = vMonth(); $('pc-body').innerHTML = html; return; }
      if (t.dataset.edit) return openEditor({ id: t.dataset.edit });
      if (t.dataset.delall) { if (!confirm('반복 일정 전체를 휴지통으로 옮깁니다. 계속할까요?')) return; const it = clone(st.items.find(x => x.id === t.dataset.delall)); it.deletedAt = nowIso(); await save(it); MW.ui.toast('휴지통으로 옮겼습니다.'); return re(); }
      if (t.dataset.restore) { const it = clone(st.items.find(x => x.id === t.dataset.restore)); it.deletedAt = null; await save(it); MW.ui.toast('복구했습니다.'); return re(); }
      if (t.dataset.purge) { if (!confirm('이 일정과 변경 이력을 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return; const id = t.dataset.purge;
        try { const hs = (await MW.pdb.all('history')).filter(h => h.itemId === id); await MW.pdb.tx(['items', 'history'], 'readwrite', Sx => { Sx('items').delete(id); hs.forEach(h => Sx('history').delete(h.id)); }); st.items = st.items.filter(x => x.id !== id); MW.ui.toast('영구 삭제했습니다.'); } catch (er) { MW.ui.toast('삭제 실패: ' + er.message, true); } return re(); }
      if (t.dataset.cand) { const c = candidates().find(x => x.id === t.dataset.cand); if (!c) return; const it = Object.assign(blank('event', c.date), { id: c.id, title: c.text, allDay: true, startTime: '', endTime: '', alarms: [-540], category: '가족 일정', origin: 'onenote', sourcePageId: c.pageId, exportConfirmed: false, memo: '원노트 「' + c.pageTitle + '」에서 가져옴' });
        try { await save(it); t.outerHTML = '<span class="chip c-ok">추가됨</span>'; MW.ui.toast('개인 일정에 추가했습니다(이 기기 안에서만). 휴대폰으로 보내려면 일정을 열어 「내보내기 확인」을 체크하세요.'); } catch (er) { MW.ui.toast('추가 실패: ' + er.message, true); } return; }
      if (t.id === 'ex-all') { pb.querySelectorAll('[data-ex]:not(:disabled)').forEach(c => { c.checked = true; }); return exCount(); }
      if (t.id === 'ex-none') { pb.querySelectorAll('[data-ex]').forEach(c => { c.checked = false; }); return exCount(); }
      if (t.id === 'ex-go') { const ids = [...pb.querySelectorAll('[data-ex]:checked')].map(c => c.dataset.ex); if (!ids.length) return MW.ui.toast('내보낼 일정을 선택해 주세요.', true); return exportFlow(ids.map(id => st.items.find(x => x.id === id)), `${EF.from} ~ ${EF.to} 중 선택한 일정`); }
    };
    pb.onkeydown = e => { const cell = e.target.closest && e.target.closest('.mcell'); if (cell && (e.key === 'Enter' || e.key === ' ') && e.target === cell) { e.preventDefault(); S.sel = cell.dataset.day; $('pc-body').innerHTML = vMonth(); } };
    const exCount = () => { const n = pb.querySelectorAll('[data-ex]:checked').length, el = $('ex-n'); if (el) el.textContent = `선택 ${n}건`; };
    pb.onchange = async e => {
      const t = e.target;
      if (t.dataset.done) { await toggleDone(t.dataset.done, t.checked); return re(); }
      if (t.dataset.ex) return exCount();
      if (t.id === 'ex-from' || t.id === 'ex-to') { EF[t.id === 'ex-from' ? 'from' : 'to'] = t.value; if (EF.from && EF.to && EF.from <= EF.to) re(); else MW.ui.toast('기간을 확인해 주세요.', true); }
    };
    const sf = $('pc-sform'); if (sf) sf.onsubmit = e => { e.preventDefault(); S.q = $('pc-q').value; re(); const i = $('pc-q'); i.focus(); };
  }

  /* ---------- 홈 위젯 · 통합 검색 · 설정 ---------- */
  function widget(kind) {
    if (!st.loaded) return '<p class="muted small">개인 일정 저장소를 열지 못했습니다.</p>';
    const t = C().today();
    if (kind === 'pcal') { const os = C().occurrences(st.items, t, t).filter(o => o.type === 'event'), soon = C().occurrences(st.items, C().addDays(t, 1), C().addDays(t, 7)).filter(o => o.type === 'event').slice(0, 4);
      return `<div data-pw="1">${pendingCard()}${occList(os, '오늘 개인 일정이 없습니다.')}${soon.length ? `<p class="small muted" style="margin:8px 0 0">다가오는 일정</p>${occList(soon, '', { date: 1 })}` : ''}</div><div class="row"><button class="btn sm" data-pnew="event">＋ 일정</button><a class="btn sm" href="#/cal?v=month">달력</a></div>`; }
    return `<div data-pw="1">${occList(tasksDue(t), '오늘까지 할 일이 없습니다.', { date: 1 })}</div><div class="row"><button class="btn sm" data-pnew="task">＋ 할 일</button><a class="btn sm" href="#/cal?v=tasks">할 일 전체</a></div>`;
  }
  async function widgetClick(e) {
    const t = e.target, oc = t.closest('[data-occ]');
    if (oc && oc.closest('[data-pw]')) { const o = findOcc(oc.dataset.occ); if (o) openEditor({ id: o.id, orig: o.recurring ? o.orig : null }); return true; }
    if (t.dataset.pnew) { openEditor({ type: t.dataset.pnew }); return true; }
    if (t.closest('[data-sendall]')) { sendPending(); return true; }
    return false;
  }
  async function widgetChange(e) { if (e.target.dataset.done && e.target.closest('[data-pw]')) { await toggleDone(e.target.dataset.done, e.target.checked); return true; } return false; }
  function searchItems(q) {
    const sq = MW.search.words(q).map(MW.search.squash); if (!sq.length) return [];
    return live().filter(i => { const s = MW.search.squash([i.title, i.desc, i.location, i.memo, i.category].join(' ')); return sq.every(k => s.includes(k)); })
      .map(i => ({ kind: 'personal', id: i.id, title: i.title, sub: '개인 일정' + (i.rule && i.rule.freq ? ' · 🔁' : ''), date: i.start, snippet: [i.location, i.desc].filter(Boolean).join(' · ') }));
  }
  function settingsCard() {
    const n = live().length;
    return `<section class="card" id="pc-settings"><h2>개인 일정</h2>
      <p class="small muted">개인 일정은 업무 자료와 <b>다른 저장소</b>에 있으며 백업 파일도 따로 만듭니다. PC와 휴대폰의 일정은 서로 동기화되지 않습니다.</p>
      <div class="form"><label for="ps-role">이 기기</label><select id="ps-role"><option value="">정하지 않음</option><option value="admin-pc" ${st.meta.deviceRole === 'admin-pc' ? 'selected' : ''}>행정 PC</option><option value="personal" ${st.meta.deviceRole === 'personal' ? 'selected' : ''}>개인 휴대폰·PC</option></select>
        <label for="ps-only">업무 메뉴</label><label class="row" style="font-weight:400"><input type="checkbox" id="ps-only" ${MW.state.settings.personalOnly ? 'checked' : ''}> 개인 일정 전용으로 쓰기(업무 메뉴 숨김 · 휴대폰용)</label></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="ps-export">개인 일정 백업 내보내기</button><label class="btn" for="ps-restore" style="display:inline-flex;align-items:center">개인 일정 백업에서 복원</label><input id="ps-restore" type="file" accept=".json" hidden><button class="btn danger" id="ps-wipe">개인 일정 모두 삭제</button></div>
      <p class="small muted" id="ps-counts">일정·할 일 ${n}건 · 휴지통 ${st.items.length - n}건 · 내보내기 이력 ${st.exports.length}건</p>
      <h3 style="margin-top:14px">Google 캘린더 동기화</h3>
      <p class="small muted" id="ps-gsync">${!st.gsync || !st.gsync.clientId ? '설정 안 됨.' : `마지막 동기화: ${st.gsync.lastSync ? esc(MW.docs.fmt(st.gsync.lastSync)) : '아직 없음'}${(st.gsync.conflicts || []).length ? ` · <b>확인할 충돌 ${st.gsync.conflicts.length}건</b>` : ''}`}
        ${st.meta.deviceRole === 'admin-pc' ? ' 행정 PC에서는 사용하지 않습니다.' : onlineOk() ? '' : ' 휴대폰·개인 PC에서 https 주소로 열었을 때만 사용할 수 있습니다.'}</p>
      ${st.meta.deviceRole === 'personal' && onlineOk() ? '<a class="btn" href="sync.html">Google 캘린더 동기화 열기</a>' : ''}
      <details><summary class="small">자동화(n8n) 연결 상태</summary><p class="small muted">자동화 이벤트: 일정 변경을 이 기기 안에 기록만 하며 어디로도 전송하지 않습니다(<span id="ps-outbox">…</span>건 대기).</p></details></section>`;
  }
  function bindSettings(rerender) {
    const $ = id => document.getElementById(id); if (!$('pc-settings')) return;
    MW.pdb.count('outbox').then(n => { const el = $('ps-outbox'); if (el) el.textContent = n; }).catch(() => {});
    $('ps-role').onchange = async e => { st.meta.deviceRole = e.target.value; try { await saveMeta(); MW.ui.toast('저장했습니다.'); } catch (er) { MW.ui.toast(er.message, true); } };
    $('ps-only').onchange = async e => { MW.state.settings.personalOnly = e.target.checked; await MW.app.saveSettings(); MW.app.route(); };
    $('ps-export').onclick = async () => {
      try { const data = await MW.pdb.exportAll(); download('my-workspace-personal-backup-' + C().today() + '.json', JSON.stringify(data), 'application/json'); MW.ui.toast('개인 일정 백업 파일을 내보냈습니다. 업무 자료는 들어 있지 않습니다.'); }
      catch (e) { MW.ui.toast('백업 실패: ' + e.message, true); }
    };
    $('ps-restore').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const d = await MW.importer.readFile(f); if (!d.ok) throw new Error(d.error);
        let obj; try { obj = JSON.parse(d.text.replace(/^﻿/, '')); } catch (x) { throw new Error('백업 파일을 읽을 수 없습니다(JSON 형식 오류).'); }
        const v = MW.pdb.validateBackup(obj); if (v.errors.length) throw new Error(v.errors.slice(0, 3).join(' / '));
        if (!confirm(`개인 일정 백업 검사를 통과했습니다. (일정 ${v.counts.items}건)\n현재 개인 일정을 이 백업의 내용으로 바꿉니다. 계속할까요?`)) return;
        await MW.pdb.importAll(obj); await load(); MW.ui.toast('개인 일정을 복원했습니다.'); rerender();
      } catch (er) { console.error(er); MW.ui.toast('복원 실패: ' + er.message + ' — 현재 개인 일정은 그대로 유지됩니다.', true); try { await load(); } catch (_) { /* 무시 */ } }
    };
    $('ps-wipe').onclick = async () => { if (!confirm('이 기기의 개인 일정·이력을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return; try { await MW.pdb.wipe(); await load(); MW.ui.toast('개인 일정을 모두 삭제했습니다.'); rerender(); } catch (e) { MW.ui.toast('삭제 실패: ' + e.message, true); } };
  }
  MW.personal = { load, save, render, openEditor, exportFlow, pendingPhone, sendPending, widget, widgetClick, widgetChange, searchItems, settingsCard, bindSettings, toggleDone, candidates, CATS, COLORS, state: st };
})();
