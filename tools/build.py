#!/usr/bin/env python3
"""Build listen.html, final.html, questions.md, questions.html and consent.html for the
GapCaster trial site.

One source of truth: the listener questions below are rendered both into the web page
(listen.html) and into the reference sheet for anyone who wants to see the questions first
(questions.md; there are no calls), so the two can never drift apart. The describers' final
questions are rendered into final.html (a form with a 送出 button) and into questions.md (the
copy-paste fallback). consent.html is rendered from consent.md.

Standard library only. Run from anywhere:  python3 tools/build.py
"""
from __future__ import annotations

import html
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
# v2 (23 November 2026): one trial round only (25-29 November), no round choice on any page, and the
# per-clip exposure question. v1 was never used by a participant.
# v3 (23 November 2026): open self-serve route (join.html), the listeners' vision-status question,
# the describers' experience question, and the 送出 button that posts answers to the trial inbox.
# v2 was never used by a participant.
PAGE_VERSION = "v3"

# The trial inbox. Its full address lives in assets/common.js (GC_INBOX), the only script that may
# talk to the network; pages that submit allow exactly this origin in their CSP.
INBOX_ORIGIN = "https://gapcaster-trial-inbox.pages.dev"

# ---------------------------------------------------------------------------
# Listener questions (Traditional Chinese, Taiwan usage). Edit here, then rebuild.
# key: short tag used in the result code; label: short name; text: the question.
# ---------------------------------------------------------------------------
UNDERSTOOD_NOAD = {
    "id": "understood",
    "key": "懂",
    "label": "看懂",
    "text": "聽完這個沒有口述影像的版本，你覺得自己知道畫面上發生了什麼事嗎？",
    "options": ["完全不知道", "大多不知道", "一半一半", "大多知道", "完全知道"],
}

AD_ITEMS = [
    {
        "id": "understood",
        "key": "懂",
        "label": "看懂",
        "text": "聽完這個版本，你覺得自己知道畫面上發生了什麼事嗎？",
        "options": ["完全不知道", "大多不知道", "一半一半", "大多知道", "完全知道"],
    },
    {
        "id": "content",
        "key": "內",
        "label": "內容",
        "text": "口述說的內容，也就是說了哪些事、怎麼說，對你有沒有幫助？請只評內容，不評聲音。",
        "options": ["完全沒幫助", "幫助很少", "普通", "有幫助", "非常有幫助"],
    },
    {
        "id": "clarity",
        "key": "聲",
        "label": "聲音清楚",
        "text": "口述的聲音清不清楚、好不好聽懂？請只評聲音，不評內容。",
        "options": ["完全聽不清楚", "常常聽不清楚", "普通", "大多清楚", "非常清楚"],
    },
    {
        "id": "not_covered",
        "key": "蓋",
        "label": "沒蓋到",
        "text": "口述有沒有蓋到對白或重要的聲音，例如音樂或音效？",
        "options": ["常常蓋到", "好幾次蓋到", "偶爾蓋到", "很少蓋到", "完全沒蓋到"],
    },
    {
        "id": "overall",
        "key": "整",
        "label": "整體",
        "text": "整體來說，這個版本你給幾分？",
        "options": ["很差", "差", "普通", "好", "很好"],
    },
    {
        "id": "want_more",
        "key": "想",
        "label": "想再看",
        "text": "如果有更多像這樣附口述影像的影片，你想不想看？",
        "options": ["完全不想", "不太想", "普通", "想", "非常想"],
    },
]

COMPREHENSION_HINT = "只問畫面上的事。用自己的話回答就好，不知道可以寫「不知道」。"

ENGLISH = {
    "id": "english",
    "line": "英語",
    "text": "片段 A 的英語對白，你大概聽得懂多少？",
    "hint": "這題不影響結果，只是分析時把聽得懂和聽不懂英語的人分開看。",
    "options": ["大部分聽得懂", "聽得懂一部分", "幾乎聽不懂"],
}

METHOD = {
    "id": "method",
    "line": "聽法",
    "text": "這次你用什麼裝置聽？",
    "hint": "只用來統計，不影響結果。",
    "options": ["電腦", "手機或平板", "其他"],
}

COMMENT = {
    "id": "comment",
    "line": "備註",
    "text": "還有什麼想說的嗎？（可不填）",
    "hint": "這段文字不會公開，也不會被引用。請不要寫姓名或聯絡方式。",
}

# Vision status (v3, 23 November 2026). Asked first, before clip B, of every listener (invited and
# open). Only 全盲 and 低視能 count as listeners in the analysis; 看得見 is reported separately and never
# pooled with them (a group under 3 is not shown); 不想說 is left out of the listener analysis and
# only counted. Unanswered counts as 不想說, except for an invited listener, whose self-description at
# recruitment is used (eval-protocol.md, Amendment 2). It is in the result code as its own line,
# e.g. "視力 全盲".
VISION = {
    "id": "vision",
    "line": "視力",
    "label": "視力狀況",
    "text": "你的視力狀況是？",
    "hint": ("這一題決定你的作答怎麼統計：選「全盲」或「低視能」，算進聽眾的結果；選「看得見」，另外統計，"
             "不和全盲、低視能的結果合在一起；選「不想說」，不放進聽眾的分析，只算人數。"
             "沒有回答這一題，當作「不想說」；受邀參加的人，改用報名時說的視力狀況。不論怎麼選，都可以照常做完。"),
    "options": ["全盲", "低視能", "看得見", "不想說"],
}

