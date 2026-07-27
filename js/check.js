/* =========================================================
   신청 확인·취소: 신청번호(문서 ID)로 본인 신청 조회 후 취소
   취소 시 해당 프로그램의 신청 인원(applied)을 1 차감합니다.
========================================================= */
import { db } from './firebase-init.js';
import {
  doc, getDoc, deleteDoc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { initLayout, esc, fbError } from './common.js';

initLayout('check');

const $ = id => document.getElementById(id);
let currentApp = null; // {id, ...data}

function showError(msg){
  const el = $('checkError');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideError(){ $('checkError').style.display = 'none'; }

function appDate(a){
  try {
    return a.createdAt?.toDate
      ? a.createdAt.toDate().toLocaleString('ko-KR', {dateStyle:'long', timeStyle:'short'})
      : '-';
  } catch { return '-'; }
}

$('checkForm').addEventListener('submit', async e => {
  e.preventDefault();
  hideError();
  const code = $('c-code').value.trim();
  if (!code) return;
  const btn = $('checkBtn');
  btn.disabled = true; btn.textContent = '조회 중…';
  try {
    const snap = await getDoc(doc(db, 'applications', code));
    if (!snap.exists()){
      showError('해당 신청번호로 접수된 내역이 없습니다. 번호를 다시 확인해주세요. (이미 취소된 신청일 수도 있습니다.)');
      return;
    }
    currentApp = { id: snap.id, ...snap.data() };
    $('r-code').textContent = currentApp.id;
    $('r-program').textContent = currentApp.programTitle || '-';
    $('r-course').textContent = currentApp.course || currentApp.session || '-';
    $('r-name').textContent = currentApp.name || '-';
    $('r-org').textContent = currentApp.org || '-';
    $('r-orgtype').textContent = currentApp.orgType || '-';
    $('r-phone').textContent = currentApp.phone || '-';
    $('r-email').textContent = currentApp.email || '-';
    $('r-date').textContent = appDate(currentApp);
    $('checkResult').style.display = 'block';
    $('cancelDone').style.display = 'none';
  } catch (err) {
    showError(fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '조회하기';
  }
});

function resetCheck(){
  currentApp = null;
  $('checkResult').style.display = 'none';
  $('cancelDone').style.display = 'none';
  $('c-code').value = '';
  hideError();
  $('c-code').focus();
}

async function cancelApplication(){
  if (!currentApp) return;
  if (!confirm(`[${currentApp.programTitle} · ${currentApp.course || ''}]\n${currentApp.name}님의 신청을 취소할까요?\n\n취소 후에는 되돌릴 수 없으며, 재참여를 원하시면 다시 신청해야 합니다.`)) return;
  const btn = $('cancelBtn');
  btn.disabled = true; btn.textContent = '취소 처리 중…';
  try {
    await deleteDoc(doc(db, 'applications', currentApp.id));
    if (currentApp.programId){
      await updateDoc(doc(db, 'programs', currentApp.programId), { applied: increment(-1) }).catch(()=>{});
    }
    $('checkResult').style.display = 'none';
    $('cancelDone').style.display = 'block';
    currentApp = null;
  } catch (err) {
    showError(fbError(err));
  } finally {
    btn.disabled = false; btn.textContent = '신청 취소하기';
  }
}

Object.assign(window, { resetCheck, cancelApplication });
