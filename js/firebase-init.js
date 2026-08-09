/* =========================================================
   Firebase 초기화 (공통)
   설정값을 바꿀 일이 있으면 이 파일만 수정하면 됩니다.
========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCVy9a2nHFU8jB8aoDrJ9s0BIRmFUng9Jc",
  authDomain: "newsac-20d73.firebaseapp.com",
  projectId: "newsac-20d73",
  storageBucket: "newsac-20d73.firebasestorage.app",
  messagingSenderId: "905675773911",
  appId: "1:905675773911:web:bc440794051cc17afd9d92"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
/* v32: 과제 파일 첨부용 스토리지 */
export const storage = getStorage(app);
