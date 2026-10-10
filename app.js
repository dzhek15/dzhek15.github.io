(function(){
  "use strict";
  var C = window.CONFIG;
  var OUT = C.OUT;
  var KEY = C.STORAGE_KEY;
  var MAX_CSV = C.MAX_CSV;
  var book = null;          /* открытый CSV: {name, rows:[["1","X",...]], idx} — только в памяти вкладки */
  var ZMIN = C.ZOOM_MIN, ZMAX = C.ZOOM_MAX, ZSTEP = C.ZOOM_STEP;

  var SEED = [
    ["14.09","21:15","Азия. Лига Чемпионов","Эстеглаль ФК","Аль Садд",[],"rand"],
    ["14.09","22:00","Англия. Премьер-Лига","Лидс","Ньюкасл",[],"rand"],
    ["14.09","20:00","Египет. Чемпионат","Серамека","Нацбанк ФК",[],"rand"],
    ["14.09","21:45","Ирландия. Чемпионат","Уотерфорд","Дерри Сити",[],"rand"],
    ["14.09","21:45","Ирландия. Чемпионат","Слайго Роверс","Гэлуэй Юнайтед",[],"rand"],
    ["14.09","21:45","Ирландия. Чемпионат","Дандолк","Ст. Патрикс Атлетик",[],"rand"],
    ["14.09","22:00","Испания. Ла Лига","Вильярреал","Бетис",[],"rand"],
    ["14.09","21:30","Испания. Ла Лига 2","Сельта Б","Эйбар",[],"rand"],
    ["14.09","21:00","Нидерланды. 1-й дивизион","Утрехт (м)","Аякс (м)",[],"rand"],
    ["14.09","21:00","Нидерланды. 1-й дивизион","ПСВ Эйндховен (м)","Алкмаар (м)",[],"rand"],
    ["14.09","20:00","Польша. Чемпионат","Радомяк Радом","Пяст Гливице",[],"rand"],
    ["14.09","20:45","Португалия. Чемпионат","Риу Аве","Эштрела Амадора",[],"rand"],
    ["14.09","22:15","Португалия. Чемпионат","Морейренсе","Маритиму",[],"rand"],
    ["14.09","20:00","Португалия. 2-й дивизион","Спортинг Лиссабон Б","Лузитания",[],"rand"],
    ["14.09","21:45","Франция. Лига 2","Ред Стар","Мец",[],"rand"]
  ];

  /* Выбор Claude от 13.09.2026: по одному наименее вероятному исходу на матч.
     Сверяется по хозяевам, чтобы не приложиться к чужому тиражу. */
  var PRESET = {
    tirazh: "5005",
    date: "13.09.2026",
    rows: [
      ["Манчестер Юнайтед", "X", "МЮ дома шесть матчей без ничьих"],
      ["Сармьенто", "2", "три чистые домашние победы Сармьенто"],
      ["Тигре", "2", "Тигре дома пять матчей без поражений"],
      ["Зюльте-Варегем", "X", "у обеих по одной ничьей за шесть"],
      ["РААЛ Ла Лувьер", "2", "Кортрейк в элите на выезде не забил"],
      ["Хетафе", "2", "Хетафе дома цепкий, судья с домашним перекосом"],
      ["Реал Сосьедад", "1", "Сосьедад дома выиграл один раз из пяти"],
      ["Вальядолид", "2", "Овьедо вылетел и едва тянет"],
      ["Тенерифе", "1", "Леганес на выезде не проигрывает"],
      ["Лечче", "2", "Монца на выезде без побед, судья Креццини 13/3/4"],
      ["Мантова", "2", "Сампдория на выезде без побед"],
      ["Арока", "2", "Санта-Клара на выезде только ничьи"],
      ["Торпедо Москва", "X", "Пари НН на выезде без ничьих в шести"],
      ["Генчлербирлиги", "2", "Генчлер дома обыграл даже Фенербахче"],
      ["Амедспор", "2", "Башакшехир проиграл два последних выезда"]
    ],
    /* итоговый билет: по одному исходу на матч */
    final: ["1","1","X","2","X","1","X","1","2","1","1","1","2","1","1"]
  };

  function seedState(){
    return {
      tirazh: "5006",
      price: 30,
      target: 0,
      rolls: 0,
      deadline: "",
      jackpot: 0,
      poolSum: 0,
      poolTypical: 0,
      ratioTypical: 0,
      ratioList: [],
      ratioQ: [],
      jackWins: 0,
      finCount: 0,
      showPct: false,
      showKf: false,
      compact: false,
      zoom: 1,
      spent: 0,
      spins: 1,
      speed: 900,
      matches: SEED.map(function(s,i){
        return {id:"m"+i, date:s[0], time:s[1], league:s[2], home:s[3], away:s[4],
                picks:{ "1":s[5].indexOf("1")>=0, "X":s[5].indexOf("X")>=0, "2":s[5].indexOf("2")>=0 },
                pool: (s[6]==="rand" ? s[5].slice() : OUT.slice()),
                mode:s[6]};
      }),
      history: [],
      played: []
    };
  }

  var state, freshStart = false;
  try{
    var raw = localStorage.getItem(KEY);
    if(raw){ state = JSON.parse(raw); }
    if(!state || !Array.isArray(state.matches) || !state.matches.length){ state = seedState(); freshStart = true; }
  }catch(e){ state = seedState(); freshStart = true; }
  if(!Array.isArray(state.history)) state.history = [];
  if(!Array.isArray(state.future)) state.future = [];
  if(!Array.isArray(state.played)) state.played = [];
  state.showPct = !!state.showPct;
  state.showKf  = !!state.showKf;
  /* один шаг назад: предыдущий тираж хранится целиком для просмотра, купон он не трогает */
  if(!state.prev || !Array.isArray(state.prev.matches) || !state.prev.matches.length) state.prev = null;
  if(!state.prevKeep || !Array.isArray(state.prevKeep.matches) || !state.prevKeep.matches.length) state.prevKeep = null;
  if(state.prev && state.prev.cur && !state.viewPrev){ state.prev = state.prevKeep; state.prevKeep = null; }   /* снимок текущего тиража живёт только пока открыт его просмотр */
  state.viewPrev = !!(state.viewPrev && state.prev);
  /* ссылки на наборы тиража, который ещё не начался: ждут старта и сами открываются в просмотре */
  if(!state.waitSets || !state.waitSets.tirazh || !Array.isArray(state.waitSets.payloads) || !state.waitSets.payloads.length) state.waitSets = null;
  if(state.tirazhId == null) state.tirazhId = null;
  state.compact = false;   /* компактный вид убран вместе с кнопкой */
  state.zoom = Number(state.zoom);
  if(!isFinite(state.zoom) || state.zoom <= 0) state.zoom = 1;
  state.zoom = Math.round(Math.max(ZMIN, Math.min(ZMAX, state.zoom)) * 100) / 100;
  state.target = Number(state.target);
  if(!isFinite(state.target) || state.target < 0) state.target = 0;
  state.price = Number(state.price); if(!isFinite(state.price) || state.price <= 0) state.price = 30;
  state.rolls = Number(state.rolls); if(!isFinite(state.rolls) || state.rolls < 0) state.rolls = 0;
  state.spent = Number(state.spent); if(!isFinite(state.spent) || state.spent < 0) state.spent = 0;
  state.spins = Math.floor(Number(state.spins)); if(!isFinite(state.spins) || state.spins < 1) state.spins = 1;
  if(state.spins > 100000) state.spins = 100000;
  state.speed = Number(state.speed);
  if([70,380,900].indexOf(state.speed) < 0) state.speed = 900;
  state.matches.forEach(function(m){
    if(!m.picks) m.picks = {};
    OUT.forEach(function(o){ m.picks[o] = !!m.picks[o]; });
    if(m.mode!=="rand" && m.mode!=="lock") m.mode = "free";
    if(!Array.isArray(m.pool)) m.pool = null;
    if(m.pool) m.pool = m.pool.filter(function(o){ return OUT.indexOf(o)>=0; });
    if(!m.pool || !m.pool.length) m.pool = OUT.slice();
  });

  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
    if(typeof ujSoon === "function" && UJ && UJ.last) ujSoon();
  }

  var $ = function(id){ return document.getElementById(id); };

  /* ---------- единый журнал «Назад / Вперёд» ----------
     Любое изменение купона и корзины (исход, режим строки, жребий, «в корзину», отметка,
     удаление, очистка, стратегии, загрузка тиража…) замечается само: после каждого действия
     сравниваем пользовательскую часть состояния с прежней и кладём прежнюю в стопку.
     Корзину храним как список id вариантов + общий словарь самих вариантов (не копии целиком).
     Стопка живёт до 300 шагов, последние 25 переживают перезагрузку страницы. */
  var UJ = { back: [], fwd: [], ent: {}, last: null, lastFp: "", busy: false, q: false, pt: 0, n: 0, gKey: "", gAt: 0, silent: false, MAX: 300, KEEP: 25 };
  var UJ_KEY = "dzhek-undo1";
  function ujNewId(){ UJ.n++; return "e" + Date.now().toString(36) + UJ.n.toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function ujTime(){ return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
  function ujId(){ return state.matches.map(function(m){ return (m.id || "") + "|" + m.home + "|" + m.away; }).join("~"); }
  function ujParts(){
    var p = [], so = [];
    state.played.forEach(function(v){
      if(!v.u) v.u = ujNewId();
      p.push(v.u); if(v.sel === false) so.push(v.u);
    });
    return {
      id: ujId(),
      mt: state.matches.map(function(m){ return [OUT.filter(function(o){ return m.picks && m.picks[o]; }).join(""), m.mode, (m.pool || OUT).join("")]; }),
      p: p, so: so,
      sc: [state.spent, state.rolls, Number(state.price), state.spins, Number(state.target) || 0],
      tz: String(state.tirazh || "")
    };
  }
  function ujFp(){ var x = ujParts(); return JSON.stringify([x.id, x.mt, x.p, x.so, x.sc, x.tz]); }
  function ujCap(){
    var x = ujParts();
    state.played.forEach(function(v){
      if(UJ.ent[v.u]) return;
      var c = {}; Object.keys(v).forEach(function(k){ if(k !== "sel") c[k] = v[k]; });
      UJ.ent[v.u] = c;
    });
    x.at = ujTime();
    x.ti = state.tirazhId || null; x.dl = state.deadline || "";
    x.mfull = JSON.parse(JSON.stringify(state.matches));
    return x;
  }
  /* что именно изменилось — для подсказки на кнопке и для склейки набора цифр в одно действие */
  function ujDiff(a, b){
    var L = [], g = "";
    if(a.id !== b.id){ L.push("смена тиража"); g = "draw"; }
    else {
      var np = 0, nm = 0, nl = 0;
      b.mt.forEach(function(x, i){ var y = a.mt[i]; if(!y) return; if(x[0] !== y[0]) np++; if(x[1] !== y[1]) nm++; if(x[2] !== y[2]) nl++; });
      if(np) L.push(np > 1 ? "расстановка исходов" : "выбор исхода");
      if(nm) L.push("режим строки");
      if(nl) L.push("жеребьёвка исходов");
    }
    if(a.p.join() !== b.p.join()){
      if(b.p.length > a.p.length) L.push("в корзину");
      else if(b.p.length === 0) L.push("очистка корзины");
      else if(b.p.length < a.p.length) L.push("из корзины");
      else L.push("порядок в корзине");
    } else if(a.so.join() !== b.so.join()) L.push("отметка в корзине");
    var nmz = ["spent", "rolls", "price", "spins", "target"];
    [2, 3, 4].forEach(function(i){ if(a.sc[i] !== b.sc[i]){ var k = nmz[i]; L.push(k === "price" ? "цена" : k === "spins" ? "число бросков" : "цель"); if(!g) g = k; } });
    if(a.tz !== b.tz && a.id === b.id){ L.push("номер тиража"); if(!g) g = "tz"; }
    return { l: L.length ? L.join(" + ") : "изменение", g: L.length === 1 && (g === "price" || g === "spins" || g === "target" || g === "tz") ? g : "" };
  }
  function ujSync(){
    var u = $("btnUndo"), r = $("btnRedo");
    if(u){
      u.disabled = UJ.back.length === 0 || spinning;
      u.title = UJ.back.length ? "Отменить: " + UJ.back[UJ.back.length - 1].l + " (шагов назад: " + UJ.back.length + ")" : "Отменять пока нечего";
    }
    if(r){
      r.disabled = UJ.fwd.length === 0 || spinning;
      r.title = UJ.fwd.length ? "Вернуть: " + UJ.fwd[UJ.fwd.length - 1].l + " (шагов вперёд: " + UJ.fwd.length + ")" : "Возвращать пока нечего";
    }
  }
  function ujCheck(){
    if(UJ.busy || spinning || !UJ.last) return;
    var fp = ujFp();
    if(fp === UJ.lastFp) return;
    var cur = ujCap(), prev = UJ.last, d = ujDiff(prev, cur), now = Date.now();
    var merge = d.g && d.g === UJ.gKey && now - UJ.gAt < 1500 && UJ.back.length;
    UJ.gKey = d.g; UJ.gAt = now;
    if(!merge){
      prev.mf = prev.id !== cur.id ? prev.mfull : null; delete prev.mfull; prev.l = d.l;
      UJ.back.push(prev);
      if(UJ.back.length > UJ.MAX) UJ.back.splice(0, UJ.back.length - UJ.MAX);
    } else {
      UJ.back[UJ.back.length - 1].l = d.l;
    }
    UJ.fwd = [];
    UJ.last = cur; UJ.lastFp = fp;
    ujSync(); ujSave();
  }
  function ujSoon(){
    if(UJ.q) return; UJ.q = true;
    Promise.resolve().then(function(){ UJ.q = false; try{ ujCheck(); }catch(e){} });
  }
  function ujApply(s){
    if(s.mf){
      state.matches = JSON.parse(JSON.stringify(s.mf));
      state.tirazhId = s.ti; state.deadline = s.dl;
    } else {
      state.matches.forEach(function(m, i){
        var x = s.mt[i]; if(!x) return;
        m.picks = { "1": x[0].indexOf("1") >= 0, "X": x[0].indexOf("X") >= 0, "2": x[0].indexOf("2") >= 0 };
        m.mode = x[1];
        var pl = OUT.filter(function(o){ return x[2].indexOf(o) >= 0; });
        m.pool = pl.length ? pl : OUT.slice();
      });
    }
    state.tirazh = s.tz;
    var tn = $("tirazhName"); if(tn) tn.value = state.tirazh || "";
    state.spent = s.sc[0]; state.rolls = s.sc[1]; state.price = s.sc[2]; state.spins = s.sc[3]; state.target = s.sc[4];
    var off = {}; s.so.forEach(function(u){ off[u] = 1; });
    state.played = s.p.map(function(u){
      var e = UJ.ent[u]; if(!e) return null;
      var c = {}; Object.keys(e).forEach(function(k){ c[k] = e[k]; });
      if(off[u]) c.sel = false;
      return c;
    }).filter(Boolean);
  }
  /* from → откуда берём шаг, to → куда кладём текущее состояние (для «Вперёд» наоборот) */
  function ujMove(from, to){
    if(spinning || !from.length) return;
    var s = from.pop();
    UJ.busy = true;
    try{
      var cur = ujCap();
      cur.mf = cur.id !== s.id ? cur.mfull : null; delete cur.mfull; cur.l = s.l;
      to.push(cur);
      if(to.length > UJ.MAX) to.splice(0, to.length - UJ.MAX);
      ujApply(s);
      UJ.last = ujCap(); UJ.lastFp = ujFp(); UJ.gKey = "";
      histArmed = -1; try{ disarmClear(); }catch(e){}
      save(); render();
    } finally { UJ.busy = false; }
    ujSync(); ujSave();
    var h = $("hint"); if(h && !h.hidden){ h.hidden = true; h.textContent = ""; }
  }
  function ujReset(){ UJ.back = []; UJ.fwd = []; UJ.ent = {}; UJ.last = ujCap(); UJ.lastFp = ujFp(); UJ.gKey = ""; ujSync(); ujSave(); }
  function ujSave(){ clearTimeout(UJ.pt); UJ.pt = setTimeout(ujFlush, 700); }
  function ujFlush(){
    clearTimeout(UJ.pt);
    try{
      var keep = UJ.KEEP, str = "";
      for(var tries = 0; tries < 7; tries++){
        var b = keep ? UJ.back.slice(-keep) : [], f = keep ? UJ.fwd.slice(-keep) : [], need = {}, e = {};
        b.concat(f).forEach(function(s){ s.p.forEach(function(u){ need[u] = 1; }); });
        Object.keys(need).forEach(function(u){ if(UJ.ent[u]) e[u] = UJ.ent[u]; });
        str = JSON.stringify({ b: b, f: f, e: e });
        if(str.length < 700000) break;
        keep = Math.floor(keep / 2);   /* огромная корзина: в память браузера уходит меньше шагов, в сессии остаются все */
      }
      localStorage.setItem(UJ_KEY, str);
      /* словарь вариантов чистим от тех, на кого никто не ссылается */
      var used = {};
      UJ.back.concat(UJ.fwd).forEach(function(s){ s.p.forEach(function(u){ used[u] = 1; }); });
      if(UJ.last) UJ.last.p.forEach(function(u){ used[u] = 1; });
      Object.keys(UJ.ent).forEach(function(u){ if(!used[u]) delete UJ.ent[u]; });
    }catch(e){ try{ localStorage.removeItem(UJ_KEY); }catch(_){} }
  }
  try{
    var ujRaw = localStorage.getItem(UJ_KEY);
    if(ujRaw){
      var ujo = JSON.parse(ujRaw);
      var okStep = function(s){ return s && Array.isArray(s.mt) && Array.isArray(s.p) && Array.isArray(s.so) && Array.isArray(s.sc) && typeof s.id === "string"; };
      if(ujo && Array.isArray(ujo.b) && Array.isArray(ujo.f) && ujo.e && typeof ujo.e === "object"){
        UJ.back = ujo.b.filter(okStep); UJ.fwd = ujo.f.filter(okStep); UJ.ent = ujo.e;
      }
    }
  }catch(e){ UJ.back = []; UJ.fwd = []; UJ.ent = {}; }
  state.history = []; state.future = [];     /* старая стопка заменена единым журналом */
  UJ.last = ujCap(); UJ.lastFp = ujFp();
  window.addEventListener("pagehide", function(){ ujCheck(); ujFlush(); });
  document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "hidden"){ ujCheck(); ujFlush(); } });

  /* любая строка обязана иметь набор исходов и объект picks — иначе рендер падает */
  function ensureShape(){
    state.matches.forEach(function(m){
      if(!m.picks) m.picks = {};
      OUT.forEach(function(o){ m.picks[o] = !!m.picks[o]; });
      if(!Array.isArray(m.pool)) m.pool = null;
      if(m.pool) m.pool = m.pool.filter(function(o){ return OUT.indexOf(o) >= 0; });
      if(!m.pool || !m.pool.length) m.pool = OUT.slice();
      if(m.mode !== "rand" && m.mode !== "lock") m.mode = "free";
    });
  }

  function countPicks(m){ var n=0; for(var i=0;i<3;i++) if(m.picks[OUT[i]]) n++; return n; }

  function tally(){
    var t={combos:1, singles:0, doubles:0, triples:0, empty:0, rand:0, locked:0};
    state.matches.forEach(function(m){
      var n=countPicks(m);
      if(n===0){ t.empty++; } else if(n===1){ t.singles++; } else if(n===2){ t.doubles++; } else { t.triples++; }
      t.combos *= (n||0);
      if(m.mode==="rand") t.rand++;
      if(m.mode==="lock") t.locked++;
    });
    if(t.empty>0) t.combos = 0;
    return t;
  }

  function fmt(n){ return n.toLocaleString("ru-RU"); }

  /* Момент первого матча тиража в московском времени, независимо от часового пояса зрителя.
     Дата в строках вида «13.09», время «16:30». МСК = UTC+3. */
  /* «2026-09-14T20:00:00Z» у totobrief — это московское время, а не UTC */
  function mskIso(iso){
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if(!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5]);
  }

  function kickoffMs(){
    var fromApi = mskIso(state.deadline);
    if(fromApi !== null) return fromApi;
    var best = null;
    var now = new Date();
    state.matches.forEach(function(m){
      var dm = String(m.date || "").match(/^(\d{1,2})\.(\d{1,2})/);
      var tm = String(m.time || "").match(/^(\d{1,2}):(\d{2})/);
      if(!dm || !tm) return;
      var d = +dm[1], mo = +dm[2], hh = +tm[1], mi = +tm[2];
      var y = now.getUTCFullYear();
      var ts = Date.UTC(y, mo - 1, d, hh - 3, mi);
      /* если матч «в прошлом» больше чем на полгода — значит это следующий год */
      if(ts < now.getTime() - 180*86400000) ts = Date.UTC(y + 1, mo - 1, d, hh - 3, mi);
      if(best === null || ts < best) best = ts;
    });
    return best;
  }

  /* время последнего ответа totobrief, по МСК */
  function resStamp(){
    if(!state.resAt) return "";
    var d = new Date(Number(state.resAt) + 3 * 3600000);
    var two = function(x){ return (x < 10 ? "0" : "") + x; };
    return two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
  }

  function renderKickoff(){
    try{ renderBlend(); }catch(e){}
    var tc = $("tkCount"); /* плитку «Матчей» убрали — оставляем проверку на случай возврата */
    if(tc) tc.textContent = state.matches.length;
    /* всё в шапке — по тиражу, который на экране: листаешь стрелками — меняется и суперприз */
    var inPrevK = !!(state.viewPrev && state.prev);
    var jackShow = inPrevK
      ? (Number(state.prev.jack) || Number(((state.drawByNo || {})[state.prev.tirazh] || {}).jack) || 0)
      : (Number(state.jackpot) || 0);
    var jw = $("tkJackWrap");
    if(jackShow){
      jw.hidden = false;
      $("tkJack").textContent = fmt(jackShow) + " ₽";
    } else { jw.hidden = true; }

    /* пул тиража, который сейчас на экране (у БалтБета — «Возможный выигрыш»);
       листаешь тираж стрелками — меняется и пул */
    var fw = $("tkFundWrap");
    var inPrevF = !!(state.viewPrev && state.prev);
    var fShow = inPrevF
      ? (Number(((state.drawByNo || {})[state.prev.tirazh] || {}).pool) || Number(state.prev.pool) || 0)
      : (Number(state.poolSum) || 0);
    if(fShow > 0){
      fw.hidden = false;
      $("tkFund").textContent = fmt(fShow) + " ₽";
    } else { fw.hidden = false; $("tkFund").textContent = "—"; }

    /* ценность тиража: суперприз к типичному фонду, сравниваем с обычным уровнем */
    var vw = $("tkValWrap");
    var fundNow = Number(state.poolTypical) || Number(state.poolSum) || 0;
    var rTyp = Number(state.ratioTypical) || 0;
    if(jackShow && fundNow){
      vw.hidden = false;
      var r = jackShow / fundNow;
      var vEl = $("tkVal");
      vEl.textContent = r.toFixed(2).replace(".", ",");
      vEl.classList.remove("good", "bad");
      var word = "—", Q = state.ratioQ || [];
      if(Q.length === 4){
        if(r >= Q[3]){ vEl.classList.add("good"); word = "ТОП"; }
        else if(r >= Q[2]){ vEl.classList.add("good"); word = "высокая"; }
        else if(r >= Q[0]){ word = "средняя"; }
        else { vEl.classList.add("bad"); word = "низкая"; }
      } else if(rTyp > 0){
        word = r >= rTyp ? "средняя" : "низкая";
      }
      vEl.textContent = word;
      $("tkValNote").innerHTML = "суперприз " + r.toFixed(2).replace(".", ",") +
        " от фонда" + (rTyp > 0 ? ", обычно " + rTyp.toFixed(2).replace(".", ",") : "");
    } else { vw.hidden = false; $("tkVal").textContent = "—"; $("tkVal").classList.remove("good", "bad"); $("tkValNote").innerHTML = "&nbsp;"; }

    /* на телефоне плитки лежат сеткой 2×2: нечётную последнюю растягиваем на всю ширину,
       иначе справа от неё просвечивает серый фон контейнера */
    var tks = [].slice.call(document.querySelectorAll(".ticket .tk"));
    var vis = tks.filter(function(e){ return !e.hidden; });
    tks.forEach(function(e){ e.style.gridColumn = ""; });
    if(vis.length % 2 === 1 && vis.length) vis[vis.length - 1].style.gridColumn = "1 / -1";

    var tv = $("koTime"), lv = $("koLeft");
    tv.classList.remove("soon","shut"); lv.classList.remove("soon","shut");
    if(lv.previousElementSibling) lv.previousElementSibling.textContent = (state.viewPrev && state.prev) ? "Статус" : "Осталось";
    if(state.viewPrev && state.prev){
      var pts = mskIso(state.prev.deadline), pt = function(x){ return (x<10?"0":"") + x; };
      if(pts !== null){
        var pm = new Date(pts + 3*3600000);
        tv.textContent = pt(pm.getUTCDate()) + "." + pt(pm.getUTCMonth()+1) + " · " + pt(pm.getUTCHours()) + ":" + pt(pm.getUTCMinutes());
      } else tv.textContent = "—";
      /* прошлый тираж — без красного: приём по нему давно закрыт, это не тревога */
      lv.textContent = prevDone() ? "сыгран" : "идёт";
      lv.title = prevDone() ? "Все результаты прошлого тиража подведены" : "Счёт прошлого тиража обновляется раз в 30 секунд, пока открыт просмотр";
      return;
    }
    var ts = kickoffMs();
    if(ts === null){
      tv.textContent = "—";
      lv.textContent = "—";
      return;
    }
    var two = function(x){ return (x<10?"0":"") + x; };
    /* печатаем в МСК */
    var msk = new Date(ts + 3*3600000);
    tv.textContent = two(msk.getUTCDate()) + "." + two(msk.getUTCMonth()+1) + " · " +
      two(msk.getUTCHours()) + ":" + two(msk.getUTCMinutes());
    var diff = ts - Date.now();
    if(diff <= 0){
      tv.classList.add("shut"); lv.classList.add("shut");
      lv.textContent = "закрыт" + (state.resAt ? " · обн. " + resStamp() : "");
      lv.title = state.matches.length && state.matches.every(function(m){ return m.res; })
        ? "Все результаты подведены, автообновление остановлено"
        : "Пока идут матчи, счёт сам обновляется раз в 30 секунд (если вкладка открыта)";
      return;
    }
    var mins = Math.floor(diff / 60000);
    var hrs = Math.floor(mins / 60);
    var days = Math.floor(hrs / 24);
    var txt = days > 0 ? (days + " дн " + (hrs % 24) + " ч")
            : hrs > 0 ? (hrs + " ч " + (mins % 60) + " мин")
            : (mins + " мин");
    if(mins <= 60){ tv.classList.add("soon"); lv.classList.add("soon"); }
    lv.textContent = txt;
  }

  function signature(matches){
    return matches.map(function(m){
      var s = OUT.filter(function(o){ return m.picks[o]; }).join("");
      return s || "·";
    }).join(" ");
  }

  function makeSnap(label, keepMeta){
    return {
      at: new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}),
      label: label,
      sig: signature(state.matches),
      snap: state.matches.map(function(m){
        return {picks:{"1":m.picks["1"],"X":m.picks["X"],"2":m.picks["2"]}, mode:m.mode, pool:(m.pool || OUT).slice()};
      }),
      meta: keepMeta ? {
        tirazh: state.tirazh, spent: state.spent, rolls: state.rolls,
        played: state.played.slice(0, 60),
        matches: JSON.parse(JSON.stringify(state.matches))
      } : null
    };
  }
  function pushHistory(label, keepMeta){ /* история теперь ведётся автоматически: см. журнал UJ */ }
  /* «Назад» для корзины: храним только убранные варианты с их местами,
     а не копию всей корзины — так история не раздувает память браузера */
  function pushBasketUndo(label, removed){ /* см. журнал UJ */ }
  function applyBasket(bk){
    if(bk.ins){
      var ins = bk.ins.slice().sort(function(a, b){ return a[0] - b[0]; });
      ins.forEach(function(p){ state.played.splice(Math.min(p[0], state.played.length), 0, p[1]); });
      return { del: ins.map(function(p){ return p[0]; }) };
    }
    var idx = (bk.del || []).slice().sort(function(a, b){ return b - a; }), back = [];
    idx.forEach(function(i){ if(i < state.played.length) back.push([i, state.played.splice(i, 1)[0]]); });
    return { ins: back };
  }
  function applySnap(h){
    if(!(h.meta && Array.isArray(h.meta.matches) && h.meta.matches.length)){
      state.matches.forEach(function(m,i){
        var s = h.snap[i]; if(!s) return;
        m.picks = {"1":s.picks["1"],"X":s.picks["X"],"2":s.picks["2"]};
        m.mode = s.mode;
        if(Array.isArray(s.pool) && s.pool.length) m.pool = s.pool.slice();
      });
    }
    if(h.meta){
      if(Array.isArray(h.meta.matches) && h.meta.matches.length) state.matches = h.meta.matches;
      state.tirazh = h.meta.tirazh;
      state.spent = h.meta.spent;
      state.rolls = h.meta.rolls;
      state.played = Array.isArray(h.meta.played) ? h.meta.played : state.played;
      $("tirazhName").value = state.tirazh || "";
    }
  }

  /* ---------- масштаб ---------- */
  /* CSS zoom на body: значение живёт в состоянии и переживает перезагрузку */
  function applyZoom(){
    var z = Number(state.zoom) || 1;
    document.body.style.zoom = (z === 1 ? "" : String(z));
    var lbl = $("zoomVal");
    if(lbl) lbl.textContent = Math.round(z * 100) + "%";
    var zi = $("btnZoomIn"), zo = $("btnZoomOut");
    if(zi) zi.disabled = z >= ZMAX - 0.001;
    if(zo) zo.disabled = z <= ZMIN + 0.001;
  }

  function setZoom(z){
    z = Math.round(Math.max(ZMIN, Math.min(ZMAX, z)) * 100) / 100;
    state.zoom = z;
    applyZoom();
    save();
    return z;
  }

  /* высота САМОЙ таблицы матчей при заданном масштабе.
     Раньше мерили расстояние от верха экрана до её низа — в расчёт попадали
     шапка и пульт, и масштаб выходил излишне мелким. */
  function measureBottom(z){
    var coup = $("coupon");
    if(!coup) return 0;
    document.body.style.zoom = (z === 1 ? "" : String(z));
    void document.body.offsetHeight; /* заставляем пересчитать вёрстку */
    return coup.getBoundingClientRect().height + 8;
  }

  /* Масштаб меняет ширину вёрстки, а с ней и высоту — поэтому не одна формула,
     а несколько проходов с пересчётом, пока купон не уложится в экран. */
  function fitZoom(){
    var have = window.innerHeight;
    var z = 1, good = null;
    if(!(have > 0)) return z;
    for(var pass = 0; pass < 8; pass++){
      var bottom = measureBottom(z);
      if(!(bottom > 0)) break;
      if(bottom <= have){ good = z; break; }   /* таблица влезла — этот масштаб и берём */
      var guess = Math.floor((z * have / bottom) * 100) / 100;
      if(!isFinite(guess) || guess <= 0) guess = z - 0.05;
      if(guess > z - 0.02) guess = z - 0.02;   /* каждый проход обязан уменьшать масштаб */
      z = Math.max(ZMIN, Math.round(guess * 100) / 100);
      if(z <= ZMIN){ good = ZMIN; break; }
    }
    return good === null ? z : good;
  }

  /* подобрать масштаб так, чтобы таблица матчей целиком влезла в высоту окна */
  function fitToScreen(){
    if(!$("coupon")) return null;
    var z = fitZoom();
    var turnedCompact = false;
    /* мельче 60% читать уже нельзя — сначала включаем компактный вид, потом меряем заново */
    if(z < 0.6 && !state.compact){
      state.compact = true;
      turnedCompact = true;
      render();
      z = fitZoom();
    }
    setZoom(z);
    return {zoom: z, compact: turnedCompact};
  }


  /* ---------- Бриф-система: покрывающий код ----------
     Задача. В купоне часть матчей закрыта одним исходом, часть двумя-тремя. Полное
     покрытие — это все комбинации, и оно дорогое. Бриф-система берёт подмножество
     строк с обещанием: КАКОЙ БЫ исход внутри купона ни выпал, хотя бы одна строка
     угадает не меньше g матчей из пятнадцати.
     Матчи с одним исходом угадываются всегда, поэтому вся геометрия живёт только на
     «широких» матчах: если их m штук, промахнуться можно максимум по r = 15 - g
     координатам. То есть нужен покрывающий код радиуса r — набор точек, шары вокруг
     которых накрывают весь куб.
     Строим жадно: каждый раз берём точку, чей шар закрывает больше всего ещё не
     закрытого. Пересчитываем лениво (CELF): в куче лежат устаревшие оценки, и точка
     берётся, только если её свежая оценка не хуже верхушки. Ничьи разрешаем по
     меньшему индексу — без этого результат хуже на 5-6%. */
  /* Сколько точек в шаре радиуса r: свёртка по координатам, dp[d] — сумма
     произведений (размер-1) по всем d-подмножествам координат. */
  function briefBall(sizes, r){
    var dp = [1], k, i;
    for(k = 0; k < sizes.length; k++){
      dp.push(0);
      for(i = dp.length - 1; i > 0; i--) dp[i] += dp[i-1] * (sizes[k] - 1);
    }
    var tot = 0;
    for(var d = 0; d <= r && d < dp.length; d++) tot += dp[d];
    return tot;
  }

  /* ---------- готовые системы (brief_lib.js): покрытия для купонов из двоек и троек ---------- */
  function briefLibKey(sizes, r){
    var d = 0, t = 0;
    sizes.forEach(function(x){ if(x === 2) d++; else if(x === 3) t++; });
    return { d: d, t: t, key: d + "," + t + "," + r };
  }
  function briefLibRows(str){
    var out = [];
    for(var i = 0; i + 4 <= str.length; i += 4) out.push(parseInt(str.substr(i, 4), 36));
    return out;
  }
  function briefLibHas(sizes, r){
    return !!window.BRIEF_LIB && !!window.BRIEF_LIB[briefLibKey(sizes, r).key];
  }
  /* номера строк в нумерации купона (mul — веса позиций купона). exact: форма купона совпала с готовой;
     иначе — проекция более широкой готовой системы, проверенная перебором (детерминированно). */
  function briefLibCode(sizes, mul, r){
    if(!window.BRIEF_LIB) return null;
    var m = sizes.length, kk = briefLibKey(sizes, r), d = kk.d, t = kk.t, k, j;
    var dpos = [], tpos = [];
    for(k = 0; k < m; k++) (sizes[k] === 2 ? dpos : tpos).push(k);
    var order = dpos.concat(tpos);
    function digitsOf(x, sz, ml, n){
      var dg = new Array(n);
      for(var q = 0; q < n; q++) dg[q] = Math.floor(x / ml[q]) % sz[q];
      return dg;
    }
    function toMul(sz){ var ml = [1]; for(var q = 1; q < sz.length; q++) ml.push(ml[q-1] * sz[q-1]); return ml; }
    var exact = window.BRIEF_LIB[kk.key];
    if(exact){
      var sz0 = []; for(j = 0; j < d; j++) sz0.push(2); for(j = 0; j < t; j++) sz0.push(3);
      var ml0 = toMul(sz0), rows0 = briefLibRows(exact).map(function(x){
        var dg = digitsOf(x, sz0, ml0, sz0.length), y = 0;
        for(var q = 0; q < order.length; q++) y += dg[q] * mul[order[q]];
        return y;
      });
      return { rows: rows0, exact: true };
    }
    /* проекция: берём t троичных столбцов и d любых из остальных */
    var best = null;
    Object.keys(window.BRIEF_LIB).forEach(function(key){
      var pr = key.split(","), d2 = Number(pr[0]), t2 = Number(pr[1]);
      if(Number(pr[2]) !== r || t2 < t || d2 + t2 < m) return;
      var sz2 = []; for(j = 0; j < d2; j++) sz2.push(2); for(j = 0; j < t2; j++) sz2.push(3);
      var ml2 = toMul(sz2), code2 = briefLibRows(window.BRIEF_LIB[key]);
      if(best && code2.length > best.rows.length * 4) return;
      for(var trial = 0; trial < 6; trial++){
        var idx3 = [], idx2 = [];
        for(j = 0; j < t2; j++) idx3.push(d2 + ((j + trial) % t2));
        for(j = 0; j < d2; j++) idx2.push((j + trial) % d2);
        var pt = idx3.slice(0, t);
        var pool = idx2.concat(idx3.filter(function(c){ return pt.indexOf(c) < 0; }));
        var cols = pool.slice(0, d).concat(pt);
        var seen = {}, rows = [];
        code2.forEach(function(x){
          var dg = digitsOf(x, sz2, ml2, sz2.length), y = 0;
          for(var q = 0; q < cols.length; q++){
            var v = dg[cols[q]]; if(q < d && v === 2) v = 0;
            y += v * mul[order[q]];
          }
          if(!seen[y]){ seen[y] = 1; rows.push(y); }
        });
        if(best && rows.length >= best.rows.length) continue;
        if(briefCovers(rows, sizes, mul, r)) best = { rows: rows, exact: false };
      }
    });
    return best;
  }
  function briefCovers(rows, sizes, mul, r){
    var m = sizes.length, U = 1, k;
    for(k = 0; k < m; k++) U *= sizes[k];
    var cov = new Uint8Array(U), left = U;
    function mark(x, dg, depth, start){
      if(!cov[x]){ cov[x] = 1; left--; }
      if(depth === r) return;
      for(var p = start; p < m; p++){
        for(var v = 0; v < sizes[p]; v++){ if(v === dg[p]) continue; mark(x + (v - dg[p]) * mul[p], dg, depth + 1, p + 1); }
      }
    }
    for(var i = 0; i < rows.length; i++){
      var dg = new Array(m);
      for(k = 0; k < m; k++) dg[k] = Math.floor(rows[i] / mul[k]) % sizes[k];
      mark(rows[i], dg, 0, 0);
    }
    return left === 0;
  }

  /* W — вероятности исходов по матчам (или null): тогда жадный шаг берёт строку, чей шар
     закрывает больше всего ещё не закрытой ВЕРОЯТНОСТИ, а не штук. Гарантия та же, но
     строки ложатся на вероятные сочетания — чаще 15 и 14. */
  function briefBuild(sets, g, budgetMs, W, even){
    budgetMs = budgetMs || 25000;
    var n = sets.length, wide = [], fixed = [], i, k;
    for(i = 0; i < n; i++){ (sets[i].length > 1 ? wide : fixed).push(i); }
    var m = wide.length, r = n - g;
    if(r < 0) return { err: "гарантия больше числа матчей" };
    if(r >= m){
      var one = []; for(i = 0; i < n; i++) one.push(sets[i][0]);
      return { lines: [one], U: 1, rows: 1, m: m, r: r };
    }
    var sizes = [], U = 1;
    for(k = 0; k < m; k++){ sizes.push(sets[wide[k]].length); U *= sizes[k]; }
    if(U > BRIEF_CAP_U) return { tooBig: true, U: U, m: m, r: r };

    var mul = new Array(m); mul[0] = 1;
    for(k = 1; k < m; k++) mul[k] = mul[k-1] * sizes[k-1];
    var v = new Int32Array(m);
    /* вес точки: произведение вероятностей её исходов (внутри купона, нормировано) */
    var wt = null;
    if(W){
      var wk = [];
      for(k = 0; k < m; k++){
        var st = sets[wide[k]], pk = W[wide[k]], S = 0, row = [];
        st.forEach(function(o){ var q = pk ? Math.max(pk[o], 1e-6) : 1; row.push(q); S += q; });
        wk.push(row.map(function(q){ return q / S; }));
      }
      wt = new Float64Array(U);
      for(var xx = 0; xx < U; xx++){
        var prod = 1, rest = xx;
        for(k = 0; k < m; k++){ prod *= wk[k][rest % sizes[k]]; rest = Math.floor(rest / sizes[k]); }
        wt[xx] = prod;
      }
    }
    function dec(x){ for(var j = 0; j < m; j++) v[j] = Math.floor(x / mul[j]) % sizes[j]; }
    function walk(x, depth, start, fn){
      fn(x);
      if(depth === r) return;
      for(var p = start; p < m; p++){
        var base = Math.floor(x / mul[p]) % sizes[p];
        for(var val = 0; val < sizes[p]; val++){
          if(val === base) continue;
          walk(x + (val - base) * mul[p], depth + 1, p + 1, fn);
        }
      }
    }
    var covered = new Uint8Array(U), left = U, code = [];
    var gw = even ? null : wt;             /* веса для жадного шага; шансы считаем в любом режиме */
    var heap = new Int32Array(U + 1), hkey = gw ? new Float64Array(U + 1) : new Int32Array(U + 1), hstamp = new Int32Array(U + 1), hn = 0;
    function push(key, x, st){
      hn++; heap[hn] = x; hkey[hn] = key; hstamp[hn] = st;
      var c = hn, t;
      while(c > 1){
        var pp = c >> 1;
        if(hkey[pp] > hkey[c] || (hkey[pp] === hkey[c] && heap[pp] <= heap[c])) break;
        t = heap[pp]; heap[pp] = heap[c]; heap[c] = t;
        t = hkey[pp]; hkey[pp] = hkey[c]; hkey[c] = t;
        t = hstamp[pp]; hstamp[pp] = hstamp[c]; hstamp[c] = t;
        c = pp;
      }
    }
    function pop(){
      var topX = heap[1], topSt = hstamp[1], t;
      heap[1] = heap[hn]; hkey[1] = hkey[hn]; hstamp[1] = hstamp[hn]; hn--;
      var c = 1;
      for(;;){
        var l = c << 1, rr = l + 1, b = c;
        if(l  <= hn && (hkey[l]  > hkey[b] || (hkey[l]  === hkey[b] && heap[l]  < heap[b]))) b = l;
        if(rr <= hn && (hkey[rr] > hkey[b] || (hkey[rr] === hkey[b] && heap[rr] < heap[b]))) b = rr;
        if(b === c) break;
        t = heap[b]; heap[b] = heap[c]; heap[c] = t;
        t = hkey[b]; hkey[b] = hkey[c]; hkey[c] = t;
        t = hstamp[b]; hstamp[b] = hstamp[c]; hstamp[c] = t;
        c = b;
      }
      return { x: topX, st: topSt };
    }
    var libRes = briefLibCode(sizes, mul, r), libExact = !!(libRes && libRes.exact);
    var ballSize = 0; walk(0, 0, 0, function(){ ballSize++; });
    /* со взвешиванием стартовые оценки неизвестны — ставим заведомо большие и
       устаревшие (штамп −1), CELF пересчитает их при первом же взятии */
    if(!libExact) for(var x = 0; x < U; x++){ if(gw) push(1e9, x, -1); else push(ballSize, x, 0); }

    var gen = 0, t0 = Date.now(), cnt = 0;
    var counter = gw ? function(y){ if(!covered[y]) cnt += gw[y]; } : function(y){ if(!covered[y]) cnt++; };
    var marker = function(y){ if(!covered[y]){ covered[y] = 1; left--; } };
    while(left > 0 && !libExact){
      if((gen & 31) === 0 && Date.now() - t0 > budgetMs)
        return { slow: true, U: U, m: m, r: r, ms: Date.now() - t0 };
      var best = -1;
      for(;;){
        if(hn === 0) break;
        var top = pop();
        if(top.st === gen){ best = top.x; break; }
        cnt = 0; walk(top.x, 0, 0, counter);
        if(cnt === 0) continue;
        if(hn === 0 || cnt >= hkey[1]){ best = top.x; break; }
        push(cnt, top.x, gen);
      }
      if(best < 0) break;
      code.push(best);
      walk(best, 0, 0, marker);
      gen++;
    }
    if(libRes && (libExact || libRes.rows.length < code.length)) code = libRes.rows.slice().sort(function(a, b){ return a - b; });
    /* доля вероятности (при условии, что все исходы попали в купон), где лучшая строка
       берёт 15 и хотя бы 14 */
    var w15 = 0, w14 = 0;
    if(wt){
      var near = new Uint8Array(U);
      code.forEach(function(c){
        w15 += wt[c];
        if(!near[c]){ near[c] = 1; w14 += wt[c]; }
        for(var q = 0; q < m; q++){
          var base = Math.floor(c / mul[q]) % sizes[q];
          for(var val = 0; val < sizes[q]; val++){
            if(val === base) continue;
            var y = c + (val - base) * mul[q];
            if(!near[y]){ near[y] = 1; w14 += wt[y]; }
          }
        }
      });
    }
    var lines = [];
    for(i = 0; i < code.length; i++){
      dec(code[i]);
      var row = new Array(n), j;
      for(j = 0; j < fixed.length; j++) row[fixed[j]] = sets[fixed[j]][0];
      for(j = 0; j < m; j++) row[wide[j]] = sets[wide[j]][v[j]];
      lines.push(row);
    }
    return { lines: lines, U: U, rows: lines.length, m: m, r: r, ms: Date.now() - t0, w15: wt ? w15 : null, w14: wt ? w14 : null };
  }


  /* потолки: выше первого предупреждаем о долгом счёте, выше второго не беремся вовсе */
  var BRIEF_CAP_U = C.BRIEF_CAP_U, BRIEF_WARN_WORK = C.BRIEF_WARN_WORK, BRIEF_MAX_WORK = C.BRIEF_MAX_WORK;

  /* ---------- матожидание купона ---------- */
  /* Доли призового фонда по категориям (в процентах от оборота; в сумме 90,
     оставшиеся 10 идут в суперприз — это ровно та 1/9 от pool_sum, на которую
     суперприз и растёт из тиража в тираж, если его никто не берёт). */
  var EV_SHARE = C.EV_SHARE;
  var EV_JACK14 = C.EV_JACK14, EV_JACK15 = C.EV_JACK15;
  var EV_MINPOOL = C.EV_MINPOOL;

  /* Поправка к расчётному числу победителей (факт / модель), по фактическим выплатам
     13 тиражей: 4980, 4981, 4984, 4988, 4990, 4992, 4993, 4997, 5000, 5003, 5005, 5006, 5007.
     Выплата за строку обратно пропорциональна числу победителей, поэтому берётся среднее
     гармоническое по тиражам, а не отношение сумм — так честнее для матожидания.
     Разброс между тиражами большой: по 12+ от 0,53 (4992) до 1,65 (4993). Причина —
     крупные системы: если чья-то система на тысячи строк легла рядом с итогом, она одна
     забирает половину верхних категорий, и победителей в полтора раза больше модели.
     13 держится на единицах победителей (гармоническое 0,58, по суммам 0,87) — взято 0,70.
     14 выше единицы: большие системы ближе к верху, чем независимые строки.
     15 измерена отдельно и напрямую, не по выплатам: суперприз сбрасывается ровно в
     1 000 000, когда его берут, значит по каждому тиражу известен факт взятия. На 197
     подряд идущих парах тиражей 4810-5007 сбросов восемь, все внутри 170 тиражей с
     полными котировками. Модель при множителе 1 ждёт 7,70 тиражей со взятием, при 2,0 —
     14,02. Оценка максимального правдоподобия 1,05, интервал 0,48-1,95, так что прежняя
     двойка лежит за его краем (z = -1,88). Поставлено 1,05. */
  var FIX_BASE = C.FIX_BASE;

  function fixFactors(){ return FIX_BASE; }

  /* Метод Шина: снимает маржу точнее простой нормировки, потому что учитывает,
     что контора закладывает в коэффициенты защиту от осведомлённых игроков, и на
     фаворитах эта добавка не такая, как на аутсайдерах. Ищем параметр z бисекцией. */
  function shinProbs(raw){
    var S = raw[0] + raw[1] + raw[2];
    function fromZ(z){
      return raw.map(function(pi){
        var inner = z*z + 4*(1-z)*pi*pi/S;
        return (Math.sqrt(Math.max(0, inner)) - z) / (2*(1-z));
      });
    }
    var lo = 0, hi = 0.5;
    for(var i=0;i<50;i++){
      var mid = (lo + hi)/2;
      var p = fromZ(mid), sum = p[0] + p[1] + p[2];
      if(sum > 1) lo = mid; else hi = mid;
    }
    var out = fromZ((lo + hi)/2), t = out[0] + out[1] + out[2];
    if(!(t > 0) || !isFinite(t)) return null;
    return [out[0]/t, out[1]/t, out[2]/t];
  }

  /* Вероятности 1/X/2 по версии конторы: берём из коэффициентов и убираем маржу.
     Запасной путь — целые проценты «Б», они те же, но округлённые. */
  function evProbs(m){
    var raw = null, k;
    if(m.kf){
      raw = [];
      for(k=0;k<3;k++){
        var v = Number(m.kf[k]);
        if(!(isFinite(v) && v > 1)){ raw = null; break; }
        raw.push(1/v);
      }
    }
    if(!raw && m.pct && m.pct.bk){
      raw = [];
      for(k=0;k<3;k++){
        var b = Number(m.pct.bk[k]);
        if(!(isFinite(b) && b > 0)){ raw = null; break; }
        raw.push(b);
      }
    }
    if(!raw) return null;
    var s = raw[0] + raw[1] + raw[2];
    if(!(s > 0)) return null;
    /* маржу снимаем методом Шина; если он не сошёлся — обычной нормировкой */
    if(s > 1.0005){
      var sh = shinProbs(raw);
      if(sh) return sh;
    }
    return [raw[0]/s, raw[1]/s, raw[2]/s];
  }

  /* Доли пула игроков на каждый исход — по ним оцениваем, сколько будет соперников */
  function evPool(m){
    if(!(m.pct && m.pct.pool)) return null;
    var raw = [];
    for(var k=0;k<3;k++){
      var v = Number(m.pct.pool[k]);
      if(!isFinite(v)) return null;
      raw.push(Math.max(v, EV_MINPOOL));
    }
    var s = raw[0] + raw[1] + raw[2];
    return [raw[0]/s, raw[1]/s, raw[2]/s];
  }

  /* Пуассон-Биномиальное распределение: свёртка, dist[k] = P(ровно k угадано) */
  function poissonBinomial(ps){
    var dist = [1], i, j;
    for(i=0;i<ps.length;i++){
      var p = ps[i], next = [];
      for(j=0;j<=dist.length;j++) next[j] = 0;
      for(j=0;j<dist.length;j++){
        next[j]   += dist[j] * (1 - p);
        next[j+1] += dist[j] * p;
      }
      dist = next;
    }
    return dist;
  }

  function evTail(dist, from){
    var s = 0;
    for(var k=from;k<dist.length;k++) s += dist[k];
    return s;
  }

  /* Сколько стоит строка, угадавшая ровно k матчей.
     Разбор фактических выплат БалтБета показал: КАЖДАЯ категория делится между
     всеми, кто угадал не меньше её порога, а строка получает сумму по всем
     категориям от 9 до своего k. То есть «ровно 12» — это доля фонда, которую
     делят все с 12 и выше, а не только угадавшие ровно двенадцать. */
  function evPayouts(pDist, lines, fund, jack){
    var A = fund / 90;
    var alloc = {
      9: A * EV_SHARE.g9, 10: A * EV_SHARE.g10, 11: A * EV_SHARE.g11,
      12: A * EV_SHARE.e12, 13: A * EV_SHARE.e13,
      14: A * EV_SHARE.e14 + jack * EV_JACK14,
      15: A * EV_SHARE.e15 + jack * EV_JACK15
    };
    /* «+1» — это своя строка: она тоже делит приз */
    var fx = fixFactors();
    var n = {};
    for(var k = 9; k <= 15; k++) n[k] = lines * evTail(pDist, k) * fx[k] + 1;
    var pay = [];
    for(var m = 0; m <= 15; m++){
      var v = 0;
      for(var c = 9; c <= m; c++) v += alloc[c] / n[c];
      pay[m] = v;
    }
    return { pay: pay, n: n, alloc: alloc };
  }

  /* Матожидание одной строки: line — массив из 15 индексов выбранного исхода */
  function evOfLine(line, probs, pools, lines, fund, jack){
    var qs = [], ps = [], i;
    for(i=0;i<line.length;i++){ qs.push(probs[i][line[i]]); ps.push(pools[i][line[i]]); }
    var qDist = poissonBinomial(qs);
    var tbl = evPayouts(poissonBinomial(ps), lines, fund, jack);
    var ev = 0, rows = [];
    for(var k=9;k<=15;k++){
      var part = (qDist[k] || 0) * tbl.pay[k];
      ev += part;
      rows.push({ k:k, p:(qDist[k] || 0), pay:tbl.pay[k], part:part });
    }
    return { ev: ev, rows: rows, qDist: qDist, tbl: tbl };
  }

  /* Шанс КУПОНА, а не одной строки. Купон берёт k угаданных, если верный исход
     попал в отмеченные тобой ровно в k матчах: тогда среди строк системы найдётся
     та, что угадала все эти k. Поэтому в каждом матче складываем вероятности
     отмеченных исходов — и снова свёртка. Каждый доп поднимает слагаемое, а с ним
     и весь шанс: ради этого допы и ставят. */
  function evCouponDist(sets, probs){
    var qs = sets.map(function(sel, i){
      var s = 0;
      for(var j=0;j<sel.length;j++) s += probs[i][sel[j]];
      return Math.min(s, 1);
    });
    return poissonBinomial(qs);
  }

  /* Разбор текущего купона: собираем выбранные исходы по каждому матчу */
  function evCoupon(){
    var probs = [], pools = [], sets = [], combos = 1, bad = null;
    state.matches.forEach(function(m, idx){
      var pr = evProbs(m), pl = evPool(m);
      if(!pr || !pl){ bad = bad || ("нет данных по матчу «" + m.home + " — " + m.away + "»"); return; }
      var sel = [];
      for(var i=0;i<3;i++) if(m.picks[OUT[i]]) sel.push(i);
      if(!sel.length){ bad = bad || ("в матче «" + m.home + " — " + m.away + "» не выбран исход"); return; }
      probs.push(pr); pools.push(pl); sets.push(sel); combos *= sel.length;
    });
    if(bad) return { error: bad };
    if(probs.length !== 15) return { error: "в тираже не 15 матчей с данными" };
    return { probs: probs, pools: pools, sets: sets, combos: combos };
  }

  function evBest(probs, sets, pools, byPool){
    var line = [];
    for(var i=0;i<probs.length;i++){
      var pick = sets ? sets[i][0] : 0, best = -1;
      var src = byPool ? pools[i] : probs[i];
      var pool = sets ? sets[i] : [0,1,2];
      for(var j=0;j<pool.length;j++){
        if(src[pool[j]] > best){ best = src[pool[j]]; pick = pool[j]; }
      }
      line.push(pick);
    }
    return line;
  }

  function evRandomLine(n){
    var line = [];
    for(var i=0;i<n;i++) line.push(Math.floor(Math.random()*3));
    return line;
  }

  /* Средний EV по всем строкам купона; при большом числе строк — по выборке */
  function evAverage(sets, probs, pools, lines, fund, jack, cap){
    var combos = 1, i;
    for(i=0;i<sets.length;i++) combos *= sets[i].length;
    var total = 0, anyTot = 0, used = 0, exact = combos <= cap;
    if(exact){
      var idx = sets.map(function(){ return 0; });
      while(true){
        var line = [];
        for(i=0;i<sets.length;i++) line.push(sets[i][idx[i]]);
        var one0 = evOfLine(line, probs, pools, lines, fund, jack);
        total += one0.ev; anyTot += evTail(one0.qDist, 9);
        used++;
        var pos = sets.length - 1;
        while(pos >= 0 && idx[pos] === sets[pos].length - 1){ idx[pos] = 0; pos--; }
        if(pos < 0) break;
        idx[pos]++;
      }
    } else {
      for(var s=0;s<cap;s++){
        var ln = [];
        for(i=0;i<sets.length;i++) ln.push(sets[i][Math.floor(Math.random()*sets[i].length)]);
        var one1 = evOfLine(ln, probs, pools, lines, fund, jack);
        total += one1.ev; anyTot += evTail(one1.qDist, 9);
        used++;
      }
    }
    return { avg: total / used, any: anyTot / used, exact: exact, used: used, combos: combos };
  }

  function evMoney(x){
    if(!isFinite(x)) return "—";
    return (Math.abs(x) >= 100 ? Math.round(x).toLocaleString("ru-RU") : x.toFixed(2)) + " ₽";
  }
  function evPct(x){
    if(x >= 0.01) return (x*100).toFixed(1) + "%";
    if(x >= 0.0001) return (x*100).toFixed(3) + "%";
    return (x*100).toExponential(1) + "%";
  }

  function showEV(){
    var c = evCoupon();
    var box = $("evBody");
    $("evTitle").textContent = "Оценка купона";
    if(c.error){
      box.innerHTML = '<p class="ev-warn">Посчитать не получилось: ' + c.error +
        '. Нужен загруженный тираж с процентами и коэффициентами и выбранный исход в каждом матче.</p>';
      $("evBack").hidden = false;
      return;
    }
    var price = Number(state.price) || 30;
    var poolNow = Number(state.poolSum) || 0;
    var typical = Number(state.poolTypical) || 0;
    /* приём ещё идёт — выплаты будут из ИТОГОВОГО фонда, а не из того, что собрано сейчас */
    var projected = (typical && poolNow < typical * 0.6);
    var fund = projected ? typical : poolNow;
    var jack  = Number(state.jackpot) || 0;
    if(!fund){
      box.innerHTML = '<p class="ev-warn">Не знаю размер призового фонда — нажми «Обновить тираж», он приезжает вместе с матчами.</p>';
      $("evBack").hidden = false;
      return;
    }
    /* фонд по категориям — это 90% оборота, значит строк продано оборот/цена */
    var lines = (fund / 0.9) / price;

    var mine = evAverage(c.sets, c.probs, c.pools, lines, fund, jack, 600);
    var one  = evOfLine(evBest(c.probs, c.sets, c.pools, false), c.probs, c.pools, lines, fund, jack);
    var favLine  = evBest(c.probs, null, c.pools, false);
    var mostLine = evBest(c.probs, null, c.pools, true);
    var fav  = evOfLine(favLine,  c.probs, c.pools, lines, fund, jack);
    var most = evOfLine(mostLine, c.probs, c.pools, lines, fund, jack);
    var rndSum = 0, rndAny = 0;
    for(var r=0;r<300;r++){
      var rr = evOfLine(evRandomLine(15), c.probs, c.pools, lines, fund, jack);
      rndSum += rr.ev; rndAny += evTail(rr.qDist, 9);
    }
    var rnd = rndSum / 300, rndA = rndAny / 300;

    var cDist = evCouponDist(c.sets, c.probs);
    var cAny  = evTail(cDist, 9);
    var total = mine.avg * mine.combos;
    var cost  = mine.combos * price;

    var verdictCls = total >= cost ? "ev-good" : "ev-bad";
    var verdict = total >= cost
      ? "больше, чем купон стоит — по этой модели он в плюсе"
      : "меньше, чем купон стоит — по этой модели он в минусе";

    var h = "";
    h += '<div class="ev-top ' + verdictCls + '">' +
         '<b>' + evMoney(total) + '</b>' +
         '<span>матожидание всего купона из ' + fmt(mine.combos) + ' строк(и) при цене ' + evMoney(cost) + ' — ' + verdict + '</span>' +
         '<span>шанс купона взять 9 угаданных и больше: <b class="ev-inline">' + evPct(cAny) + '</b>' +
         ' · 11 и больше: <b class="ev-inline">' + evPct(evTail(cDist, 11)) + '</b>' +
         ' · все 15: <b class="ev-inline">' + evPct(cDist[15] || 0) + '</b></span>' +
         '<span class="ev-fine">на одну строку: ' + evMoney(mine.avg) + ' при цене ' + fmt(price) +
         ' ₽, шанс строки ' + evPct(mine.any) + '</span></div>';

    h += '<p class="ev-sub">Тираж №' + state.tirazh + ': ' +
         (projected
           ? 'приём ещё идёт, сейчас собрано ' + evMoney(poolNow) + ', поэтому считаю по типичному итоговому фонду ' + evMoney(fund) +
             ' (медиана завершённых тиражей)'
           : 'призовой фонд ' + evMoney(fund)) +
         ', суперприз ' + evMoney(jack) + ', строк в тираже ожидается около ' + fmt(Math.round(lines)) + '. ' +
         'В купоне ' + fmt(mine.combos) + ' строк(и), посчитано ' +
         (mine.exact ? "все" : "по случайной выборке из " + fmt(mine.used)) + '.</p>';

    h += '<table class="ev-tab"><thead><tr><th>Угадано</th><th>Вероятность</th>' +
         '<th>Ждём победителей</th><th>Выплата на строку</th><th>Вклад в EV</th></tr></thead><tbody>';
    var nMap = one.tbl.n;
    one.rows.forEach(function(row){
      h += '<tr><td>' + row.k + '</td><td>' + evPct(row.p) + '</td><td>' +
           fmt(Math.round(nMap[row.k])) + '</td><td>' + evMoney(row.pay) + '</td><td>' +
           evMoney(row.part) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="ev-note">Вероятности в таблице — для самой вероятной строки твоего купона; ' +
         'числа победителей относятся ко всему тиражу. Шанс купона в шапке считается иначе: ' +
         'каждый доп повышает вероятность угадать матч, поэтому с допами он растёт, ' +
         'а матожидание одной строки — почти нет. Растёт сумма за весь купон.</p>';

    h += '<h3>С чем сравнить</h3>';
    h += '<table class="ev-tab ev-cmp"><thead><tr><th>Строка</th><th>EV</th><th>Шанс 9+</th></tr></thead><tbody>' +
         '<tr><td>Твой купон, в среднем</td><td><b>' + evMoney(mine.avg) + '</b></td><td>' + evPct(mine.any) + '</td></tr>' +
         '<tr><td>Все фавориты конторы</td><td>' + evMoney(fav.ev) + '</td><td>' + evPct(evTail(fav.qDist, 9)) + '</td></tr>' +
         '<tr><td>Везде выбор большинства</td><td>' + evMoney(most.ev) + '</td><td>' + evPct(evTail(most.qDist, 9)) + '</td></tr>' +
         '<tr><td>Случайная строка</td><td>' + evMoney(rnd) + '</td><td>' + evPct(rndA) + '</td></tr>' +
         '<tr><td>Цена строки</td><td>' + evMoney(price) + '</td><td>—</td></tr>' +
         '</tbody></table>';
    h += '<p class="ev-alarm">Обрати внимание на строку «случайная»: по этой модели она почти всегда выглядит выгоднее любого осмысленного купона. ' +
         'Это не находка, а прямая демонстрация её слабого места. Модель считает соперников в предположении, что игроки выбирают исходы независимо друг от друга, ' +
         'и поэтому резко переоценивает редкие комбинации: ей кажется, что приз делить будет не с кем. ' +
         'Высокий EV у непопулярного купона — артефакт расчёта, а не преимущество. Смотри на EV вместе с шансом 9+, а не отдельно.</p>';

    h += '<h3>На чём это держится</h3><ul class="ev-ass">' +
         '<li>Вероятность исхода берётся из коэффициента конторы, маржа снимается методом Шина — он точнее простой нормировки, потому что не размазывает надбавку поровну, а учитывает, что на аутсайдерах она больше. Ничего более точного в открытых данных нет.</li>' +
         '<li>Число соперников оценивается в предположении, что игроки выбирают исходы независимо друг от друга, а затем правится постоянным множителем, полученным из фактических выплат тиражей 4980, 4990, 5000 и 5006. Сверка с реальным тиражом показала, что независимость даёт слишком жирный правый хвост: настоящие купоны скоррелированы и проваливаются вместе. Поправка это частично лечит, но перекос в пользу редких комбинаций остаётся.</li>' +
         '<li>Суперприз в тираже 5007 накоплен за 16 тиражей и сравним со всем призовым фондом, поэтому слагаемые за 14 и 15 угаданных сильно тянут EV вверх — при том что их вероятность тысячные доли процента. Почти весь EV сидит в событиях, которые почти никогда не случаются.</li>' +
         '<li>Выплаты считаются от итогового призового фонда: пока приём идёт, вместо собранной на сейчас суммы берётся медиана завершённых тиражей. А вот доли пула — снимок на момент «Обновить тираж», к закрытию они ещё сдвинутся, так что чем раньше считаешь, тем грубее оценка.</li>' +
         '<li>Структура призов: 40% фонда делят все с 9 угаданными и больше, 20% — все с 10 и больше, 10% — с 11 и больше, и по 5% на каждый порог 12, 13, 14, 15; за 14 добавляется 10% суперприза, за 15 — 90%. Строка получает сумму по всем порогам, до которых дотянулась. Проверено на фактических выплатах тиража 5006 до копейки. Невыигранные пороги 14 и 15 уходят в суперприз — тоже сверено, расхождение 3 ₽.</li>' +
         '</ul>';

    box.innerHTML = h;
    $("evBack").hidden = false;
  }


  /* ---------- отбор строк из системы ---------- */
  /* Задача не «найти самые прибыльные строки» — по EV наверх всегда лезут самые
     редкие комбинации, а это артефакт модели. Поэтому сначала отсекаем строки,
     у которых шанс угадать 9+ заметно ниже лучшего в системе, и только среди
     оставшихся ищем те, что меньше пересекаются с толпой и друг с другом. */
  var pfLast = [];
  var PF_VIABLE = C.PF_VIABLE;   /* доля от лучшего шанса 9+, ниже которой строку не рассматриваем */
  var PF_SCAN   = C.PF_SCAN;  /* сколько строк перебираем максимум */

  function evLines(sets, cap){
    var combos = 1, i;
    for(i=0;i<sets.length;i++) combos *= sets[i].length;
    var out = [];
    if(combos <= cap){
      var idx = sets.map(function(){ return 0; });
      while(true){
        var line = [];
        for(i=0;i<sets.length;i++) line.push(sets[i][idx[i]]);
        out.push(line);
        var pos = sets.length - 1;
        while(pos >= 0 && idx[pos] === sets[pos].length - 1){ idx[pos] = 0; pos--; }
        if(pos < 0) break;
        idx[pos]++;
      }
    } else {
      var seen = {};
      while(out.length < cap){
        var ln = [];
        for(i=0;i<sets.length;i++) ln.push(sets[i][Math.floor(Math.random()*sets[i].length)]);
        var key = ln.join("");
        if(seen[key]) continue;
        seen[key] = 1;
        out.push(ln);
      }
    }
    return { lines: out, combos: combos, full: combos <= cap };
  }

  function showPortfolio(){
    var c = evCoupon();
    var box = $("evBody");
    $("evTitle").textContent = "Отбор строк из системы";
    if(c.error){
      box.innerHTML = '<p class="ev-warn">Посчитать не получилось: ' + c.error + '.</p>';
      $("evBack").hidden = false;
      return;
    }
    var price = Number(state.price) || 30;
    var poolNow = Number(state.poolSum) || 0;
    var typical = Number(state.poolTypical) || 0;
    var projected = (typical && poolNow < typical * 0.6);
    var fund = projected ? typical : poolNow;
    var jack = Number(state.jackpot) || 0;
    if(!fund){
      box.innerHTML = '<p class="ev-warn">Не знаю размер призового фонда — нажми «Обновить тираж».</p>';
      $("evBack").hidden = false;
      return;
    }
    var lines = (fund / 0.9) / price;

    var gen = evLines(c.sets, PF_SCAN);
    if(gen.combos < 2){
      box.innerHTML = '<p class="ev-warn">В купоне одна строка — отбирать не из чего. ' +
        'Отметь в некоторых матчах по два-три исхода, тогда получится система.</p>';
      $("evBack").hidden = false;
      return;
    }

    var all = gen.lines.map(function(line){
      var r = evOfLine(line, c.probs, c.pools, lines, fund, jack);
      return { line: line, ev: r.ev, any: evTail(r.qDist, 9), q: r.qDist,
               comp: r.tbl.n[9], rows: r.rows };
    });

    var best = 0;
    all.forEach(function(x){ if(x.any > best) best = x.any; });
    var pool = all.filter(function(x){ return x.any >= best * PF_VIABLE; });
    if(!pool.length) pool = all;

    var limit = Math.min(30, pool.length);
    var occ = {}; for(var k=9;k<=15;k++) occ[k] = 0;
    var picked = [], rest = pool.slice();
    for(var step=0; step<limit; step++){
      var bi = -1, bv = -Infinity;
      for(var i=0;i<rest.length;i++){
        var v = 0;
        for(var j=0;j<rest[i].rows.length;j++){
          var row = rest[i].rows[j];
          v += row.part / (1 + occ[row.k]);
        }
        if(v > bv){ bv = v; bi = i; }
      }
      if(bi < 0) break;
      var ch = rest.splice(bi, 1)[0];
      ch.rows.forEach(function(row){ occ[row.k] += row.p; });
      ch.gain = bv;
      picked.push(ch);
    }

    var h = '';
    h += '<p class="ev-sub">В системе ' + fmt(gen.combos) + ' строк(и), ' +
         (gen.full ? 'перебрал все' : 'перебрал случайные ' + fmt(gen.lines.length)) + '. ' +
         'Отсеяно по шансу: осталось ' + fmt(pool.length) + ', из них отобрано ' + fmt(picked.length) + '. ' +
         'Фонд ' + evMoney(fund) + (projected ? ' (типичный итоговый, приём ещё идёт)' : '') +
         ', суперприз ' + evMoney(jack) + '.</p>';

    pfLast = picked;
    h += '<table class="ev-tab pf-tab"><thead><tr><th><input type="checkbox" id="pfAll" checked ' +
         'aria-label="Отметить все строки"></th><th>#</th><th>Строка</th><th>Шанс 9+</th>' +
         '<th>Соперников в 9+</th><th>EV</th></tr></thead><tbody>';
    picked.forEach(function(x, i){
      var txt = x.line.map(function(o){ return OUT[o]; }).join(" ");
      h += '<tr><td><input type="checkbox" class="pf-cb" data-i="' + i + '" checked ' +
           'aria-label="Строка ' + (i+1) + '"></td><td>' + (i+1) + '</td><td class="pf-line">' + txt +
           '</td><td>' + evPct(x.any) + '</td><td>' + fmt(Math.round(x.comp)) + '</td><td>' +
           evMoney(x.ev) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="pf-foot"><button class="btn-keep" id="pfSave" type="button">Положить отмеченные в корзину</button>' +
         '<span class="pf-note" id="pfNote"></span></div>';

    h += '<h3>Как отобрано</h3><ul class="ev-ass">' +
         '<li>Сначала отсев по жизнеспособности: строка проходит дальше, только если её шанс угадать 9 и больше не меньше ' +
         Math.round(PF_VIABLE*100) + '% от лучшего в системе. Без этого наверх списка лезут самые редкие комбинации — у них EV по модели огромный, но выиграть они не могут почти никогда.</li>' +
         '<li>Среди прошедших идёт жадный отбор: на каждом шаге берётся строка с наибольшим приростом, причём вклад в каждую категорию делится на то, сколько уже набрано этой категории отобранными строками. Так набор не сходится в один угол — строки получаются разные.</li>' +
         '<li>Колонка «соперников в 9+» — сколько игроков тиража, по оценке долей пула, попадут в ту же категорию. Чем меньше, тем меньше делить приз. Это та же оценка независимости, что и в матожидании, со всеми её оговорками.</li>' +
         '<li>Список — не рекомендация покупать именно эти строки, а способ увидеть, какие места системы меньше всего заняты толпой.</li>' +
         '</ul>';

    box.innerHTML = h;
    pfWire(price);
    $("evBack").hidden = false;
  }

  function pfChecked(){
    var out = [];
    [].forEach.call(document.querySelectorAll(".pf-cb"), function(b){
      if(b.checked) out.push(pfLast[Number(b.getAttribute("data-i"))]);
    });
    return out;
  }

  function pfCount(price){
    var n = pfChecked().length;
    var note = $("pfNote");
    if(note) note.textContent = n
      ? "отмечено " + fmt(n) + " строк(и) на " + fmt(n * price) + " ₽"
      : "ни одна строка не отмечена";
    var btn = $("pfSave");
    if(btn) btn.disabled = !n;
  }

  function pfWire(price){
    var all = $("pfAll");
    if(all) all.addEventListener("change", function(){
      [].forEach.call(document.querySelectorAll(".pf-cb"), function(b){ b.checked = all.checked; });
      pfCount(price);
    });
    [].forEach.call(document.querySelectorAll(".pf-cb"), function(b){
      b.addEventListener("change", function(){ pfCount(price); });
    });
    var save1 = $("pfSave");
    if(save1) save1.addEventListener("click", function(){ pfCommit(price); });
    pfCount(price);
  }

  /* Каждая отмеченная строка уходит в «Сыгранные варианты» отдельной записью:
     так она попадает и в выгрузку CSV наравне с брошенными вариантами. */
  function pfCommit(price){
    var chosen = pfChecked();
    if(!chosen.length) return;
    pushHistory("до записи отобранных строк");
    var stamp = new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
    var added = 0, dup = 0;
    var seen = {};
    state.played.forEach(function(v){ if(v.sig) seen[v.sig] = true; });
    chosen.forEach(function(x, i){
      var snap = state.matches.map(function(m, j){
        var pk = {"1":false, "X":false, "2":false};
        pk[OUT[x.line[j]]] = true;
        return { picks: pk, mode: "free", pool: (m.pool || OUT).slice() };
      });
      var sig = snap.map(function(r){
        return OUT.filter(function(o){ return r.picks[o]; }).join("") || "·";
      }).join(" ");
      if(seen[sig]){ dup++; return; }
      seen[sig] = true;
      state.rolls++;
      state.spent += price;
      state.played.unshift({
        at: stamp,
        label: "отбор " + (i + 1) + "/" + chosen.length,
        sig: sig,
        combos: 1,
        cost: price,
        snap: snap
      });
      added++;
    });
    if(state.played.length > BASKET_MAX) state.played.length = BASKET_MAX;
    save(); render();
    $("evBack").hidden = true;
    say("Положено в корзину: " + fmt(added) + " строк(и) на " + fmt(added * price) + " ₽" +
        (dup ? ", пропущено повторов: " + fmt(dup) : "") +
        ". Они уйдут в CSV наравне с брошенными вариантами; убрать лишние можно корзиной в списке, откатить всё — кнопкой «Назад».");
  }


  /* ---------- флаги стран ---------- */
  /* Страна — это часть строки чемпионата до первой точки: «Испания. Ла Лига».
     Картинки берём с flagcdn.com: эмодзи-флаги не рисуются в Windows, а тут
     одинаково везде. Не загрузилось — картинка просто прячется. */
  var FLAGS = {
    "англия":"gb-eng", "шотландия":"gb-sct", "уэльс":"gb-wls", "северная ирландия":"gb-nir",
    "ирландия":"ie", "испания":"es", "италия":"it", "германия":"de", "франция":"fr",
    "португалия":"pt", "нидерланды":"nl", "голландия":"nl", "бельгия":"be", "швейцария":"ch",
    "австрия":"at", "польша":"pl", "чехия":"cz", "словакия":"sk", "словения":"si",
    "венгрия":"hu", "хорватия":"hr", "сербия":"rs", "босния и герцеговина":"ba", "босния":"ba",
    "черногория":"me", "северная македония":"mk", "македония":"mk", "албания":"al",
    "греция":"gr", "болгария":"bg", "румыния":"ro", "молдова":"md", "украина":"ua",
    "беларусь":"by", "белоруссия":"by", "россия":"ru", "турция":"tr", "кипр":"cy",
    "мальта":"mt", "израиль":"il", "грузия":"ge", "армения":"am", "азербайджан":"az",
    "казахстан":"kz", "узбекистан":"uz", "швеция":"se", "норвегия":"no", "дания":"dk",
    "финляндия":"fi", "исландия":"is", "эстония":"ee", "латвия":"lv", "литва":"lt",
    "аргентина":"ar", "бразилия":"br", "чили":"cl", "уругвай":"uy", "парагвай":"py",
    "перу":"pe", "колумбия":"co", "эквадор":"ec", "боливия":"bo", "венесуэла":"ve",
    "мексика":"mx", "сша":"us", "канада":"ca", "коста-рика":"cr", "гондурас":"hn",
    "япония":"jp", "южная корея":"kr", "корея":"kr", "китай":"cn", "индия":"in",
    "индонезия":"id", "таиланд":"th", "вьетнам":"vn", "малайзия":"my", "сингапур":"sg",
    "австралия":"au", "новая зеландия":"nz", "египет":"eg", "марокко":"ma", "тунис":"tn",
    "алжир":"dz", "юар":"za", "нигерия":"ng", "гана":"gh", "саудовская аравия":"sa",
    "оаэ":"ae", "катар":"qa", "иран":"ir", "ирак":"iq", "иордания":"jo", "кувейт":"kw",
    "оман":"om", "бахрейн":"bh", "сирия":"sy", "ливан":"lb", "йемен":"ye", "палестина":"ps",
    "афганистан":"af", "пакистан":"pk", "бангладеш":"bd", "шри-ланка":"lk", "непал":"np",
    "мьянма":"mm", "камбоджа":"kh", "лаос":"la", "бутан":"bt", "мальдивы":"mv", "бруней":"bn",
    "монголия":"mn", "северная корея":"kp", "гонконг":"hk", "тайвань":"tw", "филиппины":"ph",
    "туркменистан":"tm", "таджикистан":"tj", "киргизия":"kg", "тимор-лесте":"tl",
    "кот-дивуар":"ci", "сенегал":"sn", "камерун":"cm", "мали":"ml", "буркина-фасо":"bf",
    "др конго":"cd", "конго":"cg", "замбия":"zm", "зимбабве":"zw", "кения":"ke", "уганда":"ug",
    "танзания":"tz", "эфиопия":"et", "ливия":"ly", "судан":"sd", "ангола":"ao", "мозамбик":"mz",
    "габон":"ga", "гвинея":"gn", "намибия":"na", "бенин":"bj", "того":"tg", "нигер":"ne",
    "чад":"td", "мавритания":"mr", "гамбия":"gm", "сьерра-леоне":"sl", "либерия":"lr",
    "кабо-верде":"cv", "ботсвана":"bw", "малави":"mw", "руанда":"rw", "бурунди":"bi",
    "эсватини":"sz", "лесото":"ls",
    "ямайка":"jm", "панама":"pa", "гватемала":"gt", "сальвадор":"sv", "никарагуа":"ni",
    "тринидад и тобаго":"tt", "гаити":"ht", "куба":"cu", "доминиканская республика":"do",
    "кюрасао":"cw", "белиз":"bz", "суринам":"sr", "гайана":"gy",
    "фиджи":"fj", "папуа-новая гвинея":"pg", "соломоновы острова":"sb", "вануату":"vu",
    "новая каледония":"nc", "таити":"pf"
  };

  /* Континентальные турниры: в шапке лиги стоит часть света, а не страна,
     и одного флага на матч мало — команды бывают из разных стран. Тогда флаг
     вешаем на каждую команду отдельно. Таблица собрана руками по участникам
     еврокубков и АФК; чего в ней нет — остаётся без флага, а имя уходит
     в консоль, чтобы таблицу пополнять. Частичного совпадения нет намеренно:
     лучше без флага, чем с чужим. */
  var CONTINENTS = {"европа":"eu","азия":null,"африка":null,"южная америка":null,
    "северная америка":null,"мир":null,"世界":null};
  var TEAMS = {
    "арсенал":"gb-eng","астон вилла":"gb-eng","ливерпуль":"gb-eng","манчестер сити":"gb-eng",
    "манчестер юнайтед":"gb-eng","челси":"gb-eng","тоттенхэм":"gb-eng","ньюкасл":"gb-eng",
    "вест хэм":"gb-eng","брайтон":"gb-eng","эвертон":"gb-eng","фулхэм":"gb-eng",
    "кристал пэлас":"gb-eng","ноттингем форест":"gb-eng","брентфорд":"gb-eng","борнмут":"gb-eng",
    "вулверхэмптон":"gb-eng","лестер":"gb-eng","лидс":"gb-eng","бернли":"gb-eng","сандерленд":"gb-eng",
    "селтик":"gb-sct","рейнджерс":"gb-sct","хартс":"gb-sct","хиберниан":"gb-sct","абердин":"gb-sct",
    "нью-сейнтс":"gb-wls","линфилд":"gb-nir","ларн":"gb-nir","гленторан":"gb-nir","колрейн":"gb-nir",
    "баллимена":"gb-nir","каррик рейнджерс":"gb-nir",
    "реал мадрид":"es","барселона":"es","атлетико мадрид":"es","севилья":"es","вильярреал":"es",
    "реал сосьедад":"es","атлетик бильбао":"es","бетис":"es","валенсия":"es","жирона":"es",
    "осасуна":"es","сельта":"es","райо вальекано":"es","эспаньол":"es","мальорка":"es",
    "хетафе":"es","алавес":"es","леванте":"es","эльче":"es","овьедо":"es","депортиво ла-корунья":"es",
    "ювентус":"it","милан":"it","интер":"it","наполи":"it","рома":"it","лацио":"it","аталанта":"it",
    "фиорентина":"it","болонья":"it","торино":"it","удинезе":"it","дженоа":"it","кальяри":"it",
    "верона":"it","комо":"it","парма":"it","лечче":"it","сассуоло":"it","пиза":"it","кремонезе":"it",
    "бавария":"de","боруссия дортмунд":"de","рб лейпциг":"de","байер":"de","байер леверкузен":"de",
    "айнтрахт":"de","штутгарт":"de","хоффенхайм":"de","вольфсбург":"de","фрайбург":"de",
    "вердер":"de","майнц":"de","аугсбург":"de","унион берлин":"de","боруссия менхенгладбах":"de",
    "гамбург":"de","санкт-паули":"de","кельн":"de","хайденхайм":"de",
    "псж":"fr","марсель":"fr","лион":"fr","монако":"fr","лилль":"fr","ницца":"fr","ланс":"fr",
    "ренн":"fr","страсбур":"fr","нант":"fr","тулуза":"fr","брест":"fr","осер":"fr","гавр":"fr",
    "анже":"fr","метц":"fr","лорьян":"fr","париж":"fr",
    "бенфика":"pt","порту":"pt","спортинг":"pt","брага":"pt","витория гимарайнш":"pt",
    "санта-клара":"pt","арока":"pt","риу аве":"pt","эштрела амадора":"pt","морейренсе":"pt",
    "маритиму":"pt","фамаликан":"pt","каса пия":"pt",
    "аякс":"nl","псв":"nl","фейеноорд":"nl","аз":"nl","твенте":"nl","утрехт":"nl",
    "гоу эхед иглз":"nl","херенвен":"nl",
    "андерлехт":"be","брюгге":"be","клуб брюгге":"be","генк":"be","гент":"be",
    "юнион сен-жилуаз":"be","антверпен":"be","стандард":"be","шарлеруа":"be",
    "зюльте-варегем":"be","кортрейк":"be","мехелен":"be",
    "ред булл зальцбург":"at","зальцбург":"at","штурм":"at","рапид вена":"at",
    "аустрия вена":"at","ласк":"at",
    "янг бойз":"ch","базель":"ch","цюрих":"ch","серветт":"ch","люцерн":"ch","лугано":"ch",
    "санкт-галлен":"ch",
    "славия прага":"cz","спарта прага":"cz","виктория пльзень":"cz","баник":"cz",
    "легия":"pl","ракув":"pl","лех познань":"pl","ягеллония":"pl","пяст гливице":"pl",
    "радомяк радом":"pl",
    "шахтер":"ua","динамо киев":"ua","заря":"ua","полесье":"ua",
    "галатасарай":"tr","фенербахче":"tr","бешикташ":"tr","трабзонспор":"tr","башакшехир":"tr",
    "самсунспор":"tr","касымпаша":"tr","генчлербирлиги":"tr",
    "олимпиакос":"gr","панатинаикос":"gr","паок":"gr","аек":"gr","арис":"gr",
    "динамо загреб":"hr","хайдук":"hr","риека":"hr",
    "црвена звезда":"rs","партизан":"rs",
    "копенгаген":"dk","мидтьюлланн":"dk","брондбю":"dk","норшелланн":"dk",
    "мальме":"se","хеккен":"se","юргорден":"se","эльфсборг":"se","броммапойкарна":"se",
    "браге":"se","сандвикенс":"se",
    "буде-глимт":"no","мольде":"no","русенборг":"no","бранн":"no",
    "маккаби тель-авив":"il","маккаби хайфа":"il","хапоэль беэр-шева":"il",
    "омония":"cy","апоэл":"cy","пафос":"cy",
    "фкса":"ro","университатя клуж":"ro","чфр клуж":"ro",
    "лудогорец":"bg","левски":"bg","цска софия":"bg",
    "ференцварош":"hu","пакш":"hu","слован братислава":"sk",
    "марибор":"si","целе":"si","олимпия":"si",
    "карабах":"az","нефтчи":"az","астана":"kz","кайрат":"kz","ноа":"am","арарат":"am",
    "динамо тбилиси":"ge","брейдаблик":"is","викингур":"is","хик":"fi","купс":"fi",
    "шемрок роверс":"ie","дандолк":"ie","дерри сити":"ie","шелбурн":"ie","слайго роверс":"ie",
    "гэлуэй юнайтед":"ie","уотерфорд":"ie","сент-патрикс":"ie",
    "шериф":"md","рига":"lv","жальгирис":"lt","левадия":"ee","флора":"ee",
    "зенит":"ru","спартак":"ru","цска":"ru","локомотив":"ru","краснодар":"ru","динамо москва":"ru",
    "рубин":"ru","родина":"ru","торпедо":"ru","ахмат":"ru","ростов":"ru","крылья советов":"ru",
    "нижний новгород":"ru","балтика":"ru","сочи":"ru","оренбург":"ru","акрон":"ru","пари нн":"ru",
    "эстеглаль":"ir","персеполис":"ir","сепахан":"ir","трактор":"ir",
    "аль садд":"qa","аль райян":"qa","аль духаиль":"qa","аль гарафа":"qa",
    "аль хиляль":"sa","аль наср":"sa","аль иттихад":"sa","аль шабаб":"sa",
    "аль айн":"ae","аль вахда":"ae","аль джазира":"ae","шабаб аль ахли":"ae",
    "насаф":"uz","пахтакор":"uz","аль шорта":"iq",
    "аль ахли каир":"eg","замалек":"eg","пирамидс":"eg","серамека":"eg","нацбанк":"eg"
  };

  /* приводим имя к ключу: регистр, ё, кавычки и служебное «ФК» в сторону */
  function teamCode(name){
    var k = String(name || "").toLowerCase().replace(/ё/g, "е")
      .replace(/[«»"'`]/g, " ").replace(/(^|\s)фк\.?(?=\s|$)/g, " ")
      .replace(/\s+/g, " ").trim();
    /* сборные в межгосударственных турнирах называются именем страны —
       те же ключи, что и в FLAGS для внутренних чемпионатов */
    return TEAMS[k] || FLAGS[k] || null;
  }

  /* лига вида «Европа. Лига Европы УЕФА» — часть света вместо страны */
  /* турнир сборных: у них флаг, а не эмблема из ленты (там вместо эмблемы — логотип федерации) */
  function isNatLeague(league){
    return /лига наций|чемпионат мира|чемпионат европы|кубок африки|кубок азии|кубок америки|золотой кубок|отбор|сборн|товарищеск.*(сборн|национ)/i.test(String(league || ""));
  }
  function continentCode(league){
    var head = String(league || "").split(".")[0].toLowerCase()
      .replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    return Object.prototype.hasOwnProperty.call(CONTINENTS, head)
      ? { hit: true, flag: CONTINENTS[head] } : { hit: false, flag: null };
  }

  function mkFlag(code, cls, title){
    var img = document.createElement("img");
    img.className = cls || "flag";
    img.src = "https://flagcdn.com/w40/" + code + ".png";
    img.alt = ""; img.loading = "lazy";
    if(title) img.title = title;
    img.onerror = function(){ this.remove(); };
    return img;
  }

  /* ---------- эмблемы и цвета клубов ----------
     data/api/teams.json: { "ключ имени": {id, c:[цвет1, цвет2]} }, картинки — icons/teams/<id>.webp.
     Собираются вне сайта (API-Football), ключ в браузер не попадает. */
  var TEAMDB = {}, teamDbAt = 0;
  function teamKey(name){
    return String(name || "").toLowerCase().replace(/ё/g, "е")
      .replace(/[«»"'`]/g, " ").replace(/(^|\s)фк\.?(?=\s|$)/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function teamInfo(name){ return TEAMDB[teamKey(name)] || null; }
  /* картинка эмблемы: своя база (icons/teams), иначе — эмблема из ленты Flashscore,
     которую сайт уже читает для времени матчей. У сборных вместо эмблемы — флаг */
  var FS_LOGO_HOST = "https://static.flashscore.com/res/image/data/";
  function embSrc(name, nat){
    var t = teamInfo(name);
    if(t && t.id) return "icons/teams/" + t.id + ".webp";
    if(t && t.f) return "icons/teams/fs/" + t.f;
    if(nat) return null;
    var f = (state.fsLogo || {})[teamKey(name)];
    return f && /^[\w-]+\.png$/.test(f) ? FS_LOGO_HOST + f : null;
  }
  function loadTeamDb(){
    if(typeof fetch !== "function" || (teamDbAt && Date.now() - teamDbAt < 3600000)) return;
    teamDbAt = Date.now();
    fetch(MIRROR + "teams.json?t=" + Math.floor(Date.now() / 3600000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && typeof j === "object"){ TEAMDB = j; render(); } attachFsLogos(); })
      .catch(function(){});
  }
  function mkEmb(name, nat){
    var src = embSrc(name, nat); if(!src) return null;
    var img = document.createElement("img");
    img.className = "temb"; img.src = src;
    img.width = 18; img.height = 18; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    img.onerror = function(){ this.remove(); };
    return img;
  }


  function flagCode(league){
    var head = String(league || "").split(".")[0];
    head = head.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    return FLAGS[head] || null;
  }

  /* Насколько доля лидера должна опережать ближайший исход, чтобы он получил
     стрелку ▲. Четыре пункта отсекают матчи вроде 36/27/37, где большинства
     по сути нет. Настройку из интерфейса убрали — менять здесь. */
  var PCT_GAP = C.PCT_GAP;

  /* ---------- история тиражей для разбора матчей ----------
     data/api/history.json собирает зеркало (GitHub Actions): все завершённые тиражи
     с линией конторы, долями пула и итогом. Отсюда — история команды по клику на название. */
  var hist = { ev: [], at: 0, loading: false, count: 0 };
  function loadHist(){
    if(hist.loading || typeof fetch !== "function") return;
    if(hist.at && Date.now() - hist.at < 6 * 3600 * 1000) return;
    hist.loading = true;
    fetch("data/api/history.json?t=" + Math.floor(Date.now() / 3600000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j || !j.draws) return;
        var ev = [];
        Object.keys(j.draws).forEach(function(n){
          var d = j.draws[n];
          (d.ev || []).forEach(function(e){
            ev.push({ n: Number(n), at: d.ended_at || "", home: e[0], away: e[1], ch: e[2] || "",
                      bk: (e[3] != null && e[4] != null && e[5] != null) ? [Number(e[3]), Number(e[4]), Number(e[5])] : null,
                      pool: (e[6] != null) ? [Number(e[6]), Number(e[7]), Number(e[8])] : null,
                      res: e[9] || "", score: e[10] || "" });
          });
        });
        ev.sort(function(a, b){ return b.n - a.n; });
        hist.ev = ev; hist.count = Object.keys(j.draws).length; hist.at = Date.now();
        if(!book) render();
      })
      .catch(function(){})
      .then(function(){ hist.loading = false; });
  }

  function normTeam(x){ return String(x || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, ""); }
  function fmtDay(iso){
    var ms = mskIso(iso); if(ms === null) return "";
    var d = new Date(ms + 3 * 3600000), p = function(x){ return (x < 10 ? "0" : "") + x; };
    return p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1);
  }
  /* история команды в Балтсистеме: последние появления, линия, пул, итог */
  /* общий рендер одной таблицы очных/личных встреч — переиспользуется и для H2H, и для истории команды */
  function h2hTable(rows, meKey, meName){
    var h = '<table class="ev-tab th-tab"><tr><th>Тираж</th><th>Дата</th><th style="text-align:left">Матч</th><th>Линия БК</th><th>Пул</th><th>Итог</th><th>Счёт</th></tr>';
    rows.forEach(function(r){
      var e = r.e, mine = r.home ? "1" : "2";
      var cls = (!e.res || e.res === "X") ? "" : (e.res === mine ? " w" : " l");
      var opp = r.home ? e.away : e.home;
      h += '<tr><td class="nw">' + e.n + '</td><td class="nw">' + fmtDay(e.at) + '</td>' +
        '<td class="tm-me" style="text-align:left">' + escHtml(r.home ? meName : opp) + ' — ' + escHtml(r.home ? opp : meName) +
        '<span class="side">' + (r.home ? "дома" : "в гостях") + '</span></td>' +
        '<td class="nw">' + (e.bk ? e.bk.join(" / ") : "—") + '</td>' +
        '<td class="nw">' + (e.pool ? e.pool.join(" / ") : "—") + '</td>' +
        (e.res ? '<td class="nw th-res' + cls + '">' + escHtml(e.res) + '</td>' +
                 '<td class="nw">' + escHtml(String(e.score || "").replace(/\s+/g, "")) + '</td></tr>'
               : '<td class="nw th-void" colspan="2" title="матч отменён, засчитан всем">отменён</td></tr>');
    });
    return h + '</table>';
  }
  /* калибровка линии конторы по всей накопленной истории: бакеты по 5 п.п.
     фаворит = исход с максимальным bk%; разрыв для ничьей = топ-1 минус топ-2 доли конторы */
  function showTeam(name, opp){
    var key = normTeam(name), rows = [], h2h = [];
    var oppKey = opp ? normTeam(opp) : null;
    hist.ev.forEach(function(e){
      var isH = normTeam(e.home) === key, isA = normTeam(e.away) === key;
      if(isH || isA) rows.push({ e: e, home: isH });
      if(oppKey && isH && normTeam(e.away) === oppKey) h2h.push({ e: e, home: true });
      if(oppKey && isA && normTeam(e.home) === oppKey) h2h.push({ e: e, home: false });
    });
    $("evTitle").textContent = name + " в Балтсистеме";
    var box = $("evBody");
    if(!hist.ev.length){
      box.innerHTML = '<p class="ev-warn">История тиражей ещё не загрузилась — попробуй через минуту.</p>';
      $("evBack").hidden = false; return;
    }
    /* очные встречи — своим блоком сверху, независимо от того, нашлась ли история самой команды */
    var h2hBlock = "";
    if(opp){
      if(h2h.length){
        var hw = 0, hd = 0, hl = 0;
        h2h.forEach(function(r){ var mine = r.home ? "1" : "2"; if(!r.e.res) return; if(r.e.res === "X") hd++; else if(r.e.res === mine) hw++; else hl++; });
        h2hBlock = '<h3 class="th-h2">Очные встречи с ' + escHtml(opp) + '</h3>' +
          '<div class="th-sum"><span>всего <b>' + h2h.length + '</b></span>' +
          '<span>' + escHtml(name) + ': В <b>' + hw + '</b> · Н <b>' + hd + '</b> · П <b>' + hl + '</b></span></div>' +
          h2hTable(h2h, key, name) +
          '<p class="ev-note">В личных встречах учтены оба порядка (дома и в гостях).</p><hr class="th-hr">';
      } else {
        h2hBlock = '<h3 class="th-h2">Очные встречи с ' + escHtml(opp) + '</h3>' +
          '<p class="ev-warn">В истории (' + hist.count + ' тиражей) эти команды между собой не встречались.</p><hr class="th-hr">';
      }
    }
    if(!rows.length){
      box.innerHTML = h2hBlock + '<p class="ev-warn">В истории (' + hist.count + ' тиражей) эта команда не встречалась.</p>';
      $("evBack").hidden = false; return;
    }
    var w = 0, d = 0, l = 0, favN = 0, favHit = 0;
    rows.forEach(function(r){
      var e = r.e, mine = r.home ? "1" : "2";
      if(!e.res) return;                      /* отменённый матч не считаем ни победой, ни поражением */
      if(e.res === "X") d++; else if(e.res === mine) w++; else l++;
      if(e.bk){
        var f = 0; if(e.bk[1] > e.bk[f]) f = 1; if(e.bk[2] > e.bk[f]) f = 2;
        if(OUT[f] === mine){ favN++; if(e.res === mine) favHit++; }
      }
    });
    var h = '<div class="th-sum"><span>появлений <b>' + rows.length + '</b></span>' +
      '<span>В <b>' + w + '</b> · Н <b>' + d + '</b> · П <b>' + l + '</b></span>' +
      (favN ? '<span>фаворитом конторы <b>' + favN + '</b>, прошла <b>' + favHit + '</b></span>' : '') + '</div>';
    h += h2hTable(rows.slice(0, 12), key, name);
    if(rows.length > 12) h += '<p class="ev-note">Показаны последние 12 из ' + rows.length + '.</p>';
    h += '<p class="ev-note">Линия и пул — доли в процентах 1 / X / 2 на момент закрытия тиража. История: ' + hist.count + ' тиражей.</p>';
    box.innerHTML = h2hBlock + h;
    $("evBack").hidden = false;
  }

  /* ---------- render ---------- */
  var rowsEl = $("rows");

  /* лупа: страница хозяев на flashscore.ru. Команду ищем тем же API, что и сам Flashscore
     (project 46 = flashscore.ru, lang 12 = русские названия). Молодёжки и дубли отсеиваем,
     женские — только если сам матч не женский (тогда наоборот ищем среди них), при нескольких
     тёзках берём страну турнира, а среди тёзок той же страны — только похожих по названию.
     Не нашли похожую команду или страна турнира не совпала ни у кого — обычный поиск, а не
     первая попавшаяся команда: лучше не найти, чем перепутать (было — уводило не туда). */
  /* хоккей в тираже определяем по названию лиги — от этого зависит, каким sport-id
     запрашивать фид Flashscore (см. FS_SPORT_ID ниже) */
  var FS_NONFOOTBALL = /КХЛ|НХЛ|ВХЛ|МХЛ|хокке|hockey|\b(?:NHL|KHL|AHL|VHL|MHL|SHL)\b/i;
  /* континент/регион (еврокубки, «Мир. ЧМ» и т.п.) — это не страна, у клуба такой
     defaultCountry не бывает; если считать это страной, фильтр по стране отбраковывает
     даже точное совпадение (так ловился «Интер Милан(ж) — Хеккен(ж)», Лига Чемпионов) */
  var FS_NOT_COUNTRY = /^(европа|азия|африка|америка|океания|мир|северная америка|южная америка|центральная америка)$/i;
  function fsCountry(league){
    var m = /^([^.]+)\./.exec(String(league || ""));
    var c = m ? m[1].trim() : "";
    return FS_NOT_COUNTRY.test(c) ? "" : c;
  }
  /* «(ж)» в конце названия — это БалтБет помечает женский матч прямо в имени команды; для
     поиска это лишний шум (Flashscore такую строку не найдёт), а по каким командам смотреть —
     полезный сигнал (см. isWomen ниже) */
  function fsClean(name){ return String(name || "").replace(/\s*\((?:ж|мол)\)\s*$/i, "").trim(); }
  function fsIsWomen(name){ return /\(ж\)\s*$/i.test(String(name || "")); }
  /* слова, которые слишком часто встречаются в чужих названиях, чтобы засчитывать их как
     совпадение (иначе «Ротерем Юнайтед» пройдёт по слову «Юнайтед» и получит «Манчестер Юнайтед») */
  var FS_GENERIC = { "фк":1, "ск":1, "сити":1, "таун":1, "юнайтед":1, "атлетик":1, "атлетико":1,
    "роверс":1, "депортиво":1, "реал":1, "интер":1, "олимпик":1, "спортинг":1, "насьональ":1,
    "юниор":1, "юнион":1, "динамо":1, "спартак":1, "локомотив":1, "рейнджерс":1 };
  function fsWords(name){
    return String(name || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter(function(w){ return w.length >= 3; });
  }
  function fsCoreWords(name){
    var w = fsWords(name).filter(function(x){ return !FS_GENERIC[x]; });
    return w.length ? w : fsWords(name);
  }
  /* редакционное расстояние — короткие строки, точность не критична */
  function fsDist(a, b){
    var m = a.length, n = b.length, i, j, d = [];
    for(i = 0; i <= m; i++) d[i] = [i];
    for(j = 0; j <= n; j++) d[0][j] = j;
    for(i = 1; i <= m; i++)
      for(j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a.charAt(i-1) === b.charAt(j-1) ? 0 : 1));
    return d[m][n];
  }
  /* FS_STRICT — первый проход: только точное слово или вхождение. Нечёткое сравнение —
     потом и строже прежнего, иначе «Испания» находила «Италию», «Словения» — «Словакию» */
  var FS_STRICT = false;
  function fsWordSimilar(a, b){
    if(a === b) return true;
    if(a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return Math.min(a.length, b.length) >= 4 || !FS_STRICT;
    if(FS_STRICT) return false;
    return fsDist(a, b) <= Math.ceil(Math.max(a.length, b.length) * 0.25);
  }
  /* молодёжь (U21, «(21)»), дубль («Б», «(Б)», II) — у обеих сторон должно совпадать */
  function fsTag(name){
    var n = String(name || "").toLowerCase(), t = "";
    var y = n.match(/\bu\s?(\d\d)\b|\((\d\d)\)|до\s?(\d\d)/);
    if(y) t += "y" + (y[1] || y[2] || y[3]);
    if(/\((?:б|b)\)|\s(?:б|b|ii)\s*$|\s(?:б|b|ii)\s*\(/.test(n)) t += "r";
    return t;
  }
  /* каждое «важное» слово запроса должно найтись (точно или почти) среди слов кандидата —
     иначе это просто другой клуб с одним общим словом в названии. У части команд (как
     Эрзурумспор) на Flashscore само название в базе латиницей — сверяем и так, и так */
  function fsMatches(coreWords, candidateName){
    var hay = fsWords(candidateName);
    for(var i = 0; i < coreWords.length; i++){
      var w = coreWords[i], wLat = translit(w).toLowerCase();
      var ok = false;
      for(var j = 0; j < hay.length; j++){
        if(fsWordSimilar(w, hay[j]) || (wLat !== w && fsWordSimilar(wLat, hay[j]))){ ok = true; break; }
      }
      if(!ok) return false;
    }
    return true;
  }
  /* латиница для второй попытки: totobrief пишет «Элверсберг», Flashscore — «Эльферсберг»,
     а по-английски Elversberg находят оба */
  var TRANSLIT = { "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k",
    "л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch",
    "ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya" };
  function translit(x){
    return String(x || "").replace(/[А-Яа-яЁё]/g, function(c){
      var lo = c.toLowerCase(), t = TRANSLIT[lo] == null ? c : TRANSLIT[lo];
      return (c === lo) ? t : (t.charAt(0).toUpperCase() + t.slice(1));
    });
  }
  /* --- поиск матча по дате+виду спорта (замена поиску команды по имени) ---
     Раньше искали КАЖДУЮ команду по названию через поиск Flashscore — это не работало,
     когда имя в тираже не похоже на имя на Flashscore («Автомобилист» → «yekaterinburg»,
     «Атлетико Кали» → «atletico-f-c») и не работало для хоккея вовсе (тот поиск заточен
     под футбол). День тиража всегда сегодня или завтра — поэтому вместо поиска по имени
     берём ВЕСЬ список матчей нужного спорта на эти два дня одним фидом (~100-200 записей)
     и ищем среди них пару команд напрямую. Формат фида — родной Flashscore: записи через
     «¬~», поля внутри через «¬» и «КОД÷значение»; перед каждой группой матчей идёт запись
     без AA (id матча) — это заголовок страны/турнира (ZY — страна, ZA — «страна: турнир») */
  /* фид Flashscore запрашивается не напрямую (46.flashscore.ninja блокирует CORS с чужих
     доменов — сайту сторонний x-fsign-запрос не проходит), а через собственный прокси
     на Cloudflare Workers, который делает этот запрос на сервере и отдаёт готовый фид сайту */
  var FS_FEED_HOST = C.FS_FEED_HOST;
  var FS_SPORT_ID = C.FS_SPORT_ID;
  var FS_DAY_CACHE = {};
  function fsFeedSport(league){ return FS_NONFOOTBALL.test(league || "") ? "hockey" : "football"; }
  function fsParseFeed(text){
    var groups = [], cur = null;
    if(!text) return groups;
    var recs = text.split("¬~");
    for(var i = 0; i < recs.length; i++){
      var parts = recs[i].split("¬"), obj = {};
      for(var j = 0; j < parts.length; j++){
        var kv = parts[j].split("÷");
        if(kv.length === 2) obj[kv[0]] = kv[1];
      }
      if(!obj.AA){
        if(obj.ZY || obj.ZA){ cur = { country: obj.ZY || "", league: obj.ZA || "", matches: [] }; groups.push(cur); }
      } else if(cur && obj.AE && obj.AF && obj.WU && obj.WV && obj.PX && obj.PY){
        cur.matches.push({ id: obj.AA, home: obj.AE, away: obj.AF, hSlug: obj.WU, aSlug: obj.WV, hId: obj.PX, aId: obj.PY, hLogo: obj.OA || "", aLogo: obj.OB || "", hs: obj.AG, as: obj.AH, ao: obj.AO, bx: obj.BX, ts: obj.AD || obj.ADE || null, st: obj.AB || "", sc: obj.AC || "" });
      }
    }
    return groups;
  }
  /* фид на день+спорт кэшируем — за один тираж кнопку FS жмут по многу раз подряд для
     одного и того же спорта, незачем качать заново */
  var FS_DAY_AT = {};
  function fsLoadDay(sportKey, day, maxAgeMs){
    var key = sportKey + "|" + day;
    if(FS_DAY_CACHE[key] && maxAgeMs && Date.now() - (FS_DAY_AT[key] || 0) > maxAgeMs) delete FS_DAY_CACHE[key];
    if(FS_DAY_CACHE[key]) return FS_DAY_CACHE[key];
    FS_DAY_AT[key] = Date.now();
    var url = FS_FEED_HOST + FS_SPORT_ID[sportKey] + "&day=" + day;
    /* Worker может не открываться (workers.dev без VPN): ждём недолго и не запоминаем неудачу */
    if(Date.now() - fsWorkerDown < 5 * 60000) return Promise.resolve([]);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var tm = ctl ? setTimeout(function(){ ctl.abort(); }, 6000) : null;
    FS_DAY_CACHE[key] = fetch(url, ctl ? { signal: ctl.signal } : undefined)
      .then(function(r){ if(tm) clearTimeout(tm); if(!r.ok) throw new Error("http"); return r.text(); })
      .then(fsParseFeed)
      .catch(function(){ if(tm) clearTimeout(tm); fsWorkerDown = Date.now(); delete FS_DAY_CACHE[key]; return []; });
    return FS_DAY_CACHE[key];
  }
  /* дневной фид хранит команду часто под коротким «фирменным» именем без города-уточнения
     («Торпедо Нижний Новгород» в тираже — просто «Торпедо» на Flashscore), поэтому сверяем
     обе стороны: и что все слова запроса нашлись у кандидата, и наоборот — что все слова
     (более короткого) кандидата нашлись в запросе */
  /* клубы, которые на Flashscore называются совсем иначе (переименование, аббревиатура) */
  var FS_ALIAS = { "телеком египет": ["WE SC", "Telecom Egypt"], "юк дублин": ["ЮКД", "UCD"], "юкд": ["ЮК Дублин"] };
  function fsNameOk(queryClean, queryCore, candidateName){
    if(fsTag(queryClean) !== fsTag(candidateName)) return false;
    var al = FS_ALIAS[String(queryClean || "").toLowerCase().replace(/ё/g, "е")];
    if(al && al.some(function(x){ return x.toLowerCase() === String(candidateName || "").toLowerCase(); })) return true;
    if(fsMatches(queryCore, candidateName)) return true;
    var candCore = fsCoreWords(candidateName);
    return !!(candCore.length && fsMatches(candCore, queryClean));
  }
  /* пара «дом/гости» у источника иногда переставлена относительно тиража — проверяем
     совпадение обеих команд и в прямом, и в обратном порядке. Женский матч — кандидат
     должен быть помечен «(Ж)» в имени или сама лига содержать «жен» (иначе можно
     случайно подставить мужской клуб с тем же именем) */
  function fsFindMatch(groups, homeName, awayName, isWomen){
    var hClean = fsClean(homeName), aClean = fsClean(awayName);
    var hCore = fsCoreWords(hClean), aCore = fsCoreWords(aClean);
    for(var i = 0; i < groups.length; i++){
      var g = groups[i], leagueW = /жен/i.test(g.league || "");
      for(var j = 0; j < g.matches.length; j++){
        var mm = g.matches[j];
        if(isWomen && !leagueW && !(/\(ж\)/i.test(mm.home) && /\(ж\)/i.test(mm.away))) continue;
        if(fsNameOk(hClean, hCore, mm.home) && fsNameOk(aClean, aCore, mm.away))
          return { h: { url: mm.hSlug, id: mm.hId, logo: mm.hLogo }, a: { url: mm.aSlug, id: mm.aId, logo: mm.aLogo }, mid: mm.id, ts: mm.ts, st: mm.st, sc: mm.sc, hs: mm.hs, as: mm.as, ao: mm.ao, bx: mm.bx };
        if(fsNameOk(hClean, hCore, mm.away) && fsNameOk(aClean, aCore, mm.home))
          return { h: { url: mm.aSlug, id: mm.aId, logo: mm.aLogo }, a: { url: mm.hSlug, id: mm.hId, logo: mm.hLogo }, mid: mm.id, ts: mm.ts, st: mm.st, sc: mm.sc, hs: mm.as, as: mm.hs, ao: mm.ao, bx: mm.bx };
      }
    }
    return null;
  }

  function fsLookup(m, all){
    var isWomen = fsIsWomen(m.home) || fsIsWomen(m.away);
    var country = fsCountry(m.league);
    var mine = country ? all.filter(function(g){ return g.country === country; }) : null;
    var found = null;
    /* сначала точные названия (страна, потом все), затем нечёткие, затем одна команда */
    [true, false].some(function(strict){
      FS_STRICT = strict;
      if(mine) found = fsFindMatch(mine, m.home, m.away, isWomen);
      if(!found) found = fsFindMatch(all, m.home, m.away, isWomen);
      return !!found;
    });
    FS_STRICT = true;
    if(!found && mine) found = fsFindOneSide(mine, m.home, m.away, isWomen);
    FS_STRICT = false;
    return found;
  }
  /* запасной путь: в турнирах нужной страны совпала только одна команда, а вторая на
     Flashscore записана по-другому. Берём, только если такой матч ровно один */
  function fsFindOneSide(groups, homeName, awayName, isWomen){
    var hClean = fsClean(homeName), aClean = fsClean(awayName);
    var hCore = fsCoreWords(hClean), aCore = fsCoreWords(aClean), hits = [];
    groups.forEach(function(g){
      var leagueW = /жен/i.test(g.league || "");
      g.matches.forEach(function(mm){
        if(isWomen && !leagueW && !(/\(ж\)/i.test(mm.home) && /\(ж\)/i.test(mm.away))) return;
        if(fsNameOk(hClean, hCore, mm.home) || fsNameOk(aClean, aCore, mm.away))
          hits.push({ h: { url: mm.hSlug, id: mm.hId, logo: fsNameOk(hClean, hCore, mm.home) ? mm.hLogo : "" }, a: { url: mm.aSlug, id: mm.aId, logo: fsNameOk(aClean, aCore, mm.away) ? mm.aLogo : "" }, mid: mm.id, ts: mm.ts, st: mm.st, sc: mm.sc });
      });
    });
    return hits.length === 1 ? hits[0] : null;
  }
  function fsFmtTime(ts){
    var n = Number(ts);
    if(!isFinite(n) || n <= 0) return "";
    var ms = n < 1e12 ? n * 1000 : n;
    try{
      var parts = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" }).formatToParts(new Date(ms));
      var hh = "", mi = "";
      parts.forEach(function(p){ if(p.type === "hour") hh = p.value; if(p.type === "minute") mi = p.value; });
      return (hh && mi) ? hh + ":" + mi : "";
    } catch(e){ return ""; }
  }
  /* эмблемы из ленты Flashscore для клубов, которых нет в своей базе: лента знает
     матчи на сегодня и завтра, поэтому остальные дозаполнятся при следующих заходах.
     Найденное запоминаем в браузере — эмблема остаётся и у прошлого тиража */
  var fsLogoBusy = false;
  function attachFsLogos(){
    if(fsLogoBusy || typeof fetch !== "function") return;
    if(!state.fsLogo || typeof state.fsLogo !== "object") state.fsLogo = {};
    var list = state.matches.slice();
    if(state.prev && Array.isArray(state.prev.matches)) list = list.concat(state.prev.matches);
    var need = list.filter(function(m){
      return [m.home, m.away].some(function(n){ return n && !teamInfo(n) && !state.fsLogo[teamKey(n)]; });
    });
    if(!need.length) return;
    var sports = {};
    need.forEach(function(m){ sports[fsFeedSport(m.league)] = true; });
    var keys = Object.keys(sports);
    fsLogoBusy = true;
    Promise.all(keys.map(function(k){ return Promise.all([fsLoadDay(k, 0), fsLoadDay(k, 1)]); })).then(function(rs){
      var by = {}, changed = false;
      keys.forEach(function(k, i){ by[k] = rs[i][0].concat(rs[i][1]); });
      need.forEach(function(m){
        var f = fsLookup(m, by[fsFeedSport(m.league)] || []);
        if(!f) return;
        [[m.home, f.h], [m.away, f.a]].forEach(function(p){
          var k = teamKey(p[0]);
          if(p[1] && p[1].logo && !teamInfo(p[0]) && state.fsLogo[k] !== p[1].logo){ state.fsLogo[k] = p[1].logo; changed = true; }
        });
      });
      var ks = Object.keys(state.fsLogo);
      if(ks.length > 400) ks.slice(0, ks.length - 400).forEach(function(k){ delete state.fsLogo[k]; });
      fsLogoBusy = false;
      if(changed){ save(); render(); }
    }).catch(function(){ fsLogoBusy = false; });
  }
  /* ---------- отладка просмотра ----------
     Включается адресом ?debug=1 (запоминается в браузере) или пятью быстрыми тапами по логотипу; ?debug=0 выключает.
     Пишет журнал: откуда пришёл счёт и принят ли он, ответы ленты и totobrief с задержкой, время перерисовок,
     долгие задачи (зависания) и ошибки. Панель — кнопка «отладка» внизу справа, журнал копируется одной кнопкой. */
  var DBG = { on: false, buf: [], max: 500, t0: Date.now(), feed: {}, api: {}, rn: 0, rsum: 0, rmax: 0, slow: 0, lt: 0, ltmax: 0, errs: 0, open: false, el: null };
  try{
    var dq = /[?&]debug=(\w+)/.exec(location.search || "");
    if(dq && dq[1] !== "0") localStorage.setItem("dz_dbg", "1");
    else if(dq) localStorage.removeItem("dz_dbg");
    DBG.on = localStorage.getItem("dz_dbg") === "1";
  }catch(e){}
  function dbgTag(m){ return fsClean(m.home || "") + " — " + fsClean(m.away || ""); }
  function dbgTime(t){
    var d = new Date(t), two = function(x){ return (x < 10 ? "0" : "") + x; };
    return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
  }
  function dbgLog(kind, msg){
    if(!DBG.on) return;
    DBG.buf.push({ t: Date.now(), k: kind, m: msg });
    if(DBG.buf.length > DBG.max) DBG.buf.splice(0, DBG.buf.length - DBG.max);
    if(DBG.open) dbgSoon();
  }
  var dbgPend = 0;
  function dbgSoon(){ if(dbgPend) return; dbgPend = setTimeout(function(){ dbgPend = 0; dbgPaint(); }, 400); }
  function dbgText(){
    var o = ["Журнал отладки ДЖЕК 15 · " + new Date().toISOString() + " · " + navigator.userAgent, dbgStatus().replace(/<[^>]+>/g, "").replace(/\s+/g, " ")];
    DBG.buf.forEach(function(x){ o.push(dbgTime(x.t) + " " + x.k + " " + x.m); });
    var p = state.prev && state.viewPrev ? state.prev : null;
    if(p) p.matches.forEach(function(m, i){ o.push("м" + (i + 1) + " " + dbgTag(m) + " | " + (m.score || "—") + " | res " + (m.res || "—") + " | src " + (SRC_NAME[m.scSrc] || "—") + " | gmax " + (m.gmax ? m.gmax.join(":") : "—") + " | fsAt " + (m.fsAt ? Math.round((Date.now() - m.fsAt) / 1000) + "с назад" : "—") + (m.fsMir ? " (снимок)" : "")); });
    return o.join("\n");
  }
  function dbgStatus(){
    var ago = function(t){ return t ? Math.round((Date.now() - t) / 1000) + " с" : "—"; };
    var w = fsWorkerDown && Date.now() - fsWorkerDown < 2 * 60000 ? "не отвечает " + ago(fsWorkerDown) + " назад, идём через снимок" : "ок";
    var fk = Object.keys(DBG.feed).map(function(k){ var f = DBG.feed[k]; return k + ": " + f.src + " " + f.ms + " мс" + (f.age != null ? ", снимку " + f.age + " с" : "") + ", " + ago(f.at) + " назад"; }).join("; ") || "ещё не опрашивали";
    var ak = Object.keys(DBG.api).map(function(k){ var f = DBG.api[k]; return k + " " + f.ms + " мс" + (f.err ? " ОШИБКА" : "") + ", " + ago(f.at) + " назад"; }).join("; ") || "—";
    return "<b>Лента (worker):</b> " + w + "<br><b>Последние опросы ленты:</b> " + fk + "<br><b>totobrief:</b> " + ak +
      "<br><b>Перерисовок:</b> " + DBG.rn + ", среднее " + (DBG.rn ? Math.round(DBG.rsum / DBG.rn) : 0) + " мс, максимум " + Math.round(DBG.rmax) + " мс, медленных (&gt;80 мс) " + DBG.slow +
      "<br><b>Зависаний (&gt;100 мс):</b> " + DBG.lt + (DBG.lt ? ", самое долгое " + Math.round(DBG.ltmax) + " мс" : "") + " · <b>ошибок:</b> " + DBG.errs;
  }
  function dbgPaint(){
    if(!DBG.el) return;
    var st = DBG.el.querySelector(".dbg-st"), lg = DBG.el.querySelector(".dbg-log"), mt = DBG.el.querySelector(".dbg-m");
    st.innerHTML = dbgStatus();
    var p = state.prev && state.viewPrev ? state.prev : null, h = "";
    if(p) p.matches.forEach(function(m, i){
      h += "<tr><td>" + (i + 1) + "</td><td>" + escHtml(fsClean(m.home)) + " — " + escHtml(fsClean(m.away)) + "</td><td><b>" + escHtml(m.score ? String(m.score).replace(/\s+/g, "") : "—") + "</b></td><td>" + (SRC_NAME[m.scSrc] || "—") + "</td><td>" + (m.res ? "итог" : (liveInfo(m) ? "идёт" : "")) + "</td></tr>";
    });
    mt.innerHTML = h ? "<table><thead><tr><th>#</th><th>Матч</th><th>Счёт</th><th>Откуда</th><th></th></tr></thead><tbody>" + h + "</tbody></table>" : "<p>Откройте просмотр прошлого тиража — здесь появятся его матчи.</p>";
    var out = "";
    for(var i = DBG.buf.length - 1; i >= 0 && i > DBG.buf.length - 160; i--){
      var x = DBG.buf[i];
      out += '<div class="dbg-l k-' + x.k + '"><i>' + dbgTime(x.t) + "</i> <b>" + x.k + "</b> " + escHtml(x.m) + "</div>";
    }
    lg.innerHTML = out || "<p>Журнал пуст.</p>";
  }
  function dbgUi(){
    if(!DBG.on || DBG.btn) return;
    var b = document.createElement("button");
    b.type = "button"; b.id = "dbgBtn"; b.textContent = "отладка"; DBG.btn = b;
    b.addEventListener("click", function(){
      if(!DBG.el){
        var el = document.createElement("div"); el.id = "dbgPanel";
        el.innerHTML = '<div class="dbg-h"><b>Отладка</b><span><button type="button" data-a="copy">Копировать</button><button type="button" data-a="clear">Очистить</button><button type="button" data-a="off">Выкл.</button><button type="button" data-a="x" aria-label="Закрыть">×</button></span></div>' +
          '<div class="dbg-body"><div class="dbg-st"></div><div class="dbg-m"></div><div class="dbg-log"></div></div>';
        document.body.appendChild(el); DBG.el = el;
        el.addEventListener("click", function(e){
          var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a"); if(!a) return;
          if(a === "x"){ DBG.open = false; el.hidden = true; }
          else if(a === "clear"){ DBG.buf = []; dbgPaint(); }
          else if(a === "off"){ try{ localStorage.removeItem("dz_dbg"); }catch(x){} location.search = location.search.replace(/[?&]debug=\w+/, "").replace(/^&/, "?"); }
          else if(a === "copy"){
            var t = dbgText(), done = function(){ e.target.textContent = "Скопировано"; setTimeout(function(){ e.target.textContent = "Копировать"; }, 1500); };
            if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function(){ dbgFallback(t); done(); });
            else { dbgFallback(t); done(); }
          }
        });
      }
      DBG.open = !DBG.open; DBG.el.hidden = !DBG.open; if(DBG.open) dbgPaint();
    });
    document.body.appendChild(b);
    window.__dbg = DBG; DBG.hook = { noteScore: noteScore, state: state, render: render, renderSoon: renderSoon, SRC: { TB: SRC_TB, MIR: SRC_MIR, FEED: SRC_FEED } };
    if(window.PerformanceObserver){
      try{
        new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ DBG.lt++; if(e.duration > DBG.ltmax) DBG.ltmax = e.duration; dbgLog("долго", Math.round(e.duration) + " мс без реакции страницы"); }); }).observe({ entryTypes: ["longtask"] });
      }catch(e){}
    }
    window.addEventListener("error", function(e){ DBG.errs++; dbgLog("err", (e.message || "ошибка") + " @" + (e.lineno || "")); });
    window.addEventListener("unhandledrejection", function(e){ DBG.errs++; dbgLog("err", "promise: " + (e.reason && e.reason.message || e.reason)); });
    document.addEventListener("visibilitychange", function(){ dbgLog("вкладка", document.hidden ? "ушла в фон" : "снова на экране"); });
    dbgLog("старт", "отладка включена · v " + ((document.querySelector('script[src*="app.js"]') || {}).src || "").replace(/^.*\?/, ""));
  }
  function dbgFallback(t){
    var ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;left:-999px;top:0"; document.body.appendChild(ta);
    ta.select(); try{ document.execCommand("copy"); }catch(e){} ta.remove();
  }
  /* пять быстрых тапов по логотипу включают отладку (для телефона, где нет адресной строки) */
  (function(){
    var taps = [];
    document.addEventListener("click", function(e){
      var lg = e.target && e.target.closest && e.target.closest("svg.logo, .logo"); if(!lg) return;
      var n = Date.now(); taps = taps.filter(function(t){ return n - t < 3000; }); taps.push(n);
      if(taps.length >= 5){ taps = []; try{ localStorage.setItem("dz_dbg", "1"); }catch(x){} DBG.on = true; dbgUi(); if(DBG.btn) DBG.btn.click(); }
    });
    if(DBG.on) setTimeout(dbgUi, 0);
  })();
  /* перерисовки фоновых источников склеиваем: несколько ответов подряд — одна отрисовка */
  var rsT = 0, rsWhy = "";
  function renderSoon(why){
    rsWhy = rsWhy ? (rsWhy.indexOf(why) < 0 ? rsWhy + "+" + why : rsWhy) : why;
    if(rsT) return;
    rsT = setTimeout(function(){ rsT = 0; var w = rsWhy; rsWhy = ""; dbgLog("рисуем", "причина: " + w); try{ render(); }catch(e){ DBG.errs++; dbgLog("err", "render: " + (e && e.message)); } }, 150);
  }
  /* ---------- быстрый счёт из ленты Flashscore ----------
     totobrief отдаёт счёт с задержкой, лента Flashscore — почти сразу. Пока матч идёт, счёт
     берём из ленты (каждые 15 секунд); итог матча и исход по-прежнему только от totobrief.
     Свежий счёт из ленты не затирается более старым от totobrief, пока тот не подведёт итог. */
  var FS_LIVE_EVERY = 15000, FS_KEEP = 5 * 60000;
  /* Источники счёта по надёжности: totobrief отстаёт, снимок из GitHub отстаёт меньше, лента Flashscore — самый свежий.
     Счёт не должен «качаться»: более слабый или более старый источник не откатывает уже принятый счёт (иначе
     гол пропадал и появлялся заново, а вместе с ним прыгали места наборов). Откат принимаем только от равного
     или более сильного источника с не более старыми данными — так отмена гола (VAR) всё равно доходит. */
  var SRC_TB = 1, SRC_MIR = 2, SRC_FEED = 3, SRC_NAME = { 1: "totobrief", 2: "снимок", 3: "лента" };
  function scPair(x){ var r = /(\d+)\D+(\d+)/.exec(x || ""); return r ? [+r[1], +r[2]] : null; }
  function mergeScore(m, sc){
    noteScore(m, sc, SRC_TB, Date.now());
    if(m.res){ delete m.fsAt; delete m.fsPh; }
  }
  /* новый счёт: если гол выше всех виденных ранее (m.gmax) — запоминаем гол (кто забил и когда) для подсветки на минуту.
     incOnly — источник может только подтверждать и повышать счёт (снимок GitHub) */
  var GOAL_MS = 60000, ROLLBACK_MS = 100000;
  function noteScore(m, sc, src, t, incOnly){
    src = src || SRC_TB; t = t || Date.now();
    var now = Date.now(), old = m.score || "", a = scPair(old), b = scPair(sc);
    var tag = dbgTag(m);
    if(!b){
      if(old && !m.res){ if(sc) dbgLog("score", tag + ": «" + sc + "» от " + SRC_NAME[src] + " — не счёт, пропущено"); return false; }
      if(old === sc) return false;
      m.score = sc; m.scAt = now; return true;
    }
    if(a && a[0] === b[0] && a[1] === b[1]){                /* тот же счёт — только подтверждение */
      m.scAt = now;
      if(m.dn) delete m.dn;
      if(src > 1){ m.scSrc = Math.max(m.scSrc || 0, src); m.scHi = now; m.scT = Math.max(m.scT || 0, t); }
      if(!m.gmax) m.gmax = a.slice();
      return false;
    }
    var down = !!a && (b[0] < a[0] || b[1] < a[1]);
    if(!down && m.dn) delete m.dn;                           /* любой источник снова не ниже принятого — ожидание отката сбрасываем */
    if(down && !m.res){
      var why = "";
      if(incOnly) why = "источник только повышает";
      else if(t < (m.scT || 0) && src <= (m.scSrc || 0)) why = "данные старее принятых";
      else {
        /* Счёт только растёт. Источники отстают друг от друга (totobrief и лента то опережают, то нет), поэтому
           «меньший» счёт от одного из них — чаще всего отставание, а не отмена гола. Откат принимаем, только если
           меньший счёт держится без перерыва ROLLBACK_MS и никто за это время не показал принятый или больший счёт. */
        if(!m.dn || m.dn.sc !== sc){ m.dn = { sc: sc, t0: now }; why = "ждём подтверждения отката (источники отстают друг от друга)"; }
        else if(now - m.dn.t0 < ROLLBACK_MS) why = "меньший счёт держится " + Math.round((now - m.dn.t0) / 1000) + " с из " + Math.round(ROLLBACK_MS / 1000);
      }
      if(why){ dbgLog("rej", tag + ": " + old + " → " + sc + " от " + SRC_NAME[src] + " отклонено: " + why); return false; }
      delete m.dn;
      m.gmax = b.slice();                                   /* честный откат (отмена гола) — счётчик голов сбрасываем */
      dbgLog("score", tag + ": откат " + old + " → " + sc + " (" + SRC_NAME[src] + ")");
    }
    var g = m.gmax || (a ? a.slice() : b.slice()), goal = false;
    if(!down && !m.res && a && (b[0] > g[0] || b[1] > g[1]) && now - (m.scAt || 0) < 10 * 60000){
      goal = true; m.goalAt = now; m.goalSide = b[0] > g[0] ? "h" : "a";
      try{ goalToast(m, sc); }catch(e){}
      setTimeout(function(){ try{ if(!book) renderSoon("гол"); }catch(e){} }, GOAL_MS + 300);
    }
    if(!down){ g = [Math.max(g[0], b[0]), Math.max(g[1], b[1])]; m.gmax = g; }
    else if(!m.gmax) m.gmax = b.slice();
    dbgLog(goal ? "goal" : "score", tag + ": " + (old || "—") + " → " + sc + " · " + SRC_NAME[src] + (goal ? " · ГОЛ" : (a && !down && !(b[0] > g[0] || b[1] > g[1]) ? "" : "")));
    m.score = sc; m.scAt = now; m.scT = t; m.scSrc = src; if(src > 1) m.scHi = now;
    return true;
  }
  /* всплывающее уведомление о голе: сверху, 7 секунд, коротко вибрирует на телефоне */
  var toastTimer = null, toastUntil = 0;
  function goalToast(m, sc){
    if(document.hidden) return;
    var el = document.getElementById("goalToast");
    if(!el){ el = document.createElement("div"); el.id = "goalToast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el);
      el.addEventListener("click", function(){ el.classList.remove("on"); }); }
    var r = /(\d+)\D+(\d+)/.exec(sc) || [0, "", ""], li = liveInfo(m), mn = li && li.ph ? liveMinute(li.ph, li.hockey, false) : null;
    var side = m.goalSide;
    el.innerHTML = '<span class="gt-tag">ГОЛ</span><span class="gt-body"><span class="gt-names"><span class="gt-m' + (side === "h" ? " gt-hit" : "") + '">' + escHtml(fsClean(m.home)) + '</span> \u2014 ' +
      '<span class="gt-m' + (side === "a" ? " gt-hit" : "") + '">' + escHtml(fsClean(m.away)) + '</span></span>' +
      '<b class="gt-sc"><i' + (side === "h" ? ' class="gt-hit"' : '') + '>' + r[1] + '</i>:<i' + (side === "a" ? ' class="gt-hit"' : '') + '>' + r[2] + '</i></b></span>' +
      (mn && mn.t !== "" && mn.tick ? '<span class="gt-min">' + escHtml(String(mn.t)) + '\u2019</span>' : "");
    el.classList.remove("on", "vt", "vt-bad"); void el.offsetWidth; el.classList.add("on");
    try{ if(navigator.vibrate) navigator.vibrate([70, 40, 70]); }catch(e){}
    toastUntil = Date.now() + 7000;
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.classList.remove("on"); }, 7000);
  }
  /* уведомление о вариантах: вышли в 9+ / выбыли — ждёт, пока уйдёт уведомление о голе */
  function varToast(tag, bad, text){
    if(document.hidden) return;
    var go = function(){
      var el = document.getElementById("goalToast");
      if(!el){ el = document.createElement("div"); el.id = "goalToast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el);
        el.addEventListener("click", function(){ el.classList.remove("on"); }); }
      el.innerHTML = '<span class="gt-tag">' + escHtml(tag) + '</span><span class="gt-body"><span class="gt-names">' + escHtml(text) + '</span></span>';
      el.classList.remove("on", "vt", "vt-bad"); el.classList.add(bad ? "vt-bad" : "vt"); void el.offsetWidth; el.classList.add("on");
      try{ if(navigator.vibrate) navigator.vibrate(bad ? 60 : [40, 30, 40]); }catch(e){}
      toastUntil = Date.now() + 6000;
      clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.classList.remove("on"); }, 6000);
    };
    var wait = toastUntil - Date.now();
    if(wait > 0) setTimeout(go, wait + 400); else go();
  }
  function goalOn(m){ return !m.res && !!m.goalAt && Date.now() - m.goalAt < GOAL_MS; }
  function fillScore(sc, m){
    var t = m.score ? String(m.score).replace(/\s+/g, "") : "", r = /^(\d+):(\d+)$/.exec(t);
    if(!r){ sc.textContent = t; return; }
    var g = goalOn(m);
    /* каждая цифра в своём span: на телефоне в просмотре счёт встаёт столбиком у края */
    var dh = Number(r[1]) - Number(r[2]);   /* ведущая сторона — ярче, отстающая — приглушена */
    sc.innerHTML = '<span class="sh' + (dh < 0 ? " tr" : "") + (g && m.goalSide === "h" ? " g-hit" : "") + '">' + r[1] + '</span><span class="sc-c">:</span><span class="sa' + (dh > 0 ? " tr" : "") + (g && m.goalSide === "a" ? " g-hit" : "") + '">' + r[2] + '</span>';
  }
  /* минута матча по данным ленты: футбол — от начала тайма, хоккей — минута периода из ленты */
  function liveMinute(ph, hockey, short){
    if(!ph) return null;
    var ac = String(ph.ac), now = Date.now();
    if(hockey){
      if(/^1[4-6]$/.test(ac)){
        var bx = Number(ph.bx), per = Number(ac) - 13;
        if(!isFinite(bx) || bx < 0) return { t: short ? "П" + per : per + "-й период", n: (per - 1) * 20 + 10 };
        bx = Math.min(20, bx + Math.floor((now - ph.at) / 60000));
        return { t: short ? "П" + per + " " + bx : per + "-й п. " + bx, tick: true, n: (per - 1) * 20 + bx, tot: 60 };
      }
      if(ac === "46") return { t: short ? "ПЕР" : "Перерыв" };
      if(ac === "7") return { t: short ? "ОТ" : "Овертайм" };
      return { t: "" };
    }
    if(ac === "38") return { t: short ? "ПЕР" : "Перерыв", n: 45, tot: 90 };
    if(ac === "12" || ac === "13"){
      var ao = Number(ph.ao); if(!isFinite(ao) || ao <= 0) return { t: "" };
      var mn = Math.floor((now / 1000 - ao) / 60) + 1;
      if(ac === "12") return { t: (mn > 45 ? "45+" : Math.max(1, mn)), tick: true, n: Math.min(45, Math.max(1, mn)), tot: 90 };
      mn += 45; return { t: (mn > 90 ? "90+" : mn), tick: true, n: Math.min(90, mn), tot: 90 };
    }
    return { t: "" };
  }
  function liveInfo(m){
    if(m.res || m.res === VOID) return null;
    var fresh = m.fsPh && m.fsAt && Date.now() - m.fsAt < (m.fsMir ? 30 : 3) * 60000;
    if(!fresh && !m.score) return null;
    if(m.fsEnd && Date.now() - m.fsEnd < 30 * 60000) return { end: true, ph: null, hockey: false };
    return { ph: fresh ? m.fsPh : null, hockey: fsFeedSport(m.league) === "hockey" };
  }
  /* значок LIVE и минута в начале подписи матча, подсветка строки при голе — как на Flashscore */
  function liveDecor(m, row, meta){
    var li = liveInfo(m); if(!li) return;
    if(li.end){
      var e = document.createElement("span");
      e.className = "lv-chip lv-end"; e.title = "Матч закончился, итог подводится";
      e.innerHTML = '<b class="lv-tag">КОНЕЦ</b>';
      meta.insertBefore(e, meta.firstChild); return;
    }
    var goal = goalOn(m), mn = liveMinute(li.ph, li.hockey);
    var chip = document.createElement("span");
    chip.className = "lv-chip" + (goal ? " lv-goal" : "");
    chip.title = goal ? "Забит гол" : "Матч идёт";
    var txt = mn && mn.t !== "" ? String(mn.t) : "";
    var isMin = mn && mn.tick && li.ph;
    chip.innerHTML = '<i class="lv-dot"></i><b class="lv-tag">' + (goal ? "ГОЛ" : "LIVE") + '</b>' +
      '<span class="lv-min"' + (isMin ? ' data-ac="' + li.ph.ac + '" data-ao="' + escHtml(li.ph.ao || "") + '" data-bx="' + escHtml(li.ph.bx || "") + '" data-at="' + li.ph.at + '" data-h="' + (li.hockey ? 1 : 0) + '"' : '') + '>' +
      escHtml(txt) + (isMin && /^\d/.test(txt) ? "" : "") + '</span>';
    meta.insertBefore(chip, meta.firstChild);
    if(goal) row.classList.add("goal");
  }
  setInterval(function(){
    var els = document.querySelectorAll(".lv-min[data-ac]");
    for(var i = 0; i < els.length; i++){
      var e = els[i], mn = liveMinute({ ac: e.getAttribute("data-ac"), ao: e.getAttribute("data-ao"), bx: e.getAttribute("data-bx"), at: Number(e.getAttribute("data-at")) }, e.getAttribute("data-h") === "1", e.getAttribute("data-s") === "1");
      if(mn && String(mn.t) !== e.textContent) e.textContent = String(mn.t);
      var rw = e.closest && e.closest(".row");
      if(rw && mn && mn.n != null) rw.style.setProperty("--p", Math.min(100, Math.round(mn.n / mn.tot * 100)) + "%");
    }
  }, 10000);
  function mStartMs(m){
    var dm = String(m.date || "").match(/^(\d{1,2})\.(\d{1,2})/), tm = String(m.time || "").match(/^(\d{1,2}):(\d{2})/);
    if(!dm || !tm) return null;
    var y = new Date().getUTCFullYear();
    return Date.UTC(y, +dm[2] - 1, +dm[1], +tm[1] - 3, +tm[2]);
  }
  /* матч мог уже идти: есть счёт, либо время старта прошло не больше 4 часов назад */
  function maybeLive(m){
    if(m.res) return false;
    if(m.score) return true;
    var t = mStartMs(m), d = t == null ? null : Date.now() - t;
    return d != null && d > -60000 && d < 4 * 3600000;
  }
  var fsLiveBusy = false, fsLiveAt = 0;
  /* лента живых матчей: сначала Worker, а если он не открывается (workers.dev у части провайдеров
     без VPN) — снимок из GitHub (data/api/fs-<спорт>.txt, обновляется раз в 5 минут) */
  var fsWorkerDown = 0, fsLastMir = false;
  function fsGetLive(k){
    var t0 = Date.now();
    return fsGetLive0(k).then(function(g){
      var mir = !!(g && g.mir), age = mir && g.ts ? Math.round((Date.now() - g.ts) / 1000) : null;
      DBG.feed[k] = { src: mir ? "снимок GitHub" : "worker", ms: Date.now() - t0, age: age, at: Date.now() };
      dbgLog("лента", k + ": " + (mir ? "снимок GitHub" : "worker") + ", " + (Date.now() - t0) + " мс, матчей " + (g ? g.length : 0) + (age != null ? ", снимку " + age + " с" : ""));
      return g;
    });
  }
  function fsGetLive0(k){
    var parseMir = function(t){
      var g = fsParseFeed(t), z = /^ZT÷(\d+)/.exec(t || "");
      g.mir = true; g.ts = z ? Number(z[1]) * 1000 : 0;
      return g;
    };
    var getMir1 = function(url, ms){
      var c2 = typeof AbortController === "function" ? new AbortController() : null;
      var t2 = c2 ? setTimeout(function(){ c2.abort(); }, ms) : null;
      return fetch(url, { cache: "no-store", signal: c2 ? c2.signal : undefined })
        .then(function(r){ if(t2) clearTimeout(t2); if(!r.ok) throw new Error("http"); return r.text(); })
        .then(parseMir);
    };
    /* свежие снимки лежат в отдельной ветке live (raw.githubusercontent.com): коммиты каждую минуту не мешают сборкам Pages; если ветка не открылась — прежний путь на сайте */
    var getMir = function(file, ms){
      return getMir1(C.LIVE_PATH + file, Math.min(ms, 5000)).catch(function(){ return getMir1(C.MIRROR_PATH + file, ms); });
    };
    /* fs-now — только матчи тиража (обновляется раз в минуту при изменениях), fs — все идущие матчи раз в 5 минут */
    var mirror = function(){
      var q = ".txt?t=" + Math.floor(Date.now() / 30000), sp = FS_SPORT_ID[k];
      var full = function(){ return getMir("fs-" + sp + q, 8000).catch(function(){ return []; }); };
      return getMir("fs-now-" + sp + q, 8000).then(function(g){
        return (g && g.ts && Date.now() - g.ts < 30 * 60000) ? g : full();
      }, full);
    };
    if(Date.now() - fsWorkerDown < 2 * 60000) return mirror();
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var tm = ctl ? setTimeout(function(){ ctl.abort(); }, 6000) : null;
    return fetch(FS_FEED_HOST + FS_SPORT_ID[k] + "&day=0&_=" + Date.now(), { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function(r){ if(tm) clearTimeout(tm); if(!r.ok) throw new Error("http"); return r.text(); })
      .then(fsParseFeed)
      .catch(function(e){ if(tm) clearTimeout(tm); fsWorkerDown = Date.now(); dbgLog("err", "worker ленты: " + (e && e.message || e) + " → идём через снимок GitHub на 2 минуты"); return mirror(); });
  }
  function fsLiveTick(){
    if(fsLiveBusy || document.hidden || typeof fetch !== "function") return;
    if(Date.now() - fsLiveAt < (fsLastMir ? 30000 : FS_LIVE_EVERY) - 1500) return;
    var lists = [];
    if(state.matches.length) lists.push(state.matches);
    if(state.prev && Array.isArray(state.prev.matches) && !prevDone()) lists.push(state.prev.matches);
    var cand = [], sports = {};
    /* у матчей просматриваемого тиража времени начала нет — пока тираж свежий (двое суток), сверяем их с лентой по названиям */
    var pvRecent = !!(state.prev && Date.now() - (Date.parse(state.prev.deadline) || state.prev.at || 0) < 48 * 3600000);
    lists.forEach(function(l){ l.forEach(function(m){
      var pv = state.prev && l === state.prev.matches;
      if(maybeLive(m) || (pv && pvRecent && !m.res && !m.score && mStartMs(m) == null)){ cand.push(m); sports[fsFeedSport(m.league)] = true; }
    }); });
    if(!cand.length) return;
    fsLiveBusy = true; fsLiveAt = Date.now(); var tk0 = Date.now();
    var keys = Object.keys(sports);
    Promise.all(keys.map(function(k){
      return fsGetLive(k);
    })).then(function(rs){
      var by = {}, changed = false;
      keys.forEach(function(k, i){ by[k] = rs[i]; });
      fsLastMir = rs.some(function(g){ return g && g.mir; });
      cand.forEach(function(m){
        var f = fsLookup(m, by[fsFeedSport(m.league)] || []);
        if(!f || (f.st !== "2" && f.st !== "3")) return;
        if(f.st === "3" && f.sc !== "3"){            /* перенос, отмена и прочее — не итог */
          /* в просмотре тиража подписываем матч «перенесён»/«отменён»; в текущем купоне это делает checkFsVoids */
          var vtag = FS_VOID_CODES[f.sc];
          if(vtag && state.prev && state.prev.matches.indexOf(m) >= 0 && !m.res && m.fsVoid !== vtag){ m.fsVoid = vtag; changed = true; }
          return;
        }
        if(!/^\d+$/.test(f.hs || "") || !/^\d+$/.test(f.as || "")) return;
        var grp = by[fsFeedSport(m.league)], mir = !!(grp && grp.mir);
        /* снимок из GitHub старше получаса — не верим, пусть остаётся только счёт из totobrief */
        if(mir && (!grp.ts || Date.now() - grp.ts > 30 * 60000)) return;
        var sc = f.hs + " : " + f.as, oldAc = m.fsPh ? m.fsPh.ac : null;
        m.fsAt = mir ? grp.ts : Date.now(); m.fsMir = mir;
        if(f.st === "3"){
          if(!m.fsEnd){ m.fsEnd = m.fsAt; changed = true; }
          if(!mir && noteScore(m, sc, SRC_FEED, Date.now())) changed = true;
          return;
        }
        m.fsPh = { ac: f.sc, ao: f.ao, bx: f.bx, at: m.fsAt };
        if(oldAc !== f.sc) changed = true;
        /* лента — счёт как есть; снимок из GitHub может отставать, поэтому от него берём фазу и минуту,
           а счёт только повышаем или подтверждаем (отмену гола ждём от ленты или totobrief) */
        if(!mir){
          if(noteScore(m, sc, SRC_FEED, Date.now())){ changed = true; if(state.prev && state.prev.matches.indexOf(m) >= 0) state.prev.at = Date.now(); }
        } else if(grp.ts && Date.now() - grp.ts < 12 * 60000){
          if(noteScore(m, sc, SRC_MIR, grp.ts, true)){ changed = true; if(state.prev && state.prev.matches.indexOf(m) >= 0) state.prev.at = Date.now(); }
        }
      });
      fsLiveBusy = false;
      dbgLog("tick", "лента: матчей-кандидатов " + cand.length + (changed ? ", есть изменения" : ", без изменений") + " · " + (Date.now() - tk0) + " мс");
      if(changed){ state.resAt = Date.now(); save(); if(!book) renderSoon("лента"); }
    }).catch(function(e){ fsLiveBusy = false; dbgLog("err", "лента: " + (e && e.message || e)); });
  }
  setInterval(fsLiveTick, 5000);
  function attachFsTimes(){
    if(!state.matches.length || typeof fetch !== "function") return;
    var need = {};
    state.matches.forEach(function(m){ if(!m.time) need[fsFeedSport(m.league)] = true; });
    var sports = Object.keys(need);
    if(!sports.length) return;
    var loadKeys = [];
    sports.forEach(function(sportKey){ loadKeys.push(sportKey + "|0"); loadKeys.push(sportKey + "|1"); });
    Promise.all(loadKeys.map(function(k){
      var p = k.split("|");
      return fsLoadDay(p[0], p[1]);
    })).then(function(results){
      var bySport = {};
      loadKeys.forEach(function(k, i){
        var sportKey = k.split("|")[0];
        bySport[sportKey] = (bySport[sportKey] || []).concat(results[i]);
      });
      var changed = false;
      state.matches.forEach(function(m){
        if(m.time) return;
        var all = bySport[fsFeedSport(m.league)];
        if(!all) return;
        var found = fsLookup(m, all);
        var tt2 = found ? fsFmtTime(found.ts) : "";
        if(tt2){ m.time = tt2; changed = true; }
      });
      if(changed){ save(); render(); }
    }).catch(function(){});
  }
  /* ---------- перенос и отмена матча ----------
     Flashscore помечает матч «перенесён» (AB=3, AC=4) или «отменён» (AC=5) обычно сразу,
     как об этом объявили. Фид отдаёт только сегодня и завтра, поэтому матчи позже увидим,
     когда до них останется меньше двух суток. Балтбет засчитывает такой матч угаданным
     любой ставке, если его не сыграют в срок, — значит, двойник или тройник на нём
     выброшенные деньги. Найденный матч сразу фиксируем одним исходом: стратегии фикс не
     трогают и не тратят на него варианты. Прежние исходы помним — если статус снимут
     (матч вернули в расписание), купон вернётся как был. */
  var FS_VOID_CODES = { "4": "перенесён", "5": "отменён" };
  function checkFsVoids(){
    if(!state.matches.length || typeof fetch !== "function") return;
    if(document.body.classList.contains("is-prev")) return;
    if(state.matches.some(function(m){ return m.res; })) return;
    var sports = {};
    state.matches.forEach(function(m){ sports[fsFeedSport(m.league)] = true; });
    var keys = [];
    Object.keys(sports).forEach(function(sp){ keys.push([sp, 0]); keys.push([sp, 1]); });
    Promise.all(keys.map(function(k){ return fsLoadDay(k[0], k[1], 10 * 60000); })).then(function(res){
      var by = {};
      keys.forEach(function(k, i){ by[k[0]] = (by[k[0]] || []).concat(res[i] || []); });
      var news = [], back = [];
      state.matches.forEach(function(m, i){
        var all = by[fsFeedSport(m.league)];
        if(!all || !all.length) return;
        var f = fsLookup(m, all);
        if(!f) return;
        var tag = (f.st === "3" && FS_VOID_CODES[f.sc]) || "";
        if(tag && !m.fsVoid){
          m.fsVoid = tag;
          if(m.mode !== "lock"){
            m.fsVoidPrev = { picks: JSON.parse(JSON.stringify(m.picks)), mode: m.mode, pool: m.pool ? m.pool.slice() : null };
            var cur = OUT.filter(function(o){ return m.picks[o]; }), keep = cur[0] || "1";
            var p = (m.pct && m.pct.bk) ? m.pct.bk : null;
            if(p){ var best = -1; OUT.forEach(function(o, k){ if((!cur.length || m.picks[o]) && Number(p[k]) > best){ best = Number(p[k]); keep = o; } }); }
            m.picks = { "1": false, "X": false, "2": false }; m.picks[keep] = true; m.mode = "lock";
          }
          news.push((i + 1) + " " + tag);
        } else if(!tag && m.fsVoid){
          delete m.fsVoid;
          if(m.fsVoidPrev){ m.picks = m.fsVoidPrev.picks; m.mode = m.fsVoidPrev.mode; m.pool = m.fsVoidPrev.pool; delete m.fsVoidPrev; }
          back.push(i + 1);
        }
      });
      if(news.length || back.length){
        save(); render();
        say((news.length ? "По данным Flashscore матч № " + news.join(", ") + ". Оставил один исход и зафиксировал: если матч не сыграют в срок, Балтбет засчитает его угаданным любой ставке. " : "") +
            (back.length ? "Матч № " + back.join(", ") + " вернули в расписание — вернул прежние исходы." : ""));
      }
    }).catch(function(){});
  }
  function mkFsVoid(m){
    var sc = document.createElement("span");
    sc.className = "mscore void fsvoid";
    sc.textContent = m.fsVoid;
    sc.title = "По данным Flashscore матч " + m.fsVoid + ". Если его не сыграют в срок, Балтбет засчитает его угаданным для любой ставки. Сайт оставил один исход и зафиксировал строку.";
    return sc;
  }
  function openFs(m){
    var w = window.open("", "_blank");          /* вкладку открываем сразу — после fetch браузер её заблокирует */
    if(w){ try{ w.opener = null; }catch(e){} }   /* чужая страница не должна управлять нашей вкладкой */
    var fallback = "https://www.google.com/search?q=" + encodeURIComponent(m.home + " " + m.away + " flashscore");
    function go(url){ if(w) w.location = url; else window.open(url, "_blank", "noopener"); }
    if(typeof fetch !== "function"){ go(fallback); return; }
    var sportKey = fsFeedSport(m.league);
    var isWomen = fsIsWomen(m.home) || fsIsWomen(m.away);
    var country = fsCountry(m.league);
    Promise.all([fsLoadDay(sportKey, 0), fsLoadDay(sportKey, 1)])
      .then(function(days){
        var all = days[0].concat(days[1]);
        /* сначала — турнир нужной страны, потом все группы, потом совпадение по одной команде */
        var found = fsLookup(m, all);
        if(found) return found;
        /* Worker не ответил или матча в ленте нет — ищем в снимке матчей тиража на GitHub */
        return fsDrawMirror(sportKey).then(function(g){ return fsLookup(m, g); });
      })
      .then(function(found){
        if(found) go("https://www.flashscore.ru/match/" + sportKey + "/" + found.h.url + "-" + found.h.id + "/" + found.a.url + "-" + found.a.id + "/?mid=" + found.mid);
        else go(fallback);
      })
      .catch(function(){ go(fallback); });
  }
  var FS_DRAW = {};
  function fsDrawMirror(k){
    var c = FS_DRAW[k];
    if(c && Date.now() - c.at < 5 * 60000) return c.p;
    var fn = "fs-draw-" + FS_SPORT_ID[k] + ".txt?t=" + Math.floor(Date.now() / 300000);
    var p = fetch(C.LIVE_PATH + fn, { cache: "no-store" })
      .then(function(r){ if(!r.ok) throw new Error("http"); return r; })
      .catch(function(){ return fetch(C.MIRROR_PATH + fn, { cache: "no-store" }); })
      .then(function(r){ return r.ok ? r.text() : null; })
      .then(fsParseFeed)
      .catch(function(){ return []; });
    FS_DRAW[k] = { at: Date.now(), p: p };
    return p;
  }
  /* кнопка FS — в купоне и в просмотре прошлого тиража одна и та же */
  function mkFs(m){
    var b = document.createElement("button");
    b.type = "button"; b.className = "mode srch";
    b.title = "Открыть матч на Flashscore";
    b.setAttribute("aria-label", "Открыть на Flashscore: " + m.home + " — " + m.away);
    b.innerHTML = '<b class="fs-mark">F<i>S</i></b>';
    b.addEventListener("click", function(){ openFs(m); });
    return b;
  }

  /* таблица «ИИ варианты» в просмотре: сворачивается кнопкой, выбор помнится */
  (function(){
    var bar = document.getElementById("aiTblBar"), btn = document.getElementById("aiTblBtn");
    if(!bar || !btn) return;
    var KEY = "dz_aitbl_off";
    function apply(off){
      document.body.classList.toggle("aitbl-off", off);
      btn.setAttribute("aria-expanded", off ? "false" : "true");
      btn.querySelector("span").textContent = off ? "Развернуть" : "Свернуть";
    }
    var off0 = false;
    try{ off0 = localStorage.getItem(KEY) === "1"; }catch(e){}
    apply(off0);
    btn.addEventListener("click", function(){
      var off = !document.body.classList.contains("aitbl-off");
      apply(off);
      try{ localStorage.setItem(KEY, off ? "1" : "0"); }catch(e){}
    });
  })();

  /* ---------- Составы и новости по матчу ----------
     Заголовки собирает GitHub Actions из Google News раз в 2 часа (data/api/news.json),
     ссылки собираются из названий команд — работают для любой лиги. */
  var news = { data: null, at: 0, loading: null };
  function loadNews(){
    if(news.data && Date.now() - news.at < 10 * 60000) return Promise.resolve(news.data);
    if(news.loading) return news.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    news.loading = fetch(MIRROR + "news.json?t=" + Math.floor(Date.now() / 600000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ news.data = j; news.at = Date.now(); news.loading = null; return j; })
      .catch(function(){ news.loading = null; return null; });
    return news.loading;
  }
  var sites = { data: null, at: 0, loading: null };
  function loadSites(){
    if(sites.data && Date.now() - sites.at < 30 * 60000) return Promise.resolve(sites.data);
    if(sites.loading) return sites.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    sites.loading = fetch(MIRROR + "sites.json?t=" + Math.floor(Date.now() / 1800000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ sites.data = j; sites.at = Date.now(); sites.loading = null; return j; })
      .catch(function(){ sites.loading = null; return null; });
    return sites.loading;
  }
  /* разбор матчей от ИИ: data/api/ai.json, пишется один раз на тираж */
  var ai = { data: null, at: 0, loading: null };
  /* fresh = окно разбора открыто: перечитываем файл, если ему больше минуты,
     чтобы правки разбора были видны сразу, а не через полчаса */
  function aiSig(j){ return j ? String(j.number) + "|" + (j.at || "") + "|" + JSON.stringify(j.m || []).length : ""; }
  function loadAi(fresh){
    if(ai.data && Date.now() - ai.at < (fresh ? 60000 : 30 * 60000)) return Promise.resolve(ai.data);
    if(ai.loading) return ai.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    var was = aiSig(ai.data);
    ai.loading = fetch(MIRROR + "ai.json?t=" + (fresh ? Date.now() : Math.floor(Date.now() / 1800000)), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        ai.loading = null;
        if(!j) return ai.data;
        ai.data = j; ai.at = Date.now();
        if(was && was !== aiSig(j)) try { aiCmp.v = null; aiBtnsUpdate(); } catch(e){}
        return j;
      })
      .catch(function(){ ai.loading = null; return ai.data; });
    return ai.loading;
  }
  function aiFor(j, idx){
    return (j && String(j.number) === String(state.tirazh) && j.m && j.m[idx]) || null;
  }
  /* оформление текста разбора: счета, даты, очки, цитаты, роли в скобках */
  var AI_SEC = { "Прошлые игры": "past", "Следующие игры": "next", "Кубок": "cup", "На кону": "stake", "Составы и отсутствующие": "lineup", "Тренеры и настроение": "coach", "Неочевидная деталь": "hid", "Неочевидные детали, наблюдения": "hid" };
  function aiBlkKind(h){
    h = String(h || "");
    return (h.indexOf("решает") >= 0 || h === "Факты") ? "main" : h.indexOf("Цена") >= 0 ? "risk" : h.indexOf("Человеческий") >= 0 ? "human" : "other";
  }
  function aiFmt(s){
    s = s.replace(/«[^»]*»/g, function(m){ return '<span class="ai-q">' + m + '</span>'; });
    s = s.replace(/\((?!\d)[^():]*\)/g, function(m){ return '<span class="ai-par">' + m + '</span>'; });
    s = s.replace(/(^|[^\d:+])(\d{1,2}:\d{1,2})(?![\d:])(\s?МСК)?/g, function(m, pre, sc, msk){
      if(msk) return m;
      return pre === "(" ? '<span class="ai-nb">(<span class="ai-sc">' + sc + '</span></span>' : pre + '<span class="ai-sc">' + sc + '</span>';
    });
    s = s.replace(/(\d{1,2}(?:[–-]\d{1,2})?\s(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/g, '<span class="ai-dt">$1</span>');
    s = s.replace(/(\d+\s(?:очк[а-я]*))/g, '<span class="ai-nm">$1</span>');
    return s;
  }
  /* календарь «Следующие игры»: таблица по каждой команде; красный соперник сильнее или выше в таблице, зелёный слабее или ниже */
  function aiCalTeam(t){
    if(!t || !t.g || !t.g.length) return "";
    var rows = t.g.map(function(g){
      var cls = g[4] === "s" ? " ai-st" : g[4] === "w" ? " ai-wk" : "";
      var eu = /^Лига (чемпионов|Европы|конференций)/.test(g[1]);
      var me = '<b class="ai-gme">' + escHtml(t.n) + '</b>', op = '<span class="ai-cn' + cls + '">' + escHtml(g[3]) + '</span>';
      var cap = (eu ? '<span class="ai-eub">Еврокубок</span> ' : '') + escHtml(g[1]) + (g[5] ? ' · соперник ' + escHtml(g[5]) + ' место' : '') + (g[6] ? ' · <em class="ai-dby">' + escHtml(g[6]) + '</em>' : '');
      return '<div class="ai-g ' + (g[2] ? 'ai-g-h' : 'ai-g-a') + (eu ? ' ai-eu' : '') + '"><div class="ai-gl"><span class="ai-cd">' + escHtml(g[0]) + '</span> ' +
        (g[2] ? me + ' — ' + op : op + ' — ' + me) + '</div><div class="ai-gc">' + cap + '</div></div>';
    }).join("");
    return '<div class="ai-cal-t"><b>' + escHtml(t.n) + '</b>' + (t.p ? '<span>' + escHtml(t.p) + '</span>' : '') + '</div><div class="ai-cal">' + rows + '</div>';
  }
  function aiCal(n){
    if(!n) return "";
    var a = aiCalTeam(n.h), b = aiCalTeam(n.a);
    if(!a && !b) return "";
    return a + b + '<p class="ai-cal-lg"><span class="ai-st">Красный</span> соперник сильнее или выше в таблице, <span class="ai-wk">зелёный</span> слабее или ниже, без цвета класс не определён. <span class="ai-euk">Синим</span> выделены еврокубки. Название команды стоит слева от тире в домашней игре и справа в гостевой.</p>';
  }
  function aiPara(x, r){
    var m = /^(Прошлые игры|Следующие игры|Кубок|На кону|Составы и отсутствующие|Тренеры и настроение|Неочевидная деталь|Неочевидные детали, наблюдения):\s*([\s\S]*)$/.exec(x);
    /* «Прошлые игры» на сайте не показываем: уже сыгранные матчи только мешают читать разбор (решение 09.10.2026) */
    if(m && m[1] === "Прошлые игры") return "";
    if(m && m[1] === "Следующие игры" && r && r.n){
      var cal = aiCal(r.n);
      if(cal) return '<div class="ai-sec ai-s-next"><span class="ai-lb">Следующие игры</span>' + cal + (m[2] ? '<p>' + aiFmt(escHtml(m[2].charAt(0).toUpperCase() + m[2].slice(1))) + '</p>' : '') + '</div>';
    }
    if(m && m[1] === "Составы и отсутствующие" && r && r.lu && r.lu.teams) return aiLuHtml(r.lu);
    if(m && m[1] === "Составы и отсутствующие" && r){
      var lu = aiLineup(m[2], r);
      if(lu) return '<div class="ai-sec ai-s-lineup"><span class="ai-lb">Составы и отсутствующие</span>' + lu + '</div>';
    }
    if(m && AI_SEC[m[1]]){
      return '<div class="ai-sec ai-s-' + AI_SEC[m[1]] + '"><span class="ai-lb">' + escHtml(m[1]) + '</span><p>' + aiFmt(escHtml(m[2].charAt(0).toUpperCase() + m[2].slice(1))) + '</p></div>';
    }
    return '<p>' + aiFmt(escHtml(x)) + '</p>';
  }
  /* шапка матча: турнир и тур, команды с местом и очками, время, стадион, чьё поле */
  function aiTeamHd(t){
    if(!t) return "";
    var pl = t.pl ? String(t.pl).replace(/-[йя]\b/g, "-е").replace("последний", "последнее") + " место" : "";
    return '<div class="ai-ht"><b>' + escHtml(t.n) + '</b>' + (pl ? '<span>' + escHtml(pl) + '</span>' : '') + (t.pts ? '<span>' + escHtml(t.pts) + '</span>' : '') + (t.rec ? '<em>' + escHtml(t.rec) + '</em>' : '') + '</div>';
  }
  function aiHead(d){
    var info = [["Время", d.time + (d.tz ? " (" + d.tz + ")" : "")], ["Стадион", d.v], ["Поле", d.g]].filter(function(x){ return x[1]; }).map(function(x){
      return '<div class="ai-hi"><span>' + x[0] + '</span><b>' + escHtml(x[1]) + '</b></div>';
    }).join("");
    return '<div class="ai-hd"><div class="ai-hd-top">' + escHtml(d.c) + (d.tour ? '<i></i>' + escHtml(d.tour) : '') + '</div>' +
      (d.tag ? '<div class="ai-hd-tag">' + escHtml(d.tag) + '</div>' : '') +
      '<div class="ai-hd-teams">' + aiTeamHd(d.h) + '<div class="ai-hd-vs">—</div>' + aiTeamHd(d.a) + '</div>' +
      '<div class="ai-hd-info">' + info + '</div></div>';
  }
  function escRe(x){ return String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  /* порядок чтения: ставка матча, составы, настроение, кубок, календарь, неочевидное, главное */
  var AI_ORD = ["На кону", "Составы и отсутствующие", "Тренеры и настроение", "Кубок", "Следующие игры", "Неочевидная деталь", "Неочевидные детали, наблюдения", "Главное"];
  function aiOrder(ps){
    var rank = function(x){
      var m = /^([^:]{3,40}):/.exec(x), k = m ? AI_ORD.indexOf(m[1]) : -1;
      return k < 0 ? 50 : k;
    };
    return ps.map(function(x, i){ return { x: x, i: i, k: rank(x) }; }).sort(function(a, b){ return a.k - b.k || a.i - b.i; }).map(function(o){ return o.x; });
  }
  /* составы построчно: каждый игрок отдельной строкой — позиция, статус, причина, с какого времени, ОСНОВНОЙ или РЕЗЕРВ */
  var AI_ST = { "выбыл": "out", "под вопросом": "q", "дисквалифицирован": "sus", "вернулся": "back", "в строю": "ok" };
  function aiLuPl(p){
    var st = AI_ST[p.st] || "q", ro = String(p.role || "").toLowerCase();
    var rb = ro === "основной" ? '<span class="ai-ro ai-ro-m">Основной</span>' : (ro === "резерв" ? '<span class="ai-ro ai-ro-r">Резерв</span>' : '');
    var d = [];
    if(p.why) d.push(escHtml(p.why));
    if(p.since) d.push('<span class="ai-lu-sn">' + escHtml(p.since) + '</span>');
    return '<li class="ai-lp"><div class="ai-lp-a">' + (p.num ? '<span class="ai-lp-num">' + escHtml(String(p.num).replace(/^№\s*/, "")) + '</span>' : '') + '<b>' + escHtml(p.n) + '</b>' + (p.pos ? '<span class="ai-lp-pos">' + escHtml(p.pos) + '</span>' : '') + rb + '</div>' +
      '<div class="ai-lp-b"><span class="ai-stb ai-stb-' + st + '">' + escHtml(p.st || "статус не указан") + '</span>' + (d.length ? '<span class="ai-lp-d">' + d.join(" · ") + '</span>' : '') + '</div></li>';
  }
  function aiLuHtml(lu){
    var o = '<div class="ai-sec ai-s-lineup"><span class="ai-lb">Составы и отсутствующие</span>';
    if(lu.meta) o += '<p class="ai-lu-meta">' + aiFmt(escHtml(lu.meta)) + '</p>';
    (lu.teams || []).forEach(function(t){
      o += '<div class="ai-lu-t"><b>' + escHtml(t.n) + '</b>';
      if(t.pl && t.pl.length) o += '<ul class="ai-lps">' + t.pl.map(aiLuPl).join("") + '</ul>';
      else o += '<span class="ai-lu-no">' + escHtml(t.no || "Отсутствующих в источниках нет.") + '</span>';
      if(t.xi) o += '<span class="ai-lu-xi"><i>Вероятный состав</i> ' + escHtml(t.xi) + '</span>';
      o += '</div>';
    });
    if(lu.key) o += '<p class="ai-lu-key"><b>Ключевой вопрос</b>' + aiFmt(escHtml(lu.key)) + '</p>';
    if(lu.note) o += '<p class="ai-lu-note">' + escHtml(lu.note) + '</p>';
    return o + '</div>';
  }
  /* составы по командам: метка проверки, по абзацу на команду, ключевой вопрос, примечание */
  function aiLineup(txt, r){
    var names = [];
    ["h", "a"].forEach(function(k){ var t = r && r.hd && r.hd[k]; if(t && t.n) names.push(t.n.split(" ")[0]); });
    if(names.length < 2) return "";
    var s = String(txt), note = "", key = "";
    var mk = /\s*Ключевой вопрос к составу:\s*([^.]*)\.?\s*$/.exec(s);
    if(mk){ key = mk[1]; s = s.slice(0, mk.index); }
    var mn = /\s*(Официальных стартовых составов[^.]*\.[^.]*\.?)\s*$/.exec(s);
    if(mn){ note = mn[1]; s = s.slice(0, mn.index); }
    var re = new RegExp("(?:^|[.)]\\s+)(" + names.map(escRe).join("|") + ")[^:.]{0,16}:\\s", "g"), hits = [], m;
    while((m = re.exec(s))){ hits.push({ at: m.index + m[0].length - m[0].replace(/^[.)]\s+/, "").length, end: m.index + m[0].length, name: m[0].replace(/^[.)]\s+/, "").replace(/:\s$/, "") }); }
    if(!hits.length) return "";
    var meta = s.slice(0, hits[0].at).trim(), out = "";
    if(meta) out += '<p class="ai-lu-meta">' + aiFmt(escHtml(meta)) + '</p>';
    hits.forEach(function(h, i){
      var body = s.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : s.length).trim();
      out += '<div class="ai-lu-t"><b>' + escHtml(h.name) + '</b><span>' + aiFmt(escHtml(body)) + '</span></div>';
    });
    if(key) out += '<p class="ai-lu-key"><b>Ключевой вопрос</b>' + aiFmt(escHtml(key)) + '</p>';
    if(note) out += '<p class="ai-lu-note">' + escHtml(note) + '</p>';
    return out;
  }
  function aiHtml(r, full, mt){
    var src = (r.s || []).map(function(x){
      return '<a target="_blank" rel="noopener noreferrer" href="' + escHtml(x.u) + '">' + escHtml(x.n) + '</a>';
    }).join(" · ");
    var fin = "";
    var blk = (full && Array.isArray(r.b)) ? r.b.filter(function(b){ return b && b.t; }).map(function(b){
      var kind = aiBlkKind(b.h);
      var ps = aiOrder(String(b.t).split(/\n+/));
      ps = ps.filter(function(x){
        var f = /^Главное:\s*([\s\S]*)$/.exec(x);
        if(f){ fin += '<div class="ai-fin"><span class="ai-lb">Главное</span><p>' + aiFmt(escHtml(f[1].charAt(0).toUpperCase() + f[1].slice(1))) + '</p></div>'; return false; }
        return true;
      });
      return '<div class="ai-blk ai-k-' + kind + '">' + (b.h ? '<h4 class="ai-blk-h">' + escHtml(kind === "main" ? "Факты" : b.h) + '</h4>' : '') +
        ps.map(function(x){ return aiPara(x, r); }).join("") + '</div>';
    }).join("") : "";
    return (full ? '<div class="ai-paper">' : '') + ((full && r.hd) ? aiHead(r.hd) : '<p class="ai-txt' + (full ? ' ai-lead' : '') + '">' + (full ? aiFmt(escHtml(r.t)) : escHtml(r.t)) + '</p>') + (blk ? '<div class="ai-blks">' + blk + '</div>' : '') + fin +
      (src ? '<p class="ai-src">Источники: ' + src + '</p>' : '') + (full ? '</div>' : '') +
      (full ? '<p class="ev-note">Разбор написан ИИ по открытым источникам' +
        ((r.at || (ai.data && ai.data.at)) ? ' (' + new Date(r.at || ai.data.at).toLocaleString("ru-RU", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Moscow"}) + ' МСК)' : '') +
        '. Это мнение, а не гарантия; составы за час до игры могут всё поменять.</p>' : '');
  }
  /* вариант ИИ: строка исходов «1», «1X», «12»… на каждый матч */
  /* сравнение со стратегиями сайта: Расхождения, Симуляция, Келли — считаем здесь же, кэш на минуту */
  var aiCmp = { at: 0, key: "", v: null };
  function aiStrats(){
    var key = state.tirazh + "|" + state.price + "|" + state.bankroll + "|" + stratBudgetValue();
    if(aiCmp.v && aiCmp.key === key && Date.now() - aiCmp.at < 60000) return aiCmp.v;
    var v = stratCore();
    aiCmp = { at: Date.now(), key: key, v: v };
    return v;
  }
  /* строки исходов трёх стратегий по текущему state.matches */
  function stratCore(){
    var v = { gap: null, sim: null, kel: null }, str = function(set){ return set.map(function(k){ return OUT[k]; }).join(""); };
    try {
      var g = gapSwaps();
      if(g){
        var line = g.base.slice(), sw = g.swaps.slice().sort(function(x, y){ return y.score - x.score; });
        for(var k = 0; k < sw.length; k++){
          if(sw[k].score >= SWAP_MIN && sw[k].loss <= LOSS_CAP) line[sw[k].i] = sw[k].to; else break;
        }
        v.gap = line.map(function(o){ return OUT[o]; });
      }
    } catch(e){}
    try { var sm = planBySim(stratBudgetValue()); if(sm && sm.rows) v.sim = sm.rows.map(function(r){ return str(r.set); }); } catch(e){}
    try {
      var K = planByKelly(), kp = K && !K.error ? (K.best || K.cands[0]) : null;
      if(kp) v.kel = kp.plan.rows.map(function(r){ return str(r.set); });
    } catch(e){}
    return v;
  }

  /* ---------- точность по тиражам: ИИ и стратегии против итогов ----------
     Стратегии считаются тем же кодом, что и в купоне, по линии и долям на закрытие
     тиража. Посчитанное хранится в браузере, так что таблица не теряет тиражи,
     которые уже ушли из ленты. */
  var ACC_KEY = "dzhek-acc", ACC_N = 10;
  function accRead(){ try { return JSON.parse(localStorage.getItem(ACC_KEY)) || {}; } catch(e){ return {}; } }
  function accWrite(o){ try { localStorage.setItem(ACC_KEY, JSON.stringify(o)); } catch(e){} }
  function accSetKey(){ return state.price + "|" + state.bankroll + "|" + stratBudgetValue(); }
  function stratForInfo(info){
    var list = matchesFromInfo(info);
    var bak = { matches: state.matches, poolSum: state.poolSum, jackpot: state.jackpot, tirazh: state.tirazh }, v;
    try {
      state.matches = list; state.poolSum = Number(info.pool_sum) || 0;
      state.jackpot = Number(info.jackpot) || 0; state.tirazh = String(info.number);
      v = stratCore();
    } finally {
      state.matches = bak.matches; state.poolSum = bak.poolSum; state.jackpot = bak.jackpot; state.tirazh = bak.tirazh;
    }
    return { res: list.map(function(m){ return m.res; }), gap: v.gap, sim: v.sim, kel: v.kel, key: accSetKey() };
  }
  function accScore(line, res){
    if(!Array.isArray(line) || !Array.isArray(res) || line.length !== res.length) return null;
    var hit = 0, vars = 1;
    for(var i = 0; i < res.length; i++){
      var c = String(line[i] || "");
      if(!c) return null;
      vars *= c.length;
      if(hitRes(c, res[i])) hit++;
    }
    return { hit: hit, vars: vars };
  }
  function showAcc(back){
    $("evTitle").textContent = "Статистика стратегий";
    $("evBody").innerHTML = '<div id="accBox"><p class="ev-note">Считаю…</p></div>' +
      (back ? '<div class="blend-go"><button type="button" class="btn-ev" id="accBack">К разбору</button></div>' : '');
    $("evBack").hidden = false;
    if(back) $("accBack").addEventListener("click", back);
    var store = accRead(), key = accSetKey();
    var aiH = fetch(MIRROR + "ai_hist.json?t=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.json() : {}; }).catch(function(){ return {}; });
    var draws = apiFetch("baltbet-main/drawings?page=1")
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var rows = ((j && j.data) || []).filter(function(d){ return d.status === "finished"; })
          .sort(function(a, b){ return b.number - a.number; }).slice(0, ACC_N);
        return Promise.all(rows.map(function(d){
          var have = store[d.number];
          if(have && have.key === key) return null;
          return apiFetch("drawing-info/" + d.id).then(function(r){ return r.ok ? r.json() : null; })
            .then(function(j2){
              var info = j2 && (j2.data || j2);
              if(!info || info.status !== "finished") return;
              info.number = info.number || d.number;
              store[d.number] = stratForInfo(info);
            }).catch(function(){});
        }));
      }).catch(function(){});
    var vp = loadVirt().catch(function(){ return null; });
    Promise.all([aiH, draws, vp]).then(function(r){
      var aih = r[0] || {}, vdata = r[2] || {}, el = $("accBox"); if(!el) return;
      var nums = Object.keys(store).map(Number).sort(function(a, b){ return b - a; });
      var keep = {}; nums.slice(0, 40).forEach(function(n){ keep[n] = store[n]; }); accWrite(keep);
      nums = nums.slice(0, ACC_N);
      if(!nums.length){ el.innerHTML = '<p class="ev-warn">Пока не удалось получить итоги прошлых тиражей. Попробуй позже.</p>'; return; }
      var cols = [["ai", "ИИ", "ИИ"], ["hunt", "Охота", "Охота"], ["gap", "Расхожд.", "Расх."], ["sim", "Симул.", "Сим."], ["kel", "Келли", "Келли"]], sum = {}, cnt = {};
      var body = nums.map(function(n){
        var d = store[n], sc = {}, best = -1;
        cols.forEach(function(c){
          if(c[0] === "hunt"){
            var vr = vdata[String(n)];
            if(vr && vr.z && Array.isArray(d.res)){
              var best15 = 0;
              virtRows(vr.z).forEach(function(row){
                var h15 = 0; for(var q = 0; q < row.length; q++) if(hitRes(row.charAt(q), d.res[q])) h15++;
                if(h15 > best15) best15 = h15;
              });
              sc.hunt = { hit: best15, vars: vr.n, rows: true };
            } else sc.hunt = null;
          } else sc[c[0]] = accScore(c[0] === "ai" ? aih[n] : d[c[0]], d.res);
          if(sc[c[0]] && sc[c[0]].hit > best) best = sc[c[0]].hit;
        });
        return '<tr><th scope="row">' + n + '</th>' + cols.map(function(c){
          var x = sc[c[0]];
          if(!x) return '<td class="acc-na">—</td>';
          sum[c[0]] = (sum[c[0]] || 0) + x.hit; cnt[c[0]] = (cnt[c[0]] || 0) + 1;
          return '<td><span class="ac-pill' + (x.hit === best ? ' ac-best' : x.hit >= 9 ? ' ac-prize' : '') + '"><b>' + x.hit + '</b></span><small>' + fmt(x.vars) + '<span class="acc-u">' + (x.rows ? ' стр.' : ' вар.') + '</span></small></td>';
        }).join("") + '</tr>';
      }).join("");
      var avg = {}, topK = null;
      cols.forEach(function(c){ if(cnt[c[0]]){ avg[c[0]] = sum[c[0]] / cnt[c[0]]; if(topK === null || avg[c[0]] > avg[topK]) topK = c[0]; } });
      var f1 = function(v){ return v.toFixed(1).replace(".", ","); };
      var lb = cols.filter(function(c){ return avg[c[0]] !== undefined; }).sort(function(x, y){ return avg[y[0]] - avg[x[0]]; }).map(function(c){
        return '<div class="ac-lb' + (c[0] === topK ? ' ac-top' : '') + '"><span class="ac-lbn">' + c[1].replace("Расхожд.", "Расхождения").replace("Симул.", "Симуляция") + '</span>' +
          '<span class="ac-bar"><i style="width:' + Math.round(avg[c[0]] / 15 * 100) + '%"></i></span><b>' + f1(avg[c[0]]) + '</b><small>' + cnt[c[0]] + ' тир.</small></div>';
      }).join("");
      var foot = '<tr><th scope="row">Среднее</th>' + cols.map(function(c){
        return cnt[c[0]] ? '<td><span class="ac-pill' + (c[0] === topK ? ' ac-best' : '') + '"><b>' + f1(avg[c[0]]) + '</b></span><small>' + cnt[c[0]] + ' тир.</small></td>' : '<td class="acc-na">—</td>';
      }).join("") + '</tr>';
      el.innerHTML = '<h3 class="ac-h">Среднее число угаданных матчей</h3><div class="ac-lbs">' + lb + '</div>' +
        '<h3 class="ac-h">По тиражам</h3>' +
        '<p class="ac-leg"><span class="ac-pill ac-best"><b>12</b></span> лучший в тираже <span class="ac-pill ac-prize"><b>9</b></span> призовая зона, 9 и больше</p>' +
        '<div class="acc-wrap"><table class="acc"><thead><tr><th>Тираж</th>' + cols.map(function(c){ return '<th' + (c[0] === topK ? ' class="ac-topc"' : '') + '><span class="acc-l">' + c[1] + '</span><span class="acc-s">' + c[2] + '</span></th>'; }).join("") +
        '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
        '<p class="ev-note ac-fn">Число в таблице: сколько матчей из 15 накрыл купон, столько угадала бы его лучшая строка. У Охоты это лучшая из её готовых строк, под числом количество строк. Расхождения, Симуляция и Келли посчитаны по линии и долям на закрытие тиража при текущих настройках цены и бюджета; ИИ и Охота взяты из сохранённых на тираж данных. «—» — купона не было.</p>';
    });
  }
  var AI_SN = [["gap", "Расхождения"], ["sim", "Симуляция"], ["kel", "Келли"]];
  /* вариант ИИ скрыт, пока не нажать «показать»: чтобы не отвлекал от фактов разбора */
  function aiGate(inner){
    return '<div class="ai-gate"><p class="ai-pick ai-pick-closed">Вариант ИИ: <button type="button" class="ai-reveal">показать</button></p>' +
      '<div class="ai-real" hidden>' + inner + '</div></div>';
  }
  function aiGateBind(box, cb){
    var g = box && box.querySelector(".ai-gate"); if(!g) return;
    var b = g.querySelector(".ai-reveal"); if(!b) return;
    b.addEventListener("click", function(){
      var c = g.querySelector(".ai-pick-closed"), r = g.querySelector(".ai-real");
      if(c) c.hidden = true;
      if(r) r.hidden = false;
      if(cb) cb();
    });
  }
  function aiPickLine(r, idx){
    if(!r || !r.p) return "";
    var v = aiStrats(), P = r.p.split(""), cells = "", any = false, union = {};
    AI_SN.forEach(function(n){
      var x = v[n[0]] && v[n[0]][idx];
      if(!x) return; any = true;
      x.split("").forEach(function(o){ union[o] = 1; });
      var same = x.length === r.p.length && P.every(function(o){ return x.indexOf(o) >= 0; });
      cells += '<span class="ai-c"><i>' + n[1] + '</i><b>' + escHtml(x) + '</b>' + (same ? '<em class="ai-eq">=</em>' : '') + '</span>';
    });
    var head = '<p class="ai-pick">Вариант ИИ: <b>' + escHtml(r.p) + '</b>';
    if(!any) return head + '</p>';
    var add = P.filter(function(o){ return !union[o]; });
    var tag = add.length ? '<span class="ai-vs ai-vs-diff">ИИ против всех: ' + add.join("") + '</span>' : "";
    return head + tag + '</p><div class="ai-cmp">' + cells + '</div>';
  }
  function aiKellySummary(j){
    var v = aiStrats(); if(!j || !j.m) return "";
    var parts = [];
    AI_SN.forEach(function(n){
      var a = v[n[0]]; if(!a) return;
      var same = 0, t = 0;
      j.m.forEach(function(r, i){ if(r.p && a[i]){ t++; if(r.p.split("").sort().join("") === a[i].split("").sort().join("")) same++; } });
      if(t) parts.push(n[1] + " " + same + "/" + t);
    });
    return parts.length ? '<p class="ev-note">ИИ совпадает по матчам: ' + parts.join(" · ") + '. Стратегии сайта берут те же цифры (линия и толпа), поэтому ИИ отличается от них только там, где есть новости.</p>' : "";
  }
  function aiPlan(j){
    if(!j || String(j.number) !== String(state.tirazh) || !j.m || j.m.length !== state.matches.length) return null;
    var combos = 1;
    for(var i = 0; i < j.m.length; i++){
      var p = String(j.m[i].p || "");
      if(!/^[1X2]{1,3}$/.test(p)) return null;
      combos *= p.length;
    }
    return { combos: combos };
  }
  function aiApply(j, only){
    pushHistory("до варианта ИИ");
    var set = 0, locked = 0;
    state.matches.forEach(function(m, i){
      if(only && only.indexOf(i) < 0) return;
      var p = String((j.m[i] || {}).p || "");
      if(!/^[1X2]{1,3}$/.test(p)) return;
      if(m.mode === "lock"){ locked++; return; }
      m.picks = { "1": false, "X": false, "2": false };
      p.split("").forEach(function(o){ m.picks[o] = true; });
      m.mode = "free"; set++;
    });
    save(); render();
    $("evBack").hidden = true;
    var t0 = tally();
    say("Вариант ИИ: проставлено " + set + " матч(ей)" + (locked ? ", зафиксированных не трогал: " + locked : "") +
        ". В купоне " + fmt(t0.combos) + " вариант(ов) на " + fmt(t0.combos * (Number(state.price) || 0)) + " ₽. «Назад» откатит.");
  }
  /* нет разбора на этот тираж — кнопка серая и не нажимается, место под неё остаётся */
  function aiBtnState(b, idx){
    var ok = !!aiFor(ai.data, idx);
    b.disabled = !ok;
    b.title = ok ? "Короткий разбор матча от ИИ" : "Разбор не готов";
  }
  function aiBtnsUpdate(){
    [].slice.call(document.querySelectorAll(".ai-btn")).forEach(function(b){ aiBtnState(b, Number(b.getAttribute("data-idx"))); });
  }
  function mkAiBtn(m, idx){
    var b = document.createElement("button");
    b.type = "button"; b.className = "nw-btn ai-btn";
    b.textContent = "ИИ";
    b.setAttribute("data-idx", idx);
    aiBtnState(b, idx);
    b.setAttribute("aria-label", "Разбор ИИ: " + m.home + " — " + m.away);
    b.addEventListener("click", function(ev){ ev.stopPropagation(); showAi(m, idx); });
    return b;
  }
  /* ИИ в просмотре начавшегося тиража: полный разбор, пока ai.json про этот тираж,
     иначе только варианты из ai_hist.json */
  var aiHist = { data: null, at: 0, loading: null }, aiPrevAsked = "";
  function loadAiHist(){
    if(aiHist.data && Date.now() - aiHist.at < 10 * 60000) return Promise.resolve(aiHist.data);
    if(aiHist.loading) return aiHist.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    aiHist.loading = fetch(MIRROR + "ai_hist.json?t=" + Math.floor(Date.now() / 600000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ aiHist.loading = null; if(j){ aiHist.data = j; aiHist.at = Date.now(); } return aiHist.data; })
      .catch(function(){ aiHist.loading = null; return aiHist.data; });
    return aiHist.loading;
  }
  /* архив полных разборов прошлых тиражей: data/api/ai_arch.json {"<номер>": {at, m:[…]}} — чтобы
     после записи нового разбора текст прошлого не пропадал (нужен для разбора ошибок) */
  var aiArch = { data: null, at: 0, loading: null };
  function loadAiArch(){
    if(aiArch.data && Date.now() - aiArch.at < 10 * 60000) return Promise.resolve(aiArch.data);
    if(aiArch.loading) return aiArch.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    aiArch.loading = fetch(MIRROR + "ai_arch.json?t=" + Math.floor(Date.now() / 600000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ aiArch.loading = null; if(j){ aiArch.data = j; aiArch.at = Date.now(); } return aiArch.data; })
      .catch(function(){ aiArch.loading = null; return aiArch.data; });
    return aiArch.loading;
  }
  /* виртуальные купоны стратегий (data/api/virt.json {"<тираж>": {name, sets, n, pin, z}}): считаются до дедлайна и не меняются,
     в просмотре идут в рейтинг с пометкой «виртуальный» — на деньги не ставятся, нужны для отслеживания */
  var virt = { data: null, at: 0, loading: null };
  function loadVirt(){
    if(virt.data && Date.now() - virt.at < 10 * 60000) return Promise.resolve(virt.data);
    if(virt.loading) return virt.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    virt.loading = fetch(MIRROR + "virt.json?t=" + Math.floor(Date.now() / 600000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ virt.loading = null; if(j){ virt.data = j; virt.at = Date.now(); } return virt.data; })
      .catch(function(){ virt.loading = null; return virt.data; });
    return virt.loading;
  }
  /* 5 знаков base36 на строку: число исходов в троичной записи (1=0, X=1, 2=2) */
  function virtRows(z){
    var out = [], i, j, v, s;
    for(i = 0; i + 5 <= z.length; i += 5){
      v = parseInt(z.substr(i, 5), 36); s = "";
      for(j = 0; j < 15; j++){ s = "1X2".charAt(v % 3) + s; v = Math.floor(v / 3); }
      out.push(s);
    }
    return out;
  }
  function aiPrevRec(no, idx){
    var j = ai.data;
    if(j && String(j.number) === String(no) && j.m && j.m[idx] && j.m[idx].p) return j.m[idx];
    var ar = aiArch.data && aiArch.data[String(no)];
    if(ar && ar.m && ar.m[idx] && ar.m[idx].p){ var rr = {}; for(var k in ar.m[idx]) rr[k] = ar.m[idx][k]; rr.at = ar.at; return rr; }
    var h = aiHist.data && aiHist.data[String(no)];
    var p = Array.isArray(h) ? h[idx] : null;
    return /^[1X2]{1,3}$/.test(String(p || "")) ? { p: String(p) } : null;
  }
  /* загрузить разбор для просмотра один раз на тираж и перерисовать, когда придёт */
  function aiPrevEnsure(no){
    if(aiPrevAsked === String(no)) return;
    aiPrevAsked = String(no);
    Promise.all([loadAi(), loadAiHist(), loadAiArch(), loadVirt()]).then(function(){
      if(state.viewPrev && state.prev && String(state.prev.tirazh) === String(no)) render();
    });
  }
  /* исход сейчас: итог матча или текущий счёт в лайве */
  function liveOutcome(m){
    if(m.res && /^[1X2]$/.test(m.res)) return { o: m.res, live: false };
    var r = /^\s*(\d+)\s*[:\-]\s*(\d+)/.exec(String(m.score || ""));
    if(!r || m.res === VOID) return null;
    var a = +r[1], b = +r[2];
    return { o: a > b ? "1" : a < b ? "2" : "X", live: true };
  }
  function mkAiLive(rec, m){
    var lo = rec && liveOutcome(m); if(!lo) return null;
    var ok = rec.p.indexOf(lo.o) >= 0;
    var el = document.createElement("span");
    el.className = "ai-live " + (ok ? "ai-ok" : "ai-no") + (lo.live ? " is-live" : "");
    el.innerHTML = 'ИИ <i class="pm" aria-hidden="true"></i>';
    el.title = "Вариант ИИ " + rec.p + (lo.live ? ": по текущему счёту " : ": итог ") + (ok ? "угадан" : "не угадан");
    return el;
  }
  function showAiPrev(m, idx, no){
    var r = aiPrevRec(no, idx);
    $("evTitle").textContent = "Разбор ИИ · " + m.home + " — " + m.away;
    var lo = liveOutcome(m), st = "";
    if(r && lo){
      var ok = r.p.indexOf(lo.o) >= 0;
      st = ' <span class="ai-live ' + (ok ? "ai-ok" : "ai-no") + '">' + (lo.live ? "сейчас " : "итог ") + (ok ? "угадан" : "мимо") + '</span>';
    } else if(r) st = ' <span class="ai-live">матч не начался</span>';
    $("evBody").innerHTML = '<div id="aiBox">' + (r ? aiGate('<p class="ai-pick">Вариант ИИ: <b>' + escHtml(r.p) + '</b>' + st + '</p>') +
        (r.t ? aiHtml(r, true, m) : '<p class="ev-note">Полный текст разбора к этому тиражу не сохранён, остался только вариант.</p>')
      : '<p class="ev-warn">Разбора ИИ по этому тиражу нет.</p>') + '</div>';
    $("evBack").hidden = false;
    aiGateBind($("aiBox"));
  }
  function mkAiPrev(m, idx, no, mode){
    var b = document.createElement("button");
    b.type = "button"; b.className = mode ? "mode nw-mode ai-btn" : "nw-btn ai-btn";
    b.textContent = "ИИ";
    var ok = !!aiPrevRec(no, idx);
    b.disabled = !ok;
    b.title = ok ? "Вариант ИИ и разбор матча" : "Разбора нет";
    b.setAttribute("aria-label", "Разбор ИИ: " + m.home + " — " + m.away);
    b.addEventListener("click", function(ev){ ev.stopPropagation(); showAiPrev(m, idx, no); });
    return b;
  }
  function showAi(m, idx){
    $("evTitle").textContent = "Разбор ИИ · " + m.home + " — " + m.away;
    $("evBody").innerHTML = '<div id="aiBox"><p class="ev-note">Загружаю…</p></div>' +
      '';
    $("evBack").hidden = false;
    loadAi(true).then(function(j){
      var el = $("aiBox"); if(!el) return;
      var r = aiFor(j, idx);
      if(!r){
        el.innerHTML = '<p class="ev-warn">Разбора для этого тиража пока нет: его пишут один раз, вскоре после открытия тиража. Загляни позже или открой новости.</p>';
        return;
      }
      var all = aiPlan(j);
      el.innerHTML = (r.p ? aiGate(aiPickLine(r, idx)) : "") + aiHtml(r, true, state.matches[idx]);
      if(r.p){
        aiGateBind(el, function(){
          var go = el.querySelector(".ai-gate .ai-real"); if(!go || $("aiOne")) return;
          go.insertAdjacentHTML("beforeend", '<div class="ai-act">' +
            '<button type="button" class="btn-ev" id="aiOne">Поставить ' + escHtml(r.p) + ' в матч</button>' +
            (all ? '<button type="button" class="btn-ev" id="aiAll">Весь купон ИИ · ' + fmt(all.combos) + ' вар.</button>' : '') + '</div>');
          $("aiOne").addEventListener("click", function(){ aiApply(j, [idx]); });
          if(all) $("aiAll").addEventListener("click", function(){ aiApply(j, null); });
          el.insertAdjacentHTML("beforeend", aiKellySummary(j));
        });
      }
    });
  }
  function nwHost(u){ var r = /^https?:\/\/(?:www\.)?([^\/?#]+)/i.exec(u || ""); return r ? r[1] : ""; }
  function siteLink(team, url){
    var ok = /^https?:\/\//i.test(url || "");
    var href = ok ? url : "https://www.google.com/search?q=" + encodeURIComponent(team + " официальный сайт футбол");
    return '<a class="nw-link" target="_blank" rel="noopener noreferrer" href="' + escHtml(href) + '">Сайт: ' + escHtml(team) +
      '<span>' + (ok ? escHtml(nwHost(url)) : "не нашли в базе — поиск в Google") + '</span></a>';
  }
  function mkNewsBtn(m, idx, prev){
    var b = document.createElement("button");
    b.type = "button"; b.className = "nw-btn";
    b.textContent = "новости";
    b.title = "Составы и свежие новости по матчу";
    b.setAttribute("aria-label", "Составы и новости: " + m.home + " — " + m.away);
    b.addEventListener("click", function(ev){ ev.stopPropagation(); showNews(m, idx, prev); });
    return b;
  }
  /* на телефоне кнопка стоит в ряду «рандом · фикс · FS» — там ей просторно */
  function mkNewsMode(m, idx, prev){
    var b = document.createElement("button");
    b.type = "button"; b.className = "mode nw-mode";
    b.textContent = "новости";
    b.title = "Составы и свежие новости по матчу";
    b.setAttribute("aria-label", "Составы и новости: " + m.home + " — " + m.away);
    b.addEventListener("click", function(){ showNews(m, idx, prev); });
    return b;
  }
  function mkAiMode(m, idx){
    var b = document.createElement("button");
    b.type = "button"; b.className = "mode nw-mode ai-btn";
    b.textContent = "ИИ";
    b.setAttribute("data-idx", idx);
    b.setAttribute("aria-label", "Разбор ИИ: " + m.home + " — " + m.away);
    aiBtnState(b, idx);
    b.addEventListener("click", function(){ showAi(m, idx); });
    return b;
  }
  function numNews(el, m, idx, prev){
    el.classList.add("num-nw");
    el.title = "Составы и новости по матчу";
    el.addEventListener("click", function(){ showNews(m, idx, prev); });
  }
  var NW_HOT = /травм|дисквал|состав|ротац|пропуст|не сыграет|отстран|вернул|верн[её]т|тренер|уволен|отставк|поврежд|восстанов/i;
  function nwAgo(iso){
    var t = Date.parse(iso); if(!isFinite(t)) return "";
    var h = Math.max(0, Math.round((Date.now() - t) / 3600000));
    return h < 1 ? "только что" : h < 24 ? h + " ч назад" : Math.round(h / 24) + " дн назад";
  }
  function nwTeam(x){ return String(x || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(); }
  function showNews(m, idx, prev){
    var h = nwTeam(m.home), a = nwTeam(m.away), pair = h + " " + a;
    var q = function(s){ return encodeURIComponent(s); };
    $("evTitle").textContent = m.home + " — " + m.away;
    var links =
      '<div class="nw-links">' +
        '<a class="nw-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=' + q(pair + " стартовые составы") + '">Стартовые составы<span>поиск, появляются за час до начала</span></a>' +
        '<a class="nw-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=' + q(pair + " sofascore") + '">Sofascore<span>составы, рейтинги игроков</span></a>' +
        '<a class="nw-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=' + q(pair + " травмы дисквалификации") + '">Травмы и дисквалификации<span>поиск по обеим командам</span></a>' +
        '<a class="nw-link" target="_blank" rel="noopener noreferrer" href="https://news.google.com/search?hl=ru&gl=RU&ceid=RU:ru&q=' + q(pair + " when:7d") + '">Все новости<span>Google Новости за неделю</span></a>' +
      '</div>' +
      '<div class="nw-links" id="nwSites">' + siteLink(h, "") + siteLink(a, "") + '</div>';
    var box = $("evBody");
    box.innerHTML = (prev ? '' : '<div id="nwAi"></div>') + links + '<h3 class="th-h2 nw-h">Свежие заголовки</h3><div id="nwList"><p class="ev-note">Загружаю…</p></div>' +
      '<p class="ev-note">Заголовки обновляются раз в 2 часа. Сначала — про обе команды и с пометкой о травмах, составе, тренере; прогнозы букмекерских сайтов — в конце.</p>';
    $("evBack").hidden = false;
    if(!prev) loadAi(true).then(function(j){
      var el = $("nwAi"), r = aiFor(j, idx); if(!el || !r) return;
      el.innerHTML = '<h3 class="th-h2 nw-h">Разбор ИИ</h3>' + (r.p ? aiPickLine(r, idx) : '') + aiHtml(r, false, m);
      if(r.p) el.insertAdjacentHTML("beforeend", '<p class="ai-more"><button type="button" class="nw-btn" id="nwAiMore">поставить вариант ИИ</button></p>');
      var mb = $("nwAiMore"); if(mb) mb.addEventListener("click", function(){ showAi(m, idx); });
    });
    loadSites().then(function(j){
      var el = $("nwSites"); if(!el) return;
      var r = j && !prev && String(j.number) === String(state.tirazh) && j.m && j.m[idx];
      if(r) el.innerHTML = siteLink(h, r[0]) + siteLink(a, r[1]);
    });
    loadNews().then(function(j){
      var el = $("nwList"); if(!el) return;
      var ok = j && !prev && String(j.number) === String(state.tirazh) && j.m && j.m[idx];
      var list = ok ? j.m[idx] : null;
      if(!ok){
        el.innerHTML = '<p class="ev-warn">' + (prev ? "Для прошлого тиража заголовки не собираются — открой ссылки выше."
          : "Заголовки для этого тиража ещё не собраны — открой ссылки выше или загляни позже.") + '</p>';
        return;
      }
      if(!list.length){
        el.innerHTML = '<p class="ev-warn">За последние 4 дня новостей по этому матчу не нашлось — у небольших лиг так бывает часто. Попробуй ссылки выше.</p>';
        return;
      }
      el.innerHTML = '<ul class="nw-ul">' + list.map(function(x){
        var hot = NW_HOT.test(x.t) && !x.f;
        return '<li class="' + (hot ? "hot" : "") + (x.f ? " fc" : "") + '">' +
          '<a target="_blank" rel="noopener noreferrer" href="' + escHtml(x.u) + '">' + escHtml(x.t) + '</a>' +
          '<span class="nw-meta">' + escHtml(x.s || "") + (x.d ? " · " + nwAgo(x.d) : "") +
          (x.b ? "" : " · про одну команду") + (x.f ? " · прогноз" : "") + '</span></li>';
      }).join("") + '</ul>';
    });
  }
  /* название команды — ссылка на её историю в тото */
  function mkTeam(name, opp){
    var t = document.createElement("span");
    t.className = "tm"; t.textContent = name;
    t.title = "История команды в Балтсистеме" + (opp ? " · очные с " + opp : "");
    t.addEventListener("click", function(){ showTeam(name, opp); });
    return t;
  }
  function render(){
    var t0 = performance.now();
    renderCore(); ujSoon(); renderWaitNote();
    if(typeof DBG !== "object") return;
    var d = performance.now() - t0; DBG.rn++; DBG.rsum += d; if(d > DBG.rmax) DBG.rmax = d;
    if(d > 80){ DBG.slow++; dbgLog("медленно", "перерисовка " + Math.round(d) + " мс"); }
  }
  function renderCore(){
    ensureShape();
    syncTirNav();
    if(state.viewPrev && state.prev){
      var pcur = state.prev;
      if(pcur.cur){
        /* просмотр ещё не начавшегося тиража: матчи берём из текущего купона, он обновляется сам */
        if(String(pcur.tirazh) === String(state.tirazh)){
          var snCur = snapPrev(state.tirazh, state.tirazhId, state.deadline, state.matches, state.poolSum);
          snCur.cur = true; snCur.at = pcur.at; state.prev = snCur;
        } else { delete pcur.cur; state.prevKeep = null; }   /* тираж начался: снимок стал обычным прошлым тиражом */
      }
      renderPrevView(); return;
    }
    rowsEl.innerHTML = "";
    state.matches.forEach(function(m, idx){
      var n = countPicks(m);
      var row = document.createElement("div");
      row.className = "row" + (m.mode==="lock" ? " is-lock" : "") + (n===0 ? " is-empty" : "");

      var num = document.createElement("div");
      num.className = "num"; num.textContent = String(idx+1);
      numNews(num, m, idx, false);
      row.appendChild(num);

      var fix = document.createElement("div");
      fix.className = "fix";
      var teams = document.createElement("div");
      teams.className = "teams";
      teams.title = m.home + " — " + m.away + (m.league ? " · " + m.league : "");
      var cont = continentCode(m.league);
      var hc = cont.hit ? teamCode(m.home) : null;
      var ac = cont.hit ? teamCode(m.away) : null;
      if(cont.hit && !hc && window.console && console.info){
        console.info("ДЖЕК: нет в таблице клубов — " + m.home);
      }
      if(cont.hit && !ac && window.console && console.info){
        console.info("ДЖЕК: нет в таблице клубов — " + m.away);
      }
      var natM = isNatLeague(m.league), he = mkEmb(m.home, hc || natM), ae = mkEmb(m.away, ac || natM);
      if(he) teams.appendChild(he); else if(hc) teams.appendChild(mkFlag(hc, "tflag", m.home));
      teams.appendChild(mkTeam(m.home, m.away));
      var vs = document.createElement("span"); vs.className="vs"; vs.textContent="—";
      teams.appendChild(vs);
      if(ae) teams.appendChild(ae); else if(ac) teams.appendChild(mkFlag(ac, "tflag", m.away));
      teams.appendChild(mkTeam(m.away, m.home));
      fix.appendChild(teams);
      var meta = document.createElement("div");
      meta.className="meta";
      /* флаг в подписи: страна турнира, а для континентальных — только если
         на самих командах флагов не оказалось, иначе рябит */
      var code = cont.hit ? ((hc || ac) ? null : cont.flag) : flagCode(m.league);
      if(code) meta.appendChild(mkFlag(code, "flag"));
      meta.appendChild(document.createTextNode(
        [m.date, m.time, m.league].filter(Boolean).join("  ·  ")));
      meta.appendChild(mkNewsBtn(m, idx, false));
      meta.appendChild(mkAiBtn(m, idx));
      if(m.res === VOID){
        teams.appendChild(mkVoid());
      } else if(!m.res && !m.score && m.fsVoid){
        teams.appendChild(mkFsVoid(m));
      } else if(m.res || m.score){
        var sc = document.createElement("span");
        /* подведённый счёт зелёный, живой — синий; сам исход всегда синий,
           чтобы читался отдельно от счёта */
        sc.className = "mscore" + (m.res ? "" : " live");
        fillScore(sc, m);
        sc.title = m.res ? "матч сыгран, итог " + m.res : "счёт по ходу матча, итог ещё не подведён";
        if(m.res){
          var rs = document.createElement("span");
          rs.className = "mres";
          rs.textContent = (m.score ? " · " : "") + m.res;
          rs.title = "итог матча";
          sc.appendChild(rs);
        }
        teams.appendChild(sc);          /* счёт стоит у названия матча, а не в подписи */
      }
      liveDecor(m, row, meta);
      fix.appendChild(meta);


      row.appendChild(fix);

      /* кто в этом матче собрал больше всего игроков, а кто меньше всего */
      var crowd = null;
      if(state.showPct && m.pct && m.pct.pool){
        var vals = [0,1,2].map(function(k){
          var x = Number(m.pct.pool[k]);
          return isFinite(x) ? x : null;
        });
        if(vals.indexOf(null) < 0){
          var sorted = vals.slice().sort(function(a, b){ return b - a; });
          var lead = PCT_GAP;
          crowd = {
            top: (sorted[0] - sorted[1] >= lead) ? sorted[0] : null,
            low: (sorted[1] - sorted[2] >= lead) ? sorted[2] : null
          };
        }
      }

      /* кэфы: у фаворита конторы он самый низкий, у аутсайдера самый высокий */
      var kfRank = null;
      if(state.showKf && m.kf){
        var kvals = [0,1,2].map(function(k){
          var x = Number(m.kf[k]);
          return isFinite(x) && x > 0 ? x : null;
        });
        if(kvals.indexOf(null) < 0){
          var ks = kvals.slice().sort(function(a, b){ return a - b; });
          kfRank = {
            fav: (ks[1] - ks[0] > 0.001) ? ks[0] : null,
            dog: (ks[2] - ks[1] > 0.001) ? ks[2] : null
          };
        }
      }

      var picksWrap = document.createElement("div");
      picksWrap.className = "picks-m";

      OUT.forEach(function(o,i){
        var cell = document.createElement("div");
        cell.className = "pick-cell";
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pick " + (o==="1"?"p1":o==="X"?"px":"p2");
        b.textContent = o;
        if(m.res === o) b.classList.add("won");
        b.setAttribute("aria-pressed", m.picks[o] ? "true" : "false");
        if(book && bookPages()[book.idx] && bookPages()[book.idx].length === state.matches.length
           && String(bookPages()[book.idx][idx]).indexOf(o) >= 0) b.classList.add("bk-on");
        /* просмотр после игры: угаданный исход — зелёный, мимо — красный */
        if(book && m.res && m.res !== VOID && bookPages()[book.idx] && bookPages()[book.idx].length === state.matches.length){
          var bkCell = String(bookPages()[book.idx][idx]);
          if(o === m.res) b.classList.add(bkCell.indexOf(o) >= 0 ? "bk-good" : "bk-real");
          else if(bkCell.indexOf(o) >= 0 && bkCell.indexOf(m.res) < 0) b.classList.add("bk-bad");
        }
        var inPool = m.pool.indexOf(o) >= 0;
        if(m.mode==="rand"){
          if(!inPool) b.classList.add("off-pool");
          if(inPool && !m.picks[o]) b.classList.add("in-pool");
          b.setAttribute("aria-label", m.home + " — " + m.away + ", исход " + o +
            (inPool ? ": участвует в жеребьёвке" : ": исключён из жеребьёвки"));
          b.title = inPool ? "Исход участвует в жеребьёвке. Клик — исключить."
                           : "Исход исключён. Клик — вернуть в жеребьёвку.";
          b.addEventListener("click", function(){
            var i = m.pool.indexOf(o);
            if(i >= 0){
              if(m.pool.length === 1) return;
              m.pool.splice(i, 1);
              if(m.picks[o]){
                m.picks[o] = false;
                if(countPicks(m) === 0) m.picks[m.pool[0]] = true;
              }
            } else {
              m.pool.push(o);
              m.pool.sort(function(a,c){ return OUT.indexOf(a) - OUT.indexOf(c); });
            }
            save(); render();
          });
        } else {
          b.setAttribute("aria-label", m.home + " — " + m.away + ", исход " + o);
          if(m.mode==="lock"){ b.disabled = true; }
          b.addEventListener("click", function(){
            m.picks[o] = !m.picks[o];
            save(); render();
          });
        }
        cell.appendChild(b);

        if(state.showPct && m.pct && m.pct.pool){
          var pl = Number(m.pct.pool[i]);
          var bk = m.pct.bk ? Number(m.pct.bk[i]) : null;
          var isTop = !!(crowd && crowd.top !== null && pl === crowd.top);
          var isLow = !!(crowd && crowd.low !== null && pl === crowd.low && !isTop);
          /* ничья загружена, если игроков на неё на 5+ п.п. больше, чем у конторы (а не просто >30% пула) */
          var xg = (i === 1 && bk !== null && isFinite(bk)) ? (pl - bk) : null;
          var xOver = (xg !== null && xg >= X_OVER_GAP);
          var col = document.createElement("div");
          col.className = "pct-col" + (isTop ? " lead" : (isLow ? " rare" : "")) + (xOver ? " x-over" : "");
          col.title = "Игроки " + pl + "%" + (bk === null ? "" : " · контора " + bk + "%") +
            (isTop ? " — больше всего игроков в этом матче, приз делить со многими"
             : isLow ? " — меньше всего игроков в этом матче" : "") +
            (xOver ? ". Ничья загружена: игроков на " + xg.toFixed(0) + " п.п. больше, чем у конторы. " +
                     "На архиве такие ничьи выпадали в 34,8% при доле игроков 37,1% — переплата на дележе около 2 п.п." : "");
          col.innerHTML = '<b>' + pl + '</b><i>' + (bk === null ? '\u2014' : bk) + '</i>' + (xOver ? '<u>!</u>' : '');
          cell.appendChild(col);
        }

        if(state.showKf){
          var kf = document.createElement("div");
          var kv = (m.kf && m.kf[i] != null) ? Number(m.kf[i]) : null;
          var isFav = !!(kfRank && kfRank.fav !== null && kv === kfRank.fav);
          var isDog = !!(kfRank && kfRank.dog !== null && kv === kfRank.dog && !isFav);
          kf.className = "kf-col" + (isFav ? " fav" : (isDog ? " dog" : ""));
          kf.textContent = (kv && isFinite(kv)) ? kv.toFixed(2) : "—";
          kf.title = (kv && isFinite(kv))
            ? ("Коэффициент конторы на этот исход" +
               (isFav ? " — самый низкий в матче, контора считает исход самым вероятным"
                : isDog ? " — самый высокий в матче, контора считает исход наименее вероятным" : ""))
            : "Контора коэффициент на этот исход не дала";
          cell.appendChild(kf);
        }

        picksWrap.appendChild(cell);
      });
      row.appendChild(picksWrap);

      var modes = document.createElement("div");
      modes.className = "modes";

      /* если в «рандоме» разыгрываются не все три исхода — показываем какие */
      if(m.mode === "rand" && m.pool.length < 3){
        var poolTag = document.createElement("span");
        poolTag.className = "pool-tag";
        poolTag.textContent = m.pool.join("/");
        poolTag.title = "Бросок разыграет в этой строке только " + m.pool.join(", ") +
                        ". Вернуть все три — «Снять режимы».";
        modes.appendChild(poolTag);
      }

      var bRand = document.createElement("button");
      bRand.type="button"; bRand.className="mode";
      bRand.setAttribute("aria-pressed", m.mode==="rand" ? "true":"false");
      bRand.title = "Рандом: бросок разыгрывает исход в этой строке";
      bRand.innerHTML = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="3" stroke="currentColor" stroke-width="2"/><circle cx="6.5" cy="6.5" r="1.6" fill="currentColor"/><circle cx="13.5" cy="13.5" r="1.6" fill="currentColor"/></svg>рандом';
      bRand.addEventListener("click", function(){
        if(m.mode === "rand"){ m.mode = "free"; }
        else {
          var cur = OUT.filter(function(o){ return m.picks[o]; });
          m.pool = (cur.length >= 1) ? cur : OUT.slice();
          m.mode = "rand";
        }
        save(); render();
      });

      var bLock = document.createElement("button");
      bLock.type="button"; bLock.className="mode";
      bLock.setAttribute("aria-pressed", m.mode==="lock" ? "true":"false");
      bLock.title = "Фикс: бросок эту строку не трогает";
      bLock.innerHTML = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3.5" y="8.5" width="13" height="9" rx="2" stroke="currentColor" stroke-width="2"/><path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" stroke-width="2"/></svg>фикс';
      bLock.addEventListener("click", function(){
        m.mode = (m.mode==="lock") ? "free" : "lock";
        save(); render();
      });

      modes.appendChild(bRand);
      modes.appendChild(bLock);
      modes.appendChild(mkFs(m));
      modes.appendChild(mkNewsMode(m, idx, false));
      modes.appendChild(mkAiMode(m, idx));
      row.appendChild(modes);

      rowsEl.appendChild(row);
    });

    var t = tally();

    var hint = $("hint");
    if(hintSticky){ hintSticky = false; }
    else if(t.empty>0){
      hint.hidden = false;
      hint.textContent = "В " + t.empty + " матч(ах) не выбрано ни одного исхода — купон неполный, комбинации не считаются.";
    } else if(t.combos > MAX_CSV){
      hint.hidden = false;
      hint.textContent = "Комбинаций больше " + fmt(MAX_CSV) + " — выгрузка в CSV отключена, файл будет неподъёмным.";
    } else { hint.hidden = true; }

    var note = $("rollNote");
    note.classList.remove("done");
    $("btnSpin").disabled = t.rand === 0 || spinning;
    if($("btnPreset")) $("btnPreset").disabled = spinning;
    if($("btnFinal")) $("btnFinal").disabled = spinning;
    if(t.rand===0){
      note.innerHTML = "Ни один матч не помечен «рандом». Разыгрывать нечего.";
    } else {
      var narrow = state.matches.filter(function(m){ return m.mode==="rand" && m.pool.length < 3; }).length;
      var frozen = state.matches.filter(function(m){ return m.mode==="rand" && m.pool.length === 1; }).length;
      note.innerHTML = "«РАНДОМ» поставит по одному случайному исходу в <b>" + t.rand + "</b> матч(ах)" +
        (narrow ? ", в <b>" + narrow + "</b> из них — только из отмеченных" : "") +
        ". Зафиксировано руками: <b>" + t.locked + "</b>." +
        (frozen ? " <b>Внимание:</b> в " + frozen + " строк(ах) в жеребьёвке остался один исход — там при броске ничего не меняется" +
                  (frozen === t.rand ? ", поэтому выбор будет крутиться вхолостую" : "") +
                  ". Вернуть все три — кнопкой «Снять режимы»." : "");
    }
    ujSync();
    $("btnKeep").disabled = t.empty > 0 || spinning;
    $("sbRoll").disabled = $("btnSpin").disabled;
    $("sbKeep").disabled = $("btnKeep").disabled;
    $("sbSum").textContent = t.empty > 0
      ? t.empty + " матч(ей) без исхода"
      : fmt(t.combos) + " комб. · " + fmt(t.combos * (Number(state.price)||0)) + " ₽";
    $("keepNote").textContent = t.empty > 0
      ? "Сначала выбери исход в каждом из " + t.empty + " пустых матч(ей)."
      : "Купон, собранный руками, попадёт в корзину и в CSV: " +
        fmt(t.combos) + " строк, " + fmt(t.combos * (Number(state.price)||0)) + " ₽.";

    var price = Number(state.price) || 0;

    var ph = $("priceHint");
    ph.textContent = t.empty > 0
      ? "нужны все 15 исходов"
      : (t.combos > 1
          ? fmt(price) + " ₽ × " + fmt(t.combos) + " вар. = " + fmt(t.combos * price) + " ₽ за купон"
          : fmt(price) + " ₽ за один вариант");
    /* в поле должна стоять цена ОДНОГО варианта: однажды 240 вместо 30 стоило восьмикратной ставки */
    var priceOdd = price > 100;
    if(priceOdd && t.empty === 0){
      ph.textContent = "это за ОДИН вариант! спишут " + fmt(t.combos * price) + " ₽";
    }
    ph.classList.toggle("warn", priceOdd);
    $("priceLine").classList.toggle("warn", priceOdd);

    var plan = csvPlan();
    var en = $("expNote");
    en.classList.remove("warn");
    if(plan.take.length){
      en.textContent = "В файл уйдут отмеченные варианты из корзины: " + plan.take.length +
        " шт., " + fmt(plan.total) + " строк, " + fmt(plan.total * price) + " ₽." +
        (plan.off ? " Без галочки и мимо файла: " + plan.off + "." : "") +
        (plan.skipped ? " Пропущено записей от другого списка матчей: " + plan.skipped + "." : "");
      var cd = csvDupLines(plan);
      en.classList.toggle("warn", cd.lines > 0);
      if(cd.lines) en.textContent += " Внимание: в файле " + fmt(cd.lines) + " одинаковых строк(и)" +
        (cd.coupons ? ", из них одинаковых купонов: " + fmt(cd.coupons) + " — убрать их можно кнопкой «Убрать повторы» в корзине" :
          " — это варианты, которые уже входят в другой купон или систему") + ". Каждая такая строка оплачивается ещё раз.";
      $("btnCsv").disabled = plan.total > MAX_CSV;
      $("btnSend").disabled = $("btnCsv").disabled;
      $("btnCsvSys").disabled = false;
    } else if(t.empty){
      en.textContent = (state.played.length ? "В корзине не отмечено ни одного варианта" : "Корзина пуста") + ", а в купоне есть матчи без исхода — заполни или брось.";
      $("btnCsv").disabled = true;
      $("btnSend").disabled = true;
      $("btnCsvSys").disabled = true;
    } else {
      en.textContent = (state.played.length ? "В корзине не отмечено ни одного варианта" : "Корзина пуста") +
        " — уйдёт то, что сейчас в купоне: " + fmt(t.combos) + " строк, " + fmt(t.combos * price) + " ₽.";
      $("btnCsv").disabled = t.combos > MAX_CSV;
      $("btnSend").disabled = $("btnCsv").disabled;
      $("btnCsvSys").disabled = t.empty > 0;
    }
    $("btnSendSys").disabled = $("btnCsvSys").disabled;
    if(book){
      ["btnCsv","btnSend","btnCsvSys","btnSendSys"].forEach(function(id){ $(id).disabled = false; });
      en.textContent = "Открыт файл «" + book.name + "» — пока он открыт, кнопки ниже работают с НИМ, а не с корзиной: «по 1 купону» — " +
        fmt(book.rows.length) + " вариант(ов) по одному в строке" + (book.text ? ", «с допами» — сам файл как есть" : "") +
        ". Закроешь просмотр — кнопки вернутся к корзине и купону.";
    }

    document.documentElement.setAttribute("data-compact", state.compact ? "1" : "0");
    applyZoom();
    try{ updateCsvPrev(); }catch(e){}

    var havePct = state.matches.some(function(m){ return m.pct; });
    var pvMs = (state.viewPrev && state.prev) ? state.prev.matches : null;
    var havePvPct = !!pvMs && pvMs.some(function(m){ return m.pct; }), havePvKf = !!pvMs && pvMs.some(function(m){ return m.kf; });
    $("btnMost").disabled = !havePct || spinning;
    $("btnLeast").disabled = !havePct || spinning;
    $("btnMid").disabled = !havePct || spinning;
    $("btnMid").title = havePct ? "В каждом матче поставить исход со средней долей игроков — между самым популярным и самым редким" : "Нет процентов — сначала «Обновить тираж»";
    $("btnMost").title = havePct
      ? "В каждом матче поставить исход, который выбрало больше всего игроков"
      : "Нет процентов — сначала «Обновить тираж»";
    $("btnLeast").title = havePct
      ? "В каждом матче поставить исход, который выбрало меньше всего игроков"
      : "Нет процентов — сначала «Обновить тираж»";
    var pb = $("btnPct");
    pb.hidden = false; pb.disabled = pvMs ? !havePvPct : !havePct;
    pb.setAttribute("aria-pressed", state.showPct ? "true" : "false");
    pb.textContent = state.showPct ? "Скрыть проценты" : "Показать проценты";
    pb.title = state.showPct
      ? "Убрать доли игроков и конторы из строк"
      : "Показать под каждым исходом долю игроков и оценку конторы";
    var haveKf = pvMs ? havePvKf : state.matches.some(function(m){ return m.kf; });
    var kb = $("btnKf");
    kb.hidden = false; kb.disabled = !haveKf;
    kb.setAttribute("aria-pressed", state.showKf ? "true" : "false");
    kb.textContent = state.showKf ? "Скрыть кэфы" : "Показать кэфы";
    kb.title = state.showKf
      ? "Убрать коэффициенты конторы из строк"
      : "Показать под каждым исходом коэффициент конторы из того же тиража";
    $("pctLegend").hidden = !(((pvMs ? havePvPct : havePct) && state.showPct) || (haveKf && state.showKf));
    /* ручка влияет только на стрелки, а стрелки живут вместе с процентами —
       прячем её, пока проценты выключены, иначе выглядит как неработающая */
    renderKickoff();
    renderHistory();
  }

  var histArmed = -1, histTimer = null;
  var HIST_SHOW = 200;   /* сколько вариантов корзины рисуем разом: тысячи строк DOM тормозили бы страницу */
  var clearArmed = 0, clearTimer = null;
  /* одинаковые купоны в корзине: оригинал — самый ранний, остальные помечаются «повтор» */
  function histDups(){
    var first = {}, mark = {}, n = 0;
    for(var i = state.played.length - 1; i >= 0; i--){
      var v = state.played[i]; if(!v.sig) continue;
      if(first[v.sig] == null) first[v.sig] = i;
      else { mark[i] = first[v.sig]; n++; }
    }
    return { mark: mark, n: n };
  }
  /* сколько одинаковых строк уйдёт в CSV — в том числе ординар, целиком лежащий внутри системы */
  function csvDupLines(plan){
    if(!plan.take.length || plan.total > 50000) return { coupons: 0, lines: 0 };
    var sigs = {}, coupons = 0, seen = {}, lines = 0;
    plan.take.forEach(function(v){
      if(v.sig){ if(sigs[v.sig]) coupons++; sigs[v.sig] = 1; }
      var rows = enumerate(vSnap(v));
      if(rows === null || rows === "toobig") return;
      for(var r = 0; r < rows.length; r++){ var k = rows[r].join(""); if(seen[k]) lines++; else seen[k] = 1; }
    });
    return { coupons: coupons, lines: lines };
  }

  function renderHistory(){
    var ul = $("hist"); ul.innerHTML = "";
    var dups = histDups();
    $("histEmpty").hidden = state.played.length > 0;
    /* общая сумма по сыгранным: считаем прямо из списка, чтобы «Очистить список»
       обнулял её сам собой и не расходился со сводкой */
    var sum = 0, rows = 0, on = 0;
    state.played.forEach(function(v){
      if(v.sel === false) return;                 /* в сводку идёт то же, что уйдёт в файл */
      var n = variantCombos(v) || (v.combos || 0);
      on++; rows += n;
      sum += (v.cost != null) ? Number(v.cost) : n * (Number(state.price) || 0);
    });
    $("histSum").textContent = state.played.length
      ? "отмечено " + fmt(on) + " из " + fmt(state.played.length) +
        " · " + fmt(rows) + " строк · " + fmt(sum) + " ₽" +
        (dups.n ? " · повторов: " + fmt(dups.n) : "")
      : "";
    var bd = $("btnDedup");
    if(bd){ bd.hidden = !dups.n; bd.disabled = !dups.n; }
    var sa = $("btnSelAll");
    sa.disabled = state.played.length === 0;
    (sa.querySelector(".lbl") || sa).textContent = (on === state.played.length && on > 0) ? "Снять все" : "Отметить все";
    var cb = $("btnClearHist");
    cb.disabled = state.played.length === 0;
    if(cb.disabled && cb.classList.contains("danger")){
      clearArmed = 0; clearTimeout(clearTimer);
      (cb.querySelector(".lbl") || cb).textContent = "Очистить корзину"; cb.classList.remove("danger");
    }
    var shown = Math.min(state.played.length, HIST_SHOW);
    for(var i = 0; i < shown; i++){ (function(h, i){
      var li = document.createElement("li");
      if(h.sel === false) li.classList.add("is-off");
      if(dups.mark[i] != null) li.classList.add("is-dup");

      var cbw = document.createElement("label");
      cbw.className = "hist-cb";
      cbw.title = "Галочка — вариант уходит в CSV. Снять — останется в корзине, но в файл не попадёт.";
      var cbi = document.createElement("input");
      cbi.type = "checkbox";
      cbi.checked = h.sel !== false;
      cbi.setAttribute("aria-label", "Выгружать вариант " + h.at + " · " + h.label + " в CSV");
      cbi.addEventListener("change", function(){
        h.sel = cbi.checked ? true : false;
        save(); render();
      });
      cbw.appendChild(cbi);
      li.appendChild(cbw);

      var left = document.createElement("div");
      var top = document.createElement("div");
      top.style.fontWeight = "500";
      top.textContent = h.at + " · " + h.label +
        (h.combos ? "  ·  " + fmt(h.combos) + " комб. / " + fmt(h.cost || 0) + " ₽" : "");
      var sig = document.createElement("div");
      sig.className = "sig"; sig.textContent = h.sig;
      if(dups.mark[i] != null){
        var o = state.played[dups.mark[i]];
        var badge = document.createElement("span");
        badge.className = "dup-badge";
        badge.textContent = "повтор";
        badge.title = "Точно такой же купон уже лежит в корзине: " + o.at + " · " + o.label;
        top.appendChild(document.createTextNode(" "));
        top.appendChild(badge);
      }
      left.appendChild(top); left.appendChild(sig);
      var acts = document.createElement("div");
      acts.className = "hist-acts";

      var b = document.createElement("button");
      b.type="button"; b.textContent = "В купон";
      b.title = "Загрузить этот вариант обратно в купон";
      b.addEventListener("click", function(){ restore(h); });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "hist-del";
      del.setAttribute("aria-label", "Удалить вариант " + h.at + " · " + h.label);
      del.title = "Убрать этот вариант из списка и из выгрузки";
      del.innerHTML = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
        '<path d="M4 6h12M8.5 6V4.5h3V6M6.5 6l.7 9.5h5.6L13.5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      if(i === histArmed){ del.classList.add("danger"); del.title = "Нажми ещё раз — вариант удалится"; }
      del.addEventListener("click", function(e){
        e.stopPropagation();
        if(histArmed !== i){
          /* первое нажатие только взводит кнопку: без перерисовки и без таймера,
             чтобы ряд не сдвигался; снимается нажатием в любом другом месте */
          histArmed = i;
          [].forEach.call(document.querySelectorAll("#hist .hist-del.danger"), function(x){ x.classList.remove("danger"); x.title = "Убрать этот вариант из списка и из выгрузки"; });
          del.classList.add("danger");
          del.title = "Нажми ещё раз — вариант удалится";
          return;
        }
        histArmed = -1;
        pushBasketUndo("вариант " + (h.label || "") , [[i, state.played[i]]]);
        state.played.splice(i, 1);
        save(); render();
      });

      acts.appendChild(b); acts.appendChild(del);
      left.style.flex = "1 1 auto"; left.style.minWidth = "0";
      li.appendChild(left); li.appendChild(acts);
      ul.appendChild(li);
    })(state.played[i], i); }
    if(shown < state.played.length){
      var more = document.createElement("li");
      more.className = "hist-more";
      var mb = document.createElement("button");
      mb.type = "button"; mb.className = "btn-ev";
      mb.textContent = "Ещё " + fmt(Math.min(200, state.played.length - shown)) + " · осталось " + fmt(state.played.length - shown);
      mb.title = "В файл и в сводку уходят все варианты, а не только показанные";
      mb.addEventListener("click", function(){ HIST_SHOW += 200; renderHistory(); });
      more.appendChild(mb); ul.appendChild(more);
    }
  }

  function restore(h){
    pushHistory("до возврата");
    var hs = vSnap(h) || [];
    state.matches.forEach(function(m, i){
      var s = hs[i];
      if(!s) return;
      m.picks = {"1":s.picks["1"], "X":s.picks["X"], "2":s.picks["2"]};
      m.mode = s.mode;
      if(Array.isArray(s.pool) && s.pool.length) m.pool = s.pool.slice();
    });
    save(); render();
  }

  /* ---------- actions ---------- */
  /* Сколько исходов раздать каждому «рандомному» матчу, чтобы уложиться в цель.
     base — произведение исходов по матчам, которые бросок не трогает.
     Возвращает массив длины n из 1/2/3 (перемешанный) и итоговое число комбинаций. */
  /* Бросок всегда ставит по одному исходу в каждую строку с «рандомом» —
     режим до бюджета убран, ширину строк задаёшь руками. */
  function planSizes(n){
    var sizes = [];
    for(var i=0;i<n;i++) sizes.push(1);
    return {sizes:sizes, combos:1};
  }

  function pickN(k, src){
    var pool = (src && src.length ? src : OUT).slice();
    for(var i=pool.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, k);
  }

  /* перекрасить только кнопки исходов — без пересборки строк, чтобы шла анимация */
  function paintPicks(){
    var rows = rowsEl.children;
    state.matches.forEach(function(m, i){
      var row = rows[i]; if(!row) return;
      var btns = row.querySelectorAll(".pick");
      OUT.forEach(function(o, k){
        var b = btns[k]; if(!b) return;
        var on = !!m.picks[o];
        if((b.getAttribute("aria-pressed") === "true") === on) return;
        b.setAttribute("aria-pressed", on ? "true" : "false");
        if(m.mode === "rand"){
          b.classList.toggle("in-pool", !on && m.pool.indexOf(o) >= 0);
        }
        b.classList.remove("pop");
        if(on){ void b.offsetWidth; b.classList.add("pop"); }
      });
    });
  }

  /* набор подписей всех уже сыгранных вариантов — чтобы не платить дважды за одно и то же */
  function playedSigs(){
    var seen = {};
    state.played.forEach(function(v){ if(v.sig) seen[v.sig] = true; });
    return seen;
  }

  /* перетасовывать, пока не выпадет комбинация, которой ещё не было в списке */
  function shuffleFresh(){
    var seen = playedSigs(), tries = 0, fresh = false;
    do {
      if(!shuffleOnce()) return true;
      tries++;
      fresh = !seen[signature(state.matches)];
    } while(!fresh && tries < 80);
    return fresh;
  }

  /* одна перетасовка исходов — без истории, без счёта и без денег */
  function shuffleOnce(){
    ensureShape();
    var rand = state.matches.filter(function(m){ return m.mode === "rand"; });
    if(!rand.length) return false;
    var plan = planSizes(rand.length);
    rand.forEach(function(m, i){
      var want = Math.min(plan.sizes[i] || 1, m.pool.length);
      var chosen = pickN(want, m.pool);
      m.picks = {"1":false,"X":false,"2":false};
      chosen.forEach(function(o){ m.picks[o] = true; });
    });
    return true;
  }

  /* При открытии и перезагрузке страницы купон должен быть пустым: проставленные
     исходы — это заготовка, а не решение, и каждый раз начинать с чужой раскладки
     неудобно. Зафиксированные строки не трогаем, а прежний набор кладём в историю,
     чтобы «Назад» поднял его, если страницу перезагрузили случайно. */
  function clearOnLoad(){
    ensureShape();
    var had = state.matches.some(function(m){
      return countPicks(m) > 0 || m.mode !== "free" || (m.pool || OUT).length !== 3;
    });
    if(!had) return false;
    pushHistory("до очистки при загрузке");
    state.matches.forEach(function(m){
      m.picks = {"1":false, "X":false, "2":false};
      m.mode = "free";
      m.pool = OUT.slice();
    });
    save();
    return true;
  }

  /* вариант принят: +1 к счётчику, стоимость уходит в банк */
  function commitVariant(extra, label){
    state.rolls++;
    var t0 = tally();
    var cost0 = t0.empty ? 0 : t0.combos * (Number(state.price)||0);
    state.spent += cost0;
    state.played.unshift({
      at: new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}),
      label: label || ("бросок №" + state.rolls),
      sig: signature(state.matches),
      combos: t0.combos,
      cost: cost0,
      snap: state.matches.map(function(m){
        return {picks:{"1":m.picks["1"],"X":m.picks["X"],"2":m.picks["2"]}, mode:m.mode, pool:(m.pool || OUT).slice()};
      })
    });
    if(state.played.length > BASKET_MAX) state.played.length = BASKET_MAX;
    save(); render();
    var note = $("rollNote");
    note.classList.add("done");
    note.innerHTML = (extra || "Брошено") + ": <b>" + fmt(t0.combos) + "</b> комбинац(ий) на <b>" + fmt(cost0) +
      " ₽</b>. Всего по тиражу: <b>" + fmt(state.spent) + " ₽</b> за " + state.rolls + " вариант(ов).";
  }

  /* купон собран руками — записать его в сыгранные, ничего не разыгрывая */
  $("btnKeep").addEventListener("click", function(){
    if(spinning) return;
    var t0 = tally();
    if(t0.empty > 0){
      say("В " + t0.empty + " матч(ах) не выбран исход — записывать нечего. Отметь исходы во всех строках.");
      return;
    }
    var sig = signature(state.matches);
    var dup = state.played.some(function(v){ return v.sig === sig; });
    commitVariant("Записано вручную", "вручную №" + (state.rolls + 1));
    if(dup) say("Такой же вариант в списке уже был — записал ещё раз. Лишний убирается корзиной в «Сыгранных вариантах».");
  });

  /* подсказку подкручиваем в поле зрения только после действий человека:
     сообщения при загрузке не должны уводить страницу с обложки */
  var userActed = false;
  ["pointerdown", "keydown", "touchstart"].forEach(function(ev){
    document.addEventListener(ev, function(){ userActed = true; }, { capture: true, passive: true });
  });
  function say(msg){
    hintSticky = true;
    var h = $("hint");
    h.hidden = false;
    h.textContent = msg;
    if(userActed) h.scrollIntoView({block:"nearest"});
  }

  function norm(x){
    return String(x || "").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/g," ").trim();
  }

  if($("btnPreset")) $("btnPreset").addEventListener("click", function(){
   try{
    if(spinning) return;
    if(!presetFits()) return;

    pushHistory("до выбора Claude " + PRESET.date);

    /* Купон пустой и без режимов — разбору не на чем работать.
       Тогда заодно помечаем строки «рандом» и ставим по исходу, чтобы было что бросать. */
    var blank = state.matches.every(function(m){
      return m.mode === "free" && countPicks(m) === 0;
    });

    var applied = 0, lockedSkipped = 0, dropped = 0, randRows = 0;
    state.matches.forEach(function(m, i){
      var drop = PRESET.rows[i][1];
      var pool = OUT.filter(function(o){ return o !== drop; });
      if(!pool.length) return;
      m.pool = pool;
      applied++;
      if(blank){
        m.mode = "rand";
        m.picks = {"1":false,"X":false,"2":false};
        m.picks[pool[Math.floor(Math.random()*pool.length)]] = true;
      }
      if(m.mode === "rand") randRows++;
      if(m.mode === "lock"){ lockedSkipped++; return; }   /* зафиксированное не трогаем */
      if(m.picks[drop]){
        m.picks[drop] = false;
        dropped++;
        if(countPicks(m) === 0) m.picks[pool[Math.floor(Math.random()*pool.length)]] = true;
      }
    });
    save(); render();

    var msg = "Выбор Claude от " + PRESET.date + ": исключения проставлены во всех " + applied + " матчах" +
      (dropped ? ", в " + dropped + " строк(ах) исключённый исход снят с выбора" : "") + ". ";
    if(blank){
      msg += "Купон был пустой, поэтому все строки помечены «рандом» и заполнены случайным исходом из двух оставшихся — можно сразу бросать.";
    } else if(randRows === 0){
      msg += "Но сейчас ни одна строка не помечена «рандом», поэтому на бросок это ничего не меняет — " +
             "нажми «Все в рандом», и жеребьёвка пойдёт только по двум оставшимся исходам.";
    } else {
      msg += "В " + randRows + " строк(ах) с пометкой «рандом» жеребьёвка теперь идёт только между двумя оставшимися исходами" +
             (lockedSkipped ? "; зафиксированных строк не трогал: " + lockedSkipped : "") + ".";
    }
    msg += " Исключённые исходы в таблице показаны бледными.";
    say(msg);
   }catch(err){
    say("Кнопка «Выбор Claude» споткнулась: " + (err && (err.message || err)) + ". Покажи этот текст Клоду.");
   }
  });

  /* общая сверка: тот ли это тираж */
  function presetFits(){
    if(state.matches.length !== PRESET.rows.length){
      say("Разбор Claude от " + PRESET.date + " рассчитан на " + PRESET.rows.length +
          " матчей, а в купоне сейчас " + state.matches.length + " — не применяю, чтобы не испортить список.");
      return false;
    }
    var bad = [];
    state.matches.forEach(function(m, i){
      var want = norm(PRESET.rows[i][0]), have = norm(m.home);
      var w0 = want.split(" ").pop(), h0 = have.split(" ").pop();
      if(have.indexOf(want) < 0 && want.indexOf(have) < 0 && w0 !== h0) bad.push((i+1) + " («" + m.home + "» вместо «" + PRESET.rows[i][0] + "»)");
    });
    if(bad.length > 4){
      say("Список матчей не совпадает с разбором Claude от " + PRESET.date + ". Расходятся строки: " +
          bad.slice(0,5).join("; ") + (bad.length>5 ? " и ещё " + (bad.length-5) : "") + ". Не применяю.");
      return false;
    }
    return true;
  }

  if($("btnFinal")) $("btnFinal").addEventListener("click", function(){
   try{
    if(spinning) return;
    if(!Array.isArray(PRESET.final) || PRESET.final.length !== PRESET.rows.length){
      say("Итоговый билет для этого тиража ещё не заполнен."); return;
    }
    if(!presetFits()) return;

    pushHistory("до итога Claude " + PRESET.date);
    var set = 0, locked = 0;
    state.matches.forEach(function(m, i){
      var o = PRESET.final[i];
      if(OUT.indexOf(o) < 0) return;
      m.pool = OUT.filter(function(x){ return x !== PRESET.rows[i][1]; });
      if(m.mode === "lock"){ locked++; return; }      /* зафиксированное руками не трогаем */
      m.picks = {"1":false,"X":false,"2":false};
      m.picks[o] = true;
      m.mode = "free";
      set++;
    });
    save(); render();
    var t0 = tally();
    say("Итог Claude от " + PRESET.date + " проставлен в " + set + " матч(ах)" +
        (locked ? ", зафиксированных руками не трогал: " + locked : "") + ". " +
        "Получилось " + fmt(t0.combos) + " комбинац(ий) на " + fmt(t0.combos * (Number(state.price)||0)) + " ₽. " +
        "Строки без пометки «рандом» бросок не меняет — помечай те, которые хочешь разыграть.");
   }catch(err){
    say("Кнопка «Итог Claude» споткнулась: " + (err && (err.message || err)) + ". Покажи этот текст Клоду.");
   }
  });

  var spinning = false;
  var hintSticky = false;

  /* Прокрутка только расставляет исходы. В корзину вариант попадает
     исключительно кнопкой «Положить купон в корзину» — иначе там копится
     мусор, которого человек не просил. */
  function afterSpin(n){
    var t0 = tally();
    var cost0 = t0.empty ? 0 : t0.combos * (Number(state.price) || 0);
    save(); render();
    var note = $("rollNote");
    note.classList.add("done");
    note.innerHTML = "РАНДОМ ×" + fmt(n) + " — остановилось на <b>" + fmt(t0.combos) +
      "</b> комбинац(иях) на <b>" + fmt(cost0) + " ₽</b>. В корзину ничего не ушло: " +
      "чтобы сохранить — «Положить купон в корзину».";
  }
  $("btnSpin").addEventListener("click", function(){
    if(spinning) return;
    if(!state.matches.some(function(m){ return m.mode === "rand"; })) return;
    var n = Math.max(1, Math.min(100000, Math.floor(Number(state.spins) || 1)));
    pushHistory("до прокрутки");
    spinning = true;
    $("btnSpin").disabled = true; $("btnUndo").disabled = true; $("btnRedo").disabled = true;
    var base = Number(state.speed) || 0;
    if(base === 0){                       /* без анимации — считаем разом */
      for(var q=0;q<n-1;q++) shuffleOnce();
      shuffleFresh();
      spinning = false;
      afterSpin(n);
      return;
    }
    var FRAMES = Math.min(n, 22);   /* число кадров фиксировано, скорость задаёт паузу между ними */
    var CHUNK = Math.max(1, Math.ceil(n / FRAMES));
    var done = 0, frame = 0;
    $("coupon").classList.add("spinning");
    (function step(){
      var k = 0;
      while(done < n && k < CHUNK){ shuffleOnce(); done++; k++; }
      paintPicks();
      frame++;
      $("rollNote").classList.add("done");
      $("rollNote").innerHTML = "Крутится… <b>" + fmt(done) + "</b> из <b>" + fmt(n) + "</b>";
      if(done < n){
        /* замедление к концу, как барабан */
        var t = frame / FRAMES;
        setTimeout(step, Math.round(base * (1 + 2.6 * t * t * t)));
      } else {
        setTimeout(function(){
          $("coupon").classList.remove("spinning");
          shuffleFresh(); paintPicks();
          spinning = false;
          afterSpin(n);
        }, Math.round(base * 1.6));
      }
    })();
  });

  /* «Назад» кладёт текущий вид в «Вперёд», «Вперёд» — обратно в «Назад» */
  $("btnUndo").addEventListener("click", function(){ ujMove(UJ.back, UJ.fwd); });
  $("btnRedo").addEventListener("click", function(){ ujMove(UJ.fwd, UJ.back); });

  function disarmClear(){
    var b = $("btnClearHist");
    clearArmed = 0;
    clearTimeout(clearTimer);
    (b.querySelector(".lbl") || b).textContent = "Очистить корзину";
    b.classList.remove("danger");
  }

  $("btnDedup").addEventListener("click", function(){
    var d = histDups();
    if(!d.n) return;
    pushBasketUndo("повторы (" + d.n + ")", state.played.map(function(v, i){ return [i, v]; }).filter(function(p){ return d.mark[p[0]] != null; }));
    state.played = state.played.filter(function(v, i){ return d.mark[i] == null; });
    save(); render();
    say("Убрано повторов: " + fmt(d.n) + ". Оставлен самый ранний экземпляр каждого купона. Отменить — «Назад».");
  });

  $("btnSelAll").addEventListener("click", function(){
    if(!state.played.length) return;
    var allOn = state.played.every(function(v){ return v.sel !== false; });
    state.played.forEach(function(v){ v.sel = !allOn; });
    save(); render();
    say(allOn ? "Галочки сняты со всех вариантов — в CSV сейчас не уйдёт ни один."
              : "Отмечены все варианты в корзине — в CSV уйдут все.");
  });

  /* взведённые «удалить» и «очистить» снимаются нажатием в любом другом месте */
  document.addEventListener("click", function(e){
    if(histArmed !== -1 && !(e.target.closest && e.target.closest(".hist-del"))){
      histArmed = -1;
      [].forEach.call(document.querySelectorAll("#hist .hist-del.danger"), function(x){ x.classList.remove("danger"); x.title = "Убрать этот вариант из списка и из выгрузки"; });
    }
    if(clearArmed && !(e.target.closest && e.target.closest("#btnClearHist"))) disarmClear();
  }, true);
  $("btnClearHist").addEventListener("click", function(){
    var b = $("btnClearHist");
    if(!state.played.length){ disarmClear(); return; }
    if(!clearArmed){
      clearArmed = 1;
      (b.querySelector(".lbl") || b).textContent = "Точно очистить?";
      b.classList.add("danger");
      return;
    }
    disarmClear();
    var n = state.played.length;
    pushBasketUndo("вся корзина (" + n + ")", state.played.map(function(v, i){ return [i, v]; }));
    state.played = [];
    histArmed = -1;
    save(); render();
    say("Корзина очищена: убрано " + n + " шт. Вернуть — «Назад».");
  });

  /* Расстановка по долям игроков (строка «П»): most=true — самый популярный исход
     в каждом матче, most=false — самый непопулярный. Зафиксированные строки не трогаем. */
  function pickByCrowd(most){
    if(spinning) return;
    if(!state.matches.some(function(m){ return m.pct && m.pct.pool; })){
      say("В строках нет процентов — сначала нажми «Обновить тираж», чтобы подтянуть доли игроков с totobrief.");
      return;
    }
    var mid = most === "mid";   /* «средние»: исход со средней долей игроков — не самый популярный и не самый редкий */
    pushHistory(mid ? "до расстановки средних" : (most ? "до расстановки большинства" : "до расстановки меньшинства"));
    var set = 0, locked = 0, noData = 0, ties = 0;
    state.matches.forEach(function(m){
      if(!(m.pct && m.pct.pool)){ noData++; return; }
      if(m.mode === "lock"){ locked++; return; }
      var vals = [];
      for(var i=0;i<3;i++){
        var v = Number(m.pct.pool[i]);
        vals.push(isFinite(v) ? v : (mid ? NaN : (most ? -1 : Infinity)));
      }
      var target = mid ? vals.slice().sort(function(a, b){ return a - b; })[1]
                     : (most ? Math.max(vals[0], vals[1], vals[2]) : Math.min(vals[0], vals[1], vals[2]));
      if(!isFinite(target)){ noData++; return; }
      if(vals.filter(function(x){ return x === target; }).length > 1) ties++;
      m.picks = {"1":false,"X":false,"2":false};
      m.picks[OUT[vals.indexOf(target)]] = true;
      m.mode = "free"; /* иначе бросок тут же перебьёт расстановку */
      set++;
    });
    save(); render();
    var t0 = tally();
    say((mid ? "Средние" : (most ? "Большинство" : "Меньшинство")) + " по долям игроков проставлено в " + set + " матч(ах)" +
        (locked ? ", зафиксированных не трогал: " + locked : "") +
        (noData ? ", без процентов пропущено: " + noData : "") +
        (ties ? ", в " + ties + " матч(ах) доли совпали — взят первый по порядку 1/X/2" : "") +
        ". Получилось " + fmt(t0.combos) + " комбинац(ий) на " + fmt(t0.combos * (Number(state.price)||0)) + " ₽. " +
        "Эти строки переведены в обычный режим, чтобы бросок их не перебил — вернуть в жеребьёвку можно кнопкой «Все в рандом».");
  }

  $("btnMost").addEventListener("click", function(){ pickByCrowd(true); });
  $("btnMid").addEventListener("click", function(){ pickByCrowd("mid"); });
  $("btnLeast").addEventListener("click", function(){ pickByCrowd(false); });

  $("btnMarkAll").addEventListener("click", function(){
    pushHistory("до «все в рандом»");
    var marked = 0, locked = 0, narrow = 0, widened = 0;
    state.matches.forEach(function(m){
      if(m.mode === "lock"){ locked++; return; }
      var cur = OUT.filter(function(o){ return m.picks[o]; });
      /* два-три отмеченных исхода — считаем это осознанным сужением и сохраняем;
         один или ноль — возвращаем все три, иначе строка застынет и бросок в ней ничего не изменит */
      if(cur.length >= 2){ m.pool = cur; }
      else { m.pool = OUT.slice(); widened++; }
      m.mode = "rand";
      marked++;
      if(m.pool.length < 3) narrow++;
    });
    save(); render();
    say("Помечено «рандом»: " + marked + " строк(и)" +
        (locked ? ", зафиксированных не трогал: " + locked : "") + ". " +
        (narrow ? "В " + narrow + " из них жеребьёвка идёт только по отмеченным исходам — они показаны рамкой справа. "
                : "") +
        (widened ? "В остальных вернул все три исхода." : ""));
  });
  $("btnClearModes").addEventListener("click", function(){
    pushHistory("до снятия режимов");
    var cleared = 0, locked = 0;
    state.matches.forEach(function(m){
      if(m.mode === "lock"){ locked++; return; } /* «фикс» снимается только вручную в строке */
      m.mode = "free";
      m.pool = OUT.slice();
      cleared++;
    });
    save(); render();
    say("«Рандом» снят с " + cleared + " строк(и), наборы исходов вернулись к полным 1/X/2" +
        (locked ? ". Зафиксированных строк не трогал: " + locked + " — «фикс» снимается кнопкой в самой строке" : "") +
        ". Отменить — «Назад».");
  });
  $("btnReset").addEventListener("click", function(){
    pushHistory("очистка");
    state.matches.forEach(function(m){ if(m.mode!=="lock") m.picks={"1":false,"X":false,"2":false}; });
    save(); render();
  });

  $("tirazhName").addEventListener("input", function(e){ state.tirazh = e.target.value; save(); });
  $("btnTirPrev").addEventListener("click", enterPrev);
  $("btnTirNext").addEventListener("click", leavePrev);
  /* кнопка «ТИРАЖИ»: страница наблюдения — вкладки «Предыдущий» и «Текущий»; повторное нажатие возвращает к купону */
  $("btnTirages").addEventListener("click", function(){
    if(state.viewPrev){ leavePrev(); return; }
    if(state.matches.length) enterCurView(); else enterPrev();
  });
  $("tirazhName").value = state.tirazh || "";
  /* ---------- Окно «Расхождения с толпой» ----------
     Считаем, насколько доли игроков расходятся с оценкой конторы. Мера — сумма
     (доля_конторы − доля_игроков)² / доля_игроков по трём исходам: это тот же
     критерий, что на форуме 1x2.su описан как «сумма отношений против тройки»,
     только без бесполезного порога. Чем больше, тем сильнее толпа ошибается. */
  /* Ничья «загружена», когда игроки ставят на неё заметно больше конторы. Прежнее правило «больше 30% пула»
     оценивало долю без оглядки на матч: там, где контора сама даёт ничье 33-36%, метка горела зря.
     Проверка на архиве: 13 706 футбольных матчей, 940 тиражей. Пул на ничью выше 30% — выпадает 34,2% при доле
     игроков 33,9%, то есть толпа права. Пул выше конторы на 5+ п.п. (446 случаев) — выпадает 34,8% при доле игроков
     37,1%: перегруз есть, но около 2 п.п. и в пределах разброса. В целом ничью игроки недогружают: пул 27,7%, факт 30,2%. */
  var X_OVER_GAP = 5;
  function xGap(m){
    if(!(m && m.pct && m.pct.pool && m.pct.bk)) return null;
    var p = Number(m.pct.pool[1]), b = Number(m.pct.bk[1]);
    if(!isFinite(p) || !isFinite(b) || b <= 0) return null;
    return p - b;
  }

  function crowdGap(m){
    var pr = evProbs(m), pl = evPool(m);
    if(!pr || !pl) return null;
    var d = 0, over = 0, under = 0;
    for(var i = 0; i < 3; i++){
      d += (pr[i] - pl[i]) * (pr[i] - pl[i]) / Math.max(pl[i], 0.01);
      if(pl[i] - pr[i] > pl[over] - pr[over]) over = i;
      if(pr[i] - pl[i] > pr[under] - pl[under]) under = i;
    }
    var gOver  = (pl[over]  - pr[over])  * 100;   /* насколько толпа грузит выше рынка, п.п. */
    var gUnder = (pr[under] - pl[under]) * 100;  /* насколько толпа жалеет ниже рынка, п.п. */
    return { d: d, over: over, under: under, pr: pr, pl: pl, gOver: gOver, gUnder: gUnder,
             vrd: gapVerdict(gOver, gUnder) };
  }

  /* Пороги проверены ровно этим правилом на архиве из 13 952 матчей 940 тиражей (04.10.2026).
     Толпа грузит исход на 10+ п.п. выше рынка (2342 случая): сама даёт ему 53,0%,
     контора 40,2%, а выпадает он в 38,7% — права контора, а не толпа. ЛОВУШКА:
     исход и дорогой при делёжке, и заходит куда реже, чем о нём думают.
     Толпа жалеет исход на 5+ п.п. (3541 случай): даёт ему 25,3%, контора 31,8%,
     выпадает 30,2%. ЦЕННОСТЬ: заходит заметно чаще, чем считает толпа, а приз
     делить с меньшим числом людей. Контора тут тоже мажет (на 1,5 п.п.), но в несколько раз слабее.
     Обе половины архива дают то же самое (ловушка 39,2% и 38,3%, ценность 30,6% и 29,9%). */
  function gapVerdict(gOver, gUnder){
    if(gOver >= 10) return { k: "trap", t: "ловушка", why:
      "толпа грузит этот исход на " + gOver.toFixed(0) + " п.п. выше рынка. " +
      "На архиве такие исходы заходят в 38,7% случаев против 53,0%, которые им даёт толпа" };
    if(gUnder >= 5) return { k: "val", t: "ценность", why:
      "толпа жалеет этот исход на " + gUnder.toFixed(0) + " п.п. против рынка. " +
      "На архиве такие исходы заходят в 30,2% случаев против 25,3%, которые им даёт толпа" };
    return { k: "neut", t: "\u2014", why: "толпа и контора близки, брать нечего" };
  }

  /* Линия фаворитов и список замен на недогруженные исходы, от самой дешёвой
     по потере вероятности к самой дорогой. */
  /* Замены ранжируем по ОТДАЧЕ, а не по дешевизне: сколько доли толпы сбрасываем
     на единицу отданной вероятности. Прежнее правило брало просто самый недогруженный
     исход, и ничьи в линию почти никогда не попадали — хотя именно их толпа бросает
     чаще всего, и тогда замена на ничью стоит дёшево, а конкурентов снимает много. */
  function gapSwaps(){
    var base = [], swaps = [], probs = [], pools = [], i, j;
    for(i = 0; i < state.matches.length; i++){
      var pr = evProbs(state.matches[i]), pl = evPool(state.matches[i]);
      if(!pr || !pl) return null;
      probs.push(pr); pools.push(pl);
      var fav = 0;
      for(j = 1; j < 3; j++) if(pr[j] > pr[fav]) fav = j;
      base.push(fav);
      var best = null;
      for(j = 0; j < 3; j++){
        if(j === fav) continue;
        var loss = pr[fav] - pr[j];        /* отдаём вероятности */
        var relief = pl[fav] - pl[j];      /* сбрасываем доли толпы */
        if(relief <= 0) continue;          /* уходим в более людный исход — смысла нет */
        var score = relief / Math.max(loss, 1e-4);
        if(!best || score > best.score)
          best = { i: i, to: j, from: fav, loss: loss, relief: relief, score: score };
      }
      if(best) swaps.push(best);
    }
    swaps.sort(function(a, b){ return b.score - a.score; });
    return { base: base, swaps: swaps, probs: probs, pools: pools };
  }

  /* Порог окупаемости замены: сброшенной толпы не меньше отданной вероятности,
     и за один исход отдаём не больше 5 пунктов (LOSS_CAP в config.js). */
  var SWAP_MIN = C.SWAP_MIN, LOSS_CAP = C.LOSS_CAP;

  /* Те же замены, но всегда в один заданный исход — нужно для ничейной линейки */
  function gapSwapsTo(g, to){
    var out = [], i;
    for(i = 0; i < g.base.length; i++){
      var fav = g.base[i];
      if(fav === to) continue;
      var pr = g.probs[i], pl = g.pools[i];
      var loss = pr[fav] - pr[to], relief = pl[fav] - pl[to];
      if(relief <= 0) continue;
      out.push({ i: i, to: to, from: fav, loss: loss, relief: relief, score: relief / Math.max(loss, 1e-4) });
    }
    out.sort(function(a, b){ return b.score - a.score; });
    return out;
  }

  /* Одна линейка расстановок: строка фаворитов плюс первые k замен из списка */
  function gapBlock(title, lead, raw, g, sc, store, key){
    /* окупающиеся замены идут первыми, внутри группы — по отдаче: иначе одна дорогая
       замена в середине обрывала бы ★ раньше, чем кончились выгодные */
    var swaps = raw.slice().sort(function(a, b){
      var qa = (a.score >= SWAP_MIN && a.loss <= LOSS_CAP) ? 0 : 1;
      var qb = (b.score >= SWAP_MIN && b.loss <= LOSS_CAP) ? 0 : 1;
      return qa !== qb ? qa - qb : b.score - a.score;
    });
    var k, rec = 0;
    for(k = 0; k < swaps.length; k++){
      if(swaps[k].score >= SWAP_MIN && swaps[k].loss <= LOSS_CAP) rec = k + 1; else break;
    }
    var maxK = Math.min(swaps.length, 8);
    var s = '<h3>' + title + '</h3><p class="ev-lead">' + lead + '</p>' +
      '<table class="ev-tab"><thead><tr><th>Замен</th><th>Линия</th><th>Шанс 9+</th>' +
      '<th>Отдача 9\u201312</th><th></th></tr></thead><tbody>';
    var line = g.base.slice();
    for(k = 0; k <= maxK; k++){
      if(k > 0) line[swaps[k-1].i] = swaps[k-1].to;
      var cur = line.slice();
      store.push(cur);
      var one = evOfLine(cur, g.probs, g.pools, sc.lines, sc.fund, sc.jack);
      var e912 = 0;
      one.rows.forEach(function(r){ if(r.k <= 12) e912 += r.part; });
      s += '<tr' + (k === rec ? ' class="rec"' : '') + '><td>' + k + (k === rec ? ' \u2605' : '') + '</td>' +
           '<td class="nw">' + cur.map(function(j){ return OUT[j]; }).join("") + '</td>' +
           '<td>' + (evTail(one.qDist, 9) * 100).toFixed(2) + '%</td>' +
           '<td>' + e912.toFixed(2) + ' \u20bd</td>' +
           '<td><button type="button" class="gap-set" data-set="' + key + '" data-k="' + k + '">поставить</button></td></tr>';
    }
    s += '</tbody></table>';
    s += '<p class="ev-note">' +
         (rec ? '\u2605 — докуда замена сбрасывает толпы не меньше, чем отдаёт вероятности. Дальше платишь больше, чем получаешь. '
              : 'Ни одна замена здесь не окупается: за каждый пункт вероятности сбрасывается меньше пункта толпы. ') +
         'Порядок замен — по отдаче, поэтому цена по строкам не обязана расти ровно.</p>';
    if(swaps.length){
      s += '<p class="ev-note ev-swaps"><b>Порядок замен:</b> ' +
        swaps.slice(0, maxK).map(function(sw, n){
          return (n + 1) + ') матч ' + (sw.i + 1) + ' ' + OUT[sw.from] + '\u2192' + OUT[sw.to] +
                 ' \u2014 отдаём ' + (sw.loss * 100).toFixed(1) + ' п.п., сбрасываем ' +
                 (sw.relief * 100).toFixed(1) + ' п.п. толпы (\u00d7' + sw.score.toFixed(1) + ')';
        }).join('; ') + '.</p>';
    }
    return s;
  }

  /* фонд, суперприз и число строк — та же логика, что в «Оценить купон» */
  function evScene(){
    var price = Number(state.price) || 30;
    var poolNow = Number(state.poolSum) || 0;
    var typical = Number(state.poolTypical) || 0;
    var fund = (typical && poolNow < typical * 0.6) ? typical : poolNow;
    if(!fund) return null;
    return { fund: fund, jack: Number(state.jackpot) || 0, lines: (fund / 0.9) / price, price: price };
  }

  /* Ставит линию в купон: по одному исходу в каждом матче */
  function setLine(line, label){
    pushHistory("до расстановки по расхождениям");
    state.matches.forEach(function(m, i){
      OUT.forEach(function(o, k){ m.picks[o] = (k === line[i]); });
      m.mode = "free"; m.pool = OUT.slice();
    });
    save(); render();
    $("evBack").hidden = true;
    say(label + " Отменить — «Назад».");
  }

  function showCrowdGaps(){
    var rows = [], i;
    for(i = 0; i < state.matches.length; i++){
      var g = crowdGap(state.matches[i]);
      if(g){ g.idx = i; g.m = state.matches[i]; rows.push(g); }
    }
    $("evTitle").textContent = "Расхождения с толпой";
    if(!rows.length){
      $("evBody").innerHTML = '<p class="ev-warn">Нет данных по долям игроков — нажми «Обновить тираж».</p>';
      $("evBack").hidden = false;
      return;
    }
    rows.sort(function(a, b){ return b.d - a.d; });
    var pc = function(x){ return Math.round(x * 100) + "%"; };
    var nTrap = 0, nVal = 0;
    rows.forEach(function(g){ if(g.vrd.k === "trap") nTrap++; if(g.vrd.k === "val") nVal++; });
    var h = '<p class="ev-lead">Здесь матчи выстроены по тому, насколько доля игроков расходится с оценкой ' +
            'конторы. Верх списка — места, где толпа ошибается сильнее всего: её перегруженный исход стоит ' +
            'дорого (приз делить со многими), а недогруженный при той же вероятности достаётся дешевле.</p>';
    h += '<p class="ev-lead"><b>Пороги проверены этим же правилом на 13 952 матчах из 940 тиражей.</b> ' +
         'Толпа грузит исход на 10 и более пунктов выше рынка (2342 случая): даёт ему 53,0%, контора 40,2%, ' +
         'а выпадает он в 38,7% — права контора. Толпа жалеет исход на 5 и более пунктов (3541 случай): ' +
         'даёт ему 25,3%, контора 31,8%, выпадает 30,2%. Толпа мажет на 14 пунктов в первом случае и на 5 ' +
         'во втором, контора — на 1,5 и 1,6. Обе половины архива дают то же самое. Поэтому расхождение с рынком ' +
         'читается как вердикт, а не как подсказка. В среднем на тираж выходит 2,5 ловушки и 3,8 ценных исхода.</p>';
    h += '<p class="ev-note">Доли игроков меняются до закрытия: в тираже 5026 за четыре часа в среднем на 2 пункта, ' +
         'самое большое на 4. Вердикты у самого порога (бледные в таблице) могут перевернуться, смотри их ближе к закрытию.</p>';
    h += '<p class="ev-note">Сейчас в тираже: ловушек — ' + nTrap + ', ценных исходов — ' + nVal + '.</p>';
    h += '<p class="ev-note">В столбцах: исход, доля игроков → оценка конторы.</p>' +
         '<table class="ev-tab"><thead><tr><th>Матч</th><th>Толпа грузит</th><th>Толпа жалеет</th><th>Вердикт</th><th>Расх.</th></tr></thead><tbody>';
    rows.forEach(function(g){
      var nm = (g.idx + 1) + ". " + g.m.home + " — " + g.m.away;
      var edge = (g.vrd.k === "trap" && g.gOver < 12) || (g.vrd.k === "val" && g.gUnder < 7);
      var vt = g.vrd.k === "trap" ? (OUT[g.over] + " ловушка")
             : g.vrd.k === "val"  ? (OUT[g.under] + " ценность") : "\u2014";
      h += '<tr><td>' + nm + '</td>' +
           '<td class="nw">' + OUT[g.over] + '  ' + pc(g.pl[g.over]) + ' \u2192 ' + pc(g.pr[g.over]) +
             (g.gOver >= 10 ? '  (+' + g.gOver.toFixed(0) + ')' : '') + '</td>' +
           '<td class="nw">' + OUT[g.under] + '  ' + pc(g.pl[g.under]) + ' \u2192 ' + pc(g.pr[g.under]) +
             (g.gUnder >= 5 ? '  (\u2212' + g.gUnder.toFixed(0) + ')' : '') + '</td>' +
           '<td class="nw"><span class="vrd ' + g.vrd.k + (edge ? ' edge' : '') + '" title="' + g.vrd.why +
             (edge ? '. Вердикт у самого порога: до закрытия доли игроков сдвигаются на 2–4 п.п., он может перевернуться' : '') + '">' + vt + '</span></td>' +
           '<td>' + (g.d * 100).toFixed(1) + '</td></tr>';
    });
    h += '</tbody></table>';
    var xo = [];
    state.matches.forEach(function(m, k){
      var g = xGap(m);
      if(g !== null && g >= X_OVER_GAP) xo.push((k + 1) + " (+" + g.toFixed(0) + ")");
    });
    h += '<h3>Загруженные ничьи</h3><p class="ev-lead">Ничья случается в 30,2% футбольных матчей, а игроки в среднем ' +
         'отдают ей только 27,7%: ничью они недогружают. Поэтому сам по себе пул выше 30% ничего не значит — такие ничьи ' +
         'выпадали в 34,2% при доле игроков 33,9%, толпа тут права. Метка «!» ставится, только когда игроки грузят ничью ' +
         'на 5 и более пунктов выше конторы: на архиве (446 случаев) она выпадала в 34,8% при доле игроков 37,1%, ' +
         'то есть переплата около 2 пунктов. Это слабый сигнал, не повод вычёркивать ничью.</p>';
    h += xo.length
      ? '<p class="ev-note">Сейчас загружены ничьи в матчах (на сколько пунктов выше конторы): ' + xo.join(", ") + '.</p>'
      : '<p class="ev-note">Сейчас загруженных ничьих нет.</p>';
    h += '<p class="ev-warn">Расхождение говорит только о цене исхода, а не о его вероятности. ' +
         'Брать недогруженный исход стоит там, где он и по оценке конторы не сильно хуже перегруженного, ' +
         'иначе сэкономишь на дележе приза, но проиграешь сам матч.</p>';

    /* --- готовые расстановки: две линейки, обычная и ничейная --- */
    var g = gapSwaps(), sc = evScene();
    window.__gapLines = []; window.__gapLinesX = [];
    if(g && sc && g.base.length === 15){
      var maxK = Math.min(g.swaps.length, 8);
      h += gapBlock('Готовые расстановки',
        'Линия фаворитов конторы, в которой N исходов заменены. Замены идут по отдаче: сначала та, где ' +
        'на каждый отданный пункт вероятности сбрасывается больше всего доли толпы. «Отдача 9–12» ' +
        'считается только по надёжным категориям: в 13–15 модель завышает редкие комбинации, туда ' +
        'смотреть нельзя.',
        g.swaps, g, sc, window.__gapLines, 'a');

      /* Вторая линейка — замены только в ничью. В матче ничья часто окупается, но проигрывает
         другой замене, и в первой таблице её не видно вовсе. Здесь видно, сколько она стоит. */
      var xs = gapSwapsTo(g, 1), xOk = 0, q;
      for(q = 0; q < xs.length; q++) if(xs[q].score >= SWAP_MIN && xs[q].loss <= LOSS_CAP) xOk++;
      if(xs.length){
        h += gapBlock('Расстановки с уклоном в ничью',
          'То же самое, но замена всегда в ничью. Порог окупаемости проходят <b>' + xOk + '</b> ничьих из ' +
          xs.length + ' возможных. Если обе таблицы совпали — значит толпа ничьи бросила, и они и так ' +
          'лучший выбор в своих матчах.',
          xs, g, sc, window.__gapLinesX, 'x');
      }

      /* Почему в первой таблице нет ничьих — самый частый вопрос. Считаем по текущему тиражу. */
      var favX = 0, undX = 0, sumPX = 0, sumQX = 0;
      for(var t = 0; t < g.base.length; t++){
        if(g.base[t] === 1) favX++;
        sumPX += g.pools[t][1]; sumQX += g.probs[t][1];
      }
      for(var t2 = 0; t2 < maxK; t2++) if(g.swaps[t2].to === 1) undX++;
      var n15 = g.base.length;
      h += '<h3>Откуда берутся ничьи</h3>' +
        '<p class="ev-lead">В первую таблицу ничья попадает двумя путями: либо она фаворит конторы, либо ' +
        'замена на неё даёт лучшую отдачу среди замен своего матча. В этом тираже ничья — фаворит конторы ' +
        'в <b>' + favX + '</b> матч(ах) из ' + n15 + ', а среди показанных замен ведёт в <b>' + undX + '</b>. ' +
        'На ничьи уходит в среднем ' + Math.round(sumPX / n15 * 100) + '% пула при оценке конторы ' +
        Math.round(sumQX / n15 * 100) + '%.</p>' +
        '<p class="ev-note">' +
        (favX + undX === 0
          ? 'Поэтому в первой таблице ничьих нет: в своих матчах они проиграли другой замене. Но ' +
            (xOk ? 'окупается из них <b>' + xOk + '</b> — их и показывает вторая таблица. '
                 : 'и по отдельности они не окупаются — вторая таблица показывает, во что это обходится. ')
          : 'Поэтому ничьи в расстановках встречаются. ') +
        'Отсутствие ничьих в линии не значит, что их не будет в результатах: в футболе ничьей ' +
        'заканчивается примерно каждый четвёртый матч — просто это не делает её лучшей заменой.</p>';
    }

    $("evBody").innerHTML = h;
    [].slice.call($("evBody").querySelectorAll(".gap-set")).forEach(function(b){
      b.addEventListener("click", function(){
        var k = Number(b.getAttribute("data-k"));
        var set = b.getAttribute("data-set");
        var ln = ((set === "x" ? window.__gapLinesX : window.__gapLines) || [])[k];
        if(ln) setLine(ln, k === 0
          ? "Поставлена линия фаворитов конторы, без замен."
          : "Поставлена линия фаворитов с " + k + " " + plural(k, "заменой", "заменами", "заменами") +
            (set === "x" ? " в ничью." : " по расхождениям."));
      });
    });
    $("evBack").hidden = false;
  }

  $("btnDiff").addEventListener("click", showCrowdGaps);

  /* ---------- Окно «Бриф-система» ---------- */
  function briefSets(){
    var sets = [], bad = -1;
    for(var i = 0; i < state.matches.length; i++){
      var m = state.matches[i], cur = [];
      for(var k = 0; k < 3; k++) if(m.picks[OUT[k]]) cur.push(k);
      if(!cur.length){ bad = i; break; }
      sets.push(cur);
    }
    return { sets: sets, bad: bad };
  }

  function briefPrice(){ return Number(state.price) > 0 ? Number(state.price) : 30; }
  /* имя CSV «Бриф <режим>, <N> строк - <сумма>р»: режим = вер-ть (с учётом вероятностей), исход (все исходы поровну), МАХ 15 (максимум шанса) */
  /* имя CSV из кнопок выгрузки: «по 1 купону, 140 строк - 4200р» и «допы, 12 строк - 4200р» */
  function csvNameSum(kind, rows, sum){ return kind + ", " + rows + " строк - " + sum + "р.csv"; }
  function briefFileName(kind, rows){
    return "Бриф " + kind + ", " + rows + " строк - " + (rows * briefPrice()) + "р.csv";
  }
  /* вероятности исходов для «Брифа»: линия конторы с поправкой по истории */
  function briefProbs(){
    return state.matches.map(function(m){ return (m.pct && m.pct.bk) ? calProb(m.pct.bk) : null; });
  }
  /* шанс, что все 15 исходов окажутся внутри купона */
  function briefInside(sets, P){
    var p = 1;
    sets.forEach(function(st, i){
      if(state.matches[i] && state.matches[i].fsVoid) return;
      if(!P[i]){ p *= st.length / 3; return; }
      var S = 0; st.forEach(function(o){ S += P[i][o]; }); p *= Math.min(1, S);
    });
    return p;
  }
  /* строки «Брифа» — в корзину, как броски и прокрутки */
  var BASKET_MAX = 12000;   /* строки охоты/брифа хранятся сжато (без snap), поэтому влезает 10 000 */
  function briefToBasket(lines, g){
    var price = briefPrice();
    var stamp = new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
    var seen = {}, add = [], dup = 0;
    state.played.forEach(function(v){ if(v.sig) seen[v.sig] = true; });
    lines.forEach(function(L, n){
      var sig = L.map(function(k){ return OUT[k]; }).join(" ");
      if(seen[sig]){ dup++; return; }
      seen[sig] = true;
      add.push({ at: stamp, label: "бриф " + g + " · " + (n + 1) + "/" + lines.length, sig: sig, combos: 1, cost: price });
    });
    state.rolls += add.length; state.spent += add.length * price;
    state.played = add.reverse().concat(state.played);
    if(state.played.length > BASKET_MAX) state.played.length = BASKET_MAX;
    save(); render();
    return { added: add.length, dup: dup };
  }

  function briefCsv(lines){
    var price = briefPrice(), sep = state.csvSep === "; " ? "; " : ";";
    var out = lines.map(function(L){
      return String(price) + sep + L.map(function(j){ return OUT[j]; }).join(sep);
    });
    return out.join("\n") + "\n";
  }

  /* Посчитанные системы кэшируем, но только для ТОГО купона, из которого их собрали:
     иначе поменял исходы — а в таблице висят вчерашние строки. Подпись купона — это
     сами выбранные исходы по всем матчам. */
  window.__brief = {};
  function briefSig(sets){
    return sets.map(function(a){ return a.join(""); }).join("-");
  }
  function briefCache(sets){
    var sig = briefSig(sets);
    if(window.__brief.__sig !== sig){ window.__brief = { __sig: sig }; }
    return window.__brief;
  }

  function briefRow(g, sets, sizes, U){
    var r = state.matches.length - g;
    var wideSizes = sizes.filter(function(x){ return x > 1; });
    var m = wideSizes.length;
    var key = "g" + g;
    var have = briefCache(sets)[key];
    var cells;
    if(have && have.rows){
      var cost = have.rows * briefPrice();
      var save = U > 0 ? (100 * (1 - have.rows / U)) : 0;
      var ch = "";
      if(have.w15 != null){
        var pin = briefInside(sets, briefProbs());
        ch = '<div class="brief-ch" title="Шанс по модели: 15 из 15 и хотя бы 14 при условии, что все исходы попали в купон, умноженный на шанс такого попадания">15: ' +
             stratChance(pin * have.w15) + '</div><div class="brief-ch">14+: ' + stratChance(pin * have.w14) + '</div>';
      }
      cells = '<td><b>' + fmt(have.rows) + '</b>' + ch + '</td><td>' + fmt(cost) + ' ₽</td>' +
              '<td class="brief-save">' + (U === have.rows ? "—" : "−" + save.toFixed(0) + "%") + '</td>' +
              '<td class="nw"><button type="button" class="gap-set brief-cart" data-g="' + g + '">в корзину</button>' +
              ' <button type="button" class="gap-set brief-csv" data-g="' + g + '">CSV</button>' +
              ' <button type="button" class="gap-set brief-prev" data-g="' + g + '">строки</button></td>';
    } else if(have && have.tooBig){
      cells = '<td colspan="3" class="brief-no">вселенная ' + fmt(have.U) + ' — не берусь</td><td class="brief-save"></td>';
    } else if(have && have.slow){
      cells = '<td colspan="3" class="brief-no">не уложился за ' + Math.round(have.ms/1000) + ' с</td><td class="brief-save"></td>';
    } else {
      var ball = briefBall(wideSizes, r);
      var fast = briefLibHas(wideSizes, r), work = fast ? 0 : U * ball;
      if(r >= m) cells = '<td><b>1</b></td><td>' + fmt(briefPrice()) + ' ₽</td><td class="brief-save">−' + (100*(1-1/U)).toFixed(0) + '%</td>' +
                         '<td class="nw"><button type="button" class="gap-set brief-go" data-g="' + g + '">собрать</button></td>';
      else if(U > BRIEF_CAP_U || work > BRIEF_MAX_WORK)
        cells = '<td colspan="3" class="brief-no">слишком большой перебор (' + fmt(U) + ' × ' + fmt(ball) + ')</td><td class="brief-save"></td>';
      else
        cells = '<td colspan="2" class="brief-no">' +
                (work > BRIEF_WARN_WORK ? ("считать примерно " + Math.max(1, Math.round(work / 4e6)) + " с") : "не посчитано") +
                '</td><td class="brief-save"></td><td class="nw"><button type="button" class="gap-set brief-go" data-g="' + g + '">собрать</button></td>';
    }
    return '<tr><td>' + g + '<span class="bt-of"> из 15</span></td>' + cells + '</tr>';
  }

  /* формула сбора купона под бриф: два режима (13 и 14 из 15), у каждого описание, шаги, варианты форм с шансами и кнопкой «Собрать с ИИ».
     Форма: s — ординаров, d — двойников, t — тройников, rows — строк в системе, ch — шансы по модели (12+ и, для гарантии 14, ещё 14+) */
  var BRIEF_FORMS = {
    13: {
      name: "13 из 15", sub: "около 7 700 ₽",
      lead: "Купон собирается в три шага, система к нему берётся из библиотеки проверенных покрытий. Решает не код, а то, сколько исходов купон накрывает.",
      steps: [
        ["Ординары", "только при двух жёстких фактах, обычно 2–3, не больше 4"],
        ["Тройники", "в самых ровных матчах, где нельзя отсечь ни один исход"],
        ["Двойники", "всё остальное"]
      ],
      groups: [{ shapes: [
        { s: 2, d: 11, t: 2, rows: 256, ch: "12+ 10,8%" },
        { s: 3, d: 8, t: 4, rows: 252, ch: "12+ 11,3%" },
        { s: 4, d: 5, t: 6, rows: 276, ch: "12+ 11,6%" },
        { s: 1, d: 14, t: 0, rows: 256, ch: "12+ 9,6%" }
      ] }],
      foot: "Накрыто — исходов купона из 45 возможных. 12+ — шанс на 12 и больше угаданных по модели на ровном тираже при гарантии 13. Бюджет формулы 6 900–8 450 ₽ (230–281 строка).",
      recs: [
        "Один надёжный ординар — ищите второй: 14 двойников накрывают меньше всего и дают худший шанс.",
        "Четвёртый ординар только при двух жёстких фактах; если их нет, остановитесь на трёх.",
        "Тройник ставьте туда, где по фактам нельзя отсечь ни один исход, а не туда, где просто страшно.",
        "Смотрите строку «шанс, что все 15 внутри купона» ниже: гарантия работает только в этом случае."
      ],
      how: [
        "Гарантия действует, только если все 15 итогов попали внутрь купона. На ровном тираже для купона из 14 двойников это около 1 к 200: " +
        "обычно мимо купона уходят 3–5 итогов, и тогда лучшая строка даёт «гарантия минус число промахов». Поэтому при одинаковом числе строк " +
        "бриф почти не отличается от такого же числа случайных строк того же купона, а решает то, сколько исходов купон накрывает.",
        "Тройник накрывает матч целиком и стоит дороже двух двойников, поэтому его уравновешивают ординаром. По модели на линии конторы каждый " +
        "дополнительный накрытый исход при тех же 256 строках даёт примерно +0,5 п.п. к шансу на 12 и больше: 14 дв + 1 орд (29 исходов) — 9,6%, " +
        "11 дв + 2 тр + 2 орд (30) — 10,8%, 8 дв + 4 тр + 3 орд (31) — 11,3%, 5 дв + 6 тр + 4 орд (32) — 11,6%. Разница между двумя последними в пределах " +
        "погрешности, а ординар без двух жёстких фактов губит всё, так что форму выбирает число надёжных ординаров. Шансы в таблице — модель " +
        "200 000 сценариев по линии конторы на ровном тираже; в тираже с явными фаворитами они выше у всех форм, порядок форм тот же.",
        "Сами системы берутся из библиотеки готовых покрытий, каждая проверена перебором всех комбинаций купона; на частых формах их размер совпадает " +
        "с лучшими известными покрытиями из таблиц Кери, для редких форм считается жадное покрытие прямо в браузере. Самые вероятные строки вместо системы " +
        "работают хуже всех: на 12 и больше они дают 6,4% против 9,6%."
      ]
    },
    14: {
      name: "14 из 15", sub: "около 21 900 ₽",
      lead: "То же правило, но гарантия на ступень выше: если все 15 итогов внутри купона, одна из строк системы даст не меньше 14. Системе нужно почти втрое больше строк, поэтому основной бюджет формулы около 21 900 ₽ вместо 7 700 ₽.",
      steps: [
        ["Ординары", "только при двух жёстких фактах, 2–4: чем меньше ординаров, тем дороже система"],
        ["Тройники", "в самых ровных матчах: тройник берёт матч целиком и добавляет накрытый исход"],
        ["Двойники", "всё остальное"]
      ],
      groups: [
        { shapes: [
          { s: 2, d: 13, t: 0, rows: 730, ch: "12+ 15,5% · 14+ 0,61%" },
          { s: 3, d: 10, t: 2, rows: 768, ch: "12+ 17,1% · 14+ 0,65%" },
          { s: 3, d: 11, t: 1, rows: 548, ch: "12+ 14,1% · 14+ 0,48%" },
          { s: 4, d: 8, t: 3, rows: 690, ch: "12+ 15,4% · 14+ 0,58%" }
        ] },
        { label: "Дешевле, но больше ординаров", shapes: [
          { s: 4, d: 11, t: 0, rows: 192, ch: "12+ 7,9% · 14+ 0,19%" },
          { s: 4, d: 10, t: 1, rows: 316, ch: "12+ 10,1% · 14+ 0,32%" },
          { s: 3, d: 12, t: 0, rows: 380, ch: "12+ 11,3% · 14+ 0,34%" }
        ] }
      ],
      foot: "Накрыто — исходов купона из 45 возможных. 12+ и 14+ — шанс на 12 и больше и на 14 и больше угаданных по модели на ровном тираже при гарантии 14. Основной бюджет формулы 20 700–23 040 ₽ (690–768 строк).",
      recs: [
        "Гарантию 14 берите, когда есть два–четыре ординара с двумя жёсткими фактами каждый: при трёх это 10 двойников и 2 тройника за 23 040 ₽ или экономный вариант 11 двойников и 1 тройник за 16 440 ₽.",
        "Шансы у форм около 21 900 ₽ почти одинаковые, поэтому форму выбирает число надёжных ординаров, а не проценты в карточке.",
        "Пятый ординар не берите: правила разбора его не допускают, а в бюджет 6 900–8 450 ₽ гарантия 14 укладывается только с пятью ординарами.",
        "Нужно дешевле: четыре ординара и 11 двойников дают 5 760 ₽, три ординара и 12 двойников — 11 400 ₽, но шанс на 12 и больше ниже на 4–8 п.п.",
        "Смотрите строку «шанс, что все 15 внутри купона» ниже: гарантия 14 тоже работает только в этом случае."
      ],
      how: [
        "Гарантия 14 означает, что любой купон из системы отличается от какой-то её строки не больше чем в одном матче. Для этого строк нужно намного больше, " +
        "чем для 13: 11 двойников — 192 строки вместо 44 при гарантии 13, 13 двойников — 730 строк вместо 128. Условие то же: все 15 итогов должны оказаться внутри купона.",
        "Шанс на 14 и больше у любой формы ниже 1%. При близкой цене (5–10 тысяч ₽) он почти одинаков у гарантии 13 и 14, около 0,2–0,3%, а на 12 и больше " +
        "гарантия 14 слабее на 1–3,5 п.п.: плата за более высокую ступень внутри купона. Шансы в таблице — модель 200 000 сценариев по линии конторы на ровном тираже.",
        "Системы для 8–11 двойников найдены компьютерным поиском и проверены перебором всех комбинаций купона: для 9, 10 и 11 двойников это 62, 120 и 192 строки, " +
        "как у лучших известных покрытий. Для остальных форм берутся готовые системы из библиотеки."
      ]
    }
  };
  var briefTab = 13;
  function briefShapeCard(sh, g, cur, aiOk){
    var price = briefPrice(), cov = sh.s + 2 * sh.d + 3 * sh.t;
    var form = (sh.d ? sh.d + " дв" : "") + (sh.d && sh.t ? " + " : "") + (sh.t ? sh.t + " тр" : "");
    return '<div class="bf-v' + (cur ? ' cur' : '') + '"><div class="bf-i"><div class="bf-h"><span class="bf-o">' + sh.s + ' ' + (sh.s === 1 ? 'ординар' : 'ординара') + '</span><b>' + form + '</b></div>' +
      '<div class="bf-m"><span>' + cov + ' из 45</span><span>' + fmt(sh.rows) + ' ' + plural(sh.rows, 'строка', 'строки', 'строк') + '</span><span>' + fmt(sh.rows * price) + ' ₽</span><span class="bf-p">' + sh.ch + '</span></div></div>' +
      '<button type="button" class="gap-set bf-ai" data-g="' + g + '" data-s="' + sh.s + '" data-d="' + sh.d + '" data-t="' + sh.t + '"' + (aiOk ? '' : ' disabled title="Разбор ИИ на этот тираж ещё не готов"') + '>Собрать с ИИ</button></div>';
  }
  function briefRuleBox(one, cs){
    var F = BRIEF_FORMS[briefTab] || BRIEF_FORMS[13], g = briefTab;
    var aiOk = !!aiPlan(ai.data) && state.matches.length === 15;
    var anyExact = false;
    F.groups.forEach(function(gr){ gr.shapes.forEach(function(sh){ if(cs && sh.s === cs.s && sh.d === cs.d && sh.t === cs.t) anyExact = true; }); });
    var list = F.groups.map(function(gr, gi){
      return (gr.label ? '<div class="bf-gl">' + gr.label + '</div>' : '') + gr.shapes.map(function(sh){
        var cur = anyExact ? (cs.s === sh.s && cs.d === sh.d && cs.t === sh.t) : (gi === 0 && sh.s === one);
        return briefShapeCard(sh, g, cur, aiOk);
      }).join("");
    }).join("");
    var lim = g === 14 ? 'Для гарантии 14 нужно хотя бы два ординара.' : 'Без них бюджет не сходится.';
    var now = one === 1 && g === 13 ? 'Сейчас в купоне один ординар: это самая слабая форма, лучше найти второй.' :
              one === 1 ? 'Сейчас в купоне один ординар: для гарантии 14 это 14 двойников за 43 800 ₽, лучше найти второй ординар.' :
              one === 0 ? 'Сейчас в купоне нет ординаров: нужен хотя бы один матч с двумя жёсткими фактами. ' + lim :
              one > 4 ? 'Сейчас в купоне ' + one + ' ординаров: больше четырёх опасно, каждый лишний ординар без фактов губит купон целиком.' :
              'Сейчас в купоне ' + one + ' ' + (one === 1 ? 'ординар' : 'ординара') + ' — подходящая форма подсвечена ниже.';
    var tabs = '<div class="brief-tabs" role="tablist" aria-label="Формула сбора">' + [13, 14].map(function(k){
      return '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (k === g) + '"><b>' + BRIEF_FORMS[k].name + '</b><small>' + BRIEF_FORMS[k].sub + '</small></button>';
    }).join("") + '</div>';
    return tabs + '<div class="brief-rule">' +
      '<div class="brief-rule-t">Формула сбора · <span class="bf-nw">' + F.name + '</span></div>' +
      '<p class="brief-rule-d">' + F.lead + '</p>' +
      '<ol class="brief-rule-l">' + F.steps.map(function(st, i){
        return '<li><span class="brief-rule-n">' + (i + 1) + '</span><div><b>' + st[0] + '</b><small>' + st[1] + '</small></div></li>';
      }).join("") + '</ol>' +
      '<div class="bf-list">' + list + '</div>' +
      '<p class="brief-rule-fn">' + F.foot + ' Кнопка «Собрать с ИИ» ставит в купон выбор ИИ с нужным числом ординаров, двойников и тройников.</p>' +
      '<p class="brief-rule-now">' + now + '</p>' +
      '<div class="brief-rule-rt">Рекомендации</div>' +
      '<ul class="brief-rule-r">' + F.recs.map(function(x){ return '<li>' + x + '</li>'; }).join("") + '</ul>' +
      '<details class="ev-how brief-how"><summary>Как это работает и откуда формула</summary>' + F.how.map(function(x){ return '<p>' + x + '</p>'; }).join("") + '</details>' +
    '</div>';
  }
  /* «Собрать с ИИ»: форма (s ординаров, d двойников, t тройников) наполняется выбором ИИ. Порядок такой:
     ординары — у матчей, где ИИ сам дал один исход, затем у тех, где ИИ дал два, с самым сильным лидером по линии;
     тройники — у матчей, где ИИ дал три, затем у самых ровных по линии; остальное двойники.
     У ИИ-двойника исходы остаются как у ИИ; недостающий второй исход берётся по линии конторы. */
  function aiShapeBuild(j, S, D, T){
    var n = state.matches.length, i, free = [], fixed = { 1: 0, 2: 0, 3: 0 }, out = new Array(n), meta = { s: [], t: [], xs: [], xt: [], lock: 0 };
    var info = [];
    for(i = 0; i < n; i++){
      var m = state.matches[i], pr = evProbs(m);
      var A = String((j.m[i] || {}).p || "").split("").map(function(c){ return OUT.indexOf(c); }).filter(function(x){ return x >= 0; });
      var q = { i: i, A: A, P: pr };
      q.maxA = pr ? Math.max.apply(null, A.map(function(o){ return pr[o]; })) : 0.5;
      q.maxP = pr ? Math.max(pr[0], pr[1], pr[2]) : 0.34;
      if(m.mode === "lock"){
        var cur = []; for(var k = 0; k < 3; k++) if(m.picks[OUT[k]]) cur.push(k);
        out[i] = cur; fixed[Math.max(1, Math.min(3, cur.length))]++; meta.lock++;
      } else free.push(q);
    }
    var S2 = Math.max(0, S - fixed[1]), T2 = Math.max(0, T - fixed[3]);
    if(S2 + T2 > free.length){ T2 = Math.max(0, free.length - S2); S2 = Math.min(S2, free.length); }
    var byS = free.slice().sort(function(a, b){ return (a.A.length - b.A.length) || (b.maxA - a.maxA) || (a.i - b.i); });
    var sSet = {}; byS.slice(0, S2).forEach(function(q){ sSet[q.i] = 1; });
    var rest = free.filter(function(q){ return !sSet[q.i]; });
    var byT = rest.slice().sort(function(a, b){ return (b.A.length - a.A.length) || (a.maxP - b.maxP) || (a.i - b.i); });
    var tSet = {}; byT.slice(0, T2).forEach(function(q){ tSet[q.i] = 1; });
    free.forEach(function(q){
      var A = q.A, P = q.P;
      var rank = function(arr){ return arr.slice().sort(function(a, b){ return P ? (P[b] - P[a]) : (a - b); }); };
      if(sSet[q.i]){
        out[q.i] = [rank(A.length ? A : [1])[0]]; meta.s.push(q.i); if(A.length > 1) meta.xs.push(q.i);
      } else if(tSet[q.i]){
        out[q.i] = [0, 1, 2]; meta.t.push(q.i); if(A.length < 3) meta.xt.push(q.i);
      } else if(A.length === 2){ out[q.i] = A.slice().sort(); }
      else if(A.length === 1){
        var oth = rank([0, 1, 2].filter(function(o){ return o !== A[0]; }))[0];
        out[q.i] = [A[0], oth].sort();
      } else if(A.length === 3){ out[q.i] = rank(A).slice(0, 2).sort(); }
      else out[q.i] = [0, 1];
    });
    meta.s.sort(function(a, b){ return a - b; }); meta.t.sort(function(a, b){ return a - b; });
    return { sets: out, meta: meta };
  }
  function briefAiAssemble(g, S, D, T, btn){
    var was = btn ? btn.textContent : "";
    if(btn){ btn.disabled = true; btn.textContent = "собираю…"; }
    loadAi(true).then(function(j){
      var plan = aiPlan(j);
      if(btn){ btn.disabled = false; btn.textContent = was; }
      if(!plan || S + D + T !== state.matches.length){
        say("Разбор ИИ на этот тираж ещё не опубликован: форму собрать не из чего.");
        return;
      }
      pushHistory("до сборки с ИИ");
      var r = aiShapeBuild(j, S, D, T);
      state.matches.forEach(function(m, i){
        if(m.mode === "lock") return;
        m.picks = { "1": false, "X": false, "2": false };
        r.sets[i].forEach(function(o){ m.picks[OUT[o]] = true; });
        m.mode = "free";
      });
      save(); render();
      $("evBack").hidden = true;
      var t0 = tally(), nm = function(a){ return a.map(function(i){ return "№" + (i + 1); }).join(", "); };
      var msg = "Купон собран по ИИ под формулу " + g + " из 15: ординары " + (r.meta.s.length ? nm(r.meta.s) : "нет") +
        ", тройники " + (r.meta.t.length ? nm(r.meta.t) : "нет") + ", остальные двойники.";
      if(r.meta.xs.length) msg += " Ординар сверх выбора ИИ: " + nm(r.meta.xs) + " (у ИИ там двойник, взят исход с большей вероятностью по линии).";
      if(r.meta.xt.length) msg += " Тройник сверх выбора ИИ: " + nm(r.meta.xt) + " (самые ровные матчи по линии).";
      if(r.meta.lock) msg += " Зафиксированных матчей не трогал: " + r.meta.lock + ".";
      msg += " В купоне " + fmt(t0.combos) + " вариант(ов) на " + fmt(t0.combos * briefPrice()) + " ₽. Откройте «Бриф»: гарантия " + g + " из 15 посчитается под этот купон.";
      say(msg);
    }).catch(function(){ if(btn){ btn.disabled = false; btn.textContent = was; } say("Не удалось загрузить разбор ИИ. Попробуйте ещё раз."); });
  }

  function showBrief(){
    $("evTitle").textContent = "Бриф-система";
    var bs = briefSets();
    if(bs.bad >= 0){
      $("evBody").innerHTML = '<p class="ev-warn">В матче №' + (bs.bad + 1) +
        ' не выбран ни один исход. Бриф-система строится от готового купона: отметь исходы во всех пятнадцати матчах, ' +
        'а где не уверен — по два или по три.</p>';
      $("evBack").hidden = false;
      return;
    }
    var sets = bs.sets, sizes = sets.map(function(a){ return a.length; });
    briefCache(sets);                    /* чужой купон в кэше — выбрасываем */
    var U = 1; sizes.forEach(function(x){ U *= x; });
    var one = sizes.filter(function(x){ return x === 1; }).length;
    var two = sizes.filter(function(x){ return x === 2; }).length;
    var tri = sizes.filter(function(x){ return x === 3; }).length;
    var price = briefPrice();

    var h = '<p class="ev-lead">Бриф-система — это часть строк купона вместо всех. ' +
      'Обещание такое: какой бы исход внутри твоего купона ни выпал, хотя бы одна строка системы угадает ' +
      'не меньше заявленного. Платишь меньше, а взамен отказываешься от верхних категорий: гарантия 14 ' +
      'означает, что пятнадцать из пятнадцати ты возьмёшь только случайно, а не по построению.</p>';
    var curShape = { s: one, d: two, t: tri };
    h += '<div id="briefRuleW">' + briefRuleBox(one, curShape) + '</div>';
    var pin = briefInside(sets, briefProbs());
    h += '<p class="ev-note">Купон сейчас: ординаров ' + one + ', двоек ' + two + ', троек ' + tri +
         '. Полное покрытие — <b>' + fmt(U) + '</b> строк на <b>' + fmt(U * price) + ' ₽</b> по ' + fmt(price) + ' ₽ за строку.</p>';
    h += '<p class="ev-note brief-pin">Шанс, что все 15 итогов окажутся внутри купона: <b>' + stratChance(pin) + '</b>' +
         (pin < 0.05 ? ' — только в этом случае гарантия и срабатывает. При k промахах мимо купона лучшая строка даёт не меньше «гарантия минус k».' : '.') + '</p>';

    if(U === 1){
      h += '<p class="ev-warn">В купоне нет ни одной двойки или тройки — сокращать нечего, это и есть одна строка.</p>';
      $("evBody").innerHTML = h; $("evBack").hidden = false; return;
    }

    h += '<p class="ev-note">Все исходы купона равноправны. Шансы 15 и 14+ под числом строк считаются по линии конторы и только как справка, на состав системы они не влияют.</p>';
    h += '<table class="ev-tab brief-tab"><thead><tr><th><span class="bt-of">Гарантия</span><span class="bt-sh">Из 15</span></th><th>Строк</th><th>Цена</th><th>Дешевле</th><th></th></tr></thead><tbody>';
    h += '<tr><td>15<span class="bt-of"> из 15</span></td><td><b>' + fmt(U) + '</b></td><td>' + fmt(U * price) + ' ₽</td><td class="brief-save">—</td>' +
         '<td class="nw">полное покрытие</td></tr>';
    for(var g = 14; g >= 9; g--) h += briefRow(g, sets, sizes, U);
    h += '</tbody></table>';
    h += '<p class="ev-note">Числа детерминированы: один и тот же купон всегда даёт одну и ту же систему. ' +
         'Для частых форм купона из двоек и троек берутся готовые системы, каждая проверена перебором всех комбинаций; ' +
         'для остальных считается жадное покрытие, оно не обязано быть минимальным, зато считается за доли секунды прямо в браузере.</p>';
    h += '<div id="briefPrev"></div>';
    $("evBody").innerHTML = h;
    var bindRule = function(){
      var w = $("briefRuleW"); if(!w) return;
      [].slice.call(w.querySelectorAll(".brief-tabs button")).forEach(function(b){
        b.addEventListener("click", function(){
          briefTab = Number(b.getAttribute("data-tab")) === 14 ? 14 : 13;
          w.innerHTML = briefRuleBox(one, curShape); bindRule();
        });
      });
      [].slice.call(w.querySelectorAll(".bf-ai")).forEach(function(b){
        b.addEventListener("click", function(){
          briefAiAssemble(Number(b.getAttribute("data-g")), Number(b.getAttribute("data-s")), Number(b.getAttribute("data-d")), Number(b.getAttribute("data-t")), b);
        });
      });
    };
    bindRule();
    if(!aiPlan(ai.data)) loadAi(true).then(function(j){ if(aiPlan(j) && $("briefRuleW")){ $("briefRuleW").innerHTML = briefRuleBox(one, curShape); bindRule(); } });

    [].slice.call($("evBody").querySelectorAll(".brief-go")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g"));
        b.textContent = "считаю…"; b.disabled = true;
        setTimeout(function(){
          briefCache(sets)["g" + g] = briefBuild(sets, g, 30000, briefProbs(), true);
          showBrief();
        }, 30);
      });
    });
    [].slice.call($("evBody").querySelectorAll(".brief-cart")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g")), res = briefCache(sets)["g" + g];
        if(!res || !res.lines) return;
        if(res.lines.length > BASKET_MAX){
          $("briefPrev").innerHTML = '<p class="ev-warn">В корзину помещается до ' + BASKET_MAX + ' строк, а здесь ' + fmt(res.lines.length) +
            '. Возьми гарантию пониже или скачай CSV.</p>';
          return;
        }
        var r = briefToBasket(res.lines, g);
        $("evBack").hidden = true;
        say("«Бриф» " + g + " из 15: в корзину добавлено " + fmt(r.added) + " строк" + (r.dup ? ", " + r.dup + " уже были" : "") +
            " на " + fmt(r.added * briefPrice()) + " ₽. В CSV уйдут только отмеченные галочкой.");
      });
    });
    [].slice.call($("evBody").querySelectorAll(".brief-csv")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g")), res = briefCache(sets)["g" + g];
        if(!res || !res.lines) return;
        saveCsvFile(briefCsv(res.lines), briefFileName("исход", res.rows));
      });
    });
    [].slice.call($("evBody").querySelectorAll(".brief-prev")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g")), res = briefCache(sets)["g" + g];
        if(!res || !res.lines) return;
        var head = res.lines.slice(0, 20).map(function(L, i){
          return (i + 1) + ". " + L.map(function(j){ return OUT[j]; }).join("");
        }).join("\n");
        $("briefPrev").innerHTML = '<h3>Первые строки системы (гарантия ' + g + ')</h3>' +
          '<pre class="brief-pre">' + head + (res.rows > 20 ? "\n… и ещё " + fmt(res.rows - 20) + " строк" : "") + '</pre>';
        $("briefPrev").scrollIntoView({behavior:"smooth", block:"nearest"});
      });
    });
    $("evBack").hidden = false;
  }

  $("btnBrief").addEventListener("click", showBrief);


  /* ---------- Окно «Ценность тиража» ----------
     Плитка в шапке показывает одно число, а здесь объясняем словами,
     откуда оно берётся и как его читать. Всё считается по той же выгрузке. */
  function plural(n, one, few, many){
    var a = Math.abs(n) % 100, b = a % 10;
    if(a > 10 && a < 20) return many;
    if(b > 1 && b < 5) return few;
    if(b === 1) return one;
    return many;
  }

  function showValueInfo(){
    var fund = Number(state.poolTypical) || Number(state.poolSum) || 0;
    var jack = Number(state.jackpot) || 0;
    if(!fund || !jack) return;
    var r = jack / fund;
    var list = (state.ratioList || []).slice().sort(function(a, b){ return a - b; });
    var q = function(p){ return list.length ? list[Math.min(list.length - 1, Math.round(p * (list.length - 1)))] : 0; };
    var num = function(x){ return x.toFixed(2).replace(".", ","); };
    var below = 0;
    for(var i = 0; i < list.length; i++) if(list[i] < r) below++;
    var pct = list.length ? Math.round(100 * below / list.length) : 0;
    var wins = Number(state.jackWins) || 0, fin = Number(state.finCount) || 0;
    var perDraw = fund / 9;

    var h = '<p class="ev-lead">Суперприз — это деньги, собранные в прошлых тиражах и никем не выигранные. ' +
            'Сегодня они разыгрываются сверх того, что собрали сегодняшние игроки. Плитка показывает, ' +
            'сколько таких «чужих» денег приходится на рубль сегодняшнего фонда.</p>';
    h += '<p class="ev-lead"><b>' + evMoney(jack) + '</b> суперприза на <b>' + evMoney(fund) + '</b> фонда — это <b>' +
         num(r) + '</b>.' + (list.length ? ' Больше, чем в ' + pct + '% из ' + list.length + ' прошлых тиражей.' : '') + '</p>';

    if(list.length){
      h += '<h3>Шкала</h3><p class="ev-lead">Построена по ' + list.length +
        ' завершённым тиражам — по ним и видно, что для этого тотализатора много, а что мало.</p>' +
        '<table class="ev-tab"><tbody>' +
        '<tr><td>низкая</td><td>до ' + num(q(0.25)) + ' — четверть самых бедных тиражей</td></tr>' +
        '<tr><td>средняя</td><td>' + num(q(0.25)) + ' – ' + num(q(0.75)) + ', сюда попадает половина всех тиражей</td></tr>' +
        '<tr><td>высокая</td><td>от ' + num(q(0.75)) + ' — четверть самых богатых</td></tr>' +
        '<tr><td>ТОП</td><td>от ' + num(q(0.95)) + ' — примерно раз в двадцать тиражей</td></tr>' +
        '</tbody></table>';
    }

    h += '<h3>Почему число скачет</h3><p class="ev-lead">Пока никто не угадал все 15, суперприз растёт примерно на ' +
         evMoney(perDraw) + ' за тираж — это девятая часть фонда. Когда кто-то угадывает, он сбрасывается до миллиона, ' +
         'и всё начинается сначала.' +
         (wins && fin ? ' За последние ' + fin + ' тиражей это случилось ' + wins + ' ' + plural(wins, "раз", "раза", "раз") + ' — примерно раз в ' +
          Math.round(fin / wins) + ' тиражей.' : '') + '</p>';
    h += '<p class="ev-lead">Отсюда простое следствие: если ждёшь щедрый тираж, его можно просто дождаться. ' +
         'Каждый тираж без выигрыша прибавляет к этому числу около ' + num(perDraw / fund) + '.</p>';

    h += '<h3>Чего это число не значит</h3>' +
         '<p class="ev-warn">Оно не делает тираж выигрышным. Суперприз выплачивается только за 14 и 15 угаданных, ' +
         'а туда попадают очень редко, поэтому разница между низкой ценностью и ТОП — это несколько процентов отдачи, ' +
         'а не переход в плюс. Шанс угадать от этого числа не зависит вообще: он определяется матчами, а не размером суперприза.</p>';

    $("evTitle").textContent = "Ценность тиража";
    $("evBody").innerHTML = h;
    $("evBack").hidden = false;
  }

  $("tkValWrap").addEventListener("click", showValueInfo);
  $("tkValWrap").addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); showValueInfo(); }
  });

  /* ---------- Купон по ссылке ----------
     15 цифр: 1 = «1», 2 = «X», 4 = «2», сумма — если отмечено несколько.
     Так купон переезжает с телефона на компьютер и обратно. */
  function couponCode(){
    return state.matches.map(function(m){
      return String((m.picks["1"] ? 1 : 0) | (m.picks["X"] ? 2 : 0) | (m.picks["2"] ? 4 : 0));
    }).join("");
  }

  function couponLink(){
    return location.origin + location.pathname + "#k=" +
           encodeURIComponent(state.tirazh || "") + "-" + couponCode();
  }

  function applyCouponCode(code){
    if(code.length !== state.matches.length) return false;
    pushHistory("до загрузки купона по ссылке");
    for(var i = 0; i < code.length; i++){
      var v = Number(code[i]);
      if(!isFinite(v)) return false;
      var m = state.matches[i];
      m.picks["1"] = !!(v & 1); m.picks["X"] = !!(v & 2); m.picks["2"] = !!(v & 4);
      m.mode = "free"; m.pool = OUT.slice();
    }
    save(); render();
    return true;
  }

  var pendingLink = (function(){
    var m = String(location.hash || "").match(/^#k=([^-]*)-([0-7]+)$/);
    return m ? { tirazh: decodeURIComponent(m[1]), code: m[2] } : null;
  })();

  /* ссылка на купон живёт дольше одного тиража: если в ней другой номер,
     подтягиваем именно тот тираж, а не бросаем ссылку */
  var linkPulling = false;

  function tryPendingLink(){
    if(!pendingLink || !state.matches.length) return;
    if(pendingLink.code.length !== state.matches.length) return;   /* ждём загрузки тиража */
    var p = pendingLink;
    if(p.tirazh && String(p.tirazh) !== String(state.tirazh)){
      if(linkPulling || typeof fetch !== "function"){
        pendingLink = null;
        say("Тираж №" + p.tirazh + " из ссылки подгрузить не удалось, открыт №" + state.tirazh +
            " — исходы не проставлены.");
        return;
      }
      if(state.played.length && !window.confirm(
          "Ссылка сделана для тиража №" + p.tirazh + ", а сейчас открыт №" + state.tirazh + ".\n" +
          "Загрузить тираж из ссылки? Корзина очистится — вернуть можно кнопкой «Назад».")){
        pendingLink = null;
        say("Остались на тираже №" + state.tirazh + ". Исходы из ссылки не проставлены.");
        return;
      }
      linkPulling = true;
      say("Ссылка на тираж №" + p.tirazh + " — подгружаю его…");
      pullTirazh(true, p.tirazh);
      return;
    }
    pendingLink = null;
    if(openCodeBook(p.code)) return;
    if(applyCouponCode(p.code)) say("Купон из ссылки проставлен. Отменить — «Назад».");
  }

  /* ссылка на один купон открывается в просмотре: свой купон получателя не трогаем,
     перенести — кнопкой «В купон» */
  function openCodeBook(code){
    if(code.length !== state.matches.length) return false;
    var cells = [];
    for(var i = 0; i < code.length; i++){
      var v = Number(code[i]), c = OUT.filter(function(o, k){ return v & (1 << k); }).join("");
      if(!c) return false;
      cells.push(c);
    }
    var rows = [[]];
    for(i = 0; i < cells.length; i++){
      var next = [];
      for(var r = 0; r < rows.length; r++) for(var j = 0; j < cells[i].length; j++) next.push(rows[r].concat(cells[i][j]));
      rows = next;
      if(rows.length > MAX_CSV) return false;
    }
    if(book) book = null;
    book = { name: "купон по ссылке · тираж №" + (state.tirazh || ""), rows: rows, pages: [cells], lines: 0, idx: 0 };
    try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
    bookShow();
    say("Купон из ссылки открыт в просмотре. Твой купон цел: «В купон» перенесёт исходы, «Закрыть» вернёт к своему.");
    try{ $("bookBar").scrollIntoView({ behavior:"smooth", block:"center" }); }catch(e){}
    return true;
  }

  /* сводка по открытому файлу/ссылке: сколько стоит и как распределены исходы */
  function bookSummary(){
    if(!book || !book.rows.length) return;
    var N = book.rows.length, L = bookPages().length, price = Number(state.price) || 30;
    var esc = function(t){ return String(t == null ? "" : t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); };
    var h = '<p class="ev-lead"><b>' + fmt(N) + '</b> вариант(ов)' + (L > 1 && L !== N ? ' в ' + fmt(L) + ' строк(е)' : '') +
            ' · по ' + fmt(price) + '&nbsp;₽ — <b>' + fmt(N * price) + '&nbsp;₽</b>.</p>';
    var st = bookStats();
    if(st && st.played){
      var best = 0;
      book.rows.forEach(function(row){
        var h2 = 0; state.matches.forEach(function(m, i){ if(m.res && hitRes(row[i], m.res)) h2++; }); if(h2 > best) best = h2;
      });
      h += '<p class="ev-lead">Сыграно ' + st.played + ' из ' + state.matches.length + ' — лучший вариант угадал ' + best + '.</p>';
    }
    h += '<p class="ev-lead">Доля вариантов с каждым исходом. Золотом — то, на что ставит большинство' +
         (st && st.played ? ', галочка — как сыграл матч' : '') + '.</p>';
    h += '<table class="ev-tab bk-sum"><thead><tr><th>№</th><th>Матч</th><th>1</th><th>X</th><th>2</th></tr></thead><tbody>';
    state.matches.forEach(function(m, i){
      var cnt = { "1":0, "X":0, "2":0 };
      book.rows.forEach(function(row){ var c = String(row[i] || ""); OUT.forEach(function(o){ if(c.indexOf(o) >= 0) cnt[o]++; }); });
      var mx = Math.max(cnt["1"], cnt["X"], cnt["2"]);
      h += '<tr><td>' + (i + 1) + '</td><td>' + esc(m.home) + ' — ' + esc(m.away) + '</td>' + OUT.map(function(o){
        var pc = Math.round(100 * cnt[o] / N);
        return '<td class="' + (cnt[o] && cnt[o] === mx ? 'mx' : '') + (m.res === o ? ' rs' : '') + '">' +
               (cnt[o] ? pc + '%' : '—') + (m.res === o ? ' ✓' : '') + '</td>';
      }).join("") + '</tr>';
    });
    h += '</tbody></table>';
    $("evTitle").textContent = "Сводка: " + book.name;
    $("evBody").innerHTML = h;
    $("evBack").hidden = false;
  }

  $("btnLink").addEventListener("click", function(){
    var b = $("btnLink"), lbl = b.querySelector(".lbl"), was = "Ссылка на купон";
    var url = couponLink();
    try{ history.replaceState(null, "", "#k=" + encodeURIComponent(state.tirazh || "") + "-" + couponCode()); }catch(e){}
    /* видимый отклик прямо на кнопке: зелёная «Скопировано ✓» на 3 секунды */
    var done = function(){
      b.classList.add("ok"); if(lbl) lbl.textContent = "Скопировано ✓";
      clearTimeout(b._okT);
      b._okT = setTimeout(function(){ b.classList.remove("ok"); if(lbl) lbl.textContent = was; }, 3000);
      $("expNote").textContent = "Ссылка на купон скопирована в буфер" + (state.tirazh ? " (тираж №" + state.tirazh + ")" : "") +
        ". Вставь её в сообщение — у получателя откроется этот тираж и проставятся те же исходы.";
    };
    var manual = function(){
      $("expNote").textContent = "Скопировать в буфер автоматически не вышло — ссылка в окне, скопируй её оттуда.";
      try{ window.prompt("Ссылка на купон — скопируй:", url); }catch(e){ showFallback(url); }
    };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, manual);
    else manual();
  });

  /* ---------- Счёт по факту: сколько вариантов в файле ещё живы ----------
     Считаем один раз на набор результатов и держим в book.stat: при 10 000
     вариантов пересчёт на каждом листке был бы заметен. */
  function bookStats(){
    if(!book) return null;
    var N = state.matches.length;
    var res = state.matches.map(function(m){ return m.res || ""; });
    var sig = res.join("");
    if(book.sig === sig && book.stat) return book.stat;
    var played = 0, i, k;
    for(i = 0; i < res.length; i++) if(res[i]) played++;
    var alive = {};
    for(k = 0; k <= N; k++) alive[k] = 0;
    for(var r = 0; r < book.rows.length; r++){
      var row = book.rows[r], miss = 0;
      for(i = 0; i < N; i++) if(res[i] && res[i] !== VOID && row[i] !== res[i]) miss++;
      var max = N - miss;
      for(k = 9; k <= max; k++) alive[k]++;
    }
    book.sig = sig;
    book.stat = { played: played, alive: alive, n: book.rows.length };
    return book.stat;
  }

  /* ---------- Ссылка на весь файл вариантов ----------
     Каждый вариант — число в троичной системе (1=0, X=1, 2=2). Дальше пишем
     не сами числа, а разницу с предыдущим, переменной длиной, и жмём gzip.
     Систему это складывает почти в ничто: 9 664 варианта — около 300 символов. */
  function b64u(u8){
    var s = "", CH = 8000;
    for(var i = 0; i < u8.length; i += CH)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function unb64u(str){
    var s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while(s.length % 4) s += "=";
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* сжатие байтов для ссылки: gzip, если браузер умеет, иначе как есть */
  function packBytes(u8, zt, rt, cb){
    if(typeof CompressionStream === "function"){
      try{
        new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip")))
          .arrayBuffer()
          .then(function(ab){ cb(zt + b64u(new Uint8Array(ab))); })
          .catch(function(){ cb(rt + b64u(u8)); });
        return;
      }catch(e){}
    }
    cb(rt + b64u(u8));
  }

  function varsEncode(rows, cb, pages){
    /* в файле есть строки-системы — шлём сами строки (маска исходов на матч: 1=«1», 2=«X», 4=«2»),
       чтобы у получателя было столько же купонов, сколько в файле, а не развёрнутые варианты */
    if(pages === undefined && book && book.rows === rows) pages = book.pages;
    if(pages && pages.some(function(p){ return p.some(function(c){ return String(c).length > 1; }); })){
      var mb = [], NN = state.matches.length;
      for(var pp = 0; pp < pages.length; pp++)
        for(var jj = 0; jj < NN; jj++){
          var cc = String(pages[pp][jj] || "");
          var mk = (cc.indexOf("1") >= 0 ? 1 : 0) | (cc.indexOf("X") >= 0 ? 2 : 0) | (cc.indexOf("2") >= 0 ? 4 : 0);
          if(!mk){ cb(null); return; }
          mb.push(mk);
        }
      packBytes(new Uint8Array(mb), "y", "s", cb);
      return;
    }
    var N = state.matches.length, IX = {"1":0, "X":1, "2":2};
    var bytes = [], prev = 0, r, i;
    for(r = 0; r < rows.length; r++){
      var n = 0, row = rows[r];
      for(i = 0; i < N; i++){
        var v = IX[row[i]];
        if(v == null){ cb(null); return; }
        n = n * 3 + v;
      }
      var d = n - prev; prev = n;
      var z = d >= 0 ? d * 2 : (-d) * 2 - 1;
      while(z >= 128){ bytes.push((z % 128) + 128); z = Math.floor(z / 128); }
      bytes.push(z);
    }
    var u8 = new Uint8Array(bytes);
    if(typeof CompressionStream === "function"){
      try{
        new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip")))
          .arrayBuffer()
          .then(function(ab){ cb("z" + b64u(new Uint8Array(ab))); })
          .catch(function(){ cb("r" + b64u(u8)); });
        return;
      }catch(e){}
    }
    cb("r" + b64u(u8));
  }

  function varsDecode(payload, N, cb){
    var tag0 = String(payload).charAt(0);
    if(tag0 === "y" || tag0 === "s"){
      var body0;
      try{ body0 = unb64u(String(payload).slice(1)); }catch(e){ cb(null); return; }
      var fin = function(u8){
        if(!u8.length || u8.length % N){ cb(null); return; }
        var pages = [], rows = [];
        for(var p0 = 0; p0 < u8.length; p0 += N){
          var page = [], combo = [[]];
          for(var j0 = 0; j0 < N; j0++){
            var mk = u8[p0 + j0], set = [];
            for(var oi = 0; oi < 3; oi++) if(mk & (1 << oi)) set.push(OUT[oi]);
            if(!set.length){ cb(null); return; }
            page.push(set.join(""));
            var nx = [];
            for(var a0 = 0; a0 < combo.length; a0++)
              for(var b0 = 0; b0 < set.length; b0++) nx.push(combo[a0].concat(set[b0]));
            combo = nx;
          }
          pages.push(page);
          for(var q0 = 0; q0 < combo.length && rows.length < MAX_CSV; q0++) rows.push(combo[q0]);
        }
        cb(rows, pages);
      };
      if(tag0 === "y"){
        if(typeof DecompressionStream !== "function"){ cb(null); return; }
        try{
          new Response(new Blob([body0]).stream().pipeThrough(new DecompressionStream("gzip")))
            .arrayBuffer()
            .then(function(ab){ fin(new Uint8Array(ab)); })
            .catch(function(){ cb(null); });
        }catch(e){ cb(null); }
      } else fin(body0);
      return;
    }
    var tag = String(payload).charAt(0), body;
    try{ body = unb64u(String(payload).slice(1)); }
    catch(e){ cb(null); return; }
    var done = function(u8){
      var rows = [], prev = 0, i = 0;
      while(i < u8.length){
        var z = 0, sh = 1, b;
        while(i < u8.length){
          b = u8[i++];
          z += (b % 128) * sh;
          if(b < 128) break;
          sh *= 128;
        }
        var d = (z % 2) ? -((z + 1) / 2) : z / 2;
        var n = prev + d; prev = n;
        if(!(n >= 0)){ cb(null); return; }
        var row = new Array(N);
        for(var k = N - 1; k >= 0; k--){ row[k] = OUT[n % 3]; n = Math.floor(n / 3); }
        rows.push(row);
        if(rows.length >= MAX_CSV) break;
      }
      cb(rows.length ? rows : null);
    };
    if(tag === "z"){
      if(typeof DecompressionStream !== "function"){ cb(null); return; }
      try{
        new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip")))
          .arrayBuffer()
          .then(function(ab){ done(new Uint8Array(ab)); })
          .catch(function(){ cb(null); });
      }catch(e){ cb(null); }
    } else if(tag === "r"){ done(body); }
    else cb(null);
  }

  /* короткие ссылки: набор лежит на сервере под кодом, в адресе только #s=код */
  function shortPut(tir, packed){
    if(typeof fetch !== "function" || !C.SHORT_HOST) return Promise.reject(new Error("no"));
    return fetch(C.SHORT_HOST, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: String(tir || ""), d: packed }) })
      .then(function(r){ if(!r.ok) throw new Error("http"); return r.json(); })
      .then(function(j){ if(!j || !j.id) throw new Error("id"); return j.id; });
  }
  function shortGet(id){
    if(typeof fetch !== "function" || !C.SHORT_HOST) return Promise.reject(new Error("no"));
    return fetch(C.SHORT_HOST + "?id=" + encodeURIComponent(id))
      .then(function(r){ if(!r.ok) throw new Error(r.status === 404 ? "gone" : "http"); return r.json(); })
      .then(function(j){ if(!j || !j.t || !j.d) throw new Error("bad"); return j; });
  }
  var pendingBook = (function(){
    var h = String(location.hash || "");
    var ms = h.match(/^#vs=([^-]*)-([A-Za-z0-9\-_.]+)$/);
    if(ms) return { tirazh: decodeURIComponent(ms[1]), multi: ms[2].split(".").filter(Boolean) };
    var m = h.match(/^#v=([^-]*)-([A-Za-z0-9\-_]+)$/);
    return m ? { tirazh: decodeURIComponent(m[1]), payload: m[2] } : null;
  })();
  /* несколько наборов одной ссылкой (#vs=тираж-набор1.набор2…) — открываем по очереди в просмотре тиража */
  function openMultiPrev(tir, payloads, other){
    var k = 0, total = payloads.length;
    var step = function(){
      if(k >= total) return;
      var p = { tirazh: tir, payload: payloads[k++] };
      p.more = total > 1 ? "Открыто наборов: " + k + " из " + total + (other ? ", на текущий тираж пропущено: " + other : "") + "." : "";
      p.next = step;
      prevBookOpen(p, 0);
    };
    step();
  }

  /* сохранённые наборы ждут старта тиража: тираж начался (текущим стал следующий) — открываем в просмотре */
  /* постоянная плашка: пока наборы ждут старта тиража, она видна под панелью «Вид» */
  function renderWaitNote(){
    var ws = state.waitSets, el = document.getElementById("waitNote");
    if(!ws || state.viewPrev){ if(el) el.hidden = true; return; }
    var h = $("hint"); if(!h || !h.parentNode) return;
    if(!el){
      el = document.createElement("div"); el.id = "waitNote"; el.className = "wait-note";
      el.innerHTML = '<span class="wn-t"></span><button type="button" class="wn-x">Убрать</button>';
      el.querySelector(".wn-x").addEventListener("click", function(){ state.waitSets = null; save(); renderWaitNote(); });
      h.parentNode.insertBefore(el, h);
    }
    el.hidden = false;
    el.querySelector(".wn-t").textContent = "Наборов из ссылки: " + ws.payloads.length + ". Тираж №" + ws.tirazh + " ещё не начался, они откроются в просмотре сами после старта.";
  }
  function checkWaitSets(){
    var ws = state.waitSets;
    if(!ws || !state.tirazh || !state.matches.length) return;
    if(!(Number(ws.tirazh) < Number(state.tirazh))) return;
    state.waitSets = null; save();
    openMultiPrev(ws.tirazh, ws.payloads, 0);
  }
  setInterval(checkWaitSets, 15000);
  setTimeout(checkWaitSets, 3000);
  function tryPendingBook(){
    if(!pendingBook || !state.matches.length) return;
    var p = pendingBook;
    if(p.multi){
      pendingBook = null;
      if(p.tirazh && Number(p.tirazh) < Number(state.tirazh)){ openMultiPrev(p.tirazh, p.multi, 0); return; }
      if(p.tirazh && Number(p.tirazh) === Number(state.tirazh)){ openMultiCur(p.tirazh, p.multi); return; }
      if(p.multi.length === 1 && !p.tirazh){ pendingBook = { tirazh: p.tirazh, payload: p.multi[0] }; tryPendingBook(); return; }
      if(p.tirazh && Number(p.tirazh) > Number(state.tirazh)){
        /* запоминаем наборы: как только тираж начнётся, они откроются в просмотре сами */
        var wsOld = (state.waitSets && String(state.waitSets.tirazh) === String(p.tirazh)) ? state.waitSets.payloads : [];
        var wsAll = wsOld.slice();
        p.multi.forEach(function(x){ if(wsAll.indexOf(x) < 0) wsAll.push(x); });
        state.waitSets = { tirazh: String(p.tirazh), payloads: wsAll, at: Date.now() };
        save(); renderWaitNote();
        return;
      }
      say("Ссылка на варианты тиража №" + p.tirazh + " — такой тираж уже не открыть.");
      return;
    }
    /* ссылка на уже закрытый тираж — открываем её в просмотре прошлого тиража,
       текущий купон и тираж не трогаем */
    if(p.tirazh && Number(p.tirazh) < Number(state.tirazh)){
      pendingBook = null;
      prevBookOpen(p, 0);
      return;
    }
    if(p.tirazh && String(p.tirazh) !== String(state.tirazh)){
      if(linkPulling || typeof fetch !== "function"){
        pendingBook = null;
        say("Тираж №" + p.tirazh + " из ссылки подгрузить не удалось — варианты не открыть.");
        return;
      }
      if(state.played.length && !window.confirm(
          "Ссылка с вариантами сделана для тиража №" + p.tirazh +
          ", а сейчас открыт №" + state.tirazh + ".\n" +
          "Загрузить тираж из ссылки? Корзина очистится — вернуть можно кнопкой «Назад».")){
        pendingBook = null;
        say("Остались на тираже №" + state.tirazh + ". Варианты из ссылки не открыты.");
        return;
      }
      linkPulling = true;
      say("Ссылка со списком вариантов, тираж №" + p.tirazh + " — подгружаю его…");
      pullTirazh(true, p.tirazh);
      return;
    }
    pendingBook = null;
    varsDecode(p.payload, state.matches.length, function(rows, pages){
      if(!rows){
        say("Ссылку со списком вариантов развернуть не удалось — похоже, адрес обрезался при пересылке.");
        return;
      }
      book = { name: "варианты по ссылке · тираж №" + (state.tirazh || ""), rows: rows, pages: pages || null,
              lines: pages ? pages.length : 0, idx: 0 };
      bookShow();
      say("Из ссылки открыто " + fmt(rows.length) + " вариант(ов). Свой купон цел: листай стрелками " +
          "или свайпом, «Закрыть» вернёт тебя к нему.");
      try{ $("bookBar").scrollIntoView({ behavior:"smooth", block:"center" }); }catch(e){}
    });
  }

  var pullDone = false;               /* свежий тираж уже подтянут (или не вышло) — можно разбирать ссылку */
  function tryPending(){ pullDone = true; tryPendingLink(); tryPendingBook(); }
  /* ссылку вставили в уже открытую вкладку: меняется только #хвост, страница сама не перезагружается — перезагружаем, чтобы ссылка разобралась */
  window.addEventListener("hashchange", function(){
    if(/^#(?:s|v|vs|k)=/.test(String(location.hash || ""))) location.reload();
  });
  /* адрес вида #s=код: достаём набор с сервера и дальше работаем как со ссылкой #vs= */
  (function(){
    var m = String(location.hash || "").match(/^#s=([A-Za-z0-9_-]{6,16})$/);
    if(!m) return;
    shortGet(m[1]).then(function(j){
      var parts = String(j.d).split(".").filter(Boolean);
      pendingBook = { tirazh: String(j.t), multi: parts };
      if(pullDone) tryPending();          /* иначе ссылку разберёт тот, кто закончит подтяжку тиража */
    }, function(e){
      say(e && e.message === "gone" ? "Короткая ссылка устарела или не найдена: наборы хранятся 90 дней." : "Не получилось открыть короткую ссылку: сервер не ответил. Попробуй ещё раз позже.");
    });
  })();

  function prevBookOpen(p, tries){
    var isPrev = !!(state.prev && String(state.prev.tirazh) === String(p.tirazh));
    /* прошлый тираж ещё подгружается фоном — ждём до ~15 с */
    if(!isPrev && tries < 15 && Number(p.tirazh) === Number(state.tirazh) - 1){ setTimeout(function(){ prevBookOpen(p, tries + 1); }, 1000); return; }
    var N = (state.prev && state.prev.matches.length) || state.matches.length || 15;
    varsDecode(p.payload, N, function(rows, pages){
      if(!rows){ say("Ссылку со списком вариантов развернуть не удалось — похоже, адрес обрезался при пересылке."); if(p.next) p.next(); return; }
      var add = pcsvAddTo(String(p.tirazh), { link: 1, rows: rows.map(function(r){ return r.join(""); }),
                          sys: (pages || rows).map(function(pg){ return pg.join(","); }) });
      try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
      pcsv.msgAt = Date.now();
      pcsv.msg = (add.dup ? "Эта ссылка уже загружена — «" + add.name + "». " : "Из ссылки открыто " + fmt(rows.length) + " вариант(ов)" +
        (pages && pages.length !== rows.length ? " в " + fmt(pages.length) + " строк(е)" : "") + (isPrev ? "" : ", тираж №" + p.tirazh) + ". ") +
        (p.more ? p.more : "Свой купон цел.");
      if(isPrev){
        if(!state.viewPrev) enterPrev();
        renderPrevCsv();
        setTimeout(function(){ try{ $("prevCsv").scrollIntoView({ behavior: "smooth", block: "start" }); }catch(e){} }, 300);
        if(p.next) p.next();
      } else {
        prevLoad(Number(p.tirazh), true, function(){ say("Тираж №" + p.tirazh + " подгрузить не удалось, варианты сохранены — откроются, когда он загрузится."); });
        if(p.next) setTimeout(p.next, 1500);
      }
    });
  }

  /* ---------- Просмотр CSV: варианты листаются в таблице, как страницы книги ----------
     Файл никуда не записывается: купон и корзина остаются нетронутыми,
     пока не нажмёшь «В купон». */
  function normOut(x){
    x = String(x == null ? "" : x).trim().toUpperCase();
    if(x === "\u0425") x = "X";           /* кириллическая Х из чужих файлов */
    return (x === "1" || x === "X" || x === "2") ? x : null;
  }
  /* Итог матча из ответа totobrief. Если тираж уже разыгран (status finished), а итога у матча
     нет — матч отменён: Балтбет засчитывает его угаданным для любой ставки. Помечаем «*».
     Сверено на тираже 5008 (Леванте — Атлетик): число победителей сходится только так. */
  var VOID = "*";
  function evRes(e, info){
    var r = normOut(e && e.result);
    if(r) return r;
    return (info && info.status === "finished") ? VOID : "";
  }
  /* попал ли исход строки/клетки в итог: отменённый матч засчитан всем */
  function hitRes(cell, res){ return res === VOID || String(cell).indexOf(res) >= 0; }

  function parseCsvVariants(text, needN){
    var need = needN || state.matches.length;
    var lines = String(text).split(/\r?\n/);
    var out = [], pages = [], bad = 0, over = false;
    for(var i=0;i<lines.length;i++){
      var s = lines[i].trim();
      if(!s) continue;
      var parts = s.split(/[;,\t]/);
      var cand = null;
      if(parts.length === need) cand = parts;
      else if(parts.length === need + 1) cand = parts.slice(1);   /* первое поле — цена строки */
      if(!cand){ bad++; continue; }
      /* ячейка может нести несколько исходов («12», «1X2») — это строка-система,
         разворачиваем её во все комбинации */
      var cols = [], ok = true;
      for(var j=0;j<need;j++){
        var raw = String(cand[j] == null ? "" : cand[j]).trim().toUpperCase().replace(/[\s;,\/|-]/g, "");
        var set = [], seen = {};
        for(var c=0;c<raw.length;c++){
          var v = normOut(raw.charAt(c));
          if(!v){ ok = false; break; }
          if(!seen[v]){ seen[v] = 1; set.push(v); }
        }
        if(!ok || !set.length){ ok = false; break; }
        cols.push(set);
      }
      if(!ok){ bad++; continue; }
      /* страница просмотра — строка файла как есть: «1X» в матче подсвечивает обе кнопки */
      pages.push(cols.map(function(set){ return OUT.filter(function(o){ return set.indexOf(o) >= 0; }).join(""); }));
      var combo = [[]];
      for(var j2=0;j2<cols.length;j2++){
        var nx = [];
        for(var r2=0;r2<combo.length;r2++)
          for(var c2=0;c2<cols[j2].length;c2++) nx.push(combo[r2].concat(cols[j2][c2]));
        combo = nx;
        if(combo.length > MAX_CSV){ over = true; break; }
      }
      if(over && combo.length > MAX_CSV) combo = combo.slice(0, MAX_CSV);
      for(var q2=0;q2<combo.length;q2++){
        if(out.length >= MAX_CSV){ over = true; break; }
        out.push(combo[q2]);
      }
    }
    return { rows: out, pages: pages, bad: bad, over: over, need: need };
  }

  function bookShow(){
    var bar = $("bookBar");
    if(!book){
      bar.hidden = true;
      delete document.body.dataset.book;
      render();
      return;
    }
    bar.hidden = false;
    document.body.dataset.book = "1";
    $("bkName").textContent = (book.name + (book.lines && book.lines !== book.rows.length
      ? " · " + fmt(book.lines) + " строк → " + fmt(book.rows.length) + " вариантов" : ""))
      .replace(/ · /g, "\u00a0· ").replace(/(\d) (строк|вариант)/g, "$1\u00a0$2");
    $("bkNum").max = bookPages().length;
    $("bkNum").value = book.idx + 1;
    $("bkTotal").textContent = "из " + fmt(bookPages().length);
    var cur = bookPages()[book.idx], same = 0, combosHere = 1;
    cur.forEach(function(c){ combosHere *= String(c).length || 1; });
    state.matches.forEach(function(m, i){ if(cur[i] && String(cur[i]).split("").some(function(o){ return m.picks[o]; })) same++; });
    var mine = state.matches.some(function(m){ return OUT.some(function(o){ return m.picks[o]; }); });
    var line = (book.pages && book.pages.length !== book.rows.length ? "купон " : "вариант ") + fmt(book.idx + 1) +
      (combosHere > 1 ? " (система на " + fmt(combosHere) + " вар.)" : "") +
      (mine ? " · совпадает с твоим купоном в " + same + " из " + cur.length + " матчей" : "");
    var st = bookStats();
    if(st && st.played){
      var h = 0, ms = 0;
      state.matches.forEach(function(m, i){
        if(!m.res) return;
        if(hitRes(cur[i], m.res)) h++; else ms++;
      });
      line += " · по факту угадано " + h + " из " + st.played +
              (ms ? ", максимум\u00a0" + (cur.length - ms) : ", идёт на все\u00a0" + cur.length);
    }
    var ko = kickoffMs();
    if(ko != null && ko <= Date.now() && state.resAt) line += " · обновлено " + resStamp();
    $("bkHit").textContent = line;
    var sb = $("bkStat");
    document.querySelector(".bk-nav").hidden = bookPages().length < 2;
    if(st && st.played && book.rows.length > 1){
      /* тиражи, где не выбыл ещё никто, сворачиваем в одну фразу: иначе на
         телефоне строка растягивается на три ряда одинаковых чисел */
      var parts = [], floor = 0, k;
      for(k = 9; k <= cur.length; k++) if(st.alive[k] === st.n) floor = k;
      for(k = cur.length; k > floor; k--) if(st.alive[k]) parts.push(k + "+ — " + fmt(st.alive[k]));
      if(floor) parts.push("все " + fmt(st.n) + " ещё на " + floor + "+");
      sb.textContent = "сыграно " + st.played + " из " + cur.length + " · в файле ещё живы: " +
        (parts.length ? parts.join(", ") : "ни одного варианта на 9+");
      sb.hidden = false;
    } else {
      sb.textContent = "";
      sb.hidden = true;
    }
    render();
  }

  function bookGo(n){
    if(!book) return;
    var L = bookPages().length;
    book.idx = ((n % L) + L) % L;          /* по кругу: с последней страницы снова на первую */
    bookShow();
  }

  /* сообщение прямо в полосе просмотра файла — нижняя «Выгрузка» часто за экраном */
  /* страницы просмотра: строки файла как есть (системы не разворачиваем); варианты — book.rows */
  function bookPages(){
    if(!book) return [];
    return (book.pages && book.pages.length) ? book.pages : book.rows;
  }

  function bookMsg(msg){
    var el = $("bkMsg"); if(!el) return;
    el.textContent = msg || "";
    el.hidden = !(msg && book);
  }
  function bookSay(msg){ $("expNote").textContent = msg; bookMsg(msg); }

  /* пока открыт файл, «Скачать/Отправить» работают с НИМ, а не с корзиной:
     «CSV» — по одному варианту в строке, «системой» — сам файл как есть */
  function bookExport(sys){
    /* цена — из самого файла (первое поле первой строки), иначе из поля «Стоимость купона», минимум 30 */
    var fp = book.text ? Number(String(book.text).split(/\r?\n/)[0].split(";")[0].trim()) : NaN;
    var price = (fp >= 30 && fp <= 1000) ? fp : (Number(state.price) >= 30 ? Number(state.price) : 30);
    var nm = String(book.name || "варианты").replace(/\.csv$/i, "").replace(/[\\\/:*?"<>|·№]+/g, " ").trim().replace(/\s+/g, "_");
    if(sys && book.text){
      /* файл отдаём как есть, но первое поле каждой строки приводим к цене ОДНОГО варианта:
         старые выгрузки писали туда сумму за всю систему (30 × комбинации) */
      var fixed = book.text.replace(/\r\n?/g, "\n").replace(/\n*$/, "").split("\n").map(function(ln){
        var f = ln.split(";");
        if(f.length < 16) return ln;
        var v = Number(String(f[0]).trim()), n = 1;
        for(var k = 1; k < f.length; k++){ var t = String(f[k]).trim(); if(t) n *= t.length; }
        var one = (n > 1 && v >= 30 * n && v % n === 0) ? v / n : v;
        f[0] = String(one >= 30 ? one : 30);
        return f.join(";");
      }).join("\n") + "\n";
      return { csv: fixed,
               name: csvNameSum("допы", fixed.replace(/\n+$/, "").split("\n").length, book.rows.length * price),
               what: "файл " + book.name + " как есть (строк " + fmt(book.lines || 0) + ", вариантов " + fmt(book.rows.length) + ")" };
    }
    if(sys && book.pages && book.pages.length){
      var pl = book.pages.map(function(r){ return String(price) + ";" + r.join(";"); });
      return { csv: pl.join("\n") + "\n", name: csvNameSum("допы", pl.length, book.rows.length * price),
               what: "системой: строк " + fmt(pl.length) + ", вариантов " + fmt(book.rows.length) };
    }
    var lines = book.rows.map(function(r){ return String(price) + ";" + r.join(";"); });
    return { csv: lines.join("\n") + "\n", name: csvNameSum("по 1 купону", lines.length, lines.length * price),
             what: fmt(lines.length) + " вариант(ов) из файла, по одному в строке, " + fmt(lines.length * price) + " ₽" };
  }

  function shareCsv(csv, name, text, okMsg){
    var file = null;
    try{ file = new File([csv], name, {type:"text/csv"}); }catch(e){}
    if(file && navigator.canShare && navigator.canShare({files:[file]}) && navigator.share){
      navigator.share({files:[file], title:"Тираж №" + (state.tirazh||""), text:text})
        .then(function(){ bookSay(okMsg); })
        .catch(function(err){
          if(err && err.name === "AbortError"){ bookSay("Отправка отменена."); return; }
          copyCsv(csv, name);
        });
      return;
    }
    copyCsv(csv, name);
  }

  function bookClose(msg){
    book = null;
    bookMsg("");
    bookShow();
    if(msg) $("expNote").textContent = msg;
  }

  $("btnLoadCsv").addEventListener("click", function(){ $("fileCsv").click(); });

  $("fileCsv").addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      var res = parseCsvVariants(rd.result);
      if(!res.rows.length){
        bookClose("В файле «" + f.name + "» не нашлось ни одной строки на " + res.need +
          " матчей. Нужен CSV, где в строке либо " + res.need +
          " исходов (1, X или 2), либо цена строки и следом " + res.need + " исходов.");
        return;
      }
      book = { name: f.name, rows: res.rows, pages: res.pages, idx: 0, text: String(rd.result || ""),
                lines: String(rd.result || "").split(/\r?\n/).filter(function(l){ return l.trim(); }).length };
      bookShow();
      $("expNote").textContent = "Открыт файл " + f.name + ": " + fmt(res.rows.length) + " вариант(ов)." +
        (book.lines && book.lines !== res.rows.length ? " В самом файле " + fmt(book.lines) +
          " строк: строки-системы (1X, X2…) развёрнуты в отдельные варианты." : "") +
        (res.bad ? " Пропущено строк не на " + res.need + " матчей: " + res.bad + "." : "") +
        (res.over ? " Показаны первые " + fmt(MAX_CSV) + "." : "") +
        " Листай стрелками или свайпом по таблице.";
      try{ $("bookBar").scrollIntoView({ behavior:"smooth", block:"center" }); }catch(err){}
    };
    rd.onerror = function(){ $("expNote").textContent = "Не получилось прочитать файл."; };
    rd.readAsText(f);
  });

  $("bkPrev").addEventListener("click", function(){ if(book) bookGo(book.idx - 1); });
  $("bkNext").addEventListener("click", function(){ if(book) bookGo(book.idx + 1); });
  $("bkFirst").addEventListener("click", function(){ bookGo(0); });
  $("bkLast").addEventListener("click", function(){ if(book) bookGo(bookPages().length - 1); });
  $("bkNum").addEventListener("input", function(e){
    var n = Number(e.target.value);
    if(book && isFinite(n) && n >= 1 && n <= bookPages().length) bookGo(Math.round(n) - 1);
  });
  $("bkLink").addEventListener("click", function(){
    if(!book) return;
    var b = $("bkLink"), was = "Ссылка на файл", n = book.rows.length;
    b.disabled = true; b.classList.remove("ok"); b.textContent = "собираю…";
    bookMsg("Собираю ссылку на " + fmt(n) + " вариант(ов)…");
    var urlP = new Promise(function(res, rej){
      varsEncode(book.rows, function(p){
        if(!p){ rej(new Error("pack")); return; }
        res(location.origin + location.pathname + "#v=" + encodeURIComponent(state.tirazh || "") + "-" + p);
      });
    });
    /* пока идёт сжатие, Safari теряет «нажатие» и молча не пишет в буфер.
       ClipboardItem с обещанием занимает буфер сразу, а текст подкладывает, когда он готов */
    var wrote = null;
    if(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
      try{
        var blobP = urlP.then(function(url){
          if(url.length > 8000) throw new Error("long");
          return new Blob([url], {type:"text/plain"});
        });
        blobP.catch(function(){});
        wrote = navigator.clipboard.write([new ClipboardItem({"text/plain": blobP})]);
        wrote.catch(function(){});
      }catch(e){ wrote = null; }
    }
    var reset = function(){ b.disabled = false; };
    urlP.then(function(url){
      if(url.length > 8000){
        reset(); b.textContent = was;
        bookSay("В ссылку это не влезает: получилось " + fmt(url.length) + " символов, мессенджер такой адрес обрежет. " +
          "Перешли сам файл кнопкой «Отправить CSV (по 1 купону)» — у второго человека он откроется кнопкой «Загрузить CSV».");
        return;
      }
      var done = function(){
        reset(); b.textContent = "Скопировано ✓"; b.classList.add("ok");
        setTimeout(function(){ b.textContent = was; b.classList.remove("ok"); }, 3000);
        bookSay("Ссылка скопирована в буфер: " + fmt(n) + " вариант(ов), " + fmt(url.length) +
          " символов. Вставь её в сообщение — кто откроет, увидит тираж №" + (state.tirazh || "") +
          " и этот же список в режиме просмотра; его собственный купон цел." +
          (url.length > 3500 ? " Адрес длинный — в Telegram одним сообщением может не влезть, тогда пересылай файлом." : ""));
      };
      var manual = function(){
        reset(); b.textContent = was;
        bookSay("Скопировать в буфер автоматически не вышло — ссылка в окне, скопируй её оттуда.");
        try{ window.prompt("Ссылка на файл — скопируй:", url); }catch(e){ showFallback(url); }
      };
      var viaText = function(){
        if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, manual);
        else manual();
      };
      if(wrote) wrote.then(done, viaText); else viaText();
    }, function(){
      reset(); b.textContent = was;
      bookSay("Не получилось упаковать варианты в ссылку.");
    });
  });

  $("bkSum").addEventListener("click", bookSummary);
  $("bkClose").addEventListener("click", function(){ bookClose("Просмотр файла закрыт, купон остался прежним."); });
  $("bkToCoupon").addEventListener("click", function(){
    if(!book) return;
    var cur = bookPages()[book.idx].slice(), n = book.idx + 1;
    pushHistory("до переноса варианта из CSV");
    state.matches.forEach(function(m, i){
      if(!cur[i]) return;
      OUT.forEach(function(o){ m.picks[o] = String(cur[i]).indexOf(o) >= 0; });
      m.mode = "none";
      m.pool = OUT.slice();
    });
    book = null;
    bookShow();
    save();
    $("expNote").textContent = "Вариант " + fmt(n) + " перенесён в купон. Отменить — «Назад».";
  });

  document.addEventListener("keydown", function(e){
    if(!book) return;
    if(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if(e.key === "ArrowRight"){ bookGo(book.idx + 1); e.preventDefault(); }
    else if(e.key === "ArrowLeft"){ bookGo(book.idx - 1); e.preventDefault(); }
    else if(e.key === "Escape"){ bookClose("Просмотр файла закрыт, купон остался прежним."); }
  });

  (function(){
    var x0 = null, y0 = null, el = $("coupon");
    el.addEventListener("touchstart", function(e){
      if(!book || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive:true });
    el.addEventListener("touchend", function(e){
      if(!book || x0 === null) return;
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if(Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) bookGo(book.idx + (dx < 0 ? 1 : -1));
    }, { passive:true });
  })();

  $("priceLine").addEventListener("input", function(e){ state.price = Number(e.target.value)||0; save(); render(); });
  $("priceLine").value = state.price;
  $("spinCount").addEventListener("input", function(e){
    var v = Math.floor(Number(e.target.value));
    state.spins = (isFinite(v) && v >= 1) ? Math.min(100000, v) : 1;
    save();
  });
  $("spinCount").value = state.spins;
  $("sbRoll").addEventListener("click", function(){ $("btnSpin").click(); });
  $("sbKeep").addEventListener("click", function(){
    $("btnKeep").click();
    $("hint").scrollIntoView({block:"center"});
  });
  $("spinSpeed").addEventListener("change", function(e){ state.speed = Number(e.target.value); save(); });
  $("spinSpeed").value = String(state.speed);

  /* ---------- подтяжка тиража с totobrief ---------- */
  var API = C.API_BASE;
  /* Зеркало: GitHub Actions раз в полчаса кладёт снимок того же API в data/api/
     (drawings-N.json, drawing-info-ID.json, status.json). Когда totobrief лежит,
     сайт читает их — те же форматы, тот же код разбора. Если лежит долго,
     скрипт зеркала подкладывает состав тиража и результаты со stavka.tv
     (id вида «s5012», без процентов и коэффициентов). */
  var MIRROR = C.MIRROR_PATH;
  var feed = { src: "", statusAt: 0, status: null };
  function mirrorPath(path){
    var m = /^baltbet-main\/drawings\?page=(\d+)$/.exec(path);
    if(m) return MIRROR + "drawings-" + m[1] + ".json";
    m = /^drawing-info\/([\w-]+)$/.exec(path);
    if(m) return MIRROR + "drawing-info-" + m[1] + ".json";
    return null;
  }
  function apiFetch(path){
    /* no-store: браузер (особенно Safari на телефоне) иначе отдаёт счёт из своего кэша */
    return fetch(API + path, {cache: "no-store"})
      .then(function(r){
        if(!r.ok) throw new Error("totobrief " + r.status);
        if(feed.src !== "live"){ feed.src = "live"; showFeed(); }
        return r;
      })
      .catch(function(err){
        var mp = mirrorPath(path);
        if(!mp) throw err;
        /* минутный штамп обходит кэш GitHub Pages (10 минут) */
        return fetch(mp + "?t=" + Math.floor(Date.now() / 60000))
          .then(function(r){
            if(!r.ok) throw err;
            if(feed.src !== "mirror"){ feed.src = "mirror"; showFeed(); }
            return r;
          });
      });
  }
  /* штамп по Москве; short — без даты, если это сегодня */
  function fmtStamp(iso, short){
    var ms = Date.parse(iso || "");
    if(!isFinite(ms)) return "";
    var d = new Date(ms + 3 * 3600000), p = function(x){ return (x < 10 ? "0" : "") + x; };
    var t = p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
    if(short && d.toISOString().slice(0, 10) === new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)) return t;
    return p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1) + " " + t;
  }
  /* ---------- Состояние данных ----------
     Точка на кнопке «Данные»: зелёная — всё свежее, жёлтая — что-то запаздывает,
     красная — источник не отвечает или автообновление давно не запускалось. */
  var dstat = { at: 0, res: null };
  var GH_RUNS = "https://api.github.com/repos/dzhek15/dzhek15.github.io/actions/workflows/feed.yml/runs?per_page=1";
  function jget(url){
    return fetch(url).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }
  function ageMin(iso){ var t = Date.parse(iso || ""); return isFinite(t) ? (Date.now() - t) / 60000 : Infinity; }
  function ageTxt(iso){
    var m = ageMin(iso); if(!isFinite(m)) return "нет данных";
    m = Math.max(0, Math.round(m));
    var t = m < 1 ? "только что" : m < 60 ? m + " мин назад" : m < 48 * 60 ? Math.round(m / 60) + " ч назад" : Math.round(m / 1440) + " дн назад";
    return t + " (" + fmtStamp(iso, true) + ")";
  }
  function checkData(force){
    if(!force && dstat.res && Date.now() - dstat.at < 5 * 60000) return Promise.resolve(dstat.res);
    var t = Math.floor(Date.now() / 60000);
    return Promise.all([
      jget(MIRROR + "status.json?t=" + t), jget(MIRROR + "news.json?t=" + t),
      jget(MIRROR + "sites.json?t=" + t), jget(GH_RUNS)
    ]).then(function(r){
      var st = r[0] || {}, nw = r[1], si = r[2], gh = r[3] && r[3].workflow_runs && r[3].workflow_runs[0];
      var rows = [];
      /* уровень: 0 — норма, 1 — запаздывает, 2 — проблема */
      /* расписание feed.yml GitHub выполняет с большими пропусками (часами), а данные снимает цепочка keepalive:
         если зеркало (status.json) обновлялось недавно, автообновление работает, а время берём из зеркала */
      var mirFresh = ageMin(st.updated_at) <= 45;
      if(gh || mirFresh){
        var ok = mirFresh || gh.conclusion === "success" || gh.status !== "completed";
        var gat = mirFresh ? st.updated_at : gh.created_at;
        var lv = !ok ? 2 : ageMin(gat) > 90 ? 2 : ageMin(gat) > 45 ? 1 : 0;
        rows.push({ n: "Автообновление на GitHub", d: "каждые 30 минут", at: gat, lv: lv,
          s: !ok ? "последний запуск с ошибкой" : (!mirFresh && gh.status !== "completed") ? "идёт сейчас" : lv ? "давно не запускалось" : "работает" });
      } else {
        rows.push({ n: "Автообновление на GitHub", d: "каждые 30 минут", at: null, lv: 1, s: "GitHub не ответил — проверить не удалось" });
      }
      var src = function(name, d, okKey, atKey, errKey){
        /* один источник молчит, а другой работает — это «запаздывает», а не авария */
        var other = okKey === "totobrief_ok" ? st.stavka_ok : st.totobrief_ok;
        var ok = st[okKey] !== false, lv = !ok ? (other === false ? 2 : 1) : ageMin(st[atKey]) > 8 * 60 ? 1 : 0;
        rows.push({ n: name, d: d, at: st[atKey], lv: lv,
          s: !ok ? "не отвечает" + (st[errKey] ? ": " + String(st[errKey]).slice(0, 80) : "") : lv ? "давно без свежих данных" : "отвечает" });
      };
      src("totobrief", "тираж, доли игроков, линия конторы", "totobrief_ok", "totobrief_ok_at", "totobrief_error");
      src("stavka.tv", "составы тиража и результаты", "stavka_ok", "stavka_ok_at", "stavka_error");
      var cur = String(state.tirazh || "");
      var nl = !nw ? 1 : String(nw.number) !== cur ? 1 : ageMin(nw.at) > 5 * 60 ? 1 : 0;
      rows.push({ n: "Новости по матчам", d: "Google Новости, раз в 2 часа", at: nw && nw.at, lv: nl,
        s: !nw ? "файла нет" : String(nw.number) !== cur ? "собраны для тиража №" + nw.number : nl ? "давно не обновлялись" : "свежие" });
      var sl = !si ? 1 : String(si.number) !== cur ? 1 : 0;
      rows.push({ n: "Сайты команд", d: "Wikidata, для новых команд тиража", at: si && si.at, lv: sl,
        s: !si ? "файла нет" : String(si.number) !== cur ? "собраны для тиража №" + si.number : "готовы" });
      dstat = { at: Date.now(), res: rows };
      var worst = rows.reduce(function(x, y){ return Math.max(x, y.lv); }, 0);
      var dot = $("dataDot");
      if(dot) dot.className = "data-dot lv" + worst;
      var b = $("btnFeedSt");
      if(b) b.title = worst === 0 ? "Данные: всё обновляется" : worst === 1 ? "Данные: что-то запаздывает — нажми, чтобы посмотреть" : "Данные: есть проблема — нажми, чтобы посмотреть";
      return rows;
    });
  }
  function showData(){
    $("evTitle").textContent = "Состояние данных";
    var box = $("evBody");
    box.innerHTML = '<p class="ev-note">Проверяю…</p>';
    $("evBack").hidden = false;
    checkData(true).then(function(rows){
      var lab = ["норма", "запаздывает", "проблема"];
      box.innerHTML = '<ul class="ds-ul">' + rows.map(function(r){
        return '<li><span class="data-dot lv' + r.lv + '" aria-label="' + lab[r.lv] + '"></span>' +
          '<div><b>' + escHtml(r.n) + '</b> — ' + escHtml(r.s) +
          '<span class="nw-meta">' + escHtml(r.d) + ' · ' + escHtml(r.at ? ageTxt(r.at) : "время неизвестно") + '</span></div></li>';
      }).join("") + '</ul>' +
      '<p class="ev-note">Время — московское. Основной источник — totobrief, запасной — stavka.tv: если один молчит, сайт берёт данные из другого и из зеркала на GitHub.</p>';
    });
  }
  function showFeed(){
    var wrap = $("tkFeedWrap");
    if(feed.src !== "mirror"){ wrap.hidden = true; return; }
    wrap.hidden = false;
    $("tkFeedNote").textContent = "";
    if(Date.now() - feed.statusAt < 10 * 60000){ feedNote(); return; }
    feed.statusAt = Date.now();
    fetch(MIRROR + "status.json?t=" + Math.floor(Date.now() / 60000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ feed.status = j; feedNote(); })
      .catch(function(){ feedNote(); });
  }
  function feedNote(){
    var st = feed.status, note = $("tkFeedNote"), wrap = $("tkFeedWrap");
    if(!st){ note.textContent = ""; return; }
    var tb = fmtStamp(st.totobrief_ok_at), sv = fmtStamp(st.stavka_ok_at);
    note.textContent = tb ? " · totobrief " + fmtStamp(st.totobrief_ok_at, true) : " · снимка totobrief нет";
    wrap.title = "totobrief не отвечает — данные взяты из зеркала на GitHub." +
      (tb ? " Последний живой снимок totobrief (проценты и коэффициенты на тот момент): " + tb + " МСК." : "") +
      (sv ? " Составы и результаты со stavka.tv: " + sv + " МСК." : "") +
      (st.updated_at ? " Зеркало обновлено " + fmtStamp(st.updated_at) + " МСК." : "");
  }

  /* Доли игроков и оценка конторы приезжают в одном ответе, но появляются в РАЗНОЕ
     время: у только что открытого тиража пула ещё нет, а коэффициенты уже есть.
     Раньше обе части висели на одном условии, и на свежем тираже расчёт молчал
     целиком. Теперь каждая половина живёт сама по себе. */
  function mkPct(q){
    var pool = (q.pool_win_1 != null) ? [q.pool_win_1, q.pool_draw, q.pool_win_2] : null;
    var bk   = (q.bk_win_1   != null) ? [q.bk_win_1,   q.bk_draw,   q.bk_win_2]   : null;
    if(!pool && !bk) return null;
    return { pool: pool, bk: bk };
  }

  function splitTeams(name){
    var parts = String(name || "").split(/\s+[—–−-]\s+/);
    if(parts.length < 2) return null;
    return [parts[0].trim(), parts.slice(1).join(" - ").trim()];
  }

  function curSig(){ return state.matches.map(function(m){ return (m.res || "") + "|" + (m.score || "") + "|" + JSON.stringify(m.pct || 0) + "|" + JSON.stringify(m.kf || 0); }).join(";"); }
  /* тот же тираж: обновляем только доли игроков и коэффициенты, ничего не стирая */
  function refreshPct(info){
    var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
    if(evs.length !== state.matches.length) return false;
    var i, t;
    for(i = 0; i < evs.length; i++){
      t = splitTeams(evs[i].name);
      if(!t || t[0] !== state.matches[i].home || t[1] !== state.matches[i].away) return false;
    }
    var psig0 = curSig();
    for(i = 0; i < evs.length; i++){
      var q = evs[i].quotes || {}, m = state.matches[i];
      var np = mkPct(q); if(np) m.pct = np;
      if(q.norm_win_1 != null) m.kf = [q.norm_win_1, q.norm_draw, q.norm_win_2];
      /* сыгранные матчи: фактический исход и счёт приезжают в том же ответе */
      m.res = evRes(evs[i], info);
      mergeScore(m, evs[i].score || "");
    }
    state.resAt = Date.now();          /* когда данные с totobrief пришли в последний раз */
    if(info.id) state.tirazhId = info.id;
    save();
    var pch = psig0 !== curSig();
    if(!pch && !book && UJ.silent){ dbgLog("totobrief", "текущий тираж: без изменений, перерисовку пропускаем"); renderKickoff(); return true; }
    if(book) bookShow(); else render();   /* bookShow сам вызывает render и пересчитывает «по факту угадано» */
    return true;
  }

  var HIST_PAGES = C.HIST_PAGES;          /* 6 страниц по 50 тиражей ≈ год истории */
  var histLoading = false;

  /* Шкала ценности тиража строится по завершённым тиражам: медиана, четверти и
     верхние 5%. Чем длиннее история, тем честнее шкала. */
  function applyHistory(rows){
    var fin = rows.filter(function(x){ return x.status === "finished" && Number(x.pool_sum) > 0; });
    var pools = fin.map(function(x){ return Number(x.pool_sum); }).sort(function(a,b){ return a-b; });
    var rr = fin.filter(function(x){ return Number(x.jackpot) > 0; })
                .map(function(x){ return Number(x.jackpot) / Number(x.pool_sum); })
                .sort(function(a,b){ return a-b; });
    if(!rr.length) return;
    var q = function(p){ return rr[Math.min(rr.length - 1, Math.round(p * (rr.length - 1)))]; };
    state.poolTypical = pools.length ? pools[Math.floor(pools.length/2)] : state.poolTypical;
    state.ratioTypical = q(0.5);
    state.ratioQ = [q(0.25), q(0.5), q(0.75), q(0.95)];
    state.ratioList = rr;
    state.finCount = fin.length;
    /* суперприз ровно в миллион — значит в прошлом тираже кто-то взял 15 из 15 */
    state.jackWins = fin.filter(function(x){ return Number(x.jackpot) <= 1000001; }).length;
  }

  /* история нужна только для медиан фонда и суперприза — раз в 6 часов хватает.
     Без этого опрос счёта раз в минуту каждый раз тянул бы ещё 5 страниц списка тиражей */
  var histAt = 0;
  function loadHistory(firstPage){
    if(histLoading || typeof fetch !== "function") return;
    if(histAt && Date.now() - histAt < 6 * 3600 * 1000) return;
    histAt = Date.now();
    histLoading = true;
    var jobs = [];
    for(var p = 2; p <= HIST_PAGES; p++){
      jobs.push(apiFetch("baltbet-main/drawings?page=" + p)
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ return (j && j.data) || []; })
        .catch(function(){ return []; }));
    }
    Promise.all(jobs).then(function(pages){
      var seen = {}, all = [];
      firstPage.concat.apply(firstPage, pages).forEach(function(x){
        var k = String(x.number);
        if(seen[k]) return;
        seen[k] = 1; all.push(x);
      });
      applyHistory(all);
      save(); render();
    }).catch(function(){}).then(function(){ histLoading = false; });
  }

  var COUPON_KEEP = 12;
  function couponStash(){
    if(!state.tirazh || !state.matches.length) return;
    var has = state.matches.some(function(m){ return countPicks(m) > 0 || m.mode !== "free"; }) || (state.played || []).length;
    if(!state.coupons || typeof state.coupons !== "object") state.coupons = {};
    if(!has){ delete state.coupons[state.tirazh]; return; }
    state.coupons[state.tirazh] = {
      at: Date.now(),
      rows: state.matches.map(function(m){ return { k: m.home + "|" + m.away, picks: { "1": !!m.picks["1"], "X": !!m.picks["X"], "2": !!m.picks["2"] }, mode: m.mode, pool: (m.pool || OUT).slice() }; }),
      played: (state.played || []).slice(), spent: state.spent || 0, rolls: state.rolls || 0
    };
    var ks = Object.keys(state.coupons).sort(function(a, b){ return state.coupons[b].at - state.coupons[a].at; });
    ks.slice(COUPON_KEEP).forEach(function(k){ delete state.coupons[k]; });
  }
  function couponUnstash(){
    var c = state.coupons && state.coupons[state.tirazh];
    if(!c) return false;
    var by = {};
    c.rows.forEach(function(r){ by[r.k] = r; });
    var n = 0;
    state.matches.forEach(function(m){
      var r = by[m.home + "|" + m.away]; if(!r) return;
      m.picks = { "1": !!r.picks["1"], "X": !!r.picks["X"], "2": !!r.picks["2"] };
      m.mode = r.mode === "rand" || r.mode === "lock" ? r.mode : "free";
      if(Array.isArray(r.pool) && r.pool.length) m.pool = r.pool.slice();
      n++;
    });
    if(n){ state.played = (c.played || []).slice(); state.spent = c.spent || 0; state.rolls = c.rolls || 0; c.played = []; }   /* копию корзины не держим дважды: при уходе с тиража она запишется заново */
    return n > 0;
  }
  function matchesFromInfo(info){
    var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
    var list = [];
    evs.forEach(function(e, i){
      var t = splitTeams(e.name);
      if(!t) return;
      var q = e.quotes || {};
      list.push({
        id: "api" + info.id + "_" + i,
        date: "", time: "",
        league: e.championship || "",
        home: t[0], away: t[1],
        picks: {"1":false,"X":false,"2":false},
        pool: OUT.slice(),
        mode: "free",   /* режимы не проставляем: «рандом» ставится вручную или кнопкой */
        pct: mkPct(q),
        /* коэффициенты конторы приходят в том же ответе, отдельного источника не нужно */
        kf: (q.norm_win_1 != null) ? [q.norm_win_1, q.norm_draw, q.norm_win_2] : null,
        /* фактический исход и счёт — пусто, пока матч не сыгран */
        res: evRes(e, info),
        score: e.score || ""
      });
    });
    return list;
  }
  function applyDrawing(info){
    var list = matchesFromInfo(info);
    if(!list.length) throw new Error("в ответе нет матчей");

    /* купон у каждого тиража свой и не теряется: уходя с тиража, запоминаем его,
       а вернувшись (или перезагрузив тот же тираж) — поднимаем обратно */
    var tzWas = state.tirazh;
    couponStash();
    pushHistory("до обновления тиража", true);
    /* тираж сменился — прошлый уходит в «один шаг назад» (только результаты и счёт) */
    /* берём его, только если он ровно предыдущий: иначе (первый запуск, пропущенные тиражи)
       «один шаг назад» подтянет seedPrev по номеру — стрелка всегда ведёт на тираж перед текущим */
    if(state.matches.length && state.tirazh && Number(info.number) === Number(state.tirazh) + 1){
      state.prev = snapPrev(state.tirazh, state.tirazhId, state.deadline, state.matches, state.poolSum);
    }
    state.viewPrev = false;
    state.tirazhId = info.id || null;
    state.matches = list;
    state.tirazh = String(info.number || state.tirazh);
    state.deadline = info.ended_at || state.deadline;
    state.resAt = Date.now();
    state.played = [];
    state.spent = 0;
    state.rolls = 0;
    couponUnstash();
    histArmed = -1;
    save();
    /* тихая смена тиража (в корзине пусто) — не действие человека, «Назад» через неё не ходит */
    if(UJ.silent && String(tzWas) !== String(state.tirazh)) ujReset();
    $("tirazhName").value = state.tirazh;
    render();
    attachFsTimes(); attachFsLogos();
    setTimeout(seedPrev, 1500);
    return list.length;
  }

  /* ---------- предыдущий тираж: один шаг назад ---------- */
  function mkVoid(){
    var sc = document.createElement("span");
    sc.className = "mscore void";
    sc.textContent = "отменён";
    sc.title = "Матч отменён: Балтбет засчитывает его угаданным для любой ставки";
    return sc;
  }
  function snapPrev(tirazh, id, deadline, matches, pool){
    /* собственные дата, пул и суперприз тиража — из списка тиражей, если он уже подтянут */
    var own = (state.drawByNo || {})[String(tirazh || "")] || {};
    return {
      tirazh: String(tirazh || ""), id: id || null, deadline: own.end || deadline || "", at: Date.now(),
      pool: own.pool || Number(pool) || 0, jack: own.jack || 0,
      matches: matches.map(function(m){
        var o = { home: m.home, away: m.away, league: m.league || "", res: m.res || "", score: m.score || "",
                  date: m.date || "", time: m.time || "" };
        if(m.fsVoid) o.fsVoid = m.fsVoid;
        /* доли игроков и конторы и коэффициенты на момент закрытия — для раскрытой строки в просмотре */
        if(m.pct) o.pct = m.pct;
        if(m.kf) o.kf = m.kf;
        return o;
      })
    };
  }
  function prevSig(p){ return p.matches.map(function(m){ return (m.res || "") + "|" + (m.score || "") + "|" + (m.fsVoid || ""); }).join(";"); }
  function prevDone(){
    return !!(state.prev && state.prev.matches.every(function(m){ return m.res; }));
  }
  /* счёт и итоги прошлого тиража — тем же ответом drawing-info */
  function refreshPrev(){
    var p = state.prev;
    if(!p || p.cur || !p.id || typeof fetch !== "function" || prevDone()) return;
    var tr0 = Date.now();
    apiFetch("drawing-info/" + p.id)
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j) return;
        var info = j.data || j;
        var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
        if(evs.length !== p.matches.length) return;
        var sig0 = prevSig(p);
        evs.forEach(function(e, i){
          p.matches[i].res = evRes(e, info);
          mergeScore(p.matches[i], e.score || "");
        });
        p.at = Date.now();
        save();
        var ch = sig0 !== prevSig(p);
        dbgLog("totobrief", "прошлый тираж: " + (Date.now() - tr0) + " мс, " + (ch ? "есть изменения" : "без изменений"));
        DBG.api["прошлый"] = { ms: Date.now() - tr0, at: Date.now() };
        if(state.viewPrev && ch) renderSoon("totobrief");
      })
      .catch(function(e){ DBG.api["прошлый"] = { ms: Date.now() - tr0, at: Date.now(), err: 1 }; dbgLog("err", "totobrief (прошлый тираж): " + (e && e.message || e)); });
  }
  /* при первом запуске после обновления прошлого тиража ещё нет — подтягиваем его по номеру */
  function seedPrev(){
    if(!state.tirazh || typeof fetch !== "function") return;
    var wantN = Number(state.tirazh) - 1;
    if(state.viewPrev && state.prev) return;      /* просмотр открыт — его тираж не подменяем */
    /* снимок без процентов и кэфов (сделан до их сохранения) — один раз дополняем из API */
    if(state.prev && !state.prev.matches.some(function(m){ return m.pct || m.kf; })){
      var pn = Number(state.prev.tirazh);
      if(isFinite(pn) && pn > 0){ prevLoad(pn, !!state.viewPrev); return; }
    }
    if(state.prev && Number(state.prev.tirazh) === wantN) return;
    if(!isFinite(wantN) || wantN <= 0) return;
    prevLoad(wantN, false);
  }
  /* загрузить в просмотр любой закрытый тираж по номеру (для сохранённых вариантов старых тиражей) */
  function prevLoad(wantN, open, fail){
    apiFetch("baltbet-main/drawings?page=1")
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var rows = (j && j.data) || [], d = null, i;
        for(i = 0; i < rows.length; i++) if(String(rows[i].number) === String(wantN)){ d = rows[i]; break; }
        if(!d){ if(fail) fail(); return null; }
        return apiFetch("drawing-info/" + d.id).then(function(r){ return r.ok ? r.json() : null; })
          .then(function(j2){
            if(!j2) return;
            var info = j2.data || j2;
            var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
            var list = [];
            evs.forEach(function(e){
              var t = splitTeams(e.name);
              if(!t) return;
              var qq = e.quotes || {};
              list.push({ home: t[0], away: t[1], league: e.championship || "",
                          res: evRes(e, info), score: e.score || "",
                          pct: mkPct(qq), kf: (qq.norm_win_1 != null) ? [qq.norm_win_1, qq.norm_draw, qq.norm_win_2] : null });
            });
            if(!list.length){ if(fail) fail(); return; }
            if(!open && Number(state.tirazh) - 1 !== Number(d.number)) return;   /* пока тянули, тираж уже сменился */
            if(state.prev && String(state.prev.tirazh) === String(d.number)){
              /* снимок сделан раньше без долей и кэфов — дополняем, ничего не стирая */
              var pmM = state.prev.matches, fillN = 0;
              if(pmM.length === list.length) pmM.forEach(function(pm, i){
                if(!pm.pct && list[i].pct && pm.home === list[i].home){ pm.pct = list[i].pct; fillN++; }
                if(!pm.kf && list[i].kf && pm.home === list[i].home){ pm.kf = list[i].kf; fillN++; }
              });
              if(fillN){ save(); if(open) enterPrev(); else render(); return; }
              if(open) enterPrev(); return;
            }
            state.prev = snapPrev(d.number, d.id, d.ended_at || "", list, d.pool_sum);
            save();
            if(open) enterPrev(); else render();
          });
      })
      .catch(function(){ if(fail) fail(); });
  }
  var PVUI_KEY = "dzhek-pvui", pvFlt = "all", pvFltTir = "";
  var pvOpen = (function(){
    try{
      var u = JSON.parse(localStorage.getItem(PVUI_KEY) || "null");
      if(u){ pvFlt = u.flt || "all"; pvFltTir = u.tir || ""; return u.open && typeof u.open === "object" ? u.open : {}; }
    }catch(e){}
    return {};
  })();
  /* что раскрыто и какой фильтр — запоминаем, после обновления страницы всё на месте */
  function pvSave(){
    try{
      var tir = state.prev ? String(state.prev.tirazh) : pvFltTir, keep = {};
      Object.keys(pvOpen).forEach(function(k){ if(k.indexOf(tir + "|") === 0) keep[k] = 1; });
      pvOpen = keep; pvFltTir = tir;
      localStorage.setItem(PVUI_KEY, JSON.stringify({ tir: tir, flt: pvFlt, open: keep }));
    }catch(e){}
  }
  var PVF = [["all", "Все"], ["live", "Идут"], ["wait", "Ждём"], ["fin", "Сыграны"]];
  function pvStat(row){ return row.classList.contains("st-live") ? "live" : row.classList.contains("st-fin") ? "fin" : "wait"; }
  function pvFltRender(){
    var box = document.getElementById("pvFlt"); if(!box) return;
    var rows = document.querySelectorAll("#rows .row"), cnt = { all: rows.length, live: 0, wait: 0, fin: 0 }, i;
    for(i = 0; i < rows.length; i++) cnt[pvStat(rows[i])]++;
    /* фильтр, который ничего не меняет (равен «Все») или пуст, сбрасывается */
    if(pvFlt !== "all" && (!cnt[pvFlt] || cnt[pvFlt] === cnt.all)) pvFlt = "all";
    var h = "";
    PVF.forEach(function(f){
      var c = cnt[f[0]], off = f[0] !== "all" && (!c || c === cnt.all);
      h += '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (pvFlt === f[0]) + '"' + (off ? " disabled" : "") + '>' + f[1] + ' <small>' + c + '</small></button>';
    });
    box.innerHTML = h;
    for(i = 0; i < rows.length; i++) rows[i].classList.toggle("pv-hide", pvFlt !== "all" && pvStat(rows[i]) !== pvFlt);
    box.hidden = false;
  }
  function pvExpSync(){
    var b = document.getElementById("btnPrevExp"); if(!b) return;
    var rows = document.querySelectorAll("#rows .row"), all = rows.length > 0;
    for(var i = 0; i < rows.length; i++) if(!rows[i].classList.contains("open")){ all = false; break; }
    b.textContent = all ? "Свернуть все" : "Раскрыть все";
    b.setAttribute("aria-pressed", all ? "true" : "false");
    pvSave();
  }
  function renderPrevView(){
    var p = state.prev;
    rowsEl.innerHTML = "";
    /* кнопки «Показать проценты / кэфы» в просмотре живут по данным самого просмотренного тиража */
    var pvPb = $("btnPct"), pvKb = $("btnKf"), pvHasP = p.matches.some(function(m){ return m.pct; }), pvHasK = p.matches.some(function(m){ return m.kf; });
    pvPb.hidden = false; pvPb.disabled = !pvHasP; pvPb.setAttribute("aria-pressed", state.showPct ? "true" : "false");
    pvPb.textContent = state.showPct ? "Скрыть проценты" : "Показать проценты";
    pvKb.hidden = false; pvKb.disabled = !pvHasK; pvKb.setAttribute("aria-pressed", state.showKf ? "true" : "false");
    pvKb.textContent = state.showKf ? "Скрыть кэфы" : "Показать кэфы";
    aiPrevEnsure(p.tirazh);
    var aiN = { done: 0, hit: 0, live: 0, liveHit: 0 };
    /* просмотр прошлого тиража — только счёт и итоги, без своего купона */
    p.matches.forEach(function(m, idx){
      var row = document.createElement("div");
      row.className = "row";
      var num = document.createElement("div");
      num.className = "num"; num.textContent = String(idx + 1);
      numNews(num, m, idx, true);
      row.appendChild(num);
      var fix = document.createElement("div");
      fix.className = "fix";
      var teams = document.createElement("div");
      teams.className = "teams";
      teams.title = m.home + " — " + m.away + (m.league ? " · " + m.league : "");
      var cont = continentCode(m.league);
      var hc = cont.hit ? teamCode(m.home) : null;
      var ac = cont.hit ? teamCode(m.away) : null;
      var natM = isNatLeague(m.league), he = mkEmb(m.home, hc || natM), ae = mkEmb(m.away, ac || natM);
      /* каждая команда в своём span: на телефоне названия встают отдельными строками */
      var tmH = document.createElement("span"), tmA = document.createElement("span");
      tmH.className = "tm"; tmA.className = "tm";
      if(he) tmH.appendChild(he); else if(hc) tmH.appendChild(mkFlag(hc, "tflag", m.home));
      tmH.appendChild(document.createTextNode(m.home));
      teams.appendChild(tmH);
      var vs = document.createElement("span"); vs.className = "vs"; vs.textContent = "—";
      teams.appendChild(vs);
      if(ae) tmA.appendChild(ae); else if(ac) tmA.appendChild(mkFlag(ac, "tflag", m.away));
      tmA.appendChild(document.createTextNode(m.away));
      teams.appendChild(tmA);
      if(m.res === VOID || m.res || m.score) teams.classList.add("has-sc");
      if(m.res === VOID){
        teams.appendChild(mkVoid());
      } else if(m.res || m.score){
        var sc = document.createElement("span");
        sc.className = "mscore" + (m.res ? "" : " live");
        fillScore(sc, m);
        sc.title = m.res ? "матч сыгран, итог " + m.res : "счёт по ходу матча, итог ещё не подведён";
        if(m.res){
          var rs = document.createElement("span");
          rs.className = "mres";
          rs.textContent = (m.score ? " · " : "") + m.res;
          sc.appendChild(rs);
        }
        teams.appendChild(sc);
      }
      /* телефон и планшет: кнопка Flashscore стоит прямо у счёта, а не прячется в раскрытой строке */
      var fsNear = mkFs(m); fsNear.classList.add("fs-near");
      /* рядом с FS — кнопка «ИИ» (разбор матча), чтобы читать аналитику, пока идёт игра */
      var nearW = document.createElement("span"); nearW.className = "near-btns";
      if(aiPrevRec(p.tirazh, idx)){ var aiNear = mkAiPrev(m, idx, p.tirazh, true); aiNear.classList.add("ai-near"); nearW.appendChild(aiNear); }
      nearW.appendChild(fsNear); teams.appendChild(nearW);
      var aiRec = aiPrevRec(p.tirazh, idx), aiEl = mkAiLive(aiRec, m);
      if(aiEl){
        teams.appendChild(aiEl);
        var lo = liveOutcome(m), okk = aiRec.p.indexOf(lo.o) >= 0;
        if(lo.live){ aiN.live++; if(okk) aiN.liveHit++; } else { aiN.done++; if(okk) aiN.hit++; }
      }
      fix.appendChild(teams);
      var meta = document.createElement("div");
      meta.className = "meta";
      var code = cont.hit ? ((hc || ac) ? null : cont.flag) : flagCode(m.league);
      if(code) meta.appendChild(mkFlag(code, "flag"));
      meta.appendChild(document.createTextNode([m.date, m.time, m.league].filter(Boolean).join("  ·  ")));
      meta.appendChild(mkAiPrev(m, idx, p.tirazh, false));
      liveDecor(m, row, meta);
      /* телефон: значок LIVE и метка ИИ стоят в одной строке под командами (копии, оригиналы там скрыты) */
      var stl = document.createElement("div"); stl.className = "st-line";
      var lcEl = meta.querySelector(".lv-chip"), alEl = teams.querySelector(".ai-live");
      if(lcEl) stl.appendChild(lcEl.cloneNode(true));
      if(alEl) stl.appendChild(alEl.cloneNode(true));
      fix.appendChild(meta);
      if(stl.firstChild) fix.appendChild(stl);
      /* телефон: слева время или минута, цвет полосы — угадал ли ИИ; строка раскрывается по тапу */
      var li2 = liveInfo(m), lo2 = liveOutcome(m), fin2 = !!m.res || (li2 && li2.end);
      var tcol = document.createElement("div"); tcol.className = "tcol";
      var tt, tAttr = "";
      if(m.res === VOID) tt = "ОТМ";
      else if(m.res) tt = "Full time";
      else if(fin2) tt = "КОНЕЦ";
      else if(li2){
        var mn2 = liveMinute(li2.ph, li2.hockey, true);
        tt = mn2 && mn2.t !== "" ? String(mn2.t) : "LIVE";
        if(mn2 && mn2.tick && li2.ph) tAttr = ' data-ac="' + li2.ph.ac + '" data-ao="' + escHtml(li2.ph.ao || "") + '" data-bx="' + escHtml(li2.ph.bx || "") + '" data-at="' + li2.ph.at + '" data-h="' + (li2.hockey ? 1 : 0) + '" data-s="1"';
        if(mn2 && mn2.n != null) row.style.setProperty("--p", Math.min(100, Math.round(mn2.n / mn2.tot * 100)) + "%");
      } else tt = m.time || "—";
      var ppTag = !m.res && !m.score && m.fsVoid ? (m.fsVoid === "отменён" ? "ОТМЕНЁН" : "ПЕРЕНОС") : "";
      if(ppTag) tt = ppTag;
      tcol.innerHTML = '<b class="tc-t' + (li2 && !fin2 ? " tc-live lv-min" : "") + (tt === "Full time" ? " tc-ft" : "") + (tt === "КОНЕЦ" ? " tc-end" : "") + '"'  + tAttr + '>' + (tt === "Full time" ? "Full<br>time" : escHtml(tt)) + '</b><i class="tc-n">' + (idx + 1) + '</i>';
      if(ppTag){ var tcb = tcol.querySelector(".tc-t"); if(tcb) tcb.classList.add("tc-pp"); }
      row.insertBefore(tcol, num.nextSibling);
      if(li2 && !fin2) row.classList.add("st-live", "is-lv");
      if(fin2) row.classList.add("st-fin");
      if(aiRec && lo2) row.classList.add(aiRec.p.indexOf(lo2.o) >= 0 ? "ai-ok" : "ai-no");
      var okey = p.tirazh + "|" + idx;
      if(pvOpen[okey]) row.classList.add("open");
      row.addEventListener("click", function(ev){
        if(document.documentElement.getAttribute("data-compact") === "1") return;
        if(ev.target.closest("button, a")) return;
        row.classList.add("anim");
        var on = row.classList.toggle("open");
        if(on) pvOpen[okey] = 1; else delete pvOpen[okey];
        pvExpSync();
      });
      row.appendChild(fix);
      var picksWrap = document.createElement("div");
      picksWrap.className = "picks-m";
      OUT.forEach(function(o){
        var cell = document.createElement("div");
        cell.className = "pick-cell";
        var b = document.createElement("button");
        b.type = "button"; b.disabled = true;
        b.className = "pick " + (o === "1" ? "p1" : o === "X" ? "px" : "p2");
        b.textContent = o;
        if(m.res === o) b.classList.add("won");
        if(aiRec && aiRec.p.indexOf(o) >= 0){ b.classList.add("ai-pk"); b.title = "в варианте ИИ"; }
        cell.appendChild(b);
        var oi = OUT.indexOf(o), hit = m.res === o;
        if(hit) cell.classList.add("hit");
        /* проценты (игроки / контора) и кэфы на момент закрытия тиража; зашедший исход подсвечен */
        if(state.showPct && m.pct && m.pct.pool){
          var ppl = Number(m.pct.pool[oi]), pbk = m.pct.bk ? Number(m.pct.bk[oi]) : null;
          var pAll = m.pct.pool.map(Number), pTop = Math.max.apply(null, pAll), pLow = Math.min.apply(null, pAll);
          var pc = document.createElement("div");
          pc.className = "pct-col" + (ppl === pTop && pTop !== pLow ? " lead" : (ppl === pLow && pTop !== pLow ? " rare" : "")) + (hit ? " hit" : "");
          pc.title = "Игроки " + ppl + "%" + (pbk === null || !isFinite(pbk) ? "" : " · контора " + pbk + "%") + " на момент закрытия" + (hit ? " · исход зашёл" : "");
          pc.innerHTML = "<b>" + ppl + "</b><i>" + (pbk === null || !isFinite(pbk) ? "\u2014" : pbk) + "</i>";
          cell.appendChild(pc);
        }
        if(state.showKf && m.kf){
          var kv2 = Number(m.kf[oi]), ks2 = m.kf.map(Number).filter(function(x){ return isFinite(x) && x > 0; }).sort(function(x, y){ return x - y; });
          var kc = document.createElement("div");
          kc.className = "kf-col" + (ks2.length === 3 && ks2[1] - ks2[0] > 0.001 && kv2 === ks2[0] ? " fav" : (ks2.length === 3 && ks2[2] - ks2[1] > 0.001 && kv2 === ks2[2] ? " dog" : "")) + (hit ? " hit" : "");
          kc.textContent = (kv2 && isFinite(kv2)) ? kv2.toFixed(2) : "\u2014";
          kc.title = "Коэффициент конторы на момент закрытия" + (hit ? " · исход зашёл" : "");
          cell.appendChild(kc);
        }
        picksWrap.appendChild(cell);
      });
      row.appendChild(picksWrap);
      var modes = document.createElement("div");
      modes.className = "modes";
      modes.appendChild(mkFs(m));
      modes.appendChild(mkAiPrev(m, idx, p.tirazh, true));
      row.appendChild(modes);
      rowsEl.appendChild(row);
    });
    var done = p.matches.filter(function(m){ return m.res; }).length;
    var live = p.matches.filter(function(m){ return !m.res && m.score; }).length;
    var voids = p.matches.filter(function(m){ return m.res === VOID; }).length;
    var bar = $("prevBar");
    var curN = Number(state.tirazh), prvN = curN - 1, pn = Number(p.tirazh);
    var tabsH = '<span class="pb-tabs' + (pn !== curN && pn !== prvN ? ' t3' : '') + '" role="tablist" aria-label="Тиражи">' +
      '<button type="button" role="tab" data-n="' + prvN + '" aria-selected="' + (pn === prvN) + '"><small>Предыдущий</small><b>№' + prvN + '</b></button>' +
      '<button type="button" role="tab" data-n="' + curN + '" aria-selected="' + (pn === curN) + '"><small>Текущий · приём</small><b>№' + curN + '</b></button>' +
      (pn !== curN && pn !== prvN ? '<button type="button" role="tab" data-n="' + pn + '" aria-selected="true"><small>По ссылке</small><b>№' + pn + '</b></button>' : '') +
      '</span>';
    bar.innerHTML = tabsH + '<span class="pb-t">Просмотр тиража ' + escHtml(p.tirazh) + '</span>' + (p.cur ? '<span class="pb-nst">ещё не начался</span>' : '') +
      '<span>сыграно <b>' + done + '</b> из ' + p.matches.length + '</span>' +
      (live ? '<span>идёт <b>' + live + '</b></span>' : '') +
      (p.matches.length - done - live - voids > 0 ? '<span>ждём <b>' + (p.matches.length - done - live - voids) + '</b></span>' : '') +
      '<span id="pbBest" hidden>лучший набор <b></b></span>' +
      '<span id="pbSum" hidden title="Сумма всех загруженных наборов этого тиража">сумма <b></b></span>' +
      (voids ? '<span title="засчитан угаданным для любой ставки">отменён <b>' + voids + '</b></span>' : '') +
      (aiN.done || aiN.live ? '<span class="pb-ai" title="Вариант ИИ: угадано из сыгранных · в лайве по текущему счёту">' +
        '<svg class="pb-ring" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><circle cx="16" cy="16" r="12" class="rg-bg"/><circle cx="16" cy="16" r="12" class="rg-fg" style="--rg:' +
        (75.4 * (aiN.hit + aiN.liveHit) / (aiN.done + aiN.live)).toFixed(1) + '"/></svg>ИИ' +
        (aiN.done ? ' <b>' + aiN.hit + '/' + aiN.done + '</b>' : '') + (aiN.done && aiN.live ? ' ·' : '') +
        (aiN.live ? ' в лайве <b>' + aiN.liveHit + '/' + aiN.live + '</b>' : '') + '</span>' : '') +
      (p.at ? '<span>обновлено <b>' + new Date(p.at).toTimeString().slice(0,5) + '</b></span>' : '') +
      '<button type="button" class="pb-exp" id="btnPrevExp">Раскрыть все</button>' +
      '<button type="button" class="pb-back" id="btnPrevBack">К текущему тиражу &#8250;</button>' +
      '<div class="pb-flt" id="pvFlt" role="group" aria-label="Фильтр матчей" hidden></div>';
    bar.hidden = false;
    [].slice.call(bar.querySelectorAll(".pb-tabs button")).forEach(function(bt){
      bt.addEventListener("click", function(){
        var n = Number(bt.getAttribute("data-n"));
        if(n !== Number(p.tirazh)) viewNavTo(n);
      });
    });
    if(pvFltTir !== String(p.tirazh)){ pvFlt = "all"; pvFltTir = String(p.tirazh); }
    pvFltRender();
    $("pvFlt").addEventListener("click", function(ev){
      var bt = ev.target.closest("button[data-f]"); if(!bt || bt.disabled) return;
      pvFlt = bt.getAttribute("data-f"); pvFltRender(); pvSave();
    });
    $("btnPrevBack").addEventListener("click", leavePrev);
    $("btnPrevExp").addEventListener("click", function(){
      var rows = document.querySelectorAll("#rows .row"), all = true, i;
      for(i = 0; i < rows.length; i++) if(!rows[i].classList.contains("open")){ all = false; break; }
      for(i = 0; i < rows.length; i++){
        var k = p.tirazh + "|" + i;
        if(all){ rows[i].classList.remove("open"); delete pvOpen[k]; } else { rows[i].classList.add("open"); pvOpen[k] = 1; }
      }
      pvExpSync();
    });
    pvExpSync();
    renderPrevCsv();
  }

  /* ---------- CSV в прошлом тираже: весь купон и варианты по 30 — следить за угаданными ----------
     Файл читается только здесь и хранится в браузере (последние 3 тиража), купон не трогает. */
  var PCSV_KEY = "dzhek-prevcsv", PCSV_PAGE = 30;
  /* наборов вариантов на тираж может быть несколько (файлы и ссылки) — переключаются вкладками */
  var pcsv = { tir: null, sets: [], act: 0, name: "", rows: [], sys: [], page: 0, sort: "hits" };
  function pcsvUse(i){
    var st = pcsv.sets[i];
    pcsv.act = st ? i : 0; pcsv.page = 0; pcsv.flt = "all"; pcsv.what = null;
    pcsv.name = st ? st.name : ""; pcsv.rows = st ? st.rows : []; pcsv.sys = st ? (st.sys || []) : [];
  }
  function pcsvEnsure(tir){
    if(pcsv.tir === tir) return;
    var saved = pcsvAll()[tir] || null, sets = [];
    if(saved && saved.sets) sets = saved.sets.map(function(st){ return { name: st.name, link: st.link || 0, sys: st.sys || [], rows: st.rows || pcsvExpand(st.sys || []) }; });
    else if(saved && saved.rows) sets = [{ name: saved.name || "Файл", rows: saved.rows, sys: saved.sys || saved.rows }];
    pcsv = { tir: tir, sets: sets, act: 0, page: 0, sort: pcsv.sort || "hits", view: pcsv.view, msg: pcsv.msg, msgAt: pcsv.msgAt };
    pcsvUse(saved && saved.act < sets.length ? saved.act : 0);
  }
  function pcsvExpand(sys){
    var out = [];
    for(var i = 0; i < sys.length && out.length < MAX_CSV; i++){
      var combo = [""];
      String(sys[i]).split(",").forEach(function(c){
        var nx = [];
        combo.forEach(function(pfx){ for(var k = 0; k < c.length; k++) nx.push(pfx + c.charAt(k)); });
        combo = nx;
      });
      for(var q = 0; q < combo.length && out.length < MAX_CSV; q++) out.push(combo[q]);
    }
    return out;
  }
  /* набор ИИ: варианты, которые ИИ проставил по тиражу, собираются сами и идут в рейтинг с пометкой «ИИ».
     В хранилище не пишется: каждый раз строится заново из ai.json / ai_hist.json */
  function pcsvMine(){ return pcsv.sets.filter(function(x){ return !x.ai; }); }
  /* Бриф ИИ на 14 из 15: готовые строки лежат в ai.json (br, пока тираж текущий) или в ai_arch.json (br, после смены).
     Строка — 15 символов исходов, например "X21X..." */
  function aiPrevBrief(no){
    var j = ai.data, b = null;
    if(j && String(j.number) === String(no) && Array.isArray(j.br) && j.br.length) b = j.br;
    else { var ar = aiArch.data && aiArch.data[String(no)]; if(ar && Array.isArray(ar.br) && ar.br.length) b = ar.br; }
    return b && b.every(function(x){ return /^[1X2]{15}$/.test(String(x).replace(/,/g, "")); }) ? b : null;
  }
  function pcsvSyncAi(){
    var p = state.prev; if(!p || pcsv.tir !== String(p.tirazh)) return;
    var picks = [], i, sys, nm = "ИИ-разбор · виртуальный", br = aiPrevBrief(p.tirazh);
    if(br){
      /* строки брифа идут как есть: каждая — один вариант, поэтому в набор попадают именно они, а не весь купон */
      sys = br.map(function(x){ return x.replace(/,/g, "").split("").join(","); }); nm = "ИИ-бриф · виртуальный";
    } else {
      for(i = 0; i < p.matches.length; i++){ var r = aiPrevRec(p.tirazh, i); if(!r) return; picks.push(r.p); }
      sys = [picks.join(",")];
    }
    var k = -1, sig = sys.join("|");
    for(i = 0; i < pcsv.sets.length; i++) if(pcsv.sets[i].ai && !pcsv.sets[i].virt){ k = i; break; }
    if(k >= 0 && (pcsv.sets[k].sys || []).join("|") === sig) return;
    var set = { name: nm, ai: 1, virtai: 1, link: 0, sys: sys, rows: pcsvExpand(sys) };
    if(!set.rows.length) return;
    if(k >= 0) pcsv.sets[k] = set; else pcsv.sets.push(set);
    if(k < 0 && pcsv.sets.length === 1) pcsvUse(0);
    else if(k >= 0 && pcsv.act === k) pcsvUse(k);
  }
  /* виртуальный набор стратегии «Охота на 15 · бриф 14 из 15»: строки готовы заранее (virt.json), в хранилище не пишутся */
  function pcsvSyncVirt(){
    var p = state.prev; if(!p || pcsv.tir !== String(p.tirazh)) return;
    var rec = virt.data && virt.data[String(p.tirazh)]; if(!rec || !rec.z) return;
    var k = -1, i;
    for(i = 0; i < pcsv.sets.length; i++) if(pcsv.sets[i].virt){ k = i; break; }
    if(k >= 0 && pcsv.sets[k].sig === rec.at + "|" + rec.n) return;
    var rows = virtRows(rec.z);
    if(!rows.length) return;
    var set = { name: (rec.name || "Охота на 15") + " · виртуальный", ai: 1, virt: 1, link: 0, sig: rec.at + "|" + rec.n, pin: rec.pin,
                sys: rows.map(function(x){ return x.split("").join(","); }), rows: rows };
    if(k >= 0) pcsv.sets[k] = set; else pcsv.sets.push(set);
    if(k >= 0 && pcsv.act === k) pcsvUse(k);
  }
  /* сохранённые наборы других тиражей — кнопки, чтобы открыть их */
  function pcsvOthers(cur){ return ""; }
  function pcsvOthersBind(box){
    [].slice.call(box.querySelectorAll(".pc-others button")).forEach(function(b){
      b.addEventListener("click", function(){
        var n = Number(b.getAttribute("data-tir"));
        b.disabled = true; b.textContent = "открываю…"; pcsv.msg = "";
        prevLoad(n, true, function(){ b.disabled = false; b.textContent = "№" + n + " · не открылся"; });
      });
    });
  }
  /* добавить набор к любому тиражу: к открытому — сразу, к другому — в сохранённые */
  function pcsvAddTo(tir, set){
    if(pcsv.tir === tir){
      if(set.link) set.name = "Ссылка " + (pcsv.sets.filter(function(x){ return x.link; }).length + 1);
      var r = pcsvAdd(set); return { dup: r.dup, name: pcsvLabel(pcsv.sets[pcsv.act]) || pcsv.name };
    }
    var all = pcsvAll(), e = all[tir] || { sets: [], act: 0 };
    if(!e.sets) e = { sets: e.rows ? [{ name: e.name || "Файл", sys: e.sys || e.rows }] : [], act: 0 };
    var sig = (set.sys || []).join("|");
    for(var i = 0; i < e.sets.length; i++) if((e.sets[i].sys || []).join("|") === sig){ e.act = i; all[tir] = e; pcsvPut(tir); return { dup: true, name: e.sets[i].name }; }
    var nm = set.link ? "Ссылка " + (e.sets.filter(function(x){ return x.link; }).length + 1) : set.name;
    e.sets.push({ name: nm, link: set.link || 0, sys: set.sys }); e.act = e.sets.length - 1; e.at = Date.now();
    all[tir] = e;
    pcsvPut(tir);
    return { dup: false, name: set.link ? fmt(pcsvExpand(set.sys || []).length * (Number(state.price) || 0)) + " ₽" : nm };
  }
  function pcsvAdd(set, keepTwin){
    var sig = (set.sys || []).join("|") + "#" + set.rows.length, twin = false;
    for(var i = 0; i < pcsv.sets.length; i++){
      if(!pcsv.sets[i].ai && ((pcsv.sets[i].sys || []).join("|") + "#" + pcsv.sets[i].rows.length) === sig){
        /* файл с тем же содержимым: из файлов берём отдельным набором (у него может быть другая ставка), из ссылок — нет */
        if(!keepTwin){ pcsvUse(i); pcsvStore(); return { dup: true, of: pcsv.sets[i].name }; }
        twin = true; break;
      }
    }
    if(keepTwin){
      var base = set.name, n = 1;
      while(pcsv.sets.some(function(x){ return x.name === set.name; })) set.name = base + " (" + (++n) + ")";
    }
    pcsv.sets.push(set);
    pcsvUse(pcsv.sets.length - 1);
    pcsvStore();
    return { dup: false, twin: twin };
  }
  /* Хранилище наборов: IndexedDB (по ключу на тираж, лимита в несколько МБ нет); localStorage — только
     старые данные, которые переносятся при первом запуске, и запасной путь, если IndexedDB недоступна.
     Все чтения идут из памяти PCSV_MEM, запись — в фоне. */
  var PCSV_MEM = null, PCSV_DB = null, PCSV_DBFAIL = false, PCSV_PEND = {}, PCSV_TIMER = 0;
  function pcsvAll(){
    if(!PCSV_MEM){
      try{ PCSV_MEM = JSON.parse(localStorage.getItem(PCSV_KEY) || "{}") || {}; }catch(e){ PCSV_MEM = {}; }
    }
    return PCSV_MEM;
  }
  function pcsvDbOpen(cb){
    if(PCSV_DB || PCSV_DBFAIL || !window.indexedDB){ if(!PCSV_DB) PCSV_DBFAIL = true; cb(PCSV_DB); return; }
    var done = false, fin = function(db){ if(done) return; done = true; if(!db) PCSV_DBFAIL = true; PCSV_DB = db || null; cb(PCSV_DB); };
    try{
      var rq = indexedDB.open("dzhek-prevcsv", 1);
      rq.onupgradeneeded = function(){ try{ rq.result.createObjectStore("sets"); }catch(e){} };
      rq.onsuccess = function(){ fin(rq.result); };
      rq.onerror = rq.onblocked = function(){ fin(null); };
      setTimeout(function(){ fin(null); }, 4000);
    }catch(e){ fin(null); }
  }
  function pcsvWarn(text){
    pcsv.msg = text; pcsv.msgAt = Date.now();
    try{ if(state.prev && $("prevCsv")) renderPrevCsv(); }catch(e){}
  }
  function pcsvFlush(){
    PCSV_TIMER = 0;
    var keys = Object.keys(PCSV_PEND); if(!keys.length) return;
    PCSV_PEND = {};
    var legacy = function(){
      var okLs = false;
      try{ localStorage.setItem(PCSV_KEY, JSON.stringify(pcsvAll())); okLs = true; }catch(e){}
      if(!okLs) pcsvWarn("Наборы не сохранились в браузере (нет места) — останутся до перезагрузки страницы.");
    };
    pcsvDbOpen(function(db){
      if(!db){ legacy(); return; }
      try{
        var tx = db.transaction("sets", "readwrite"), st = tx.objectStore("sets"), all = pcsvAll();
        keys.forEach(function(k){
          var e = all[k];
          if(e && ((e.sets && e.sets.length) || e.rows)) st.put(e, k); else st.delete(k);
        });
        tx.oncomplete = function(){ try{ localStorage.removeItem(PCSV_KEY); }catch(e){} };
        tx.onerror = tx.onabort = function(){
          pcsvWarn("Не удалось сохранить наборы в браузере (" + ((tx.error && tx.error.name) || "ошибка") + ") — останутся до перезагрузки страницы.");
        };
      }catch(e){ legacy(); }
    });
  }
  function pcsvPut(tir){
    PCSV_PEND[String(tir)] = 1;
    if(!PCSV_TIMER) PCSV_TIMER = setTimeout(pcsvFlush, 300);
  }
  /* подтянуть сохранённое из IndexedDB и слить со старым localStorage */
  function pcsvLoadDb(){
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
    pcsvAll();
    pcsvDbOpen(function(db){
      var legacyKeys = Object.keys(PCSV_MEM);
      if(!db) return;
      try{
        var rq = db.transaction("sets", "readonly").objectStore("sets").openCursor(), got = {};
        rq.onsuccess = function(){
          var cur = rq.result;
          if(cur){ got[cur.key] = cur.value; cur.continue(); return; }
          var changed = false;
          Object.keys(got).forEach(function(k){
            var mine = PCSV_MEM[k], e = got[k];
            if(!e || !e.sets) return;
            if(mine && mine.sets){
              var have = {}; e.sets.forEach(function(x){ have[(x.sys || []).join("|")] = 1; });
              mine.sets.forEach(function(x){ if(!have[(x.sys || []).join("|")]){ e.sets.push(x); pcsvPut(k); } });
            }
            PCSV_MEM[k] = e; changed = true;
          });
          legacyKeys.forEach(function(k){ if(!got[k]) pcsvPut(k); });
          pcsvPurgeOld();
          if(changed && pcsv.tir != null && !pcsvMine().length) pcsv.tir = null;
          if(changed){ try{ if(state.prev && $("prevCsv")) renderPrevCsv(); }catch(e){} }
        };
        rq.onerror = function(){};
      }catch(e){}
    });
  }
  /* на странице «Тиражи» живут два тиража: предыдущий и текущий. Наборы остальных стираются при заходе;
     общий список прошлой версии («w») переезжает в тираж 5029, для которого он собирался */
  function pcsvPurgeOld(){
    var all = pcsvAll();
    if(all.w){
      if(!all["5029"]) all["5029"] = all.w;
      delete all.w; pcsvPut("w"); pcsvPut("5029");
    }
    var cur = Number(state.tirazh);
    if(!(cur > 0)) return;
    Object.keys(all).forEach(function(k){
      if(Number(k) !== cur && Number(k) !== cur - 1){ delete all[k]; pcsvPut(k); }
    });
  }
  pcsvPurgeOld();
  pcsvLoadDb();
  /* подпись сборки внизу — по версии скрипта, чтобы видеть, какая версия реально открыта */
  (function(){
    try{
      var sc = document.querySelector('script[src*="app.js"]'), el = document.querySelector(".build");
      var m = sc && /v=(\d{4})(\d{2})(\d{2})([a-z]*)/.exec(sc.getAttribute("src") || "");
      if(el && m) el.textContent = "сборка " + m[3] + "." + m[2] + (m[4] ? " · " + m[4] : "");
    }catch(e){}
  })();
  /* у набора из ссылки вместо слова «Ссылка N» — сумма, на которую он сделан */
  var RK_VT = '<em class="rk-vt" title="Виртуальный набор: на деньги не ставится, нужен для отслеживания"><span class="f">виртуальный</span><span class="s">вирт.</span></em> ';
  function pcsvLabel(st){
    if(!st) return "";
    return fmt(st.rows.length * (Number(state.price) || 0)) + " ₽";
  }
  /* заголовок блока: у ссылки — сумма, у файла — имя файла и сумма */
  function pcsvHead(){
    var st = pcsv.sets[pcsv.act]; if(!st) return pcsv.name;
    return st.link ? pcsvLabel(st) : st.name + " · " + pcsvLabel(st);
  }
  function pcsvStore(){
    var all = pcsvAll();
    /* храним только строки файла (с допами) — варианты разворачиваются при открытии; удаляются только кнопкой «Убрать» */
    var mine = pcsvMine(), actM = 0;
    pcsv.sets.forEach(function(st, q){ if(q < pcsv.act && !st.ai) actM++; });
    if(mine.length) all[pcsv.tir] = { act: Math.min(actM, mine.length - 1), at: Date.now(),
      sets: mine.map(function(st){ return { name: st.name, link: st.link || 0, sys: st.sys }; }) };
    else delete all[pcsv.tir];
    pcsvPut(pcsv.tir);
    return true;
  }
  function pcsvPick(){
    var inp = $("filePrevCsv");
    if(!inp){
      inp = document.createElement("input");
      inp.type = "file"; inp.id = "filePrevCsv"; inp.accept = ".csv,text/csv,text/plain"; inp.hidden = true;
      document.body.appendChild(inp);
      inp.multiple = true;                 /* можно выбрать сразу несколько файлов */
      inp.addEventListener("change", function(e){
        var files = [].slice.call((e.target.files) || []);
        e.target.value = "";
        if(!files.length || !state.prev) return;
        pcsvEnsure(String(state.prev.tirazh));
        var ok = 0, dup = 0, bad = [], dupN = [], twinN = 0, k = 0;
        var next = function(){
          if(k >= files.length){
            var kept = pcsvStore();
            pcsv.msgAt = Date.now();
            pcsv.msg = (ok ? (files.length > 1 ? "Загружено файлов: " + ok + ". " : "Загружено " + fmt(pcsv.rows.length) + " вариант(ов)" +
                          (pcsv.sys.length !== pcsv.rows.length ? " в " + fmt(pcsv.sys.length) + " строк(е) файла" : "") + ". ") : "") +
              (twinN ? "Повторов отдельными наборами: " + twinN + ". " : "") +
              (dup ? "Уже были загружены (такое же содержимое): " + dup + " — " + dupN.slice(0, 5).join(", ") + (dupN.length > 5 ? " и ещё " + (dupN.length - 5) : "") + ". " : "") +
              (bad.length ? "Не на " + state.prev.matches.length + " матчей или пустой файл: " + bad.slice(0, 5).join(", ") + (bad.length > 5 ? " и ещё " + (bad.length - 5) : "") + ". " : "") +
              "Всего наборов в тираже: " + pcsvMine().length + ". " +
              (kept ? "" : "Файлы большие — сохранятся до перезагрузки страницы.");
            renderPrevCsv();
            try{ $("prevCsv").scrollIntoView({ behavior: "smooth", block: "start" }); }catch(err){}
            return;
          }
          var f = files[k++], rd = new FileReader();
          rd.onload = function(){
            var res = parseCsvVariants(rd.result, state.prev.matches.length);
            if(!res.rows.length){ bad.push("«" + f.name + "»"); next(); return; }
            var a = pcsvAdd({ name: f.name, rows: res.rows.map(function(r){ return r.join(""); }),
                              sys: res.pages.map(function(pg){ return pg.join(","); }) }, true);
            if(a.twin) twinN++;
            if(a.dup){ dup++; dupN.push("«" + f.name + "» = «" + (a.of || "?") + "»"); } else ok++;
            next();
          };
          rd.onerror = function(){ bad.push("«" + f.name + "»"); next(); };
          rd.readAsText(f);
        };
        next();
      });
    }
    inp.click();
  }
  var PC_PASTE = '<form class="pc-paste" id="pcPaste" autocomplete="off" hidden><input type="text" id="pcUrl" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="Вставь ссылку" aria-label="Ссылка на варианты">' +
    '<button type="submit" class="pc-btn">Открыть</button></form>';
  var PC_BTNS = '<button type="button" class="pc-btn" id="pcLoad">Загрузить CSV</button><button type="button" class="pc-btn" id="pcLinkBtn">Загрузить ссылку</button>';
  var pcPasteBusy = false;
  function pcPasteBind(){
    var f = $("pcPaste"); if(!f) return;
    $("pcLinkBtn").addEventListener("click", function(){
      f.hidden = !f.hidden;
      if(!f.hidden){
        var inp = $("pcUrl"); inp.focus();
        /* если браузер даёт прочитать буфер — подставляем ссылку сразу */
        try{
          if(navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function(t){
            if((/#vs?=[^-\s]*-[A-Za-z0-9\-_.]+/.test(t || "") || /#s=[A-Za-z0-9_-]{6,16}/.test(t || "")) && !inp.value) inp.value = String(t).trim();
          }, function(){});
        }catch(e){}
      }
    });
    f.addEventListener("submit", function(e){
      e.preventDefault();
      var v = String($("pcUrl").value || "").trim();
      /* короткие ссылки #s=код сначала превращаем в обычные #vs= (набор берём с сервера) */
      var sIds = v.match(/#s=[A-Za-z0-9_-]{6,16}/g);
      if(sIds && !pcPasteBusy){
        pcPasteBusy = true;
        var rest = v.replace(/#s=[A-Za-z0-9_-]{6,16}/g, " ");
        Promise.all(sIds.map(function(x){
          return shortGet(x.slice(3)).then(function(j){ return "#vs=" + encodeURIComponent(j.t) + "-" + j.d; }, function(){ return ""; });
        })).then(function(list){
          pcPasteBusy = false;
          var ok = list.filter(Boolean);
          if(!ok.length){ pcsv.msgAt = Date.now(); pcsv.msg = "Короткая ссылка устарела или не найдена: наборы хранятся 90 дней."; renderPrevCsv(); return; }
          $("pcUrl").value = (rest.trim() + " " + ok.join(" ")).trim();
          $("pcPaste").dispatchEvent(new Event("submit", { cancelable: true }));
        });
        return;
      }
      /* можно вставить сразу несколько ссылок — через пробел или с новой строки */
      var re = /#v=([^-&#\s]*)-([A-Za-z0-9\-_]+)/g, m, list = [], other = 0;
      var reS = /#vs=([^-&#\s]*)-([A-Za-z0-9\-_.]+)/g, ms2;
      while((ms2 = reS.exec(v))){
        var t2 = decodeURIComponent(ms2[1]);
        if(Number(t2) < Number(state.tirazh)) ms2[2].split(".").filter(Boolean).forEach(function(pl){ list.push({ tirazh: t2, payload: pl }); });
        else other++;
      }
      v = v.replace(reS, " ");
      while((m = re.exec(v))){
        var t = decodeURIComponent(m[1]);
        if(Number(t) < Number(state.tirazh)) list.push({ tirazh: t, payload: m[2] });
        else other++;
      }
      if(!list.length){
        pcsv.msgAt = Date.now();
        pcsv.msg = other ? "Это ссылки на текущий тираж №" + state.tirazh + " — их открывают в самом купоне, а не в просмотре."
                         : "Это не ссылка на варианты: нужна ссылка вида …#v=5017-…";
        renderPrevCsv(); return;
      }
      var k = 0, total = list.length;
      var step = function(){
        if(k >= total) return;
        var p = list[k++];
        p.more = total > 1 ? "Обработано ссылок: " + k + " из " + total + (other ? ", на текущий тираж пропущено: " + other : "") + "." : "";
        p.next = step;
        prevBookOpen(p, 0);
      };
      step();
    });
  }
  function pcsvShareAll(){
    var b = $("pcShareAll"); if(!b || !pcsvMine().length) return;
    var was = b.textContent, sets = pcsvMine(), tir = pcsv.tir;
    var nVars = sets.reduce(function(a, st){ return a + st.rows.length; }, 0);
    b.disabled = true; b.textContent = "собираю…";
    var urlP = Promise.all(sets.map(function(st){
      return new Promise(function(res, rej){
        var pages = (st.sys || []).map(function(x){ return String(x).split(","); });
        varsEncode(st.rows, function(p){ if(p) res(p); else rej(new Error("pack")); }, pages.length ? pages : null);
      });
    })).then(function(list){
      var packed = list.join("."), base = location.origin + location.pathname;
      var longUrl = base + "#vs=" + encodeURIComponent(tir || "") + "-" + packed;
      /* длинный адрес заменяем коротким #s=код; не вышло — отдаём длинный, как раньше */
      return shortPut(tir, packed).then(function(id){ return base + "#s=" + id; }, function(){ return longUrl; });
    });
    var wrote = null;
    if(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
      try{
        var blobP = urlP.then(function(url){ if(url.length > 8000) throw new Error("long"); return new Blob([url], { type: "text/plain" }); });
        blobP.catch(function(){});
        wrote = navigator.clipboard.write([new ClipboardItem({ "text/plain": blobP })]);
        wrote.catch(function(){});
      }catch(e){ wrote = null; }
    }
    var fin = function(text){ pcsv.msg = text; pcsv.msgAt = Date.now(); renderPrevCsv(); };
    urlP.then(function(url){
      if(url.length > 8000){
        fin("В одну ссылку все наборы не влезают: " + fmt(url.length) + " символов, мессенджер такой адрес обрежет. Перешли наборы по одному или файлами CSV.");
        return;
      }
      var ok = function(){
        fin((url.indexOf("#s=") > 0 ? "Короткая ссылка скопирована: " : "Ссылка скопирована: ") + fmt(sets.length) + " набор(ов), " + fmt(nVars) + " вариант(ов), тираж №" + tir +
          ". Кто откроет — увидит все наборы вкладками в просмотре тиража." + (url.indexOf("#s=") > 0 ? " Хранится 90 дней." : (url.length > 3500 ? " Адрес длинный — в Telegram может не влезть одним сообщением." : "")));
      };
      var manual = function(){
        fin("Скопировать автоматически не вышло — ссылка в окне, скопируй её оттуда.");
        try{ window.prompt("Ссылка на все варианты — скопируй:", url); }catch(e){}
      };
      var viaText = function(){
        if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, manual); else manual();
      };
      if(wrote) wrote.then(ok, viaText); else viaText();
    }, function(){ b.disabled = false; b.textContent = was; fin("Не получилось упаковать варианты в ссылку."); });
  }
  /* время матча напротив строки в «Весь купон»: минута в лайве (тикает), Full time, начало */
  function pcDay(m){
    var dm = String(m.date || "").match(/^(\d{1,2})\.(\d{1,2})/); if(!dm) return "";
    var t = new Date(Date.now() + 3 * 3600000);
    return (+dm[1] === t.getUTCDate() && +dm[2] === t.getUTCMonth() + 1) ? "" : ("0" + dm[1]).slice(-2) + "." + ("0" + dm[2]).slice(-2);
  }
  function pcTime(m){
    var li = liveInfo(m);
    if(m.res === VOID) return '<span class="pc-tm pc-tx">ОТМ</span>';
    if(m.res) return '<span class="pc-tm pc-tx pc-ftm">Full time</span>';
    if(m.fsVoid && !m.score) return '<span class="pc-tm pc-tx pc-pp">' + (m.fsVoid === "отменён" ? "отмена" : "перенос") + '</span>';
    if(li && li.end) return '<span class="pc-tm pc-tx lv">КОНЕЦ</span>';
    if(li){
      var mn = liveMinute(li.ph, li.hockey, true), txt = mn && mn.t !== "" ? String(mn.t) : "LIVE";
      var at = mn && mn.tick && li.ph ? ' data-ac="' + li.ph.ac + '" data-ao="' + escHtml(li.ph.ao || "") + '" data-bx="' + escHtml(li.ph.bx || "") + '" data-at="' + li.ph.at + '" data-h="' + (li.hockey ? 1 : 0) + '" data-s="1"' : "";
      return '<span class="pc-tm lv' + (txt === "LIVE" ? ' pc-tx' : '') + '"><i class="lv-dot"></i><b class="lv-min"' + at + '>' + escHtml(txt) + '</b></span>';
    }
    return '<span class="pc-tm">' + escHtml((pcDay(m) ? pcDay(m) + " " : "") + (m.time || "—")) + '</span>';
  }
  function renderPrevCsv(){
    var box = $("prevCsv"); if(!box) return;
    var p = state.prev;
    if(!(state.viewPrev && p)){ box.hidden = true; return; }
    box.hidden = false;
    pcsvEnsure(String(p.tirazh));
    pcsvSyncAi();
    pcsvSyncVirt();
    /* сообщение держим 10 с: фоновые обновления счёта перерисовывают блок */
    var msg = pcsv.msg && Date.now() - (pcsv.msgAt || 0) < 45000 ? '<p class="pc-msg">' + escHtml(pcsv.msg) + '</p>' : "";
    if(!pcsv.rows.length){
      var pbE = document.getElementById("pbBest"); if(pbE) pbE.hidden = true;
      var pbS0 = document.getElementById("pbSum"); if(pbS0) pbS0.hidden = true;
      box.innerHTML = '<div class="pc-empty"><span>Загрузи CSV своих вариантов на этот тираж или вставь ссылку на них — здесь появится весь купон и все варианты с угаданными по ходу матчей.</span>' +
        '<span class="pc-acts">' + PC_BTNS + '</span></div>' + PC_PASTE + msg;
      $("pcLoad").addEventListener("click", pcsvPick);
      pcPasteBind();
      return;
    }
    var ms = p.matches, n = ms.length, res = ms.map(function(m){ return m.res || ""; });
    var played = res.filter(Boolean).length, rows = pcsv.rows, total = rows.length;
    var st = rows.map(function(r, i){
      var h = 0, miss = 0;
      for(var j = 0; j < n; j++) if(res[j]){ if(res[j] === VOID || r.charAt(j) === res[j]) h++; else miss++; }
      return { i: i, h: h, miss: miss };
    });
    /* строки файла как есть — система с допами («1X», «12») остаётся одной строкой */
    var sysL = (pcsv.sys || []).map(function(x){ return x.split(","); }).filter(function(x){ return x.length === n; });
    var hasSys = sysL.length && sysL.length !== rows.length;
    var view = hasSys && pcsv.view !== "one" ? "sys" : "one";
    var PAY = 9, best = 0, now9 = 0, can9 = 0, can15 = 0, vst = st, lad = {}, winSet = {}, deadSet = {};
    st.forEach(function(x){
      if(x.h > best) best = x.h; if(x.h >= PAY){ now9++; winSet[x.i] = 1; } if(n - x.miss >= PAY) can9++; else deadSet[x.i] = 1; if(!x.miss) can15++;
      lad[x.h] = (lad[x.h] || 0) + 1;
    });
    var flt = pcsv.flt || "all";
    /* исходы «сейчас»: итоги + идущие матчи по текущему счёту (для рейтинга, шапки и подписей live) */
    var er = ms.map(function(m, j){
      if(res[j]) return res[j];
      var lo = m.res ? null : liveOutcome(m); return lo && lo.live ? lo.o : "";
    });
    var pe = er.filter(Boolean).length, liveN = er.filter(function(x, j){ return x && !res[j]; }).length;
    var lvB = 0, lvW = 0;
    if(liveN) rows.forEach(function(r){
      var hh = 0;
      for(var j = 0; j < n; j++) if(er[j] && (er[j] === VOID || r.charAt(j) === er[j])) hh++;
      if(hh > lvB) lvB = hh; if(hh >= PAY) lvW++;
    });
    var h = '<div class="pc-head"><span class="pc-t">Мои варианты</span><span class="pc-f" title="' + escHtml(pcsvHead()) + '">' + escHtml(pcsvHead()) + '</span>' +
      '<span class="pc-acts">' + PC_BTNS + '<button type="button" class="pc-btn pc-share" id="pcShareAll" title="Одна ссылка на все загруженные наборы этого тиража — перешли её, и у получателя откроются все варианты">' +
      (pcsvMine().length > 1 ? 'Ссылка на все (' + pcsvMine().length + ')' : 'Ссылка на варианты') + '</button>' +
      (pcsv.sets[pcsv.act] && pcsv.sets[pcsv.act].ai ? "" : '<button type="button" class="pc-btn ghost" id="pcDrop">Убрать</button>') +
      (pcsvMine().length ? '<button type="button" class="pc-btn ghost" id="pcDropAll" title="Удалить все загруженные CSV и ссылки этого тиража">Убрать все CSV</button>' : "") + '</span></div>' + PC_PASTE + msg;
    var rkNow = null;
    if(pcsv.sets.length > 1){
      /* рейтинг наборов: завершённые матчи + идущие по текущему счёту; выше тот, у кого лучше результат */
      var sc = pcsv.sets.map(function(set, i){
        var bst = 0, w = 0, al = 0, sum = 0;
        set.rows.forEach(function(r){
          var hh = 0, mf = 0;
          for(var j = 0; j < n; j++){
            if(er[j] && (er[j] === VOID || r.charAt(j) === er[j])) hh++;
            if(res[j] && res[j] !== VOID && r.charAt(j) !== res[j]) mf++;   /* только подведённые итоги: выбыл насовсем */
          }
          /* «Живых» — по сыгранным: идущий матч ещё может перевернуться, поэтому его счёт вариант не убивает */
          if(hh > bst) bst = hh; if(hh >= PAY) w++; if(n - mf >= PAY) al++; sum += hh;
        });
        return { i: i, b: bst, w: w, a: al, out: set.rows.length > 0 && played > 0 && !al, avg: set.rows.length ? sum / set.rows.length : 0 };
      });
      if(pe) sc.sort(function(x, y){ return (y.b - x.b) || (y.w - x.w) || (y.avg - x.avg) || (y.a - x.a) || (x.i - y.i); });
      var rk = pcsv.rk && pcsv.rk.tir === pcsv.tir ? pcsv.rk : (pcsv.rk = { tir: pcsv.tir, pos: {}, mv: {} });
      if(rk.n !== sc.length){ rk.pos = {}; rk.mv = {}; rk.n = sc.length; }   /* набор добавили или убрали — старые места не сравниваем */
      sc.forEach(function(q, k){
        var o = rk.pos[q.i];
        if(o && o.place !== k + 1 && pe) rk.mv[q.i] = { d: o.place - (k + 1), at: Date.now() };
      });
      rkNow = sc;
      h += '<div class="pc-rkw"><div class="pc-rkttl"><span class="pc-rkx">Рейтинг наборов</span>' + (liveN ? '<span class="pc-rklive"><i class="lv-dot"></i>LIVE · ' + liveN + '</span>' : '') + '</div>' +
        '<p class="pc-lnote pc-rknote">Считаются сыгранные матчи' + (liveN ? ' и идущие по текущему счёту' : '') + '. Тап по набору открывает его.' +
        (pcsv.sets.some(function(x){ return x.ai; }) ? '<br>' + RK_VT + '\u2014 набор не ставится на деньги, он нужен для отслеживания.' : '') +
        (sc.some(function(q){ return q.out; }) ? '<br><span class="rk-x" aria-hidden="true">\u00d7</span> \u2014 набор выбыл: после сыгранных матчей ни один его вариант уже не наберёт ' + PAY + '+.' : '') + '</p>' +
        '<div class="pc-rkt" role="tablist"><div class="pc-rkh"><span>#</span><span>Набор</span><span>Лучший</span><span>9+</span><span>Живых</span></div><div class="pc-rkb">';
      sc.forEach(function(q, k){
        var st = pcsv.sets[q.i], mv = rk.mv[q.i], tr = "";
        if(mv && Date.now() - mv.at < 90000) tr = '<u class="' + (mv.d > 0 ? "up" : "dn") + '">' + (mv.d > 0 ? "▲" : "▼") + Math.abs(mv.d) + '</u>';
        h += '<button type="button" role="tab" class="pc-rk' + (q.out ? " out" : "") + (q.i === pcsv.act ? " on" : "") + (k < 3 && pe ? " m" + (k + 1) : "") + '" data-t="' + q.i + '" data-id="' + q.i + '" aria-pressed="' + (q.i === pcsv.act) + '" title="' + escHtml(st.link ? "Ссылка · " + pcsvLabel(st) : st.name) + ' · ' + fmt(st.rows.length) + ' вар.">' +
          '<span class="rk-p"><b>' + (k + 1) + '</b>' + tr + '</span>' +
          '<span class="rk-n"><b>' + escHtml(pcsvLabel(st)) + '</b><small>' + (q.out ? '<span class="rk-x" title="Набор выбыл: ни один вариант уже не наберёт ' + PAY + '+">\u00d7</span> ' : '') + (st.virt ? '<em class="rk-ai rk-hunt">Охота</em>' + RK_VT : st.ai ? '<em class="rk-ai">ИИ</em>' + RK_VT : st.link ? "" : escHtml(st.name) + " · ") + '<span class="rk-cnt">' + fmt(st.rows.length) + ' вар.</span></small></span>' +
          '<span class="rk-v">' + (pe ? '<i class="cn" data-k="' + q.i + 'b">' + q.b + '</i><small> из ' + pe + '</small>' : '—') + '</span>' +
          '<span class="rk-v' + (q.w ? " ok" : "") + '"><i class="cn" data-k="' + q.i + 'w">' + fmt(q.w) + '</i></span><span class="rk-v"><i class="cn" data-k="' + q.i + 'a">' + fmt(q.a) + '</i></span>' +
          '<span class="rk-bar" data-w="' + (n ? Math.round(q.b / n * 100) : 0) + '" data-pay="' + (n ? Math.round(PAY / n * 100) : 60) + '"><i></i><u></u></span></button>';
      });
      h += '</div></div></div>';
    }
    /* общая сумма всех загруженных наборов тиража — в панели просмотра */
    var allRows = 0; pcsv.sets.forEach(function(x){ if(!x.ai) allRows += x.rows.length; });
    var pbS = document.getElementById("pbSum");
    if(pbS){
      pbS.hidden = !allRows;
      if(allRows) pbS.innerHTML = 'сумма <b>' + fmt(allRows * (Number(state.price) || 0)) + ' ₽</b>';
    }
    var pbB = document.getElementById("pbBest");
    if(pbB){
      var bb = rkNow ? sc[0].b : liveN ? lvB : best, bo = rkNow || liveN ? pe : played;
      pbB.hidden = !bo; if(bo) pbB.innerHTML = 'лучший набор <b>' + bb + '</b> из ' + bo;
    }
    h += '<div class="pc-cards">' +
      (hasSys ? '<div><span>Строк</span><b>' + fmt(sysL.length) + '</b></div>' : '') +
      '<div><span>Вариантов</span><b>' + fmt(total) + '</b></div>' +
      '<div><span>Сумма</span><b>' + fmt(total * (Number(state.price) || 0)) + ' ₽</b></div>' +
      '<div data-k="best"><span>Лучший</span><b>' + (played ? best + ' из ' + played : '—') + '</b>' + (liveN ? '<small class="pc-lv">live ' + lvB + ' из ' + pe + '</small>' : '') + '</div>' +
      '<div data-k="now9"><span>9+ сейчас</span><b>' + fmt(now9) + '</b>' + (liveN ? '<small class="pc-lv">live ' + fmt(lvW) + '</small>' : '') + '</div>' +
      '<div data-k="can9"><span>Могут 9+</span><b>' + fmt(can9) + '</b></div>' +
      '<div data-k="can15"><span>Без ошибок</span><b>' + fmt(can15) + '</b></div></div>';
    if(played && total && !can9) h += '<p class="pc-lnote pc-outnote"><span class="rk-x" aria-hidden="true">\u00d7</span> Набор выбыл: после сыгранных матчей ни один вариант уже не наберёт ' + PAY + '+.</p>';
    /* лесенка: сколько вариантов угадали k матчей; тап — показать только их */
    if(played){
      var lv = [], lo = 0, mx = 1;
      for(var k = n; k >= PAY; k--){ lv.push({ k: k, c: lad[k] || 0 }); }
      lv.forEach(function(x){ if(x.c > mx) mx = x.c; });
      h += '<div class="pc-sub">Сколько угадали</div><div class="pc-lad" style="--cols:' + lv.length + '">';
      lv.forEach(function(x){
        h += '<button type="button" class="pc-lb' + (x.k >= PAY ? " pay" : "") + (x.c ? "" : " zero") + '" data-h="' + x.k + '" aria-pressed="' + (flt === "h" + x.k) + '"' + (x.c ? '' : ' disabled') +
          ' title="' + (x.k < 0 ? "0–" + (PAY - 1) : x.k) + ' из ' + played + ': ' + fmt(x.c) + ' вар."><b>' + (x.c ? fmt(x.c) : "·") + '</b><i><u style="height:' + (x.c ? Math.max(4, Math.round(x.c / mx * 100)) : 0) + '%"></u></i><span>' + (x.k < 0 ? "0–" + (PAY - 1) : x.k) + '</span></button>';
      });
      h += '</div><p class="pc-lnote">Варианты, угадавшие ' + PAY + ' и больше матчей</p>';
    }
    /* весь купон: сколько вариантов стоит на каждый исход */
    var unc = [];
    ms.forEach(function(m, j){ if(res[j] && res[j] !== VOID && !rows.some(function(r){ return r.charAt(j) === res[j]; })) unc.push(j + 1); });
    h += '<div class="pc-sub">Весь купон</div>' + (played ? '<p class="pc-lnote pc-key"><span class="k-on">выделены</span> — ваши исходы, <span class="k-hit">зелёной заливкой</span> — зашёл, <span class="k-bad">красный контур</span> — не зашёл' +
      (unc.length ? '. Исход не был в купоне: <b>№' + unc.slice(0, 6).join(", №") + (unc.length > 6 ? " +" + (unc.length - 6) : "") + '</b>' : '') + '</p>' : '') + '<div class="pc-cov">';
    ms.forEach(function(m, j){
      var c = { "1": 0, "X": 0, "2": 0 };
      rows.forEach(function(r){ var o = r.charAt(j); if(c[o] != null) c[o]++; });
      var sc = m.res === VOID ? "" : (m.score ? String(m.score).replace(/\s+/g, "") : "");
      var wiOk = !m.res && m.res !== VOID;
      h += '<div class="pc-cr' + (wiOk ? " wi-able" + (pcsv.what === j ? " wi-on" : "") : "") + '"' + (wiOk ? ' data-w="' + j + '" title="Тап — что будет с вариантами при каждом исходе"' : '') + '><span class="pc-n">' + (j + 1) + '</span><span class="pc-m"><i><b>' + escHtml(m.home) + '</b><u> — </u><b>' + escHtml(m.away) + '</b></i></span>';
      var liN = !m.res && liveInfo(m), lvc = liN && !liN.end ? ' is-lv' : '';
      h += '<span class="pc-sc' + (sc ? '' : ' no') + lvc + '">' + (sc ? '<em class="' + (m.res ? "" : "live") + '">' + escHtml(sc) + '</em>' : '–') + '</span>' +
        '<span class="pc-tc' + lvc + '">' + pcTime(m) + '</span>';
      h += '<button type="button" class="pc-fs" data-fs="' + j + '" title="Открыть матч на Flashscore" aria-label="Открыть на Flashscore: ' + escHtml(m.home) + ' — ' + escHtml(m.away) + '"><b class="fs-mark">F<i>S</i></b></button>';
      OUT.forEach(function(o){
        var cls = "pc-o" + (c[o] ? " on" : "") + (res[j] === VOID ? (c[o] ? " hit" : "") : res[j] === o ? (c[o] ? " hit" : " hole") : (res[j] && c[o] ? " miss" + (res[j] && !c[res[j]] ? " bad" : "") : ""));
        h += '<span class="' + cls + '" title="' + o + ': ' + fmt(c[o]) + ' вар.">' + o + (sysL.length === 1 ? '' : '<small>' + (c[o] ? (c[o] === total ? "все" : fmt(c[o])) : "·") + '</small>') + '</span>';
      });
      h += '</div>';
      if(wiOk && pcsv.what === j){
        var lw = liveOutcome(m), wi = { "1": [0, 0], "X": [0, 0], "2": [0, 0] };
        vst.forEach(function(x){
          OUT.forEach(function(o){
            var add = rows[x.i].charAt(j) === o ? 1 : 0;
            if(n - x.miss - (1 - add) >= PAY) wi[o][1]++;
            if(x.h + add >= PAY) wi[o][0]++;
          });
        });
        h += '<div class="pc-wi"><div class="pc-wt">Если в матче № ' + (j + 1) + ' выйдет…</div>';
        OUT.forEach(function(o){
          var d0 = wi[o][0] - now9, d1 = wi[o][1] - can9;
          h += '<div class="pc-wc' + (lw && lw.o === o ? " cur" : "") + '"><b>' + o + (lw && lw.o === o ? '<small>сейчас</small>' : '') + '</b>' +
            '<span>9+ <strong>' + fmt(wi[o][0]) + '</strong>' + (d0 ? '<em class="' + (d0 > 0 ? "up" : "dn") + '">' + (d0 > 0 ? "+" : "−") + fmt(Math.abs(d0)) + '</em>' : '') + '</span>' +
            '<span>живых <strong>' + fmt(wi[o][1]) + '</strong>' + (d1 ? '<em class="' + (d1 > 0 ? "up" : "dn") + '">' + (d1 > 0 ? "+" : "−") + fmt(Math.abs(d1)) + '</em>' : '') + '</span></div>';
        });
        h += '</div>';
      }
    });
    h += '</div>';
    if(ms.some(function(m){ return !m.res; })) h += '<p class="pc-lnote">Тап по матчу без итога: что будет с вариантами при каждом исходе</p>';
    /* варианты по 30 */
    var src = rows;
    if(view === "sys"){
      src = sysL;
      st = sysL.map(function(r, i){
        var h = 0, miss = 0, v = 1;
        for(var j = 0; j < n; j++){
          v *= r[j].length;
          if(res[j]){ if(res[j] === VOID || r[j].indexOf(res[j]) >= 0) h++; else miss++; }
        }
        return { i: i, h: h, miss: miss, v: v };
      });
    }
    var fm = /^h(-?\d+)$/.exec(flt), fk = fm ? Number(fm[1]) : null;
    if(fk !== null && view === "sys"){ view = "one"; pcsv.view = "one"; }
    var pred = flt === "w" ? function(x){ return x.h >= PAY; } : flt === "c" ? function(x){ return n - x.miss >= PAY; } :
      flt === "z" ? function(x){ return !x.miss; } : flt === "d" ? function(x){ return n - x.miss < PAY; } :
      fk !== null ? function(x){ return fk < 0 ? x.h < PAY : x.h === fk; } : null;
    if(fk !== null && view === "one"){ src = rows; st = vst; }
    var fl = { w: 0, c: 0, z: 0, d: 0 };
    st.forEach(function(x){ if(x.h >= PAY) fl.w++; if(n - x.miss >= PAY) fl.c++; else fl.d++; if(!x.miss) fl.z++; });
    var order = pred ? st.filter(pred) : st.slice();
    order.sort(function(a, b){ return (b.h - a.h) || (a.miss - b.miss) || (a.i - b.i); });
    var pages = Math.max(1, Math.ceil(order.length / PCSV_PAGE));
    if(pcsv.page >= pages) pcsv.page = pages - 1;
    var from = pcsv.page * PCSV_PAGE, part = order.slice(from, from + PCSV_PAGE);
    h += '<div class="pc-sub">' + (view === "sys" ? "Строки файла" : "Варианты") +
      (hasSys ? '<span class="pc-sort pc-view"><button type="button" data-v="sys" aria-pressed="' + (view === "sys") + '">с допами</button>' +
        '<button type="button" data-v="one" aria-pressed="' + (view === "one") + '">по одному</button></span>' : '') +
      '</div>';
    if(played){
      var chips = [["all", "Все", st.length], ["w", PAY + "+ сейчас", fl.w], ["c", "Могут " + PAY + "+", fl.c], ["z", "Без ошибок", fl.z], ["d", "Мёртвые", fl.d]];
      h += '<div class="pc-flt" role="group" aria-label="Фильтр вариантов">';
      chips.forEach(function(c){
        var on = c[0] === "all" ? !pred : flt === c[0];
        h += '<button type="button" data-f="' + c[0] + '" aria-pressed="' + on + '"' + (c[0] !== "all" && (!c[2] || c[2] === st.length) && !on ? ' disabled title="' + (c[2] ? "Совпадает со списком «Все» — все варианты подходят" : "Таких вариантов нет") + '"' : '') + '>' + c[1] + '<small>' + fmt(c[2]) + '</small></button>';
      });
      if(fk !== null) h += '<button type="button" data-f="all" aria-pressed="true" class="pc-fx">' + (fk < 0 ? "угадано 0–" + (PAY - 1) : "угадано " + fk) + ' &times;</button>';
      h += '</div>';
    }
    var cols = n % 5 === 0 ? 5 : n % 4 === 0 ? 4 : n % 6 === 0 ? 6 : 8;
    h += '<div class="pc-vars" style="--n:' + n + ';--cols:' + cols + '"><div class="pc-vr pc-vh"><span>№</span>';
    for(var j = 0; j < n; j++) h += '<span>' + (j + 1) + '</span>';
    h += '<span>угад.</span></div>';
    part.forEach(function(x){
      var r = src[x.i], vkey = view + ":" + x.i, vop = pcsv.vopen === vkey;
      h += '<div class="pc-vr' + (x.h >= 9 ? " win" : "") + (n - x.miss < 9 ? " dead" : "") + (vop ? " open" : "") + '" data-vk="' + vkey + '" role="button" tabindex="0" aria-expanded="' + vop + '" title="Тап — разбор варианта"><span>' + (x.i + 1) + '</span>';
      for(var j = 0; j < n; j++){
        var o = view === "sys" ? r[j] : r.charAt(j), cls = !res[j] ? "" : (res[j] === VOID || o.indexOf(res[j]) >= 0) ? "hit" : "miss";
        if(o.length > 1) cls += " m" + o.length;
        h += '<span class="' + cls + '" data-j="' + (j + 1) + '">' + o + '</span>';
      }
      h += '<span class="pc-h"' + (x.v ? ' title="' + fmt(x.v) + ' вар. в строке"' : '') + '>' + x.h + '</span></div>';
      if(vop){
        var vm = [], vw = [], vcp = "";
        for(var q = 0; q < n; q++){
          var oq = view === "sys" ? r[q] : r.charAt(q);
          vcp += oq.length > 1 ? "(" + oq + ")" : oq;
          if(res[q]){ if(res[q] !== VOID && oq.indexOf(res[q]) < 0) vm.push('<li><b>№' + (q + 1) + '</b> ' + escHtml(ms[q].home) + ' — ' + escHtml(ms[q].away) + ': у вас <b>' + oq + '</b>, вышло <b>' + res[q] + '</b></li>'); }
          else vw.push(q + 1);
        }
        h += '<div class="pc-vd"><div class="pc-vs"><b>' + (view === "sys" ? "Строка " : "Вариант ") + (x.i + 1) + '</b><span>угадано <b>' + x.h + '</b> из ' + played + '</span><span>максимум <b>' + (n - x.miss) + '</b></span>' + (x.v > 1 ? '<span>вариантов в строке <b>' + fmt(x.v) + '</b></span>' : '') + '</div>' +
          (vm.length ? '<p class="pc-vl">Не зашли</p><ul class="pc-vm">' + vm.join("") + '</ul>' : '<p class="pc-vl ok">' + (played ? "Ошибок пока нет" : "Матчи ещё не сыграны") + '</p>') +
          (vw.length ? '<p class="pc-vl">Ещё не решено: <b>№' + vw.join(", №") + '</b></p>' : '') +
          '<button type="button" class="pc-btn pc-vcp" data-cp="' + escHtml(vcp) + '">Скопировать вариант</button></div>';
      }
    });
    if(!part.length) h += '<div class="pc-none">Нет вариантов по этому фильтру</div>';
    h += '</div>';
    if(pages > 1) h += '<div class="pc-pager"><button type="button" data-g="0" aria-label="В начало"' + (pcsv.page ? '' : ' disabled') + '>&#171;</button>' +
      '<button type="button" data-g="' + (pcsv.page - 1) + '" aria-label="Назад"' + (pcsv.page ? '' : ' disabled') + '>&#8249;</button>' +
      '<span><b>' + (pcsv.page + 1) + '</b> / ' + pages + '</span>' +
      '<button type="button" data-g="' + (pcsv.page + 1) + '" aria-label="Дальше"' + (pcsv.page < pages - 1 ? '' : ' disabled') + '>&#8250;</button>' +
      '<button type="button" data-g="' + (pages - 1) + '" aria-label="В конец"' + (pcsv.page < pages - 1 ? '' : ' disabled') + '>&#187;</button></div>';
    /* где строки рейтинга были на экране прямо сейчас (с учётом ещё идущей анимации) — от этого и поедем */
    var oldVis = {}, ob = box.querySelector(".pc-rkb");
    if(ob){ var obt = ob.getBoundingClientRect().top; [].slice.call(box.querySelectorAll(".pc-rk")).forEach(function(r){ oldVis[r.getAttribute("data-id")] = r.getBoundingClientRect().top - obt; }); }
    box.innerHTML = h;
    $("pcLoad").addEventListener("click", pcsvPick);
    pcPasteBind();
    $("pcShareAll").addEventListener("click", pcsvShareAll);
    if($("pcDropAll")) $("pcDropAll").addEventListener("click", function(){
      var mine = pcsvMine(), nv = mine.reduce(function(a, st){ return a + st.rows.length; }, 0);
      if(!window.confirm("Убрать все загруженные CSV тиража №" + pcsv.tir + ": " + mine.length + " " + plural(mine.length, "набор", "набора", "наборов") +
        ", " + fmt(nv) + " " + plural(nv, "вариант", "варианта", "вариантов") + "? Вернуть их нельзя.")) return;
      pcsv.sets = pcsv.sets.filter(function(x){ return x.ai; });
      pcsvUse(0); pcsvStore();
      pcsv.msgAt = Date.now(); pcsv.msg = "Все загруженные CSV тиража №" + pcsv.tir + " убраны.";
      renderPrevCsv();
    });
    if($("pcDrop")) $("pcDrop").addEventListener("click", function(){
      pcsv.sets.splice(pcsv.act, 1);
      pcsvUse(Math.max(0, Math.min(pcsv.act, pcsv.sets.length - 1)));
      pcsvStore(); renderPrevCsv();
    });
    [].slice.call(box.querySelectorAll(".pc-lb")).forEach(function(b){
      b.addEventListener("click", function(){
        var f = "h" + b.getAttribute("data-h");
        pcsv.flt = pcsv.flt === f ? "all" : f; pcsv.page = 0; renderPrevCsv();
        var t = box.querySelector(".pc-flt"); if(t) try{ t.scrollIntoView({ behavior: "smooth", block: "center" }); }catch(e){}
      });
    });
    [].slice.call(box.querySelectorAll(".pc-flt button")).forEach(function(b){
      b.addEventListener("click", function(){ pcsv.flt = b.getAttribute("data-f"); pcsv.page = 0; renderPrevCsv(); });
    });
    [].slice.call(box.querySelectorAll(".pc-cr.wi-able")).forEach(function(r){
      r.addEventListener("click", function(){ var j = Number(r.getAttribute("data-w")); pcsv.what = pcsv.what === j ? null : j; renderPrevCsv(); });
    });
    /* живая реакция: счётчики крутятся, а вышедшие в 9+ и выбывшие варианты попадают в уведомление */
    var skey = pcsv.tir + "|" + pcsv.act + "|" + total, ps = pcsv.snap && pcsv.snap.key === skey ? pcsv.snap : null;
    pcsv.snap = { key: skey, best: best, now9: now9, can9: can9, can15: can15, win: winSet, dead: deadSet };
    if(ps){
      var cur = { best: best, now9: now9, can9: can9, can15: can15 };
      Object.keys(cur).forEach(function(k){
        if(cur[k] === ps[k]) return;
        var b = box.querySelector('[data-k="' + k + '"] b'); if(!b) return;
        b.parentNode.classList.add("bump");
        if(k === "best") return;
        var t0 = Date.now(), from = ps[k], to = cur[k];
        (function tick(){
          var f = Math.min(1, (Date.now() - t0) / 700);
          b.textContent = fmt(Math.round(from + (to - from) * f));
          if(f < 1 && b.isConnected) requestAnimationFrame(tick);
        })();
      });
      var nw = Object.keys(winSet).filter(function(i){ return !ps.win[i]; }), nd = Object.keys(deadSet).filter(function(i){ return !ps.dead[i]; });
      var lst = function(a){ return "№" + a.slice(0, 4).map(function(i){ return Number(i) + 1; }).join(", №") + (a.length > 4 ? " и ещё " + (a.length - 4) : ""); };
      if(nw.length && state.viewPrev) varToast(PAY + "+", false, "Вышли в " + PAY + "+: " + lst(nw));
      else if(nd.length && state.viewPrev) varToast("МИМО", true, "Выбыли из борьбы: " + lst(nd));
    }
    /* плавная перестановка наборов (FLIP): строки едут со старого места на новое. Едем от того места, где строка
       видна сейчас, поэтому новая перерисовка посреди движения не обрывает анимацию, а подхватывает её */
    if(rkNow){
      var rk2 = pcsv.rk, rb = box.querySelector(".pc-rkb"), rbt = rb ? rb.getBoundingClientRect().top : 0;
      var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      [].slice.call(box.querySelectorAll(".pc-rk")).forEach(function(r){
        var id = r.getAttribute("data-id"), nt = r.getBoundingClientRect().top - rbt, o = rk2.pos[id], ov = oldVis[id];
        var place = rkNow.map(function(q){ return String(q.i); }).indexOf(id) + 1;
        if(ov != null && Math.abs(ov - nt) > 1.5 && !calm && r.animate){
          var up = ov > nt;
          r.style.zIndex = up ? 2 : 1;
          var an = r.animate([{ transform: "translateY(" + (ov - nt) + "px)" }, { transform: "translateY(0)" }], { duration: 900, easing: "cubic-bezier(.22,.8,.25,1)" });
          an.onfinish = an.oncancel = function(){ r.style.zIndex = ""; };
          if(o && o.place !== place){ r.classList.add(up ? "go-up" : "go-dn"); dbgLog("места", "набор " + (Number(id) + 1) + ": " + o.place + " → " + place); }
        }
        rk2.pos[id] = { place: place };
        /* полоска «угадано из матчей» плавно растёт/падает, галочка — порог выплат */
        var bar = r.querySelector(".rk-bar"), fi = bar && bar.firstChild;
        if(bar){
          var wv = Number(bar.getAttribute("data-w")) || 0, pw = rk2.w && rk2.w[id] != null ? rk2.w[id] : 0;
          bar.lastChild.style.left = bar.getAttribute("data-pay") + "%";
          bar.className = "rk-bar" + (wv >= Number(bar.getAttribute("data-pay")) ? " pay" : "");
          fi.style.width = pw + "%";
          (function(f, to){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ f.style.width = to + "%"; }); }); })(fi, wv);
          (rk2.w = rk2.w || {})[id] = wv;
        }
        /* цифры докручиваются и вспыхивают при изменении */
        [].slice.call(r.querySelectorAll(".cn")).forEach(function(e){
          var key = e.getAttribute("data-k"), to = Number(String(e.textContent).replace(/\s/g, "")), vals = rk2.vals = rk2.vals || {}, from = vals[key];
          vals[key] = to;
          if(from == null || from === to) return;
          e.parentNode.classList.add("bump");
          var t0 = Date.now();
          (function tick(){ var f = Math.min(1, (Date.now() - t0) / 700); e.textContent = fmt(Math.round(from + (to - from) * f)); if(f < 1 && e.isConnected) requestAnimationFrame(tick); })();
        });
      });
    }
    [].slice.call(box.querySelectorAll(".pc-vr[data-vk]")).forEach(function(r){
      function tg(){ var k = r.getAttribute("data-vk"); pcsv.vopen = pcsv.vopen === k ? null : k; renderPrevCsv(); }
      r.addEventListener("click", tg);
      r.addEventListener("keydown", function(e){ if(e.key === "Enter" || e.key === " "){ e.preventDefault(); tg(); } });
    });
    [].slice.call(box.querySelectorAll(".pc-vcp")).forEach(function(b){
      b.addEventListener("click", function(e){
        e.stopPropagation();
        var t = b.getAttribute("data-cp") || "";
        function fb(){ var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); }catch(x){} document.body.removeChild(ta); }
        if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb); else fb();
        b.textContent = "Скопировано"; b.classList.add("ok");
        setTimeout(function(){ if(b.isConnected){ b.textContent = "Скопировать вариант"; b.classList.remove("ok"); } }, 1600);
      });
    });
    [].slice.call(box.querySelectorAll(".pc-cr.wi-able")).forEach(function(r){
      r.setAttribute("role", "button"); r.setAttribute("tabindex", "0");
      r.addEventListener("keydown", function(e){ if((e.key === "Enter" || e.key === " ") && e.target === r){ e.preventDefault(); r.click(); } });
    });
    [].slice.call(box.querySelectorAll(".pc-fs")).forEach(function(b){
      b.addEventListener("click", function(e){ e.stopPropagation(); var m = ms[Number(b.getAttribute("data-fs"))]; if(m) openFs(m); });
    });
    [].slice.call(box.querySelectorAll(".pc-rk")).forEach(function(b){
      b.addEventListener("click", function(){ pcsvUse(Number(b.getAttribute("data-t")) || 0); pcsvStore(); renderPrevCsv(); });
    });
    [].slice.call(box.querySelectorAll(".pc-view button")).forEach(function(b){
      b.addEventListener("click", function(){ pcsv.view = b.getAttribute("data-v"); pcsv.page = 0; renderPrevCsv(); });
    });
    [].slice.call(box.querySelectorAll(".pc-pager button")).forEach(function(b){
      b.addEventListener("click", function(){ pcsv.page = Number(b.getAttribute("data-g")) || 0; renderPrevCsv(); });
    });
  }
  function escHtml(x){ return String(x).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function enterPrev(){
    if(!state.prev) return;
    navBusy = 0; state.viewPrev = true; save(); render(); renderKickoff(); refreshPrev(); attachPrevTimes(); attachFsLogos();
  }
  /* время начала у прошлого тиража: берём из снимка, а чего нет — из фида Flashscore
     (он отдаёт только сегодня и завтра, поэтому вчерашние матчи дозаполнятся, пока они в фиде) */
  function attachPrevTimes(){
    var p = state.prev;
    if(!p || typeof fetch !== "function" || p.matches.every(function(m){ return m.time; })) return;
    var sports = {};
    p.matches.forEach(function(m){ if(!m.time) sports[fsFeedSport(m.league)] = true; });
    var keys = Object.keys(sports);
    Promise.all(keys.map(function(k){ return Promise.all([fsLoadDay(k, 0), fsLoadDay(k, 1)]); })).then(function(rs){
      if(state.prev !== p) return;
      var by = {}, changed = false;
      keys.forEach(function(k, i){ by[k] = rs[i][0].concat(rs[i][1]); });
      p.matches.forEach(function(m){
        if(m.time) return;
        var f = fsLookup(m, by[fsFeedSport(m.league)] || []);
        var t = f ? fsFmtTime(f.ts) : "";
        if(t){ m.time = t; changed = true; }
      });
      if(changed){ save(); if(state.viewPrev) render(); }
    }).catch(function(){});
  }
  function leavePrev(){
    var wasCur = !!(state.prev && state.prev.cur);
    state.viewPrev = false;
    if(wasCur){ state.prev = state.prevKeep || null; state.prevKeep = null; }   /* снимок текущего уходит, настоящий прошлый тираж возвращается сразу */
    save(); render(); renderKickoff();
    if(wasCur && !state.prev) setTimeout(seedPrev, 200);
  }
  /* отдельные кнопки в панели просмотра: листаем тиражи назад и вперёд, вплоть до текущего ещё не начавшегося.
     Набор CSV один на всех тиражах: те же варианты считаются по каждому тиражу. */
  var navBusy = 0;
  /* ссылка на наборы текущего тиража, который ещё не начался: открываем просмотр этого тиража с наборами */
  function openMultiCur(tir, payloads){
    var N = state.matches.length || 15, k = 0, added = 0;
    var step = function(){
      if(k >= payloads.length){
        try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
        enterCurView();
        pcsv.msgAt = Date.now();
        pcsv.msg = "Из ссылки открыто наборов: " + added + ". Тираж №" + tir + " ещё не начался: когда он начнётся, наборы останутся в просмотре.";
        renderPrevCsv();
        return;
      }
      varsDecode(payloads[k++], N, function(rows, pages){
        if(rows){
          pcsvAddTo(String(tir), { link: 1, rows: rows.map(function(r){ return r.join(""); }),
                                   sys: (pages || rows).map(function(pg){ return pg.join(","); }) });
          added++;
        }
        step();
      });
    };
    step();
  }
  function enterCurView(){
    if(!state.matches.length) return;
    if(state.prev && !state.prev.cur) state.prevKeep = state.prev;   /* прошлый тираж запоминаем: возврат на его вкладку мгновенный */
    var sn = snapPrev(state.tirazh, state.tirazhId, state.deadline, state.matches, state.poolSum);
    sn.cur = true; state.prev = sn; state.viewPrev = true;
    save(); render(); renderKickoff();
  }
  function viewNavTo(n){
    n = Number(n); var cur = Number(state.tirazh);
    if(!(n > 0) || !isFinite(cur)) return;
    pcsv.msg = "";
    if(n > cur){ leavePrev(); return; }
    if(n === cur){ enterCurView(); return; }
    var k = state.prevKeep;
    if(state.prev && !state.prev.cur && Number(state.prev.tirazh) === n){ enterPrev(); return; }
    if(k && Number(k.tirazh) === n){
      /* вкладка уже загружена: переключаем без сети */
      state.prev = k; state.prevKeep = null; state.viewPrev = true;
      save(); render(); renderKickoff(); refreshPrev();
      return;
    }
    if(navBusy && Date.now() - navBusy < 6000) return;
    navBusy = Date.now();
    prevLoad(n, true, function(){ navBusy = 0; say("Тираж №" + n + " подгрузить не удалось: его нет в списке тиражей. Наборы сохранены и откроются, когда он загрузится."); });
  }
  function syncTirNav(){
    var inPrev = !!(state.viewPrev && state.prev);
    document.body.classList.toggle("is-prev", inPrev);
    $("btnTirPrev").disabled = !state.prev || inPrev;
    $("btnTirNext").disabled = !inPrev;
    var bt = $("btnTirages");
    if(bt){
      bt.setAttribute("aria-pressed", inPrev ? "true" : "false");
      var tpt = bt.querySelector(".tp-t");
      if(tpt) tpt.textContent = inPrev ? "АКТИВНЫЙ ТИРАЖ" : "ТИРАЖИ";
      bt.title = inPrev ? "Вернуться к купону активного тиража" : "Страница наблюдения за тиражами: предыдущий и текущий, их наборы CSV, бриф, охота и ИИ";
    }
    $("tirazhName").value = inPrev ? state.prev.tirazh : (state.tirazh || "");
    if(!inPrev){ $("prevBar").hidden = true; if($("prevCsv")) $("prevCsv").hidden = true; }
  }

  /* выбираем тираж: либо заданный номером (ссылка на купон), либо текущий активный */
  function findDrawing(rows, want){
    var i;
    if(want){
      for(i=0;i<rows.length;i++) if(String(rows[i].number) === String(want)) return rows[i];
      return null;
    }
    for(i=0;i<rows.length;i++) if(rows[i].status === "active") return rows[i];
    return rows[0] || null;
  }

  function pullTirazh(silent, wantNumber){
    UJ.silent = !!silent;
    var btn = $("btnFetch");
    var lbl = btn.querySelector(".lbl") || btn;
    btn.disabled = true;
    var was = lbl.textContent, tp0 = Date.now();
    if(!silent){ btn.classList.add("is-loading"); lbl.textContent = "Загружаю…"; }   /* фоновый опрос кнопку не трогает: без миганий и сдвигов */
    var firstRows = null;
    /* одна страница выгрузки — 50 тиражей; если ищем конкретный номер, идём глубже */
    function grab(page){
      return apiFetch("baltbet-main/drawings?page=" + page)
        .then(function(r){ if(!r.ok) throw new Error("список тиражей: " + r.status); return r.json(); })
        .then(function(j){
          var rows = (j && j.data) || [];
          if(firstRows === null) firstRows = rows;
          var d = findDrawing(rows, wantNumber);
          if(d) return d;
          if(wantNumber && page < 3 && rows.length) return grab(page + 1);
          return null;
        });
    }
    return grab(1)
      .then(function(d){
        var rows = firstRows || [];
        if(!d) throw new Error(wantNumber ? ("тираж №" + wantNumber + " не найден") : "тиражи не найдены");
        var haveApiData = state.matches.some(function(m){ return m.pct; });
        /* приём идёт до закрытия, поэтому запоминаем типичный ИТОГОВЫЙ фонд:
           медиану завершённых тиражей — по ней и надо считать выплаты */
        var done = rows.filter(function(x){ return x.status === "finished" && Number(x.pool_sum) > 0; })
                       .map(function(x){ return Number(x.pool_sum); })
                       .sort(function(a,b){ return a - b; });
        state.poolTypical = done.length ? done[Math.floor(done.length/2)] : 0;
        /* пул каждого тиража из списка — для просмотра прошлого тиража стрелками */
        var pbn = {};
        rows.forEach(function(x){
          pbn[String(x.number)] = { pool: Number(x.pool_sum) || 0, jack: Number(x.jackpot) || 0, end: x.ended_at || "" };
        });
        state.drawByNo = pbn;
        /* прошлый тираж мог сохраниться уже с датой и пулом нового — берём его собственные из списка */
        if(state.prev && pbn[state.prev.tirazh]){
          if(pbn[state.prev.tirazh].end) state.prev.deadline = pbn[state.prev.tirazh].end;
          if(pbn[state.prev.tirazh].pool) state.prev.pool = pbn[state.prev.tirazh].pool;
          if(pbn[state.prev.tirazh].jack) state.prev.jack = pbn[state.prev.tirazh].jack;
        }
        var rr = rows.filter(function(x){ return x.status === "finished" && Number(x.pool_sum) > 0 && Number(x.jackpot) > 0; })
                     .map(function(x){ return Number(x.jackpot) / Number(x.pool_sum); })
                     .sort(function(a,b){ return a - b; });
        state.ratioTypical = rr.length ? rr[Math.floor(rr.length/2)] : 0;
        applyHistory(rows);
        /* одна страница выгрузки — это 50 тиражей; для шкалы этого мало,
           поэтому остальные страницы дотягиваем следом и пересчитываем */
        loadHistory(rows);
        /* тираж сменился, а в корзине уже что-то есть — молча не сносим.
           Если номер запрошен явно (ссылка на купон), переход как раз и нужен. */
        if(!wantNumber && silent && String(d.number) !== String(state.tirazh) && (state.played.length || state.rolls)){
          return { changed: d.number };
        }
        state.deadline = d.ended_at || "";
        state.jackpot = Number(d.jackpot) || 0;
        state.poolSum = Number(d.pool_sum) || 0;
        /* тираж тот же — не пересобираем его заново, а только освежаем проценты и кэфы:
           купон, режимы и корзина остаются как были */
        if(haveApiData && String(d.number) === String(state.tirazh)){
          return apiFetch("drawing-info/" + d.id)
            .then(function(r){ if(!r.ok) throw new Error("тираж " + d.number + ": " + r.status); return r.json(); })
            .then(function(j2){
              var info = j2.data || j2;
              if(refreshPct(info)) return {soft:true, number:d.number};
              return {n:applyDrawing(info), number:d.number};
            });
        }
        return apiFetch("drawing-info/" + d.id)
          .then(function(r){ if(!r.ok) throw new Error("тираж " + d.number + ": " + r.status); return r.json(); })
          .then(function(j2){ return applyDrawing(j2.data || j2); })
          .then(function(n){ return {n:n, number:d.number}; });
      })
      .then(function(res){
        btn.disabled = false; btn.classList.remove("is-loading"); lbl.textContent = was;
        DBG.api["текущий"] = { ms: Date.now() - tp0, at: Date.now() }; dbgLog("totobrief", "опрос тиража: " + (Date.now() - tp0) + " мс");
        if(res && res.changed){
          say("На totobrief появился тираж №" + res.changed + ", а открыт №" + state.tirazh +
              ". Нажми «Обновить тираж», чтобы перейти на него — купон и корзина этого тиража сохранятся, к ним можно вернуться.");
          tryPending();
        }
        else if(res && res.soft){
          if(!silent) say("Тираж №" + res.number + " тот же — обновил доли игроков и коэффициенты. Купон и корзина не тронуты.");
          tryPending();
        }
        else if(res){
          var noPct = !state.matches.some(function(m){ return m.pct; });
          say("Тираж №" + res.number + (feed.src === "mirror" ? " загружен из зеркала: " : " загружен: ") + res.n +
              " матч(ей)" + (noPct ? ", процентов и кэфов в снимке нет." : ", проценты игроков и конторы в строках."));
        }
        if(res && !res.soft) tryPending();
      })
      .catch(function(err){
        btn.disabled = false; btn.classList.remove("is-loading"); lbl.textContent = was;
        DBG.api["текущий"] = { ms: Date.now() - tp0, at: Date.now(), err: 1 }; dbgLog("err", "опрос тиража: " + (err && err.message || err));
        tryPending();
        if(!silent) say("Не удалось забрать тираж ни с totobrief, ни из зеркала: " + (err && err.message ? err.message : err) +
                        ". На странице-артефакте запросы наружу запрещены — автоподтяжка работает только в размещённой версии.");
      });
  }

  $("btnFetch").addEventListener("click", function(){
    /* в просмотре файла освежаем открытый тираж, а не переходим на следующий */
    if(book) pullTirazh(false, state.tirazh); else pullTirazh(false);
  });

  $("btnPct").addEventListener("click", function(){
    state.showPct = !state.showPct;
    save(); render();
  });

  /* кнопка «Оценить купон» снята 20.09.2026 — расчёт EV не пригодился; showEV оставлен на случай возврата */
  $("btnPF").addEventListener("click", function(){ showPortfolio(); });
  /* окно разбора ИИ целиком в газетном стиле: рамка, шапка, кнопки; остальные окна обычные */
  (function(){
    var t = $("evTitle"), box = t && t.closest(".ev-box"); if(!box || typeof MutationObserver !== "function") return;
    function sync(){ box.classList.toggle("ev-paper", /^Разбор ИИ/.test(t.textContent || "")); }
    new MutationObserver(sync).observe(t, { childList: true, characterData: true, subtree: true }); sync();
  })();
  $("evClose").addEventListener("click", function(){ $("evBack").hidden = true; });
  $("evBack").addEventListener("click", function(e){ if(e.target === $("evBack")) $("evBack").hidden = true; });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape") $("evBack").hidden = true; });

  $("btnKf").addEventListener("click", function(){
    state.showKf = !state.showKf;
    save(); render();
  });

  $("btnZoomIn").addEventListener("click", function(){ setZoom((Number(state.zoom) || 1) + ZSTEP); });
  $("btnZoomOut").addEventListener("click", function(){ setZoom((Number(state.zoom) || 1) - ZSTEP); });

  function applyThemeBtn(){
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    var b = $("btnTheme");
    b.setAttribute("aria-pressed", isLight ? "true" : "false");
    b.title = isLight ? "Сейчас светлая тема — нажми, чтобы включить тёмную" : "Сейчас тёмная тема — нажми, чтобы включить светлую";
  }
  $("btnFeedSt").addEventListener("click", showData);
  setTimeout(function(){ checkData(); }, 4000);
  setInterval(function(){ checkData(true); }, 10 * 60000);
  $("btnTheme").addEventListener("click", function(){
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    var next = isLight ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try{ localStorage.setItem("theme", next); }catch(e){}
    applyThemeBtn();
  });
  applyThemeBtn();


  /* ---------- csv ---------- */
  function enumerate(src){
    var list = src || state.matches;
    var cols = list.map(function(m){ return OUT.filter(function(o){ return m.picks[o]; }); });
    if(cols.some(function(c){ return c.length===0; })) return null;
    var rows = [[]];
    for(var i=0;i<cols.length;i++){
      var next = [];
      for(var r=0;r<rows.length;r++){
        for(var c=0;c<cols[i].length;c++){ next.push(rows[r].concat(cols[i][c])); }
      }
      rows = next;
      if(rows.length > MAX_CSV) return "toobig";
    }
    return rows;
  }

  /* Формат Балтбета: без заголовка и BOM, разделитель ";",
     первое поле — цена строки, дальше по одному исходу на матч, перевод строки "\n". */
  /* сколько строк даст один сохранённый вариант */
  /* у однострочных вариантов (охота, бриф) копии купона нет — исходы берём из подписи «1 X 2 …» */
  function vSnap(v){
    if(!v) return null;
    if(Array.isArray(v.snap)) return v.snap;
    if(!v.sig) return null;
    var a = String(v.sig).split(" ");
    if(a.length !== state.matches.length) return null;
    var out = [];
    for(var j = 0; j < a.length; j++){
      if(OUT.indexOf(a[j]) < 0) return null;
      var pk = {"1": false, "X": false, "2": false}; pk[a[j]] = true;
      out.push({ picks: pk, mode: "free", pool: OUT.slice() });
    }
    return out;
  }
  function variantCombos(v){
    if(v && !v.snap && v.combos === 1 && v.sig) return 1;   /* быстрый путь для тысяч однострочных вариантов */
    var vs = vSnap(v);
    if(!vs) return 0;
    var n = 1;
    for(var i=0;i<vs.length;i++){
      var c = 0;
      for(var k=0;k<3;k++) if(vs[i].picks[OUT[k]]) c++;
      if(c === 0) return 0;
      n *= c;
    }
    return n;
  }

  /* сколько матчей в текущем купоне — варианты с другим числом не выгружаем */
  function csvPlan(){
    var need = state.matches.length;
    var take = [], skipped = 0, off = 0, total = 0;
    state.played.forEach(function(v){
      var vs0 = v.snap ? v.snap : null;
      if(vs0 ? (!Array.isArray(vs0) || vs0.length !== need || variantCombos(v) === 0) : (!v.sig || String(v.sig).split(" ").length !== need)){ skipped++; return; }
      if(v.sel === false){ off++; return; }        /* галочка снята — в файл не идёт */
      take.push(v); total += variantCombos(v);
    });
    return {take:take.slice().reverse(), skipped:skipped, off:off, total:total, need:need};
  }

  function buildCsv(){
    var price = Number(state.price) || 0;
    var lines = [];
    var plan = csvPlan();

    if(plan.take.length){                       /* выгружаем все сыгранные варианты, от первого к последнему */
      if(plan.total > MAX_CSV) return null;
      for(var i=0;i<plan.take.length;i++){
        var rows = enumerate(vSnap(plan.take[i]));
        if(rows === null || rows === "toobig") continue;
        for(var r=0;r<rows.length;r++) lines.push(String(price) + ";" + rows[r].join(";"));
      }
    } else {                                    /* список пуст — выгружаем то, что сейчас в купоне */
      var cur = enumerate();
      if(cur === null || cur === "toobig") return null;
      cur.forEach(function(r){ lines.push(String(price) + ";" + r.join(";")); });
    }
    if(!lines.length) return null;
    return lines.join("\n") + "\n";
  }

  /* Системный формат БалтБета: одна строка на вариант, исходы матча пишутся
     слитно («12», «1X», «1X2»), а первое поле — сумма ЗА ВАРИАНТ, не за строку.
     Шесть двоек при 30 ₽ за вариант БалтБет сам посчитает как 1 920 ₽. */
  function csvCell(m){
    var s = "";
    for(var k = 0; k < 3; k++) if(m.picks[OUT[k]]) s += OUT[k];
    return s;
  }

  /* Системная выгрузка берёт ИМЕННО ТОТ КУПОН, который на экране: он и есть
     одна строка с допами. Корзина идёт в файл, только если купон не заполнен —
     иначе человек собирает систему, а получает старые броски. */
  function buildCsvSys(){
    var price = Number(state.price) > 0 ? Number(state.price) : 30;
    var sep = state.csvSep === "; " ? "; " : ";";
    /* первое поле — ВСЕГДА цена одного варианта (30 ₽); БалтБет сам умножает её на число комбинаций */
    var lines = [], src = "";
    var mk = function(snap){
      var cells = [], i, c, n = 1;
      for(i = 0; i < snap.length; i++){
        c = csvCell(snap[i]);
        if(!c) return null;                    /* в матче не выбрано ничего */
        n *= c.length;
        cells.push(c);
      }
      return String(price) + sep + cells.join(sep);
    };
    var one = mk(state.matches);
    if(one){ lines.push(one); src = "купон"; }
    else {
      var plan = csvPlan();
      for(var i = 0; i < plan.take.length; i++){
        var row = mk(vSnap(plan.take[i]));
        if(row) lines.push(row);
      }
      src = "корзина";
    }
    if(!lines.length) return null;
    return { csv: lines.join("\n") + "\n", rows: lines.length, price: price, src: src };
  }

  /* обычное скачивание в папку загрузок браузера — запасной путь */
  function plainDownload(csv, name){
    var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    $("expNote").textContent = "Файл " + name + " сохранён в загрузки.";
  }
  /* На ПК (Chrome, Edge, Opera) браузер сам спрашивает папку и имя файла и запоминает
     последнюю выбранную папку. Если окна выбора нет (телефон, Firefox, Safari) —
     файл уходит в папку загрузок, как раньше. Окно можно открыть только прямо из клика. */
  function saveCsvFile(csv, name){
    if(!(window.claude && typeof window.claude.use === "function")){
      if(typeof window.showSaveFilePicker === "function" && window.isSecureContext){
        var p;
        try{
          p = window.showSaveFilePicker({
            suggestedName: name, id: "dzhek-csv", startIn: "downloads",
            types: [{ description: "Таблица CSV", accept: { "text/csv": [".csv"] } }]
          });
        }catch(e){ p = null; }
        if(p){
          p.then(function(h){
            return h.createWritable().then(function(w){
              return w.write(new Blob([csv], {type:"text/csv;charset=utf-8"})).then(function(){ return w.close(); });
            }).then(function(){ $("expNote").textContent = "Файл " + (h.name || name) + " сохранён там, где вы указали."; });
          }).catch(function(e){
            if(e && e.name === "AbortError"){ $("expNote").textContent = "Сохранение отменено."; return; }
            try{ plainDownload(csv, name); }catch(e2){ showFallback(csv); }
          });
          return;
        }
      }
      try{ plainDownload(csv, name); }catch(e){ showFallback(csv); }
      return;
    }
    var done = false;
    window.claude.use("downloads").then(function(dl){
      if(!dl || done) { if(!done) showFallback(csv); return; }
      done = true;
      dl.save({filename:name, data:csv}).catch(function(){ showFallback(csv); });
    }).catch(function(){ showFallback(csv); });
  }

  function updateCsvPrev(){
    var el = $("csvPrev");
    if(!el) return;
    var out = buildCsvSys();
    el.textContent = out ? out.csv.split("\n")[0] : "строка появится, когда в каждом матче будет исход";
  }

  /* настройки «сумма в строке» и «разделитель» убраны с экрана: остаются прежние значения
     из state (сумма в строке теперь всегда цена одного варианта, разделитель «;»), поменять можно только в коде */

  $("btnCsvSys").addEventListener("click", function(){
    if(book){
      var bx = bookExport(true);
      saveCsvFile(bx.csv, bx.name);
      bookSay("Скачан " + bx.what + ".");
      return;
    }
    var out = buildCsvSys();
    if(!out){
      $("expNote").textContent = "Нечего выгружать: в купоне есть матч без исхода, а корзина пуста.";
      return;
    }
    var combos = out.src === "купон" ? (tally().combos || 0) : csvPlan().total;
    var name = csvNameSum("допы", out.rows, combos * out.price);
    saveCsvFile(out.csv, name);
    var note = "Файл " + name + " — выгружен " +
      (out.src === "купон" ? "КУПОН с экрана" : "корзина (купон не заполнен)") +
      ": строк " + out.rows + ", комбинаций " + fmt(combos) +
      ", цена одного варианта " + out.price + " ₽, итого " + fmt(combos * out.price) +
      " ₽. Исходы записаны слитно.";
    if(!(Number(state.price) > 0)) note += " Поле «Стоимость купона» пустое, поставил минимальные 30 ₽.";
    if(out.src === "купон" && state.played.length)
      note += " В корзине лежит " + state.played.length + " вариант(ов) — они в этот файл НЕ вошли.";
    $("expNote").textContent = note;
  });

  $("btnSendSys").addEventListener("click", function(){
    if(book){
      var bx = bookExport(true);
      shareCsv(bx.csv, bx.name, "Система из файла — " + bx.what, "Отправлен " + bx.what + ".");
      return;
    }
    var out = buildCsvSys();
    if(!out){
      $("expNote").textContent = "Нечего отправлять: в купоне есть матч без исхода, а корзина пуста.";
      return;
    }
    var combos = out.src === "купон" ? (tally().combos || 0) : csvPlan().total;
    var total = combos * out.price;
    var name = csvNameSum("допы", out.rows, total);
    var what = (out.src === "купон" ? "купон с экрана" : "корзина") + ": вариантов " + out.rows +
      ", комбинаций " + fmt(combos) + ", итого " + fmt(total) + " ₽";
    var extra = (out.src === "купон" && state.played.length)
      ? " В корзине лежит " + state.played.length + " вариант(ов) — они в этот файл НЕ вошли." : "";

    var file = null;
    try{ file = new File([out.csv], name, {type:"text/csv"}); }catch(e){}

    if(file && navigator.canShare && navigator.canShare({files:[file]}) && navigator.share){
      navigator.share({files:[file], title:"Тираж №" + (state.tirazh||""), text:"Система Балтсистемы — " + what})
        .then(function(){ $("expNote").textContent = "Файл " + name + " отправлен (" + what + ")." + extra; })
        .catch(function(err){
          if(err && err.name === "AbortError"){ $("expNote").textContent = "Отправка отменена."; return; }
          copyCsv(out.csv, name);
        });
      return;
    }
    copyCsv(out.csv, name);
  });

  $("btnCsv").addEventListener("click", function(){
    if(book){
      var bx = bookExport(false);
      saveCsvFile(bx.csv, bx.name);
      bookSay("Скачано: " + bx.what + ".");
      return;
    }
    var csv = buildCsv();
    if(!csv){ $("expNote").textContent = "Нечего выгружать — купон пустой."; return; }
    var rowsN = csv.replace(/\n+$/,"").split("\n").length;
    var name = csvNameSum("по 1 купону", rowsN, rowsN * briefPrice());
    saveCsvFile(csv, name);
  });

  $("btnSend").addEventListener("click", function(){
    if(book){
      var bx = bookExport(false);
      shareCsv(bx.csv, bx.name, "Варианты из файла — " + bx.what, "Отправлено: " + bx.what + ".");
      return;
    }
    var csv = buildCsv();
    if(!csv){ $("expNote").textContent = "Нечего отправлять — купон пустой."; return; }
    var rowsN = csv.replace(/\n+$/,"").split("\n").length;
    var name = csvNameSum("по 1 купону", rowsN, rowsN * briefPrice());

    var file = null;
    try{ file = new File([csv], name, {type:"text/csv"}); }catch(e){}

    if(file && navigator.canShare && navigator.canShare({files:[file]}) && navigator.share){
      navigator.share({files:[file], title:"Тираж №" + (state.tirazh||""), text:"Купон Балтсистемы, " + rowsN + " строк"})
        .then(function(){ $("expNote").textContent = "Файл " + name + " отправлен."; })
        .catch(function(err){
          if(err && err.name === "AbortError"){ $("expNote").textContent = "Отправка отменена."; return; }
          copyCsv(csv, name);
        });
      return;
    }
    copyCsv(csv, name);
  });

  function copyCsv(csv, name){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(csv).then(function(){
        $("expNote").textContent = "Отправка файлом тут недоступна, поэтому содержимое " + name +
          " скопировано в буфер — вставляй куда нужно.";
        bookMsg($("expNote").textContent);
      }).catch(function(){ showFallback(csv); });
    } else {
      showFallback(csv);
    }
  }

  function showFallback(csv){
    bookMsg("Скопировать не вышло — текст лежит в поле внизу, в панели «Выгрузка».");
    $("csvFallback").hidden = false;
    $("csvOut").value = csv;
    $("csvOut").focus();
    $("csvOut").select();
  }

  function boom(e){
    var d = document.createElement("div");
    d.className = "hint";
    d.style.position = "relative";
    d.textContent = "Сбой в странице: " + (e && (e.message || e)) + ". Покажи этот текст Клоду.";
    document.body.insertBefore(d, document.body.firstChild);
  }
  window.addEventListener("error", function(ev){ boom(ev.error || ev.message); });

  try {
    if(freshStart){ save(); }
    /* купон при перезагрузке НЕ очищаем (25.09.2026): телефон и браузер сами перезагружают
       вкладку, и проставленные исходы пропадали. У каждого тиража свой купон (couponStash), очищается только кнопкой. */
    render();
    attachFsLogos(); attachFsTimes(); /* дозаполнить время начала, если тираж пришёл из кэша ещё без него */
    /* если страница размещена в интернете — тихо проверить, не сменился ли тираж */
    if(typeof fetch === "function"){
      /* открыли ссылку на купон — грузим сразу ТОТ тираж, а не текущий */
      setTimeout(function(){
        /* ссылку с вариантами тянем после текущего тиража: закрытый тираж откроется в просмотре прошлого */
        var want = (pendingLink && pendingLink.tirazh) ? pendingLink.tirazh : null;
        if(want) linkPulling = true;
        pullTirazh(true, want);
        setTimeout(seedPrev, 4000);          /* прошлый тираж — фоном, когда текущий уже на месте */
        setTimeout(attachPrevTimes, 7000);   /* и время начала его матчей */
        setTimeout(loadHist, 2500);          /* история тиражей для разбора — тоже фоном */
      }, 300);
    } else {
      tryPending();                        /* без сети — ставим купон из ссылки по тому, что уже сохранено */
    }
  } catch(e){ boom(e); }
  setInterval(function(){ try{ renderKickoff(); }catch(e){} }, 30000);

  /* пока приём идёт и вкладка открыта, доли игроков сами подтягиваются раз в 7 минут:
     они ползут весь день, а «большинство/меньшинство» считаются именно по ним */
  /* автообновление (вкладка в фоне — не опрашиваем):
     — приём идёт — раз в 7 минут, доли игроков ползут медленно;
     — приём закрыт, а в тираже есть неподведённые матчи — раз в 30 секунд, ради счёта;
       при возврате на вкладку — сразу.
       Тянем ОТКРЫТЫЙ тираж по номеру, чтобы не перескочить на следующий;
     — все результаты подведены или приём закрылся больше 3 дней назад — не опрашиваем */
  var lastAuto = Date.now(), lastPrev = 0;
  var LIVE_EVERY = C.LIVE_EVERY_MS;              /* счёт идущих матчей — раз в 30 секунд */
  /* вернулся на вкладку (телефон разблокировал, переключился из другого приложения) —
     счёт тянем сразу, не дожидаясь очередного круга: пока вкладка в фоне, опроса нет */
  document.addEventListener("visibilitychange", function(){
    if(document.hidden) return;
    lastAuto = 0; lastPrev = 0;
    setTimeout(autoTick, 300);
  });
  setInterval(autoTick, 10 * 1000);
  function autoTick(){
    try{
      if(document.hidden) return;
      if(typeof fetch !== "function") return;
      loadHist();                           /* сама решает, пора ли: не чаще раза в 6 часов */
      if(state.viewPrev && state.prev && !prevDone() && Date.now() - lastPrev > LIVE_EVERY - 2000){
        lastPrev = Date.now(); refreshPrev();
      }
      if(!state.matches.length) return;
      var ts = kickoffMs();
      if(ts == null) return;
      var now = Date.now(), open = ts - now > 0;
      if(!open){
        if(!state.tirazh) return;
        if(now - ts > 3 * 24 * 3600 * 1000) return;
        if(state.matches.every(function(m){ return m.res; })) return;
      }
      var every = open ? 7 * 60 * 1000 : LIVE_EVERY;
      if(now - lastAuto < every - 2000) return;
      if($("btnFetch").disabled) return;      /* прошлый запрос ещё идёт */
      lastAuto = now;
      if(open && !book) pullTirazh(true); else pullTirazh(true, state.tirazh);
    }catch(e){}
  }

  /* ====================================================================
     НОВАЯ АНАЛИТИКА: подстановка исходов по данным
     ==================================================================== */

  /* ---------- «По данным»: расстановка исходов по истории ----------
     Вероятность конторы поправляется по фактической частоте похожих исходов
     в истории (отдельно для 1, X и 2, со сглаживанием к самой линии).
     Затем каждому матчу даётся один исход — с лучшим сочетанием вероятности
     и недооценённости толпой, — и купон расширяется двойниками/тройниками
     там, где прирост шанса на рубль максимален, пока не упрётся в бюджет. */
  var DATA_BUDGETS = [1, 8, 32, 128, 512];
  var dataCal = null;
  function buildDataCal(){
    if(dataCal && dataCal.n === hist.ev.length) return dataCal;
    var SIZE = 5, B = 20, cal = [[], [], []];
    for(var k = 0; k < 3; k++) for(var i = 0; i < B; i++) cal[k][i] = { hit: 0, n: 0, sp: 0 };
    hist.ev.forEach(function(e){
      if(!e.bk || !e.res) return;
      var s = e.bk[0] + e.bk[1] + e.bk[2]; if(!s) return;
      for(var k = 0; k < 3; k++){
        var p = e.bk[k] / s, bi = Math.max(0, Math.min(B - 1, Math.floor(p * 100 / SIZE)));
        var c = cal[k][bi]; c.n++; c.sp += p; if(OUT[k] === e.res) c.hit++;
      }
    });
    dataCal = { n: hist.ev.length, cal: cal, SIZE: SIZE, B: B };
    return dataCal;
  }
  function calProb(bk){
    var s = Number(bk[0]) + Number(bk[1]) + Number(bk[2]);
    if(!(s > 0)) return null;
    var D = buildDataCal(), SHRINK = 300, out = [];
    for(var k = 0; k < 3; k++){
      var p = Number(bk[k]) / s;
      var c = D.cal[k][Math.max(0, Math.min(D.B - 1, Math.floor(p * 100 / D.SIZE)))];
      /* поправка = (факт − прогноз) в бакете, сглаженная к нулю при малой выборке */
      var shift = c.n ? (c.hit - c.sp) / (c.n + SHRINK) : 0;
      out.push(Math.max(0.01, p + shift));
    }
    var t = out[0] + out[1] + out[2];
    return out.map(function(x){ return x / t; });
  }
  function crowdShare(pool){
    if(!pool) return null;
    var v = pool.map(Number);
    if(v.some(function(x){ return !isFinite(x) || x < 1; })) return null;   /* пропуски в долях — не доверяем */
    var s = v[0] + v[1] + v[2];
    return v.map(function(x){ return x / s; });
  }
  function planByData(budget){
    var rows = [];
    state.matches.forEach(function(m, idx){
      var r = { idx: idx, m: m, locked: m.mode === "lock", p: null, q: null, set: [] };
      if(m.pct && m.pct.bk) r.p = calProb(m.pct.bk);
      if(m.pct) r.q = crowdShare(m.pct.pool);
      if(r.locked){ r.set = OUT.filter(function(o){ return m.picks[o]; }).map(function(o){ return OUT.indexOf(o); }); }
      else if(r.p){
        var best = 0, bs = -1;
        for(var k = 0; k < 3; k++){
          var v = r.q ? r.p[k] / r.q[k] : 1;
          var sc = r.p[k] * Math.pow(Math.min(v, 2), 0.35);
          if(sc > bs){ bs = sc; best = k; }
        }
        r.set = [best];
      }
      rows.push(r);
    });
    var free = rows.filter(function(r){ return !r.locked && r.p; });
    var combos = 1;
    rows.forEach(function(r){ combos *= Math.max(1, r.set.length); });
    for(;;){
      var bestR = null, bestK = -1, bestG = 0;
      free.forEach(function(r){
        var n = r.set.length; if(n >= 3) return;
        if(combos / n * (n + 1) > budget) return;
        var S = 0; r.set.forEach(function(k){ S += r.p[k]; });
        for(var k = 0; k < 3; k++){
          if(r.set.indexOf(k) >= 0) continue;
          var g = Math.log((S + r.p[k]) / S) / Math.log((n + 1) / n);
          if(g > bestG){ bestG = g; bestR = r; bestK = k; }
        }
      });
      if(!bestR) break;
      combos = combos / bestR.set.length * (bestR.set.length + 1);
      bestR.set.push(bestK);
    }
    var hit = 1;
    rows.forEach(function(r){
      if(!r.p){ return; }
      var S = 0; r.set.forEach(function(k){ S += r.p[k]; }); hit *= S;
      r.set.sort();
      var top = r.set.map(function(k){ return OUT[k] + " " + Math.round(r.p[k] * 100) + "%"; }).join(", ");
      if(r.locked) r.why = "фикс, не трогаю";
      else if(r.set.length === 3) r.why = "перекоса нет — все три";
      else if(r.set.length === 2) r.why = "исходы близки: " + top;
      else {
        var k0 = r.set[0], v0 = r.q ? r.p[k0] / r.q[k0] : 1;
        r.why = (v0 >= 1.15 ? "толпа недооценивает (" + Math.round(r.q[k0] * 100) + "%)"
               : (r.p[k0] >= 0.45 ? "явный фаворит" : "лучший из трёх")) + ": " + top;
      }
    });
    return { rows: rows, combos: combos, hit: rows.some(function(r){ return r.p; }) ? hit : 0 };
  }
  /* ---------- «Симуляция»: максимум шанса на приз (9+) ----------
     Купон берёт k угаданных, если верный исход попал в отмеченные в k матчах.
     Начинаем с самого вероятного исхода в каждом матче и добавляем исходы там,
     где они сильнее всего поднимают шанс 9+ на каждое удвоение цены. */
  function planBySim(budget){
    var rows = [];
    state.matches.forEach(function(m, idx){
      var r = { idx: idx, m: m, locked: m.mode === "lock", p: null, q: null, set: [], gain: 0 };
      if(m.pct && m.pct.bk) r.p = calProb(m.pct.bk);
      if(m.pct) r.q = crowdShare(m.pct.pool);
      if(r.locked) r.set = OUT.filter(function(o){ return m.picks[o]; }).map(function(o){ return OUT.indexOf(o); });
      else if(r.p){ var b = 0; for(var k = 1; k < 3; k++) if(r.p[k] > r.p[b]) b = k; r.set = [b]; }
      rows.push(r);
    });
    function cover(r){
      if(r.m && r.m.fsVoid) return 1;
      if(!r.p) return r.locked ? 0.4 : 0;
      var s = 0; r.set.forEach(function(k){ s += r.p[k]; }); return Math.min(1, s);
    }
    function tail9(){ return evTail(poissonBinomial(rows.map(cover)), 9); }
    var combos = 1; rows.forEach(function(r){ combos *= Math.max(1, r.set.length); });
    var cur = tail9();
    for(;;){
      var bestR = null, bestK = -1, bestG = 0, bestT = cur;
      rows.forEach(function(r){
        if(r.locked || !r.p) return;
        var n = r.set.length; if(n >= 3 || combos / n * (n + 1) > budget) return;
        for(var k = 0; k < 3; k++){
          if(r.set.indexOf(k) >= 0) continue;
          r.set.push(k); var t = tail9(); r.set.pop();
          var g = Math.log(t / Math.max(cur, 1e-12)) / Math.log((n + 1) / n);
          if(g > bestG){ bestG = g; bestR = r; bestK = k; bestT = t; }
        }
      });
      if(!bestR) break;
      combos = combos / bestR.set.length * (bestR.set.length + 1);
      bestR.set.push(bestK); bestR.gain += bestT - cur; cur = bestT;
    }
    /* проверка розыгрышем: 10 000 тиражей по поправленным вероятностям */
    var RUNS = 10000, h9 = 0, h12 = 0, h15 = 0;
    for(var s = 0; s < RUNS; s++){
      var hits = 0;
      for(var i = 0; i < rows.length; i++){
        var r = rows[i]; if(!r.p) continue;
        var u = Math.random(), res = u < r.p[0] ? 0 : (u < r.p[0] + r.p[1] ? 1 : 2);
        if(r.set.indexOf(res) >= 0) hits++;
      }
      if(hits >= 9) h9++; if(hits >= 12) h12++; if(hits >= 15) h15++;
    }
    rows.forEach(function(r){
      if(!r.p) return;
      r.set.sort();
      var top = r.set.map(function(k){ return OUT[k] + " " + Math.round(r.p[k] * 100) + "%"; }).join(", ");
      if(r.locked) r.why = "фикс, не трогаю";
      else if(r.set.length === 1) r.why = "самый вероятный: " + top;
      else r.why = "+" + (r.gain * 100).toFixed(1) + " п.п. к шансу 9+: " + top;
    });
    return { rows: rows, combos: combos, sim: { p9: h9 / RUNS, p12: h12 / RUNS, p15: h15 / RUNS, runs: RUNS } };
  }

  /* ---------- «Сплав к дедлайну» ----------
     Линия «Расхождений» ∪ купон «Симуляции» на тот же бюджет. Лишнее сверх бюджета
     срезаем с наименее вероятных допов, недобор добиваем самыми выгодными исходами
     (как в «Отборе»: вероятность × недогруз толпы). Проверка на 854 тиражах (4135–5017):
     при 32 вариантах отдача 1,45 против 1,38 у одной «Симуляции», без 5 лучших тиражей
     1,21 против 1,15 — не хуже, но разница в пределах шума. */
  function blendOpenMs(){ return 120 * 60000; }   /* функция, а не var: renderKickoff зовёт нас раньше, чем var успевает присвоиться */
  function planBlend(budget){
    var g = gapSwaps();
    if(!g) return { error: "нет линии конторы или долей игроков хотя бы в одном матче" };
    var line = g.base.slice(), swapped = {};
    var sw = g.swaps.slice().sort(function(a, b){ return b.score - a.score; });
    for(var k = 0; k < sw.length; k++){
      if(sw[k].score >= SWAP_MIN && sw[k].loss <= LOSS_CAP){ line[sw[k].i] = sw[k].to; swapped[sw[k].i] = 1; }
      else break;
    }
    var sim = planBySim(budget), K = planByKelly();
    var kp = K && !K.error ? (K.best || K.cands[0]) : null;
    var kRows = kp ? kp.plan.rows : null;
    var rows = sim.rows.map(function(r, i){
      var votes = [0, 0, 0];
      var src = { gap: [line[i]], kel: kRows ? kRows[i].set.slice() : [], sim: r.set.slice() };
      [src.gap, src.kel, src.sim].forEach(function(st){ st.forEach(function(k){ votes[k]++; }); });
      var set = r.locked ? r.set.slice() : [0, 1, 2].filter(function(k){ return votes[k] > 0; });
      var strong = r.locked ? r.set.slice() : [0, 1, 2].filter(function(k){ return votes[k] >= 2; });
      if(!strong.length && set.length){   /* ни один исход не набрал двух голосов — оставляем самый вероятный из выбранных */
        strong = [set.reduce(function(x, y){ return r.p && r.p[y] > r.p[x] ? y : x; }, set[0])];
      }
      var why = r.locked ? "фикс, не трогаю" : !r.p ? "" :
        "Расхождения: " + OUT[line[i]] + (swapped[i] ? " (замена)" : "") +
        " · Симуляция: " + src.sim.map(function(k){ return OUT[k]; }).join("") +
        (kRows ? " · Келли: " + src.kel.map(function(k){ return OUT[k]; }).join("") : "") +
        (set.length > 1 ? " · голоса: " + set.map(function(k){ return OUT[k] + "×" + votes[k]; }).join(", ") : "");
      return { idx: r.idx, m: r.m, locked: r.locked, p: r.p, q: r.q, set: set, strong: strong, why: why };
    });
    var cnt = function(key){ var c = 1; rows.forEach(function(r){ c *= Math.max(1, r[key].length); }); return c; };
    var tails = function(key){
      return poissonBinomial(rows.map(function(r){
        if(r.m && r.m.fsVoid) return 1;
        if(!r.p) return r.locked ? 0.4 : 0;
        var S = 0; r[key].forEach(function(k){ S += r.p[k]; }); return Math.min(1, S);
      }));
    };
    var dAll = tails("set"), dStr = tails("strong");
    return { rows: rows, combos: cnt("set"), strongCombos: cnt("strong"),
             p9: evTail(dAll, 9), p12: evTail(dAll, 12), s9: evTail(dStr, 9),
             kelly: kp ? (K.best ? "Келли выбрал купон на " + fmt(kp.plan.combos) + " вариант(ов)" : "У Келли выгодного купона нет, взят наименее убыточный на " + fmt(kp.plan.combos) + " вариант(ов)")
                       : "Келли не посчитался: " + ((K && K.error) || "нет данных") + " — голосуют две стратегии" };
  }
  function blendState(){
    var dl = kickoffMs(), now = Date.now();
    if(document.body.classList.contains("is-prev")) return { on: false, t: "Сплав к дедлайну · только для текущего тиража" };
    if(!dl) return { on: false, t: "Сплав к дедлайну · нет времени закрытия" };
    var left = dl - now;
    if(left <= 0) return { on: false, t: "Сплав к дедлайну · приём закрыт" };
    var hm = function(ms){ var m = Math.ceil(ms / 60000), h = Math.floor(m / 60); return h ? h + " ч " + (m % 60) + " мин" : m + " мин"; };
    if(left > blendOpenMs()) return { on: false, t: "Сплав к дедлайну · через " + hm(left - blendOpenMs()) };
    return { on: true, t: "Сплав к дедлайну · до закрытия " + hm(left) };
  }
  function renderBlend(){
    var b = $("btnBlend"); if(!b) return;
    var st = blendState();
    b.disabled = !st.on;
    $("blendLbl").textContent = st.t;
  }
  function showBlend(){
    if(!blendState().on) return;
    var box = stratGuard("Сплав к дедлайну"); if(!box) return;
    box.innerHTML = '<p class="ev-note">Обновляю тираж — беру самые свежие доли игроков и линию…</p>';
    var done = function(){ renderBlendBox(); };
    try{
      var pr = pullTirazh(true);
      if(pr && pr.then) pr.then(done, done); else done();
    }catch(e){ done(); }
  }
  function renderBlendBox(){
    var box = stratGuard("Сплав к дедлайну"); if(!box) return;
    var budget = stratBudgetValue(), plan = planBlend(budget), price = Number(state.price) || 0;
    if(plan.error){ box.innerHTML = '<p class="ev-warn">' + escHtml(plan.error) + '</p>'; $("evBack").hidden = false; return; }
    var h = stratHow('Три стратегии — «Расхождения», «Симуляция» и «Келли» — собирают купон на свежих данных: «Симуляция» на выбранный бюджет, «Келли» сама выбирает размер под твой банк, «Расхождения» дают одну строку. ' +
      'Все их исходы складываются в один купон: где стратегии расходятся, получается двойник или тройник. У каждого исхода видно, сколько стратегий его выбрали. ' +
      'Дальше решаешь сам: ставишь всё или снимаешь в купоне лишнее до нужной суммы — первыми обычно снимают исходы с одним голосом.');
    h += stratBudget(budget).replace("Вариантов не больше", "Бюджет «Симуляции», вариантов");
    h += stratCards([["Все исходы", fmt(plan.combos) + " · " + fmt(plan.combos * price) + " ₽"],
                     ["Шанс 9+", stratChance(plan.p9)],
                     ["Только 2+ голоса", fmt(plan.strongCombos) + " · " + fmt(plan.strongCombos * price) + " ₽"]]);
    h += '<p class="ev-note">Данные на ' + escHtml(fmtStamp(new Date().toISOString(), true)) + ' МСК. «Только 2+ голоса» — исходы, которые выбрали хотя бы две стратегии из трёх; шанс 9+ у такого купона ' + stratChance(plan.s9) + '. ' + escHtml(plan.kelly) + '.</p>';
    h += stratTable(plan.rows);
    h += '<div class="ev-data-go blend-go"><button type="button" id="dataApply" class="btn-ev">Поставить все исходы</button>' +
         '<button type="button" id="blendStrong" class="btn-ev">Только 2+ голоса</button></div>' + STRAT_NOTE;
    stratFinish(box, h, plan, "Сплав к дедлайну", renderBlendBox);
    $("blendStrong").addEventListener("click", function(){
      stratApply({ rows: plan.rows.map(function(r){ return { idx: r.idx, m: r.m, locked: r.locked, p: r.p, set: r.strong }; }) }, "Сплав · 2+ голоса");
    });
  }

  /* ---------- «Келли»: какой купон сильнее всего растит банк ----------
     Кандидаты — купоны «По данным» и «Симуляции» на 1…512 вариантов.
     Для каждого: шанс хоть какого-то приза p (купон угадал 9+), средняя выплата
     при призе и цена купона как доля банка f. Рост банка за тираж —
     p·ln(1 + f·b) + (1 − p)·ln(1 − f), где b — чистый выигрыш на рубль при призе.
     Подставляется купон с наибольшим ростом; если у всех рост ≤ 0 — не ставить. */
  function planByKelly(){
    var price = Number(state.price) || 30;
    var poolNow = Number(state.poolSum) || 0, typical = Number(state.poolTypical) || 0;
    var fund = (typical && poolNow < typical * 0.6) ? typical : poolNow;
    var jack = Number(state.jackpot) || 0;
    var bank = Number(state.bankroll) || 10000;
    if(!fund) return { error: "не знаю размер призового фонда — нажми «Обновить тираж»" };
    var probs = [], pools = [], bad = null;
    state.matches.forEach(function(m){
      var pr = evProbs(m), pl = evPool(m);
      if(!pr || !pl) bad = bad || ("нет данных по матчу «" + m.home + " — " + m.away + "»");
      probs.push(pr); pools.push(pl);
    });
    if(bad) return { error: bad };
    if(probs.length !== 15) return { error: "в тираже не 15 матчей с данными" };
    var lines = (fund / 0.9) / price, cands = [];
    DATA_BUDGETS.forEach(function(B){
      [["Система", planByData(B)], ["Симуляция", planBySim(B)]].forEach(function(pair){
        var plan = pair[1];
        if(plan.rows.some(function(r){ return !r.set.length; })) return;
        var sets = plan.rows.map(function(r){ return r.set; });
        var key = sets.map(function(s){ return s.join(""); }).join("|");
        if(cands.some(function(c){ return c.key === key; })) return;
        var cost = plan.combos * price;
        var ev = evAverage(sets, probs, pools, lines, fund, jack, 400);
        var pWin = evTail(evCouponDist(sets, probs), 9);
        var W = ev.avg * plan.combos;                 /* средняя выплата купона */
        var f = cost / bank, b = pWin > 0 ? (W / pWin) / cost - 1 : -1;
        var g = (f < 1 && pWin > 0 && b > -1) ? pWin * Math.log(1 + f * b) + (1 - pWin) * Math.log(1 - f) : -Infinity;
        cands.push({ key: key, src: pair[0], plan: plan, cost: cost, pWin: pWin, ret: W / cost, g: g });
      });
    });
    cands.sort(function(a, b){ return b.g - a.g; });
    return { cands: cands, best: cands[0] && cands[0].g > 0 ? cands[0] : null, bank: bank };
  }

  /* ---------- общее окно стратегии ---------- */
  /* описание стратегии — свёрнуто, раскрывается по клику и не занимает место */
  function stratHow(html){
    return '<details class="ev-how"><summary>Как работает стратегия</summary><p>' + html + '</p></details>';
  }
  var STRAT_GUIDE = [
    ["Расхождения", "Ищет матчи, где доля игроков сильнее всего расходится с оценкой конторы, и ставит исходы, которые толпа недоигрывает. Выигрыш в тотализаторе делится между угадавшими, поэтому такие исходы выгоднее.<span class=\"ev-bt\">На истории (733 тиража, 4142–5024): замена отдаёт не больше 5 п.п. вероятности, в среднем 2,8 замены за тираж. Приз в 10,4% тиражей, 12+ — в 0,41%. Прежнее правило (до 15 п.п., 8,4 замены) давало 7,1% и 0,14%. У линии фаворитов без замен призов чаще (12,7%). По деньгам модель даёт замене отдачу 2,06 против 1,36, но это одна крупная выплата: интервал разницы от −0,27 до +2,11, то есть ноль внутри. Выигрыш неустойчив.</span>"],
    ["Отобрать строки", "Из большой системы оставляет строки, которые меньше всего совпадают с выбором толпы, — при угадывании делить приз придётся с меньшим числом соперников.<span class=\"ev-bt\">На истории не проверялась: работает поверх вашего купона.</span>"],
    ["Бриф", "Собирает систему с гарантией: вместо всех строк купона берётся их часть, которая всё равно гарантирует заданное число угаданных при попадании в отмеченные исходы.<span class=\"ev-bt\">На истории не проверялась: работает поверх вашего купона.</span>"],
    ["Охота на 15", "Цель — забрать 15 из 15. Вместо системы берутся самые вероятные отдельные строки: система вынуждена покупать и маловероятные сочетания. Вероятности — модель, обученная на истории (линия конторы, ничьи, молодёжные турниры); среди почти равных строк остаются менее популярные у игроков, чтобы не делить суперприз. До 400 строк — в корзину, больше — сразу в CSV.<span class=\"ev-bt\">На истории (618 тиражей, на 940 тиражах не пересчитывалось): при ~900 строках шанс 15 из 15 по модели — 0,085% против 0,073% у системы той же цены, при ~8 000 строк — 0,55% против 0,44%. На ~8 000 строк 15 из 15 забрали бы 4 раза, система — ни разу, но 4 события слишком мало для вывода, это не доказательство.</span>"],
    ["Симуляция", "Цель — чаще попадать в призы (9 и больше). Двойники и тройники ставятся там, где сильнее всего растёт шанс 9+, итог проверяется розыгрышем 10 000 тиражей.<span class=\"ev-bt\">На истории (733 тиража, купон до 32 вариантов, в среднем 809 ₽): приз в 40,1% тиражей, 12+ — в 2,46%, 13+ — в 0,55%.</span>"],
    ["Келли", "Цель — быстрее всего растить банк. Сравнивает системы по вероятностям и купоны «Симуляции» на 1–512 вариантов и подставляет тот, у которого ожидаемый рост банка больше. Если выгодного нет, честно говорит «не ставить» и предлагает наименее убыточный.<span class=\"ev-bt\">На истории (733 тиража): в среднем купон за 3 113 ₽, приз в 55,7% тиражей, 12+ — в 4,91%, 13+ — в 1,64%. Модель выплат считала выгодным каждый тираж из-за крупных суперпризов — к этому стоит относиться осторожно.</span>"]
  ];
  function showStratGuide(){
    $("evTitle").textContent = "Как работают стратегии";
    var h = '<dl class="ev-guide">';
    STRAT_GUIDE.forEach(function(g){ h += '<dt>' + g[0] + '</dt><dd>' + g[1] + '</dd>'; });
    h += '</dl><p class="ev-note">Каждая кнопка ставит исходы в купон; «Назад» откатывает последнюю расстановку. Проверка — по тиражам 4142–5024, вероятности поправлялись только по прошлым тиражам. Ни одна стратегия за это время не угадала 14 или 15. Реальных выплат в истории нет, поэтому сравниваются частоты призов, а не деньги. Модель выплат оптимистична: даже простая линия фаворитов получает в ней отдачу 1,36 (интервал 1,04–1,72), а стратегии отличаются от неё в пределах шума: у всех интервал разницы с фаворитами включает ноль. В деньги эти числа переводить нельзя. Это модели, а не гарантия выигрыша.</p>';
    $("evBody").innerHTML = h;
    $("evBack").hidden = false;
  }
  function stratCards(list){
    return '<div class="ev-sum ev-data-sum">' + list.map(function(c){
      return '<div class="ev-top"><span>' + c[0] + '</span><b>' + c[1] + '</b></div>';
    }).join("") + '</div>';
  }
  function stratChance(p){
    return p >= 0.001 ? (p * 100).toFixed(p >= 0.1 ? 1 : 2) + '%' : '1 к ' + fmt(Math.round(1 / Math.max(p, 1e-12)));
  }
  function stratBudget(budget){
    return '<div class="ev-data-bar"><label for="dataBudget">Вариантов не больше</label><select id="dataBudget">'
      + DATA_BUDGETS.map(function(b){ return '<option value="' + b + '"' + (b === budget ? ' selected' : '') + '>' + fmt(b) + '</option>'; }).join("")
      + '</select></div>';
  }
  function stratTable(rows){
    var h = '<table class="ev-tab ev-data-tab"><thead><tr><th>№</th><th>Матч</th><th>1 · X · 2</th><th>Выбор</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var pr = r.p ? r.p.map(function(x){ return Math.round(x * 100); }).join(" · ") : "—";
      var cr = r.q ? r.q.map(function(x){ return Math.round(x * 100); }).join(" · ") : "нет данных";
      var pick = r.set.length ? r.set.map(function(k){ return OUT[k]; }).join("") : "—";
      h += '<tr><td class="nw">' + (r.idx + 1) + '</td>'
        + '<td><div class="dt-m">' + escHtml(r.m.home) + ' — ' + escHtml(r.m.away) + '</div>'
        + '<div class="dt-why">' + escHtml(r.p ? r.why : "нет линии конторы, строку не трогаю") + '</div></td>'
        + '<td class="nw mono"><div>' + pr + '</div><div class="dt-why">толпа ' + cr + '</div></td>'
        + '<td class="nw"><span class="dt-pick' + (r.locked ? ' dt-lock' : '') + '">' + pick + '</span></td></tr>';
    });
    return h + '</tbody></table>';
  }
  function stratApply(plan, name){
    pushHistory("до стратегии «" + name + "»");
    var set = 0;
    plan.rows.forEach(function(r){
      if(r.locked || !r.p || !r.set.length) return;
      r.m.picks = {"1": false, "X": false, "2": false};
      r.set.forEach(function(k){ r.m.picks[OUT[k]] = true; });
      r.m.mode = "free"; set++;
    });
    save(); render();
    $("evBack").hidden = true;
    var t0 = tally();
    say("«" + name + "»: проставлено " + set + " матч(ей), " + fmt(t0.combos) + " вариант(ов) на "
        + fmt(t0.combos * (Number(state.price) || 0)) + " ₽. «Назад» откатит изменения.");
  }
  function stratGuard(title){
    $("evTitle").textContent = title;
    var box = $("evBody");
    if(!hist.ev.length){
      box.innerHTML = '<p class="ev-warn">История тиражей ещё не загрузилась — попробуй через минуту.</p>';
      $("evBack").hidden = false; return null;
    }
    if(!state.matches.some(function(m){ return m.pct && m.pct.bk; })){
      box.innerHTML = '<p class="ev-warn">В строках нет линии конторы — сначала нажми «Обновить тираж».</p>';
      $("evBack").hidden = false; return null;
    }
    return box;
  }
  function stratBudgetValue(){
    var b = Number(state.dataBudget) || 32;
    return DATA_BUDGETS.indexOf(b) < 0 ? 32 : b;
  }
  function stratFinish(box, h, plan, name, rerender){
    box.innerHTML = h;
    $("evBack").hidden = false;
    var sel = $("dataBudget");
    if(sel) sel.addEventListener("change", function(){ state.dataBudget = Number(this.value) || 32; save(); rerender(); });
    var go = $("dataApply");
    if(go && plan) go.addEventListener("click", function(){ stratApply(plan, name); });
  }
  var STRAT_NOTE = '<p class="ev-note">Строки с фиксом не меняются. «Назад» откатит купон к прежнему виду. Это модель, а не гарантия.</p>';

  /* ---------- «Охота на 15»: самые вероятные отдельные строки ----------
     Для шанса на 15 из 15 лучший купон из N вариантов — N самых вероятных полных
     комбинаций, а не система двойников/тройников: система вынуждена покупать и
     маловероятные сочетания. Проверка на 618 тиражах: при ~900 строках шанс
     выше на 15%, при ~8 000 — на 25% (4 попадания 15 из 15 против 0 у системы).
     Вероятности — модель, обученная на истории: линия конторы, ничьи, молодёжь. */
  var HUNT_SIZES = [32, 100, 400, 1000, 10000];
  var HUNT_W = { bk: 1.085, crowd: 0.036, draw: 0.088, drawYouth: 0.146, drawWomen: -0.047, home: 0.011 };
  function huntProbs(m){
    if(!(m.pct && m.pct.bk)) return null;
    var bk = m.pct.bk.map(Number), s = bk[0] + bk[1] + bk[2];
    if(!(s > 0) || bk.some(function(x){ return !(x > 0); })) return null;
    var q = crowdShare(m.pct.pool);
    var name = (m.home || "") + " " + (m.away || "");
    var youth = /\((?:19|20|21)\)/.test(name) || /^До |\bДо \d+/.test(m.league || "");
    var women = /\(ж\)/.test(name);
    var z = [];
    for(var k = 0; k < 3; k++){
      var lb = Math.log(bk[k] / s);
      var v = HUNT_W.bk * lb + (q ? HUNT_W.crowd * (Math.log(q[k]) - lb) : 0);
      if(k === 1) v += HUNT_W.draw + (youth ? HUNT_W.drawYouth : 0) + (women ? HUNT_W.drawWomen : 0);
      if(k === 0) v += HUNT_W.home;
      z.push(v);
    }
    var mx = Math.max(z[0], z[1], z[2]), e = z.map(function(v){ return Math.exp(v - mx); }), t = e[0] + e[1] + e[2];
    return e.map(function(v){ return v / t; });
  }
  /* лучшие N строк: перебор «от лучшей» по куче, каждый шаг — сдвиг одного матча на следующий исход */
  function huntTop(P, N){
    var n = P.length, order = [], lp = [];
    for(var i = 0; i < n; i++){
      var o = [0, 1, 2].sort(function(a, b){ return P[i][b] - P[i][a]; });
      order.push(o); lp.push(o.map(function(k){ return Math.log(Math.max(P[i][k], 1e-9)); }));
    }
    var heap = [], seen = {}, out = [];
    function push(x){ heap.push(x); var c = heap.length - 1;
      while(c > 0){ var p = (c - 1) >> 1; if(heap[p].s >= heap[c].s) break; var t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } }
    function pop(){ var top = heap[0], last = heap.pop();
      if(heap.length){ heap[0] = last; var c = 0;
        for(;;){ var l = 2 * c + 1, r = l + 1, m = c;
          if(l < heap.length && heap[l].s > heap[m].s) m = l;
          if(r < heap.length && heap[r].s > heap[m].s) m = r;
          if(m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } }
      return top; }
    var start = [], s0 = 0;
    for(i = 0; i < n; i++){ start.push(0); s0 += lp[i][0]; }
    push({ s: s0, idx: start }); seen[start.join("")] = 1;
    while(heap.length && out.length < N){
      var cur = pop();
      out.push({ lp: cur.s, line: cur.idx.map(function(r, j){ return order[j][r]; }) });
      for(i = 0; i < n; i++){
        if(cur.idx[i] >= 2) continue;
        var nx = cur.idx.slice(); nx[i]++;
        var key = nx.join("");
        if(seen[key]) continue;
        seen[key] = 1;
        push({ s: cur.s - lp[i][cur.idx[i]] + lp[i][nx[i]], idx: nx });
      }
    }
    return out;
  }
  /* жадно набирает исходы в таблицу: каждый шаг — исход, который сильнее всего поднимает шанс на единицу роста числа вариантов;
     останавливается, когда число вариантов (произведение) дошло бы до больше N */
  function huntSystem(P, N){
    var n = P.length, order = [], set = [], sum = [], size = 1;
    for(var i = 0; i < n; i++){
      var o = [0, 1, 2].sort(function(a, b){ return P[i][b] - P[i][a]; });
      order.push(o); set.push([o[0]]); sum.push(Math.max(P[i][o[0]], 1e-9));
    }
    for(;;){
      var bi = -1, bg = -1;
      for(i = 0; i < n; i++){
        var len = set[i].length; if(len >= 3) continue;
        if(size / len * (len + 1) > N) continue;
        var k = order[i][len], g = Math.log((sum[i] + P[i][k]) / sum[i]) / Math.log((len + 1) / len);
        if(g > bg){ bg = g; bi = i; }
      }
      if(bi < 0) break;
      var l2 = set[bi].length, k2 = order[bi][l2];
      size = size / l2 * (l2 + 1); sum[bi] += P[bi][k2]; set[bi].push(k2);
    }
    var p = 1; for(i = 0; i < n; i++) p *= sum[i];
    return { set: set, size: Math.round(size), p: p };
  }
  function planHunt(N){
    var P = [], Q = [], bad = null;
    state.matches.forEach(function(m){
      var p = huntProbs(m);
      if(!p) bad = bad || ("нет линии конторы в матче «" + m.home + " — " + m.away + "»");
      P.push(p); Q.push(evPool(m));
    });
    if(bad) return { error: bad };
    /* берём с запасом 20% и среди почти равных строк оставляем менее людные —
       при 15 из 15 делить суперприз придётся с меньшим числом игроков */
    var cand = huntTop(P, Math.ceil(N * 1.2));
    cand.forEach(function(c){
      var crowd = 0;
      c.line.forEach(function(k, i){ crowd += Math.log(Q[i] ? Math.max(Q[i][k], 1e-4) : 1 / 3); });
      c.key = c.lp - 0.05 * crowd;
      c.crowd = crowd;
    });
    cand.sort(function(a, b){ return b.key - a.key; });
    var lines = cand.slice(0, N);
    var p15 = 0, share = [];
    lines.forEach(function(c){ p15 += Math.exp(c.lp); });
    for(var i = 0; i < 15; i++) share.push([0, 0, 0]);
    lines.forEach(function(c){ c.line.forEach(function(k, i){ share[i][k]++; }); });
    /* таблица: самые вероятные исходы, которых хватает на N вариантов (произведение исходов по матчам не больше N) —
       она же служит для сравнения: система двойников и тройников той же цены */
    var tab = huntSystem(P, N);
    return { P: P, lines: lines, p15: p15, share: share, sysP: tab.p, sysCombos: tab.size, tab: tab };
  }
  /* проставить в таблицу самые вероятные исходы на N вариантов (tab.set — исходы по матчам) */
  function huntToTable(tab){
    pushHistory("до «Охоты на 15»");
    state.matches.forEach(function(m, i){
      var pk = {"1": false, "X": false, "2": false};
      tab.set[i].forEach(function(k){ pk[OUT[k]] = true; });
      m.picks = pk; m.mode = "free";
    });
    save(); render();
    return tally().combos;
  }
  function huntCommit(lines, price){
    var stamp = new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
    var seen = {}, add = [], dup = 0;
    state.played.forEach(function(v){ if(v.sig) seen[v.sig] = true; });
    lines.forEach(function(c, n){
      var sig = c.line.map(function(k){ return OUT[k]; }).join(" ");
      if(seen[sig]){ dup++; return; }
      seen[sig] = true;
      /* без копии купона (snap): 10 000 строк иначе не поместились бы в память браузера */
      add.push({ at: stamp, label: "охота " + (n + 1) + "/" + lines.length, sig: sig, combos: 1, cost: price });
    });
    state.rolls += add.length; state.spent += add.length * price;
    state.played = add.reverse().concat(state.played);      /* порядок тот же, что у прежних одиночных добавлений: последняя строка сверху */
    if(state.played.length > BASKET_MAX) state.played.length = BASKET_MAX;
    save(); render();
    $("evBack").hidden = true;
    return { added: add.length, dup: dup };
  }
  function showHunt(){
    var box = stratGuard("Стратегия «Охота на 15»"); if(!box) return;
    var N = Number(state.huntSize) || 100;
    if(HUNT_SIZES.indexOf(N) < 0) N = 100;
    var plan = planHunt(N);
    if(plan.error){
      box.innerHTML = '<p class="ev-warn">Посчитать не получилось: ' + plan.error + '.</p>';
      $("evBack").hidden = false; return;
    }
    var price = briefPrice(), cost = plan.lines.length * price;
    var h = stratHow('Цель — забрать 15 из 15. Вместо системы двойников и тройников берутся самые вероятные отдельные строки: система вынуждена покупать и маловероятные сочетания, а здесь каждый рубль идёт на самые вероятные комбинации. Вероятности — модель, обученная на истории тиражей (линия конторы, ничьи, молодёжные турниры). Среди почти равных строк остаются менее популярные у игроков: при попадании суперприз делится на меньшее число людей. Строки уходят в корзину (до 400) или сразу в CSV.');
    h += '<div class="ev-data-bar"><label for="huntSize">Строк</label><select id="huntSize">'
      + HUNT_SIZES.map(function(b){ return '<option value="' + b + '"' + (b === N ? ' selected' : '') + '>' + fmt(b) + '</option>'; }).join("")
      + '</select></div>';
    var gain = plan.sysP > 0 ? plan.p15 / plan.sysP : 0;
    h += stratCards([["Цена купона", fmt(cost) + " ₽"], ["Шанс 15 из 15", stratChance(plan.p15)],
      ["Система в таблице", plan.sysP > 0 ? stratChance(plan.sysP) : "—"]]);
    if(gain > 0) h += '<p class="ev-sub dt-center">Строки дают в ' + gain.toFixed(2).replace(".", ",") + ' раза больше шанса, чем система двойников и тройников на ' + fmt(plan.sysCombos) + ' вариантов.</p>';
    h += '<table class="ev-tab ev-data-tab"><thead><tr><th>№</th><th>Матч</th><th class="dt-pr">1 · X · 2</th><th>В строках</th></tr></thead><tbody>';
    state.matches.forEach(function(m, i){
      var pr = plan.P[i].map(function(x){ return Math.round(x * 100); }).join(" · ");
      var sh = plan.share[i], tot = plan.lines.length, parts = [];
      for(var k = 0; k < 3; k++) if(sh[k]) parts.push(OUT[k] + (sh[k] === tot ? "" : " " + Math.round(sh[k] / tot * 100) + "%"));
      h += '<tr><td class="nw">' + (i + 1) + '</td><td><div class="dt-m">' + escHtml(m.home) + ' — ' + escHtml(m.away) + '</div></td>'
        + '<td class="nw mono dt-pr">' + pr + '</td><td class="dt-share"><span class="dt-pick">' + parts.join(" · ") + '</span></td></tr>';
    });
    h += '</tbody></table>';
    var canBasket = plan.lines.length <= BASKET_MAX;
    h += '<div class="ev-data-go ev-data-go2">'
      + '<button type="button" id="huntBasket" class="btn-ev"' + (canBasket ? '' : ' disabled title="В корзину помещается до ' + fmt(BASKET_MAX) + ' строк — используй CSV"') + '>В корзину</button>'
      + '<button type="button" id="huntCsv" class="btn-ev">Скачать CSV</button></div>';
    if(!canBasket) h += '<p class="ev-note dt-center">Больше ' + fmt(BASKET_MAX) + ' строк корзина не вмещает — такой купон выгружается сразу в CSV.</p>';
    h += '<p class="ev-note">Выигрыш не гарантирован: даже 10 000 строк дают около полупроцента шанса. Контора оценивает матчи точно, поэтому шанс растёт в основном с числом строк.</p>';
    box.innerHTML = h;
    $("evBack").hidden = false;
    $("huntSize").addEventListener("change", function(){ state.huntSize = Number(this.value) || 100; save(); showHunt(); });
    var hb = $("huntBasket");
    function tableNote(sys){
      return " В таблице самые вероятные исходы на " + fmt(sys) + " вар. (" + fmt(sys * price) + " ₽), а строки охоты — отдельно; «Записать» не нажимай.";
    }
    if(hb && canBasket) hb.addEventListener("click", function(){
      if(state.played.length + plan.lines.length > BASKET_MAX){
        say("В корзине уже " + fmt(state.played.length) + " вариантов, вместе с " + fmt(plan.lines.length) + " строками охоты выйдет больше " + fmt(BASKET_MAX) + ". Очисти корзину или скачай CSV.");
        return;
      }
      var sys = huntToTable(plan.tab);
      var r = huntCommit(plan.lines, price);
      say("«Охота на 15»: в корзину " + fmt(r.added) + " строк на " + fmt(r.added * price) + " ₽"
        + (r.dup ? ", повторов пропущено: " + fmt(r.dup) : "") + "." + tableNote(sys));
    });
    $("huntCsv").addEventListener("click", function(){
      saveCsvFile(briefCsv(plan.lines.map(function(c){ return c.line; })),
        "ohota15_" + (state.tirazh || "tirazh") + "_" + plan.lines.length + ".csv");
      var sys = huntToTable(plan.tab);
      $("evBack").hidden = true;
      say("«Охота на 15»: " + fmt(plan.lines.length) + " строк на " + fmt(plan.lines.length * price) + " ₽ — в CSV." + tableNote(sys));
    });
  }
  function showSim(){
    var box = stratGuard("Стратегия «Симуляция»"); if(!box) return;
    var budget = stratBudgetValue(), plan = planBySim(budget), price = Number(state.price) || 0;
    var h = stratHow('Цель — чаще попадать в призы (9 и больше угаданных). Двойники и тройники ставятся там, где сильнее всего поднимают этот шанс; итог проверен розыгрышем '
      + fmt(plan.sim.runs) + ' тиражей.');
    h += stratBudget(budget);
    h += stratCards([["Вариантов", fmt(plan.combos) + " · " + fmt(plan.combos * price) + " ₽"], ["Шанс 9+", stratChance(plan.sim.p9)], ["Шанс 12+", stratChance(plan.sim.p12)]]);
    h += stratTable(plan.rows);
    h += '<div class="ev-data-go"><button type="button" id="dataApply" class="btn-ev">Подставить в купон</button></div>' + STRAT_NOTE;
    stratFinish(box, h, plan, "Симуляция", showSim);
  }
  function showKellyStrat(){
    var box = stratGuard("Стратегия «Келли»"); if(!box) return;
    var K = planByKelly();
    if(K.error){
      box.innerHTML = '<p class="ev-warn">Посчитать не получилось: ' + K.error + '.</p>';
      $("evBack").hidden = false; return;
    }
    var h = stratHow('Цель — быстрее всего растить банк. Сравниваются системы по вероятностям и купоны «Симуляции» на 1–512 вариантов; подставляется тот, у которого ожидаемый рост банка за тираж больше. Если у всех он отрицательный — ставить не стоит.');
    h += '<div class="ev-data-bar"><label for="kellyBank">Размер банка, ₽</label><input type="number" id="kellyBank" value="' + K.bank + '" min="100" step="100"></div>';
    var b = K.best;
    if(b){
      h += stratCards([["Купон", fmt(b.plan.combos) + " · " + fmt(b.cost) + " ₽"], ["Шанс приза", stratChance(b.pWin)], ["Рост банка", (b.g >= 0 ? "+" : "") + (b.g * 100).toFixed(2) + "%"]]);
    }
    h += '<table class="ev-tab ev-data-cands"><thead><tr><th>Купон</th><th>Цена</th><th>Приз</th><th>Отдача</th><th>Рост</th></tr></thead><tbody>';
    K.cands.slice(0, 6).forEach(function(c, i){
      h += '<tr' + (i === 0 ? ' class="dt-best"' : '') + '><td>' + c.src + ', ' + fmt(c.plan.combos) + '</td><td>' + fmt(c.cost) + ' ₽</td><td>' + stratChance(c.pWin)
        + '</td><td>' + c.ret.toFixed(2) + '</td><td class="' + (c.g > 0 ? "ev-good" : "ev-bad") + '">' + (isFinite(c.g) ? (c.g * 100).toFixed(2) + '%' : '—') + '</td></tr>';
    });
    h += '</tbody></table><p class="ev-note">«Отдача» — средняя выплата на рубль цены купона; меньше 1 — в среднем в минус.</p>';
    /* выгодного нет — всё равно даём подставить наименее убыточный купон */
    var pick = b || K.cands[0];
    if(pick){
      if(!b) h += '<p class="ev-sub">Наименьшие потери у купона «' + pick.src + ', ' + fmt(pick.plan.combos) + '»:</p>';
      h += stratTable(pick.plan.rows);
      h += '<div class="ev-data-go"><button type="button" id="dataApply" class="btn-ev">'
        + (b ? 'Подставить в купон' : 'Подставить наименее убыточный') + '</button></div>' + STRAT_NOTE;
    }
    stratFinish(box, h, pick ? pick.plan : null, "Келли", showKellyStrat);
    var kb = $("kellyBank");
    if(kb) kb.addEventListener("change", function(){
      var v = Number(kb.value); if(!isFinite(v) || v < 100) return;
      state.bankroll = v; save(); showKellyStrat();
    });
  }
  $("btnData").addEventListener("click", showHunt);
  $("stratHelp").addEventListener("click", function(e){ e.preventDefault(); showStratGuide(); });
  $("btnSim").addEventListener("click", showSim);
  $("btnKelly").addEventListener("click", showKellyStrat);
  $("btnStat").addEventListener("click", function(){ showAcc(); });
  setTimeout(checkFsVoids, 4000);
  loadAi().then(aiBtnsUpdate);
  setInterval(function(){ loadAi().then(aiBtnsUpdate); }, 30 * 60000);
  setInterval(checkFsVoids, 10 * 60000);
  loadTeamDb();
  setInterval(loadTeamDb, 3600000);

  /* мост для visual.js (обложка, карта тиража, билеты): только чтение + перерисовка */
  window.DZ = {
    get: function(){
      var P = state.viewPrev && state.prev ? state.prev : null;
      if(P) return { matches: P.matches, tirazh: P.tirazh, prev: true, deadline: P.deadline || "",
               jackpot: Number(P.jack) || Number(((state.drawByNo || {})[P.tirazh] || {}).jack) || 0,
               kickoff: 0, played: state.played, price: Number(state.price) || 30, viewPrev: true, book: !!book };
      return { matches: state.matches, tirazh: state.tirazh, jackpot: Number(state.jackpot) || 0,
               kickoff: kickoffMs(), played: state.played, price: Number(state.price) || 30,
               viewPrev: !!state.viewPrev, book: !!book };
    },
    team: teamInfo, emb: mkEmb, embSrc: embSrc, fmt: fmt,
    nat: function(name, league){ return !!(isNatLeague(league) || (continentCode(league).hit && teamCode(name))); }, render: function(){ render(); }
  };
  var renderBase = render;
  render = function(){
    renderBase.apply(this, arguments);
    try{ document.dispatchEvent(new CustomEvent("dz:render")); }catch(e){}
  };
  try{ document.dispatchEvent(new CustomEvent("dz:render")); }catch(e){}

  /* ====================================================================
     конец новой аналитики
     ==================================================================== */
})();
