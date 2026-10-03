"""Снимок живых матчей Flashscore для ДЖЕК 15 — запасной путь для тех, у кого workers.dev не открывается.

Запускается в GitHub Actions каждые 5 минут. Берёт ленту «сегодня» через тот же Cloudflare Worker,
оставляет только идущие матчи и закончившиеся за последние 4 часа, только нужные поля, и пишет
data/api/fs-<спорт>.txt в том же формате ленты (сайт разбирает его тем же кодом).
Первая запись «ZT÷<время снимка>» нужна сайту, чтобы понимать возраст данных.
Ключей и платных API не нужно.
"""
import os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "api")
FEED = "https://sweet-heart-f51d.dzhek15-api.workers.dev/?sport=%d&day=0"
HDR = {"User-Agent": "Mozilla/5.0 (dzhek15 fslive)", "Origin": "https://dzhek15.github.io",
       "Referer": "https://dzhek15.github.io/"}
# FSLIVE_FAST=1: только fs-now (матчи тиража, быстрый круг раз в минуту); FSLIVE_FORCE=1: писать файл всегда, чтобы обновить время снимка
FAST = os.environ.get("FSLIVE_FAST") == "1"
FORCE = os.environ.get("FSLIVE_FORCE") == "1"
KEEP = ("AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AO", "BX", "OA", "OB", "PX", "PY", "WU", "WV")


def get(url):
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=25) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            print("fslive: попытка", k + 1, e, flush=True)
            time.sleep(3)
    return None


def build(text, now, toks=None):
    out, head, keep_head = [], None, False
    for rec in text.split("¬~"):
        kv = {}
        for p in rec.split("¬"):
            a = p.split("÷")
            if len(a) == 2:
                kv[a[0]] = a[1]
        if not kv.get("AA"):
            if kv.get("ZY") or kv.get("ZA"):
                head = "ZY÷%s¬ZA÷%s" % (kv.get("ZY", ""), kv.get("ZA", "")); keep_head = False
            continue
        if toks is not None and not (norm_tokens(kv.get("AE", "")) & toks or norm_tokens(kv.get("AF", "")) & toks):
            continue
        live = kv.get("AB") == "2"
        done = kv.get("AB") == "3" and kv.get("AC") == "3" and now - int(kv.get("AD") or 0) < 4 * 3600
        # перенесён (AC=4) или отменён (AC=5): держим сутки, сайт подписывает такой матч в просмотре тиража
        void = kv.get("AB") == "3" and kv.get("AC") in ("4", "5") and abs(now - int(kv.get("AD") or 0)) < 36 * 3600
        if not (live or done or void):
            continue
        if head and not keep_head:
            out.append(head); keep_head = True
        out.append("¬".join("%s÷%s" % (k, kv[k]) for k in KEEP if k in kv))
    return out


DKEEP = ("AA", "AD", "AE", "AF", "OA", "OB", "PX", "PY", "WU", "WV")   # только то, что нужно для ссылки на матч


def norm_tokens(name):
    t = re.sub(r"[^a-zа-я0-9 ]", " ", str(name).lower().replace("ё", "е"))
    return {w for w in t.split() if len(w) >= 4 and not w.isdigit()}


def draw_tokens():
    """Слова из названий команд актуального и прошлого тиража — по ним отбираем матчи из ленты."""
    toks = set()
    try:
        import json
        lst = json.load(open(os.path.join(OUT, "drawings-1.json"), encoding="utf-8"))
        lst = lst if isinstance(lst, list) else lst.get("data", [])
        for d in lst[:2]:
            p = os.path.join(OUT, "drawing-info-%s.json" % d["id"])
            if not os.path.exists(p):
                continue
            info = json.load(open(p, encoding="utf-8"))
            for e in (info.get("data", info).get("events") or []):
                for side in re.split(r"\s+[—–-]\s+", e.get("name", "")):
                    toks |= norm_tokens(side)
    except Exception as e:
        print("fslive: тираж не прочитан", e)
    return toks


