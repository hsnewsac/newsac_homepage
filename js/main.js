/* =========================================================
   메인 페이지 v5
   - 접수중 프로그램 카드 + 신청 모달 + 최신 공지 미리보기
   - 로그인 회원 신청 시 정보 자동 입력 + uid 자동 연결
   - 프로그램별 '로그인 회원만 신청' 옵션 지원 (강사 모집 공고용)
========================================================= */
import { db, auth } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, where, getDocs,
  increment, serverTimestamp, getDoc as fsGetDoc, doc as fsDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  initLayout, esc, ddayInfo, notYetOpen, programEnded, noticeIsNew, catClass, fbError,
  KIND, ORG_TYPES, openModal, closeModal, bindModalEvents, toast,
  ROLES, roleOf, qualificationHTML, RECRUIT_FOR,
  guessCourseKey, acceptedOnlineKeys, courseByKey,
  courseInfoOf, courseStat, courseTimeText, allCoursesFull, hasCourseCaps, appliedPatch,
  overlappingPairs
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
let endedOpen = false;        // 종료된 워크샵 펼침 상태 (렌더보다 먼저 선언)
const openSeats = new Set();  // v49: 과목별 잔여 좌석을 펼쳐 둔 프로그램 id
/* v27 방문객 대시보드 상태 — 로그인 콜백이 먼저 실행돼도 안전하도록 위쪽에 둡니다 */
const VDASH_DEFAULTS = { students: 0, instructors: 0, visit: 0, group: 0, workshops: 0, goal: 4800 };
let vdashStats = null, vdashPainted = false;

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

/* ---------- v27: 방문객 대시보드 ----------
   수치는 stats/public 문서에서 읽습니다 (관리자 대시보드에서 입력).
   강사 워크샵 건수는 미입력 시 등록된 워크샵 프로그램 수로 대체합니다. */

function countUp(el, to, dur = 1400){
  if (!el) return;
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);          // ease-out
    el.textContent = Math.round(to * e).toLocaleString('ko-KR');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function paintVdash(){
  if (!vdashStats || vdashPainted || !$('vd-students')) return;
  vdashPainted = true;
  const s = vdashStats;
  countUp($('vd-students'), s.students);
  countUp($('vd-instructors'), s.instructors);
  countUp($('vd-visit'), s.visit);
  countUp($('vd-group'), s.group);
  countUp($('vd-workshops'), s.workshops || programs.filter(p => p.type === 'workshop').length);
  const goal = s.goal || 4800;
  $('vd-goalTotal').textContent = goal.toLocaleString('ko-KR');
  const pct = Math.min(100, Math.round((s.students / goal) * 100));
  setTimeout(() => { $('vd-fill').style.width = pct + '%'; }, 250);
  countUp($('vd-goalPct'), pct, 1600);
  setTimeout(() => { $('vd-goalPct').textContent = pct + '%'; }, 1650);
  $('vd-goalSub').textContent =
    `지금까지 ${s.students.toLocaleString('ko-KR')}명의 학생이 디지털새싹과 함께했습니다.`;
}

(async () => {
  let d = {};
  try {
    const snap = await fsGetDoc(fsDoc(db, 'stats', 'public'));
    if (snap.exists()) d = snap.data();
  } catch (e) { /* 수치 미공개 시 0으로 표시 */ }
  vdashStats = { ...VDASH_DEFAULTS, ...d };
  paintVdash();
})();

