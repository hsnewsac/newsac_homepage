/* =========================================================
   마이페이지 v8 — 회원 유형(강사·학부모·학생·교직원)별 구성
   - 역할 선택형 회원가입, 역할별 입력 항목
   - 역할별 마이페이지 구성 (강사 프로필 / 관심분야 / 기관 협력)
   - 신청 이력 · 지원 진행 현황 · 강의활동 이력
   - 지난 신청 연결 · 비밀번호 변경
========================================================= */
import { db, auth } from './firebase-init.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs,
  query, where, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initLayout, esc, fbError, toast, tsText, tsNum,
  ORG_TYPES, SPECIALTIES, REGIONS, CAREER_LEVELS,
  ROLES, ROLE_ORDER, roleOf, GRADES, INTERESTS, STAFF_DUTIES,
  STATUS, STATUS_ORDER, statusOf, statusChip, statusSet, checkIsAdmin
} from './common.js';

initLayout('mypage');
const $ = id => document.getElementById(id);

let currentUser = null;
let profile = {};
let myApps = [];
let joinRole = 'instructor';   // 회원가입 화면에서 선택된 유형

/* =========================================================
   셀렉트 / 체크박스 초기화
========================================================= */
const opt = (arr, ph = '선택') =>
  `<option value="">${ph}</option>` + arr.map(v => `<option>${esc(v)}</option>`).join('');

['j-orgtype','e-orgtype'].forEach(id => $(id).innerHTML = opt(ORG_TYPES));
['j-duty','e-duty'].forEach(id => $(id).innerHTML = opt(STAFF_DUTIES));
['j-childGrade','e-childGrade','j-grade','e-grade','st-target'].forEach(id => $(id).innerHTML = opt(GRADES));
$('pf-career').innerHTML = opt(CAREER_LEVELS);
$('e-role').innerHTML = ROLE_ORDER.map(k =>
  `<option value="${k}">${ROLES[k].icon} ${ROLES[k].label}</option>`).join('');

const chkList = (arr, name) => arr.map((v, i) =>
  `<label class="chk"><input type="checkbox" name="${name}" value="${esc(v)}" id="${name}${i}"><span>${esc(v)}</span></label>`).join('');
$('pf-specialties').innerHTML = chkList(SPECIALTIES, 'sp');
$('pf-regions').innerHTML     = chkList(REGIONS, 'rg');
$('it-interests').innerHTML   = chkList(INTERESTS, 'it');
$('st-interests').innerHTML   = chkList(INTERESTS, 'si');

/* 회원 유형 선택 카드 */
$('rolePicker').innerHTML = ROLE_ORDER.map(k => `
  <button type="button" class="role-opt ${k === joinRole ? 'on' : ''}" data-role="${k}" onclick="pickRole('${k}')">
    <i>${ROLES[k].icon}</i>
    <b>${ROLES[k].label}</b>
    <span>${ROLES[k].tag}</span>
  </button>`).join('');

/* 회원 유형 안내 리스트 */
$('roleBenefits').innerHTML = ROLE_ORDER.map(k => `
  <li><b>${ROLES[k].icon} ${ROLES[k].label}</b><span>${ROLES[k].desc}</span></li>`).join('');

/* =========================================================
   공통 유틸
========================================================= */
function showErr(id, msg, ok = false){
  const el = $(id);
  el.textContent = msg;
  el.style.display = 'block';
  el.classList.toggle('as-ok', ok);
}
function hideErr(id){ $(id).style.display = 'none'; }

/** data-role 속성에 해당 역할이 포함된 블록만 표시 */
function applyRoleFields(scope, role){
  scope.querySelectorAll('.role-fields').forEach(el => {
    el.style.display = el.dataset.role.split(' ').includes(role) ? '' : 'none';
  });
}

/* =========================================================
   회원가입 · 로그인
========================================================= */
function switchAuthTab(tab){
  const login = tab === 'login';
  $('tabLogin').classList.toggle('active', login);
  $('tabJoin').classList.toggle('active', !login);
  $('loginForm').style.display = login ? 'block' : 'none';
  $('joinForm').style.display = login ? 'none' : 'block';
  hideErr('authError'); hideErr('joinError');
}
window.switchAuthTab = switchAuthTab;

