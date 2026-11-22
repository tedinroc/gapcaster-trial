#!/usr/bin/env python3
"""Offline checks for the GapCaster trial site. Standard library only (OpenCC optional).

    python3 tools/check.py                         # structure, accessibility, privacy, sync
    python3 tools/check.py --prepublish            # also: no placeholders or stray braces left,
                                                   # media present
    python3 tools/check.py --after-trial           # after 22:00 on 29 November 2026: --prepublish,
                                                   # except that media/A_ad.mp3, media/B_ad.mp3 and
                                                   # every file in review/ must be GONE
    python3 tools/check.py --forbid-file PATH      # extra private words that must not appear
                                                   # (one per line; keep that file OUT of the repo)

Exit code 0 when there are no errors. Warnings are printed but do not fail.
What it checks:
  HTML   tags balanced, unique ids, label/aria references resolve, every form control labelled,
         radios inside a fieldset whose first child is a legend, one h1 and no skipped heading
         levels, lang/title/viewport/CSP and a robots noindex meta present, audio/video have
         controls, an accessible name and no autoplay, no inline script or style, no third-party
         scripts/styles/fonts, local links resolve, buttons and links have text.
  JS     no network APIs (fetch, XHR, beacons, sockets), no innerHTML, no external URLs.
  Media  media/ holds only the public files listed below. review/<clip>-<half>/ holds only the
         draft-only files of a describer review page (review_pilot.html, clip.mp4,
         clip_with_ad.mp4, lines/AD###.wav, and clip.zh-TW.vtt for clip A). No audio or video
         anywhere else. A review page must carry noindex, load nothing external, and the files
         it plays must sit next to it.
         Round-2 versions (版本一/版本二, including any describer-approved audio), the
         round2-audio/ sets, ORDER.txt and other stage2/pilot-private/ files must never be in
         this folder, and no file may name or map them. .gitignore must exist and list them.
         (Round 2 was cancelled on 23 November 2026: one round only. These guards stay, because
         describer text must still never be published.)
  Round  one trial round only: participant pages, documents and scripts never mention a second
         round, round-2 audio or 版本一/版本二, and never ask for a round. The review pages are not
         covered: they were not regenerated and still carry a round select and the word 核可版
         (README.md, 審閱頁 step 5 and 已知限制).
  Text   no home-directory paths, private words, simplified Chinese characters; e-mail
         addresses are listed as warnings (only the contact address should appear).
  Sync   listen.html, questions.md and consent.html equal what tools/build.py generates, and
         every question and option on listen.html appears in questions.md in the same order.
         Each clip's exposure question (q-B-pre, q-A-pre) comes before that clip's first player.
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
PAGES = ["index.html", "consent.html", "listen.html", "write.html", "questions.html"]
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
ALLOWED_EXTERNAL_LINK_HOSTS = {"creativecommons.org", "github.com"}
# Public listener audio: no AD, and the raw draft with AD. Nothing else.
LISTENER_MEDIA = [f"media/{c}_{k}.mp3" for c in "AB" for k in ("noad", "ad")]
# Chinese synthetic voice: trial material only (LongMaoData data terms not cleared). Removed from the
# site after the trial ends (22:00 on 29 November 2026) and before the numbers lock (12:00 on
# 30 November), together with the whole review/ folder. `--after-trial` checks that they are gone.
TRIAL_ONLY_MEDIA = ["media/A_ad.mp3", "media/B_ad.mp3"]
WRITER_MEDIA = [f"media/write/{c}_h{h}.mp4" for c in "AB" for h in (1, 2)] + \
               [f"media/write/A_h{h}.zh-TW.vtt" for h in (1, 2)]
# Describer review pages (gapcaster review RUN --pilot --window ... [--subs ...]), one folder per clip
# half. Draft material only: never the describer's version (lines/*_edited.wav, the export folder,
# pilot_log.json), which carries describer text and stays in stage2/pilot-private/.
REVIEW_DIRS = [f"review/{c}-{h}" for c in "AB" for h in (1, 2)]
REVIEW_FILES = ("review_pilot.html", "clip.mp4", "clip_with_ad.mp4")
REVIEW_SUBS = "clip.zh-TW.vtt"              # clip A only: the official Traditional Chinese subtitles
REVIEW_LINE = re.compile(r"lines/AD\d{3,}\.wav")   # the pipeline's draft line audio
REVIEW_PAGES = {f"{d}/review_pilot.html" for d in REVIEW_DIRS}
# Words that would name the round-2 versions or map them to page order. Built from parts so
# this file does not trip its own check.
REVEALING = re.compile("|".join([r"appro" + r"ved", r"_dra" + r"ft\.mp3", r"核可" + r"版\.mp3"]), re.IGNORECASE)
# A review page's own code uses the line status "appro" + "ved" (the same words as the approved.json the
# default review page exports), so in that page only the file names are looked for.
REVEALING_FILES = re.compile("|".join([r"_dra" + r"ft\.mp3", r"核可" + r"版\.mp3"]), re.IGNORECASE)
# Text that maps a page version to what it is, e.g. a line copied from ORDER.txt.
MAPPING = re.compile(r"版本[一二]\s*[＝=：:→]\s*(草稿|核可|撰稿人|修改)")
# Audio and video belong in media/ only (and only the files listed above).
AV_SUFFIXES = {".mp3", ".m4a", ".m4b", ".wav", ".aac", ".ogg", ".oga", ".opus", ".flac", ".aif", ".aiff",
               ".caf", ".weba", ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".3gp"}
# Anything from stage2/pilot-private/ (the round-2 sets, the order key, the roster, values and
# private word lists). Matched case-insensitively against the whole path.
PRIVATE_PATH_PARTS = ("round2-audio", "pilot-private")
PRIVATE_NAMES = {"order.txt", "order-list.txt", "roster.csv", "site-values.json", "forbidden.txt",
                 "pilot_log.json", "voiceover-test.md"}
# Neutral names used only for the privately sent round-2 files.
PRIVATE_NAME_WORDS = ("版本一", "版本二", "沒有口述影像")
# One round only: what participant-facing text must never say again (a second round, its audio, the
# 版本一/版本二 names, a describer-approved version, or a round-2 link).
SECOND_ROUND = re.compile(r"第二輪|第\s*[2二]\s*輪|版本[一二]|核可版|round=2|[#&]r=2")
SECOND_ROUND_FILES = {"consent.md", "questions.md", "index.html", "consent.html", "listen.html", "write.html",
                      "questions.html", "assets/listen.js", "assets/consent.js", "assets/write.js",
                      "assets/common.js"}
# Lines .gitignore must keep (second line of defence for `git add -A`).
GITIGNORE_REQUIRED = ["round2-audio/", "ORDER.txt", "*版本一*", "*版本二*", "*沒有口述影像*", "*.mp3", "*.mp4",
                      "*.wav", "*_edited.wav", "appro" + "ved/"]

# Common simplified-only characters (Traditional/Taiwan text should never contain them).
SIMPLIFIED = set(
    "这们为说时发对问题请开关门见听读写谢话语经过还进选试码页频应该样个与业东两从会传体兴养"
    "内农决况别动务区单卖却历压厅县参双变号吗员围国图圆场块坏声处复头夹奖实宝宫寻导将尔尽层"
    "岁师带帮广庆库异张录彻忆态总恶惊战户扑执扩扫扬择报护拥换据摄敌数断无旧显术机杀杂权条来"
    "极构标树桥检楼欢残毕气汇汉没沟洁浅济测满滤灵灯点热爱环现电画盖监确离种积称稳穷笔筑简类"
    "紧红纪纯纸线练组细织终结给绝统继续维综绿网罗罚职联脑腾节苏药获营虽补装观规视览觉论证识"
    "诉译诗误调谈贝负财责贵贸费资质赞赶车轨转轮软轻较辆辑输边达运远连迟递遗邮针钟钱铁银错锁"
    "长间闻阅阶阳阴际陆陈险随难静顶顺须预领颜风飞饭馆马验鱼鸟麦黄齐齿龙净减凉冻吕产温鸡么"
)

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


class PageChecker(HTMLParser):
    def __init__(self, name: str):
        super().__init__(convert_charrefs=True)
        self.name = name
        self.stack: list[tuple[str, dict]] = []
        self.ids: dict[str, int] = {}
        self.label_for: list[str] = []
        self.aria_refs: list[tuple[str, str]] = []
        self.controls: list[tuple[str, dict, bool]] = []  # (tag, attrs, inside_label)
        self.headings: list[int] = []
        self.fieldset_first: list[bool] = []  # per open fieldset: waiting for first child
        self.text_targets: list[list] = []  # [tag, attrs, text]
        self.title = ""
        self.in_title = False
        self.in_script = False
        self.script_text = ""
        self.html_lang = None
        self.meta: dict[str, str] = {}
        self.links: list[str] = []
        self.srcs: list[str] = []

    # -- helpers
    def inside(self, tag: str) -> bool:
        return any(t == tag for t, _ in self.stack)

    def handle_starttag(self, tag, attrs_list):
        a = {k: (v if v is not None else "") for k, v in attrs_list}
        # first child of a fieldset must be its legend
        if self.fieldset_first and self.fieldset_first[-1]:
            if tag != "legend":
                err(f"{self.name}: <fieldset> whose first child is <{tag}>, not <legend>")
            self.fieldset_first[-1] = False
        if "id" in a:
            self.ids[a["id"]] = self.ids.get(a["id"], 0) + 1
        for ref_attr in ("aria-labelledby", "aria-describedby", "aria-controls"):
            if ref_attr in a:
                for ref in a[ref_attr].split():
                    self.aria_refs.append((ref_attr, ref))
        if "style" in a:
            err(f"{self.name}: inline style attribute on <{tag}> (blocked by the CSP)")
        if any(k.startswith("on") for k in a):
            err(f"{self.name}: inline event handler on <{tag}> (blocked by the CSP)")
        if tag == "html":
            self.html_lang = a.get("lang")
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            if "charset" in a:
                self.meta["charset"] = a["charset"]
            if "name" in a:
                self.meta[a["name"].lower()] = a.get("content", "")
            if "http-equiv" in a:
                self.meta[a["http-equiv"].lower()] = a.get("content", "")
        if tag == "label" and "for" in a:
            self.label_for.append(a["for"])
        if tag in ("input", "textarea", "select"):
            typ = a.get("type", "text").lower()
            if typ not in ("hidden", "submit", "button", "reset", "image"):
                self.controls.append((tag, a, self.inside("label")))
            if typ in ("radio", "checkbox") and typ == "radio" and not self.inside("fieldset"):
                err(f"{self.name}: radio {a.get('id')} is not inside a <fieldset>")
        if tag in ("audio", "video"):
            if "controls" not in a:
                err(f"{self.name}: <{tag}> without controls")
            if tag == "audio" and not (a.get("aria-labelledby") or a.get("aria-label")):
                err(f"{self.name}: <audio src={a.get('src')!r}> has no accessible name (aria-labelledby)")
            if "autoplay" in a:
                err(f"{self.name}: <{tag}> has autoplay")
            if "src" in a:
                self.srcs.append(a["src"])
        if "autoplay" in a and tag not in ("audio", "video"):
            err(f"{self.name}: autoplay on <{tag}>")
        if tag == "script":
            if "src" in a:
                self.srcs.append(a["src"])
            else:
                self.in_script = True
                self.script_text = ""
        if tag == "link":
            self.srcs.append(a.get("href", ""))
        if tag in ("source", "track", "img", "iframe", "embed", "object"):
            if tag in ("iframe", "embed", "object"):
                err(f"{self.name}: <{tag}> is not allowed")
            if "src" in a:
                self.srcs.append(a["src"])
            if tag == "img" and "alt" not in a:
                err(f"{self.name}: <img> without alt")
        if tag == "a":
            if "href" in a:
                self.links.append(a["href"])
            if a.get("target") == "_blank" and "noopener" not in a.get("rel", ""):
                err(f"{self.name}: target=_blank without rel=noopener")
        if tag == "button" and "type" not in a:
            err(f"{self.name}: <button> without a type attribute")
        if tag == "form" and a.get("action", "").startswith("http"):
            err(f"{self.name}: form posts to an external address")
        if re.fullmatch(r"h[1-6]", tag):
            self.headings.append(int(tag[1]))
        if tag in ("a", "button"):
            self.text_targets.append([tag, a, ""])
        if tag not in VOID:
            self.stack.append((tag, a))
            if tag == "fieldset":
                self.fieldset_first.append(True)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "title":
            self.in_title = False
        if tag == "script" and self.in_script:
            self.in_script = False
            if self.script_text.strip():
                err(f"{self.name}: inline <script> content (blocked by the CSP)")
        if tag == "fieldset" and self.fieldset_first:
            if self.fieldset_first[-1]:
                err(f"{self.name}: empty <fieldset> without <legend>")
            self.fieldset_first.pop()
        if tag in ("a", "button"):
            for t in reversed(self.text_targets):
                if t[0] == tag and t[2] is not None:
                    if not t[2].strip() and not t[1].get("aria-label"):
                        err(f"{self.name}: <{tag}> without text ({t[1].get('id') or t[1].get('href')})")
                    t[2] = None
                    break
        if not self.stack:
            err(f"{self.name}: stray </{tag}>")
            return
        if self.stack[-1][0] != tag:
            err(f"{self.name}: </{tag}> closes <{self.stack[-1][0]}> (line {self.getpos()[0]})")
            # try to recover
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    return
            return
        self.stack.pop()

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_script:
            self.script_text += data
        for t in self.text_targets:
            if t[2] is not None:
                t[2] += data


def check_page(name: str) -> PageChecker | None:
    path = SITE / name
    if not path.exists():
        err(f"missing page {name}")
        return None
    text = path.read_text(encoding="utf-8")
    if not text.lstrip().lower().startswith("<!doctype html>"):
        err(f"{name}: missing <!doctype html>")
    p = PageChecker(name)
    p.feed(text)
    p.close()
    if p.stack:
        err(f"{name}: unclosed tags at end: {[t for t, _ in p.stack]}")
    if not p.html_lang:
        err(f"{name}: <html> has no lang")
    if not p.title.strip():
        err(f"{name}: empty <title>")
    if "viewport" not in p.meta:
        err(f"{name}: no viewport meta")
    if p.meta.get("charset", "").lower() != "utf-8":
        err(f"{name}: charset is not utf-8")
    csp = p.meta.get("content-security-policy", "")
    if "connect-src 'none'" not in csp or "script-src 'self'" not in csp:
        err(f"{name}: CSP missing or too loose")
    if "noindex" not in p.meta.get("robots", "").lower():
        err(f"{name}: no <meta name=\"robots\" content=\"noindex, nofollow\">")
    if "user-scalable=no" in p.meta.get("viewport", "") or "maximum-scale" in p.meta.get("viewport", ""):
        err(f"{name}: viewport blocks zooming")
    for k, n in p.ids.items():
        if n > 1:
            err(f"{name}: duplicate id {k!r}")
    for f in p.label_for:
        if f not in p.ids:
            err(f"{name}: <label for={f!r}> points to no element")
    for attr, ref in p.aria_refs:
        if ref not in p.ids:
            err(f"{name}: {attr}={ref!r} points to no element")
    labelled = set(p.label_for)
    for tag, a, inside_label in p.controls:
        if not (inside_label or a.get("id") in labelled or a.get("aria-label") or a.get("aria-labelledby")):
            err(f"{name}: <{tag} id={a.get('id')!r}> has no label")
    if p.headings.count(1) != 1:
        err(f"{name}: expected exactly one <h1>, found {p.headings.count(1)}")
    if p.headings and p.headings[0] != 1:
        err(f"{name}: first heading is h{p.headings[0]}, not h1")
    for prev, cur in zip(p.headings, p.headings[1:]):
        if cur > prev + 1:
            err(f"{name}: heading level jumps from h{prev} to h{cur}")
    for src in p.srcs:
        if re.match(r"^(https?:)?//", src):
            err(f"{name}: external resource {src}")
        elif src and not src.startswith(("data:", "#")):
            target = SITE / src.split("#")[0].split("?")[0]
            if not target.exists():
                (err if not src.startswith("media/") else warn)(f"{name}: {src} does not exist yet")
    for href in p.links:
        if href.startswith(("http://", "https://")):
            host = re.sub(r"^https?://([^/]+).*$", r"\1", href)
            if host not in ALLOWED_EXTERNAL_LINK_HOSTS:
                warn(f"{name}: external link to {host}")
        elif href.startswith(("mailto:", "tel:", "#")) or not href:
            continue
        else:
            target = SITE / href.split("#")[0].split("?")[0]
            if not target.exists():
                (warn if href.startswith("media/") else err)(f"{name}: link to missing {href}")
    return p


def check_js() -> None:
    bad = [r"\bfetch\s*\(", r"XMLHttpRequest", r"sendBeacon", r"WebSocket", r"EventSource",
           r"importScripts", r"\bimport\s*\(", r"\.innerHTML\b", r"https?://", r"document\.write"]
    for path in sorted((SITE / "assets").glob("*.js")):
        text = path.read_text(encoding="utf-8")
        for pat in bad:
            if re.search(pat, text):
                err(f"assets/{path.name}: forbidden pattern {pat}")


def check_css() -> None:
    for path in sorted((SITE / "assets").glob("*.css")):
        text = path.read_text(encoding="utf-8")
        if re.search(r"@import|url\(\s*['\"]?(https?:)?//", text):
            err(f"assets/{path.name}: external import or url()")


def text_files():
    for p in sorted(SITE.rglob("*")):
        if p.is_file() and p.suffix in {".html", ".md", ".js", ".css", ".py", ".txt", ".json", ".vtt"}:
            yield p, p.relative_to(SITE).as_posix()


def review_allowed(rel: str) -> bool:
    """True for exactly the draft-only files a describer review page may publish."""
    for d in REVIEW_DIRS:
        if rel.startswith(d + "/"):
            rest = rel[len(d) + 1:]
            return (rest in REVIEW_FILES or bool(REVIEW_LINE.fullmatch(rest))
                    or (rest == REVIEW_SUBS and d.startswith("review/A-")))
    return False


def check_media() -> None:
    """Only the public files may sit in media/. The round-2 versions, the order key and anything
    else from stage2/pilot-private/ never belong anywhere in this folder."""
    allowed = set(LISTENER_MEDIA + WRITER_MEDIA)
    for p in sorted(SITE.rglob("*")):
        if not p.is_file():
            continue
        rel = unicodedata.normalize("NFC", p.relative_to(SITE).as_posix())
        if rel.startswith(".git/"):
            continue
        name = rel.rsplit("/", 1)[-1]
        low = rel.lower()
        if REVEALING.search(name):
            err(f"{rel}: file name names a round-2 version; such files stay in stage2/pilot-private/")
        if any(part in low for part in PRIVATE_PATH_PARTS):
            err(f"{rel}: path looks like stage2/pilot-private/ (round-2 audio or other private files); "
                "nothing from there may be copied into this folder")
        if name.lower() in PRIVATE_NAMES:
            err(f"{rel}: {name} belongs in stage2/pilot-private/ only (it may hold the round-2 order "
                "or personal data)")
        if any(w in rel for w in PRIVATE_NAME_WORDS):
            err(f"{rel}: name of a privately sent round-2 file (版本一、版本二、沒有口述影像); those files "
                "stay in stage2/pilot-private/round2-audio/")
        if rel.startswith("review/"):
            if p.name.startswith("."):
                warn(f"{rel}: hidden file in review/ (delete it before publishing)")
            elif not review_allowed(rel):
                why = (" It is a line re-voiced from a describer's edit: describer text stays in stage2/pilot-private/."
                       if "_edited" in name else "")
                err(f"{rel}: not one of the review-page files (review/A-1, A-2, B-1, B-2: review_pilot.html, "
                    f"clip.mp4, clip_with_ad.mp4, lines/AD###.wav; clip.zh-TW.vtt for clip A).{why}")
            continue
        if p.suffix.lower() in AV_SUFFIXES and not rel.startswith("media/"):
            err(f"{rel}: audio or video outside media/. Only the listed public media files may be "
                "published; round-2 audio stays in stage2/pilot-private/")
        if not rel.startswith("media/"):
            continue
        if p.name.startswith("."):
            warn(f"{rel}: hidden file in media/ (delete it before publishing)")
        elif rel not in allowed:
            err(f"{rel}: not one of the public media files. Round-2 versions (版本一、版本二) and any "
                "other private audio stay in stage2/pilot-private/, never in this folder")


def check_review() -> None:
    """Describer review pages: generated by gapcaster (tested there), so not held to the checks of the
    site's own pages; here only noindex, nothing external, and the files they play are next to them."""
    for d in REVIEW_DIRS:
        folder = SITE / d
        if not folder.is_dir():
            continue
        page = folder / "review_pilot.html"
        if not page.exists():
            err(f"{d}/: review_pilot.html is missing")
            continue
        text = page.read_text(encoding="utf-8")
        if not re.search(r"<meta name=\"?robots\"? content=\"?noindex", text):
            err(f"{d}/review_pilot.html: no robots noindex meta (rebuild it with the current gapcaster)")
        for ref in re.findall(r"\b(?:src|href)=\"([^\"]*)\"", text):
            if re.match(r"^(https?:)?//", ref):
                err(f"{d}/review_pilot.html: external resource {ref}")
            elif ref and not ref.startswith(("data:", "#", "blob:")) and not (folder / ref).exists():
                warn(f"{d}/review_pilot.html: {ref} does not exist yet")


