/* Shared helpers for the GapCaster trial pages.
 *
 * Network: the ONLY network call on this site is GC.send() below. It posts one JSON body to the
 * trial inbox (GC_INBOX) and runs only when the participant presses a button labelled 送出
 * (including 同意並送出 on consent.html and join.html, which sends the consent record).
 * Nothing is sent before that press, nothing is retried on its own, and there are no beacons,
 * analytics or third parties. Pages that do not submit keep connect-src 'none' in their CSP,
 * so even a stray call would be blocked there. Copy, download and e-mail remain as fallbacks.
 */
(function () {
  "use strict";

  // The trial inbox (Cloudflare Pages Functions on Ted's tedinroc account). Keep this the only
  // place the address appears in the site's scripts; tools/check.py enforces that, and the CSP of
  // each submitting page allows exactly this origin.
  var GC_INBOX = "https://gapcaster-trial-inbox.pages.dev/api/submit";

  // The trial window (Taipei time). The inbox enforces it too; these copies only drive messages
  // and the join page. Change both here and in the inbox if the dates ever move.
  var WINDOW = { start: "2026-11-25T00:00:00+08:00", end: "2026-11-29T22:00:00+08:00" };
  var WINDOW_TEXT = {
    start: "2026 年 11 月 25 日（星期三）凌晨 0 點（臺北時間）",
    end: "2026 年 11 月 29 日（星期日）晚上 10 點（臺北時間）"
  };
  var MAX_BYTES = 300000;   // the inbox refuses bodies over 300 KB; stay safely under it
  var TIMEOUT_MS = 15000;

  // Consent v4: everyone agrees once, online. An open participant ticks OPEN_CONSENT_ITEMS on
  // join.html, an invited one INVITED_CONSENT_ITEMS on consent.html; 同意並送出 sends the record
  // {version: "v4", items: [...], at: ISO time} to the inbox (kind "consent"), and every later 送出
  // of that code carries it too when this device has it. Pages never ask again: a code whose record
  // is not on this device only gets a note (consentGate below).
  var CONSENT_VERSION = "v4";
  var OPEN_CONSENT_ITEMS = ["年滿 18 歲", "讀過試用同意書 v4", "同意參加", "了解公開參加沒有酬勞",
    "不在作答裡寫姓名或聯絡方式"];
  var INVITED_CONSENT_ITEMS = ["年滿 18 歲", "讀過試用同意書 v4", "同意參加", "不在作答裡寫姓名或聯絡方式"];
  // Describers' section 7 choices, as flags in the consent token: Y, N, or - (not asked).
  var CHOICE_TEXT = {
    A: { Y: "選項 A：可以放進作品", N: "選項 A：不要放進作品" },
    A1: { Y: "選項 A-1：願意（同意第 7 節授權聲明，以本名簽署）", N: "選項 A-1：不願意" },
    B: { Y: "選項 B：要", N: "選項 B：不要" }
  };

  // Read parameters from the URL hash first (never sent to the server), then the query string.
  function readParams() {
    var out = {};
    var sources = [window.location.search.replace(/^\?/, ""), window.location.hash.replace(/^#/, "")];
    sources.forEach(function (src) {
      if (!src) return;
      src.split("&").forEach(function (pair) {
        if (!pair) return;
        var i = pair.indexOf("=");
        var k, v;
        try {
          k = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, " "));
          v = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
        } catch (e) { return; }
        out[k.toLowerCase()] = v; // hash wins because it is read last
      });
    });
    return out;
  }

  // Participant codes: invited W03 / L07 (optionally with "-" and 5 characters, e.g. W03-K7QXM), tests
  // T01..T99, and, for the open route, OL- / OW- plus 5 characters (TOL- / TOW- in test mode).
  // Keep only safe characters; a code typed without its "-", or with a zero for the letter O, is
  // put back in its usual form (ol7k3qx, 0L-7K3QX -> OL-7K3QX).
  function cleanCode(raw) {
    if (!raw) return "";
    var c = String(raw).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
    var m = /^(T?)[O0]([LW])-?([2-9A-HJKMNP-Z]{5})$/.exec(c);
    if (m) c = m[1] + "O" + m[2] + "-" + m[3];
    return c;
  }
  // Only these forms are sent. Anything else (a name typed in the code field, a typo) is refused on
  // the page, so it never reaches the inbox and the participant is told at once.
  var CODE_RE = /^(?:[WL]\d{2}(?:-[2-9A-HJKMNP-Z]{5})?|T\d{2}|T?O[LW]-[2-9A-HJKMNP-Z]{5})$/;
  function validCode(c) { return CODE_RE.test(c || ""); }
  // Said when a typed code has the wrong form (setup forms and 送出).
  var CODE_HELP = "代號的格式不對。受邀參加的代號是 Ted 給的，W 或 L 開頭；公開參加的代號是參加頁給的，" +
    "OL- 或 OW- 開頭，後面 5 個英文字母或數字。請檢查代號，不要填姓名。";
  // Open-route codes are made by join.html: OL- (listener) or OW- (describer) plus 5 characters.
  // A leading T marks a test code made with join.html#test=1 (always excluded from the analysis).
  function isOpenCode(c) { return /^T?O[LW]-[2-9A-HJKMNP-Z]{5}$/.test(c || ""); }
  function modeOf(c) { return isOpenCode(c) ? "open" : "invited"; }

  // An open describer's counterbalancing row (1-4) is a function of the code's 5 random characters
  // (read as a base-31 number, mod 4, plus 1), so the same code gets the same row on every device.
  // join.html draws codes so that each row has probability exactly 1/4 (newOpenCode below).
  var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  var ROW_LIMIT = 4 * Math.floor(Math.pow(31, 5) / 4); // values at or above this are redrawn
  function codeValue(c) {
    var m = /^T?O[LW]-([2-9A-HJKMNP-Z]{5})$/.exec(c || "");
    if (!m) return -1;
    var v = 0;
    for (var i = 0; i < 5; i++) v = v * 31 + CODE_ALPHABET.indexOf(m[1].charAt(i));
    return v;
  }
  function rowForCode(c) {
    if (!/^T?OW-/.test(c || "")) return null;
    var v = codeValue(c);
    return v < 0 ? null : (v % 4) + 1;
  }

  // localStorage can be missing or throw (private mode, blocked storage). Never let that break the page.
  var store = {
    get: function (key) {
      try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) {
      try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  // Answers typed before a code was entered are saved under "<prefix>_". When the code is entered
  // (the page reloads under "<prefix><CODE>"), move them there, so nothing seems to disappear.
  // Works for the {radios, texts} drafts of listen.html and final.html; the newer answers win.
  function moveDraft(prefix, code) {
    var from = store.get(prefix + "_");
    if (!from) return;
    var to = store.get(prefix + code) || { radios: {}, texts: {} };
    ["radios", "texts"].forEach(function (k) {
      to[k] = to[k] || {};
      Object.keys(from[k] || {}).forEach(function (name) { to[k][name] = from[k][name]; });
    });
    if (store.set(prefix + code, to)) store.remove(prefix + "_");
  }

  // Announce a message through a polite live region. Clearing first and setting after a short
  // delay makes VoiceOver on iOS and NVDA announce repeated messages reliably.
  function announce(el, message) {
    if (!el) return;
    el.textContent = "";
    window.setTimeout(function () { el.textContent = message; }, 150);
  }

  // Copy text to the clipboard. Resolves true on success, false otherwise.
  function copyText(text, fallbackTextarea) {
    function legacy() {
      if (!fallbackTextarea) return false;
      try {
        var wasReadOnly = fallbackTextarea.readOnly;
        fallbackTextarea.readOnly = false;
        fallbackTextarea.focus();
        fallbackTextarea.select();
        fallbackTextarea.setSelectionRange(0, fallbackTextarea.value.length);
        var ok = document.execCommand("copy");
        fallbackTextarea.readOnly = wasReadOnly;
        return !!ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
  }

  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }

  // Local date as YYYY-MM-DD.
  function localDate(d) {
    d = d || new Date(Date.now());
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ISO 8601 with the local UTC offset, e.g. 2026-11-20T14:03:05+08:00. Shown to people only: what
  // is sent uses UTC (toISOString), so it does not reveal the device's time zone.
  function isoLocal(d) {
    d = d || new Date(Date.now());
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    off = Math.abs(off);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
      sign + pad(Math.floor(off / 60)) + ":" + pad(off % 60);
  }

  // A UTC ISO time shown as Taipei time, e.g. "2026-11-26 14:03:05（臺北時間）".
  function taipeiTime(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return String(iso || "");
    var s = new Date(t + 8 * 3600 * 1000).toISOString();
    return s.slice(0, 10) + " " + s.slice(11, 19) + "（臺北時間）";
  }

  // Collapse line breaks so free text stays on one line of the result code.
  function oneLine(s) {
    return String(s || "").replace(/\s*[\r\n]+\s*/g, " / ").trim();
  }

  // "before", "open" or "after" the trial window, by this device's clock.
  function windowState(now) {
    now = typeof now === "number" ? now : Date.now();
    if (now < Date.parse(WINDOW.start)) return "before";
    if (now >= Date.parse(WINDOW.end)) return "after";
    return "open";
  }

  // --- Consent record ---------------------------------------------------------------------
  // join.html and consent.html keep it in this browser and also put a short token in the links they
  // give (#consent=v4.<unix seconds>[.<A><A1><B>]), so it survives blocked storage. The token and the
  // stored record never hold a name: a describer's legal name (option A-1) goes only into the one
  // kind "consent" submission. Times are UTC (toISOString), so nothing sent reveals the time zone.
  function consentItems(code) { return (isOpenCode(code) ? OPEN_CONSENT_ITEMS : INVITED_CONSENT_ITEMS).slice(); }
  function consentToken(atMs, flags) {
    return CONSENT_VERSION + "." + Math.floor(atMs / 1000) + (flags ? "." + flags : "");
  }
  function consentFromToken(tok, code) {
    var m = /^v4\.(\d{9,11})(?:\.([YN])([YN-])([YN-]))?$/.exec(tok || "");
    if (!m || !validCode(code)) return null;
    var items = consentItems(code);
    if (m[2]) {
      items.push(CHOICE_TEXT.A[m[2]]);
      if (m[3] !== "-") items.push(CHOICE_TEXT.A1[m[3]]);
      if (m[4] !== "-") items.push(CHOICE_TEXT.B[m[4]]);
    }
    return { version: CONSENT_VERSION, items: items, at: new Date(Number(m[1]) * 1000).toISOString() };
  }
  var memConsent = {}; // records made on this page, in case storage is blocked
  function rememberConsent(code, rec) {
    memConsent[code] = rec;
    store.set("gc-consent:" + code, rec);
  }
  function consentFor(code, token) {
    if (!validCode(code)) return null;
    if (memConsent[code]) return memConsent[code];
    var c = store.get("gc-consent:" + code);
    if (c && c.version === CONSENT_VERSION && Array.isArray(c.items) && c.at) return c;
    return consentFromToken(token, code);
  }
  // One line for the fallback outputs (result code, reply text), so a result sent by e-mail still
  // carries the consent record: "同意 v4｜<UTC time>｜<ticked items>".
  function consentLine(code, token) {
    if (!validCode(code)) return "";
    var c = consentFor(code, token);
    return c ? "同意 " + c.version + "｜" + c.at + "｜" + c.items.join("、")
      : "同意 這臺裝置上沒有紀錄（已經按過「同意並送出」的話，不用理會）";
  }

  // A note (never a block) next to a 送出 button, for a code whose consent record is not on this
  // device, for example after switching devices. Consent is given once, by 同意並送出 on join.html
  // (open) or consent.html (invited), and that record is already at the inbox, so nobody is asked
  // to agree again: the note only says where to agree if the person never did. Answers are sent
  // either way; only codes with a consent record are used (eval-protocol.md, Amendment 3).
  // opts: before (element the note is put in front of), root ("" or "../../", where consent.html
  // and join.html are), boxClass (the note's class; the review pages have their own style sheet).
  var gateCount = 0;
  function consentGate(opts) {
    var box = null, shownFor = "";
    gateCount += 1;
    var gid = "cg" + gateCount;

    function needs(code, token) { return validCode(code) && !consentFor(code, token); }

    function build(code) {
      box = document.createElement("p");
      box.className = opts.boxClass || "panel";
      box.id = gid;
      var open = isOpenCode(code);
      box.appendChild(document.createTextNode("這臺裝置上沒有代號 " + code + " 的同意紀錄。" +
        (open ? "你在參加頁看到「同意紀錄已經送給 Ted」的話，換了裝置不用再同意。"
              : "已經按過「同意並送出」（在哪臺裝置都可以）的話，不用再做。") +
        "還沒同意過的話，請先到"));
      var a = document.createElement("a");
      a.setAttribute("href", (opts.root || "") + "consent.html#code=" + encodeURIComponent(code));
      a.textContent = "同意書頁";
      box.appendChild(a);
      box.appendChild(document.createTextNode("同意一次；作答要有同意紀錄才會使用。"));
      opts.before.parentNode.insertBefore(box, opts.before);
    }

    // Show the note when this code has no record here, hide it otherwise. Returns true when shown.
    function update(code, token) {
      var need = needs(code, token);
      if (need && (!box || shownFor !== code)) {
        if (box) box.parentNode.removeChild(box);
        build(code);
        shownFor = code;
      }
      if (box) box.hidden = !need;
      return need;
    }

    // At 送出: never stops the send (kept so the pages need no change).
    function check(code, token) {
      update(code, token);
      return null;
    }
    return { update: update, check: check };
  }

  // --- Sending ------------------------------------------------------------------------------
  function utf8Bytes(s) {
    try { return new Blob([s]).size; } catch (e) { return unescape(encodeURIComponent(s)).length; }
  }

  // The request body of the inbox API (v 1). kind: listen, write, review, writer-final or consent.
  // client_time is UTC.
  function envelope(kind, code, page, payload, consent) {
    var body = { v: 1, kind: kind, code: code, mode: modeOf(code), round: 1, page: page,
      client_time: new Date().toISOString(), payload: payload };
    if (consent) body.consent = consent;
    return body;
  }

  // POST one body to the inbox. Resolves (never rejects) to
  //   {ok: true, id, received_at}  or  {ok: false, error, status}
  // error is the inbox's own code (not_open_yet, closed, busy, storage, origin, bad_request, too_large,
  // method, not_found) or one of timeout, network, bad_code, no_fetch, bad_reply, http.
  function send(body) {
    if (!validCode(body && body.code)) return Promise.resolve({ ok: false, error: "bad_code" });
    var text;
    try { text = JSON.stringify(body); } catch (e) { return Promise.resolve({ ok: false, error: "bad_request" }); }
    if (utf8Bytes(text) > MAX_BYTES) return Promise.resolve({ ok: false, error: "too_large" });
    if (typeof window.fetch !== "function") return Promise.resolve({ ok: false, error: "no_fetch" });
    return new Promise(function (resolve) {
      var settled = false;
      var ctrl = typeof window.AbortController === "function" ? new window.AbortController() : null;
      function finish(r) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(r);
      }
      var timer = window.setTimeout(function () {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
        finish({ ok: false, error: "timeout" });
      }, TIMEOUT_MS);
      var init = { method: "POST", headers: { "Content-Type": "application/json" }, body: text,
        mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" };
      if (ctrl) init.signal = ctrl.signal;
      var req;
      try { req = window.fetch(GC_INBOX, init); } catch (e) { finish({ ok: false, error: "network" }); return; }
      Promise.resolve(req).then(function (res) {
        return res.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) { j = null; }
          if (res.status === 200 && j && j.ok === true && typeof j.id === "string") {
            finish({ ok: true, id: j.id, received_at: String(j.received_at || ""), status: 200 });
          } else if (j && typeof j.error === "string") {
            finish({ ok: false, error: j.error, status: res.status });
          } else {
            finish({ ok: false, error: res.status === 413 ? "too_large" : (res.ok ? "bad_reply" : "http"), status: res.status });
          }
        });
      }).then(null, function () { finish({ ok: false, error: "network" }); });
    });
  }

  var SEND_ERRORS = {
    not_open_yet: "收件伺服器還沒開始收件：試用從 " + WINDOW_TEXT.start + " 開始。作答會留在這臺裝置上，請在那個時間以後再按一次「送出」。",
    closed: "試用已經在 " + WINDOW_TEXT.end + " 結束，收件伺服器不再收件；現在才傳的作答，不會算進結果。謝謝你的參與。",
    busy: "收件伺服器今天收到太多資料，暫時不收（每天臺北時間早上 8 點重新開始收件）。請晚一點再按一次，或改用下面的方法傳給 Ted。",
    storage: "收件伺服器暫時存不進去。請過幾分鐘再按一次，或改用下面的方法傳給 Ted。",
    http: "收件伺服器暫時出了問題。請過幾分鐘再按一次，或改用下面的方法傳給 Ted。",
    bad_reply: "收件伺服器的回應不完整。請過幾分鐘再按一次（重送沒關係，Ted 用最後一次送出的版本），或改用下面的方法傳給 Ted。",
    too_large: "資料太大，沒辦法送出。請改用下面的方法傳給 Ted。",
    timeout: "等了 15 秒還沒有回應，可能是網路不穩。請再按一次（重送沒關係，Ted 用最後一次送出的版本），或改用下面的方法傳給 Ted。",
    network: "沒有連上收件伺服器，可能是網路斷了，或這個網路擋住了連線。請再按一次，或改用下面的方法傳給 Ted。",
    no_fetch: "這個瀏覽器不能直接送出。請改用下面的方法傳給 Ted。",
    bad_code: CODE_HELP,
    bad_request: "收件伺服器說資料格式不對，沒有收下。請改用下面的方法傳給 Ted，也請告訴 Ted 發生了這個問題。",
    origin: "收件伺服器拒絕了這個網頁的連線。請改用下面的方法傳給 Ted，也請告訴 Ted 發生了這個問題。"
  };
  function sendErrorText(r) {
    var msg = SEND_ERRORS[r.error];
    // Anything else (method, not_found, ...): plain words first, the technical code last, for Ted.
    if (!msg) msg = SEND_ERRORS.http + "（給 Ted 看的錯誤代碼：" + (r.error || "?") + (r.status ? " " + r.status : "") + "）";
    // A timeout or an unreadable reply may still have reached the inbox; everything else surely did not.
    return (r.error === "timeout" || r.error === "bad_reply" ? "不確定有沒有送出。" : "沒有送出。") + msg;
  }
  // After these, the fallback (e-mail, download) would not help: the window is closed, or not open yet
  // (then the same button works later).
  var NO_FALLBACK = { closed: true, not_open_yet: true };

  function receiptKey(kind, code, detail) {
    return "gc-receipt-v3:" + kind + ":" + code + (detail ? ":" + detail : "");
  }
  function receiptText(rec) {
    return "收件編號 " + rec.id + "，伺服器收到的時間 " + taipeiTime(rec.received_at) + "。";
  }

  // Wire one 送出 button. opts:
  //   button, status (aria-live element), receipt (element that keeps the last receipt),
  //   help (element shown after a failure: the fallback instructions),
  //   key: function () -> localStorage key for the receipt (or "" when not known yet),
  //   build: function () -> {body} to send, or {error: message, focus: element} to stop.
  // Returns {sendNow: function (), showReceipt: function ()}.
  function sendButton(opts) {
    var btn = opts.button;
    var idleLabel = btn.textContent;
    var busy = false;

    function showReceipt() {
      var k = opts.key();
      var rec = k ? store.get(k) : null;
      if (opts.receipt) {
        opts.receipt.textContent = rec && rec.id
          ? "這臺裝置上次送出成功：" + receiptText(rec) + "之後又修改的話，請再送出一次；Ted 用最後一次送出的版本。"
          : "";
      }
    }

    function sendNow() {
      if (busy) return;
      // build() returns {body}, or {error, focus} to stop with a message, or {cancel: true} when the
      // participant cancelled a confirm dialog.
      var built = opts.build();
      if (!built || !built.body) {
        if (built && built.error) announce(opts.status, built.error);
        if (built && built.focus) built.focus.focus();
        return;
      }
      busy = true;
      btn.setAttribute("aria-disabled", "true");
      btn.textContent = "正在送出……";
      announce(opts.status, "正在送出，最多等 15 秒。");
      send(built.body).then(function (r) {
        busy = false;
        btn.removeAttribute("aria-disabled");
        if (r.ok) {
          btn.textContent = idleLabel;
          var k = opts.key();
          if (k) store.set(k, { id: r.id, received_at: r.received_at });
          if (opts.help) opts.help.hidden = true;
          if (opts.status) opts.status.classList.remove("err");
          announce(opts.status, "已送出。" + receiptText(r) + "謝謝你！");
          showReceipt();
          if (opts.onSent) opts.onSent(r);
        } else {
          if (!NO_FALLBACK[r.error]) btn.textContent = "再送一次";
          if (opts.help) opts.help.hidden = !!NO_FALLBACK[r.error];
          // The words say it failed; the colour only repeats it.
          if (opts.status) opts.status.classList.add("err");
          announce(opts.status, sendErrorText(r));
          if (opts.onFail) opts.onFail(r);
        }
        // Keep the keyboard on the button (it is now 再送一次 after a failure) unless the person has
        // moved on while waiting.
        var ae = document.activeElement;
        if (!ae || ae === document.body || ae === btn) btn.focus();
      });
    }

    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      sendNow();
    });
    showReceipt();
    return { sendNow: sendNow, showReceipt: showReceipt };
  }

  // A new open-route code: prefix ("OL-", "OW-", "TOL-", "TOW-") plus 5 random characters. Values that
  // would make the four rows unequal (3 of the 31^5) are redrawn, so rowForCode() gives each row
  // with probability exactly 1/4.
  function newOpenCode(prefix) {
    for (;;) {
      var c = prefix + randomChars(CODE_ALPHABET, 5);
      if (codeValue(c) < ROW_LIMIT) return c;
    }
  }

  // Cryptographically random characters from an alphabet (rejection sampling keeps it uniform).
  function randomChars(alphabet, n) {
    var out = "";
    var limit = 256 - (256 % alphabet.length);
    var buf = new Uint8Array(16);
    while (out.length < n) {
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length && out.length < n; i++) {
        if (buf[i] < limit) out += alphabet.charAt(buf[i] % alphabet.length);
      }
    }
    return out;
  }

  // Pages read the participant's code, round etc. once, at load. Opening another personal link
  // in the same tab only changes the part after "#", which does not reload the page, so the old
  // participant's state (and storage key) would stay in use. Reload whenever those values change.
  // In-page anchors such as "#main" carry no "=" and are ignored.
  var reloading = false;
  function signature(keys) {
    var p = readParams();
    return keys.map(function (k) { return k + "=" + (p[k] || ""); }).join("&");
  }
  function watchHash(keys) {
    var start = signature(keys);
    window.addEventListener("hashchange", function () {
      if (reloading || window.location.hash.indexOf("=") < 0) return;
      if (signature(keys) !== start) {
        reloading = true;
        window.location.reload();
      }
    });
  }
  // Move to a new set of parameters (setup forms) and reload exactly once.
  function goToHash(h) {
    reloading = true;
    if (window.location.hash !== "#" + h) window.location.hash = h;
    window.location.reload();
  }

  // The skip link would replace "#code=..." in the address with "#main", so a later reload
  // (or iOS restoring the tab) would lose the participant's code. Move focus without
  // touching the address instead.
  var skip = document.querySelector("a.skip");
  var mainEl = document.getElementById("main");
  if (skip && mainEl) {
    skip.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (!mainEl.hasAttribute("tabindex")) mainEl.setAttribute("tabindex", "-1");
      mainEl.focus();
      mainEl.scrollIntoView();
    });
  }

  window.GC = {
    INBOX: GC_INBOX,
    WINDOW: WINDOW,
    WINDOW_TEXT: WINDOW_TEXT,
    CONSENT_VERSION: CONSENT_VERSION,
    OPEN_CONSENT_ITEMS: OPEN_CONSENT_ITEMS,
    INVITED_CONSENT_ITEMS: INVITED_CONSENT_ITEMS,
    consentItems: consentItems,
    rememberConsent: rememberConsent,
    CHOICE_TEXT: CHOICE_TEXT,
    watchHash: watchHash,
    goToHash: goToHash,
    readParams: readParams,
    cleanCode: cleanCode,
    validCode: validCode,
    CODE_HELP: CODE_HELP,
    isOpenCode: isOpenCode,
    rowForCode: rowForCode,
    newOpenCode: newOpenCode,
    modeOf: modeOf,
    store: store,
    moveDraft: moveDraft,
    announce: announce,
    copyText: copyText,
    pad: pad,
    localDate: localDate,
    isoLocal: isoLocal,
    taipeiTime: taipeiTime,
    oneLine: oneLine,
    windowState: windowState,
    consentToken: consentToken,
    consentFromToken: consentFromToken,
    consentFor: consentFor,
    consentLine: consentLine,
    consentGate: consentGate,
    envelope: envelope,
    send: send,
    sendErrorText: sendErrorText,
    receiptKey: receiptKey,
    receiptText: receiptText,
    sendButton: sendButton,
    randomChars: randomChars
  };
})();
