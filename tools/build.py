#!/usr/bin/env python3
"""Build listen.html, questions.md and consent.html for the GapCaster trial site.

One source of truth: the listener questions below are rendered both into the web page
(listen.html) and into the phone script Ted reads aloud (questions.md), so the two can
never drift apart. consent.html is rendered from consent.md.

Standard library only. Run from anywhere:  python3 tools/build.py
"""
from __future__ import annotations

import html
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
# v2 (23 November 2026): one trial round only (25-29 November), no round choice on any page, and the
# per-clip exposure question. v1 was never used by a participant.
PAGE_VERSION = "v2"

# ---------------------------------------------------------------------------
# Listener questions (Traditional Chinese, Taiwan usage). Edit here, then rebuild.
# key: short tag used in the result code; label: short name; text: the question.
# ---------------------------------------------------------------------------
UNDERSTOOD_NOAD = {
    "key": "懂",
    "label": "看懂",
    "text": "聽完這個沒有口述影像的版本，你覺得自己知道畫面上發生了什麼事嗎？",
    "options": ["完全不知道", "大多不知道", "一半一半", "大多知道", "完全知道"],
}

AD_ITEMS = [
    {
        "key": "懂",
        "label": "看懂",
        "text": "聽完這個版本，你覺得自己知道畫面上發生了什麼事嗎？",
        "options": ["完全不知道", "大多不知道", "一半一半", "大多知道", "完全知道"],
    },
    {
        "key": "內",
        "label": "內容",
        "text": "口述說的內容，也就是說了哪些事、怎麼說，對你有沒有幫助？請只評內容，不評聲音。",
        "options": ["完全沒幫助", "幫助很少", "普通", "有幫助", "非常有幫助"],
    },
    {
        "key": "聲",
        "label": "聲音清楚",
        "text": "口述的聲音清不清楚、好不好聽懂？請只評聲音，不評內容。",
        "options": ["完全聽不清楚", "常常聽不清楚", "普通", "大多清楚", "非常清楚"],
    },
    {
        "key": "蓋",
        "label": "沒蓋到",
        "text": "口述有沒有蓋到對白或重要的聲音，例如音樂或音效？",
        "options": ["常常蓋到", "好幾次蓋到", "偶爾蓋到", "很少蓋到", "完全沒蓋到"],
    },
    {
        "key": "整",
        "label": "整體",
        "text": "整體來說，這個版本你給幾分？",
        "options": ["很差", "差", "普通", "好", "很好"],
    },
    {
        "key": "想",
        "label": "想再看",
        "text": "如果有更多像這樣附口述影像的影片，你想不想看？",
        "options": ["完全不想", "不太想", "普通", "想", "非常想"],
    },
]

COMPREHENSION_HINT = "只問畫面上的事。用自己的話回答就好，不知道可以寫「不知道」。"

ENGLISH = {
    "line": "英語",
    "text": "片段 A 的英語對白，你大概聽得懂多少？",
    "hint": "這題不影響結果，只是分析時把聽得懂和聽不懂英語的人分開看。",
    "options": ["大部分聽得懂", "聽得懂一部分", "幾乎聽不懂"],
}

METHOD = {
    "line": "聽法",
    "text": "這次你是怎麼聽的？",
    "hint": "通話時由 Ted 代填。",
    "options": ["自己用聆聽網頁播放", "Ted 在通話中播放", "Ted 用 LINE 傳音檔", "臺北現場用耳機", "其他"],
}

COMMENT = {
    "line": "備註",
    "text": "還有什麼想說的嗎？（可不填）",
    "hint": "這段文字不會逐字公開。如果想引用其中一句，會先逐句問你。",
}