function pickRole(k){
  joinRole = k;
  document.querySelectorAll('.role-opt').forEach(b =>
    b.classList.toggle('on', b.dataset.role === k));
  $('roleNote').textContent = ROLES[k].desc;
  $('j-nameLabel').innerHTML = (k === 'instructor' ? '이름 (강사명)' : '이름') + ' <span class="req">*</span>';
  $('j-phoneLabel').textContent = k === 'student' ? '전화번호 (본인 또는 보호자)' : '전화번호';
  $('j-orgLabel').textContent = k === 'staff' ? '소속 학교 / 기관' : '소속기관';
  applyRoleFields($('joinForm'), k);
}
window.pickRole = pickRole;
pickRole('instructor');

/** 역할별 저장 데이터 수집 (prefix: 'j' = 가입, 'e' = 수정) */
function collectRoleData(role, px){
  const v = id => ($(`${px}-${id}`)?.value || '').trim();
  const base = { role, phone: v('phone') };
  if (px === 'j') base.name = v('name');
  if (role === 'instructor' || role === 'staff'){
    base.org = v('org');
    base.orgType = $(`${px}-orgtype`).value;
  }
  if (role === 'staff'){
    base.dept = v('dept');
    base.duty = $(`${px}-duty`).value;
  }
  if (role === 'parent'){
    base.childName = v('childName');
    base.childGrade = $(`${px}-childGrade`).value;
    base.childSchool = v('childSchool');
  }
  if (role === 'student'){
    base.school = v('school');
    base.grade = $(`${px}-grade`).value;
    base.guardianPhone = v('guardian');
  }
  return base;
}

$('joinForm').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('j-pw').value !== $('j-pw2').value){
    showErr('joinError', '비밀번호가 서로 일치하지 않습니다.');
    return;
  }
  const btn = $('jBtn');
  btn.disabled = true; btn.textContent = '가입 중…';
  try {
    const email = $('j-email').value.trim();
    const cred = await createUserWithEmailAndPassword(auth, email, $('j-pw').value);
    const data = { ...collectRoleData(joinRole, 'j'), email, createdAt: serverTimestamp() };
    await setDoc(doc(db, 'users', cred.user.uid), data);
    await updateProfile(cred.user, { displayName: data.name }).catch(()=>{});
    toast(`${ROLES[joinRole].label} 회원으로 가입되었습니다. 환영합니다!`);
  } catch (err) {
    const map = {
      'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인 탭을 이용해주세요.',
      'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
      'auth/invalid-email': '이메일 형식이 올바르지 않습니다.'
    };
    showErr('joinError', map[err.code] || fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '회원가입';
  }
});

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('liBtn');
  btn.disabled = true; btn.textContent = '로그인 중…';
  try {
    await signInWithEmailAndPassword(auth, $('li-email').value.trim(), $('li-pw').value);
  } catch (err) {
    showErr('authError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '로그인';
  }
});

