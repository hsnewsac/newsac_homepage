/* =========================================================
   관리자 페이지 v5
   - 탭 구조 (대시보드 / 프로그램 / 공지 / 신청자 / 강사 회원)
   - 신청자: 검색·필터·정렬·페이지네이션·일괄처리·선택 CSV
   - 수료 처리 시 수료 안내 메일 자동 발송(템플릿 설정 시)
   - 강사 회원 명단 조회 (강사모집·강의배정 대비)
========================================================= */
import { db, auth } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc,
  query, orderBy, where, getDocs, increment, serverTimestamp,
  runTransaction, deleteField
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initLayout, esc, ddayInfo, todayStr, catClass, fbError,
  KIND, ORG_TYPES, SPECIALTIES, REGIONS, CAREER_LEVELS,
  COURSES_2026, WORKSHOP_TARGET, qualificationHTML,
  SCHOOL_LEVELS, CAMP_MODES, RECRUIT_ROLES, fmtPeriodKo,
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
$('r-mode').innerHTML = CAMP_MODES.map(v => `<option>${esc(v)}</option>`).join('');

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
  subscribeApplications();
});

/* ==================== 프로그램 ==================== */
$('programForm').addEventListener('submit', async e => {
  e.preventDefault();
  const idVal = $('p-id').value;
  const extra = $('p-courseExtra').value.split(',').map(v => v.trim()).filter(Boolean);
  const start = $('p-start').value, end = $('p-end').value;
  if (start && end && start > end){ alert('운영 종료일이 시작일보다 빠릅니다.'); return; }
  const data = {
    type: $('p-type').value,
    title: $('p-title').value.trim(),
    target: $('p-target').value.trim(),
    startDate: start,
    endDate: end,
    period: fmtPeriodKo(start, end),
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
      await updateDoc(doc(db, 'programs', idVal), data);
      toast('프로그램을 수정했습니다.');
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
function editProgram(id){
  const p = programs.find(x => x.id === id);
  if (!p) return;
  /* v10: 강사 모집 공고는 [강사 배정] 탭의 전용 폼에서 수정합니다 */
  if (p.type === 'recruit'){ editRecruit(id); return; }
  switchTab('program');
  $('p-id').value = p.id;
  /* v10: '집합형 연수(camp)'는 신규 등록에서 제외했지만,
     기존에 등록된 camp 프로그램을 수정할 때는 유형이 비어버리지 않도록
     임시 옵션을 넣어줍니다. (저장하면 그대로 camp로 유지됩니다) */
  if (p.type && !$('p-type').querySelector(`option[value="${p.type}"]`)){
    const opt = document.createElement('option');
    opt.value = p.type;
    opt.textContent = `${KIND[p.type] || p.type} (이전 유형)`;
    opt.dataset.legacy = '1';
    $('p-type').prepend(opt);
  }
  $('p-type').value = p.type;
  $('p-title').value = p.title;
  $('p-target').value = p.target || WORKSHOP_TARGET;
  $('p-start').value = p.startDate || '';
  $('p-end').value   = p.endDate || '';
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
  /* 수정 중 추가된 이전 유형 옵션 제거 */
  $('p-type').querySelectorAll('option[data-legacy]').forEach(o => o.remove());
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
    return `<tr>
      <td><span class="chip ${p.type}">${KIND[p.type] || ''}</span>
        ${p.loginOnly ? '<span class="chip lock" title="로그인 회원만 신청 가능">🔐</span>' : ''}</td>
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
  keep($('f-program'), [...new Set(applications.map(a => a.programTitle).filter(Boolean))]);
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

function filteredApps(){
  const q = $('f-q').value.trim().toLowerCase();
  const fp = $('f-program').value, fc = $('f-course').value;
  const fo = $('f-orgtype').value, fs = $('f-status').value, fm = $('f-member').value;
  const fa = $('f-astatus').value;

  let list = applications.filter(a => {
    if (fp && a.programTitle !== fp) return false;
    if (fc && (a.course || a.session) !== fc) return false;
    if (fo && a.orgType !== fo) return false;
    if (fs === 'done' && !a.completed) return false;
    if (fs === 'wait' && a.completed) return false;
    if (fa && statusOf(a) !== fa) return false;
    if (fm === 'linked' && !a.uid) return false;
    if (fm === 'guest' && a.uid) return false;
    if (q){
      const hay = [a.name, a.org, a.email, a.phone, a.id, a.programTitle,
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
      <div class="ai-prog">${esc(a.programTitle) || '-'}${a.programType === 'recruit' ? '<span class="chip recruit">모집</span>' : ''}</div>
      <div class="ai-sub">
        <span class="ai-when">🗓 ${progPeriod(a) ? esc(progPeriod(a)) : '일정 미등록'}</span>
        <span class="ai-got">접수 ${esc(tsText(a.createdAt))}</span>
      </div>
    </td>
    <td>${esc(a.course || a.session) || '-'}</td>
    <td><b>${esc(a.name)}</b>${a.uid ? '<span class="chip member" title="회원 계정으로 신청">회원</span>' : ''}</td>
    <td>${esc(a.org)}</td>
    <td>${esc(a.orgType) || '-'}</td>
    <td class="nowrap"><span class="cell-sub">${esc(a.phone)}<br>${esc(a.email) || '-'}</span></td>
    <td>${statusChip(a)}${a.assignPlace ? `<br><span class="cell-sub">${esc(a.assignPlace)}</span>` : ''}</td>
    <td>${a.completed
      ? `<span class="status-chip done">수료</span><br><span class="cell-sub">${esc(a.certNo || '')}</span>`
      : '<span class="status-chip wait">미수료</span>'}</td>
    <td class="c-act"><div class="t-actions">
      <button class="mini-btn" onclick="openAssign('${a.id}')">${a.programType === 'recruit' ? '배정/상태' : '승인/상태'}</button>
      <button class="mini-btn" onclick="openEditApp('${a.id}')">✏️ 수정</button>
      ${a.completed
        ? `<a class="mini-btn" href="cert.html?id=${a.id}" target="_blank" rel="noopener">이수증</a>
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
    program: a.programTitle || '',
    course: a.course || a.session || '',
    cert_no: certNo,
    cert_url: `${base}cert.html?id=${a.id}`,
    date: new Date().toLocaleDateString('ko-KR', { dateStyle: 'long' })
  });
}

async function completeApp(id){
  const a = applications.find(x => x.id === id);
  if (!a || !confirm(`${a.name}님 (${a.programTitle} · ${a.course || ''})\n수료 처리하고 이수증 발급번호를 채번할까요?`)) return;
  try {
    const certNo = await issueCert(id);
    await notifyCert(a, certNo);
    toast(`수료 처리 완료 · ${certNo}`);
  } catch (err) { alert(fbError(err)); }
}
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

/* ==================== 신청자: 일괄 처리 ==================== */
function pickSelected(){
  const list = applications.filter(a => selected.has(a.id));
  if (!list.length) alert('먼저 표에서 대상을 선택해주세요.');
  return list;
}
async function bulkComplete(){
  const list = pickSelected().filter(a => !a.completed);
  if (!list.length){ if (selected.size) alert('선택된 항목이 모두 이미 수료 처리되어 있습니다.'); return; }
  const mailNote = certEmailEnabled() ? '\n수료 안내 메일도 함께 발송됩니다.' : '';
  if (!confirm(`선택한 ${list.length}명을 일괄 수료 처리할까요?\n이수증 발급번호가 순차 채번됩니다.${mailNote}`)) return;

  let ok = 0, fail = 0;
  for (const a of list){
    try {
      const certNo = await issueCert(a.id);
      await notifyCert(a, certNo).catch(()=>{});
      ok++;
    } catch (e){ console.error(e); fail++; }
  }
  selected.clear();
  toast(`일괄 수료 처리 ${ok}건 완료${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok');
}
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
    ['프로그램', a.programTitle || '-'],
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
    ${row('프로그램', `${txt(a.programTitle) || '-'} <span class="chip">${txt(KIND[a.programType] || '신청')}</span>`)}
    ${row('운영 기간', txt(progPeriod(a)) || '<span class="cell-sub">일정 미등록</span>')}
    ${row('운영 장소', txt(progPlace(a)))}
    ${row(assignMode ? '지원 분야' : '강좌', txt(a.course || a.session))}
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
  $('ea-program').value = `${a.programTitle || '-'}${progPeriod(a) ? ` · ${progPeriod(a)}` : ''}`;

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
  $('r-role').value      = p.role || RECRUIT_ROLES[0];
  $('r-mode').value      = p.mode || CAMP_MODES[0];
  $('r-start').value     = p.startDate || '';
  $('r-end').value       = p.endDate || '';
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
  if (start && end && start > end){ alert('활동 종료일이 시작일보다 빠릅니다.'); return; }
  const data = {
    type: 'recruit',
    title:   $('r-title').value.trim(),
    target:  $('r-target').value.trim(),
    role:    $('r-role').value,
    mode:    $('r-mode').value,
    startDate: start,
    endDate:   end,
    period:  fmtPeriodKo(start, end),
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
  if (!data.levels.length){ alert('대상 학교급을 1개 이상 선택해주세요.'); return; }
  if (!data.courses.length){ alert('담당 과정을 1개 이상 선택해주세요.'); return; }
  const btn = $('rFormSubmit');
  btn.disabled = true;
  try {
    if (idVal){
      await updateDoc(doc(db, 'programs', idVal), data);
      toast('모집 공고를 수정했습니다.');
      resetRecruitForm();
      toggleRecruitForm(false);
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
    tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#6A776F;">아직 지원자가 없습니다. 아래 강사 후보 검색에서 직접 등록할 수 있습니다.</td></tr>';
  } else {
    tb.innerHTML = apps
      .slice().sort((a,b) => STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)) || tsNum(b.createdAt) - tsNum(a.createdAt))
      .map(a => {
        const days = (a.availDays || []).join('·');
        const asg = [a.assignPlace, a.assignPeriod,
          a.assignSessions ? `${a.assignSessions}차수` : '',
          a.assignHours ? `${a.assignHours}시수` : ''].filter(Boolean).join(' · ');
        return `<tr>
        <td class="nowrap">${esc(tsText(a.createdAt, false))}</td>
        <td><b>${esc(a.name)}</b>${a.uid ? '<span class="chip member">회원</span>' : ''}</td>
        <td>${esc(a.org) || '-'}</td>
        <td>${esc(a.course || '-')}</td>
        <td class="cell-sub">${days ? esc(days) : '-'}<br>${esc(a.availTime || '')}</td>
        <td class="cell-sub">${esc(a.preferArea || '-')}</td>
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
function downloadCSV(scope = 'filtered'){
  const list = scope === 'all' ? applications : filteredApps();
  if (!list.length){ alert('내보낼 신청 내역이 없습니다.'); return; }
  const rows = [['접수일시','신청번호','프로그램','운영기간','운영장소','유형','강좌/지원분야','강사명','소속기관','소속기관 유형',
                 '전화번호','전자메일','회원가입 여부','승인/진행 상태','배정 학교/기관','배정 기간',
                 '배정 차수','배정 시수','안내 메모','가능 요일','가능 시간대','희망 지역',
                 '수료여부','이수증 발급번호','요청사항']];
  list.forEach(a => {
    rows.push([tsText(a.createdAt), a.id, a.programTitle || '',
      progPeriod(a), progPlace(a), KIND[a.programType] || '',
      a.course || a.session || '', a.name, a.org, a.orgType || '', a.phone, a.email,
      a.uid ? '회원' : '비회원', statusSet(a)[statusOf(a)].label,
      a.assignPlace || '', a.assignPeriod || '', a.assignSessions ?? '', a.assignHours ?? '',
      a.statusMemo || '', (a.availDays || []).join('·'), a.availTime || '', a.preferArea || '',
      a.completed ? '수료' : '접수', a.certNo || '', a.memo]);
  });
  const tag = scope === 'all' ? '전체' : '검색결과';
  saveCSV(rows, `디지털새싹_신청자명단_${tag}_${todayStr().replace(/\./g,'')}.csv`);
  toast(`CSV ${list.length}건을 내려받았습니다.`);
}
window.downloadCSV = downloadCSV;

/* ==================== 강사 회원 ==================== */
async function loadMembers(){
  const tb = $('memberTableBody');
  tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#6A776F;">불러오는 중…</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'users'));
    members = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    membersLoaded = true;
    renderMembers();
    renderDashboard();
    if ($('tab-assign').classList.contains('on')) renderCandidates();
  } catch (err){
    tb.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#C64B3C;">${esc(fbError(err))}</td></tr>`;
  }
}
window.loadMembers = loadMembers;

function memberStats(m){
  const mine = applications.filter(a =>
    (a.uid && a.uid === m.uid) || (a.email && m.email && a.email === m.email));
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
function renderMembers(){
  const tb = $('memberTableBody');
  const list = filteredMembers();
  $('badgeMember').textContent = members.length;
  if (!list.length){
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#6A776F;">${
      members.length ? '조건에 맞는 회원이 없습니다.' : '가입한 회원이 없습니다.'}</td></tr>`;
    return;
  }
  tb.innerHTML = list.map(m => {
    const s = memberStats(m);
    const r = roleOf(m);
    const detail = roleDetail(m);
    return `<tr>
      <td class="nowrap">${esc(tsText(m.createdAt, false))}</td>
      <td><span class="role-chip ${r}">${ROLES[r].icon} ${ROLES[r].label}</span></td>
      <td><b>${esc(m.name || '-')}</b></td>
      <td class="cell-sub">${esc(m.email || '-')}</td>
      <td class="nowrap cell-sub">${esc(m.phone || '-')}</td>
      <td>${esc(m.org || m.childSchool || m.school || '-')}</td>
      <td class="cell-sub">${detail ? esc(detail) : '<span style="color:#A5B1A9;">미작성</span>'}</td>
      <td class="nowrap">${s.total}건 / <b style="color:var(--leaf);">${s.done}</b></td>
      <td class="nowrap">${r === 'instructor' ? `${s.assigned}건 / <b style="color:var(--navy);">${s.hours}</b>시수` : '-'}</td>
    </tr>`;
  }).join('');
}
$('mf-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderMembers, 200); });
$('mf-profile').addEventListener('change', renderMembers);
$('mf-role').addEventListener('change', renderMembers);

function downloadMemberCSV(){
  const list = filteredMembers();
  if (!list.length){ alert('내보낼 회원이 없습니다.'); return; }
  const rows = [['가입일','회원 유형','이름','이메일','전화번호','소속/학교','소속유형',
                 '유형별 정보','전문분야','경력','활동가능지역','자기소개/메모',
                 '총 신청','수료 완료','배정 건수','누적 시수']];
  list.forEach(m => {
    const s = memberStats(m);
    rows.push([tsText(m.createdAt, false), ROLES[roleOf(m)].label, m.name, m.email, m.phone || '',
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

function renderDashboard(){
  $('d-total').textContent = applications.length;
  const todayKey = new Date().toDateString();
  $('d-today').textContent = applications.filter(a => {
    try { return a.createdAt?.toDate && a.createdAt.toDate().toDateString() === todayKey; }
    catch { return false; }
  }).length;
  const openCount = programs.filter(p => p.open && !ddayInfo(p).closed && (p.applied || 0) < p.capacity).length;
  $('d-open').textContent = openCount;
  const fills = programs.map(p => Math.min(1, (p.applied || 0) / (p.capacity || 1)));
  $('d-fill').textContent = fills.length
    ? Math.round(fills.reduce((a,b) => a+b, 0) / fills.length * 100) + '%' : '0%';
  $('d-done').textContent = applications.filter(a => a.completed).length;
  $('d-member').textContent = membersLoaded
    ? `${members.filter(m => roleOf(m) === 'instructor').length}/${members.length}` : '—';

  makeChart('chartPrograms', {
    type: 'bar',
    data: {
      labels: programs.map(p => p.title.length > 14 ? p.title.slice(0,14) + '…' : p.title),
      datasets: [
        { label: '신청', data: programs.map(p => p.applied || 0), backgroundColor: C.sprout },
        { label: '정원', data: programs.map(p => p.capacity), backgroundColor: C.line }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false,
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });

  const courseCount = {};
  applications.forEach(a => {
    const key = a.course || a.session || '(미지정)';
    courseCount[key] = (courseCount[key] || 0) + 1;
  });
  const courseEntries = Object.entries(courseCount).sort((a,b) => b[1]-a[1]).slice(0,8);
  makeChart('chartCourses', {
    type: 'bar',
    data: {
      labels: courseEntries.map(e => e[0].length > 16 ? e[0].slice(0,16) + '…' : e[0]),
      datasets: [{ label:'신청', data: courseEntries.map(e => e[1]), backgroundColor: C.navy }]
    },
    options: { indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ x:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });

  const typeCount = {};
  applications.forEach(a => {
    const key = a.orgType || '(미입력)';
    typeCount[key] = (typeCount[key] || 0) + 1;
  });
  makeChart('chartOrgTypes', {
    type: 'doughnut',
    data: {
      labels: Object.keys(typeCount),
      datasets: [{ data: Object.values(typeCount),
        backgroundColor: [C.leaf, C.navy, C.sun, C.red, C.sprout, '#8ADCA0'] }]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'right' } } }
  });

  const days = [], counts = [];
  for (let i = 13; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push((d.getMonth()+1) + '/' + d.getDate());
    const key = d.toDateString();
    counts.push(applications.filter(a => {
      try { return a.createdAt?.toDate && a.createdAt.toDate().toDateString() === key; }
      catch { return false; }
    }).length);
  }
  makeChart('chartDaily', {
    type: 'line',
    data: { labels: days,
      datasets: [{ label:'신청', data: counts, borderColor: C.leaf,
        backgroundColor: 'rgba(95,201,126,.18)', fill:true, tension:.3 }] },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });
}

/* ==================== 실시간 구독 (프로그램/공지) ==================== */
onSnapshot(
  query(collection(db, 'programs'), orderBy('createdAt', 'desc')),
  snap => {
    programs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminTable();
    renderApplicants();      // v10: 신청자 표의 운영기간 열 갱신
    renderDashboard();
    refreshAssignPrograms();
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
