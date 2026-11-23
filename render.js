/* 影像合成：濾鏡、相框、輸出。booth 與 wall 共用。 */
(function () {
  const W = 1080, H = 1350;

  // ---------- 濾鏡 ----------
  const FILTERS = [
    { id: "none",  name: "原色", ops: [] },
    { id: "warm",  name: "暖春", ops: [["sepia", 0.22], ["saturate", 1.35], ["brightness", 1.06], ["contrast", 1.06]], tint: ["rgba(255,140,60,0.32)", "soft-light"] },
    { id: "red",   name: "喜氣", ops: [["saturate", 1.55], ["contrast", 1.14]], tint: ["rgba(235,40,40,0.30)", "soft-light"], vignette: 0.32 },
    { id: "soft",  name: "柔光", ops: [["brightness", 1.14], ["contrast", 0.82], ["saturate", 0.95]], tint: ["rgba(255,215,215,0.30)", "screen"] },
    { id: "fresh", name: "清透", ops: [["brightness", 1.08], ["contrast", 1.08], ["saturate", 1.15]], tint: ["rgba(90,170,255,0.22)", "soft-light"] },
    { id: "retro", name: "復古", ops: [["sepia", 0.6], ["contrast", 1.12], ["saturate", 0.8]], vignette: 0.45 },
    { id: "mono",  name: "黑白", ops: [["grayscale", 1], ["contrast", 1.28]], vignette: 0.25 }
  ];

  const cssOf = f => f.ops.length ? f.ops.map(([k, v]) => `${k}(${v})`).join(" ") : "none";

  // 3x4 color matrix (rows r,g,b; last col offset in 0..1)
  function opMatrix(k, v) {
    const I = [1,0,0,0, 0,1,0,0, 0,0,1,0];
    if (k === "brightness") return [v,0,0,0, 0,v,0,0, 0,0,v,0];
    if (k === "contrast") { const o = 0.5 - 0.5 * v; return [v,0,0,o, 0,v,0,o, 0,0,v,o]; }
    if (k === "saturate") { const s = v; return [
      0.213+0.787*s, 0.715-0.715*s, 0.072-0.072*s, 0,
      0.213-0.213*s, 0.715+0.285*s, 0.072-0.072*s, 0,
      0.213-0.213*s, 0.715-0.715*s, 0.072+0.928*s, 0]; }
    if (k === "grayscale") { const a = 1 - Math.min(1, v); return [
      0.2126+0.7874*a, 0.7152-0.7152*a, 0.0722-0.0722*a, 0,
      0.2126-0.2126*a, 0.7152+0.2848*a, 0.0722-0.0722*a, 0,
      0.2126-0.2126*a, 0.7152-0.7152*a, 0.0722+0.9278*a, 0]; }
    if (k === "sepia") { const a = 1 - Math.min(1, v); return [
      0.393+0.607*a, 0.769-0.769*a, 0.189-0.189*a, 0,
      0.349-0.349*a, 0.686+0.314*a, 0.168-0.168*a, 0,
      0.272-0.272*a, 0.534-0.534*a, 0.131+0.869*a, 0]; }
    return I;
  }
  // result = A ∘ B  (apply B first, then A)
  function mcompose(A, B) {
    const R = new Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        R[r*4+c] = A[r*4]*B[c] + A[r*4+1]*B[4+c] + A[r*4+2]*B[8+c];
      }
      R[r*4+3] = A[r*4]*B[3] + A[r*4+1]*B[7] + A[r*4+2]*B[11] + A[r*4+3];
    }
    return R;
  }
  function matrixOf(f) {
    let M = [1,0,0,0, 0,1,0,0, 0,0,1,0];
    for (const [k, v] of f.ops) M = mcompose(opMatrix(k, v), M);
    return M;
  }

  let nativeFilter = null;
  // iPhone Safari 雖然有 ctx.filter 屬性，但畫出來沒有效果；一律用像素運算，所有手機結果一致
  function hasNativeFilter() { return false; }

  function applyMatrix(ctx, x, y, w, h, M) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(ctx.canvas.width - x, Math.ceil(w)); h = Math.min(ctx.canvas.height - y, Math.ceil(h));
    const img = ctx.getImageData(x, y, w, h), d = img.data;
    const [a,b,c,o1, e,f,g,o2, i,j,k,o3] = M;
    const O1 = o1*255, O2 = o2*255, O3 = o3*255;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], gg = d[p+1], bb = d[p+2];
      d[p]   = a*r + b*gg + c*bb + O1;
      d[p+1] = e*r + f*gg + g*bb + O2;
      d[p+2] = i*r + j*gg + k*bb + O3;
    }
    ctx.putImageData(img, x, y);
  }

  function srcSize(src) {
    return {
      w: src.videoWidth || src.naturalWidth || src.width,
      h: src.videoHeight || src.naturalHeight || src.height
    };
  }

  /** 把來源圖 cover 進 rect，套濾鏡、色調、暗角。view = {zoom, dx, dy} 可選 */
  function drawPhoto(ctx, src, rect, filter, opts = {}) {
    const { w: sw, h: sh } = srcSize(src);
    if (!sw || !sh) return;
    const zoom = opts.zoom || 1;
    const scale = Math.max(rect.w / sw, rect.h / sh) * zoom;
    const dw = sw * scale, dh = sh * scale;
    const dx = rect.x + (rect.w - dw) / 2 + (opts.dx || 0) * rect.w;
    const dy = rect.y + (rect.h - dh) / 2 + (opts.dy || 0) * rect.h;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const useNative = filter.ops.length && hasNativeFilter();
    if (useNative) ctx.filter = cssOf(filter);
    if (opts.mirror) {
      ctx.translate(dx + dw, dy); ctx.scale(-1, 1); ctx.drawImage(src, 0, 0, dw, dh);
    } else {
      ctx.drawImage(src, dx, dy, dw, dh);
    }
    ctx.restore();
    if (filter.ops.length && !useNative) applyMatrix(ctx, rect.x, rect.y, rect.w, rect.h, matrixOf(filter));
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    if (filter.tint) {
      ctx.globalCompositeOperation = filter.tint[1];
      ctx.fillStyle = filter.tint[0];
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalCompositeOperation = "source-over";
    }
    if (filter.vignette) {
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      const g = ctx.createRadialGradient(cx, cy, Math.min(rect.w, rect.h) * 0.35, cx, cy, Math.hypot(rect.w, rect.h) * 0.6);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(20,0,0,${filter.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
  }

  // ---------- 相框 ----------
  const C = { red: "#b3122a", redDeep: "#7a0b1c", gold: "#e3b866", goldHi: "#f6e2ac", paper: "#fff8ec", ink: "#2b0a0f" };
  const SERIF = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';
  const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

  function goldGrad(ctx, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "#c8933f"); g.addColorStop(0.45, C.goldHi); g.addColorStop(1, "#b88232");
    return g;
  }
  function fitText(ctx, text, maxW, size, weight, family) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 12);
  }
  function cloud(ctx, x, y, r, flip) {
    // 簡化祥雲：三段相切圓弧 + 內捲
    ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
    ctx.lineWidth = r * 0.16; ctx.strokeStyle = goldGrad(ctx, -r, -r, r * 3, r);
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI * 0.9, Math.PI * 2.0);
    ctx.arc(r * 1.55, -r * 0.15, r * 0.65, Math.PI * 1.1, Math.PI * 2.1);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 1.5); ctx.stroke();
    ctx.restore();
  }
  function seal(ctx, x, y, s, ch, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.fillStyle = C.red; ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = C.paper; ctx.lineWidth = s * 0.05; ctx.strokeRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    ctx.fillStyle = C.paper; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `900 ${s * 0.56}px ${SERIF}`; ctx.fillText(ch, 0, s * 0.03);
    ctx.restore();
  }
  function doufang(ctx, x, y, s, ch) {
    // 斗方春聯：旋轉 45 度的紅色方塊 + 金字
    ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = C.red; ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = goldGrad(ctx, -s / 2, -s / 2, s / 2, s / 2); ctx.lineWidth = 6;
    ctx.strokeRect(-s / 2 + 10, -s / 2 + 10, s - 20, s - 20);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = goldGrad(ctx, -s / 3, -s / 3, s / 3, s / 3);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `900 ${s * 0.62}px ${SERIF}`; ctx.fillText(ch, 0, s * 0.04);
    ctx.restore();
  }
  function lantern(ctx, x, y, r, ch) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -y); ctx.lineTo(0, -r * 1.05); ctx.stroke();
    ctx.fillStyle = goldGrad(ctx, -r * .4, 0, r * .4, 0);
    ctx.fillRect(-r * 0.42, -r * 1.12, r * 0.84, r * 0.2);
    ctx.fillRect(-r * 0.42, r * 0.92, r * 0.84, r * 0.2);
    const g = ctx.createRadialGradient(-r * .25, -r * .2, r * .1, 0, 0, r * 1.1);
    g.addColorStop(0, "#ff5a4a"); g.addColorStop(0.6, C.red); g.addColorStop(1, C.redDeep);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.98, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(246,226,172,.55)"; ctx.lineWidth = 2;
    for (const k of [-0.62, -0.25, 0.25, 0.62]) {
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(k) * r * 1.05, r * 0.98, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (ch) {
      ctx.fillStyle = C.goldHi; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `900 ${r * 0.9}px ${SERIF}`; ctx.fillText(ch, 0, r * 0.05);
    }
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 5, r * 1.12); ctx.lineTo(i * 7, r * 1.75); ctx.stroke(); }
    ctx.restore();
  }

  const BUILTIN = {
    spring: {
      window: { x: 46, y: 46, w: W - 92, h: H - 46 - 250 },
      bg: C.red,
      draw(ctx, cfg) {
        // 外框
        ctx.fillStyle = C.red;
        ctx.fillRect(0, 0, W, 46); ctx.fillRect(0, 0, 46, H); ctx.fillRect(W - 46, 0, 46, H);
        ctx.fillRect(0, H - 250, W, 250);
        ctx.strokeStyle = goldGrad(ctx, 0, 0, W, H); ctx.lineWidth = 5;
        ctx.strokeRect(46, 46, W - 92, H - 296);
        ctx.lineWidth = 2; ctx.strokeRect(26, 26, W - 52, H - 52);
        // 角落祥雲
        cloud(ctx, 120, H - 336, 30, false);
        cloud(ctx, W - 120, H - 336, 30, true);
        // 斗方
        doufang(ctx, 150, 150, 150, "春");
        // 標題
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        fitText(ctx, cfg.title, W - 200, 78, 900, SERIF);
        ctx.fillStyle = goldGrad(ctx, 0, H - 210, 0, H - 120);
        ctx.fillText(cfg.title, W / 2, H - 140);
        ctx.font = `500 32px ${SANS}`; ctx.fillStyle = C.goldHi;
        ctx.fillText(cfg.subtitle, W / 2, H - 82);
        ctx.font = `400 24px ${SANS}`; ctx.fillStyle = "rgba(246,226,172,.7)";
        ctx.fillText(cfg.hashtags, W / 2, H - 44);
      }
    },
    polaroid: {
      window: { x: 64, y: 64, w: W - 128, h: H - 64 - 300 },
      bg: C.paper,
      draw(ctx, cfg) {
        ctx.fillStyle = C.paper;
        ctx.fillRect(0, 0, W, 64); ctx.fillRect(0, 0, 64, H); ctx.fillRect(W - 64, 0, 64, H);
        ctx.fillRect(0, H - 300, W, 300);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        fitText(ctx, cfg.title, W - 330, 72, 900, SERIF);
        ctx.fillStyle = C.ink; ctx.fillText(cfg.title, 72, H - 170);
        ctx.font = `500 30px ${SANS}`; ctx.fillStyle = C.red;
        ctx.fillText(cfg.subtitle, 72, H - 112);
        ctx.font = `400 24px ${SANS}`; ctx.fillStyle = "rgba(43,10,15,.55)";
        ctx.fillText(cfg.hashtags, 72, H - 70);
        seal(ctx, W - 150, H - 150, 130, cfg.sealChar || "夢", -0.06);
      }
    },
    lantern: {
      window: { x: 0, y: 0, w: W, h: H },
      bg: C.redDeep,
      draw(ctx, cfg) {
        // 上方燈籠串 + 底部漸層字幕
        lantern(ctx, 150, 170, 70, "福");
        lantern(ctx, W - 150, 210, 82, "春");
        lantern(ctx, W - 300, 120, 48, "");
        const g = ctx.createLinearGradient(0, H - 420, 0, H);
        g.addColorStop(0, "rgba(122,11,28,0)"); g.addColorStop(0.55, "rgba(122,11,28,.82)"); g.addColorStop(1, "rgba(90,6,18,.96)");
        ctx.fillStyle = g; ctx.fillRect(0, H - 420, W, 420);
        ctx.strokeStyle = goldGrad(ctx, 0, 0, W, 0); ctx.lineWidth = 4;
        ctx.strokeRect(28, 28, W - 56, H - 56);
        ctx.textAlign = "center";
        fitText(ctx, cfg.title, W - 160, 84, 900, SERIF);
        ctx.fillStyle = goldGrad(ctx, 0, H - 230, 0, H - 140);
        ctx.fillText(cfg.title, W / 2, H - 150);
        ctx.font = `500 32px ${SANS}`; ctx.fillStyle = C.goldHi;
        ctx.fillText(cfg.subtitle, W / 2, H - 92);
        ctx.font = `400 24px ${SANS}`; ctx.fillStyle = "rgba(246,226,172,.75)";
        ctx.fillText(cfg.hashtags, W / 2, H - 54);
      }
    }
  };

  const imageCache = {};
  function loadImage(src) {
    if (!imageCache[src]) {
      imageCache[src] = new Promise((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
      });
    }
    return imageCache[src];
  }

  /** 取得相框定義（含 window / draw） */
  async function getFrame(def) {
    if (def.type === "image") {
      let im = null;
      try { im = await loadImage((window.PB_ASSETS && window.PB_ASSETS[def.src]) || def.src); } catch (e) { console.warn("相框圖片載入失敗", def.src); }
      return {
        window: def.window || (def.windows && def.windows[0]) || { x: 0, y: 0, w: W, h: H },
        windows: def.windows || null,
        bg: def.bg || "#fcf3f2",
        draw(ctx) { if (im) ctx.drawImage(im, 0, 0, W, H); }
      };
    }
    return BUILTIN[def.id] || BUILTIN.spring;
  }

  /** 把相框（不含照片）畫成透明圖層，給即時預覽用 */
  async function frameOverlay(def, cfg) {
    const fr = await getFrame(def);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    fr.draw(ctx, cfg);
    return { canvas: cv, window: fr.window, windows: fr.windows || null };
  }

  /** 完整合成 */
  async function compose(target, src, frameDef, filter, cfg, opts = {}) {
    target.width = W; target.height = H;
    const ctx = target.getContext("2d");
    const fr = await getFrame(frameDef);
    ctx.fillStyle = fr.bg; ctx.fillRect(0, 0, W, H);
    const list = Array.isArray(src) ? src : [src];
    if (fr.windows) {
      // 多格相框（四格拍貼）：每格放一張；還沒拍的格子顯示提示
      fr.windows.forEach((w, i) => {
        if (list[i]) drawPhoto(ctx, list[i], w, filter, opts);
        else emptySlot(ctx, w, i);
      });
    } else if (list[0]) {
      drawPhoto(ctx, list[0], fr.window, filter, opts);
    }
    fr.draw(ctx, cfg);
    return target;
  }

  function emptySlot(ctx, w, i) {
    ctx.save();
    ctx.fillStyle = "#efe3dc"; ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = "#b07a66"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(w.w * 0.09)}px ${SANS}`;
    ctx.fillText(`第 ${i + 1} 張`, w.x + w.w / 2, w.y + w.h / 2);
    ctx.restore();
  }

  /** 給大合照的縮圖（不含相框，4:5）；四格拍貼會拼成 2x2 */
  function thumbnail(src, filter, opts = {}, w = 400) {
    const h = Math.round(w * 1.25);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fcf3f2"; ctx.fillRect(0, 0, w, h);
    if (Array.isArray(src) && src.filter(Boolean).length > 1) {
      const g = 4, cw = (w - g) / 2, ch = (h - g) / 2;
      src.slice(0, 4).forEach((s, i) => { if (s) drawPhoto(ctx, s, { x: (i % 2) * (cw + g), y: Math.floor(i / 2) * (ch + g), w: cw, h: ch }, filter, opts); });
    } else {
      drawPhoto(ctx, Array.isArray(src) ? src.find(Boolean) : src, { x: 0, y: 0, w, h }, filter, opts);
    }
    let q = 0.74, url = cv.toDataURL("image/jpeg", q);
    while (url.length > 150000 && q > 0.4) { q -= 0.08; url = cv.toDataURL("image/jpeg", q); }
    return url;
  }

  async function fontsReady() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load(`900 64px "Noto Serif TC"`, "一起夢想迎春團圓福春"),
          document.fonts.load(`500 30px "Noto Sans TC"`, "微型社福饗宴一起夢想"),
          document.fonts.load(`400 24px "Noto Sans TC"`, "#一起夢想")
        ]),
        new Promise(r => setTimeout(r, 2500))
      ]);
    } catch (e) {}
  }

  /** 濾鏡小圖（給選單用） */
  function filterThumb(src, filter, w = 192) {
    const h = Math.round(w * 1.25);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    drawPhoto(cv.getContext("2d"), src, { x: 0, y: 0, w, h }, filter);
    return cv.toDataURL("image/jpeg", 0.8);
  }
  /** 範例照片：還沒拍照前，濾鏡選單用它示範效果 */
  function sampleSource() {
    const w = 240, h = 300, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#9fc6e8"); g.addColorStop(1, "#f6c9a4");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = "#e2432f"; c.beginPath(); c.ellipse(120, 300, 95, 90, 0, Math.PI, 0); c.fill();
    c.fillStyle = "#eec4a0"; c.beginPath(); c.arc(120, 140, 58, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#3b2418"; c.beginPath(); c.arc(120, 122, 60, Math.PI, 0); c.fill();
    c.fillStyle = "#f28a3a"; c.fillRect(0, 238, 46, 62); c.fillStyle = "#4caf72"; c.fillRect(196, 226, 44, 74);
    return cv;
  }
  /** 相框小圖 */
  async function frameThumb(def, cfg, w = 192) {
    const h = Math.round(w * 1.25);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    const fr = await getFrame(def);
    ctx.fillStyle = "#f6d2b8"; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.scale(w / W, h / H); fr.draw(ctx, cfg); ctx.restore();
    return cv.toDataURL("image/png");
  }

  window.PBRender = { W, H, FILTERS, filterThumb, sampleSource, frameThumb, cssOf, compose, thumbnail, frameOverlay, getFrame, fontsReady, drawPhoto };
})();
