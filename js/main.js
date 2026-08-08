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
  ROLES, roleOf, qualificationHTML, RECRUIT_FOR
} from './common.js';
import { sendApplicationEmail, emailEnabled } from './email-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

initLayout('home');
bindModalEvents();

document.getElementById('a-orgtype').innerHTML =
  '<option value="">유형을 선택하세요</option>' +
  ORG_TYPES.map(t => `<option>${t}</option>`).join('');


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
function cardHTML(p){
  const applied = p.applied || 0;
  const remain = p.capacity - applied;
  const dd = ddayInfo(p);
  const closed = !p.open || dd.closed || remain <= 0;
  const pct = Math.min(100, Math.round(applied / p.capacity * 100));
  const isRecruit = p.type === 'recruit';
  const needLogin = p.loginOnly && !currentUser;
  const wrongRole = isRecruit && currentUser && roleOf(userProfile) !== 'instructor';
  const btnClass = p.type === 'camp' ? 'btn-primary' : 'btn-navy';

  const seatText = isRecruit
    ? (remain <= 0 ? '모집 마감' : `모집 <strong>${p.capacity}명</strong> · 현재 <strong>${applied}명</strong> 지원`)
    : (remain <= 0 ? '정원 마감'
        : (remain <= 10 ? `잔여 <strong>${remain}석</strong> · 마감 임박` : '회차별 선착순 마감'));

  let action;
  if (closed){
    action = `<button class="btn ${btnClass}" disabled>${isRecruit ? '모집이 마감되었습니다' : '접수가 마감되었습니다'}</button>`;
  } else if (needLogin){
    action = `<a class="btn ${btnClass}" href="mypage.html?next=apply">🔐 로그인 후 ${isRecruit ? '지원하기' : '신청하기'}</a>`;
  } else if (wrongRole){
    action = `<button class="btn ${btnClass}" disabled title="강사 회원만 지원할 수 있습니다">강사 회원만 지원 가능</button>`;
  } else {
    action = `<button class="btn ${btnClass}" onclick="openApply('${p.id}')">${isRecruit ? '강사 지원하기' : '신청하기'}</button>`;
  }

  return `
    <div class="open-card ${p.type !== 'camp' ? 'workshop' : ''} ${isRecruit ? 'recruit' : ''} ${closed ? 'closed' : ''}">
      <div class="open-top">
        ${closed
          ? `<span class="status end">${isRecruit ? '모집마감' : '접수마감'}</span>`
          : `<span class="status live">${isRecruit ? '모집중' : '접수중'}</span><span class="dday ${dd.urgent ? '' : 'calm'}">${esc(dd.text)}</span>`}
        <span class="kind-label">${KIND[p.type] || ''}</span>
        ${p.loginOnly ? '<span class="kind-label lock">🔐 회원 전용</span>' : ''}
      </div>
      <h3>${esc(p.title)}</h3>
      <dl>
        <dt>${isRecruit ? '모집대상' : '대상'}</dt>
        <dd class="target-dd">${esc(p.target)}${p.type === 'workshop' ? `
          <span class="help qual-help" tabindex="0" role="button" aria-label="지원 자격 상세 보기">?
            <span class="help-pop"><b class="pop-title">지원 자격</b>${qualificationHTML()}</span>
          </span>` : ''}</dd>
        ${isRecruit && p.recruitFor && RECRUIT_FOR[p.recruitFor]
          ? `<dt>모집목적</dt><dd>${esc(RECRUIT_FOR[p.recruitFor].label)}</dd>` : ''}
        ${isRecruit && p.role ? `<dt>모집구분</dt><dd>${esc(p.role)}</dd>` : ''}
        ${isRecruit && p.mode ? `<dt>운영형태</dt><dd>${esc(p.mode)}</dd>` : ''}
        ${isRecruit && Array.isArray(p.levels) && p.levels.length
          ? `<dt>학교급</dt><dd>${esc(p.levels.join(' · '))}</dd>` : ''}
        <dt>${isRecruit ? '활동기간' : '운영'}</dt><dd>${esc(p.period)}</dd>
        <dt>${isRecruit ? '활동장소' : '장소'}</dt><dd>${esc(p.place)}</dd>
        ${isRecruit && p.hours ? `<dt>운영조건</dt><dd>${esc(p.hours)}</dd>` : ''}
        <dt>${isRecruit ? '담당업무' : '내용'}</dt><dd>${esc(p.content)}</dd>
        ${isRecruit && p.qualification
          ? `<dt>지원자격</dt><dd>${esc(p.qualification).replace(/\n/g, '<br>')}</dd>` : ''}
      </dl>

      <div class="seat-bar">
        ${isRecruit ? '지원 현황' : '신청 현황'} <strong>${applied} / ${p.capacity}명</strong> · ${seatText}
        <div class="seat-track"><div class="seat-fill" style="width:${pct}%"></div></div>
      </div>
      ${wrongRole ? `<p class="card-note">현재 <b>${ROLES[roleOf(userProfile)].label}</b> 회원으로 로그인되어 있습니다.
        <a href="mypage.html">마이페이지</a>에서 회원 유형을 <b>강사</b>로 변경하면 지원할 수 있습니다.</p>` : ''}
      <div class="open-actions">
        ${action}
        <a href="notice.html" class="btn btn-outline">${isRecruit ? '공고 상세 보기' : '모집 공고 보기'}</a>
      </div>
    </div>`;
}

