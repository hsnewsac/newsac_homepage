/* =========================================================
   메인 페이지 v5
   - 접수중 프로그램 카드 + 신청 모달 + 최신 공지 미리보기
   - 로그인 회원 신청 시 정보 자동 입력 + uid 자동 연결
   - 프로그램별 '로그인 회원만 신청' 옵션 지원 (강사 모집 공고용)
========================================================= */
import { db, auth } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy,
  increment, serverTimestamp, getDoc as fsGetDoc, doc as fsDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  initLayout, esc, ddayInfo, noticeIsNew, catClass, fbError,
  KIND, ORG_TYPES, openModal, closeModal, bindModalEvents, toast,
  WEEKDAYS, TIMESLOTS
} from './common.js';
import { sendApplicationEmail, emailEnabled } from './email-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

initLayout('home');
bindModalEvents();

document.getElementById('a-orgtype').innerHTML =
  '<option value="">유형을 선택하세요</option>' +
  ORG_TYPES.map(t => `<option>${t}</option>`).join('');

document.getElementById('a-days').innerHTML = WEEKDAYS.map((d, i) =>
  `<label class="chk"><input type="checkbox" name="ad" value="${d}" id="ad${i}"><span>${d}</span></label>`).join('');
document.getElementById('a-time').innerHTML =
  '<option value="">선택</option>' + TIMESLOTS.map(t => `<option>${t}</option>`).join('');

const $ = id => document.getElementById(id);
let programs = [];
let currentUser = null, userProfile = null;

onAuthStateChanged(auth, async user => {
  currentUser = user;
  userProfile = null;
  if (user){
    try {
      const p = await fsGetDoc(fsDoc(db, 'users', user.uid));
      if (p.exists()) userProfile = p.data();
    } catch (e) { /* 프로필 없음 */ }
  }
  renderPrograms();
});

/* ---------- 프로그램 카드 ---------- */
function renderPrograms(){
  const grid = $('programGrid');
  if (!programs.length){
    grid.innerHTML = '<div class="open-empty">현재 접수 중인 프로그램이 없습니다.<br>새로운 연수 일정은 공지사항을 통해 안내드립니다.</div>';
    return;
  }
  grid.innerHTML = programs.map(p => {
    const applied = p.applied || 0;
    const remain = p.capacity - applied;
    const dd = ddayInfo(p);
    const closed = !p.open || dd.closed || remain <= 0;
    const pct = Math.min(100, Math.round(applied / p.capacity * 100));
    const seatText = remain <= 0 ? '정원 마감'
      : (remain <= 10 ? `잔여 <strong>${remain}석</strong> · 마감 임박` : '회차별 선착순 마감');
    const needLogin = p.loginOnly && !currentUser;
    const btnClass = p.type === 'camp' ? 'btn-primary' : 'btn-navy';
    return `
    <div class="open-card ${p.type !== 'camp' ? 'workshop' : ''} ${closed ? 'closed' : ''}">
      <div class="open-top">
        ${closed
          ? '<span class="status end">접수마감</span>'
          : `<span class="status live">접수중</span><span class="dday ${dd.urgent ? '' : 'calm'}">${esc(dd.text)}</span>`}
        <span class="kind-label">${KIND[p.type] || ''}</span>
        ${p.loginOnly ? '<span class="kind-label lock">🔐 회원 전용</span>' : ''}
      </div>
      <h3>${esc(p.title)}</h3>
      <dl>
        <dt>대상</dt><dd>${esc(p.target)}</dd>
        <dt>운영</dt><dd>${esc(p.period)}</dd>
        <dt>장소</dt><dd>${esc(p.place)}</dd>
        <dt>내용</dt><dd>${esc(p.content)}</dd>
      </dl>
      <div class="seat-bar">
        신청 현황 <strong>${applied} / ${p.capacity}명</strong> · ${seatText}
        <div class="seat-track"><div class="seat-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="open-actions">
        ${closed
          ? `<button class="btn ${btnClass}" disabled>접수가 마감되었습니다</button>`
          : (needLogin
              ? `<a class="btn ${btnClass}" href="mypage.html?next=apply">🔐 로그인 후 신청하기</a>`
              : `<button class="btn ${btnClass}" onclick="openApply('${p.id}')">신청하기</button>`)}
        <a href="notice.html" class="btn btn-outline">모집 공고 보기</a>
      </div>
    </div>`;
  }).join('');
}

