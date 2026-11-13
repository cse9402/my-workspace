/* 원노트 아카이브: 원본 보존 열람 (원본 블록 순서·좌표·표 그대로) */
(function () {
  const MW = (window.MW = window.MW || {});
  const F = { section: '', year: '', month: '', type: '', title: '' };
  const TYPE = { daily: '일일 업무일지', monthly: '월간 일정', note: '메모·절차' };
  let showPos = false;
  const sorted = () => MW.state.pages.slice().sort((a, b) => a.sectionOrder - b.sectionOrder || (a.date === null) - (b.date === null) || String(a.date).localeCompare(String(b.date)) || a.orderInFile - b.orderInFile);
  function filtered() {
    const t = MW.search.squash(F.title);
    return sorted().filter(p => (!F.section || p.section === F.section) && (!F.type || p.type === F.type) &&
      (!F.year || (p.date || '').slice(0, 4) === F.year) && (!F.month || (p.date || '').slice(5, 7) === F.month) &&
      (!t || MW.search.squash(p.title).includes(t)));
  }
  function listHtml(curId) {
    const { esc } = MW.ui, ps = filtered(); let html = '', grp = null;
    ps.forEach(p => {
      const g = p.section + ' · ' + (p.date ? p.date.slice(0, 7) : '날짜 미확인');
      if (g !== grp) { html += `<h3>${esc(g)}</h3>`; grp = g; }
      html += `<a href="#/archive/${p.id}" class="${p.id === curId ? 'on' : ''}"><span>${p.fav ? '★ ' : ''}${esc(p.title || '(제목없음)')}</span><span class="small">${esc(p.date && p.date.length === 10 ? p.date.slice(5) : TYPE[p.type] || '')}</span></a>`;
    });
    return `<div class="small muted" id="arc-count">${ps.length}개 페이지</div>` + (html || '<p class="muted">조건에 맞는 페이지가 없습니다.</p>');
  }
  function childHtml(c, q) {
    const { esc } = MW.ui, show = MW.sec.show, pad = `style="padding-left:${(c.level || 0) * 22}px"`;
    if (c.type === 'paragraph') {
      const tags = (c.tags || []).map(t => `<span class="chip c-warn" title="완료 여부 미확인">☐ ${esc(t.label || '태그')}</span>`).join('');
      const list = c.list ? esc(c.list) + ' ' : '';
      return `<p class="para" ${pad}>${tags}${list}${MW.search.mark(show(c.text), q, esc)}</p>`;
    }
    if (c.type === 'table') return `<div class="scroll-x" ${pad}><table class="t"><tbody>${c.rows.map(r => '<tr>' + r.map(x => `<td>${MW.search.mark(show(x), q, esc).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>').join('')}</tbody></table></div>`;
    if (c.type === 'image') return `<div class="imgph" ${pad}>🖼 이미지 자리 — 이미지 파일은 추출되지 않았습니다${c.alt ? ' (' + esc(c.alt) + ')' : ''}</div>`;
    if (c.type === 'attachment') return `<div class="imgph" ${pad}>📎 첨부파일 자리: ${esc(c.name || '')}</div>`;
    return `<div class="imgph" ${pad}>알 수 없는 블록(${esc(c.type)})</div>`;
  }
  function pageHtml(p, q) {
    const { esc } = MW.ui, list = filtered(), i = list.findIndex(x => x.id === p.id);
    const prev = list[i - 1], next = list[i + 1], c = p.counts;
    const linked = MW.state.tasks.filter(t => t.occurrences.includes(p.id)).length;
    return `<article class="doc ${showPos ? 'showpos' : ''}" id="doc">
      <div class="row spread"><div class="row"><span class="chip c-acc">${esc(p.section)}</span><span class="chip">${esc(TYPE[p.type] || p.type)}</span><span class="chip">원본(수정 불가)</span></div>
        <div class="row"><button class="btn sm" id="pg-fav">${p.fav ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'}</button><button class="btn sm" id="pg-copy">원본 텍스트 복사</button><a class="btn sm" id="pg-manual" href="#/manual?from=${p.id}">이 페이지로 매뉴얼 만들기</a><button class="btn sm" id="pg-pos">위치 정보 ${showPos ? '숨기기' : '보기'}</button></div></div>
      <h1>${esc(p.title || '(제목없음)')}</h1>
      <p class="small muted">날짜(제목 기준): ${esc(p.date || '미확인')} · 원노트 생성일: ${esc(p.onenoteCreated || '미확인')} · 파일 안 순서: ${p.orderInFile} · 페이지 수준: ${p.level}<br>
        블록 ${c.blocks} · 단락 ${c.filled}/${c.paragraphs} · 표 ${c.tables} · 이미지 ${c.images} · 첨부 ${c.attachments} · 연결된 업무 항목 <a href="#/tasks?page=${p.id}">${linked}건</a></p>
      ${p.warnings.map(w => `<div class="notice small">⚠ ${esc(w)}</div>`).join('')}
      ${p.blocks.map((b, bi) => `<section class="blk"><div class="pos">블록 ${bi + 1} · 원본 위치 x=${b.x}, y=${b.y}</div>${b.children.map(ch => childHtml(ch, q)).join('')}</section>`).join('') || '<p class="muted">표시할 내용이 없습니다.</p>'}
      <div class="row spread" style="margin-top:18px">${prev ? `<a class="btn sm" href="#/archive/${prev.id}">← ${esc(prev.title || '이전')}</a>` : '<span></span>'}${next ? `<a class="btn sm" href="#/archive/${next.id}">${esc(next.title || '다음')} →</a>` : ''}</div>
    </article>`;
  }
  MW.archive = {
    TYPE,
    render(view, r) {
      const { esc } = MW.ui, st = MW.state;
      if (!st.pages.length) { view.innerHTML = MW.ui.empty('아카이브'); return; }
      const cur = r.id ? st.pages.find(p => p.id === r.id) : null;
      const secs = [...new Set(sorted().map(p => p.section))], years = [...new Set(st.pages.map(p => (p.date || '').slice(0, 4)).filter(Boolean))].sort();
      const opt = (v, l, s) => `<option value="${esc(v)}" ${s === v ? 'selected' : ''}>${esc(l)}</option>`;
      view.innerHTML = `<h1>원노트 아카이브</h1>
        <p class="muted small">기존 원노트 ${st.pages.length}페이지를 원본 그대로 보관·열람합니다. 이 화면의 내용은 수정되지 않습니다.</p>
        <div class="toolbar">
          <select id="f-section" aria-label="섹션">${opt('', '전체 섹션', F.section)}${secs.map(s => opt(s, s, F.section)).join('')}</select>
          <select id="f-year" aria-label="연도">${opt('', '전체 연도', F.year)}${years.map(y => opt(y, y + '년', F.year)).join('')}</select>
          <select id="f-month" aria-label="월">${opt('', '전체 월', F.month)}${Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => opt(m, Number(m) + '월', F.month)).join('')}</select>
          <select id="f-type" aria-label="종류">${opt('', '전체 종류', F.type)}${Object.keys(TYPE).map(k => opt(k, TYPE[k], F.type)).join('')}</select>
          <input id="f-title" type="search" placeholder="페이지 제목 검색" value="${esc(F.title)}" aria-label="페이지 제목 검색">
        </div>
        <div class="split"><div class="card pagelist" id="arc-list">${listHtml(r.id)}</div>
        <div id="arc-page">${cur ? pageHtml(cur, r.q || '') : (r.id ? '<div class="card">페이지를 찾을 수 없습니다.</div>' : '<div class="card muted">왼쪽 목록에서 페이지를 선택하세요.</div>')}</div></div>`;
      const relist = () => { document.getElementById('arc-list').innerHTML = listHtml(r.id); };
      [['f-section', 'section'], ['f-year', 'year'], ['f-month', 'month'], ['f-type', 'type']].forEach(([id, k]) => document.getElementById(id).onchange = e => { F[k] = e.target.value; relist(); });
      document.getElementById('f-title').oninput = e => { F.title = e.target.value; relist(); };
      if (cur) {
        MW.app.touchRecent('page', cur.id);
        document.getElementById('pg-fav').onclick = async () => { cur.fav = !cur.fav; await MW.app.save('pages', cur); MW.archive.render(view, r); };
        document.getElementById('pg-pos').onclick = () => { showPos = !showPos; MW.archive.render(view, r); };
        document.getElementById('pg-copy').onclick = () => MW.ui.copy((cur.title ? cur.title + '\n' : '') + cur.text);
        const on = document.querySelector('#arc-list a.on'); if (on) on.scrollIntoView({ block: 'center' });
        const mk = document.querySelector('#doc mark'); if (mk) mk.scrollIntoView({ block: 'center' });
      }
    }
  };
})();
