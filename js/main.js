/* =========================================================
   메인 페이지: 접수중 프로그램 카드 + 신청 모달 + 최신 공지 미리보기
========================================================= */
import { db } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy,
  increment, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  initLayout, esc, ddayInfo, noticeIsNew, catClass, fbError,
  KIND, openModal, closeModal, bindModalEvents
} from './common.js';

initLayout('home');
bindModalEvents();

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
  $('a-session').innerHTML = '<option value="">회차를 선택하세요</option>' +
    Array.from({length: p.sessions}, (_, i) => `<option>${i+1}회차</option>`).join('');
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
    await addDoc(collection(db, 'applications'), {
      programId,
      programTitle: p ? p.title : '',
      session: $('a-session').value,
      name: $('a-name').value.trim(),
      org: $('a-org').value.trim(),
      phone: $('a-phone').value.trim(),
      email: $('a-email').value.trim(),
      memo: $('a-memo').value.trim(),
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'programs', programId), { applied: increment(1) });
    $('applyForm').style.display = 'none';
    $('applyDoneMsg').textContent =
      `[${p.title} · ${$('a-session').value}] 신청이 접수되었습니다. 담당자 확인 후 입력하신 연락처로 안내드립니다.`;
    $('applyDone').style.display = 'block';
  } catch (err) {
    $('applyError').textContent = fbError(err);
    $('applyError').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '신청 접수하기';
  }
});

/* ---------- 최신 공지 미리보기 (5건) ---------- */
onSnapshot(
  query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(5)),
  snap => {
    const tb = $('noticePreviewBody');
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!rows.length){
      tb.innerHTML = '<tr class="empty-row"><td colspan="4">등록된 공지사항이 없습니다.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(n => `
      <tr onclick="location.href='notice.html?id=${n.id}'">
        <td><span class="notice-cat ${catClass(n.cat)}">${esc(n.cat)}</span></td>
        <td class="b-title"><b>${esc(n.title)}</b>${noticeIsNew(n.date) ? '<span class="notice-new">N</span>' : ''}</td>
        <td class="b-author">${esc(n.author)}</td>
        <td>${esc(n.date)}</td>
      </tr>`).join('');
  },
  err => {
    $('noticePreviewBody').innerHTML =
      `<tr class="empty-row"><td colspan="4">${esc(fbError(err))}</td></tr>`;
  }
);
