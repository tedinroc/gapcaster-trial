/* Open self-serve route (join.html). The only thing this page sends is the consent record, when the
 * participant presses 同意並送出 (its CSP allows connect-src to the inbox origin only).
 *
 * The participant picks 聽眾 or 撰稿人, ticks the consent v3 items, and gets a random code made in
 * the browser: "OL-" (listener) or "OW-" (describer) plus 5 characters from
 * 23456789ABCDEFGHJKMNPQRSTUVWXYZ (crypto.getRandomValues). Describers also get one of the four
 * counterbalancing rows, each with probability 1/4: the row follows from the code's 5 random
 * characters (GC.rowForCode), so it is the same on every device. 同意並送出 makes the code and sends
 * the consent record {version, items, at} to the inbox at once (kind "consent"), so the person never
 * has to agree again, on any device. The record (never the name) is also kept in this browser and,
 * as a short token, in the next link, and goes with every 送出 of that code from this device. A
 * describer who chooses 可以 and 願意 types their legal name here; it goes only into this one
 * consent submission (payload.licence), never into storage, links or later submissions.
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
  function licenceWanted() {
    return checked("j-role") === "writer" && checked("j-text") === "Y" && checked("j-sign") === "Y";
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
      $("move-text").textContent = "要換到另一臺裝置聽的話，請按「複製下一步的連結」，傳到那臺裝置上打開，" +
        "或在那臺裝置的聆聽頁輸入代號。你已經同意過，換裝置不用再同意。";
    } else {
      $("next-text").textContent = (fresh ? "" : "這臺裝置之前拿過這個代號。") +
        "請打開你的工作清單：上面有四個步驟的連結，照順序做，最後回答幾個問題。代號已經放在連結裡。" +
        "可以把工作清單加入書籤，下次從那裡繼續。";
      link.textContent = "打開撰稿人工作清單";
      $("move-text").textContent = "撰寫頁和審閱頁請用電腦的瀏覽器。現在用的是手機的話，請按「複製下一步的連結」，" +
        "傳到電腦上打開。你已經同意過，換裝置不用再同意。";
    }
    if (!fresh) showConsentReceipt(cur.code, cur);
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
    pending = null;
    gen += 1;
    retryBtn.hidden = true;
    sendStatus.textContent = "";
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

  // --- Send the consent record ------------------------------------------------------
  var sendStatus = $("send-status");
  var retryBtn = $("consent-retry");
  var pending = null; // {body} still to send; holds the name only in memory, for 再送一次
  var gen = 0;        // bumped for every new person, so a late answer for the previous one is ignored
  function receiptKey(code) { return GC.receiptKey("consent", code); }
  function licencePendingKey(code) { return "gc-licence-pending:" + code; } // a flag, never the name
  function errText(r) {
    return GC.sendErrorText(r).replace(/請改用下面的方法傳給 Ted/g, "請過幾分鐘再試").replace(/，或改用下面的方法傳給 Ted/g, "");
  }
  function licenceLink(code) {
    var a = document.createElement("a");
    a.setAttribute("href", "consent.html#code=" + encodeURIComponent(code));
    a.textContent = "同意書頁（代號已經帶入）";
    return a;
  }
  // After a reload: say whether the consent record reached Ted, and offer to send it again if not.
  function showConsentReceipt(code, cur) {
    var r = GC.store.get(receiptKey(code));
    if (r && r.id) {
      sendStatus.classList.remove("err");
      sendStatus.textContent = "同意紀錄已經送給 Ted：" + GC.receiptText(r) + "不用再同意。";
      return;
    }
    var rec = GC.consentFor(code, cur && cur.token);
    if (!rec) return;
    pending = { body: GC.envelope("consent", code, "join v4",
      { format: "gapcaster-consent/1", page_version: "v4", route: "open", role: cur.role }, rec) };
    sendStatus.classList.add("err");
    sendStatus.textContent = "";
    sendStatus.appendChild(document.createTextNode("同意紀錄還沒送到 Ted。請按「再送一次同意紀錄」。"));
    if (GC.store.get(licencePendingKey(code))) {
      sendStatus.appendChild(document.createTextNode("你的本名和授權聲明也還沒送到：請打開"));
      sendStatus.appendChild(licenceLink(code));
      sendStatus.appendChild(document.createTextNode("，重新打上本名、勾選授權聲明，按「同意並送出」。送到以前，你的文字只用來計算數字。"));
    }
    retryBtn.hidden = false;
  }
  function sendConsent() {
    if (!pending) return;
    retryBtn.hidden = true;
    GC.announce(sendStatus, "正在送出同意紀錄，最多等 15 秒。");
    var body = pending.body;
    var mine = gen;
    GC.send(body).then(function (r) {
      if (mine !== gen) return;
      if (r.ok) {
        pending = null;
        GC.store.set(receiptKey(body.code), { id: r.id, received_at: r.received_at });
        if (body.payload && body.payload.licence) GC.store.remove(licencePendingKey(body.code));
        sendStatus.classList.remove("err");
        GC.announce(sendStatus, "同意紀錄已經送給 Ted：" + GC.receiptText(r) + "不用再同意。");
        return;
      }
      sendStatus.classList.add("err");
      var named = body.payload && body.payload.licence;
      GC.announce(sendStatus, "同意紀錄還沒送到 Ted：" + errText(r) +
        (named ? "你的本名和授權聲明要送到以後才算數；請按「再送一次同意紀錄」。還是不行的話，過一陣子到同意書頁（填上你的代號）再按一次「同意並送出」；一直不行，請寫信告訴 Ted 發生了什麼事。"
               : "不用擔心：你在這臺裝置的其他頁按「送出」時，同意紀錄會跟著作答一起送出。也可以按「再送一次同意紀錄」。"));
      retryBtn.hidden = false;
    });
  }
  retryBtn.addEventListener("click", function (ev) { ev.preventDefault(); sendConsent(); });

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
      if (licenceWanted() && !GC.oneLine($("j-name").value)) {
        GC.announce(statusEl, "你選了「願意」：請打上你的本名。不想提供本名的話，請改選「不願意」。");
        $("j-name").focus();
        return false;
      }
      if (licenceWanted() && !$("j-lic-ok").checked) {
        GC.announce(statusEl, "你選了「願意」：請勾選同意第 7 節的授權聲明。");
        $("j-lic-ok").focus();
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
    GC.rememberConsent(code, consent);
    GC.store.set(CURRENT_KEY, cur);
    if (licenceWanted()) GC.store.set(licencePendingKey(code), 1);
    statusEl.textContent = "";
    var payload = { format: "gapcaster-consent/1", page_version: "v4", route: "open", role: role };
    if (licenceWanted()) {
      payload.licence = { statement: "試用同意書 v4 第 7 節授權聲明", agreed: true, name: GC.oneLine($("j-name").value).slice(0, 60) };
    }
    gen += 1;
    pending = { body: GC.envelope("consent", code, "join v4", payload, consent) };
    $("j-name").value = "";
    showResult(cur, true);
    sendConsent();
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
