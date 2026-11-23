/* Open self-serve route (join.html). Nothing is sent from this page (its CSP has connect-src 'none').
 *
 * The participant picks 聽眾 or 撰稿人, ticks the consent v3 items, and gets a random code made in
 * the browser: "OL-" (listener) or "OW-" (describer) plus 5 characters from
 * 23456789ABCDEFGHJKMNPQRSTUVWXYZ (crypto.getRandomValues). Describers also get one of the four
 * counterbalancing rows, each with probability 1/4: the row follows from the code's 5 random
 * characters (GC.rowForCode), so it is the same on every device. The consent record
 * {version, items, at} is kept in this browser and, as a short token, in the next link; it is sent
 * with every 送出 of that code.
 *
 * Codes are issued only inside the trial window by this device's clock. join.html#test=1 issues
 * test codes (TOL-..., TOW-...) at any time; tests are always accepted by the inbox and are never
 * counted.
 */
(function () {
  "use strict";
  var GC = window.GC;
  var CURRENT_KEY = "gc-open:current";

  var params = GC.readParams();
  var testMode = params.test === "1";

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("j-status");

  function checked(name) {
    var el = document.querySelector("input[name='" + name + "']:checked");
    return el ? el.value : "";
  }

  function sync() {
    var writer = checked("j-role") === "writer";
    $("j-writer").hidden = !writer;
    var yes = writer && checked("j-text") === "Y";
    $("j-sign-wrap").hidden = !yes;
    $("j-licence-wrap").hidden = !(yes && checked("j-sign") === "Y");
  }
  $("join-form").addEventListener("change", sync);

  // --- Window -------------------------------------------------------------------
  var state = testMode ? "open" : GC.windowState();
  var msg = $("window-msg");
  if (testMode) $("test-msg").hidden = false;
  if (state === "before") {
    msg.textContent = "公開參加從 " + GC.WINDOW_TEXT.start + " 開始，到時候再回來這一頁取得代號。試用到 " +
      GC.WINDOW_TEXT.end + " 結束。";
  } else if (state === "after") {
    msg.textContent = "試用已經在 " + GC.WINDOW_TEXT.end + " 結束，這一頁不再產生新的代號。謝謝你的關心。";
  } else {
    msg.textContent = "現在是試用時間，可以取得代號。試用到 " + GC.WINDOW_TEXT.end + " 結束，請在這之前做完並按「送出」。";
  }

  // --- Result -------------------------------------------------------------------
  function spell(code) {
    return "一個字一個字唸：" + code.split("").map(function (ch) {
      return ch === "-" ? "減號" : ch;
    }).join("、") + "。";
  }

  function nextLink(cur) {
    var token = cur.consent ? "&consent=" + encodeURIComponent(cur.token || "") : "";
    if (cur.role === "listener") {
      return "listen.html#code=" + encodeURIComponent(cur.code) + "&round=1&mode=open" + token;
    }
    return "kit.html#code=" + encodeURIComponent(cur.code) + "&round=1&mode=open&row=" + GC.rowForCode(cur.code) + token;
  }

  function showResult(cur, fresh) {
    $("form-section").hidden = true;
    $("result").hidden = false;
    $("code-show").textContent = cur.code;
    $("code-spell").textContent = spell(cur.code);
    var link = $("next-link");
    link.setAttribute("href", nextLink(cur));
    if (cur.role === "listener") {
      $("next-text").textContent = (fresh ? "" : "這臺裝置之前拿過這個代號。") +
        "請打開聆聽頁。代號已經放在連結裡，會自動帶入。";
      link.textContent = "開始聆聽（聆聽頁）";
      $("move-text").textContent = "要換到另一臺裝置聽的話，請按「複製下一步的連結」，傳到那臺裝置上打開。" +
        "連結裡有你的代號和同意紀錄；只抄代號的話，送出以前要在那臺裝置上再勾選一次同意。";
    } else {
      $("next-text").textContent = (fresh ? "" : "這臺裝置之前拿過這個代號。") +
        "請打開你的工作清單：上面有四個步驟的連結，照順序做，最後回答幾個問題。代號已經放在連結裡。" +
        "可以把工作清單加入書籤，下次從那裡繼續。";
      link.textContent = "打開撰稿人工作清單";
      $("move-text").textContent = "撰寫頁和審閱頁請用電腦的瀏覽器。現在用的是手機的話，請按「複製下一步的連結」，" +
        "傳到電腦上打開。連結裡有你的代號和同意紀錄；只抄代號的話，送出以前要在電腦上再勾選一次同意。";
    }
    // An open describer who chose 可以 and 願意 still has to e-mail the licence statement (consent
    // section 7); say it again here, with the consent page's reply form already holding the code.
    var lic = $("licence-next");
    if (cur.role === "writer" && /^YY/.test(String(cur.token || "").split(".")[2] || "")) {
      var lp = $("licence-link");
      lp.setAttribute("href", "consent.html#code=" + encodeURIComponent(cur.code));
      lic.hidden = false;
    } else {
      lic.hidden = true;
    }
    if (fresh) {
      var h = $("h-code");
      h.focus();
    }
  }

  $("copy-link").addEventListener("click", function () {
    var href = $("next-link").href; // absolute address, with the code and the consent token
    GC.copyText(href, null).then(function (ok) {
      GC.announce($("code-status"), ok ? "已複製下一步的連結。請貼到訊息或 email 傳給自己，在另一臺裝置上打開。"
        : "沒有複製成功。請在「下一步」的按鈕上用瀏覽器的選單複製連結。");
    });
  });

  $("copy-code").addEventListener("click", function () {
    var code = $("code-show").textContent;
    GC.copyText(code, null).then(function (ok) {
      GC.announce($("code-status"), ok ? "已複製代號 " + code + "。" : "沒有複製成功，請自己記下代號：" + code + "。");
    });
  });

  $("new-person").addEventListener("click", function () {
    if (!window.confirm("確定要換另一個人嗎？你的代號會從這一頁消失，請先記下來。")) return;
    GC.store.remove(CURRENT_KEY);
    $("join-form").reset();
    sync();
    $("result").hidden = true;
    if (state === "open") {
      $("form-section").hidden = false;
      $("j-role-l").focus();
      GC.announce(statusEl, "已經清除。下一位請重新選擇參加方式並勾選。");
    } else {
      msg.setAttribute("tabindex", "-1");
      msg.focus();
    }
  });

  // --- Issue a code ---------------------------------------------------------------
  function ready() {
    if (!checked("j-role")) {
      GC.announce(statusEl, "請先選擇參加方式：聽眾或撰稿人。");
      $("j-role-l").focus();
      return false;
    }
    var boxes = document.querySelectorAll("#j-agree input[type=checkbox]");
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].checked) {
        var label = document.querySelector("label[for='" + boxes[i].id + "']");
        GC.announce(statusEl, "還有一項沒有勾：" + (label ? label.textContent.trim() : "") + "每一項都要勾，才能取得代號。");
        boxes[i].focus();
        return false;
      }
    }
    if (checked("j-role") === "writer") {
      if (!checked("j-text")) {
        GC.announce(statusEl, "請先回答選項 A：你的文字可以放進參賽作品嗎？");
        $("j-text-yes").focus();
        return false;
      }
      if (checked("j-text") === "Y" && !checked("j-sign")) {
        GC.announce(statusEl, "請先回答選項 A-1：主辦單位要求時，你願意提供本名並簽署嗎？");
        $("j-sign-yes").focus();
        return false;
      }
    }
    return true;
  }

  $("join-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var now = testMode ? "open" : GC.windowState();
    if (now !== "open") {
      GC.announce(statusEl, now === "before"
        ? "還沒到試用時間，不能取得代號。公開參加從 " + GC.WINDOW_TEXT.start + " 開始。"
        : "試用已經結束，不能取得代號。");
      return;
    }
    if (!ready()) return;
    var role = checked("j-role");
    var writer = role === "writer";
    var code = GC.newOpenCode((testMode ? "T" : "") + (writer ? "OW-" : "OL-"));
    var atMs = Date.now();
    var flags = "";
    var items = GC.OPEN_CONSENT_ITEMS.slice();
    if (writer) {
      var a = checked("j-text");
      var a1 = a === "Y" ? checked("j-sign") : "";
      var b = a === "Y" && a1 === "Y" ? checked("j-ccby") : "";
      flags = a + (a1 || "-") + (b || "-");
      items.push(GC.CHOICE_TEXT.A[a]);
      if (a1) items.push(GC.CHOICE_TEXT.A1[a1]);
      if (b) items.push(GC.CHOICE_TEXT.B[b]);
    }
    var consent = { version: GC.CONSENT_VERSION, items: items, at: new Date(atMs).toISOString() };
    var cur = { code: code, role: role, consent: true, token: GC.consentToken(atMs, flags) };
    if (writer) cur.row = GC.rowForCode(code);
    GC.store.set("gc-consent:" + code, consent);
    GC.store.set(CURRENT_KEY, cur);
    statusEl.textContent = "";
    showResult(cur, true);
  });

  // --- Init ---------------------------------------------------------------------
  var saved = GC.store.get(CURRENT_KEY);
  // A test code (leading T) is shown again only in test mode.
  if (saved && GC.isOpenCode(saved.code) && (testMode || saved.code.charAt(0) !== "T") &&
      (saved.role === "listener" || saved.role === "writer") &&
      (saved.role === "listener" || GC.rowForCode(saved.code))) {
    showResult(saved, false);
  } else if (state === "open") {
    $("form-section").hidden = false;
  }
  sync();
})();
