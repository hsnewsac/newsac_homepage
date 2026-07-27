/* =========================================================
   메인 페이지: 접수중 프로그램 카드 + 신청 모달 + 최신 공지 미리보기
========================================================= */
import { db } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  initLayout, esc, ddayInfo, noticeIsNew, catClass, fbError,
  KIND, ORG_TYPES, openModal, closeModal, bindModalEvents
} from './common.js';
import { sendApplicationEmail, emailEnabled } from './email-config.js';

initLayout('home');
bindModalEvents();

document.getElementById('a-orgtype').innerHTML =
  '<option value="">유형을 선택하세요</option>' +
  ORG_TYPES.map(t => `<option>${t}</option>`).join('');

const $ = id => document.getElementById(id);
let programs = [];

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
    return `
    <div class="open-card ${p.type === 'workshop' ? 'workshop' : ''} ${closed ? 'closed' : ''}">
      <div class="open-top">
        ${closed
          ? '<span class="status end">접수마감</span>'
          : `<span class="status live">접수중</span><span class="dday ${dd.urgent ? '' : 'calm'}">${esc(dd.text)}</span>`}
        <span class="kind-label">${KIND[p.type] || ''}</span>
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
        <button class="btn ${p.type === 'workshop' ? 'btn-navy' : 'btn-primary'}"
          ${closed ? 'disabled' : ''} onclick="openApply('${p.id}')">
          ${closed ? '접수가 마감되었습니다' : '신청하기'}
        </button>
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
function openApply(programId){
  const p = programs.find(x => x.id === programId);
  if (!p) return;
  $('a-programId').value = p.id;
  $('a-programName').value = p.title;
  const chip = $('am-kind');
  chip.textContent = KIND[p.type] || '';
  chip.style.background = p.type === 'workshop' ? 'var(--navy-soft)' : 'var(--sprout-soft)';
  chip.style.color = p.type === 'workshop' ? 'var(--navy)' : 'var(--leaf)';
  const courses = Array.isArray(p.courses) && p.courses.length
    ? p.courses
    : Array.from({length: p.sessions || 1}, (_, i) => `${i+1}회차`); // 구버전 데이터 호환
  $('a-course').innerHTML = '<option value="">강좌를 선택하세요</option>' +
    courses.map(c => `<option>${esc(c)}</option>`).join('');
  $('applyForm').reset();
  $('a-programId').value = p.id;
  $('a-programName').value = p.title;
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
      course: $('a-course').value,
      name: $('a-name').value.trim(),
      org: $('a-org').value.trim(),
      orgType: $('a-orgtype').value,
      phone: $('a-phone').value.trim(),
      email: $('a-email').value.trim(),
      memo: $('a-memo').value.trim(),
      createdAt: serverTimestamp()
    };
    const ref = await addDoc(collection(db, 'applications'), appData);
    await updateDoc(doc(db, 'programs', programId), { applied: increment(1) });

    $('applyForm').style.display = 'none';
    $('applyDoneMsg').textContent =
      `[${p.title} · ${appData.course}] 신청이 접수되었습니다. 담당자 확인 후 안내드립니다.`;
    $('applyDoneCode').textContent = ref.id;
    $('applyDone').style.display = 'block';

    // 신청내역 이메일 발송 (실패해도 접수는 완료)
    const mailNote = $('applyDoneMail');
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
      mailNote.innerHTML = r.ok
        ? '신청번호는 <b>신청 확인·취소</b>에 필요합니다. 📧 입력하신 이메일로 신청내역을 발송했습니다.'
        : '신청번호는 <b>신청 확인·취소</b>에 필요합니다. (이메일 발송에 실패했으니 위 번호를 꼭 메모해주세요.)';
    } else {
      mailNote.innerHTML = '신청번호는 <b>신청 확인·취소</b>에 필요합니다. 위 번호를 꼭 메모하거나 화면을 캡처해주세요.';
    }
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
