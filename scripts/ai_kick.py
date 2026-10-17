#!/usr/bin/env python3
"""Надёжный автозапуск разбора ИИ. Расписание GitHub в закрытом репозитории опаздывает на часы,
поэтому цикл keepalive раз в 5 минут вызывает этот скрипт. Он запускает задание разбора
(workflow_dispatch в dzhek15/dzhek15-ai), если одновременно:
  - сейчас 11:07 МСК или позже и до закрытия приёма больше 75 минут;
  - текущий открытый тираж ещё не разобран (data/api/ai.json);
  - разбор сейчас не идёт и не стоит в очереди (ai_status.json и API GitHub);
  - после прошлого запуска этим скриптом прошло больше 40 минут (не больше 3 попыток в день).
Нужен секрет AI_RUN_TOKEN (ключ владельца с правом Actions: Read and write на dzhek15-ai).
Нет секрета — скрипт молча ничего не делает. Повторный разбор задание само отсекает проверкой в начале."""
import json, os, sys, urllib.request, datetime as dt

TOK = os.environ.get("AI_RUN_TOKEN", "").strip()
if not TOK:
    sys.exit(0)
API = "data/api/"
WF = "https://api.github.com/repos/dzhek15/dzhek15-ai/actions/workflows/razbor.yml"
MEM = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "ai_kick.json")
now = dt.datetime.now(dt.timezone.utc); msk = now + dt.timedelta(hours=3)


def jl(p, d=None):
    try:
        return json.load(open(p, encoding="utf-8"))
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


if msk.hour * 60 + msk.minute < 11 * 60 + 7:
    sys.exit(0)
lst = jl(API + "drawings-1.json", {}); lst = lst.get("data", lst) if isinstance(lst, dict) else lst
act = [d for d in (lst or []) if d.get("status") == "active"]
if not act:
    sys.exit(0)
cur = act[0]; no = int(cur["number"])
# ended_at у totobrief — московское время с пометкой Z
end = dt.datetime.strptime(str(cur.get("ended_at", ""))[:16], "%Y-%m-%dT%H:%M").replace(tzinfo=dt.timezone.utc) - dt.timedelta(hours=3)
if (end - now).total_seconds() < 75 * 60:
    sys.exit(0)
ai = jl(API + "ai.json", {}) or {}
if str(ai.get("number")) == str(no):
    sys.exit(0)
st = jl(API + "ai_status.json", {}) or {}
try:
    if st.get("state") == "run" and (now - dt.datetime.strptime(st["start"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).total_seconds() < 70 * 60:
        sys.exit(0)
except (KeyError, ValueError):
    pass
mem = jl(MEM, {}) or {}
day = msk.strftime("%Y-%m-%d")
if mem.get("day") != day:
    mem = {"day": day, "n": 0, "last": 0}
if mem["n"] >= 3 or now.timestamp() - mem["last"] < 40 * 60:
    sys.exit(0)
try:
    runs = gh(WF + "/runs?per_page=3").get("workflow_runs", [])
    if any(r.get("status") != "completed" for r in runs):
        say("разбор уже идёт или в очереди — не запускаю"); sys.exit(0)
    gh(WF + "/dispatches", {"ref": "main", "inputs": {"publish": True}})
    mem["n"] += 1; mem["last"] = now.timestamp()
    json.dump(mem, open(MEM, "w"))
    say("тираж %d не разобран — запустил разбор (попытка %d из 3 за день)" % (no, mem["n"]))
except urllib.error.HTTPError as e:
    say("GitHub ответил %d — проверьте секрет AI_RUN_TOKEN (доступ к dzhek15-ai, Actions: Read and write)" % e.code)
    mem["n"] += 1; mem["last"] = now.timestamp(); json.dump(mem, open(MEM, "w"))
except Exception as e:
    say("сбой: %s" % e)
