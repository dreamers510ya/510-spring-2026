/* 大螢幕：輪播牆 + 形狀馬賽克大合照 */
(function () {
  const cfg = window.PB_CONFIG;
  const WC = Object.assign({ pageSize: 40, pageSeconds: 9, shape: "heart", shapeText: "夢", showNames: true, boothUrl: "" }, cfg.wall || {});
  const $ = id => document.getElementById(id);
  if (!$("wall")) return;

  // 畫面設定全部由主持人控制台遙控（control 文件），投影端不保存任何設定
  const set = { mode: "kv", shape: WC.shape, shapeText: WC.shapeText, tour: true, names: WC.showNames, qrUrl: "" };
  let hidden = new Set();
  const photos = new Map();   // id -> {id,name,ts,full,mini,demo}
  let started = false;

  // ---------- helpers ----------
  function toBlobUrl(dataUrl) {
    if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return null;
    try {
      const b = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
      const a = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
      return URL.createObjectURL(new Blob([a], { type: dataUrl.slice(5, dataUrl.indexOf(";")) }));
    } catch (e) { return null; }
  }
  function makeMini(p) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas"); c.width = 120; c.height = 150;
        const ctx = c.getContext("2d");
        const k = Math.max(120 / im.naturalWidth, 150 / im.naturalHeight);
        const w = im.naturalWidth * k, h = im.naturalHeight * k;
        ctx.drawImage(im, (120 - w) / 2, (150 - h) / 2, w, h);
        c.toBlob(b => { if (b) p.mini = URL.createObjectURL(b); res(); }, "image/jpeg", 0.82);
      };
      im.onerror = () => res();
      im.src = p.full;
    });
  }
  let miniQ = Promise.resolve();
  const queueMini = p => { miniQ = miniQ.then(() => makeMini(p)).then(() => { if (set.mode === "mosaic") scheduleRender(); }); };

  const visible = () => [...photos.values()].filter(p => !hidden.has(p.id)).sort((a, b) => a.ts - b.ts);
  const stageSize = () => { const r = $("wStage").getBoundingClientRect(); return { W: Math.max(200, r.width), H: Math.max(150, r.height) }; };

  // ---------- 計數 ----------
  let lastCount = -1;
  function updateCount(n) {
    const b = $("wCount");
    b.textContent = n.toLocaleString("zh-TW");
    if (lastCount >= 0 && n > lastCount) { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
    lastCount = n;
    $("wEmpty").hidden = n > 0 || set.mode === "cloud";
    $("wall").classList.toggle("is-empty", n === 0 && set.mode !== "cloud");
  }

  // ---------- 輪播牆 ----------
  let page = 0, freshIds = new Set();
  function fitGrid(n, W, H, gap) {
    let best = { cols: 1, tw: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const tw = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 0.8);
      if (tw > best.tw) best = { cols, tw };
    }
    return best;
  }
  function renderPages() {
    const box = $("wPages");
    const list = visible().reverse();          // 最新的在前
    const size = Math.max(4, WC.pageSize | 0);
    const pages = Math.max(1, Math.ceil(list.length / size));
    if (page >= pages) page = 0;
    const items = list.slice(page * size, page * size + size);
    const { W, H } = stageSize();
    const gap = Math.max(6, Math.round(H * 0.012));
    const g = fitGrid(Math.max(1, Math.min(list.length, size)), W, H, gap);
    box.style.setProperty("--cols", g.cols);
    box.style.setProperty("--tw", Math.floor(g.tw) + "px");
    box.style.setProperty("--gap", gap + "px");
    box.textContent = "";
    items.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "p" + (freshIds.has(p.id) ? " fresh" : "");
      d.style.setProperty("--i", i);
      d.dataset.id = p.id;
      const im = document.createElement("img"); im.src = p.full; im.alt = p.name || "活動照片"; im.decoding = "async";
      d.appendChild(im);
      if (p.name) { const n = document.createElement("div"); n.className = "n"; n.textContent = p.name; d.appendChild(n); }
      box.appendChild(d);
    });
    freshIds.clear();
  }
  let pageTimer = null;
  function startPageTimer() {
    clearInterval(pageTimer);
    pageTimer = setInterval(() => {
      if (set.mode !== "pages" || spotActive) return;
      const n = visible().length, size = Math.max(4, WC.pageSize | 0);
      if (n <= size) return;
      page++; renderPages();
    }, Math.max(4, WC.pageSeconds) * 1000);
  }

  // ---------- 形狀遮罩 ----------
  function buildMask(shape, text, W, H) {
    if (shape === "rect") return () => true;
    const mw = 320, mh = Math.max(40, Math.round(320 * H / W));
    const c = document.createElement("canvas"); c.width = mw; c.height = mh;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    if (shape === "text" && text) {
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.font = `900 100px "Noto Serif TC", "Songti TC", serif`;
      const m = ctx.measureText(text);
      const asc = m.actualBoundingBoxAscent || 88, desc = m.actualBoundingBoxDescent || 12;
      const k = Math.min((mw * 0.96) / m.width, (mh * 0.94) / (asc + desc));
      ctx.font = `900 ${100 * k}px "Noto Serif TC", "Songti TC", serif`;
      ctx.fillText(text, mw / 2, mh / 2 + ((asc - desc) * k) / 2);
    } else {
      const pts = [];
      for (let t = 0; t < Math.PI * 2; t += 0.02) {
        pts.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
      }
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const k = Math.min((mh * 0.96) / (maxY - minY), (mw * 0.96) / (maxX - minX));
      const ox = mw / 2 - ((minX + maxX) / 2) * k, oy = mh / 2 - ((minY + maxY) / 2) * k;
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(ox + x * k, oy + y * k) : ctx.moveTo(ox + x * k, oy + y * k));
      ctx.closePath(); ctx.fill();
    }
    const data = ctx.getImageData(0, 0, mw, mh).data;
    return (x, y) => {
      const mx = Math.min(mw - 1, Math.max(0, Math.floor(x / W * mw)));
      const my = Math.min(mh - 1, Math.max(0, Math.floor(y / H * mh)));
      return data[(my * mw + mx) * 4 + 3] > 110;
    };
  }
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  let layout = null;
  function computeLayout(target) {
    const { W, H } = stageSize();
    const inside = buildMask(set.shape, set.shapeText, W, H);
    let pick = null;
    for (let cols = 5; cols <= 320; cols++) {
      const tw = W / cols, th = tw * 1.25;
      const rows = Math.floor(H / th);
      if (rows < 1) continue;
      const offX = 0, offY = (H - rows * th) / 2;
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = offX + c * tw, y = offY + r * th;
        if (inside(x + tw / 2, y + th / 2)) cells.push({ x, y });
      }
      pick = { cols, rows, tw, th, cells, W, H };
      if (cells.length >= target || tw < 9) break;
    }
    const rand = rng(510);
    const cs = pick.cells;
    for (let i = cs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cs[i], cs[j]] = [cs[j], cs[i]]; }
    pick.key = `${set.shape}|${set.shapeText}|${Math.round(W)}x${Math.round(H)}`;
    return pick;
  }

  const tiles = [];
  function renderMosaic(newIds) {
    const vis = visible(), N = vis.length;
    const { W, H } = stageSize();
    const key = `${set.shape}|${set.shapeText}|${Math.round(W)}x${Math.round(H)}`;
    const target = Math.max(N, set.shape === "rect" ? 24 : 90);
    if (!layout || layout.key !== key || layout.cells.length < target) layout = computeLayout(target);
    const board = $("wBoard");
    board.style.width = W + "px"; board.style.height = H + "px";
    board.style.setProperty("--tw", layout.tw + "px");
    board.style.setProperty("--th", layout.th + "px");
    board.style.setProperty("--pad", (layout.tw > 40 ? 2 : 1) + "px");
    const C = N ? layout.cells.length : 0;
    while (tiles.length < C) {
      const t = document.createElement("div"); t.className = "t";
      const im = document.createElement("img"); im.alt = ""; im.decoding = "async";
      t.appendChild(im); board.appendChild(t); tiles.push(t);
    }
    while (tiles.length > C) tiles.pop().remove();
    for (let j = 0; j < C; j++) {
      const p = vis[j < N ? j : j % N], cell = layout.cells[j], t = tiles[j];
      t.style.transform = `translate(${cell.x}px, ${cell.y}px)`;
      t.dataset.id = p.id; t.dataset.j = j;
      t.classList.toggle("echo", j >= N);
      t.classList.toggle("new", !!(newIds && newIds.has(p.id) && j < N));
      const src = (t.dataset.hi === "1" ? p.full : (p.mini || p.full));
      if (t.firstChild.getAttribute("src") !== src) t.firstChild.src = src;
    }
  }

  // ---------- 鏡頭巡覽 ----------
  let tourTimer = null, tourHi = [];
  function clearHi() {
    for (const t of tourHi) { t.dataset.hi = "0"; const p = photos.get(t.dataset.id); if (p) t.firstChild.src = p.mini || p.full; }
    tourHi = [];
  }
  function zoomOut() {
    $("wBoard").style.transform = ""; $("wCaption").hidden = true; clearHi();
  }
  function stopTour() { clearTimeout(tourTimer); zoomOut(); }
  function startTour() {
    stopTour();
    if (!set.tour || set.mode !== "mosaic") return;
    const step = zoomIn => {
      if (!set.tour || set.mode !== "mosaic") return;
      const vis = visible();
      if (!zoomIn || vis.length < 12 || !layout || spotActive) {
        zoomOut();
        tourTimer = setTimeout(() => step(true), 6000);
        return;
      }
      const N = vis.length, j = Math.floor(Math.random() * Math.min(N, tiles.length));
      const cell = layout.cells[j]; if (!cell) { tourTimer = setTimeout(() => step(false), 1000); return; }
      const { W, H } = layout;
      const k = Math.max(2, Math.min(14, (H * 0.42) / layout.th));
      const cx = cell.x + layout.tw / 2, cy = cell.y + layout.th / 2;
      // 把附近的格子換成高畫質
      clearHi();
      const r = Math.max(W, H) / k * 0.75;
      for (const t of tiles) {
        const c2 = layout.cells[+t.dataset.j];
        if (c2 && Math.abs(c2.x - cell.x) < r && Math.abs(c2.y - cell.y) < r) {
          const p = photos.get(t.dataset.id);
          if (p) { t.dataset.hi = "1"; t.firstChild.src = p.full; tourHi.push(t); }
        }
      }
      $("wBoard").style.transform = `translate(${W / 2 - cx * k}px, ${H / 2 - cy * k}px) scale(${k})`;
      const p = vis[j];
      setTimeout(() => {
        if (set.mode !== "mosaic" || !set.tour) return;
        if (p && p.name && set.names) { $("wCaption").textContent = p.name; $("wCaption").hidden = false; }
      }, 3400);
      tourTimer = setTimeout(() => { $("wCaption").hidden = true; step(false); }, 8500);
    };
    tourTimer = setTimeout(() => step(true), 4000);
  }

  // ---------- 渲染排程 ----------
  let renderTimer = null, pendingNew = new Set();
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderNow, 220);
  }
  function renderNow() {
    const n = visible().length;
    updateCount(n);
    $("wall").classList.toggle("is-kv", set.mode === "kv");
    $("wPages").hidden = set.mode !== "pages";
    $("wMosaic").hidden = set.mode !== "mosaic";
    $("wCloud").hidden = set.mode !== "cloud";
    $("wSlides").hidden = set.mode !== "slides";
    if (set.mode === "slides") renderSlide();
    $("wall").classList.toggle("is-cloud", set.mode === "cloud");
    $("wQrText").innerHTML = set.mode === "cloud" ? "掃碼回答<br>一起上牆" : "掃碼自拍<br>一起入鏡";
    if (set.mode === "cloud") renderCloud();
    if (set.mode === "pages") renderPages();
    else if (set.mode === "mosaic") renderMosaic(pendingNew);
    pendingNew = new Set();
  }

  // ---------- 新照片聚光 ----------
  const spotQ = []; let spotActive = false;
  function runSpot() {
    if (spotActive || !spotQ.length) return;
    const p = photos.get(spotQ.shift());
    if (!p || hidden.has(p.id)) return runSpot();
    if (set.mode === "kv" || set.mode === "cloud" || set.mode === "slides") { freshIds.add(p.id); return runSpot(); }
    spotActive = true;
    const s = $("wSpot");
    $("wSpotImg").src = p.full;
    $("wSpotName").textContent = (set.names && p.name) ? p.name : "新夥伴";
    s.classList.remove("out"); s.hidden = false;
    const hold = spotQ.length > 3 ? 1500 : 3400;
    setTimeout(() => {
      s.classList.add("out");
      setTimeout(() => {
        s.hidden = true; spotActive = false;
        freshIds.add(p.id); pendingNew.add(p.id);
        if (set.mode === "pages") page = 0;
        if (spotQ.length) runSpot();
        scheduleRender();
      }, 650);
    }, hold);
  }

  // ---------- 資料進出 ----------
  function addPhoto(raw, initial) {
    if (photos.has(raw.id)) return;
    const full = toBlobUrl(raw.img);
    if (!full) return;
    const p = { id: String(raw.id), name: String(raw.name || "").slice(0, 16), ts: Number(raw.ts) || Date.now(), full, mini: null, demo: !!raw.demo };
    photos.set(p.id, p);
    queueMini(p);
    if (!initial && !hidden.has(p.id)) { spotQ.push(p.id); runSpot(); }
    if (initial || !spotActive) scheduleRender();
  }
  function removePhoto(id) {
    const p = photos.get(id); if (!p) return;
    photos.delete(id);
    setTimeout(() => { URL.revokeObjectURL(p.full); if (p.mini) URL.revokeObjectURL(p.mini); }, 5000);
    scheduleRender();
  }
  function showErr(msg) { const e = $("wErr"); e.textContent = msg || ""; e.hidden = !msg; }

  // ---------- QR ----------
  function qrUrl() {
    return (set.qrUrl || "").trim() || WC.boothUrl || cfg.derivedBoothUrl || "";
  }
  function renderQr() {
    const url = qrUrl(), box = $("wQrImg");
    box.textContent = "";
    if (!url || typeof window.qrcode !== "function") { $("wQr").hidden = true; return; }
    try {
      const q = window.qrcode(0, "M"); q.addData(url); q.make();
      const im = document.createElement("img"); im.alt = "自拍頁 QR code"; im.src = q.createDataURL(8, 0);
      box.appendChild(im); $("wQr").hidden = false;
    } catch (e) { $("wQr").hidden = true; }
  }

  // ---------- 示範照片 ----------
  let demoN = 0;
  function demoPhoto(i) {
    const c = document.createElement("canvas"); c.width = 240; c.height = 300;
    const ctx = c.getContext("2d"), r = rng(i * 7919 + 3);
    const hue = Math.floor(r() * 360);
    const g = ctx.createLinearGradient(0, 0, 240, 300);
    g.addColorStop(0, `hsl(${hue},55%,${55 + r() * 15}%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},50%,${30 + r() * 15}%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 240, 300);
    const people = 1 + Math.floor(r() * 3);
    for (let k = 0; k < people; k++) {
      const cx = 240 * (k + 1) / (people + 1) + (r() - .5) * 20, s = 0.75 + r() * 0.35;
      ctx.fillStyle = `hsl(${25 + r() * 15},${35 + r() * 20}%,${55 + r() * 20}%)`;
      ctx.beginPath(); ctx.arc(cx, 130 - 10 * s, 38 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsl(${Math.floor(r() * 360)},45%,${30 + r() * 30}%)`;
      ctx.beginPath(); ctx.ellipse(cx, 270, 62 * s, 80 * s, 0, Math.PI, 0); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "700 22px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("示範 " + i, 12, 30);
    return c.toDataURL("image/jpeg", 0.8);
  }
  function addDemo(count, silent) {
    const base = Date.now() - 100000;
    for (let k = 0; k < count && demoN < 1200; k++) {
      demoN++;
      addPhoto({ id: "demo-" + demoN, img: demoPhoto(demoN), name: "示範 " + demoN, ts: base + demoN, demo: true }, true);
    }
    if (silent) return;
    demoN++;
    addPhoto({ id: "demo-" + demoN, img: demoPhoto(demoN), name: "示範新照片 " + demoN, ts: Date.now() }, false);
  }

  // ---------- 文字雲 ----------
  const answers = new Map();   // id -> {q, w, ts}
  let cq = null, cBlocked = [], cloudT = null, cMeasure = null;
  const cWords = new Map();    // key -> span
  function cloudCtl(c) {
    const qs = Array.isArray(c.questions) ? c.questions : [];
    const nq = qs.find(x => x.id === c.activeQ) || null;
    const nb = Array.isArray(c.blocked) ? c.blocked.map(String) : [];
    const changed = (nq && nq.id) !== (cq && cq.id) || (nq && nq.text) !== (cq && cq.text) || nb.join("|") !== cBlocked.join("|");
    if ((nq && nq.id) !== (cq && cq.id)) { for (const el of cWords.values()) el.remove(); cWords.clear(); }
    cq = nq; cBlocked = nb;
    if (changed && set.mode === "cloud") scheduleCloud();
  }
  function addAnswer(a) {
    if (!a || answers.has(a.id) || typeof a.w !== "string") return;
    answers.set(a.id, { q: String(a.q), w: a.w.slice(0, 16), ts: Number(a.ts) || Date.now() });
    if (cq && a.q === cq.id && set.mode === "cloud") scheduleCloud();
  }
  function removeAnswer(id) { if (answers.delete(id) && set.mode === "cloud") scheduleCloud(); }
  function scheduleCloud() { clearTimeout(cloudT); cloudT = setTimeout(renderCloud, 350); }

  const CLOUD_COLORS = ["#fff8ec", "#ffe1a6", "#f9c97c", "#ffffff", "#ffd8c7"];
  function hashN(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) | 0; return Math.abs(h); }
  function renderCloud() {
    const box = $("wCwords");
    $("wCq").textContent = cq ? cq.text : "題目準備中";
    if (!cq) { $("wCn").textContent = "0"; $("wCwait").hidden = false; for (const el of cWords.values()) el.remove(); cWords.clear(); return; }
    const list = window.PBWords.tally([...answers.values()], cq.id, cBlocked);
    const total = list.reduce((s, e) => s + e.n, 0);
    $("wCn").textContent = total.toLocaleString("zh-TW");
    $("wCwait").hidden = total > 0;
    const top = list.slice(0, 80);
    const r = box.getBoundingClientRect();
    const W = Math.max(300, r.width), H = Math.max(200, r.height);
    if (!cMeasure) cMeasure = document.createElement("canvas").getContext("2d");
    const maxN = top.length ? top[0].n : 1;
    const sizeOf = (n, k) => {
      const t = maxN > 1 ? Math.sqrt((n - 1) / (maxN - 1)) : .55;
      return k * (H * .055 + t * H * .13);
    };
    let placed = null;
    for (let k = 1; k >= .45 && !placed; k -= .08) placed = layoutCloud(top, W, H, n => sizeOf(n, k));
    if (!placed) placed = layoutCloud(top, W, H, n => sizeOf(n, .4), true);
    const keep = new Set();
    for (const p of placed) {
      keep.add(p.key);
      let el = cWords.get(p.key);
      if (!el) {
        el = document.createElement("span"); el.className = "w-word new";
        el.style.color = CLOUD_COLORS[hashN(p.key) % CLOUD_COLORS.length];
        el.style.left = (p.x / W * 100) + "%"; el.style.top = (p.y / H * 100) + "%";
        box.appendChild(el); cWords.set(p.key, el);
        setTimeout(() => el.classList.remove("new"), 1600);
      }
      el.textContent = p.text;
      el.title = p.n + " 人";
      el.style.fontSize = p.fs.toFixed(1) + "px";
      el.style.left = (p.x / W * 100) + "%"; el.style.top = (p.y / H * 100) + "%";
      el.classList.toggle("top", p.rank < 3 && p.n > 1);
    }
    for (const [k, el] of cWords) if (!keep.has(k)) { el.remove(); cWords.delete(k); }
  }
  // 由中心往外螺旋擺放，大字在中間；擺不下就整體縮小重排
  function layoutCloud(list, W, H, fsOf, force) {
    const out = [], rects = [];
    const cx = W / 2, cy = H / 2, ar = W / H;
    for (let i = 0; i < list.length; i++) {
      const e = list[i], fs = fsOf(e.n);
      cMeasure.font = `900 ${fs}px "Noto Serif TC", "Songti TC", serif`;
      const w = cMeasure.measureText(e.text).width + fs * .5, h = fs * 1.2;
      let ok = false, x = cx, y = cy;
      const start = hashN(e.key) % 360 * Math.PI / 180;
      const maxR = Math.hypot(W / ar, H) / 2 + h;
      for (let t = 0; ; t++) {
        const a = start + t * .12, rad = t * .09 * Math.max(1, fs / 60);
        if (rad > maxR) break;
        x = cx + Math.cos(a) * rad * ar; y = cy + Math.sin(a) * rad;
        const rc = { l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2 };
        if (rc.l < 0 || rc.r > W || rc.t < 0 || rc.b > H) continue;
        if (rects.some(o => rc.l < o.r && rc.r > o.l && rc.t < o.b && rc.b > o.t)) continue;
        rects.push(rc); ok = true; break;
      }
      if (!ok) { if (!force && i < Math.min(list.length, 30)) return null; continue; }
      out.push({ key: e.key, text: e.text, n: e.n, fs, x, y, rank: i });
    }
    return out;
  }

  // ---------- 簡報 ----------
  const slides = new Map();    // id -> {id, deck, idx, url}（url 在需要時才載入）
  let sDeck = "", sIdx = 0, sShown = "", sFront = "wSlA", slideT = null;
  function slideCtl(c) {
    const decks = Array.isArray(c.decks) ? c.decks : [];
    const d = decks.some(x => x.id === c.deck) ? c.deck : "";
    const i = Math.max(0, Number(c.slide) || 0);
    const deckChanged = d !== sDeck;
    sDeck = d; sIdx = i;
    if (deckChanged) preloadDeck();
    if (set.mode === "slides") renderSlide();
  }
  function deckList(deck) {
    const byIdx = new Map();
    for (const s of slides.values()) if (s.deck === deck && !byIdx.has(s.idx)) byIdx.set(s.idx, s);
    return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
  }
  function addSlide(raw) {
    if (!raw || slides.has(raw.id)) return;
    slides.set(raw.id, { id: raw.id, deck: String(raw.deck), idx: Number(raw.idx) || 0, url: "", p: null });
    if (raw.deck === sDeck) { clearTimeout(slideT); slideT = setTimeout(() => { preloadDeck(); if (set.mode === "slides") renderSlide(); }, 120); }
  }
  function removeSlide(id) {
    const s = slides.get(id); if (!s) return;
    slides.delete(id); if (s.url && s.url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(s.url), 5000);
    if (s.deck === sDeck && set.mode === "slides") renderSlide();
  }
  // 取大圖：資料庫回傳 data URL 就轉成 blob，網址就直接用；先載入並解碼，換頁才不會閃
  function ensureSrc(s) {
    if (s.p) return s.p;
    s.p = (async () => {
      let u = "";
      try { u = await storeRef.slideSrc(s.id); } catch (e) {}
      if (!u) { s.p = null; return ""; }
      s.url = u.startsWith("data:") ? (toBlobUrl(u) || "") : u;
      const im = new Image(); im.src = s.url;
      try { if (im.decode) await im.decode(); } catch (e) {}
      return s.url;
    })();
    return s.p;
  }
  async function preloadDeck() {
    if (!storeRef || !storeRef.slideSrc) return;
    const list = deckList(sDeck);
    const order = list.slice(sIdx).concat(list.slice(0, sIdx));   // 先載目前這頁之後的
    for (let k = 0; k < order.length; k += 4) await Promise.all(order.slice(k, k + 4).map(ensureSrc));
  }
  async function renderSlide() {
    const list = deckList(sDeck);
    const s = list[Math.min(sIdx, list.length - 1)];
    $("wSlEmpty").hidden = !!s;
    if (!s) { $("wSlA").classList.remove("on"); $("wSlB").classList.remove("on"); sShown = ""; return; }
    if (s.id === sShown) return;
    sShown = s.id;
    const url = await ensureSrc(s);
    if (sShown !== s.id || !url) return;   // 快速連續換頁時，只顯示最後一頁
    const back = sFront === "wSlA" ? "wSlB" : "wSlA";
    const im = $(back);
    im.src = url;
    try { if (im.decode) await im.decode(); } catch (e) {}
    if (sShown !== s.id) return;
    im.classList.add("on"); $(sFront).classList.remove("on");
    sFront = back;
  }

  // ---------- 主持人控制台遙控 ----------
  function applyControl(c) {
    c = c || {};
    const prev = Object.assign({}, set);
    if (["kv", "pages", "mosaic", "cloud", "slides"].includes(c.mode)) set.mode = c.mode;
    cloudCtl(c);
    slideCtl(c);
    if (["rect", "heart", "text"].includes(c.shape)) set.shape = c.shape;
    if (typeof c.shapeText === "string" && c.shapeText.trim()) set.shapeText = c.shapeText.trim().slice(0, 3);
    if (typeof c.tour === "boolean") set.tour = c.tour;
    if (typeof c.names === "boolean") set.names = c.names;
    if (typeof c.qrUrl === "string") set.qrUrl = c.qrUrl;
    const nh = new Set(Array.isArray(c.hidden) ? c.hidden.map(String) : []);
    const hiddenChanged = nh.size !== hidden.size || [...nh].some(id => !hidden.has(id));
    hidden = nh;
    $("wall").classList.toggle("no-names", !set.names);
    if (prev.qrUrl !== set.qrUrl) renderQr();
    if (prev.shape !== set.shape || prev.shapeText !== set.shapeText || hiddenChanged) layout = null;
    const demo = Math.max(0, Math.min(1200, Number(c.demo) || 0));
    if (demo > demoN) addDemo(demo - demoN, true);
    else if (demo === 0 && demoN > 0) clearDemo();
    if (prev.mode !== set.mode || prev.tour !== set.tour || prev.shape !== set.shape || prev.shapeText !== set.shapeText) {
      stopTour(); renderNow(); if (set.mode === "mosaic") startTour();
      sendBeat();
    } else if (hiddenChanged || prev.names !== set.names) {
      renderNow();
    }
  }
  function clearDemo() {
    for (const id of [...photos.keys()]) if (id.startsWith("demo-")) removePhoto(id);
    demoN = 0;
  }

  // 投影端心跳：讓控制台知道大螢幕在線
  let storeRef = null;
  function sendBeat() {
    if (storeRef && storeRef.heartbeat) { try { storeRef.heartbeat({ scene: set.mode, count: visible().length }); } catch (e) {} }
  }

  // 全螢幕與滑鼠游標
  let cursorT = null;
  document.addEventListener("mousemove", () => {
    if (!started) return;
    $("wall").classList.remove("idle");
    clearTimeout(cursorT); cursorT = setTimeout(() => $("wall").classList.add("idle"), 2000);
  });
  document.addEventListener("keydown", e => {
    if (!started || $("wall").hidden) return;
    if (e.key.toLowerCase() === "f") goFull();
  });
  async function goFull() {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (e) {}
  }
  let rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { layout = null; if (started) renderNow(); }, 300); });
  window.addEventListener("load", () => { if (set.mode === "cloud") scheduleCloud(); });

  // ---------- 啟動 ----------
  function whenStore() {
    if (window.PBStore) return Promise.resolve(window.PBStore);
    return new Promise(r => window.addEventListener("pbstore", () => r(window.PBStore), { once: true }));
  }
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    $("wall").classList.add("idle");
    try { if (document.fonts) await Promise.race([document.fonts.load(`900 100px "Noto Serif TC"`, set.shapeText + "一起夢想"), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
    renderQr(); renderNow(); startPageTimer();
    const store = await whenStore();
    storeRef = store;
    // 照片、文字雲、簡報只有控台帳號讀得到：先登入，再開始接收資料
    const auth = store.auth || { onChange: cb => cb({ ok: true }) };
    let dataOn = false;
    auth.onChange(st => {
      const need = !st.ok && !st.noSignIn;
      $("wLogin").hidden = !need;
      $("wStartBtn").hidden = !st.ok;
      $("wLoginBtn").disabled = false; $("wLoginBtn").textContent = "登入";
      if (!st.ok) {
        $("wStartStatus").textContent = st.reason || (need ? "尚未登入" : "無法連線");
        if (need) { if (!$("wAcct").value) $("wAcct").value = cfg.consoleAccount || ""; setTimeout(() => ($("wAcct").value ? $("wPw") : $("wAcct")).focus(), 50); }
        return;
      }
      $("wPw").value = ""; $("wLoginErr").textContent = "";
      if (dataOn) return; dataOn = true;
      $("wStartStatus").textContent = "已登入" + (st.name ? "（" + st.name + "）" : "") + "，照片會即時更新";
      store.subscribe(addPhoto, removePhoto, msg => { showErr(msg); if (msg) $("wStartStatus").textContent = msg; });
      if (store.watchControl) store.watchControl(applyControl);
      if (store.subscribeAnswers) store.subscribeAnswers(addAnswer, removeAnswer, () => {});
      if (store.subscribeSlides) store.subscribeSlides(addSlide, removeSlide, () => {});
      sendBeat(); setInterval(sendBeat, 15000);
    });
    $("wLogin").addEventListener("submit", async e => {
      e.preventDefault();
      const acct = $("wAcct").value.trim(), pw = $("wPw").value;
      if (!acct || !pw) { $("wLoginErr").textContent = "請輸入帳號和密碼"; return; }
      $("wLoginBtn").disabled = true; $("wLoginBtn").textContent = "登入中…"; $("wLoginErr").textContent = "";
      try { await auth.signIn(acct, pw); }
      catch (er) { $("wLoginErr").textContent = er && er.message ? er.message : "登入沒有成功"; $("wLoginBtn").disabled = false; $("wLoginBtn").textContent = "登入"; }
    });
  }
  async function start() {
    await boot();
  }
  $("wStartBtn").addEventListener("click", async () => {
    started = true;
    $("wStart").hidden = true;
    await goFull();
    layout = null; renderNow();
  });
  window.PBWall = { start, addPhoto, renderNow, photos };
})();