# Pages and documents participants read. After removing {{NAME}} placeholders (reported
# separately), no brace may remain: a leftover such as {LINE ID x} means a placeholder was
# filled inside a Python f-string or similar and the braces would be read aloud.
PARTICIPANT_TEXT = set(PAGES) | {"consent.md", "questions.md"}


def check_text(forbid: list[str], prepublish: bool) -> None:
    # Built from parts so this file does not itself contain a home-directory prefix.
    users = "Us" + "ers"
    home_re = re.compile("(/" + users + r"/[A-Za-z0-9._-]+|/ho" + r"me/[a-z0-9._-]+|[A-Za-z]:\\" + users + r"\\)")
    email_re = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
    placeholder_re = re.compile(r"\{\{[A-Z][A-Z0-9_]*\}\}")
    try:
        import opencc  # optional, used for a second opinion on simplified characters
        s2tw = opencc.OpenCC("s2tw")
    except Exception:
        s2tw = None
    emails: dict[str, set] = {}
    for path, rel in text_files():
        text = path.read_text(encoding="utf-8")
        is_tool = rel.startswith("tools/")
        if home_re.search(text):
            err(f"{rel}: contains a home-directory path")
        for word in forbid:
            if word and word.lower() in text.lower():
                err(f"{rel}: contains a private word from the forbid file")
        for m in email_re.finditer(text):
            emails.setdefault(m.group(0), set()).add(rel)
        revealing = REVEALING_FILES if rel in REVIEW_PAGES else REVEALING
        if rel != "tools/check.py" and revealing.search(text):
            err(f"{rel}: names or maps a round-2 version ({revealing.search(text).group(0)!r}); "
                "which version is which may only be written in stage2/pilot-private/")
        if rel != "tools/check.py" and MAPPING.search(text):
            err(f"{rel}: maps a round-2 version to what it is ({MAPPING.search(text).group(0)!r}); "
                "that key belongs in stage2/pilot-private/round2-audio/ORDER.txt only")
        if rel in SECOND_ROUND_FILES and SECOND_ROUND.search(text):
            err(f"{rel}: mentions a second round or its versions ({SECOND_ROUND.search(text).group(0)!r}); "
                "the trial has one round only (25-29 November 2026)")
        if rel in PARTICIPANT_TEXT:
            rest = placeholder_re.sub("", text)
            stray = [m.start() for m in re.finditer(r"[{}]", rest)]
            for pos in stray[:5]:
                snippet = rest[max(0, pos - 25):pos + 25].replace("\n", " ")
                err(f"{rel}: stray brace (single-brace leftover of a placeholder?): …{snippet}…")
            if len(stray) > 5:
                err(f"{rel}: {len(stray) - 5} more stray brace(s)")
        if rel != "tools/check.py":
            found = sorted({ch for ch in text if ch in SIMPLIFIED})
            if found:
                err(f"{rel}: simplified characters {''.join(found)}")
            if s2tw is not None:
                cjk = "".join(ch for ch in text if "一" <= ch <= "鿿")
                conv = s2tw.convert(cjk)
                diff = sorted({a for a, b in zip(cjk, conv) if a != b})
                if diff:
                    warn(f"{rel}: OpenCC s2tw would change {''.join(diff)} (check by eye)")
        if prepublish and rel not in ("README.md",) and not is_tool:
            for m in placeholder_re.finditer(text):
                err(f"{rel}: unfilled placeholder {m.group(0)}")
            if "【待填" in text:
                err(f"{rel}: unfilled 【待填】 marker")
    for addr, files in sorted(emails.items()):
        warn(f"e-mail address {addr} in {', '.join(sorted(files))} (should only be the contact address)")