async function resetPassword(){
  const email = $('li-email').value.trim();
  if (!email){ showErr('authError', '이메일을 먼저 입력한 뒤 재설정 링크를 눌러주세요.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showErr('authError', '비밀번호 재설정 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해주세요.', true);
  } catch (err) { showErr('authError', fbError(err)); }
}
function myLogout(){ signOut(auth); }
Object.assign(window, { resetPassword, myLogout });

/* =========================================================
   내 정보 (역할별)
========================================================= */
function infoRows(role){
  const rows = [['이름', profile.name], ['이메일', profile.email || currentUser?.email]];
  if (role === 'instructor' || role === 'staff'){
    rows.push(['소속기관', profile.org], ['소속 유형', profile.orgType]);
  }
  if (role === 'staff') rows.push(['부서·직위', profile.dept], ['담당 업무', profile.duty]);
  if (role === 'parent') rows.push(['자녀 이름', profile.childName],
    ['자녀 학년', profile.childGrade], ['자녀 학교', profile.childSchool]);
  if (role === 'student') rows.push(['학교', profile.school],
    ['학년', profile.grade], ['보호자 연락처', profile.guardianPhone]);
  rows.push(['전화번호', profile.phone]);
  return rows;
}
function paintInfo(){
  const role = roleOf(profile);
  $('roleBadge').innerHTML = `<span class="role-chip ${role}">${ROLES[role].icon} ${ROLES[role].label}</span>`;
  $('infoView').innerHTML = infoRows(role).map(([k, v]) =>
    `<dt>${esc(k)}</dt><dd>${esc(v) || '-'}</dd>`).join('');
  // 역할 전용 박스 표시
  document.querySelectorAll('[data-rolebox]').forEach(el => {
    const allowed = el.dataset.rolebox.split(' ').includes(role);
    if (!allowed){ el.style.display = 'none'; }
    else if (el.id !== 'statusBox' && el.id !== 'activityBox'){ el.style.display = 'block'; }
  });
  $('histTitle').childNodes[0].nodeValue =
    role === 'instructor' ? '🎓 나의 신청·지원 이력\n      '
      : (role === 'parent' ? '🎓 자녀 참여 이력\n      ' : '🎓 나의 참여 이력\n      ');
  if (role === 'parent'){
    $('interestTitle').textContent = '🌱 자녀 관심 분야';
    $('interestDesc').textContent = '자녀에게 맞는 캠프·연수를 안내해 드리는 데 활용됩니다.';
    $('it-noteLabel').textContent = '자녀 참여 시 참고사항';
  } else {
    $('interestTitle').textContent = '🌱 나의 관심 분야';
    $('interestDesc').textContent = '관심 분야에 맞는 캠프·연수 소식을 안내해 드리는 데 활용됩니다.';
    $('it-noteLabel').textContent = '참여 시 참고사항';
  }
}

function toggleInfoEdit(on){
  $('infoView').style.display = on ? 'none' : 'grid';
  $('infoForm').style.display = on ? 'block' : 'none';
  $('editInfoBtn').style.display = on ? 'none' : 'inline-block';
  hideErr('infoError');
  if (!on) return;
  const role = roleOf(profile);
  $('e-role').value = role;
  $('e-name').value = profile.name || '';
  $('e-phone').value = profile.phone || '';
  $('e-org').value = profile.org || '';
  $('e-orgtype').value = profile.orgType || '';
  $('e-dept').value = profile.dept || '';
  $('e-duty').value = profile.duty || '';
  $('e-childName').value = profile.childName || '';
  $('e-childGrade').value = profile.childGrade || '';
  $('e-childSchool').value = profile.childSchool || '';
  $('e-school').value = profile.school || '';
  $('e-grade').value = profile.grade || '';
  $('e-guardian').value = profile.guardianPhone || '';
  applyRoleFields($('infoForm'), role);
}
window.toggleInfoEdit = toggleInfoEdit;

$('e-role').addEventListener('change', () => {
  const k = $('e-role').value;
  $('e-nameLabel').innerHTML = (k === 'instructor' ? '이름 (강사명)' : '이름') + ' <span class="req">*</span>';
  $('e-orgLabel').textContent = k === 'staff' ? '소속 학교 / 기관' : '소속기관';
  applyRoleFields($('infoForm'), k);
});

$('infoForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('infoSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const role = $('e-role').value;
    const patch = { ...collectRoleData(role, 'e'), name: $('e-name').value.trim(), updatedAt: serverTimestamp() };
    await setDoc(doc(db, 'users', currentUser.uid), patch, { merge: true });
    await updateProfile(currentUser, { displayName: patch.name }).catch(()=>{});
    profile = { ...profile, ...patch };
    paintInfo(); paintCards(); paintApps();
    toggleInfoEdit(false);
    toast('내 정보를 저장했습니다.');
  } catch (err) {
    showErr('infoError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '저장';
  }
});

