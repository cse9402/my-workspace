/* IndexedDB 저장소. 주의: IndexedDB는 암호화된 보안 저장소가 아닙니다.
   - MW.db  (my-workspace, 이 파일)        : 업무 자료 — 원노트 원본·업무 항목·문서·매뉴얼·정기 업무
   - MW.pdb (my-workspace-personal, pdb.js) : 개인 일정 — 일정·할 일·변경 이력·자동화 대기 기록·내보내기 기록
   두 저장소는 서로의 자료를 읽지 않으며, 개인 일정 내보내기(ICS)·향후 동기화는 MW.pdb만 사용합니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  let pending = 0;
  const notify = (ok, err) => { if (MW.onSaveState) MW.onSaveState(pending, ok, err); };
  function friendly(e) {
    const n = e && e.name;
    if (n === 'QuotaExceededError') return new Error('저장 공간이 부족합니다. 브라우저 저장 공간을 확보한 뒤 다시 시도해 주세요.');
    if (n === 'SecurityError' || n === 'InvalidStateError') return new Error('브라우저 저장소를 사용할 수 없습니다. (시크릿 창이거나 저장이 차단된 상태일 수 있습니다)');
    if (e instanceof Error) return e;
    return new Error(String((e && e.message) || e || '저장 실패'));
  }
  /* cfg: { name, version, data:[keyPath id 저장소], need:{저장소: 검증함수}, required:[반드시 있어야 하는 저장소] } */
  function createDb(cfg) {
    const DATA = cfg.data, STORES = ['meta'].concat(DATA), need = cfg.need;
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
        let r;
        try { r = indexedDB.open(cfg.name, cfg.version); } catch (e) { return rej(friendly(e)); }
        r.onupgradeneeded = () => {
          const d = r.result, has = n => d.objectStoreNames.contains(n);
          if (!has('meta')) d.createObjectStore('meta');
          DATA.forEach(n => { if (!has(n)) d.createObjectStore(n, { keyPath: 'id' }); });
          if (!has('staging')) d.createObjectStore('staging', { autoIncrement: true });
        };
        r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
        r.onerror = () => rej(friendly(r.error));
        r.onblocked = () => rej(new Error('다른 탭에서 앱이 열려 있어 저장소를 열 수 없습니다. 다른 탭을 닫고 새로고침해 주세요.'));
      });
      dbp.catch(() => { dbp = null; });
      return dbp;
    }
    /* 여러 저장소를 한 번에 다루는 트랜잭션. 중간에 하나라도 실패하면 전부 취소됩니다(원자적). */
    function tx(stores, mode, fn) {
      const write = mode === 'readwrite';
      if (write) { pending++; notify(); }
      return open().then(d => new Promise((res, rej) => {
        let t, out;
        try { t = d.transaction(stores, mode); } catch (e) { return rej(e); }
        t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : undefined);
        t.onabort = () => rej(t.error || new Error('저장이 취소되었습니다.'));
        try { out = fn(n => t.objectStore(n), t); } catch (e) { try { t.abort(); } catch (_) { /* 이미 취소됨 */ } rej(e); }
      })).then(v => { if (write) { pending--; notify(true); } return v; },
              e => { e = friendly(e); if (write) { pending--; notify(false, e); } throw e; });
    }
    const one = (store, mode, fn) => tx(store, mode, S => fn(S(store)));
    /* 저장소 묶음(stores) 전체 검증 — 아무것도 저장하지 않음 */
    function validateStores(stores) {
      const errors = [], counts = {}, err = m => { if (errors.length < 20) errors.push(m); };
      if (!stores || typeof stores !== 'object') return { errors: ['백업 파일에 stores 항목이 없습니다.'], counts };
      (cfg.required || []).forEach(s => { if (!Array.isArray(stores[s])) err(`${s} 목록이 없습니다.`); });
      DATA.forEach(s => {
        const arr = stores[s] === undefined ? [] : stores[s];
        if (!Array.isArray(arr)) return err(`${s} 항목이 목록 형식이 아닙니다.`);
        const seen = new Set();
        arr.forEach((r, i) => {
          if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) err(`${s} ${i + 1}번째 자료: 고유 ID가 없습니다.`);
          else if (seen.has(r.id)) err(`${s} ${i + 1}번째 자료: ID가 중복됩니다.`);
          else if (!need[s](r)) err(`${s} ${i + 1}번째 자료: 필수 값이 없거나 형식이 다릅니다.`);
          if (r && r.id) seen.add(r.id);
        });
        counts[s] = arr.length;
      });
      const meta = stores.meta === undefined ? [] : stores.meta;
      if (!Array.isArray(meta)) err('meta 항목이 목록 형식이 아닙니다.');
      else meta.forEach((m, i) => { if (!m || typeof m.key !== 'string') err(`meta ${i + 1}번째: key가 없습니다.`); });
      return { errors, counts };
    }
    const api = {
      name: cfg.name, stores: STORES, dataStores: DATA, tx, validateStores,
      get: (store, key) => one(store, 'readonly', s => s.get(key)),
      all: store => one(store, 'readonly', s => s.getAll()),
      count: store => one(store, 'readonly', s => s.count()),
      put: (store, val, key) => one(store, 'readwrite', s => (key === undefined ? s.put(val) : s.put(val, key))),
      del: (store, key) => one(store, 'readwrite', s => s.delete(key)),
      bulkPut: (store, arr) => one(store, 'readwrite', s => { arr.forEach(v => s.put(v)); }),
      clear: store => one(store, 'readwrite', s => s.clear()),
      wipe: () => tx(STORES.concat('staging'), 'readwrite', S => { STORES.concat('staging').forEach(n => S(n).clear()); }),
      async exportStores() {
        const out = {};
        for (const s of DATA) out[s] = await api.all(s);
        const keys = await one('meta', 'readonly', s => s.getAllKeys()), vals = await one('meta', 'readonly', s => s.getAll());
        out.meta = keys.map((k, i) => ({ key: k, value: vals[i] }));
        return out;
      },
      /* 안전한 교체: ① 전체 검증 → ② 임시 저장소(staging)에 기록 → ③ 기록 건수 확인 → ④ 한 번의 트랜잭션으로 교체.
         ①~③에서 실패하면 기존 자료는 손대지 않고, ④가 중간에 실패하면 트랜잭션 전체가 취소되어 기존 자료가 그대로 남습니다. */
      async replaceStores(stores, opt) {
        opt = opt || {};
        const v = validateStores(stores);
        if (v.errors.length) throw new Error('백업 파일 검증 실패: ' + v.errors.slice(0, 3).join(' / ') + (v.errors.length > 3 ? ` 외 ${v.errors.length - 3}건` : ''));
        const recs = [];
        DATA.forEach(s => (stores[s] || []).forEach(r => recs.push({ store: s, value: r })));
        (stores.meta || []).forEach(m => recs.push({ store: 'meta', key: m.key, value: m.value }));
        try {
          await tx('staging', 'readwrite', S => { const st = S('staging'); st.clear(); recs.forEach(r => st.add(r)); });
          const n = await api.count('staging');
          if (n !== recs.length) throw new Error(`임시 저장 확인 실패 (기록 ${n} / 예상 ${recs.length})`);
          await tx(STORES.concat('staging'), 'readwrite', (S, t) => {
            STORES.forEach(s => S(s).clear());
            const cur = S('staging').openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (c) { const r = c.value; if (r.store === 'meta') S('meta').put(r.value, r.key); else S(r.store).put(r.value); c.continue(); }
              else if (opt.testFailAtSwap) t.abort();   // 테스트 전용: 교체 도중 실패 상황 재현
              else S('staging').clear();
            };
          });
        } finally { try { await api.clear('staging'); } catch (_) { /* 다음 실행 때 정리 */ } }
        return v.counts;
      }
    };
    return api;
  }

  /* ---------- 업무 자료 저장소 ---------- */
  const db = createDb({
    name: 'my-workspace', version: 2, data: ['pages', 'tasks', 'docs', 'versions', 'routines', 'rlog'], required: ['pages', 'tasks'],
    need: {
      pages: r => typeof r.title === 'string' && Array.isArray(r.blocks),
      tasks: r => typeof r.detail === 'string' && typeof r.status === 'string',
      docs: r => ['doc', 'manual', 'memo'].includes(r.kind) && Array.isArray(r.blocks),
      versions: r => typeof r.docId === 'string' && Array.isArray(r.blocks),
      routines: r => typeof r.title === 'string',
      rlog: r => typeof r.routineId === 'string' && typeof r.periodKey === 'string'
    }
  });
  db.pending = () => pending;
  db.validateBackup = obj => {
    if (!obj || typeof obj !== 'object' || obj.app !== 'my-workspace') return { errors: ['MY WORKSPACE 백업 파일이 아닙니다.'], counts: {} };
    const pre = [1, 2].includes(obj.format) ? [] : ['지원하지 않는 백업 형식입니다. (format: ' + obj.format + ')'];
    const v = db.validateStores(obj.stores); return { errors: pre.concat(v.errors), counts: v.counts };
  };
  db.exportAll = async () => ({ app: 'my-workspace', format: 2, exportedAt: new Date().toISOString(), stores: await db.exportStores() });
  db.importAll = async (obj, opt) => {
    const v = db.validateBackup(obj);
    if (v.errors.length) throw new Error('백업 파일 검증 실패: ' + v.errors.slice(0, 3).join(' / ') + (v.errors.length > 3 ? ` 외 ${v.errors.length - 3}건` : ''));
    return db.replaceStores(obj.stores, opt);
  };

  /* 개인 일정 저장소는 js/pdb.js(MW.pdb, 'my-workspace-personal')가 따로 관리합니다.
     업무 자료와 개인 일정을 한 백업 파일·한 요청에 섞지 않습니다. */
  MW.db = db;
})();
