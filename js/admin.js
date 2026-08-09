/* =========================================================
   관리자 페이지 v5
   - 탭 구조 (대시보드 / 프로그램 / 공지 / 신청자 / 강사 회원)
   - 신청자: 검색·필터·정렬·페이지네이션·일괄처리·선택 CSV
   - 수료 처리 시 수료 안내 메일 자동 발송(템플릿 설정 시)
   - 강사 회원 명단 조회 (강사모집·강의배정 대비)
========================================================= */
import { db, auth } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc, setDoc,
  query, orderBy, where, getDocs, increment, serverTimestamp,
  runTransaction, deleteField
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initLayout, esc, ddayInfo, notYetOpen, todayStr, catClass, fbError,
  KIND, ORG_TYPES, SPECIALTIES, REGIONS, CAREER_LEVELS,
  COURSES_2026, courseByKey, guessCourseKey, acceptedOnlineKeys, acceptedOnlineLabel,
  WORKSHOP_TARGET, qualificationHTML,
  SCHOOL_LEVELS, CAMP_MODES, RECRUIT_ROLES, RECRUIT_FOR, WORKSHOP_MODES, fmtPeriodKo,
  STATUS, STATUS_ORDER, statusOf, statusChip, APPROVE_STATUS, statusSet, isRecruit,
  ROLES, ROLE_ORDER, roleOf,
  tsText, tsNum, toast, openModal, closeModal, bindModalEvents, checkIsAdmin
} from './common.js';
import { sendCertificateEmail, certEmailEnabled } from './email-config.js';

initLayout('admin');
bindModalEvents();

const $ = id => document.getElementById(id);
const PAGE_SIZE = 50;

let programs = [], notices = [], applications = [], members = [];
let unsubApplications = null;
let selected = new Set();
let sortKey = 'createdAt', sortDir = 'desc';
let page = 1;
let membersLoaded = false;

/* 상태 관련 셀렉트 초기화
   신청자 탭에는 워크샵(승인 흐름)과 강사모집(배정 흐름)이 섞여 있으므로
   라벨이 다른 항목은 '승인완료 / 배정확정'처럼 함께 표기합니다. */
const dualLabel = k => APPROVE_STATUS[k].label === STATUS[k].label
  ? STATUS[k].label
  : `${APPROVE_STATUS[k].label} / ${STATUS[k].label}`;

$('f-astatus').innerHTML = '<option value="">전체</option>' +
  STATUS_ORDER.map(k => `<option value="${k}">${dualLabel(k)}</option>`).join('');
$('bulkStatus').innerHTML = '<option value="">승인 상태 일괄 변경…</option>' +
  STATUS_ORDER.map(k => `<option value="${k}">→ ${dualLabel(k)}(으)로 변경</option>`).join('');
/* ---------- v11: 강좌 체크박스 · 학교급 칩 · 지원자격 툴팁 ---------- */
function courseListHTML(prefix){
  return COURSES_2026.map((c, i) => `
    <label>
      <input type="checkbox" data-course="${prefix}" value="${esc(c.name)}"
             onchange="updateCourseCount('${prefix}')" id="${prefix}-c${i}">
      <span>
        <span class="cp-name">${esc(c.name)}</span>
        <span class="cp-meta">
          <span class="${c.group === '특화' ? 'cp-sp' : ''}">${esc(c.group)}과정</span> · ${esc(c.level)}
        </span>
      </span>
    </label>`).join('');
}
$('p-courseList').innerHTML = courseListHTML('p');
$('r-courseList').innerHTML = courseListHTML('r');

$('r-levelList').innerHTML = SCHOOL_LEVELS.map((l, i) => `
  <label><input type="checkbox" data-level="r" value="${esc(l)}" id="r-l${i}"><span>${esc(l)}</span></label>`).join('');

$('r-role').innerHTML = RECRUIT_ROLES.map(v => `<option>${esc(v)}</option>`).join('');
$('r-for').innerHTML = Object.entries(RECRUIT_FOR)
  .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');

/* v11.1: 모집 목적(캠프 강사 / 워크샵 운영 강사)에 따라 폼 항목을 바꿉니다 */
const R_PRESET = {
  camp: {
    modeLabel: '운영 형태', modes: CAMP_MODES,
    placeLabel: '활동 지역 / 운영 학교',
    placeHint: '예) 경기 남부권(오산·화성·수원) 초·중학교',
    startLabel: '활동 시작', endLabel: '활동 종료',
    hoursLabel: '운영 조건 / 시수', hoursHint: '예) 1개교당 8차시 · 회차별 일정 협의',
    courseLabel: '담당 과정', courseHint: '지원자는 이 목록에서 희망 과정을 선택합니다.',
    titleHint: '예) 2026 하반기 디지털새싹 캠프 강사 모집',
    contentHint: '예) 학교 방문 캠프 강의 · 교구 운영 · 결과보고서 작성',
    targetHint: '예) SW·AI 교육 경력 1년 이상 강사',
    showLevels: true
  },
  workshop: {
    modeLabel: '진행 방식', modes: WORKSHOP_MODES,
    placeLabel: '운영 장소',
    placeHint: '예) 한신대학교 AI·SW관 302호 (온라인 병행 시 Zoom)',
    startLabel: '워크샵 시작', endLabel: '워크샵 종료',
    hoursLabel: '운영 조건 / 차시', hoursHint: '예) 1일 6차시 · 사전 교안 회의 1회 포함',
    courseLabel: '담당 과정', courseHint: '이 강사가 워크샵에서 다룰 과정을 선택하세요.',
    titleHint: '예) 2026 하반기 강사 워크샵 운영 강사 모집',
    contentHint: '예) 워크샵 강의 진행 · 교안 작성 · 실습 지원',
    targetHint: '예) 해당 과정 운영 경험이 있는 현직 강사',
    showLevels: false
  }
};
function applyRecruitPreset(){
  const key = $('r-for').value || 'camp';
  const c = R_PRESET[key];
  const req = '<span class="req">*</span>';

  $('r-forHint').textContent = RECRUIT_FOR[key].hint;
  $('r-modeLabel').innerHTML  = `${c.modeLabel} ${req}`;
  $('r-placeLabel').innerHTML = `${c.placeLabel} ${req}`;
  $('r-startLabel').innerHTML = `${c.startLabel} ${req}`;
  $('r-endLabel').innerHTML   = `${c.endLabel} ${req}`;
  $('r-hoursLabel').innerHTML = `${c.hoursLabel} ${req}`;
  $('r-courseLabel').innerHTML = `${c.courseLabel} ${req} <span class="hint">— ${esc(c.courseHint)}</span>`;

  const keepMode = $('r-mode').value;
  $('r-mode').innerHTML = c.modes.map(v => `<option>${esc(v)}</option>`).join('');
  if (c.modes.includes(keepMode)) $('r-mode').value = keepMode;

  $('r-place').placeholder   = c.placeHint;
  $('r-hours').placeholder   = c.hoursHint;
  $('r-title').placeholder   = c.titleHint;
  $('r-content').placeholder = c.contentHint;
  $('r-target').placeholder  = c.targetHint;

  $('r-levelBlock').style.display = c.showLevels ? '' : 'none';
  if (!c.showLevels) setPickedLevels([]);
}
$('r-for').addEventListener('change', applyRecruitPreset);
applyRecruitPreset();   // 최초 1회 적용

/* 워크샵 대상 기본값 + 지원 자격 툴팁 */
$('p-qualPop').innerHTML = '<b class="pop-title">지원 자격</b>' + qualificationHTML() +
  '<em>홈 화면 워크샵 카드의 <b>대상</b> 옆 도움말에도 같은 내용이 표시됩니다.</em>';
$('p-target').value = WORKSHOP_TARGET;

function pickedCourses(prefix){
  return [...document.querySelectorAll(`input[data-course="${prefix}"]:checked`)].map(c => c.value);
}
function setPickedCourses(prefix, list){
  const set = new Set(list || []);
  document.querySelectorAll(`input[data-course="${prefix}"]`).forEach(c => { c.checked = set.has(c.value); });
  updateCourseCount(prefix);
  /* 목록에 없는 강좌는 직접 입력 칸으로 (워크샵만 해당) */
  if (prefix === 'p'){
    const known = new Set(COURSES_2026.map(c => c.name));
    $('p-courseExtra').value = (list || []).filter(v => !known.has(v)).join(', ');
  }
}
function updateCourseCount(prefix){
  const n = pickedCourses(prefix).length;
  const el = $(`${prefix}-courseCount`);
  el.textContent = `${n}개 선택`;
  el.classList.toggle('on', n > 0);
}
function pickAllCourses(prefix, on){
  document.querySelectorAll(`input[data-course="${prefix}"]`).forEach(c => { c.checked = on; });
  updateCourseCount(prefix);
}
function pickedLevels(){
  return [...document.querySelectorAll('input[data-level="r"]:checked')].map(c => c.value);
}
function setPickedLevels(list){
  const set = new Set(list || []);
  document.querySelectorAll('input[data-level="r"]').forEach(c => { c.checked = set.has(c.value); });
}
Object.assign(window, { pickAllCourses, updateCourseCount });

$('cd-region').innerHTML = '<option value="">전체</option>' +
  REGIONS.map(r => `<option>${r}</option>`).join('');
$('cd-specialty').innerHTML = '<option value="">전체</option>' +
  SPECIALTIES.map(s => `<option>${s}</option>`).join('');
$('cd-career').innerHTML = '<option value="">전체</option>' +
  CAREER_LEVELS.map((c, i) => `<option value="${i}">${c} 이상</option>`).join('');
$('mf-role').innerHTML = '<option value="">전체</option>' +
  ROLE_ORDER.map(k => `<option value="${k}">${ROLES[k].icon} ${ROLES[k].label}</option>`).join('');

