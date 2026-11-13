/* 클라우드 동기화 자리(미구현). 이번 단계에서는 구조만 분리해 두었고, 네트워크로 아무것도 보내지 않습니다.
   향후 구현 시 원칙: ① 사용자가 「외부 저장 허용」으로 표시한 문서(syncAllowed)만 대상
                     ② 원노트에서 가져온 원본 페이지·업무 항목은 대상에서 제외
                     ③ 기관 보안정책 확인과 사용자 로그인 뒤에만 켤 수 있음 */
/* 개인 일정(Google 캘린더) 동기화는 업무 자료 동기화와 완전히 다른 경로로 설계합니다.
   - 개인 일정: MW.pdb('my-workspace-personal') → (향후) 개인 일정 전용 인증 서버 → Google Calendar API
     변환 규칙은 MW.cal.toGoogle / fromGoogle / syncState 에 준비되어 있으나, 이번 단계에서는 연결하지 않습니다.
   - 업무 자료: 아래 MW.sync (구현 안 됨). 업무 자료는 개인 일정 경로로 절대 보내지 않습니다. */
(function () {
  const MW = (window.MW = window.MW || {});
  MW.sync = {
    implemented: false,
    enabled: false,
    adapter: null,                                   // 향후: { push(records), pull(since), signIn(), signOut() }
    eligible: st => st.docs.filter(d => d.syncAllowed && !d.deletedAt),
    status(st) { return { implemented: false, enabled: false, eligible: MW.sync.eligible(st).length }; },
    async push() { throw new Error('클라우드 동기화는 아직 구현되지 않았습니다.'); },
    async pull() { throw new Error('클라우드 동기화는 아직 구현되지 않았습니다.'); }
  };
})();
