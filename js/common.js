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
  camp:     '집합형 연수',
  workshop: '강사 워크샵',
  recruit:  '강사 모집'          // ★ v5: 강의배정용 강사모집 공고
};

export const ORG_TYPES = ['초중고등 교원', '대학생/대학원생', '기업/기관 종사자', '프리랜서'];

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

/* ---------- v6: 지원·배정 상태 ---------- */
export const STATUS = {
  applied:  { label: '접수',     cls: 'wait',     desc: '지원서가 접수된 상태입니다.' },
  review:   { label: '검토중',   cls: 'review',   desc: '사업단에서 서류를 검토하고 있습니다.' },
  assigned: { label: '배정확정', cls: 'assigned', desc: '강의 배정이 확정되었습니다.' },
  rejected: { label: '반려',     cls: 'rejected', desc: '이번 배정에서는 선정되지 않았습니다.' }
};
export const STATUS_ORDER = ['applied', 'review', 'assigned', 'rejected'];
/** 구버전 문서(status 필드 없음)는 '접수'로 간주 */
export function statusOf(a){
  return (a && a.status && STATUS[a.status]) ? a.status : 'applied';
}
export function statusChip(a){
  const k = statusOf(a);
  return `<span class="status-chip ${STATUS[k].cls}">${STATUS[k].label}</span>`;
}

/* ---------- v6: 강사 모집 지원 시 추가 입력 ---------- */
export const WEEKDAYS  = ['월', '화', '수', '목', '금', '토'];
export const TIMESLOTS = ['오전 (09~12시)', '오후 (13~17시)', '저녁 (18~21시)', '협의 가능'];

/* ---------- 헤더/푸터 주입 ---------- */
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
        onclick="document.getElementById('gnb').classList.toggle('open')">☰</button>
      <nav id="gnb">
        <a href="index.html"  class="${active === 'home'   ? 'active' : ''}">홈</a>
        <a href="notice.html" class="${active === 'notice' ? 'active' : ''}">공지사항</a>
        <a href="check.html"  class="${active === 'check'  ? 'active' : ''}">신청 확인</a>
        <a href="mypage.html" class="${active === 'mypage' ? 'active' : ''}">마이페이지</a>
        <a href="about.html"  class="${active === 'about'  ? 'active' : ''}">사업단 소개</a>
        <a href="admin.html"  class="${active === 'admin'  ? 'active' : ''}">관리자</a>
        <span id="authChip" class="auth-chip"></span>
      </nav>
    </div>`;
    header.querySelectorAll('#gnb a').forEach(a => {
      a.addEventListener('click', () => document.getElementById('gnb').classList.remove('open'));
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
        <p>경기도 오산시 한신대길 137 한신대학교<br>사무국 031-379-0252 · hello@hsnewsac.com<br>운영시간 평일 09:00 ~ 18:00 (점심 12:00~13:00)</p>
      </div>
      <div>
        <h4>바로가기</h4>
        <p><a href="index.html">홈</a> · <a href="notice.html">공지사항</a> · <a href="check.html">신청 확인</a> · <a href="mypage.html">마이페이지</a> · <a href="about.html">사업단 소개</a> · <a href="admin.html">관리자</a></p>
      </div>
    </div>
    <div class="footer-bottom">© 2026 Hanshin University Digital Saessak.</div>`;
  }
}

/* ---------- 헤더 로그인 상태 칩 ---------- */
async function mountAuthChip(){
  const el = document.getElementById('authChip');
  if (!el) return;
  try {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import('./firebase-init.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js')
    ]);
    onAuthStateChanged(auth, u => {
      el.innerHTML = u
        ? `<a href="mypage.html" class="chip-on" title="${esc(u.email)}">${esc(shortName(u))} 님</a>`
        : `<a href="mypage.html" class="chip-off">로그인</a>`;
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
  if (diff === 0) return { text:'오늘 마감!', closed:false, urgent:true };
  return { text:`D-${diff} · ${md} 마감`, closed:false, urgent: diff <= 7 };
}
export function todayStr(){
  const t = new Date();
  return t.getFullYear() + '.' + String(t.getMonth()+1).padStart(2,'0') + '.' + String(t.getDate()).padStart(2,'0');
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
