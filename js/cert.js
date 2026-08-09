/* =========================================================
   이수증 페이지: cert.html?id=신청문서ID
   - 수료 처리(completed=true)된 신청만 이수증이 표시됩니다.
   - 문서 ID(신청번호)를 아는 본인만 접근 가능한 구조입니다.
========================================================= */
import { db } from './firebase-init.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { initLayout, esc, fbError, guessCourseKey, courseByKey } from './common.js';

initLayout('');
const $ = id => document.getElementById(id);

function showError(title, msg){
  $('certSheet').style.display = 'none';
  $('certError').style.display = 'block';
  $('certErrorTitle').textContent = title;
  $('certErrorMsg').textContent = msg;
}

async function load(){
  const id = new URLSearchParams(location.search).get('id');
  if (!id){
    showError('잘못된 접근입니다', '마이페이지의 [이수증 발급] 버튼을 통해 접속해주세요.');
    return;
  }
  try {
    /* v13: 신청(applications)과 상시 온라인 수강(enrollments) 양쪽에서 찾습니다 */
    let a = null, kind = 'app';
    let snap = await getDoc(doc(db, 'applications', id));
    if (snap.exists()) a = snap.data();
    else {
      snap = await getDoc(doc(db, 'enrollments', id));
      if (snap.exists()){ a = snap.data(); kind = 'enroll'; }
    }
    if (!a){
      showError('신청 내역을 찾을 수 없습니다', '신청번호가 올바른지 확인해주세요. 취소된 신청일 수도 있습니다.');
      return;
    }
    if (!a.completed){
      showError('아직 수료 처리 전입니다',
        '이수증은 과정 종료 후 사업단에서 수료 처리를 완료하면 발급할 수 있습니다. 문의: newsac26@naver.com');
      return;
    }
    /* v20: 미니(교구 사용법) 워크샵은 온라인 워크샵 이수 확인 후 발급번호가 채번됩니다.
       발급 대기 상태에서는 온라인 이수 절차를 함께 안내합니다. */
    if (kind === 'app' && !a.certNo
        && (a.programWsKind === 'mini' || /미니|mini|교구/i.test(a.programTitle || ''))){
      const key = guessCourseKey(a.course || a.session);
      const c = key ? courseByKey(key) : null;
      const cname = c ? c.name : '신청 강좌에 해당하는 과목';
      showError('이수증 발급 대기 중입니다', '');
      $('certErrorMsg').innerHTML = `
        미니(교구 사용법) 워크샵은 <b>온라인 워크샵까지 이수해야</b> 이수증이 발급됩니다.<br>
        아래 순서로 온라인 워크샵을 이수해주세요.<br><br>
        <span style="display:inline-block;text-align:left;line-height:2;">
        ① <a href="online.html" style="text-decoration:underline;color:var(--leaf);font-weight:700;">온라인 워크샵 페이지</a>에서
           <b>${esc(cname)}</b> 수강 신청<br>
        ② <a href="mypage.html" style="text-decoration:underline;color:var(--leaf);font-weight:700;">마이페이지</a> →
           <b>내 강의실</b>에서 차시별 영상 시청 (필수 차시 100%)<br>
        ③ 사업단 확인 후 이수증 발급 — 이 페이지에서 다시 확인하실 수 있습니다</span><br><br>
        이미 모두 이수하셨다면 사업단(newsac26@naver.com / 031-379-0255)으로 문의해주세요.`;
      return;
    }

    // 교육 기간
    let period = '-';
    if (kind === 'enroll'){
      period = '상시 온라인 워크샵';
    } else if (a.programId){
      try {
        const p = await getDoc(doc(db, 'programs', a.programId));
        if (p.exists()) period = p.data().period || '-';
      } catch (e) { /* 프로그램 삭제 시 무시 */ }
    }

    $('c-no').textContent = a.certNo || '-';
    $('c-name').textContent = a.name || '-';
    $('c-org').textContent = a.orgType ? `${a.org} (${a.orgType})` : (a.org || '-');
    $('c-program').textContent = kind === 'enroll'
      ? '디지털새싹 온라인 강사 워크샵' : (a.programTitle || '-');
    $('c-course').textContent = (kind === 'enroll' ? a.courseName : (a.course || a.session)) || '-';
    $('c-period').textContent = period;

    const d = a.completedAt?.toDate ? a.completedAt.toDate() : new Date();
    $('c-date').textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;

    document.title = `이수증_${a.name}_${a.certNo || ''} — 한신대학교 디지털새싹 사업단`;
    $('certSheet').style.display = 'block';
  } catch (err) {
    showError('오류가 발생했습니다', fbError(err));
  }
}
load();
