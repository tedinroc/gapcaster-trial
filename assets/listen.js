/* Listener page logic: code from the URL, autosave, result code, and the 送出 button.
 * Answers leave the page only when the participant presses 送出作答 (GC.send in common.js, to the
 * trial inbox), or when they copy or share the result code themselves.
 *
 * URL (hash preferred, it never reaches the server):
 *   listen.html#code=L07&round=1                         invited (code from Ted)
 *   listen.html#code=OL-7K3QX&round=1&mode=open          open route (code made by join.html)
 *
 * One trial round only (25-29 November 2026). Links still carry round=1; the page never asks for
 * a round and ignores any other value. Every clip plays the public files in media/: the version
 * without audio description, then the raw draft with it. The route (invited or open) follows from
 * the code: OL-/OW- codes are open.
 */
(function () {
  "use strict";
  var GC = window.GC;
  // v3: vision-status line first (視力), 送出 button, structured payload. v2: one round, no round
  // field, per-clip exposure line (B先前, A先前).
  var PAGE_VERSION = "v3";
  // Change this whenever the public audio files in media/ are replaced, so each result code
  // records which set of recordings the listener heard.
  var MEDIA_VERSION = "m1";

  // A different personal link opened in this tab must not reuse this participant's answers.
  GC.watchHash(["code"]);

  var params = GC.readParams();
  var code = GC.cleanCode(params.code);
  // A link with a code of the wrong form is treated like no code: the setup form asks for it.
  var badLinkCode = !!code && !GC.validCode(code);
  if (badLinkCode) code = "";
  var isOpen = GC.isOpenCode(code);

  var main = document.getElementById("main");
  var who = document.getElementById("who");
  var statusEl = document.getElementById("status");
  var out = document.getElementById("code-out");
  var unansweredEl = document.getElementById("unanswered");
  var storagePrefix = "gc-listen-" + PAGE_VERSION + ":";
  var storageKey = storagePrefix + (code || "_");

  function each(selector, fn, root) {
    Array.prototype.forEach.call((root || document).querySelectorAll(selector), fn);
  }

  // --- Who / setup ------------------------------------------------------------
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

  // --- Fields ----------------------------------------------------------------
  function answerFields() {
    return main.querySelectorAll("[data-line]");
  }

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

  // --- Result code and payload -------------------------------------------------
  function build() {
    var lineOrder = [];
    var byLine = {};
    var missing = 0;
    var answers = {};
    Array.prototype.forEach.call(answerFields(), function (el) {
      if (el.closest("[hidden]")) return; // e.g. the setup form
      var line = el.getAttribute("data-line");
      var key = el.getAttribute("data-key") || "";
      var val = valueOf(el);
      if (!val && line !== "備註") missing++;
      if (!byLine.hasOwnProperty(line)) { byLine[line] = []; lineOrder.push(line); }
      byLine[line].push(key ? key + (val || "-") : (val || "-"));
      // Structured copy for the inbox: data-field is a dotted path such as "B.ad.content".
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
      "GapCaster 聆聽結果 " + PAGE_VERSION,
      "代號 " + (code || "未填") + "｜素材 " + MEDIA_VERSION + "｜" + GC.localDate()
    ];
    // Open codes: the consent record travels with the result code too (e-mail fallback).
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
    save();
    update();
  });
  main.addEventListener("input", function (ev) {
    if (ev.target.closest("#setup")) return;
    save();
    update();
  });

  // --- Send ---------------------------------------------------------------------
  var sendStatus = document.getElementById("send-status");
  var sendBtn = document.getElementById("send");
  var gate = GC.consentGate({ before: sendBtn.parentNode, root: "" });
  var needConsent = gate.update(code, params.consent);
  GC.sendButton({
    button: sendBtn,
    status: sendStatus,
    receipt: document.getElementById("send-receipt"),
    help: document.getElementById("send-help"),
    key: function () { return code ? GC.receiptKey("listen", code) : ""; },
    build: function () {
      if (!code) {
        var input = document.getElementById("in-code");
        return { error: "還沒有代號，沒辦法送出。請先在頁面上方輸入代號；已經填的作答會保留。", focus: input };
      }
      var g = gate.check(code, params.consent);
      if (g) return g;
      save();
      var r = update();
      // Open route: an unanswered vision question counts as 不想說 (eval-protocol.md, Amendment 2).
      if (isOpen && !r.answers.vision) {
        if (!window.confirm("視力狀況那一題還沒回答。沒有回答會當作「不想說」，作答不算進聽眾的結果。\n" +
            "按「確定」：不回答，照樣送出。\n按「取消」：先不送出，回去回答這一題。")) {
          return { error: "還沒送出。請回答最前面的視力狀況那一題，再按「送出作答」。",
            focus: document.getElementById("q-vision-1") };
        }
      }
      var payload = {
        format: "gapcaster-listen/1",
        page_version: PAGE_VERSION,
        media_version: MEDIA_VERSION,
        answers: r.answers,
        unanswered: r.missing,
        result_text: r.text
      };
      var consent = GC.consentFor(code, params.consent);
      return { body: GC.envelope("listen", code, "listen " + PAGE_VERSION, payload, consent) };
    }
  });

  // --- Copy / share / clear ---------------------------------------------------
  document.getElementById("copy").addEventListener("click", function () {
    var r = update();
    var extra = r.missing > 0 ? "有 " + r.missing + " 題沒有回答，沒關係。" : "";
    GC.copyText(r.text, out).then(function (ok) {
      if (ok) {
        GC.announce(statusEl, "已複製結果碼。" + extra + "現在可以打開 email，貼上並寄給 Ted（受邀參加的人也可以用 LINE）。");
      } else {
        GC.announce(statusEl, "沒有複製成功。請到下面的「結果碼」文字框，自己全選後複製。");
        out.focus();
      }
    });
  });

  var shareBtn = document.getElementById("share");
  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener("click", function () {
      var r = update();
      navigator.share({ title: "GapCaster 聆聽結果", text: r.text }).then(function () {
        GC.announce(statusEl, "已送到你選的 app。請在那裡確認後再傳給 Ted。");
      }, function (err) {
        if (err && err.name === "AbortError") return;
        GC.announce(statusEl, "無法分享，請改用「複製結果碼」。");
      });
    });
  }

  document.getElementById("clear").addEventListener("click", function () {
    if (!window.confirm("確定要清除這臺裝置上的作答嗎？清除後無法復原。已經送出的作答不受影響。")) return;
    GC.store.remove(storageKey);
    each("[data-line] input[type=radio]", function (r) { r.checked = false; }, main);
    each("input[type=text][data-line], textarea[data-line]", function (t) { t.value = ""; }, main);
    update();
    GC.announce(statusEl, "已清除這臺裝置上的作答。");
  });

  // --- Init -------------------------------------------------------------------
  var restored = restore();
  if (code) {
    var parts = ["你的代號：" + code + "。"];
    if (isOpen) parts.push("你是公開參加（沒有酬勞）。請記下這個代號：要刪除資料時告訴 Ted。");
    if (needConsent) parts.push("這臺裝置上沒有你的同意紀錄；已經按過「同意並送出」的話不用理會，說明在送出按鈕上方。");
    if (restored) parts.push("已恢復這臺裝置上之前的作答。");
    who.textContent = parts.join("");
  } else if (badLinkCode) {
    who.textContent = "連結裡的代號用不了。" + GC.CODE_HELP + "請在下面重新輸入代號。";
  }
  update();
})();
