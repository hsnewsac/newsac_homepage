/* =========================================================
   공통 레이아웃 + 유틸  (v5)
   헤더/푸터를 한 곳에서 관리합니다. 메뉴를 바꾸려면 이 파일만 수정하세요.
   v5 변경점
   - 프로그램 유형에 '강사 모집(recruit)' 추가 → 향후 강의배정용 강사모집 공고에 사용
   - 강사 프로필용 공통 상수(전문분야/활동지역/경력) 추가
   - 헤더에 로그인 상태 칩 표시 (로그인 / ○○님)
   - 토스트 알림 유틸 추가
========================================================= */

export const KIND = {
  workshop: '강사 워크샵',
  recruit:  '강사 모집',         // ★ v5: 강의배정용 강사모집 공고
  camp:     '집합형 연수'        // ※ v10: 신규 등록에서 제외 (기존 데이터 표시용으로만 유지)
};

export const ORG_TYPES = ['초중고등 교원', '대학생/대학원생', '기업/기관 종사자', '프리랜서'];

/* ---------- v11: 2026 교육과정 7종 ----------
   강사 워크샵의 '개설 강좌', 강사 모집 공고의 '담당 과정' 선택에 함께 사용합니다. */
export const COURSES_2026 = [
  { key: 'lit-elem',  group: '기본', level: '초등 고학년',  icon: '📖',
    name: 'AI문학코딩: 미래 작가의 따뜻한 마음그림여행',
    intro: '생성형 AI로 감정을 이야기·동화책·주제곡으로 바꾸는 정서 중심 창작 수업' },
  { key: 'mus-elem',  group: '기본', level: '초등 저학년',  icon: '🎵',
    name: 'AI음악코딩: 유쾌한 창작자의 싱어송여행',
    intro: '허밍블럭스 교구와 AI로 순차·반복·조건·함수를 익히고 뮤직비디오까지 만드는 수업' },
  { key: 'sci-space', group: '기본', level: '초등 고학년',  icon: '🚀',
    name: 'AI과학코딩: VRAI로 떠나는 우주여행',
    intro: 'VR 체험과 티처블머신, 바이브코딩으로 우주 인터랙티브 프로젝트를 완성하는 수업' },
  { key: 'sci-vibe',  group: '기본', level: '중학교',       icon: '🔬',
    name: 'AI과학코딩: 호기심 많은 과학자의 바이브여행',
    intro: '공공데이터(NEIS API)와 바이브코딩으로 실생활 문제 해결 웹앱을 만드는 수업' },
  { key: 'sci-quant', group: '기본', level: '고등학교',     icon: '⚛️',
    name: 'AI과학코딩: 바이브실험으로 과학자의 평행우주여행',
    intro: '과학 실험 앱 제작과 양자 시뮬레이터로 다변수 최적화에 도전하는 수업' },
  { key: 'sp-lit',    group: '특화', level: '특수교육대상', icon: '🌱',
    name: 'AI문학코딩: 특수아이의 따뜻한 마음그림여행',
    intro: '사회정서학습(SEL)을 융합해 디지털 동화책을 완성하는 특수교육대상 특화 과정' },
  { key: 'sp-mus',    group: '특화', level: '특수교육대상', icon: '🔔',
    name: 'AI음악코딩: 특수아이의 유쾌한 음악여행',
    intro: '다감각 교구와 AI를 결합해 감정을 소리로 표현하는 특수교육대상 특화 과정' }
];
/** 과목 키로 조회 */
export function courseByKey(k){ return COURSES_2026.find(c => c.key === k) || null; }

/** v20.1: 강좌명 → 7종 과목 키 매칭 (이관·미니 워크샵 온라인 연동 공용)
    정식 과목명, 'AI과학코딩(초등)'·'*오프라인필수' 접미 형식 모두 인식합니다. */
