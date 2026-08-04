/* =========================================================
   마이페이지 v5 — 강사 계정 허브
   - 회원가입/로그인 (강사 계정)
   - 활동 요약 · 내 정보 수정 · 강사 프로필(강사모집 대비)
   - 신청 이력 조회 · 신청 취소 · 이수증
   - 지난 신청 내역을 신청번호로 내 계정에 연결
   - 비밀번호 변경
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
  STATUS, STATUS_ORDER, statusOf, statusChip
} from './common.js';

initLayout('mypage');
const $ = id => document.getElementById(id);

let currentUser = null;
let profile = {};
let myApps = [];

/* ---------- 셀렉트/체크박스 초기화 ---------- */
const orgOptions = '<option value="">선택</option>' + ORG_TYPES.map(t => `<option>${t}</option>`).join('');
$('j-orgtype').innerHTML = orgOptions;
$('e-orgtype').innerHTML = orgOptions;
$('pf-career').innerHTML = '<option value="">선택</option>' +
  CAREER_LEVELS.map(c => `<option>${c}</option>`).join('');
$('pf-specialties').innerHTML = SPECIALTIES.map((s, i) =>
  `<label class="chk"><input type="checkbox" name="sp" value="${esc(s)}" id="sp${i}"><span>${esc(s)}</span></label>`).join('');
$('pf-regions').innerHTML = REGIONS.map((r, i) =>
  `<label class="chk"><input type="checkbox" name="rg" value="${esc(r)}" id="rg${i}"><span>${esc(r)}</span></label>`).join('');

/* ---------- 공통 ---------- */
function showErr(id, msg, ok = false){
  const el = $(id);
  el.textContent = msg;
  el.style.display = 'block';
  el.classList.toggle('as-ok', ok);
}
function hideErr(id){ $(id).style.display = 'none'; }

/* ---------- 인증 탭 ---------- */
function switchAuthTab(tab){
  const login = tab === 'login';
  $('tabLogin').classList.toggle('active', login);
  $('tabJoin').classList.toggle('active', !login);
  $('loginForm').style.display = login ? 'block' : 'none';
  $('joinForm').style.display = login ? 'none' : 'block';
  hideErr('authError'); hideErr('joinError');
}
window.switchAuthTab = switchAuthTab;

/* ---------- 회원가입 ---------- */
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
    await setDoc(doc(db, 'users', cred.user.uid), {
      name: $('j-name').value.trim(),
      email,
      org: $('j-org').value.trim(),
      orgType: $('j-orgtype').value,
      phone: $('j-phone').value.trim(),
      role: 'instructor',          // ★ 강사 계정 (향후 강사모집·강의배정 대상)
      createdAt: serverTimestamp()
    });
    await updateProfile(cred.user, { displayName: $('j-name').value.trim() }).catch(()=>{});
    toast('회원가입이 완료되었습니다. 환영합니다!');
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

/* ---------- 로그인 ---------- */
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

/* ---------- 내 정보 ---------- */
function paintInfo(){
  $('m-name').textContent    = profile.name || '-';
  $('m-email').textContent   = profile.email || currentUser?.email || '-';
  $('m-org').textContent     = profile.org || '-';
  $('m-orgtype').textContent = profile.orgType || '-';
  $('m-phone').textContent   = profile.phone || '-';
}
function toggleInfoEdit(on){
  $('infoView').style.display = on ? 'none' : 'grid';
  $('infoForm').style.display = on ? 'block' : 'none';
  $('editInfoBtn').style.display = on ? 'none' : 'inline-block';
  hideErr('infoError');
  if (on){
    $('e-name').value    = profile.name || '';
    $('e-org').value     = profile.org || '';
    $('e-orgtype').value = profile.orgType || '';
    $('e-phone').value   = profile.phone || '';
  }
}
window.toggleInfoEdit = toggleInfoEdit;

