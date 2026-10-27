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
FIX = {9: .945, 10: .927, 11: .892, 12: .830, 13: .645, 14: .70, 15: 1.05}   # 13/14 — по реальным выплатам 5025–5044
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


# --- новый Келли: рост банка по полному распределению выплат (как на сайте) ---
def edge_adj(p, L):
    """L — список поправок матча [{src, o, d}] (как на сайте: сумма ≤ 8 п.п., сдвиг берётся у остальных исходов)"""
    if not L: return p
    add = [0.0, 0.0, 0.0]
    for a in L: add[OUT.index(a['o'])] += float(a['d'])
    t = sum(add)
    if t > .08: add = [x * .08 / t for x in add]
    q = list(p)
    for k in range(3):
        if add[k] <= 0: continue
        d = min(add[k], .9 - q[k]); r = 1 - q[k]
        if d <= 0 or r <= d: continue
        q = [q[k] + d if j == k else q[j] * (r - d) / r for j in range(3)]
    return q


def kel_scen(evs, fund, jack, S=200, seed=7):
    import random
    rnd = random.Random(seed)
    lines = (fund / .9) / PRICE; A = fund / 90
    alloc = {k: A * SH[k] for k in SH}; alloc[14] += jack * J14; alloc[15] += jack * J15
    P = [calprob(e['p']) for e in evs]; out = []
    for _ in range(S):
        res = []
        for p in P:
            u = rnd.random(); res.append(0 if u < p[0] else (1 if u < p[0] + p[1] else 2))
        crowd = pb([e['pl'][r] for e, r in zip(evs, res)])
        n = {c: lines * tail(crowd, c) * FIX[c] + 1 for c in range(9, 16)}
        out.append((res, [sum(alloc[c] / n[c] for c in range(9, k + 1)) if k >= 9 else 0 for k in range(16)]))
    return out


def kel_g(sets, sc, cost, bank):
    g = 0.0
    for res, pay in sc:
        poly = [1]
        for r, s in zip(res, sets):
            h = 1 if r in s else 0; a = len(s) - h
            nn = [0] * (len(poly) + 1)
            for j, v in enumerate(poly): nn[j] += v * a; nn[j + 1] += v * h
            poly = nn
        w = sum(v * pay[k] for k, v in enumerate(poly) if k >= 9)
        g += math.log(max(1e-9, 1 - cost / bank + w / bank))
    return g / len(sc)


def reach_t(sets, T):
    """можно ли от купона дойти ровно до T строк, добавляя исходы (двойник ×2, тройник из двойника ×1,5)"""
    def pw(n, b):
        c = 0
        while n > 1 and n % b == 0: n //= b; c += 1
        return c
    c = math.prod(len(x) for x in sets); y = pw(T, 3) - pw(c, 3); x = pw(T, 2) - pw(c, 2) + y
    if c > T or y < 0 or x < 0: return False
    return x <= sum(len(z) == 1 for z in sets) and y <= sum(len(z) == 2 for z in sets) + x


def plan_kelly_new(evs, fund, jack, bank=10000, edges=None, maxc=None):
    """edges: {номер матча: {'o','f'}} — перекосы ИИ; без них это «Келли (новый)»"""
    ev2 = [dict(e, p=edge_adj(e['p'], (edges or {}).get(i))) for i, e in enumerate(evs)]
    sc = kel_scen(ev2, fund, jack); best = None; seen = set()
    for Bd in BUDGETS:
        for sets in (plan_max15(ev2, Bd), plan_sim(ev2, Bd)):
            key = str(sets)
            if key in seen: continue
            seen.add(key)
            cost = math.prod(len(x) for x in sets) * PRICE
            if cost >= bank or (maxc and not reach_t(sets, maxc)): continue
            g = kel_g(sets, sc, cost, bank)
            if best is None or g > best[0]: best = (g, sets)
    # своя сборка Монстра: от фаворитов по одному исходу, каждый шаг — наибольший рост банка; каждый шаг — кандидат
    sets = [[max(range(3), key=lambda k: calprob(e['p'])[k])] for e in ev2]; combos = 1
    for _ in range(40):
        st = None
        for i in range(15):
            n = len(sets[i]); nc = combos // n * (n + 1)
            if n >= 3 or nc > (maxc or max(BUDGETS)) or nc * PRICE >= bank: continue
            for k in range(3):
                if k in sets[i]: continue
                t = [list(x) for x in sets]; t[i] = sorted(t[i] + [k])
                g = kel_g(t, sc, nc * PRICE, bank)
                if st is None or g > st[0]: st = (g, i, k)
        if st is None: break
        g, i, k = st; combos = combos // len(sets[i]) * (len(sets[i]) + 1); sets[i] = sorted(sets[i] + [k])
        if (best is None or g > best[0]) and (not maxc or reach_t(sets, maxc)): best = (g, [list(x) for x in sets])
    return best[1]


def hit_dist(evs, sets):
    poly = [1]
    for e, s in zip(evs, sets):
        h = 1 if (e['res'] < 0 or e['res'] in s) else 0; a = len(s) - h
        nn = [0] * (len(poly) + 1)
        for j, v in enumerate(poly): nn[j] += v * a; nn[j + 1] += v * h
        poly = nn
    return poly