onSnapshot(
  query(collection(db, 'programs'), orderBy('createdAt', 'desc')),
  snap => {
    programs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPrograms();
  },
  err => {
    $('programGrid').innerHTML =
      `<div class="open-empty">프로그램을 불러오지 못했습니다.<br>${esc(fbError(err))}</div>`;
  }
);

/* ---------- 신청 모달 ---------- */
function paintAuthNote(){
  const box = $('applyAuthNote');
  if (currentUser){
    box.className = 'apply-auth on';
    box.innerHTML = `✅ <b>${esc(userProfile?.name || currentUser.displayName || currentUser.email)}</b> 님으로 신청합니다.
      이 신청은 <a href="mypage.html">마이페이지</a>에 자동으로 저장됩니다.`;
  } else {
    box.className = 'apply-auth off';
    box.innerHTML = `💡 <b>로그인하고 신청하면</b> 신청번호를 따로 보관하지 않아도 마이페이지에서 이력·이수증을 확인할 수 있고,
      참여한 강의활동이 계속 누적됩니다.
      <a class="mini-btn" href="mypage.html?next=apply">로그인 / 회원가입</a>
      <span class="aa-sub">회원가입 없이 계속 신청하셔도 됩니다.</span>`;
  }
}

function openApply(programId){
  const p = programs.find(x => x.id === programId);
  if (!p) return;
  if (p.loginOnly && !currentUser){
    location.href = 'mypage.html?next=apply';
    return;
  }
  $('applyForm').reset();
  $('a-programId').value = p.id;
  $('a-programName').value = p.title;

  const chip = $('am-kind');
  chip.textContent = KIND[p.type] || '';
  chip.style.background = p.type === 'camp' ? 'var(--sprout-soft)' : 'var(--navy-soft)';
  chip.style.color = p.type === 'camp' ? 'var(--leaf)' : 'var(--navy)';

  const courses = Array.isArray(p.courses) && p.courses.length
    ? p.courses
    : Array.from({length: p.sessions || 1}, (_, i) => `${i+1}회차`); // 구버전 데이터 호환
  $('a-course').innerHTML = '<option value="">강좌를 선택하세요</option>' +
    courses.map(c => `<option>${esc(c)}</option>`).join('');

  // 강사 모집 공고면 지원서 항목으로 전환
  const isRecruit = p.type === 'recruit';
  $('recruitFields').style.display = isRecruit ? 'block' : 'none';
  $('a-courseLabel').innerHTML = (isRecruit ? '지원 분야' : '희망 강좌') + ' <span class="req">*</span>';
  $('a-course').firstElementChild.textContent = isRecruit ? '지원 분야를 선택하세요' : '강좌를 선택하세요';
  $('a-memo').placeholder = isRecruit
    ? '지원 동기, 강의 가능 시수, 참고사항 등을 자유롭게 적어주세요.'
    : '궁금한 점이나 요청사항을 적어주세요.';

  paintAuthNote();
  if (currentUser){
    $('a-name').value    = userProfile?.name || currentUser.displayName || '';
    $('a-org').value     = userProfile?.org || '';
    $('a-orgtype').value = userProfile?.orgType || '';
    $('a-phone').value   = userProfile?.phone || '';
    $('a-email').value   = currentUser.email || '';
    $('a-email').readOnly = true;
  } else {
    $('a-email').readOnly = false;
  }
  $('applyError').style.display = 'none';
  $('applyForm').style.display = 'block';
  $('applyDone').style.display = 'none';
  openModal('applyModal');
}
window.openApply = openApply;