# Exposure question, one per clip (pre-registered before the trial): before this trial, had the
# participant already heard an audio description of the clip's film, or read or reviewed an audio
# description script of it? Listeners answer it on the listen page (and on calls) before the clip's
# first playback; describers answer it with their final questions. Analysis rule: 有 takes that
# participant's data for that clip out of the main analysis (reported as a count only); 不確定 stays
# in and is counted. Taking part and pay are unaffected. It names only the two trial films.
EXPOSURE = {
    "line": "先前",
    "label": "以前接觸過",
    "text": "在參加這次試用以前，你有沒有聽過{film}的口述影像，或讀過、審閱過它的口述影像稿？",
    "listener_hint": ("請在播放這段片以前回答。沒聽過也沒讀過，選「沒有」；記不清楚，選「不確定」。"
                      "不論怎麼回答，都可以照常做完，酬勞照付。"),
    "writer_hint": ("這次試用裡看到的草稿、你自己寫的和改的都不算。記不清楚，選「不確定」。"
                    "不論怎麼回答，酬勞照付。"),
    "options": ["沒有", "有", "不確定"],
}

# Read aloud to a listener who has not sent written consent yet (consent.md section 12). The consent's
# one-minute summary has describer-only points, so listeners get this shorter version.
LISTENER_SUMMARY = (
    "「開始前我先唸幾個重點，大約一分鐘。一、這是 GapCaster 的產品可用性試用，不是學術研究。"
    "二、您會聽到的口述影像是 AI 寫的草稿，用合成語音唸，不是真人配音。"
    "三、參加完全自願，任何題目都可以不答，隨時可以停，不用說原因，酬勞 800 元照付。"
    "四、通話不錄音。"
    "五、除了作答，我只記下您自述是全盲或低視能，以及付款和聯絡需要的資料。"
    "六、公開的只有代號和分數，不公開姓名；想引用您的話，會先逐句問您。"
    "七、用代號標示的作答，我會用 Anthropic 公司的 AI 工具 Claude 協助分析，它的伺服器在臺灣以外；"
    "您的姓名、聯絡方式和付款資料不會交給它。"
    "八、個人資料最晚在 2027 年 3 月 1 日前刪除，想退出、查詢或刪除，隨時告訴我。"
    "請問您年滿 18 歲嗎？同意參加嗎？通話後我會傳一則簡訊，麻煩回「同意」兩個字。」"
)

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
    {"slot": "N", "line": "無", "heading": "先聽，沒有口述影像的版本", "src": "{clip}_noad.mp3"},
    {"slot": "1", "line": "一", "heading": "再聽，有口述影像的版本", "src": "{clip}_ad.mp3"},
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
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">
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
<p>GapCaster 試用網站 {version}。這個網頁不會自動送出任何資料。</p>
</footer>
{scripts}</body>
</html>
"""

GENERATED_NOTE = "<!-- Generated by tools/build.py. Edit the source there, then rebuild. -->\n"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def opt_label(i: int, text: str) -> str:
    return f"{i} 分：{text}"


def question_html(qid: str, name: str, legend: str, options: list[str], line: str, key: str,
                  numbered_scale: bool = True, hint: str | None = None, legend_html: str | None = None) -> str:
    """A radio group: fieldset, legend, optional hint, one label per option. legend_html, when given,
    is already-escaped HTML for the legend (for lang marks); otherwise legend is escaped here."""
    described = f' aria-describedby="{qid}-hint"' if hint else ""
    out = [f'<fieldset id="{qid}" data-line="{esc(line)}" data-key="{esc(key)}"{described}>',
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
    parts = [HEAD.format(title="聆聽試用｜GapCaster"), GENERATED_NOTE]
    parts.append("""<h1>口述影像聆聽試用</h1>
<p id="who" class="panel">還沒有代號。請用 Ted 傳給你的個人連結開啟這一頁，或在下面輸入代號。</p>

<section aria-labelledby="h-start">
<h2 id="h-start">開始之前</h2>
<ul>
<li>試用時間是 2026 年 11 月 25 日（星期三）到 11 月 29 日（星期日）晚上 10 點（臺北時間）。請在這段時間內做完，並傳出結果碼。試用結束以後，有口述影像的版本會從網站移除，就不能再播放。</li>
<li>請戴耳機，或在安靜的地方聽。</li>
<li>每段片開始播放以前，請先回答一題：在這次試用以前，你有沒有聽過這段片的口述影像，或讀過、審閱過它的口述影像稿。</li>
<li>然後先聽沒有口述影像的版本，再聽有口述影像的版本。每個版本聽完，再回答它下面的題目。</li>
<li>口述影像是 AI 寫的草稿，用合成語音唸出來。</li>
<li>播放器不會自動播放，請自己按「播放」。每個版本都可以重聽。</li>
<li>每一題都可以不答。不想做了隨時可以停止，酬勞照付。</li>
<li>作答只暫存在這臺裝置的瀏覽器，不會自動送出。全部做完，請在頁面最後按「複製結果碼」，再用 email 或 LINE 傳給 Ted：tedinroc@gmail.com。</li>
<li>參加前請先看<a href="consent.html">試用同意書</a>。</li>
</ul>

