/* 원본 JSON·CSV 가져오기: 인코딩 검사 → 구조 검증 → ID 생성 → 연결 → 보고서. 원본 파일은 수정하지 않습니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  const CSV_HEAD = ['업무분류', '내용', '반복횟수', '최초일', '최종일', '할일태그', '섹션'];
  const PAGE_KEYS = ['title', 'date', 'type', 'level', 'onenote_created', 'order_in_file', 'blocks'];

  /* 안정적인 ID: 같은 입력이면 항상 같은 값(cyrb53). scripts/validate_convert.py와 동일 알고리즘 */
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }
  const pageId = (section, order, title) => 'p_' + hash(section + '\u0001' + order + '\u0001' + title);
  const taskId = text => 't_' + hash(text);
  /* 업무 항목 내용과 페이지 단락을 맞춰 보기 위한 정규화 */
  const norm = t => String(t).replace(/﷟/g, '').replace(/\[[^\]\s]+:\/\/[^\]]*\]\s?/g, '').replace(/\s+/g, ' ').trim();
  const rowText = r => norm('TBL: ' + r.map(c => String(c).replace(/\n/g, ' / ')).join(' | '));

  function decode(buf) {
    const u8 = new Uint8Array(buf);
    const bom = u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
    try { return { ok: true, bom, text: new TextDecoder('utf-8', { fatal: true }).decode(u8) }; }
    catch (e) { return { ok: false, bom, text: '', error: 'UTF-8 인코딩이 아닙니다. (EUC-KR 등으로 저장된 파일일 수 있습니다)' }; }
  }
  function readFile(file) {
    if (!file) return Promise.reject(new Error('파일이 선택되지 않았습니다.'));
    if (file.size === 0) return Promise.reject(new Error('빈 파일입니다: ' + file.name));
    if (file.size > 200 * 1024 * 1024) return Promise.reject(new Error('파일이 너무 큽니다(200MB 초과): ' + file.name));
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(decode(r.result)); r.onerror = () => rej(new Error('파일을 읽지 못했습니다: ' + file.name)); r.readAsArrayBuffer(file); });
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function validateJson(obj) {
    const errors = [], warnings = [], st = { sections: 0, pages: 0, blocks: 0, paragraph: 0, table: 0, image: 0, attachment: 0, other: 0, types: {} };
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.sections)) { errors.push('최상위에 sections 배열이 없습니다.'); return { errors, warnings, stats: st }; }
    obj.sections.forEach((s, si) => {
      st.sections++;
      if (typeof s.name !== 'string' || !Array.isArray(s.pages)) { errors.push(`섹션 ${si + 1}: name 또는 pages가 없습니다.`); return; }
      const seen = new Set();
      s.pages.forEach((p, pi) => {
        st.pages++;
        const miss = PAGE_KEYS.filter(k => !(k in p));
        if (miss.length) { errors.push(`${s.name} ${pi + 1}번째 페이지: ${miss.join(', ')} 키가 없습니다.`); return; }
        if (seen.has(p.order_in_file)) errors.push(`${s.name}: order_in_file ${p.order_in_file} 중복`); seen.add(p.order_in_file);
        st.types[p.type] = (st.types[p.type] || 0) + 1;
        if (p.date !== null && !/^\d{4}-\d{2}(-\d{2})?$/.test(p.date)) warnings.push(`${s.name} / ${p.title}: 날짜 형식 확인 필요 (${p.date})`);
        if (!Array.isArray(p.blocks)) { errors.push(`${s.name} / ${p.title}: blocks가 배열이 아닙니다.`); return; }
        p.blocks.forEach(b => {
          st.blocks++;
          if (typeof b.x !== 'number' || typeof b.y !== 'number' || !Array.isArray(b.children)) { errors.push(`${s.name} / ${p.title}: 블록 구조(x, y, children) 오류`); return; }
          b.children.forEach(c => {
            if (c.type === 'paragraph') { st.paragraph++; if (typeof c.text !== 'string') errors.push(`${s.name} / ${p.title}: 단락 text 오류`); }
            else if (c.type === 'table') { st.table++; if (!Array.isArray(c.rows)) errors.push(`${s.name} / ${p.title}: 표 rows 오류`); }
            else if (c.type === 'image') st.image++;
            else if (c.type === 'attachment') st.attachment++;
            else { st.other++; warnings.push(`${s.name} / ${p.title}: 알 수 없는 블록 종류 '${c.type}'`); }
          });
        });
      });
    });
    return { errors, warnings, stats: st };
  }
  function validateCsv(rows) {
    const errors = [], warnings = [];
    if (!rows.length) { errors.push('CSV가 비어 있습니다.'); return { errors, warnings, count: 0 }; }
    const head = rows[0].map(h => h.replace(/^﻿/, ''));
    CSV_HEAD.forEach((h, i) => { if (head[i] !== h) errors.push(`CSV ${i + 1}번째 열 이름이 '${h}'가 아닙니다. (실제: '${head[i] || ''}')`); });
    const seen = new Set(); let n = 0;
    rows.slice(1).forEach((r, i) => {
      if (r.length === 1 && r[0] === '') return;
      n++;
      if (r.length !== CSV_HEAD.length) { errors.push(`CSV ${i + 2}행: 열 개수 ${r.length} (7이어야 함)`); return; }
      if (!r[1]) warnings.push(`CSV ${i + 2}행: 내용이 비어 있습니다.`);
      if (seen.has(r[1])) warnings.push(`CSV ${i + 2}행: 같은 내용이 중복됩니다.`); seen.add(r[1]);
      if (r[2] && !/^\d+$/.test(r[2])) warnings.push(`CSV ${i + 2}행: 반복횟수가 숫자가 아닙니다.`);
      [r[3], r[4]].forEach(d => { if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) warnings.push(`CSV ${i + 2}행: 날짜 형식 확인 필요 (${d})`); });
    });
    return { errors, warnings, count: n };
  }

  /* 원본 → 앱 데이터. 원본 블록은 그대로 보존(pages[].blocks) */
  function build(obj, rows) {
    const now = new Date().toISOString(), pages = [], tasks = [], byText = new Map(), sens = [];
    rows.slice(1).forEach(r => {
      if (r.length !== CSV_HEAD.length || !r[1]) return;
      const t = {
        id: taskId(r[1]), title: r[1].length > 70 ? r[1].slice(0, 70) + '…' : r[1], detail: r[1],
        category: r[0], origCategory: r[0], firstSeen: r[3] || null, lastSeen: r[4] || null,
        count: Number(r[2]) || 0, hadTodoTag: r[5] === 'Y', sourceSection: r[6], occurrences: [],
        status: '미분류', priority: '미확인', due: null, doneDate: null, recurring: '미확인', tags: [], memo: '', fav: false, updatedAt: null
      };
      tasks.push(t); byText.set(norm(r[1]), t);
      sens.push({ text: r[1], where: '업무 항목' });
    });
    const dateCount = {};
    obj.sections.forEach(s => s.pages.forEach(p => { if (p.type === 'daily' && p.date) { const k = s.name + '|' + p.date; dateCount[k] = (dateCount[k] || 0) + 1; } }));
    let matchedParas = 0;
    obj.sections.forEach((s, si) => s.pages.forEach(p => {
      const id = pageId(s.name, p.order_in_file, p.title);
      const c = { blocks: p.blocks.length, paragraphs: 0, filled: 0, tables: 0, images: 0, attachments: 0, tags: 0, chars: 0 };
      const parts = [], linked = new Set();
      const link = key => { const t = byText.get(key); if (t) { matchedParas++; if (!linked.has(t.id)) { linked.add(t.id); t.occurrences.push(id); } } };
      p.blocks.forEach(b => b.children.forEach(ch => {
        if (ch.type === 'paragraph') {
          c.paragraphs++; if (ch.text.trim()) { c.filled++; parts.push(ch.text); c.chars += ch.text.length; link(norm(ch.text)); }
          if (ch.tags) c.tags += ch.tags.length;
        } else if (ch.type === 'table') { c.tables++; ch.rows.forEach(r => { parts.push(r.join(' ')); link(rowText(r)); }); }
        else if (ch.type === 'image') c.images++;
        else if (ch.type === 'attachment') c.attachments++;
      }));
      const warn = [];
      if (!c.filled && !c.tables) warn.push('내용이 없는 페이지입니다.');
      if (!p.title) warn.push('제목이 없는 페이지입니다.');
      if (p.date === null) warn.push('날짜를 제목에서 확인하지 못했습니다(미확인).');
      if (c.images) warn.push(`이미지 ${c.images}개: 위치만 기록되어 있고 이미지 파일은 추출되지 않았습니다.`);
      if (c.tags) warn.push('체크박스·태그의 완료 여부는 추출 과정에서 확인되지 않았습니다(미확인).');
      if (dateCount[s.name + '|' + p.date] > 1) warn.push(`같은 날짜(${p.date})의 페이지가 ${dateCount[s.name + '|' + p.date]}개 있습니다.`);
      const text = parts.join('\n');
      pages.push({ id, section: s.name, sectionOrder: si, title: p.title, date: p.date, type: p.type, level: p.level, onenoteCreated: p.onenote_created, orderInFile: p.order_in_file, blocks: p.blocks, text, counts: c, warnings: warn, fav: false, importedAt: now });
      sens.push({ text: p.title + '\n' + text, where: s.name + ' / ' + (p.title || '(제목없음)') });
    }));
    const ids = new Set(pages.map(p => p.id)), tids = new Set(tasks.map(t => t.id));
    const unmatched = tasks.filter(t => !t.occurrences.length).length;
    const report = {
      createdAt: now, source: obj.source || null, generated: obj.generated || null, masking: obj.masking || null,
      pagesIn: obj.sections.reduce((a, s) => a + s.pages.length, 0), pagesOut: pages.length, pageIdUnique: ids.size === pages.length,
      tasksIn: rows.slice(1).filter(r => r.length === CSV_HEAD.length && r[1]).length, tasksOut: tasks.length, taskIdUnique: tids.size === tasks.length,
      tasksLinked: tasks.length - unmatched, tasksUnlinked: unmatched, matchedParagraphs: matchedParas,
      sumCsvCount: tasks.reduce((a, t) => a + t.count, 0)
    };
    return { pages, tasks, report, sensitive: MW.sec.scan(sens) };
  }

  /* 저장: 다시 가져와도 중복 생성되지 않고, 사용자가 바꾼 값(상태·메모 등)은 유지.
     페이지·업무·보고서를 한 번의 트랜잭션으로 기록하므로 중간에 실패하면 아무것도 바뀌지 않습니다. */
  async function commit(result) {
    if (!result || !Array.isArray(result.pages) || !Array.isArray(result.tasks)) throw new Error('가져올 자료가 올바르지 않습니다.');
    const bad = result.pages.concat(result.tasks).find(r => !r || typeof r.id !== 'string' || !r.id);
    if (bad) throw new Error('고유 ID가 없는 자료가 있어 저장하지 않았습니다.');
    const oldT = new Map((await MW.db.all('tasks')).map(t => [t.id, t]));
    const oldP = new Map((await MW.db.all('pages')).map(p => [p.id, p]));
    const KEEP = ['status', 'priority', 'due', 'doneDate', 'recurring', 'tags', 'memo', 'fav', 'updatedAt', 'category'];
    let kept = 0;
    result.tasks.forEach(t => { const o = oldT.get(t.id); if (o) { kept++; KEEP.forEach(k => { if (o[k] !== undefined) t[k] = o[k]; }); } });
    result.pages.forEach(p => { const o = oldP.get(p.id); if (o) p.fav = !!o.fav; });
    result.report.reimportKept = kept;
    await MW.db.tx(['pages', 'tasks', 'meta'], 'readwrite', S => {
      result.pages.forEach(p => S('pages').put(p));
      result.tasks.forEach(t => S('tasks').put(t));
      S('meta').put(result.report, 'importReport');
    });
    return result.report;
  }
  MW.importer = { hash, pageId, taskId, norm, decode, readFile, parseCsv, validateJson, validateCsv, build, commit, CSV_HEAD };
})();
