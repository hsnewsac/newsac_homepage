/* =========================================================
   관리자 페이지: Firebase Auth 로그인 + 프로그램/공지/신청자 관리
========================================================= */
import { db, auth } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, where, getDocs, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initLayout, esc, ddayInfo, todayStr, catClass, fbError, KIND } from './common.js';

initLayout('admin');

const $ = id => document.getElementById(id);
let programs = [], notices = [], applications = [];
let unsubApplications = null;

/* ==================== 인증 ==================== */
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = '로그인 중…';
  try {
    await signInWithEmailAndPassword(auth, $('l-email').value.trim(), $('l-pw').value);
  } catch (err) {
    $('loginError').textContent = fbError(err);
    $('loginError').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '로그인';
  }
});
function adminLogout(){ signOut(auth); }
window.adminLogout = adminLogout;

onAuthStateChanged(auth, user => {
  const on = !!user;
  $('loginSection').style.display = on ? 'none' : 'block';
  $('admin-panel').classList.toggle('on', on);
  $('adminSubtitle').textContent = on
    ? '프로그램 등록, 공지 작성, 신청자 명단을 관리합니다.'
    : '사업단 관리자 계정으로 로그인해주세요.';
  if (on){
    $('adminEmail').textContent = user.email;
    subscribeApplications();
  } else {
    if (unsubApplications){ unsubApplications(); unsubApplications = null; }
    applications = [];
  }
});

/* ==================== 프로그램 ==================== */
$('programForm').addEventListener('submit', async e => {
  e.preventDefault();
  const idVal = $('p-id').value;
  const data = {
    type: $('p-type').value,
    title: $('p-title').value.trim(),
    target: $('p-target').value.trim(),
    period: $('p-period').value.trim(),
    place: $('p-place').value.trim(),
    content: $('p-content').value.trim(),
    deadline: $('p-deadline').value,
    capacity: Number($('p-capacity').value),
    sessions: Number($('p-sessions').value)
  };
  try {
    if (idVal){
      await updateDoc(doc(db, 'programs', idVal), data);
    } else {
      await addDoc(collection(db, 'programs'), {
        ...data,
        applied: Number($('p-applied').value) || 0,
        open: true,
        createdAt: serverTimestamp()
      });
    }
    resetProgramForm();
  } catch (err) { alert(fbError(err)); }
});
function editProgram(id){
  const p = programs.find(x => x.id === id);
  if (!p) return;
  $('p-id').value = p.id;
  $('p-type').value = p.type;
  $('p-title').value = p.title;
  $('p-target').value = p.target;
  $('p-period').value = p.period;
  $('p-place').value = p.place;
  $('p-content').value = p.content;
  $('p-deadline').value = p.deadline;
  $('p-capacity').value = p.capacity;
  $('p-sessions').value = p.sessions;
  $('p-applied').value = p.applied || 0;
  $('p-applied').disabled = true; // 신청 인원은 접수와 함께 자동 관리
  $('pFormTitle').textContent = '✏️ 프로그램 수정 — ' + p.title;
  $('pFormSubmit').textContent = '수정 저장';
  $('programForm').scrollIntoView({behavior:'smooth', block:'center'});
}
function resetProgramForm(){
  $('programForm').reset();
  $('p-id').value = '';
  $('p-sessions').value = 3;
  $('p-applied').value = 0;
  $('p-applied').disabled = false;
  $('pFormTitle').textContent = '📌 새 프로그램 등록';
  $('pFormSubmit').textContent = '프로그램 등록';
}
async function deleteProgram(id){
  const p = programs.find(x => x.id === id);
  if (!p || !confirm(`'${p.title}' 프로그램을 삭제할까요?\n관련 신청 내역도 함께 삭제됩니다.`)) return;
  try {
    const snap = await getDocs(query(collection(db, 'applications'), where('programId', '==', id)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'programs', id));
  } catch (err) { alert(fbError(err)); }
}
async function toggleOpen(id){
  const p = programs.find(x => x.id === id);
  if (!p) return;
  try { await updateDoc(doc(db, 'programs', id), { open: !p.open }); }
  catch (err) { alert(fbError(err)); }
}
function renderAdminTable(){
  const tb = $('programTableBody');
  if (!programs.length){
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6A776F;">등록된 프로그램이 없습니다. 위에서 새 프로그램을 등록하세요.</td></tr>';
    return;
  }
  tb.innerHTML = programs.map(p => {
    const dd = ddayInfo(p);
    const closed = !p.open || dd.closed;
    return `<tr>
      <td><span class="chip ${p.type}">${KIND[p.type] || ''}</span></td>
      <td><b>${esc(p.title)}</b></td>
      <td>${esc(p.deadline)}</td>
      <td>${p.applied || 0} / ${p.capacity}</td>
      <td><span class="chip ${closed ? 'close' : 'open'}">${closed ? '마감' : '접수중'}</span></td>
      <td><div class="t-actions">
        <button class="mini-btn" onclick="editProgram('${p.id}')">수정</button>
        <button class="mini-btn" onclick="toggleOpen('${p.id}')">${p.open ? '마감처리' : '접수재개'}</button>
        <button class="mini-btn danger" onclick="deleteProgram('${p.id}')">삭제</button>
      </div></td>
    </tr>`;
  }).join('');
}
Object.assign(window, { editProgram, resetProgramForm, deleteProgram, toggleOpen });