<div id="setup" hidden>
<h3 id="h-setup">輸入代號</h3>
<form id="setup-form" aria-labelledby="h-setup" novalidate>
<label class="block" for="in-code">你的代號（Ted 給你的，例如 L07）</label>
<input type="text" id="in-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false">
<button type="submit" class="btn">用這個代號開始</button>
</form>
</div>
</section>
""")

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
                                   hint=EXPOSURE["listener_hint"], legend_html=exposure_legend(clip, True)))
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
                                           item["options"], line, item["key"]))
            else:
                for n, item in enumerate(AD_ITEMS, start=1):
                    parts.append(question_html(f"q-{c}-{slot}-{n}", f"{c}-{slot}-{n}", legend_for(item, n),
                                               item["options"], line, item["key"]))
            parts.append("</div>")
        # Comprehension question (screen content only), asked once per clip after the described version.
        qid = f"q-{c}-comp"
        parts.append(f'<h3 id="h-{c}-comp">{esc(c)}：理解題</h3>')
        parts.append(f'<label class="block" for="{qid}">{esc(comprehension_text(clip))}</label>')
        parts.append(f'<p class="hint" id="{qid}-hint">{esc(COMPREHENSION_HINT)}</p>')
        parts.append(f'<input type="text" id="{qid}" name="{c}-comp" data-line="{c}理解" aria-describedby="{qid}-hint" autocomplete="off">')
        if clip["english"]:
            parts.append(question_html(f"q-{c}-en", f"{c}-en", ENGLISH["text"], ENGLISH["options"],
                                       ENGLISH["line"], "", numbered_scale=False, hint=ENGLISH["hint"]))
        parts.append("</section>")

    parts.append(f"""
<section aria-labelledby="h-end">
<h2 id="h-end">最後兩題</h2>
{question_html("q-method", "method", METHOD["text"], METHOD["options"], METHOD["line"], "", numbered_scale=False, hint=METHOD["hint"])}
<label class="block" for="q-comment">{esc(COMMENT["text"])}</label>
<p class="hint" id="q-comment-hint">{esc(COMMENT["hint"])}</p>
<textarea id="q-comment" name="comment" data-line="{COMMENT["line"]}" aria-describedby="q-comment-hint" rows="4"></textarea>
</section>
""")
    # Plain (non-f) string on purpose: tools/fill.py replaces the contact placeholder inside this
    # file, and inside an f-string the doubled braces would survive as literal braces on the page.
    parts.append("""
<section aria-labelledby="h-result">
<h2 id="h-result">結果碼</h2>
<p>按「複製結果碼」，再打開 LINE 或 email，貼上並傳給 Ted：tedinroc@gmail.com。網頁不會自動送出任何資料。</p>
<p id="unanswered" class="muted"></p>
<div class="btn-row">
<button type="button" class="btn" id="copy">複製結果碼</button>
<button type="button" class="btn secondary" id="share" hidden>分享結果碼（手機）</button>
</div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<label class="block" for="code-out">結果碼（也可以自己選取複製）</label>
<textarea id="code-out" class="code" readonly rows="14"></textarea>

