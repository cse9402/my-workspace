/* 정기 업무: 매일·매주·매월·분기·연간 반복, 실제 기한 규칙, 기간별 완료 기록
   완료 기록(rlog)은 "정기업무ID|기간키"로 저장되므로 기간이 바뀌면 새 기간이 자동으로 비어 있는 상태로 시작되고 이전 기록은 남습니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  const FREQ = { daily: '매일', weekly: '매주', monthly: '매월', quarterly: '분기', yearly: '연간' };
  const ORDER = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
  const WD = ['월', '화', '수', '목', '금', '토', '일'];
  const esc = s => MW.ui.esc(s), pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2] || 1); };
  const R = {};
  R._now = null;                                         // 테스트용: 'YYYY-MM-DD'를 넣으면 그 날짜를 오늘로 봄
  R.now = () => (R._now ? parse(R._now) : new Date());
  function isoWeek(d) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);   // 그 주의 목요일
    const y = t.getFullYear(), jan4 = new Date(y, 0, 4);
    return y + '-W' + pad(1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7));
  }
  const quarter = d => Math.floor(d.getMonth() / 3) + 1;
  function periodKey(freq, d) {
    if (freq === 'daily') return iso(d);
    if (freq === 'weekly') return isoWeek(d);
    if (freq === 'monthly') return iso(d).slice(0, 7);
    if (freq === 'quarterly') return d.getFullYear() + '-Q' + quarter(d);
    if (freq === 'yearly') return String(d.getFullYear());
    return '';
  }
  function label(key) {
    let m;
    if ((m = /^(\d{4})-W(\d{2})$/.exec(key))) return `${m[1]}년 ${+m[2]}주차`;
    if ((m = /^(\d{4})-Q(\d)$/.exec(key))) return `${m[1]}년 ${m[2]}분기`;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key))) return `${+m[2]}월 ${+m[3]}일`;
    if ((m = /^(\d{4})-(\d{2})$/.exec(key))) return `${m[1]}년 ${+m[2]}월`;
    return key + '년';
  }
  const clampDay = (y, m, day) => Math.min(day, new Date(y, m + 1, 0).getDate());
  /* 그 기간의 실제 기한(사용자가 정한 규칙). 규칙이 없으면 null = 「기한 미확인」 */
  function dueDate(r, d) {
    const u = r.due || {}, y = d.getFullYear();
    if (r.freq === 'daily') return iso(d);
    if (r.freq === 'weekly') { if (!u.weekday) return null; const t = new Date(y, d.getMonth(), d.getDate()); t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + (u.weekday - 1)); return iso(t); }
    if (r.freq === 'monthly') { if (!u.day) return null; return iso(new Date(y, d.getMonth(), clampDay(y, d.getMonth(), u.day))); }
    if (r.freq === 'quarterly') { if (!u.day) return null; const m = (quarter(d) - 1) * 3 + ((u.qmonth || 1) - 1); return iso(new Date(y, m, clampDay(y, m, u.day))); }
    if (r.freq === 'yearly') { if (!u.day || !u.month) return null; return iso(new Date(y, u.month - 1, clampDay(y, u.month - 1, u.day))); }
    return null;
  }
  function dueText(r, d) {
    const u = r.due || {};
    if (r.freq === 'daily') return '매일';
    if (r.freq === 'weekly') return u.weekday ? `매주 ${WD[u.weekday - 1]}요일` : '기한 미확인';
    if (r.freq === 'monthly') return u.day ? `매월 ${u.day}일` : '기한 미확인';
    if (r.freq === 'quarterly') return u.day ? `분기 ${u.qmonth || 1}번째 달 ${u.day}일` : '기한 미확인';
    if (r.freq === 'yearly') return u.day && u.month ? `매년 ${u.month}월 ${u.day}일` : '기한 미확인';
    return '주기 확인 필요';
  }
  function step(freq, d, n) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (freq === 'daily') t.setDate(t.getDate() + n); else if (freq === 'weekly') t.setDate(t.getDate() + 7 * n);
    else if (freq === 'monthly') { t.setDate(1); t.setMonth(t.getMonth() + n); } else if (freq === 'quarterly') { t.setDate(1); t.setMonth(t.getMonth() + 3 * n); } else t.setFullYear(t.getFullYear() + n);
    return t;
  }
  const isDone = (id, key) => MW.state.rlog.has(id + '|' + key);
  async function setDone(r, key, done) {
    const id = r.id + '|' + key;
    if (done) { const rec = { id, routineId: r.id, periodKey: key, doneAt: new Date().toISOString() }; await MW.db.put('rlog', rec); MW.state.rlog.set(id, rec); }
    else { await MW.db.del('rlog', id); MW.state.rlog.delete(id); }
  }
  const save = r => { MW.search.indexRoutine(r); return MW.app.save('routines', r); };
  /* 지금 기간에 해야 할(아직 완료하지 않은) 정기 업무 */
  function pendingNow() {
    const d = R.now();
    return MW.state.routines.filter(r => r.active !== false && FREQ[r.freq] && !isDone(r.id, periodKey(r.freq, d))).map(r => ({ r, key: periodKey(r.freq, d), due: dueDate(r, d) }))
      .sort((a, b) => ORDER.indexOf(a.r.freq) - ORDER.indexOf(b.r.freq) || String(a.due || '9').localeCompare(String(b.due || '9')));
  }
  /* ---------- 원노트 「아침 체크」에서 가져오기 (주기는 검증 전 상태로) ---------- */
  const GROUP = /^(매일|매주|매월|분기별?|반기|매년|연간|\d+개월마다.*)$/;
  const groupFreq = g => g === '매일' ? 'daily' : g === '매주' ? 'weekly' : g === '매월' ? 'monthly' : /^분기/.test(g) ? 'quarterly' : /^(매년|연간)$/.test(g) ? 'yearly' : '';
  function sourcePage() { return MW.state.pages.find(p => p.section === '아침 체크'); }
  function parseSource() {
    const p = sourcePage(); if (!p) return [];
    const out = []; let grp = null, cur = null;
    p.blocks.forEach(b => b.children.forEach(c => {
      if (c.type !== 'paragraph') return; const t = c.text.trim(); if (!t) return;
      if (GROUP.test(t)) { grp = t; cur = null; return; }
      if (!grp) return;
      if ((c.level || 0) > 0 && cur) { cur.note += (cur.note ? '\n' : '') + t; return; }
      const freq = groupFreq(grp), hint = (t.match(/매월\s?\d*일?|\d+개월마다|\d+일까지|월말|분기별|매주|매일/g) || []).join(', ');
      const hm = /(\d+)개월마다/.exec(t), hintM = hm ? +hm[1] : /매월/.test(t) ? 1 : 0, grpM = { monthly: 1, quarterly: 3 }[freq];
      cur = { id: 'r_' + MW.importer.hash('onenote\u0001' + grp + '\u0001' + t), title: t, freq, due: {}, category: '', note: '', active: true, source: 'onenote', sourcePageId: p.id, origGroup: grp, origHint: hint,
        conflict: !!(hintM && ((grpM && grpM !== hintM) || freq === 'daily' || freq === 'weekly')), verified: false, createdAt: new Date().toISOString() };
      out.push(cur);
    }));
    return out;
  }
  async function importFromOneNote() {
    const found = parseSource(), have = new Set(MW.state.routines.map(r => r.id)), add = found.filter(r => !have.has(r.id));
    for (const r of add) { MW.state.routines.push(r); await save(r); }
    return { found: found.length, added: add.length };
  }
  /* ---------- 화면 ---------- */
  function chips(r) {
    return (r.source === 'onenote' ? '<span class="chip">원노트 원본</span> ' : '') + (r.verified ? '<span class="chip c-ok">주기 확인됨</span>' : '<span class="chip c-warn">주기 검토 필요</span>') + (r.conflict && !r.verified ? ' <span class="chip c-bad">원본 표현과 주기 불일치</span>' : '');
  }
  function rowHtml(r, d) {
    const key = periodKey(r.freq, d), done = FREQ[r.freq] && isDone(r.id, key), due = FREQ[r.freq] ? dueDate(r, d) : null, today = iso(d);
    const rec = done && MW.state.rlog.get(r.id + '|' + key);
    const dd = !due || r.freq === 'daily' ? '' : due < today ? (done ? '' : ' <span class="chip c-bad">기한 지남</span>') : due === today ? ' <span class="chip c-warn">오늘까지</span>' : '';
    return `<div class="rrow ${done ? 'done' : ''}" data-id="${r.id}">${FREQ[r.freq] ? `<input type="checkbox" data-done="${r.id}" ${done ? 'checked' : ''} aria-label="${esc(r.title)} 완료">` : '<span aria-hidden="true">？</span>'}
      <div class="rmain"><b>${esc(r.title)}</b> ${chips(r)}<div class="small muted">${esc(dueText(r, d))}${due && r.freq !== 'daily' ? ' · 이번 기한 ' + due : ''}${dd}${rec ? ' · 완료 기록 ' + esc(MW.docs.fmt(rec.doneAt)) : ''}${r.category ? ' · ' + esc(r.category) : ''}</div>
      ${r.note ? `<div class="small muted para">${esc(r.note)}</div>` : ''}</div>
      <div class="row">${FREQ[r.freq] ? `<button class="btn sm" data-hist="${r.id}">이력</button>` : ''}<button class="btn sm" data-edit="${r.id}">수정</button></div></div>`;
  }
  function monthHistory(ym) {
    const first = parse(ym + '-01'), days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(), today = iso(R.now());
    const rs = MW.state.routines.filter(r => FREQ[r.freq]);
    if (!rs.length) return '<p class="muted small">정기 업무가 없습니다.</p>';
    return `<div class="scroll-x"><table class="t" id="rt-hist"><thead><tr><th>정기 업무</th><th>주기</th><th>${esc(label(ym))} 완료 기록</th></tr></thead><tbody>${rs.map(r => {
      let cell;
      if (r.freq === 'daily') { const ds = []; for (let i = 1; i <= days; i++) { const k = ym + '-' + pad(i); if (k <= today) ds.push(k); } const dn = ds.filter(k => isDone(r.id, k)); cell = `<b>${dn.length}</b> / ${ds.length}일 완료${dn.length ? ` <span class="small muted">(${dn.map(k => +k.slice(8)).join(', ')}일)</span>` : ''}`; }
      else { const keys = []; for (let i = 1; i <= days; i++) { const k = periodKey(r.freq, new Date(first.getFullYear(), first.getMonth(), i)); if (!keys.includes(k)) keys.push(k); } cell = keys.map(k => `<span class="chip ${isDone(r.id, k) ? 'c-ok' : ''}">${esc(label(k))} ${isDone(r.id, k) ? '✔ 완료' : '– 기록 없음'}</span>`).join(' '); }
      return `<tr><td>${esc(r.title)}</td><td>${FREQ[r.freq]}</td><td>${cell}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function historyModal(r, rerender) {
    const d = R.now(), n = r.freq === 'daily' ? 21 : 12, keys = Array.from({ length: n }, (_, i) => periodKey(r.freq, step(r.freq, d, -i)));
    MW.ui.modal(`<h2>완료 이력</h2><p><b>${esc(r.title)}</b> <span class="chip">${FREQ[r.freq]}</span></p><p class="small muted">지난 기간의 기록을 바로잡을 수 있습니다. 체크하면 지금 시각으로 완료 기록이 남습니다.</p>
      <div id="rh-list">${keys.map(k => { const rec = MW.state.rlog.get(r.id + '|' + k); return `<label class="row" style="padding:5px 0;font-weight:400"><input type="checkbox" data-hk="${k}" ${rec ? 'checked' : ''}> <span>${esc(label(k))}</span> <span class="small muted">${rec ? '완료 ' + esc(MW.docs.fmt(rec.doneAt)) : '기록 없음'}</span></label>`; }).join('')}</div>`);
    document.getElementById('rh-list').onchange = async e => { const k = e.target.dataset.hk; if (!k) return; await setDone(r, k, e.target.checked); MW.app.refreshSoon(); historyModal(r, rerender); };
  }
  function editModal(r, rerender) {
    const isNew = !r; r = r || { id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: '', freq: 'monthly', due: {}, category: '', note: '', active: true, source: 'user', verified: true, createdAt: new Date().toISOString() };
    const u = Object.assign({}, r.due), opt = (v, l, s) => `<option value="${v}" ${String(s) === String(v) ? 'selected' : ''}>${l}</option>`;
    MW.ui.modal(`<h2>${isNew ? '새 정기 업무' : '정기 업무 수정'}</h2>
      ${r.source === 'onenote' ? `<div class="notice small">원노트 원본: 「${esc(r.origGroup)}」 묶음${r.origHint ? ` · 본문 표현 「${esc(r.origHint)}」` : ''}${r.conflict ? '<br><b>묶음의 주기와 본문 표현이 서로 다릅니다. 실제 주기를 확인해 주세요.</b>' : ''}</div>` : ''}
      <div class="form">
        <label for="re-title">업무 이름</label><input id="re-title" value="${esc(r.title)}">
        <label for="re-freq">반복 주기</label><select id="re-freq">${r.freq ? '' : opt('', '선택하세요', '')}${ORDER.map(f => opt(f, FREQ[f], r.freq)).join('')}</select>
        <label>실제 기한</label><div class="row" id="re-due"></div>
        <label for="re-cat">업무 분야</label><select id="re-cat">${opt('', '없음', r.category)}${MW.CATS.map(c => opt(c, c, r.category)).join('')}</select>
        <label for="re-note">메모</label><textarea id="re-note" rows="2">${esc(r.note || '')}</textarea>
        <label>확인</label><div><label class="row" style="font-weight:400"><input type="checkbox" id="re-ver" ${r.verified ? 'checked' : ''}> 반복 주기와 기한을 직접 확인했습니다</label>
          <label class="row" style="font-weight:400"><input type="checkbox" id="re-act" ${r.active !== false ? 'checked' : ''}> 사용 중 (끄면 점검 목록에서 숨김)</label></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="re-save">저장</button>${isNew ? '' : '<button class="btn danger" id="re-del">삭제</button>'}</div>`);
    const $ = i => document.getElementById(i);
    const dueUi = () => {
      const f = $('re-freq').value, day = `<label class="small">일 <input type="number" id="re-day" min="1" max="31" value="${u.day || ''}" style="width:84px" placeholder="미확인"></label>`;
      $('re-due').innerHTML = f === 'daily' ? '<span class="small muted">매일 (그날까지)</span>' : f === 'weekly' ? `<select id="re-wd" aria-label="요일">${opt('', '요일 미확인', u.weekday || '')}${WD.map((w, i) => opt(i + 1, w + '요일', u.weekday || '')).join('')}</select>`
        : f === 'monthly' ? day : f === 'quarterly' ? `<select id="re-qm" aria-label="분기 중 몇 번째 달">${[1, 2, 3].map(i => opt(i, `분기 ${i}번째 달`, u.qmonth || 1)).join('')}</select>${day}`
        : f === 'yearly' ? `<select id="re-mon" aria-label="월">${opt('', '월 미확인', u.month || '')}${Array.from({ length: 12 }, (_, i) => opt(i + 1, (i + 1) + '월', u.month || '')).join('')}</select>${day}` : '<span class="small muted">주기를 먼저 선택하세요</span>';
    };
    dueUi(); $('re-freq').onchange = dueUi;
    $('re-save').onclick = async () => {
      const title = $('re-title').value.trim(); if (!title) return MW.ui.toast('업무 이름을 입력해 주세요.', true);
      const num = id => { const e = $(id); const n = e ? parseInt(e.value, 10) : NaN; return Number.isFinite(n) ? n : undefined; };
      const day = num('re-day'); if (day !== undefined && (day < 1 || day > 31)) return MW.ui.toast('기한의 「일」은 1~31 사이로 입력해 주세요.', true);
      Object.assign(r, { title, freq: $('re-freq').value, due: { weekday: num('re-wd'), day, qmonth: num('re-qm'), month: num('re-mon') }, category: $('re-cat').value, note: $('re-note').value, verified: $('re-ver').checked, active: $('re-act').checked });
      if (isNew) MW.state.routines.push(r);
      await save(r); MW.ui.closeModal(); MW.ui.toast('정기 업무를 저장했습니다.'); rerender();
    };
    if (!isNew) $('re-del').onclick = async () => {
      if (!confirm('이 정기 업무와 완료 기록을 삭제합니다. 계속할까요?')) return;
      await MW.db.del('routines', r.id); MW.state.routines = MW.state.routines.filter(x => x.id !== r.id);
      for (const k of [...MW.state.rlog.keys()].filter(k => k.startsWith(r.id + '|'))) { await MW.db.del('rlog', k); MW.state.rlog.delete(k); }
      MW.ui.closeModal(); rerender();
    };
  }
  let histMonth = '';
  function render(view) {
    const d = R.now(), rs = MW.state.routines, act = rs.filter(r => r.active !== false), re = () => render(view);
    if (!histMonth) histMonth = iso(d).slice(0, 7);
    const groups = ORDER.map(f => [f, act.filter(r => r.freq === f)]).filter(g => g[1].length), unknown = act.filter(r => !FREQ[r.freq]), off = rs.filter(r => r.active === false);
    view.innerHTML = `<h1>정기 업무</h1>
      <p class="small muted">오늘 ${iso(d)} 기준입니다. 날짜·주·달·분기·해가 바뀌면 새 기간의 점검표가 자동으로 비어 있는 상태로 시작되고, 이전 기간의 완료 기록은 이력에 남습니다.</p>
      <div class="toolbar"><button class="btn primary" id="rt-new">＋ 새 정기 업무</button><button class="btn" id="rt-import" ${sourcePage() ? '' : 'disabled'}>원노트 점검표에서 가져오기</button></div>
      ${rs.length ? '' : '<div class="card muted" id="rt-empty">등록된 정기 업무가 없습니다. 원노트 「아침 체크」를 가져왔다면 「원노트 점검표에서 가져오기」로 시작할 수 있습니다.</div>'}
      <div id="rt-body">${groups.map(g => { const key = periodKey(g[0], d), dn = g[1].filter(r => isDone(r.id, key)).length; return `<section class="card rgroup" data-freq="${g[0]}" style="margin-bottom:12px"><h2>${FREQ[g[0]]} <span class="small muted">${esc(label(key))} · ${dn}/${g[1].length} 완료</span></h2>${g[1].map(r => rowHtml(r, d)).join('')}</section>`; }).join('')}
      ${unknown.length ? `<section class="card rgroup" data-freq="" style="margin-bottom:12px"><h2>주기 확인 필요 <span class="small muted">${unknown.length}건</span></h2><p class="small muted">원본에 적힌 주기가 앱의 반복 주기와 맞지 않습니다. 「수정」에서 실제 주기를 정하면 점검표에 나타납니다.</p>${unknown.map(r => rowHtml(r, d)).join('')}</section>` : ''}
      ${off.length ? `<details class="card" style="margin-bottom:12px"><summary>사용 안 함 ${off.length}건</summary>${off.map(r => rowHtml(r, d)).join('')}</details>` : ''}</div>
      <h2 style="margin-top:18px">월별 체크 이력</h2><div class="toolbar"><label class="small">기간 <input type="month" id="rt-month" value="${histMonth}"></label></div><div class="card" id="rt-histbox">${monthHistory(histMonth)}</div>`;
    document.getElementById('rt-new').onclick = () => editModal(null, re);
    document.getElementById('rt-import').onclick = async () => { const x = await importFromOneNote(); MW.ui.toast(x.added ? `원노트 점검표에서 ${x.added}건을 가져왔습니다. 주기는 「검토 필요」 상태입니다.` : `새로 가져올 항목이 없습니다. (원본 ${x.found}건은 이미 등록됨)`); re(); };
    document.getElementById('rt-month').onchange = e => { if (e.target.value) { histMonth = e.target.value; document.getElementById('rt-histbox').innerHTML = monthHistory(histMonth); } };
    const body = document.getElementById('rt-body');
    body.onchange = async e => { const id = e.target.dataset.done; if (!id) return; const r = rs.find(x => x.id === id); await setDone(r, periodKey(r.freq, R.now()), e.target.checked); re(); };
    body.onclick = e => { const h = e.target.dataset.hist, ed = e.target.dataset.edit; if (h) historyModal(rs.find(x => x.id === h), re); else if (ed) editModal(rs.find(x => x.id === ed), re); };
  }
  Object.assign(R, { FREQ, ORDER, periodKey, label, dueDate, dueText, isDone, setDone, pendingNow, parseSource, sourcePage, importFromOneNote, render, iso, save });
  MW.routine = R;
})();