/* =========================================================
   강사 프로필
========================================================= */
function paintProfileForm(){
  const sp = profile.specialties || [], rg = profile.regions || [];
  document.querySelectorAll('#pf-specialties input').forEach(c => c.checked = sp.includes(c.value));
  document.querySelectorAll('#pf-regions input').forEach(c => c.checked = rg.includes(c.value));
  $('pf-career').value = profile.career || '';
  $('pf-cert').value = profile.certs || '';
  $('pf-bio').value = profile.bio || '';
  const done = !!(sp.length || profile.career || rg.length);
  $('pfState').innerHTML = done
    ? '<span class="status-chip done">작성 완료</span>'
    : '<span class="status-chip wait">미작성</span>';
}
$('profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('pfSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const patch = {
      specialties: [...document.querySelectorAll('#pf-specialties input:checked')].map(c => c.value),
      regions: [...document.querySelectorAll('#pf-regions input:checked')].map(c => c.value),
      career: $('pf-career').value,
      certs: $('pf-cert').value.trim(),
      bio: $('pf-bio').value.trim(),
      profileUpdatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', currentUser.uid), patch, { merge: true });
    profile = { ...profile, ...patch };
    paintProfileForm();
    toast('강사 프로필을 저장했습니다.');
  } catch (err) {
    showErr('pfError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '강사 프로필 저장';
  }
});

/* =========================================================
   관심 분야 (학부모 · 학생)
========================================================= */
function paintInterestForm(){
  const it = profile.interests || [];
  document.querySelectorAll('#it-interests input').forEach(c => c.checked = it.includes(c.value));
  $('it-note').value = profile.careNote || '';
  $('it-alert').checked = !!profile.alertOptIn;
}
$('interestForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('itSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const patch = {
      interests: [...document.querySelectorAll('#it-interests input:checked')].map(c => c.value),
      careNote: $('it-note').value.trim(),
      alertOptIn: $('it-alert').checked,
      profileUpdatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', currentUser.uid), patch, { merge: true });
    profile = { ...profile, ...patch };
    toast('저장했습니다.');
  } catch (err) {
    showErr('itError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '저장';
  }
});

/* =========================================================
   기관 협력 (교직원)
========================================================= */
function paintStaffForm(){
  const si = profile.orgInterests || [];
  document.querySelectorAll('#st-interests input').forEach(c => c.checked = si.includes(c.value));
  $('st-students').value = profile.groupSize ?? '';
  $('st-target').value = profile.groupGrade || '';
  $('st-note').value = profile.orgNote || '';
}
$('staffForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('stSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const patch = {
      orgInterests: [...document.querySelectorAll('#st-interests input:checked')].map(c => c.value),
      groupSize: $('st-students').value === '' ? null : Number($('st-students').value),
      groupGrade: $('st-target').value,
      orgNote: $('st-note').value.trim(),
      profileUpdatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', currentUser.uid), patch, { merge: true });
    profile = { ...profile, ...patch };
    toast('저장했습니다.');
  } catch (err) {
    showErr('stError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '저장';
  }
});

/* =========================================================
   신청 이력
========================================================= */
async function loadMyApps(){
  const found = new Map();
  const runQ = async q_ => {
    try {
      const snap = await getDocs(q_);
      snap.docs.forEach(d => found.set(d.id, { id: d.id, ...d.data() }));
    } catch (e) { console.warn('이력 조회 오류:', e); }
  };
  await runQ(query(collection(db, 'applications'), where('email', '==', currentUser.email)));
  await runQ(query(collection(db, 'applications'), where('uid', '==', currentUser.uid)));

  myApps = [...found.values()].sort((a, b) => tsNum(b.createdAt) - tsNum(a.createdAt));
  paintApps(); paintCards(); paintStatusCards(); paintActivity();
  paintClassroom();
}

