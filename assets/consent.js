/* Consent reply generator. Builds a short text the participant copies into email or LINE.
 * Nothing is sent anywhere.
 * Optional URL hash: consent.html#code=W03&round=1 (one trial round only; round is ignored)
 *
 * The reply has the same lines, in the same order, as the plain-text template in consent.md
 * section 12. A describer who answers "可以放進作品" (option A) and "願意" (option A-1: sign
 * with their legal name if the organizer asks) gets the licence statement from consent.md
 * section 7 appended; it is read from the page (pre#tpl-licence), so the two can never
 * differ. The page never asks for the legal name: the describer types it into the message.
 * Option A-1 has no default. There is no round question: the trial has one round, and describers'
 * edited text is never voiced for listeners, so nothing asks for that permission either.
 */
(function () {
  "use strict";
  var GC = window.GC;
  var CONSENT_VERSION = "v2";
  var CODE_SLOT = "（代號）";
  var NAME_LINE = "本名：（請在這裡打上你的本名再傳出）";

  // Another personal link opened in this tab must start from that link's code.
  GC.watchHash(["code"]);

  var $ = function (id) { return document.getElementById(id); };
  var codeIn = $("c-code");
  var agree = $("c-agree");
  var out = $("c-out");
  var statusEl = $("c-status");
  var licenceEl = $("tpl-licence");

  function checked(name) {
    var el = document.querySelector("input[name='" + name + "']:checked");
    return el ? el.value : "";
  }

  // Prefill from the URL.
  var params = GC.readParams();
  var code = GC.cleanCode(params.code);
  if (code) {
    codeIn.value = code;
    if (code.charAt(0) === "W") $("c-role-w").checked = true;
    if (code.charAt(0) === "L") $("c-role-l").checked = true;
  }

  function sync() {
    var writer = checked("c-role") === "撰稿人";
    $("c-writer").hidden = !writer;
    var useText = writer && checked("c-text") === "可以";
    $("c-ccby-wrap").hidden = !useText;
    $("c-licence-wrap").hidden = !(useText && checked("c-sign") === "願意");
  }

  function licenceText(c) {
    if (!licenceEl) return "";
    return licenceEl.textContent.replace(CODE_SLOT, c || "未填");
  }

  function build() {
    var role = checked("c-role");
    var c = GC.cleanCode(codeIn.value);
    var lines = [
      "GapCaster 試用同意書 " + CONSENT_VERSION + " 回覆",
      "代號：" + (c || "未填") + "｜" + (role || "身分未選"),
      agree.checked ? "我已看完同意書，年滿 18 歲，同意參加。" : "（還沒勾選同意）"
    ];
    var text = "", sign = "";
    if (role === "撰稿人") {
      text = checked("c-text");
      lines.push("文字放進作品：" + (text || "未選"));
      if (text === "可以") {
        sign = checked("c-sign");
        lines.push("主辦單位要求時願意以本名簽署：" + (sign || "未選"));
        if (sign === "願意") lines.push("CC BY 4.0：" + (checked("c-ccby") || "未選"));
      }
    }
    lines.push("日期：" + GC.localDate());
    if (role === "撰稿人" && text === "可以" && sign === "願意") {
      lines.push("");
      lines.push(licenceText(c));
      lines.push(NAME_LINE);
    }
    return lines.join("\n");
  }

  function update() {
    sync();
    out.value = build();
  }

  document.getElementById("main").addEventListener("change", update);
  codeIn.addEventListener("input", update);

  // Same order as the form: role, agreement, then the describer's options A and A-1.
  function ready() {
    if (!checked("c-role")) {
      GC.announce(statusEl, "請先選擇你的身分：聽眾或撰稿人。");
      $("c-role-l").focus();
      return false;
    }
    if (!agree.checked) {
      GC.announce(statusEl, "請先勾選「我已看完同意書，年滿 18 歲，同意參加」。");
      agree.focus();
      return false;
    }
    if (checked("c-role") === "撰稿人" && !checked("c-text")) {
      GC.announce(statusEl, "請先回答選項 A：你的文字可以放進參賽作品嗎？");
      $("c-text-yes").focus();
      return false;
    }
    if (checked("c-role") === "撰稿人" && checked("c-text") === "可以" && !checked("c-sign")) {
      GC.announce(statusEl, "請先回答選項 A-1：主辦單位要求時，你願意提供本名並簽署嗎？");
      $("c-sign-yes").focus();
      return false;
    }
    return true;
  }

  $("c-copy").addEventListener("click", function () {
    update();
    if (!ready()) return;
    GC.copyText(out.value, out).then(function (ok) {
      GC.announce(statusEl, ok
        ? "已複製同意回覆。現在可以打開 LINE 或 email，貼上並傳給 Ted。"
        : "沒有複製成功。請到下面的「同意回覆」文字框，自己全選後複製。");
      if (!ok) out.focus();
    });
  });

  var shareBtn = $("c-share");
  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener("click", function () {
      update();
      if (!ready()) return;
      navigator.share({ title: "GapCaster 試用同意回覆", text: out.value }).then(function () {
        GC.announce(statusEl, "已送到你選的 app。請在那裡確認後再傳給 Ted。");
      }, function (err) {
        if (err && err.name === "AbortError") return;
        GC.announce(statusEl, "無法分享，請改用「複製同意回覆」。");
      });
    });
  }

  update();
})();