def ai_edges(num):
    """поправки «Келли · улучшения» из разбора ИИ: {номер матча: [{src, o, d, why}]}"""
    a = rd("ai.json", {})
    if str(a.get("number")) != str(num): return None
    out = {}
    for i, m in enumerate(a.get("m") or []):
        m = m or {}
        L = m.get("adj")
        if not L and m.get("edge") and m["edge"].get("o") in OUT:
            e = m["edge"]; L = [{"src": "ИИ", "o": e["o"], "d": .06 if str(e.get("f")) == "2" else .03, "why": e.get("why", "")}]
        L = [x for x in (L or []) if x.get("o") in OUT and float(x.get("d") or 0) > 0]
        S = LEARN.get("src") or {}
        L = [dict(x, d=float(x["d"]) * (S.get("Усталость" if x.get("src") == "Усталость" else "ИИ: факты") or {}).get("d_mult", 1.0)) for x in L]
        mf = ((S.get("ИИ: факты") or {}).get("models") or {}).get(m.get("model")) or {}
        if not mf.get("on", True): L = [x for x in L if x.get("src") == "Усталость"]   # модель ИИ выключена — её факты не сдвигают
        L = [x for x in L if x["d"] > 0]
        if L: out[i] = L
    return out


STRATS = ['Фавориты (база)', 'Большинство (база)', 'Расхождения', 'max15 ·32', 'Симуляция ·32',
          'Келли (только выгодные)', 'Келли (всегда)', 'Монстр Келли', 'Монстр Келли · улучшения', 'Монстр Келли · добор по росту', 'ИИ']
cal = [[[0, 0, 0.0] for _ in range(B)] for _ in range(3)]


def mk_ev(bk, pl_raw, res):
    s = sum(bk); p = [x / s for x in bk]
    plm = [max(x, .5) for x in pl_raw]; t = sum(plm); pl = [x / t for x in plm]
    ok = min(pl_raw) >= 1 and sum(pl_raw) >= 90
    return {'p': p, 'pl': pl, 'q': pl if min(pl_raw) >= 1 else None, 'res': res}, ok


LEARN = {}


def ai_src(num):
    """источники добора Монстра по матчам: [(исход, порядок доверия, источник)] — как на сайте; порядок и выключение — из обучения"""
    a = rd("ai.json", {})
    if str(a.get("number")) != str(num): return None
    if LEARN.get("mode") == "growth": return None
    S = LEARN.get("src") or {}
    def rk(name, t0, md=None):
        v = S.get(name)
        if v and not v.get("on", True): return None
        if v and md and not ((v.get("models") or {}).get(md) or {}).get("on", True): return None
        return v.get("rank", t0) if v else t0
    out = []
    for m in a.get("m") or []:
        m = m or {}; L = []; md = m.get("model")
        for x in (m.get("adj") or []):
            nm = "Усталость" if x.get("src") == "Усталость" else "ИИ: факты"; t = rk(nm, 2 if nm == "Усталость" else 1, md if nm != "Усталость" else None)
            if x.get("o") in OUT and t: L.append((OUT.index(x["o"]), t, nm))
        t = rk("Разбор ИИ", 3, md)
        for o in str(m.get("p") or ""):
            if o in OUT and t: L.append((OUT.index(o), t, "Разбор ИИ"))
        tp = m.get("trap") or {}; t = rk("ИИ-критик", 4, md)
        if tp.get("o") in OUT and t: L.append((OUT.index(tp["o"]), t, "ИИ-критик"))
        t = rk("Betzona: факты", 5, md)
        for o in set(x.get("s") for x in (m.get("bza") or [])):
            if o in OUT and t: L.append((OUT.index(o), t, "Betzona: факты"))
        t = rk("Betzona: события", 7, md)
        for o in set(x.get("s") for x in (m.get("bze") or []) if (x.get("w") or 0) >= 2):
            if o in OUT and t: L.append((OUT.index(o), t, "Betzona: события"))
        bw = m.get("bzw") or {}
        if bw and max(bw.values()) >= 1:
            mxw = max(bw.values()); t = rk("Betzona: голоса", 6)
            for o in OUT:
                if bw.get(o, 0) >= mxw and t: L.append((OUT.index(o), t, "Betzona: голоса"))
        bz = {} if bw else (m.get("bz") or {})
        if bz.get("n"):
            v = bz.get("v") or {}; mx = max(v.get(o, 0) for o in OUT)
            for o in OUT:
                t = rk("Betzona: голоса", 6)
                if mx > 0 and v.get(o, 0) >= mx and t: L.append((OUT.index(o), t, "Betzona: голоса"))
        out.append(L)
    return out


def ai_src_all(num):
    global LEARN
    keep = LEARN; LEARN = {}
    try: return ai_src(num)
    finally: LEARN = keep


