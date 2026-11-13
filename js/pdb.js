/* 개인 일정 전용 저장소 (IndexedDB 'my-workspace-personal')
   업무 자료(원노트·업무 항목·문서)가 들어 있는 'my-workspace' 저장소와 완전히 분리되어 있습니다.
   백업 파일도 따로 만들며, 두 자료가 한 파일·한 요청에 섞이지 않습니다.
   주의: 브라우저 저장소는 암호화된 보안 저장소가 아닙니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  const NAME = 'my-workspace-personal', VER = 1, APP = 'my-workspace-personal';
  const DATA = ['items', 'history', 'exports'];                     // keyPath: id
  const STORES = ['meta', 'outbox'].concat(DATA);                   // outbox keyPath: idempotencyKey
  let dbp = null, pending = 0;
  const friendly = e => {
    const n = e && e.name;
    if (n === 'QuotaExceededError') return new Error('저장 공간이 부족합니다.');
    if (n === 'SecurityError' || n === 'InvalidStateError') return new Error('브라우저 저장소를 사용할 수 없습니다. (시크릿 창이거나 저장이 차단된 상태일 수 있습니다)');
    return e instanceof Error ? e : new Error(String((e && e.message) || e || '저장 실패'));
  };
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
      let r; try { r = indexedDB.open(NAME, VER); } catch (e) { return rej(friendly(e)); }
      r.onupgradeneeded = () => {
        const d = r.result, has = n => d.objectStoreNames.contains(n);
        if (!has('meta')) d.createObjectStore('meta');
        DATA.forEach(n => { if (!has(n)) d.createObjectStore(n, { keyPath: 'id' }); });
        if (!has('outbox')) d.createObjectStore('outbox', { keyPath: 'idempotencyKey' });
        if (!has('staging')) d.createObjectStore('staging', { autoIncrement: true });
      };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
      r.onerror = () => rej(friendly(r.error));
      r.onblocked = () => rej(new Error('다른 탭에서 앱이 열려 있어 개인 일정 저장소를 열 수 없습니다.'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  const notify = (ok, err) => { if (MW.onSaveState) MW.onSaveState(pending, ok, err); };
  function tx(stores, mode, fn) {
    const write = mode === 'readwrite';
    if (write) { pending++; notify(); }
    return open().then(d => new Promise((res, rej) => {
      let t, out;
      try { t = d.transaction(stores, mode); } catch (e) { return rej(e); }
      t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : undefined);
      t.onabort = () => rej(t.error || new Error('저장이 취소되었습니다.'));
      try { out = fn(n => t.objectStore(n), t); } catch (e) { try { t.abort(); } catch (_) { /* 이미 취소됨 */ } rej(e); }
    })).then(v => { if (write) { pending--; notify(true); } return v; }, e => { e = friendly(e); if (write) { pending--; notify(false, e); } throw e; });
  }
  const one = (s, mode, fn) => tx(s, mode, S => fn(S(s)));
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const okItem = r => typeof r.title === 'string' && ['event', 'task'].includes(r.type) && isDate(r.start) && Array.isArray(r.alarms);
  function validateBackup(obj) {
    const errors = [], counts = {}, err = m => { if (errors.length < 20) errors.push(m); };
    if (!obj || typeof obj !== 'object') return { errors: ['백업 파일 형식이 아닙니다.'], counts };
    if (obj.app === 'my-workspace') return { errors: ['업무 자료 백업 파일입니다. 개인 일정 복원에는 개인 일정 백업 파일을 선택해 주세요.'], counts };
    if (obj.app !== APP) return { errors: ['MY WORKSPACE 개인 일정 백업 파일이 아닙니다.'], counts };
    if (obj.format !== 1) err('지원하지 않는 백업 형식입니다.');
    if (!obj.stores || typeof obj.stores !== 'object' || !Array.isArray(obj.stores.items)) return { errors: errors.concat('백업 파일에 일정 목록이 없습니다.'), counts };
    DATA.concat('outbox').forEach(s => {
      const arr = obj.stores[s] === undefined ? [] : obj.stores[s], key = s === 'outbox' ? 'idempotencyKey' : 'id';
      if (!Array.isArray(arr)) return err(`${s} 항목이 목록 형식이 아닙니다.`);
      const seen = new Set();
      arr.forEach((r, i) => {
        if (!r || typeof r[key] !== 'string' || !r[key]) err(`${s} ${i + 1}번째 자료: 고유 ID가 없습니다.`);
        else if (seen.has(r[key])) err(`${s} ${i + 1}번째 자료: ID가 중복됩니다.`);
        else if (s === 'items' && !okItem(r)) err(`일정 ${i + 1}번째 자료: 필수 값(제목·종류·날짜·알림 목록)이 없거나 형식이 다릅니다.`);
        else if (s === 'history' && (typeof r.itemId !== 'string' || !r.snapshot)) err(`변경 이력 ${i + 1}번째 자료 형식 오류`);
        if (r && r[key]) seen.add(r[key]);
      });
      counts[s] = arr.length;
    });
    const meta = obj.stores.meta === undefined ? [] : obj.stores.meta;
    if (!Array.isArray(meta) || meta.some(m => !m || typeof m.key !== 'string')) err('meta 항목 형식 오류');
    return { errors, counts };
  }
  /* 일정 1건 저장: 일정 + 변경 이력(이전 상태) + 자동화 이벤트 기록을 한 번에 저장(하나라도 실패하면 모두 취소) */
  async function saveItem(prev, next) {
    const t = new Date().toISOString();
    next.version = (prev ? prev.version || 0 : 0) + 1; next.updatedAt = t; if (!prev) next.createdAt = t;
    const evs = MW.cal.changeEvents(prev, next);
    await tx(['items', 'history', 'outbox'], 'readwrite', S => {
      S('items').put(next);
      if (prev) S('history').put({ id: 'h_' + next.id + '_' + prev.version, itemId: next.id, at: t, version: prev.version, snapshot: prev });
      evs.forEach(e => S('outbox').put(e));                         // 같은 idempotencyKey는 덮어써서 중복 기록 없음
    });
    return next;
  }
  /* 동기화 정보(sync)만 기록: 내용이 바뀐 것이 아니므로 버전·이력·자동화 기록을 남기지 않음 */
  async function saveSyncInfo(item) { await tx(['items'], 'readwrite', S => { S('items').put(item); }); return item; }
  MW.pdb = {
    NAME, APP, stores: STORES, dataStores: DATA, tx, validateBackup, saveItem, saveSyncInfo,
    pending: () => pending,
    get: (s, k) => one(s, 'readonly', st => st.get(k)),
    all: s => one(s, 'readonly', st => st.getAll()),
    count: s => one(s, 'readonly', st => st.count()),
    put: (s, v, k) => one(s, 'readwrite', st => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => one(s, 'readwrite', st => st.delete(k)),
    clear: s => one(s, 'readwrite', st => st.clear()),
    wipe: () => tx(STORES.concat('staging'), 'readwrite', S => { STORES.concat('staging').forEach(n => S(n).clear()); }),
    async exportAll() {
      const out = { app: APP, format: 1, exportedAt: new Date().toISOString(), note: '개인 일정 전용 백업입니다. 업무 자료는 들어 있지 않습니다.', stores: {} };
      for (const s of DATA.concat('outbox')) out.stores[s] = await MW.pdb.all(s);
      const keys = await one('meta', 'readonly', s => s.getAllKeys()), vals = await one('meta', 'readonly', s => s.getAll());
      out.stores.meta = keys.map((k, i) => ({ key: k, value: vals[i] }));
      return out;
    },
    /* 안전한 복원: 전체 검증 → 임시 저장 → 건수 확인 → 한 번의 트랜잭션으로 교체 (실패하면 기존 자료 유지) */
    async importAll(obj, opt) {
      opt = opt || {};
      const v = validateBackup(obj);
      if (v.errors.length) throw new Error('백업 파일 검증 실패: ' + v.errors.slice(0, 3).join(' / ') + (v.errors.length > 3 ? ` 외 ${v.errors.length - 3}건` : ''));
      const recs = [];
      DATA.concat('outbox').forEach(s => (obj.stores[s] || []).forEach(r => recs.push({ store: s, value: r })));
      (obj.stores.meta || []).forEach(m => recs.push({ store: 'meta', key: m.key, value: m.value }));
      try {
        await tx('staging', 'readwrite', S => { const st = S('staging'); st.clear(); recs.forEach(r => st.add(r)); });
        const n = await MW.pdb.count('staging');
        if (n !== recs.length) throw new Error(`임시 저장 확인 실패 (기록 ${n} / 예상 ${recs.length})`);
        await tx(STORES.concat('staging'), 'readwrite', (S, t) => {
          STORES.forEach(s => S(s).clear());
          const cur = S('staging').openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) { const r = c.value; if (r.store === 'meta') S('meta').put(r.value, r.key); else S(r.store).put(r.value); c.continue(); }
            else if (opt.testFailAtSwap) t.abort();
            else S('staging').clear();
          };
        });
      } finally { try { await MW.pdb.clear('staging'); } catch (_) { /* 다음 실행 때 정리 */ } }
      return v.counts;
    }
  };
})();
