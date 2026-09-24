#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Зеркало данных для сайта «ДЖЕК» (dzhek15.github.io).

Раз в полчаса GitHub Actions запускает этот скрипт. Он:
  1. снимает копию API totobrief (список тиражей + drawing-info активного и
     последних завершённых) и кладёт её в data/api/ в ТОМ ЖЕ формате, что отдаёт
     totobrief — сайт читает эти файлы, когда totobrief не отвечает;
  2. параллельно читает страницу stavka.tv: состав текущего тиража, дедлайн,
     джекпот, пул и результаты завершённых тиражей. Если totobrief лежит долго,
     из этих данных собираются синтетические записи (id вида "s5012"), чтобы
     сайт видел новый тираж и результаты хотя бы без процентов и коэффициентов;
  3. пишет data/api/status.json — когда что последний раз удавалось снять.

Файлы в data/api/ — единственное состояние: скрипт читает их, обновляет и
пишет обратно; workflow коммитит изменения. Никаких внешних зависимостей.
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "api")
TB = "https://totobrief.com/api/v1/community/"
STAVKA = "https://stavka.tv/promo/sets/baltbet-superexpress-toto"
UA = "Mozilla/5.0 (X11; Linux x86_64) dzhek-feed/1.0 (+https://dzhek15.github.io)"
PAGES = 6            # столько страниц списка тиражей читает сайт для шкалы «ценность тиража»
KEEP_INFO = 8        # сколько drawing-info хранить (активный + последние завершённые)
HIST_PAGES = 20      # глубина истории: страниц списка по 50 тиражей (≈ 1000 тиражей, почти три года)
HIST_FETCH = 80      # сколько недостающих завершённых тиражей дотягивать в историю за один запуск
HIST_MAX = 1000      # сколько тиражей держать в history.json
HIST_MIN_RES = 12    # тираж берём в историю, если итог есть хотя бы у стольких матчей (отменённые — пусто)
MSK = timezone(timedelta(hours=3))

DASH = re.compile(r"\s+[—–−-]\s+")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def jget(url):
    return json.loads(get(url).decode("utf-8"))


def rd(name, default):
    p = os.path.join(OUT, name)
    if not os.path.exists(p):
        return default
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # битый файл — не повод падать
        log("не прочитал", name, e)
        return default


def wr(name, obj):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    new = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    old = None
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            old = f.read()
    if old == new:
        return False
    with open(p, "w", encoding="utf-8") as f:
        f.write(new)
    return True


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm_name(s):
    return re.sub(r"[^a-zа-яё0-9]+", "", (s or "").lower().replace("ё", "е"))


# ---------------------------------------------------------------- totobrief
def snap_totobrief():
    """Возвращает (pages, infos) или бросает исключение, если API недоступно."""
    pages = []
    for p in range(1, PAGES + 1):
        j = jget(TB + "baltbet-main/drawings?page=%d" % p)
        rows = (j or {}).get("data") or []
        pages.append(j)
        if not rows:
            break
    rows1 = (pages[0] or {}).get("data") or []
    if not rows1:
        raise RuntimeError("пустой список тиражей")
    want = [r for r in rows1 if r.get("status") == "active"][:2]
    fin = [r for r in rows1 if r.get("status") != "active"]
    want += fin[: max(1, KEEP_INFO - len(want))]
    infos = {}
    for r in want:
        try:
            j = jget(TB + "drawing-info/%s" % r["id"])
            infos[str(r["id"])] = j
        except Exception as e:
            log("drawing-info", r.get("id"), "не снялся:", e)
    return pages, infos