def monster_fill(core, T, sc, src):
    """остаток бюджета до T строк — исходами по порядку доверия источников, внутри — по росту банка; путь всегда ведёт ровно к T"""
    sets = [list(x) for x in core]; combos = math.prod(len(x) for x in sets); added = []
    def pw(n, b):
        c = 0
        while n > 1 and n % b == 0: n //= b; c += 1
        return c
    A, B = pw(T, 2), pw(T, 3)
    def reach(c, ss):
        y = B - pw(c, 3); x = A - pw(c, 2) + y
        if y < 0 or x < 0: return False
        return x <= sum(len(z) == 1 for z in ss) and y <= sum(len(z) == 2 for z in ss) + x
    for _ in range(40):
        if combos >= T: break
        best = None
        for i in range(15):
            n = len(sets[i]); nc = combos // n * (n + 1)
            if n >= 3 or nc > T: continue
            for k in range(3):
                if k in sets[i]: continue
                t = [list(x) for x in sets]; t[i] = sorted(t[i] + [k])
                if not reach(nc, t): continue
                tiers = [z for z in ((src or [[]] * 15)[i] if src else []) if z[0] == k]
                tier, nm = (min(tiers, key=lambda z: z[1])[1:] if tiers else (9, "Рост банка"))
                g = kel_g(t, sc, nc * PRICE, 30000)
                if best is None or (tier, -g) < (best[0], -best[1]): best = (tier, g, i, k, nm, nc)
        if best is None: break
        _, _, i, k, nm, nc = best; sets[i] = sorted(sets[i] + [k]); combos = nc; added.append({"i": i, "o": OUT[k], "src": nm})
    return sets, added


def plans_for(evs, fund, jack, edges=None, src=None, fill_log=None):
    kel_ok, kel_any = plan_kelly(evs, fund, jack)
    T = math.prod(len(x) for x in kel_any)          # бюджет Монстра = бюджет Келли
    kn0 = plan_kelly_new(evs, fund, jack, bank=30000, maxc=T)   # ядро: наибольший рост банка 30 000, как на сайте
    sc = kel_scen(evs, fund, jack)
    kn, add_n = monster_fill(kn0, T, sc, src)
    if edges:
        ev2 = [dict(e, p=edge_adj(e['p'], edges.get(i))) for i, e in enumerate(evs)]
        ka, add_a = monster_fill(plan_kelly_new(evs, fund, jack, bank=30000, edges=edges, maxc=T), T, kel_scen(ev2, fund, jack), src)
    else:
        ka, add_a = kn, add_n
    kg, _ = monster_fill(kn0, T, sc, None)
    if fill_log is not None: fill_log.extend(add_n)
    return {'Фавориты (база)': [[max(range(3), key=lambda k: e['p'][k])] for e in evs],
            'Большинство (база)': [[max(range(3), key=lambda k: e['pl'][k])] for e in evs],
            'Расхождения': plan_gaps(evs), 'max15 ·32': plan_max15(evs, 32), 'Симуляция ·32': plan_sim(evs, 32),
            'Келли (только выгодные)': kel_ok, 'Келли (всегда)': kel_any,
            'Монстр Келли': kn, 'Монстр Келли · улучшения': ka, 'Монстр Келли · добор по росту': kg}


def ser(sets):
    return None if sets is None else ["".join(OUT[k] for k in s) for s in sets]


def deser(rows):
    return None if rows is None else [[OUT.index(c) for c in r] for r in rows]



# ---------- самообучение Монстра Келли ----------
FIX_BASE = dict(FIX)                     # стартовые поправки выплат (из кода), от них идёт обучение
SRC_PRIOR = {"ИИ: факты": .03, "Усталость": .02, "Разбор ИИ": 0.0, "ИИ-критик": 0.0, "Betzona: факты": 0.0, "Betzona: голоса": 0.0, "Betzona: события": 0.0}   # стартовая вера в перевес, доля
SRC_K, SRC_MIN, FIX_K, FIX_WIN = 300, 30, 8, 30


def learn_fix(hist, pays):
    """поправки выплат 9–14 по реальным выплатам последних FIX_WIN тиражей: модель/факт выплаты на строку по категории,
    сжатие к стартовым (FIX_K тиражей веса у старта), 15 не трогаем — она измерена по сбросам суперприза"""
    errs = {k: [] for k in range(9, 15)}; used = []
    for num in sorted([n for n in pays if n in hist], key=int)[-FIX_WIN:]:
        h = hist[num]; P = pays[num]
        if not P.get("k") or any(e[9] is None or e[9] == "" for e in h["ev"]) or any(None in e[6:9] for e in h["ev"]): continue
        evs = [mk_ev([float(x) for x in e[3:6]], [float(x) for x in e[6:9]], OUT.index(e[9]) if e[9] in OUT else -1)[0] for e in h["ev"]]
        fund = float(h.get("pool_sum") or 0); jack = float(h.get("jackpot") or 0)
        if not fund: continue
        lines = (fund / .9) / PRICE; A = fund / 90
        alloc = {k: A * SH[k] for k in SH}; alloc[14] += jack * J14; alloc[15] += jack * J15
        crowd = pb([1.0 if e['res'] < 0 else e['pl'][e['res']] for e in evs])
        for k in range(9, 15):
            real = float(P["k"].get(str(k)) or 0) * PRICE
            if real > 0:
                errs[k].append(math.log((alloc[k] / (lines * tail(crowd, k) * FIX_BASE[k] + 1)) / real))
        used.append(num)
    fix = dict(FIX_BASE); info = {}
    for k in range(9, 15):
        n = len(errs[k])
        if n >= 5:
            m = sum(errs[k]) / n; w = n / (n + FIX_K)
            fix[k] = round(min(FIX_BASE[k] * 2, max(FIX_BASE[k] / 2, FIX_BASE[k] * math.exp(m * w))), 3)
        info[k] = {"n": n, "ratio": round(math.exp(sum(errs[k]) / n), 3) if n else None}
    return fix, info, used


ADW_DELTA, ADW_MIN, ADW_STEP = 0.05, 30, 5     # уверенность детектора, минимум с каждой стороны разреза, шаг проверки