<h3 id="h-clear">清除作答</h3>
<p>作答暫存在這臺裝置的瀏覽器裡，方便你中途離開再回來。做完並傳出結果碼以後，可以按下面的按鈕刪除。</p>
<button type="button" class="btn secondary" id="clear">清除這臺裝置上的作答</button>
</section>
""")
    scripts = '<script src="assets/common.js"></script>\n<script src="assets/listen.js"></script>\n'
    parts.append(FOOT.format(version=PAGE_VERSION, scripts=scripts))
    return "\n".join(parts)


def md_options(options: list[str], numbered: bool = True) -> list[str]:
    return [f"  - {opt_label(i, t) if numbered else t}" for i, t in enumerate(options, start=1)]


def build_questions_md() -> str:
    L: list[str] = []
    L.append("# 通話題目稿（聽眾）和撰稿人問題")
    L.append("")
    L.append("> 這份題目和聆聽頁 `listen.html` 完全一樣：兩者都由 `tools/build.py` 從同一份題目產生。"
             "要改題目，請改 `tools/build.py` 再執行 `python3 tools/build.py`，不要只改其中一邊。")
    L.append("")
    L.append("## 通話前準備（Ted）")
    L.append("")
    L.append("- 試用時間：2026 年 11 月 25 日（三）到 11 月 29 日（日）晚上 10 點（臺北時間）。")
    L.append("- 確認這位聽眾的代號。")
    L.append("- 確認已經收到同意回覆；還沒有的話，開場前照唸下面的「聽眾版重點」，請對方口頭同意，在私人紀錄（`identity/`）寫下日期和時間；"
             "通話後傳一則簡訊，請對方回覆「同意」兩個字，把回覆存進 `identity/`。")
    L.append("- **每位聽眾都用一個新分頁**開 `listen.html#code=代號&round=1`，邊問邊點選。不要在同一個分頁只改網址的代號。"
             "做完按「複製結果碼」，貼進 `stage2/pilot-private/` 裡這位聽眾的檔案。絕對不要放進任何 repo。")
    L.append("- 決定怎麼播放（三選一，最後一題「聽法」照實填）：")
    L.append("  1. 對方用自己的手機或電腦開個人連結，自己按播放，Ted 在電話裡唸題目。")
    L.append("  2. Ted 用 LINE 依頁面順序一次傳一個音檔，對方聽完再回答。只傳網站 `media/` 裡的公開檔案"
             "（`B_noad.mp3`、`B_ad.mp3`、`A_noad.mp3`、`A_ad.mp3`），不要傳電腦上其他的檔案，並請對方做完就刪除、不要轉傳。")
    L.append("  3. Ted 在通話中播放。音質會變差，「聲音清楚」的分數要分開看。")
    L.append("- 每段片**播放以前**，先問「聽之前先回答」那一題（以前有沒有接觸過這段片的口述影像）。不論對方怎麼回答，都照常往下做。")
    L.append("- 不錄音。")
    L.append("")
    L.append("## 聽眾版重點（還沒收到書面同意時照唸）")
    L.append("")
    L.append(LISTENER_SUMMARY)
    L.append("")
    L.append("## 開場（照唸）")
    L.append("")
    L.append("「您好，我是 Ted。謝謝您參加 GapCaster 的口述影像試用。這是產品可用性試用，不是學術研究。"
             "通話不錄音。整個過程大約 30 到 45 分鐘。每一題都可以不回答，任何時候想停都可以停，酬勞照付。"
             "口述影像是 AI 寫的草稿，用合成語音唸出來。")
    L.append("")
    L.append("接下來會聽兩段短片的聲音。每段開始以前，我會先問您以前有沒有聽過這段片的口述影像。"
             "然後先聽沒有口述影像的版本，再聽有口述影像的版本。"
             "每個版本聽完，我會唸幾個問題，請用 1 到 5 分回答，我會把每個分數代表的意思唸給您聽。"
             "最後每段還有一題關於畫面的問題，用自己的話回答就好。」")
    L.append("")
    L.append("唸題目的方式：題目照下面的文字唸。每一題第一次唸的時候，把 1 到 5 分的意思全部唸出來；"
             "對方說記得了，之後可以只唸題目，再問「1 到 5 分，幾分？」。")
    L.append("")

    for clip in CLIPS:
        c = clip["id"]
        L.append(f"## {clip['title_md']}")
        L.append("")
        L.append(clip["desc"])
        L.append("")
        L.append(f"### {c}：聽之前先回答")
        L.append("")
        L.append(f"還沒播放 {c} 的任何音檔以前，先問這一題。不論對方怎麼回答，都照常往下做。"
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
            L.append(f"{play}聽完再唸題目。結果碼裡這一行的開頭是「{c}{v['line']}」。")
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
        L.append(f"（{COMPREHENSION_HINT}）把回答照對方的話打進去，不要改寫。")
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
    L.append("## 結束（照唸）")
    L.append("")
    L.append("「謝謝您！酬勞會在一週內付款，請問要用 LINE Pay、用 LINE 傳超商電子禮物卡，還是銀行轉帳？也可以改捐給轉介您的單位。"
             "如果之後想退出、想看或刪除您的資料，隨時告訴我就可以。」")
    L.append("")
    L.append("Ted：按「複製結果碼」，存到 `stage2/pilot-private/`，然後按「清除這臺裝置上的作答」，關閉這個分頁。"
             "下一位聽眾用新分頁開他自己的連結。")
    L.append("")
    L.append("## 撰稿人做完以後的問題")
    L.append("")
    L.append("四個半段（兩個從零撰寫、兩個修改草稿）全部做完以後再回答。請把答案寫在回信裡，和檔案一起寄給 Ted。")
    L.append("")
    L.append(f"### {len(WRITER_ITEMS)} 個 1 到 5 分的問題")
    L.append("")
    for n, item in enumerate(WRITER_ITEMS, start=1):
        L.append(f"- **第{n}題　{item['label']}：{item['text']}**")
        L.extend(md_options(item["options"]))
    L.append("")
    L.append("### 每段片一題：以前接觸過嗎")
    L.append("")
    L.append(f"選「沒有」「有」或「不確定」。{EXPOSURE['writer_hint']}")
    L.append("")
    for n, clip in enumerate(writer_exposure_clips(), start=len(WRITER_ITEMS) + 1):
        L.append(f"- **第{n}題　{EXPOSURE['label']}：{exposure_legend(clip)}**")
        L.extend(md_options(EXPOSURE["options"], numbered=False))
    L.append("")
    L.append("回信可以直接複製這段：「" + "」「".join(item["key"] for item in WRITER_ITEMS)
             + "」後面的底線換成 1 到 5 分；「"
             + "」「".join(c["id"] + EXPOSURE["line"] for c in writer_exposure_clips())
             + "」後面的底線換成「沒有」「有」或「不確定」。")
    L.append("")
    L.append("```")
    L.append(f"GapCaster 撰稿人問題 {PAGE_VERSION}")
    L.append("代號：W__")
    L.append(" ".join(f"{item['key']}_" for item in WRITER_ITEMS))
    L.append(" ".join(f"{c['id']}{EXPOSURE['line']}_" for c in writer_exposure_clips()))
    L.append("備註：（可不填）")
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
        "key": "省力",
        "label": "省力",
        "text": "修改 GapCaster 草稿的那一半，和從零撰寫的那一半比起來，省不省力？",
        "options": ["費力很多", "費力一些", "差不多", "省力一些", "省力很多"],
    },
    {
        "key": "正確",
        "label": "正確",
        "text": "GapCaster 草稿描述的畫面，整體來說正確嗎？",
        "options": ["錯很多", "錯不少", "一半一半", "大多正確", "幾乎都正確"],
    },
    {
        "key": "想用",
        "label": "想用",
        "text": "如果之後能用 GapCaster 產生草稿，你會想在工作中使用嗎？",
        "options": ["完全不想", "不太想", "看情況", "想", "非常想"],
    },
]


# ---------------------------------------------------------------------------
# Minimal Markdown subset -> HTML for consent.md (headings, paragraphs, nested lists,
# fenced code, **bold**, `code`). Enough for this one document; no dependencies.
# ---------------------------------------------------------------------------
def md_inline(s: str) -> str:
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
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
<h2 id="h-reply">產生同意回覆</h2>
<p>填好代號、勾選你的選擇，按「複製同意回覆」，再貼到 email 或 LINE 傳給 Ted：tedinroc@gmail.com。網頁不會自動送出任何資料。</p>
<label class="block" for="c-code">你的代號（Ted 給你的，例如 W03 或 L07；還沒有可以不填）</label>
<input type="text" id="c-code" autocomplete="off" autocapitalize="characters" spellcheck="false">
<fieldset id="c-role">
<legend>你的身分（必填）</legend>
<label class="opt" for="c-role-l"><input type="radio" id="c-role-l" name="c-role" value="聽眾"> 聽眾</label>
<label class="opt" for="c-role-w"><input type="radio" id="c-role-w" name="c-role" value="撰稿人"> 撰稿人</label>
</fieldset>
<fieldset id="c-agree-set">
<legend>同意</legend>
<label class="opt" for="c-agree"><input type="checkbox" id="c-agree"> 我已看完同意書，年滿 18 歲，同意參加。</label>
</fieldset>
<div id="c-writer" hidden>
<fieldset id="c-text">
<legend>選項 A：你的文字可以放進參賽作品嗎？</legend>
<label class="opt" for="c-text-yes"><input type="radio" id="c-text-yes" name="c-text" value="可以"> 可以放進作品</label>
<label class="opt" for="c-text-no"><input type="radio" id="c-text-no" name="c-text" value="不要"> 不要放進作品</label>
</fieldset>
<div id="c-ccby-wrap" hidden>
<fieldset id="c-sign">
<legend>選項 A-1：如果主辦單位依規則要求簽署的授權文件，你願意提供本名並簽署嗎？（必選。本名只存在 Ted 的私人資料夾，不公開）</legend>
<label class="opt" for="c-sign-yes"><input type="radio" id="c-sign-yes" name="c-sign" value="願意"> 願意：我會在傳出的回覆最後一行打上本名</label>
<label class="opt" for="c-sign-no"><input type="radio" id="c-sign-no" name="c-sign" value="不願意"> 不願意：我的文字只用來計算數字，不放進作品</label>
</fieldset>
<div id="c-licence-wrap" hidden>
<p class="panel">你選了「可以放進作品」和「願意」。同意回覆的最後會自動附上第 7 節的「授權聲明」，並填好你的代號。請整段一起傳給 Ted，傳出前在最後一行打上你的本名（這個網頁不會收你的本名）。</p>
<fieldset id="c-ccby">
<legend>選項 B：要不要用 CC BY 4.0 公開你的文字？</legend>
<label class="opt" for="c-ccby-yes"><input type="radio" id="c-ccby-yes" name="c-ccby" value="要"> 要</label>
<label class="opt" for="c-ccby-no"><input type="radio" id="c-ccby-no" name="c-ccby" value="不要"> 不要</label>
</fieldset>
</div>
</div>
</div>
<div class="btn-row">
<button type="button" class="btn" id="c-copy">複製同意回覆</button>
<button type="button" class="btn secondary" id="c-share" hidden>分享同意回覆（手機）</button>
</div>
<p id="c-status" class="status" role="status" aria-live="polite"></p>
<label class="block" for="c-out">同意回覆（也可以自己選取複製）</label>
<textarea id="c-out" class="code" readonly rows="12"></textarea>
</section>
"""