/* ---------- 프로그램 카드 ---------- */
function cardHTML(p){
  const applied = p.applied || 0;
  const remain = p.capacity - applied;
  const dd = ddayInfo(p);
  const isRecruit = p.type === 'recruit';
  /* v17: 모집 공고는 정원이 차도 자동 마감하지 않습니다 — 서류 검토 후 선발 방식.
     접수 마감은 마감일 경과 또는 관리자의 접수 중지로만 처리합니다. */
  /* v33: 운영 기간이 지난 프로그램은 무조건 마감으로 처리합니다 */
  const ended = programEnded(p);
  /* v42: 과목별 정원이 있으면 전 과목이 찬 경우에만 마감합니다.
     (시간대가 다른 과목을 함께 신청해도 서로의 정원을 깎지 않습니다) */
  const perCourse = courseInfoOf(p);
  const byCourse = allCoursesFull(p);
  const seatFull = byCourse === null ? remain <= 0 : byCourse;
  const closed = ended || !p.open || dd.closed || (!isRecruit && seatFull);
  /* v19: 접수 시작(날짜+시각) 전이면 '접수 예정'으로 표시하고 신청을 막습니다 */
  const notYet = !closed && notYetOpen(p);
  const pct = Math.min(100, Math.round(applied / p.capacity * 100));
  const needLogin = p.loginOnly && !currentUser;
  const wrongRole = isRecruit && currentUser && roleOf(userProfile) !== 'instructor';
  const btnClass = p.type === 'camp' ? 'btn-primary' : 'btn-navy';

  const seatText = ended
    ? `운영 종료 · 최종 <strong>${applied}명</strong> ${isRecruit ? '지원' : '신청'}`
    : isRecruit
    ? `모집 <strong>${p.capacity}명</strong> · 현재 <strong>${applied}명</strong> 지원 · 서류 검토 후 선발`
    : (seatFull ? '전 과목 정원 마감'
        : (byCourse !== null ? '과목별 선착순 마감' 
          : (remain <= 10 ? `잔여 <strong>${remain}석</strong> · 마감 임박` : '회차별 선착순 마감')));

  let action;
  if (ended){
    action = `<button class="btn ${btnClass}" disabled>${isRecruit ? '종료된 공고입니다' : '운영이 종료되었습니다'}</button>`;
  } else if (closed){
    action = `<button class="btn ${btnClass}" disabled>${isRecruit ? '모집이 마감되었습니다' : '접수가 마감되었습니다'}</button>`;
  } else if (notYet){
    const [, m, d] = p.openDate.split('-');
    action = `<button class="btn ${btnClass}" disabled>${Number(m)}월 ${Number(d)}일${p.openTime ? ` ${p.openTime}` : ''}부터 ${isRecruit ? '지원할 수 있습니다' : '접수합니다'}</button>`;
  } else if (needLogin){
    action = `<a class="btn ${btnClass}" href="mypage.html?next=apply">🔐 로그인 후 ${isRecruit ? '지원하기' : '신청하기'}</a>`;
  } else if (wrongRole){
    action = `<button class="btn ${btnClass}" disabled title="강사 회원만 지원할 수 있습니다">강사 회원만 지원 가능</button>`;
  } else {
    action = `<button class="btn ${btnClass}" onclick="openApply('${p.id}')">${isRecruit ? '강사 지원하기' : '신청하기'}</button>`;
  }

  return `
    <div class="open-card ${p.type !== 'camp' ? 'workshop' : ''} ${isRecruit ? 'recruit' : ''} ${closed ? 'closed' : ''} ${ended ? 'ended' : ''}">
      <div class="open-top">
        ${ended
          ? `<span class="status done">운영종료</span>`
          : (closed
          ? `<span class="status end">${isRecruit ? '모집마감' : '접수마감'}</span>`
          : (notYet
            ? `<span class="status soon">${isRecruit ? '모집 예정' : '접수 예정'}</span>`
            : `<span class="status live">${isRecruit ? '모집중' : '접수중'}</span><span class="dday ${dd.urgent ? '' : 'calm'}">${esc(dd.text)}</span>`))}
        <span class="kind-label">${KIND[p.type] || ''}${p.type === 'workshop' && (p.wsKind === 'mini' || /미니|mini|교구/i.test(p.title || '')) ? ' · 미니(교구)' : ''}</span>
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

      ${(() => {
        /* v50: 과목별 정원이 있으면 '신청 현황' 줄 자체가 펼침 버튼이 됩니다 */
        const can = !isRecruit && byCourse !== null;
        const open = can && openSeats.has(p.id);
        const inner = `${isRecruit ? '지원 현황' : '신청 현황'} <strong>${applied} / ${p.capacity}명</strong> · ${seatText}
        ${can ? `<span class="sb-more" aria-hidden="true">과목별 <i>▾</i></span>` : ''}
        <div class="seat-track"><div class="seat-fill" style="width:${pct}%"></div></div>`;
        return can
          ? `<button type="button" class="seat-bar seat-toggle${open ? ' open' : ''}" data-seat="${p.id}"
               aria-expanded="${open ? 'true' : 'false'}" aria-controls="cseat-${p.id}"
               title="과목별 잔여 좌석 보기">${inner}</button>`
          : `<div class="seat-bar">${inner}</div>`;
      })()}
      ${(!isRecruit && byCourse !== null) ? (() => {
        const open = openSeats.has(p.id);
        return `
      <ul class="cseat" id="cseat-${p.id}"${open ? '' : ' hidden'}>
        ${perCourse.map(c => {
          const st = courseStat(p, c);
          const t = courseTimeText(c);
          return `<li class="${st.full ? 'full' : (st.remain <= 3 ? 'soon' : '')}">
            <span class="cs-name">${esc(c.name)}</span>
            ${t ? `<span class="cs-time">${esc(t)}</span>` : ''}
            <span class="cs-num">${st.full ? '마감' : `잔여 ${st.remain}석`}
              <em>${st.applied}/${st.cap}</em></span>
          </li>`;
        }).join('')}
      </ul>`;
      })() : ''}
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
  /* 모집 공고는 정원 초과 지원을 허용하므로 정원 도달로는 마감 처리하지 않음 */
  return !p.open || ddayInfo(p).closed || (p.type !== 'recruit' && remain <= 0);
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

/* v33: 종료된 워크샵은 최근에 끝난 순으로 보여줍니다 */
function byEndDesc(list){
  return [...list].sort((a, b) => {
    const ea = a.endDate || a.startDate || '', eb = b.endDate || b.startDate || '';
    return ea === eb ? 0 : (ea > eb ? -1 : 1);
  });
}

function renderPrograms(){
  const all     = programs.filter(p => p.type !== 'recruit' && !isOnlineWs(p));
  const edu     = byDeadline(all.filter(p => !programEnded(p)));
  const done    = byEndDesc(all.filter(programEnded));
  const recruit = byDeadline(programs.filter(p => p.type === 'recruit' && !programEnded(p)));

  const grid = $('programGrid');
  grid.innerHTML = edu.length
    ? edu.map(cardHTML).join('')
    : `<div class="open-empty">현재 접수 중인 프로그램이 없습니다.<br>새로운 연수 일정은 공지사항을 통해 안내드립니다.${
        done.length ? '<br><br>지난 워크샵은 아래 <b>종료된 워크샵 보기</b>에서 확인할 수 있습니다.' : ''}</div>`;

  /* 종료된 워크샵 — 기본은 접힌 상태 */
  const wrap = $('endedWrap');
  if (wrap){
    wrap.style.display = done.length ? '' : 'none';
    $('endedCount').textContent = done.length;
    $('endedGrid').innerHTML = done.map(cardHTML).join('');
    paintEndedToggle();
  }

  /* 대시보드의 워크샵 건수를 프로그램 수로 보정 (수기 입력이 없을 때) */
  if (vdashStats && !vdashStats.workshops && $('vd-workshops') && vdashPainted){
    $('vd-workshops').textContent = programs.filter(p => p.type === 'workshop').length;
  }

  const rSec = $('recruit-now');
  if (recruit.length){
    rSec.style.display = 'block';
    $('recruitGrid').innerHTML = recruit.map(cardHTML).join('');
  } else {
    rSec.style.display = 'none';
  }
}

/* v49: 카드의 과목별 잔여 좌석 펼치기/접기 — 다시 그려도 상태가 유지됩니다 */
document.addEventListener('click', e => {
  const btn = e.target.closest('.seat-toggle');
  if (!btn) return;
  const id = btn.dataset.seat;
  const box = document.getElementById('cseat-' + id);
  if (!box) return;
  const open = box.hidden;
  box.hidden = !open;
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) openSeats.add(id); else openSeats.delete(id);
});

function paintEndedToggle(){
  const btn = $('endedToggle'), gridEl = $('endedGrid'), note = $('endedNote');
  if (!btn) return;
  btn.setAttribute('aria-expanded', endedOpen ? 'true' : 'false');
  btn.classList.toggle('open', endedOpen);
  btn.querySelector('.et-txt').textContent = endedOpen ? '종료된 워크샵 접기' : '종료된 워크샵 보기';
  gridEl.hidden = !endedOpen;
  note.style.display = endedOpen ? '' : 'none';
}

document.getElementById('endedToggle')?.addEventListener('click', () => {
  endedOpen = !endedOpen;
  paintEndedToggle();
  if (endedOpen) $('endedGrid').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

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
  if (programEnded(p)){
    alert('운영 기간이 종료된 프로그램입니다.');
    return;
  }
  if (notYetOpen(p)){
    alert('아직 접수 시작 전입니다. 접수가 열리면 신청할 수 있습니다.');
    return;
  }
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
    $('a-pickBar').style.display = 'none';
    checks.innerHTML = '';
    sel.innerHTML = '<option value="">강좌를 선택하세요</option>' +
      courses.map(c => `<option>${esc(c)}</option>`).join('');
  } else {
    sel.style.display = 'none'; sel.required = false; sel.innerHTML = '';
    checks.style.display = ''; courseNote.style.display = '';
    $('a-pickBar').style.display = '';
    /* v42: 과목별 운영 시간과 잔여 정원을 함께 보여주고, 찬 과목은 고를 수 없게 합니다 */
    const info = courseInfoOf(p);
    const hasCap = hasCourseCaps(p);
    checks.innerHTML = courses.map((c, i) => {
      const ci = info.find(x => x.name === c) || { name: c };
      const st = courseStat(p, ci);
      const t = courseTimeText(ci);
      const cls = hasCap ? (st.full ? 'full' : (st.remain <= 3 ? 'soon' : '')) : '';
      return `<label class="chk cchk ${cls}">
        <input type="checkbox" name="ac" value="${esc(c)}" id="ac${i}"${st.full && hasCap ? ' disabled' : ''}>
        <span class="cc-main">
          <b>${esc(c)}</b>
          ${t ? `<em class="cc-time">🕘 ${esc(t)}</em>` : ''}
        </span>
        ${hasCap ? `<span class="cc-seat">${st.full ? '마감'
          : `잔여 <b>${st.remain}</b>석`}<i>${st.applied}/${st.cap}</i></span>` : ''}
      </label>`;
    }).join('');
    courseNote.innerHTML = `<span id="a-courseHint">${hasCap
      ? '과목마다 <b>정원이 따로</b> 관리됩니다. 시간이 겹치지 않으면 여러 과목을 함께 신청하셔도 다른 과목의 잔여 좌석이 줄지 않습니다.'
      : '시간이 겹치지 않으면 여러 강좌를 함께 신청할 수 있습니다. 선택한 강좌 수만큼 신청이 각각 접수되며, 강좌별로 따로 취소할 수 있습니다.'}</span>`;

    /* v48: 고른 과목 수와 시간 충돌을 바로 알려줍니다 */
    const paintPick = () => {
      const picked = [...checks.querySelectorAll('input:checked')].map(x => x.value);
      const chosen = picked.map(n => info.find(x => x.name === n) || { name: n });
      const bad = overlappingPairs(chosen);
      $('a-pickCount').textContent = picked.length
        ? `${picked.length}과목 선택` : '과목을 선택하세요';
      $('a-pickCount').classList.toggle('on', picked.length > 0);
      $('a-pickCount').classList.toggle('bad', bad.length > 0);
      const warn = $('a-courseWarn');
      warn.innerHTML = bad.length
        ? `⚠️ <b>운영 시간이 겹칩니다</b> — ${bad.map(([x, y]) =>
            `${esc(x.name)}(${esc(courseTimeText(x))}) · ${esc(y.name)}(${esc(courseTimeText(y))})`).join(' / ')}<br>
           시간이 겹치는 과목은 함께 수강할 수 없으니 하나만 선택해주세요.`
        : '';
      warn.style.display = bad.length ? 'block' : 'none';
      checks.querySelectorAll('.cchk').forEach(l => {
        const v = l.querySelector('input').value;
        l.classList.toggle('clash', bad.some(([x, y]) => x.name === v || y.name === v));
      });
    };
    checks.querySelectorAll('input').forEach(i => i.addEventListener('change', paintPick));
    paintPick();
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
  /* v48: 시간이 겹치는 과목은 함께 신청할 수 없습니다 */
  if (!isRecruitSubmit && p && chosenCourses.length > 1){
    const info0 = courseInfoOf(p);
    const bad = overlappingPairs(chosenCourses.map(n => info0.find(x => x.name === n) || { name: n }));
    if (bad.length){
      $('applyError').textContent =
        `운영 시간이 겹치는 과목은 함께 신청할 수 없습니다: ${
          bad.map(([x, y]) => `${x.name} · ${y.name}`).join(' / ')}`;
      $('applyError').style.display = 'block';
      return;
    }
  }
  /* v42: 접수 직전 과목 정원을 다시 확인합니다 (다른 사람이 먼저 접수한 경우) */
  if (!isRecruitSubmit && p){
    const info = courseInfoOf(p);
    const full = chosenCourses.filter(name => {
      const ci = info.find(x => x.name === name);
      return ci && courseStat(p, ci).full;
    });
    if (full.length){
      $('applyError').textContent =
        `방금 정원이 찼습니다: ${full.join(', ')}\n다른 과목을 선택해주세요.`;
      $('applyError').style.display = 'block';
      openApply(programId);
      return;
    }
  }

  const btn = $('applySubmitBtn');
  btn.disabled = true; btn.textContent = '접수 중…';
  try {
    const appData = {
      programId,
      programTitle: p ? p.title : '',
      programType: p ? p.type : '',
      programWsKind: (p && p.wsKind) || null,   // v18: 정규/미니 구분 (마이페이지 안내용)
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
      /* v42: 전체 인원과 과목별 인원을 함께 반영합니다 */
      await updateDoc(doc(db, 'programs', programId),
        appliedPatch(increment, course, 1)).catch(() => {});
    }
    const courseText = chosenCourses.join(' · ');

    /* v23: 미니(교구 사용법) 워크샵을 회원이 신청하면 대응 온라인 워크샵을
       내 강의실에 자동 등록합니다 (이미 수강 중인 과목은 건너뜀).
       실패해도 신청 접수에는 영향을 주지 않습니다. */
    let autoEnrolled = 0;
    if (currentUser && p && p.type !== 'recruit'
        && (p.wsKind === 'mini' || /미니|mini|교구/i.test(p.title || ''))){
      try {
        const es = await getDocs(query(collection(db, 'enrollments'), where('uid', '==', currentUser.uid)));
        const mine = es.docs.map(d => d.data().courseKey);
        for (const course of chosenCourses){
          const key = guessCourseKey(course);
          if (!key || acceptedOnlineKeys(course).some(k => mine.includes(k))) continue;
          await addDoc(collection(db, 'enrollments'), {
            uid: currentUser.uid,
            name: appData.name, email: appData.email, phone: appData.phone,
            org: appData.org, orgType: appData.orgType,
            courseKey: key,
            courseName: courseByKey(key)?.name || course,
            completed: false,
            createdAt: serverTimestamp(),
            linkedFrom: ids[0] || null
          });
          mine.push(key);
          autoEnrolled++;
        }
      } catch (e) { /* 자동 연동 실패 시 온라인 워크샵 페이지에서 직접 신청 가능 */ }
    }

    $('applyForm').style.display = 'none';
    $('applyDoneMsg').textContent = (p && p.type === 'recruit')
      ? `[${p.title} · ${courseText}] 지원이 접수되었습니다. 서류 검토 후 배정 결과를 안내드립니다.`
      : `[${p.title} · ${courseText}] 신청이 접수되었습니다. (${ids.length}건) 담당자 확인 후 안내드립니다.`
        + (autoEnrolled ? ` 수료에 필요한 온라인 워크샵 ${autoEnrolled}과목이 마이페이지 내 강의실에 함께 등록되었습니다.` : '');
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
