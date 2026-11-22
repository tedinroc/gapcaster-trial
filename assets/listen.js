/* Listener page logic: code from the URL, autosave, result code.
 * Nothing is sent anywhere. The result code is copied or shared by the participant.
 *
 * URL (hash preferred, it never reaches the server):
 *   listen.html#code=L07&round=1
 *
 * One trial round only (25-29 November 2026). Links still carry round=1; the page never asks for
 * a round and ignores any other value. Every clip plays the public files in media/: the version
 * without audio description, then the raw draft with it.
 */
(function () {
  "use strict";
  var GC = window.GC;
  // v2: one round, no round field, and the per-clip exposure line (B先前, A先前).
  var PAGE_VERSION = "v2";
  // Change this whenever the public audio files in media/ are replaced, so each result code
  // records which set of recordings the listener heard.
  var MEDIA_VERSION = "m1";

  // A different personal link opened in this tab must not reuse this participant's answers.
  GC.watchHash(["code"]);

  var params = GC.readParams();
  var code = GC.cleanCode(params.code);

  var main = document.getElementById("main");
  var who = document.getElementById("who");
  var statusEl = document.getElementById("status");
  var out = document.getElementById("code-out");
  var unansweredEl = document.getElementById("unanswered");
  var storageKey = "gc-listen-" + PAGE_VERSION + ":" + (code || "_");

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
    if (!c) {
      input.setAttribute("aria-invalid", "true");
      GC.announce(statusEl, "請先輸入代號。");
      input.focus();
      return;
    }
    GC.goToHash("code=" + encodeURIComponent(c) + "&round=1");
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

  // --- Result code ------------------------------------------------------------
  function build() {
    var lineOrder = [];
    var byLine = {};
    var missing = 0;
    Array.prototype.forEach.call(answerFields(), function (el) {
      if (el.closest("[hidden]")) return; // e.g. the setup form
      var line = el.getAttribute("data-line");
      var key = el.getAttribute("data-key") || "";
      var val = valueOf(el);
      if (!val && line !== "備註") missing++;
      if (!byLine.hasOwnProperty(line)) { byLine[line] = []; lineOrder.push(line); }
      byLine[line].push(key ? key + (val || "-") : (val || "-"));
    });
    var head = [
      "GapCaster 聆聽結果 " + PAGE_VERSION,
      "代號 " + (code || "未填") + "｜素材 " + MEDIA_VERSION + "｜" + GC.localDate()
    ];
    var body = lineOrder.map(function (line) { return line + " " + byLine[line].join(" "); });
    body.push("未答 " + missing + " 題");
    return { text: head.concat(body).join("\n"), missing: missing };
  }

  function update() {
    var r = build();
    out.value = r.text;
    unansweredEl.textContent = r.missing > 0
      ? "目前有 " + r.missing + " 題沒有回答。每一題都可以不答。"
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

  // --- Copy / share / clear ---------------------------------------------------
  document.getElementById("copy").addEventListener("click", function () {
    var r = update();
    var extra = r.missing > 0 ? "有 " + r.missing + " 題沒有回答，沒關係。" : "";
    GC.copyText(r.text, out).then(function (ok) {
      if (ok) {
        GC.announce(statusEl, "已複製結果碼。" + extra + "現在可以打開 LINE 或 email，貼上並傳給 Ted。");
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
    if (!window.confirm("確定要清除這臺裝置上的作答嗎？清除後無法復原。")) return;
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
    if (restored) parts.push("已恢復這臺裝置上之前的作答。");
    who.textContent = parts.join("");
  }
  update();
})();