def build_consent() -> str:
    md = (SITE / "consent.md").read_text(encoding="utf-8")
    body = md_to_html(md)
    parts = [HEAD.format(title="試用同意書｜GapCaster"), GENERATED_NOTE,
             '<p class="muted">也有<a href="consent.md">純文字版（Markdown）</a>。</p>',
             body, CONSENT_FORM]
    scripts = '<script src="assets/common.js"></script>\n<script src="assets/consent.js"></script>\n'
    parts.append(FOOT.format(version=PAGE_VERSION, scripts=scripts))
    return "\n".join(parts)


def build_questions_html() -> str:
    body = md_to_html(build_questions_md())
    parts = [HEAD.format(title="題目稿｜GapCaster"), GENERATED_NOTE,
             '<p class="muted">也有<a href="questions.md">純文字版（Markdown）</a>。</p>', body]
    parts.append(FOOT.format(version=PAGE_VERSION, scripts=""))
    return "\n".join(parts)


def main() -> None:
    outputs = {
        "listen.html": build_listen(),
        "questions.md": build_questions_md(),
        "questions.html": build_questions_html(),
        "consent.html": build_consent(),
    }
    for name, text in outputs.items():
        (SITE / name).write_text(text, encoding="utf-8")
        print(f"wrote {name} ({len(text.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