# Exposure question, one per clip (pre-registered before the trial): before this trial, had the
# participant already heard an audio description of the clip's film, or read or reviewed an audio
# description script of it? Listeners answer it on the listen page before the clip's
# first playback; describers answer it with their final questions. Analysis rule: 有 takes that
# participant's data for that clip out of the main analysis (reported as a count only); 不確定 stays
# in and is counted. Taking part and pay are unaffected. It names only the two trial films.
EXPOSURE = {
    "line": "先前",
    "label": "以前接觸過",
    "text": "在參加這次試用以前，你有沒有聽過{film}的口述影像，或讀過、審閱過它的口述影像稿？",
    "listener_hint": ("請在播放這段片以前回答。沒聽過也沒讀過，選「沒有」；記不清楚，選「不確定」。"
                      "不論怎麼回答，都可以照常做完；受邀參加的人，酬勞也照付。"),
    "writer_hint": ("這次試用裡看到的草稿、你自己寫的和改的都不算。記不清楚，選「不確定」。"
                    "不論怎麼回答，受邀參加的人酬勞都照付。"),
    "options": ["沒有", "有", "不確定"],
}

# Clip B is the primary listener clip, so it comes first: if someone stops early we still have it.
CLIPS = [
    {
        "id": "B",
        "title_html": "片段 B：《Spring》",
        "title_md": "片段 B：《Spring》",
        "desc": "Blender 動畫，沒有對白，約 80 到 90 秒。",
        "question": "片中的女孩手上一直拿著什麼東西？",
        "english": False,
        # Film name as used in the exposure question (plain text, and HTML with language marks).
        "film_text": "《Spring》（片段 B）",
        "film_html": "《Spring》（片段 B）",
    },
    {
        "id": "A",
        "title_html": '片段 A：<span lang="en">Tears of Steel</span>',
        "title_md": "片段 A：Tears of Steel",
        "desc": "科幻短片的開頭 0:00 到 1:22，有英語對白。",
        "question": "片中有一張桌子上放著一個模型。那是什麼東西的模型？",
        "english": True,
        "film_text": " Tears of Steel（片段 A）",
        "film_html": ' <span lang="en">Tears of Steel</span>（片段 A）',
    },
]

# Versions per clip, in the order they are played. One trial round only (25-29 November 2026):
#   N  no audio description (media/<clip>_noad.mp3).
#   1  the raw R16 draft with audio description (media/<clip>_ad.mp3). The result-code tag 一 is
#      kept from v1 for continuity; there is no second described version.
# Describers' edited text is never voiced for listeners, so no other audio exists for this page.
VERSIONS = [
    {"slot": "N", "line": "無", "field": "no_ad", "heading": "先聽，沒有口述影像的版本", "src": "{clip}_noad.mp3"},
    {"slot": "1", "line": "一", "field": "ad", "heading": "再聽，有口述影像的版本", "src": "{clip}_ad.mp3"},
]


def exposure_legend(clip: dict, html_marks: bool = False) -> str:
    """The exposure question for one clip; HTML (already escaped, with lang marks) when asked."""
    if html_marks:
        return esc(EXPOSURE["text"]).replace("{film}", clip["film_html"])
    return EXPOSURE["text"].format(film=clip["film_text"])

HEAD = """<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self'; connect-src {connect}; form-action 'none'; base-uri 'none'; object-src 'none'">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>{title}</title>
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<a class="skip" href="#main">跳到主要內容</a>
<header class="site-header"><nav aria-label="網站"><a href="index.html">GapCaster 口述影像試用</a></nav></header>
<main id="main">
"""

FOOT = """</main>
<footer class="site-footer">
<p>GapCaster 試用網站 {version}。{note}</p>
</footer>
{scripts}</body>
</html>
"""
# Footer notes: pages that can submit, and pages that never send anything.
NOTE_SUBMIT = "只有按「送出」，這個網頁才會把作答傳給 Ted。"
NOTE_NONE = "這個網頁不會送出任何資料。"
CONNECT_NONE = "'none'"


def head(title: str, submit: bool = False) -> str:
    """Page head. A page that submits allows exactly the inbox origin in connect-src."""
    return HEAD.format(title=title, connect=INBOX_ORIGIN if submit else CONNECT_NONE)


def foot(scripts: str, submit: bool = False) -> str:
    return FOOT.format(version=PAGE_VERSION, note=NOTE_SUBMIT if submit else NOTE_NONE, scripts=scripts)

GENERATED_NOTE = "<!-- Generated by tools/build.py. Edit the source there, then rebuild. -->\n"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def opt_label(i: int, text: str) -> str:
    return f"{i} 分：{text}"


def question_html(qid: str, name: str, legend: str, options: list[str], line: str, key: str,
                  numbered_scale: bool = True, hint: str | None = None, legend_html: str | None = None,
                  field: str | None = None) -> str:
    """A radio group: fieldset, legend, optional hint, one label per option. legend_html, when given,
    is already-escaped HTML for the legend (for lang marks); otherwise legend is escaped here.
    field is the dotted path of the answer in the submitted payload (e.g. "B.ad.content")."""
    described = f' aria-describedby="{qid}-hint"' if hint else ""
    fattr = f' data-field="{esc(field)}"' if field else ""
    out = [f'<fieldset id="{qid}" data-line="{esc(line)}" data-key="{esc(key)}"{fattr}{described}>',
           f"<legend>{legend_html if legend_html is not None else esc(legend)}</legend>"]
    if hint:
        out.append(f'<p class="hint" id="{qid}-hint">{esc(hint)}</p>')
    for i, text in enumerate(options, start=1):
        rid = f"{qid}-{i}"
        value = str(i) if numbered_scale else text
        label = opt_label(i, text) if numbered_scale else text
        out.append(f'<label class="opt" for="{rid}"><input type="radio" id="{rid}" name="{name}" value="{esc(value)}"> {esc(label)}</label>')
    out.append("</fieldset>")
    return "\n".join(out)


def legend_for(item: dict, number: int | None) -> str:
    prefix = f"第{number}題　" if number is not None else ""
    return f"{prefix}{item['label']}：{item['text']}"