export function guessCourseKey(courseName){
  const t = String(courseName || '').trim();
  if (!t) return '';
  const exact = COURSES_2026.find(c => c.name === t);
  if (exact) return exact.key;
  /* 'AI문학코딩(초등)' 형식: 과목 접두 + 괄호 안 학교급 */
  const m = t.match(/^(AI\S*코딩)\s*\(([^)]+)\)/);
  if (m){
    const subject = m[1], lv = m[2];
    const lvOk = c =>
      lv.includes('특수') ? c.level.includes('특수')
      : lv.includes('중')  ? c.level.includes('중학교')
      : lv.includes('고')  ? c.level.includes('고등학교')
      : c.level.includes('초등');
    const hit = COURSES_2026.find(c => c.name.startsWith(subject) && lvOk(c));
    if (hit) return hit.key;
  }
  /* 이름이 조금 달라도 핵심 어구로 추정 */
  const norm = v => v.replace(/[\s:·・]/g, '');
  const n = norm(t);
  const loose = COURSES_2026.find(c => norm(c.name).includes(n) || n.includes(norm(c.name)));
  if (loose) return loose.key;
  const bySub = COURSES_2026.find(c => {
    const sub = norm(c.name.split(':')[1] || '');
    return sub && (n.includes(sub) || sub.includes(n));
  });
  return bySub ? bySub.key : '';
}

/** v22: 미니 워크샵 ↔ 온라인 과목 연동 시 '이수로 인정되는' 과목 키 목록.
    음악코딩은 기본·특수가 같은 교구(허밍블럭스)를 사용하므로
    두 과목 중 어느 것을 이수해도 인정하도록 묶습니다. */
export function acceptedOnlineKeys(courseName){
  const key = guessCourseKey(courseName);
  if (!key) return [];
  const c = courseByKey(key);
  if (c && c.name.startsWith('AI음악코딩')) return ['mus-elem', 'sp-mus'];
  return [key];
}

/** 인정 과목 묶음의 표시용 이름 (예: 'AI음악코딩 (기본·특수 중 1과목)') */
export function acceptedOnlineLabel(keys){
  if (!keys.length) return '';
  if (keys.length === 1){
    const c = courseByKey(keys[0]);
    return c ? c.name : keys[0];
  }
  const prefix = (courseByKey(keys[0])?.name || '').split(':')[0] || '해당 과목';
  return `${prefix} (기본·특수 중 1과목)`;
}

/* ---------- v11: 강사 워크샵 지원 자격 ---------- */
export const WORKSHOP_TARGET = '강사를 희망하고 있는 교원, 프리랜서 등';
export const WORKSHOP_QUALIFICATION = {
  main:    ['현직 교사', '초·중등교원 자격 소지자', '민간·기업 전문가', '석사 학위 이상 대학원생'],
  assist:  ['학부생 이상'],
  exclude: ['현직 학원 운영자']
};
/** 지원 자격 안내를 HTML로 (툴팁·안내문 공용) */
export function qualificationHTML(){
  const Q = WORKSHOP_QUALIFICATION;
  return `<b>주강사</b> ${Q.main.join(' · ')}<br>
          <b>보조강사</b> ${Q.assist.join(' · ')}<br>
          <b>제외</b> ${Q.exclude.join(' · ')}`;
}

/* ---------- v11: 강사 모집 공고용 선택지 ---------- */
export const SCHOOL_LEVELS  = ['초등 저학년', '초등 고학년', '중학교', '고등학교', '특수교육대상'];
export const CAMP_MODES     = ['방문형 (학교 방문 운영)', '집합형 (캠프 운영)', '방문형 + 집합형 병행'];
export const RECRUIT_ROLES  = ['주강사', '보조강사', '주강사 + 보조강사'];