def build_draw(text, toks):
    """Все матчи (любой статус), где хоть одно слово названия команды совпало со словами тиража."""
    out, head, keep_head = {}, None, False
    for rec in text.split("¬~"):
        kv = {}
        for p in rec.split("¬"):
            a = p.split("÷")
            if len(a) == 2:
                kv[a[0]] = a[1]
        if not kv.get("AA"):
            if kv.get("ZY") or kv.get("ZA"):
                head = "ZY÷%s¬ZA÷%s" % (kv.get("ZY", ""), kv.get("ZA", "")); keep_head = False
            continue
        if not (norm_tokens(kv.get("AE", "")) & toks or norm_tokens(kv.get("AF", "")) & toks):
            continue
        out[kv["AA"]] = (head, "¬".join("%s÷%s" % (k, kv[k]) for k in DKEEP if k in kv), int(kv.get("AD") or 0))
    return out


def write_draw(sport, now, toks):
    """fs-draw-<спорт>.txt: матчи тиража на сегодня и завтра + то, что уже было (до 3 суток) —
    сайт берёт отсюда id матча для кнопки FS, когда Worker недоступен."""
    found = {}
    for day in (0, 1):
        text = get((FEED % sport).replace("day=0", "day=%d" % day))
        if text and "AA÷" in text:
            found.update(build_draw(text, toks))
    path = os.path.join(OUT, "fs-draw-%d.txt" % sport)
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    # прежние записи не теряем: матч прошлого тиража уже исчез из ленты, а ссылка на него нужна
    prev = {}
    head = None
    for rec in old.split("¬~"):
        if rec.startswith("ZY÷"):
            head = rec; continue
        kv = dict(p.split("÷", 1) for p in rec.split("¬") if "÷" in p)
        if kv.get("AA") and kv["AA"] not in found and now - int(kv.get("AD") or 0) < 72 * 3600:
            prev[kv["AA"]] = (head, rec, int(kv.get("AD") or 0))
    found.update(prev)
    if not found:
        print("fslive: draw", sport, "пусто, файл не трогаю"); return False
    groups = {}
    for aa, (h, rec, ts) in sorted(found.items(), key=lambda x: x[1][2]):
        groups.setdefault(h or "ZY÷¬ZA÷", []).append(rec)
    body = "ZT÷%d¬~" % now + "".join(h + "¬~" + "¬~".join(rs) + "¬~" for h, rs in groups.items())
    strip = lambda t: re.sub(r"^ZT÷\d+", "", t)
    if strip(old) != strip(body):
        open(path, "w", encoding="utf-8").write(body)
        print("fslive: draw", sport, "обновлён,", len(found), "матчей,", len(body), "байт")
    else:
        print("fslive: draw", sport, "без изменений")
    return True


def write_feed(name, body, force):
    path = os.path.join(OUT, name)
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    # время снимка само по себе не повод для коммита: пишем, только если изменились матчи (или force)
    strip = lambda t: re.sub(r"^ZT÷\d+", "", t)
    if force or strip(old) != strip(body):
        open(path, "w", encoding="utf-8").write(body)
        print("fslive:", name, "обновлён,", len(body), "байт")
    else:
        print("fslive:", name, "без изменений")


def main():
    now = int(time.time()); ok = False
    toks = draw_tokens()
    for sport in (1, 4):
        text = get(FEED % sport)
        if not text or "AA÷" not in text:
            print("fslive: лента", sport, "недоступна, файл не трогаю"); continue
        mk = lambda recs: "ZT÷%d" % now + "¬~" + "¬~".join(recs) + ("¬~" if recs else "")
        # fs-now-<спорт>.txt — только матчи тиража: меняется редко (гол, фаза), поэтому коммитится каждую минуту
        if toks:
            write_feed("fs-now-%d.txt" % sport, mk(build(text, now, toks)), FORCE)
        if not FAST:
            write_feed("fs-%d.txt" % sport, mk(build(text, now)), FORCE)
            if toks:
                write_draw(sport, now, toks)
        ok = True
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