/* =========================================================
   v13: 내 강의실 — 상시 온라인 워크샵(과목별) 수강 내역
========================================================= */
async function paintClassroom(){
  const box = $('classroomBox'), grid = $('classroomCards');
  if (!box) return;

  /* v14: 수강 내역이 없어도 박스를 숨기지 않고 신청 안내를 보여줍니다 */
  const showEmpty = () => {
    box.style.display = 'block';
    grid.innerHTML = `<div class="cr-empty">아직 수강 중인 온라인 워크샵이 없습니다.<br>
      상시 개설 과목을 신청하면 이곳에서 바로 수강할 수 있습니다.<br>
      <a class="btn btn-navy btn-sm" href="workshop.html#online">온라인 워크샵 신청하러 가기 →</a></div>`;
  };

  let enrolls = [];
  try {
    const snap = await getDocs(query(collection(db, 'enrollments'), where('uid', '==', currentUser.uid)));
    enrolls = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => tsNum(b.createdAt) - tsNum(a.createdAt));
  } catch (e) { console.warn('수강 내역 조회 오류:', e); }

  if (!enrolls.length){ showEmpty(); return; }

  const cards = [];
  for (const e of enrolls){
    try {
      const ls = await getDocs(collection(db, 'onlineCourses', e.courseKey, 'lessons'));
      const lessons = ls.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((x, y) => (x.order || 0) - (y.order || 0));

      const pr = await getDocs(collection(db, 'enrollments', e.id, 'progress'));
      const prog = Object.fromEntries(pr.docs.map(d => [d.id, d.data()]));

      const done = l => {
        const q = prog[l.id];
        if (!q) return false;
        if (l.mode === 'offline') return !!q.done;
        if (q.done) return true;
        return !!l.durationSec && (q.watchedSec || 0) >= l.durationSec * 0.9;
      };
      const req = lessons.filter(l => l.required !== false);
      const doneN = req.filter(done).length;
      const rate = req.length ? Math.round(doneN / req.length * 100) : 0;
      cards.push({ e, total: req.length, doneN, rate, empty: !lessons.length });
    } catch (err) { console.warn('강의실 조회 오류:', err); }
  }

  if (!cards.length){ showEmpty(); return; }
  box.style.display = 'block';
  grid.innerHTML = cards.map(c => `
    <div class="cr-card">
      <h4>${esc(c.e.courseName || '')}</h4>
      <span class="cc-course">신청 ${esc(tsText(c.e.createdAt, false))}${c.e.completed ? ' · 수료' : ''}</span>
      ${c.empty
        ? '<div class="cc-warn">아직 차시가 등록되지 않았습니다.<br>준비되면 안내드리겠습니다.</div>'
        : `<div class="cc-bar"><i style="width:${c.rate}%"></i></div>
           <div class="cc-tx"><span>필수 ${c.doneN} / ${c.total}차시</span><b>${c.rate}%</b></div>`}
      ${c.e.completed
        ? `<div class="cc-done">🎓 수료 완료${c.e.certNo ? ` · ${esc(c.e.certNo)}` : ''}</div>`
        : (c.rate === 100 && !c.empty
          ? '<div class="cc-done">✅ 학습 완료 · 수료 확정은 사업단에서 진행합니다</div>' : '')}
      ${c.empty ? '' : `<a class="btn ${c.rate === 100 || c.e.completed ? 'btn-outline' : 'btn-navy'} btn-sm"
         href="classroom.html?enroll=${c.e.id}">
        ${c.rate === 100 || c.e.completed ? '다시 보기' : (c.doneN ? '이어서 학습' : '학습 시작')}</a>`}
      ${c.e.completed
        ? `<a class="btn btn-navy btn-sm" href="cert.html?id=${c.e.id}" target="_blank" rel="noopener">🎓 이수증 발급</a>`
        : `<button class="mini-btn danger cc-cancel" onclick="cancelEnroll('${c.e.id}', '${esc(c.e.courseName || '')}')">수강 취소</button>`}
    </div>`).join('');
}

/* v15: 온라인 워크샵 수강 취소 (수료 전만 가능) */
async function cancelEnroll(id, name){
  if (!confirm(`[${name}]\n온라인 워크샵 수강을 취소할까요?\n\n지금까지의 학습 기록은 복구되지 않으며, 다시 신청하면 처음부터 수강합니다.`)) return;
  try {
    await deleteDoc(doc(db, 'enrollments', id));
    toast('수강을 취소했습니다.');
    await loadMyApps();
  } catch (err) { alert(fbError(err)); }
}
window.cancelEnroll = cancelEnroll;

/* v15: 본인 취소 가능 여부 — 수료 건과 '강사 모집 배정확정' 건만 제한합니다.
   워크샵·연수 신청은 승인완료 상태여도 수료 전이면 스스로 취소할 수 있습니다. */
