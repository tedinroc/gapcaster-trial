/* Consent v4, given once and online (consent.html).
 *
 * An invited participant opens Ted's personal link (consent.html#code=W05-K7QXM), ticks the items,
 * answers the describer options of section 7 and presses 同意並送出. The page sends the consent record
 * to the trial inbox (kind "consent"; the CSP allows the inbox origin only) and shows the receipt and
 * the next link. That is the whole consent: no reply by e-mail or LINE, and no page asks again, on any
 * device. An open participant agrees on join.html instead; an open code typed here gets the same form
 * with the open items, for the rare case where join.html could not send.
 *
 * A describer who answers 可以放進作品 (option A) and 願意 (option A-1) types their legal name and ticks
 * the licence statement of section 7 (shown on this page, pre#tpl-licence). The name goes only into
 * this one submission (payload.licence.name): never into storage, links, later submissions or the
 * consent record that the other pages carry.
 *
 * There is no other way to agree (no e-mail, LINE, text message, call or paper): if sending fails,
 * the person presses 同意並送出 again later (consent.md section 12).
 */
(function () {
  "use strict";
  var GC = window.GC;

  // Another personal link opened in this tab must start from that link's code.
  GC.watchHash(["code"]);

  var $ = function (id) { return document.getElementById(id); };
  var codeIn = $("c-code");
  var nextBox = $("c-next");

  function checked(name) {
    var el = document.querySelector("input[name='" + name + "']:checked");
    return el ? el.value : "";
  }
  function code() { return GC.cleanCode(codeIn.value); }

  // Prefill from the URL.
  var params = GC.readParams();
  var start = GC.cleanCode(params.code);
  if (start) codeIn.value = start;
  function roleFromCode(c) {
    if (/^(T?OW|W)/.test(c)) return "撰稿人";
    if (/^(T?OL|L)/.test(c)) return "聽眾";
    return "";
  }

  function sync() {
    var c = code();
    var r = roleFromCode(c);
    if (r) {
      $(r === "撰稿人" ? "c-role-w" : "c-role-l").checked = true;
    }
    var writer = checked("c-role") === "撰稿人";
    $("c-writer").hidden = !writer;
    var useText = writer && checked("c-text") === "可以";
    $("c-sign-wrap").hidden = !useText;
    $("c-licence-wrap").hidden = !(useText && checked("c-sign") === "願意");
    $("c-open-item").hidden = !GC.isOpenCode(c);
    sender.showReceipt();
    showDoneIfAny(c);
  }
  // Coming back after agreeing: show the next link again (from the token kept with the record), and
  // say that nothing more is needed. Pressing again only replaces the earlier answers.
  function showDoneIfAny(c) {
    var tok = GC.validCode(c) ? GC.store.get("gc-consent-token:" + c) : null;
    if (tok && GC.consentFor(c, tok) && GC.store.get(GC.receiptKey("consent", c))) {
      showNext(c, tok);
      $("c-done").hidden = false;
    } else {
      $("c-done").hidden = true;
    }
  }
  function licenceWanted() {
    return checked("c-role") === "撰稿人" && checked("c-text") === "可以" && checked("c-sign") === "願意";
  }

  // The describer's row (1-4): an open code's comes from the code; an invited describer's from the
  // number Ted gave (W01 row 1, W02 row 2, ... W05 row 1), as in START-TRIALS.md 0.3.
  function rowOf(c) {
    if (GC.isOpenCode(c)) return GC.rowForCode(c);
    var m = /^W(\d{2})/.exec(c);
    return m ? ((Number(m[1]) - 1) % 4) + 1 : null;
  }

  // Items ticked, in the order of GC.consentItems(code).
  function ticked(c) {
    var boxes = [["c-a1", "年滿 18 歲"], ["c-a2", "讀過試用同意書 v4"], ["c-a3", "同意參加"]];
    if (GC.isOpenCode(c)) boxes.push(["c-a4", "了解公開參加沒有酬勞"]);
    boxes.push(["c-a5", "不在作答裡寫姓名或聯絡方式"]);
    for (var i = 0; i < boxes.length; i++) {
      var el = $(boxes[i][0]);
      if (!el.checked) {
        var label = document.querySelector("label[for='" + boxes[i][0] + "']");
        return { missing: el, text: label ? label.textContent.trim() : boxes[i][1] };
      }
    }
    return null;
  }

  function choices() {
    var a = checked("c-text") === "可以" ? "Y" : checked("c-text") === "不要" ? "N" : "";
    var a1 = a === "Y" ? (checked("c-sign") === "願意" ? "Y" : checked("c-sign") === "不願意" ? "N" : "") : "";
    var b = a === "Y" && a1 === "Y" ? (checked("c-ccby") === "要" ? "Y" : checked("c-ccby") === "不要" ? "N" : "") : "";
    return { a: a, a1: a1, b: b };
  }

  // Same order as the form. Returns null, or {error, focus}.
  function problem(c) {
    if (!c) return { error: "請先填你的代號（Ted 傳給你的連結裡已經有；例如 W03-K7QXM）。", focus: codeIn };
    if (!GC.validCode(c)) return { error: GC.CODE_HELP, focus: codeIn };
    if (!checked("c-role")) return { error: "請先選擇你的身分：聽眾或撰稿人。", focus: $("c-role-l") };
    var miss = ticked(c);
    if (miss) return { error: "還有一項沒有勾：" + miss.text + "每一項都要勾，才能送出。", focus: miss.missing };
    if (checked("c-role") === "撰稿人") {
      if (!checked("c-text")) return { error: "請先回答選項 A：你的文字可以放進參賽作品嗎？", focus: $("c-text-yes") };
      if (checked("c-text") === "可以" && !checked("c-sign")) {
        return { error: "請先回答選項 A-1：主辦單位要求時，你願意提供本名並簽署嗎？", focus: $("c-sign-yes") };
      }
      if (licenceWanted() && !GC.oneLine($("c-name").value)) {
        return { error: "你選了「願意」：請打上你的本名。不想提供本名的話，請改選「不願意」。", focus: $("c-name") };
      }
      if (licenceWanted() && !$("c-lic-ok").checked) {
        return { error: "你選了「願意」：請勾選同意上面的授權聲明。", focus: $("c-lic-ok") };
      }
    }
    return null;
  }

  // The record and token being sent (without the name), kept until the inbox answers.
  var lastSent = null;

  function nextHref(c, token) {
    var t = "&consent=" + encodeURIComponent(token);
    var mode = GC.isOpenCode(c) ? "&mode=open" : "";
    if (checked("c-role") === "聽眾") return "listen.html#code=" + encodeURIComponent(c) + "&round=1" + mode + t;
    var row = rowOf(c);
    return "kit.html#code=" + encodeURIComponent(c) + "&round=1" + mode + (row ? "&row=" + row : "") + t;
  }

  function showNext(c, token) {
    var link = $("c-next-link");
    link.setAttribute("href", nextHref(c, token));
    link.textContent = checked("c-role") === "聽眾" ? "開始聆聽（聆聽頁）" : "打開撰稿人工作清單";
    nextBox.hidden = false;
  }

  var sender = GC.sendButton({
    button: $("send"),
    status: $("send-status"),
    receipt: $("c-receipt"),
    help: $("c-fallback-help"),
    key: function () { var c = code(); return GC.validCode(c) ? GC.receiptKey("consent", c) : ""; },
    build: function () {
      sync();
      var c = code();
      var bad = problem(c);
      if (bad) return bad;
      var isTest = /^T/.test(c);
      var now = GC.windowState();
      if (!isTest && now === "before") {
        return { error: "還沒到試用時間：" + GC.WINDOW_TEXT.start + " 起才能按「同意並送出」。到時候再回來這一頁，代號會留在連結裡。", focus: $("send") };
      }
      if (!isTest && now === "after") {
        return { error: "試用已經在 " + GC.WINDOW_TEXT.end + " 結束，不再收同意紀錄。", focus: $("send") };
      }
      var ch = choices();
      var items = GC.consentItems(c);
      var flags = "";
      if (checked("c-role") === "撰稿人") {
        flags = ch.a + (ch.a1 || "-") + (ch.b || "-");
        items.push(GC.CHOICE_TEXT.A[ch.a]);
        if (ch.a1) items.push(GC.CHOICE_TEXT.A1[ch.a1]);
        if (ch.b) items.push(GC.CHOICE_TEXT.B[ch.b]);
      }
      var atMs = Date.now();
      var rec = { version: GC.CONSENT_VERSION, items: items, at: new Date(atMs).toISOString() };
      var payload = { format: "gapcaster-consent/1", page_version: "v4",
        route: GC.isOpenCode(c) ? "open" : "invited", role: checked("c-role") === "撰稿人" ? "writer" : "listener" };
      if (licenceWanted()) {
        payload.licence = { statement: "試用同意書 v4 第 7 節授權聲明", agreed: true, name: GC.oneLine($("c-name").value).slice(0, 60) };
      }
      lastSent = { code: c, rec: rec, token: GC.consentToken(atMs, flags) };
      return { body: GC.envelope("consent", c, "consent v4", payload, rec) };
    },
    onSent: function () {
      if (!lastSent) return;
      GC.rememberConsent(lastSent.code, lastSent.rec);
      GC.store.set("gc-consent-token:" + lastSent.code, lastSent.token);
      $("c-name").value = "";
      showNext(lastSent.code, lastSent.token);
    }
  });

  document.getElementById("main").addEventListener("change", function () { sync(); });
  codeIn.addEventListener("input", function () { sync(); nextBox.hidden = true; });
  sync();
})();
