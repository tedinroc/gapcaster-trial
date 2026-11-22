/* From-scratch writing page: plays one clip half, timestamped writing, timer, JSON download.
 * Nothing is sent anywhere. The file is downloaded and emailed by the participant.
 *
 * URL (hash preferred, it never reaches the server):
 *   write.html#code=W03&round=1&clip=A&half=2
 *
 * One trial round only (25-29 November 2026): the round is always 1 (kept in the file name and the
 * JSON for continuity); the page never asks for it and ignores any other value in the link.
 */
(function () {
  "use strict";
  var GC = window.GC;
  var PAGE_VERSION = "v2";

  // Where each half starts inside the trial clip, in seconds. Half 1 always starts at 0.
  // Fill the two placeholders once the split points are fixed (tools/fill.py does this).
  var HALF_START_S = {
    A1: 0,
    A2: "42.083",
    B1: 0,
    B2: "46.25"
  };
  var CLIP_TITLE = { A: "片段 A：Tears of Steel", B: "片段 B：《Spring》" };
  var HALF_NAME = { "1": "前半", "2": "後半" };

  // Another personal link opened in this tab (different code, clip or half) must not reuse this
  // half's text and timer.
  GC.watchHash(["code", "clip", "half"]);

  var params = GC.readParams();
  var code = GC.cleanCode(params.code);
  var round = 1;
  var clip = (params.clip || "").toUpperCase();
  var half = params.half === "1" || params.half === "2" ? params.half : "";
  if (clip !== "A" && clip !== "B") clip = "";

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status");
  var textEl = $("text");
  var noteEl = $("timer-note");
  var video = $("video");

  // --- Setup ------------------------------------------------------------------
  $("setup-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var c = GC.cleanCode($("in-code").value);
    var cl = $("in-clip-a").checked ? "A" : ($("in-clip-b").checked ? "B" : "");
    var h = $("in-half-1").checked ? "1" : ($("in-half-2").checked ? "2" : "");
    if (!c || !cl || !h) {
      $("who").textContent = "請填代號，並選擇片段和哪一半。";
      GC.announce(statusEl, "請填代號，並選擇片段和哪一半。");
      if (!c) $("in-code").focus();
      return;
    }
    GC.goToHash("code=" + encodeURIComponent(c) + "&round=1&clip=" + cl + "&half=" + h);
  });

  if (!code || !clip || !half) {
    $("setup").hidden = false;
    if (code) $("in-code").value = code;
    if (clip) $("in-clip-" + clip.toLowerCase()).checked = true;
    if (half) $("in-half-" + half).checked = true;
    return; // nothing else to do until the setup is complete
  }

  $("work").hidden = false;
  var halfKey = clip + half;
  var halfStart = Number(HALF_START_S[halfKey]);
  var halfStartKnown = isFinite(halfStart);
  if (!halfStartKnown) {
    halfStart = 0;
    $("offset-warn").hidden = false;
  }
  var mediaPath = "media/write/" + clip + "_h" + half + ".mp4";
  // Heading with the English title marked as English for screen readers.
  var heading = $("h-clip");
  heading.textContent = "";
  if (clip === "A") {
    heading.appendChild(document.createTextNode("片段 A："));
    var en = document.createElement("span");
    en.lang = "en";
    en.textContent = "Tears of Steel";
    heading.appendChild(en);
  } else {
    heading.appendChild(document.createTextNode(CLIP_TITLE[clip]));
  }
  heading.appendChild(document.createTextNode("，" + HALF_NAME[half]));
  video.setAttribute("src", mediaPath);
  if (clip === "A") {
    var track = document.createElement("track");
    track.kind = "subtitles";
    track.srclang = "zh-Hant-TW";
    track.label = "繁體中文字幕";
    track.src = "media/write/A_h" + half + ".zh-TW.vtt";
    track.default = true;
    video.appendChild(track);
  }
  $("video-link").setAttribute("href", mediaPath);

  var storageKey = "gc-write-" + PAGE_VERSION + ":" + code + ":r" + round + ":" + halfKey;

  // --- Timer ------------------------------------------------------------------
  // segments: [{s: ms, e: ms|null}]; finishedAt: ms|null
  var timer = { segments: [], finishedAt: null, lastTick: null };
  var tickHandle = null;

  function state() {
    if (timer.finishedAt) return "finished";
    if (!timer.segments.length) return "idle";
    return timer.segments[timer.segments.length - 1].e === null ? "running" : "paused";
  }

  function activeMs() {
    var now = Date.now();
    return timer.segments.reduce(function (sum, seg) {
      return sum + ((seg.e === null ? now : seg.e) - seg.s);
    }, 0);
  }

  function fmtClock(ms) {
    var t = Math.floor(ms / 1000);
    return GC.pad(Math.floor(t / 3600)) + ":" + GC.pad(Math.floor(t / 60) % 60) + ":" + GC.pad(t % 60);
  }

  var STATE_TEXT = { idle: "還沒開始", running: "計時中", paused: "已暫停", finished: "已完成" };

  function render() {
    var st = state();
    $("timer").textContent = fmtClock(activeMs());
    $("timer-state").textContent = STATE_TEXT[st];
    $("t-start").disabled = st !== "idle";
    $("t-pause").disabled = st !== "running";
    $("t-resume").disabled = !(st === "paused" || st === "finished");
    $("t-resume").textContent = st === "finished" ? "繼續（取消完成）" : "繼續";
    $("t-finish").disabled = !(st === "running" || st === "paused");
    if (st === "running" && !tickHandle) {
      tickHandle = window.setInterval(function () {
        timer.lastTick = Date.now();
        $("timer").textContent = fmtClock(activeMs());
        if (Math.floor(timer.lastTick / 1000) % 10 === 0) save();
      }, 1000);
    } else if (st !== "running" && tickHandle) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function closeOpenSegment(at) {
    var last = timer.segments[timer.segments.length - 1];
    if (last && last.e === null) last.e = at;
  }

  $("t-start").addEventListener("click", function () {
    timer.segments.push({ s: Date.now(), e: null });
    timer.lastTick = Date.now();
    render(); save();
    GC.announce(statusEl, "開始計時。");
    $("t-pause").focus();
  });
  $("t-pause").addEventListener("click", function () {
    closeOpenSegment(Date.now());
    render(); save();
    GC.announce(statusEl, "已暫停計時。");
    $("t-resume").focus();
  });
  $("t-resume").addEventListener("click", function () {
    timer.finishedAt = null;
    timer.segments.push({ s: Date.now(), e: null });
    timer.lastTick = Date.now();
    render(); save();
    GC.announce(statusEl, "繼續計時。");
    $("t-pause").focus();
  });
  function finish() {
    var now = Date.now();
    closeOpenSegment(now);
    timer.finishedAt = now;
    render(); save();
  }
  $("t-finish").addEventListener("click", function () {
    finish();
    GC.announce(statusEl, "已完成，共計時 " + fmtClock(activeMs()) + "。請按「下載檔案」。");
    $("download").focus();
  });

  // --- Writing ----------------------------------------------------------------
  function fmtStamp(sec) {
    var ms = Math.max(0, Math.round(sec * 1000));
    var h = Math.floor(ms / 3600000);
    var m = Math.floor(ms / 60000) % 60;
    var s = Math.floor(ms / 1000) % 60;
    return GC.pad(h) + ":" + GC.pad(m) + ":" + GC.pad(s) + "." + GC.pad(ms % 1000, 3);
  }

  var LINE_RE = /^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?\]\s*(.*)$/;

  function parseLines(text) {
    var lines = [];
    var unparsed = [];
    text.split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var m = LINE_RE.exec(raw);
      if (!m) { unparsed.push(raw.trim()); return; }
      if (!m[5].trim()) return; // a timestamp with no description yet
      var h = 0, mi, s;
      if (m[3] !== undefined) { h = Number(m[1]); mi = Number(m[2]); s = Number(m[3]); }
      else { mi = Number(m[1]); s = Number(m[2]); }
      var frac = m[4] ? Number((m[4] + "00").slice(0, 3)) / 1000 : 0;
      lines.push({ t: Math.round((h * 3600 + mi * 60 + s + frac) * 1000) / 1000, text: m[5].trim() });
    });
    return { lines: lines, unparsed: unparsed };
  }

  function updateLineInfo() {
    var p = parseLines(textEl.value);
    var msg = "目前 " + p.lines.length + " 行有時間。";
    if (p.unparsed.length) msg += "有 " + p.unparsed.length + " 行沒有時間或格式不符，下載時仍會保留原文。";
    $("line-info").textContent = msg;
  }

  function insertTime() {
    var stamp = "[" + fmtStamp((video.currentTime || 0) + halfStart) + "] ";
    var s = textEl.selectionStart, e = textEl.selectionEnd, v = textEl.value;
    var before = v.slice(0, s);
    var prefix = before.length && before.charAt(before.length - 1) !== "\n" ? "\n" : "";
    textEl.value = before + prefix + stamp + v.slice(e);
    var pos = (before + prefix + stamp).length;
    textEl.focus();
    textEl.setSelectionRange(pos, pos);
    save(); updateLineInfo();
    GC.announce(statusEl, "已插入時間 " + stamp.trim());
  }

  $("insert-time").addEventListener("click", insertTime);
  textEl.addEventListener("keydown", function (ev) {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.code === "KeyT") { ev.preventDefault(); insertTime(); }
    else if (ev.code === "KeyK") { ev.preventDefault(); if (video.paused) video.play(); else video.pause(); }
    else if (ev.code === "KeyJ") { ev.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); }
  });
  textEl.addEventListener("input", function () { save(); updateLineInfo(); });
  noteEl.addEventListener("input", save);

  // --- Save / restore -----------------------------------------------------------
  function save() {
    GC.store.set(storageKey, { text: textEl.value, note: noteEl.value, timer: timer });
  }

  function restore() {
    var data = GC.store.get(storageKey);
    if (!data) return "";
    textEl.value = data.text || "";
    noteEl.value = data.note || "";
    if (data.timer && Array.isArray(data.timer.segments)) {
      timer = { segments: data.timer.segments, finishedAt: data.timer.finishedAt || null, lastTick: data.timer.lastTick || null };
      // If the page was closed while the timer ran, keep it running: writers may be working in
      // their own tool while this tab is closed or unloaded. Breaks without "pause" go in the note.
      var last = timer.segments[timer.segments.length - 1];
      if (last && last.e === null) {
        return "已恢復這臺裝置上之前的內容。離開這一頁的期間，計時仍在進行；如果中間休息時沒有按暫停，請在計時備註寫下大約休息多久。";
      }
    }
    return "已恢復這臺裝置上之前的內容。";
  }

  // --- Download -----------------------------------------------------------------
  function isoOrNull(ms) { return ms ? GC.isoLocal(new Date(ms)) : null; }

  function exportData() {
    var p = parseLines(textEl.value);
    return {
      format: "gapcaster-write/1",
      page_version: PAGE_VERSION,
      participant: code,
      round: round,
      clip: clip,
      half: Number(half),
      half_start_s: halfStartKnown ? halfStart : null,
      media: mediaPath,
      started_at: timer.segments.length ? isoOrNull(timer.segments[0].s) : null,
      finished_at: isoOrNull(timer.finishedAt),
      active_seconds: Math.round(activeMs() / 1000),
      segments: timer.segments.map(function (seg) { return { start: isoOrNull(seg.s), end: isoOrNull(seg.e) }; }),
      timer_note: noteEl.value,
      text: textEl.value,
      lines: p.lines,
      unparsed_lines: p.unparsed,
      exported_at: GC.isoLocal()
    };
  }

  function download() {
    var data = JSON.stringify(exportData(), null, 2);
    var name = "gapcaster-write_" + code + "_r" + round + "_" + clip + "_h" + half + ".json";
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return name;
  }

  $("download").addEventListener("click", function () {
    var st = state();
    if (st === "running" || st === "paused") {
      var finishNow = window.confirm("你還沒有按「完成」。\n按「確定」：先結束計時再下載。\n按「取消」：下載目前的進度，計時不會停。");
      if (finishNow) finish();
    }
    var name = download();
    GC.announce(statusEl, "已下載 " + name + "。請用 email 附件寄給 Ted。");
  });

  $("clear").addEventListener("click", function () {
    if (!window.confirm("確定要清除這臺裝置上的內容和計時嗎？清除後無法復原。請先確定 Ted 已經收到檔案。")) return;
    GC.store.remove(storageKey);
    textEl.value = "";
    noteEl.value = "";
    timer = { segments: [], finishedAt: null, lastTick: null };
    render(); updateLineInfo();
    GC.announce(statusEl, "已清除這臺裝置上的內容和計時。");
  });

  // --- Init -------------------------------------------------------------------
  var restoredMsg = restore();
  $("who").textContent = "代號 " + code + "，" + CLIP_TITLE[clip] + "，" + HALF_NAME[half] + "。" + restoredMsg;
  render();
  updateLineInfo();
  window.addEventListener("pagehide", save);
})();
