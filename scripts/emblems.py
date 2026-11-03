"""Эмблемы клубов для ДЖЕК 15 — автосбор из ленты Flashscore.

Запускается в GitHub Actions после зеркала (feed.py). Для текущего и прошлого тиража
находит клубы, которых нет в data/api/teams.json, ищет их матч в ленте Flashscore
(сегодня и завтра, через тот же Cloudflare Worker, что и сайт), скачивает эмблему в
icons/teams/fs/<файл>.png и дописывает в teams.json запись {"f": "<файл>.png"}.
Фонбет: берёт названия из data/api/fon (английские), переводит их словарём data/api/fon/ru.json
(как сайт) и, если матча нет в ленте Flashscore, берёт эмблему из Википедии по английскому названию.
Сборные пропускаются — у них на сайте флаги. Матчи, которых ещё нет в ленте,
дособерутся при следующих запусках. Ключей и платных API не нужно.
"""
import json, os, re, time, urllib.request, urllib.parse, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "data", "api")
OUT = os.path.join(API, "teams.json")
IMG = os.path.join(ROOT, "icons", "teams", "fs")
FEED = "https://sweet-heart-f51d.dzhek15-api.workers.dev/?sport=%d&day=%d"
LOGO = "https://static.flashscore.com/res/image/data/"
HDR = {"User-Agent": "Mozilla/5.0 (dzhek15 emblems)", "Origin": "https://dzhek15.github.io",
       "Referer": "https://dzhek15.github.io/"}
NAT = re.compile(r"лига наций|чемпионат мира|чемпионат европы|кубок африки|кубок азии|кубок америки|"
                 r"золотой кубок|отбор|сборн", re.I)
HOCKEY = re.compile(r"хокк|кхл|вхл|мхл|nhl|нхл|shl|liiga", re.I)
GENERIC = set("фк ск сити таун юнайтед атлетик атлетико роверс депортиво реал интер олимпик спортинг "
              "насьональ юниор юнион динамо спартак локомотив рейнджерс".split())


FNAT = re.compile(r"international|nations league|world cup|qualif|european championship|euro 20|"
                  r"copa america|africa cup|asian cup|gold cup|friendl", re.I)
WP = "https://en.wikipedia.org/api/rest_v1/page/summary/"
WPS = "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch="
WPH = {"User-Agent": "dzhek15-emblems/1.0 (noreply@users.noreply.github.com)"}


def log(*a):
    print(time.strftime("%H:%M:%S"), "emblems:", *a, flush=True)