def adwin(xs):
    """ADWIN (Bifet, Gavaldà 2007): окно растёт, пока его старая и новая части не начнут различаться по среднему
    сильнее, чем допускает случай; тогда старая часть отбрасывается. xs — поток (сыграло − вероятность линии)
    в порядке тиражей. Возвращает начало окна и список разрезов [(позиция, среднее до, среднее после)]"""
    st = 0; cuts = []
    pre = [0.0]; pre2 = [0.0]
    for v in xs: pre.append(pre[-1] + v); pre2.append(pre2[-1] + v * v)
    for t in range(1, len(xs) + 1):
        if (t - st) < 2 * ADW_MIN or t % ADW_STEP: continue
        while True:
            n = t - st; cut = None
            mu = (pre[t] - pre[st]) / n; var = max(1e-6, (pre2[t] - pre2[st]) / n - mu * mu)
            dl = math.log(2 * math.log(max(3, n)) / ADW_DELTA)
            for c in range(st + ADW_MIN, t - ADW_MIN + 1, ADW_STEP):
                n0, n1 = c - st, t - c
                m0 = (pre[c] - pre[st]) / n0; m1 = (pre[t] - pre[c]) / n1
                m = 1.0 / (1.0 / n0 + 1.0 / n1)
                eps = math.sqrt(2.0 / m * var * dl) + 2.0 / (3.0 * m) * dl
                if abs(m0 - m1) > eps: cut = (c, m0, m1); break
            if not cut: break
            cuts.append((cut[0], round(cut[1], 4), round(cut[2], 4))); st = cut[0]
            if t - st < 2 * ADW_MIN: break
    return st, cuts


def src_stat(L, m0, K):
    """статистика источника по окну детектора: при найденном переломе стартовая вера сбрасывается к нулю и вес старта
    вдвое меньше — чтобы после смены качества купон реагировал быстрее"""
    L = sorted(L, key=lambda x: (int(x["_n"]), x["i"]))
    st, cuts = adwin([x["hit"] - x["p"] for x in L])
    W = L[st:]; n = len(W)
    if cuts: m0, K = 0.0, K // 2
    hit = sum(x["hit"] for x in W); exp = sum(x["p"] for x in W)
    lift = (hit - exp) / n if n else 0.0
    post = (K * m0 + n * lift) / (K + n)
    r = {"n": n, "n_all": len(L), "hit": hit, "exp": round(exp, 2), "lift": round(lift, 4), "post": round(post, 4), "prior": m0,
         "on": not (n >= SRC_MIN and post < -0.01), "learned": n >= SRC_MIN}
    if cuts:
        c = cuts[-1]; r["cut"] = {"from": L[c[0]]["_n"], "drop": c[0], "was": c[1], "now": c[2], "k": len(cuts)}
    return r


def mdn(md):
    """короткое имя модели ИИ: nvidia/nemotron-3-ultra-550b-a55b"""
    return str(md or "").replace(":free", "").split(":")[-1].split("/")[-1]


LLM_SRC = ("ИИ: факты", "Разбор ИИ", "ИИ-критик", "Betzona: факты", "Betzona: события")   # подсказки этих источников пишет модель ИИ


def learn_src(jd):
    """доверие к источникам добора: сколько подсказанных исходов сыграло против ожидания линии; апостериорный перевес
    по окну детектора смены качества. Для источников от ИИ — то же отдельно по каждой модели ИИ"""
    seen = {}
    for num, ent in jd.items():
        F = ent.get("feat") or []
        for x in (ent.get("fill") or []) + (ent.get("sugg") or []) + [dict(e, src="ИИ: факты" if e.get("src", "ИИ") == "ИИ" else e.get("src")) for e in (ent.get("edges") or [])]:
            if "hit" not in x or x.get("src") not in SRC_PRIOR: continue
            i = int(x["i"]); md = (F[i] or {}).get("md") if i < len(F) else None
            seen[(num, i, x["o"], x["src"])] = dict(x, _n=num, md=md)
    out = {}
    for s, m0 in SRC_PRIOR.items():
        L = [x for k, x in seen.items() if k[3] == s]
        out[s] = src_stat(L, m0, SRC_K)
        if s in LLM_SRC:
            M = {}
            for x in L:
                if x.get("md"): M.setdefault(x["md"], []).append(x)
            out[s]["models"] = {md: {k: v for k, v in src_stat(Lm, out[s]["post"], 100).items() if k in ("n", "hit", "exp", "post", "on", "learned", "cut")}
                                for md, Lm in M.items()}
    act = sorted([s for s in out if out[s]["on"]], key=lambda s: (-out[s]["post"], list(SRC_PRIOR).index(s)))
    # пока обучение не набрано, порядок стартовый; обученные источники ставятся по перевесу
    if not any(out[s]["learned"] for s in out): act = [s for s in SRC_PRIOR if out[s]["on"]]
    for i, s in enumerate(act): out[s]["rank"] = i + 1
    for s in out:
        if s in ("ИИ: факты", "Усталость") and out[s]["learned"]:
            out[s]["d_mult"] = round(max(0.0, min(2.0, out[s]["post"] / SRC_PRIOR[s])), 3)
    return out


