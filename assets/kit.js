/* Describer work list (kit.html). Nothing is sent from this page (its CSP has connect-src 'none').
 *
 * URL (hash, never sent to the server):
 *   kit.html#code=OW-7K3QX&round=1&mode=open&row=2&consent=v3....   (made by join.html)
 *
 * Lists the four half-tasks in the order of one counterbalancing row, then the final questions.
 * The rows are the table of README.md (給參加者的連結) and stage2/pilot/START-TRIALS.md 0.3.
 * An open describer's row follows from the code (GC.rowForCode: its 5 random characters, mod 4), so it
 * is the same on every device and whatever the link says; join.html draws codes so that each row has
 * probability 1/4. Invited describers follow Ted's letter; a link from Ted may carry row=1..4 to show
 * the same list. Review links carry row=N, so the review log records the row too.
 */
(function () {
  "use strict";
  var GC = window.GC;

  // Each step: clip, half (1 front, 2 back), task: "write" (from scratch, write.html) or "review"
  // (edit the draft, review/<clip>-<half>/review_pilot.html).
  var ROWS = {
    1: [["A", 1, "write"], ["B", 2, "write"], ["A", 2, "review"], ["B", 1, "review"]],
    2: [["A", 1, "review"], ["B", 2, "review"], ["A", 2, "write"], ["B", 1, "write"]],
    3: [["A", 2, "review"], ["B", 1, "review"], ["A", 1, "write"], ["B", 2, "write"]],
    4: [["A", 2, "write"], ["B", 1, "write"], ["A", 1, "review"], ["B", 2, "review"]]
  };
  var FIRST = { 1: "從零撰寫", 2: "修改草稿", 3: "修改草稿", 4: "從零撰寫" };
  var HALF = { 1: "前半", 2: "後半" };

  var params = GC.readParams();
  var code = GC.cleanCode(params.code);
  var row = /^[1-4]$/.test(params.row || "") ? Number(params.row) : null;
  var token = params.consent && GC.consentFromToken(params.consent) ? params.consent : "";
  var $ = function (id) { return document.getElementById(id); };

  $("setup-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("in-code");
    var c = GC.cleanCode(input.value);
    if (!GC.validCode(c)) {
      input.setAttribute("aria-invalid", "true");
      GC.announce($("setup-status"), GC.CODE_HELP);
      input.focus();
      return;
    }
    GC.goToHash("code=" + encodeURIComponent(c) + "&round=1" + (GC.isOpenCode(c) ? "&mode=open" : ""));
  });

  if (!code) {
    $("setup").hidden = false;
    GC.watchHash(["code", "row"]);
    return;
  }

  var open = GC.isOpenCode(code);
  var who = "你的代號：" + code + "。";
  if (!GC.validCode(code)) {
    // A link with a code of the wrong form: ask for the code again instead of listing steps.
    $("who").textContent = GC.CODE_HELP;
    $("setup").hidden = false;
    GC.watchHash(["code", "row"]);
    return;
  }
  if (open) who += "你是公開參加（沒有酬勞）。請記下這個代號：要刪除資料時告訴 Ted。";
  if (open && !GC.consentFor(code, token)) {
    who += "這臺裝置上沒有你的同意紀錄：每一步按「送出」以前，那一頁會請你再勾選一次同意。";
  }
  $("who").textContent = who;

  if (open && !GC.rowForCode(code)) {
    // A listener's code (OL-) opened here by mistake.
    $("who").textContent = "代號 " + code + " 是聽眾的代號（OL- 開頭），這一頁是撰稿人用的。聽眾請用參加頁給你的聆聽頁連結。";
    return;
  }
  if (open) {
    // The row comes from the code, never from the link or a new draw.
    var fromCode = GC.rowForCode(code);
    if (fromCode !== row) {
      row = fromCode;
      // Put it in the address too, so a bookmark shows the same list.
      try {
        var h = "code=" + encodeURIComponent(code) + "&round=1&mode=open&row=" + row +
          (token ? "&consent=" + encodeURIComponent(token) : "");
        window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + h);
      } catch (e) { /* ignore */ }
    }
  } else if (row) {
    GC.store.set("gc-row:" + code, row);
  }
  // Another personal link opened in this tab (different code or row) reloads the list.
  GC.watchHash(["code", "row"]);

  var extra = (open ? "&mode=open" : "") + (token ? "&consent=" + encodeURIComponent(token) : "");
  var finalHref = "final.html#code=" + encodeURIComponent(code) + "&round=1" + (row ? "&row=" + row : "") + extra;

  if (!row) {
    // Invited describer without a row in the link: Ted's letter has the order.
    $("invited-section").hidden = false;
    $("invited-final").setAttribute("href", finalHref);
    return;
  }

  function clipName(parent, clip) {
    if (clip === "A") {
      parent.appendChild(document.createTextNode("片段 A（"));
      var en = document.createElement("span");
      en.lang = "en";
      en.textContent = "Tears of Steel";
      parent.appendChild(en);
      parent.appendChild(document.createTextNode("）"));
    } else {
      parent.appendChild(document.createTextNode("片段 B（《Spring》）"));
    }
  }

  function stepHref(step) {
    var clip = step[0], half = step[1];
    if (step[2] === "write") {
      return "write.html#code=" + encodeURIComponent(code) + "&round=1&clip=" + clip + "&half=" + half +
        "&row=" + row + extra;
    }
    return "review/" + clip + "-" + half + "/review_pilot.html#p=" + encodeURIComponent(code) + "&r=1&row=" + row +
      (token ? "&consent=" + encodeURIComponent(token) : "");
  }

  function receipt(kind, detail) {
    var rec = GC.store.get(GC.receiptKey(kind, code, detail));
    return rec && rec.id ? rec : null;
  }

  function addStep(list, n, labelParts, href, desc, rec) {
    var li = document.createElement("li");
    var p = document.createElement("p");
    var a = document.createElement("a");
    a.setAttribute("href", href);
    a.appendChild(document.createTextNode("第 " + n + " 步："));
    labelParts(a);
    p.appendChild(a);
    if (rec) {
      var done = document.createElement("strong");
      done.textContent = "（這臺裝置已送出：" + GC.taipeiTime(rec.received_at) + "）";
      p.appendChild(document.createTextNode(" "));
      p.appendChild(done);
    }
    li.appendChild(p);
    var d = document.createElement("p");
    d.className = "hint";
    d.textContent = desc;
    li.appendChild(d);
    list.appendChild(li);
  }

  $("row-text").textContent = (open
    ? "網頁為你隨機分配了第 " + row + " 種順序（共四種）。順序由代號決定，在任何裝置上打開都一樣。"
    : "這是 Ted 為你排的第 " + row + " 種順序。") +
    "先做「" + FIRST[row] + "」，兩段片都做完，再做另一種。請照順序做。";

  var list = $("steps");
  ROWS[row].forEach(function (step, i) {
    var clip = step[0], half = step[1], task = step[2];
    var write = task === "write";
    addStep(list, i + 1, function (a) {
      clipName(a, clip);
      a.appendChild(document.createTextNode(HALF[half] + "，" + (write ? "從零撰寫" : "修改 GapCaster 的草稿")));
    }, stepHref(step), write
      ? "在撰寫頁看這一半的影片，自己寫口述影像，頁面會計時。做完按「送出撰寫內容」。"
      : "在審閱頁逐句標記「正確、小錯、錯」，並修改 GapCaster 的草稿，頁面會自動計時。做完按「送出記錄」。",
      receipt(write ? "write" : "review", clip + half));
  });
  addStep(list, 5, function (a) { a.appendChild(document.createTextNode("最後的問題")); }, finalHref,
    "四個半段都做完以後，回答幾個問題，再按「送出回答」。", receipt("writer-final", ""));
  $("steps-section").hidden = false;
})();