/* ==================== 탭 ==================== */
function switchTab(name){
  document.querySelectorAll('.atab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('on', p.id === 'tab-' + name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if ((name === 'member' || name === 'assign') && !membersLoaded) loadMembers();
  if (name === 'assign') renderAssign();
  if (name === 'class') renderClassroom();
}
window.switchTab = switchTab;

/* ==================== 접근 제어 ==================== */
function adminLogout(){ signOut(auth); }
window.adminLogout = adminLogout;

function showGate(kind, user){
  $('gateSection').style.display = 'block';
  $('admin-panel').classList.remove('on');
  const icon = $('gateIcon'), title = $('gateTitle'),
        desc = $('gateDesc'), acts = $('gateActions');
  if (kind === 'anon'){
    $('adminSubtitle').textContent = '관리자 로그인이 필요합니다.';
    icon.textContent = '🔒';
    title.textContent = '로그인이 필요합니다';
    desc.innerHTML = '사업단 관리자 계정으로 로그인하시면 이 페이지가 열립니다.<br>로그인은 사이트 우측 상단에서도 하실 수 있습니다.';
    acts.innerHTML = `<a class="btn btn-navy" href="mypage.html?next=admin">로그인하러 가기</a>
      <a class="btn btn-outline" href="index.html">홈으로</a>`;
  } else {
    $('adminSubtitle').textContent = '이 계정에는 관리자 권한이 없습니다.';
    icon.textContent = '⛔';
    title.textContent = '관리자 권한이 없습니다';
    desc.innerHTML = `현재 <b>${esc(user?.email || '')}</b> 계정으로 로그인되어 있습니다.<br>
      강사·참가자 계정은 마이페이지를 이용해주세요.`;
    acts.innerHTML = `<a class="btn btn-primary" href="mypage.html">마이페이지로 이동</a>
      <button class="btn btn-outline" onclick="adminLogout()">다른 계정으로 로그인</button>`;
  }
}

onAuthStateChanged(auth, async user => {
  if (!user){
    if (unsubApplications){ unsubApplications(); unsubApplications = null; }
    applications = []; members = []; membersLoaded = false; selected.clear();
    showGate('anon');
    return;
  }
  const ok = await checkIsAdmin(user.uid);
  if (!ok){ showGate('denied', user); return; }

  $('gateSection').style.display = 'none';
  $('admin-panel').classList.add('on');
  $('adminSubtitle').textContent = '프로그램 등록, 공지 작성, 신청자·강사 배정을 관리합니다.';
  $('adminEmail').textContent = user.email;
  $('adminAva').textContent = (user.email || 'A').charAt(0).toUpperCase();
  myUid = user.uid;
  subscribeApplications();
  loadMembers();          // v11: 대시보드·뱃지 숫자를 위해 로그인 직후 회원도 불러옵니다
});

/* ==================== 프로그램 ==================== */
$('programForm').addEventListener('submit', async e => {
  e.preventDefault();
  const idVal = $('p-id').value;
  const extra = $('p-courseExtra').value.split(',').map(v => v.trim()).filter(Boolean);
  const start = $('p-start').value, end = $('p-end').value;
  const st = $('p-startTime').value, et = $('p-endTime').value;
  if (start && end && start > end){ alert('운영 종료일이 시작일보다 빠릅니다.'); return; }
  if (start && end && start === end && st && et && st > et){
    alert('종료 시각이 시작 시각보다 빠릅니다.'); return;
  }
  const openDate = $('p-open').value, openTime = $('p-openTime').value;
  const dl = $('p-deadline').value, dlTime = $('p-deadlineTime').value;
  if (openDate && dl && openDate > dl){
    alert('접수 시작일이 접수 마감일보다 늦습니다.'); return;
  }
  if (openDate && dl && openDate === dl && openTime && dlTime && openTime > dlTime){
    alert('접수 마감 시각이 시작 시각보다 빠릅니다.'); return;
  }
  const data = {
    type: $('p-type').value || 'workshop',
    wsKind: $('p-wskind').value,          // v18: 정규(regular) / 미니(mini)
    openDate,                             // v19: 접수 시작 (없으면 즉시 접수)
    openTime,
    deadlineTime: dlTime,                 // v19: 마감 시각 (없으면 마감일 자정까지)
    title: $('p-title').value.trim(),
    target: $('p-target').value.trim(),
    startDate: start,
    endDate: end,
    startTime: st,
    endTime: et,
    period: fmtPeriodKo(start, end, st, et),
    place: $('p-place').value.trim(),
    content: $('p-content').value.trim(),
    deadline: $('p-deadline').value,
    capacity: Number($('p-capacity').value),
    loginOnly: $('p-loginonly').checked,
    courses: [...pickedCourses('p'), ...extra]
  };
  if (!data.courses.length){ alert('개설 강좌를 1개 이상 선택해주세요.'); return; }
  try {
    if (idVal){
      const before = programs.find(x => x.id === idVal) || {};
      await updateDoc(doc(db, 'programs', idVal), data);
      toast('프로그램을 수정했습니다.');
      await syncApplications(idVal, before, data);
    } else {
      await addDoc(collection(db, 'programs'), {
        ...data,
        applied: Number($('p-applied').value) || 0,
        open: true,
        createdAt: serverTimestamp()
      });
      toast('프로그램을 등록했습니다.');
    }
    resetProgramForm();
  } catch (err) { alert(fbError(err)); }
});
/* ---------- v11: 프로그램 수정 → 신청 문서 동기화 ----------
   신청 문서는 접수 시점의 programTitle/course를 그대로 갖고 있습니다.
   화면 표시는 progTitle()이 항상 최신 이름을 따르지만, 신청 문서 자체도 맞춰두어야
   마이페이지·이수증·CSV 등 다른 경로에서도 어긋나지 않습니다. */
async function syncApplications(programId, before, after){
  const mine = applications.filter(a => a.programId === programId);
  if (!mine.length) return;

  const patch = {};
  if (before.title !== after.title) patch.programTitle = after.title;
  if (before.type  !== after.type)  patch.programType  = after.type;
  if (before.wsKind !== after.wsKind) patch.programWsKind = after.wsKind || null;

  /* 강좌 이름이 바뀐 경우: 정확히 1개가 빠지고 1개가 새로 생겼다면 '이름 변경'으로 보고 확인 */
  const oldC = Array.isArray(before.courses) ? before.courses : [];
  const newC = Array.isArray(after.courses)  ? after.courses  : [];
  const removed = oldC.filter(c => !newC.includes(c));
  const added   = newC.filter(c => !oldC.includes(c));
  let rename = null;

  if (removed.length){
    const affected = c => mine.filter(a => (a.course || a.session) === c).length;
    if (removed.length === 1 && added.length === 1 && affected(removed[0])){
      if (confirm(`강좌명이 바뀐 것으로 보입니다.\n\n  이전: ${removed[0]}\n  현재: ${added[0]}\n\n` +
                  `이 강좌를 신청한 ${affected(removed[0])}건의 강좌명도 함께 변경할까요?\n` +
                  `[취소]를 누르면 기존 신청 내역은 그대로 유지됩니다.`)){
        rename = { from: removed[0], to: added[0] };
      }
    } else {
      const lines = removed.map(c => `  · ${c} — 신청 ${affected(c)}건`).filter(l => !l.endsWith('0건'));
      if (lines.length){
        alert(`개설 강좌에서 빠진 항목 중 신청 내역이 있는 강좌가 있습니다.\n\n${lines.join('\n')}\n\n` +
              `신청 내역은 그대로 유지되며, 명단에 ⚠️ 표시가 붙습니다.\n` +
              `필요하면 각 신청건의 [✏️ 수정]에서 강좌를 다시 지정해주세요.`);
      }
    }
  }

  if (!Object.keys(patch).length && !rename) return;

  let n = 0;
  for (const a of mine){
    const p = { ...patch };
    if (rename && (a.course || a.session) === rename.from) p.course = rename.to;
    if (!Object.keys(p).length) continue;
    try { await updateDoc(doc(db, 'applications', a.id), p); n++; } catch (err) { console.error(err); }
  }
  if (n) toast(`신청 내역 ${n}건을 함께 업데이트했습니다.`);
}

function editProgram(id){
  const p = programs.find(x => x.id === id);
  if (!p) return;
  /* v10: 강사 모집 공고는 [강사 배정] 탭의 전용 폼에서 수정합니다 */
  if (p.type === 'recruit'){ editRecruit(id); return; }
  switchTab('program');
  $('p-id').value = p.id;
  /* v19: 유형은 숨은 필드로 유지합니다 — 이 폼은 강사 워크샵 전용이지만
     기존 camp 프로그램을 수정해도 유형이 workshop으로 바뀌지 않도록 원래 값을 보존합니다 */
  $('p-type').value = p.type || 'workshop';
  /* 구버전 데이터는 wsKind가 없으므로 제목으로 추정해 채웁니다 */
  $('p-wskind').value = p.wsKind || (/미니|mini|교구/i.test(p.title || '') ? 'mini' : 'regular');
  $('p-title').value = p.title;
  $('p-open').value = p.openDate || '';
  $('p-openTime').value = p.openTime || '';
  $('p-deadlineTime').value = p.deadlineTime || '';
  $('p-target').value = p.target || WORKSHOP_TARGET;
  $('p-start').value = p.startDate || '';
  $('p-end').value   = p.endDate || '';
  $('p-startTime').value = p.startTime || '';
  $('p-endTime').value   = p.endTime || '';
  $('p-place').value = p.place;
  $('p-content').value = p.content;
  $('p-deadline').value = p.deadline;
  $('p-capacity').value = p.capacity;
  $('p-loginonly').checked = !!p.loginOnly;
  setPickedCourses('p', Array.isArray(p.courses) ? p.courses : []);
  /* 구버전 데이터: startDate/endDate 없이 period 문자열만 있는 경우 안내 */
  if (!p.startDate && p.period) toast(`이전 형식의 운영 기간(${p.period})입니다. 날짜를 다시 선택해주세요.`, 'warn');
  $('p-applied').value = p.applied || 0;
  $('p-applied').disabled = true; // 신청 인원은 접수와 함께 자동 관리
  $('pFormTitle').textContent = '✏️ 워크샵 수정 — ' + p.title;
  $('pFormSubmit').textContent = '수정 저장';
  setTimeout(() => $('programForm').scrollIntoView({behavior:'smooth', block:'center'}), 120);
}
function resetProgramForm(){
  $('programForm').reset();
  $('p-id').value = '';
  $('p-type').value = 'workshop';
  $('p-applied').value = 0;
  $('p-applied').disabled = false;
  $('p-target').value = WORKSHOP_TARGET;   // 기본 대상 문구 복원
  setPickedCourses('p', []);
  $('p-courseExtra').value = '';
  $('pFormTitle').textContent = '📌 새 강사 워크샵 등록';
  $('pFormSubmit').textContent = '워크샵 등록';
}
async function deleteProgram(id){
  const p = programs.find(x => x.id === id);
  if (!p || !confirm(`'${p.title}' 프로그램을 삭제할까요?\n관련 신청 내역도 함께 삭제됩니다.`)) return;
  try {
    const snap = await getDocs(query(collection(db, 'applications'), where('programId', '==', id)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'programs', id));
    toast('프로그램을 삭제했습니다.');
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
    const notYet = !closed && notYetOpen(p);
    const mini = p.type === 'workshop' && (p.wsKind === 'mini' || (!p.wsKind && /미니|mini|교구/i.test(p.title || '')));
    return `<tr>
      <td><span class="chip ${p.type}">${KIND[p.type] || ''}</span>
        ${mini ? '<span class="chip minik" title="온라인 워크샵 병행 이수 필요">미니</span>' : ''}
        ${p.loginOnly ? '<span class="chip lock" title="로그인 회원만 신청 가능">🔐</span>' : ''}</td>
      <td><b>${esc(p.title)}</b></td>
      <td>${esc(p.deadline)}${p.deadlineTime ? ` ${esc(p.deadlineTime)}` : ''}${p.openDate ? `<br><span class="cell-sub">시작 ${esc(p.openDate)}${p.openTime ? ` ${esc(p.openTime)}` : ''}</span>` : ''}</td>
      <td>${p.applied || 0} / ${p.capacity}</td>
      <td><span class="chip ${closed ? 'close' : 'open'}">${closed ? '마감' : (notYet ? '접수예정' : '접수중')}</span></td>
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
  const idVal = $('n-id').value;
  try {
    if (idVal){
      await updateDoc(doc(db, 'notices', idVal), {
        cat: $('n-cat').value,
        title: $('n-title').value.trim(),
        body: bodyHtml,
        pinned: $('n-pinned').checked
      });
      toast('공지를 수정했습니다.');
    } else {
      await addDoc(collection(db, 'notices'), {
        cat: $('n-cat').value,
        title: $('n-title').value.trim(),
        author: '사업단',
        date: todayStr(),
        views: 0,
        pinned: $('n-pinned').checked,
        body: bodyHtml,
        createdAt: serverTimestamp()
      });
      toast('공지를 등록했습니다.');
    }
    resetNoticeForm();
  } catch (err) { alert(fbError(err)); }
});
function editNotice(id){
  const n = notices.find(x => x.id === id);
  if (!n) return;
  switchTab('notice');
  $('n-id').value = n.id;
  $('n-cat').value = n.cat;
  $('n-title').value = n.title;
  $('n-body').value = String(n.body || '')
    .replace(/<\/p><p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
  $('n-pinned').checked = !!n.pinned;
  $('nFormTitle').textContent = '✏️ 공지 수정 — ' + n.title;
  $('nFormSubmit').textContent = '수정 저장';
  setTimeout(() => $('noticeForm').scrollIntoView({behavior:'smooth', block:'center'}), 120);
}
function resetNoticeForm(){
  $('noticeForm').reset();
  $('n-id').value = '';
  $('nFormTitle').textContent = '📢 공지사항 작성';
  $('nFormSubmit').textContent = '공지 등록';
}
async function togglePin(id){
  const n = notices.find(x => x.id === id);
  if (!n) return;
  try { await updateDoc(doc(db, 'notices', id), { pinned: !n.pinned }); }
  catch (err) { alert(fbError(err)); }
}
async function deleteNotice(id){
  const n = notices.find(x => x.id === id);
  if (!n || !confirm(`'${n.title}' 공지를 삭제할까요?`)) return;
  try { await deleteDoc(doc(db, 'notices', id)); toast('공지를 삭제했습니다.'); }
  catch (err) { alert(fbError(err)); }
}
function renderNoticeAdmin(){
  const tb = $('noticeAdminBody');
  if (!notices.length){
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6A776F;">등록된 공지가 없습니다.</td></tr>';
    return;
  }
  const sorted = [...notices.filter(n => n.pinned), ...notices.filter(n => !n.pinned)];
  tb.innerHTML = sorted.map(n => `<tr class="${n.pinned ? 'pinned' : ''}">
    <td>${n.pinned ? '📌' : '-'}</td>
    <td><span class="notice-cat ${catClass(n.cat)}">${esc(n.cat)}</span></td>
    <td><b>${esc(n.title)}</b></td>
    <td>${esc(n.date)}</td>
    <td>${n.views || 0}</td>
    <td><div class="t-actions">
      <a class="mini-btn" href="notice.html?id=${n.id}" target="_blank" rel="noopener">보기</a>
      <button class="mini-btn" onclick="editNotice('${n.id}')">수정</button>
      <button class="mini-btn" onclick="togglePin('${n.id}')">${n.pinned ? '고정해제' : '고정'}</button>
      <button class="mini-btn danger" onclick="deleteNotice('${n.id}')">삭제</button>
    </div></td>
  </tr>`).join('');
}
Object.assign(window, { deleteNotice, editNotice, resetNoticeForm, togglePin });

/* ==================== 신청자: 구독 ==================== */
function subscribeApplications(){
  if (unsubApplications) return;
  unsubApplications = onSnapshot(
    query(collection(db, 'applications'), orderBy('createdAt', 'desc')),
    snap => {
      applications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // 삭제된 문서는 선택 목록에서 제거
      const ids = new Set(applications.map(a => a.id));
      selected.forEach(id => { if (!ids.has(id)) selected.delete(id); });
      refreshFilterOptions();
      renderApplicants();
      renderDashboard();
      if ($('tab-assign').classList.contains('on')) renderAssign();
    },
    err => console.error('applications 구독 오류:', err)
  );
}

/* ==================== 신청자: 필터 ==================== */
function refreshFilterOptions(){
  const keep = (sel, values) => {
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체</option>' +
      values.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  };
  keep($('f-program'), [...new Set(applications.map(a => progTitle(a)).filter(Boolean))]);
  keep($('f-course'),  [...new Set(applications.map(a => a.course || a.session).filter(Boolean))]);
  keep($('f-orgtype'), [...new Set([...ORG_TYPES, ...applications.map(a => a.orgType).filter(Boolean)])]);
}

['f-program','f-course','f-orgtype','f-status','f-astatus','f-member'].forEach(id => {
  $(id).addEventListener('change', () => { page = 1; renderApplicants(); });
});
let qTimer = null;
$('f-q').addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { page = 1; renderApplicants(); }, 200);
});
function resetFilters(){
  ['f-program','f-course','f-orgtype','f-status','f-astatus','f-member'].forEach(id => $(id).value = '');
  $('f-q').value = '';
  page = 1;
  renderApplicants();
}
window.resetFilters = resetFilters;

/* ---------- v10: 신청건 → 프로그램 일정 조회 ----------
   applications 문서에는 programId가 저장되어 있으므로
   programs 컬렉션에서 운영 기간·장소를 찾아 함께 보여줍니다. */
function progOf(a){
  if (!a) return null;
  return programs.find(p => p.id === a.programId)
      || programs.find(p => p.title === a.programTitle)
      || null;
}
/** 운영 기간 (없으면 신청건에 저장된 값 → '-') */
function progPeriod(a){
  const p = progOf(a);
  return (p && p.period) || a.programPeriod || '';
}
/** 운영 장소 */
function progPlace(a){
  const p = progOf(a);
  return (p && p.place) || a.programPlace || '';
}
/** v11: 화면에 쓸 프로그램명.
    신청 문서의 programTitle은 '접수 시점 스냅샷'이라 프로그램을 수정해도 그대로입니다.
    표시할 때는 항상 programs에서 현재 이름을 가져와 자동으로 최신 상태를 따릅니다. */
function progTitle(a){
  const p = progOf(a);
  return (p && p.title) || a.programTitle || '';
}
/** v11: 현재 프로그램의 개설 강좌 목록에 없는(삭제·변경된) 강좌인지 */
function courseIsOrphan(a){
  const p = progOf(a);
  const c = a.course || a.session || '';
  if (!p || !Array.isArray(p.courses) || !p.courses.length || !c) return false;
  return !p.courses.includes(c);
}

function filteredApps(){
  const q = $('f-q').value.trim().toLowerCase();
  const fp = $('f-program').value, fc = $('f-course').value;
  const fo = $('f-orgtype').value, fs = $('f-status').value, fm = $('f-member').value;
  const fa = $('f-astatus').value;

  let list = applications.filter(a => {
    if (fp && progTitle(a) !== fp) return false;
    if (fc && (a.course || a.session) !== fc) return false;
    if (fo && a.orgType !== fo) return false;
    if (fs === 'done' && !a.completed) return false;
    if (fs === 'wait' && a.completed) return false;
    if (fa && statusOf(a) !== fa) return false;
    if (fm === 'linked' && !a.uid) return false;
    if (fm === 'guest' && a.uid) return false;
    if (q){
      const hay = [a.name, a.org, a.email, a.phone, a.id, progTitle(a), a.programTitle,
                   a.course || a.session, a.orgType, a.certNo, a.memo,
                   a.assignPlace, a.statusMemo, progPeriod(a), progPlace(a)]
        .map(v => String(v ?? '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const dir = sortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    let va, vb;
    if (sortKey === 'createdAt'){ va = tsNum(a.createdAt); vb = tsNum(b.createdAt); }
    else if (sortKey === 'completed'){ va = a.completed ? 1 : 0; vb = b.completed ? 1 : 0; }
    else if (sortKey === 'status'){
      va = STATUS_ORDER.indexOf(statusOf(a)); vb = STATUS_ORDER.indexOf(statusOf(b));
    }
    else if (sortKey === 'course'){ va = a.course || a.session || ''; vb = b.course || b.session || ''; }
    else if (sortKey === 'period'){ va = progPeriod(a); vb = progPeriod(b); }
    else { va = a[sortKey] ?? ''; vb = b[sortKey] ?? ''; }
    if (typeof va === 'string') return va.localeCompare(vb, 'ko') * dir;
    return (va - vb) * dir;
  });
  return list;
}

/* 정렬 헤더 클릭 */
document.querySelectorAll('.admin-table.sortable th.sort').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
    else { sortKey = key; sortDir = key === 'createdAt' ? 'desc' : 'asc'; }
    page = 1;
    renderApplicants();
  });
});

/* ==================== 신청자: 렌더 ==================== */
function renderApplicants(){
  const tb = $('applicantTableBody');
  const list = filteredApps();
  const total = applications.length;

  $('rc-filtered').textContent = list.length;
  $('rc-total').textContent = total;
  $('badgeApply').textContent = total;
  $('rc-selected').textContent = selected.size ? ` · 선택 ${selected.size}건` : '';

  document.querySelectorAll('.admin-table.sortable th.sort').forEach(th => {
    th.classList.toggle('asc',  sortKey === th.dataset.key && sortDir === 'asc');
    th.classList.toggle('desc', sortKey === th.dataset.key && sortDir === 'desc');
  });

  if (!list.length){
    tb.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#6A776F;">
      ${total ? '조건에 맞는 신청이 없습니다. 필터를 조정해보세요.' : '아직 접수된 신청이 없습니다.'}</td></tr>`;
    $('applyPager').innerHTML = '';
    return;
  }

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const rows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  tb.innerHTML = rows.map(a => `<tr class="row-click ${selected.has(a.id) ? 'row-sel' : ''}" data-app="${a.id}" title="클릭하면 신청 상세를 볼 수 있습니다">
    <td class="c-check"><input type="checkbox" data-id="${a.id}"
      ${selected.has(a.id) ? 'checked' : ''} onchange="toggleOne('${a.id}', this.checked)"></td>
    <td class="c-appinfo">
      <div class="ai-prog">${esc(progTitle(a)) || '-'}${a.programType === 'recruit' ? '<span class="chip recruit">모집</span>' : ''}${isMiniApp(a) ? '<span class="chip minik" title="온라인 워크샵 병행 이수 필요">미니</span>' : ''}</div>
      <div class="ai-sub">
        <span class="ai-when">🗓 ${progPeriod(a) ? esc(progPeriod(a)) : '일정 미등록'}</span>
        <span class="ai-got">접수 ${esc(tsText(a.createdAt))}</span>
      </div>
    </td>
    <td>${esc(a.course || a.session) || '-'}${courseIsOrphan(a)
      ? ' <span class="orphan-mark" title="현재 프로그램의 개설 강좌 목록에 없는 강좌입니다">⚠️</span>' : ''}</td>
    <td><b>${esc(a.name)}</b>${a.uid ? '<span class="chip member" title="회원 계정으로 신청">회원</span>' : ''}</td>
    <td>${esc(a.org)}</td>
    <td>${esc(a.orgType) || '-'}</td>
    <td class="nowrap"><span class="cell-sub">${esc(a.phone)}<br>${esc(a.email) || '-'}</span></td>
    <td>${statusChip(a)}${a.assignPlace ? `<br><span class="cell-sub">${esc(a.assignPlace)}</span>` : ''}</td>
    <td>${a.completed
      ? `<span class="status-chip done">수료</span><br><span class="cell-sub">${a.certNo
          ? esc(a.certNo)
          : (isMiniApp(a) ? '이수증 대기 — 온라인 이수 확인 중' : '')}</span>`
      : '<span class="status-chip wait">미수료</span>'}</td>
    <td class="c-act"><div class="t-actions">
      <button class="mini-btn" onclick="openAssign('${a.id}')">${a.programType === 'recruit' ? '배정/상태' : '승인/상태'}</button>
      <button class="mini-btn" onclick="openEditApp('${a.id}')">✏️ 수정</button>
      ${a.completed
        ? `${(!a.certNo && isMiniApp(a))
            ? `<button class="mini-btn" onclick="issueMiniCert('${a.id}')">🎓 이수증발급</button>`
            : `<a class="mini-btn" href="cert.html?id=${a.id}" target="_blank" rel="noopener">이수증</a>`}
           <button class="mini-btn" onclick="uncompleteApp('${a.id}')">수료취소</button>`
        : `<button class="mini-btn" onclick="completeApp('${a.id}')">수료처리</button>`}
      <button class="mini-btn danger" onclick="deleteApplicant('${a.id}')">삭제</button>
    </div></td>
  </tr>`).join('');

  $('chkAll').checked = rows.length > 0 && rows.every(a => selected.has(a.id));
  renderPager(pages, list.length);
}

function renderPager(pages, count){
  const box = $('applyPager');
  if (pages <= 1){
    box.innerHTML = `<span class="pager-info">${count}건 표시</span>`;
    return;
  }
  const btn = (p, label = p, cls = '') =>
    `<button class="pg ${cls} ${p === page ? 'on' : ''}" onclick="goPage(${p})">${label}</button>`;
  let html = btn(Math.max(1, page - 1), '‹', 'nav');
  const from = Math.max(1, page - 2), to = Math.min(pages, page + 2);
  if (from > 1) html += btn(1) + (from > 2 ? '<span class="pg-gap">…</span>' : '');
  for (let p = from; p <= to; p++) html += btn(p);
  if (to < pages) html += (to < pages - 1 ? '<span class="pg-gap">…</span>' : '') + btn(pages);
  html += btn(Math.min(pages, page + 1), '›', 'nav');
  box.innerHTML = html + `<span class="pager-info">${count}건 · ${page}/${pages} 페이지</span>`;
}
function goPage(p){ page = p; renderApplicants(); window.scrollTo({top: $('tab-apply').offsetTop - 20, behavior:'smooth'}); }
window.goPage = goPage;

/* ==================== 신청자: 선택 ==================== */
function toggleOne(id, on){
  if (on) selected.add(id); else selected.delete(id);
  $('rc-selected').textContent = selected.size ? ` · 선택 ${selected.size}건` : '';
  document.querySelector(`tr input[data-id="${id}"]`)?.closest('tr')?.classList.toggle('row-sel', on);
  const boxes = [...document.querySelectorAll('#applicantTableBody input[data-id]')];
  $('chkAll').checked = boxes.length > 0 && boxes.every(b => b.checked);
}
function toggleAll(on){
  document.querySelectorAll('#applicantTableBody input[data-id]').forEach(b => {
    b.checked = on;
    if (on) selected.add(b.dataset.id); else selected.delete(b.dataset.id);
    b.closest('tr').classList.toggle('row-sel', on);
  });
  $('rc-selected').textContent = selected.size ? ` · 선택 ${selected.size}건` : '';
}
Object.assign(window, { toggleOne, toggleAll });

/* ==================== v27: 홈 방문객 대시보드 수치 ==================== */
const VDASH_KEYS = ['students', 'instructors', 'visit', 'group', 'workshops', 'goal'];
async function loadVdashForm(){
  try {
    const s = await getDoc(doc(db, 'stats', 'public'));
    const d = s.exists() ? s.data() : {};
    VDASH_KEYS.forEach(k => {
      const el = $('vd-' + k);
      if (el) el.value = d[k] ?? (k === 'goal' ? 4800 : 0);
    });
  } catch (e){ /* 최초에는 문서가 없을 수 있음 */ }
}
loadVdashForm();

$('vdashForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const data = {};
  VDASH_KEYS.forEach(k => data[k] = Number($('vd-' + k).value) || 0);
  if (!data.goal) data.goal = 4800;
  const btn = $('vdashSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    await setDoc(doc(db, 'stats', 'public'), { ...data, updatedAt: serverTimestamp() }, { merge: true });
    toast('홈 대시보드 수치를 저장했습니다.');
  } catch (err){ alert(fbError(err)); }
  finally { btn.disabled = false; btn.textContent = '저장 — 홈에 바로 반영'; }
});

/* ==================== 신청자: 수료 처리 ==================== */
/** 발급번호 채번 + 수료 표시 (단건) */
async function issueCert(id){
  const year = new Date().getFullYear();
  let certNo = '';
  await runTransaction(db, async t => {
    const cRef = doc(db, 'counters', 'certificates');
    const cSnap = await t.get(cRef);
    const seq = (cSnap.exists() ? (cSnap.data().seq || 0) : 0) + 1;
    certNo = `한신새싹 제 ${year}-${String(seq).padStart(4, '0')} 호`;
    t.set(cRef, { seq, year });
    t.update(doc(db, 'applications', id), {
      completed: true,
      completedAt: serverTimestamp(),
      certNo
    });
  });
  return certNo;
}
/** 수료 안내 메일 (템플릿 미설정 시 자동 생략) */
async function notifyCert(a, certNo){
  if (!certEmailEnabled() || !a.email) return;
  const base = location.href.replace(/admin\.html.*$/, '');
  await sendCertificateEmail({
    to_email: a.email,
    name: a.name,
    program: progTitle(a) || '',
    course: a.course || a.session || '',
    cert_no: certNo,
    cert_url: `${base}cert.html?id=${a.id}`,
    date: new Date().toLocaleDateString('ko-KR', { dateStyle: 'long' })
  });
}