def comprehension_text(clip: dict) -> str:
    q = clip["question"]
    if "{{" in q:
        return f"【待填理解題】{q}"
    return q


def build_listen() -> str:
    parts = [head("聆聽試用｜GapCaster", submit=True), GENERATED_NOTE]
    parts.append("""<h1>口述影像聆聽試用</h1>
<p id="who" class="panel">還沒有代號。受邀參加的人，請用 Ted 傳給你的個人連結開啟這一頁，或在下面輸入代號。公開參加的人，請先到<a href="join.html">參加頁</a>取得代號。</p>

<section aria-labelledby="h-start">
<h2 id="h-start">開始之前</h2>
<ul>
<li>試用時間是 2026 年 11 月 25 日（星期三）到 11 月 29 日（星期日）晚上 10 點（臺北時間）。請在這段時間內做完並按「送出作答」。試用結束以後，有口述影像的版本會從網站移除，就不能再播放。</li>
<li>請戴耳機，或在安靜的地方聽。</li>
<li>做完以前，請不要另外找這兩段片的影片來看；這一頁只用聲音。</li>
<li>最前面先回答一題：你的視力狀況。</li>
<li>每段片開始播放以前，請先回答一題：在這次試用以前，你有沒有聽過這段片的口述影像，或讀過、審閱過它的口述影像稿。</li>
<li>然後先聽沒有口述影像的版本，再聽有口述影像的版本。每個版本聽完，再回答它下面的題目。</li>
<li>口述影像是 AI 寫的草稿，用合成語音唸出來。</li>
<li>播放器不會自動播放，請自己按「播放」。每個版本都可以重聽。</li>
<li>每一題都可以不答。不想做了隨時可以停止。受邀參加的人，停止也照付酬勞；公開參加沒有酬勞。</li>
<li>全部做完，請在頁面最後按「送出作答」，作答會傳到 Ted 在 Cloudflare 的儲存空間。按下以前，作答只暫存在這臺裝置的瀏覽器，不會送出。送不出去的時候，可以改用「複製結果碼」，用 email 傳給 Ted：tedinroc@gmail.com（受邀參加的人也可以用 LINE）。</li>
<li>理解題和備註請不要寫姓名或聯絡方式。</li>
<li>參加前請先看<a href="consent.html">試用同意書</a>。</li>
</ul>

<div id="setup" hidden>
<h3 id="h-setup">輸入代號</h3>
<form id="setup-form" aria-labelledby="h-setup" novalidate>
<label class="block" for="in-code">你的代號（Ted 給你的，例如 L07；公開參加的人，用參加頁給你的代號：OL- 開頭，後面 5 個字）</label>
<input type="text" id="in-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false">
<button type="submit" class="btn">用這個代號開始</button>
</form>
<p>公開參加、還沒有代號的人，請先到<a href="join.html">參加頁</a>。</p>
</div>
</section>
""")

    # Vision status: the very first question, before clip B.
    parts.append('\n<section aria-labelledby="h-vision">')
    parts.append(f'<h2 id="h-vision">先回答：{esc(VISION["label"])}</h2>')
    parts.append(question_html("q-vision", "vision", VISION["text"], VISION["options"], VISION["line"], "",
                               numbered_scale=False, hint=VISION["hint"], field=VISION["id"]))
    parts.append("</section>")

    for clip in CLIPS:
        c = clip["id"]
        parts.append(f'\n<section aria-labelledby="h-{c}">')
        parts.append(f'<h2 id="h-{c}">{clip["title_html"]}</h2>')
        parts.append(f"<p>{esc(clip['desc'])}</p>")
        # Exposure question: inside the clip's section and before its first player, so it is
        # answered before any playback of this clip.
        parts.append("<div>")
        parts.append(f'<h3 id="h-{c}-pre">{esc(c)}：聽之前先回答</h3>')
        parts.append(question_html(f"q-{c}-pre", f"{c}-pre", exposure_legend(clip), EXPOSURE["options"],
                                   c + EXPOSURE["line"], "", numbered_scale=False,
                                   hint=EXPOSURE["listener_hint"], legend_html=exposure_legend(clip, True),
                                   field=f"{c}.exposure"))
        parts.append("</div>")
        for v in VERSIONS:
            slot = v["slot"]
            hid = f"h-{c}-{slot}"
            src = "media/" + v["src"].format(clip=c)
            parts.append("<div>")
            parts.append(f'<h3 id="{hid}">{esc(c + "：" + v["heading"])}</h3>')
            parts.append(f'<audio controls preload="none" src="{src}" aria-labelledby="{hid}"></audio>')
            parts.append(f'<p class="fallback">播放器不好用的話，可以<a href="{src}">直接開啟這個音檔</a>。</p>')
            line = c + v["line"]
            if slot == "N":
                item = UNDERSTOOD_NOAD
                parts.append(question_html(f"q-{c}-{slot}-1", f"{c}-{slot}-1", legend_for(item, None),
                                           item["options"], line, item["key"],
                                           field=f"{c}.{v['field']}.{item['id']}"))
            else:
                for n, item in enumerate(AD_ITEMS, start=1):
                    parts.append(question_html(f"q-{c}-{slot}-{n}", f"{c}-{slot}-{n}", legend_for(item, n),
                                               item["options"], line, item["key"],
                                               field=f"{c}.{v['field']}.{item['id']}"))
            parts.append("</div>")
        # Comprehension question (screen content only), asked once per clip after the described version.
        qid = f"q-{c}-comp"
        parts.append(f'<h3 id="h-{c}-comp">{esc(c)}：理解題</h3>')
        parts.append(f'<label class="block" for="{qid}">{esc(comprehension_text(clip))}</label>')
        parts.append(f'<p class="hint" id="{qid}-hint">{esc(COMPREHENSION_HINT)}</p>')
        parts.append(f'<input type="text" id="{qid}" name="{c}-comp" data-line="{c}理解" data-field="{c}.comprehension" aria-describedby="{qid}-hint" autocomplete="off">')
        if clip["english"]:
            parts.append(question_html(f"q-{c}-en", f"{c}-en", ENGLISH["text"], ENGLISH["options"],
                                       ENGLISH["line"], "", numbered_scale=False, hint=ENGLISH["hint"],
                                       field=f"{c}.{ENGLISH['id']}"))
        parts.append("</section>")

    parts.append(f"""
<section aria-labelledby="h-end">
<h2 id="h-end">最後兩題</h2>
{question_html("q-method", "method", METHOD["text"], METHOD["options"], METHOD["line"], "", numbered_scale=False, hint=METHOD["hint"], field=METHOD["id"])}
<label class="block" for="q-comment">{esc(COMMENT["text"])}</label>
<p class="hint" id="q-comment-hint">{esc(COMMENT["hint"])}</p>
<textarea id="q-comment" name="comment" data-line="{COMMENT["line"]}" data-field="{COMMENT["id"]}" aria-describedby="q-comment-hint" rows="4"></textarea>
</section>
""")
    # Plain (non-f) string on purpose: tools/fill.py replaces the contact placeholder inside this
    # file, and inside an f-string the doubled braces would survive as literal braces on the page.
    parts.append("""
<section aria-labelledby="h-send">
<h2 id="h-send">送出</h2>
<p>按「送出作答」，你的代號、各題的回答和下面的結果碼，會傳到 Ted 在 Cloudflare 的儲存空間。按下以前，什麼都不會送出。送出以後又改了作答，可以再送一次，Ted 用最後一次送出的版本。</p>
<p id="unanswered" class="muted"></p>
<div class="btn-row">
<button type="button" class="btn" id="send">送出作答</button>
</div>
<p id="send-status" class="status" role="status" aria-live="polite"></p>
<p id="send-receipt" class="muted"></p>
<div id="send-help" class="warn" hidden>
<p>送不出去也沒關係，作答還在這臺裝置上。可以稍後再按一次「送出作答」，或用下面的「複製結果碼」，貼到 email 寄給 Ted：tedinroc@gmail.com（受邀參加的人也可以用 LINE）。用 email 或 LINE 傳，Ted 會看到你的 email 地址或 LINE 名稱。</p>
</div>
</section>

<section aria-labelledby="h-result">
<h2 id="h-result">結果碼（送不出去的時候用）</h2>
<p>送出不成功時，按「複製結果碼」，再打開 email，貼上並寄給 Ted：tedinroc@gmail.com（受邀參加的人也可以用 LINE）。結果碼的內容和「送出作答」送出的一樣。</p>
<div class="btn-row">
<button type="button" class="btn secondary" id="copy">複製結果碼</button>
<button type="button" class="btn secondary" id="share" hidden>分享結果碼（手機）</button>
</div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<label class="block" for="code-out">結果碼（也可以自己選取複製）</label>
<textarea id="code-out" class="code" readonly rows="16"></textarea>

<h3 id="h-clear">清除作答</h3>
<p>作答暫存在這臺裝置的瀏覽器裡，方便你中途離開再回來。送出成功以後，可以按下面的按鈕刪除。</p>
<button type="button" class="btn secondary" id="clear">清除這臺裝置上的作答</button>
</section>
""")
    scripts = '<script src="assets/common.js"></script>\n<script src="assets/listen.js"></script>\n'
    parts.append(foot(scripts, submit=True))
    return "\n".join(parts)