/* ==================== 공지 ==================== */
$('noticeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const bodyHtml = '<p>' + esc($('n-body').value.trim())
    .replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  try {
    await addDoc(collection(db, 'notices'), {
      cat: $('n-cat').value,
      title: $('n-title').value.trim(),
      author: '사업단',
      date: todayStr(),
      views: 0,
      body: bodyHtml,
      createdAt: serverTimestamp()
    });
    $('noticeForm').reset();
  } catch (err) { alert(fbError(err)); }
});
async function deleteNotice(id){
  const n = notices.find(x => x.id === id);
  if (!n || !confirm(`'${n.title}' 공지를 삭제할까요?`)) return;
  try { await deleteDoc(doc(db, 'notices', id)); }
  catch (err) { alert(fbError(err)); }
}
function renderNoticeAdmin(){
  const tb = $('noticeAdminBody');
  if (!notices.length){
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6A776F;">등록된 공지가 없습니다.</td></tr>';
    return;
  }
  tb.innerHTML = notices.map(n => `<tr>
    <td><span class="notice-cat ${catClass(n.cat)}">${esc(n.cat)}</span></td>
    <td><b>${esc(n.title)}</b></td>
    <td>${esc(n.date)}</td>
    <td>${n.views || 0}</td>
    <td><div class="t-actions">
      <a class="mini-btn" href="notice.html?id=${n.id}" target="_blank" rel="noopener">보기</a>
      <button class="mini-btn danger" onclick="deleteNotice('${n.id}')">삭제</button>
    </div></td>
  </tr>`).join('');
}
window.deleteNotice = deleteNotice;

/* ==================== 신청자 명단 ==================== */
function subscribeApplications(){
  if (unsubApplications) return;
  unsubApplications = onSnapshot(
    query(collection(db, 'applications'), orderBy('createdAt', 'desc')),
    snap => {
      applications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderApplicants();
    },
    err => console.error('applications 구독 오류:', err)
  );
}
function appDate(a){
  try {
    return a.createdAt?.toDate
      ? a.createdAt.toDate().toLocaleString('ko-KR', {dateStyle:'short', timeStyle:'short'})
      : '-';
  } catch { return '-'; }
}
function renderApplicants(){
  const tb = $('applicantTableBody');
  if (!applications.length){
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6A776F;">아직 접수된 신청이 없습니다.</td></tr>';
    return;
  }
  tb.innerHTML = applications.map(a => `<tr>
    <td>${esc(appDate(a))}</td>
    <td>${esc(a.programTitle) || '-'}</td>
    <td>${esc(a.session)}</td>
    <td><b>${esc(a.name)}</b></td>
    <td>${esc(a.org)}</td>
    <td>${esc(a.phone)}</td>
    <td>${esc(a.email) || '-'}</td>
    <td><button class="mini-btn danger" onclick="deleteApplicant('${a.id}')">삭제</button></td>
  </tr>`).join('');
}
async function deleteApplicant(id){
  const a = applications.find(x => x.id === id);
  if (!a || !confirm('이 신청 내역을 삭제할까요?')) return;
  try {
    await deleteDoc(doc(db, 'applications', id));
    if (a.programId){
      await updateDoc(doc(db, 'programs', a.programId), { applied: increment(-1) }).catch(()=>{});
    }
  } catch (err) { alert(fbError(err)); }
}
function downloadCSV(){
  if (!applications.length){ alert('접수된 신청이 없습니다.'); return; }
  const rows = [['접수일시','프로그램','회차','이름','소속','연락처','이메일','요청사항']];
  applications.forEach(a => {
    rows.push([appDate(a), a.programTitle || '', a.session, a.name, a.org, a.phone, a.email, a.memo]);
  });
  const csv = '\uFEFF' + rows.map(r =>
    r.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')
  ).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '디지털새싹_신청자명단.csv';
  a.click();
  URL.revokeObjectURL(url);
}
Object.assign(window, { deleteApplicant, downloadCSV });

/* ==================== 실시간 구독 (프로그램/공지) ==================== */
onSnapshot(
  query(collection(db, 'programs'), orderBy('createdAt', 'desc')),
  snap => {
    programs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminTable();
  },
  err => console.error('programs 구독 오류:', err)
);
onSnapshot(
  query(collection(db, 'notices'), orderBy('createdAt', 'desc')),
  snap => {
    notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNoticeAdmin();
  },
  err => console.error('notices 구독 오류:', err)
);
