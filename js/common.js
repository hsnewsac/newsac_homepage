/* =========================================================
   공통 레이아웃 + 유틸
   헤더/푸터를 한 곳에서 관리합니다. 메뉴를 바꾸려면 이 파일만 수정하세요.
========================================================= */

export const KIND = { camp: '집합형 연수', workshop: '강사 워크샵' };
export const ORG_TYPES = ['초중고등 교원', '대학생/대학원생', '기업/기관 종사자', '프리랜서'];

/* ---------- 헤더/푸터 주입 ---------- */
export function initLayout(active){
  const header = document.getElementById('site-header');
  if (header){
    header.innerHTML = `
    <div class="header-inner">
      <a href="index.html" class="brand">
        <svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
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
        <a href="about.html"  class="${active === 'about'  ? 'active' : ''}">사업단 소개</a>
        <a href="admin.html"  class="${active === 'admin'  ? 'active' : ''}">관리자</a>
      </nav>
    </div>`;
    header.querySelectorAll('#gnb a').forEach(a => {
      a.addEventListener('click', () => document.getElementById('gnb').classList.remove('open'));
    });
  }

  const footer = document.getElementById('site-footer');
  if (footer){
    footer.innerHTML = `
    <div class="footer-inner">
      <div>
        <h4>한신대학교 디지털새싹 사업단</h4>
        <p>경기도 오산시 한신대길 137 한신대학교<br>사무국 031-000-0000 · hello@hsnewsac.com<br>운영시간 평일 09:00 ~ 18:00 (점심 12:00~13:00)</p>
      </div>
      <div>
        <h4>바로가기</h4>
        <p><a href="index.html">홈</a> · <a href="notice.html">공지사항</a> · <a href="check.html">신청 확인</a> · <a href="about.html">사업단 소개</a> · <a href="admin.html">관리자</a></p>
      </div>
    </div>
    <div class="footer-bottom">© 2026 Hanshin University Digital Saessak.</div>`;
  }
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
export function fbError(err){
  console.error(err);
  const map = {
    'permission-denied': '권한이 없습니다. Firestore 보안 규칙을 확인하세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/user-not-found': '등록되지 않은 관리자 계정입니다.',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
    'auth/too-many-requests': '시도 횟수가 많습니다. 잠시 후 다시 시도하세요.',
    'auth/unauthorized-domain': '이 도메인이 Firebase 승인 목록에 없습니다. Authentication → Settings → 승인된 도메인에 추가하세요.',
    'unavailable': '네트워크 연결을 확인해주세요.'
  };
  return map[err.code] || ('오류가 발생했습니다: ' + (err.code || err.message));
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
