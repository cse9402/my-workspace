/* 사용자 문서: 일반 문서(doc) · 업무 매뉴얼(manual) · 빠른 메모(memo)
   자동저장, 복제, 휴지통, 버전 이력, 원노트 페이지·업무 연결 */
(function () {
  const MW = (window.MW = window.MW || {});
  const CATS = (MW.CATS = ['건축물 해체', '옥외광고물 허가·신고', '불법광고물 정비', '민간임대주택', '부동산중개업', '공통 행정·서무', '업무 시스템', '개인 지식 및 기타']);
  const KIND = { doc: '문서', manual: '업무 매뉴얼', memo: '빠른 메모' };
  const BACK = { doc: 'docs', manual: 'manual', memo: 'memo' };
  const LAW = ['법령 확인 필요', '법령 확인 완료'], PROC = ['미검증', '담당자 검증 완료'];
  const MFIELDS = [['law', '적용 법령 (한 줄에 법령 이름 하나)'], ['purpose', '처리 목적'], ['system', '담당 시스템'], ['intake', '신청 및 접수 방법'], ['checks', '확인 사항'], ['papers', '제출서류'], ['deadline', '처리 기한'], ['fee', '수수료'], ['sanction', '행정처분'], ['penalty', '과태료·벌칙'], ['notice', '민원인 안내문']];
  const esc = s => MW.ui.esc(s), now = () => new Date().toISOString();
  const rid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmt = iso => iso ? new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '미확인';
  const clone = o => JSON.parse(JSON.stringify(o));
  const strip = d => { const { _s, ...c } = d; return c; };
  const live = kind => MW.state.docs.filter(d => !d.deletedAt && (!kind || d.kind === kind));
  const newManual = () => ({ lawVerify: LAW[0], procVerify: PROC[0], reviewedAt: '', draftAuto: false, sources: [], law: '', purpose: '', system: '', intake: '', checks: '', papers: '', deadline: '', fee: '', sanction: '', penalty: '', notice: '' });
  const catOf = c => CATS.includes(c) ? c : c === '업무 시스템·계정' ? '업무 시스템' : '개인 지식 및 기타';

  /* ---------- 만들기 · 저장 ---------- */
  function create(kind, init) {
    const t = now();
    const d = Object.assign({ id: rid('d'), kind, title: '', blocks: [MW.editor.make('p')], category: '', tags: [], fav: false, createdAt: t, updatedAt: t, deletedAt: null, linkedPages: [], linkedTasks: [], syncAllowed: false }, init || {});
    if (kind === 'manual') d.manual = Object.assign(newManual(), d.manual || {});
    MW.state.docs.push(d); MW.search.indexDoc(d);
    return d;
  }
  const persist = d => { MW.search.indexDoc(d); return MW.app.save('docs', d); };
  const dirty = new Map(); let timer = null, sess = null;
  const setStatus = t => document.querySelectorAll('.doc-status').forEach(el => { el.textContent = t; });
  /* 바뀐 문서를 표시하고 0.7초 뒤 자동저장 */
  function touch(d) {
    dirty.set(d.id, d); setStatus('입력 중…');
    clearTimeout(timer); timer = setTimeout(flush, 700);
    if (sess && sess.id === d.id && !sess.snapped) { sess.snapped = true; sess.lastSnapAt = Date.now(); if (sess.hadContent) addVersion(JSON.parse(sess.base), '편집 전'); }
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    const list = [...dirty.values()]; dirty.clear();
    for (const d of list) {
      d.updatedAt = now();
      try {
        await persist(d);
        setStatus('자동 저장됨 ' + new Date().toLocaleTimeString('ko-KR'));
        document.querySelectorAll('.doc-upd').forEach(el => { el.textContent = fmt(d.updatedAt); });
        if (sess && sess.id === d.id && Date.now() - sess.lastSnapAt > 5 * 60000) { sess.lastSnapAt = Date.now(); addVersion(d, '자동 저장'); }
      } catch (e) { dirty.set(d.id, d); setStatus('⚠ 저장 실패 — 내용을 다른 곳에 복사해 두세요'); }
    }
  }
  /* ---------- 버전 이력 ---------- */
  async function addVersion(d, reason) {
    const v = { id: rid('v'), docId: d.id, at: now(), reason, title: d.title, blocks: clone(d.blocks), manual: d.manual ? clone(d.manual) : null };
    try {
      await MW.db.put('versions', v);
      const mine = (await MW.db.all('versions')).filter(x => x.docId === d.id).sort((a, b) => a.at.localeCompare(b.at));
      for (const old of mine.slice(0, Math.max(0, mine.length - 30))) await MW.db.del('versions', old.id);
    } catch (e) { /* 저장 실패 경고는 공통 처리 */ }
    return v;
  }
  async function versionsModal(d, rerender) {
    await flush();
    const vs = (await MW.db.all('versions')).filter(v => v.docId === d.id).sort((a, b) => b.at.localeCompare(a.at));
    MW.ui.modal(`<h2>버전 이력</h2><p class="small muted">편집을 시작할 때와 편집 중 5분마다 자동으로 남기며, 문서마다 최근 30개를 보관합니다.</p>
      <button class="btn" id="ver-now">지금 상태를 버전으로 저장</button>
      <ul class="list" id="ver-list" style="margin-top:10px">${vs.map(v => `<li><b>${esc(fmt(v.at))}</b> <span class="chip">${esc(v.reason)}</span> <span class="small muted">블록 ${v.blocks.length}개</span>
        <div class="small muted">${esc(MW.sec.show((v.title ? v.title + ' — ' : '') + MW.editor.text(v.blocks).replace(/\n/g, ' ').slice(0, 90)))}</div>
        <button class="btn sm" data-ver="${v.id}">이 버전으로 복원</button></li>`).join('') || '<li class="muted">저장된 버전이 없습니다.</li>'}</ul>`);
    document.getElementById('ver-now').onclick = async () => { await addVersion(d, '직접 저장'); MW.ui.toast('현재 상태를 버전으로 저장했습니다.'); versionsModal(d, rerender); };
    document.getElementById('ver-list').onclick = async e => {
      const id = e.target.dataset.ver; if (!id) return;
      const v = vs.find(x => x.id === id);
      await addVersion(d, '복원 전');
      d.title = v.title; d.blocks = clone(v.blocks); if (d.manual && v.manual) d.manual = clone(v.manual);
      d.updatedAt = now(); await persist(d);
      MW.ui.closeModal(); MW.ui.toast('선택한 버전으로 복원했습니다. (복원 전 상태도 버전으로 남겼습니다)'); rerender();
    };
  }
  /* ---------- 복제 · 삭제 · 복구 ---------- */
  async function duplicate(d) {
    await flush();
    const c = clone(strip(d)), t = now();
    Object.assign(c, { id: rid('d'), title: (d.title || '제목 없음') + ' (복사본)', createdAt: t, updatedAt: t, fav: false, deletedAt: null });
    c.blocks.forEach(b => { b.id = MW.editor.uid(); });
    MW.state.docs.push(c); await persist(c); return c;
  }
  async function softDelete(d) { dirty.delete(d.id); d.deletedAt = now(); await persist(d); }
  async function restore(d) { d.deletedAt = null; await persist(d); }
  async function purge(d) {
    dirty.delete(d.id);
    await MW.db.del('docs', d.id);
    MW.state.docs = MW.state.docs.filter(x => x.id !== d.id);
    for (const v of (await MW.db.all('versions')).filter(v => v.docId === d.id)) await MW.db.del('versions', v.id);
  }
  /* ---------- 찾아서 고르기(원노트 페이지 · 업무) ---------- */
  function picker(el, kind, onPick) {
    el.innerHTML = `<input type="search" class="pk-q" placeholder="${kind === 'page' ? '연결할 원노트 페이지 제목 찾기' : '연결할 업무 내용 찾기'}" aria-label="${kind === 'page' ? '원노트 페이지 찾기' : '업무 찾기'}"><ul class="list pk-r"></ul>`;
    const q = el.querySelector('.pk-q'), r = el.querySelector('.pk-r');
    q.oninput = () => {
      const sq = MW.search.words(q.value).map(MW.search.squash);
      if (!sq.length) { r.innerHTML = ''; return; }
      const items = kind === 'page' ? MW.state.pages.filter(p => sq.every(k => MW.search.squash(p.section + p.title).includes(k))).slice(0, 8).map(p => [p.id, p.section + ' / ' + (p.title || '(제목없음)')])
        : MW.state.tasks.filter(t => sq.every(k => t._s.includes(k))).slice(0, 8).map(t => [t.id, MW.sec.show(t.title)]);
      r.innerHTML = items.map(i => `<li><button type="button" class="ttl" data-pick="${i[0]}">${esc(i[1])}</button></li>`).join('') || '<li class="small muted">찾는 자료가 없습니다.</li>';
    };
    r.onclick = e => { const b = e.target.closest('[data-pick]'); if (b) { onPick(b.dataset.pick); q.value = ''; r.innerHTML = ''; } };
  }
  /* ---------- 목록 ---------- */
  const rowHtml = d => `<li><a href="#/docs/${d.id}">${d.fav ? '★ ' : ''}${esc(MW.sec.show(d.title || '제목 없음'))}</a> ${d.category ? `<span class="chip">${esc(d.category)}</span>` : ''} ${(d.tags || []).map(t => `<span class="chip c-acc">#${esc(t)}</span>`).join(' ')}
    <div class="small muted">수정 ${esc(fmt(d.updatedAt))} · ${esc(MW.sec.show(MW.editor.text(d.blocks).replace(/\n/g, ' ').slice(0, 80)))}</div></li>`;
  const LF = { cat: '', q: '' };
  function renderList(view) {
    const all = live('doc'), sq = MW.search.words(LF.q).map(MW.search.squash);
    const ds = all.filter(d => (!LF.cat || d.category === LF.cat) && sq.every(k => (d._s || '').includes(k))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const trash = MW.state.docs.filter(d => d.deletedAt).length;
    view.innerHTML = `<h1>문서</h1>
      <div class="toolbar"><button class="btn primary" id="doc-new">＋ 새 문서</button>
        <select id="dl-cat" aria-label="업무 분야"><option value="">전체 분야</option>${CATS.map(c => `<option ${LF.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <input type="search" id="dl-q" placeholder="문서 찾기" value="${esc(LF.q)}" aria-label="문서 찾기">
        <a class="btn" href="#/trash">🗑 휴지통 ${trash}</a></div>
      <p class="small muted" id="dl-count">${ds.length}개 / 전체 ${all.length}개 · 직접 작성한 문서입니다. 원노트 원본은 「아카이브」에 따로 보관됩니다.</p>
      <div class="card"><ul class="list" id="doc-list">${ds.map(rowHtml).join('') || '<li class="muted">문서가 없습니다. 「새 문서」로 시작해 보세요.</li>'}</ul></div>`;
    document.getElementById('doc-new').onclick = async () => { const d = create('doc'); await persist(d); location.hash = '#/docs/' + d.id; };
    document.getElementById('dl-cat').onchange = e => { LF.cat = e.target.value; renderList(view); };
    document.getElementById('dl-q').oninput = MW.ui.debounce(e => { LF.q = e.target.value; renderList(view); const i = document.getElementById('dl-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
  }
  /* ---------- 매뉴얼 전용 영역 ---------- */
  const lawLinks = m => String(m.law || '').split('\n').map(s => s.trim()).filter(Boolean).map(n => `<li><a href="https://www.law.go.kr/법령/${encodeURIComponent(n)}" target="_blank" rel="noopener noreferrer">국가법령정보센터: ${esc(n)} ↗</a> <span class="chip ${m.lawVerify === LAW[1] ? 'c-ok' : 'c-warn'}">${esc(m.lawVerify)}</span></li>`).join('');
  function manualHtml(d) {
    const m = d.manual, opt = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('');
    return `<section class="mbox verify"><h3>검증 상태</h3><div class="row">
        <label class="small">법령 <select id="m-law">${opt(LAW, m.lawVerify)}</select></label>
        <label class="small">처리절차 <select id="m-proc">${opt(PROC, m.procVerify)}</select></label>
        <label class="small">최종 검토일 <input type="date" id="m-rev" value="${esc(m.reviewedAt || '')}"></label></div>
        <p class="small muted" style="margin:.5em 0 0">검증 전에는 공식 법령·확정 절차로 쓰지 마세요. 법령 내용은 이 앱이 확인하지 않습니다.</p></section>
      <section class="mbox src"><h3>원본 메모 <span class="chip">원노트 원본 · 수정 불가</span> <span class="chip c-warn">검증되지 않은 메모</span></h3>
        ${m.sources.length ? `<ul class="list" id="m-src">${m.sources.map(s => `<li><span class="para">${esc(MW.sec.show(s.text))}</span><div class="small muted">${s.count ? s.count + '회 기재 · ' : ''}${s.pageId ? `<a href="#/archive/${s.pageId}?q=${encodeURIComponent(s.text.slice(0, 20))}">원본 페이지 보기</a>` : '원본 페이지 미확인'}</div></li>`).join('')}</ul>` : '<p class="small muted">원노트 메모 없이 직접 작성한 매뉴얼입니다.</p>'}</section>
      <details class="mbox" id="m-fields"><summary><b>매뉴얼 항목</b> <span class="small muted">적용 법령 · 제출서류 · 처리 기한 · 수수료 등</span></summary>
        <div class="form" style="margin-top:10px">${MFIELDS.map(f => `<label for="mf-${f[0]}">${f[1]}</label><textarea id="mf-${f[0]}" data-mf="${f[0]}" rows="2">${esc(m[f[0]] || '')}</textarea>`).join('')}</div>
        <p class="small muted">법령 이름을 적으면 국가법령정보센터 링크가 만들어집니다. 조문 내용과 현행 여부는 링크에서 직접 확인해 주세요.</p></details>
      <ul class="list" id="m-lawlinks">${lawLinks(m)}</ul>
      <h3 style="margin-top:14px">처리 단계 · 정리 내용 <span class="chip ${m.procVerify === PROC[1] ? 'c-ok' : 'c-warn'}" id="m-bodychip">${m.procVerify === PROC[1] ? '담당자 검증 완료' : m.draftAuto ? '원본 메모로 자동 생성한 초안 — 검증 전' : '직접 작성 — 검증 전'}</span></h3>`;
  }
  /* ---------- 문서 편집 화면 ---------- */
  function renderDoc(view, id) {
    const d = MW.state.docs.find(x => x.id === id);
    if (!d) { view.innerHTML = '<div class="card">문서를 찾을 수 없습니다. <a href="#/docs">문서 목록</a></div>'; return; }
    if (d.deletedAt) { view.innerHTML = '<div class="card">휴지통에 있는 문서입니다. <a href="#/trash">휴지통에서 복구</a>할 수 있습니다.</div>'; return; }
    sess = { id: d.id, base: JSON.stringify(strip(d)), hadContent: !!(d.title || MW.editor.text(d.blocks)), snapped: false, lastSnapAt: Date.now() };
    MW.app.touchRecent('doc', d.id);
    const re = () => renderDoc(view, id);
    view.innerHTML = `<div class="row spread" style="margin-bottom:10px"><a class="btn sm" href="#/${BACK[d.kind]}">← ${KIND[d.kind]} 목록</a><span class="small muted doc-status" aria-live="polite">저장됨</span></div>
      <article class="doc docedit">
        <div class="row"><span class="chip c-acc">${KIND[d.kind]}</span><span class="small muted">생성 ${esc(fmt(d.createdAt))} · 수정 <span class="doc-upd">${esc(fmt(d.updatedAt))}</span></span></div>
        <input id="doc-title" class="doc-title" placeholder="제목 없음" value="${esc(d.title)}" aria-label="문서 제목">
        <div class="row doc-meta">
          <select id="doc-cat" aria-label="업무 분야"><option value="">업무 분야 없음</option>${CATS.map(c => `<option ${d.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <input id="doc-tags" placeholder="태그 (쉼표로 구분)" value="${esc((d.tags || []).join(', '))}" aria-label="태그">
        </div>
        <div class="row doc-actions"><button class="btn sm" id="doc-fav">${d.fav ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'}</button><button class="btn sm" id="doc-dup">복제</button><button class="btn sm" id="doc-ver">버전 이력</button><button class="btn sm danger" id="doc-del">삭제</button></div>
        ${d.kind === 'manual' ? manualHtml(d) : ''}
        <div id="doc-editor"></div>
        <details class="mbox" id="doc-links" ${d.linkedPages.length + d.linkedTasks.length ? 'open' : ''}><summary><b>연결</b> <span class="small muted" id="doc-linkcount"></span></summary><div id="doc-linkbody"></div></details>
        <label class="row small" style="margin-top:12px;font-weight:400"><input type="checkbox" id="doc-sync" ${d.syncAllowed ? 'checked' : ''}> <span>향후 기기 간 동기화 대상으로 표시 (외부 저장이 허용된 자료만 체크 · 동기화 기능은 아직 없음)</span></label>
      </article>`;
    const $ = i => document.getElementById(i);
    MW.editor.mount($('doc-editor'), d, () => touch(d));
    $('doc-title').oninput = e => { d.title = e.target.value; touch(d); };
    $('doc-cat').onchange = e => { d.category = e.target.value; touch(d); };
    $('doc-tags').onchange = e => { d.tags = [...new Set(e.target.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean))]; touch(d); };
    $('doc-sync').onchange = e => { d.syncAllowed = e.target.checked; touch(d); };
    $('doc-fav').onclick = async () => { d.fav = !d.fav; touch(d); await flush(); $('doc-fav').textContent = d.fav ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'; };
    $('doc-dup').onclick = async () => { const c = await duplicate(d); MW.ui.toast('문서를 복제했습니다.'); location.hash = '#/docs/' + c.id; };
    $('doc-ver').onclick = () => versionsModal(d, re);
    $('doc-del').onclick = async () => { await flush(); await softDelete(d); MW.ui.toast('휴지통으로 옮겼습니다. 휴지통에서 복구할 수 있습니다.'); location.hash = '#/' + BACK[d.kind]; };
    function links() {
      $('doc-linkcount').textContent = `원노트 페이지 ${d.linkedPages.length} · 업무 ${d.linkedTasks.length}`;
      const pg = d.linkedPages.map(i => MW.state.pages.find(p => p.id === i)).filter(Boolean), tk = d.linkedTasks.map(i => MW.state.tasks.find(t => t.id === i)).filter(Boolean);
      $('doc-linkbody').innerHTML = `<h3 style="margin-top:10px">원노트 페이지</h3><ul class="list" id="lk-pages">${pg.map(p => `<li><a href="#/archive/${p.id}">📄 ${esc(p.section)} / ${esc(p.title || '(제목없음)')}</a> <button class="btn sm" data-unp="${p.id}" aria-label="연결 해제">해제</button></li>`).join('') || '<li class="small muted">연결된 페이지가 없습니다.</li>'}</ul><div id="pk-page"></div>
        <h3 style="margin-top:10px">업무 항목</h3><ul class="list" id="lk-tasks">${tk.map(t => `<li><button type="button" class="ttl" data-open="${t.id}">✅ ${esc(MW.sec.show(t.title))}</button> <button class="btn sm" data-unt="${t.id}" aria-label="연결 해제">해제</button></li>`).join('') || '<li class="small muted">연결된 업무가 없습니다.</li>'}</ul><div id="pk-task"></div>`;
      picker($('pk-page'), 'page', pid => { if (!d.linkedPages.includes(pid)) d.linkedPages.push(pid); touch(d); links(); });
      picker($('pk-task'), 'task', tid => { if (!d.linkedTasks.includes(tid)) d.linkedTasks.push(tid); touch(d); links(); });
    }
    links();
    $('doc-linkbody').onclick = e => {
      const t = e.target;
      if (t.dataset.unp) { d.linkedPages = d.linkedPages.filter(x => x !== t.dataset.unp); touch(d); links(); }
      else if (t.dataset.unt) { d.linkedTasks = d.linkedTasks.filter(x => x !== t.dataset.unt); touch(d); links(); }
      else if (t.closest('[data-open]')) MW.tasks.openDetail(t.closest('[data-open]').dataset.open);
    };
    if (d.kind === 'manual') {
      const m = d.manual, chip = () => { const c = $('m-bodychip'); c.className = 'chip ' + (m.procVerify === PROC[1] ? 'c-ok' : 'c-warn'); c.textContent = m.procVerify === PROC[1] ? '담당자 검증 완료' : m.draftAuto ? '원본 메모로 자동 생성한 초안 — 검증 전' : '직접 작성 — 검증 전'; };
      $('m-law').onchange = e => { m.lawVerify = e.target.value; $('m-lawlinks').innerHTML = lawLinks(m); touch(d); };
      $('m-proc').onchange = e => { m.procVerify = e.target.value; chip(); touch(d); };
      $('m-rev').onchange = e => { m.reviewedAt = e.target.value; touch(d); };
      $('m-fields').oninput = e => { const k = e.target.dataset.mf; if (!k) return; m[k] = e.target.value; if (k === 'law') $('m-lawlinks').innerHTML = lawLinks(m); touch(d); };
    }
    if (!d.title && d.kind !== 'memo') $('doc-title').focus();
  }
  /* ---------- 휴지통 ---------- */
  function renderTrash(view) {
    const ds = MW.state.docs.filter(d => d.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    view.innerHTML = `<h1>휴지통</h1><p class="small muted">삭제한 문서·매뉴얼·메모가 여기에 보관됩니다. 「영구 삭제」한 자료는 되돌릴 수 없습니다.</p>
      <div class="toolbar"><a class="btn" href="#/docs">← 문서 목록</a><button class="btn danger" id="tr-empty" ${ds.length ? '' : 'disabled'}>휴지통 비우기</button></div>
      <div class="card"><ul class="list" id="tr-list">${ds.map(d => `<li><b>${esc(MW.sec.show(d.title || '제목 없음'))}</b> <span class="chip">${KIND[d.kind]}</span> <span class="small muted">삭제 ${esc(fmt(d.deletedAt))}</span>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-restore="${d.id}">복구</button><button class="btn sm danger" data-purge="${d.id}">영구 삭제</button></div></li>`).join('') || '<li class="muted">휴지통이 비어 있습니다.</li>'}</ul></div>`;
    document.getElementById('tr-list').onclick = async e => {
      const r = e.target.dataset.restore, p = e.target.dataset.purge, d = MW.state.docs.find(x => x.id === (r || p)); if (!d) return;
      if (r) { await restore(d); MW.ui.toast('문서를 복구했습니다.'); }
      else if (confirm('이 문서와 버전 이력을 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) { await purge(d); MW.ui.toast('영구 삭제했습니다.'); } else return;
      renderTrash(view);
    };
    document.getElementById('tr-empty').onclick = async () => { if (!confirm(`휴지통의 ${ds.length}개 자료를 모두 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return; for (const d of ds) await purge(d); renderTrash(view); };
  }
  /* ---------- 업무 매뉴얼 ---------- */
  function fromSources(title, category, sources) {
    return create('manual', { title, category, blocks: sources.length ? sources.map(s => MW.editor.make('ol', { text: s.text })) : [MW.editor.make('p')], linkedPages: [...new Set(sources.map(s => s.pageId).filter(Boolean))].slice(0, 20), manual: Object.assign(newManual(), { sources, draftAuto: sources.length > 0 }) });
  }
  const pageSources = p => p.blocks.flatMap(b => b.children).filter(c => c.type === 'paragraph' && c.text.trim()).map(c => ({ text: c.text.trim(), pageId: p.id }));
  function fromMemosModal() {
    const st = MW.state, picked = new Set(), pickedPages = new Set();
    const notes = st.pages.filter(p => p.type === 'note' && p.counts.filled > 0);
    MW.ui.modal(`<h2>원노트 메모에서 매뉴얼 만들기</h2>
      <p class="small muted">반복해서 적어 둔 메모를 골라 매뉴얼 초안을 만듭니다. 고른 메모는 「원본 메모」로 따로 보존되고, 초안은 「검증 전」으로 표시됩니다.</p>
      <div class="form"><label for="mf-title">매뉴얼 이름</label><input id="mf-title" placeholder="예: 건축물 해체 완료신고 처리">
        <label for="mf-cat">업무 분야</label><select id="mf-cat">${CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <label for="mf-q">메모 찾기</label><input type="search" id="mf-q" placeholder="단어로 좁히기"></div>
      <h3 style="margin-top:12px">반복 업무 메모 <span class="small muted">(많이 적힌 순)</span></h3><div id="mf-list" class="picklist"></div>
      ${notes.length ? `<h3 style="margin-top:12px">절차·메모 페이지 전체</h3><div id="mf-pages" class="picklist">${notes.map(p => `<label class="row"><input type="checkbox" data-pg="${p.id}"> <span>${esc(p.section)} / ${esc(p.title || '(제목없음)')} <span class="small muted">단락 ${p.counts.filled}개</span></span></label>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="mf-go">매뉴얼 만들기</button><span class="small muted" id="mf-n">선택 0건</span></div>`);
    const $ = i => document.getElementById(i);
    const list = () => {
      const cat = $('mf-cat').value, sq = MW.search.words($('mf-q').value).map(MW.search.squash);
      const ts = st.tasks.filter(t => catOf(t.category) === cat && sq.every(k => t._s.includes(k))).sort((a, b) => b.count - a.count).slice(0, 80);
      $('mf-list').innerHTML = ts.map(t => `<label class="row"><input type="checkbox" data-tk="${t.id}" ${picked.has(t.id) ? 'checked' : ''}> <span>${esc(MW.sec.show(t.detail))} <span class="small muted">${t.count}회</span></span></label>`).join('') || '<p class="small muted">이 분야에 해당하는 메모가 없습니다.</p>';
    };
    list(); $('mf-cat').onchange = list; $('mf-q').oninput = list;
    $('modal-body').onchange = e => {
      const t = e.target; if (t.dataset.tk) t.checked ? picked.add(t.dataset.tk) : picked.delete(t.dataset.tk); else if (t.dataset.pg) t.checked ? pickedPages.add(t.dataset.pg) : pickedPages.delete(t.dataset.pg); else return;
      $('mf-n').textContent = `선택 ${picked.size + pickedPages.size}건`;
    };
    $('mf-go').onclick = async () => {
      const src = [...picked].map(i => st.tasks.find(t => t.id === i)).filter(Boolean).sort((a, b) => b.count - a.count).map(t => ({ text: t.detail, taskId: t.id, count: t.count, pageId: t.occurrences[t.occurrences.length - 1] || null }))
        .concat([...pickedPages].flatMap(i => pageSources(st.pages.find(p => p.id === i))));
      if (!src.length) return MW.ui.toast('메모를 하나 이상 선택해 주세요.', true);
      const d = fromSources($('mf-title').value.trim() || $('mf-cat').value + ' 매뉴얼', $('mf-cat').value, src);
      $('modal-body').onchange = null; await persist(d); MW.ui.closeModal(); location.hash = '#/docs/' + d.id;
    };
  }
  async function renderManual(view, r) {
    if (r.q.from) {                                             // 아카이브의 「이 페이지로 매뉴얼 만들기」
      const p = MW.state.pages.find(x => x.id === r.q.from);
      if (p) { const d = fromSources(p.title || '제목 없음', '', pageSources(p)); await persist(d); location.replace('#/docs/' + d.id); return; }
    }
    const ms = live('manual'), groups = CATS.concat('').map(c => [c, ms.filter(m => (m.category || '') === c)]).filter(g => g[1].length);
    view.innerHTML = `<h1>업무 매뉴얼</h1>
      <div class="notice small">원노트의 단편적인 메모는 공식 법령이나 확정된 절차가 아닙니다. 매뉴얼마다 <b>원본 메모 / 정리 내용 / 검증 상태</b>를 구분해 표시하며, 직접 확인한 뒤 검증 상태를 바꿔 주세요.</div>
      <div class="toolbar"><button class="btn primary" id="man-new">＋ 새 매뉴얼</button><button class="btn" id="man-from" ${MW.state.tasks.length ? '' : 'disabled'}>원노트 메모에서 만들기</button></div>
      ${groups.map(g => `<section class="card" style="margin-bottom:12px"><h2>${esc(g[0] || '분야 미지정')} <span class="muted small">${g[1].length}건</span></h2><ul class="list">${g[1].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(m => `<li><a href="#/docs/${m.id}">${m.fav ? '★ ' : ''}${esc(m.title || '제목 없음')}</a>
        <span class="chip ${m.manual.lawVerify === LAW[1] ? 'c-ok' : 'c-warn'}">${esc(m.manual.lawVerify)}</span> <span class="chip ${m.manual.procVerify === PROC[1] ? 'c-ok' : 'c-warn'}">절차 ${esc(m.manual.procVerify)}</span>
        <div class="small muted">원본 메모 ${m.manual.sources.length}건 · 최종 검토일 ${esc(m.manual.reviewedAt || '미확인')} · 수정 ${esc(fmt(m.updatedAt))}</div></li>`).join('')}</ul></section>`).join('') || '<div class="card muted" id="man-empty">아직 매뉴얼이 없습니다.</div>'}`;
    document.getElementById('man-new').onclick = async () => { const d = create('manual'); await persist(d); location.hash = '#/docs/' + d.id; };
    document.getElementById('man-from').onclick = fromMemosModal;
  }
  /* ---------- 빠른 메모 ---------- */
  const memoText = d => d.blocks.map(b => b.text || '').join('\n');
  /* el 안에 메모 작성기를 그림. 첫 글자를 치는 순간 메모가 만들어지고 이후 자동저장 */
  function composer(el, onChange) {
    let memo = null, cat = '', task = null;
    el.innerHTML = `<textarea class="memo-text" rows="5" placeholder="메모를 바로 적으세요. 자동으로 저장됩니다." aria-label="빠른 메모 내용"></textarea>
      <div class="row" style="margin-top:8px"><select class="memo-cat" aria-label="업무 분야"><option value="">업무 분야 없음</option>${CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <button type="button" class="btn sm memo-new">새 메모 시작</button><span class="small muted doc-status" aria-live="polite"></span></div>
      <div class="memo-task small" style="margin-top:8px"></div><div class="memo-pick"></div>`;
    const q = s => el.querySelector(s), ta = q('.memo-text');
    const apply = () => {
      const text = ta.value;
      if (!memo) { if (!text.trim() && !cat && !task) return; memo = create('memo', { blocks: [] }); }
      memo.blocks = text.split('\n').map(l => MW.editor.make('p', { text: l }));
      memo.title = (text.split('\n').find(l => l.trim()) || '').trim().slice(0, 40);
      memo.category = cat; memo.linkedTasks = task ? [task] : [];
      touch(memo); if (onChange) onChange();
    };
    const showTask = () => { const t = task && MW.state.tasks.find(x => x.id === task); q('.memo-task').innerHTML = t ? `연결된 업무: <b>${esc(MW.sec.show(t.title))}</b> <button type="button" class="btn sm memo-untask">해제</button>` : ''; };
    ta.oninput = apply;
    q('.memo-cat').onchange = e => { cat = e.target.value; apply(); };
    q('.memo-new').onclick = async () => { await flush(); memo = null; task = null; cat = ''; ta.value = ''; q('.memo-cat').value = ''; showTask(); setStatus(''); ta.focus(); if (onChange) onChange(); };
    q('.memo-task').onclick = e => { if (e.target.classList.contains('memo-untask')) { task = null; showTask(); apply(); } };
    if (MW.state.tasks.length) picker(q('.memo-pick'), 'task', id => { task = id; showTask(); apply(); });
    setTimeout(() => ta.focus(), 30);
  }
  function renderMemo(view) {
    view.innerHTML = `<h1>빠른 메모</h1><div class="card" id="memo-comp"></div><h2 style="margin-top:18px">메모 목록 <span class="small muted" id="memo-count"></span></h2><div class="card"><ul class="list" id="memo-list"></ul></div>`;
    const list = () => {
      const ms = live('memo').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      document.getElementById('memo-count').textContent = ms.length + '건';
      document.getElementById('memo-list').innerHTML = ms.map(m => `<li><div class="para">${esc(MW.sec.show(memoText(m).slice(0, 240)))}</div>
        <div class="small muted">${m.category ? `<span class="chip">${esc(m.category)}</span> ` : ''}${m.linkedTasks.map(i => MW.state.tasks.find(t => t.id === i)).filter(Boolean).map(t => `<button type="button" class="chip" data-open="${t.id}">✅ ${esc(MW.sec.show(t.title.slice(0, 24)))}</button>`).join(' ')} 수정 ${esc(fmt(m.updatedAt))}</div>
        <div class="row" style="margin-top:6px"><a class="btn sm" href="#/docs/${m.id}">편집</a><button class="btn sm danger" data-del="${m.id}">삭제</button></div></li>`).join('') || '<li class="muted">메모가 없습니다.</li>';
    };
    composer(document.getElementById('memo-comp'), list); list();
    document.getElementById('memo-list').onclick = async e => {
      const o = e.target.closest('[data-open]'); if (o) return MW.tasks.openDetail(o.dataset.open);
      const id = e.target.dataset.del; if (!id) return;
      await softDelete(MW.state.docs.find(d => d.id === id)); MW.ui.toast('메모를 휴지통으로 옮겼습니다.'); renderMemo(view);
    };
  }
  function quickMemo() { MW.ui.modal('<h2>빠른 메모</h2><div id="qm"></div><p class="small muted" style="margin-top:10px">적는 즉시 이 기기에 저장됩니다. 창을 닫아도 「빠른 메모」 목록에 남습니다.</p>'); composer(document.getElementById('qm'), () => MW.app.refreshSoon()); }

  MW.docs = {
    KIND, LAW, PROC, create, persist, touch, flush, live, fmt, catOf, addVersion, duplicate, softDelete, restore, purge, quickMemo,
    hasDirty: () => dirty.size > 0,
    render(view, r) { return r.id ? renderDoc(view, r.id) : renderList(view); },
    renderTrash, renderManual, renderMemo
  };
})();
