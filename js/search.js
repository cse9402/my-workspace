/* 브라우저 내부 통합 검색(외부 전송 없음). 띄어쓰기 차이·일부 단어·여러 키워드(모두 포함) 지원 */
(function () {
  const MW = (window.MW = window.MW || {});
  const squash = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* 키워드 글자 사이의 띄어쓰기를 무시하는 정규식 */
  const looseRe = kw => new RegExp(squash(kw).split('').map(escRe).join('\\s*'), 'gi');
  const words = q => String(q || '').trim().split(/\s+/).filter(Boolean);
  function snippet(text, kws) {
    for (const k of kws) { const m = looseRe(k).exec(text); if (m) { const a = Math.max(0, m.index - 30); return (a ? '…' : '') + text.slice(a, m.index + m[0].length + 60).replace(/\n/g, ' ') + '…'; } }
    return text.slice(0, 90).replace(/\n/g, ' ');
  }
  MW.search = {
    squash, words, looseRe,
    indexDoc(d) {
      const m = d.manual || {};
      d._s = squash([d.title, MW.editor.text(d.blocks), (d.tags || []).join(' '), d.category, m.law, m.purpose, m.system, m.intake, m.checks, m.papers, m.deadline, m.fee, m.sanction, m.penalty, m.notice, (m.sources || []).map(x => x.text).join(' ')].join(' '));
    },
    indexRoutine(r) { r._s = squash(r.title + ' ' + (r.note || '') + ' ' + (r.category || '')); },
    index(st) {
      (st.pages || []).forEach(p => { p._s = squash(p.title + ' ' + p.text); });
      (st.tasks || []).forEach(t => { t._s = squash(t.detail + ' ' + t.memo + ' ' + (t.tags || []).join(' ')); });
      (st.docs || []).forEach(MW.search.indexDoc);
      (st.routines || []).forEach(MW.search.indexRoutine);
    },
    /* f: {q, kind:'all'|'page'|'task'|'doc'|'manual'|'memo'|'routine', category, status, from, to, tag} */
    run(st, f) {
      const kws = words(f.q), sq = kws.map(squash), out = [];
      const hit = s => sq.every(k => (s || '').indexOf(k) >= 0), want = k => !f.kind || f.kind === 'all' || f.kind === k;
      const inRange = (a, b) => (!f.from || (b || a || '') >= f.from) && (!f.to || (a || '9') <= f.to + '-31');
      const dated = f.from || f.to;
      if (want('page') && !f.status && !f.tag) st.pages.forEach(p => {
        if (!hit(p._s)) return; if (dated && (!p.date || !inRange(p.date, p.date))) return;
        if (f.category && !p.blocks.some(b => b.children.some(c => c.category === f.category))) return;
        out.push({ kind: 'page', id: p.id, title: p.title || '(제목없음)', sub: p.section, date: p.date, snippet: snippet(p.text, kws) });
      });
      if (want('task')) st.tasks.forEach(t => {
        if (!hit(t._s)) return; if (f.category && t.category !== f.category) return; if (f.status && t.status !== f.status) return;
        if (f.tag && !(t.tags || []).includes(f.tag)) return;
        if (dated && (!t.firstSeen || !inRange(t.firstSeen, t.lastSeen))) return;
        out.push({ kind: 'task', id: t.id, title: t.title, sub: t.category + ' · ' + t.status, date: t.lastSeen, snippet: snippet(t.detail, kws) });
      });
      if (!f.status) (st.docs || []).forEach(d => {
        if (d.deletedAt || !want(d.kind) || !hit(d._s)) return; if (f.category && d.category !== f.category) return;
        if (f.tag && !(d.tags || []).includes(f.tag)) return;
        const day = (d.updatedAt || '').slice(0, 10); if (dated && !inRange(day, day)) return;
        out.push({ kind: d.kind, id: d.id, title: d.title || '제목 없음', sub: MW.docs.KIND[d.kind] + (d.category ? ' · ' + d.category : ''), date: day, snippet: snippet(MW.editor.text(d.blocks), kws) });
      });
      if (want('routine') && !f.status && !f.tag && !dated) (st.routines || []).forEach(r => {
        if (!hit(r._s)) return; if (f.category && r.category !== f.category) return;
        out.push({ kind: 'routine', id: r.id, title: r.title, sub: '정기 업무 · ' + (MW.routine.FREQ[r.freq] || '주기 확인 필요'), date: '', snippet: r.note || '' });
      });
      return out;
    },
    /* 이미 escape된 HTML이 아닌 원문에 표시를 넣어 escape해서 돌려줌 */
    mark(text, q, esc) {
      const kws = words(q); if (!kws.length) return esc(text);
      const re = new RegExp(kws.map(k => squash(k).split('').map(escRe).join('\\s*')).join('|'), 'gi');
      let out = '', last = 0, m;
      while ((m = re.exec(text))) { if (!m[0]) { re.lastIndex++; continue; } out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
      return out + esc(text.slice(last));
    }
  };
})();
