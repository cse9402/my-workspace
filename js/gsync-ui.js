/* sync.html 화면: Google 캘린더 동기화 설정·실행·충돌 확인 (개인 일정 전용) */
(function () {
  const MW = (window.MW = window.MW || {});
  const $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = iso => iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '없음';
  const toast = (m, err) => { const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = m; $('toasts').appendChild(d); setTimeout(() => d.remove(), err ? 9000 : 4000); };
  MW.onSaveState = (n, ok) => { const el = $('save-state'); if (el) el.textContent = n > 0 ? '저장 중…' : ok === false ? '⚠ 저장 실패' : ''; };
  let busy = false;
  const repText = r => [r.pulledNew && `Google에서 새 일정 ${r.pulledNew}건`, r.pulledUpd && `Google에서 바뀐 일정 ${r.pulledUpd}건`, r.pulledDel && `Google에서 지운 일정 ${r.pulledDel}건(앱 휴지통으로)`,
    r.pushedNew && `앱 → Google 새 일정 ${r.pushedNew}건`, r.pushedUpd && `앱 → Google 수정 ${r.pushedUpd}건`, r.pushedDel && `앱 → Google 삭제 ${r.pushedDel}건`,
    r.conflicts && `양쪽에서 바뀐 일정 ${r.conflicts}건(확인 필요)`, r.itemErrors && `오류 ${r.itemErrors}건`].filter(Boolean).join(' · ') || '바뀐 일정 없음';

  async function render() {
    const view = $('view'), al = await MW.gsync.allowed();
    if (!al.ok) { view.innerHTML = `<h1>Google 캘린더 동기화</h1><div class="notice bad">${esc(al.reason)}</div><p class="small muted">이 화면은 개인 일정만 다룹니다. 업무 자료는 Google로 보내지 않습니다.</p>`; return; }
    const s = await MW.gsync.settings(), pend = await MW.gsync.pendingCount(), items = await MW.pdb.all('items'), byId = new Map(items.map(i => [i.id, i]));
    const errs = items.filter(i => !i.deletedAt && i.sync && i.sync.error);
    view.innerHTML = `<h1>Google 캘린더 동기화</h1>
      <div class="notice info small">앱의 <b>개인 일정</b>과 개인 Google 캘린더를 서로 맞춥니다. Google 캘린더에 들어간 일정은 휴대폰 삼성 캘린더(같은 Google 계정)에 자동으로 나타나고, 앱에서 정한 알림도 함께 들어갑니다.
        <br>업무 자료는 이 화면에 불러오지 않으며 Google로 보내지 않습니다. 로그인 정보는 이 화면을 닫으면 사라집니다(저장하지 않음).</div>
      ${s.clientId ? '' : `<section class="card" id="gs-setup"><h2>처음 설정</h2><p class="small">개인 Google 계정으로 만든 <b>OAuth 클라이언트 ID</b>를 아래 「설정」에 넣어 주세요. 클라이언트 ID는 비밀번호가 아니며, 비밀키(client secret)는 넣지 않습니다.</p>
        <details><summary><b>클라이언트 ID 만드는 방법</b> <span class="small muted">(약 10분, 휴대폰·개인 PC에서)</span></summary><ol class="small" style="padding-left:20px">
          <li>console.cloud.google.com 에 개인 Google 계정으로 들어가 <b>새 프로젝트</b>를 만듭니다(이름 예: my-workspace).</li>
          <li>「API 및 서비스 → 라이브러리」에서 <b>Google Calendar API</b>를 찾아 <b>사용</b>을 누릅니다.</li>
          <li>「OAuth 동의 화면(Google 인증 플랫폼)」에서 앱 이름·지원 이메일을 넣고, 대상은 <b>외부</b>로 만듭니다. 「테스트 사용자」에 <b>내 Gmail 주소</b>를 추가합니다(게시하지 않고 테스트 상태로 둡니다).</li>
          <li>「클라이언트(사용자 인증 정보) → 만들기 → OAuth 클라이언트 ID」에서 유형 <b>웹 애플리케이션</b>, 「승인된 JavaScript 원본」에 <b>${esc(location.origin)}</b> 를 넣고 만듭니다.</li>
          <li>만들어진 <b>클라이언트 ID</b>(…apps.googleusercontent.com)를 복사해 아래에 붙여 넣고 「설정 저장」을 누릅니다. 클라이언트 보안 비밀(secret)은 쓰지 않습니다.</li>
          <li>처음 로그인할 때 「Google에서 확인하지 않은 앱」 안내가 나오면 내가 만든 앱이 맞는지 확인한 뒤 계속합니다.</li></ol>
          <p class="small muted">Google 화면의 메뉴 이름은 바뀔 수 있습니다. 행정 PC에서는 진행하지 마세요.</p></details></section>`}
      <section class="card"><h2>상태</h2>
        <table class="t"><tbody>
          <tr><th>Google 로그인</th><td id="gs-auth">${MW.gsync.hasToken() ? '<span class="chip c-ok">연결됨</span>' : '<span class="chip">로그인 필요</span>'}</td></tr>
          <tr><th>마지막 동기화</th><td id="gs-last">${esc(fmt(s.lastSync))}</td></tr>
          <tr><th>보낼 변경</th><td id="gs-pend">${pend}건</td></tr>
          <tr><th>확인할 충돌</th><td id="gs-conf">${(s.conflicts || []).length}건</td></tr>
          ${s.lastError ? `<tr><th>최근 오류</th><td class="small" id="gs-err">${esc(fmt(s.lastError.at))} · ${esc(s.lastError.message)}</td></tr>` : ''}
        </tbody></table>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="gs-run" ${s.clientId ? '' : 'disabled'} style="min-height:52px;font-size:1.05rem">${MW.gsync.hasToken() ? '지금 동기화' : 'Google 로그인하고 동기화'}</button></div>
        <p class="small muted" id="gs-step" aria-live="polite"></p></section>
      ${(s.conflicts || []).length ? `<section class="card" id="gs-conflicts"><h2>양쪽에서 바뀐 일정</h2><p class="small muted">앱과 Google에서 같은 일정을 각각 고쳤습니다. 자동으로 덮어쓰지 않았으니 어느 쪽을 남길지 골라 주세요.</p>
        <ul class="list">${s.conflicts.map(c => { const l = byId.get(c.itemId), g = c.remote; return `<li data-cf="${esc(c.itemId)}"><b>${esc(l ? l.title : c.itemId)}</b>
          <div class="small">앱: ${l ? (l.deletedAt ? '삭제함' : esc(l.start + ' ' + (l.allDay ? '종일' : l.startTime) + ' ' + l.title)) : '없음'}<br>Google: ${g.status === 'cancelled' ? '삭제됨' : esc(((g.start && (g.start.date || g.start.dateTime)) || '') + ' ' + (g.summary || ''))}</div>
          <div class="row" style="margin-top:6px"><button class="btn sm" data-keep="mine">앱 내용 남기기</button><button class="btn sm" data-keep="google">Google 내용 남기기</button></div></li>`; }).join('')}</ul></section>` : ''}
      ${errs.length ? `<section class="card"><h2>확인할 내용</h2><ul class="list small">${errs.slice(0, 20).map(i => `<li><b>${esc(i.title)}</b> — ${esc(i.sync.error)}</li>`).join('')}</ul></section>` : ''}
      <section class="card"><h2>설정</h2><div class="form">
        <label for="gs-cid">OAuth 클라이언트 ID</label><input id="gs-cid" value="${esc(s.clientId)}" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false">
        <label for="gs-cal">캘린더 ID</label><input id="gs-cal" value="${esc(s.calendarId)}" placeholder="primary" autocomplete="off"></div>
        <p class="small muted">캘린더 ID는 기본값 <b>primary</b>(내 기본 캘린더)를 권장합니다. 다른 캘린더를 쓰려면 Google 캘린더 설정의 「캘린더 ID」를 넣으세요.</p>
        <div class="row"><button class="btn" id="gs-save">설정 저장</button><button class="btn" id="gs-reset">처음부터 다시 맞추기</button>${MW.gsync.hasToken() ? '<button class="btn" id="gs-logout">로그아웃</button>' : ''}</div></section>
      ${(s.log || []).length ? `<section class="card"><h2>동기화 기록</h2><ul class="list small">${s.log.slice(0, 10).map(x => `<li>${esc(fmt(x.at))} · ${esc(repText(x.rep))}</li>`).join('')}</ul></section>` : ''}`;
    $('gs-save').onclick = async () => {
      const cid = $('gs-cid').value.trim(), cal = $('gs-cal').value.trim() || 'primary', cur = await MW.gsync.settings();
      if (cid && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(cid)) return toast('클라이언트 ID 형식이 아닙니다. (…apps.googleusercontent.com)', true);
      if (cal !== cur.calendarId && cur.lastSync && !confirm('캘린더를 바꾸면 처음부터 다시 맞춥니다. 이미 연결된 일정은 기존 캘린더와 연결된 채로 남습니다. 계속할까요?')) return;
      cur.clientId = cid; if (cal !== cur.calendarId) { cur.calendarId = cal; cur.syncToken = null; }
      try { await MW.gsync.saveSettings(cur); toast('설정을 저장했습니다.'); render(); } catch (e) { toast('저장 실패: ' + e.message, true); }
    };
    $('gs-reset').onclick = async () => { if (!confirm('Google 쪽 변경 기록만 초기화하고 다음 동기화 때 최근 1년치를 다시 비교합니다. 일정은 지우지 않습니다. 계속할까요?')) return; await MW.gsync.resetToken(); toast('다음 동기화 때 처음부터 다시 맞춥니다.'); render(); };
    if ($('gs-logout')) $('gs-logout').onclick = () => { MW.gsync.disconnect(); toast('로그아웃했습니다.'); render(); };
    $('gs-run').onclick = async () => {
      if (busy) return; busy = true; $('gs-run').disabled = true;
      const stepEl = $('gs-step'), say = m => { stepEl.textContent = m; };
      try {
        if (!MW.gsync.hasToken()) { say('Google 로그인 창을 여는 중…'); await MW.gsync.connect((await MW.gsync.settings()).clientId); }
        const rep = await MW.gsync.run(say);
        toast('동기화 완료: ' + repText(rep)); (rep.notes || []).forEach(n => toast(n));
      } catch (e) { console.error(e); toast((e.kind === 'auth' ? '로그인 필요: ' : '동기화 실패: ') + e.message + ' (이미 처리된 일정은 그대로 남습니다)', true); }
      busy = false; render();
    };
    const cf = $('gs-conflicts');
    if (cf) cf.onclick = async e => {
      const b = e.target.closest('[data-keep]'); if (!b || busy) return;
      const id = b.closest('[data-cf]').dataset.cf;
      if (!confirm(b.dataset.keep === 'mine' ? '앱의 내용으로 Google 일정을 바꿉니다. 계속할까요?' : 'Google의 내용으로 앱 일정을 바꿉니다(앱의 이전 내용은 변경 이력에 남습니다). 계속할까요?')) return;
      busy = true;
      try { if (b.dataset.keep === 'mine' && !MW.gsync.hasToken()) await MW.gsync.connect((await MW.gsync.settings()).clientId); await MW.gsync.resolve(id, b.dataset.keep); toast('반영했습니다.'); }
      catch (er) { toast('반영 실패: ' + er.message, true); }
      busy = false; render();
    };
  }
  window.addEventListener('DOMContentLoaded', () => {
    try { const look = JSON.parse(localStorage.getItem('mw-look') || '{}'); if (look.theme) document.documentElement.dataset.theme = look.theme; if (look.fs) document.documentElement.style.setProperty('--fs', look.fs); if (look.company) $('footer').textContent = `© 2026 ${look.company}. All Rights Reserved.`; } catch (_) { /* 기본값 사용 */ }
    window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
    render().catch(e => { $('view').innerHTML = `<div class="notice bad">화면을 열지 못했습니다: ${esc(e.message)}</div>`; });
  });
  MW.gsyncUi = { render };
})();
