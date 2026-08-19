/* =========================================================
   공지사항 게시판: 목록/검색/페이지네이션/상세
   notice.html?id=문서ID 로 특정 글 바로 열기 지원 (링크 공유용)
========================================================= */
import { db, auth, storage } from './firebase-init.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  ref as stRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initLayout, esc, noticeIsNew, catClass, fbError, toast, todayStr,
         mdToHtml, checkIsAdmin, noticeBodyHTML, noticeBodyText } from './common.js';

initLayout('notice');

const $ = id => document.getElementById(id);
const NOTICE_PAGE_SIZE = 10;
let notices = [];
let noticePage = 1, noticeQuery = '';
let pendingOpenId = new URLSearchParams(location.search).get('id');
let openedOnce = false;
/* v53: 관리자 여부 — 첫 렌더가 먼저 실행돼도 안전하도록 위쪽에 선언 */
let isAdmin = false;
let editFiles = [];          // 수정 중인 글의 기존 첨부 (삭제 표시 포함)

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
      ${attachHTML(n.files)}
      <div class="nd-nav">
        <div><span class="lbl">▲ 다음글</span>${next ? `<a href="javascript:openNotice('${next.id}')">${esc(next.title)}</a>` : '<span class="none">다음 글이 없습니다.</span>'}</div>
        <div><span class="lbl">▼ 이전글</span>${prev ? `<a href="javascript:openNotice('${prev.id}')">${esc(prev.title)}</a>` : '<span class="none">이전 글이 없습니다.</span>'}</div>
      </div>
      <div class="nd-actions">
        <button class="btn btn-outline btn-sm" onclick="backToNoticeList()">목록으로</button>
        ${isAdmin ? `
          <button class="btn btn-navy btn-sm" onclick="openNoticeEditor('${n.id}')">✏️ 수정</button>
          <button class="btn btn-outline btn-sm danger-btn" onclick="removeNotice('${n.id}')">🗑 삭제</button>` : ''}
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

/* =========================================================
   v53: 관리자 로그인 시 이 페이지에서 바로 작성·수정·삭제
   본문은 마크다운 원문으로 저장하고(md:true), 첨부 파일은
   Storage(noticeFiles/)에 올려 files 배열로 함께 보관합니다.
========================================================= */
const MAX_FILE = 30 * 1024 * 1024;
const isImage = f => /^image\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.name || '');
const isVideo = f => /^video\//.test(f.type || '') || /\.(mp4|webm|mov|m4v)$/i.test(f.name || '');
const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB'
                   : n >= 1024 ? Math.round(n / 1024) + 'KB' : (n || 0) + 'B';

