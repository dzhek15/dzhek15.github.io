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
  if(!Array.isArray(state.played)) state.played = [];
  state.showPct = !!state.showPct;
  state.showKf  = !!state.showKf;
  /* один шаг назад: предыдущий тираж хранится целиком для просмотра, купон он не трогает */
  if(!state.prev || !Array.isArray(state.prev.matches) || !state.prev.matches.length) state.prev = null;
  state.viewPrev = !!(state.viewPrev && state.prev);
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
  }

  var $ = function(id){ return document.getElementById(id); };

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
    } else { fw.hidden = true; }

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
        " от фонда" + (rTyp > 0 ? ", обычно " + rTyp.toFixed(2).replace(".", ",") : "") +
        ' · <i class="tk-why">что это значит</i>';
    } else { vw.hidden = true; }

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

  function pushHistory(label, keepMeta){
    state.history.unshift({
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
    });
    if(state.history.length>14) state.history.length=14;
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
    var ballSize = 0; walk(0, 0, 0, function(){ ballSize++; });
    /* со взвешиванием стартовые оценки неизвестны — ставим заведомо большие и
       устаревшие (штамп −1), CELF пересчитает их при первом же взятии */
    for(var x = 0; x < U; x++){ if(gw) push(1e9, x, -1); else push(ballSize, x, 0); }

    var gen = 0, t0 = Date.now(), cnt = 0;
    var counter = gw ? function(y){ if(!covered[y]) cnt += gw[y]; } : function(y){ if(!covered[y]) cnt++; };
    var marker = function(y){ if(!covered[y]){ covered[y] = 1; left--; } };
    while(left > 0){
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
    if(state.played.length > 400) state.played.length = 400;
    save(); render();
    $("evBack").hidden = true;
    say("Положено в корзину: " + fmt(added) + " строк(и) на " + fmt(added * price) + " ₽" +
        (dup ? ", пропущено повторов: " + fmt(dup) : "") +
        ". Они уйдут в CSV наравне с брошенными вариантами; убрать лишние можно корзиной в списке, откатить всё — кнопкой «Вернуть».");
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
  var FS_NONFOOTBALL = /КХЛ|НХЛ|ВХЛ|МХЛ|хокке/i;
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
  function fsClean(name){ return String(name || "").replace(/\s*\((?:ж|б|мол)\)\s*$/i, "").trim(); }
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
  function fsWordSimilar(a, b){
    if(a === b) return true;
    if(a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    return fsDist(a, b) <= Math.ceil(Math.max(a.length, b.length) * 0.3);
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
        cur.matches.push({ id: obj.AA, home: obj.AE, away: obj.AF, hSlug: obj.WU, aSlug: obj.WV, hId: obj.PX, aId: obj.PY, ts: obj.AD || obj.ADE || null, st: obj.AB || "", sc: obj.AC || "" });
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
    FS_DAY_CACHE[key] = fetch(url)
      .then(function(r){ return r.ok ? r.text() : null; })
      .then(fsParseFeed)
      .catch(function(){ return []; });
    return FS_DAY_CACHE[key];
  }
  /* дневной фид хранит команду часто под коротким «фирменным» именем без города-уточнения
     («Торпедо Нижний Новгород» в тираже — просто «Торпедо» на Flashscore), поэтому сверяем
     обе стороны: и что все слова запроса нашлись у кандидата, и наоборот — что все слова
     (более короткого) кандидата нашлись в запросе */
  function fsNameOk(queryClean, queryCore, candidateName){
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
          return { h: { url: mm.hSlug, id: mm.hId }, a: { url: mm.aSlug, id: mm.aId }, mid: mm.id, ts: mm.ts, st: mm.st, sc: mm.sc };
        if(fsNameOk(hClean, hCore, mm.away) && fsNameOk(aClean, aCore, mm.home))
          return { h: { url: mm.aSlug, id: mm.aId }, a: { url: mm.hSlug, id: mm.hId }, mid: mm.id, ts: mm.ts, st: mm.st, sc: mm.sc };
      }
    }
    return null;
  }

  function fsLookup(m, all){
    var isWomen = fsIsWomen(m.home) || fsIsWomen(m.away);
    var country = fsCountry(m.league);
    var found = null;
    if(country){
      found = fsFindMatch(all.filter(function(g){ return g.country === country; }), m.home, m.away, isWomen);
    }
    if(!found) found = fsFindMatch(all, m.home, m.away, isWomen);
    return found;
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
        var found = null;
        /* сначала — только турнир нужной страны (если она известна и не континент), это
           страхует от тёзок в других странах; не нашли — ищем по всем группам */
        if(country){
          found = fsFindMatch(all.filter(function(g){ return g.country === country; }), m.home, m.away, isWomen);
        }
        if(!found) found = fsFindMatch(all, m.home, m.away, isWomen);
        if(found) go("https://www.flashscore.ru/match/" + sportKey + "/" + found.h.url + "-" + found.h.id + "/" + found.a.url + "-" + found.a.id + "/?mid=" + found.mid);
        else go(fallback);
      })
      .catch(function(){ go(fallback); });
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
  function loadAi(){
    if(ai.data && Date.now() - ai.at < 30 * 60000) return Promise.resolve(ai.data);
    if(ai.loading) return ai.loading;
    if(typeof fetch !== "function") return Promise.resolve(null);
    ai.loading = fetch(MIRROR + "ai.json?t=" + Math.floor(Date.now() / 1800000))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ ai.data = j; ai.at = Date.now(); ai.loading = null; return j; })
      .catch(function(){ ai.loading = null; return null; });
    return ai.loading;
  }
  function aiFor(j, idx){
    return (j && String(j.number) === String(state.tirazh) && j.m && j.m[idx]) || null;
  }
  function aiHtml(r, full){
    var src = (r.s || []).map(function(x){
      return '<a target="_blank" rel="noopener noreferrer" href="' + escHtml(x.u) + '">' + escHtml(x.n) + '</a>';
    }).join(" · ");
    return '<p class="ai-txt">' + escHtml(r.t) + '</p>' +
      (src ? '<p class="ai-src">Источники: ' + src + '</p>' : '') +
      (full ? '<p class="ev-note">Разбор написан ИИ по открытым источникам' +
        (ai.data && ai.data.at ? ' (' + new Date(ai.data.at).toLocaleString("ru-RU", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Moscow"}) + ' МСК)' : '') +
        '. Это мнение, а не гарантия; составы за час до игры могут всё поменять.</p>' : '');
  }
  /* вариант ИИ: строка исходов «1», «1X», «12»… на каждый матч */
  /* сравнение со стратегиями сайта: Расхождения, Симуляция, Келли — считаем здесь же, кэш на минуту */
  var aiCmp = { at: 0, key: "", v: null };
  function aiStrats(){
    var key = state.tirazh + "|" + state.price + "|" + state.bankroll + "|" + stratBudgetValue();
    if(aiCmp.v && aiCmp.key === key && Date.now() - aiCmp.at < 60000) return aiCmp.v;
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
    aiCmp = { at: Date.now(), key: key, v: v };
    return v;
  }
  var AI_SN = [["gap", "Расхождения"], ["sim", "Симуляция"], ["kel", "Келли"]];
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
        ". В купоне " + fmt(t0.combos) + " вариант(ов) на " + fmt(t0.combos * (Number(state.price) || 0)) + " ₽. «Вернуть» откатит.");
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
  function showAi(m, idx){
    $("evTitle").textContent = "Разбор ИИ · " + m.home + " — " + m.away;
    $("evBody").innerHTML = '<div id="aiBox"><p class="ev-note">Загружаю…</p></div>' +
      '<div class="blend-go" id="aiGo"><button type="button" class="btn-ev" id="aiNews">Новости и составы</button></div>';
    $("evBack").hidden = false;
    $("aiNews").addEventListener("click", function(){ showNews(m, idx, false); });
    loadAi().then(function(j){
      var el = $("aiBox"); if(!el) return;
      var r = aiFor(j, idx);
      if(!r){
        el.innerHTML = '<p class="ev-warn">Разбора для этого тиража пока нет: его пишут один раз, вскоре после открытия тиража. Загляни позже или открой новости.</p>';
        return;
      }
      var all = aiPlan(j);
      el.innerHTML = aiPickLine(r, idx) + aiHtml(r, true) + aiKellySummary(j);
      if(r.p){
        var go = $("aiGo");
        go.insertAdjacentHTML("afterbegin",
          '<button type="button" class="btn-ev" id="aiOne">Поставить ' + escHtml(r.p) + ' в матч</button>' +
          (all ? '<button type="button" class="btn-ev" id="aiAll">Весь купон ИИ · ' + fmt(all.combos) + ' вар.</button>' : ''));
        $("aiOne").addEventListener("click", function(){ aiApply(j, [idx]); });
        if(all) $("aiAll").addEventListener("click", function(){ aiApply(j, null); });
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
    if(!prev) loadAi().then(function(j){
      var el = $("nwAi"), r = aiFor(j, idx); if(!el || !r) return;
      el.innerHTML = '<h3 class="th-h2 nw-h">Разбор ИИ</h3>' + (r.p ? aiPickLine(r, idx) : '') + aiHtml(r, false);
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
    ensureShape();
    syncTirNav();
    if(state.viewPrev && state.prev){ renderPrevView(); return; }
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
      if(hc) teams.appendChild(mkFlag(hc, "tflag", m.home));
      teams.appendChild(mkTeam(m.home, m.away));
      var vs = document.createElement("span"); vs.className="vs"; vs.textContent="—";
      teams.appendChild(vs);
      if(ac) teams.appendChild(mkFlag(ac, "tflag", m.away));
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
        sc.textContent = m.score ? String(m.score).replace(/\s+/g, "") : "";
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
          /* правило форума 1x2.su: больше 30% пула на ничью в футболе — исход переоценён */
          var xOver = (i === 1 && pl > 30);
          var col = document.createElement("div");
          col.className = "pct-col" + (isTop ? " lead" : (isLow ? " rare" : "")) + (xOver ? " x-over" : "");
          col.title = "Игроки " + pl + "%" + (bk === null ? "" : " · контора " + bk + "%") +
            (isTop ? " — больше всего игроков в этом матче, приз делить со многими"
             : isLow ? " — меньше всего игроков в этом матче" : "") +
            (xOver ? ". На ничью ушло больше 30% пула — по правилу форума такой исход переоценён" : "");
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
    $("btnUndo").disabled = state.history.length === 0 || spinning;
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
    if(plan.take.length){
      en.textContent = "В файл уйдут отмеченные варианты из корзины: " + plan.take.length +
        " шт., " + fmt(plan.total) + " строк, " + fmt(plan.total * price) + " ₽." +
        (plan.off ? " Без галочки и мимо файла: " + plan.off + "." : "") +
        (plan.skipped ? " Пропущено записей от другого списка матчей: " + plan.skipped + "." : "");
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
    pb.hidden = !havePct;
    pb.setAttribute("aria-pressed", state.showPct ? "true" : "false");
    pb.textContent = state.showPct ? "Скрыть проценты" : "Показать проценты";
    pb.title = state.showPct
      ? "Убрать доли игроков и конторы из строк"
      : "Показать под каждым исходом долю игроков и оценку конторы";
    var haveKf = state.matches.some(function(m){ return m.kf; });
    var kb = $("btnKf");
    kb.hidden = !haveKf;
    kb.setAttribute("aria-pressed", state.showKf ? "true" : "false");
    kb.textContent = state.showKf ? "Скрыть кэфы" : "Показать кэфы";
    kb.title = state.showKf
      ? "Убрать коэффициенты конторы из строк"
      : "Показать под каждым исходом коэффициент конторы из того же тиража";
    $("pctLegend").hidden = !((havePct && state.showPct) || (haveKf && state.showKf));
    /* ручка влияет только на стрелки, а стрелки живут вместе с процентами —
       прячем её, пока проценты выключены, иначе выглядит как неработающая */
    renderKickoff();
    renderHistory();
  }

  var histArmed = -1, histTimer = null;
  var clearArmed = 0, clearTimer = null;
  function renderHistory(){
    var ul = $("hist"); ul.innerHTML = "";
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
        " · " + fmt(rows) + " строк · " + fmt(sum) + " ₽"
      : "";
    var sa = $("btnSelAll");
    sa.disabled = state.played.length === 0;
    (sa.querySelector(".lbl") || sa).textContent = (on === state.played.length && on > 0) ? "Снять все" : "Отметить все";
    var cb = $("btnClearHist");
    cb.disabled = state.played.length === 0;
    if(cb.disabled && cb.classList.contains("danger")){
      clearArmed = 0; clearTimeout(clearTimer);
      (cb.querySelector(".lbl") || cb).textContent = "Очистить корзину"; cb.classList.remove("danger");
    }
    state.played.forEach(function(h, i){
      var li = document.createElement("li");
      if(h.sel === false) li.classList.add("is-off");

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
      if(i === histArmed){
        del.classList.add("danger");
        del.innerHTML = "Удалить?";
      }
      del.addEventListener("click", function(){
        clearTimeout(histTimer);
        if(histArmed !== i){
          histArmed = i;
          renderHistory();
          histTimer = setTimeout(function(){
            if(histArmed !== -1){ histArmed = -1; renderHistory(); }
          }, 4000);
          return;
        }
        histArmed = -1;
        state.played.splice(i, 1);
        save(); render();
      });

      acts.appendChild(b); acts.appendChild(del);
      left.style.flex = "1 1 auto"; left.style.minWidth = "0";
      li.appendChild(left); li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  function restore(h){
    pushHistory("до возврата");
    state.matches.forEach(function(m, i){
      var s = h.snap[i];
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
     чтобы «Вернуть» поднял его, если страницу перезагрузили случайно. */
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
    if(state.played.length > 400) state.played.length = 400;
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

  function say(msg){
    hintSticky = true;
    var h = $("hint");
    h.hidden = false;
    h.textContent = msg;
    h.scrollIntoView({block:"nearest"});
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
    $("btnSpin").disabled = true; $("btnUndo").disabled = true;
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

  $("btnUndo").addEventListener("click", function(){
    var h = state.history.shift();
    if(!h) return;
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
    save(); render();
  });

  function disarmClear(){
    var b = $("btnClearHist");
    clearArmed = 0;
    clearTimeout(clearTimer);
    (b.querySelector(".lbl") || b).textContent = "Очистить корзину";
    b.classList.remove("danger");
  }

  $("btnSelAll").addEventListener("click", function(){
    if(!state.played.length) return;
    var allOn = state.played.every(function(v){ return v.sel !== false; });
    state.played.forEach(function(v){ v.sel = !allOn; });
    save(); render();
    say(allOn ? "Галочки сняты со всех вариантов — в CSV сейчас не уйдёт ни один."
              : "Отмечены все варианты в корзине — в CSV уйдут все.");
  });

  $("btnClearHist").addEventListener("click", function(){
    var b = $("btnClearHist");
    if(!state.played.length){ disarmClear(); return; }
    if(!clearArmed){
      clearArmed = 1;
      (b.querySelector(".lbl") || b).textContent = "Точно очистить?";
      b.classList.add("danger");
      clearTimer = setTimeout(disarmClear, 4000);
      return;
    }
    disarmClear();
    var n = state.played.length;
    state.played = [];
    histArmed = -1;
    save(); render();
    say("Корзина очищена: убрано " + n + " шт. Купон и счётчики не тронуты.");
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
        ". Отменить — «Вернуть».");
  });
  $("btnReset").addEventListener("click", function(){
    pushHistory("очистка");
    state.matches.forEach(function(m){ if(m.mode!=="lock") m.picks={"1":false,"X":false,"2":false}; });
    save(); render();
  });

  $("tirazhName").addEventListener("input", function(e){ state.tirazh = e.target.value; save(); });
  $("btnTirPrev").addEventListener("click", enterPrev);
  $("btnTirNext").addEventListener("click", leavePrev);
  $("tirazhName").value = state.tirazh || "";
  /* ---------- Окно «Расхождения с толпой» ----------
     Считаем, насколько доли игроков расходятся с оценкой конторы. Мера — сумма
     (доля_конторы − доля_игроков)² / доля_игроков по трём исходам: это тот же
     критерий, что на форуме 1x2.su описан как «сумма отношений против тройки»,
     только без бесполезного порога. Чем больше, тем сильнее толпа ошибается. */
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

  /* Пороги проверены ровно этим правилом на архиве из 2856 матчей 192 тиражей.
     Толпа грузит исход на 10+ п.п. выше рынка (424 случая): сама даёт ему 54,7%,
     контора 41,8%, а выпадает он в 40,3% — права контора, а не толпа. ЛОВУШКА:
     исход и дорогой при делёжке, и заходит куда реже, чем о нём думают.
     Толпа жалеет исход на 5+ п.п. (711 случаев): даёт ему 23,9%, контора 30,2%,
     выпадает 28,1%. ЦЕННОСТЬ: заходит заметно чаще, чем считает толпа, а приз
     делить с меньшим числом людей. Контора тут тоже мажет, но втрое слабее. */
  function gapVerdict(gOver, gUnder){
    if(gOver >= 10) return { k: "trap", t: "ловушка", why:
      "толпа грузит этот исход на " + gOver.toFixed(0) + " п.п. выше рынка. " +
      "На архиве такие исходы заходят в 40,3% случаев против 54,7%, которые им даёт толпа" };
    if(gUnder >= 5) return { k: "val", t: "ценность", why:
      "толпа жалеет этот исход на " + gUnder.toFixed(0) + " п.п. против рынка. " +
      "На архиве такие исходы заходят в 28,1% случаев против 23,9%, которые им даёт толпа" };
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
    say(label + " Отменить — «Вернуть».");
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
    h += '<p class="ev-lead"><b>Пороги проверены этим же правилом на 2856 матчах из 192 тиражей.</b> ' +
         'Толпа грузит исход на 10 и более пунктов выше рынка (424 случая): даёт ему 54,7%, контора 41,8%, ' +
         'а выпадает он в 40,3% — права контора. Толпа жалеет исход на 5 и более пунктов (711 случаев): ' +
         'даёт ему 23,9%, контора 30,2%, выпадает 28,1%. Толпа мажет на 14 пунктов в первом случае и на 4 ' +
         'во втором, контора — на 1,5 и 2,1. Поэтому расхождение с рынком читается как вердикт, ' +
         'а не как подсказка. В среднем на тираж выходит 2,2 ловушки и 3,7 ценных исхода.</p>';
    h += '<p class="ev-note">Сейчас в тираже: ловушек — ' + nTrap + ', ценных исходов — ' + nVal + '.</p>';
    h += '<p class="ev-note">В столбцах: исход, доля игроков → оценка конторы.</p>' +
         '<table class="ev-tab"><thead><tr><th>Матч</th><th>Толпа грузит</th><th>Толпа жалеет</th><th>Вердикт</th><th>Расх.</th></tr></thead><tbody>';
    rows.forEach(function(g){
      var nm = (g.idx + 1) + ". " + g.m.home + " — " + g.m.away;
      var vt = g.vrd.k === "trap" ? (OUT[g.over] + " ловушка")
             : g.vrd.k === "val"  ? (OUT[g.under] + " ценность") : "\u2014";
      h += '<tr><td>' + nm + '</td>' +
           '<td class="nw">' + OUT[g.over] + '  ' + pc(g.pl[g.over]) + ' \u2192 ' + pc(g.pr[g.over]) +
             (g.gOver >= 10 ? '  (+' + g.gOver.toFixed(0) + ')' : '') + '</td>' +
           '<td class="nw">' + OUT[g.under] + '  ' + pc(g.pl[g.under]) + ' \u2192 ' + pc(g.pr[g.under]) +
             (g.gUnder >= 5 ? '  (\u2212' + g.gUnder.toFixed(0) + ')' : '') + '</td>' +
           '<td class="nw"><span class="vrd ' + g.vrd.k + '" title="' + g.vrd.why + '">' + vt + '</span></td>' +
           '<td>' + (g.d * 100).toFixed(1) + '</td></tr>';
    });
    h += '</tbody></table>';
    var xo = [];
    state.matches.forEach(function(m, k){
      if(m.pct && m.pct.pool && Number(m.pct.pool[1]) > 30) xo.push(k + 1);
    });
    if(xo.length){
      h += '<h3>Переоценённые ничьи</h3><p class="ev-lead">В футболе ничья случается примерно в 28–30% матчей. ' +
           'Если на неё ушло больше 30% пула, исход переоценён. Сейчас это матч(и) № ' + xo.join(", ") +
           ' — в строках такая ничья помечена восклицательным знаком.</p>';
    }
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
  /* вероятности исходов для «Брифа»: линия конторы с поправкой по истории */
  function briefProbs(){
    return state.matches.map(function(m){ return (m.pct && m.pct.bk) ? calProb(m.pct.bk) : null; });
  }
  function briefWeighted(){ return state.briefMode !== "even"; }
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
  var BASKET_MAX = 400;
  function briefToBasket(lines, g){
    var price = briefPrice();
    var stamp = new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
    var seen = {}, added = 0, dup = 0;
    state.played.forEach(function(v){ if(v.sig) seen[v.sig] = true; });
    lines.forEach(function(L, n){
      var snap = state.matches.map(function(m, j){
        var pk = {"1": false, "X": false, "2": false}; pk[OUT[L[j]]] = true;
        return { picks: pk, mode: "free", pool: (m.pool || OUT).slice() };
      });
      var sig = L.map(function(k){ return OUT[k]; }).join(" ");
      if(seen[sig]){ dup++; return; }
      seen[sig] = true; state.rolls++; state.spent += price;
      state.played.unshift({ at: stamp, label: "бриф " + g + " · " + (n + 1) + "/" + lines.length, sig: sig, combos: 1, cost: price, snap: snap });
      added++;
    });
    if(state.played.length > BASKET_MAX) state.played.length = BASKET_MAX;
    save(); render();
    return { added: added, dup: dup };
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
    var key = "g" + g + (briefWeighted() ? "w" : "");
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
      var work = U * ball;
      if(r >= m) cells = '<td><b>1</b></td><td>' + fmt(briefPrice()) + ' ₽</td><td class="brief-save">−' + (100*(1-1/U)).toFixed(0) + '%</td>' +
                         '<td class="nw"><button type="button" class="gap-set brief-go" data-g="' + g + '">собрать</button></td>';
      else if(U > BRIEF_CAP_U || work > BRIEF_MAX_WORK)
        cells = '<td colspan="3" class="brief-no">слишком большой перебор (' + fmt(U) + ' × ' + fmt(ball) + ')</td><td class="brief-save"></td>';
      else
        cells = '<td colspan="2" class="brief-no">' +
                (work > BRIEF_WARN_WORK ? ("считать примерно " + Math.max(1, Math.round(work / 4e6)) + " с") : "не посчитано") +
                '</td><td class="brief-save"></td><td class="nw"><button type="button" class="gap-set brief-go" data-g="' + g + '">собрать</button></td>';
    }
    return '<tr><td>' + g + ' из 15</td>' + cells + '</tr>';
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
    h += '<p class="ev-note">Купон сейчас: одиночек ' + one + ', двоек ' + two + ', троек ' + tri +
         '. Полное покрытие — <b>' + fmt(U) + '</b> строк на <b>' + fmt(U * price) + ' ₽</b> по ' + fmt(price) + ' ₽ за строку.</p>';

    if(U === 1){
      h += '<p class="ev-warn">В купоне нет ни одной двойки или тройки — сокращать нечего, это и есть одна строка.</p>';
      $("evBody").innerHTML = h; $("evBack").hidden = false; return;
    }

    var wOn = briefWeighted();
    h += '<div class="brief-mode" role="group" aria-label="Как строить систему">' +
         '<button type="button" class="gap-set brief-mode-b" data-m="w" aria-pressed="' + wOn + '">С учётом вероятностей</button>' +
         '<button type="button" class="gap-set brief-mode-b" data-m="even" aria-pressed="' + !wOn + '">Все исходы поровну</button></div>' +
         '<p class="ev-note">' + (wOn ? 'Жадный подбор в первую очередь закрывает вероятные по линии конторы сочетания. Гарантия та же. Обычно разница небольшая: сравни строки и шансы в обоих режимах и бери, что выгоднее.'
                                      : 'Классическое покрытие: все исходы купона равноправны.') + '</p>';
    h += '<table class="ev-tab brief-tab"><thead><tr><th>Гарантия</th><th>Строк</th><th>Цена</th><th>Дешевле</th><th></th></tr></thead><tbody>';
    h += '<tr><td>15 из 15</td><td><b>' + fmt(U) + '</b></td><td>' + fmt(U * price) + ' ₽</td><td class="brief-save">—</td>' +
         '<td class="nw">полное покрытие</td></tr>';
    for(var g = 14; g >= 9; g--) h += briefRow(g, sets, sizes, U);
    h += '</tbody></table>';
    h += '<p class="ev-note">Числа детерминированы: один и тот же купон всегда даёт одну и ту же систему. ' +
         'Считается жадным покрытием, а оно не обязано быть минимальным — на десяти двойках с гарантией 14 ' +
         'выходит 135 строк, теоретический минимум 120. Разницу в 12% считаю честной ценой за то, что расчёт ' +
         'идёт доли секунды прямо в браузере.</p>';
    h += '<div id="briefPrev"></div>';
    $("evBody").innerHTML = h;

    [].slice.call($("evBody").querySelectorAll(".brief-go")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g"));
        b.textContent = "считаю…"; b.disabled = true;
        setTimeout(function(){
          briefCache(sets)["g" + g + (briefWeighted() ? "w" : "")] = briefBuild(sets, g, 30000, briefProbs(), !briefWeighted());
          showBrief();
        }, 30);
      });
    });
    [].slice.call($("evBody").querySelectorAll(".brief-mode-b")).forEach(function(b){
      b.addEventListener("click", function(){ state.briefMode = b.getAttribute("data-m"); save(); showBrief(); });
    });
    [].slice.call($("evBody").querySelectorAll(".brief-cart")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g")), res = briefCache(sets)["g" + g + (briefWeighted() ? "w" : "")];
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
        var g = Number(b.getAttribute("data-g")), res = briefCache(sets)["g" + g + (briefWeighted() ? "w" : "")];
        if(!res || !res.lines) return;
        saveCsvFile(briefCsv(res.lines), "brief_" + (state.tirazh || "tirazh") + "_g" + g + "_" + res.rows + ".csv");
      });
    });
    [].slice.call($("evBody").querySelectorAll(".brief-prev")).forEach(function(b){
      b.addEventListener("click", function(){
        var g = Number(b.getAttribute("data-g")), res = briefCache(sets)["g" + g + (briefWeighted() ? "w" : "")];
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
          "Загрузить тираж из ссылки? Корзина очистится — вернуть можно кнопкой «Вернуть».")){
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
    if(applyCouponCode(p.code)) say("Купон из ссылки проставлен. Отменить — «Вернуть».");
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

  var pendingBook = (function(){
    var m = String(location.hash || "").match(/^#v=([^-]*)-([A-Za-z0-9\-_]+)$/);
    return m ? { tirazh: decodeURIComponent(m[1]), payload: m[2] } : null;
  })();

  function tryPendingBook(){
    if(!pendingBook || !state.matches.length) return;
    var p = pendingBook;
    if(p.tirazh && String(p.tirazh) !== String(state.tirazh)){
      if(linkPulling || typeof fetch !== "function"){
        pendingBook = null;
        say("Тираж №" + p.tirazh + " из ссылки подгрузить не удалось — варианты не открыть.");
        return;
      }
      if(state.played.length && !window.confirm(
          "Ссылка с вариантами сделана для тиража №" + p.tirazh +
          ", а сейчас открыт №" + state.tirazh + ".\n" +
          "Загрузить тираж из ссылки? Корзина очистится — вернуть можно кнопкой «Вернуть».")){
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

  function tryPending(){ tryPendingLink(); tryPendingBook(); }

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

  function parseCsvVariants(text){
    var need = state.matches.length;
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
    $("bkName").textContent = book.name + (book.lines && book.lines !== book.rows.length
      ? " · " + fmt(book.lines) + " строк → " + fmt(book.rows.length) + " вариантов" : "");
    $("bkNum").max = bookPages().length;
    $("bkNum").value = book.idx + 1;
    $("bkTotal").textContent = "из " + fmt(bookPages().length);
    var cur = bookPages()[book.idx], same = 0, combosHere = 1;
    cur.forEach(function(c){ combosHere *= String(c).length || 1; });
    state.matches.forEach(function(m, i){ if(cur[i] && String(cur[i]).split("").some(function(o){ return m.picks[o]; })) same++; });
    var line = (book.pages && book.pages.length !== book.rows.length ? "купон " : "вариант ") + fmt(book.idx + 1) +
      (combosHere > 1 ? " (система на " + fmt(combosHere) + " вар.)" : "") +
      " · совпадает с твоим купоном в " + same + " из " + cur.length + " матчей";
    var st = bookStats();
    if(st && st.played){
      var h = 0, ms = 0;
      state.matches.forEach(function(m, i){
        if(!m.res) return;
        if(hitRes(cur[i], m.res)) h++; else ms++;
      });
      line += " · по факту угадано " + h + " из " + st.played +
              (ms ? ", максимум " + (cur.length - ms) : ", идёт на все " + cur.length);
    }
    var ko = kickoffMs();
    if(ko != null && ko <= Date.now() && state.resAt) line += " · обновлено " + resStamp();
    $("bkHit").textContent = line;
    var sb = $("bkStat");
    if(st && st.played){
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
               name: /\.csv$/i.test(book.name) ? book.name : nm + ".csv",
               what: "файл " + book.name + " как есть (строк " + fmt(book.lines || 0) + ", вариантов " + fmt(book.rows.length) + ")" };
    }
    if(sys && book.pages && book.pages.length){
      var pl = book.pages.map(function(r){ return String(price) + ";" + r.join(";"); });
      return { csv: pl.join("\n") + "\n", name: nm + "_sys_" + pl.length + ".csv",
               what: "системой: строк " + fmt(pl.length) + ", вариантов " + fmt(book.rows.length) };
    }
    var lines = book.rows.map(function(r){ return String(price) + ";" + r.join(";"); });
    return { csv: lines.join("\n") + "\n", name: nm + "_" + lines.length + "v.csv",
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
    $("expNote").textContent = "Вариант " + fmt(n) + " перенесён в купон. Отменить — «Вернуть».";
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
      if(gh){
        var ok = gh.conclusion === "success" || gh.status !== "completed";
        var lv = !ok ? 2 : ageMin(gh.created_at) > 90 ? 2 : ageMin(gh.created_at) > 45 ? 1 : 0;
        rows.push({ n: "Автообновление на GitHub", d: "каждые 30 минут", at: gh.created_at, lv: lv,
          s: !ok ? "последний запуск с ошибкой" : gh.status !== "completed" ? "идёт сейчас" : lv ? "давно не запускалось" : "работает" });
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

  /* тот же тираж: обновляем только доли игроков и коэффициенты, ничего не стирая */
  function refreshPct(info){
    var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
    if(evs.length !== state.matches.length) return false;
    var i, t;
    for(i = 0; i < evs.length; i++){
      t = splitTeams(evs[i].name);
      if(!t || t[0] !== state.matches[i].home || t[1] !== state.matches[i].away) return false;
    }
    for(i = 0; i < evs.length; i++){
      var q = evs[i].quotes || {}, m = state.matches[i];
      var np = mkPct(q); if(np) m.pct = np;
      if(q.norm_win_1 != null) m.kf = [q.norm_win_1, q.norm_draw, q.norm_win_2];
      /* сыгранные матчи: фактический исход и счёт приезжают в том же ответе */
      m.res = evRes(evs[i], info);
      m.score = evs[i].score || "";
    }
    state.resAt = Date.now();          /* когда данные с totobrief пришли в последний раз */
    if(info.id) state.tirazhId = info.id;
    save();
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
    if(n){ state.played = (c.played || []).slice(); state.spent = c.spent || 0; state.rolls = c.rolls || 0; }
    return n > 0;
  }
  function applyDrawing(info){
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
    if(!list.length) throw new Error("в ответе нет матчей");

    /* купон у каждого тиража свой и не теряется: уходя с тиража, запоминаем его,
       а вернувшись (или перезагрузив тот же тираж) — поднимаем обратно */
    couponStash();
    pushHistory("до обновления тиража", true);
    /* тираж сменился — прошлый уходит в «один шаг назад» (только результаты и счёт) */
    if(state.matches.length && state.tirazh && String(info.number) !== String(state.tirazh)){
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
    $("tirazhName").value = state.tirazh;
    render();
    attachFsTimes();
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
        return { home: m.home, away: m.away, league: m.league || "", res: m.res || "", score: m.score || "" };
      })
    };
  }
  function prevDone(){
    return !!(state.prev && state.prev.matches.every(function(m){ return m.res; }));
  }
  /* счёт и итоги прошлого тиража — тем же ответом drawing-info */
  function refreshPrev(){
    var p = state.prev;
    if(!p || !p.id || typeof fetch !== "function" || prevDone()) return;
    apiFetch("drawing-info/" + p.id)
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j) return;
        var info = j.data || j;
        var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
        if(evs.length !== p.matches.length) return;
        evs.forEach(function(e, i){
          p.matches[i].res = evRes(e, info);
          p.matches[i].score = e.score || "";
        });
        p.at = Date.now();
        save();
        if(state.viewPrev) render();
      })
      .catch(function(){});
  }
  /* при первом запуске после обновления прошлого тиража ещё нет — подтягиваем его по номеру */
  function seedPrev(){
    if(state.prev || !state.tirazh || typeof fetch !== "function") return;
    var wantN = Number(state.tirazh) - 1;
    if(!isFinite(wantN) || wantN <= 0) return;
    apiFetch("baltbet-main/drawings?page=1")
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var rows = (j && j.data) || [], d = null, i;
        for(i = 0; i < rows.length; i++) if(String(rows[i].number) === String(wantN)){ d = rows[i]; break; }
        if(!d) return null;
        return apiFetch("drawing-info/" + d.id).then(function(r){ return r.ok ? r.json() : null; })
          .then(function(j2){
            if(!j2) return;
            var info = j2.data || j2;
            var evs = (info.events || []).slice().sort(function(a,b){ return (a.order||0) - (b.order||0); });
            var list = [];
            evs.forEach(function(e){
              var t = splitTeams(e.name);
              if(!t) return;
              list.push({ home: t[0], away: t[1], league: e.championship || "",
                          res: evRes(e, info), score: e.score || "" });
            });
            if(!list.length) return;
            if(state.prev) return;                       /* пока тянули, тираж уже сменился */
            state.prev = snapPrev(d.number, d.id, d.ended_at || "", list, d.pool_sum);
            save(); render();
          });
      })
      .catch(function(){});
  }
  function renderPrevView(){
    var p = state.prev;
    rowsEl.innerHTML = "";
    /* свой купон прошлого тиража — из сохранённых купонов по тиражам */
    var myPrev = {}, myC = state.coupons && state.coupons[p.tirazh];
    if(myC) myC.rows.forEach(function(r){ myPrev[r.k] = r; });
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
      if(hc) teams.appendChild(mkFlag(hc, "tflag", m.home));
      teams.appendChild(document.createTextNode(m.home));
      var vs = document.createElement("span"); vs.className = "vs"; vs.textContent = "—";
      teams.appendChild(vs);
      if(ac) teams.appendChild(mkFlag(ac, "tflag", m.away));
      teams.appendChild(document.createTextNode(m.away));
      if(m.res === VOID){
        teams.appendChild(mkVoid());
      } else if(!m.res && !m.score && m.fsVoid){
        teams.appendChild(mkFsVoid(m));
      } else if(m.res || m.score){
        var sc = document.createElement("span");
        sc.className = "mscore" + (m.res ? "" : " live");
        sc.textContent = m.score ? String(m.score).replace(/\s+/g, "") : "";
        sc.title = m.res ? "матч сыгран, итог " + m.res : "счёт по ходу матча, итог ещё не подведён";
        if(m.res){
          var rs = document.createElement("span");
          rs.className = "mres";
          rs.textContent = (m.score ? " · " : "") + m.res;
          sc.appendChild(rs);
        }
        teams.appendChild(sc);
      }
      fix.appendChild(teams);
      var meta = document.createElement("div");
      meta.className = "meta";
      var code = cont.hit ? ((hc || ac) ? null : cont.flag) : flagCode(m.league);
      if(code) meta.appendChild(mkFlag(code, "flag"));
      meta.appendChild(document.createTextNode(m.league || ""));
      meta.appendChild(mkNewsBtn(m, idx, true));
      fix.appendChild(meta);
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
        var myr = myPrev[m.home + "|" + m.away];
        if(myr && myr.picks[o]){ b.setAttribute("aria-pressed", "true"); if(m.res === o) b.classList.add("mine-hit"); }
        cell.appendChild(b);
        picksWrap.appendChild(cell);
      });
      row.appendChild(picksWrap);
      var modes = document.createElement("div");
      modes.className = "modes";
      modes.appendChild(mkFs(m));
      modes.appendChild(mkNewsMode(m, idx, true));
      row.appendChild(modes);
      rowsEl.appendChild(row);
    });
    var done = p.matches.filter(function(m){ return m.res; }).length;
    var live = p.matches.filter(function(m){ return !m.res && m.score; }).length;
    var voids = p.matches.filter(function(m){ return m.res === VOID; }).length;
    var myHit = 0, myN = 0;
    if(myC) p.matches.forEach(function(m){
      var r = myPrev[m.home + "|" + m.away]; if(!r || !m.res) return;
      if(!(r.picks["1"] || r.picks["X"] || r.picks["2"])) return;
      myN++; if(m.res === VOID || r.picks[m.res]) myHit++;
    });
    var bar = $("prevBar");
    bar.innerHTML = '<span class="pb-t">Просмотр тиража ' + escHtml(p.tirazh) + '</span>' +
      '<span>сыграно <b>' + done + '</b> из ' + p.matches.length + '</span>' +
      (live ? '<span>идёт <b>' + live + '</b></span>' : '') +
      (voids ? '<span title="засчитан угаданным для любой ставки">отменён <b>' + voids + '</b></span>' : '') +
      (myN ? '<span title="твой купон на этот тираж">твой купон: угадано <b>' + myHit + '</b> из ' + myN + '</span>' : '') +
      (p.at ? '<span>обновлено <b>' + new Date(p.at).toTimeString().slice(0,5) + '</b></span>' : '') +
      '<button type="button" class="pb-back" id="btnPrevBack">К текущему тиражу &#8250;</button>';
    bar.hidden = false;
    $("btnPrevBack").addEventListener("click", leavePrev);
  }
  function escHtml(x){ return String(x).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function enterPrev(){
    if(!state.prev) return;
    state.viewPrev = true; save(); render(); renderKickoff(); refreshPrev();
  }
  function leavePrev(){
    state.viewPrev = false; save(); render(); renderKickoff();
  }
  function syncTirNav(){
    var inPrev = !!(state.viewPrev && state.prev);
    document.body.classList.toggle("is-prev", inPrev);
    $("btnTirPrev").disabled = !state.prev || inPrev;
    $("btnTirNext").disabled = !inPrev;
    $("tirazhName").value = inPrev ? state.prev.tirazh : (state.tirazh || "");
    if(!inPrev) $("prevBar").hidden = true;
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
    var btn = $("btnFetch");
    var lbl = btn.querySelector(".lbl") || btn;
    btn.disabled = true;
    btn.classList.add("is-loading");
    var was = lbl.textContent;
    lbl.textContent = "Загружаю…";
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
          say("Тираж №" + res.number + (feed.src === "mirror" ? " загружен из зеркала (totobrief не отвечает): " : " загружен с totobrief: ") + res.n +
              " матч(ей)" + (noPct ? ", процентов игроков и коэффициентов у этого снимка нет — только состав и дедлайн."
                                   : ", проценты игроков и конторы подставлены в строки.") +
              " Исходы и режимы не проставлены — отмечай сам, а для «РАНДОМА» сначала нажми «Все в рандом».");
        }
        if(res && !res.soft) tryPending();
      })
      .catch(function(err){
        btn.disabled = false; btn.classList.remove("is-loading"); lbl.textContent = was;
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
  function variantCombos(v){
    if(!v || !Array.isArray(v.snap)) return 0;
    var n = 1;
    for(var i=0;i<v.snap.length;i++){
      var c = 0;
      for(var k=0;k<3;k++) if(v.snap[i].picks[OUT[k]]) c++;
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
      if(!Array.isArray(v.snap) || v.snap.length !== need || variantCombos(v) === 0){ skipped++; return; }
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
        var rows = enumerate(plan.take[i].snap);
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
        var row = mk(plan.take[i].snap);
        if(row) lines.push(row);
      }
      src = "корзина";
    }
    if(!lines.length) return null;
    return { csv: lines.join("\n") + "\n", rows: lines.length, price: price, src: src };
  }

  function saveCsvFile(csv, name){
    if(!(window.claude && typeof window.claude.use === "function")){
      try{
        var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        $("expNote").textContent = "Файл " + name + " сохранён в загрузки.";
      }catch(e){ showFallback(csv); }
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
    var name = "export_sys_" + out.rows + "_" + (combos * out.price) + ".csv";
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
    var name = "export_sys_" + out.rows + "_" + total + ".csv";
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
    var name = "export_random_" + rowsN + "_" + (rowsN * (Number(state.price)||0)) + ".csv";
    var done = false;
    if(!(window.claude && typeof window.claude.use === "function")){
      try{
        var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        $("expNote").textContent = "Файл " + name + " сохранён в загрузки.";
        return;
      }catch(e){ showFallback(csv); return; }
    }
    if(window.claude && typeof window.claude.use === "function"){
      window.claude.use("downloads").then(function(dl){
        if(!dl || done) { if(!done) showFallback(csv); return; }
        done = true;
        dl.save({filename:name, data:csv}).catch(function(){ showFallback(csv); });
      }).catch(function(){ showFallback(csv); });
    } else {
      showFallback(csv);
    }
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
    var name = "export_random_" + rowsN + "_" + (rowsN * (Number(state.price)||0)) + ".csv";

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
    attachFsTimes(); /* дозаполнить время начала, если тираж пришёл из кэша ещё без него */
    /* если страница размещена в интернете — тихо проверить, не сменился ли тираж */
    if(typeof fetch === "function"){
      /* открыли ссылку на купон — грузим сразу ТОТ тираж, а не текущий */
      setTimeout(function(){
        var want = (pendingLink && pendingLink.tirazh) ? pendingLink.tirazh :
                   (pendingBook && pendingBook.tirazh) ? pendingBook.tirazh : null;
        if(want) linkPulling = true;
        pullTirazh(true, want);
        setTimeout(seedPrev, 4000);          /* прошлый тираж — фоном, когда текущий уже на месте */
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
  function blendOpenMs(){ return 60 * 60000; }   /* функция, а не var: renderKickoff зовёт нас раньше, чем var успевает присвоиться */
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
    ["Расхождения", "Ищет матчи, где доля игроков сильнее всего расходится с оценкой конторы, и ставит исходы, которые толпа недоигрывает. Выигрыш в тотализаторе делится между угадавшими, поэтому такие исходы выгоднее.<span class=\"ev-bt\">На истории (731 тираж): замена отдаёт не больше 5 п.п. вероятности, в среднем 2,9 замены за тираж. Приз в 10,1% тиражей, 12+ — в 0,41%. Прежнее правило (до 15 п.п., 8,5 замены) давало 6,8% и 0,14%. У линии фаворитов без замен призов чаще (12,7%), зато на делёжке замены по модели окупаются — но этот выигрыш неустойчив.</span>"],
    ["Отобрать строки", "Из большой системы оставляет строки, которые меньше всего совпадают с выбором толпы, — при угадывании делить приз придётся с меньшим числом соперников.<span class=\"ev-bt\">На истории не проверялась: работает поверх вашего купона.</span>"],
    ["Бриф", "Собирает систему с гарантией: вместо всех строк купона берётся их часть, которая всё равно гарантирует заданное число угаданных при попадании в отмеченные исходы.<span class=\"ev-bt\">На истории не проверялась: работает поверх вашего купона.</span>"],
    ["Охота на 15", "Цель — забрать 15 из 15. Вместо системы берутся самые вероятные отдельные строки: система вынуждена покупать и маловероятные сочетания. Вероятности — модель, обученная на истории (линия конторы, ничьи, молодёжные турниры); среди почти равных строк остаются менее популярные у игроков, чтобы не делить суперприз. До 400 строк — в корзину, больше — сразу в CSV.<span class=\"ev-bt\">На истории (618 тиражей): при ~900 строках шанс 15 из 15 — 0,085% против 0,073% у системы той же цены, при ~8 000 строк — 0,55% против 0,44%. На ~8 000 строк 15 из 15 забрали бы 4 раза, система — ни разу.</span>"],
    ["Симуляция", "Цель — чаще попадать в призы (9 и больше). Двойники и тройники ставятся там, где сильнее всего растёт шанс 9+, итог проверяется розыгрышем 10 000 тиражей.<span class=\"ev-bt\">На истории (731 тираж, купон до 32 вариантов, в среднем 810 ₽): приз в 40,5% тиражей, 12+ — в 2,46%, 13+ — в 0,68%.</span>"],
    ["Сплав к дедлайну", "Включается за час до закрытия приёма, когда доли игроков и линия уже почти окончательные. «Расхождения», «Симуляция» и «Келли» собирают свои купоны, и все их исходы складываются в один купон с двойниками и тройниками там, где стратегии расходятся. У каждого исхода видно число голосов. Можно поставить всё, только исходы с 2+ голосами или снять лишнее в купоне вручную. Это не гарантия выигрыша."],
    ["Келли", "Цель — быстрее всего растить банк. Сравнивает системы по вероятностям и купоны «Симуляции» на 1–512 вариантов и подставляет тот, у которого ожидаемый рост банка больше. Если выгодного нет, честно говорит «не ставить» и предлагает наименее убыточный.<span class=\"ev-bt\">На истории (731 тираж): в среднем купон за 3 110 ₽, приз в 55,1% тиражей, 12+ — в 5,06%, 13+ — в 1,5%. Модель выплат считала выгодным каждый тираж из-за крупных суперпризов — к этому стоит относиться осторожно.</span>"]
  ];
  function showStratGuide(){
    $("evTitle").textContent = "Как работают стратегии";
    var h = '<dl class="ev-guide">';
    STRAT_GUIDE.forEach(function(g){ h += '<dt>' + g[0] + '</dt><dd>' + g[1] + '</dd>'; });
    h += '</dl><p class="ev-note">Каждая кнопка ставит исходы в купон; «Вернуть» откатывает последнюю расстановку. Проверка — по тиражам 4135–5015, вероятности поправлялись только по прошлым тиражам. Ни одна стратегия за это время не угадала 14 или 15. Реальных выплат в истории нет, поэтому сравниваются частоты призов, а не деньги. Это модели, а не гарантия выигрыша.</p>';
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
        + fmt(t0.combos * (Number(state.price) || 0)) + " ₽. «Вернуть» откатит изменения.");
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
  var STRAT_NOTE = '<p class="ev-note">Строки с фиксом не меняются. «Вернуть» откатит купон к прежнему виду. Это модель, а не гарантия.</p>';

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
    /* для сравнения — система двойников и тройников примерно той же цены */
    var sys = planByData(N), sysP = 1;
    sys.rows.forEach(function(r){
      if(!r.set.length){ sysP = 0; return; }
      var hp = huntProbs(r.m); var s = 0; r.set.forEach(function(k){ s += hp ? hp[k] : 0; }); sysP *= s;
    });
    return { P: P, lines: lines, p15: p15, share: share, sysP: sysP, sysCombos: sys.combos };
  }
  /* проставить в таблицу все исходы, которые встречаются в строках охоты */
  function huntToTable(lines){
    pushHistory("до «Охоты на 15»");
    state.matches.forEach(function(m, i){
      var pk = {"1": false, "X": false, "2": false};
      lines.forEach(function(c){ pk[OUT[c.line[i]]] = true; });
      m.picks = pk; m.mode = "free";
    });
    save(); render();
    return tally().combos;
  }
  function huntCommit(lines, price){
    var stamp = new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
    var seen = {}, added = 0, dup = 0;
    state.played.forEach(function(v){ if(v.sig) seen[v.sig] = true; });
    lines.forEach(function(c, n){
      var snap = state.matches.map(function(m, j){
        var pk = {"1": false, "X": false, "2": false}; pk[OUT[c.line[j]]] = true;
        return { picks: pk, mode: "free", pool: (m.pool || OUT).slice() };
      });
      var sig = c.line.map(function(k){ return OUT[k]; }).join(" ");
      if(seen[sig]){ dup++; return; }
      seen[sig] = true; state.rolls++; state.spent += price;
      state.played.unshift({ at: stamp, label: "охота " + (n + 1) + "/" + lines.length, sig: sig, combos: 1, cost: price, snap: snap });
      added++;
    });
    if(state.played.length > 400) state.played.length = 400;
    save(); render();
    $("evBack").hidden = true;
    return { added: added, dup: dup };
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
      ["Система той же цены", plan.sysP > 0 ? stratChance(plan.sysP) : "—"]]);
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
    var canBasket = plan.lines.length <= 400;
    h += '<div class="ev-data-go ev-data-go2">'
      + '<button type="button" id="huntBasket" class="btn-ev"' + (canBasket ? '' : ' disabled title="В корзину помещается до 400 строк — используй CSV"') + '>В корзину</button>'
      + '<button type="button" id="huntCsv" class="btn-ev">Скачать CSV</button></div>';
    if(!canBasket) h += '<p class="ev-note dt-center">Больше 400 строк корзина не вмещает — такой купон выгружается сразу в CSV.</p>';
    h += '<p class="ev-note">Выигрыш не гарантирован: даже 10 000 строк дают около полупроцента шанса. Контора оценивает матчи точно, поэтому шанс растёт в основном с числом строк.</p>';
    box.innerHTML = h;
    $("evBack").hidden = false;
    $("huntSize").addEventListener("change", function(){ state.huntSize = Number(this.value) || 100; save(); showHunt(); });
    var hb = $("huntBasket");
    function tableNote(sys){
      return " Таблица показывает все исходы строк (система на " + fmt(sys) + " вар.) — «Записать» не нажимай.";
    }
    if(hb && canBasket) hb.addEventListener("click", function(){
      var sys = huntToTable(plan.lines);
      var r = huntCommit(plan.lines, price);
      say("«Охота на 15»: в корзину " + fmt(r.added) + " строк на " + fmt(r.added * price) + " ₽"
        + (r.dup ? ", повторов пропущено: " + fmt(r.dup) : "") + "." + tableNote(sys));
    });
    $("huntCsv").addEventListener("click", function(){
      saveCsvFile(briefCsv(plan.lines.map(function(c){ return c.line; })),
        "ohota15_" + (state.tirazh || "tirazh") + "_" + plan.lines.length + ".csv");
      var sys = huntToTable(plan.lines);
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
    } else {
      h += '<div class="ev-top ev-bad ev-data-verdict"><b>Не ставить</b><span>ни один купон не растит банк: средняя выплата меньше цены</span></div>';
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
      if(!b) h += '<p class="ev-sub">Если всё же играть — наименьшие потери у купона «' + pick.src + ', ' + fmt(pick.plan.combos) + '»:</p>';
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
  $("btnBlend").addEventListener("click", showBlend);
  renderBlend();
  setInterval(renderBlend, 30000);
  setTimeout(checkFsVoids, 4000);
  loadAi().then(aiBtnsUpdate);
  setInterval(function(){ loadAi().then(aiBtnsUpdate); }, 30 * 60000);
  setInterval(checkFsVoids, 10 * 60000);

  /* ====================================================================
     конец новой аналитики
     ==================================================================== */
})();
