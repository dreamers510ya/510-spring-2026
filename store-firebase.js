/* 照片資料庫：Firebase Firestore（來賓不需登入；主持人控制台需用工作人員 Google 帳號登入） */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, serverTimestamp, query, where, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const cfg = window.PB_CONFIG;
const fb = cfg.firebase || {};
const configured = !!fb.projectId && !/^YOUR/.test(fb.projectId) && !/^YOUR/.test(fb.apiKey || "");
let db = null, col = null, auth = null;
if (configured) {
  try {
    const app = initializeApp(fb);
    db = getFirestore(app);
    col = collection(db, "events", cfg.eventId, "photos");
    auth = getAuth(app);
  } catch (e) { console.error(e); }
}
const ok = !!col;
const controlRef = () => doc(db, "events", cfg.eventId, "control", "state");
const presenceRef = () => doc(db, "events", cfg.eventId, "control", "presence");

window.PBStore = {
  ready: Promise.resolve(ok),
  notReadyMsg: "管理員尚未完成 Firebase 設定（config.js）",
  async upload(p) {
    if (!ok) throw new Error(this.notReadyMsg);
    await addDoc(col, { img: p.img, name: p.name || "", ts: serverTimestamp() });
  },
  subscribe(onAdd, onRemove, onError) {
    if (!ok) { onError("尚未設定 Firebase：請依部署手冊填寫 config.js。"); return () => {}; }
    let first = true;
    return onSnapshot(query(col, orderBy("ts", "asc")), snap => {
      onError(null);
      snap.docChanges().forEach(ch => {
        if (ch.type === "added") {
          const d = ch.doc.data();
          onAdd({ id: ch.doc.id, img: d.img, name: d.name, ts: d.ts && d.ts.toMillis ? d.ts.toMillis() : Date.now() }, first);
        } else if (ch.type === "removed") onRemove(ch.doc.id);
      });
      first = false;
    }, err => onError("照片資料連線失敗：" + (err.code || err.message) + "（請確認 Firestore 規則已發布）"));
  },
  async submitAnswer(a) {
    if (!ok) throw new Error(this.notReadyMsg);
    await addDoc(collection(db, "events", cfg.eventId, "answers"), { q: String(a.q), w: String(a.w), ts: serverTimestamp() });
  },
  subscribeAnswers(onAdd, onRemove, onError) {
    if (!ok) return () => {};
    let first = true;
    return onSnapshot(query(collection(db, "events", cfg.eventId, "answers"), orderBy("ts", "asc")), snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (ch.type === "added") onAdd({ id: ch.doc.id, q: d.q, w: d.w, ts: d.ts && d.ts.toMillis ? d.ts.toMillis() : Date.now() }, first);
        else if (ch.type === "removed" && onRemove) onRemove(ch.doc.id);
      });
      first = false;
    }, err => onError && onError("文字雲連線失敗：" + (err.code || err.message)));
  },
  // 簡報：slides 只放頁碼與小縮圖（控制台快速載入）；slideImgs 放大圖（Firestore 單筆上限 1MB）
  slideMax: 950000,
  async addSlide(s) {
    if (!ok) throw new Error(this.notReadyMsg);
    const ref = doc(collection(db, "events", cfg.eventId, "slides"));
    await setDoc(doc(db, "events", cfg.eventId, "slideImgs", ref.id), { deck: String(s.deck), img: s.img });
    await setDoc(ref, { deck: String(s.deck), idx: Number(s.idx), thumb: s.thumb, ts: serverTimestamp() });
  },
  async deleteDeck(deck) {
    if (!ok) throw new Error(this.notReadyMsg);
    const snap = await getDocs(query(collection(db, "events", cfg.eventId, "slides"), where("deck", "==", String(deck))));
    for (const d of snap.docs) {
      await deleteDoc(doc(db, "events", cfg.eventId, "slideImgs", d.id)).catch(() => {});
      await deleteDoc(d.ref);
    }
  },
  subscribeSlides(onAdd, onRemove, onError) {
    if (!ok) return () => {};
    return onSnapshot(collection(db, "events", cfg.eventId, "slides"), snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (ch.type === "added") onAdd({ id: ch.doc.id, deck: d.deck, idx: d.idx, thumb: d.thumb || "" });
        else if (ch.type === "removed" && onRemove) onRemove(ch.doc.id);
      });
    }, err => onError && onError("簡報連線失敗：" + (err.code || err.message)));
  },
  async slideSrc(id) {
    if (!ok) return "";
    const s = await getDoc(doc(db, "events", cfg.eventId, "slideImgs", id));
    return s.exists() ? s.data().img : "";
  },
  async deletePhoto(id) {
    if (!ok) throw new Error(this.notReadyMsg);
    await deleteDoc(doc(col, id));
  },
  watchControl(cb) {
    if (!ok) { cb({}); return () => {}; }
    return onSnapshot(controlRef(), s => cb(s.exists() ? s.data() : {}), () => cb({}));
  },
  async setControl(patch) {
    if (!ok) throw new Error(this.notReadyMsg);
    await setDoc(controlRef(), patch, { merge: true });
  },
  heartbeat(info) {
    if (!ok) return;
    setDoc(presenceRef(), { lastSeen: serverTimestamp(), scene: String(info.scene || ""), count: Number(info.count) || 0 }).catch(() => {});
  },
  watchPresence(cb) {
    if (!ok) { cb(null); return () => {}; }
    return onSnapshot(presenceRef(), s => {
      const d = s.exists() ? s.data() : null;
      cb(d ? { lastSeen: d.lastSeen && d.lastSeen.toMillis ? d.lastSeen.toMillis() : 0, scene: d.scene, count: d.count } : null);
    }, () => cb(null));
  },
  // 控制台登入：共用控台帳號＋密碼。真正的權限由 firestore.rules 把關，
  // 登入後先試寫一次控制設定，寫不進去就代表這個帳號不在規則名單內
  auth: {
    onChange(cb) {
      if (!auth) { cb({ ok: false, noSignIn: true, reason: "尚未設定 Firebase" }); return; }
      onAuthStateChanged(auth, async u => {
        if (!u) return cb({ ok: false, signedOut: true });
        try {
          await setDoc(controlRef(), { lastLogin: serverTimestamp() }, { merge: true });
          cb({ ok: true, name: String(u.email || "").split("@")[0] });
        } catch (e) {
          cb({ ok: false, name: u.email, reason: "這個帳號沒有控制台權限（請確認 firestore.rules 名單）" });
        }
      });
    },
    async signIn(email, password) {
      try {
        let id = String(email || "").trim().toLowerCase();
        if (id && !id.includes("@")) id += "@" + (cfg.consoleDomain || "510.org.tw");
        await signInWithEmailAndPassword(auth, id, String(password || ""));
      } catch (e) {
        const c = e && e.code || "";
        if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) throw new Error("帳號或密碼不正確");
        if (/too-many-requests/.test(c)) throw new Error("嘗試太多次，請稍等幾分鐘再試");
        if (/network/.test(c)) throw new Error("網路連線失敗，請檢查網路");
        if (/operation-not-allowed/.test(c)) throw new Error("Firebase 尚未開啟「電子郵件／密碼」登入");
        throw new Error(c || "登入失敗");
      }
    },
    async signOut() { await signOut(auth); }
  }
};
window.dispatchEvent(new Event("pbstore"));