# ---------------------------------------------------------------- stavka.tv
class Blocks(HTMLParser):
    """Раскладывает страницу на поток блоков: ('text', str) и ('table', [[ячейки]])."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.table = None
        self.row = None
        self.cell = None
        self.skip = 0
        self.buf = []

    def flush_text(self):
        t = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        self.buf = []
        if t:
            self.blocks.append(("text", t))

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        elif tag == "table":
            self.flush_text()
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag in ("br", "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article") and self.table is None:
            self.flush_text()

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            if self.table:
                self.blocks.append(("table", self.table))
            self.table = None
        elif tag in ("p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article") and self.table is None:
            self.flush_text()

    def handle_data(self, data):
        if self.skip:
            return
        if self.cell is not None:
            self.cell.append(data)
        elif self.table is None:
            self.buf.append(data)

    def close(self):
        super().close()
        self.flush_text()


def num(s):
    d = re.sub(r"[^\d]", "", s or "")
    return int(d) if d else None


def to_iso_msk(dd_mm_yyyy, hh_mm):
    """'20.09.2026','16:00' → '2026-09-20T16:00:00.000000Z' — как отдаёт totobrief
    (московское время с буквой Z, сайт трактует его именно так)."""
    d, m, y = dd_mm_yyyy.split(".")
    return "%s-%s-%sT%s:00.000000Z" % (y, m, d, hh_mm)


def result_from_score(score):
    m = re.match(r"^\s*(\d+)\s*:\s*(\d+)\s*$", score or "")
    if not m:
        return None
    a, b = int(m.group(1)), int(m.group(2))
    return "1" if a > b else ("2" if b > a else "X")


def parse_stavka(html):
    p = Blocks()
    p.feed(html)
    p.close()
    text = " \n ".join(t for k, t in p.blocks if k == "text")

    cur = {}
    m = re.search(r"Окончание при[её]ма ставок:\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})", text)
    if m:
        cur["ended_at"] = to_iso_msk(m.group(1), m.group(2).zfill(5))
    m = re.search(r"Джекпот:\s*([\d\s ]+)", text)
    if m:
        cur["jackpot"] = num(m.group(1))
    m = re.search(r"Пул:\s*([\d\s ]+)", text)
    if m:
        cur["pool_sum"] = num(m.group(1))
    m = re.search(r"Тираж:\s*№\s*(\d{3,5})", text) or re.search(r"Суперэкспресс\s*№\s*(\d{3,5})", text)
    if m:
        cur["number"] = int(m.group(1))

    matches = None
    results = []          # [{number, date, rows:[{home, away, result, score}]}]
    last_head = None      # (number, date) из ближайшего заголовка «Тираж №5011 19.09.2026»
    for kind, b in p.blocks:
        if kind == "text":
            m = re.search(r"Тираж\s*№\s*(\d{3,5})(?:\D{0,12}(\d{2}\.\d{2}\.\d{4}))?", b)
            if m and "Окончание" not in b:
                last_head = (int(m.group(1)), m.group(2))
            continue
        rows = [r for r in b if len(r) >= 2 and DASH.search(r[0])]
        if len(rows) < 10:
            continue
        head = [c.upper() for c in b[0]]
        is_res = any("СЧ" in c or "РЕЗУЛЬТАТ" in c for c in head) or all(
            re.search(r"\d+\s*:\s*\d+", r[-1] or "") or r[-1] in ("", "—", "-") for r in rows)
        parsed = []
        for r in rows:
            t = DASH.split(r[0], 1)
            if len(t) < 2:
                continue
            parsed.append({"home": t[0].strip(), "away": t[1].strip(), "cells": r[1:]})
        if not is_res and matches is None:
            matches = [{"home": x["home"], "away": x["away"],
                        "editor": (x["cells"][0] if x["cells"] else ""),
                        "popular": (x["cells"][1] if len(x["cells"]) > 1 else "")} for x in parsed]
        elif is_res and last_head:
            out = []
            for x in parsed:
                score = next((c for c in x["cells"] if re.search(r"\d+\s*:\s*\d+", c)), "")
                score = re.sub(r"\s+", "", score)
                res = next((c for c in x["cells"] if c in ("1", "X", "2", "Х")), "")
                res = "X" if res == "Х" else res
                out.append({"home": x["home"], "away": x["away"],
                            "result": res or result_from_score(score) or None,
                            "score": score or None})
            results.append({"number": last_head[0], "date": last_head[1], "rows": out})
            last_head = None
    cur["matches"] = matches or []
    return {"fetched_at": now_iso(), "current": cur, "results": results}


# ---------------------------------------------------------------- слияние
def synth_info(number, ended_at, matches):
    """drawing-info в формате totobrief, собранный из данных stavka."""
    evs = []
    for i, m in enumerate(matches):
        evs.append({"order": i + 1, "name": "%s — %s" % (m["home"], m["away"]),
                    "championship": "", "result": m.get("result"), "score": m.get("score"),
                    "quotes": {}, "synthetic": True})
    return {"data": {"id": "s%d" % number, "number": number, "ended_at": ended_at,
                     "status": "active", "events": evs, "synthetic": True}}


def merge_stavka(st, pages, infos):
    """Дополняет зеркало данными stavka: новый тираж, которого нет в списке, и
    результаты завершённых. Возвращает список текстовых пометок для лога."""
    notes = []
    page1 = pages[0] if pages else {"data": []}
    rows = page1.setdefault("data", [])
    by_num = {str(r.get("number")): r for r in rows}
    cur = st.get("current") or {}
    n = cur.get("number")

    if n and len(cur.get("matches") or []) >= 10:
        key = str(n)
        if key not in by_num:
            row = {"id": "s%d" % n, "number": n, "status": "active",
                   "ended_at": cur.get("ended_at"), "jackpot": cur.get("jackpot"),
                   "pool_sum": cur.get("pool_sum"), "synthetic": True}
            rows.insert(0, row)
            by_num[key] = row
            infos["s%d" % n] = synth_info(n, cur.get("ended_at"), cur["matches"])
            notes.append("тираж %d добавлен по данным stavka" % n)
        elif by_num[key].get("synthetic"):
            r = by_num[key]
            r["jackpot"] = cur.get("jackpot") or r.get("jackpot")
            r["pool_sum"] = cur.get("pool_sum") or r.get("pool_sum")
            r["ended_at"] = cur.get("ended_at") or r.get("ended_at")
            if str(r["id"]) not in infos:
                infos[str(r["id"])] = synth_info(n, r.get("ended_at"), cur["matches"])

    # у синтетических записей статус ведём сами: дедлайн прошёл — тираж «идёт», всё сыграно — finished
    nowu = datetime.now(timezone.utc)
    for r in rows:
        if not r.get("synthetic"):
            continue
        try:
            dl = datetime.strptime(r["ended_at"][:16], "%Y-%m-%dT%H:%M").replace(tzinfo=MSK)
        except Exception:
            continue
        if nowu > dl and r.get("status") == "active":
            r["status"] = "finished"

    # результаты: по номеру тиража → drawing-info; матчи сопоставляем по названиям, иначе по порядку
    for block in st.get("results") or []:
        key = str(block["number"])
        r = by_num.get(key)
        if not r:
            continue
        info = infos.get(str(r["id"]))
        if not info:
            continue
        d = info.get("data") or info
        evs = sorted(d.get("events") or [], key=lambda e: e.get("order") or 0)
        if not evs:
            continue
        idx = {}
        for i, e in enumerate(evs):
            t = DASH.split(e.get("name") or "", 1)
            if len(t) == 2:
                idx[(norm_name(t[0]), norm_name(t[1]))] = i
        changed = 0
        for j, x in enumerate(block["rows"]):
            i = idx.get((norm_name(x["home"]), norm_name(x["away"])))
            if i is None and len(block["rows"]) == len(evs):
                i = j
            if i is None:
                continue
            e = evs[i]
            if x.get("score") and not e.get("score"):
                e["score"] = x["score"]; changed += 1
            if x.get("result") and not e.get("result"):
                e["result"] = x["result"]; changed += 1
        if changed:
            notes.append("тираж %s: %d полей результата из stavka" % (key, changed))
    return notes


# ---------------------------------------------------------------- история для разбора матчей
def hist_row(e):
    """[home, away, championship, bk1, bkX, bk2, pool1, poolX, pool2, result, score]"""
    t = DASH.split(e.get("name") or "", 1)
    if len(t) != 2:
        return None
    q = e.get("quotes") or {}
    def g(k):
        v = q.get(k)
        return v if isinstance(v, (int, float)) else None
    res = e.get("result")
    res = "X" if res in ("X", "Х", "x") else (str(res) if res in ("1", "2", 1, 2) else None)
    return [t[0].strip(), t[1].strip(), e.get("championship") or "",
            g("bk_win_1"), g("bk_draw"), g("bk_win_2"),
            g("pool_win_1"), g("pool_draw"), g("pool_win_2"),
            res, e.get("score") or None]


def add_hist(hist, row, info):
    """Кладёт завершённый тираж в историю, если у всех матчей есть результат."""
    d = (info or {}).get("data") or info or {}
    evs = sorted(d.get("events") or [], key=lambda e: e.get("order") or 0)
    rows = [hist_row(e) for e in evs]
    rows = [r for r in rows if r]
    if len(rows) < 10 or sum(1 for r in rows if r[9]) < HIST_MIN_RES:
        return False
    hist["draws"][str(row["number"])] = {"id": row.get("id"), "ended_at": row.get("ended_at"),
                                         "pool_sum": row.get("pool_sum"), "jackpot": row.get("jackpot"), "ev": rows}
    return True


def build_history(pages, infos):
    """history.json — все завершённые тиражи из списка с линией конторы, долями пула и итогом.
    Сначала берём то, что уже снято (infos), потом дотягиваем недостающие, не больше HIST_FETCH за раз."""
    hist = rd("history.json", {"draws": {}})
    hist.setdefault("draws", {})
    hist.setdefault("skip", {})            # тиражи без итогов (много отмен) — не дёргать их каждый запуск
    added = 0
    rows = []
    for pg in pages:
        rows += [r for r in (pg.get("data") or []) if r.get("status") == "finished" and not r.get("synthetic")]
    # список тиражей глубже, чем зеркало для сайта: страницы 7..HIST_PAGES читаем только ради истории
    for p in range(len(pages) + 1, HIST_PAGES + 1):
        try:
            j = jget(TB + "baltbet-main/drawings?page=%d" % p)
        except Exception as e:
            log("история: страница", p, "не снялась:", e)
            break
        more = [r for r in ((j or {}).get("data") or []) if r.get("status") == "finished"]
        if not more:
            break
        rows += more
    for r in rows:
        k = str(r.get("number"))
        if k in hist["draws"]:
            continue
        info = infos.get(str(r.get("id")))
        if info and add_hist(hist, r, info):
            added += 1
    fetched = 0
    for r in rows:                      # список идёт от новых к старым — так и дотягиваем
        k = str(r.get("number"))
        if k in hist["draws"] or k in hist["skip"] or fetched >= HIST_FETCH:
            continue
        try:
            info = jget(TB + "drawing-info/%s" % r["id"])
            fetched += 1
            if add_hist(hist, r, info):
                added += 1
            else:
                hist["skip"][k] = "нет итогов"
                added += 1              # пометка тоже изменение файла — иначе не запишется
        except Exception as e:
            log("история: тираж", k, "не снялся:", e)
            break
    keys = sorted(hist["draws"], key=lambda x: int(x) if x.isdigit() else 0)
    for k in keys[:-HIST_MAX]:
        hist["draws"].pop(k, None)
    hist["updated_at"] = now_iso()
    hist["count"] = len(hist["draws"])
    log("история: %d тиражей, добавлено %d, дотянуто %d" % (len(hist["draws"]), added, fetched))
    return hist, added


# ---------------------------------------------------------------- Elo-рейтинг команд
ELO_K = 32            # коэффициент изменчивости
ELO_INIT = 1500       # стартовый рейтинг
ELO_PROVISIONAL = 30  # меньше матчей — рейтинг «предварительный»

def norm_name(s):
    """Тот же ключ, что в JS: lower, ё→е, только буквы/цифры."""
    return re.sub(r"[^a-zа-я0-9]+", "", (s or "").lower().replace("ё", "е"))

def build_elo(hist):
    """Считает Elo-рейтинг команд по истории тиражей.
    Результат — {имя: {rating, played, w, d, l}}, сохраняется в elo.json."""
    if not hist or not hist.get("draws"):
        return None
    # сортируем тиражи от старых к новым
    nums = sorted(hist["draws"].keys(), key=lambda x: int(x) if x.isdigit() else 0)
    ratings = {}
    for n in nums:
        d = hist["draws"][n]
        for row in d.get("ev", []):
            if len(row) < 11 or not row[9]:
                continue
            home, away = norm_name(row[0]), norm_name(row[1])
            res = row[9]
            if res not in ("1", "X", "2"):
                continue
            for t in (home, away):
                if t not in ratings:
                    ratings[t] = {"rating": ELO_INIT, "played": 0, "w": 0, "d": 0, "l": 0}
            ra, rb = ratings[home]["rating"], ratings[away]["rating"]
            ea = 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))
            if res == "1":
                sa, sb = 1.0, 0.0
                ratings[home]["w"] += 1; ratings[away]["l"] += 1
            elif res == "X":
                sa, sb = 0.5, 0.5
                ratings[home]["d"] += 1; ratings[away]["d"] += 1
            else:
                sa, sb = 0.0, 1.0
                ratings[home]["l"] += 1; ratings[away]["w"] += 1
            ratings[home]["rating"] = ra + ELO_K * (sa - ea)
            ratings[away]["rating"] = rb + ELO_K * (sb - (1 - ea))
            ratings[home]["played"] += 1
            ratings[away]["played"] += 1
    # сортируем по рейтингу убыванию
    out = []
    for name, r in sorted(ratings.items(), key=lambda x: -x[1]["rating"]):
        out.append({"name": name, "rating": round(r["rating"]), "played": r["played"],
                    "w": r["w"], "d": r["d"], "l": r["l"],
                    "provisional": r["played"] < ELO_PROVISIONAL})
    log("elo: %d команд, топ-3: %s" % (len(out), ", ".join(
        "%s %d" % (o["name"][:12], o["rating"]) for o in out[:3])))
    return {"teams": out, "updated_at": now_iso(), "count": len(out)}


def main():
    status = rd("status.json", {})
    pages = [rd("drawings-%d.json" % p, None) for p in range(1, PAGES + 1)]
    pages = [p for p in pages if p]
    infos = {}
    for fn in (os.listdir(OUT) if os.path.isdir(OUT) else []):
        m = re.match(r"drawing-info-([\w-]+)\.json$", fn)
        if m:
            infos[m.group(1)] = rd(fn, None)
    infos = {k: v for k, v in infos.items() if v}

    tb_ok = False
    hist_changed = False
    tb_err = st_err = None
    try:
        pages, infos_new = snap_totobrief()
        # totobrief жив — его данные главнее любых синтетических
        infos = {k: v for k, v in infos.items() if not str(k).startswith("s")}
        infos.update(infos_new)
        for pg in pages:
            pg["data"] = [r for r in (pg.get("data") or []) if not r.get("synthetic")]
        tb_ok = True
        log("totobrief: %d страниц, %d drawing-info" % (len(pages), len(infos_new)))
        try:
            hist, hist_added = build_history(pages, infos)
            if hist_added:
                hist_changed = wr("history.json", hist)
                status["history_count"] = hist["count"]
            # Elo-рейтинг пересчитываем по истории раз в запуск (быстро)
            try:
                elo = build_elo(hist)
                if elo:
                    changed_elo = wr("elo.json", elo)
                    hist_changed = hist_changed or changed_elo
            except Exception as e:
                log("elo не собрался:", repr(e))
        except Exception as e:
            log("история не собралась:", repr(e))
    except Exception as e:
        log("totobrief недоступен:", repr(e))
        tb_err = repr(e)[:160]

    st_ok = False
    try:
        html = get(STAVKA).decode("utf-8", "replace")
        st = parse_stavka(html)
        cur = st["current"]
        log("stavka: тираж %s, матчей %d, результатов %d" % (cur.get("number"), len(cur.get("matches") or []), len(st["results"])))
        if cur.get("number") and cur.get("matches"):
            st_ok = True
            status["stavka_current"] = cur.get("number")
        wr("stavka.json", st)
        if not pages:
            pages = [{"data": []}]
        for note in merge_stavka(st, pages, infos):
            log(note)
    except Exception as e:
        log("stavka недоступна:", repr(e))
        st_err = repr(e)[:160]

    # оставляем ограниченное число drawing-info: активные + свежие завершённые из первой страницы
    keep = set()
    if pages:
        for r in (pages[0].get("data") or [])[:KEEP_INFO + 2]:
            keep.add(str(r.get("id")))
    for k in list(infos):
        if k not in keep:
            infos.pop(k)
    removed = False
    # на диске не должно оставаться drawing-info, которых нет в актуальном наборе
    # (в том числе синтетических «s…» после того, как totobrief ожил)
    for fn in (os.listdir(OUT) if os.path.isdir(OUT) else []):
        m = re.match(r"drawing-info-([\w-]+)\.json$", fn)
        if m and m.group(1) not in infos:
            os.remove(os.path.join(OUT, fn))
            removed = True

    changed = (1 if removed else 0) + (1 if hist_changed else 0)
    for i, pg in enumerate(pages):
        changed += wr("drawings-%d.json" % (i + 1), pg)
    for k, v in infos.items():
        changed += wr("drawing-info-%s.json" % k, v)
    # updated_at двигаем только когда что-то реально поменялось или раз в 6 часов —
    # иначе каждые полчаса был бы пустой коммит и лишняя пересборка Pages
    prev_upd = status.get("updated_at") or ""
    stale = True
    try:
        stale = (datetime.now(timezone.utc) - datetime.strptime(prev_upd, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)) > timedelta(hours=6)
    except Exception:
        pass
    flags_changed = (status.get("totobrief_ok") != tb_ok) or (status.get("stavka_ok") != st_ok)
    if changed or stale or flags_changed or not prev_upd:
        status["updated_at"] = now_iso()
        if tb_ok: status["totobrief_ok_at"] = now_iso()
        if st_ok: status["stavka_ok_at"] = now_iso()
        status["totobrief_error"] = tb_err
        status["stavka_error"] = st_err
    status.update({"totobrief_ok": tb_ok, "stavka_ok": st_ok})
    wr("status.json", status)
    log("изменено файлов: %d; totobrief=%s stavka=%s" % (changed, tb_ok, st_ok))
    return 0


if __name__ == "__main__":
    sys.exit(main())
