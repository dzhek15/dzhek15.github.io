#!/usr/bin/env python3
"""Надёжный автозапуск разбора ИИ. Расписание GitHub в закрытом репозитории опаздывает на часы,
поэтому цикл keepalive раз в 5 минут вызывает этот скрипт. Он запускает задание разбора
(workflow_dispatch в dzhek15/dzhek15-ai) для каждой конторы (Балтбет и Фонбет), если одновременно:
  - вечерний проход: накануне закрытия приёма, с 22:07 МСК (и после полуночи до 11:01, если запуск опоздал);
    контрольный проход: в день закрытия, с 11:07 МСК и при остатке не менее 75 минут;
  - нужный проход для текущего открытого тиража ещё не сделан (data/api/ai.json: номер и поле stage);
  - разбор сейчас не идёт и не стоит в очереди (ai_status.json и API GitHub);
  - после прошлого запуска этим скриптом прошло больше 40 минут (не больше 3 попыток в день).
Нужен секрет AI_RUN_TOKEN (ключ владельца с правом Actions: Read and write на dzhek15-ai).
Нет секрета — скрипт молча ничего не делает. Повторный разбор задание само отсекает проверкой в начале."""
import json, os, sys, urllib.request, datetime as dt
from ai_window import auto_plan

TOK = os.environ.get("AI_RUN_TOKEN", "").strip()
if not TOK:
    sys.exit(0)
API = "data/api/"
WF = "https://api.github.com/repos/dzhek15/dzhek15-ai/actions/workflows/razbor.yml"
MEM = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "ai_kick.json")
now = dt.datetime.now(dt.timezone.utc); msk = now + dt.timedelta(hours=3)


def jl(p, d=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return d


def gh(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, method="POST" if data is not None else "GET",
                                 headers={"Authorization": "Bearer " + TOK, "Accept": "application/vnd.github+json", "User-Agent": "dzhek15-keepalive"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
        return json.loads(b) if b else {}


def say(m):
    print("ai_kick: " + m, flush=True)


minute = msk.hour * 60 + msk.minute
if 11 * 60 + 1 <= minute < 11 * 60 + 7 or 22 * 60 + 1 <= minute < 22 * 60 + 7:
    sys.exit(0)   # первые минуты оставляем расписанию GitHub
_runs = []


def sched_running():
    """Идёт или стоит в очереди запуск по расписанию GitHub (он берёт сразу обе конторы) — тогда не вмешиваемся."""
    if not _runs:
        _runs.append([r for r in gh(WF + "/runs?per_page=5").get("workflow_runs", []) if r.get("status") != "completed"])
    return any(r.get("event") == "schedule" for r in _runs[0]), bool(_runs[0])


mem = jl(MEM, {}) or {}
day = msk.strftime("%Y-%m-%d")
if mem.get("day") != day:
    mem = {"day": day}


def save():
    with open(MEM, "w") as f:
        json.dump(mem, f)


# обе конторы: Балтбет (data/api) и Фонбет (data/api/fon); повтор внутри конторы отсекает concurrency задания и его gate
for book, d in (("baltbet", ""), ("fonbet", "fon/")):
    lst = jl(API + d + "drawings-1.json", {}); lst = lst.get("data", lst) if isinstance(lst, dict) else lst
    act = [x for x in (lst or []) if x.get("status") == "active"]
    if not act:
        continue
    cur = act[0]; no = int(cur["number"])
    ai = jl(API + d + "ai.json", {}) or {}
    why, stage = auto_plan(cur, ai, now)
    if why:
        if not why.startswith(("вечерний разбор накануне", "авторазбор только", "тираж %d уже разобран" % no, "контрольный")):
            say("%s: пропуск: %s" % (book, why))
        continue
    st = (jl(API + "ai_status.json", {}) or {}) if not d else {}
    try:
        if st.get("state") == "run" and (now - dt.datetime.strptime(st["start"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).total_seconds() < 70 * 60:
            continue
    except (KeyError, ValueError):
        pass
    bm = mem.setdefault(book, {"n": 0, "last": 0})
    if bm["n"] >= 3 or now.timestamp() - bm["last"] < 40 * 60:
        continue
    try:
        by_sched, any_run = sched_running()
        if by_sched:
            say("идёт запуск по расписанию — не вмешиваюсь"); break
        gh(WF + "/dispatches", {"ref": "main", "inputs": {
            "publish": True, "automatic": True, "draw": str(int(cur["id"])), "book": book}})
        bm["n"] += 1; bm["last"] = now.timestamp(); save()
        say("%s: тираж %d, %s проход не сделан — запустил разбор (попытка %d из 3 за день)" % (book, no, "вечерний" if stage == "evening" else "контрольный", bm["n"]))
    except urllib.error.HTTPError as e:
        say("GitHub ответил %d — проверьте секрет AI_RUN_TOKEN (доступ к dzhek15-ai, Actions: Read and write)" % e.code)
        bm["n"] += 1; bm["last"] = now.timestamp(); save()
    except Exception as e:
        say("сбой: %s" % e)