def get(url, timeout=25):
    req = urllib.request.Request(url, headers=HDR)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def team_key(n):
    """Тот же ключ, что teamKey() на сайте."""
    n = str(n or "").lower().replace("ё", "е")
    n = re.sub(r"[«»\"'`]", " ", n)
    n = re.sub(r"(^|\s)фк\.?(?=\s|$)", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def words(n):
    return [w for w in re.split(r"[^a-zа-я0-9]+", str(n or "").lower().replace("ё", "е")) if len(w) >= 3]


def core(n):
    w = [x for x in words(n) if x not in GENERIC]
    return w or words(n)


def tag(n):
    n = str(n or "").lower(); t = ""
    y = re.search(r"\bu\s?(\d\d)\b|\((\d\d)\)|до\s?(\d\d)", n)
    if y: t += "y" + (y.group(1) or y.group(2) or y.group(3))
    if re.search(r"\((?:ж)\)", n): t += "w"
    return t


def dist(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def sim(w, v):
    """Слова похожи: разное написание одной фамилии/города («Брэдфорд» и «Бредфорд»)."""
    if w == v: return True
    if len(w) < 4 or len(v) < 4: return False
    if dist(w, v) <= (1 if min(len(w), len(v)) < 7 else 2): return True
    return w[:4] == v[:4] and abs(len(w) - len(v)) <= 2 and dist(w, v) <= 3


def same(q, c):
    """Совпадение имён: все важные слова одного нашлись (точно или почти) среди слов другого."""
    if tag(q) != tag(c): return False
    qw, cw = words(q), words(c)
    def cover(a, b): return bool(a) and all(any(sim(x, y) for y in b) for x in a)
    return cover(core(q), cw) or cover(core(c), qw)


def parse_feed(text):
    out = []
    for rec in text.split("¬~"):
        o = {}
        for part in rec.split("¬"):
            kv = part.split("÷")
            if len(kv) == 2: o[kv[0]] = kv[1]
        if o.get("AA") and o.get("AE") and o.get("AF"):
            out.append((o["AE"], o["AF"], o.get("OA", ""), o.get("OB", "")))
    return out


def ascii_(x):
    import unicodedata
    return unicodedata.normalize("NFKD", str(x)).encode("ascii", "ignore").decode().lower()


def fon_events(teams):
    """Матчи Фонбета (текущий и прошлый тираж): (рус1, рус2, англ1, англ2) только для клубов без эмблемы.
    Перевод — словарём ru.json, как на сайте; чего в словаре нет, пропускаем (конвейер его пополняет)."""
    out = []
    try:
        ru = json.load(open(os.path.join(API, "fon", "ru.json"), encoding="utf-8")).get("t", {})
        draws = json.load(open(os.path.join(API, "fon", "drawings-1.json"), encoding="utf-8"))
        draws = draws.get("data", draws)
    except Exception as e:
        log("Фонбет: нет данных:", e); return out
    for d in draws[:2]:
        p = os.path.join(API, "fon", "drawing-info-%s.json" % d.get("id"))
        if not os.path.exists(p): continue
        info = json.load(open(p, encoding="utf-8")); info = info.get("data", info)
        for e in info.get("events", []):
            if FNAT.search(str(e.get("championship") or "")): continue
            parts = [s.strip() for s in re.split(r"\s+[–—-]\s+", str(e.get("name", "")))]
            if len(parts) != 2: continue
            ruparts = []
            for en in parts:
                m = re.match(r"^(.*?)(\s*\((?:w|W)\))?$", en)
                r = ru.get(m.group(1))
                ruparts.append(None if not r else r + (" (ж)" if m.group(2) else ""))
            if None in ruparts: continue
            if all(team_key(n) in teams for n in ruparts): continue
            out.append((ruparts[0], ruparts[1], parts[0], parts[1]))
    return out


def wp_logo(en):
    """Эмблема клуба из Википедии по английскому названию: (png-байты, заголовок) или None."""
    en = re.sub(r"\s*\((?:w|W)\)$", "", en)
    q = json.loads(get_h(WPS + urllib.parse.quote(en + " football club")).decode("utf-8"))
    ws = [w for w in re.split(r"[^a-z0-9]+", ascii_(en)) if len(w) >= 3 and w not in GENERIC_EN]
    for hit in q.get("query", {}).get("search", []):
        title = hit["title"]
        tl = ascii_(title)
        if ws and not all(any(w[:5] == x[:5] for x in re.split(r"[^a-z0-9]+", tl)) for w in ws): continue
        d = json.loads(get_h(WP + urllib.parse.quote(title.replace(" ", "_"))).decode("utf-8"))
        if not re.search(r"football|soccer|sports club|\bclub\b", str(d.get("description", "")) + " " + str(d.get("extract", ""))[:200], re.I): continue
        src = re.sub(r"\?.*", "", (d.get("thumbnail") or {}).get("source") or "")
        if not src: continue
        raw = get_h(src)
        try:
            from PIL import Image
            im = Image.open(io.BytesIO(raw)).convert("RGBA"); im.thumbnail((128, 128))
            c = Image.new("RGBA", (max(im.size),) * 2, (0, 0, 0, 0))
            c.paste(im, ((c.width - im.width) // 2, (c.height - im.height) // 2), im)
            b = io.BytesIO(); c.save(b, "PNG", optimize=True); raw = b.getvalue()
        except Exception:
            pass
        if raw.startswith(b"\x89PNG") and len(raw) > 200 and len(raw) < 200000: return raw, title
    return None


GENERIC_EN = set("fc cf sc ac as fk sk club city town united athletic atletico sporting real rovers".split())


def get_h(url, timeout=25):
    req = urllib.request.Request(url, headers=WPH)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def wiki_fallback(fon, teams, limit=12):
    """Клубы Фонбета, которых нет в ленте Flashscore (матч позже завтрашнего дня и т.п.): эмблема из Википедии."""
    added = 0
    for rh, ra, eh, ea in fon:
        for ru, en in ((rh, eh), (ra, ea)):
            k = team_key(ru)
            if k in teams or added >= limit: continue
            try:
                res = wp_logo(en)
                time.sleep(1)
                if not res: continue
                fn = "wp-" + re.sub(r"[^a-z0-9]+", "-", ascii_(res[1])).strip("-") + ".png"
                open(os.path.join(IMG, fn), "wb").write(res[0])
                teams[k] = {"f": fn}; added += 1; log("+ (wiki)", ru, "<-", res[1])
            except Exception as e:
                log("википедия", en, "не снялась:", e)
    return added


def main():
    teams = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    try:
        draws = json.load(open(os.path.join(API, "drawings-1.json"), encoding="utf-8"))
        draws = draws.get("data", draws)
    except Exception as e:
        log("нет списка тиражей:", e); return
    events = []
    for d in draws[:2]:                       # текущий и прошлый тираж
        p = os.path.join(API, "drawing-info-%s.json" % d.get("id"))
        if not os.path.exists(p): continue
        info = json.load(open(p, encoding="utf-8")); info = info.get("data", info)
        for e in info.get("events", []):
            parts = [s.strip() for s in str(e.get("name", "")).split("—")]
            if len(parts) != 2: continue
            league = str(e.get("championship") or e.get("tournament") or e.get("league") or "")
            if NAT.search(league) or re.search(r"\((?:19|20|21)\)", e.get("name", "")): continue
            if all(team_key(n) in teams for n in parts): continue
            events.append((parts[0], parts[1], 4 if HOCKEY.search(league) else 1))
    fon = fon_events(teams)
    events += [(h, a, 1) for h, a, _, _ in fon]
    if not events:
        log("все клубы уже с эмблемами"); return
    feeds = {}
    for sport in sorted({s for _, _, s in events}):
        rows = []
        for day in (0, 1):
            try: rows += parse_feed(get(FEED % (sport, day)).decode("utf-8", "ignore"))
            except Exception as e: log("лента", sport, day, "не снялась:", e)
        feeds[sport] = rows
    os.makedirs(IMG, exist_ok=True)
    added = 0
    for h, a, sport in events:
        hit = None
        for fh, fa, lh, la in feeds.get(sport, []):
            if same(h, fh) and same(a, fa): hit = ((h, lh), (a, la)); break
            if same(h, fa) and same(a, fh): hit = ((h, la), (a, lh)); break
        if not hit: continue
        for name, logo in hit:
            k = team_key(name)
            if k in teams or not re.fullmatch(r"[\w-]+\.png", logo or ""): continue
            try:
                raw = get(LOGO + logo)
                if len(raw) < 200 or not raw.startswith(b"\x89PNG"): continue
                open(os.path.join(IMG, logo), "wb").write(raw)
                teams[k] = {"f": logo}; added += 1; log("+", name, logo)
            except Exception as e:
                log("эмблема", name, "не скачалась:", e)
    added += wiki_fallback(fon, teams)
    if added:
        json.dump(teams, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    log("добавлено эмблем:", added, "· матчей без эмблем было:", len(events))


if __name__ == "__main__":
    try: main()
    except Exception as e: log("ошибка, пропускаю:", e)