const selfLocked = a => a.completed || (a.programType === 'recruit' && statusOf(a) === 'assigned');

function paintApps(){
  const tb = $('myAppsBody');
  const role = roleOf(profile);
  const badge = $('myBadgeApps');
  if (badge) badge.textContent = myApps.length;
  if (!myApps.length){
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6A776F;">
      ${role === 'instructor' ? '신청·지원 이력이 없습니다.' : '참여 이력이 없습니다.'}<br>
      <a href="index.html" style="color:var(--leaf);text-decoration:underline;">홈에서 접수 중인 프로그램</a>을 확인해보세요!</td></tr>`;
    return;
  }
  tb.innerHTML = myApps.map(a => {
    const locked = selfLocked(a);
    return `<tr>
    <td class="nowrap">${esc(tsText(a.createdAt, false))}</td>
    <td><b>${esc(a.programTitle) || '-'}</b>${a.programType === 'recruit' ? '<span class="chip recruit">모집</span>' : ''}</td>
    <td>${esc(a.course || a.session) || '-'}</td>
    <td class="code-cell">${esc(a.id)}</td>
    <td>${statusChip(a)}${a.statusMemo ? `<br><span class="cell-sub">📝 ${esc(a.statusMemo)}</span>` : ''}</td>
    <td>${a.completed
      ? '<span class="status-chip done">수료완료</span>'
      : '<span class="status-chip wait">미수료</span>'}</td>
    <td><div class="t-actions">
      ${a.completed
        ? `<a class="mini-btn" href="cert.html?id=${a.id}" target="_blank" rel="noopener">이수증</a>`
        : (locked
            ? '<span class="cell-sub">사업단 문의</span>'
            : `<button class="mini-btn danger" onclick="cancelMyApp('${a.id}')">신청취소</button>`)}
    </div></td>
  </tr>`;
  }).join('');
}

/* 역할별 요약 카드 */
function paintCards(){
  const role = roleOf(profile);
  const done = myApps.filter(a => a.completed).length;
  const acts = myApps.filter(a => statusOf(a) === 'assigned');
  const hours = acts.reduce((s, a) => s + (Number(a.assignHours) || 0), 0);
  let cards;
  if (role === 'instructor'){
    cards = [['총 신청·지원', myApps.length], ['수료 완료', done],
             ['배정 확정', acts.length], ['누적 강의 시수', hours]];
  } else if (role === 'parent'){
    cards = [['자녀 참여 신청', myApps.length], ['수료 완료', done],
             ['참여 프로그램', new Set(myApps.map(a => a.programTitle).filter(Boolean)).size],
             ['진행 중', myApps.filter(a => !a.completed).length]];
  } else if (role === 'student'){
    cards = [['참여 신청', myApps.length], ['수료 완료', done],
             ['이수 강좌', new Set(myApps.filter(a => a.completed).map(a => a.course).filter(Boolean)).size],
             ['진행 중', myApps.filter(a => !a.completed).length]];
  } else {
    cards = [['단체·개인 신청', myApps.length], ['수료 완료', done],
             ['참여 프로그램', new Set(myApps.map(a => a.programTitle).filter(Boolean)).size],
             ['진행 중', myApps.filter(a => !a.completed).length]];
  }
  $('myCards').innerHTML = cards.map(([l, n], i) =>
    `<div class="dash-card a${i+1}"><div class="num">${n}</div><div class="lbl">${esc(l)}</div></div>`).join('');
}

function paintStatusCards(){
  if (roleOf(profile) !== 'instructor'){ $('statusBox').style.display = 'none'; return; }
  const live = myApps.filter(a => a.programType === 'recruit' || a.status);
  if (!live.length){ $('statusBox').style.display = 'none'; return; }
  $('statusBox').style.display = 'block';
  $('statusCards').innerHTML = live.slice(0, 6).map(a => {
    const k = statusOf(a);
    const steps = STATUS_ORDER.filter(s => s !== 'rejected');
    const idx = steps.indexOf(k);
    const track = k === 'rejected'
      ? '<div class="step-track rejected"><span>반려</span></div>'
      : `<div class="step-track">${steps.map((s, i) =>
          `<span class="step ${i <= idx ? 'on' : ''}">${statusSet(a)[s].label}</span>`).join('<i>›</i>')}</div>`;
    const asg = [a.assignPlace, a.assignPeriod,
      a.assignSessions ? `${a.assignSessions}차수` : '',
      a.assignHours ? `${a.assignHours}시수` : ''].filter(Boolean).join(' · ');
    return `<div class="status-card ${k}">
      <div class="sc-head"><b>${esc(a.programTitle || '-')}</b>${statusChip(a)}</div>
      <div class="sc-sub">${esc(a.course || '-')}</div>
      ${track}
      ${asg ? `<div class="sc-assign">📍 ${esc(asg)}</div>` : ''}
      ${a.statusMemo ? `<div class="sc-memo">📝 ${esc(a.statusMemo)}</div>` : ''}
    </div>`;
  }).join('');
}

function paintActivity(){
  if (roleOf(profile) !== 'instructor'){ $('activityBox').style.display = 'none'; return; }
  const acts = myApps.filter(a => statusOf(a) === 'assigned');
  if (!acts.length){ $('activityBox').style.display = 'none'; return; }
  $('activityBox').style.display = 'block';
  const hours = acts.reduce((s, a) => s + (Number(a.assignHours) || 0), 0);
  const sess  = acts.reduce((s, a) => s + (Number(a.assignSessions) || 0), 0);
  $('actTotal').innerHTML =
    `<span class="status-chip assigned">총 ${acts.length}건 · ${sess}차수 · ${hours}시수</span>`;
  $('activityBody').innerHTML = acts.map(a => `<tr>
    <td><b>${esc(a.programTitle || '-')}</b></td>
    <td>${esc(a.course || '-')}</td>
    <td>${esc(a.assignPlace || '-')}</td>
    <td class="nowrap">${esc(a.assignPeriod || '-')}</td>
    <td class="nowrap">${a.assignSessions ?? '-'}</td>
    <td class="nowrap">${a.assignHours ?? '-'}</td>
    <td class="cell-sub">${esc(a.statusMemo || '-')}</td>
  </tr>`).join('');
}

/* v14: 마이페이지 탭 전환 */
function switchMyTab(name){
  document.querySelectorAll('.my-tabs .atab').forEach(b =>
    b.classList.toggle('active', b.dataset.mytab === name));
  document.querySelectorAll('[id^="mytab-"]').forEach(p =>
    p.classList.toggle('on', p.id === 'mytab-' + name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.switchMyTab = switchMyTab;

function goLinkBox(){
  switchMyTab('apps');
  const el = $('linkBox');
  if (el){ el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600); }
}
window.goLinkBox = goLinkBox;

function reloadMyApps(){
  $('myAppsBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6A776F;">불러오는 중…</td></tr>';
  loadMyApps();
}
window.reloadMyApps = reloadMyApps;

async function cancelMyApp(id){
  const a = myApps.find(x => x.id === id);
  if (!a) return;
  if (selfLocked(a)){
    alert(a.completed
      ? '수료 처리된 건은 취소할 수 없습니다.\n사업단(newsac26@naver.com / 031-379-0255)으로 문의해주세요.'
      : '배정이 확정된 지원 건은 취소할 수 없습니다.\n사업단(newsac26@naver.com / 031-379-0255)으로 문의해주세요.');
    return;
  }
  if (!confirm(`[${a.programTitle} · ${a.course || ''}]\n신청을 취소할까요?\n\n취소 후에는 되돌릴 수 없으며, 재참여를 원하시면 다시 신청해야 합니다.`)) return;
  try {
    await deleteDoc(doc(db, 'applications', id));
    if (a.programId){
      await updateDoc(doc(db, 'programs', a.programId), { applied: increment(-1) }).catch(()=>{});
    }
    toast('신청을 취소했습니다.');
    await loadMyApps();
  } catch (err) { alert(fbError(err)); }
}
window.cancelMyApp = cancelMyApp;

/* =========================================================
   지난 신청 연결
========================================================= */
$('linkForm').addEventListener('submit', async e => {
  e.preventDefault();
  hideErr('linkError'); $('linkOk').style.display = 'none';
  const code = $('lk-code').value.trim();
  if (!code) return;
  const btn = $('lkBtn');
  btn.disabled = true; btn.textContent = '연결 중…';
  try {
    const ref = doc(db, 'applications', code);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      showErr('linkError', '해당 신청번호로 접수된 내역이 없습니다. 번호를 다시 확인해주세요.');
      return;
    }
    const a = snap.data();
    if (a.uid && a.uid !== currentUser.uid){
      showErr('linkError', '이미 다른 계정에 연결된 신청입니다. 사업단(newsac26@naver.com)으로 문의해주세요.');
      return;
    }
    if (a.uid === currentUser.uid){
      showErr('linkError', '이미 내 계정에 연결되어 있는 신청입니다.');
      return;
    }
    await updateDoc(ref, { uid: currentUser.uid, linkedAt: serverTimestamp() });
    $('lk-code').value = '';
    $('linkOk').textContent = `✅ [${a.programTitle || '신청'} · ${a.course || a.session || ''}] 내역을 내 계정에 연결했습니다.`;
    $('linkOk').style.display = 'block';
    toast('신청 내역을 연결했습니다.');
    await loadMyApps();
  } catch (err) {
    showErr('linkError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '내 계정에 연결';
  }
});

/* =========================================================
   비밀번호 변경
========================================================= */
$('pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  hideErr('pwError');
  if ($('pw-new').value !== $('pw-new2').value){
    showErr('pwError', '새 비밀번호가 서로 일치하지 않습니다.');
    return;
  }
  const btn = $('pwBtn');
  btn.disabled = true; btn.textContent = '변경 중…';
  try {
    const cred = EmailAuthProvider.credential(currentUser.email, $('pw-cur').value);
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, $('pw-new').value);
    $('pwForm').reset();
    showErr('pwError', '비밀번호를 변경했습니다.', true);
    toast('비밀번호를 변경했습니다.');
  } catch (err) {
    const map = {
      'auth/invalid-credential': '현재 비밀번호가 올바르지 않습니다.',
      'auth/wrong-password': '현재 비밀번호가 올바르지 않습니다.',
      'auth/weak-password': '새 비밀번호는 6자 이상이어야 합니다.'
    };
    showErr('pwError', map[err.code] || fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '비밀번호 변경';
  }
});

/* =========================================================
   상태 전환
========================================================= */
onAuthStateChanged(auth, async user => {
  currentUser = user;
  const on = !!user;
  $('authSection').style.display = on ? 'none' : 'block';
  $('mySection').style.display = on ? 'block' : 'none';
  $('mySubtitle').textContent = on
    ? `${user.displayName || user.email} 님, 환영합니다.`
    : '로그인하면 나의 신청·수강 이력과 이수증을 확인할 수 있습니다.';
  if (!on) return;

  /* v12: 관리자도 마이페이지를 그대로 이용합니다.
     예전에는 관리자면 admin.html로 자동 이동시켰는데,
     관리자 계정으로도 워크샵을 수강하거나 이수증을 받을 수 있어야 하므로
     이동 대신 상단에 '관리자 페이지로 가기' 안내만 띄웁니다. */
  const params = new URLSearchParams(location.search);
  const isAdm = await checkIsAdmin(user.uid);
  $('adminNotice').style.display = isAdm ? 'block' : 'none';
  if (isAdm) $('mySubtitle').textContent =
    `${user.displayName || user.email} 님, 환영합니다. (관리자 계정)`;

  profile = { name: user.displayName || '', email: user.email };
  try {
    const p = await getDoc(doc(db, 'users', user.uid));
    if (p.exists()) profile = { ...profile, ...p.data() };
  } catch (e) { console.warn(e); }

  paintInfo();
  paintProfileForm();
  paintInterestForm();
  paintStaffForm();
  toggleInfoEdit(false);
  await loadMyApps();

  if (params.get('next') === 'apply'){
    toast('로그인되었습니다. 신청 페이지로 이동합니다.');
    setTimeout(() => location.href = 'index.html#open-now', 900);
  }
});
