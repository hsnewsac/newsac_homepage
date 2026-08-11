/* =========================================================
   공지사항 게시판: 목록/검색/페이지네이션/상세
   notice.html?id=문서ID 로 특정 글 바로 열기 지원 (링크 공유용)
========================================================= */
import { db } from './firebase-init.js';
import {
  collection, updateDoc, doc, onSnapshot, query, orderBy, increment
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { initLayout, esc, noticeIsNew, catClass, fbError,
         noticeBodyHTML, noticeBodyText } from './common.js';

initLayout('notice');

const $ = id => document.getElementById(id);
const NOTICE_PAGE_SIZE = 10;
let notices = [];
let noticePage = 1, noticeQuery = '';
let pendingOpenId = new URLSearchParams(location.search).get('id');
let openedOnce = false;

function sortPinnedFirst(list){
  return [...list.filter(n => n.pinned), ...list.filter(n => !n.pinned)];
}
function filteredNotices(){
  const base = sortPinnedFirst(notices);
  if (!noticeQuery) return base;
  const q = noticeQuery.toLowerCase();
  return base.filter(n =>
    n.title.toLowerCase().includes(q) ||
    noticeBodyText(n).toLowerCase().includes(q)
  );
}

function renderNoticeList(){
  const list = filteredNotices();
  $('noticeTotal').textContent = list.length;
  const totalPages = Math.max(1, Math.ceil(list.length / NOTICE_PAGE_SIZE));
  if (noticePage > totalPages) noticePage = totalPages;
  const start = (noticePage - 1) * NOTICE_PAGE_SIZE;
  const pageItems = list.slice(start, start + NOTICE_PAGE_SIZE);

  const tb = $('noticeTableBody');
  if (!pageItems.length){
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">${noticeQuery ? '검색 결과가 없습니다.' : '등록된 공지사항이 없습니다.'}</td></tr>`;
  } else {
    tb.innerHTML = pageItems.map((n, i) => `
      <tr onclick="openNotice('${n.id}')" class="${n.pinned ? 'pinned' : ''}">
        <td>${n.pinned ? '📌' : list.length - start - i}</td>
        <td><span class="notice-cat ${catClass(n.cat)}">${esc(n.cat)}</span></td>
        <td class="b-title">${n.pinned ? '<span class="pin-mark">📌</span>' : ''}<b>${esc(n.title)}</b>${noticeIsNew(n.date) ? '<span class="notice-new">N</span>' : ''}</td>
        <td class="b-author">${esc(n.author)}</td>
        <td>${esc(n.date)}</td>
        <td class="b-views">${n.views || 0}</td>
      </tr>`).join('');
  }

  const pg = $('noticePagination');
  let html = `<button onclick="gotoNoticePage(${noticePage - 1})" ${noticePage === 1 ? 'disabled' : ''}>‹</button>`;
  for (let p = 1; p <= totalPages; p++){
    html += `<button class="${p === noticePage ? 'cur' : ''}" onclick="gotoNoticePage(${p})">${p}</button>`;
  }
  html += `<button onclick="gotoNoticePage(${noticePage + 1})" ${noticePage === totalPages ? 'disabled' : ''}>›</button>`;
  pg.innerHTML = html;
}

function gotoNoticePage(p){
  const totalPages = Math.max(1, Math.ceil(filteredNotices().length / NOTICE_PAGE_SIZE));
  if (p < 1 || p > totalPages) return;
  noticePage = p;
  renderNoticeList();
}
function searchNotices(){
  noticeQuery = $('noticeSearch').value.trim();
  noticePage = 1;
  renderNoticeList();
}

function openNotice(id){
  const n = notices.find(x => x.id === id);
  if (!n) return;
  updateDoc(doc(db, 'notices', id), { views: increment(1) }).catch(()=>{});
  const shownViews = (n.views || 0) + 1;
  const list = filteredNotices();
  const idx = list.findIndex(x => x.id === id);
  const prev = list[idx + 1];
  const next = list[idx - 1];
  $('noticeDetailView').innerHTML = `
    <div class="notice-detail">
      <div class="nd-head">
        <span class="notice-cat ${catClass(n.cat)}">${esc(n.cat)}</span>
        <h3>${esc(n.title)}</h3>
        <div class="nd-meta">
          <span>작성자 <b>${esc(n.author)}</b></span>
          <span>등록일 ${esc(n.date)}</span>
          <span>조회 ${shownViews}</span>
        </div>
      </div>
      <div class="nd-body md">${noticeBodyHTML(n)}</div>
      <div class="nd-nav">
        <div><span class="lbl">▲ 다음글</span>${next ? `<a href="javascript:openNotice('${next.id}')">${esc(next.title)}</a>` : '<span class="none">다음 글이 없습니다.</span>'}</div>
        <div><span class="lbl">▼ 이전글</span>${prev ? `<a href="javascript:openNotice('${prev.id}')">${esc(prev.title)}</a>` : '<span class="none">이전 글이 없습니다.</span>'}</div>
      </div>
      <div class="nd-actions">
        <button class="btn btn-outline btn-sm" onclick="backToNoticeList()">목록으로</button>
      </div>
    </div>`;
  $('noticeListView').style.display = 'none';
  $('noticeDetailView').style.display = 'block';
  history.replaceState(null, '', 'notice.html?id=' + id);
  window.scrollTo({top: 0, behavior: 'smooth'});
}
function backToNoticeList(){
  $('noticeDetailView').style.display = 'none';
  $('noticeListView').style.display = 'block';
  history.replaceState(null, '', 'notice.html');
  renderNoticeList();
}

Object.assign(window, { gotoNoticePage, searchNotices, openNotice, backToNoticeList });

/* 실시간 구독 */
onSnapshot(
  query(collection(db, 'notices'), orderBy('createdAt', 'desc')),
  snap => {
    notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // 상세 화면을 보고 있지 않을 때만 목록 갱신
    if ($('noticeDetailView').style.display === 'none' || !openedOnce){
      renderNoticeList();
    }
    // URL로 특정 글 직접 접근 (?id=)
    if (pendingOpenId && !openedOnce && notices.some(n => n.id === pendingOpenId)){
      openedOnce = true;
      openNotice(pendingOpenId);
      pendingOpenId = null;
    }
  },
  err => {
    $('noticeTableBody').innerHTML =
      `<tr class="empty-row"><td colspan="6">${esc(fbError(err))}</td></tr>`;
  }
);
