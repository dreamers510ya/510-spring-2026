/* 主持人控制台 */
(function () {
  const cfg = window.PB_CONFIG;
  const $ = id => document.getElementById(id);
  if (!$("cc")) return;
  const WC = cfg.wall || {};
  const SCENE_NAME = { kv: "主視覺", pages: "輪播牆", mosaic: "大合照", cloud: "文字雲", slides: "簡報" };
  let store = null, ctrl = {}, presence = null, started = false;
  const photos = new Map();   // id -> {id, img, name, ts}
  let filter = "all", limit = 60, lastTs = 0;
  const freshIds = new Set();

  const C = () => Object.assign({ mode: "kv", shape: WC.shape || "rect", shapeText: WC.shapeText || "夢", tour: true, names: WC.showNames !== false, qrUrl: "", hidden: [], demo: 0, questions: [], activeQ: "", cloudOpen: false, blocked: [], decks: [], deck: "", slide: 0, pos: {} }, ctrl);
  const slides = new Map();    // id -> {id, deck, idx, thumb}
  const fullSrc = new Map();   // id -> 大圖網址（預覽用）
  const answers = new Map();   // id -> {q, w, ts}

  // ---------- 提示 ----------
  let toastT = null, undoFn = null;
  function toast(text, undo) {
    $("ccToastT").textContent = text;
    undoFn = undo || null;
    $("ccToastUndo").hidden = !undo;
    $("ccToast").hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { $("ccToast").hidden = true; undoFn = null; }, undo ? 6000 : 2600);
  }
  $("ccToastUndo").addEventListener("click", () => { const f = undoFn; $("ccToast").hidden = true; if (f) f(); });

  async function setControl(patch, msg, undoPatch) {
    const before = ctrl;
    ctrl = Object.assign({}, ctrl, patch); syncUI();
    try {
      await store.setControl(patch);
      if (msg) toast(msg, undoPatch ? () => setControl(undoPatch, "已復原") : null);
    } catch (e) {
      ctrl = before; syncUI();
      toast("沒有成功：" + (e && e.message ? e.message : "請檢查網路或登入狀態"));
    }
  }

  // ---------- 畫面同步 ----------
  function syncUI() {
    const c = C();
    document.querySelectorAll(".cc-scene").forEach(b => b.setAttribute("aria-checked", String(b.dataset.scene === c.mode)));
    document.querySelectorAll("[data-shape]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.shape === c.shape)));
    $("ccTextWrap").hidden = c.shape !== "text";
    if (document.activeElement !== $("ccShapeText")) $("ccShapeText").value = c.shapeText;
    $("ccTour").checked = !!c.tour;
    $("ccNames").checked = !!c.names;
    if (document.activeElement !== $("ccQr")) $("ccQr").value = c.qrUrl || "";
    $("ccDemoNow").textContent = c.demo ? `目前示範照片 ${c.demo} 張` : "";
    $("ccHiddenN").textContent = (c.hidden || []).length;
    renderPresence();
    renderGrid();
    renderCloud();
    renderSlides();
  }

  function rel(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + " 秒前";
    if (s < 3600) return Math.floor(s / 60) + " 分鐘前";
    return Math.floor(s / 3600) + " 小時前";
  }
  function renderPresence() {
    const on = presence && presence.lastSeen && Date.now() - Number(presence.lastSeen) < 45000;
    $("ccDot").className = "dot " + (on ? "on" : "off");
    $("ccOnline").textContent = on ? "大螢幕在線" : "大螢幕未連線";
    $("ccOnlineSub").textContent = on ? "正在投影：" + (SCENE_NAME[presence.scene] || "—") : "請在投影電腦開啟投影畫面";
    const hid = new Set(C().hidden || []);
    $("ccCount").textContent = [...photos.keys()].filter(id => !hid.has(id)).length.toLocaleString("zh-TW");
    $("ccLast").textContent = lastTs ? rel(lastTs) : "—";
  }
  setInterval(renderPresence, 5000);

  // ---------- 照片格 ----------
  function fmtTime(ts) { const d = new Date(ts); return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }); }
  let gridT = null;
  function renderGrid() { clearTimeout(gridT); gridT = setTimeout(drawGrid, 120); }
  function drawGrid() {
    const hid = new Set(C().hidden || []);
    let list = [...photos.values()].sort((a, b) => b.ts - a.ts);
    if (filter === "hidden") list = list.filter(p => hid.has(p.id));
    const total = list.length;
    list = list.slice(0, limit);
    const g = $("ccGrid"); g.textContent = "";
    for (const p of list) {
      const isH = hid.has(p.id);
      const card = document.createElement("div");
      card.className = "cc-ph" + (isH ? " is-hidden" : "") + (freshIds.has(p.id) ? " is-new" : "");
      const im = document.createElement("img"); im.src = p.img; im.alt = p.name || "來賓照片"; im.loading = "lazy";
      const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = p.name || "（未署名）";
      const tm = document.createElement("div"); tm.className = "tm"; tm.textContent = fmtTime(p.ts) + (isH ? "・已隱藏" : "");
      const acts = document.createElement("div"); acts.className = "acts";
      const bt = document.createElement("button"); bt.type = "button";
      bt.textContent = isH ? "復原" : "隱藏";
      bt.addEventListener("click", () => isH ? unhide(p.id) : hide(p.id));
      const del = document.createElement("button"); del.type = "button"; del.className = "del";
      del.textContent = "刪除"; del.setAttribute("aria-label", "永久刪除 " + (p.name || "這張照片"));
      del.addEventListener("click", () => delPhotos([p.id]));
      acts.append(bt, del);
      card.append(im, nm, tm, acts);
      g.appendChild(card);
    }
    $("ccEmpty").hidden = total > 0;
    $("ccEmpty").textContent = filter === "hidden" ? "沒有隱藏的照片。" : "還沒有照片。來賓上傳後會出現在這裡。";
    $("ccMore").hidden = total <= limit;
    $("ccDelHidden").hidden = !(filter === "hidden" && total > 0);
  }
  async function delPhotos(ids) {
    const one = ids.length === 1, p = one ? photos.get(ids[0]) : null;
    const ok = await ask(one ? "永久刪除這張照片？" : `永久刪除 ${ids.length} 張已隱藏的照片？`,
      "照片會從資料庫刪除，大螢幕、大合照、控制台都不會再出現，無法復原。只想先拿下大螢幕，請用「隱藏」。",
      one ? "永久刪除" : `刪除 ${ids.length} 張`, p ? p.img : "");
    if (!ok) return;
    let done = 0;
    for (const id of ids) {
      try { await store.deletePhoto(id); done++; photos.delete(id); } catch (e) { toast("刪除沒有成功：" + (e && e.message ? e.message : "請檢查網路或登入狀態")); break; }
    }
    const left = (C().hidden || []).filter(x => !ids.includes(x));
    if (left.length !== (C().hidden || []).length) setControl({ hidden: left });
    if (done) toast(done === 1 ? "已永久刪除照片" : `已永久刪除 ${done} 張照片`);
    renderGrid(); renderPresence();
  }
  $("ccDelHidden").addEventListener("click", () => delPhotos((C().hidden || []).filter(id => photos.has(id))));

  // 確認視窗（不用瀏覽器內建 confirm，嵌入頁面也能正常顯示）
  function ask(title, body, okText, img) {
    return new Promise(res => {
      const d = $("ccAsk");
      $("ccAskT").textContent = title; $("ccAskB").textContent = body || ""; $("ccAskOk").textContent = okText || "確定";
      $("ccAskImg").hidden = !img; if (img) $("ccAskImg").src = img;
      d.hidden = false; $("ccAskNo").focus();
      const done = v => { d.hidden = true; $("ccAskOk").onclick = $("ccAskNo").onclick = d.onkeydown = d.onclick = null; res(v); };
      $("ccAskOk").onclick = () => done(true);
      $("ccAskNo").onclick = () => done(false);
      d.onclick = e => { if (e.target === d) done(false); };
      d.onkeydown = e => { if (e.key === "Escape") done(false); };
    });
  }
  function hide(id) {
    const h = new Set(C().hidden || []); h.add(id);
    setControl({ hidden: [...h] }, "已從大螢幕隱藏", { hidden: (C().hidden || []).filter(x => x !== id) });
  }
  function unhide(id) {
    setControl({ hidden: (C().hidden || []).filter(x => x !== id) }, "已復原，照片會回到大螢幕");
  }
  $("ccMore").addEventListener("click", () => { limit += 60; drawGrid(); });
  document.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.filter; limit = 60;
    document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    drawGrid();
  }));

  // ---------- 控制 ----------
  document.querySelectorAll(".cc-scene").forEach(b => b.addEventListener("click", () => {
    if (b.disabled || C().mode === b.dataset.scene) return;
    const prev = C().mode;
    if (b.dataset.scene === "slides" && !C().decks.some(d => d.id === C().deck)) {
      toast("請先在「簡報」上傳 PDF，並選一份簡報");
      $("ccSlidesCard").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (b.dataset.scene === "cloud" && !C().activeQ) {
      toast("請先在下方「文字雲」新增題目，按「投影這題」");
      $("ccCloudCard").scrollIntoView({ behavior: "smooth", block: "center" }); $("ccQNew").focus();
      return;
    }
    setControl({ mode: b.dataset.scene }, "大螢幕已切換為「" + SCENE_NAME[b.dataset.scene] + "」", { mode: prev });
  }));
  document.querySelectorAll("[data-shape]").forEach(b => b.addEventListener("click", () => {
    setControl({ shape: b.dataset.shape }, "大合照形狀：" + b.textContent);
  }));
  $("ccShapeTextApply").addEventListener("click", () => {
    const t = $("ccShapeText").value.trim().slice(0, 3);
    if (!t) { toast("請輸入 1～3 個字"); return; }
    setControl({ shapeText: t }, "大合照會拼出「" + t + "」");
  });
  $("ccTour").addEventListener("change", e => setControl({ tour: e.target.checked }, e.target.checked ? "鏡頭巡覽：開" : "鏡頭巡覽：關"));
  $("ccNames").addEventListener("change", e => setControl({ names: e.target.checked }, e.target.checked ? "顯示署名：開" : "顯示署名：關"));
  $("ccQrSave").addEventListener("click", () => setControl({ qrUrl: $("ccQr").value.trim() }, "QR code 網址已更新"));
  document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => {
    const n = Number(b.dataset.demo);
    const v = n === 0 ? 0 : (n === 40 ? (C().demo || 0) + 40 : 1000);
    setControl({ demo: v }, n === 0 ? "已清除示範照片" : `大螢幕示範照片：${v} 張`);
  }));

  // ---------- 文字雲 ----------
  let cloudT = null;
  function renderCloud() { clearTimeout(cloudT); cloudT = setTimeout(drawCloud, 150); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, fn, cls) { const b = el("button", "cc-btn small" + (cls ? " " + cls : ""), text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function drawCloud() {
    const c = C(), qs = c.questions || [], all = [...answers.values()];
    const active = qs.find(q => q.id === c.activeQ);
    const ul = $("ccQList"); ul.textContent = "";
    for (const q of qs) {
      const n = window.PBWords.tally(all, q.id, c.blocked).reduce((s, e) => s + e.n, 0);
      const li = el("li", "cc-q" + (q.id === c.activeQ ? " on" : ""));
      const t = el("div", "qt", q.text); t.appendChild(el("span", "qn", n + " 則回應"));
      const act = el("div", "qa");
      if (q.id === c.activeQ && c.mode === "cloud") act.appendChild(el("span", "live", "投影中"));
      else act.appendChild(btn("投影這題", () => showQ(q), "primary"));
      act.appendChild(btn("刪除", () => delQ(q), "ghost"));
      li.append(t, act); ul.appendChild(li);
    }
    $("ccQEmpty").hidden = qs.length > 0;
    $("ccOpenRow").hidden = !active;
    $("ccCloudOpen").checked = !!c.cloudOpen;
    $("ccCloudState").textContent = !active ? "" : (c.cloudOpen ? "來賓可以作答" : "已暫停作答");
    $("ccWordsWrap").hidden = !active;
    if (active) {
      const list = window.PBWords.tally(all, active.id, c.blocked);
      const wl = $("ccWList"); wl.textContent = "";
      for (const w of list.slice(0, 120)) {
        const li = el("li", "cc-w"); li.append(el("b", "", w.text), el("small", "", "×" + w.n), btn("移除", () => blockW(w)));
        const vs = Object.entries(w.vars || {}).sort((x, y) => y[1] - x[1]);
        if (vs.length > 1 || (vs[0] && vs[0][0] !== w.text)) {
          li.title = "合併：" + vs.map(([t, c]) => t + " " + c).join("、");
          li.insertBefore(el("small", "cc-merge", "含 " + vs.length + " 種說法"), li.lastChild);
        }
        wl.appendChild(li);
      }
      $("ccWEmpty").hidden = list.length > 0;
    }
    const bl = c.blocked || [];
    $("ccBlockedWrap").hidden = !bl.length;
    $("ccBlockedN").textContent = bl.length;
    const bu = $("ccBList"); bu.textContent = "";
    for (const k of bl) { const li = el("li", "cc-w"); li.append(el("b", "", k), btn("復原", () => unblockW(k))); bu.appendChild(li); }
  }
  function addQ() {
    const t = $("ccQNew").value.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!t) { toast("請輸入題目"); return; }
    const q = { id: "q" + Date.now().toString(36), text: t };
    $("ccQNew").value = "";
    setControl({ questions: [...C().questions, q] }, "已新增題目，按「投影這題」開始");
  }
  function showQ(q) {
    const prev = { mode: C().mode, activeQ: C().activeQ, cloudOpen: C().cloudOpen };
    setControl({ activeQ: q.id, mode: "cloud", cloudOpen: true }, "大螢幕已切到文字雲：「" + q.text + "」，來賓可以作答", prev);
  }
  async function delQ(q) {
    if (!(await ask("刪除題目「" + q.text + "」？", "已收到的回答會一起從控制台消失。", "刪除題目"))) return;
    const patch = { questions: C().questions.filter(x => x.id !== q.id) };
    if (C().activeQ === q.id) { patch.activeQ = ""; patch.cloudOpen = false; if (C().mode === "cloud") patch.mode = "kv"; }
    setControl(patch, patch.mode ? "已刪除題目，大螢幕回到主視覺" : "已刪除題目");
  }
  function blockW(w) {
    const bl = new Set(C().blocked); bl.add(w.key);
    setControl({ blocked: [...bl] }, "已從文字雲移除「" + w.text + "」", { blocked: C().blocked.filter(x => x !== w.key) });
  }
  function unblockW(k) { setControl({ blocked: C().blocked.filter(x => x !== k) }, "已復原「" + k + "」"); }
  $("ccQAdd").addEventListener("click", addQ);
  $("ccQNew").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) addQ(); });
  $("ccCloudOpen").addEventListener("change", e => setControl({ cloudOpen: e.target.checked }, e.target.checked ? "已開放來賓作答" : "已暫停作答，大螢幕保留目前結果"));
  function onAnswer(a) {
    if (!a || answers.has(a.id) || typeof a.w !== "string") return;
    answers.set(a.id, { q: String(a.q), w: a.w, ts: Number(a.ts) || Date.now() });
    renderCloud();
  }

  // ---------- 簡報 ----------
  let slT = null, uploading = false, gridKey = "";
  function renderSlides() { clearTimeout(slT); slT = setTimeout(drawSlides, 80); }
  function deckList(deck) {
    const byIdx = new Map();
    for (const s of slides.values()) if (s.deck === deck && !byIdx.has(s.idx)) byIdx.set(s.idx, s);
    return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
  }
  function curDeck() { const c = C(); return c.decks.find(d => d.id === c.deck) || null; }
  function drawSlides() {
    const c = C(), deck = curDeck();
    const dw = $("ccDecks"); dw.textContent = "";
    for (const d of c.decks) {
      const w = el("span", "cc-deck"); w.setAttribute("role", "radio"); w.setAttribute("aria-checked", String(d.id === c.deck));
      const p = el("button", "pick", d.name); p.type = "button"; p.appendChild(el("small", "", d.n + " 頁"));
      p.addEventListener("click", () => pickDeck(d));
      const x = el("button", "del", "×"); x.type = "button"; x.setAttribute("aria-label", "刪除簡報 " + d.name);
      x.addEventListener("click", () => delDeck(d));
      w.append(p, x); dw.appendChild(w);
    }
    $("ccSlEmpty").hidden = c.decks.length > 0;
    $("ccSlBody").hidden = !deck;
    const live = c.mode === "slides";
    $("ccSlState").textContent = !deck ? "" : (live ? "大螢幕投影中" : "目前沒有投影簡報，換頁只會先準備好");
    if (!deck) return;
    const list = deckList(deck.id), n = list.length || deck.n, i = Math.min(c.slide, Math.max(0, n - 1));
    $("ccSlPage").textContent = (i + 1) + " / " + n;
    $("ccSlPrev").disabled = i <= 0; $("ccSlNextBtn").disabled = i >= n - 1;
    $("ccSlShow").hidden = live;
    $("ccSlCurCap").textContent = live ? "大螢幕這一頁" : "目前這一頁（尚未投影）";
    const cur = list[i], nx = list[i + 1];
    showPv($("ccSlCur"), cur);
    showPv($("ccSlNext"), nx);
    $("ccSlNextCap").textContent = nx ? "下一頁" : "已是最後一頁";
    const key = deck.id + ":" + list.length;
    const g = $("ccSlGrid");
    if (key !== gridKey) {
      gridKey = key; g.textContent = "";
      list.forEach((s, k) => {
        const b = el("button"); b.type = "button"; b.setAttribute("aria-label", "第 " + (k + 1) + " 頁");
        const im = el("img"); im.src = s.thumb; im.alt = ""; im.decoding = "async";
        b.append(im, el("span", "", String(k + 1)));
        b.addEventListener("click", () => go(k, true));
        g.appendChild(b);
      });
    }
    [...g.children].forEach((b, k) => b.setAttribute("aria-current", String(k === i)));
    const on = g.children[i];
    if (on && live) { const gr = g.getBoundingClientRect(), r = on.getBoundingClientRect(); if (r.top < gr.top || r.bottom > gr.bottom) g.scrollTop += r.top - gr.top - 8; }
  }
  // 預覽先放縮圖，再換成清楚的大圖
  function showPv(img, s) {
    if (!s) { img.removeAttribute("src"); img.dataset.id = ""; return; }
    if (img.dataset.id === s.id) return;
    img.dataset.id = s.id; img.src = s.thumb;
    const f = fullSrc.get(s.id);
    if (f) { img.src = f; return; }
    store.slideSrc(s.id).then(u => {
      if (!u) return;
      fullSrc.set(s.id, u);
      if (img.dataset.id === s.id) img.src = u;
    }).catch(() => {});
  }
  function go(i, show) {
    const c = C(), deck = curDeck(); if (!deck) return;
    const n = deckList(deck.id).length || deck.n;
    i = Math.max(0, Math.min(n - 1, i));
    const patch = { slide: i, pos: Object.assign({}, c.pos, { [deck.id]: i }) };
    if (show && c.mode !== "slides") { patch.mode = "slides"; setControl(patch, "大螢幕已切換為「簡報」", { mode: c.mode }); }
    else if (i !== c.slide) setControl(patch);
  }
  function pickDeck(d) {
    if (C().deck === d.id) return;
    setControl({ deck: d.id, slide: (C().pos || {})[d.id] || 0 }, C().mode === "slides" ? "大螢幕換成「" + d.name + "」" : "已選「" + d.name + "」");
  }
  async function delDeck(d) {
    if (!(await ask("刪除簡報「" + d.name + "」？", "共 " + d.n + " 頁，刪除後要重新上傳。", "刪除簡報"))) return;
    const c = C(), patch = { decks: c.decks.filter(x => x.id !== d.id) };
    const pos = Object.assign({}, c.pos); delete pos[d.id]; patch.pos = pos;
    if (c.deck === d.id) {
      const nx = patch.decks[0];
      patch.deck = nx ? nx.id : ""; patch.slide = nx ? (pos[nx.id] || 0) : 0;
      if (!nx && c.mode === "slides") patch.mode = "kv";
    }
    await setControl(patch, "已刪除簡報「" + d.name + "」");
    try { await store.deleteDeck(d.id); } catch (e) {}
  }
  $("ccSlPrev").addEventListener("click", () => go(C().slide - 1));
  $("ccSlNextBtn").addEventListener("click", () => go(C().slide + 1));
  $("ccSlShow").addEventListener("click", () => go(C().slide, true));
  document.addEventListener("keydown", e => {
    if (C().mode !== "slides" || !curDeck() || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(C().slide + 1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(C().slide - 1); }
  });

  // 上傳：PDF 用 pdf.js 逐頁轉成 JPEG；圖片依檔名數字排序（投影片1、投影片2…投影片10）
  const isPdf = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("讀取 PDF 工具失敗，可改成上傳圖片（PNG／JPG）")); document.head.appendChild(s); });
  }
  async function pdfLib() {
    if (window.pdfjsLib) return window.pdfjsLib;
    const base = cfg.pdfjs || "pdfjs/";
    await loadScript(base + "pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
    return window.pdfjsLib;
  }
  function encode(src, w, h, max) {
    let k = Math.min(1, 1920 / w, 1080 / h);
    for (let tries = 0; tries < 6; tries++) {
      const cv = document.createElement("canvas");
      cv.width = Math.round(w * k); cv.height = Math.round(h * k);
      const x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height);
      x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, cv.width, cv.height);
      for (const q of [.9, .82, .74, .66, .58]) {
        const url = cv.toDataURL("image/jpeg", q);
        if (url.length <= max) return url;
      }
      k *= .8;
    }
    throw new Error("這一頁內容太複雜，壓縮後仍太大");
  }
  function encodeThumb(src, w, h) {
    const k = Math.min(400 / w, 225 / h);
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height);
    x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", .72);
  }
  async function* pagesOf(files) {
    const pdf = files.find(isPdf);
    if (pdf) {
      const lib = await pdfLib();
      const base = cfg.pdfjsData || cfg.pdfjs || "pdfjs/";
      const doc = await lib.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()), cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/" }).promise;
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const v0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(1920 / v0.width, 1080 / v0.height) });
        const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp, background: "#ffffff" }).promise;
        page.cleanup();
        yield { src: cv, w: cv.width, h: cv.height, total: doc.numPages };
      }
      return;
    }
    const imgs = files.filter(f => /^image\//.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
    for (const f of imgs) {
      const bmp = await createImageBitmap(f).catch(() => null);
      if (!bmp) throw new Error("讀不到圖片：" + f.name);
      yield { src: bmp, w: bmp.width, h: bmp.height, total: imgs.length };
    }
  }
  async function upload(files) {
    if (uploading || !files.length) return;
    uploading = true; $("ccSlUpLbl").classList.add("busy");
    const prog = t => { $("ccSlProg").textContent = t; };
    const first = files.find(isPdf) || files[0];
    const name = (first.name.replace(/\.[^.]+$/, "") || "簡報").slice(0, 24);
    const id = "d" + Date.now().toString(36);
    let n = 0;
    try {
      prog("讀取檔案中…");
      for await (const pg of pagesOf(files)) {
        prog(`轉換並上傳第 ${n + 1} / ${pg.total} 頁…`);
        const img = encode(pg.src, pg.w, pg.h, store.slideMax || 900000);
        const thumb = encodeThumb(pg.src, pg.w, pg.h);
        await store.addSlide({ deck: id, idx: n, img, thumb });
        n++;
      }
      if (!n) throw new Error("沒有找到可用的頁面，請上傳 PDF 或圖片");
      const c = C(), patch = { decks: [...c.decks, { id, name, n }] };
      if (!curDeck()) { patch.deck = id; patch.slide = 0; }
      await setControl(patch, "簡報「" + name + "」已上傳，共 " + n + " 頁");
      prog("");
    } catch (e) {
      prog("上傳沒有完成：" + (e && e.message ? e.message : "請再試一次"));
      try { await store.deleteDeck(id); } catch (er) {}
    }
    uploading = false; $("ccSlUpLbl").classList.remove("busy"); $("ccSlFile").value = "";
  }
  $("ccSlFile").addEventListener("change", e => upload([...e.target.files]));
  function onSlide(s) {
    if (!s || slides.has(s.id)) return;
    slides.set(s.id, { id: s.id, deck: String(s.deck), idx: Number(s.idx) || 0, thumb: s.thumb || "" });
    renderSlides();
  }

  // ---------- 啟動 ----------
  function whenStore() {
    if (window.PBStore) return Promise.resolve(window.PBStore);
    return new Promise(r => window.addEventListener("pbstore", () => r(window.PBStore), { once: true }));
  }
  function onPhoto(raw, initial) {
    if (photos.has(raw.id) || typeof raw.img !== "string" || !/^data:image\//.test(raw.img)) return;
    const p = { id: String(raw.id), img: raw.img, name: String(raw.name || "").slice(0, 16), ts: Number(raw.ts) || Date.now() };
    photos.set(p.id, p);
    lastTs = Math.max(lastTs, p.ts);
    if (!initial) { freshIds.add(p.id); setTimeout(() => { freshIds.delete(p.id); renderGrid(); }, 15000); }
    renderGrid(); renderPresence();
  }
  function onRemove(id) { photos.delete(id); renderGrid(); renderPresence(); }

  async function start() {
    if (started) return; started = true;
    $("ccEvent").textContent = cfg.subtitle || "";
    store = await whenStore();
    const auth = store.auth || { onChange: cb => cb({ ok: true }) };
    let dataOn = false;
    auth.onChange(st => {
      $("ccUser").textContent = st.ok && st.name ? st.name : "";
      $("ccSignOut").hidden = !(st.ok && store.auth && store.auth.signOut && !st.noSignOut);
      $("ccLogin").hidden = !!st.ok;
      $("ccMain").hidden = !st.ok;
      $("ccLoginForm").hidden = !!st.noSignIn;
      $("ccSignIn").disabled = false; $("ccSignIn").textContent = "登入";
      if (!st.ok) {
        $("ccLoginMsg").textContent = st.reason || "只有控台人員可以切換大螢幕、管理照片與簡報。";
        if (!$("ccAcct").value) $("ccAcct").value = cfg.consoleAccount || "";
        if (!st.noSignIn) setTimeout(() => ($("ccAcct").value ? $("ccPw") : $("ccAcct")).focus(), 50);
        return;
      }
      $("ccPw").value = ""; $("ccLoginErr").textContent = "";
      if (dataOn) return; dataOn = true;
      store.subscribe(onPhoto, onRemove, msg => { if (msg) toast(msg); });
      store.watchControl(c => { ctrl = c || {}; syncUI(); });
      if (store.subscribeAnswers) store.subscribeAnswers(onAnswer, id => { answers.delete(id); renderCloud(); }, () => {});
      if (store.subscribeSlides) store.subscribeSlides(onSlide, id => { slides.delete(id); gridKey = ""; renderSlides(); }, () => {});
      if (store.watchPresence) store.watchPresence(p => { presence = p; renderPresence(); });
      syncUI();
    });
    $("ccLoginForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (!auth.signIn) return;
      const acct = $("ccAcct").value.trim(), pw = $("ccPw").value;
      if (!acct || !pw) { $("ccLoginErr").textContent = "請輸入帳號和密碼"; return; }
      $("ccSignIn").disabled = true; $("ccSignIn").textContent = "登入中…"; $("ccLoginErr").textContent = "";
      try { await auth.signIn(acct, pw); }
      catch (er) { $("ccLoginErr").textContent = er && er.message ? er.message : "登入沒有成功"; $("ccSignIn").disabled = false; $("ccSignIn").textContent = "登入"; }
    });
    $("ccPwShow").addEventListener("click", () => {
      const show = $("ccPw").type === "password";
      $("ccPw").type = show ? "text" : "password";
      $("ccPwShow").textContent = show ? "隱藏" : "顯示"; $("ccPwShow").setAttribute("aria-pressed", String(show));
    });
    $("ccSignOut").addEventListener("click", () => auth.signOut && auth.signOut());
  }
  window.PBConsole = { start };
})();
