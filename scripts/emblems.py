"""Эмблемы клубов для ДЖЕК 15 — автосбор из ленты Flashscore.

Запускается в GitHub Actions после зеркала (feed.py). Для текущего и прошлого тиража
находит клубы, которых нет в data/api/teams.json, ищет их матч в ленте Flashscore
(сегодня и завтра, через тот же Cloudflare Worker, что и сайт), скачивает эмблему в
icons/teams/fs/<файл>.png и дописывает в teams.json запись {"f": "<файл>.png"}.
Сборные пропускаются — у них на сайте флаги. Матчи, которых ещё нет в ленте,
дособерутся при следующих запусках. Ключей и платных API не нужно.
"""
import json, os, re, time, urllib.request

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
    if added:
        json.dump(teams, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    log("добавлено эмблем:", added, "· матчей без эмблем было:", len(events))


if __name__ == "__main__":
    try: main()
    except Exception as e: log("ошибка, пропускаю:", e)
