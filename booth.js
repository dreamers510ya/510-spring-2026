/* 自拍頁邏輯 */
(function () {
  const cfg = window.PB_CONFIG;
  const R = window.PBRender;
  const $ = id => document.getElementById(id);
  if (!$("booth")) return;

  const S = {
    frameIdx: 0, filterIdx: 0,
    facing: "user", stream: null,
    mode: "home",           // home | live | still
    source: null,           // canvas / image；四格拍貼時為陣列
    shots: [], slot: 0,
    view: { zoom: 1, dx: 0, dy: 0 }, adjusting: false,     // 四格拍貼：已拍的照片與目前要拍第幾格
    timer: 0,
    blob: null, uploaded: false, renderToken: 0,
    liveAllowed: !cfg.noLiveCamera && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  };

  // ---------- 文案 ----------
  if (!$("homeTitle").querySelector("img")) $("homeTitle").textContent = cfg.title;
  // 鏡頭選擇（前鏡頭自拍／後鏡頭幫拍）
  function setFacing(f) {
    S.facing = f;
    if (f === "user") S.lensWide = false;
    document.querySelectorAll(".cam-pick [data-facing]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.facing === f)));
    $("fileCam").setAttribute("capture", f);
    $("flipLbl").textContent = f === "user" ? "換後鏡頭" : "換前鏡頭";
  }
  document.querySelectorAll(".cam-pick [data-facing]").forEach(b => b.addEventListener("click", () => setFacing(b.dataset.facing)));

  // ---------- In-app browser 提示 ----------
  const ua = navigator.userAgent || "";
  if (/FBAN|FBAV|Instagram/i.test(ua)) {
    const h = $("homeHint"); h.className = "hint warn";
    h.textContent = "目前在 Facebook／Instagram 內建瀏覽器，相機可能打不開。請點右上角「⋯」選擇「用瀏覽器開啟」。";
  }

  // ---------- Chips ----------
  function chipRow(el, items, getIdx, setIdx) {
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip";
      b.setAttribute("role", "radio");
      const im = document.createElement("img"); im.alt = ""; im.className = "th";
      const tx = document.createElement("span"); tx.textContent = it.name;
      b.append(im, tx);
      b.addEventListener("click", () => { setIdx(i); sync(); b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); });
      el.appendChild(b);
    });
    function sync() {
      [...el.querySelectorAll(".chip")].forEach((b, i) => b.setAttribute("aria-checked", String(i === getIdx())));
    }
    sync();
    return sync;
  }
  const syncFrameChips = chipRow($("frameChips"), cfg.frames, () => S.frameIdx, i => { S.frameIdx = i; onLookChange(); });
  chipRow($("filterChips"), R.FILTERS, () => S.filterIdx, i => { S.filterIdx = i; onLookChange(); });

  // 相框縮圖
  (async () => {
    const imgs = $("frameChips").querySelectorAll(".th");
    for (let i = 0; i < cfg.frames.length; i++) {
      try { imgs[i].src = await R.frameThumb(cfg.frames[i], cfg); } catch (e) {}
    }
  })();
  // 濾鏡縮圖：拍照前用範例圖，拍照後換成自己的照片
  function paintFilterThumbs(src) {
    const imgs = $("filterChips").querySelectorAll(".th");
    R.FILTERS.forEach((f, i) => { imgs[i].src = R.filterThumb(src, f); });
  }
  paintFilterThumbs(R.sampleSource());

  function setTab(which) {
    const map = { frame: ["tabFrame", "frameChips"], filter: ["tabFilter", "filterChips"], sticker: ["tabSticker", "stkPanel"] };
    for (const [k, [tab, panel]] of Object.entries(map)) {
      $(tab).setAttribute("aria-selected", String(k === which));
      $(panel).hidden = k !== which;
    }
    if (which === "sticker") { if (S.adjusting) endAdjust(); enterStickers(); }
    else exitStickers();
  }
  $("tabFrame").addEventListener("click", () => setTab("frame"));
  $("tabFilter").addEventListener("click", () => setTab("filter"));
  $("tabSticker").addEventListener("click", () => setTab("sticker"));

  const frameDef = () => cfg.frames[S.frameIdx];
  const filter = () => R.FILTERS[S.filterIdx];
  const isGrid = () => !!frameDef().windows;
  const gridN = () => isGrid() ? frameDef().windows.length : 1;
  const firstShot = () => Array.isArray(S.source) ? S.source.find(Boolean) : S.source;
  const missing = () => { if (!isGrid()) return -1; for (let i = 0; i < gridN(); i++) if (!S.shots[i]) return i; return -1; };
  function resetShots() { S.shots = []; S.slot = 0; }
  function poseText() {
    const d = frameDef();
    if (d.poses) return `第 ${S.slot + 1}／${gridN()} 張｜${d.poses[S.slot] || ""}`;
    return d.pose || "";
  }

  // ---------- 即時預覽圖層 ----------
  async function paintOverlay() {
    const ov = await R.frameOverlay(frameDef(), cfg);
    const fl = $("frameLayer"), ctx = fl.getContext("2d");
    ctx.clearRect(0, 0, fl.width, fl.height); ctx.drawImage(ov.canvas, 0, 0);
    // 四格拍貼：已拍好的格子畫在下層
    const sl = $("shotLayer"), sctx = sl.getContext("2d");
    sctx.clearRect(0, 0, sl.width, sl.height);
    if (ov.windows) ov.windows.forEach((w, i) => { if (S.shots[i] && i !== S.slot) R.drawPhoto(sctx, S.shots[i], w, filter()); });
    const w = ov.windows ? ov.windows[Math.min(S.slot, ov.windows.length - 1)] : ov.window, pct = (v, t) => (v / t * 100) + "%";
    const pt = poseText(); $("pose").textContent = pt; $("pose").hidden = !pt;
    // 擊拳引導框（只在拍照預覽時顯示，不會出現在成品）
    const g = frameDef().guide, ge = $("guide");
    ge.hidden = !g || S.mode !== "live";
    if (g) {
      ge.style.left = pct(g.x, R.W); ge.style.top = pct(g.y, R.H); ge.style.width = pct(g.w, R.W); ge.style.height = pct(g.h, R.H);
      $("guideLbl").textContent = g.label || "";
    }
    for (const el of [$("video"), $("tint"), $("vig")]) {
      el.style.left = pct(w.x, R.W); el.style.top = pct(w.y, R.H);
      el.style.width = pct(w.w, R.W); el.style.height = pct(w.h, R.H);
    }
    const f = filter();
    $("video").style.filter = R.cssOf(f);
    $("tint").style.background = f.tint ? f.tint[0] : "transparent";
    $("tint").style.mixBlendMode = f.tint ? f.tint[1] : "normal";
    $("vig").style.background = f.vignette ? `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(20,0,0,${f.vignette}) 100%)` : "transparent";
  }

  function onLookChange() {
    // 換相框時，照片陣列跟著調整：單張相框用第一張；四格相框把現有照片放進第一格
    if (isGrid()) { if (!S.shots.length && S.source && !Array.isArray(S.source)) S.shots = [S.source]; if (S.mode === "still") S.source = S.shots.slice(); S.slot = Math.max(0, missing()); }
    else if (S.mode === "still" && Array.isArray(S.source)) S.source = S.source.find(Boolean);
    if (S.mode === "live") paintOverlay();
    else if (S.mode === "still") {
      updateGridUI(); S.view = { zoom: 1, dx: 0, dy: 0 };
      if (frameDef().guide && !isGrid()) { S.adjusting = true; updateAdjUI(); drawEdit(); }
      else { S.adjusting = false; updateAdjUI(); }
      renderStill();
    }
  }

  // ---------- Screens ----------
  function show(mode) {
    S.mode = mode;
    $("booth").classList.toggle("at-home", mode === "home");
    $("scrHome").hidden = mode !== "home";
    $("scrPick").hidden = mode !== "pick";
    $("scrAnswer").hidden = mode !== "answer";
    $("scrBrief").hidden = mode !== "brief";
    $("scrStudio").hidden = mode !== "live" && mode !== "still";
    const still = mode === "still";
    $("scrStudio").classList.toggle("is-still", still);
    $("dockLive").hidden = still;
    $("dockStill").hidden = !still;
    $("btnTimer").hidden = still;
    $("btnFlip").hidden = !S.liveAllowed;
    $("dockLive").classList.toggle("no-live", !S.liveAllowed);
    $("result").hidden = !still;
    $("frameLayer").hidden = still; $("shotLayer").hidden = still; $("pose").hidden = still || !poseText();
    if (still) $("guide").hidden = true;
    if (!still) { S.adjusting = false; $("editCv").hidden = true; $("adjHint").hidden = true; $("stage").classList.remove("adjusting"); }
    $("adjBar").hidden = !still;
    $("tabSticker").hidden = !still;
    if (mode !== "live") $("lens").hidden = true; else if (typeof syncLens === "function") syncLens();
    if (!still && !$("stkPanel").hidden) setTab("frame");
    for (const id of ["video", "tint", "vig"]) $(id).hidden = still;
    $("studioTitle").textContent = still ? "完成" : (S.facing === "user" ? "前鏡頭" : "後鏡頭");
    window.scrollTo(0, 0);
  }

  // ---------- 先選相框 ----------
  const TAG = { grid: "連拍 4 張", fist: "一起擊拳" };
  (async () => {
    const box = $("pickGrid");
    for (let i = 0; i < cfg.frames.length; i++) {
      const f = cfg.frames[i];
      const b = document.createElement("button");
      b.type = "button"; b.className = "pick-card"; b.setAttribute("role", "listitem");
      b.setAttribute("aria-label", f.name);
      const im = document.createElement("img"); im.alt = "";
      b.append(im);
      if (TAG[f.id]) { const tg = document.createElement("small"); tg.textContent = TAG[f.id]; b.append(tg); }
      b.addEventListener("click", () => choose(i));
      box.appendChild(b);
      try { im.src = await R.frameThumb(f, cfg, 360); } catch (e) {}
    }
  })();
  let nextSrc = "camera";          // camera | album
  function openPick(src) { nextSrc = src; resetShots(); show("pick"); }
  function choose(i) {
    S.frameIdx = i; syncFrameChips();
    resetShots();
    if (nextSrc === "album" && !isGrid()) { pickFile(false); return; }
    if (S.liveAllowed && nextSrc === "camera") { goLive(); return; }
    // 無法即時開相機（或從相簿選四格）：先看引導再拍
    if (isGrid() || frameDef().guide || frameDef().pose) { openBrief(); return; }
    pickFile(true);
  }
  async function openBrief() {
    S.slot = Math.max(0, missing());
    const d = frameDef();
    $("briefTitle").textContent = d.name;
    if (isGrid()) {
      $("briefStep").textContent = `第 ${S.slot + 1}／${gridN()} 張`;
      $("briefText").textContent = (d.poses && d.poses[S.slot]) ? `姿勢：${d.poses[S.slot]}` : "";
      $("btnBriefGo").textContent = `拍第 ${S.slot + 1} 張`;
    } else {
      $("briefStep").textContent = "拍照前先看一下";
      $("briefText").textContent = (d.pose || "") + (d.guide ? "\n拍完可以拖曳、縮放照片，把拳頭對準框框" : "");
      $("btnBriefGo").textContent = "開啟相機";
    }
    $("btnBriefAlbum").textContent = isGrid() ? `從相簿選第 ${S.slot + 1} 張` : "從相簿選照片";
    show("brief");
    const cv = document.createElement("canvas");
    await R.compose(cv, isGrid() ? S.shots.slice() : [null], d, filter(), cfg);
    const ctx = cv.getContext("2d");
    const hi = isGrid() ? d.windows[S.slot] : d.guide;
    if (hi) {
      ctx.save(); ctx.setLineDash([22, 14]); ctx.lineWidth = 10; ctx.strokeStyle = "#e2432f";
      ctx.strokeRect(hi.x + 8, hi.y + 8, hi.w - 16, hi.h - 16);
      if (d.guide && !isGrid()) {
        ctx.fillStyle = "#e2432f"; ctx.font = "700 46px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(d.guide.label || "拳頭對準這裡", hi.x + hi.w / 2, hi.y + hi.h + 60);
      }
      ctx.restore();
    }
    $("briefImg").src = cv.toDataURL("image/jpeg", 0.85);
  }
  $("btnBriefGo").addEventListener("click", () => pickFile(true));
  $("btnBriefAlbum").addEventListener("click", () => pickFile(false));
  $("btnBriefBack").addEventListener("click", () => show("pick"));
  $("btnPickBack").addEventListener("click", () => show("home"));

  // ---------- 文字雲：現場提問 ----------
  let liveQ = null, blocked = [];
  const ansKey = q => "pb-ans-" + cfg.eventId + "-" + q;
  const ansUsed = q => { try { return Number(localStorage.getItem(ansKey(q))) || 0; } catch (e) { return 0; } };
  function onControl(c) {
    c = c || {};
    blocked = Array.isArray(c.blocked) ? c.blocked : [];
    const qs = Array.isArray(c.questions) ? c.questions : [];
    const q = c.cloudOpen ? qs.find(x => x.id === c.activeQ) : null;
    liveQ = q || null;
    $("qBanner").hidden = !liveQ;
    if (liveQ) { $("qBannerText").textContent = liveQ.text; $("ansQ").textContent = liveQ.text; }
    if (S.mode === "answer") renderAnswer();
  }
  function renderAnswer() {
    if (!liveQ) { $("ansQ").textContent = "目前沒有開放回應的題目"; $("btnAnsSend").disabled = true; $("ansInput").disabled = true; return; }
    const left = 3 - ansUsed(liveQ.id);
    $("btnAnsSend").disabled = left <= 0; $("ansInput").disabled = left <= 0;
    if (left <= 0) setAns("這題已經回答 3 次了，謝謝你！抬頭看看大螢幕", "ok");
  }
  function setAns(t, k) { const e = $("ansStatus"); e.textContent = t; e.className = "status" + (k ? " " + k : ""); }
  function openAnswer() { setAns(""); show("answer"); renderAnswer(); setTimeout(() => $("ansInput").focus(), 50); }
  async function sendAnswer() {
    if (!liveQ) return;
    const raw = $("ansInput").value;
    const why = window.PBWords.blockedBy(raw, blocked);
    if (why) { setAns(why, "err"); return; }
    if (ansUsed(liveQ.id) >= 3) { renderAnswer(); return; }
    const btn = $("btnAnsSend"); btn.disabled = true; btn.textContent = "送出中…";
    try {
      const store = await whenStore();
      await withTimeout(store.submitAnswer({ q: liveQ.id, w: raw.trim().slice(0, 8) }), 15000);
      try { localStorage.setItem(ansKey(liveQ.id), String(ansUsed(liveQ.id) + 1)); } catch (e) {}
      $("ansInput").value = "";
      const left = 3 - ansUsed(liveQ.id);
      setAns(left > 0 ? `已送出！還可以再回答 ${left} 次` : "已送出！抬頭看看大螢幕的文字雲", "ok");
    } catch (e) {
      setAns("沒有送出成功：" + (e && e.message ? e.message : "請檢查網路"), "err");
    }
    btn.textContent = "送出"; renderAnswer();
    if (ansUsed(liveQ.id) < 3) btn.disabled = false;
  }
  $("qBanner").addEventListener("click", openAnswer);
  $("btnAnsSend").addEventListener("click", sendAnswer);
  $("ansInput").addEventListener("keydown", e => { if (e.key === "Enter") sendAnswer(); });
  $("btnAnsBack").addEventListener("click", () => show("home"));
  $("btnAnsPhoto").addEventListener("click", () => openPick("camera"));
  whenStore().then(st => { if (st.watchControl) st.watchControl(onControl); });

  // ---------- 貼紙：拍完後可加多張，拖曳移動、雙指或圓點縮放旋轉 ----------
  const STICKERS = [
    { id: "p-gongxi", cat: "word", name: "恭喜發財", src: "assets/stk_p-gongxi.webp" },
    { id: "p-caiyuan", cat: "word", name: "財源滾滾", src: "assets/stk_p-caiyuan.webp" },
    { id: "p-zhaocai", cat: "word", name: "招財進寶", src: "assets/stk_p-zhaocai.webp" },
    { id: "p-hongbao", cat: "word", name: "紅包拿來", src: "assets/stk_p-hongbao.webp" },
    { id: "p-xiqi", cat: "word", name: "喜氣羊羊", src: "assets/stk_p-xiqi.webp" },
    { id: "p-xingfu", cat: "word", name: "幸福羊溢", src: "assets/stk_p-xingfu.webp" },
    { id: "p-sanyang", cat: "word", name: "三羊開泰", src: "assets/stk_p-sanyang.webp" },
    { id: "p-dayun", cat: "word", name: "羊年行大運", src: "assets/stk_p-dayun.webp" },
    { id: "p-pingan", cat: "word", name: "健康平安", src: "assets/stk_p-pingan.webp" },
    { id: "p-ruyi", cat: "word", name: "萬事如意", src: "assets/stk_p-ruyi.webp" },
    { id: "p-tuanyuan", cat: "word", name: "闔家團圓", src: "assets/stk_p-tuanyuan.webp" },
    { id: "p-xinchun", cat: "word", name: "新春快樂", src: "assets/stk_p-xinchun.webp" },
    { id: "p-mengxiang", cat: "word", name: "一起夢想", src: "assets/stk_p-mengxiang.webp" },
    { id: "p-zuohuo", cat: "word", name: "作伙迎春", src: "assets/stk_p-zuohuo.webp" },
    { id: "p-aixin", cat: "word", name: "愛心滿滿", src: "assets/stk_p-aixin.webp" },
    { id: "p-chengzhen", cat: "word", name: "夢想成真", src: "assets/stk_p-chengzhen.webp" },
    { id: "i-yang1", cat: "icon", name: "小羊", src: "assets/stk_i-yang1.webp" },
    { id: "i-yang2", cat: "icon", name: "小羊捧紅包", src: "assets/stk_i-yang2.webp" },
    { id: "i-yang3", cat: "icon", name: "小羊比讚", src: "assets/stk_i-yang3.webp" },
    { id: "i-hongbao", cat: "icon", name: "紅包", src: "assets/stk_i-hongbao.webp" },
    { id: "i-hongbao3", cat: "icon", name: "紅包三連", src: "assets/stk_i-hongbao3.webp" },
    { id: "i-yuanbao", cat: "icon", name: "金元寶", src: "assets/stk_i-yuanbao.webp" },
    { id: "i-coins", cat: "icon", name: "金幣", src: "assets/stk_i-coins.webp" },
    { id: "i-lantern", cat: "icon", name: "燈籠", src: "assets/stk_i-lantern.webp" },
    { id: "i-firecracker", cat: "icon", name: "鞭炮", src: "assets/stk_i-firecracker.webp" },
    { id: "i-fu", cat: "icon", name: "福字", src: "assets/stk_i-fu.webp" },
    { id: "i-plum", cat: "icon", name: "梅花", src: "assets/stk_i-plum.webp" },
    { id: "i-cloud", cat: "icon", name: "祥雲", src: "assets/stk_i-cloud.webp" },
    { id: "i-sparkle", cat: "icon", name: "金光", src: "assets/stk_i-sparkle.webp" }
  ];
  const stkImgs = new Map();
  function loadStk(def) {
    if (!stkImgs.has(def.id)) stkImgs.set(def.id, new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = def.src; }));
    return stkImgs.get(def.id);
  }
  S.stickers = []; S.stkSel = 0; S.stkEditing = false;
  let stkSeq = 0, stkCat = "word";
  function buildStkGrid() {
    const g = $("stkGrid"); g.textContent = "";
    for (const def of STICKERS.filter(d => d.cat === stkCat)) {
      const b = document.createElement("button"); b.type = "button"; b.className = "stk-pick";
      b.setAttribute("aria-label", "加入貼紙：" + def.name);
      const im = document.createElement("img"); im.src = def.src; im.alt = ""; im.decoding = "async"; im.draggable = false;
      b.appendChild(im); b.addEventListener("click", () => addSticker(def));
      g.appendChild(b);
    }
  }
  document.querySelectorAll(".stk-cats [data-cat]").forEach(b => b.addEventListener("click", () => {
    stkCat = b.dataset.cat;
    document.querySelectorAll(".stk-cats [data-cat]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    buildStkGrid(); $("stkGrid").scrollLeft = 0;
  }));
  async function addSticker(def) {
    let im; try { im = await loadStk(def); } catch (e) { return; }
    const n = S.stickers.length, j = (n % 5) * 36 - 72;
    const w = def.cat === "word" ? (im.naturalWidth > im.naturalHeight * 1.6 ? 560 : im.naturalHeight > im.naturalWidth * 1.6 ? 170 : 340) : 300;
    const st = { uid: ++stkSeq, def, x: R.W / 2 + j, y: R.H * .42 + j, w, rot: 0, ar: im.naturalHeight / im.naturalWidth };
    S.stickers.push(st); S.stkSel = st.uid;
    renderStkLayer(); syncStkUI();
  }
  function selSt() { return S.stickers.find(s => s.uid === S.stkSel) || null; }
  function placeEl(el, st) {
    el.style.left = (st.x / R.W * 100) + "%"; el.style.top = (st.y / R.H * 100) + "%";
    el.style.width = (st.w / R.W * 100) + "%";
    el.style.transform = `translate(-50%, -50%) rotate(${st.rot}rad)`;
  }
  function renderStkLayer() {
    const layer = $("stkLayer"); layer.textContent = "";
    for (const st of S.stickers) {
      const el = document.createElement("div"); el.className = "stk-item" + (st.uid === S.stkSel ? " sel" : ""); el.dataset.uid = st.uid;
      const im = document.createElement("img"); im.src = st.def.src; im.alt = st.def.name; im.draggable = false;
      el.appendChild(im);
      if (st.uid === S.stkSel) {
        const del = document.createElement("button"); del.type = "button"; del.className = "stk-del"; del.setAttribute("aria-label", "刪除貼紙"); del.textContent = "×";
        const rh = document.createElement("span"); rh.className = "stk-rot"; rh.setAttribute("aria-hidden", "true");
        el.append(del, rh);
      }
      placeEl(el, st); layer.appendChild(el);
    }
  }
  function syncStkUI() {
    $("stkClear").hidden = !S.stickers.length;
    $("stkTip").textContent = S.stickers.length ? "拖曳移動・雙指或拉圓點縮放旋轉・點 × 刪除" : "點貼紙加到照片上，可以放好幾張";
  }
  $("stkClear").addEventListener("click", () => { S.stickers = []; S.stkSel = 0; renderStkLayer(); syncStkUI(); });
  $("stkDone").addEventListener("click", () => setTab("frame"));

  (() => {
    const layer = $("stkLayer"), pts = new Map();
    let g = null;   // 進行中的手勢
    const k = () => R.W / layer.getBoundingClientRect().width;
    function begin(kind) {
      const st = selSt(); if (!st) { g = null; return; }
      g = { kind, st, s0: { ...st }, p0: new Map([...pts].map(([i, v]) => [i, { ...v }])) };
    }
    layer.addEventListener("pointerdown", e => {
      if (e.target.closest(".stk-del")) return;
      try { layer.setPointerCapture(e.pointerId); } catch (er) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && g) { begin("pinch"); return; }
      const item = e.target.closest(".stk-item");
      if (!item) { if (S.stkSel) { S.stkSel = 0; renderStkLayer(); } g = null; return; }
      const uid = Number(item.dataset.uid);
      if (S.stkSel !== uid) {
        S.stkSel = uid;
        const i = S.stickers.findIndex(s => s.uid === uid);
        S.stickers.push(S.stickers.splice(i, 1)[0]);   // 點到的移到最上層
        renderStkLayer();
      }
      begin(e.target.closest(".stk-rot") ? "handle" : "drag");
    });
    layer.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g) return;
      const { st, s0, p0 } = g, K = k();
      if (g.kind === "drag") {
        const a = p0.get(e.pointerId); if (!a) return;
        st.x = s0.x + (e.clientX - a.x) * K; st.y = s0.y + (e.clientY - a.y) * K;
      } else if (g.kind === "handle") {
        const r = layer.getBoundingClientRect();
        const cx = r.left + s0.x / K, cy = r.top + s0.y / K, a = p0.get(e.pointerId); if (!a) return;
        const v0 = Math.hypot(a.x - cx, a.y - cy), v1 = Math.hypot(e.clientX - cx, e.clientY - cy);
        st.w = s0.w * v1 / Math.max(10, v0);
        st.rot = s0.rot + Math.atan2(e.clientY - cy, e.clientX - cx) - Math.atan2(a.y - cy, a.x - cx);
      } else if (g.kind === "pinch") {
        const ids = [...p0.keys()].filter(i => pts.has(i)).slice(0, 2); if (ids.length < 2) return;
        const A0 = p0.get(ids[0]), B0 = p0.get(ids[1]), A1 = pts.get(ids[0]), B1 = pts.get(ids[1]);
        const d0 = Math.hypot(B0.x - A0.x, B0.y - A0.y), d1 = Math.hypot(B1.x - A1.x, B1.y - A1.y);
        st.w = s0.w * d1 / Math.max(10, d0);
        st.rot = s0.rot + Math.atan2(B1.y - A1.y, B1.x - A1.x) - Math.atan2(B0.y - A0.y, B0.x - A0.x);
        st.x = s0.x + ((A1.x + B1.x) - (A0.x + B0.x)) / 2 * K; st.y = s0.y + ((A1.y + B1.y) - (A0.y + B0.y)) / 2 * K;
      }
      st.w = Math.max(90, Math.min(1500, st.w));
      st.x = Math.max(0, Math.min(R.W, st.x)); st.y = Math.max(0, Math.min(R.H, st.y));
      const el = layer.querySelector(`.stk-item[data-uid="${st.uid}"]`); if (el) placeEl(el, st);
    });
    const up = e => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size === 1 && g) begin("drag"); else if (!pts.size) g = null;
    };
    layer.addEventListener("pointerup", up); layer.addEventListener("pointercancel", up);
    layer.addEventListener("click", e => {
      const d = e.target.closest(".stk-del"); if (!d) return;
      const uid = Number(d.closest(".stk-item").dataset.uid);
      S.stickers = S.stickers.filter(s => s.uid !== uid); S.stkSel = 0;
      renderStkLayer(); syncStkUI();
    });
  })();
  async function bakeStickers(base) {
    if (!S.stickers.length) return base;
    const cv = document.createElement("canvas"); cv.width = base.width; cv.height = base.height;
    const x = cv.getContext("2d"); x.drawImage(base, 0, 0);
    const sc = base.width / R.W;
    for (const st of S.stickers) {
      let im; try { im = await loadStk(st.def); } catch (e) { continue; }
      x.save(); x.translate(st.x * sc, st.y * sc); x.rotate(st.rot);
      const w = st.w * sc, h = w * st.ar;
      x.drawImage(im, -w / 2, -h / 2, w, h); x.restore();
    }
    return cv;
  }
  function enterStickers() {
    if (S.stkEditing) return;
    S.stkEditing = true;
    if (!$("stkGrid").children.length) buildStkGrid();
    $("stkLayer").hidden = false; $("stage").classList.add("stk-editing");
    renderStkLayer(); syncStkUI(); updateAdjUI(); showStill();
  }
  async function exitStickers() {
    if (!S.stkEditing) return;
    S.stkEditing = false; S.stkSel = 0;
    $("stkLayer").hidden = true; $("stage").classList.remove("stk-editing");
    updateAdjUI(); await showStill();
  }

  // ---------- Camera ----------
  function stopCam() {
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  }
  // 取景：用感光元件完整的 4:3 畫面（不先裁成正方形），自拍能拍進更多人
  function camConstraints(deviceId) {
    const v = { width: { ideal: 1920 }, height: { ideal: 1440 }, resizeMode: { ideal: "none" } };
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = S.facing;
    return { video: v, audio: false };
  }
  async function startCam(fallbackFacing) {
    stopCam();
    const v = $("video");
    const wantWide = S.facing === "environment" && S.lensWide && S.wideCam && S.wideCam.kind === "device";
    try {
      try {
        S.stream = await navigator.mediaDevices.getUserMedia(camConstraints(wantWide ? S.wideCam.id : null));
      } catch (e1) {
        if (wantWide) { S.lensWide = false; S.stream = await navigator.mediaDevices.getUserMedia(camConstraints()); }
        else throw e1;
      }
    } catch (e) {
      console.warn(e);
      if (fallbackFacing) {           // 切換鏡頭失敗（例如電腦沒有後鏡頭）：退回原本的鏡頭
        setFacing(fallbackFacing);
        $("studioTitle").textContent = "這台裝置沒有另一顆鏡頭";
        setTimeout(() => { if (S.mode === "live") $("studioTitle").textContent = S.facing === "user" ? "前鏡頭" : "後鏡頭"; }, 2500);
        return startCam();
      }
      S.liveAllowed = false;
      const h = $("homeHint"); h.className = "hint warn";
      h.textContent = "無法開啟即時相機（可能沒有允許相機權限）。已改用手機相機拍照，拍完一樣可以套相框和濾鏡。";
      show("home");

      return false;
    }
    v.srcObject = S.stream;
    v.classList.toggle("mirror", S.facing === "user");
    try { await v.play(); } catch (e) {}
    await detectWide();
    return true;
  }

  // ---------- 後鏡頭超廣角（0.5×）：手機有開放才顯示 ----------
  // 兩種開放方式：① 超廣角是另一顆獨立鏡頭（iPhone 等，名稱含 Ultra Wide／超廣角）
  //               ② 同一顆鏡頭可以縮放到 1 倍以下（部分 Android）
  S.wideCam = null; S.lensWide = false;
  async function detectWide() {
    S.wideCam = null;
    const track = S.stream && S.stream.getVideoTracks()[0];
    if (S.facing !== "environment" || !track) { syncLens(); return; }
    try {
      const cap = track.getCapabilities ? track.getCapabilities() : {};
      if (cap.zoom && cap.zoom.min < 1) {
        S.wideCam = { kind: "zoom", min: cap.zoom.min };
        if (S.lensWide) await setZoom(cap.zoom.min);
      }
    } catch (e) {}
    if (!S.wideCam) {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const uw = list.find(d => d.kind === "videoinput" && /ultra\s*wide|ultrawide|超廣角|超广角|0\.5/i.test(d.label) && !/front|前/i.test(d.label));
        if (uw && uw.deviceId) S.wideCam = { kind: "device", id: uw.deviceId };
      } catch (e) {}
    }
    if (!S.wideCam) S.lensWide = false;
    syncLens();
  }
  async function setZoom(z) {
    const track = S.stream && S.stream.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (e) {}
  }
  function syncLens() {
    const show = S.mode === "live" && S.facing === "environment" && !!S.wideCam;
    $("lens").hidden = !show;
    document.querySelectorAll("#lens [data-lens]").forEach(b => b.setAttribute("aria-checked", String((b.dataset.lens === "wide") === S.lensWide)));
  }
  document.querySelectorAll("#lens [data-lens]").forEach(b => b.addEventListener("click", async () => {
    const wide = b.dataset.lens === "wide";
    if (wide === S.lensWide || !S.wideCam) return;
    S.lensWide = wide; syncLens();
    if (S.wideCam.kind === "zoom") await setZoom(wide ? S.wideCam.min : 1);
    else await startCam();
  }));

  async function goLive(keepShots) {
    if (!keepShots) resetShots();
    show("live");
    await paintOverlay();
    await startCam();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function grab() {
    const v = $("video");
    const fl = $("flash"); fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go");
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (S.facing === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0);
    return c;
  }
  async function countdown(n) {
    if (!n) return;
    const cd = $("countdown"); cd.hidden = false;
    for (; n > 0; n--) { cd.textContent = n; await sleep(1000); }
    cd.hidden = true;
  }
  async function shoot() {
    const v = $("video");
    if (!v.videoWidth) return;
    $("btnShutter").disabled = true;
    if (isGrid()) {
      // 四格拍貼：自動連拍剩下的格子，每格倒數 3 秒並顯示姿勢提示
      while (missing() !== -1) {
        S.slot = missing(); await paintOverlay();
        await countdown(Math.max(3, S.timer));
        S.shots[S.slot] = grab();
        await sleep(450);
      }
      $("btnShutter").disabled = false;
      stopCam();
      setSource(S.shots.slice());
      return;
    }
    await countdown(S.timer);
    const c = grab();
    $("btnShutter").disabled = false;
    stopCam();
    resetShots(); S.shots[0] = c;
    setSource(c);
  }

  function setSource(src) {
    S.source = src; S.uploaded = false; S.blob = null;
    S.stickers = []; S.stkSel = 0;
    if (S.stkEditing || !$("stkPanel").hidden) { S.stkEditing = false; setTab("frame"); }
    S.view = { zoom: 1, dx: 0, dy: 0 }; S.adjusting = false;
    updateGridUI();
    $("btnUpload").disabled = false; $("btnUpload").textContent = "上傳到大螢幕";
    $("upConfirm").hidden = true; $("upRow").hidden = false;
    setStatus("");
    show("still");
    updateGridUI();
    renderStill();
    // 有擊拳對準框的相框：拍完自動進入「調整位置」，讓來賓把拳頭移進框框
    if (frameDef().guide && !isGrid()) startAdjust(); else updateAdjUI();
    try { paintFilterThumbs(firstShot()); } catch (e) {}
  }
  // 四格還沒拍滿：顯示「繼續拍第 n 張」，先不開放分享與上傳
  function updateGridUI() {
    const m = missing();
    const need = isGrid() && m !== -1 && S.mode !== "home";
    $("btnMore").hidden = !need;
    if (need) $("btnMore").textContent = `繼續拍第 ${m + 1} 張（共 ${gridN()} 張）`;
    $("btnShare").disabled = need;
    $("tabSticker").hidden = need || S.mode !== "still";
    $("btnUpload").disabled = need || S.uploaded;
  }
  function continueGrid() {
    S.slot = missing(); if (S.slot < 0) return;
    if (S.liveAllowed) goLive(true); else openBrief();
  }

  // ---------- 拍完調整照片位置（拖曳、縮放） ----------
  function clampView() {
    const src = firstShot(), w = frameDef().window;
    if (!src || !w) return;
    const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    const sc = Math.max(w.w / sw, w.h / sh) * S.view.zoom;
    const mx = Math.max(0, (sw * sc - w.w) / 2 / w.w), my = Math.max(0, (sh * sc - w.h) / 2 / w.h);
    S.view.dx = Math.max(-mx, Math.min(mx, S.view.dx));
    S.view.dy = Math.max(-my, Math.min(my, S.view.dy));
  }
  let drawQ = false;
  function drawEdit() {
    if (drawQ) return; drawQ = true;
    requestAnimationFrame(async () => {
      drawQ = false;
      await R.compose($("editCv"), S.source, frameDef(), filter(), cfg, S.view);
    });
  }
  function updateAdjUI() {
    const can = S.mode === "still" && !isGrid() && !!frameDef().window && !S.stkEditing;
    $("adjBar").hidden = !can;
    $("btnAdj").textContent = S.adjusting ? "完成調整" : "調整照片位置";
    $("btnAdj").classList.toggle("on", S.adjusting);
    $("adjZoomWrap").hidden = !S.adjusting;
    $("adjZoom").value = Math.round(S.view.zoom * 100);
    $("editCv").hidden = !S.adjusting;
    $("result").hidden = S.mode !== "still" || S.adjusting;
    $("adjHint").hidden = !S.adjusting;
    $("adjHint").textContent = frameDef().guide ? "拖曳照片，把擊拳的位置移進框框裡" : "單指拖曳移動、雙指縮放照片";
    const g = frameDef().guide, ge = $("guide");
    ge.hidden = !(S.adjusting && g);
    if (g) {
      const pct = (v, t) => (v / t * 100) + "%";
      ge.style.left = pct(g.x, R.W); ge.style.top = pct(g.y, R.H); ge.style.width = pct(g.w, R.W); ge.style.height = pct(g.h, R.H);
      $("guideLbl").textContent = g.label || "";
    }
    $("stage").classList.toggle("adjusting", S.adjusting);
  }
  function startAdjust() {
    if (isGrid() || !firstShot()) return;
    if (S.stkEditing) setTab("frame");
    S.adjusting = true; updateAdjUI(); drawEdit();
  }
  async function endAdjust() {
    S.adjusting = false; updateAdjUI();
    await renderStill();
  }
  $("btnAdj").addEventListener("click", () => S.adjusting ? endAdjust() : startAdjust());
  $("adjZoom").addEventListener("input", e => { S.view.zoom = e.target.value / 100; clampView(); drawEdit(); });
  (() => {
    const pts = new Map(); let start = null;
    const stage = $("stage");
    const winPx = () => { const r = stage.getBoundingClientRect(), w = frameDef().window; return { w: w.w / R.W * r.width, h: w.h / R.H * r.height }; };
    stage.addEventListener("pointerdown", e => {
      if (!S.adjusting) return;
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { view: { ...S.view }, pts: new Map([...pts].map(([k, v]) => [k, { ...v }])) };
    });
    stage.addEventListener("pointermove", e => {
      if (!S.adjusting || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const wp = winPx(), ids = [...pts.keys()];
      if (ids.length === 1 && start.pts.has(ids[0])) {
        const a = start.pts.get(ids[0]), b = pts.get(ids[0]);
        S.view.dx = start.view.dx + (b.x - a.x) / wp.w;
        S.view.dy = start.view.dy + (b.y - a.y) / wp.h;
      } else if (ids.length >= 2 && start.pts.has(ids[0]) && start.pts.has(ids[1])) {
        const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
        const d0 = d(start.pts.get(ids[0]), start.pts.get(ids[1])), d1 = d(pts.get(ids[0]), pts.get(ids[1]));
        S.view.zoom = Math.max(1, Math.min(3, start.view.zoom * d1 / Math.max(1, d0)));
        $("adjZoom").value = Math.round(S.view.zoom * 100);
      }
      clampView(); drawEdit();
    });
    const up = e => {
      pts.delete(e.pointerId);
      start = { view: { ...S.view }, pts: new Map([...pts].map(([k, v]) => [k, { ...v }])) };
    };
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  })();

  async function renderStill() {
    if (!S.source) return;
    const token = ++S.renderToken;
    $("busy").hidden = false;
    await R.fontsReady();
    const cv = document.createElement("canvas");
    await R.compose(cv, S.source, frameDef(), filter(), cfg, isGrid() ? {} : S.view);
    if (token !== S.renderToken) return;
    S.baseCanvas = cv;
    await showStill(token);
  }
  // 顯示成品：編輯貼紙時只放底圖（貼紙在上層可拖曳），其他時候把貼紙合成進照片，長按存檔也有貼紙
  async function showStill(token) {
    if (!S.baseCanvas) return;
    if (token == null) token = ++S.renderToken;
    $("busy").hidden = false;
    const out = S.stkEditing ? S.baseCanvas : await bakeStickers(S.baseCanvas);
    if (token !== S.renderToken) return;
    const blob = await new Promise(r => out.toBlob(r, "image/jpeg", 0.92));
    if (token !== S.renderToken) return;
    S.blob = blob;
    const img = $("result");
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    const url = URL.createObjectURL(blob);
    img.dataset.url = url; img.src = url;
    $("busy").hidden = true;
  }

  function pickFile(capture) {
    const inp = capture ? $("fileCam") : $("filePick");
    inp.value = ""; inp.click();
  }
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    stopCam();
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      // 先縮到 1600px 以內，避免大照片拖慢手機
      const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (isGrid()) {
        S.shots[S.slot] = c;
        S.slot = Math.max(0, missing());
        if (missing() !== -1 && !S.liveAllowed) { openBrief(); return; }
        setSource(S.shots.slice());
      } else { resetShots(); S.shots[0] = c; setSource(c); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); alertHint("這個檔案無法讀取，請換一張 JPG 或 PNG 照片。"); };
    im.src = url;
  }
  function alertHint(t) { const h = $("homeHint"); h.className = "hint warn"; h.textContent = t; show("home"); }

  // ---------- Share / Save ----------
  function fileName() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `510-${cfg.eventId}-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
  }
  async function share() {
    if (S.adjusting) await endAdjust();
    if (S.stkEditing) { setTab("frame"); await showStill(); }
    if (!S.blob) return;
    const name = fileName();
    const file = new File([S.blob], name, { type: "image/jpeg" });
    if (navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: cfg.hashtags });
          return;
        }
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (typeof window.PB_SAVE === "function") {
      try { await window.PB_SAVE(S.blob, name); return; } catch (e) { console.warn(e); }
    }
    try {
      const a = document.createElement("a");
      a.href = $("result").src; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      $("saveHint").textContent = "如果沒有開始下載，請長按上方照片選擇「儲存影像」";
    } catch (e) {
      $("saveHint").textContent = "請長按上方照片選擇「儲存影像」";
    }
  }

  // ---------- Upload ----------
  function setStatus(t, kind) { const s = $("upStatus"); s.textContent = t; s.className = "status" + (kind ? " " + kind : ""); }
  function askUpload() {
    if (S.uploaded || !S.source) return;
    $("upRow").hidden = true; $("upConfirm").hidden = false; setStatus("");
    $("btnUploadYes").focus();
  }
  async function upload() {
    if (S.uploaded || !S.source) return;
    $("upConfirm").hidden = true; $("upRow").hidden = false;
    const store = await whenStore();
    const btn = $("btnUpload");
    btn.disabled = true; btn.textContent = "上傳中…"; setStatus("");
    try {
      const ok = await store.ready;
      if (!ok) throw new Error(store.notReadyMsg || "上傳功能尚未啟用");
      if (S.adjusting) await endAdjust();
      const img = R.thumbnail(isGrid() ? S.shots : firstShot(), filter(), isGrid() ? {} : S.view);
      const name = $("nameInput").value.trim().slice(0, 12);
      await withTimeout(store.upload({ img, name }), 20000);
      S.uploaded = true;
      btn.textContent = "已上傳";
      setStatus("上傳成功！照片已出現在大螢幕，抬頭找找你在哪裡。", "ok");
    } catch (e) {
      btn.disabled = false; btn.textContent = "再試一次";
      setStatus("上傳沒有成功：" + (e && e.message ? e.message : "請檢查網路後再試一次"), "err");
    }
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("網路較慢，請移到訊號好的地方再試一次")), ms))]);
  }
  function whenStore() {
    if (window.PBStore) return Promise.resolve(window.PBStore);
    return new Promise(r => window.addEventListener("pbstore", () => r(window.PBStore), { once: true }));
  }

  // ---------- Events ----------
  $("btnStart").addEventListener("click", () => openPick("camera"));
  $("btnMore").addEventListener("click", continueGrid);
  $("btnAlbum").addEventListener("click", () => openPick("album"));
  $("btnAlbum2").addEventListener("click", () => pickFile(false));
  $("filePick").addEventListener("change", onFile);
  $("fileCam").addEventListener("change", onFile);
  $("btnShutter").addEventListener("click", shoot);
  $("btnFlip").addEventListener("click", async () => {
    const prev = S.facing;
    setFacing(prev === "user" ? "environment" : "user");
    $("studioTitle").textContent = S.facing === "user" ? "前鏡頭" : "後鏡頭";
    await startCam(prev);
  });
  $("btnTimer").addEventListener("click", () => {
    S.timer = S.timer === 0 ? 3 : S.timer === 3 ? 5 : 0;
    $("btnTimer").textContent = S.timer ? `倒數 ${S.timer} 秒` : "倒數 關";
  });
  $("btnBack").addEventListener("click", () => {
    if (S.mode === "still" && S.liveAllowed) { goLive(); return; }
    stopCam(); show("pick");
  });
  $("btnRetake").addEventListener("click", () => {
    resetShots();
    if (S.liveAllowed) goLive(); else if (isGrid() || frameDef().guide) openBrief(); else pickFile(true);
  });
  $("btnShare").addEventListener("click", share);
  $("btnUpload").addEventListener("click", askUpload);
  $("btnUploadYes").addEventListener("click", upload);
  $("btnUploadNo").addEventListener("click", () => { $("upConfirm").hidden = true; $("upRow").hidden = false; });
  $("nameInput").addEventListener("keydown", e => { if (e.key === "Enter") askUpload(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCam();
    else if (S.mode === "live") startCam();
  });

  R.fontsReady();
  window.PBBooth = { state: S, setSource, show };
})();
