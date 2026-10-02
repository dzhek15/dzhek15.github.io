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


def build(text, now):
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
        live = kv.get("AB") == "2"
        done = kv.get("AB") == "3" and kv.get("AC") == "3" and now - int(kv.get("AD") or 0) < 4 * 3600
        if not (live or done):
            continue
        if head and not keep_head:
            out.append(head); keep_head = True
        out.append("¬".join("%s÷%s" % (k, kv[k]) for k in KEEP if k in kv))
    return out


def main():
    now = int(time.time()); ok = False
    for sport in (1, 4):
        text = get(FEED % sport)
        if not text or "AA÷" not in text:
            print("fslive: лента", sport, "недоступна, файл не трогаю"); continue
        recs = build(text, now)
        body = "ZT÷%d" % now + "¬~" + "¬~".join(recs) + ("¬~" if recs else "")
        path = os.path.join(OUT, "fs-%d.txt" % sport)
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        # время снимка само по себе не повод для коммита: пишем, только если изменились матчи
        strip = lambda s: re.sub(r"^ZT÷\d+", "", s)
        if strip(old) != strip(body):
            open(path, "w", encoding="utf-8").write(body)
            print("fslive: спорт", sport, "обновлён,", len(recs), "записей,", len(body), "байт")
        else:
            print("fslive: спорт", sport, "без изменений")
        ok = True
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
