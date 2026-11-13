/* 민감정보 탐지·화면 가리기. 자동 탐지는 완전하지 않습니다(누락 가능). */
(function () {
  const MW = (window.MW = window.MW || {});
  const P = [
    { id: 'rrn', name: '주민등록번호(가림 처리된 것 포함)', re: /\d{6}\s?-\s?[1-4](?:\d{6}|\*{6})/g },
    { id: 'phone', name: '전화번호', re: /(?:01[016789]|0\d{1,2})[-.\s]\d{3,4}[-.\s]\d{4}|\b\d{3,4}-\d{4}\b/g },
    { id: 'email', name: '이메일', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { id: 'addr', name: '주소·지번', re: /[가-힣]{2,}(?:리|동|로|길)\s?\d+(?:-\d+)?(?:번지)?/g },
    { id: 'account', name: '계정정보(ID·비밀번호)', re: /(?:\bID|\bPW|아이디|비밀번호)\s*[:：]\s*\S+|\*{8}/gi },
    { id: 'bank', name: '계좌번호로 보이는 숫자', re: /\b(?!0\d{1,2}-)\d{3}-\d{2,4}-\d{4,6}(?:-\d{2,3})?\b/g }
  ];
  function hide(s) {
    return String(s)
      .replace(P[0].re, '******-*******')
      .replace(P[4].re, m => m.replace(/([:：]\s*)\S+/, '$1●●●●'))
      .replace(P[2].re, m => m[0] + '***@' + m.split('@')[1])
      .replace(/((?:01[016789]|0\d{1,2})[-.\s])\d{3,4}([-.\s]\d{4})/g, '$1****$2');
  }
  MW.sec = {
    patterns: P,
    /* 화면 표시용: 설정이 켜져 있으면 가려서 돌려줌 (원본 데이터는 바꾸지 않음) */
    show(s) { return MW.state && MW.state.settings.mask ? hide(s || '') : (s || ''); },
    hide,
    /* texts: [{text, where}] → 유형별 건수·영향 위치·예시(가림) */
    scan(texts) {
      const out = P.map(p => ({ id: p.id, name: p.name, count: 0, where: new Set(), samples: [] }));
      for (const t of texts) {
        if (!t.text) continue;
        P.forEach((p, i) => {
          p.re.lastIndex = 0;
          const m = t.text.match(p.re);
          if (m) {
            out[i].count += m.length; out[i].where.add(t.where);
            if (out[i].samples.length < 3) out[i].samples.push(hide(m[0]).replace(/\d(?=\d{0,3}$)/g, '*'));
          }
        });
      }
      return out.map(o => ({ id: o.id, name: o.name, count: o.count, places: o.where.size, samples: o.samples }));
    }
  };
})();