def md_options(options: list[str], numbered: bool = True) -> list[str]:
    return [f"  - {opt_label(i, t) if numbered else t}" for i, t in enumerate(options, start=1)]


def build_questions_md() -> str:
    L: list[str] = []
    L.append("# 題目稿（聽眾）和撰稿人問題")
    L.append("")
    L.append("> 這份題目和聆聽頁 `listen.html`、撰稿人最後的問題頁 `final.html` 完全一樣：都由 `tools/build.py` 從同一份題目產生。"
             "要改題目，請改 `tools/build.py` 再執行 `python3 tools/build.py`，不要只改其中一邊。")
    L.append("")
    L.append("這次全部在試用網站上自己作答，沒有電話、通話或現場場次。這份只給想先看題目的人參考。")
    L.append("")
    L.append(f"## 開始前：{VISION['label']}")
    L.append("")
    L.append(f"還沒播放任何音檔以前，先問這一題，把選項全部唸出來。結果碼裡這一行的開頭是「{VISION['line']}」。")
    L.append("")
    L.append(f"**{VISION['text']}**（{VISION['hint']}）")
    L.append("")
    L.extend(o.replace("  - ", "- ", 1) for o in md_options(VISION["options"], numbered=False))
    L.append("")

    for clip in CLIPS:
        c = clip["id"]
        L.append(f"## {clip['title_md']}")
        L.append("")
        L.append(clip["desc"])
        L.append("")
        L.append(f"### {c}：聽之前先回答")
        L.append("")
        L.append(f"還沒播放 {c} 的任何音檔以前，先回答這一題。不論怎麼回答，都照常往下做。"
                 f"結果碼裡這一行的開頭是「{c}{EXPOSURE['line']}」。")
        L.append("")
        L.append(f"**{exposure_legend(clip)}**（{EXPOSURE['listener_hint']}）")
        L.append("")
        L.extend(o.replace("  - ", "- ", 1) for o in md_options(EXPOSURE["options"], numbered=False))
        L.append("")
        for v in VERSIONS:
            slot = v["slot"]
            src = v["src"].format(clip=c)
            L.append(f"### {c}：{v['heading']}")
            L.append("")
            if slot == "N":
                play = f"播放 {c} 沒有口述影像的版本（網站上的 `media/{src}`）。"
            else:
                play = f"播放 {c} 有口述影像的版本（網站上的 `media/{src}`，GapCaster 的原始草稿）。"
            L.append(f"{play}聽完再回答。結果碼裡這一行的開頭是「{c}{v['line']}」。")
            L.append("")
            items = [(None, UNDERSTOOD_NOAD)] if slot == "N" else list(enumerate(AD_ITEMS, start=1))
            for n, item in items:
                L.append(f"- **{legend_for(item, n)}**")
                L.extend(md_options(item["options"]))
            L.append("")
        L.append(f"### {c}：理解題")
        L.append("")
        L.append(f"**{comprehension_text(clip)}**")
        L.append("")
        L.append(f"（{COMPREHENSION_HINT}）")
        L.append("")
        if clip["english"]:
            L.append(f"**{ENGLISH['text']}**（{ENGLISH['hint']}）")
            L.append("")
            L.extend(o.replace("  - ", "- ", 1) for o in md_options(ENGLISH["options"], numbered=False))
            L.append("")

    L.append("## 最後兩題")
    L.append("")
    L.append(f"**{METHOD['text']}**（{METHOD['hint']}）")
    L.append("")
    L.extend(o.replace("  - ", "- ", 1) for o in md_options(METHOD["options"], numbered=False))
    L.append("")
    L.append(f"**{COMMENT['text']}**（{COMMENT['hint']}）")
    L.append("")
    L.append("## 結束")
    L.append("")
    L.append("在聆聽頁最後按「送出作答」，看到收件編號就完成了。")
    L.append("")
    L.append("## 撰稿人做完以後的問題")
    L.append("")
    L.append("四個半段（兩個從零撰寫、兩個修改草稿）全部做完以後再回答。請用[最後的問題頁](final.html)回答，"
             "答完按「送出回答」。題目和這裡一樣。送不出去的時候，也可以把答案寫在 email 裡寄給 Ted（格式在這一節最後）。"
             "請不要寫姓名或聯絡方式。")
    L.append("")
    L.append(f"### {len(WRITER_ITEMS)} 個 1 到 5 分的問題")
    L.append("")
    for n, item in enumerate(WRITER_ITEMS, start=1):
        L.append(f"- **{legend_for(item, n)}**")
        L.extend(md_options(item["options"]))
    L.append("")
    L.append("### 每段片一題：以前接觸過嗎")
    L.append("")
    L.append(f"選「沒有」「有」或「不確定」。{EXPOSURE['writer_hint']}")
    L.append("")
    for n, clip in writer_exposure_numbered():
        L.append(f"- **第{n}題　{EXPOSURE['label']}：{exposure_legend(clip)}**")
        L.extend(md_options(EXPOSURE["options"], numbered=False))
    L.append("")
    L.append(f"### {TRAINING['label']}")
    L.append("")
    L.append(f"{TRAINING['hint']}")
    L.append("")
    L.append(f"- **{legend_for(TRAINING, training_number())}**")
    L.extend(md_options(TRAINING["options"], numbered=False))
    L.append("")
    L.append(f"### {WRITER_COMMENT['label']}")
    L.append("")
    L.append(f"**{WRITER_COMMENT['text']}**（{WRITER_COMMENT['hint']}）")
    L.append("")
    L.append("### 用 email 回答的格式（送不出去的時候）")
    L.append("")
    L.append("最後的問題頁送出成功，就不用寄這段。要用 email 回答，可以直接複製這段：「分數」那一行每個「_」換成 1 到 5 分；「"
             + "」「".join(c["id"] + EXPOSURE["line"] for c in writer_exposure_clips())
             + "」後面換成「沒有」「有」或「不確定」；「" + TRAINING["line"] + "」後面換成「有」或「沒有」。"
             "最後的問題頁產生的回覆文字也是這個格式。")
    L.append("")
    L.append("```")
    L.append(f"GapCaster 撰稿人問題 {PAGE_VERSION}")
    L.append("代號 W__")
    L.append(WRITER_SCORE_LINE + " " + " ".join(f"{item['key']}_" for item in WRITER_ITEMS))
    for c in writer_exposure_clips():
        L.append(f"{c['id']}{EXPOSURE['line']} _")
    L.append(f"{TRAINING['line']} _")
    L.append(f"{WRITER_COMMENT['line']} （可不填）")
    L.append("```")
    L.append("")
    L.append("結果碼格式和各欄位的意思，請看 `README.md` 的「結果碼格式」。")
    L.append("")
    return "\n".join(L)