def learn_mode(jd, pays, hist):
    """сравнение двух способов добора по реальным выплатам: от источников и только по росту банка"""
    a, b, n = 0.0, 0.0, 0; wa = wb = cost = 0
    for num, ent in jd.items():
        sc = ent.get("score") or {}; P = pays.get(num)
        x, y = sc.get("Монстр Келли"), sc.get("Монстр Келли · добор по росту")
        if not x or not y or not P or not P.get("k"): continue
        h = hist.get(num)
        if not h: continue
        evs = [mk_ev([float(q) for q in e[3:6]], [float(q) for q in e[6:9]], OUT.index(e[9]) if e[9] in OUT else -1)[0] for e in h["ev"]]
        cum = [0.0] * 16; c = 0.0
        for k in range(9, 16): c += float(P["k"].get(str(k)) or 0); cum[k] = c * PRICE
        r = []
        for key in ("Монстр Келли", "Монстр Келли · добор по росту"):
            sets = deser(ent["plans"].get(key))
            if not sets: break
            d = hit_dist(evs, sets); w = sum(v * cum[j] for j, v in enumerate(d) if 9 <= j <= 15); cs = math.prod(len(z) for z in sets) * PRICE
            r.append((w, cs))
        if len(r) < 2: continue
        n += 1; wa += r[0][0]; wb += r[1][0]; cost += r[0][1]
        a += math.log(max(1e-9, 1 + (r[0][0] - r[0][1]) / 30000)); b += math.log(max(1e-9, 1 + (r[1][0] - r[1][1]) / 30000))
    mode = "growth" if n >= 20 and b > a and wb > wa else "src"
    return mode, {"n": n, "src_log": round(a, 3), "gr_log": round(b, 3), "src_win": round(wa), "gr_win": round(wb), "cost": round(cost)}


# ---------- «мозг Монстра»: своя обучаемая модель поверх линии ----------
# логиты исхода = log(вероятность линии) + Σ w·признак; признаки — то, чего нет в линии. Сильная L2-регуляризация
# тянет веса к нулю: пока сигнал не доказан, модель почти повторяет линию. Проверка — последовательная:
# каждый тираж предсказывается моделью, обученной только на более ранних.
BRAIN_F = ["ai_pick", "ai_top", "edge", "fat", "trap", "bz_facts", "bz_votes", "crowd_gap", "even_x", "bz_conv", "emo"]
BRAIN_L2, BRAIN_MIN, BRAIN_IT, BRAIN_STEP = 20.0, 300, 150, 10


def brain_x(f, k, p, q):
    """признаки исхода k матча; f — сохранённые до матча данные разбора"""
    o = OUT[k]; ap = str(f.get("ap") or "")
    adj = f.get("adj") or []
    return [1.0 / len(ap) if o in ap and ap else 0.0,
            1.0 if (f.get("rk") or [None])[0] == o else 0.0,
            (2.0 if f.get("ef") == 2 else 1.0) if f.get("eo") == o else 0.0,
            sum(float(a.get("d") or 0) for a in adj if a.get("src") == "Усталость" and a.get("o") == o) * 50,
            1.0 if f.get("tr") == o else 0.0,
            min(2, sum(1 for x in (f.get("bza") or []) if x.get("s") == o)) / 2.0,
            (float((f.get("bz") or {}).get("v", {}).get(o, 0)) / max(1, (f.get("bz") or {}).get("n") or 1)) if (f.get("bz") or {}).get("n") else 0.0,
            (q[k] - p[k]) * 10,
            (float(f.get("ev") or 0) / 10.0) if o == "X" else 0.0,
            (float((f.get("bzw") or {}).get(o, 0)) / sum((f.get("bzw") or {}).values())) if f.get("bzw") and sum(f["bzw"].values()) > 0 else 0.0,
            emo_x(f.get("emo"), o)]


def emo_x(e, o):
    """разница тона тренеров и игроков (уверенность − тревога − раздражение) хозяев и гостей, со знаком исхода"""
    if not e or o == "X": return 0.0
    tn = lambda z: (z["pos"] - z["anx"] - z["irr"]) if z else 0.0
    d = tn(e.get("h")) - tn(e.get("a"))
    return d if o == "1" else -d


def brain_feat(m):
    """что сохранить из разбора ИИ по матчу до начала: только то, что известно до матча"""
    if not m: return None
    e = m.get("edge") or {}
    return {"ap": m.get("p"), "rk": m.get("rank"), "ev": m.get("even"), "eo": e.get("o"), "ef": e.get("f"),
            "adj": [{"o": a.get("o"), "d": a.get("d"), "src": a.get("src")} for a in (m.get("adj") or [])],
            "tr": (m.get("trap") or {}).get("o"), "bza": [{"s": x.get("s"), "t": x.get("t")} for x in (m.get("bza") or [])],
            "bze": [{"s": x.get("s"), "t": x.get("t"), "w": x.get("w")} for x in (m.get("bze") or [])],
            "bz": m.get("bz"), "bzw": m.get("bzw"), "emo": m.get("emo"), "md": m.get("model")}


def brain_prob(w, f, p, q):
    lg = [math.log(max(1e-6, p[k])) + sum(wi * xi for wi, xi in zip(w, brain_x(f, k, p, q))) for k in range(3)]
    mx = max(lg); e = [math.exp(v - mx) for v in lg]; s = sum(e)
    return [v / s for v in e]