/** 공지 상세의 첨부 영역 — 이미지·동영상은 바로 보여주고 나머지는 내려받기 */
function attachHTML(files){
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return '';
  const media = list.filter(f => isImage(f) || isVideo(f));
  const docs  = list.filter(f => !isImage(f) && !isVideo(f));
  return `<div class="nd-files">
    ${media.length ? `<div class="nf-media">${media.map(f => isImage(f)
      ? `<figure><a href="${esc(f.url)}" target="_blank" rel="noopener">
           <img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>
         <figcaption>${esc(f.name)}</figcaption></figure>`
      : `<figure><video src="${esc(f.url)}" controls preload="metadata"></video>
         <figcaption>${esc(f.name)}</figcaption></figure>`).join('')}</div>` : ''}
    ${docs.length ? `<ul class="nf-docs">
      <li class="nf-head">📎 첨부파일 ${docs.length}개</li>
      ${docs.map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener" download>
        <span class="nf-name">${esc(f.name)}</span>
        <span class="nf-size">${fmtSize(f.size)}</span></a></li>`).join('')}
    </ul>` : ''}
  </div>`;
}

/* ---------- 편집기 ---------- */
function paintEditFiles(){
  const box = $('ntFileList');
  box.innerHTML = editFiles.map((f, i) => `
    <li class="${f._del ? 'del' : ''}">
      <span class="nfl-ic">${isImage(f) ? '🖼' : isVideo(f) ? '🎬' : '📄'}</span>
      <span class="nfl-name">${esc(f.name)}</span>
      <span class="nfl-size">${fmtSize(f.size)}</span>
      <button type="button" class="mini-btn ${f._del ? '' : 'danger'}"
        onclick="toggleNoticeFile(${i})">${f._del ? '되살리기' : '삭제'}</button>
    </li>`).join('');
}
function toggleNoticeFile(i){
  if (!editFiles[i]) return;
  editFiles[i]._del = !editFiles[i]._del;
  paintEditFiles();
}

function openNoticeEditor(id){
  const n = id ? notices.find(x => x.id === id) : null;
  $('nt-id').value = n ? n.id : '';
  $('nt-cat').value = n ? n.cat : '모집';
  $('nt-title').value = n ? n.title : '';
  /* 예전 글은 HTML로 저장되어 있으므로 편집할 수 있게 텍스트로 되돌립니다 */
  $('nt-body').value = !n ? '' : (n.md
    ? String(n.body || '')
    : String(n.body || '')
        .replace(/<\/p><p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim());
  $('nt-pinned').checked = !!(n && n.pinned);
  $('nt-files').value = '';
  editFiles = (n && Array.isArray(n.files) ? n.files : []).map(f => ({ ...f }));
  paintEditFiles();
  $('ntFormTitle').textContent = n ? '✏️ 공지 수정 — ' + n.title : '📢 새 공지 작성';
  $('ntSubmit').textContent = n ? '수정 저장' : '공지 등록';
  $('ntError').style.display = 'none';
  $('ntEditor').hidden = false;
  $('noticeDetailView').style.display = 'none';
  $('noticeListView').style.display = 'block';
  paintNoticePreview();
  $('ntEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeNoticeEditor(){
  $('ntEditor').hidden = true;
  editFiles = [];
  $('ntForm').reset();
}
function paintNoticePreview(){
  const box = $('ntPreview');
  if (!box) return;
  const src = $('nt-body').value.trim();
  box.innerHTML = src
    ? mdToHtml(src)
    : '<p class="np-empty">내용을 입력하면 실제 표시되는 모습이 여기에 나타납니다.</p>';
}
function toggleNoticePreview(){
  const wrap = $('ntPreviewWrap');
  const on = wrap.hasAttribute('hidden');
  wrap.toggleAttribute('hidden', !on);
  $('ntPreviewBtn').textContent = on ? '미리보기 닫기' : '미리보기';
  if (on) paintNoticePreview();
}

async function removeNotice(id){
  const n = notices.find(x => x.id === id);
  if (!n || !confirm(`[${n.title}] 공지를 삭제할까요?\n첨부파일도 함께 삭제되며 되돌릴 수 없습니다.`)) return;
  try {
    for (const f of (n.files || [])){
      if (f.path) await deleteObject(stRef(storage, f.path)).catch(() => {});
    }
    await deleteDoc(doc(db, 'notices', id));
    toast('공지를 삭제했습니다.');
    backToNoticeList();
  } catch (err){ alert(fbError(err)); }
}

document.getElementById('ntForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('ntError'), btn = $('ntSubmit');
  const picked = [...($('nt-files').files || [])];
  const tooBig = picked.find(f => f.size > MAX_FILE);
  if (tooBig){
    err.textContent = `${tooBig.name} 파일이 30MB를 넘습니다. 용량을 줄여 다시 첨부해주세요.`;
    err.style.display = 'block';
    return;
  }
  const idVal = $('nt-id').value;
  const label = btn.textContent;
  btn.disabled = true;
  err.style.display = 'none';
  try {
    /* 삭제 표시된 기존 첨부는 Storage에서도 지웁니다 */
    const keep = [];
    for (const f of editFiles){
      if (f._del){
        if (f.path) await deleteObject(stRef(storage, f.path)).catch(() => {});
      } else {
        const { _del, ...rest } = f;
        keep.push(rest);
      }
    }
    const files = [...keep];
    for (let i = 0; i < picked.length; i++){
      const f = picked[i];
      btn.textContent = `업로드 중… (${i + 1}/${picked.length})`;
      const safe = f.name.replace(/[^\w.\-가-힣 ]/g, '_');
      const path = `noticeFiles/${Date.now()}_${i}_${safe}`;
      const r = stRef(storage, path);
      await uploadBytes(r, f);
      files.push({ name: f.name, size: f.size, type: f.type || '',
                   url: await getDownloadURL(r), path });
    }
    btn.textContent = '저장 중…';
    const data = {
      cat: $('nt-cat').value,
      title: $('nt-title').value.trim(),
      body: $('nt-body').value.trim(),
      md: true,
      files,
      pinned: $('nt-pinned').checked
    };
    if (idVal){
      await updateDoc(doc(db, 'notices', idVal), data);
      toast('공지를 수정했습니다.');
    } else {
      await addDoc(collection(db, 'notices'), {
        ...data, author: '사업단', date: todayStr(), views: 0,
        createdAt: serverTimestamp()
      });
      toast('공지를 등록했습니다.');
    }
    closeNoticeEditor();
  } catch (e2){
    err.textContent = /storage|CORS|unauthorized|permission/i.test(String(e2?.code || e2))
      ? '파일 업로드에 실패했습니다. Firebase Storage 설정과 규칙을 확인해주세요.'
      : fbError(e2);
    err.style.display = 'block';
  } finally { btn.disabled = false; btn.textContent = label; }
});
$('nt-body')?.addEventListener('input', paintNoticePreview);

/* 관리자 여부에 따라 작성 버튼·관리 버튼을 켜고 끕니다 */
onAuthStateChanged(auth, async user => {
  isAdmin = user ? await checkIsAdmin(user.uid) : false;
  $('ntNewBtn').hidden = !isAdmin;
  if (!isAdmin) closeNoticeEditor();
  /* 상세 화면이 열려 있으면 관리 버튼이 나오도록 다시 그립니다 */
  const openId = new URLSearchParams(location.search).get('id');
  if (isAdmin && openId && $('noticeDetailView').style.display === 'block') openNotice(openId);
});

Object.assign(window, {
  openNoticeEditor, closeNoticeEditor, toggleNoticePreview, toggleNoticeFile, removeNotice
});

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