/* v11.1: 무엇을 위한 강사 모집인가 — 폼 항목이 이 값에 따라 달라집니다 */
export const RECRUIT_FOR = {
  camp:     { label: '학교 캠프 강사 모집',   hint: '학생 대상 방문형·집합형 캠프에 투입할 강사' },
  workshop: { label: '워크샵 운영 강사 모집', hint: '강사 워크샵을 진행할 강사·보조강사' }
};
/** 워크샵 운영 방식 */
export const WORKSHOP_MODES = ['대면 집합 워크샵', '온라인 실시간 워크샵', '대면 + 온라인 병행'];

/* ---------- v11: 날짜 → 한글 표기 ---------- */
/** '2026-08-03' → '2026.08.03(월)' */
export function fmtDateKo(v){
  if (!v) return '';
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d)) return v;
  const w = '일월화수목금토'[d.getDay()];
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}(${w})`;
}
/** v11.1: 시작·종료 일시 → 사람이 읽는 기간 문자열
 *  같은 날    : '2026.08.29(토) 10:00~17:00'
 *  여러 날    : '2026.08.03(월) 10:00 ~ 2026.08.21(금) 17:00'
 *  시간 미입력: '2026.08.03(월) ~ 2026.08.21(금)'                        */
export function fmtPeriodKo(start, end, startTime, endTime){
  if (!start && !end) return '';
  const s = start || end, e = end || start;
  const st = (startTime || '').slice(0, 5);
  const et = (endTime   || '').slice(0, 5);

  if (s === e){
    const d = fmtDateKo(s);
    if (st && et) return `${d} ${st}~${et}`;
    if (st)       return `${d} ${st}~`;
    return d;
  }
  const a = fmtDateKo(s) + (st ? ` ${st}` : '');
  const b = fmtDateKo(e) + (et ? ` ${et}` : '');
  return `${a} ~ ${b}`;
}

/* ---------- 강사 프로필 공통 상수 (강사모집 대비) ---------- */
export const SPECIALTIES = [
  '블록코딩(엔트리·스크래치)', '피지컬컴퓨팅(아두이노·마이크로비트)',
  '생성형 AI 활용', 'AI 윤리·디지털 시민성', '데이터 과학·시각화',
  '앱/웹 개발', '로보틱스', '메타버스·XR', '기타'
];
export const REGIONS = [
  '수원', '오산', '화성', '용인', '평택', '안산', '안양', '성남',
  '서울', '인천', '경기북부', '충청', '전국 가능'
];
export const CAREER_LEVELS = [
  '경력 없음(신규)', '1년 미만', '1~3년', '3~5년', '5~10년', '10년 이상'
];

/* ---------- v8: 회원 유형(역할) ---------- */
export const ROLES = {
  instructor: {
    label: '강사', icon: '🧑‍🏫',
    tag: '연수·캠프 강의',
    desc: '연수·캠프에서 강의하거나 강사 모집 공고에 지원합니다.'
  },
  parent: {
    label: '학부모', icon: '👨‍👩‍👧',
    tag: '자녀 참여 관리',
    desc: '자녀의 캠프·연수 참여를 신청하고 이력을 확인합니다.'
  },
  student: {
    label: '학생', icon: '🎒',
    tag: '직접 참여',
    desc: '캠프·교육 프로그램에 직접 참여하는 학생입니다.'
  },
  staff: {
    label: '교직원 / 기관 담당자', icon: '🏫',
    tag: '단체 신청·협의',
    desc: '학교·기관 담당자로 단체 참여나 협력 사업을 협의합니다.'
  }
};
export const ROLE_ORDER = ['instructor', 'parent', 'student', 'staff'];
export function roleOf(u){
  return (u && u.role && ROLES[u.role]) ? u.role : 'instructor';
}
export function roleChip(u){
  const k = roleOf(u);
  return `<span class="role-chip ${k}">${ROLES[k].icon} ${ROLES[k].label}</span>`;
}

export const GRADES = [
  '초등 1학년', '초등 2학년', '초등 3학년', '초등 4학년', '초등 5학년', '초등 6학년',
  '중학 1학년', '중학 2학년', '중학 3학년',
  '고등 1학년', '고등 2학년', '고등 3학년', '기타'
];
export const INTERESTS = [
  '블록코딩', '피지컬컴퓨팅', '생성형 AI', '게임·앱 제작',
  '데이터·AI 기초', '로보틱스', '메타버스·XR', 'AI 윤리'
];
export const STAFF_DUTIES = [
  '정보·컴퓨터 교과', '담임', '진로진학', '방과후·돌봄',
  '교육행정', '기관 사업 담당', '기타'
];

/* ---------- v6: 지원·배정 상태 ---------- */
export const STATUS = {
  applied:  { label: '접수',     cls: 'wait',     desc: '지원서가 접수된 상태입니다.' },
  review:   { label: '검토중',   cls: 'review',   desc: '사업단에서 서류를 검토하고 있습니다.' },
  assigned: { label: '배정확정', cls: 'assigned', desc: '강의 배정이 확정되었습니다.' },
  rejected: { label: '반려',     cls: 'rejected', desc: '이번 배정에서는 선정되지 않았습니다.' }
};
export const STATUS_ORDER = ['applied', 'review', 'assigned', 'rejected'];

/* ---------- v10: 워크샵·연수 '신청 승인'용 상태 ----------
   DB에 저장되는 키(applied/review/assigned/rejected)는 배정과 동일하게 유지하고,
   화면에 보이는 문구만 신청 승인 흐름에 맞게 바꿉니다.
   → 강사 모집(recruit) 공고 = 배정 흐름 / 그 외(워크샵·연수) = 승인 흐름         */
export const APPROVE_STATUS = {
  applied:  { label: '신청접수', cls: 'wait',     desc: '신청서가 접수되었습니다. 승인 대기 중입니다.' },
  review:   { label: '검토중',   cls: 'review',   desc: '사업단에서 신청 내용을 확인하고 있습니다.' },
  assigned: { label: '승인완료', cls: 'assigned', desc: '참가가 승인되었습니다. 안내 사항을 확인해주세요.' },
  rejected: { label: '반려',     cls: 'rejected', desc: '이번 회차에는 신청이 반려되었습니다.' }
};
/** 강사 모집 공고 지원 여부 */
export function isRecruit(a){ return !!a && a.programType === 'recruit'; }
/** 이 신청건에 적용할 상태 라벨 세트 */
export function statusSet(a){ return isRecruit(a) ? STATUS : APPROVE_STATUS; }

/** 구버전 문서(status 필드 없음)는 '접수'로 간주 */
export function statusOf(a){
  return (a && a.status && STATUS[a.status]) ? a.status : 'applied';
}
export function statusLabel(a){ return statusSet(a)[statusOf(a)].label; }
export function statusChip(a){
  const k = statusOf(a), S = statusSet(a);
  return `<span class="status-chip ${S[k].cls}">${S[k].label}</span>`;
}

/* ---------- v6: 강사 모집 지원 시 추가 입력 ---------- */
export const WEEKDAYS  = ['월', '화', '수', '목', '금', '토'];
export const TIMESLOTS = ['오전 (09~12시)', '오후 (13~17시)', '저녁 (18~21시)', '협의 가능'];

/* ---------- 헤더/푸터 주입 ---------- */
/* =========================================================
   v32: 간단 마크다운 → HTML
   수강 안내·과제 안내처럼 관리자가 직접 쓰는 글에 서식을 허용합니다.
   HTML을 먼저 이스케이프하므로 태그 삽입(XSS)은 불가능합니다.
   지원: # 제목, **굵게**, *기울임*, `코드`, ~~취소선~~,
        - / 1. 목록, > 인용, --- 구분선, [링크](url), 자동 링크, 줄바꿈
========================================================= */
export function mdToHtml(src){
  if (!src) return '';
  const esc0 = String(src).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    /* v41: 외부 주소뿐 아니라 사이트 안 페이지(online.html, #anchor 등)도 링크로 만듭니다.
       javascript: 같은 위험한 주소는 링크로 만들지 않고 원문 그대로 둡니다. */
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (m0, txt, url) => {
      if (!/^(https?:\/\/|mailto:|tel:|#|\/|[\w.\-]+\.html)/i.test(url)) return m0;
      const ext = /^https?:\/\//i.test(url);
      return `<a href="${url}"${ext ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`;
    })
    /* 이미 링크로 감싸지지 않은 맨 URL 자동 연결 */
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

  const out = [];
  let list = null;                       // 'ul' | 'ol'
  const closeList = () => { if (list){ out.push(`</${list}>`); list = null; } };

  esc0.split(/\r?\n/).forEach(raw => {
    const line = raw.trimEnd();
    if (!line.trim()){ closeList(); return; }
    let m;
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)){ closeList(); out.push('<hr>'); return; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))){
      closeList();
      const lv = Math.min(6, m[1].length + 2);   // # → h3
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
      return;
    }
    /* HTML을 먼저 이스케이프하므로 인용은 '&gt;' 형태로 들어옵니다 */
    if ((m = line.match(/^\s*(?:&gt;|>)\s?(.*)$/))){
      closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); return;
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))){
      if (list !== 'ul'){ closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`); return;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))){
      if (list !== 'ol'){ closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`); return;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  });
  closeList();
  return out.join('');
}

/* =========================================================
   v28: 글래스 모션 아이콘 — 프로스트 유리 타일 뒤에서
   컬러 레이어가 튀어나오는 아이콘 컴포넌트 (사이트 공용)
========================================================= */
const GLYPHS = {
  home:    '<path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>',
  notice:  '<path d="M3 10v4h3l10 5V5L6 10H3z"/><path d="M19 9.5a4 4 0 0 1 0 5"/>',
  search:  '<circle cx="10.5" cy="10.5" r="6"/><path d="M15.2 15.2 20 20"/>',
  cap:     '<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.8V16c0 1.8 11 1.8 11 0v-4.2"/><path d="M21 10v4.5"/>',
  sprout:  '<path d="M12 20v-7"/><path d="M12 13C12 9 9 7 4.8 7c0 4 3 6 7.2 6z"/><path d="M12 13c0-4 3-6 7.2-6 0 4-3 6-7.2 6z"/>',
  teacher: '<rect x="3" y="4" width="18" height="11" rx="1.6"/><path d="M8 8h8M8 11h5"/><path d="M12 15v3"/><path d="m8.5 21 3.5-3 3.5 3"/>',
  laptop:  '<rect x="4.5" y="5" width="15" height="10" rx="1.6"/><path d="M2.5 18.5h19"/>',
  school:  '<path d="M4 20V9.5L12 4l8 5.5V20"/><path d="M2.5 20h19"/><path d="M10 20v-4.5h4V20"/>',
  book:    '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M19 18v3H6.5A1.5 1.5 0 0 1 5 19.5"/>',
  users:   '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8"/><circle cx="16.8" cy="9.5" r="2.6"/><path d="M16.5 14.4c2.6.3 4.5 2 4.5 4.6"/>',
  bus:     '<rect x="4" y="4" width="16" height="12.5" rx="2"/><path d="M4 10h16"/><circle cx="8.2" cy="19" r="1.6"/><circle cx="15.8" cy="19" r="1.6"/>',
  key:     '<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5 20 3.5"/><path d="m16.5 7 3 3M14 9.5l2 2"/>',
  person:  '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 20c0-3.6 3-5.6 6.5-5.6s6.5 2 6.5 5.6"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.6"/><path d="M9.5 20h5M12 16v4"/>'
};
/** 글래스 모션 아이콘 마크업. color: green·amber·blue·purple·pink·teal / extra: 'on'(항상 컬러) 'lg'(크게) */
export function gicon(name, color = 'green', extra = ''){
  return `<span class="gic gc-${color} ${extra}"><i class="gbg"></i><i class="gtile"></i>` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] || ''}</svg></span>`;
}

export function initLayout(active){
  const header = document.getElementById('site-header');
  if (header){
    header.innerHTML = `
    <div class="header-inner">
      <a href="index.html" class="brand">
        <img src="img/logo.png" class="brand-mark brand-img" alt="사업단 로고"
             onerror="this.style.display='none';document.getElementById('brandSvg').style.display='block';">
        <svg id="brandSvg" class="brand-mark" viewBox="0 0 40 40" aria-hidden="true" style="display:none;">
          <rect x="16" y="24" width="8" height="8" rx="2" fill="#1E7F4F"/>
          <rect x="16" y="14" width="8" height="8" rx="2" fill="#5FC97E"/>
          <rect x="6"  y="8"  width="8" height="8" rx="2" fill="#5FC97E"/>
          <rect x="26" y="8"  width="8" height="8" rx="2" fill="#1E7F4F"/>
        </svg>
        <span>디지털새싹 사업단<small>한신대학교</small></span>
      </a>
      <button class="menu-btn" aria-label="메뉴 열기"
        onclick="document.getElementById('gnb').classList.toggle('open');this.classList.toggle('open')">
        <span></span><span></span><span></span>
      </button>
      <nav id="gnb">
        <a href="index.html"  class="${active === 'home'   ? 'active' : ''}">${gicon('home', 'green')}홈</a>
        <a href="notice.html" class="${active === 'notice' ? 'active' : ''}">${gicon('notice', 'amber')}공지사항</a>
        <a href="check.html"  class="${active === 'check'  ? 'active' : ''}">${gicon('search', 'blue')}신청 확인</a>
        <div class="nav-item">
          <a href="workshop.html" class="nav-parent ${['workshop','online'].includes(active) ? 'active' : ''}">${gicon('cap', 'purple')}강사 워크샵<i class="nav-caret">▾</i></a>
          <div class="nav-sub">
            <a href="workshop.html" class="${active === 'workshop' ? 'active' : ''}">${gicon('teacher', 'purple')}강사 워크샵</a>
            <a href="online.html" class="${active === 'online' ? 'active' : ''}">${gicon('laptop', 'pink')}온라인 워크샵</a>
          </div>
        </div>
        <div class="nav-item">
          <a href="about.html" class="nav-parent ${['about','programs'].includes(active) ? 'active' : ''}">${gicon('sprout', 'teal')}소개<i class="nav-caret">▾</i></a>
          <div class="nav-sub">
            <a href="about.html" class="${active === 'about' ? 'active' : ''}">${gicon('school', 'teal')}사업단 소개</a>
            <a href="programs.html" class="${active === 'programs' ? 'active' : ''}">${gicon('book', 'amber')}교육과정</a>
          </div>
        </div>
        <span id="authChip" class="auth-chip"><span class="chip-skel"></span></span>
      </nav>
    </div>`;
    header.querySelectorAll('#gnb a').forEach(a => {
      a.addEventListener('click', () => {
        document.getElementById('gnb').classList.remove('open');
        header.querySelector('.menu-btn')?.classList.remove('open');
      });
    });
    mountAuthChip();
  }

  const footer = document.getElementById('site-footer');
  if (footer){
    footer.innerHTML = `
    <div class="partner-strip" id="partnerStrip" style="display:none;">
      <div class="partner-inner">
        <span class="partner-label">함께하는 기관</span>
        <img src="img/partner-1.png" alt="교육부"
             onload="document.getElementById('partnerStrip').style.display='block'" onerror="this.remove()">
        <img src="img/partner-2.png" alt="한국과학창의재단"
             onload="document.getElementById('partnerStrip').style.display='block'" onerror="this.remove()">
        <img src="img/partner-3.png" alt="한신대학교"
             onload="document.getElementById('partnerStrip').style.display='block'" onerror="this.remove()">
        <img src="img/partner-4.png" alt="협력기관"
             onload="document.getElementById('partnerStrip').style.display='block'" onerror="this.remove()">
      </div>
    </div>
    <div class="footer-inner">
      <div>
        <h4>한신대학교 디지털새싹 사업단</h4>
        <p>(18101) 경기도 오산시 한신대길 137 한신대학교<br>임마누엘관 지하1층 5008호<br>사무국 031-379-0255 · newsac26@naver.com<br>운영시간 평일 09:00 ~ 18:00 (점심 12:00~13:00)</p>
      </div>
      <div>
        <h4>바로가기</h4>
        <p><a href="index.html">홈</a> · <a href="notice.html">공지사항</a> · <a href="check.html">신청 확인</a> · <a href="mypage.html">마이페이지</a><br><a href="workshop.html">강사 워크샵</a> · <a href="programs.html">교육과정</a> · <a href="about.html">사업단 소개</a></p>
      </div>
    </div>
    <div class="footer-bottom">© 2026 Hanshin University Digital Saessak.</div>`;
  }
}

/* ---------- 헤더 로그인 상태 칩 (역할별 분기) ---------- */
let _isAdminCache = null;
export async function checkIsAdmin(uid){
  try {
    const [{ db }, { doc, getDoc }] = await Promise.all([
      import('./firebase-init.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js')
    ]);
    return (await getDoc(doc(db, 'admins', uid))).exists();
  } catch (e) { return false; }
}

async function mountAuthChip(){
  const el = document.getElementById('authChip');
  if (!el) return;
  try {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import('./firebase-init.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js')
    ]);
    onAuthStateChanged(auth, async u => {
      if (!u){
        _isAdminCache = null;
        el.innerHTML = `<a href="mypage.html" class="chip-off">로그인</a>`;
        return;
      }
      el.innerHTML = `<span class="chip-skel"></span>`;
      const admin = await checkIsAdmin(u.uid);
      _isAdminCache = admin;
      /* v26: 로그인하면 '이름님' 버튼 하나만 표시하고,
         호버 시 마이페이지·내 강의실·(관리자) 대시보드가 플로팅됩니다 */
      el.innerHTML = `
        <div class="nav-item chip-menu">
          <a href="mypage.html" class="chip-on" title="${esc(u.email)}">
            <i>👤</i>${esc(shortName(u))} 님<i class="nav-caret">▾</i></a>
          <div class="nav-sub">
            <a href="mypage.html">${gicon('person', 'green')}마이페이지</a>
            <a href="mypage.html?goto=classroom">${gicon('monitor', 'purple')}내 강의실</a>
            ${admin ? `<a href="admin.html">${gicon('key', 'amber')}대시보드</a>` : ''}
          </div>
        </div>`;
    });
  } catch (e) { /* 파이어베이스 미로드 시 칩 생략 */ }
}
function shortName(u){
  const n = u.displayName || (u.email || '').split('@')[0];
  return n.length > 8 ? n.slice(0, 8) + '…' : n;
}

