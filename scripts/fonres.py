#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Фонбет: итоги матчей закрытых тиражей из архива ленты Flashscore (до 7 суток назад).

totobrief для тиражей Фонбета итоги матчей почти не отдаёт (result = null даже у finished), а журнал
fonstrat.py видит только ленту «сегодня»: матчи, сыгранные вчера и раньше, терялись, и в просмотре тираж
вечно «идёт», а в статистике нет ни одного тиража. Этот скрипт идёт по тиражам из data/api/fon/drawing-info-*.json,
находит сыгранные матчи в ленте за дни −7…0 (английские названия, сверка по времени ±6 ч), и дописывает итоги
в data/api/fon/history.json (формат ev: [дом, гость, турнир, bk1, bkX, bk2, пул1, пулX, пул2, итог, счёт]) —
оттуда их читает сайт (fonFillRes). Уже найденное не перезаписывается, неполные тиражи дополняются.
Только стандартная библиотека; сбой ленты ничего не ломает.
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FON = os.path.join(ROOT, "data", "api", "fon")
HIST = os.path.join(FON, "history.json")
FEED = "https://2.flashscore.ninja/2/x/feed/f_1_%d_3_en_1"
BACK = 7
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def get(url, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"x-fsign": "SW9D1eZo", "User-Agent": "Mozilla/5.0 (dzhek15 fonres)"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:
            print("fonres: лента", url[-22:], "попытка", k + 1, e, flush=True)
            time.sleep(2)
    return ""


def parse(text):
    out = []
    for rec in text.split("¬~"):
        o = {}
        for part in rec.split("¬"):
            kv = part.split("÷")
            if len(kv) == 2:
                o[kv[0]] = kv[1]
        if o.get("AB") != "3" or not (o.get("AE") and o.get("AF")):
            continue
        try:
            out.append((o["AE"], o["AF"], int(o.get("AD", "0")), int(o["AG"]), int(o["AH"])))
        except (KeyError, ValueError):
            continue
    return out


def utc(s):
    try:
        return datetime.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0


def split(name):
    p = [s.strip() for s in re.split(r"\s+[–—-]\s+", str(name or ""))]
    return p if len(p) == 2 else None


ABBR = [(r"\butd\b", "united"), (r"\bjrs\b", "juniors"), (r"\batl\b\.?", "atletico"), (r"\bst\b\.?", "saint"), (r"\bsk\b", "sport")]


def norm(n):
    import unicodedata
    n = unicodedata.normalize("NFKD", str(n or "")).encode("ascii", "ignore").decode().lower()
    n = n.replace(".", " ")
    for a, b in ABBR:
        n = re.sub(a, b, n)
    return re.sub(r"\s+", " ", n).strip()


def main():
    import emblems as E
    _same = E.same
    E.same = lambda q, c: _same(norm(q), norm(c))
    now = time.time()
    hist = json.load(open(HIST, encoding="utf-8")) if os.path.exists(HIST) else {"draws": {}}
    hist.setdefault("draws", {})
    infos = []
    for fn in sorted(os.listdir(FON)):
        if re.match(r"drawing-info-\d+\.json$", fn):
            d = json.load(open(os.path.join(FON, fn), encoding="utf-8")).get("data") or {}
            if d.get("events"):
                infos.append(d)
    todo = []
    for d in infos:
        evs = sorted(d["events"], key=lambda e: e.get("order", 0))
        have = hist["draws"].get(str(d.get("number")))
        got = [bool(x[9]) for x in (have or {}).get("ev", [])] if have else []
        if have and len(got) >= 15 and all(got):
            continue
        if all((e.get("result") or "") in ("1", "X", "2") for e in evs):
            continue
        last = max(utc(e.get("start_at", "")) for e in evs)
        if last and now < last + 3 * 3600:
            continue                      # матчи ещё идут
        todo.append((d, evs, have))
    if not todo:
        print("fonres: итоги не нужны")
        return 0
    first = min(min(utc(e.get("start_at", "")) for e in evs) for _, evs, _ in todo)
    days = range(-min(BACK, int((now - first) / 86400) + 1), 1)
    rows = []
    for dd in days:
        rows += parse(get(FEED % dd))
    print("fonres: сыгранных в ленте", len(rows), "за дни", days[0], "…", days[-1])
    jres = {}
    try:
        jres = json.load(open(os.path.join(FON, "strat_journal.json"), encoding="utf-8")).get("results") or {}
    except Exception:
        pass
    changed = 0
    for d, evs, have in todo:
        old = (have or {}).get("ev") or []
        ev_out, found = [], 0
        for i, e in enumerate(evs):
            q = e.get("quotes") or {}
            res = old[i][9] if i < len(old) and len(old[i]) > 10 else ""
            sc = old[i][10] if res else ""
            if not res:
                nm = split(e.get("name"))
                st = utc(e.get("start_at", ""))
                if nm:
                    for fh, fa, ts, gh, ga in rows:
                        if st and ts and abs(ts - st) > 6 * 3600:
                            continue
                        if E.same(nm[0], fh) and E.same(nm[1], fa):
                            res, sc = ("1" if gh > ga else "2" if gh < ga else "X"), "%d : %d" % (gh, ga)
                            break
            if not res and str(e.get("id")) in jres:          # итог, уже снятый журналом стратегий
                j = jres[str(e["id"])]; res, sc = j.get("r", ""), (j.get("s") or "").replace(":", " : ")
            if not res:
                nm = split(e.get("name")); st = utc(e.get("start_at", ""))
                cand = []
                if nm:                                  # запасной проход: совпала одна команда, время ±3 ч, кандидат один
                    for fh, fa, ts, gh, ga in rows:
                        if st and ts and abs(ts - st) <= 3 * 3600 and (E.same(nm[0], fh) or E.same(nm[1], fa)):
                            cand.append((gh, ga))
                if len(set(cand)) == 1 and len(cand) == 1:
                    gh, ga = cand[0]; res, sc = ("1" if gh > ga else "2" if gh < ga else "X"), "%d : %d" % (gh, ga)
            found += 1 if res else 0
            ev_out.append([(split(e.get("name")) or [e.get("name"), ""])[0], (split(e.get("name")) or ["", ""])[1], e.get("championship", ""),
                           q.get("bk_win_1"), q.get("bk_draw"), q.get("bk_win_2"), q.get("pool_win_1"), q.get("pool_draw"), q.get("pool_win_2"), res, sc])
        prev = sum(1 for x in old if len(x) > 10 and x[9])
        print("fonres: тираж №%s — итогов %d из %d (было %d)" % (d.get("number"), found, len(evs), prev))
        if found > prev:
            hist["draws"][str(d["number"])] = {"id": d.get("id"), "ended_at": d.get("ended_at"), "pool_sum": d.get("pool_sum"),
                                                "jackpot": d.get("jackpot"), "ev": ev_out}
            changed += 1
    if changed:
        hist["count"] = len(hist["draws"])
        hist["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(HIST, "w", encoding="utf-8") as f:
            json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
    return changed


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("fonres: сбой:", repr(e))