/* ---------- v11: 마감 임박 순 정렬 ----------
   접수 중인 카드를 마감일이 가까운 순으로 먼저 보여주고,
   이미 마감된(기한 경과·정원 마감·접수 중지) 카드는 뒤로 보냅니다. */
function isClosedCard(p){
  const remain = (p.capacity || 0) - (p.applied || 0);
  return !p.open || ddayInfo(p).closed || remain <= 0;
}
function byDeadline(list){
  return [...list].sort((a, b) => {
    const ca = isClosedCard(a) ? 1 : 0, cb = isClosedCard(b) ? 1 : 0;
    if (ca !== cb) return ca - cb;                 // 접수중 먼저
    const da = a.deadline || '9999-12-31';
    const db = b.deadline || '9999-12-31';
    if (da === db) return 0;                       // 동률이면 최신 등록순 유지
    /* 접수중은 임박한 순(오름차순), 마감건은 최근 마감된 순(내림차순) */
    return ca === 0 ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
  });
}

/* 상시 온라인 워크샵은 workshop.html#online에서 과목별 수강 신청으로 받으므로
   홈 프로그램 카드에서는 제외합니다 (홈에는 전용 배너로 안내). */
const isOnlineWs = p => p.type === 'workshop' && /온라인/.test(p.title || '');

