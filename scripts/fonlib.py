#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Единая библиотека названий команд: Фонбет показывает команды так же, как Балтбет.

Названия Фонбета переводит словарь data/api/fon/ru.json, названия Балтбета приходят готовыми русскими из totobrief
(и накоплены в data/api/history.json). Одна и та же команда в двух конторах писалась по-разному
(«Торрейнсе» / «Торреенсе», «КамАЗ» / «КАМАЗ», «Гвинея U23» / «Гвинея(23)»). Этот скрипт сверяет русские названия
Фонбета с названиями Балтбета (совпадение после нормализации или одна опечатка в длинном названии) и пишет
data/api/fon/ru_bal.json: {"t": {название по словарю Фонбета: название как у Балтбета}}. Сайт в режиме Фонбета
подставляет их поверх словаря, а лента Flashscore ищется по тем же названиям, что и у Балтбета.
Только стандартная библиотека; сбой ничего не ломает.
"""
import glob, json, os, re, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "data", "api")
FON = os.path.join(API, "fon")
OUT = os.path.join(FON, "ru_bal.json")
STOP = {"фк", "ск", "fc", "sk", "кф", "fk", "cf"}
LOOK = dict(zip("acekmhoptxyb", "асекмнортху" + "в"))   # латиница, похожая на кириллицу, в смешанных словах


def key(name):
    s = str(name or "").lower().replace("ё", "е")
    w = " (ж)" if re.search(r"\(ж\)\s*$", s) else ""
    s = re.sub(r"\s*\(ж\)\s*$", "", s)
    s = re.sub(r"\s*(?:\(\s*u?(\d{2})\s*\)|\bu\s?(\d{2}))\s*$", lambda m: " u" + (m.group(1) or m.group(2)), s)
    if re.search(r"[а-я]", s):
        s = "".join(LOOK.get(c, c) for c in s)
    s = s.replace("я", "е").replace("ю", "у").replace("й", "и")
    toks = [t for t in re.split(r"[^a-zа-я0-9]+", s) if t and t not in STOP]
    return re.sub(r"(.)\1+", r"\1", "".join(toks)) + w


def edit1(a, b):
    """Расстояние Левенштейна не больше единицы."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return a[i + 1:] == b[i + 1:]
    return a[i:] == b[i + 1:]


def balt_names():
    cnt = Counter()
    try:
        h = json.load(open(os.path.join(API, "history.json"), encoding="utf-8")).get("draws", {})
        for d in h.values():
            for e in d.get("ev", []):
                for t in e[:2]:
                    cnt[str(t).strip()] += 1
    except Exception as e:
        print("fonlib: история Балтбета не прочитана", e)
    for f in glob.glob(os.path.join(API, "drawing-info-*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
            for e in (d.get("data", d).get("events") or []):
                for t in re.split(r"\s+[—–-]\s+", e.get("name", "")):
                    cnt[t.strip()] += 3
        except Exception:
            pass
    return {n: c for n, c in cnt.items() if n and not re.search(r"\(к\)", n)}


def main():
    ru = json.load(open(os.path.join(FON, "ru.json"), encoding="utf-8")).get("t", {})
    bal = balt_names()
    byk = {}
    for n, c in bal.items():
        byk.setdefault(key(n), Counter())[n] += c
    keys = list(byk)
    res = {}
    for en, r in ru.items():
        if not r or r in bal:
            continue                                  # название уже такое же, как у Балтбета
        k = key(r)
        cand = None
        if k in byk:
            cand = byk[k].most_common(1)[0][0]
        elif len(k) >= 7:
            near = [x for x in keys if x[0] == k[0] and abs(len(x) - len(k)) <= 1 and not x.startswith(k) and not k.startswith(x) and edit1(k, x)]
            if len(near) == 1:
                cand = byk[near[0]].most_common(1)[0][0]
        if not cand:
            m = re.match(r"^(.*?)\s*\bU\s?(\d{2})(\s*\(ж\))?$", r)      # молодёжные: Балтбет всегда пишет «Греция(21)»
            if m and m.group(1):
                cand = "%s(%s)%s" % (m.group(1), m.group(2), m.group(3) or "")
        if cand and cand != r:
            res[r] = cand
    out = json.dumps({"t": res}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    old = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    if out != old:
        open(OUT, "w", encoding="utf-8").write(out)
    print("fonlib: переименований %d из %d названий Фонбета" % (len(res), len(ru)))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("fonlib: сбой:", repr(e))