# Describers answer the exposure question for clip A, then clip B (they have no fixed clip order).
WRITER_EXPOSURE_ORDER = ("A", "B")


def writer_exposure_clips() -> list[dict]:
    by_id = {c["id"]: c for c in CLIPS}
    return [by_id[i] for i in WRITER_EXPOSURE_ORDER]


WRITER_ITEMS = [
    {
        "id": "effort",
        "key": "省力",
        "label": "省力",
        "text": "修改 GapCaster 草稿的那一半，和從零撰寫的那一半比起來，省不省力？",
        "options": ["費力很多", "費力一些", "差不多", "省力一些", "省力很多"],
    },
    {
        "id": "accuracy",
        "key": "正確",
        "label": "正確",
        "text": "GapCaster 草稿描述的畫面，整體來說正確嗎？",
        "options": ["錯很多", "錯不少", "一半一半", "大多正確", "幾乎都正確"],
    },
    {
        "id": "would_use",
        "key": "想用",
        "label": "想用",
        "text": "如果之後能用 GapCaster 產生草稿，你會想在工作中使用嗎？",
        "options": ["完全不想", "不太想", "看情況", "想", "非常想"],
    },
]
# The three ratings share one line of the reply text: "分數 省力4 正確3 想用5".
WRITER_SCORE_LINE = "分數"

