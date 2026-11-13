/* Google 캘린더 양방향 동기화 (개인 일정 전용)
   - 이 파일은 sync.html에서만 불러옵니다. 업무 자료 저장소(MW.db) 코드는 그 화면에 실리지 않으므로,
     Google로 가는 요청에 업무 자료가 섞일 수 없습니다.
   - 인증: Google Identity Services 토큰 방식. 액세스 토큰은 이 화면의 메모리에만 두고 저장하지 않습니다.
     비밀키·갱신 토큰은 쓰지 않습니다(브라우저 앱에는 발급되지 않음).
   - 권한: https://www.googleapis.com/auth/calendar.events (일정 읽기·쓰기) 하나만 요청합니다.
   - 충돌(양쪽 모두 수정)은 자동으로 덮어쓰지 않고 사용자가 고르게 합니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  const C = MW.cal, API = 'https://www.googleapis.com/calendar/v3';
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  const tok = { value: null, exp: 0 };
  const nowIso = () => new Date().toISOString();
  const clone = o => JSON.parse(JSON.stringify(o));
  const DEF = { clientId: '', calendarId: 'primary', syncToken: null, lastSync: null, lastError: null, conflicts: [], log: [] };

  class SyncError extends Error { constructor(msg, kind, status) { super(msg); this.kind = kind; this.status = status; } }

  async function settings() { return Object.assign(clone(DEF), (await MW.pdb.get('meta', 'gsync')) || {}); }
  const saveSettings = s => MW.pdb.put('meta', s, 'gsync');

  /* 사용할 수 있는 환경인지: https(또는 이 PC의 시험 주소) + 개인 기기로 설정 */
  async function allowed() {
    const proto = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const meta = (await MW.pdb.get('meta', 'settings')) || {};
    if (!proto) return { ok: false, reason: '파일을 직접 연 상태에서는 사용할 수 없습니다. 휴대폰·개인 PC에서 https 주소로 열어 주세요.' };
    if (meta.deviceRole === 'admin-pc') return { ok: false, reason: '이 기기는 행정 PC로 설정되어 있어 Google 연결을 하지 않습니다.' };
    if (meta.deviceRole !== 'personal') return { ok: false, reason: '앱의 개인 일정 화면에서 이 기기를 「개인 휴대폰·PC」로 먼저 정해 주세요.' };
    return { ok: true };
  }

  /* ---------- 인증 ---------- */
  let gisP = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisP) return gisP;
    gisP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => { gisP = null; rej(new SyncError('Google 로그인 기능을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network')); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  const hasToken = () => !!tok.value && Date.now() < tok.exp - 60e3;
  /* 버튼을 누른 직후에 불러야 합니다(로그인 창은 사용자 조작으로만 열 수 있음) */
  async function connect(clientId) {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId || '')) throw new SyncError('OAuth 클라이언트 ID 형식이 아닙니다. (…apps.googleusercontent.com 으로 끝나야 합니다)', 'config');
    await loadGis();
    return new Promise((res, rej) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: r => {
          if (!r || r.error || !r.access_token) return rej(new SyncError('Google 로그인을 마치지 못했습니다' + (r && r.error ? ` (${r.error})` : '') + '.', 'auth'));
          tok.value = r.access_token; tok.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000; res(true);
        },
        error_callback: e => rej(new SyncError('로그인 창이 닫혔거나 열리지 않았습니다' + (e && e.type ? ` (${e.type})` : '') + '.', 'auth'))
      });
      client.requestAccessToken({ prompt: '' });
    });
  }
  function disconnect() {
    const t = tok.value; tok.value = null; tok.exp = 0;
    try { if (t && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, () => {}); } catch (_) { /* 무시 */ }
  }

  /* ---------- API ---------- */
  async function api(method, path, body) {
    if (!hasToken()) throw new SyncError('Google 로그인이 만료되었습니다. 다시 로그인해 주세요.', 'auth');
    let r;
    try { r = await fetch(API + path, { method, headers: Object.assign({ Authorization: 'Bearer ' + tok.value }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new SyncError('Google에 연결하지 못했습니다(네트워크 오류). 연결 상태를 확인한 뒤 다시 시도해 주세요.', 'network'); }
    if (r.status === 401) { tok.value = null; throw new SyncError('Google 로그인이 만료되었습니다. 다시 로그인해 주세요.', 'auth', 401); }
    if (r.status === 204) return null;
    let j = null; try { j = await r.json(); } catch (_) { /* 본문 없음 */ }
    if (!r.ok) { const m = j && j.error && j.error.message; throw new SyncError(`Google 응답 오류 ${r.status}${m ? ': ' + m : ''}`, r.status === 410 ? 'gone' : r.status === 404 ? 'notfound' : r.status === 403 ? 'forbidden' : 'api', r.status); }
    return j;
  }
  const calPath = s => '/calendars/' + encodeURIComponent(s.calendarId || 'primary') + '/events';

  /* ---------- 변환 ---------- */
  const isOk = it => !it.deletedAt || (it.sync && it.sync.google && it.sync.google.eventId);
  const eligible = it => !(it.origin === 'onenote' && !it.exportConfirmed);        // 원노트 후보는 「내보내기 확인」 전에는 Google로 보내지 않음
  const toBody = it => C.toGoogle(it).event;
  function parseExdates(g) {
    const out = [];
    (g.recurrence || []).filter(l => /^EXDATE/.test(l)).forEach(l => l.split(':')[1].split(',').forEach(v => out.push(v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8))));
    return out;
  }
  /* Google 일정 → 앱 일정 필드(앱에서만 쓰는 카테고리·색·메모 등은 기존 값 유지) */
  function applyRemote(base, g) {
    const f = C.fromGoogle(g), it = clone(base);
    ['title', 'type', 'desc', 'location', 'allDay', 'start', 'startTime', 'end', 'endTime', 'rule'].forEach(k => { if (f[k] !== undefined) it[k] = f[k]; });
    if (f.allDay) { it.startTime = ''; it.endTime = ''; }
    if (g.reminders && !g.reminders.useDefault) it.alarms = f.alarms.slice(0, 5);
    it.exdates = it.rule ? parseExdates(g) : [];
    it.sync = Object.assign({ google: null, error: null }, it.sync, { error: f.issues.length ? f.issues.join(' / ') : null });
    return it;
  }
  function newFromRemote(g, s) {
    const base = { id: 'e_g_' + MW.cal.hash(s.calendarId + '|' + g.id), type: 'event', title: '', desc: '', location: '', memo: '', allDay: false, start: '', startTime: '', end: '', endTime: '',
      category: '개인 약속', priority: '보통', color: '#06b6d4', rule: null, exdates: [], overrides: {}, alarms: [], done: false, origin: 'google', exportConfirmed: true, sync: { google: null, error: null }, deletedAt: null };
    return applyRemote(base, g);
  }
  const linkInfo = (s, g, version) => ({ calendarId: s.calendarId, eventId: g.id, syncedVersion: version, remoteUpdated: g.updated || null, lastSyncedAt: nowIso(), remoteDeleted: false });

  /* ---------- 동기화 1회 ---------- */
  async function run(onStep) {
    const s = await settings(), step = m => { if (onStep) onStep(m); };
    const rep = { pulledNew: 0, pulledUpd: 0, pulledDel: 0, pushedNew: 0, pushedUpd: 0, pushedDel: 0, conflicts: 0, skippedInstances: 0, itemErrors: 0, notes: [] };
    const conflicts = new Map((s.conflicts || []).map(c => [c.itemId, c]));
    let items = await MW.pdb.all('items');
    const byId = new Map(items.map(i => [i.id, i]));
    const byEvent = new Map(items.filter(i => i.sync && i.sync.google && i.sync.google.eventId).map(i => [i.sync.google.eventId, i]));
    /* 휴대폰으로 이미 보낸 일정(ICS·Google 바로 추가)이 Google에 들어와 있으면 새로 만들지 않고 연결(중복 방지) */
    const sent = new Map();
    (await MW.pdb.all('exports')).filter(x => x.method !== 'intent').sort((a, b) => a.at.localeCompare(b.at)).forEach(x => x.items.forEach(r => sent.set(r.id, { version: r.version, method: x.method })));
    const unlinked = it => !(it.sync && it.sync.google && it.sync.google.eventId && !it.sync.google.remoteDeleted);
    const findSent = g => {
      const m = /^(.+)@my-workspace\.local$/.exec(g.iCalUID || '');
      if (m && sent.has(m[1]) && byId.get(m[1]) && unlinked(byId.get(m[1])) && !byId.get(m[1]).deletedAt) return byId.get(m[1]);
      const gs = g.start ? (g.start.date || String(g.start.dateTime || '').slice(0, 16)) : '';
      for (const it of byId.values()) {
        const sv = sent.get(it.id); if (!sv || sv.method !== 'gcal-link' || it.deletedAt || !unlinked(it)) continue;
        const e = C.toGoogle(it).event, ls = e.start.date || String(e.start.dateTime || '').slice(0, 16);
        if (g.summary === e.summary && gs === ls) return it;
      }
      return null;
    };
    try {
      /* 1) 가져오기: 마지막 동기화 이후 바뀐 Google 일정 (처음이거나 토큰 만료 시 최근 1년치 전체) */
      step('Google 일정 가져오는 중…');
      let remote = [], pageToken = null, syncToken = s.syncToken, nextSync = null;
      const full = () => { syncToken = null; remote = []; pageToken = null; };
      for (let guard = 0; guard < 200; guard++) {
        const q = new URLSearchParams({ maxResults: '250', showDeleted: 'true' });
        if (syncToken) q.set('syncToken', syncToken); else q.set('timeMin', new Date(Date.now() - 365 * 864e5).toISOString());
        if (pageToken) q.set('pageToken', pageToken);
        let r;
        try { r = await api('GET', calPath(s) + '?' + q.toString()); }
        catch (e) { if (e.kind === 'gone' && syncToken) { rep.notes.push('Google 동기화 기록이 만료되어 처음부터 다시 맞췄습니다.'); full(); continue; } throw e; }
        remote.push(...(r.items || []));
        if (r.nextPageToken) { pageToken = r.nextPageToken; continue; }
        nextSync = r.nextSyncToken || null; break;
      }
      for (const g of remote) {
        if (g.recurringEventId) { rep.skippedInstances++; continue; }      // 반복 일정의 개별 회차 변경은 아직 반영하지 않음(안내)
        const mwId = g.extendedProperties && g.extendedProperties.private && g.extendedProperties.private.mwId;
        let local = byEvent.get(g.id) || (mwId && byId.get(mwId)) || null;
        if (local && !(local.sync && local.sync.google && local.sync.google.eventId === g.id)) {
          if (local.sync && local.sync.google && local.sync.google.eventId && !local.sync.google.remoteDeleted) continue;   // 다른 Google 일정과 이미 연결됨 → 건드리지 않음
          /* 앱이 보낸 일정(mwId)인데 연결 정보가 없는 경우(예: 기록 초기화): 마지막으로 보낸 버전 기준으로 다시 연결 */
          local = Object.assign(clone(local), { sync: Object.assign({ error: null }, local.sync, { google: linkInfo(s, g, Number(g.extendedProperties.private.mwVersion) || 0) }) });
          await MW.pdb.saveSyncInfo(local); byId.set(local.id, local); byEvent.set(g.id, local);
        } else if (!local && g.status !== 'cancelled') {
          const f = findSent(g);
          if (f) {                                                      // 휴대폰으로 보낸 일정: 보낸 버전 기준으로 연결(이후 고친 내용은 Google로 보냄)
            local = Object.assign(clone(f), { sync: Object.assign({ error: null }, f.sync, { google: linkInfo(s, g, sent.get(f.id).version || 0) }) });
            await MW.pdb.saveSyncInfo(local); byId.set(local.id, local); byEvent.set(g.id, local); rep.linkedSent = (rep.linkedSent || 0) + 1;
          }
        }
        if (g.status === 'cancelled') {
          if (!local || local.deletedAt) { if (local) { local.sync.google.remoteDeleted = true; await MW.pdb.saveSyncInfo(local); byId.set(local.id, local); } continue; }
          if ((local.version || 0) > (local.sync.google.syncedVersion || 0)) { conflicts.set(local.id, { itemId: local.id, kind: 'remote-deleted', remote: g, at: nowIso() }); rep.conflicts++; continue; }
          const next = Object.assign(clone(local), { deletedAt: nowIso() });
          await MW.pdb.saveItem(local, next);
          next.sync.google = Object.assign({}, next.sync.google, { remoteDeleted: true, syncedVersion: next.version, lastSyncedAt: nowIso() });
          await MW.pdb.saveSyncInfo(next); byId.set(next.id, next); rep.pulledDel++; continue;
        }
        if (!local) {
          const it = newFromRemote(g, s);
          if (!C.isDate(it.start)) { rep.itemErrors++; rep.notes.push(`가져올 수 없는 일정 형식: ${g.summary || g.id}`); continue; }
          await MW.pdb.saveItem(null, it);
          it.sync.google = linkInfo(s, g, it.version); await MW.pdb.saveSyncInfo(it);
          byId.set(it.id, it); byEvent.set(g.id, it); rep.pulledNew++; continue;
        }
        const state = C.syncState(local, g);
        if (state === 'conflict') { conflicts.set(local.id, { itemId: local.id, kind: 'both-changed', remote: g, at: nowIso() }); rep.conflicts++; continue; }
        if (state === 'pull') {
          const next = applyRemote(local, g);
          await MW.pdb.saveItem(local, next);
          next.sync.google = linkInfo(s, g, next.version); await MW.pdb.saveSyncInfo(next);
          byId.set(next.id, next); conflicts.delete(local.id); rep.pulledUpd++;
        } else if (local.sync.google.remoteUpdated !== g.updated) {     // 내용 그대로, 기록만 맞춤
          local.sync.google.remoteUpdated = g.updated; await MW.pdb.saveSyncInfo(local);
        }
      }
      if (rep.linkedSent) rep.notes.push(`휴대폰으로 이미 보낸 일정 ${rep.linkedSent}건은 Google에 있는 일정과 연결했습니다(새로 만들지 않음).`);
      if (rep.skippedInstances) rep.notes.push(`Google에서 반복 일정의 특정 회차만 바꾼 내용 ${rep.skippedInstances}건은 아직 가져오지 않습니다.`);

      /* 2) 보내기: 앱에서 새로 만들었거나 고친 일정, 삭제한 일정 */
      step('앱에서 바꾼 일정 보내는 중…');
      items = [...byId.values()];
      for (const it0 of items) {
        if (!eligible(it0) || !isOk(it0) || conflicts.has(it0.id)) continue;
        const it = clone(it0), g0 = it.sync && it.sync.google;
        try {
          if (it.deletedAt) {
            if (!g0 || !g0.eventId || g0.remoteDeleted) continue;
            try { await api('DELETE', calPath(s) + '/' + encodeURIComponent(g0.eventId)); } catch (e) { if (!['gone', 'notfound'].includes(e.kind)) throw e; }
            it.sync.google = Object.assign({}, g0, { remoteDeleted: true, syncedVersion: it.version, lastSyncedAt: nowIso() }); it.sync.error = null;
            await MW.pdb.saveSyncInfo(it); rep.pushedDel++; continue;
          }
          const ov = Object.keys(it.overrides || {}).filter(k => Object.keys(it.overrides[k]).some(x => x !== 'done')).length;
          if (!g0 || !g0.eventId || g0.remoteDeleted) {
            const g = await api('POST', calPath(s), toBody(it));
            it.sync = Object.assign({}, it.sync, { google: linkInfo(s, g, it.version), error: ov ? `따로 고친 회차 ${ov}건은 Google에 반영되지 않습니다.` : null });
            await MW.pdb.saveSyncInfo(it); rep.pushedNew++;
          } else if ((it.version || 0) > (g0.syncedVersion || 0)) {
            const g = await api('PUT', calPath(s) + '/' + encodeURIComponent(g0.eventId), toBody(it));
            it.sync = Object.assign({}, it.sync, { google: linkInfo(s, g, it.version), error: ov ? `따로 고친 회차 ${ov}건은 Google에 반영되지 않습니다.` : null });
            await MW.pdb.saveSyncInfo(it); rep.pushedUpd++;
          }
        } catch (e) {
          if (e.kind === 'auth' || e.kind === 'network') throw e;
          it.sync = Object.assign({ google: null }, it.sync, { error: e.message }); await MW.pdb.saveSyncInfo(it); rep.itemErrors++;
        }
      }
      s.syncToken = nextSync || s.syncToken; s.lastSync = nowIso(); s.lastError = null;
    } catch (e) {
      s.lastError = { at: nowIso(), message: e.message, kind: e.kind || 'unknown' };
      s.conflicts = [...conflicts.values()]; await saveSettings(s);
      e.report = rep; throw e;
    }
    s.conflicts = [...conflicts.values()];
    s.log = [{ at: s.lastSync, rep: Object.assign({}, rep, { notes: undefined }) }].concat(s.log || []).slice(0, 20);
    await saveSettings(s);
    return rep;
  }

  /* 충돌 해결: 'mine' = 앱 내용으로 Google 덮어쓰기, 'google' = Google 내용으로 앱 덮어쓰기 (사용자가 직접 고름) */
  async function resolve(itemId, choice) {
    const s = await settings(), c = (s.conflicts || []).find(x => x.itemId === itemId); if (!c) return;
    const local = await MW.pdb.get('items', itemId), g = c.remote;
    if (choice === 'google') {
      if (g.status === 'cancelled') { const next = Object.assign(clone(local), { deletedAt: nowIso() }); await MW.pdb.saveItem(local, next); next.sync.google = Object.assign({}, next.sync.google, { remoteDeleted: true, syncedVersion: next.version }); await MW.pdb.saveSyncInfo(next); }
      else { const next = applyRemote(local, g); await MW.pdb.saveItem(local, next); next.sync.google = linkInfo(s, g, next.version); await MW.pdb.saveSyncInfo(next); }
    } else {
      const it = clone(local); let r = null;
      if (local.deletedAt) { try { await api('DELETE', calPath(s) + '/' + encodeURIComponent(g.id)); } catch (e) { if (!['gone', 'notfound'].includes(e.kind)) throw e; } }
      else if (g.status === 'cancelled') r = await api('POST', calPath(s), toBody(it));          // Google에서 지운 일정을 앱 내용으로 다시 만듦
      else r = await api('PUT', calPath(s) + '/' + encodeURIComponent(g.id), toBody(it));
      it.sync.google = r ? linkInfo(s, r, it.version) : Object.assign({}, it.sync.google, { remoteDeleted: true, syncedVersion: it.version });
      await MW.pdb.saveSyncInfo(it);
    }
    s.conflicts = s.conflicts.filter(x => x.itemId !== itemId); await saveSettings(s);
  }
  async function pendingCount() {
    const items = await MW.pdb.all('items');
    return items.filter(i => eligible(i) && isOk(i) && (i.deletedAt ? i.sync.google && !i.sync.google.remoteDeleted : !(i.sync && i.sync.google && i.sync.google.eventId && !i.sync.google.remoteDeleted) || i.version > i.sync.google.syncedVersion)).length;
  }
  /* 처음부터 다시 맞추기(Google 쪽 기록만 초기화, 일정은 지우지 않음) */
  async function resetToken() { const s = await settings(); s.syncToken = null; await saveSettings(s); }

  MW.gsync = { SCOPE, settings, saveSettings, allowed, connect, disconnect, hasToken, run, resolve, pendingCount, resetToken, _tok: tok };
})();