$('infoForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('infoSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const patch = {
      name: $('e-name').value.trim(),
      org: $('e-org').value.trim(),
      orgType: $('e-orgtype').value,
      phone: $('e-phone').value.trim(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', currentUser.uid), patch, { merge: true });
    await updateProfile(currentUser, { displayName: patch.name }).catch(()=>{});
    profile = { ...profile, ...patch };
    paintInfo();
    toggleInfoEdit(false);
    toast('내 정보를 저장했습니다.');
  } catch (err) {
    showErr('infoError', fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '저장';
  }
});

/* ---------- 강사 프로필 ---------- */
function paintProfileForm(){
  const sp = profile.specialties || [];
  const rg = profile.regions || [];
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
      role: 'instructor',
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

/* ---------- 신청 이력 ---------- */
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
  paintApps();
  paintStats();
  paintStatusCards();
  paintActivity();
}
function paintApps(){
  const tb = $('myAppsBody');
  if (!myApps.length){
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6A776F;">
      신청 이력이 없습니다.<br><a href="index.html" style="color:var(--leaf);text-decoration:underline;">홈에서 접수 중인 프로그램</a>에 신청해보세요!</td></tr>`;
    return;
  }
  tb.innerHTML = myApps.map(a => {
    const k = statusOf(a);
    const locked = a.completed || k === 'assigned';
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

/* ---------- 지원 진행 현황 카드 ---------- */
function paintStatusCards(){
  const live = myApps.filter(a => a.programType === 'recruit' || a.status);
  const box = $('statusBox');
  if (!live.length){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  $('statusCards').innerHTML = live.slice(0, 6).map(a => {
    const k = statusOf(a);
    const steps = STATUS_ORDER.filter(s => s !== 'rejected');
    const idx = steps.indexOf(k);
    const track = k === 'rejected'
      ? '<div class="step-track rejected"><span>반려</span></div>'
      : `<div class="step-track">${steps.map((s, i) =>
          `<span class="step ${i <= idx ? 'on' : ''}">${STATUS[s].label}</span>`).join('<i>›</i>')}</div>`;
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

/* ---------- 강의활동 이력 ---------- */
function paintActivity(){
  const acts = myApps.filter(a => statusOf(a) === 'assigned');
  const box = $('activityBox');
  if (!acts.length){ box.style.display = 'none'; return; }
  box.style.display = 'block';
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

function paintStats(){
  $('s-total').textContent  = myApps.length;
  $('s-done').textContent   = myApps.filter(a => a.completed).length;
  const acts = myApps.filter(a => statusOf(a) === 'assigned');
  $('s-assign').textContent = acts.length;
  $('s-hours').textContent  = acts.reduce((s, a) => s + (Number(a.assignHours) || 0), 0);
}
function reloadMyApps(){
  $('myAppsBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6A776F;">불러오는 중…</td></tr>';
  loadMyApps();
}
window.reloadMyApps = reloadMyApps;

async function cancelMyApp(id){
  const a = myApps.find(x => x.id === id);
  if (!a) return;
  if (a.completed || statusOf(a) === 'assigned'){
    alert('수료 처리되었거나 배정이 확정된 건은 취소할 수 없습니다.\n사업단(hello@hsnewsac.com / 031-379-0252)으로 문의해주세요.');
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

/* ---------- 지난 신청 연결 ---------- */
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
      showErr('linkError', '이미 다른 계정에 연결된 신청입니다. 사업단(hello@hsnewsac.com)으로 문의해주세요.');
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

/* ---------- 비밀번호 변경 ---------- */
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

/* ---------- 상태 전환 ---------- */
onAuthStateChanged(auth, async user => {
  currentUser = user;
  const on = !!user;
  $('authSection').style.display = on ? 'none' : 'block';
  $('mySection').style.display = on ? 'block' : 'none';
  $('mySubtitle').textContent = on
    ? `${user.displayName || user.email} 님, 환영합니다.`
    : '로그인하면 나의 신청·수강 이력과 이수증을 확인할 수 있습니다.';
  if (!on) return;

  profile = { name: user.displayName || '', email: user.email };
  try {
    const p = await getDoc(doc(db, 'users', user.uid));
    if (p.exists()) profile = { ...profile, ...p.data() };
  } catch (e) { console.warn(e); }
  paintInfo();
  paintProfileForm();
  toggleInfoEdit(false);
  await loadMyApps();

  // 신청 페이지에서 '로그인하고 신청' 으로 넘어온 경우 되돌려보내기
  const next = new URLSearchParams(location.search).get('next');
  if (next === 'apply'){
    toast('로그인되었습니다. 신청 페이지로 이동합니다.');
    setTimeout(() => location.href = 'index.html#open-now', 900);
  }
});