def brain_fit(S, w0=None):
    """S — [(f, p, q, res)]; градиентный спуск с L2"""
    w = list(w0 or [0.0] * len(BRAIN_F)); n = max(1, len(S)); lr = 0.5
    X = [[brain_x(f, k, p, q) for k in range(3)] for f, p, q, r in S]
    for _ in range(BRAIN_IT):
        g = [BRAIN_L2 * wi / n for wi in w]
        for (f, p, q, r), xs in zip(S, X):
            lg = [math.log(max(1e-6, p[k])) + sum(wi * xi for wi, xi in zip(w, xs[k])) for k in range(3)]
            mx = max(lg); e = [math.exp(v - mx) for v in lg]; s = sum(e); pr = [v / s for v in e]
            for k in range(3):
                d = (pr[k] - (1.0 if k == r else 0.0)) / n
                for j in range(len(w)): g[j] += d * xs[k][j]
        w = [wi - lr * gi for wi, gi in zip(w, g)]
    return w


def learn_brain(jd, hist, old=None):
    rows = []                                         # (номер тиража, f, p, q, итог)
    for num in sorted(jd, key=int):
        ent = jd[num]; F = ent.get("feat"); h = hist.get(num)
        if not F or not h or len(F) != 15: continue
        for i, e in enumerate(h["ev"]):
            if not F[i] or e[9] not in OUT or None in e[3:9]: continue
            ev, _ = mk_ev([float(x) for x in e[3:6]], [float(x) for x in e[6:9]], OUT.index(e[9]))
            rows.append((int(num), F[i], calprob(ev['p']), ev['pl'], ev['res']))
    if old and old.get("n") == len(rows) and old.get("feat") == BRAIN_F: return old     # новых итогов нет — не пересчитываем
    draws = sorted(set(r[0] for r in rows)); w = None; dl = {}; ll_l = ll_b = 0.0; npred = 0
    for t, d in enumerate(draws):
        if t >= 5 and (t - 5) % BRAIN_STEP == 0:     # переобучение каждые BRAIN_STEP тиражей, только на прошлом
            w = brain_fit([r[1:] for r in rows if r[0] < d], w)
        if w is None: continue
        for r in [r for r in rows if r[0] == d]:
            pb_ = brain_prob(w, r[1], r[2], r[3]); a = -math.log(max(1e-9, r[2][r[4]])); b = -math.log(max(1e-9, pb_[r[4]]))
            ll_l += a; ll_b += b; npred += 1; dl.setdefault(d, []).append(b - a)
    wf = brain_fit([r[1:] for r in rows], w) if rows else [0.0] * len(BRAIN_F)
    ci = None
    if dl:
        import random
        rnd = random.Random(5); ks = list(dl); bs = []
        for _ in range(500):
            smp = [dl[rnd.choice(ks)] for _ in ks]; tot = sum(sum(x) for x in smp); cnt = sum(len(x) for x in smp)
            bs.append(tot / cnt)
        bs.sort(); ci = [round(bs[12], 5), round(bs[487], 5)]
    on = npred >= BRAIN_MIN and ci is not None and ci[1] < 0
    return {"feat": BRAIN_F, "w": [round(x, 4) for x in wf], "n": len(rows), "np": npred,
            "ll_line": round(ll_l / npred, 5) if npred else None, "ll_brain": round(ll_b / npred, 5) if npred else None,
            "ci": ci, "on": on, "min": BRAIN_MIN}


CSV_DIR = os.path.join(ROOT, "data", "csv")
CSV_SRC = (("mine", "Мои CSV"), ("sigal", "CSV Сигал"))


def csv_shares(st):
    """доля строк набора, где в матче стоит каждый исход (набор — пары из sys: «1,X,12,…» или строка из 15 исходов)"""
    tot, cnt = 0.0, [dict.fromkeys(OUT, 0.0) for _ in range(15)]
    for e in st.get("sys") or []:
        parts = e.split(",") if "," in e else list(e)
        if len(parts) != 15: continue
        w = 1
        for x in parts: w *= len(x)
        tot += w
        for j, x in enumerate(parts):
            for c in x:
                if c in cnt[j]: cnt[j][c] += w / len(x)
    return [{c: (v / tot if tot else 0.0) for c, v in m.items()} for m in cnt]


def csv_load(bk="baltbet"):
    """архив CSV владельца: data/csv/<контора>/<тираж>.json -> {тираж: [наборы]}"""
    out = {}
    d = os.path.join(CSV_DIR, bk)
    if not os.path.isdir(d): return out
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".json"): continue
        try:
            with open(os.path.join(d, fn), encoding="utf-8") as f: j = json.load(f)
        except Exception:
            continue
        out[str(j.get("n"))] = j.get("sets") or []
    return out


