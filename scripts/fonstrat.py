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
  «Монстр + толпа» — как «добор Монстра»: ядро — линия конторы со сдвигом по фактам ИИ и p·(p/c)^0,6 (c — доля игроков);
                   допы — по доводам источников из data/api/fon/ai.json: сначала исход с самым доверенным доводом
                   (факты ИИ, усталость, разбор ИИ, критик, Betzona, история, xG, мотивация), внутри ранга — по приросту шанса.
                   Те же формулы в app.js (tiltStrengthAi).
"""
import json, math, os, re, sys, time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "data", "api")
FON = os.path.join(API, "fon")
OUT = os.path.join(FON, "strat_journal.json")
PRICE = 50
BUDGETS = [1, 64, 324, 1024, 6000]       # строк (6000 × 50 ₽ = 300 000 ₽ — потолок)
GAMMA = {"zash": 0.0, "cen": 0.6}       # γ «Монстра + толпы» меняет обучение (learn.gamma)
GRID = {"g3": 0.3, "g6": 0.6, "g9": 0.9}  # теневые варианты наклона против толпы: сравниваются на итогах, победитель становится рабочим
GRID_BUDGETS = [324, 1024]
MIN_OBS = 60                              # наблюдений по источнику, прежде чем его ранг меняется
MIN_DRAWS = 10                            # закрытых тиражей, прежде чем γ может смениться
K_CAL = 45                                # вес «приора» калибровки линии (матчей)
SWITCH = 0.15                             # на сколько в среднем должен быть лучше вариант, чтобы сменить γ
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


def edge_list(d):
    """Сдвиги по фактам ИИ и усталости (kelEdges на сайте; доверие источников не учится, множитель 1)."""
    L = d.get("adj")
    if not L:
        e = d.get("edge")
        L = [{"o": e.get("o"), "d": 0.06 if int(e.get("f") or 0) == 2 else 0.03, "why": e.get("why")}] if isinstance(e, dict) and e.get("why") else []
    out = []
    for a in L or []:
        try:
            if a and a.get("o") in ("1", "X", "2") and float(a.get("d")) > 0 and a.get("why"):
                out.append((a["o"], float(a["d"]), 2 if a.get("src") == "Усталость" else 1))
        except (TypeError, ValueError):
            pass
    return out


def edge_adj(p, L):
    """edgeAdj на сайте: суммарный сдвиг не больше 8 п.п., берётся у остальных исходов пропорционально."""
    if not L:
        return list(p)
    q = list(p)
    add = [0.0, 0.0, 0.0]
    for o, dd, _ in L:
        add["1X2".index(o)] += dd
    tot = sum(add)
    if tot > 0.08:
        add = [x * 0.08 / tot for x in add]
    for k in range(3):
        if not add[k] > 0:
            continue
        d = min(add[k], 0.9 - q[k])
        rest = 1 - q[k]
        if not d > 0 or not rest > d:
            continue
        qk = q[k]
        for j in range(3):
            q[j] = qk + d if j == k else q[j] * (rest - d) / rest
    return q


def src_tiers(d):
    """Ранг самого доверенного довода по каждому исходу (как min t в monsterSrc без обучения); нет довода — 9."""
    tier = [9, 9, 9]
    seen = [False, False, False]

    def put(o, t):
        k = "1X2".index(o)
        if not seen[k] or t < tier[k]:
            tier[k] = t
        seen[k] = True
    for o, _, t in edge_list(d):
        put(o, t)                                                        # факты ИИ (1) / усталость (2)
    for o in str(d.get("p") or ""):
        if o in "1X2":
            put(o, 3)                                                    # Разбор ИИ
    tr = d.get("trap")
    if isinstance(tr, dict) and tr.get("o") in ("1", "X", "2"):
        put(tr["o"], 4)                                                  # ИИ-критик
    for o in "1X2":
        if any(x.get("s") == o for x in d.get("bza") or []): put(o, 5)   # Betzona: факты
        if any(x.get("s") == o for x in d.get("bth") or []): put(o, 8)   # Балтсистема: история
        if any(x.get("s") == o and x.get("k") == "xG" for x in d.get("cx") or []): put(o, 9)
        if any(x.get("s") == o and x.get("k") == "мотивация" for x in d.get("cx") or []): put(o, 10)
        if any(x.get("s") == o and (x.get("w") or 0) >= 2 for x in d.get("bze") or []): put(o, 7)   # Betzona: события
    bzw, bz = d.get("bzw"), d.get("bz")
    if bzw:
        v = {o: bzw.get(o) or 0 for o in "1X2"}
        mw = max(v.values())
        for o in "1X2":
            if mw >= 1 and v[o] >= mw: put(o, 6)                         # Betzona: голоса
    elif bz and bz.get("n"):
        v = {o: (bz.get("v") or {}).get(o) or 0 for o in "1X2"}
        mx = max(v.values())
        for o in "1X2":
            if mx > 0 and v[o] >= mx: put(o, 6)
    return tier


def strength_ai(p, c, d, gamma, tmap=None):
    """Ядро «Монстр + толпа» для одного матча: сила исходов и ранги доводов (d — разбор ИИ по матчу или None)."""
    pr = edge_adj(p, edge_list(d)) if d else list(p)
    w = [pr[j] * (pr[j] / c[j]) ** gamma for j in range(3)]
    z = sum(w)
    raw = src_tiers(d) if d else [9, 9, 9]
    return [x / z for x in w], [(tmap or {}).get(str(t), t) for t in raw], raw


def plan_tilt(P, C, n_max, gamma, AI=None, tmap=None):
    """Прямоугольный купон: по каждому матчу набор исходов, произведение размеров не больше n_max.
    Шаг жадного добора — прирост log(вес набора) на log(рост числа строк); с AI сначала идут исходы с лучшим рангом довода."""
    m = len(P)
    tiers = None
    if AI is not None:
        pairs = [strength_ai(P[i], C[i], AI[i], gamma, tmap) for i in range(m)]
        w = [x[0] for x in pairs]
        tiers = [x[1] for x in pairs]
    else:
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
                tr = tiers[i][j] if tiers else 0
                if best is None or tr < best[0] or (tr == best[0] and g > best[1] + 1e-12):
                    best = (tr, g, i, j)
        if best is None:
            break
        _, _, i, j = best
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


def Date_end(h):
    return utc(str(h.get("ended_at") or "")[:19])


def utc(s):
    try:
        return datetime.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0


def mult_apply(P, mult):
    """Поправка линии: p·m (m — выученные множители исходов) и нормировка."""
    out = []
    for p in P:
        v = [p[j] * mult[j] for j in range(3)]
        z = sum(v)
        out.append([x / z for x in v])
    return out


def learn_update(jr, now):
    """Обучение по закрытым тиражам журнала: 1) калибровка линии (множители 1/X/2),
    2) ранги источников доводов (по тому, насколько их исходы выпадали чаще линии),
    3) γ «Монстра + толпы» — по теневым вариантам 0,3/0,6/0,9. Всё пересчитывается с нуля при каждом запуске."""
    L = jr.get("learn") or {}
    done = [r for r in jr["draws"].values() if r.get("done") and r.get("res")]
    hits = [0, 0, 0]
    exp = [0.0, 0.0, 0.0]
    obs = {}
    for r in done:
        for i, e in enumerate(r["ev"]):
            o = "1X2".index(r["res"][i])
            hits[o] += 1
            for j in range(3):
                exp[j] += e.get("p0", e["p"])[j]
        for i, tr in enumerate(r.get("tr") or []):
            for j in range(3):
                t = tr[j]
                if t >= 9:
                    continue
                x = obs.setdefault(str(t), [0, 0, 0.0])
                x[0] += 1
                x[1] += 1 if "1X2"[j] == r["res"][i] else 0
                x[2] += r["ev"][i].get("p0", r["ev"][i]["p"])[j]
    mult = [round(min(1.25, max(0.8, (hits[j] + K_CAL) / (exp[j] + K_CAL))), 4) for j in range(3)]
    # ранги источников: изученные (>= MIN_OBS) меняются местами между своими же местами по приросту над линией
    lift = {t: x[1] / x[2] for t, x in obs.items() if x[0] >= MIN_OBS and x[2] > 0}
    slots = sorted(int(t) for t in lift)
    order = sorted(lift, key=lambda t: -lift[t])
    tier = {str(slots[i]): None for i in range(len(slots))}
    tmap = {}
    for i, t in enumerate(order):
        tmap[t] = float(slots[i])
    # γ: теневые варианты
    gam = {}
    for k, g in GRID.items():
        xs = []
        for r in done:
            sc = r.get("score", {}).get(k)
            if sc and all(str(b) in sc for b in GRID_BUDGETS):
                xs.append(sum(sc[str(b)]["cov"] for b in GRID_BUDGETS) / len(GRID_BUDGETS))
        if xs:
            gam[k] = {"g": g, "n": len(xs), "cov": round(sum(xs) / len(xs), 3)}
    live = L.get("gamma", GAMMA["cen"])
    nmin = min([v["n"] for v in gam.values()] or [0])
    if len(gam) == len(GRID) and nmin >= MIN_DRAWS:
        cur = min(gam.values(), key=lambda v: abs(v["g"] - live))
        best = max(gam.values(), key=lambda v: v["cov"])
        if best["g"] != cur["g"] and best["cov"] >= cur["cov"] + SWITCH:
            L.setdefault("log", []).append({"at": datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d"), "gamma": [live, best["g"]], "cov": [cur["cov"], best["cov"]], "draws": nmin})
            live = best["g"]
    L.update({"gamma": live, "mult": mult if done else [1.0, 1.0, 1.0], "tmap": tmap, "n": len(done),
              "obs": {t: {"n": x[0], "hit": x[1], "exp": round(x[2], 2)} for t, x in sorted(obs.items(), key=lambda kv: int(kv[0]))},
              "gam": gam, "need": {"obs": MIN_OBS, "draws": MIN_DRAWS, "switch": SWITCH}})
    L["log"] = (L.get("log") or [])[-20:]
    jr["learn"] = L
    return L


def main():
    now = time.time()
    jr = rd(OUT, {})
    jr.setdefault("draws", {})
    jr.setdefault("results", {})
    L0 = jr.get("learn") or {}
    gam_live = L0.get("gamma", GAMMA["cen"])
    mult = L0.get("mult") or [1.0, 1.0, 1.0]
    tmap = L0.get("tmap") or {}
    jr["strategies"] = {k: {"name": NAMES[k], "gamma": (gam_live if k == "cen" else GAMMA[k])} for k in GAMMA}
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
        ai = rd(os.path.join(FON, "ai.json"), {})
        AI = ai.get("m") if str(ai.get("number")) == num and isinstance(ai.get("m"), list) and len(ai["m"]) == 15 else None
        rec["ai"] = bool(AI)
        P = mult_apply(P, mult)            # линия с выученной калибровкой (без неё множители равны 1)
        rec["ev"] = [dict(x, p=[round(v, 4) for v in P[i]], p0=x["p"]) for i, x in enumerate(rec["ev"])]
        rec["learn"] = {"gamma": gam_live, "mult": mult, "tmap": tmap}
        rec["tr"] = [src_tiers(AI[i]) for i in range(15)] if AI else None
        for k, g in GAMMA.items():
            gg = gam_live if k == "cen" else g
            rec["sets"][k] = {str(n): plan_tilt(P, C, n, gg, AI if k == "cen" else None, tmap) for n in BUDGETS}
        if AI:
            for k, g in GRID.items():
                rec["sets"][k] = {str(n): plan_tilt(P, C, n, g, AI, tmap) for n in GRID_BUDGETS}
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

    # 2б. итоги из архива fonres.py (history.json): матчи, сыгранные раньше, чем лента «сегодня» успела их отдать
    try:
        hd = rd(os.path.join(FON, "history.json"), {}).get("draws", {})
        for num, rec in jr["draws"].items():
            h = hd.get(str(num))
            if rec.get("done") or not h or abs(Date_end(h) - rec.get("end", 0)) > 2 * 86400:
                continue
            for i, e in enumerate(rec["ev"]):
                x = h["ev"][i] if i < len(h.get("ev", [])) else None
                if x and len(x) > 10 and x[9] in ("1", "X", "2") and str(e["id"]) not in jr["results"]:
                    jr["results"][str(e["id"])] = {"s": str(x[10]).replace(" ", ""), "r": x[9]}
    except Exception as e:
        print("итоги из архива не подмешаны:", e)

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
    for k in list(GAMMA) + list(GRID):
        for n in (BUDGETS if k in GAMMA else GRID_BUDGETS):
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
    learn_update(jr, now)

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
