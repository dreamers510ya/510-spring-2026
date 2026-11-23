/* =========================================================
 *  2026 微型社福饗宴「一起夢想 作伙迎春團圓」拍照相框系統 — 活動設定檔
 *  只需要修改這個檔案，就能換文字、換相框、接上 Firebase。
 * ========================================================= */
window.PB_CONFIG = window.PB_CONFIG || {
  // 活動代號：照片會存在 events/{eventId}/photos 底下。
  // 彩排請用 "rehearsal"，正式活動當天改成 "spring-2026"，彩排照片就不會混進大合照。
  eventId: "rehearsal",

  // 相框與大螢幕上的文字
  title: "一起夢想 · 作伙迎春團圓",
  subtitle: "2026 微型社福饗宴",
  hashtags: "#一起夢想 #作伙迎春團圓 #510",
  sealChar: "夢",            // 相框上的印章字

  // 相框清單（已套用活動主視覺）。window = 照片露出的範圍（1080x1350 座標）
  // 想換新相框：請設計師輸出 1080x1350、中間透明的 PNG/WebP 放進 assets，照下面格式加一行
  frames: [
    { id: "kvposter", name: "主視覺",   type: "image", src: "assets/frame_kvposter.webp", window: { x: 90, y: 150, w: 900, h: 860 } },
    { id: "kvposter-red", name: "主視覺紅", type: "image", src: "assets/frame_kvposter_red.webp", window: { x: 90, y: 150, w: 900, h: 860 } },
    { id: "firecracker",  name: "爆竹漸層", type: "image", src: "assets/frame_firecracker.webp",  window: { x: 0, y: 0, w: 1080, h: 1350 } },
    { id: "fist",     name: "作伙碰拳", type: "image", src: "assets/frame_fist.webp",     window: { x: 0, y: 0, w: 1080, h: 1350 },
      pose: "兩人各伸一隻拳頭，對準框框擊拳！",
      guide: { x: 380, y: 780, w: 320, h: 200, label: "拳頭對準這裡" } },
    { id: "group",    name: "團圓合照", type: "image", src: "assets/frame_group.webp",    window: { x: 50, y: 400, w: 980, h: 690 } },
    { id: "grid",     name: "四格拍貼", type: "image", src: "assets/frame_grid.webp",
      windows: [ { x: 56, y: 56, w: 474, h: 497 }, { x: 550, y: 56, w: 474, h: 497 }, { x: 56, y: 573, w: 474, h: 497 }, { x: 550, y: 573, w: 474, h: 497 } ],
      poses: ["比個讚", "和夥伴碰拳", "一起比愛心", "開懷大笑"] },
    { id: "gallery",  name: "雅致米白", type: "image", src: "assets/frame_gallery.webp",   window: { x: 90, y: 80, w: 900, h: 880 } },
    { id: "vermilion",name: "朱紅金邊", type: "image", src: "assets/frame_vermilion.webp", window: { x: 80, y: 72, w: 920, h: 880 } }
    // 美編新相框：放進 assets 後照這個格式加一行；pose 是拍照時顯示的姿勢提示（可省略）
  ],

  // 簡報上傳時用來讀 PDF 的程式位置（獨立網站版已附在 pdfjs 資料夾，不用改）
  pdfjs: "pdfjs/",
  pdfjsData: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/",   // PDF 字型對照檔（GitHub 版為了減少檔案數改從這裡載入）

  // 大螢幕設定
  wall: {
    pageSize: 40,          // 輪播牆每頁張數
    pageSeconds: 9,        // 輪播換頁秒數
    shape: "rect",         // 大合照形狀：rect 滿版（每張最大）/ heart 愛心 / text 文字
    shapeText: "夢",       // shape 為 text 時拼出的字（1～3 個字效果最好）
    showNames: true,       // 新照片進場時顯示署名
    boothUrl: ""           // QR code 網址；留空會自動指向自拍頁
  },

  // 主持人控制台：共用控台帳號（登入畫面會預先帶入；密碼不寫在這裡）
  // Firebase 帳號必須是 email 格式，所以登入時會自動補上 consoleDomain：
  // 畫面上輸入 dream510 → 實際帳號 dream510@510.org.tw（在 Firebase「Authentication → Users」建立這個帳號）
  consoleAccount: "dream510",
  consoleDomain: "510.org.tw",

  // Firebase 設定（依部署手冊第 2 步，從 Firebase 主控台複製貼上）
  firebase: {
    apiKey: "AIzaSyAxLZt7SmFUNPatlVFDxexr-RnFQkP2ARg",
    authDomain: "dream510-spring-2026.firebaseapp.com",
    projectId: "dream510-spring-2026",
    storageBucket: "dream510-spring-2026.firebasestorage.app",
    messagingSenderId: "820410477964",
    appId: "1:820410477964:web:eec5b886cbce2fc0d73aa9"
  }
};