def learn_csv(hist, minlines=100):
    """CSV владельца как источник подсказок для Монстра (пока в тени, купон не меняет): исход считается «подсказкой»,
    если стоит минимум в 60% строк больших наборов тиража. Статистика та же, что у остальных источников: сыграло против ожидания линии"""
    arch = csv_load()
    out = {"draws": len(arch), "sets": sum(len(v) for v in arch.values()), "shadow": True, "src": {}}
    for key, name in CSV_SRC:
        seen = []
        for num, sets in arch.items():
            h = hist.get(num)
            if not h or len(h.get("ev") or []) != 15: continue
            use = [st for st in sets if st.get("src") == key and int(st.get("lines") or 0) >= minlines]
            if not use: continue
            sh = [csv_shares(st) for st in use]
            for i, e in enumerate(h["ev"]):
                if None in e[6:9] or e[9] not in OUT: continue
                z = sum(float(x) for x in e[6:9]) or 1.0
                for k, o in enumerate(OUT):
                    share = sum(m[i][o] for m in sh) / len(sh)
                    if share >= .6: seen.append({"_n": num, "i": i, "o": o, "hit": int(e[9] == o), "p": float(e[6 + k]) / z})
        r = src_stat(seen, 0.0, SRC_K) if seen else {"n": 0, "n_all": 0, "hit": 0, "exp": 0, "lift": 0, "post": 0, "prior": 0.0, "on": True, "learned": False}
        r["draws"] = len({x["_n"] for x in seen})
        out["src"][name] = r
    return out