function renderPrograms(){
  const edu     = byDeadline(programs.filter(p => p.type !== 'recruit' && !isOnlineWs(p)));
  const recruit = byDeadline(programs.filter(p => p.type === 'recruit'));

  const grid = $('programGrid');
  grid.innerHTML = edu.length
    ? edu.map(cardHTML).join('')
    : '<div class="open-empty">현재 접수 중인 프로그램이 없습니다.<br>새로운 연수 일정은 공지사항을 통해 안내드립니다.</div>';

  const rSec = $('recruit-now');
  if (recruit.length){
    rSec.style.display = 'block';
    $('recruitGrid').innerHTML = recruit.map(cardHTML).join('');
  } else {
    rSec.style.display = 'none';
  }
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
    const r = roleOf(userProfile);
    box.className = 'apply-auth on';
    box.innerHTML = `✅ <b>${esc(userProfile?.name || currentUser.displayName || currentUser.email)}</b> 님
      <span class="role-chip ${r}">${ROLES[r].icon} ${ROLES[r].label}</span> 으로 신청합니다.
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
  if (p.type === 'recruit' && currentUser && roleOf(userProfile) !== 'instructor'){
    alert('강사 모집 공고는 강사 회원만 지원할 수 있습니다.\n마이페이지에서 회원 유형을 [강사]로 변경한 뒤 지원해주세요.');
    location.href = 'mypage.html';
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

  // 강사 모집 공고면 지원서 항목으로 전환
  const isRecruit = p.type === 'recruit';
  $('recruitFields').style.display = isRecruit ? 'block' : 'none';

  /* v16: 모집 공고는 지원 분야 단일 선택, 워크샵·연수는 강좌 복수 선택
     (오전·오후 등 시간대가 다른 강좌를 한 번에 신청할 수 있습니다) */
  const sel = $('a-course'), checks = $('a-courseChecks'), courseNote = $('a-courseNote');
  if (isRecruit){
    sel.style.display = ''; sel.required = true;
    checks.style.display = 'none'; courseNote.style.display = 'none';
    checks.innerHTML = '';
    sel.innerHTML = '<option value="">강좌를 선택하세요</option>' +
      courses.map(c => `<option>${esc(c)}</option>`).join('');
  } else {
    sel.style.display = 'none'; sel.required = false; sel.innerHTML = '';
    checks.style.display = ''; courseNote.style.display = '';
    checks.innerHTML = courses.map((c, i) =>
      `<label class="chk"><input type="checkbox" name="ac" value="${esc(c)}" id="ac${i}"><span>${esc(c)}</span></label>`).join('');
  }

  if (isRecruit){
    /* 공고에 이미 고정된 조건을 보여주고 확인만 받습니다.
       (가능 요일·시간대·희망 지역은 특정 공고 지원서에 맞지 않아 제거) */
    const terms = [
      ['모집 구분', p.role],
      [p.recruitFor === 'workshop' ? '진행 방식' : '운영 형태', p.mode],
      ['활동 기간', p.period],
      [p.recruitFor === 'workshop' ? '운영 장소' : '활동 지역', p.place],
      ['운영 조건', p.hours],
      ['담당 업무', p.content]
    ].filter(([, v]) => v);
    $('a-terms').innerHTML = terms
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

    /* 주강사·보조강사를 함께 모집하는 공고만 역할을 고르게 합니다 */
    const both = (p.role || '').includes('+');
    $('a-roleRow').style.display = both ? '' : 'none';
    $('a-role').innerHTML = both
      ? ['주강사', '보조강사'].map(v => `<option>${v}</option>`).join('')
      : `<option>${esc(p.role || '')}</option>`;
    $('a-role').required = both;
    $('a-agree').checked = false;
  }
  $('a-courseLabel').innerHTML = (isRecruit
    ? '지원 분야'
    : '희망 강좌 <span class="hint">(복수 선택 가능)</span>') + ' <span class="req">*</span>';
  if (isRecruit) sel.firstElementChild.textContent = '지원 분야를 선택하세요';
  $('a-memo').placeholder = isRecruit
    ? '지원 동기, 강의 가능 시수, 참고사항 등을 자유롭게 적어주세요.'
    : '궁금한 점이나 요청사항을 적어주세요.';

  paintAuthNote();
  if (currentUser){
    const r = roleOf(userProfile);
    $('a-name').value  = (r === 'parent' ? (userProfile?.childName || userProfile?.name) : userProfile?.name)
                         || currentUser.displayName || '';
    $('a-org').value   = userProfile?.org || userProfile?.childSchool || userProfile?.school || '';
    $('a-orgtype').value = userProfile?.orgType || '';
    $('a-phone').value = userProfile?.phone || '';
    $('a-email').value = currentUser.email || '';
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
  if (p && p.type === 'recruit' && !$('a-agree').checked){
    $('applyError').textContent = '공고의 운영 일정과 조건 확인에 동의해주세요.';
    $('applyError').style.display = 'block';
    $('a-agree').focus();
    return;
  }
  /* v16: 워크샵은 복수 강좌 선택 — 선택한 강좌마다 신청을 각각 접수합니다 */
  const isRecruitSubmit = p && p.type === 'recruit';
  const chosenCourses = isRecruitSubmit
    ? [$('a-course').value]
    : [...document.querySelectorAll('#a-courseChecks input:checked')].map(c => c.value);
  if (!chosenCourses.length || !chosenCourses[0]){
    $('applyError').textContent = '희망 강좌를 하나 이상 선택해주세요.';
    $('applyError').style.display = 'block';
    return;
  }

  const btn = $('applySubmitBtn');
  btn.disabled = true; btn.textContent = '접수 중…';
  try {
    const appData = {
      programId,
      programTitle: p ? p.title : '',
      programType: p ? p.type : '',
      course: chosenCourses[0],
      name: $('a-name').value.trim(),
      org: $('a-org').value.trim(),
      orgType: $('a-orgtype').value,
      phone: $('a-phone').value.trim(),
      email: currentUser ? currentUser.email : $('a-email').value.trim(),
      memo: $('a-memo').value.trim(),
      uid: currentUser ? currentUser.uid : null,
      applicantRole: currentUser ? roleOf(userProfile) : null,
      status: 'applied',
      completed: false,
      createdAt: serverTimestamp()
    };
    if (p && p.type === 'recruit'){
      appData.applyRole = $('a-role').value || p.role || '';
      appData.agreedTerms = true;
    }
    /* 강좌마다 신청 문서를 하나씩 만듭니다 (강좌별 승인·수료·취소 관리 유지).
       programs.applied 증가는 규칙상 한 번에 +1만 허용되므로 건별로 반영합니다. */
    const ids = [];
    for (const course of chosenCourses){
      const ref = await addDoc(collection(db, 'applications'), { ...appData, course });
      ids.push(ref.id);
      await updateDoc(doc(db, 'programs', programId), { applied: increment(1) }).catch(() => {});
    }
    const courseText = chosenCourses.join(' · ');

    $('applyForm').style.display = 'none';
    $('applyDoneMsg').textContent = (p && p.type === 'recruit')
      ? `[${p.title} · ${courseText}] 지원이 접수되었습니다. 서류 검토 후 배정 결과를 안내드립니다.`
      : `[${p.title} · ${courseText}] 신청이 접수되었습니다. (${ids.length}건) 담당자 확인 후 안내드립니다.`;
    $('applyDoneCode').textContent = ids.join(', ');
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
        course: courseText,
        app_id: ids.join(', '),
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