/* ==================== v18: 미니(교구 사용법) 워크샵 온라인 이수 연동 ====================
   강사워크샵 미니·교구사용법 워크샵은 당일 참석만으로 수료되지 않고,
   신청 강좌에 대응하는 상시 온라인 워크샵 과목까지 이수해야 최종 수료증이 발급됩니다.
   수료 처리 전에 온라인 이수 상태를 확인하고, 미충족 건은 막거나(일괄) 예외 확인(개별)을 받습니다. */
function isMiniApp(a){
  /* v18: 프로그램의 워크샵 구분(wsKind)을 우선 사용, 구버전 데이터는 제목으로 추정 */
  const p = progOf(a);
  if (p && p.wsKind) return p.wsKind === 'mini';
  return /미니|mini|교구/i.test(`${progTitle(a)} ${a.programTitle || ''}`);
}

/** 대응 온라인 워크샵 이수 여부: 인정 과목 묶음 중 하나라도
    수료 처리됐거나 필수 차시 진도 100%면 충족
    (음악코딩은 기본·특수가 같은 교구를 쓰므로 두 과목 중 어느 쪽이든 인정) */
async function onlineDoneFor(a){
  const keys = acceptedOnlineKeys(a.course || a.session);
  const label = acceptedOnlineLabel(keys) || (a.course || '-');
  if (!keys.length) return { ok: false, why: '대응 온라인 과목을 찾지 못함 — 강좌명 확인 필요', label };

  let enrs = [];
  try {
    const by = a.uid
      ? query(collection(db, 'enrollments'), where('uid', '==', a.uid))
      : query(collection(db, 'enrollments'), where('email', '==', a.email || '-'));
    const snap = await getDocs(by);
    enrs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => keys.includes(e.courseKey));
  } catch (e){ return { ok: false, why: `온라인 수강 정보 조회 실패(${label})`, label }; }

  if (!enrs.length) return { ok: false, why: `온라인 워크샵 [${label}] 미신청`, label };
  if (enrs.some(e => e.completed)) return { ok: true, label };

  /* 수강 중인 과목들의 진도를 확인해 하나라도 100%면 충족, 아니면 최고 진도를 보고 */
  let best = null;
  for (const enr of enrs){
    try {
      const ls = await getDocs(collection(db, 'onlineCourses', enr.courseKey, 'lessons'));
      const lessons = ls.docs.map(d => ({ id: d.id, ...d.data() }));
      const req = lessons.filter(l => l.required !== false);
      if (!req.length) continue;
      const pr = await getDocs(collection(db, 'enrollments', enr.id, 'progress'));
      const prog = Object.fromEntries(pr.docs.map(d => [d.id, d.data()]));
      const done = l => {
        const q = prog[l.id];
        /* v24: 오프라인(교구 실습) 차시는 미니 워크샵 수료(참석 인정)로 갈음됩니다 */
        if (l.mode === 'offline') return !!(q && q.done) || !!a.completed;
        if (!q) return false;
        if (q.done) return true;
        return !!l.durationSec && (q.watchedSec || 0) >= l.durationSec * 0.9;
      };
      const doneN = req.filter(done).length;
      if (doneN >= req.length) return { ok: true, label };
      const cname = courseByKey(enr.courseKey)?.name.split(':')[0] || enr.courseKey;
      if (!best || doneN / req.length > best.rate){
        best = { rate: doneN / req.length, text: `온라인 워크샵 [${cname}] 진도 ${doneN}/${req.length}차시` };
      }
    } catch (e){ /* 개별 과목 확인 실패는 다음 과목으로 */ }
  }
  return best
    ? { ok: false, why: best.text, label }
    : { ok: false, why: `온라인 워크샵 [${label}] 차시 미등록 또는 진도 확인 실패`, label };
}

async function completeApp(id){
  const a = applications.find(x => x.id === id);
  if (!a) return;

  /* v20: 미니(교구 사용법) 워크샵의 수료 처리는 '참석 인정'만 기록합니다.
     이수증 발급번호는 온라인 워크샵 이수가 확인된 뒤 [이수증발급]에서 채번합니다. */
  if (isMiniApp(a)){
    if (!confirm(`${a.name}님 (${progTitle(a)} · ${a.course || ''})\n` +
      `미니 워크샵 수료(참석 인정) 처리할까요?\n\n` +
      `이수증은 대응 온라인 워크샵 이수가 확인된 뒤 [🎓 이수증발급] 버튼으로 발급됩니다.`)) return;
    try {
      await updateDoc(doc(db, 'applications', id), {
        completed: true, completedAt: serverTimestamp()
      });
      const chk = await onlineDoneFor(a);
      if (chk.ok && confirm('온라인 워크샵 이수도 이미 확인되었습니다.\n이수증을 바로 발급할까요?')){
        const certNo = await issueCert(id);
        await notifyCert(a, certNo).catch(() => {});
        toast(`수료 + 이수증 발급 완료 · ${certNo}`);
      } else {
        toast('미니 워크샵 수료 처리 완료 — 이수증은 온라인 이수 확인 후 발급하세요.');
      }
    } catch (err) { alert(fbError(err)); }
    return;
  }

  if (!confirm(`${a.name}님 (${progTitle(a)} · ${a.course || ''})\n수료 처리하고 이수증 발급번호를 채번할까요?`)) return;
  try {
    const certNo = await issueCert(id);
    await notifyCert(a, certNo);
    toast(`수료 처리 완료 · ${certNo}`);
  } catch (err) { alert(fbError(err)); }
}

/** v20: 미니 워크샵 이수증 발급 — 온라인 이수 확인 후 발급번호 채번 */
async function issueMiniCert(id){
  const a = applications.find(x => x.id === id);
  if (!a) return;
  const chk = await onlineDoneFor(a);
  if (!chk.ok && !confirm(`⚠️ 온라인 워크샵 이수가 아직 확인되지 않았습니다.\n\n` +
      `${a.name}님 현재 상태: ${chk.why}\n\n그래도 예외로 이수증을 발급할까요?`)) return;
  if (!confirm(`${a.name}님에게 이수증 발급번호를 채번할까요?`)) return;
  try {
    const certNo = await issueCert(id);
    await notifyCert(a, certNo).catch(() => {});
    toast(`이수증 발급 완료 · ${certNo}`);
  } catch (err) { alert(fbError(err)); }
}
window.issueMiniCert = issueMiniCert;
async function uncompleteApp(id){
  const a = applications.find(x => x.id === id);
  if (!a || !confirm(`${a.name}님의 수료 처리를 취소할까요?\n발급번호(${a.certNo || '-'})는 회수되며, 기발급 이수증은 무효 처리해야 합니다.`)) return;
  try {
    await updateDoc(doc(db, 'applications', id), {
      completed: false, completedAt: deleteField(), certNo: deleteField()
    });
    toast('수료 처리를 취소했습니다.');
  } catch (err) { alert(fbError(err)); }
}
async function deleteApplicant(id){
  const a = applications.find(x => x.id === id);
  if (!a || !confirm('이 신청 내역을 삭제할까요?')) return;
  try {
    await deleteDoc(doc(db, 'applications', id));
    if (a.programId){
      await updateDoc(doc(db, 'programs', a.programId), { applied: increment(-1) }).catch(()=>{});
    }
    toast('신청 내역을 삭제했습니다.');
  } catch (err) { alert(fbError(err)); }
}

/* ==================== v21: 현장 접수 등록 ====================
   홈페이지 신청 없이 워크샵 현장에서 접수한 분을 관리자가 직접 등록합니다.
   등록 즉시 승인완료 상태가 되어 명단·서명부·수료 처리에 포함됩니다. */
function openWalkIn(){
  const sel = $('wi-program');
  const list = programs.filter(p => p.type !== 'recruit');
  if (!list.length){ alert('등록된 워크샵 프로그램이 없습니다. 프로그램 탭에서 먼저 등록해주세요.'); return; }
  $('walkInForm').reset();
  $('wiError').style.display = 'none';
  $('wi-uid').value = '';
  $('wi-linked').style.display = 'none';
  $('wi-results').style.display = 'none';
  $('wi-results').innerHTML = '';
  sel.innerHTML = '<option value="">프로그램을 선택하세요</option>' +
    list.map(p => `<option value="${p.id}">${esc(p.title)}${p.period ? ` · ${esc(p.period)}` : ''}</option>`).join('');
  $('wi-course').innerHTML = '<option value="">프로그램을 먼저 선택하세요</option>';
  $('wi-orgtype').innerHTML = '<option value="">선택</option>' +
    ORG_TYPES.map(t => `<option>${esc(t)}</option>`).join('');
  if (!membersLoaded) loadMembers();   // 회원 검색을 위해 백그라운드 로드
  openModal('walkInModal');
}
window.openWalkIn = openWalkIn;

