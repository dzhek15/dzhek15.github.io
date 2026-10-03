#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Журнал стратегий: проверка вперёд.

Пока тираж принимает ставки, скрипт при каждом запуске (раз в полчаса) пересчитывает купоны
стратегий (те же расчёты, что в бэктесте: Фавориты, Большинство, Расхождения, max15, Симуляция,
Келли) и купон ИИ, а после дедлайна замораживает их. Когда у тираж появляются итоги (history.json),
считает результат каждого купона. Записанное до итогов нельзя подогнать задним числом.
Результат: data/api/journal.json. Только стандартная библиотека.
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.environ.get("JOURNAL_API") or os.path.join(ROOT, "data", "api")
OUT = ['1', 'X', '2']
SH = {9: 40, 10: 20, 11: 10, 12: 5, 13: 5, 14: 5, 15: 5}
FIX = {9: .945, 10: .927, 11: .892, 12: .830, 13: .70, 14: 1.2, 15: 1.05}
J14, J15, PRICE = .10, .90, 30
BUDGETS = [1, 8, 32, 128, 512]
B, SZ, SHR = 20, 5, 300


def rd(name, default):
    try:
        with open(os.path.join(API, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def pb(ps):
    d=[1.0]
    for p in ps:
        n=[0.0]*(len(d)+1)
        for j,v in enumerate(d): n[j]+=v*(1-p); n[j+1]+=v*p
        d=n
    return d
tail=lambda d,k: sum(d[k:])

# --- калибровка по прошлому (walk-forward) ---
B,SZ,SHR=20,5,300
cal=[[[0,0,0.0] for _ in range(B)] for _ in range(3)]  # hit,n,sp
bi=lambda p: max(0,min(B-1,int(p*100//SZ)))
def cal_update(evs):
    for e in evs:
        for k in range(3):
            if e['res']<0: continue
            c=cal[k][bi(e['p'][k])]; c[1]+=1; c[2]+=e['p'][k]; c[0]+= (e['res']==k)
def calprob(p):
    o=[]
    for k in range(3):
        c=cal[k][bi(p[k])]; sh=(c[0]-c[2])/(c[1]+SHR) if c[1] else 0
        o.append(max(.01,p[k]+sh))
    t=sum(o); return [x/t for x in o]

def plan_max15(evs,budget):
    rows=[]
    for e in evs:
        p=calprob(e['p']); q=e['q']
        best=max(range(3),key=lambda k:p[k]*min((p[k]/q[k]) if q else 1,2)**.35)
        rows.append({'p':p,'set':[best]})
    combos=1
    while True:
        bR=None;bK=-1;bG=0
        for r in rows:
            n=len(r['set'])
            if n>=3 or combos//n*(n+1)>budget: continue
            S=sum(r['p'][k] for k in r['set'])
            for k in range(3):
                if k in r['set']: continue
                g=math.log((S+r['p'][k])/S)/math.log((n+1)/n)
                if g>bG: bG,bR,bK=g,r,k
        if not bR: break
        combos=combos//len(bR['set'])*(len(bR['set'])+1); bR['set'].append(bK)
    return [sorted(r['set']) for r in rows]

def plan_sim(evs,budget):
    rows=[{'p':calprob(e['p'])} for e in evs]
    for r in rows: r['set']=[max(range(3),key=lambda k:r['p'][k])]
    cov=lambda r: min(1,sum(r['p'][k] for k in r['set']))
    t9=lambda: tail(pb([cov(r) for r in rows]),9)
    combos=1; cur=t9()
    while True:
        bR=None;bK=-1;bG=0;bT=cur
        for r in rows:
            n=len(r['set'])
            if n>=3 or combos//n*(n+1)>budget: continue
            for k in range(3):
                if k in r['set']: continue
                r['set'].append(k); t=t9(); r['set'].pop()
                g=math.log(t/max(cur,1e-12))/math.log((n+1)/n)
                if g>bG: bG,bR,bK,bT=g,r,k,t
        if not bR: break
        combos=combos//len(bR['set'])*(len(bR['set'])+1); bR['set'].append(bK); cur=bT
    return [sorted(r['set']) for r in rows]

def plan_gaps(evs):
    base=[max(range(3),key=lambda k:e['p'][k]) for e in evs]; sw=[]
    for i,e in enumerate(evs):
        pr,pl=e['p'],e['pl']; fav=base[i]; best=None
        for j in range(3):
            if j==fav: continue
            loss=pr[fav]-pr[j]; rel=pl[fav]-pl[j]
            if rel<=0: continue
            sc=rel/max(loss,1e-4)
            if not best or sc>best[0]: best=(sc,i,j,loss)
        if best: sw.append(best)
    line=base[:]
    for sc,i,j,loss in sorted(sw,reverse=True):
        if sc>=1 and loss<=.15: line[i]=j
        else: break
    return [[x] for x in line]

def pay_table(evs,fund,jack):
    """выплата строке с k угаданными — по фактическим итогам и долям толпы"""
    lines=(fund/.9)/PRICE; A=fund/90
    alloc={k:A*SH[k] for k in SH}; alloc[14]+=jack*J14; alloc[15]+=jack*J15
    crowd=pb([1.0 if e['res']<0 else e['pl'][e['res']] for e in evs])
    n={c:lines*tail(crowd,c)*FIX[c]+1 for c in range(9,16)}
    return [sum(alloc[c]/n[c] for c in range(9,k+1)) if k>=9 else 0 for k in range(16)]

def realize(evs,sets,pay):
    poly=[1]
    for e,s in zip(evs,sets):
        h=1 if e['res'] in s else 0; a,b=len(s)-h,h
        if e['res']<0: a,b=0,len(s)
        n=[0]*(len(poly)+1)
        for j,v in enumerate(poly): n[j]+=v*a; n[j+1]+=v*b
        poly=n
    best=max(k for k,v in enumerate(poly) if v)
    return sum(v*pay[k] for k,v in enumerate(poly)), best

def expected(evs,sets,fund,jack):
    """ожидание по модели (как на сайте, в упрощённой форме) — для Келли"""
    lines=(fund/.9)/PRICE; A=fund/90
    alloc={k:A*SH[k] for k in SH}; alloc[14]+=jack*J14; alloc[15]+=jack*J15
    crowd=pb([sum(e['p'][j]*e['pl'][j] for j in range(3)) for e in evs])
    n={c:lines*tail(crowd,c)*FIX[c]+1 for c in range(9,16)}
    pay=[sum(alloc[c]/n[c] for c in range(9,k+1)) if k>=9 else 0 for k in range(16)]
    poly=[1.0]
    for e,s in zip(evs,sets):
        a=sum(1-e['p'][j] for j in s); b=sum(e['p'][j] for j in s)
        nn=[0.0]*(len(poly)+1)
        for j,v in enumerate(poly): nn[j]+=v*a; nn[j+1]+=v*b
        poly=nn
    W=sum(v*pay[k] for k,v in enumerate(poly))
    pwin=tail(pb([min(1,sum(e['p'][j] for j in s)) for e,s in zip(evs,sets)]),9)
    return W,pwin

def plan_kelly(evs,fund,jack,bank=10000):
    best=None; least=None; seen=set()
    for Bd in BUDGETS:
        for sets in (plan_max15(evs,Bd),plan_sim(evs,Bd)):
            key=str(sets)
            if key in seen: continue
            seen.add(key)
            combos=math.prod(len(s) for s in sets); cost=combos*PRICE
            W,pw=expected(evs,sets,fund,jack); f=cost/bank
            b=(W/pw)/cost-1 if pw>0 else -1
            g=pw*math.log(1+f*b)+(1-pw)*math.log(1-f) if f<1 and pw>0 and b>-1 else -9
            c=(g,sets)
            if least is None or g>least[0]: least=c
    return (least[1] if least[0]>0 else None), least[1]



STRATS = ['Фавориты (база)', 'Большинство (база)', 'Расхождения', 'max15 ·32', 'Симуляция ·32',
          'Келли (только выгодные)', 'Келли (всегда)', 'ИИ']
cal = [[[0, 0, 0.0] for _ in range(B)] for _ in range(3)]


def mk_ev(bk, pl_raw, res):
    s = sum(bk); p = [x / s for x in bk]
    plm = [max(x, .5) for x in pl_raw]; t = sum(plm); pl = [x / t for x in plm]
    ok = min(pl_raw) >= 1 and sum(pl_raw) >= 90
    return {'p': p, 'pl': pl, 'q': pl if min(pl_raw) >= 1 else None, 'res': res}, ok


def plans_for(evs, fund, jack):
    kel_ok, kel_any = plan_kelly(evs, fund, jack)
    return {'Фавориты (база)': [[max(range(3), key=lambda k: e['p'][k])] for e in evs],
            'Большинство (база)': [[max(range(3), key=lambda k: e['pl'][k])] for e in evs],
            'Расхождения': plan_gaps(evs), 'max15 ·32': plan_max15(evs, 32), 'Симуляция ·32': plan_sim(evs, 32),
            'Келли (только выгодные)': kel_ok, 'Келли (всегда)': kel_any}


def ser(sets):
    return None if sets is None else ["".join(OUT[k] for k in s) for s in sets]


def deser(rows):
    return None if rows is None else [[OUT.index(c) for c in r] for r in rows]


def main():
    hist = rd("history.json", {"draws": {}}).get("draws", {})
    # калибровка — как в бэктесте: по всем завершённым тиражам
    for num in sorted(hist, key=int):
        evs = []
        for e in hist[num]["ev"]:
            if None in e[3:9] or e[9] not in OUT:
                evs = None; break
            ev, _ = mk_ev([float(x) for x in e[3:6]], [float(x) for x in e[6:9]], OUT.index(e[9]))
            evs.append(ev)
        if evs and len(evs) == 15:
            cal_update(evs)
    jr = rd("journal.json", {"draws": {}})
    jd = jr.setdefault("draws", {})
    aih = rd("ai_hist.json", {})
    lst = rd("drawings-1.json", [])
    lst = lst if isinstance(lst, list) else lst.get("data", [])
    now = datetime.now(timezone.utc)
    changed = False
    for d in lst[:6]:
        num = str(d.get("number")); did = d.get("id")
        ent = jd.get(num)
        info = rd("drawing-info-%s.json" % did, None)
        if not info:
            continue
        info = info.get("data", info)
        evl = sorted(info.get("events") or [], key=lambda e: e.get("order") or 0)
        if len(evl) != 15:
            continue
        try:
            ends = datetime.fromisoformat(str(info.get("ended_at") or d.get("ended_at"))[:19]).replace(tzinfo=timezone.utc)
        except Exception:
            ends = None
        # --- шаг 1: купоны, пока тираж открыт (ended_at — время МСК с буквой Z) ---
        open_now = (info.get("status") == "active") and (ends is None or now.timestamp() < ends.timestamp() - 3 * 3600)
        if open_now and not (ent and ent.get("frozen")):
            evs = []; allq = True
            for e in evl:
                q = e.get("quotes") or {}
                bk = [q.get("bk_win_1"), q.get("bk_draw"), q.get("bk_win_2")]
                pl = [q.get("pool_win_1"), q.get("pool_draw"), q.get("pool_win_2")]
                if None in bk or None in pl:
                    allq = False; break
                ev, ok = mk_ev([float(x) for x in bk], [float(x) for x in pl], -1)
                evs.append(ev)
            if allq and sum(float(x) for x in pl) >= 90:
                fund = float(info.get("pool_sum") or 0); jack = float(info.get("jackpot") or 0)
                P = plans_for(evs, fund, jack)
                ent = jd.setdefault(num, {"id": did})
                ent["plans"] = {k: ser(v) for k, v in P.items()}
                ent["updated"] = now.strftime("%Y-%m-%dT%H:%MZ")
                ent["ai"] = aih.get(num)
                ent["events"] = [e.get("name") for e in evl]
                changed = True
        elif ent and not ent.get("frozen") and ent.get("plans"):
            ent["frozen"] = ent.get("updated")        # дедлайн близко или прошёл: купоны больше не меняем
            ent["ai"] = aih.get(num) or ent.get("ai")
            changed = True
        # --- шаг 2: итоги ---
        if ent and ent.get("plans") and "score" not in ent and num in hist and ent.get("frozen"):
            h = hist[num]["ev"]
            if len(h) == 15 and all(None not in e[3:9] for e in h):
                evs = []
                for e in h:
                    ev, _ = mk_ev([float(x) for x in e[3:6]], [float(x) for x in e[6:9]],
                                  OUT.index(e[9]) if e[9] in OUT else -1)
                    evs.append(ev)
                fund = float(hist[num].get("pool_sum") or 0); jack = float(hist[num].get("jackpot") or 0)
                pay = pay_table(evs, fund, jack)
                sc = {}
                sets_all = {k: deser(v) for k, v in ent["plans"].items()}
                if ent.get("ai") and len(ent["ai"]) == 15:
                    sets_all["ИИ"] = [[OUT.index(c) for c in r] for r in ent["ai"]]
                for k, sets in sets_all.items():
                    if not sets:
                        sc[k] = None; continue
                    combos = math.prod(len(s) for s in sets)
                    w, best = realize(evs, sets, pay)
                    poly = [1]
                    for e, s in zip(evs, sets):
                        hh = 1 if (e['res'] < 0 or e['res'] in s) else 0
                        a, b = len(s) - hh, hh
                        nn = [0] * (len(poly) + 1)
                        for j, v in enumerate(poly): nn[j] += v * a; nn[j + 1] += v * b
                        poly = nn
                    sc[k] = {"combos": combos, "cost": combos * PRICE, "win": round(w), "best": best,
                             "ge9": sum(poly[9:])}
                ent["score"] = sc
                ent["scored"] = now.strftime("%Y-%m-%dT%H:%MZ")
                changed = True
    # сводка по всем оценённым тиражам
    summ = {}
    for num, ent in jd.items():
        for k, v in (ent.get("score") or {}).items():
            if not v:
                continue
            s = summ.setdefault(k, {"n": 0, "cost": 0, "win": 0, "paid": 0, "ge9": 0, "best": 0})
            s["n"] += 1; s["cost"] += v["cost"]; s["win"] += v["win"]; s["paid"] += 1 if v["win"] > 0 else 0
            s["ge9"] += 1 if v["best"] >= 9 else 0; s["best"] += v["best"]
    jr["summary"] = summ
    if changed or jr.get("summary") != rd("journal.json", {}).get("summary"):
        with open(os.path.join(API, "journal.json"), "w", encoding="utf-8") as f:
            json.dump(jr, f, ensure_ascii=False, separators=(",", ":"))
        print("journal: записано, тиражей", len(jd), "оценено", sum(1 for e in jd.values() if "score" in e))
    else:
        print("journal: без изменений")


if __name__ == "__main__":
    main()
