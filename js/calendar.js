/* 개인 일정 핵심 로직 (화면과 분리된 순수 함수)
   - 날짜는 모두 서울 시각 기준 "벽시계" 값('YYYY-MM-DD', 'HH:MM')으로 저장·계산합니다.
     PC의 시간대 설정이 달라도 결과가 바뀌지 않도록 Date의 지역 시간 기능을 쓰지 않습니다.
   - 반복 규칙은 RFC 5545(iCalendar) RRULE과 같은 의미로 계산합니다.
   - ICS 생성, Google Calendar 변환(연결 전 준비용), 자동화(n8n) 이벤트 형식을 포함합니다. 네트워크 전송 기능은 없습니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  const TZ = 'Asia/Seoul';
  const pad = n => String(n).padStart(2, '0');
  const P = s => String(s).split('-').map(Number);
  const dn = s => { const a = P(s); return Math.round(Date.UTC(a[0], a[1] - 1, a[2]) / 864e5); };
  const ds = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
  const addDays = (s, k) => ds(dn(s) + k);
  const wd = s => ((dn(s) + 4) % 7 + 7) % 7;                     // 0=일 … 6=토
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const addMonths = (s, k) => { const a = P(s); const t = a[0] * 12 + (a[1] - 1) + k, y = Math.floor(t / 12), m = t % 12 + 1; return y + '-' + pad(m) + '-' + pad(Math.min(a[2], daysIn(y, m))); };
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && ds(dn(s)) === s;
  const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
  const tmin = t => { const a = t.split(':').map(Number); return a[0] * 60 + a[1]; };
  const WD_KO = ['일', '월', '화', '수', '목', '금', '토'], WD_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const C = { TZ, pad, dn, ds, addDays, addMonths, wd, daysIn, isDate, isTime, WD_KO };
  C.hash = str => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0'); };

  /* ---------- 지금(서울 기준) ---------- */
  C._now = null;                                                  // 테스트용: { date: 'YYYY-MM-DD', time: 'HH:MM' }
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  C.now = () => {
    if (C._now) return C._now;
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  C.today = () => C.now().date;
  C.label = (s, opt) => { const a = P(s); return (opt && opt.year ? a[0] + '년 ' : '') + a[1] + '월 ' + a[2] + '일 (' + WD_KO[wd(s)] + ')'; };

  /* ---------- 반복 규칙 ---------- */
  const hasRule = it => !!(it.rule && it.rule.freq);
  function matches(it, d) {
    const r = it.rule, iv = Math.max(1, r.interval || 1), k = dn(d) - dn(it.start);
    if (k < 0) return false;
    if (r.freq === 'daily') return k % iv === 0;
    if (r.freq === 'weekdays') { const w = wd(d); return w >= 1 && w <= 5; }
    if (r.freq === 'weekly') {
      const days = r.byDay && r.byDay.length ? r.byDay : [wd(it.start)];
      if (!days.includes(wd(d))) return false;
      const ws = x => dn(x) - ((wd(x) + 6) % 7);                  // 그 주의 월요일 (WKST=MO)
      return ((ws(d) - ws(it.start)) / 7) % iv === 0;
    }
    const a = P(d), b = P(it.start);
    if (r.freq === 'monthly') return a[2] === (r.monthDay || b[2]) && ((a[0] - b[0]) * 12 + (a[1] - b[1])) % iv === 0;
    if (r.freq === 'yearly') return a[1] === b[1] && a[2] === b[2] && (a[0] - b[0]) % iv === 0;
    return false;
  }
  /* 시작일이 규칙에 맞지 않으면 첫 번째로 맞는 날짜로 옮김 (RFC 5545: DTSTART는 규칙과 일치해야 함) */
  C.normalizeStart = it => {
    if (!hasRule(it) || matches(it, it.start)) return null;
    for (let i = 1; i < 3000; i++) { const d = addDays(it.start, i); if (matches(it, d)) return d; }
    return null;
  };
  const until = it => (it.rule && it.rule.until) || '9999-12-31';

  /* 기간 [from, to] 안의 일정 회차. 반복 일정은 회차마다 펼치고, 회차별 수정(overrides)과 삭제(exdates)를 반영 */
  C.expand = (it, from, to) => {
    const dur = Math.max(0, dn(it.end || it.start) - dn(it.start)), out = [];
    const mk = (orig, o) => {
      o = o || {};
      const start = o.start || orig, end = o.end || addDays(start, dur);
      if (end < from || start > to) return;
      out.push({ key: it.id + '|' + orig, id: it.id, item: it, orig, recurring: hasRule(it), changed: !!(it.overrides && it.overrides[orig] && Object.keys(it.overrides[orig]).some(k => k !== 'done')),
        title: o.title !== undefined ? o.title : it.title, start, end, startTime: o.startTime !== undefined ? o.startTime : it.startTime, endTime: o.endTime !== undefined ? o.endTime : it.endTime,
        location: o.location !== undefined ? o.location : it.location, desc: o.desc !== undefined ? o.desc : it.desc,
        done: o.done !== undefined ? o.done : (hasRule(it) ? false : !!it.done), allDay: it.allDay, type: it.type, color: it.color, category: it.category, priority: it.priority });
    };
    if (!hasRule(it)) { mk(it.start); return out; }
    const ex = new Set(it.exdates || []), ov = it.overrides || {}, r = it.rule;
    let last = to; Object.keys(ov).forEach(k => { if (k > last) last = k; });
    const stop = Math.min(dn(last), dn(until(it))), cnt = r.count || 0;
    let n = 0;
    for (let x = dn(it.start), i = 0; x <= stop && i < 40000; x++, i++) {
      const d = ds(x);
      if (!matches(it, d)) continue;
      n++; if (cnt && n > cnt) break;                             // EXDATE도 회차 수(COUNT)에 포함됨
      if (!ex.has(d)) mk(d, ov[d]);
    }
    return out;
  };
  C.occurrences = (items, from, to) => {
    const out = [];
    items.forEach(it => { if (!it.deletedAt) out.push(...C.expand(it, from, to)); });
    return C.sort(out);
  };
  C.sort = arr => arr.sort((a, b) => a.start.localeCompare(b.start) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || String(a.startTime || '').localeCompare(String(b.startTime || '')) || a.title.localeCompare(b.title));
  C.next = (it, fromDate) => { const o = C.expand(it, fromDate || C.today(), addDays(fromDate || C.today(), 3660)); return o[0] || null; };
  C.ruleText = it => {
    if (!hasRule(it)) return '반복 없음';
    const r = it.rule, iv = r.interval > 1 ? r.interval : 0, a = P(it.start);
    let t = r.freq === 'daily' ? (iv ? `${iv}일마다` : '매일') : r.freq === 'weekdays' ? '평일(월~금)' :
      r.freq === 'weekly' ? `${iv ? iv + '주마다' : '매주'} ${(r.byDay && r.byDay.length ? r.byDay : [wd(it.start)]).slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map(x => WD_KO[x]).join('·')}요일` :
      r.freq === 'monthly' ? `${iv ? iv + '개월마다' : '매월'} ${r.monthDay || a[2]}일` : `${iv ? iv + '년마다' : '매년'} ${a[1]}월 ${a[2]}일`;
    if (r.until) t += ` · ${r.until}까지`; else if (r.count) t += ` · ${r.count}회`;
    return t;
  };
  C.alarmText = (m, allDay) => {
    if (allDay) { if (m <= 0 && m > -1440) return m === 0 ? '당일 0시' : `당일 ${pad(Math.floor(-m / 60))}:${pad(-m % 60)}`; const d = Math.ceil(m / 1440), t = d * 1440 - m; return `${d}일 전 ${pad(Math.floor(t / 60))}:${pad(t % 60)}`; }
    if (m === 0) return '정해진 시간'; if (m % 1440 === 0) return `${m / 1440}일 전`; if (m % 60 === 0) return `${m / 60}시간 전`; if (m > 60) return `${Math.floor(m / 60)}시간 ${m % 60}분 전`; return `${m}분 전`;
  };

  /* ---------- 입력 검증 ---------- */
  C.validate = it => {
    const e = [];
    if (!String(it.title || '').trim()) e.push('일정명을 입력해 주세요.');
    if (!['event', 'task'].includes(it.type)) e.push('종류가 올바르지 않습니다.');
    if (!isDate(it.start)) e.push('시작 날짜를 확인해 주세요.');
    if (it.end && !isDate(it.end)) e.push('종료 날짜를 확인해 주세요.');
    if (!it.allDay) {
      if (!isTime(it.startTime)) e.push('시작 시간을 입력하거나 「종일」을 선택해 주세요.');
      if (it.endTime && !isTime(it.endTime)) e.push('종료 시간을 확인해 주세요.');
    }
    if (isDate(it.start) && it.end && isDate(it.end)) {
      if (it.end < it.start) e.push('종료 날짜가 시작 날짜보다 앞섭니다.');
      else if (!it.allDay && it.end === it.start && isTime(it.startTime) && isTime(it.endTime) && tmin(it.endTime) < tmin(it.startTime)) e.push('종료 시간이 시작 시간보다 앞섭니다.');
    }
    const al = it.alarms || [];
    if (al.length > 5) e.push('알림은 일정당 5개까지 설정할 수 있습니다.');
    if (al.some(m => !Number.isInteger(m) || m > 40320 || m < -1439)) e.push('알림 시간은 4주(40,320분) 전까지 설정할 수 있습니다.');
    if (hasRule(it)) {
      const r = it.rule;
      if (!['daily', 'weekdays', 'weekly', 'monthly', 'yearly'].includes(r.freq)) e.push('반복 주기가 올바르지 않습니다.');
      if (r.interval && (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 99)) e.push('반복 간격은 1~99 사이로 입력해 주세요.');
      if (r.freq === 'weekly' && r.byDay && !r.byDay.length) e.push('반복할 요일을 하나 이상 선택해 주세요.');
      if (r.monthDay && (r.monthDay < 1 || r.monthDay > 31)) e.push('반복 날짜는 1~31일 사이로 입력해 주세요.');
      if (r.until && (!isDate(r.until) || r.until < it.start)) e.push('반복 종료일은 시작 날짜 이후여야 합니다.');
      if (r.count && (!Number.isInteger(r.count) || r.count < 1 || r.count > 999)) e.push('반복 횟수는 1~999회 사이로 입력해 주세요.');
      if (r.until && r.count) e.push('반복 종료는 날짜와 횟수 중 하나만 정할 수 있습니다.');
    }
    return e;
  };
  C.warnings = it => {
    const w = [];
    if (hasRule(it) && it.rule.freq === 'monthly' && (it.rule.monthDay || P(it.start)[2]) > 28) w.push(`${it.rule.monthDay || P(it.start)[2]}일이 없는 달에는 일정이 생기지 않습니다(달력 표준 규칙).`);
    if (hasRule(it) && it.rule.freq === 'yearly' && it.start.slice(5) === '02-29') w.push('2월 29일 반복 일정은 윤년에만 생깁니다.');
    if ((it.alarms || []).length === 0) w.push('알림이 없습니다. 휴대폰에서 알림을 받으려면 알림 시간을 정해 주세요.');
    return w;
  };

  /* ---------- 시각 계산 ---------- */
  const endOf = it => {                                            // 시간 일정의 끝 (종료 시간이 없으면 일정 1시간, 할 일 30분)
    const sd = it.start, ed = it.end || it.start;
    if (it.endTime && (ed > sd || tmin(it.endTime) > tmin(it.startTime))) return { date: ed, time: it.endTime };
    const t = tmin(it.startTime) + (it.type === 'task' ? 30 : 60);
    return { date: addDays(ed, Math.floor(t / 1440)), time: pad(Math.floor((t % 1440) / 60)) + ':' + pad(t % 60) };
  };
  C.endOf = endOf;

  /* ---------- ICS (RFC 5545) ---------- */
  const enc = new TextEncoder();
  const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  /* 한 줄 75바이트(UTF-8) 제한: 한글이 잘리지 않도록 글자 단위로 접음 */
  function fold(line) {
    const out = []; let cur = '', bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  const dt = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  const dd = d => d.replace(/-/g, '');
  const utcStamp = iso => { const x = iso ? new Date(iso) : new Date(); return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()) + 'T' + pad(x.getUTCHours()) + pad(x.getUTCMinutes()) + pad(x.getUTCSeconds()) + 'Z'; };
  C.rrule = it => {
    if (!hasRule(it)) return '';
    const r = it.rule, iv = r.interval > 1 ? ';INTERVAL=' + r.interval : '', a = P(it.start);
    let s = r.freq === 'daily' ? 'FREQ=DAILY' + iv : r.freq === 'weekdays' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' :
      r.freq === 'weekly' ? 'FREQ=WEEKLY' + iv + ';BYDAY=' + (r.byDay && r.byDay.length ? r.byDay : [wd(it.start)]).slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map(x => WD_ICS[x]).join(',') + ';WKST=MO' :
      r.freq === 'monthly' ? 'FREQ=MONTHLY' + iv + ';BYMONTHDAY=' + (r.monthDay || a[2]) : 'FREQ=YEARLY' + iv + ';BYMONTH=' + a[1] + ';BYMONTHDAY=' + a[2];
    if (r.until) s += ';UNTIL=' + (it.allDay ? dd(r.until) : dd(r.until) + 'T145959Z');   // 서울 23:59:59 = UTC 14:59:59
    else if (r.count) s += ';COUNT=' + r.count;
    return s;
  };
  const trigger = m => {
    const neg = m > 0, v = Math.abs(m);
    if (v === 0) return 'PT0M';
    const d = Math.floor(v / 1440), h = Math.floor((v % 1440) / 60), mi = v % 60;
    return (neg ? '-' : '') + 'P' + (d ? d + 'D' : '') + (h || mi ? 'T' + (h ? h + 'H' : '') + (mi ? mi + 'M' : '') : '');
  };
  C.trigger = trigger;
  const PRI = { 높음: 1, 보통: 5, 낮음: 9 };
  function veventLines(it, o, stamp) {
    const L = [], title = (it.type === 'task' ? '[할 일] ' : '') + (o ? (o.title !== undefined ? o.title : it.title) : it.title);
    const base = Object.assign({}, it, o ? { start: o.start || o.orig, end: o.end || addDays(o.start || o.orig, dn(it.end || it.start) - dn(it.start)), startTime: o.startTime !== undefined ? o.startTime : it.startTime, endTime: o.endTime !== undefined ? o.endTime : it.endTime } : {});
    if (!o && hasRule(it)) { const ns = C.normalizeStart(it); if (ns) { base.end = addDays(base.end || base.start, dn(ns) - dn(base.start)); base.start = ns; } }
    L.push('BEGIN:VEVENT', 'UID:' + it.id + '@my-workspace.local', 'DTSTAMP:' + stamp, 'SEQUENCE:' + (it.version || 0));
    if (it.createdAt) L.push('CREATED:' + utcStamp(it.createdAt));
    if (it.updatedAt) L.push('LAST-MODIFIED:' + utcStamp(it.updatedAt));
    if (o) L.push(it.allDay ? 'RECURRENCE-ID;VALUE=DATE:' + dd(o.orig) : 'RECURRENCE-ID;TZID=' + TZ + ':' + dt(o.orig, it.startTime));
    if (it.allDay) L.push('DTSTART;VALUE=DATE:' + dd(base.start), 'DTEND;VALUE=DATE:' + dd(addDays(base.end || base.start, 1)));
    else { const e = endOf(base); L.push('DTSTART;TZID=' + TZ + ':' + dt(base.start, base.startTime), 'DTEND;TZID=' + TZ + ':' + dt(e.date, e.time)); }
    L.push('SUMMARY:' + icsText(title));
    const desc = [o && o.desc !== undefined ? o.desc : it.desc, it.memo ? '메모: ' + it.memo : ''].filter(Boolean).join('\n');
    if (desc) L.push('DESCRIPTION:' + icsText(desc));
    const loc = o && o.location !== undefined ? o.location : it.location;
    if (loc) L.push('LOCATION:' + icsText(loc));
    if (it.category) L.push('CATEGORIES:' + icsText(it.category));
    if (PRI[it.priority]) L.push('PRIORITY:' + PRI[it.priority]);
    L.push('TRANSP:' + (it.allDay ? 'TRANSPARENT' : 'OPAQUE'));
    if (!o && hasRule(it)) {
      L.push('RRULE:' + C.rrule(it));
      const ex = (it.exdates || []).slice().sort();
      if (ex.length) L.push(it.allDay ? 'EXDATE;VALUE=DATE:' + ex.map(dd).join(',') : 'EXDATE;TZID=' + TZ + ':' + ex.map(d => dt(d, it.startTime)).join(','));
    }
    (it.alarms || []).forEach(m => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(title), 'TRIGGER:' + trigger(m), 'END:VALARM'));
    L.push('END:VEVENT');
    return L;
  }
  C.toICS = (items, opt) => {
    const stamp = (opt && opt.stamp) || utcStamp();
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MY WORKSPACE//Personal Calendar 1.0//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:MY WORKSPACE 개인 일정', 'X-WR-TIMEZONE:' + TZ,
      'BEGIN:VTIMEZONE', 'TZID:' + TZ, 'X-LIC-LOCATION:' + TZ, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE'];
    items.forEach(it => {
      L.push(...veventLines(it, null, stamp));
      if (hasRule(it)) Object.keys(it.overrides || {}).sort().forEach(orig => {
        if ((it.exdates || []).includes(orig)) return;
        const o = Object.assign({ orig }, it.overrides[orig]);
        const keys = Object.keys(it.overrides[orig]).filter(k => k !== 'done');
        if (keys.length) L.push(...veventLines(it, o, stamp));       // 완료 표시만 바뀐 회차는 휴대폰 일정에 영향 없음
      });
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  };

  /* ---------- Google Calendar 변환 (연결 전 준비용, 전송 기능 없음) ----------
     공식 문서 기준: reminders.overrides 최대 5개, minutes 0~40320, method 'popup'|'email'.
     extendedProperties.private.mwId에 로컬 ID를 넣어 같은 일정이 두 번 만들어지지 않게 대응시킵니다. */
  C.toGoogle = it0 => {
    const ns = hasRule(it0) ? C.normalizeStart(it0) : null;
    const it = ns ? Object.assign({}, it0, { start: ns, end: addDays(it0.end || it0.start, dn(ns) - dn(it0.start)) }) : it0;
    const ev = { summary: (it.type === 'task' ? '[할 일] ' : '') + it.title, description: [it.desc, it.memo ? '메모: ' + it.memo : ''].filter(Boolean).join('\n') || undefined, location: it.location || undefined,
      extendedProperties: { private: { mwId: it.id, mwVersion: String(it.version || 0) } } };
    if (it.allDay) { ev.start = { date: it.start }; ev.end = { date: addDays(it.end || it.start, 1) }; }
    else { const e = endOf(it); ev.start = { dateTime: it.start + 'T' + it.startTime + ':00', timeZone: TZ }; ev.end = { dateTime: e.date + 'T' + e.time + ':00', timeZone: TZ }; }
    if (hasRule(it)) {
      ev.recurrence = ['RRULE:' + C.rrule(it)];
      const ex = (it.exdates || []).slice().sort();
      if (ex.length) ev.recurrence.push(it.allDay ? 'EXDATE;VALUE=DATE:' + ex.map(dd).join(',') : 'EXDATE;TZID=' + TZ + ':' + ex.map(d => dt(d, it.startTime)).join(','));
    }
    const ok = (it.alarms || []).filter(m => m >= 0 && m <= 40320), bad = (it.alarms || []).filter(m => !(m >= 0 && m <= 40320));
    ev.reminders = { useDefault: false, overrides: ok.slice(0, 5).map(m => ({ method: 'popup', minutes: m })) };
    return { event: ev, unmapped: bad.concat(ok.slice(5)), overridesNeedSeparateUpdate: Object.keys(it.overrides || {}).length };
  };
  C.fromGoogle = g => {
    const it = { title: (g.summary || '').replace(/^\[할 일\] /, ''), type: /^\[할 일\] /.test(g.summary || '') ? 'task' : 'event', desc: g.description || '', location: g.location || '', alarms: [], rule: null, issues: [] };
    const kst = iso => { const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
    if (g.start && g.start.date) { it.allDay = true; it.start = g.start.date; it.end = addDays(g.end && g.end.date ? g.end.date : addDays(g.start.date, 1), -1); }
    else if (g.start && g.start.dateTime) { const s = kst(g.start.dateTime), e = kst(g.end.dateTime); Object.assign(it, { allDay: false, start: s.date, startTime: s.time, end: e.date, endTime: e.time }); }
    if (g.reminders && !g.reminders.useDefault) it.alarms = (g.reminders.overrides || []).filter(r => r.method === 'popup').map(r => r.minutes);
    else if (g.reminders && g.reminders.useDefault) it.issues.push('캘린더 기본 알림 사용(알림 시간 미확인)');
    (g.recurrence || []).forEach(line => {
      if (!/^RRULE:/.test(line)) { if (/^EXDATE/.test(line)) it.issues.push('제외 날짜 포함(확인 필요)'); else it.issues.push('지원하지 않는 반복 항목: ' + line.split(':')[0]); return; }
      const kv = Object.fromEntries(line.slice(6).split(';').map(x => x.split('=')));
      const iv = kv.INTERVAL ? +kv.INTERVAL : 1, extra = Object.keys(kv).filter(k => !['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'UNTIL', 'COUNT', 'WKST'].includes(k));
      const r = { interval: iv };
      if (kv.FREQ === 'DAILY' && !kv.BYDAY) r.freq = 'daily';
      else if (kv.FREQ === 'WEEKLY' && kv.BYDAY === 'MO,TU,WE,TH,FR' && iv === 1) r.freq = 'weekdays';
      else if (kv.FREQ === 'WEEKLY' && (!kv.BYDAY || /^(SU|MO|TU|WE|TH|FR|SA)(,(SU|MO|TU|WE|TH|FR|SA))*$/.test(kv.BYDAY))) { r.freq = 'weekly'; r.byDay = kv.BYDAY ? kv.BYDAY.split(',').map(x => WD_ICS.indexOf(x)) : [wd(it.start)]; }
      else if (kv.FREQ === 'MONTHLY' && (!kv.BYDAY) && (!kv.BYMONTHDAY || /^\d+$/.test(kv.BYMONTHDAY))) { r.freq = 'monthly'; r.monthDay = kv.BYMONTHDAY ? +kv.BYMONTHDAY : P(it.start)[2]; }
      else if (kv.FREQ === 'YEARLY' && !kv.BYDAY) r.freq = 'yearly';
      if (!r.freq || extra.length) { it.issues.push('이 앱이 표현할 수 없는 반복 규칙: ' + line); return; }
      if (kv.COUNT) r.count = +kv.COUNT;
      if (kv.UNTIL) { const u = kv.UNTIL; r.until = /T\d{6}Z$/.test(u) ? kst(u.slice(0, 4) + '-' + u.slice(4, 6) + '-' + u.slice(6, 8) + 'T' + u.slice(9, 11) + ':' + u.slice(11, 13) + ':' + u.slice(13, 15) + 'Z').date : u.slice(0, 4) + '-' + u.slice(4, 6) + '-' + u.slice(6, 8); }
      it.rule = r;
    });
    return it;
  };
  /* 동기화 상태 판단(연결 전 준비용): 마지막 동기화 이후 한쪽만 바뀌었는지, 양쪽 모두 바뀌었는지(충돌) */
  C.syncState = (local, remote) => {
    const s = (local && local.sync && local.sync.google) || null;
    if (!s || !s.eventId) return remote ? 'remote-only' : 'local-only';
    if (!remote) return local.deletedAt ? 'deleted-both' : 'remote-deleted';
    const lc = (local.version || 0) > (s.syncedVersion || 0), rc = !!remote.updated && remote.updated !== s.remoteUpdated;
    return lc && rc ? 'conflict' : lc ? 'push' : rc ? 'pull' : 'in-sync';
  };

  /* ---------- 안드로이드 캘린더 「새 일정」 화면 바로 열기 (intent 링크) ----------
     안드로이드 표준 캘린더 입력 화면(ACTION_INSERT)에 제목·시간·장소·설명·반복을 채워 엽니다. 저장은 사용자가 캘린더 앱에서 누릅니다.
     안드로이드 표준 입력 화면은 알림 값을 받지 않으므로 알림은 캘린더 앱의 기본 알림이 적용됩니다. */
  C.epochKST = (d, t) => { const a = P(d), m = t && isTime(t) ? tmin(t) : 0; return Date.UTC(a[0], a[1] - 1, a[2], 0, m) - 9 * 3600e3; };
  /* Google 캘린더 「일정 추가」 화면 링크: 사용자가 눌러서 Google 화면을 열고 직접 저장함(자동 전송 아님)
     ※ 안드로이드 intent 방식은 브라우저가 캘린더 앱 실행을 막아(실기기 확인) 사용하지 않음 */
  C.gcalUrl = it0 => {
    const ns = hasRule(it0) ? C.normalizeStart(it0) : null;
    const it = ns ? Object.assign({}, it0, { start: ns, end: addDays(it0.end || it0.start, dn(ns) - dn(it0.start)) }) : it0;
    const dates = it.allDay ? dd(it.start) + '/' + dd(addDays(it.end || it.start, 1)) : (e => dt(it.start, it.startTime) + '/' + dt(e.date, e.time))(endOf(it));
    const q = new URLSearchParams();
    q.set('action', 'TEMPLATE'); q.set('text', (it.type === 'task' ? '[할 일] ' : '') + it.title); q.set('dates', dates);
    if (!it.allDay) q.set('ctz', TZ);
    const desc = [it.desc, it.memo ? '메모: ' + it.memo : ''].filter(Boolean).join('\n'); if (desc) q.set('details', desc);
    if (it.location) q.set('location', it.location);
    if (hasRule(it)) q.set('recur', 'RRULE:' + C.rrule(it));
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  };
  C.linkLimits = it => {                                            // 바로 추가 링크로는 넘어가지 않는 내용
    const w = [];
    if ((it.alarms || []).length) w.push('알림 시간(Google 캘린더 기본 알림이 적용됨)');
    if (hasRule(it) && (it.exdates || []).length) w.push(`뺀 날 ${it.exdates.length}일`);
    if (hasRule(it) && Object.keys(it.overrides || {}).filter(k => Object.keys(it.overrides[k]).some(x => x !== 'done')).length) w.push('따로 고친 회차');
    return w;
  };

  /* ---------- 자동화(n8n) 이벤트 형식 (전송 기능 없음, 이 기기 안에만 기록) ---------- */
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  C.EVENT_TYPES = ['calendar.event.created', 'calendar.event.updated', 'calendar.event.deleted', 'task.created', 'task.updated', 'task.completed', 'reminder.created', 'reminder.updated'];
  C.makeEvent = (type, it) => ({
    eventId: uuid(), type, source: 'my-workspace/personal', entityType: it.type === 'task' ? 'task' : 'calendar.event', entityId: it.id,
    version: it.version || 0, updatedAt: it.updatedAt, timestamp: new Date().toISOString(), idempotencyKey: `${type}:${it.id}:v${it.version || 0}`, status: 'local-only'
  });
  /* 저장 전후를 비교해 어떤 이벤트가 생겼는지 계산 */
  C.changeEvents = (prev, next) => {
    const out = [], ev = next.type === 'task' ? 'task' : 'calendar.event';
    if (!prev) out.push(ev + '.created');
    else if (next.deletedAt && !prev.deletedAt) out.push(ev === 'task' ? 'task.updated' : 'calendar.event.deleted');
    else if (next.type === 'task' && next.done && !prev.done) out.push('task.completed');
    else out.push(ev + '.updated');
    const pa = JSON.stringify((prev && prev.alarms) || []), na = JSON.stringify(next.alarms || []);
    if (pa !== na && !next.deletedAt) out.push(prev && prev.alarms && prev.alarms.length ? 'reminder.updated' : 'reminder.created');
    return out.map(t => C.makeEvent(t, next));
  };
  MW.cal = C;
})();