# Experience question (v3, 23 November 2026), asked of every describer with the final questions.
# The rule applies to the open route only (eval-protocol.md, Amendment 2, item 6): an open describer
# counts toward the describer analysis only with 有; 沒有 is reported separately; unanswered is left
# out. Invited describers count whatever they answer; their answers are reported as counts.
TRAINING = {
    "id": "trained",
    "line": "經驗",
    "label": "撰稿經驗",
    "text": "你寫過口述影像，或受過口述影像訓練嗎？",
    "hint": ("公開參加的撰稿人，只有回答「有」的作答會算進撰稿人的結果；回答「沒有」的另外統計，不和撰稿人的結果合在一起；"
             "沒有回答的，不算進撰稿人的結果。受邀參加的撰稿人不論怎麼回答，都算進撰稿人的結果。不論怎麼回答，都可以送出。"),
    "options": ["有", "沒有"],
}

WRITER_COMMENT = {
    "id": "comment",
    "line": "備註",
    "label": "備註",
    "text": "還有什麼想說的嗎？例如審閱頁哪一句的時間點不對，請寫片段、前半或後半、第幾句。（可不填）",
    "hint": "這段文字不會公開，也不會被引用。請不要寫姓名或聯絡方式。",
}


def writer_exposure_numbered() -> list[tuple[int, dict]]:
    return list(enumerate(writer_exposure_clips(), start=len(WRITER_ITEMS) + 1))


def training_number() -> int:
    return len(WRITER_ITEMS) + len(WRITER_EXPOSURE_ORDER) + 1