def learn_all(hist, jd, now):
    pays = rd("payouts.json", {})
    old = rd("learn.json", {})
    fix, finfo, used = learn_fix(hist, pays)
    src = learn_src(jd)
    mode, cmp_ = learn_mode(jd, pays, hist)
    brain = learn_brain(jd, hist, old.get("brain"))
    log = list(old.get("log") or []); at = now.strftime("%Y-%m-%d %H:%M")
    of = {int(k): v for k, v in (old.get("fix") or {}).items()}
    ch = ["%d: %s→%s" % (k, str(of.get(k, FIX_BASE[k])).replace(".", ","), str(fix[k]).replace(".", ",")) for k in range(9, 15) if abs(fix[k] - of.get(k, FIX_BASE[k])) >= .01]
    if ch: log.append({"at": at, "what": "поправки выплат " + ", ".join(ch), "why": "реальные выплаты %d тиражей (до №%s)" % (len(used), used[-1] if used else "—")})
    for s, v in src.items():
        o = (old.get("src") or {}).get(s) or {}
        if v.get("learned") and not o.get("learned"): log.append({"at": at, "what": "источник «%s» начал влиять на купон" % s, "why": "набрано %d добранных исходов" % v["n"]})
        if o and o.get("on", True) and not v["on"]: log.append({"at": at, "what": "источник «%s» выключен" % s, "why": "сыграло %d при ожидании линии %s из %d" % (v["hit"], str(v["exp"]).replace(".", ","), v["n"])})
        if o and not o.get("on", True) and v["on"]: log.append({"at": at, "what": "источник «%s» снова включён" % s, "why": "перевес вернулся выше порога"})
        c, oc = v.get("cut"), o.get("cut")
        if c and (not oc or oc.get("from") != c["from"] or oc.get("k") != c["k"]):
            log.append({"at": at, "what": "«%s»: сменилось качество, статистика до №%s забыта" % (s, c["from"]), "why": "было %+.1f п.п., стало %+.1f п.п." % (c["was"] * 100, c["now"] * 100)})
        for md, mv in (v.get("models") or {}).items():
            om = (o.get("models") or {}).get(md) or {}
            if om.get("on", True) and not mv["on"]: log.append({"at": at, "what": "«%s»: подсказки модели %s выключены" % (s, mdn(md)), "why": "сыграло %d при ожидании линии %s из %d" % (mv["hit"], str(mv["exp"]).replace(".", ","), mv["n"])})
            if om and not om.get("on", True) and mv["on"]: log.append({"at": at, "what": "«%s»: модель %s снова в работе" % (s, mdn(md)), "why": "перевес вернулся выше порога"})
        if o.get("rank") and v.get("rank") and o["rank"] != v["rank"]: log.append({"at": at, "what": "«%s»: место в доборе %d→%d" % (s, o["rank"], v["rank"]), "why": "перевес %+.1f п.п." % (v["post"] * 100)})
    ob = old.get("brain") or {}
    if brain["on"] and not ob.get("on"): log.append({"at": at, "what": "мозг Монстра включён — купон считается по его вероятностям", "why": "на %d новых матчах точнее линии" % brain["np"]})
    if ob.get("on") and not brain["on"]: log.append({"at": at, "what": "мозг Монстра снова в тени", "why": "перестал быть точнее линии"})
    if old.get("mode", "src") != mode: log.append({"at": at, "what": "добор: " + ("только по росту банка" if mode == "growth" else "от источников"), "why": "реальные выплаты %d тиражей" % cmp_["n"]})
    L = {"at": now.isoformat(), "fix": {str(k): v for k, v in fix.items()}, "fix_base": {str(k): v for k, v in FIX_BASE.items()},
         "fix_info": {str(k): v for k, v in finfo.items()}, "fix_n": len(used), "src": src, "csv": learn_csv(hist), "mode": mode, "cmp": cmp_, "brain": brain, "log": log[-40:],
         "rules": {"src_min": SRC_MIN, "src_k": SRC_K, "fix_k": FIX_K, "fix_win": FIX_WIN, "mode_min": 20}}
    with open(os.path.join(API, "learn.json"), "w", encoding="utf-8") as f:
        json.dump(L, f, ensure_ascii=False, separators=(",", ":"))
    return L


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
    # самообучение: поправки выплат, доверие к источникам, способ добора — до расчёта купонов
    global FIX, LEARN
    LEARN = learn_all(hist, jd, datetime.now(timezone.utc))
    FIX = {int(k): v for k, v in LEARN["fix"].items()}
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
                ed = ai_edges(num) or {int(k): v for k, v in ((ent or {}).get("edges_raw") or {}).items()}
                fl = []
                P = plans_for(evs, fund, jack, ed, ai_src(num), fl)
                ent = jd.setdefault(num, {"id": did})
                ent["edges_raw"] = ed or None
                _ai = rd("ai.json", {})
                if str(_ai.get("number")) == str(num) and len(_ai.get("m") or []) == 15:
                    ent["feat"] = [brain_feat(m) for m in _ai["m"]]
                # добор Монстра: какие исходы и откуда добавлены сверх ядра (журнал проверяет каждый источник)
                # все подсказки источников по матчам (не только попавшие в купон) — для обучения доверию
                _src = ai_src_all(num)
                ent["sugg"] = [{"i": i, "o": OUT[k], "src": nm, "p": round(evs[i]['p'][k], 4), "q": round(evs[i]['pl'][k], 4)}
                               for i, L in enumerate(_src or []) for k, _, nm in L] if _src else ent.get("sugg")
                ent["fill"] = [dict(a, p=round(evs[a["i"]]['p'][OUT.index(a["o"])], 4), q=round(evs[a["i"]]['pl'][OUT.index(a["o"])], 4)) for a in fl]
                ent["edges"] = [{"i": i, "src": a.get("src", "ИИ"), "o": a["o"], "d": a["d"], "p": round(evs[i]['p'][OUT.index(a["o"])], 4),
                                 "q": round(evs[i]['pl'][OUT.index(a["o"])], 4)} for i, L in sorted((ed or {}).items(), key=lambda x: int(x[0])) for a in L]
                ent.get("plans", {}).pop("Келли · ИИ", None)
                # снимок толпы и пула: из таких снимков потом учимся предсказывать итоговую толпу к дедлайну
                snap = rd("crowd_snap.json", {})
                snap.setdefault(num, []).append([now.strftime("%Y-%m-%dT%H:%MZ"), round(fund), [[round(x, 2) for x in e['pl']] for e in evs]])
                snap[num] = snap[num][-150:]
                for old in sorted(snap, key=int)[:-60]: snap.pop(old, None)
                with open(os.path.join(API, "crowd_snap.json"), "w", encoding="utf-8") as f:
                    json.dump(snap, f, separators=(",", ":"))
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
                for x in ent.get("edges") or []:
                    x["hit"] = 1 if evs[int(x["i"])]['res'] == OUT.index(x["o"]) else 0
                for x in (ent.get("fill") or []) + (ent.get("sugg") or []):
                    x["hit"] = 1 if evs[int(x["i"])]['res'] == OUT.index(x["o"]) else 0
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
    # реальные выплаты Балтбета (общий архив выплат), где они есть
    pays = rd("payouts.json", {})
    for num, ent in jd.items():
        P = pays.get(num); h = hist.get(num)
        if not P or not P.get("k") or not h or not ent.get("score"): continue
        evs = [mk_ev([float(x) for x in e[3:6]], [float(x) for x in e[6:9]], OUT.index(e[9]) if e[9] in OUT else -1)[0] for e in h["ev"]]
        cum = [0.0] * 16; c = 0.0
        for k in range(9, 16): c += float(P["k"].get(str(k)) or 0); cum[k] = c * PRICE
        sets_all = {k: deser(v) for k, v in ent["plans"].items()}
        if ent.get("ai") and len(ent["ai"]) == 15: sets_all["ИИ"] = [[OUT.index(ch) for ch in r] for r in ent["ai"]]
        for k, sets in sets_all.items():
            if not sets or k not in summ: continue
            d = hit_dist(evs, sets); s = summ[k]
            s["rn"] = s.get("rn", 0) + 1; s["rcost"] = s.get("rcost", 0) + math.prod(len(x) for x in sets) * PRICE
            s["rwin"] = s.get("rwin", 0) + round(sum(v * cum[j] for j, v in enumerate(d) if 9 <= j <= 15))
    # перекосы ИИ: сыграли ли чаще, чем ждала линия
    eds = [x for ent in jd.values() for x in (ent.get("edges") or []) if "hit" in x]
    jr["edges"] = {}
    for x in eds:
        s = jr["edges"].setdefault(x.get("src", "ИИ"), {"n": 0, "exp": 0.0, "hit": 0, "crowd": 0.0})
        s["n"] += 1; s["exp"] = round(s["exp"] + x["p"], 2); s["hit"] += x["hit"]; s["crowd"] = round(s["crowd"] + x["q"], 2)
    jr["fill"] = {}
    for x in [x for ent in jd.values() for x in (ent.get("fill") or []) if "hit" in x]:
        s = jr["fill"].setdefault(x["src"], {"n": 0, "exp": 0.0, "hit": 0, "crowd": 0.0})
        s["n"] += 1; s["exp"] = round(s["exp"] + x["p"], 2); s["hit"] += x["hit"]; s["crowd"] = round(s["crowd"] + x["q"], 2)
    jr["summary"] = summ
    if changed or jr.get("summary") != rd("journal.json", {}).get("summary"):
        with open(os.path.join(API, "journal.json"), "w", encoding="utf-8") as f:
            json.dump(jr, f, ensure_ascii=False, separators=(",", ":"))
        print("journal: записано, тиражей", len(jd), "оценено", sum(1 for e in jd.values() if "score" in e))
    else:
        print("journal: без изменений")


if __name__ == "__main__":
    main()