/* ---------- 유틸 ---------- */
export function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}
export function ddayInfo(p){
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(p.deadline + 'T00:00:00');
  const diff = Math.round((end - today) / 86400000);
  const md = (end.getMonth()+1) + '/' + end.getDate();
  if (diff < 0) return { text:'접수마감', closed:true };
  if (diff === 0){
    /* v19: 마감일 당일 — 마감 시각이 지정되어 있으면 그 시각 이후 마감 */
    if (p.deadlineTime && new Date() >= new Date(p.deadline + 'T' + p.deadlineTime + ':00'))
      return { text:'접수마감', closed:true };
    return { text: p.deadlineTime ? `오늘 ${p.deadlineTime} 마감!` : '오늘 마감!', closed:false, urgent:true };
  }
  return { text:`D-${diff} · ${md} 마감`, closed:false, urgent: diff <= 7 };
}

/** v19: 접수 시작(날짜+시각) 전인지 — openDate가 없으면 항상 false */
export function notYetOpen(p){
  if (!p || !p.openDate) return false;
  return new Date() < new Date(p.openDate + 'T' + (p.openTime || '00:00') + ':00');
}
/* v33: 운영 기간이 지난 프로그램 판별
   운영 종료일(endDate, 없으면 startDate)이 오늘보다 이전이면 '종료'로 봅니다.
   종료 시각(endTime)이 있으면 그 시각까지는 진행 중으로 유지합니다.
   날짜 정보가 없는 구버전 데이터는 종료로 판단하지 않습니다. */