/* v21.1: 회원·이전 신청자 검색 → 클릭하면 입력 칸 자동 채움 (회원이면 계정 연결) */
let wiHits = [];
function wiSearch(){
  const q = $('wi-search').value.trim().toLowerCase();
  const box = $('wi-results');
  if (q.length < 2){ box.style.display = 'none'; box.innerHTML = ''; return; }

  const hits = [], seen = new Set();
  if (membersLoaded){
    members.forEach(m => {
      const hay = [m.name, m.email, m.phone, m.org, m.school, m.childSchool]
        .map(v => String(v ?? '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return;
      seen.add('u' + m.uid);
      hits.push({ kind: '회원', name: m.name || '', org: m.org || m.school || m.childSchool || '',
        orgType: m.orgType || '', phone: m.phone || '', email: m.email || '', uid: m.uid });
    });
  }
  applications.forEach(a => {
    const hay = [a.name, a.email, a.phone, a.org]
      .map(v => String(v ?? '').toLowerCase()).join(' ');
    if (!hay.includes(q)) return;
    if (a.uid && seen.has('u' + a.uid)) return;                     // 회원으로 이미 표시됨
    if (a.email && hits.some(h => h.email === a.email)) return;     // 같은 이메일 중복 제거
    const k = `${a.email}|${a.phone}|${a.name}`;
    if (seen.has(k)) return; seen.add(k);
    hits.push({ kind: '신청 이력', name: a.name || '', org: a.org || '', orgType: a.orgType || '',
      phone: a.phone || '', email: a.email || '', uid: a.uid || '', last: progTitle(a) });
  });

  wiHits = hits.slice(0, 8);
  box.innerHTML = wiHits.length
    ? wiHits.map((h, i) => `<div class="wi-hit" data-wi="${i}">
        <span class="chip ${h.kind === '회원' ? 'member' : 'workshop'}">${h.kind}</span>
        <b>${esc(h.name)}</b>
        <span class="cell-sub">${esc(h.org || '-')} · ${esc(h.email || h.phone || '-')}${h.last ? ` · ${esc(h.last)}` : ''}</span>
      </div>`).join('')
    : `<div class="wi-hit" style="cursor:default;color:#8A968E;">검색 결과가 없습니다${membersLoaded ? '' : ' (회원 명단 불러오는 중…)'}</div>`;
  box.style.display = 'block';
  box.querySelectorAll('[data-wi]').forEach(el =>
    el.addEventListener('click', () => wiPick(wiHits[Number(el.dataset.wi)])));
}
function wiPick(h){
  $('wi-name').value = h.name;
  $('wi-org').value = h.org;
  $('wi-orgtype').value = h.orgType || '';
  $('wi-phone').value = h.phone;
  $('wi-email').value = h.email;
  $('wi-uid').value = h.uid || '';
  $('wi-search').value = '';
  $('wi-results').style.display = 'none';
  const l = $('wi-linked');
  l.style.display = 'block';
  l.innerHTML = h.uid
    ? `✅ <b>${esc(h.name)}</b>님의 회원 계정과 연결되어 등록됩니다 — 마이페이지에 자동 표시`
    : `✅ 이전 신청 정보(<b>${esc(h.name)}</b>)를 불러왔습니다`;
}
$('wi-search').addEventListener('input', wiSearch);

$('wi-program').addEventListener('change', () => {
  const p = programs.find(x => x.id === $('wi-program').value);
  const courses = p && Array.isArray(p.courses) && p.courses.length ? p.courses : [];
  $('wi-course').innerHTML = courses.length
    ? '<option value="">강좌를 선택하세요</option>' + courses.map(c => `<option>${esc(c)}</option>`).join('')
    : '<option value="">개설 강좌가 없습니다</option>';
});

$('walkInForm').addEventListener('submit', async e => {
  e.preventDefault();
  const p = programs.find(x => x.id === $('wi-program').value);
  const err = $('wiError');
  err.style.display = 'none';
  if (!p){ err.textContent = '프로그램을 선택해주세요.'; err.style.display = 'block'; return; }
  if (!$('wi-course').value){ err.textContent = '강좌를 선택해주세요.'; err.style.display = 'block'; return; }
  const btn = $('wiSaveBtn');
  btn.disabled = true; btn.textContent = '등록 중…';
  try {
    await addDoc(collection(db, 'applications'), {
      programId: p.id,
      programTitle: p.title,
      programType: p.type,
      programWsKind: p.wsKind || null,
      course: $('wi-course').value,
      name: $('wi-name').value.trim(),
      org: $('wi-org').value.trim(),
      orgType: $('wi-orgtype').value,
      phone: $('wi-phone').value.trim(),
      email: $('wi-email').value.trim(),
      memo: $('wi-memo').value.trim(),
      uid: $('wi-uid').value || null,   // 회원 불러오기로 연결된 경우 계정에 귀속
      applicantRole: null,
      status: 'assigned',            // 현장 참석 확정이므로 승인완료로 등록
      statusMemo: '현장 접수',
      walkIn: true,
      completed: false,
      createdAt: serverTimestamp(),
      statusAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'programs', p.id), { applied: increment(1) }).catch(() => {});

    /* v23: 미니 워크샵 현장 접수가 회원과 연결된 경우 온라인 수강도 자동 등록 */
    const wiUid = $('wi-uid').value;
    const isMiniP = p.wsKind === 'mini' || (!p.wsKind && /미니|mini|교구/i.test(p.title || ''));
    if (wiUid && isMiniP){
      try {
        const key = guessCourseKey($('wi-course').value);
        if (key){
          const es = await getDocs(query(collection(db, 'enrollments'), where('uid', '==', wiUid)));
          const mine = es.docs.map(d => d.data().courseKey);
          if (!acceptedOnlineKeys($('wi-course').value).some(k => mine.includes(k))){
            await addDoc(collection(db, 'enrollments'), {
              uid: wiUid,
              name: $('wi-name').value.trim(), email: $('wi-email').value.trim(),
              phone: $('wi-phone').value.trim(), org: $('wi-org').value.trim(),
              orgType: $('wi-orgtype').value,
              courseKey: key,
              courseName: courseByKey(key)?.name || $('wi-course').value,
              completed: false,
              createdAt: serverTimestamp()
            });
            toast('현장 접수 등록 + 온라인 수강 연동 완료');
          }
        }
      } catch (e){ /* 연동 실패해도 접수 등록은 유지 */ }
    }
    toast(`현장 접수를 등록했습니다 — ${$('wi-name').value.trim()}`);
    closeModal('walkInModal');
  } catch (e2){
    err.textContent = fbError(e2); err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '등록';
  }
});

/* ==================== 신청자: 일괄 처리 ==================== */
function pickSelected(){
  const list = applications.filter(a => selected.has(a.id));
  if (!list.length) alert('먼저 표에서 대상을 선택해주세요.');
  return list;
}
async function bulkComplete(){
  const list = pickSelected().filter(a => !a.completed);
  if (!list.length){ if (selected.size) alert('선택된 항목이 모두 이미 수료 처리되어 있습니다.'); return; }

  /* v20: 미니는 참석 인정만(발급번호 없음), 정규는 수료+발급번호 채번 */
  const minis = list.filter(isMiniApp);
  const regs  = list.filter(a => !isMiniApp(a));
  const mailNote = certEmailEnabled() && regs.length ? '\n(정규 건은 수료 안내 메일도 함께 발송됩니다.)' : '';
  if (!confirm(`선택한 ${list.length}명을 일괄 수료 처리할까요?` +
    (regs.length ? `\n· 정규 ${regs.length}건 — 이수증 발급번호 즉시 채번` : '') +
    (minis.length ? `\n· 미니 ${minis.length}건 — 참석 인정만, 이수증은 온라인 이수 확인 후 [🎓 미니 이수증 발급]으로` : '') +
    mailNote)) return;

  let ok = 0, fail = 0;
  for (const a of regs){
    try {
      const certNo = await issueCert(a.id);
      await notifyCert(a, certNo).catch(()=>{});
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  for (const a of minis){
    try {
      await updateDoc(doc(db, 'applications', a.id), {
        completed: true, completedAt: serverTimestamp()
      });
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  selected.clear();
  toast(`일괄 수료 처리 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
}

/* ==================== v23: 미니 신청자 → 온라인 수강 일괄 연동 ====================
   미니 워크샵 신청자는 온라인 워크샵도 이수해야 하므로, 선택한 신청자를
   대응 온라인 과목 수강(enrollments)에 자동 등록합니다.
   강의실 이용에 계정이 필요하므로 회원(uid 연결 또는 이메일이 회원과 일치)만 등록됩니다. */
async function bulkLinkOnline(){
  const cand = pickSelected();
  if (!cand.length) return;
  if (!membersLoaded){
    toast('회원 명단을 불러오는 중입니다…');
    await loadMembers();
  }

  /* 중복 방지용: 전체 수강 등록의 uid|courseKey 집합 */
  let existing = new Set();
  try {
    const snap = await getDocs(collection(db, 'enrollments'));
    snap.docs.forEach(d => existing.add(`${d.data().uid}|${d.data().courseKey}`));
  } catch (err){ alert(fbError(err)); return; }

  const todo = [], skipped = [];
  for (const a of cand){
    if (!isMiniApp(a)){ skipped.push(`· ${a.name} — 미니 워크샵 신청이 아님`); continue; }
    const key = guessCourseKey(a.course || a.session);
    if (!key){ skipped.push(`· ${a.name} — 온라인 과목 매칭 실패(강좌명 확인)`); continue; }
    const uid = a.uid || members.find(m => a.email && m.email === a.email)?.uid || '';
    if (!uid){ skipped.push(`· ${a.name} — 회원 아님(가입 후 다시 연동 가능)`); continue; }
    const dup = acceptedOnlineKeys(a.course || a.session).some(k => existing.has(`${uid}|${k}`));
    if (dup){ skipped.push(`· ${a.name} — 이미 온라인 수강 중`); continue; }
    existing.add(`${uid}|${key}`);
    todo.push({ a, uid, key });
  }

  if (skipped.length){
    alert(`연동에서 제외되는 ${skipped.length}건:\n\n${skipped.join('\n')}`);
  }
  if (!todo.length){ if (!skipped.length) alert('연동할 대상이 없습니다.'); return; }
  if (!confirm(`${todo.length}명을 대응 온라인 워크샵 수강에 등록할까요?\n` +
    `등록 즉시 각자의 마이페이지 내 강의실에 과목이 나타나고, 학습 현황에도 표시됩니다.`)) return;

  let ok = 0, fail = 0;
  for (const { a, uid, key } of todo){
    try {
      await addDoc(collection(db, 'enrollments'), {
        uid,
        name: a.name || '', email: a.email || '', phone: a.phone || '',
        org: a.org || '', orgType: a.orgType || '',
        courseKey: key,
        courseName: courseByKey(key)?.name || a.course || '',
        completed: false,
        createdAt: serverTimestamp(),
        linkedFrom: a.id
      });
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  selected.clear();
  toast(`온라인 수강 연동 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
  if ($('cl-progressBox').style.display !== 'none') loadClassProgress().catch(() => {});
}
window.bulkLinkOnline = bulkLinkOnline;

/** v20: 선택한 미니 수료 건 중 온라인 이수가 확인된 건만 이수증 일괄 발급 */
async function bulkIssueMiniCerts(){
  const cand = pickSelected().filter(a => a.completed && !a.certNo && isMiniApp(a));
  if (!cand.length){
    if (selected.size) alert('선택된 항목 중 이수증 발급 대기 상태인 미니 워크샵 수료 건이 없습니다.\n(미니 수료 처리 후 발급번호가 없는 건이 대상입니다)');
    return;
  }
  const ready = [], waiting = [];
  for (const a of cand){
    const chk = await onlineDoneFor(a);
    if (chk.ok) ready.push(a);
    else waiting.push(`· ${a.name} — ${chk.why}`);
  }
  if (waiting.length){
    alert(`온라인 이수가 확인되지 않아 제외되는 건 ${waiting.length}건:\n\n${waiting.join('\n')}\n\n(예외 발급은 해당 건의 [🎓 이수증발급] 버튼으로 개별 진행)`);
  }
  if (!ready.length) return;
  if (!confirm(`온라인 이수가 확인된 ${ready.length}건에 이수증 발급번호를 채번할까요?`)) return;
  let ok = 0, fail = 0;
  for (const a of ready){
    try {
      const certNo = await issueCert(a.id);
      await notifyCert(a, certNo).catch(()=>{});
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  selected.clear();
  toast(`미니 이수증 발급 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
}
window.bulkIssueMiniCerts = bulkIssueMiniCerts;
async function bulkUncomplete(){
  const list = pickSelected().filter(a => a.completed);
  if (!list.length){ if (selected.size) alert('선택된 항목 중 수료 처리된 건이 없습니다.'); return; }
  if (!confirm(`선택한 ${list.length}건의 수료 처리를 취소할까요?\n발급번호가 회수되며, 기발급 이수증은 무효 처리해야 합니다.`)) return;
  let ok = 0, fail = 0;
  for (const a of list){
    try {
      await updateDoc(doc(db, 'applications', a.id), {
        completed: false, completedAt: deleteField(), certNo: deleteField()
      });
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  selected.clear();
  toast(`수료 취소 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
}
async function bulkDelete(){
  const list = pickSelected();
  if (!list.length) return;
  if (!confirm(`선택한 ${list.length}건의 신청 내역을 삭제할까요?\n되돌릴 수 없습니다.`)) return;
  if (!confirm('한 번 더 확인합니다. 정말 삭제하시겠습니까?')) return;
  let ok = 0, fail = 0;
  const dec = {};
  for (const a of list){
    try {
      await deleteDoc(doc(db, 'applications', a.id));
      if (a.programId) dec[a.programId] = (dec[a.programId] || 0) + 1;
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  await Promise.all(Object.entries(dec).map(([pid, n]) =>
    updateDoc(doc(db, 'programs', pid), { applied: increment(-n) }).catch(()=>{})
  ));
  selected.clear();
  toast(`${ok}건 삭제 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
}
Object.assign(window, { deleteApplicant, completeApp, uncompleteApp, bulkComplete, bulkUncomplete, bulkDelete });

/* ==================== 진행 상태 · 배정 ==================== */
/** 상태/배정 정보 저장
    v10: 승인·배정 결과 안내 메일 자동 발송은 제거했습니다.
         (관리자가 CSV를 내려받아 직접 안내하는 방식) */
async function applyStatus(id, patch){
  const a = applications.find(x => x.id === id);
  if (!a) return;
  await updateDoc(doc(db, 'applications', id), { ...patch, statusAt: serverTimestamp() });
}

/* 현재 모달이 다루는 신청건 (모드 판별용) */
let asmCurrent = null;
/** true = 강사 배정 모드 / false = 신청 승인 모드 */
const asmIsAssignMode = () => isRecruit(asmCurrent);

function openAssign(id){
  const a = applications.find(x => x.id === id);
  if (!a) return;
  asmCurrent = a;
  const assignMode = isRecruit(a);
  const S = statusSet(a);

  $('asm-appId').value = id;
  $('asm-who').value = `${a.name} · ${a.org || '-'}`;
  $('asm-kind').textContent = KIND[a.programType] || '신청';
  $('asm-title').textContent = assignMode
    ? `${a.name} 님 배정 정보`
    : `${a.name} 님 신청 승인 처리`;

  /* 신청 요약 */
  $('asm-info').innerHTML = [
    ['프로그램', progTitle(a) || '-'],
    ['운영 기간', progPeriod(a) || '일정 미등록'],
    ['운영 장소', progPlace(a) || '-'],
    [assignMode ? '지원 분야' : '강좌', a.course || a.session || '-'],
    ['소속 유형', a.orgType || '-'],
    ['연락처', `${a.phone || '-'} · ${a.email || '-'}`],
    ['접수일시', tsText(a.createdAt)],
    ...(a.memo ? [['요청사항', a.memo]] : [])
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join('');

  /* 상태 셀렉트를 모드에 맞는 라벨로 다시 그림 */
  $('asm-status').innerHTML =
    STATUS_ORDER.map(k => `<option value="${k}">${S[k].label}</option>`).join('');
  $('asm-status').value = statusOf(a);
  $('asm-statusLabel').innerHTML = assignMode
    ? '진행 상태 <span class="req">*</span>'
    : '승인 상태 <span class="req">*</span>';

  /* 모드별 영역 토글 */
  $('asm-assignBlock').style.display = assignMode ? '' : 'none';
  $('asm-quickBlock').style.display  = assignMode ? 'none' : '';
  $('asmSaveBtn').textContent = assignMode ? '배정 정보 저장' : '승인 상태 저장';

  $('asm-place').value    = a.assignPlace || '';
  $('asm-period').value   = a.assignPeriod || '';
  $('asm-sessions').value = a.assignSessions ?? '';
  $('asm-hours').value    = a.assignHours ?? '';
  $('asm-memoLabel').innerHTML = assignMode
    ? '안내 메모 <span class="hint">(강사에게 전달됩니다)</span>'
    : '안내 · 반려 사유 <span class="hint">(신청자에게 그대로 전달됩니다)</span>';
  $('asm-memo').placeholder = assignMode
    ? '예) 9/1 오리엔테이션 참석 필수. 교구는 사업단에서 제공합니다.'
    : '예) 8/21(목) 10:00 한신대 AI·SW관 302호로 오시면 됩니다. 노트북 지참.';
  $('asm-memo').value = a.statusMemo || '';

  $('asm-noMail').textContent = assignMode
    ? '📄 배정 결과 메일은 자동 발송하지 않습니다. 명단을 CSV로 내려받아 직접 안내해주세요.'
    : '📄 승인 결과 메일은 자동 발송하지 않습니다. 명단을 CSV로 내려받아 직접 안내해주세요.';
  $('asmError').style.display = 'none';
  paintStatusDesc();
  openModal('assignModal');
}
window.openAssign = openAssign;

function paintStatusDesc(){
  const k = $('asm-status').value;
  const S = statusSet(asmCurrent);
  $('asm-statusDesc').textContent = S[k] ? S[k].desc : '';
  document.querySelectorAll('.asm-quick .mini-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.set === k));
}
$('asm-status').addEventListener('change', paintStatusDesc);

/* 승인 모드 빠른 처리 버튼 */
document.querySelectorAll('.asm-quick .mini-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $('asm-status').value = btn.dataset.set;
    paintStatusDesc();
    if (btn.dataset.set === 'rejected') $('asm-memo').focus();
  });
});

$('assignForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('asm-appId').value;
  const btn = $('asmSaveBtn');
  const assignMode = asmIsAssignMode();
  const savedLabel = assignMode ? '배정 정보 저장' : '승인 상태 저장';
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const k = $('asm-status').value;
    /* 승인 모드에서는 학교·차수·시수를 건드리지 않습니다 */
    const patch = assignMode
      ? {
          status: k,
          assignPlace: $('asm-place').value.trim(),
          assignPeriod: $('asm-period').value.trim(),
          assignSessions: $('asm-sessions').value === '' ? null : Number($('asm-sessions').value),
          assignHours: $('asm-hours').value === '' ? null : Number($('asm-hours').value),
          statusMemo: $('asm-memo').value.trim()
        }
      : { status: k, statusMemo: $('asm-memo').value.trim() };

    await applyStatus(id, patch);
    closeModal('assignModal');
    toast(assignMode
      ? `배정 정보를 저장했습니다 · ${STATUS[k].label}`
      : `신청을 처리했습니다 · ${APPROVE_STATUS[k].label}`);
    renderAssign();
  } catch (err) {
    $('asmError').textContent = fbError(err);
    $('asmError').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = savedLabel;
  }
});

/* 진행 상태 일괄 변경 */
$('bulkStatus').addEventListener('change', async e => {
  const k = e.target.value;
  e.target.value = '';
  if (!k) return;
  const list = applications.filter(a => selected.has(a.id));
  if (!list.length){ alert('먼저 표에서 대상을 선택해주세요.'); return; }
  if (!confirm(`선택한 ${list.length}명의 상태를 [${dualLabel(k)}](으)로 변경할까요?`)) return;
  let ok = 0, fail = 0;
  for (const a of list){
    try { await applyStatus(a.id, { status: k }); ok++; }
    catch (err){ console.error(err); fail++; }
  }
  selected.clear();
  toast(`상태 변경 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
  renderAssign();
});

/* ==================== v11: 신청 상세 보기 ==================== */
function openAppDetail(id){
  const a = applications.find(x => x.id === id);
  if (!a) return;
  const assignMode = isRecruit(a);

  const row = (k, v, cls) => v == null || v === '' ? ''
    : `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd>`;
  const txt = v => esc(String(v ?? ''));

  const sections = [];

  sections.push(`<h4 class="detail-h">신청 정보</h4><dl class="detail-dl">
    ${row('프로그램', `${txt(progTitle(a)) || '-'} <span class="chip">${txt(KIND[a.programType] || '신청')}</span>`)}
    ${row('운영 기간', txt(progPeriod(a)) || '<span class="cell-sub">일정 미등록</span>')}
    ${row('운영 장소', txt(progPlace(a)))}
    ${row(assignMode ? '지원 분야' : '강좌', txt(a.course || a.session) + (courseIsOrphan(a)
      ? ' <span class="orphan-mark">⚠️ 현재 개설 강좌 목록에 없음</span>' : ''))}
    ${row('접수 일시', txt(tsText(a.createdAt)))}
    ${row('신청번호', `<code class="detail-code">${txt(a.id)}</code>`)}
    ${a.updatedAt ? row('최근 수정', txt(tsText(a.updatedAt))) : ''}
  </dl>`);

  sections.push(`<h4 class="detail-h">신청자</h4><dl class="detail-dl">
    ${row('강사명', `<b>${txt(a.name)}</b>${a.uid ? ' <span class="chip member">회원</span>' : ' <span class="chip">비회원</span>'}`)}
    ${row('소속기관', txt(a.org))}
    ${row('소속 유형', txt(a.orgType))}
    ${row('전화번호', a.phone ? `<a href="tel:${txt(a.phone)}">${txt(a.phone)}</a>` : '')}
    ${row('전자메일', a.email ? `<a href="mailto:${txt(a.email)}">${txt(a.email)}</a>` : '')}
    ${row('요청사항', a.memo ? txt(a.memo).replace(/\n/g, '<br>') : '')}
  </dl>`);

  const certRow = a.completed
    ? row('이수증 번호', a.certNo ? `<code class="detail-code">${txt(a.certNo)}</code>` : '<span class="cell-sub">미발급</span>')
    : '';
  sections.push(`<h4 class="detail-h">처리 현황</h4><dl class="detail-dl">
    ${row(assignMode ? '진행 상태' : '승인 상태', statusChip(a))}
    ${row('수료 여부', a.completed
      ? '<span class="status-chip done">수료</span>'
      : '<span class="status-chip wait">미수료</span>')}
    ${certRow}
    ${row('안내 메모', a.statusMemo ? txt(a.statusMemo).replace(/\n/g, '<br>') : '')}
  </dl>`);

  if (a.assignPlace || a.assignPeriod || a.assignSessions != null || a.assignHours != null){
    sections.push(`<h4 class="detail-h">배정 정보</h4><dl class="detail-dl">
      ${row('배정 학교/기관', txt(a.assignPlace))}
      ${row('운영 기간', txt(a.assignPeriod))}
      ${row('배정 차수', a.assignSessions != null ? `${txt(a.assignSessions)}차시` : '')}
      ${row('배정 시수', a.assignHours != null ? `${txt(a.assignHours)}시간` : '')}
    </dl>`);
  }

  $('ad-kind').textContent = KIND[a.programType] || '신청';
  $('ad-title').textContent = `${a.name} 님 신청 상세`;
  $('ad-body').innerHTML = sections.join('');
  $('ad-actions').innerHTML = `
    <button class="btn btn-navy btn-sm" onclick="closeModal('appDetailModal');openAssign('${a.id}')">
      ${assignMode ? '배정/상태 처리' : '승인/상태 처리'}</button>
    <button class="btn btn-outline btn-sm" onclick="closeModal('appDetailModal');openEditApp('${a.id}')">✏️ 내용 수정</button>
    <button class="btn btn-outline btn-sm" onclick="closeModal('appDetailModal');${a.completed ? `uncompleteApp('${a.id}')` : `completeApp('${a.id}')`}">
      ${a.completed ? '수료 취소' : '수료 처리'}</button>
    ${a.completed ? `<a class="btn btn-outline btn-sm" href="cert.html?id=${a.id}" target="_blank" rel="noopener">이수증 열기</a>` : ''}`;
  openModal('appDetailModal');
}
window.openAppDetail = openAppDetail;

/* 행 클릭 → 상세 보기 (체크박스·버튼·링크 클릭은 제외) */
$('applicantTableBody').addEventListener('click', e => {
  if (e.target.closest('button, input, a, select, label')) return;
  const tr = e.target.closest('tr[data-app]');
  if (tr) openAppDetail(tr.dataset.app);
});

/* ==================== v11: 신청 내용 수정 ==================== */
$('ea-orgtype').innerHTML = '<option value="">선택 안 함</option>' +
  ORG_TYPES.map(o => `<option>${esc(o)}</option>`).join('');

function openEditApp(id){
  const a = applications.find(x => x.id === id);
  if (!a) return;
  const prog = progOf(a);
  const cur = a.course || a.session || '';

  $('ea-appId').value = id;
  $('ea-kind').textContent = KIND[a.programType] || '신청';
  $('ea-title').textContent = `${a.name} 님 신청 내용 수정`;
  $('ea-program').value = `${progTitle(a) || '-'}${progPeriod(a) ? ` · ${progPeriod(a)}` : ''}`;

  /* 강좌: 프로그램에 등록된 목록 + 현재 값 */
  const opts = [...new Set([...(prog && Array.isArray(prog.courses) ? prog.courses : []),
                            ...(cur ? [cur] : [])])];
  $('ea-course').innerHTML = (opts.length ? opts : ['(등록된 강좌 없음)'])
    .map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');

  $('ea-name').value  = a.name || '';
  $('ea-org').value   = a.org || '';
  $('ea-orgtype').value = ORG_TYPES.includes(a.orgType) ? a.orgType : '';
  $('ea-phone').value = a.phone || '';
  $('ea-email').value = a.email || '';
  $('ea-memo').value  = a.memo || '';

  const bits = [`신청번호 ${id}`, a.uid ? '회원 신청' : '비회원 신청'];
  if (a.updatedAt) bits.push(`최근 수정 ${tsText(a.updatedAt)}`);
  $('ea-meta').textContent = `※ ${bits.join(' · ')}`;

  $('eaError').style.display = 'none';
  openModal('editAppModal');
}
window.openEditApp = openEditApp;

$('editAppForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('ea-appId').value;
  const btn = $('eaSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    await updateDoc(doc(db, 'applications', id), {
      name:    $('ea-name').value.trim(),
      org:     $('ea-org').value.trim(),
      orgType: $('ea-orgtype').value,
      phone:   $('ea-phone').value.trim(),
      email:   $('ea-email').value.trim(),
      course:  $('ea-course').value,
      memo:    $('ea-memo').value.trim(),
      updatedAt: serverTimestamp()
    });
    closeModal('editAppModal');
    toast('신청 내용을 수정했습니다.');
  } catch (err) {
    $('eaError').textContent = fbError(err);
    $('eaError').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '수정 내용 저장';
  }
});

/* ==================== 강사 배정 탭 ==================== */
function recruitPrograms(){ return programs.filter(p => p.type === 'recruit'); }

function refreshAssignPrograms(){
  const sel = $('as-program');
  const cur = sel.value;
  const list = recruitPrograms();
  sel.innerHTML = '<option value="">공고를 선택하세요</option>' +
    list.map(p => `<option value="${p.id}">${esc(p.title)} (마감 ${esc(p.deadline)})</option>`).join('');
  if (pendingSelectId && list.some(p => p.id === pendingSelectId)){
    sel.value = pendingSelectId;
    pendingSelectId = null;
    renderAssign();
  } else if (list.some(p => p.id === cur)) sel.value = cur;
  $('badgeAssign').textContent = list.length;
}
$('as-program').addEventListener('change', renderAssign);

/* ---------- v10: 모집 공고 등록/수정 (프로그램 탭에서 이관) ---------- */
let pendingSelectId = null;   // 등록 직후 자동 선택할 공고 id

function toggleRecruitForm(force){
  const box = $('recruitBox');
  const openIt = force === undefined ? box.style.display === 'none' : !!force;
  box.style.display = openIt ? '' : 'none';
  $('rToggleBtn').textContent = openIt ? '✕ 공고 등록 닫기' : '＋ 새 모집 공고 등록';
  if (openIt) setTimeout(() => box.scrollIntoView({behavior:'smooth', block:'center'}), 120);
  else resetRecruitForm();
}

function resetRecruitForm(){
  $('recruitForm').reset();
  $('r-id').value = '';
  $('r-loginonly').checked = true;
  $('r-for').value = 'camp';
  applyRecruitPreset();
  setPickedCourses('r', []);
  setPickedLevels([]);
  $('rFormTitle').textContent = '📣 새 강사 모집 공고 등록';
  $('rFormSubmit').textContent = '모집 공고 등록';
}

function editRecruit(id){
  const p = programs.find(x => x.id === id);
  if (!p) return;
  switchTab('assign');
  $('recruitBox').style.display = '';
  $('rToggleBtn').textContent = '✕ 공고 등록 닫기';
  $('r-id').value        = p.id;
  $('r-title').value     = p.title || '';
  $('r-target').value    = p.target || '';
  $('r-for').value       = p.recruitFor || 'camp';
  applyRecruitPreset();
  $('r-role').value      = p.role || RECRUIT_ROLES[0];
  if (p.mode && !$('r-mode').querySelector(`option[value="${p.mode}"]`)){
    const o = document.createElement('option'); o.textContent = p.mode; $('r-mode').prepend(o);
  }
  $('r-mode').value      = p.mode || $('r-mode').options[0]?.value || '';
  $('r-start').value     = p.startDate || '';
  $('r-end').value       = p.endDate || '';
  $('r-startTime').value = p.startTime || '';
  $('r-endTime').value   = p.endTime || '';
  $('r-place').value     = p.place || '';
  $('r-content').value   = p.content || '';
  $('r-hours').value     = p.hours || '';
  $('r-qual').value      = p.qualification || '';
  $('r-deadline').value  = p.deadline || '';
  $('r-capacity').value  = p.capacity ?? '';
  $('r-loginonly').checked = !!p.loginOnly;
  setPickedCourses('r', Array.isArray(p.courses) ? p.courses : []);
  setPickedLevels(p.levels || []);
  if (!p.startDate && p.period) toast(`이전 형식의 활동 기간(${p.period})입니다. 날짜를 다시 선택해주세요.`, 'warn');
  $('rFormTitle').textContent = '✏️ 모집 공고 수정 — ' + p.title;
  $('rFormSubmit').textContent = '수정 저장';
  setTimeout(() => $('recruitForm').scrollIntoView({behavior:'smooth', block:'center'}), 120);
}

$('recruitForm').addEventListener('submit', async e => {
  e.preventDefault();
  const idVal = $('r-id').value;
  const start = $('r-start').value, end = $('r-end').value;
  const st = $('r-startTime').value, et = $('r-endTime').value;
  if (start && end && start > end){ alert('활동 종료일이 시작일보다 빠릅니다.'); return; }
  if (start && end && start === end && st && et && st > et){
    alert('종료 시각이 시작 시각보다 빠릅니다.'); return;
  }
  const data = {
    type: 'recruit',
    recruitFor: $('r-for').value,
    title:   $('r-title').value.trim(),
    target:  $('r-target').value.trim(),
    role:    $('r-role').value,
    mode:    $('r-mode').value,
    startDate: start,
    endDate:   end,
    startTime: st,
    endTime:   et,
    period:  fmtPeriodKo(start, end, st, et),
    place:   $('r-place').value.trim(),
    content: $('r-content').value.trim(),
    hours:   $('r-hours').value.trim(),
    qualification: $('r-qual').value.trim(),
    levels:  pickedLevels(),
    deadline: $('r-deadline').value,
    capacity: Number($('r-capacity').value),
    loginOnly: $('r-loginonly').checked,
    courses: pickedCourses('r')
  };
  if (data.recruitFor === 'camp' && !data.levels.length){
    alert('대상 학교급을 1개 이상 선택해주세요.'); return;
  }
  if (!data.courses.length){ alert('담당 과정을 1개 이상 선택해주세요.'); return; }
  const btn = $('rFormSubmit');
  btn.disabled = true;
  try {
    if (idVal){
      const before = programs.find(x => x.id === idVal) || {};
      await updateDoc(doc(db, 'programs', idVal), data);
      toast('모집 공고를 수정했습니다.');
      resetRecruitForm();
      toggleRecruitForm(false);
      await syncApplications(idVal, before, data);
    } else {
      const ref = await addDoc(collection(db, 'programs'), {
        ...data, applied: 0, open: true, createdAt: serverTimestamp()
      });
      pendingSelectId = ref.id;        // 목록 갱신 후 자동 선택
      toast('모집 공고를 등록했습니다.');
      resetRecruitForm();
      toggleRecruitForm(false);
    }
  } catch (err) { alert(fbError(err)); }
  finally { btn.disabled = false; }
});
Object.assign(window, { toggleRecruitForm, resetRecruitForm, editRecruit });

function renderAssign(){
  const pid = $('as-program').value;
  const box = $('as-summary');
  const list = recruitPrograms();

  if (!list.length){
    box.innerHTML = `<div class="assign-empty">등록된 <b>강사 모집</b> 공고가 없습니다.<br>
      위 <b>[＋ 새 모집 공고 등록]</b> 버튼을 눌러 첫 공고를 만들어보세요.</div>`;
    $('as-applicantBox').style.display = 'none';
    $('as-candidateBox').style.display = 'none';
    return;
  }
  if (!pid){
    box.innerHTML = `<div class="assign-empty">위에서 모집 공고를 선택하면 지원자 현황과 강사 후보 검색이 표시됩니다.</div>`;
    $('as-applicantBox').style.display = 'none';
    $('as-candidateBox').style.display = 'none';
    return;
  }

  const p = programs.find(x => x.id === pid);
  const apps = applications.filter(a => a.programId === pid);
  const cnt = k => apps.filter(a => statusOf(a) === k).length;

  box.innerHTML = `
    <div class="assign-head">
      <div>
        <h4>${esc(p.title)}</h4>
        <p>${esc(p.target)} · ${esc(p.period)} · ${esc(p.place)}</p>
      </div>
      <div class="assign-fill">
        <b>${apps.length}</b> / ${p.capacity}명 지원
        <div class="seat-track"><div class="seat-fill" style="width:${Math.min(100, Math.round(apps.length / (p.capacity||1) * 100))}%"></div></div>
      </div>
    </div>`;

  $('as-stages').innerHTML = STATUS_ORDER.map(k =>
    `<div class="stage ${k}"><span class="stage-n">${cnt(k)}</span><span class="stage-l">${STATUS[k].label}</span></div>`
  ).join('<span class="stage-arrow">›</span>');

  $('as-count').innerHTML = `<span class="status-chip wait">지원 ${apps.length}건</span>`;
  const tb = $('as-applicantBody');
  if (!apps.length){
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6A776F;">아직 지원자가 없습니다. 아래 강사 후보 검색에서 직접 등록할 수 있습니다.</td></tr>';
  } else {
    tb.innerHTML = apps
      .slice().sort((a,b) => STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)) || tsNum(b.createdAt) - tsNum(a.createdAt))
      .map(a => {
        const asg = [a.assignPlace, a.assignPeriod,
          a.assignSessions ? `${a.assignSessions}차수` : '',
          a.assignHours ? `${a.assignHours}시수` : ''].filter(Boolean).join(' · ');
        return `<tr>
        <td class="nowrap">${esc(tsText(a.createdAt, false))}</td>
        <td><b>${esc(a.name)}</b>${a.uid ? '<span class="chip member">회원</span>' : ''}</td>
        <td>${esc(a.org) || '-'}</td>
        <td>${esc(a.course || '-')}</td>
        <td class="cell-sub">${esc(a.applyRole || '-')}</td>
        <td>${statusChip(a)}</td>
        <td class="cell-sub">${asg ? esc(asg) : '<span style="color:#A5B1A9;">미배정</span>'}
          ${a.statusMemo ? `<br><span style="color:#8A968E;">📝 ${esc(a.statusMemo)}</span>` : ''}</td>
        <td><div class="t-actions">
          <button class="mini-btn" onclick="openAssign('${a.id}')">배정</button>
          <button class="mini-btn danger" onclick="deleteApplicant('${a.id}')">삭제</button>
        </div></td>
      </tr>`;
      }).join('');
  }
  $('as-applicantBox').style.display = 'block';
  $('as-candidateBox').style.display = 'block';
  renderCandidates();
}

/* ---- 강사 후보 검색 ---- */
function careerRank(c){
  const i = CAREER_LEVELS.indexOf(c || '');
  return i < 0 ? -1 : i;
}
function filteredCandidates(){
  const pid = $('as-program').value;
  const applied = new Set(applications.filter(a => a.programId === pid && a.uid).map(a => a.uid));
  const rg = $('cd-region').value, sp = $('cd-specialty').value;
  const cr = $('cd-career').value === '' ? -1 : Number($('cd-career').value);
  const q = $('cd-q').value.trim().toLowerCase();

  return members.filter(m => {
    if (roleOf(m) !== 'instructor') return false;
    if (rg && !(m.regions || []).includes(rg) && !(m.regions || []).includes('전국 가능')) return false;
    if (sp && !(m.specialties || []).includes(sp)) return false;
    if (cr >= 0 && careerRank(m.career) < cr) return false;
    if (q){
      const hay = [m.name, m.org, m.certs, m.bio, m.orgType,
                   (m.specialties||[]).join(' '), (m.regions||[]).join(' ')]
        .map(v => String(v ?? '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  }).map(m => ({ ...m, alreadyApplied: applied.has(m.uid) }))
    .sort((a, b) => careerRank(b.career) - careerRank(a.career));
}
function renderCandidates(){
  const tb = $('as-candidateBody');
  if (!membersLoaded){
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6A776F;">강사 회원 명단을 불러오는 중…</td></tr>';
    return;
  }
  const list = filteredCandidates();
  $('as-candCount').innerHTML = `<span class="status-chip review">후보 ${list.length}명</span>`;
  if (!list.length){
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6A776F;">조건에 맞는 <b>강사</b> 회원이 없습니다. 필터를 완화해보세요.</td></tr>';
    return;
  }
  tb.innerHTML = list.slice(0, 60).map(m => {
    const assigned = applications.filter(a =>
      a.uid === m.uid && statusOf(a) === 'assigned');
    const hours = assigned.reduce((s, a) => s + (Number(a.assignHours) || 0), 0);
    return `<tr>
      <td><b>${esc(m.name || '-')}</b></td>
      <td>${esc(m.org || '-')}</td>
      <td class="cell-sub">${esc((m.specialties || []).join(', ')) || '<span style="color:#A5B1A9;">미작성</span>'}</td>
      <td class="nowrap">${esc(m.career || '-')}</td>
      <td class="cell-sub">${esc((m.regions || []).join(', ')) || '-'}</td>
      <td class="nowrap cell-sub">${esc(m.phone || '-')}<br>${esc(m.email || '')}</td>
      <td class="nowrap">${assigned.length}건 / ${hours}시수</td>
      <td>${m.alreadyApplied
        ? '<span class="status-chip review">등록됨</span>'
        : `<button class="mini-btn" onclick="addCandidate('${m.uid}')">＋ 검토대상 등록</button>`}</td>
    </tr>`;
  }).join('');
}
['cd-region','cd-specialty','cd-career'].forEach(id =>
  $(id).addEventListener('change', renderCandidates));
$('cd-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderCandidates, 200); });
function resetCandidateFilters(){
  ['cd-region','cd-specialty','cd-career','cd-q'].forEach(id => $(id).value = '');
  renderCandidates();
}
window.resetCandidateFilters = resetCandidateFilters;

/** 후보를 이 공고의 '검토중' 지원 건으로 등록 */
async function addCandidate(uid){
  const pid = $('as-program').value;
  const p = programs.find(x => x.id === pid);
  const m = members.find(x => x.uid === uid);
  if (!p || !m) return;
  if (!confirm(`${m.name} 님을 [${p.title}] 공고의 검토 대상으로 등록할까요?\n강사 마이페이지에 '검토중' 상태로 표시됩니다.`)) return;
  try {
    await addDoc(collection(db, 'applications'), {
      programId: p.id,
      programTitle: p.title,
      programType: 'recruit',
      course: (p.courses && p.courses[0]) || '',
      name: m.name || '',
      org: m.org || '',
      orgType: m.orgType || '',
      phone: m.phone || '',
      email: m.email || '',
      memo: '(사업단이 강사 후보 검색을 통해 등록)',
      uid: m.uid,
      status: 'review',
      completed: false,
      createdAt: serverTimestamp(),
      statusAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'programs', p.id), { applied: increment(1) }).catch(()=>{});
    toast(`${m.name} 님을 검토 대상으로 등록했습니다.`);
    renderAssign();
  } catch (err) { alert(fbError(err)); }
}
window.addCandidate = addCandidate;

/* ==================== CSV ==================== */
function saveCSV(rows, filename){
  const csv = '\uFEFF' + rows.map(r =>
    r.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')
  ).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
/* ==================== v15: 서명부 인쇄 ====================
   신청자 탭의 현재 필터 결과를 과목(강좌)별로 묶어
   한 과목 = 한 페이지의 서명부를 만듭니다. 반려 건은 제외합니다. */
function printAttendance(){
  const list = filteredApps().filter(a => statusOf(a) !== 'rejected');
  if (!list.length){
    alert('현재 필터에 표시된 신청자가 없습니다.\n필터를 조정한 뒤 다시 시도해주세요.');
    return;
  }

  const groups = new Map();
  list.forEach(a => {
    const key = a.course || a.session || '(강좌 미지정)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  });

  /* A4 한 장에 서명 20줄(한 반 정원 기준) — 신청자가 적으면 빈 줄로 채우고,
     20명을 넘으면 연번을 이어가며 다음 장으로 나눕니다. */
  const PER_PAGE = 20;

  $('attPages').innerHTML = [...groups.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], 'ko'))
    .flatMap(([course, apps]) => {
      apps.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      const first = apps[0];
      const pageN = Math.max(1, Math.ceil(apps.length / PER_PAGE));
      return Array.from({ length: pageN }, (_, p) => {
        const chunk = apps.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
        const rows = chunk.map((a, i) =>
          `<tr><td>${p * PER_PAGE + i + 1}</td><td>${esc(a.org || '')}</td><td class="att-role-td">${esc(a.orgType || '')}</td><td>${esc(a.name || '')}</td><td></td></tr>`).join('')
          + Array.from({ length: PER_PAGE - chunk.length }, (_, i) =>
          `<tr><td>${p * PER_PAGE + chunk.length + i + 1}</td><td></td><td></td><td></td><td></td></tr>`).join('');
        return `
      <section class="att-page">
        <div class="att-head">
          <img class="att-logo att-emblem" src="img/logo.png" alt="한신대학교" onerror="this.remove()">
          <div class="att-title">
            <span class="att-sub">HANSHIN UNIVERSITY · DIGITAL SAESSAK</span>
            <h1>2026 한신대학교 디지털새싹<br>강사워크샵 서명부</h1>
          </div>
          <img class="att-logo att-word" src="img/partner-3.png" alt="디지털새싹" onerror="this.remove()">
        </div>
        <div class="att-rule"></div>
        <p class="att-consent">본 서명부는 출석 확인을 위해 성명·소속·서명을 수집·이용하며,
          수집된 정보는 워크샵 운영과 수료 관리 목적 외에는 사용되지 않고
          종료 후 관계 법령에 따라 파기됩니다. 서명 시 위 내용에 동의한 것으로 간주합니다.</p>
        <table class="att-info">
          <tr><th>일시</th><td>${esc(progPeriod(first) || '')}</td>
              <th>장소</th><td>${esc(progPlace(first) || '')}</td></tr>
          <tr><th>과목명</th><td colspan="3">${esc(course)}${pageN > 1 ? ` <span class="att-pn">(${p + 1}/${pageN})</span>` : ''}</td></tr>
        </table>
        <table class="att-table">
          <thead><tr><th class="att-no">연번</th><th>소속</th><th class="att-role">직책</th><th class="att-name">성함</th><th class="att-sign">서명</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="att-count">신청 인원 ${apps.length}명</p>
        <div class="att-foot"><b>한신대학교 디지털새싹 사업단</b> · 031-379-0255 · newsac26@naver.com</div>
      </section>`;
      });
    }).join('');

  $('attSheet').classList.add('on');
  document.body.classList.add('att-print');
}
function closeAttendance(){
  $('attSheet').classList.remove('on');
  document.body.classList.remove('att-print');
}
Object.assign(window, { printAttendance, closeAttendance });

function downloadCSV(scope = 'filtered'){
  const list = scope === 'all' ? applications : filteredApps();
  if (!list.length){ alert('내보낼 신청 내역이 없습니다.'); return; }
  const rows = [['접수일시','신청번호','프로그램','운영기간','운영장소','유형','강좌/지원분야','강사명','소속기관','소속기관 유형',
                 '전화번호','전자메일','회원가입 여부','승인/진행 상태','배정 학교/기관','배정 기간',
                 '배정 차수','배정 시수','안내 메모','희망 역할',
                 '수료여부','이수증 발급번호','요청사항']];
  list.forEach(a => {
    rows.push([tsText(a.createdAt), a.id, progTitle(a) || '',
      progPeriod(a), progPlace(a), KIND[a.programType] || '',
      a.course || a.session || '', a.name, a.org, a.orgType || '', a.phone, a.email,
      a.uid ? '회원' : '비회원', statusSet(a)[statusOf(a)].label,
      a.assignPlace || '', a.assignPeriod || '', a.assignSessions ?? '', a.assignHours ?? '',
      a.statusMemo || '', a.applyRole || '',
      a.completed ? '수료' : '접수', a.certNo || '', a.memo]);
  });
  const tag = scope === 'all' ? '전체' : '검색결과';
  saveCSV(rows, `디지털새싹_신청자명단_${tag}_${todayStr().replace(/\./g,'')}.csv`);
  toast(`CSV ${list.length}건을 내려받았습니다.`);
}
window.downloadCSV = downloadCSV;

/* ==================== 강사 회원 ==================== */
/* ---------- v12: 관리자 명단 ---------- */
let adminUids = new Set();
let adminDocs = [];
let myUid = null;

async function loadAdmins(){
  try {
    const snap = await getDocs(collection(db, 'admins'));
    adminDocs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    adminUids = new Set(adminDocs.map(a => a.uid));
  } catch (err){
    console.warn('관리자 명단 조회 실패:', err);
  }
}
const isAdminUid = uid => adminUids.has(uid);

/** 관리자 지정 / 해제 */
async function toggleAdmin(uid){
  const m = members.find(x => x.uid === uid);
  if (!m) return;
  const on = isAdminUid(uid);

  if (on && uid === myUid){
    alert('본인의 관리자 권한은 해제할 수 없습니다.\n다른 관리자에게 요청하거나 Firebase 콘솔에서 처리해주세요.');
    return;
  }
  const msg = on
    ? `${m.name || m.email} 님의 관리자 권한을 해제할까요?\n\n해제하면 관리자 페이지에 접근할 수 없게 됩니다.`
    : `${m.name || m.email} 님을 관리자로 지정할까요?\n\n` +
      `⚠️ 관리자는 전체 신청자의 개인정보 조회, 프로그램·공지 등록, 수료 처리를 모두 할 수 있습니다.\n` +
      `신뢰할 수 있는 담당자에게만 부여해주세요.`;
  if (!confirm(msg)) return;

  try {
    if (on){
      await deleteDoc(doc(db, 'admins', uid));
      toast('관리자 권한을 해제했습니다.');
    } else {
      await setDoc(doc(db, 'admins', uid), {
        email: m.email || '',
        name: m.name || '',
        grantedAt: serverTimestamp(),
        grantedBy: auth.currentUser ? auth.currentUser.email : ''
      });
      toast('관리자로 지정했습니다.');
    }
    await loadAdmins();
    renderMembers();
    if ($('memberDetailModal').classList.contains('on')) openMemberDetail(uid);
  } catch (err){
    alert(fbError(err) + '\n\n보안 규칙이 최신인지 확인해주세요. (site_extras/firestore_보안규칙_v5.txt)');
  }
}
window.toggleAdmin = toggleAdmin;

async function loadMembers(){
  const tb = $('memberTableBody');
  tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6A776F;">불러오는 중…</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'users'));
    members = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    membersLoaded = true;
    await loadAdmins();
    renderMembers();
    renderDashboard();
    if ($('tab-assign').classList.contains('on')) renderCandidates();
  } catch (err){
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#C64B3C;">${esc(fbError(err))}</td></tr>`;
  }
}
window.loadMembers = loadMembers;

/** 해당 회원의 신청 내역 (계정 연결 + 이메일 일치) */
function memberApps(m){
  return applications
    .filter(a => (a.uid && a.uid === m.uid) || (a.email && m.email && a.email === m.email))
    .sort((a, b) => tsNum(b.createdAt) - tsNum(a.createdAt));
}
function memberStats(m){
  const mine = memberApps(m);
  const assigned = mine.filter(a => statusOf(a) === 'assigned');
  return {
    total: mine.length,
    done: mine.filter(a => a.completed).length,
    assigned: assigned.length,
    hours: assigned.reduce((s, a) => s + (Number(a.assignHours) || 0), 0)
  };
}
function hasProfileOf(m){
  const r = roleOf(m);
  if (r === 'instructor') return !!(m.specialties?.length || m.career || m.regions?.length);
  if (r === 'staff')      return !!(m.orgInterests?.length || m.groupSize || m.orgNote);
  return !!(m.interests?.length || m.careNote);
}
/** 유형별 요약 정보 (표·CSV 공용) */
function roleDetail(m){
  const r = roleOf(m);
  if (r === 'instructor'){
    return [(m.specialties || []).join(', '), m.career, (m.regions || []).join(', ')]
      .filter(Boolean).join(' · ');
  }
  if (r === 'staff'){
    return [m.dept, m.duty, m.groupSize ? `단체 ${m.groupSize}명` : '',
            (m.orgInterests || []).join(', ')].filter(Boolean).join(' · ');
  }
  if (r === 'parent'){
    return [m.childName ? `자녀 ${m.childName}` : '', m.childGrade, m.childSchool,
            (m.interests || []).join(', ')].filter(Boolean).join(' · ');
  }
  return [m.grade, m.school, m.guardianPhone ? `보호자 ${m.guardianPhone}` : '',
          (m.interests || []).join(', ')].filter(Boolean).join(' · ');
}
function filteredMembers(){
  const q = $('mf-q').value.trim().toLowerCase();
  const fp = $('mf-profile').value;
  const fr = $('mf-role').value;
  return members.filter(m => {
    if (fr && roleOf(m) !== fr) return false;
    const hp = hasProfileOf(m);
    if (fp === 'done' && !hp) return false;
    if (fp === 'none' && hp) return false;
    if (q){
      const hay = [m.name, m.email, m.org, m.orgType, m.phone, m.career, roleDetail(m),
                   ROLES[roleOf(m)].label, m.bio, m.careNote, m.orgNote]
        .map(v => String(v ?? '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => tsNum(b.createdAt) - tsNum(a.createdAt));
}
/** v11: 회원 유형별 집계 스트립 */
function renderMemberStats(){
  const box = $('memberStats');
  if (!box) return;
  if (!membersLoaded){ box.innerHTML = ''; return; }

  const byRole = r => members.filter(m => roleOf(m) === r);
  const inst = byRole('instructor');
  const instWithProfile = inst.filter(hasProfileOf).length;
  const instCompleted = inst.filter(m => memberStats(m).done > 0).length;

  const cards = [
    { k: '전체 회원',        v: members.length,   u: '명', main: false },
    { k: '강사 회원',        v: inst.length,      u: '명', main: true },
    { k: '강사 프로필 작성', v: instWithProfile,  u: '명',
      sub: inst.length ? `${Math.round(instWithProfile / inst.length * 100)}%` : '' },
    { k: '워크샵 이수 강사', v: instCompleted,    u: '명' },
    { k: '학부모',           v: byRole('parent').length,  u: '명' },
    { k: '학생',             v: byRole('student').length, u: '명' },
    { k: '교직원',           v: byRole('staff').length,   u: '명' },
    { k: '관리자',           v: adminUids.size,           u: '명' }
  ];
  box.innerHTML = cards.map(c => `
    <div class="ms-card${c.main ? ' main' : ''}">
      <span class="ms-k">${esc(c.k)}</span>
      <span class="ms-v">${c.v}<em>${c.u}</em></span>
      ${c.sub ? `<span class="ms-sub">${esc(c.sub)}</span>` : ''}
    </div>`).join('');
}

function renderMembers(){
  const tb = $('memberTableBody');
  const list = filteredMembers();
  $('badgeMember').textContent = members.length;
  renderMemberStats();
  if (!list.length){
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#6A776F;">${
      members.length ? '조건에 맞는 회원이 없습니다.' : '가입한 회원이 없습니다.'}</td></tr>`;
    return;
  }
  tb.innerHTML = list.map(m => {
    const s = memberStats(m);
    const r = roleOf(m);
    return `<tr class="row-click" data-member="${esc(m.uid)}" title="클릭하면 회원 상세를 볼 수 있습니다">
      <td class="nowrap">${esc(tsText(m.createdAt, false))}</td>
      <td><span class="role-chip ${r}">${ROLES[r].icon} ${ROLES[r].label}</span></td>
      <td><b>${esc(m.name || '-')}</b>${isAdminUid(m.uid) ? '<span class="chip admin">🔑 관리자</span>' : ''}</td>
      <td class="cell-sub">${esc(m.email || '-')}</td>
      <td class="nowrap cell-sub">${esc(m.phone || '-')}</td>
      <td>${esc(m.org || m.childSchool || m.school || '-')}</td>
      <td class="nowrap">${s.total}건 / <b style="color:var(--leaf);">${s.done}</b></td>
      <td class="nowrap">${r === 'instructor' ? `${s.assigned}건 / <b style="color:var(--navy);">${s.hours}</b>시수` : '-'}</td>
    </tr>`;
  }).join('');
}

/* 회원 행 클릭 → 상세 */
$('memberTableBody').addEventListener('click', e => {
  if (e.target.closest('button, input, a, select, label')) return;
  const tr = e.target.closest('tr[data-member]');
  if (tr) openMemberDetail(tr.dataset.member);
});

/* ---------- v11: 회원 상세 보기 ---------- */
function openMemberDetail(uid){
  const m = members.find(x => x.uid === uid);
  if (!m) return;
  const r = roleOf(m);
  const st = memberStats(m);
  const mine = memberApps(m);
  const done = mine.filter(a => a.completed);
  const live = mine.filter(a => !a.completed);
  const assigned = mine.filter(a => a.assignPlace || a.assignHours != null);

  const row = (k, v) => v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const t = v => esc(String(v ?? ''));
  const out = [];

  out.push(`<h4 class="detail-h">기본 정보</h4><dl class="detail-dl">
    ${row('회원 유형', `<span class="role-chip ${r}">${ROLES[r].icon} ${ROLES[r].label}</span>`)}
    ${row('가입일', t(tsText(m.createdAt, false)))}
    ${row('이메일', m.email ? `<a href="mailto:${t(m.email)}">${t(m.email)}</a>` : '')}
    ${row('연락처', m.phone ? `<a href="tel:${t(m.phone)}">${t(m.phone)}</a>` : '')}
    ${row('소속 / 학교', t(m.org || m.childSchool || m.school))}
    ${row('소속 유형', t(m.orgType))}
  </dl>`);

  const detail = roleDetail(m);
  if (r === 'instructor'){
    out.push(`<h4 class="detail-h">강사 프로필</h4><dl class="detail-dl">
      ${row('전문 분야', (m.specialties || []).length ? t(m.specialties.join(' · ')) : '')}
      ${row('경력', t(m.career))}
      ${row('활동 가능 지역', (m.regions || []).length ? t(m.regions.join(' · ')) : '')}
      ${row('가능 요일', (m.weekdays || []).length ? t(m.weekdays.join(' · ')) : '')}
      ${row('가능 시간', (m.timeslots || []).length ? t(m.timeslots.join(' · ')) : '')}
      ${row('자기소개', m.bio ? t(m.bio).replace(/\n/g, '<br>') : '')}
      ${!hasProfileOf(m) ? '<dt>상태</dt><dd><span class="cell-sub">프로필 미작성</span></dd>' : ''}
    </dl>`);
  } else if (detail){
    out.push(`<h4 class="detail-h">${ROLES[r].label} 정보</h4><dl class="detail-dl">
      ${row('상세', t(detail))}
      ${row('메모', (m.careNote || m.orgNote) ? t(m.careNote || m.orgNote).replace(/\n/g, '<br>') : '')}
    </dl>`);
  }

  out.push(`<h4 class="detail-h">참여 요약</h4>
    <div class="member-sum">
      <div><span>총 신청</span><b>${st.total}</b>건</div>
      <div><span>수료 완료</span><b class="ok">${st.done}</b>건</div>
      ${r === 'instructor' ? `<div><span>배정</span><b>${st.assigned}</b>건</div>
      <div><span>누적 시수</span><b class="navy">${st.hours}</b>시간</div>` : ''}
    </div>`);

  const appLine = a => `<li>
      <div class="ml-top"><b>${esc(progTitle(a)) || '-'}</b>
        ${a.certNo ? `<code class="detail-code">${esc(a.certNo)}</code>` : statusChip(a)}</div>
      <div class="ml-sub">${esc(a.course || a.session || '-')}
        · ${esc(a.completedAt ? `${tsText(a.completedAt, false)} 수료` : `${tsText(a.createdAt, false)} 접수`)}
        ${a.assignPlace ? ` · 📍 ${esc(a.assignPlace)}` : ''}
        ${a.assignHours != null ? ` · ${esc(a.assignHours)}시간` : ''}</div>
    </li>`;

  out.push(`<h4 class="detail-h">이수한 워크샵 · 연수 (${done.length})</h4>
    ${done.length ? `<ul class="member-list">${done.map(appLine).join('')}</ul>`
                  : '<p class="member-empty">아직 이수한 과정이 없습니다.</p>'}`);

  out.push(`<h4 class="detail-h">진행 중인 신청 (${live.length})</h4>
    ${live.length ? `<ul class="member-list">${live.map(appLine).join('')}</ul>`
                  : '<p class="member-empty">진행 중인 신청이 없습니다.</p>'}`);

  if (assigned.length){
    out.push(`<h4 class="detail-h">배정 이력 (${assigned.length})</h4>
      <ul class="member-list">${assigned.map(appLine).join('')}</ul>`);
  }

  /* v12: 관리자 권한 */
  const isAdm = isAdminUid(m.uid);
  const self = m.uid === myUid;
  out.push(`<h4 class="detail-h">관리자 권한</h4>
    <div class="admin-grant ${isAdm ? 'on' : ''}">
      <div>
        <b>${isAdm ? '🔑 관리자입니다' : '일반 회원입니다'}</b>
        <span>${isAdm
          ? '관리자 페이지에서 신청자 개인정보 조회, 프로그램·공지 등록, 수료 처리를 할 수 있습니다.'
          : '관리자로 지정하면 관리자 페이지의 모든 기능을 사용할 수 있게 됩니다.'}</span>
      </div>
      <button class="btn ${isAdm ? 'btn-outline' : 'btn-navy'} btn-sm"
        onclick="toggleAdmin('${m.uid}')" ${self && isAdm ? 'disabled title="본인 권한은 해제할 수 없습니다"' : ''}>
        ${isAdm ? (self ? '본인 계정' : '관리자 해제') : '🔑 관리자로 지정'}</button>
    </div>`);

  $('md-kind').textContent = ROLES[r].label;
  $('md-title').textContent = `${m.name || '이름 없음'} 님${isAdm ? ' · 관리자' : ''}`;
  $('md-body').innerHTML = out.join('');
  openModal('memberDetailModal');
}
window.openMemberDetail = openMemberDetail;
$('mf-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderMembers, 200); });
$('mf-profile').addEventListener('change', renderMembers);
$('mf-role').addEventListener('change', renderMembers);

function downloadMemberCSV(){
  const list = filteredMembers();
  if (!list.length){ alert('내보낼 회원이 없습니다.'); return; }
  const rows = [['가입일','회원 유형','관리자','이름','이메일','전화번호','소속/학교','소속유형',
                 '유형별 정보','전문분야','경력','활동가능지역','자기소개/메모',
                 '총 신청','수료 완료','배정 건수','누적 시수']];
  list.forEach(m => {
    const s = memberStats(m);
    rows.push([tsText(m.createdAt, false), ROLES[roleOf(m)].label,
      isAdminUid(m.uid) ? '관리자' : '', m.name, m.email, m.phone || '',
      m.org || m.childSchool || m.school || '', m.orgType || '', roleDetail(m),
      (m.specialties || []).join(' / '), m.career || '', (m.regions || []).join(' / '),
      m.bio || m.careNote || m.orgNote || '', s.total, s.done, s.assigned, s.hours]);
  });
  saveCSV(rows, `디지털새싹_강사회원명단_${todayStr().replace(/\./g,'')}.csv`);
  toast(`CSV ${list.length}건을 내려받았습니다.`);
}
window.downloadMemberCSV = downloadMemberCSV;

/* ==================== 통계 대시보드 ==================== */
const charts = {};
function makeChart(id, config){
  if (charts[id]) charts[id].destroy();
  const el = $(id);
  if (!el || typeof Chart === 'undefined') return;
  charts[id] = new Chart(el, config);
}
const C = { leaf:'#1E7F4F', sprout:'#5FC97E', navy:'#1B3A5C', sun:'#F5C542', red:'#C64B3C', line:'#D7E4DA' };

/* ==================== v30: 신청 현황 대시보드 ====================
   KPI 8종 + 차트 8종. 프로그램별 차트는 유형(집합형/워크샵/온라인/모집)으로,
   추이 차트는 기간(14·30·90일)으로 나눠 볼 수 있습니다. */
let dashEnrolls = [];          // 온라인 수강 등록 (대시보드 집계용)
let dashProgCat = '';          // 프로그램 차트 유형 필터
let dashTrendDays = 14;        // 추이 기간

/** 프로그램 유형 분류: camp(집합형) / workshop(강사 워크샵) / online(온라인) / recruit(모집) */
function progCategory(p){
  if (p.type === 'recruit') return 'recruit';
  if (p.type === 'camp' || /캠프/.test(p.title || '')) return 'camp';
  if (/온라인/.test(p.title || '')) return 'online';
  return 'workshop';
}

async function loadDashEnrolls(){
  try {
    const snap = await getDocs(collection(db, 'enrollments'));
    dashEnrolls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
  } catch (e){ /* 권한·네트워크 문제 시 온라인 지표만 생략 */ }
}
loadDashEnrolls();

function dayCount(list, date){
  const key = date.toDateString();
  return list.filter(a => {
    try { return a.createdAt?.toDate && a.createdAt.toDate().toDateString() === key; }
    catch { return false; }
  }).length;
}

function renderDashboard(){
  const total = applications.length;
  const today = dayCount(applications, new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yest = dayCount(applications, y);
  $('d-total').textContent = total;
  $('d-totalSub').innerHTML = today
    ? `오늘 <b class="up">+${today}</b>${yest ? ` · 어제 ${yest}` : ''}`
    : (yest ? `어제 ${yest}건` : '오늘 신청 없음');

  const waiting = applications.filter(a => ['applied', 'review'].includes(statusOf(a)));
  $('d-wait').textContent = waiting.length;
  $('d-waitSub').textContent = waiting.length
    ? `검토중 ${waiting.filter(a => statusOf(a) === 'review').length}건 포함`
    : '모두 처리 완료';

  const openList = programs.filter(p => p.open && !ddayInfo(p).closed);
  $('d-open').textContent = openList.length;
  const soon = openList.filter(p => ddayInfo(p).urgent).length;
  $('d-openSub').innerHTML = soon ? `마감 임박 <b class="warn">${soon}건</b>` : `전체 ${programs.length}개 중`;

  const fillTargets = programs.filter(p => p.type !== 'recruit');
  const fills = fillTargets.map(p => Math.min(1, (p.applied || 0) / (p.capacity || 1)));
  const avgFill = fills.length ? Math.round(fills.reduce((a, b) => a + b, 0) / fills.length * 100) : 0;
  $('d-fill').textContent = avgFill + '%';
  const full = fillTargets.filter(p => (p.applied || 0) >= (p.capacity || 1)).length;
  $('d-fillSub').textContent = full ? `정원 마감 ${full}건` : '워크샵·연수 기준';

  const doneN = applications.filter(a => a.completed).length;
  $('d-done').textContent = doneN;
  $('d-doneSub').textContent = total ? `수료율 ${Math.round(doneN / total * 100)}%` : '—';

  const pending = applications.filter(a => a.completed && !a.certNo && isMiniApp(a)).length;
  $('d-pending').textContent = pending;
  $('d-pendingSub').textContent = pending ? '미니 — 온라인 이수 확인 필요' : '대기 건 없음';

  $('d-enroll').textContent = dashEnrolls.length;
  const enrDone = dashEnrolls.filter(e => e.completed).length;
  $('d-enrollSub').textContent = dashEnrolls.length ? `수료 ${enrDone}명` : '수강 등록 없음';

  $('d-member').textContent = membersLoaded
    ? `${members.filter(m => roleOf(m) === 'instructor').length}/${members.length}` : '—';
  $('d-memberSub').textContent = membersLoaded
    ? `회원 신청 ${applications.filter(a => a.uid).length}건` : '회원 탭에서 불러옵니다';

  /* ① 프로그램별 신청/정원 — 유형 필터 (온라인은 과목별 수강 인원) */
  if (dashProgCat === 'online'){
    const byCourse = {};
    dashEnrolls.forEach(e => {
      const n = (courseByKey(e.courseKey)?.name || e.courseName || '(미지정)').split(':')[0];
      byCourse[n] = (byCourse[n] || 0) + 1;
    });
    const ent = Object.entries(byCourse).sort((a, b) => b[1] - a[1]);
    makeChart('chartPrograms', {
      type: 'bar',
      data: { labels: ent.map(e => e[0]),
        datasets: [{ label: '수강 등록', data: ent.map(e => e[1]), backgroundColor: C.sprout, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  } else {
    const list = programs.filter(p => !dashProgCat || progCategory(p) === dashProgCat);
    makeChart('chartPrograms', {
      type: 'bar',
      data: {
        labels: list.map(p => p.title.length > 14 ? p.title.slice(0, 14) + '…' : p.title),
        datasets: [
          { label: '신청', data: list.map(p => p.applied || 0), backgroundColor: C.sprout, borderRadius: 6 },
          { label: '정원', data: list.map(p => p.capacity), backgroundColor: C.line, borderRadius: 6 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  /* ② 신청 추이 — 기간 선택 + 누적선 */
  const days = [], counts = [];
  for (let i = dashTrendDays - 1; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push((d.getMonth() + 1) + '/' + d.getDate());
    counts.push(dayCount(applications, d));
  }
  let acc = 0;
  const cum = counts.map(n => (acc += n));
  makeChart('chartDaily', {
    type: 'line',
    data: { labels: days, datasets: [
      { label: '일별 신청', data: counts, borderColor: C.leaf,
        backgroundColor: 'rgba(95,201,126,.18)', fill: true, tension: .3, pointRadius: dashTrendDays > 30 ? 0 : 2 },
      { label: '누적', data: cum, borderColor: C.navy, borderDash: [5, 4],
        fill: false, tension: .3, pointRadius: 0, yAxisID: 'y1' }
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 } }
      } }
  });

  /* ③ 강좌별 신청 분포 */
  const courseCount = {};
  applications.forEach(a => {
    const key = a.course || a.session || '(미지정)';
    courseCount[key] = (courseCount[key] || 0) + 1;
  });
  const courseEntries = Object.entries(courseCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  makeChart('chartCourses', {
    type: 'bar',
    data: {
      labels: courseEntries.map(e => e[0].length > 16 ? e[0].slice(0, 16) + '…' : e[0]),
      datasets: [{ label: '신청', data: courseEntries.map(e => e[1]), backgroundColor: C.navy, borderRadius: 6 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  /* ④ 진행 상태 분포 */
  const stCount = { applied: 0, review: 0, assigned: 0, rejected: 0 };
  applications.forEach(a => { stCount[statusOf(a)] = (stCount[statusOf(a)] || 0) + 1; });
  makeChart('chartStatus', {
    type: 'doughnut',
    data: {
      labels: ['신청접수', '검토중', '승인완료', '반려'],
      datasets: [{ data: [stCount.applied, stCount.review, stCount.assigned, stCount.rejected],
        backgroundColor: [C.line, C.sun, C.leaf, C.red], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { position: 'right' } } }
  });

  /* ⑤ 소속기관 유형 분포 */
  const typeCount = {};
  applications.forEach(a => {
    const key = a.orgType || '(미입력)';
    typeCount[key] = (typeCount[key] || 0) + 1;
  });
  makeChart('chartOrgTypes', {
    type: 'doughnut',
    data: {
      labels: Object.keys(typeCount),
      datasets: [{ data: Object.values(typeCount), borderWidth: 0,
        backgroundColor: [C.leaf, C.navy, C.sun, C.red, C.sprout, '#8ADCA0'] }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { position: 'right' } } }
  });

  /* ⑥ 온라인 워크샵 과목별 수강 (신청 / 수료) */
  const onCount = {};
  dashEnrolls.forEach(e => {
    const n = (courseByKey(e.courseKey)?.name || e.courseName || '(미지정)').split(':')[0];
    if (!onCount[n]) onCount[n] = { all: 0, done: 0 };
    onCount[n].all++;
    if (e.completed) onCount[n].done++;
  });
  const onEnt = Object.entries(onCount).sort((a, b) => b[1].all - a[1].all);
  makeChart('chartOnline', {
    type: 'bar',
    data: {
      labels: onEnt.map(e => e[0]),
      datasets: [
        { label: '수강', data: onEnt.map(e => e[1].all), backgroundColor: C.sprout, borderRadius: 6 },
        { label: '수료', data: onEnt.map(e => e[1].done), backgroundColor: C.leaf, borderRadius: 6 }
      ]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  /* ⑦ 요일별 신청 분포 — 홍보·오픈 시점 참고 */
  const wd = [0, 0, 0, 0, 0, 0, 0];
  applications.forEach(a => {
    try { if (a.createdAt?.toDate) wd[a.createdAt.toDate().getDay()]++; } catch { /* 무시 */ }
  });
  makeChart('chartWeekday', {
    type: 'bar',
    data: { labels: ['일', '월', '화', '수', '목', '금', '토'],
      datasets: [{ label: '신청', data: wd, borderRadius: 6,
        backgroundColor: wd.map((_, i) => (i === 0 || i === 6) ? C.sun : C.navy) }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  /* ⑧ 소속기관 TOP 8 */
  const orgCount = {};
  applications.forEach(a => {
    const key = (a.org || '').trim();
    if (key) orgCount[key] = (orgCount[key] || 0) + 1;
  });
  const orgEnt = Object.entries(orgCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  makeChart('chartOrgTop', {
    type: 'bar',
    data: {
      labels: orgEnt.map(e => e[0].length > 14 ? e[0].slice(0, 14) + '…' : e[0]),
      datasets: [{ label: '신청', data: orgEnt.map(e => e[1]), backgroundColor: C.sprout, borderRadius: 6 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

/* 대시보드 필터 칩 */
document.querySelectorAll('#progChips .dc-chip').forEach(b =>
  b.addEventListener('click', () => {
    dashProgCat = b.dataset.cat;
    document.querySelectorAll('#progChips .dc-chip').forEach(x => x.classList.toggle('on', x === b));
    renderDashboard();
  }));
document.querySelectorAll('#trendChips .dc-chip').forEach(b =>
  b.addEventListener('click', () => {
    dashTrendDays = Number(b.dataset.days);
    document.querySelectorAll('#trendChips .dc-chip').forEach(x => x.classList.toggle('on', x === b));
    renderDashboard();
  }));

/* ==================== 실시간 구독 (프로그램/공지) ==================== */
onSnapshot(
  query(collection(db, 'programs'), orderBy('createdAt', 'desc')),
  snap => {
    programs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminTable();
    renderApplicants();      // v10: 신청자 표의 운영기간 열 갱신
    renderDashboard();
    refreshAssignPrograms();
    if ($('mg-panel') && $('mg-panel').style.display !== 'none') refreshMigratePrograms();
    $('badgeProgram').textContent = programs.length;
    if ($('tab-assign').classList.contains('on')) renderAssign();
  },
  err => console.error('programs 구독 오류:', err)
);
onSnapshot(
  query(collection(db, 'notices'), orderBy('createdAt', 'desc')),
  snap => {
    notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    $('badgeNotice').textContent = notices.length;
    renderNoticeAdmin();
  },
  err => console.error('notices 구독 오류:', err)
);

/* =========================================================
   v13: 상시 온라인 워크샵 (과목별 차시)
   - 날짜가 있는 오프라인 워크샵(programs)과 분리된 데이터
   - onlineCourses/{key}/lessons/{id}  · enrollments/{id}/progress/{id}
========================================================= */

let clCourseKey = COURSES_2026[0].key;   // 현재 선택한 과목
let clCourseDoc = null;                  // onlineCourses 문서
let clLessons = [];                      // 이 과목의 차시
let clEnrolls = [];                      // 이 과목 수강생
let clProgress = {};                     // { enrollId: { lessonId: doc } }

function renderCourseTabs(){
  $('cl-courseTabs').innerHTML = COURSES_2026.map(c => `
    <button type="button" class="ctab ${c.key === clCourseKey ? 'on' : ''} ${c.group === '특화' ? 'sp' : ''}"
      onclick="pickCourse('${c.key}')">
      <span class="ci">${c.icon}</span>
      <span class="cn">${esc(c.name.split(':')[0])}</span>
      <span class="cl">${esc(c.level)}</span>
    </button>`).join('');
}
function pickCourse(key){ clCourseKey = key; renderCourseTabs(); renderClassroom(); }
window.pickCourse = pickCourse;

async function renderClassroom(){
  const c = courseByKey(clCourseKey);
  if (!c) return;
  renderCourseTabs();

  try {
    const d = await getDoc(doc(db, 'onlineCourses', clCourseKey));
    clCourseDoc = d.exists() ? d.data() : null;
  } catch { clCourseDoc = null; }

  const open = clCourseDoc ? clCourseDoc.open !== false : false;
  $('cl-summary').innerHTML = `
    <div><span>과목</span><b>${esc(c.name)}</b></div>
    <div><span>구분</span><b>${esc(c.group)}과정 · ${esc(c.level)}</b></div>
    <div><span>신청</span><b class="${open ? 'ok' : ''}">${open ? '🟢 수강 신청 받는 중' : '⚪ 준비 중(비공개)'}</b></div>`;

  try {
    const all = await getDocs(collection(db, 'onlineCourses'));
    $('badgeClass').textContent = all.docs.filter(d => d.data().open !== false).length;
  } catch { /* 무시 */ }

  $('cl-courseBox').style.display = 'block';
  $('oc-intro').value = (clCourseDoc && clCourseDoc.intro) || c.intro || '';
  $('oc-note').value  = (clCourseDoc && clCourseDoc.note) || '';
  $('oc-open').checked = open;

  $('cl-lessonBox').style.display = 'block';
  $('cl-progressBox').style.display = 'block';
  await loadLessons();
  await loadClassProgress();
}

/* ---------- 과목 설정 저장 ---------- */
$('courseForm').addEventListener('submit', async e => {
  e.preventDefault();
  const c = courseByKey(clCourseKey);
  const btn = $('courseSaveBtn');
  btn.disabled = true;
  try {
    await setDoc(doc(db, 'onlineCourses', clCourseKey), {
      key: clCourseKey, name: c.name, group: c.group, level: c.level, icon: c.icon,
      intro: $('oc-intro').value.trim(),
      note: $('oc-note').value.trim(),
      open: $('oc-open').checked,
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast('과목 설정을 저장했습니다.');
    await renderClassroom();
  } catch (err){
    $('courseError').textContent = fbError(err);
    $('courseError').style.display = 'block';
  } finally { btn.disabled = false; }
});

/* ---------- 차시 CRUD ---------- */
const lessonCol = () => collection(db, 'onlineCourses', clCourseKey, 'lessons');
const lessonDoc = id => doc(db, 'onlineCourses', clCourseKey, 'lessons', id);

async function loadLessons(){
  const tb = $('lessonTableBody');
  tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6A776F;">불러오는 중…</td></tr>';
  try {
    const snap = await getDocs(lessonCol());
    clLessons = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderLessonTable();
  } catch (err){
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#C64B3C;">${esc(fbError(err))}</td></tr>`;
  }
}

function renderLessonTable(){
  const tb = $('lessonTableBody');
  const on = clLessons.filter(l => l.mode !== 'offline').length;
  $('cl-lessonCount').textContent = clLessons.length
    ? `총 ${clLessons.length}차시 · 온라인 ${on} · 오프라인 ${clLessons.length - on}` : '';
  if (!clLessons.length){
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6A776F;">
      이 과목에 등록된 차시가 없습니다. [＋ 차시 추가]로 첫 차시를 만들어보세요.</td></tr>`;
    return;
  }
  tb.innerHTML = clLessons.map(l => {
    const online = l.mode !== 'offline';
    return `<tr>
      <td class="nowrap"><b>${l.order || '-'}차시</b></td>
      <td class="nowrap"><span class="lesson-mode ${online ? 'on' : 'off'}">
        ${online ? '💻 온라인' : '🧰 오프라인'}</span></td>
      <td><b>${esc(l.title)}</b>${l.desc ? `<br><span class="cell-sub">${esc(l.desc)}</span>` : ''}</td>
      <td class="cell-sub">${online
        ? (l.videoId ? `<code class="detail-code">${esc(l.videoId)}</code>${l.durationSec ? ` · ${fmtDur(l.durationSec)}` : ' · <span style="color:#C64B3C;">길이 미입력</span>'}` : '<span style="color:#C64B3C;">영상 미등록</span>')
        : esc(l.place || '-')}</td>
      <td class="nowrap">${l.required !== false ? '✅' : '—'}</td>
      <td class="nowrap">${l.hasTask ? '📝' : '—'}</td>
      <td><div class="t-actions">
        <button class="mini-btn" onclick="editLesson('${l.id}')">수정</button>
        <button class="mini-btn danger" onclick="deleteLesson('${l.id}')">삭제</button>
      </div></td>
    </tr>`;
  }).join('');
}

function fmtDur(sec){
  const s = Number(sec) || 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function parseDur(v){
  const t = String(v || '').trim();
  if (!t) return 0;
  if (t.includes(':')){ const [m, s] = t.split(':'); return (Number(m) || 0) * 60 + (Number(s) || 0); }
  return Number(t) || 0;
}
function parseVideoId(v){
  const t = String(v || '').trim();
  if (!t) return '';
  const m = t.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  return '';
}

function toggleLessonForm(force){
  const f = $('lessonForm');
  const open = force === undefined ? f.style.display === 'none' : !!force;
  f.style.display = open ? 'block' : 'none';
  $('cl-addBtn').textContent = open ? '✕ 닫기' : '＋ 차시 추가';
  if (open){
    if (!$('l-id').value) $('l-order').value = clLessons.reduce((m, l) => Math.max(m, l.order || 0), 0) + 1;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else resetLessonForm();
}
function resetLessonForm(){
  $('lessonForm').reset();
  $('l-id').value = '';
  $('l-required').checked = true;
  $('lessonError').style.display = 'none';
  $('lessonSaveBtn').textContent = '차시 저장';
  paintLessonMode();
}
function paintLessonMode(){
  const online = $('l-mode').value !== 'offline';
  $('l-onlineFields').style.display  = online ? '' : 'none';
  $('l-offlineFields').style.display = online ? 'none' : '';
  $('l-taskRow').style.display = $('l-hasTask').checked ? '' : 'none';
}
$('l-mode').addEventListener('change', paintLessonMode);
$('l-hasTask').addEventListener('change', paintLessonMode);

function editLesson(id){
  const l = clLessons.find(x => x.id === id);
  if (!l) return;
  $('l-id').value       = l.id;
  $('l-order').value    = l.order || 1;
  $('l-mode').value     = l.mode || 'online';
  $('l-title').value    = l.title || '';
  $('l-desc').value     = l.desc || '';
  $('l-url').value      = l.videoId || '';
  $('l-duration').value = l.durationSec ? fmtDur(l.durationSec) : '';
  $('l-place').value    = l.place || '';
  $('l-required').checked = l.required !== false;
  $('l-hasTask').checked  = !!l.hasTask;
  $('l-task').value     = l.taskDesc || '';
  $('lessonSaveBtn').textContent = '수정 저장';
  paintLessonMode();
  toggleLessonForm(true);
}

$('lessonForm').addEventListener('submit', async e => {
  e.preventDefault();
  const online = $('l-mode').value !== 'offline';
  const videoId = online ? parseVideoId($('l-url').value) : '';
  if (online && $('l-url').value.trim() && !videoId){
    $('lessonError').textContent = 'YouTube 주소를 인식하지 못했습니다. 링크 전체 또는 11자리 영상 ID를 입력해주세요.';
    $('lessonError').style.display = 'block';
    return;
  }
  const durationSec = online ? parseDur($('l-duration').value) : 0;
  if (online && videoId && !durationSec){
    $('lessonError').textContent = '영상 길이를 입력해주세요. 이수 판정(90%) 기준이라 비워두면 진도가 오르지 않습니다.';
    $('lessonError').style.display = 'block';
    return;
  }
  const data = {
    order: Number($('l-order').value),
    mode: $('l-mode').value,
    title: $('l-title').value.trim(),
    desc: $('l-desc').value.trim(),
    videoId, durationSec,
    place: online ? '' : $('l-place').value.trim(),
    required: $('l-required').checked,
    hasTask: $('l-hasTask').checked,
    taskDesc: $('l-hasTask').checked ? $('l-task').value.trim() : ''
  };
  const btn = $('lessonSaveBtn');
  btn.disabled = true;
  try {
    const id = $('l-id').value;
    if (id) await updateDoc(lessonDoc(id), data);
    else    await addDoc(lessonCol(), { ...data, createdAt: serverTimestamp() });
    const c = courseByKey(clCourseKey);
    await setDoc(doc(db, 'onlineCourses', clCourseKey),
      { key: clCourseKey, name: c.name, group: c.group, level: c.level, icon: c.icon }, { merge: true });
    toast(id ? '차시를 수정했습니다.' : '차시를 추가했습니다.');
    resetLessonForm(); toggleLessonForm(false);
    await loadLessons(); await loadClassProgress();
  } catch (err){
    $('lessonError').textContent = fbError(err);
    $('lessonError').style.display = 'block';
  } finally { btn.disabled = false; }
});

async function deleteLesson(id){
  const l = clLessons.find(x => x.id === id);
  if (!l || !confirm(`[${l.order}차시 · ${l.title}]\n차시를 삭제할까요?\n수강생의 학습 기록은 남지만 화면에서는 보이지 않게 됩니다.`)) return;
  try {
    await deleteDoc(lessonDoc(id));
    toast('차시를 삭제했습니다.');
    await loadLessons(); await loadClassProgress();
  } catch (err){ alert(fbError(err)); }
}
Object.assign(window, { toggleLessonForm, editLesson, deleteLesson, resetLessonForm });

/* ---------- 수강생 학습 현황 ---------- */
async function loadClassProgress(){
  const head = $('progHead'), body = $('progBody');
  try {
    const snap = await getDocs(query(collection(db, 'enrollments'), where('courseKey', '==', clCourseKey)));
    clEnrolls = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => tsNum(b.createdAt) - tsNum(a.createdAt));
  } catch (err){
    head.innerHTML = '';
    body.innerHTML = `<tr><td style="text-align:center;color:#C64B3C;padding:24px;">${esc(fbError(err))}</td></tr>`;
    return;
  }
  $('cl-progCount').textContent = clEnrolls.length ? `수강생 ${clEnrolls.length}명` : '';

  if (!clLessons.length){
    head.innerHTML = '';
    body.innerHTML = '<tr><td style="text-align:center;color:#6A776F;padding:24px;">먼저 차시를 등록해주세요.</td></tr>';
    return;
  }
  head.innerHTML = `<tr><th>수강생</th>
    ${clLessons.map(l => `<th class="prog-col" title="${esc(l.title)}">${l.order}<br>
      <span class="cell-sub">${l.mode === 'offline' ? '🧰' : '💻'}</span></th>`).join('')}
    <th>진도</th><th>관리</th></tr>`;

  if (!clEnrolls.length){
    body.innerHTML = `<tr><td colspan="${clLessons.length + 3}" style="text-align:center;color:#6A776F;padding:24px;">
      아직 이 과목을 신청한 수강생이 없습니다.</td></tr>`;
    return;
  }
  body.innerHTML = `<tr><td colspan="${clLessons.length + 3}" style="text-align:center;color:#6A776F;padding:20px;">학습 기록을 불러오는 중…</td></tr>`;
  clProgress = {};
  for (const e of clEnrolls){
    try {
      const snap = await getDocs(collection(db, 'enrollments', e.id, 'progress'));
      clProgress[e.id] = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    } catch { clProgress[e.id] = {}; }
  }
  renderProgressTable();
}
window.loadClassProgress = loadClassProgress;

function lessonDone(eid, l){
  const pr = (clProgress[eid] || {})[l.id];
  if (!pr) return false;
  if (l.mode === 'offline') return !!pr.done;
  if (pr.done) return true;
  if (!l.durationSec) return false;
  return (pr.watchedSec || 0) >= l.durationSec * 0.9;
}
function progRate(eid){
  const req = clLessons.filter(l => l.required !== false);
  if (!req.length) return 0;
  return Math.round(req.filter(l => lessonDone(eid, l)).length / req.length * 100);
}

function renderProgressTable(){
  $('progBody').innerHTML = clEnrolls.map(e => {
    const rate = progRate(e.id);
    return `<tr>
      <td class="nowrap"><b>${esc(e.name)}</b>${e.completed ? '<span class="chip member">수료</span>' : ''}
        ${e.addedBy === 'admin' ? '<span class="chip">직접등록</span>' : ''}
        <br><span class="cell-sub">${esc(e.org || '')} · ${esc(tsText(e.createdAt, false))} 신청
        ${e.certNo ? `<br>🎓 ${esc(e.certNo)}` : ''}</span></td>
      ${clLessons.map(l => {
        const pr = (clProgress[e.id] || {})[l.id] || {};
        const done = lessonDone(e.id, l);
        const pct = l.mode !== 'offline' && l.durationSec
          ? Math.min(100, Math.round((pr.watchedSec || 0) / l.durationSec * 100)) : null;
        const task = l.hasTask
          ? (pr.taskAt ? `<button class="task-mark ok" onclick="openTask('${e.id}','${l.id}')" title="제출한 과제 보기">📝</button>`
                       : '<span class="task-mark none" title="과제 미제출">📝</span>')
          : '';
        const cell = l.mode === 'offline'
          ? `<button class="att-btn ${done ? 'on' : ''}" onclick="toggleAttend('${e.id}','${l.id}')"
               title="${done ? '출석 취소' : '출석 체크'}">${done ? '✅' : '○'}</button>`
          : `<span class="pr-cell ${done ? 'done' : ''}" title="${pct != null ? pct + '% 시청' : '기록 없음'}">
               ${done ? '✅' : (pct ? pct + '%' : '—')}</span>`;
        return `<td class="prog-col">${cell}${task}</td>`;
      }).join('')}
      <td class="nowrap"><div class="rate-wrap"><div class="rate-bar"><i style="width:${rate}%"></i></div>
        <b class="${rate === 100 ? 'full' : ''}">${rate}%</b></div></td>
      <td><div class="t-actions">
        <button class="mini-btn" onclick="toggleEnrollDone('${e.id}')">${e.completed ? '수료취소' : '수료처리'}</button>
        <button class="mini-btn danger" onclick="deleteEnroll('${e.id}')">삭제</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function toggleAttend(eid, lessonId){
  const cur = (clProgress[eid] || {})[lessonId] || {};
  const next = !cur.done;
  try {
    await setDoc(doc(db, 'enrollments', eid, 'progress', lessonId), {
      done: next, doneAt: next ? serverTimestamp() : null,
      checkedBy: 'admin', lastAt: serverTimestamp()
    }, { merge: true });
    clProgress[eid] = clProgress[eid] || {};
    clProgress[eid][lessonId] = { ...cur, done: next };
    renderProgressTable();
    toast(next ? '출석 처리했습니다.' : '출석을 취소했습니다.');
  } catch (err){ alert(fbError(err)); }
}
window.toggleAttend = toggleAttend;

/** 온라인 수강 수료 처리 — 이수증 발급번호를 함께 채번합니다.
    (신청자 탭의 수료 처리와 동일한 채번기를 사용해 번호가 겹치지 않습니다)
    진도와 무관하게 처리할 수 있습니다. 노션 등 외부에서 이미 수강한 분,
    오프라인으로 전 차시를 이수한 분도 관리자가 직접 인정할 수 있습니다. */
async function issueEnrollCert(eid){
  const year = new Date().getFullYear();
  let certNo = '';
  await runTransaction(db, async t => {
    const cRef = doc(db, 'counters', 'certificates');
    const cSnap = await t.get(cRef);
    const seq = (cSnap.exists() ? (cSnap.data().seq || 0) : 0) + 1;
    certNo = `한신새싹 제 ${year}-${String(seq).padStart(4, '0')} 호`;
    t.set(cRef, { seq, year });
    t.update(doc(db, 'enrollments', eid), {
      completed: true, completedAt: serverTimestamp(), certNo
    });
  });
  return certNo;
}

async function toggleEnrollDone(eid){
  const e = clEnrolls.find(x => x.id === eid);
  if (!e) return;

  if (e.completed){
    if (!confirm(`${e.name} 님의 수료 처리를 취소할까요?\n` +
      `발급번호(${e.certNo || '-'})는 회수되며, 기발급 이수증은 무효 처리해야 합니다.`)) return;
    try {
      await updateDoc(doc(db, 'enrollments', eid), {
        completed: false, completedAt: deleteField(), certNo: deleteField()
      });
      e.completed = false; e.certNo = '';
      renderProgressTable();
      toast('수료를 취소했습니다.');
    } catch (err){ alert(fbError(err)); }
    return;
  }

  const rate = progRate(eid);
  const warn = rate < 100
    ? `\n\n⚠️ 현재 진도는 ${rate}%입니다.\n` +
      `외부(노션 등)에서 이미 수강했거나 오프라인으로 이수한 경우라면 그대로 진행하세요.`
    : '';
  if (!confirm(`${e.name} 님 (${e.courseName})\n수료 처리하고 이수증 발급번호를 채번할까요?${warn}`)) return;

  try {
    const certNo = await issueEnrollCert(eid);
    await notifyEnrollCert(e, certNo);
    e.completed = true; e.certNo = certNo;
    renderProgressTable();
    toast(`수료 처리 완료 · ${certNo}`);
  } catch (err){ alert(fbError(err)); }
}
window.toggleEnrollDone = toggleEnrollDone;

/** 온라인 수강 수료 안내 메일 (템플릿 미설정 시 자동 생략) */
async function notifyEnrollCert(e, certNo){
  if (!certEmailEnabled() || !e.email) return;
  const base = location.href.replace(/admin\.html.*$/, '');
  await sendCertificateEmail({
    to_email: e.email,
    name: e.name,
    program: '디지털새싹 온라인 강사 워크샵',
    course: e.courseName || '',
    cert_no: certNo,
    cert_url: `${base}cert.html?id=${e.id}`,
    date: new Date().toLocaleDateString('ko-KR', { dateStyle: 'long' })
  }).catch(() => {});
}

/* ---------- 수강생 직접 추가 (외부 수강자 인정용) ---------- */
function openAddEnroll(){
  const c = courseByKey(clCourseKey);
  if (!membersLoaded){ alert('회원 명단을 불러오는 중입니다. 잠시 후 다시 시도해주세요.'); loadMembers(); return; }
  const already = new Set(clEnrolls.map(e => e.uid));
  const list = members.filter(m => !already.has(m.uid));

  $('ae-course').value = c.name;
  $('ae-member').innerHTML = '<option value="">회원을 선택하세요</option>' +
    list.map(m => `<option value="${m.uid}">${esc(m.name || '이름없음')} · ${esc(m.email || '')}${m.org ? ` · ${esc(m.org)}` : ''}</option>`).join('');
  $('ae-done').checked = false;
  $('aeError').style.display = 'none';
  openModal('addEnrollModal');
}
window.openAddEnroll = openAddEnroll;

$('addEnrollForm').addEventListener('submit', async e => {
  e.preventDefault();
  const uid = $('ae-member').value;
  const m = members.find(x => x.uid === uid);
  const c = courseByKey(clCourseKey);
  if (!m){
    $('aeError').textContent = '회원을 선택해주세요.';
    $('aeError').style.display = 'block';
    return;
  }
  const btn = $('aeSaveBtn');
  btn.disabled = true; btn.textContent = '등록 중…';
  try {
    const ref = await addDoc(collection(db, 'enrollments'), {
      uid: m.uid,
      name: m.name || '',
      email: m.email || '',
      phone: m.phone || '',
      org: m.org || '',
      orgType: m.orgType || '',
      courseKey: clCourseKey,
      courseName: c.name,
      completed: false,
      createdAt: serverTimestamp(),
      addedBy: 'admin',
      addNote: $('ae-note').value.trim()
    });
    if ($('ae-done').checked){
      const certNo = await issueEnrollCert(ref.id);
      await notifyEnrollCert({ ...m, courseName: c.name, id: ref.id }, certNo);
      toast(`등록 후 수료 처리했습니다 · ${certNo}`);
    } else {
      toast('수강생을 등록했습니다.');
    }
    closeModal('addEnrollModal');
    await loadClassProgress();
  } catch (err){
    $('aeError').textContent = fbError(err);
    $('aeError').style.display = 'block';
  } finally { btn.disabled = false; btn.textContent = '등록'; }
});

async function deleteEnroll(eid){
  const e = clEnrolls.find(x => x.id === eid);
  if (!e || !confirm(`${e.name} 님의 수강 신청을 삭제할까요?\n학습 기록도 함께 사라집니다.`)) return;
  try {
    await deleteDoc(doc(db, 'enrollments', eid));
    toast('수강 신청을 삭제했습니다.');
    await loadClassProgress();
  } catch (err){ alert(fbError(err)); }
}
window.deleteEnroll = deleteEnroll;

function openTask(eid, lessonId){
  const e = clEnrolls.find(x => x.id === eid);
  const l = clLessons.find(x => x.id === lessonId);
  const pr = (clProgress[eid] || {})[lessonId] || {};
  if (!e || !l) return;
  $('tk-title').textContent = `${e.name} 님 · ${l.order}차시 과제`;
  $('tk-body').innerHTML = `
    <h4 class="detail-h">과제 안내</h4>
    <p class="member-empty" style="border-style:solid;">${esc(l.taskDesc || '(안내 없음)')}</p>
    <h4 class="detail-h">제출 내용</h4>
    <dl class="detail-dl">
      ${pr.taskAt ? `<dt>제출 일시</dt><dd>${esc(tsText(pr.taskAt))}</dd>` : ''}
      ${pr.taskUrl ? `<dt>제출 링크</dt><dd><a href="${esc(pr.taskUrl)}" target="_blank" rel="noopener">${esc(pr.taskUrl)}</a></dd>` : ''}
      ${pr.taskText ? `<dt>작성 내용</dt><dd>${esc(pr.taskText).replace(/\n/g, '<br>')}</dd>` : ''}
      ${!pr.taskAt ? '<dt>상태</dt><dd><span class="cell-sub">아직 제출하지 않았습니다.</span></dd>' : ''}
      ${pr.taskReview ? `<dt>검토 메모</dt><dd>${esc(pr.taskReview)}</dd>` : ''}
    </dl>`;
  $('tk-actions').innerHTML = pr.taskAt
    ? `<button class="btn btn-navy btn-sm" onclick="reviewTask('${eid}','${lessonId}',true)">✅ 과제 인정 (차시 완료 처리)</button>
       <button class="btn btn-outline btn-sm" onclick="reviewTask('${eid}','${lessonId}',false)">↩️ 보완 요청</button>`
    : '';
  openModal('taskModal');
}
window.openTask = openTask;

async function reviewTask(eid, lessonId, ok){
  const memo = prompt(ok ? '검토 메모 (선택)' : '보완 요청 사유를 적어주세요.', '');
  if (!ok && memo === null) return;
  try {
    await setDoc(doc(db, 'enrollments', eid, 'progress', lessonId), {
      taskReview: memo || '', taskOk: ok,
      ...(ok ? { done: true, doneAt: serverTimestamp() } : {}),
      lastAt: serverTimestamp()
    }, { merge: true });
    closeModal('taskModal');
    toast(ok ? '과제를 인정했습니다.' : '보완 요청을 남겼습니다.');
    await loadClassProgress();
  } catch (err){ alert(fbError(err)); }
}
window.reviewTask = reviewTask;

function downloadProgressCSV(){
  if (!clEnrolls.length){ alert('내보낼 수강생이 없습니다.'); return; }
  const c = courseByKey(clCourseKey);
  const head = ['신청일', '이름', '소속', '이메일', '전화번호',
    ...clLessons.map(l => `${l.order}차시 ${l.mode === 'offline' ? '(오프라인)' : '(온라인)'} ${l.title}`),
    ...clLessons.filter(l => l.hasTask).map(l => `${l.order}차시 과제`),
    '진도율(%)', '수료'];
  const rows = [head];
  clEnrolls.forEach(e => {
    const pg = clProgress[e.id] || {};
    rows.push([tsText(e.createdAt, false), e.name, e.org || '', e.email || '', e.phone || '',
      ...clLessons.map(l => {
        const pr = pg[l.id] || {};
        if (l.mode === 'offline') return pr.done ? '출석' : '미출석';
        if (lessonDone(e.id, l)) return '완료';
        if (l.durationSec && pr.watchedSec) return `${Math.round(pr.watchedSec / l.durationSec * 100)}%`;
        return '미시청';
      }),
      ...clLessons.filter(l => l.hasTask).map(l => {
        const pr = pg[l.id] || {};
        return pr.taskAt ? (pr.taskUrl || pr.taskText || '제출').toString().slice(0, 200) : '미제출';
      }),
      progRate(e.id), e.completed ? '수료' : '']);
  });
  saveCSV(rows, `디지털새싹_온라인워크샵_${c.name.split(':')[0]}_${todayStr().replace(/\./g, '')}.csv`);
  toast(`CSV ${clEnrolls.length}건을 내려받았습니다.`);
}
window.downloadProgressCSV = downloadProgressCSV;

/* =========================================================
   v13: 기존 신청 데이터 → 상시 온라인 워크샵 이관
   프로그램(오프라인 형태)으로 받아둔 온라인 워크샵 신청을
   과목별 수강 등록(enrollments)으로 옮깁니다.
   · 원본 applications 문서는 삭제하지 않고 이관 표시만 남깁니다.
   · 회원 계정(uid)이 없는 비회원 신청은 이관할 수 없습니다.
========================================================= */

let mgRows = [];

function toggleMigrate(){
  const p = $('mg-panel');
  const open = p.style.display === 'none';
  p.style.display = open ? 'block' : 'none';
  $('mg-toggleBtn').textContent = open ? '닫기' : '열기';
  if (open) refreshMigratePrograms();
}
window.toggleMigrate = toggleMigrate;

function refreshMigratePrograms(){
  const sel = $('mg-program');
  const cur = sel.value;
  const list = programs.filter(p => p.type === 'workshop');
  sel.innerHTML = '<option value="">프로그램을 선택하세요</option>' +
    list.map(p => `<option value="${p.id}">${esc(p.title)}${p.period ? ` · ${esc(p.period)}` : ''}</option>`).join('');
  if (list.some(p => p.id === cur)) sel.value = cur;
}

async function scanMigrate(){
  const pid = $('mg-program').value;
  const box = $('mg-result');
  $('mg-actions').style.display = 'none';
  if (!pid){ box.innerHTML = '<div class="assign-empty">원본 프로그램을 선택해주세요.</div>'; return; }

  box.innerHTML = '<div class="assign-empty">신청 내역을 확인하는 중…</div>';

  /* 이미 이관된 수강 등록 (중복 방지) */
  let existing = new Set();
  try {
    const snap = await getDocs(collection(db, 'enrollments'));
    existing = new Set(snap.docs.map(d => `${d.data().uid}|${d.data().courseKey}`));
  } catch (err){
    box.innerHTML = `<div class="assign-empty">${esc(fbError(err))}</div>`;
    return;
  }

  const apps = applications.filter(a => a.programId === pid);
  if (!apps.length){
    box.innerHTML = '<div class="assign-empty">이 프로그램에는 신청 내역이 없습니다.</div>';
    return;
  }

  mgRows = apps.map(a => {
    const key = guessCourseKey(a.course || a.session);
    let state = 'ok', note = '';
    if (!a.uid){ state = 'nouid'; note = '비회원 신청 — 계정 연결 후 이관 가능'; }
    else if (a.migratedEnrollId){ state = 'done'; note = '이미 이관됨'; }
    else if (key && existing.has(`${a.uid}|${key}`)){ state = 'dup'; note = '이미 같은 과목을 수강 중'; }
    else if (!key){ state = 'nokey'; note = '과목을 직접 선택해주세요'; }
    return { a, key, state, note };
  });

  const okN = mgRows.filter(r => r.state === 'ok').length;
  box.innerHTML = `
    <div class="mg-summary">
      전체 <b>${mgRows.length}건</b> ·
      이관 가능 <b class="ok">${okN}건</b> ·
      제외 <b>${mgRows.length - okN}건</b>
    </div>
    <div class="table-scroll">
      <table class="admin-table compact">
        <thead><tr><th class="c-check"><input type="checkbox" onchange="mgSelectAll(this.checked)"></th>
          <th>신청자</th><th>원본 강좌</th><th>이관할 과목</th><th>상태</th></tr></thead>
        <tbody>${mgRows.map((r, i) => `
          <tr class="${r.state === 'ok' ? '' : 'mg-skip'}">
            <td class="c-check"><input type="checkbox" data-mg="${i}"
              ${r.state === 'ok' ? 'checked' : 'disabled'} onchange="mgCount()"></td>
            <td><b>${esc(r.a.name)}</b><br><span class="cell-sub">${esc(r.a.email || '-')}</span></td>
            <td class="cell-sub">${esc(r.a.course || r.a.session || '-')}</td>
            <td>${r.state === 'nouid' || r.state === 'done'
              ? '<span class="cell-sub">—</span>'
              : `<select data-mgkey="${i}" onchange="mgSetKey(${i}, this.value)">
                   <option value="">과목 선택…</option>
                   ${COURSES_2026.map(c => `<option value="${c.key}"${c.key === r.key ? ' selected' : ''}>
                     ${esc(c.name.split(':')[0])} · ${esc(c.level)}</option>`).join('')}
                 </select>`}</td>
            <td class="cell-sub">${r.state === 'ok'
              ? '<span style="color:var(--leaf);font-weight:700;">이관 가능</span>'
              : esc(r.note)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
  $('mg-actions').style.display = 'block';
  mgCount();
}
window.scanMigrate = scanMigrate;

function mgSetKey(i, key){
  mgRows[i].key = key;
  const cb = document.querySelector(`input[data-mg="${i}"]`);
  if (cb && mgRows[i].state === 'nokey' && key){ cb.disabled = false; cb.checked = true; }
  mgCount();
}
function mgSelectAll(on){
  document.querySelectorAll('input[data-mg]').forEach(c => { if (!c.disabled) c.checked = on; });
  mgCount();
}
function mgCount(){
  const n = [...document.querySelectorAll('input[data-mg]:checked')].length;
  $('mg-count').textContent = `${n}건 선택`;
  $('mg-runBtn').disabled = n === 0;
}
Object.assign(window, { mgSetKey, mgSelectAll, mgCount });

async function runMigrate(){
  const picked = [...document.querySelectorAll('input[data-mg]:checked')].map(c => Number(c.dataset.mg));
  if (!picked.length) return;

  const missing = picked.filter(i => !mgRows[i].key);
  if (missing.length){
    alert(`과목이 지정되지 않은 항목이 ${missing.length}건 있습니다.\n표에서 '이관할 과목'을 선택해주세요.`);
    return;
  }
  if (!confirm(`${picked.length}건을 상시 온라인 워크샵 수강 등록으로 이관할까요?\n\n` +
    `· 원본 신청 내역은 삭제되지 않습니다.\n` +
    `· 시청 기록은 차시 구조가 달라 옮겨지지 않습니다. 진도는 0%에서 시작합니다.`)) return;

  const btn = $('mg-runBtn');
  btn.disabled = true; btn.textContent = '이관 중…';
  let ok = 0, fail = 0;

  for (const i of picked){
    const { a, key } = mgRows[i];
    const c = courseByKey(key);
    if (!c){ fail++; continue; }
    try {
      const ref = await addDoc(collection(db, 'enrollments'), {
        uid: a.uid,
        name: a.name || '',
        email: a.email || '',
        phone: a.phone || '',
        org: a.org || '',
        orgType: a.orgType || '',
        courseKey: key,
        courseName: c.name,
        completed: !!a.completed,
        completedAt: a.completedAt || null,
        createdAt: a.createdAt || serverTimestamp(),
        migratedFrom: a.id                       // 원본 신청번호
      });
      await updateDoc(doc(db, 'applications', a.id), {
        migratedEnrollId: ref.id,
        migratedAt: serverTimestamp()
      }).catch(() => {});
      ok++;
    } catch (err){ console.error(err); fail++; }
  }

  btn.disabled = false; btn.textContent = '선택한 신청을 새 구조로 이관';
  toast(`이관 완료 · 성공 ${ok}건${fail ? ` · 실패 ${fail}건` : ''}`);
  await scanMigrate();
  await loadClassProgress();
}
window.runMigrate = runMigrate;
