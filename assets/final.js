/* Describers' final questions (final.html): autosave, reply text, and the 送出 button.
 * Answers leave the page only when the describer presses 送出回答 (GC.send in common.js, to the
 * trial inbox, kind "writer-final"), or when they copy the reply text themselves.
 *
 * URL (hash preferred, it never reaches the server):
 *   final.html#code=W03&round=1                          invited
 *   final.html#code=OW-7K3QX&round=1&row=2&mode=open     open route (from kit.html)
 * row is the counterbalancing row (1-4) the describer followed; it is recorded when known. For an open
 * code it follows from the code itself (GC.rowForCode).
 */
(function () {
  "use strict";
  var GC = window.GC;
  var PAGE_VERSION = "v3";

  GC.watchHash(["code"]);

  var params = GC.readParams();
  var code = GC.cleanCode(params.code);
  // A link with a code of the wrong form is treated like no code: the setup form asks for it.
  var badLinkCode = !!code && !GC.validCode(code);
  if (badLinkCode) code = "";
  var isOpen = GC.isOpenCode(code);
  var row = /^[1-4]$/.test(params.row || "") ? Number(params.row) : null;
  if (isOpen) row = GC.rowForCode(code);

  var main = document.getElementById("main");
  var who = document.getElementById("who");
  var statusEl = document.getElementById("status");
  var out = document.getElementById("reply-out");
  var unansweredEl = document.getElementById("unanswered");
  var storagePrefix = "gc-final-" + PAGE_VERSION + ":";
  var storageKey = storagePrefix + (code || "_");

  function each(selector, fn, root) {
    Array.prototype.forEach.call((root || document).querySelectorAll(selector), fn);
  }

  // --- Setup ------------------------------------------------------------------
  var setup = document.getElementById("setup");
  if (!code) setup.hidden = false;
  document.getElementById("setup-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = document.getElementById("in-code");
    var c = GC.cleanCode(input.value);
    if (!GC.validCode(c)) {
      input.setAttribute("aria-invalid", "true");
      GC.announce(document.getElementById("send-status"), GC.CODE_HELP);
      input.focus();
      return;
    }
    // Answers given before the code was entered move to the code's own storage.
    GC.moveDraft(storagePrefix, c);
    GC.goToHash("code=" + encodeURIComponent(c) + "&round=1" + (GC.isOpenCode(c) ? "&mode=open" : ""));
  });

  // Row: from the link, else what the kit page chose on this device.
  if (!row && code) {
    var stored = GC.store.get("gc-row:" + code);
    if (stored && /^[1-4]$/.test(String(stored))) row = Number(stored);
  }

  // --- Fields ----------------------------------------------------------------
  function answerFields() { return main.querySelectorAll("[data-line]"); }

  function valueOf(el) {
    if (el.tagName === "FIELDSET") {
      var checked = el.querySelector("input:checked");
      return checked ? checked.value : "";
    }
    return GC.oneLine(el.value);
  }

  function save() {
    var data = { radios: {}, texts: {} };
    each("[data-line]", function (el) {
      if (el.tagName === "FIELDSET") {
        var checked = el.querySelector("input:checked");
        if (checked) data.radios[checked.name] = checked.value;
      } else if (el.value) {
        data.texts[el.id] = el.value;
      }
    }, main);
    GC.store.set(storageKey, data);
  }

  function restore() {
    var data = GC.store.get(storageKey);
    if (!data) return false;
    var any = false;
    Object.keys(data.radios || {}).forEach(function (name) {
      each("input[type=radio]", function (r) {
        if (r.name === name && r.value === data.radios[name]) { r.checked = true; any = true; }
      }, main);
    });
    Object.keys(data.texts || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.getAttribute("data-line")) { el.value = data.texts[id]; any = true; }
    });
    return any;
  }

  // Reply text (same lines as the e-mail format in questions.md) and the structured answers.
  function build() {
    var lineOrder = [];
    var byLine = {};
    var missing = 0;
    var answers = {};
    Array.prototype.forEach.call(answerFields(), function (el) {
      if (el.closest("[hidden]")) return;
      var line = el.getAttribute("data-line");
      var key = el.getAttribute("data-key") || "";
      var val = valueOf(el);
      if (!val && line !== "備註") missing++;
      if (!byLine.hasOwnProperty(line)) { byLine[line] = []; lineOrder.push(line); }
      byLine[line].push(key ? key + (val || "-") : (val || "-"));
      var path = el.getAttribute("data-field");
      if (path) {
        var parts = path.split(".");
        var obj = answers;
        for (var i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        var v = el.tagName === "FIELDSET" ? val : (el.value || "");
        obj[parts[parts.length - 1]] = v === "" ? null : (/^[1-5]$/.test(v) ? Number(v) : v);
      }
    });
    var head = [
      "GapCaster 撰稿人問題 " + PAGE_VERSION,
      "代號 " + (code || "未填") + "｜列 " + (row || "-") + "｜" + GC.localDate()
    ];
    // Open codes: the consent record travels with the reply text too (e-mail fallback).
    var consentLine = GC.consentLine(code, params.consent);
    if (consentLine) head.push(consentLine);
    var body = lineOrder.map(function (line) { return line + " " + byLine[line].join(" "); });
    body.push("未答 " + missing + " 題");
    return { text: head.concat(body).join("\n"), missing: missing, answers: answers };
  }

  function update() {
    var r = build();
    out.value = r.text;
    unansweredEl.textContent = r.missing > 0
      ? "目前有 " + r.missing + " 題沒有回答。每一題都可以不答，沒答完也可以送出。"
      : "所有題目都回答了。";
    return r;
  }

  main.addEventListener("change", function (ev) {
    if (ev.target.closest("#setup")) return;
    save(); update();
  });
  main.addEventListener("input", function (ev) {
    if (ev.target.closest("#setup")) return;
    save(); update();
  });

  // --- Send ---------------------------------------------------------------------
  var sendBtn = document.getElementById("send");
  var gate = GC.consentGate({ before: sendBtn.parentNode, root: "" });
  var needConsent = gate.update(code, params.consent);
  GC.sendButton({
    button: sendBtn,
    status: document.getElementById("send-status"),
    receipt: document.getElementById("send-receipt"),
    help: document.getElementById("send-help"),
    key: function () { return code ? GC.receiptKey("writer-final", code) : ""; },
    build: function () {
      if (!code) {
        return { error: "還沒有代號，沒辦法送出。請先在頁面上方輸入代號；已經填的回答會保留。",
          focus: document.getElementById("in-code") };
      }
      var g = gate.check(code, params.consent);
      if (g) return g;
      save();
      var r = update();
      // Open route: a describer who does not answer the experience question is left out of the
      // describer analysis (eval-protocol.md, Amendment 2).
      if (isOpen && !r.answers.trained) {
        if (!window.confirm("撰稿經驗那一題還沒回答。公開參加的撰稿人沒有回答這一題，作答不算進撰稿人的結果。\n" +
            "按「確定」：不回答，照樣送出。\n按「取消」：先不送出，回去回答這一題。")) {
          return { error: "還沒送出。請回答撰稿經驗那一題，再按「送出回答」。",
            focus: document.getElementById("q-w-trained-1") };
        }
      }
      var payload = {
        format: "gapcaster-writer-final/1",
        page_version: PAGE_VERSION,
        row: row,
        answers: r.answers,
        unanswered: r.missing,
        reply_text: r.text
      };
      var consent = GC.consentFor(code, params.consent);
      return { body: GC.envelope("writer-final", code, "final " + PAGE_VERSION, payload, consent) };
    }
  });

  // --- Copy / clear -------------------------------------------------------------
  document.getElementById("copy").addEventListener("click", function () {
    var r = update();
    GC.copyText(r.text, out).then(function (ok) {
      if (ok) {
        GC.announce(statusEl, "已複製回覆文字。現在可以打開 email，貼上並寄給 Ted。");
      } else {
        GC.announce(statusEl, "沒有複製成功。請到下面的「回覆文字」文字框，自己全選後複製。");
        out.focus();
      }
    });
  });

  document.getElementById("clear").addEventListener("click", function () {
    if (!window.confirm("確定要清除這臺裝置上的回答嗎？清除後無法復原。已經送出的回答不受影響。")) return;
    GC.store.remove(storageKey);
    each("[data-line] input[type=radio]", function (r) { r.checked = false; }, main);
    each("textarea[data-line]", function (t) { t.value = ""; }, main);
    update();
    GC.announce(statusEl, "已清除這臺裝置上的回答。");
  });

  // --- Init -------------------------------------------------------------------
  var restored = restore();
  if (code) {
    var parts = ["你的代號：" + code + "。"];
    if (isOpen) parts.push("你是公開參加（沒有酬勞）。");
    if (needConsent) parts.push("這臺裝置上沒有你的同意紀錄；已經按過「同意並送出」的話不用理會，說明在送出按鈕上方。");
    if (restored) parts.push("已恢復這臺裝置上之前的回答。");
    who.textContent = parts.join("");
  } else if (badLinkCode) {
    who.textContent = "連結裡的代號用不了。" + GC.CODE_HELP + "請在下面重新輸入代號。";
  }
  update();
})();