$('applyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const programId = $('a-programId').value;
  const p = programs.find(x => x.id === programId);
  const btn = $('applySubmitBtn');
  btn.disabled = true; btn.textContent = '접수 중…';
  try {
    const appData = {
      programId,
      programTitle: p ? p.title : '',
      programType: p ? p.type : '',
      course: $('a-course').value,
      name: $('a-name').value.trim(),
      org: $('a-org').value.trim(),
      orgType: $('a-orgtype').value,
      phone: $('a-phone').value.trim(),
      email: currentUser ? currentUser.email : $('a-email').value.trim(),
      memo: $('a-memo').value.trim(),
      uid: currentUser ? currentUser.uid : null,
      status: 'applied',
      completed: false,
      createdAt: serverTimestamp()
    };
    if (p && p.type === 'recruit'){
      appData.availDays = [...document.querySelectorAll('#a-days input:checked')].map(c => c.value);
      appData.availTime = $('a-time').value;
      appData.preferArea = $('a-area').value.trim();
    }
    const ref = await addDoc(collection(db, 'applications'), appData);
    await updateDoc(doc(db, 'programs', programId), { applied: increment(1) });

    $('applyForm').style.display = 'none';
    $('applyDoneMsg').textContent = (p && p.type === 'recruit')
      ? `[${p.title} · ${appData.course}] 지원이 접수되었습니다. 서류 검토 후 배정 결과를 안내드립니다.`
      : `[${p.title} · ${appData.course}] 신청이 접수되었습니다. 담당자 확인 후 안내드립니다.`;
    $('applyDoneCode').textContent = ref.id;
    $('applyDone').style.display = 'block';

    const mailNote = $('applyDoneMail');
    if (currentUser){
      mailNote.innerHTML = '이 신청은 <b><a href="mypage.html" style="text-decoration:underline;">마이페이지</a></b>에 저장되었습니다. 신청번호를 잃어버려도 언제든 확인할 수 있습니다.';
    }

    // 신청내역 이메일 발송 (실패해도 접수는 완료)
    if (emailEnabled()){
      const r = await sendApplicationEmail({
        to_email: appData.email,
        name: appData.name,
        org: appData.org,
        org_type: appData.orgType,
        phone: appData.phone,
        program: appData.programTitle,
        course: appData.course,
        app_id: ref.id,
        date: new Date().toLocaleString('ko-KR', {dateStyle:'long', timeStyle:'short'})
      });
      if (!currentUser){
        mailNote.innerHTML = r.ok
          ? '신청번호는 <b>신청 확인·취소</b>에 필요합니다. 📧 입력하신 이메일로 신청내역을 발송했습니다.<br><a href="mypage.html" style="text-decoration:underline;">회원가입</a> 후 이 번호를 등록하면 이력이 계속 관리됩니다.'
          : '신청번호는 <b>신청 확인·취소</b>에 필요합니다. (이메일 발송에 실패했으니 위 번호를 꼭 메모해주세요.)';
      }
    } else if (!currentUser){
      mailNote.innerHTML = '신청번호는 <b>신청 확인·취소</b>에 필요합니다. 위 번호를 꼭 메모하거나 화면을 캡처해주세요.';
    }
    toast('신청이 접수되었습니다.');
  } catch (err) {
    $('applyError').textContent = fbError(err);
    $('applyError').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '신청 접수하기';
  }
});

/* ---------- 최신 공지 미리보기 (5건) ---------- */
onSnapshot(
  query(collection(db, 'notices'), orderBy('createdAt', 'desc')),
  snap => {
    const tb = $('noticePreviewBody');
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rows = [...all.filter(n => n.pinned), ...all.filter(n => !n.pinned)].slice(0, 5);
    if (!rows.length){
      tb.innerHTML = '<tr class="empty-row"><td colspan="4">등록된 공지사항이 없습니다.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(n => `
      <tr onclick="location.href='notice.html?id=${n.id}'" class="${n.pinned ? 'pinned' : ''}">
        <td><span class="notice-cat ${catClass(n.cat)}">${esc(n.cat)}</span></td>
        <td class="b-title">${n.pinned ? '<span class="pin-mark">📌</span>' : ''}<b>${esc(n.title)}</b>${noticeIsNew(n.date) ? '<span class="notice-new">N</span>' : ''}</td>
        <td class="b-author">${esc(n.author)}</td>
        <td>${esc(n.date)}</td>
      </tr>`).join('');
  },
  err => {
    $('noticePreviewBody').innerHTML =
      `<tr class="empty-row"><td colspan="4">${esc(fbError(err))}</td></tr>`;
  }
);