def build_final() -> str:
    """final.html: the describers' final questions as a form with a 送出 button (kind writer-final)."""
    parts = [head("撰稿人最後的問題｜GapCaster", submit=True), GENERATED_NOTE]
    n_items = training_number()
    parts.append(f"""<h1>撰稿人最後的問題</h1>
<p id="who" class="panel">還沒有代號。請用工作清單或 Ted 給你的連結開啟這一頁，或在下面輸入代號。</p>

<section aria-labelledby="h-start">
<h2 id="h-start">開始之前</h2>
<ul>
<li>四個半段（兩個從零撰寫、兩個修改草稿）全部做完以後再回答。</li>
<li>一共 {n_items} 題，加上可不填的備註。每一題都可以不答。</li>
<li>答完按頁面最後的「送出回答」，回答會傳到 Ted 在 Cloudflare 的儲存空間。按下以前，什麼都不會送出。</li>
<li>送不出去的時候，可以複製頁面最後的回覆文字，用 email 傳給 Ted：tedinroc@gmail.com。</li>
<li>備註請不要寫姓名或聯絡方式。</li>
</ul>
<div id="setup" hidden>
<h3 id="h-setup">輸入代號</h3>
<form id="setup-form" aria-labelledby="h-setup" novalidate>
<label class="block" for="in-code">你的代號（Ted 給你的，例如 W03；公開參加的人，用參加頁給你的代號：OW- 開頭，後面 5 個字）</label>
<input type="text" id="in-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false">
<button type="submit" class="btn">用這個代號開始</button>
</form>
</div>
</section>
""")
    parts.append('\n<section aria-labelledby="h-scores">')
    parts.append(f'<h2 id="h-scores">{len(WRITER_ITEMS)} 個 1 到 5 分的問題</h2>')
    for n, item in enumerate(WRITER_ITEMS, start=1):
        parts.append(question_html(f"q-w-{item['id']}", f"w-{item['id']}", legend_for(item, n), item["options"],
                                   WRITER_SCORE_LINE, item["key"], field=item["id"]))
    parts.append("</section>")
    parts.append('\n<section aria-labelledby="h-exposure">')
    parts.append('<h2 id="h-exposure">每段片一題：以前接觸過嗎</h2>')
    for n, clip in writer_exposure_numbered():
        c = clip["id"]
        legend = f"第{n}題　{EXPOSURE['label']}：{exposure_legend(clip)}"
        legend_html = f"第{n}題　{esc(EXPOSURE['label'])}：{exposure_legend(clip, True)}"
        parts.append(question_html(f"q-w-{c}-pre", f"w-{c}-pre", legend, EXPOSURE["options"], c + EXPOSURE["line"], "",
                                   numbered_scale=False, hint=EXPOSURE["writer_hint"], legend_html=legend_html,
                                   field=f"exposure.{c}"))
    parts.append("</section>")
    parts.append('\n<section aria-labelledby="h-trained">')
    parts.append(f'<h2 id="h-trained">{esc(TRAINING["label"])}</h2>')
    parts.append(question_html("q-w-trained", "w-trained", legend_for(TRAINING, training_number()), TRAINING["options"],
                               TRAINING["line"], "", numbered_scale=False, hint=TRAINING["hint"], field=TRAINING["id"]))
    parts.append("</section>")
    parts.append(f"""
<section aria-labelledby="h-note">
<h2 id="h-note">{esc(WRITER_COMMENT["label"])}</h2>
<label class="block" for="q-w-comment">{esc(WRITER_COMMENT["text"])}</label>
<p class="hint" id="q-w-comment-hint">{esc(WRITER_COMMENT["hint"])}</p>
<textarea id="q-w-comment" name="w-comment" data-line="{WRITER_COMMENT["line"]}" data-field="{WRITER_COMMENT["id"]}" aria-describedby="q-w-comment-hint" rows="4"></textarea>
</section>
""")
    parts.append("""
<section aria-labelledby="h-send">
<h2 id="h-send">送出</h2>
<p>按「送出回答」，你的代號、各題的回答和下面的回覆文字，會傳到 Ted 在 Cloudflare 的儲存空間。按下以前，什麼都不會送出。送出以後又改了回答，可以再送一次，Ted 用最後一次送出的版本。</p>
<p id="unanswered" class="muted"></p>
<div class="btn-row">
<button type="button" class="btn" id="send">送出回答</button>
</div>
<p id="send-status" class="status" role="status" aria-live="polite"></p>
<p id="send-receipt" class="muted"></p>
<div id="send-help" class="warn" hidden>
<p>送不出去也沒關係，回答還在這臺裝置上。可以稍後再按一次「送出回答」，或用下面的「複製回覆文字」，貼到 email 寄給 Ted：tedinroc@gmail.com。用 email 寄，Ted 會看到你的 email 地址。</p>
</div>
</section>

<section aria-labelledby="h-reply">
<h2 id="h-reply">回覆文字（送不出去的時候用）</h2>
<div class="btn-row">
<button type="button" class="btn secondary" id="copy">複製回覆文字</button>
</div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<label class="block" for="reply-out">回覆文字（也可以自己選取複製）</label>
<textarea id="reply-out" class="code" readonly rows="10"></textarea>
<h3 id="h-clear">清除回答</h3>
<p>回答暫存在這臺裝置的瀏覽器裡。送出成功以後，可以按下面的按鈕刪除。</p>
<button type="button" class="btn secondary" id="clear">清除這臺裝置上的回答</button>
</section>
""")
    scripts = '<script src="assets/common.js"></script>\n<script src="assets/final.js"></script>\n'
    parts.append(foot(scripts, submit=True))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Minimal Markdown subset -> HTML for consent.md (headings, paragraphs, nested lists,
# fenced code, **bold**, `code`). Enough for this one document; no dependencies.
# ---------------------------------------------------------------------------
def md_inline(s: str) -> str:
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    # [text](page.html): links to pages of this site only (no external addresses).
    s = re.sub(r"\[([^\]]+)\]\(([a-z0-9][a-z0-9_./-]*\.(?:html|md))\)", r'<a href="\2">\1</a>', s)
    return s


LIST_RE = re.compile(r"^( *)(- |\d+\. )(.*)$")


def md_to_html(md: str) -> str:
    lines = md.split("\n")
    out: list[str] = []
    i = 0
    para: list[str] = []
    heading_ids = 0

    def flush_para():
        if para:
            out.append("<p>" + md_inline(" ".join(x.strip() for x in para)) + "</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush_para()
            # A fence label such as ```licence becomes id="tpl-licence", so page scripts can reuse
            # the exact text of the document instead of keeping a second copy.
            info = line[3:].strip()
            pre_id = f' id="tpl-{info}"' if re.fullmatch(r"[a-z][a-z0-9-]*", info) else ""
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            out.append(f'<pre class="code"{pre_id}>' + esc("\n".join(block)) + "</pre>")
            i += 1
            continue
        if line.startswith("> "):
            flush_para()
            quote = []
            while i < len(lines) and lines[i].startswith("> "):
                quote.append(lines[i][2:])
                i += 1
            out.append("<blockquote><p>" + md_inline(" ".join(q.strip() for q in quote)) + "</p></blockquote>")
            continue
        m = re.match(r"^(#{1,4}) (.*)$", line)
        if m:
            flush_para()
            level = len(m.group(1))
            heading_ids += 1
            out.append(f'<h{level} id="s{heading_ids}">{md_inline(m.group(2))}</h{level}>')
            i += 1
            continue
        if LIST_RE.match(line):
            flush_para()
            block = []
            while i < len(lines) and (LIST_RE.match(lines[i]) or (lines[i].startswith("  ") and lines[i].strip())):
                block.append(lines[i])
                i += 1
            out.append(render_list(block))
            continue
        if not line.strip():
            flush_para()
            i += 1
            continue
        para.append(line)
        i += 1
    flush_para()
    return "\n".join(out)


def render_list(block: list[str]) -> str:
    # Parse into (indent, ordered, text) items, then build nested lists by indent.
    items = []
    for line in block:
        m = LIST_RE.match(line)
        if m:
            items.append([len(m.group(1)), m.group(2) != "- ", m.group(3)])
        elif items:
            items[-1][2] += " " + line.strip()
    html_out: list[str] = []
    stack: list[tuple[int, str]] = []  # (indent, tag)
    for indent, ordered, text in items:
        tag = "ol" if ordered else "ul"
        while stack and indent < stack[-1][0]:
            html_out.append(f"</li></{stack.pop()[1]}>")
        if stack and indent == stack[-1][0]:
            html_out.append("</li>")
        if not stack or indent > stack[-1][0]:
            html_out.append(f"<{tag}>")
            stack.append((indent, tag))
        html_out.append("<li>" + md_inline(text))
    while stack:
        html_out.append(f"</li></{stack.pop()[1]}>")
    return "".join(html_out)


CONSENT_FORM = """
<section aria-labelledby="h-reply">
<h2 id="h-reply">同意並送出（只要一次）</h2>
<p><strong>受邀參加的人</strong>：打開 Ted 傳給你的連結，代號就會帶入。勾選下面每一項（撰稿人再回答第 7 節的選項），按「同意並送出」，看到收件編號就完成了，不用再用 email 或 LINE 回覆，換裝置也不用再同意。2026 年 11 月 25 日凌晨 0 點（臺北時間）起才能送出。</p>
<p><strong>公開參加的人</strong>在<a href="join.html">參加頁</a>按「同意並送出」就完成了，不用在這裡再做一次。只有參加頁顯示同意紀錄沒送到（例如網路斷了）時，才在這裡填你的代號，再按一次「同意並送出」。</p>
<label class="block" for="c-code">你的代號（Ted 給你的，例如 W03-K7QXM 或 L07-Q4DXM）</label>
<input type="text" id="c-code" autocomplete="off" autocapitalize="characters" spellcheck="false">
<fieldset id="c-role">
<legend>你的身分（必選）</legend>
<label class="opt" for="c-role-l"><input type="radio" id="c-role-l" name="c-role" value="聽眾"> 聽眾</label>
<label class="opt" for="c-role-w"><input type="radio" id="c-role-w" name="c-role" value="撰稿人"> 撰稿人</label>
</fieldset>
<fieldset id="c-agree-set">
<legend>請確認下面每一項（都要勾）</legend>
<label class="opt" for="c-a1"><input type="checkbox" id="c-a1"> 我年滿 18 歲。</label>
<label class="opt" for="c-a2"><input type="checkbox" id="c-a2"> 我讀過試用同意書 v4。</label>
<label class="opt" for="c-a3"><input type="checkbox" id="c-a3"> 我同意參加這次試用。</label>
<span id="c-open-item" hidden><label class="opt" for="c-a4"><input type="checkbox" id="c-a4"> 我了解公開參加沒有酬勞。</label></span>
<label class="opt" for="c-a5"><input type="checkbox" id="c-a5"> 我不會在作答裡寫姓名或聯絡方式。</label>
</fieldset>
<div id="c-writer" hidden>
<fieldset id="c-text">
<legend>選項 A：你的文字可以放進參賽作品嗎？（必選）</legend>
<label class="opt" for="c-text-yes"><input type="radio" id="c-text-yes" name="c-text" value="可以"> 可以放進作品</label>
<label class="opt" for="c-text-no"><input type="radio" id="c-text-no" name="c-text" value="不要"> 不要放進作品</label>
</fieldset>
<div id="c-sign-wrap" hidden>
<fieldset id="c-sign">
<legend>選項 A-1：如果主辦單位依規則要求簽署的授權文件，你願意提供本名並簽署嗎？（必選）</legend>
<label class="opt" for="c-sign-yes"><input type="radio" id="c-sign-yes" name="c-sign" value="願意"> 願意：我在下面打上本名，同意第 7 節的授權聲明</label>
<label class="opt" for="c-sign-no"><input type="radio" id="c-sign-no" name="c-sign" value="不願意"> 不願意：我的文字只用來計算數字，不放進作品</label>
</fieldset>
<div id="c-licence-wrap" hidden>
<p class="panel">請看上面第 7 節最後的「授權聲明」。打上你的本名並勾選同意，就完成授權。本名只和這一次的同意紀錄一起存在 Ted 在 Cloudflare 的收件伺服器（伺服器可能在臺灣以外，2027 年 3 月 1 日前自動刪除）；Ted 匯出的副本只存在私人資料夾。本名不公開、不交給 AI 分析工具（第 7、9、11 節）。</p>
<label class="block" for="c-name">你的本名（必填；只用在授權聲明）</label>
<input type="text" id="c-name" autocomplete="off" maxlength="60" spellcheck="false">
<fieldset id="c-lic">
<legend>授權聲明（必勾）</legend>
<label class="opt" for="c-lic-ok"><input type="checkbox" id="c-lic-ok"> 我同意第 7 節的「授權聲明」，並以上面的本名簽署。</label>
</fieldset>
<fieldset id="c-ccby">
<legend>選項 B：要不要用 CC BY 4.0 公開你的文字？（可不選）</legend>
<label class="opt" for="c-ccby-yes"><input type="radio" id="c-ccby-yes" name="c-ccby" value="要"> 要</label>
<label class="opt" for="c-ccby-no"><input type="radio" id="c-ccby-no" name="c-ccby" value="不要"> 不要</label>
</fieldset>
</div>
</div>
</div>
<div class="btn-row">
<button type="button" class="btn" id="send">同意並送出</button>
</div>
<p id="send-status" class="status" role="status" aria-live="polite"></p>
<p id="c-receipt" class="muted"></p>
<p id="c-done" class="panel" hidden>你已經同意過了，不用再按。只有想改撰稿人的選項（11 月 30 日中午 12 點以前）時，才需要改好再按一次「同意並送出」，Ted 用最後一次送出的選項。</p>
<div id="c-next" class="panel" hidden>
<p>同意完成了。下一步：</p>
<p><a id="c-next-link" class="btn btn-link" href="index.html">下一步</a></p>
</div>
<div id="c-fallback-help" class="panel" hidden>
<p>送不出去的時候，請過幾分鐘再按一次「同意並送出」。還是不行，請寫信告訴 Ted 發生了什麼事（tedinroc@gmail.com），Ted 修好網站以後你再按一次。同意只在這個網頁上做，不用 email 或 LINE 回覆。</p>
</div>
</section>
"""


def build_consent() -> str:
    md = (SITE / "consent.md").read_text(encoding="utf-8")
    body = md_to_html(md)
    parts = [head("試用同意書｜GapCaster", submit=True), GENERATED_NOTE,
             '<p class="muted">也有<a href="consent.md">純文字版（Markdown）</a>。</p>',
             body, CONSENT_FORM]
    scripts = '<script src="assets/common.js"></script>\n<script src="assets/consent.js"></script>\n'
    parts.append(foot(scripts, submit=True))
    return "\n".join(parts)


def build_questions_html() -> str:
    body = md_to_html(build_questions_md())
    parts = [head("題目稿｜GapCaster"), GENERATED_NOTE,
             '<p class="muted">也有<a href="questions.md">純文字版（Markdown）</a>。</p>', body]
    parts.append(foot(""))
    return "\n".join(parts)


def main() -> None:
    outputs = {
        "listen.html": build_listen(),
        "final.html": build_final(),
        "questions.md": build_questions_md(),
        "questions.html": build_questions_html(),
        "consent.html": build_consent(),
    }
    for name, text in outputs.items():
        (SITE / name).write_text(text, encoding="utf-8")
        print(f"wrote {name} ({len(text.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
