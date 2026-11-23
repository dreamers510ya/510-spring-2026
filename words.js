/* 文字雲：字詞正規化與不當字詞過濾（來賓頁、大螢幕、控制台共用） */
(function () {
  // 包含就擋（較明確的不雅、攻擊字詞）
  const SUBSTR = [
    "幹你", "幹妳", "幹您", "操你", "操妳", "機掰", "雞掰", "機八", "雞巴", "靠北", "靠杯", "靠夭", "靠腰",
    "他媽", "他馬", "她媽", "媽的", "馬的", "去死", "智障", "白痴", "白癡", "腦殘", "低能", "北七", "三小",
    "婊子", "賤人", "賤貨", "王八", "混蛋", "垃圾", "廢物", "屌", "頭殼壞", "色情", "做愛", "約炮", "屁眼",
    "卒仔", "孬種", "畜生", "畜牲", "人渣", "閉嘴", "滾開", "下賤", "吃屎", "狗屎",
    "fuck", "shit", "bitch", "dick", "porn", "sex", "wtf", "stfu"
  ];
  // 整個詞完全相同才擋（太短、單獨出現才有負面意思）
  const EXACT = ["幹", "操", "死", "屁", "爛", "滾", "賤", "婊", "87", "88", "笨蛋", "去你的", "很爛", "爛透", "無聊", "難吃"];

  function norm(s) {
    return String(s || "")
      .normalize("NFKC")                        // 全形英數轉半形
      .toLowerCase()
      .replace(/[\s　]+/g, "")
      .replace(/[!-/:-@[-`{-~，。、；：？！「」『』（）《》〈〉…—～·・‘-‟]/g, "")
      .slice(0, 12);
  }
  // 程度詞合併：「很高興」「非常高興」「超級高興了」都算「高興」
  // 只拿掉詞頭的程度副詞、詞尾的語助詞；拿掉後至少要剩 2 個字，固定用語不拆
  const PRE = ["超級", "非常", "特別", "十分", "有點", "有些", "真的", "真是", "超", "很", "好", "真", "太", "蠻", "滿", "挺", "最", "極"];
  const SUF = ["了", "啦", "喔", "哦", "耶", "呀", "啊", "唷", "囉"];
  const KEEP = [
    "好朋友", "好心情", "好心", "好運", "好友", "好人", "好事", "好好", "好處", "好日子", "好時光", "好棒棒", "好家在",
    "真心", "真情", "真愛", "真誠", "真相", "真實", "真善美", "最愛", "最後", "最初", "最好", "最棒", "最佳",
    "太陽", "太太", "太平", "滿滿", "滿足", "滿意", "滿分", "滿月", "滿載", "超人", "超市", "超越", "極光", "很久"
  ];
  function base(n) {
    let w = n, changed = true;
    while (changed) {
      changed = false;
      if (KEEP.some(k => w.startsWith(k))) break;
      for (const p of PRE) {
        if (w.startsWith(p) && w.length - p.length >= 2 && (p.length > 1 || w[1] !== p)) { w = w.slice(p.length); changed = true; break; }
      }
    }
    for (const x of SUF) if (w.endsWith(x) && w.length - x.length >= 2) { w = w.slice(0, -x.length); break; }
    return w;
  }

  function blockedBy(w, extra) {
    const n = norm(w);
    if (!n) return "請輸入一個詞";
    if (/^https?|www\.|\.com|\.tw/.test(n)) return "請不要輸入網址";
    if (/^\d{4,}$/.test(n)) return "請輸入文字";
    if (EXACT.includes(n) || SUBSTR.some(b => n.includes(b))) return "這個詞不適合出現在大螢幕，換一個吧";
    if (extra && (extra.includes(n) || extra.includes(base(n)))) return "這個詞不適合出現在大螢幕，換一個吧";
    return "";
  }
  // 統計某一題的回答：同義（正規化後相同）合併，回傳依次數排序
  function tally(list, qid, extra) {
    const m = new Map();
    for (const a of list) {
      if (!a || a.q !== qid) continue;
      if (blockedBy(a.w, extra)) continue;
      const k = base(norm(a.w));
      const v = String(a.w).trim().replace(/\s+/g, " ").slice(0, 8);
      let e = m.get(k);
      if (!e) m.set(k, e = { key: k, text: k, n: 0, first: a.ts || 0, last: 0, vars: {} });
      e.n++; e.last = Math.max(e.last, a.ts || 0);
      e.vars[v] = (e.vars[v] || 0) + 1;
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.first - b.first);
  }
  window.PBWords = { norm, base, blockedBy, tally };
})();
