/* Shared helpers for the GapCaster trial pages.
 * Nothing here talks to the network: no fetch, no beacons, no third parties.
 * Data only leaves the page when the participant copies or downloads it.
 */
(function () {
  "use strict";

  // Read parameters from the URL hash first (never sent to the server), then the query string.
  function readParams() {
    var out = {};
    var sources = [window.location.search.replace(/^\?/, ""), window.location.hash.replace(/^#/, "")];
    sources.forEach(function (src) {
      if (!src) return;
      src.split("&").forEach(function (pair) {
        if (!pair) return;
        var i = pair.indexOf("=");
        var k = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, " "));
        var v = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
        out[k.toLowerCase()] = v; // hash wins because it is read last
      });
    });
    return out;
  }

  // Participant codes look like L07 or W03. Keep only safe characters.
  function cleanCode(raw) {
    if (!raw) return "";
    var c = String(raw).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
    return c;
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
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ISO 8601 with the local UTC offset, e.g. 2026-11-20T14:03:05+08:00.
  function isoLocal(d) {
    d = d || new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    off = Math.abs(off);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
      sign + pad(Math.floor(off / 60)) + ":" + pad(off % 60);
  }

  // Collapse line breaks so free text stays on one line of the result code.
  function oneLine(s) {
    return String(s || "").replace(/\s*[\r\n]+\s*/g, " / ").trim();
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
    watchHash: watchHash,
    goToHash: goToHash,
    readParams: readParams,
    cleanCode: cleanCode,
    store: store,
    announce: announce,
    copyText: copyText,
    pad: pad,
    localDate: localDate,
    isoLocal: isoLocal,
    oneLine: oneLine
  };
})();