def check_gitignore() -> None:
    """.gitignore keeps `git add -A` from picking up round-2 audio and other private files.
    It is only a second line of defence: check_media() is what blocks publishing."""
    path = SITE / ".gitignore"
    if not path.exists():
        err(".gitignore is missing (it keeps round-2 audio and private files out of `git add -A`)")
        return
    lines = {unicodedata.normalize("NFC", ln.strip()) for ln in path.read_text(encoding="utf-8").splitlines()}
    for need in GITIGNORE_REQUIRED:
        if need not in lines:
            err(f".gitignore is missing the line {need}")
    for m in LISTENER_MEDIA + WRITER_MEDIA:
        if m.endswith((".mp3", ".mp4")) and "!" + m not in lines:
            err(f".gitignore does not re-include the public file {m} (add the line !{m})")
    for d in REVIEW_DIRS:
        for f in ("clip.mp4", "clip_with_ad.mp4", "lines/AD*.wav"):
            if f"!{d}/{f}" not in lines:
                err(f".gitignore does not re-include the review-page file {d}/{f} (add the line !{d}/{f})")


def load_build():
    spec = importlib.util.spec_from_file_location("gc_build", SITE / "tools" / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class LegendCollector(HTMLParser):
    """Collect, in order, every legend, option label and text-question label in listen.html."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items: list[str] = []
        self.cur: str | None = None
        self.skip_depth = 0
        self.in_setup = False
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id") == "setup":
            self.in_setup = True
            self.skip_depth = 1
            return
        if self.in_setup:
            if tag not in VOID:
                self.skip_depth += 1
            return
        if tag in ("legend", "label"):
            self.cur = ""

    def handle_endtag(self, tag):
        if self.in_setup:
            if tag not in VOID:
                self.skip_depth -= 1
                if self.skip_depth == 0:
                    self.in_setup = False
            return
        if tag in ("legend", "label") and self.cur is not None:
            t = self.cur.strip()
            if t:
                self.items.append(t)
            self.cur = None

    def handle_data(self, data):
        if self.cur is not None:
            self.cur += data


def check_sync() -> None:
    try:
        build = load_build()
    except Exception as e:  # pragma: no cover
        err(f"cannot load tools/build.py: {e}")
        return
    expected = {
        "listen.html": build.build_listen(),
        "questions.md": build.build_questions_md(),
        "questions.html": build.build_questions_html(),
        "consent.html": build.build_consent(),
    }
    for name, text in expected.items():
        path = SITE / name
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            err(f"{name} is out of date: run python3 tools/build.py")
    # Every legend/option/question label on listen.html must appear in questions.md, in order.
    listen = (SITE / "listen.html").read_text(encoding="utf-8")
    # The exposure question of each clip must be answered before any playback of that clip.
    for clip in build.CLIPS:
        c = clip["id"]
        q = listen.find(f'id="q-{c}-pre"')
        first_player = listen.find(f'src="media/{c}_')
        if q < 0:
            err(f"listen.html: clip {c} has no exposure question (q-{c}-pre)")
        elif first_player >= 0 and q > first_player:
            err(f"listen.html: clip {c}'s exposure question comes after its first player")
        sec = listen.find(f'<section aria-labelledby="h-{c}">')
        if q >= 0 and (sec < 0 or q < sec):
            err(f"listen.html: clip {c}'s exposure question is not inside the clip's section")
    if re.search(r'name="(in-)?round"|data-round|data-r2', listen):
        err("listen.html: asks for a round or keeps round-2 markup (one round only)")
    lc = LegendCollector()
    lc.feed(listen)
    md = (SITE / "questions.md").read_text(encoding="utf-8")
    skip_labels = {"結果碼（也可以自己選取複製）"}
    pos = 0
    for item in lc.items:
        if item in skip_labels:
            continue
        i = md.find(item, pos)
        if i < 0:
            err(f"questions.md is missing (or out of order): {item}")
        else:
            pos = i + len(item)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prepublish", action="store_true")
    ap.add_argument("--after-trial", action="store_true",
                    help="after 22:00 on 29 November 2026: like --prepublish, but the trial-only Chinese "
                         "synthetic voice (media/*_ad.mp3, review/) must be gone")
    ap.add_argument("--forbid-file")
    args = ap.parse_args()
    if args.after_trial:
        args.prepublish = True
    forbid: list[str] = []
    if args.forbid_file:
        forbid = [w.strip() for w in Path(args.forbid_file).read_text(encoding="utf-8").splitlines() if w.strip()]
    for page in PAGES:
        check_page(page)
    check_js()
    check_css()
    check_media()
    check_review()
    check_text(forbid, args.prepublish)
    check_sync()
    if not (SITE / ".nojekyll").exists():
        err(".nojekyll is missing (GitHub Pages would run Jekyll and mangle {{...}} text)")
    check_gitignore()
    if args.prepublish:
        for m in LISTENER_MEDIA + WRITER_MEDIA:
            if args.after_trial and m in TRIAL_ONLY_MEDIA:
                continue
            if not (SITE / m).exists():
                err(f"missing media file {m}")
    if args.after_trial:
        for m in TRIAL_ONLY_MEDIA:
            if (SITE / m).exists():
                err(f"{m} is still here: after the trial it must be removed from the site "
                    "(Chinese synthetic voice, trial material only)")
        left = [p for p in (SITE / "review").rglob("*") if p.is_file()] if (SITE / "review").exists() else []
        if left:
            err(f"review/ still holds {len(left)} file(s): after the trial the whole review/ folder "
                "must be removed from the site")
    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
