#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Фонбет: стратегии «Защита» и «Монстр + толпа» — журнал проверки вперёд.

Каждый запуск (вместе с зеркалом ленты):
 1. пока тираж Фонбета принимает ставки, пересчитывает два прямоугольных купона на нескольких суммах
    (те же правила, что в app.js: planTilt) и перезаписывает прогноз; после дедлайна прогноз заморожен;
 2. собирает итоги сыгранных матчей из ленты Flashscore (сегодня и завтра; хранит в журнале по id события,
    потому что лента глубже не уходит);
 3. когда известны итоги всех 15 матчей, считает по каждому купону: сколько матчей накрыто и сколько строк
    угадали 13, 14, 15.
Выплаты Фонбета в данных не публикуются, поэтому считаем попадания, а не рубли.
Результат: data/api/fon/strat_journal.json. Только стандартная библиотека.

  «Защита»  — вес исхода p (вероятность по линии конторы): максимум шанса накрыть матч.
  «Монстр + толпа» — вес p·(p/c)^0,6 (c — доля игроков): добор исходов, которые толпа недогружает.
"""
import json, math, os, re, sys, time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "data", "api")
FON = os.path.join(API, "fon")
OUT = os.path.join(FON, "strat_journal.json")
PRICE = 50
BUDGETS = [1, 64, 324, 1024, 6000]       # строк (6000 × 50 ₽ = 300 000 ₽ — потолок)
GAMMA = {"zash": 0.0, "cen": 0.6}
NAMES = {"zash": "Защита", "cen": "Монстр + толпа"}
CMIN = 0.02                              # доля игроков не ниже 2%, чтобы не делить на ноль
KEEP = 60                                # тиражей в журнале

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def rd(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def probs(q):
    """(p, c): линия конторы и доли игроков, нормированные на 100%."""
    try:
        b = [float(q["bk_win_1"]), float(q["bk_draw"]), float(q["bk_win_2"])]
        c = [float(q["pool_win_1"]), float(q["pool_draw"]), float(q["pool_win_2"])]
    except (KeyError, TypeError, ValueError):
        return None
    sb, sc = sum(b), sum(c)
    if sb <= 0 or sc <= 0:
        return None
    return [x / sb for x in b], [max(x / sc, CMIN) for x in c]


def plan_tilt(P, C, n_max, gamma):
    """Прямоугольный купон: по каждому матчу набор исходов, произведение размеров не больше n_max.
    Шаг жадного добора — исход с лучшей прибавкой log(доля набора) на log(рост числа строк)."""
    m = len(P)
    w = [[P[i][j] * (P[i][j] / C[i][j]) ** gamma for j in range(3)] for i in range(m)]
    sets = [[max(range(3), key=lambda j: (w[i][j], -j))] for i in range(m)]
    lines = 1
    while True:
        best = None
        for i in range(m):
            n = len(sets[i])
            if n >= 3 or lines // n * (n + 1) > n_max:
                continue
            s = sum(w[i][j] for j in sets[i])
            for j in range(3):
                if j in sets[i]:
                    continue
                g = math.log((s + w[i][j]) / s) / math.log((n + 1) / n)
                if best is None or g > best[0] + 1e-12:
                    best = (g, i, j)
        if best is None:
            break
        _, i, j = best
        lines = lines // len(sets[i]) * (len(sets[i]) + 1)
        sets[i].append(j)
    return ["".join("1X2"[j] for j in sorted(s)) for s in sets]


def lines_of(sets):
    n = 1
    for s in sets:
        n *= len(s)
    return n


def score(sets, res):
    """Накрыто матчей и распределение строк по числу угаданных (свёртка по матчам)."""
    dist = [1]
    cov = 0
    for s, r in zip(sets, res):
        hit = r in s
        cov += hit
        f = [len(s) - 1, 1] if hit else [len(s), 0]
        nd = [0] * (len(dist) + 1)
        for k, v in enumerate(dist):
            nd[k] += v * f[0]
            nd[k + 1] += v * f[1]
        dist = nd
    return cov, dist


def ru_names(en, ru):
    m = re.match(r"^(.*?)(\s*\((?:w|W)\))?$", en.strip())
    r = ru.get(m.group(1))
    return None if not r else r + (" (ж)" if m.group(2) else "")


def split_name(name):
    parts = [s.strip() for s in re.split(r"\s+[–—-]\s+", str(name or ""))]
    return parts if len(parts) == 2 else None


def feed_results():
    """Сыгранные матчи ленты: [(дом, гость, время, счёт дома, счёт гостей)]."""
    import emblems as E
    rows = []
    for day in (0, 1):
        try:
            text = E.get(E.FEED % (1, day)).decode("utf-8", "ignore")
        except Exception as e:
            print("лента", day, "не снялась:", e)
            continue
        for rec in text.split("¬~"):
            o = {}
            for part in rec.split("¬"):
                kv = part.split("÷")
                if len(kv) == 2:
                    o[kv[0]] = kv[1]
            if o.get("AB") != "3" or not (o.get("AE") and o.get("AF")):
                continue
            try:
                rows.append((o["AE"], o["AF"], int(o.get("AD", "0")), int(o["AG"]), int(o["AH"])))
            except (KeyError, ValueError):
                continue
    return rows, E


def utc(s):
    try:
        return datetime.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0


def main():
    now = time.time()
    jr = rd(OUT, {})
    jr.setdefault("draws", {})
    jr.setdefault("results", {})
    jr["strategies"] = {k: {"name": NAMES[k], "gamma": GAMMA[k]} for k in GAMMA}
    jr["budgets"] = BUDGETS
    jr["price"] = PRICE
    ru = rd(os.path.join(FON, "ru.json"), {}).get("t", {})
    draws = rd(os.path.join(FON, "drawings-1.json"), {})
    draws = draws.get("data", draws) if isinstance(draws, dict) else draws
    infos = []
    for d in (draws or [])[:4]:
        info = rd(os.path.join(FON, "drawing-info-%s.json" % d.get("id")), None)
        if not info:
            continue
        info = info.get("data", info)
        if info.get("events"):
            infos.append(info)

    # 1. прогнозы: перезапись до дедлайна, после него заморожено
    for info in infos:
        num = str(info.get("number"))
        end = utc(str(info.get("ended_at") or ""))
        rec = jr["draws"].get(num)
        if rec and (rec.get("frozen") or (rec.get("end") and now >= rec["end"])):
            if rec and not rec.get("frozen"):
                rec["frozen"] = True
            continue
        if not end or now >= end:
            continue        # дедлайн уже прошёл, а прогноза не было: задним числом не пишем
        evs = sorted(info["events"], key=lambda e: e.get("order") or 0)
        PC = [probs(e.get("quotes") or {}) for e in evs]
        if len(evs) != 15 or any(x is None for x in PC):
            continue
        P = [x[0] for x in PC]
        C = [x[1] for x in PC]
        rec = {"id": info.get("id"), "end": end, "snap": datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
               "ev": [{"id": e.get("id"), "name": e.get("name"), "start": e.get("start_at"),
                       "p": [round(x, 4) for x in P[i]], "c": [round(x, 4) for x in C[i]]} for i, e in enumerate(evs)],
               "sets": {}}
        for k, g in GAMMA.items():
            rec["sets"][k] = {str(n): plan_tilt(P, C, n, g) for n in BUDGETS}
        jr["draws"][num] = rec
        print("прогноз тиража", num, "обновлён")

    # 2. итоги из ленты
    need = []
    for num, rec in jr["draws"].items():
        if rec.get("done"):
            continue
        for e in rec["ev"]:
            if str(e["id"]) not in jr["results"]:
                need.append(e)
    if need:
        try:
            rows, E = feed_results()
        except Exception as e:
            rows, E = [], None
            print("итоги не собраны:", e)
        for e in need:
            nm = split_name(e["name"])
            if not nm or E is None:
                continue
            h, a = ru_names(nm[0], ru), ru_names(nm[1], ru)
            if not h or not a:
                continue
            st = utc(e.get("start") or "")
            for fh, fa, ts, gh, ga in rows:
                if st and ts and abs(ts - st) > 8 * 3600:
                    continue
                if E.same(h, fh) and E.same(a, fa):
                    jr["results"][str(e["id"])] = {"s": "%d:%d" % (gh, ga), "r": "1" if gh > ga else ("2" if gh < ga else "X")}
                    print("итог", e["name"], gh, ga)
                    break

    # 3. подсчёт закрытых тиражей
    for num, rec in jr["draws"].items():
        if rec.get("done") or now < rec.get("end", 1e18):
            continue
        res = [(jr["results"].get(str(e["id"])) or {}).get("r") for e in rec["ev"]]
        if any(r is None for r in res):
            rec["res_n"] = sum(r is not None for r in res)
            continue
        rec["res"] = res
        rec["score"] = {}
        for k in rec["sets"]:
            rec["score"][k] = {}
            for n, sets in rec["sets"][k].items():
                cov, dist = score(sets, res)
                tail = lambda t: sum(dist[t:])
                rec["score"][k][n] = {"lines": lines_of(sets), "cov": cov, "l15": dist[15], "l14": tail(14), "l13": tail(13), "l12": tail(12)}
        rec["done"] = True
        print("тираж", num, "посчитан")

    # 4. сводка
    summ = {}
    for k in GAMMA:
        for n in BUDGETS:
            xs = [r["score"][k][str(n)] for r in jr["draws"].values() if r.get("done") and r.get("score", {}).get(k, {}).get(str(n))]
            if not xs:
                continue
            c = len(xs)
            summ["%s|%d" % (k, n)] = {
                "n": c, "cov": round(sum(x["cov"] for x in xs) / c, 2),
                "c12": sum(x["cov"] >= 12 for x in xs), "c13": sum(x["cov"] >= 13 for x in xs),
                "c14": sum(x["cov"] >= 14 for x in xs), "c15": sum(x["cov"] >= 15 for x in xs),
                "l13": sum(x["l13"] for x in xs), "l14": sum(x["l14"] for x in xs), "l15": sum(x["l15"] for x in xs)}
    jr["summary"] = summ

    # хвост: свежие тиражи и итоги только по ним
    keep = sorted(jr["draws"], key=lambda x: int(x))[-KEEP:]
    jr["draws"] = {k: jr["draws"][k] for k in keep}
    ids = {str(e["id"]) for r in jr["draws"].values() for e in r["ev"]}
    jr["results"] = {k: v for k, v in jr["results"].items() if k in ids}
    jr["updated"] = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(jr, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("fonstrat: ошибка, пропускаю:", e)