export function programEnded(p){
  if (!p) return false;
  const end = p.endDate || p.startDate;
  if (!end) return false;
  return new Date() > new Date(end + 'T' + (p.endTime || '23:59') + ':59');
}
export function todayStr(){
  const t = new Date();
  return t.getFullYear() + '.' + String(t.getMonth()+1).padStart(2,'0') + '.' + String(t.getDate()).padStart(2,'0');
}
/* v41: 공지 본문 — 새 글은 마크다운 원문(md:true)을 저장하고 볼 때 변환합니다.
   md 표시가 없는 예전 글은 이미 HTML로 저장되어 있으므로 그대로 씁니다. */
export function noticeBodyHTML(n){
  if (!n) return '';
  return n.md ? mdToHtml(n.body || '') : String(n.body || '');
}
/* 검색·미리보기용 순수 텍스트 */
export function noticeBodyText(n){
  const src = String((n && n.body) || '');
  return (n && n.md ? src : src.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
export function noticeIsNew(dateStr){
  const d = new Date(String(dateStr).replace(/\./g, '-') + 'T00:00:00');
  return (new Date() - d) / 86400000 <= 5;
}
export function catClass(cat){
  return cat === '안내' ? 'info' : (cat === '마감임박' ? 'urgent' : '');
}
/** Firestore Timestamp → 'YYYY. M. D. 오후 3:20' */
export function tsText(ts, withTime = true){
  try {
    if (!ts?.toDate) return '-';
    return withTime
      ? ts.toDate().toLocaleString('ko-KR', {dateStyle:'short', timeStyle:'short'})
      : ts.toDate().toLocaleDateString('ko-KR');
  } catch { return '-'; }
}
/** 정렬용 숫자 타임스탬프 */
export function tsNum(ts){ return ts?.seconds || 0; }

export function fbError(err){
  console.error(err);
  const map = {
    'permission-denied': '권한이 없습니다. Firestore 보안 규칙을 확인하세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/user-not-found': '등록되지 않은 계정입니다.',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
    'auth/too-many-requests': '시도 횟수가 많습니다. 잠시 후 다시 시도하세요.',
    'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도해주세요.',
    'auth/unauthorized-domain': '이 도메인이 Firebase 승인 목록에 없습니다. Authentication → Settings → 승인된 도메인에 추가하세요.',
    'unavailable': '네트워크 연결을 확인해주세요.'
  };
  return map[err.code] || ('오류가 발생했습니다: ' + (err.code || err.message));
}

/* ---------- 토스트 알림 ---------- */
export function toast(msg, type = 'ok'){
  let box = document.getElementById('toastBox');
  if (!box){
    box = document.createElement('div');
    box.id = 'toastBox';
    box.className = 'toast-box';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---------- 모달 ---------- */
export function openModal(id){
  document.getElementById(id).classList.add('on');
  document.body.style.overflow = 'hidden';
}
export function closeModal(id){
  document.getElementById(id).classList.remove('on');
  document.body.style.overflow = '';
}
export function bindModalEvents(){
  document.querySelectorAll('.modal-back').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-back.on').forEach(m => closeModal(m.id));
  });
}
window.closeModal = closeModal;
