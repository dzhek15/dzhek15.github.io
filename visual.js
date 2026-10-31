/* ДЖЕК 15 — визуальный слой: обложка тиража и билеты в корзине.
   Данные только читает через window.DZ (app.js), купон не меняет. */
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var root = document.documentElement;
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var OUT = ["1", "X", "2"];
  function esc(t){ return String(t == null ? "" : t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
  function fmt(n){ return Number(n || 0).toLocaleString("ru-RU"); }

  /* ---------- обложка тиража ---------- */
  var cover = $("cover"), cvNum = $("cvNum"), cvJack = $("cvJack"), cvSub = $("cvSub"), cvTrack = $("cvTrack"), cvDate = $("cvDate");
  var lastJack = null, lastTicker = "";
  function scramble(el, finalText){
    if(RM || !el.animate){ el.textContent = finalText; return; }
    var digits = [], chars = finalText.split("");
    chars.forEach(function(c, i){ if(/\d/.test(c)) digits.push(i); });
    var t0 = performance.now(), dur = 1300;
    (function step(now){
      var k = Math.min(1, (now - t0) / dur), done = Math.floor(k * digits.length);
      var out = chars.slice();
      for(var j = done; j < digits.length; j++) out[digits[j]] = String(Math.floor(Math.random() * 10));
      el.textContent = out.join("");
      if(k < 1) requestAnimationFrame(step); else el.textContent = finalText;
    })(t0);
  }
  function chipHtml(m, i){
    var D = window.DZ;
    var e = function(n){ var src = D && D.embSrc && D.embSrc(n, D.nat && D.nat(n, m.league)); return src ? '<img class="cv-emb" src="' + esc(src) + '" width="18" height="18" alt="" decoding="async">' : ''; };
    return '<button type="button" class="cv-chip" data-i="' + i + '"><i>' + (i + 1) + '</i>' + e(m.home) + '<span>' + esc(m.home) +
           '</span><em>—</em><span>' + esc(m.away) + '</span>' + e(m.away) + '</button>';
  }
  function renderCover(){
    if(!cover || !window.DZ) return;
    ensureFx();
    var g = window.DZ.get();
    cvNum.innerHTML = '<small>№</small>' + (g.tirazh ? esc(g.tirazh) : "—");
    var jt = g.jackpot ? fmt(g.jackpot) + "\u00a0₽" : "—";
    if(jt !== lastJack){
      if(g.jackpot && !cover.dataset.anim){ cover.dataset.anim = "1"; scramble(cvJack, jt); } else cvJack.textContent = jt;
      lastJack = jt;
    }
    var ko = ($("koTime") || {}).textContent || "—", left = ($("koLeft") || {}).textContent || "";
    cvSub.innerHTML = '<span class="cv-s1"><em>приём до</em> ' + esc(ko.replace(/\s+/g, " ").trim()) + '</span>' +
      (left && left.trim() !== "—" ? '<i class="cv-sep" aria-hidden="true"></i><span class="cv-s2"><em>' + (g.prev ? "статус" : "осталось") + '</em> ' + esc(left.trim()) + '</span>' : "");
    var pool = ($("tkFund") || {}).textContent || "";
    var pe = $("cvPool"), has = pool && pool.trim() !== "—";
    pe.innerHTML = '<em>Пул</em><b>' + (has ? esc(pool.trim()) : "—") + '</b>';
    pe.classList.toggle("is-on", !!has);
    var d = g.prev && g.deadline ? new Date(g.deadline) : new Date();
    if(isNaN(d)) d = new Date();
    cvDate.textContent = d.toLocaleDateString("ru-RU", { weekday:"long", day:"numeric", month:"long" });
    var sig = g.matches.map(function(m){ return m.home + "|" + m.away + (window.DZ.embSrc ? "+" + (window.DZ.embSrc(m.home) || "") + (window.DZ.embSrc(m.away) || "") : ""); }).join(";");
    if(sig !== lastTicker && g.matches.length){
      lastTicker = sig;
      var one = g.matches.map(chipHtml).join('<b class="cv-dot" aria-hidden="true">◆</b>');
      cvTrack.innerHTML = '<div class="cv-run">' + one + '<b class="cv-dot" aria-hidden="true">◆</b></div>' +
                          '<div class="cv-run" aria-hidden="true">' + one + '<b class="cv-dot">◆</b></div>';
      var n = g.matches.length;
      cvTrack.style.setProperty("--cv-dur", Math.max(40, n * 5) + "s");
    }
    renderFeat(); renderCd();
  }

  /* ---------- обложка-журнал: матч тура, лента из 15 меток, отсчёт, пыль, блик, параллакс ---------- */
  var fxs = { idx: 0, rot: 0, cd: 0, kick: 0, scSeen: {}, list: [] };
  function koKey(m){
    var d = /(\d{1,2})\.(\d{1,2})/.exec(m.date || ""), t = /(\d{1,2}):(\d{2})/.exec(m.time || "");
    if(!t) return 1e9;
    return (d ? Number(d[2]) * 1e6 + Number(d[1]) * 1e4 : 5e8) + Number(t[1]) * 100 + Number(t[2]);
  }
  function embImg(D, name, m){
    var src = D && D.embSrc && D.embSrc(name, D.nat && D.nat(name, m.league));
    return src ? '<img class="ft-emb" src="' + esc(src) + '" width="44" height="44" alt="" decoding="async">' : '<i class="ft-emb ft-noemb" aria-hidden="true"></i>';
  }
  function pickFeat(g){
    var D = window.DZ, L = g.matches.map(function(m, i){ return { m: m, i: i, s: D.liveOf(m) }; });
    var live = L.filter(function(x){ return x.s.st === "live"; });
    if(live.length) return { mode: "live", list: live, all: L };
    var wait = L.filter(function(x){ return x.s.st === "wait"; }).sort(function(a, b){ return koKey(a.m) - koKey(b.m) || a.i - b.i; });
    if(wait.length) return { mode: "next", list: wait.slice(0, 1), all: L };
    var done = L.filter(function(x){ return x.s.st === "done" || x.s.st === "end"; });
    done.sort(function(a, b){ var ga = (String(a.m.score || "").match(/\d+/g) || []).reduce(function(s, v){ return s + Number(v); }, 0), gb = (String(b.m.score || "").match(/\d+/g) || []).reduce(function(s, v){ return s + Number(v); }, 0); return gb - ga || a.i - b.i; });
    return { mode: "done", list: done.slice(0, 1), all: L };
  }
  function scoreHtml(m){
    var r = /(\d+)\D+(\d+)/.exec(String(m.score || ""));
    return r ? '<b>' + r[1] + '</b><i>:</i><b>' + r[2] + '</b>' : "";
  }
  function renderFeat(){
    var el = $("cvFeat"), pe = $("cvPips"), D = window.DZ; if(!el || !D) return;
    var g = D.get(); if(!g.matches || !g.matches.length){ el.hidden = true; pe.hidden = true; return; }
    var f = pickFeat(g); fxs.list = f.list;
    var x = f.list[fxs.idx % Math.max(1, f.list.length)];
    pe.hidden = false;
    var nd = 0, nl = 0, nw = 0;
    pe.innerHTML = '<span class="pp-d">' + f.all.map(function(y){
      var c = y.s.st === "live" ? "lv" : (y.s.st === "done" || y.s.st === "end") ? "dn" : y.s.st === "void" ? "vd" : "wt";
      if(c === "lv") nl++; else if(c === "dn") nd++; else if(c === "wt") nw++;
      return '<b class="' + c + '" data-i="' + y.i + '"></b>';
    }).join("") + '</span><span class="pp-t">' + (nl ? '<em>идут ' + nl + '</em> · ' : '') + 'сыграно ' + nd + ' из ' + f.all.length + '</span>';
    if(!x){ el.hidden = true; return; }
    el.hidden = false;
    var m = x.m, k, cls = "cv-ft m-" + f.mode;
    var key = g.tirazh + "|" + x.i, sc = String(m.score || "");
    /* «ГОЛ!» только когда счёт реально вырос: появление первого счёта 0:0 при начале матча голом не считается */
    var po = /(\d+)\D+(\d+)/.exec(fxs.scSeen[key] || ""), pn = /(\d+)\D+(\d+)/.exec(sc);
    if(po && pn && f.mode === "live" && (+pn[1] > +po[1] || +pn[2] > +po[2])) cls += " ft-goal";
    fxs.scSeen[key] = sc;
    if(f.mode === "live") k = '<b class="ft-dot"></b>В эфире' + (x.s.min ? ' · <span class="ft-min">' + esc(x.s.min) + '</span>' : "");
    else if(f.mode === "next") k = 'Ближайший матч · ' + esc([m.date, m.time].filter(Boolean).join(" "));
    else k = 'Главный итог тура';
    var mid = sc ? '<div class="ft-sc">' + scoreHtml(m) + '</div>' : '<div class="ft-sc ft-vs"><span>' + esc(m.time || "—") + '</span></div>';
    var sig = f.mode + "|" + x.i + "|" + sc + "|" + (x.s.min || "") + "|" + m.home + m.away;
    if(el.dataset.sig === sig) return;
    var swap = el.dataset.sig && el.dataset.sig.split("|")[1] !== String(x.i);
    el.dataset.sig = sig;
    var html = '<div class="' + cls + '" data-i="' + x.i + '"><div class="ft-k">' + k + '</div><div class="ft-m">' +
      '<div class="ft-t">' + embImg(D, m.home, m) + '<span>' + esc(m.home) + '</span></div>' + mid +
      '<div class="ft-t">' + embImg(D, m.away, m) + '<span>' + esc(m.away) + '</span></div></div>' +
      (m.league ? '<div class="ft-l">' + esc(m.league) + '</div>' : "") + '</div>';
    /* смена матча — плавно: старый гаснет и чуть уходит вверх, новый проявляется снизу */
    clearTimeout(fxs.sw);
    if(swap && !RM){
      el.classList.remove("ft-in"); el.classList.add("ft-out");
      fxs.sw = setTimeout(function(){ el.innerHTML = html; el.classList.remove("ft-out"); void el.offsetWidth; el.classList.add("ft-in"); }, 650);
    } else { el.innerHTML = html; }
    if(!fxs.rot){
      fxs.rot = setInterval(function(){ if(document.hidden || fxs.list.length < 2) return; fxs.idx++; renderFeat(); }, 16000);
    }
  }
  function renderCd(){
    var el = $("cvCd"), g = window.DZ && window.DZ.get(); if(!el || !g) return;
    var ms = (g.kickoff || 0) - Date.now();
    if(g.prev || !(g.kickoff > 0) || ms <= 0){ el.hidden = true; if(fxs.cd){ clearInterval(fxs.cd); fxs.cd = 0; } return; }
    el.hidden = false; fxs.kick = g.kickoff;
    var tick = function(){
      var r = Math.max(0, Math.floor((fxs.kick - Date.now()) / 1000));
      if(r <= 0){ clearInterval(fxs.cd); fxs.cd = 0; try{ renderCover(); }catch(e){} return; }
      var d = Math.floor(r / 86400), h = Math.floor(r % 86400 / 3600), mi = Math.floor(r % 3600 / 60), se = r % 60;
      var z = function(n){ return (n < 10 ? "0" : "") + n; };
      var b = el.querySelector(".cd-d");
      if(!b){
        el.innerHTML = '<div class="cd-k">до закрытия приёма</div><div class="cd-d"><span class="cd-dd"></span><b></b><i>:</i><b></b><i>:</i><b></b></div>';
        b = el.querySelector(".cd-d");
      }
      var bs = b.querySelectorAll("b"), dd = b.querySelector(".cd-dd");
      dd.textContent = d > 0 ? d + " д" : ""; dd.style.display = d > 0 ? "" : "none";
      bs[0].textContent = z(h); bs[1].textContent = z(mi); bs[2].textContent = z(se);
      el.classList.toggle("is-hot", r <= 3600); el.classList.toggle("is-last", r <= 300);
    };
    if(fxs.cd) clearInterval(fxs.cd);
    tick(); fxs.cd = setInterval(tick, 1000);
  }
  function dust(){
    var cv = cover.querySelector(".cv-dust"); if(!cv || RM || !cv.getContext) return;
    var x = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), P = [], on = true, raf = 0;
    function size(){ var r = cover.getBoundingClientRect(); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function mk(init){ return { x: Math.random() * W, y: init ? Math.random() * H : H + 10, r: .5 + Math.random() * 1.6, v: 6 + Math.random() * 16, ph: Math.random() * 6.28, a: .25 + Math.random() * .55 }; }
    size(); for(var i = 0; i < 38; i++) P.push(mk(true));
    var t0 = performance.now();
    function step(t){
      raf = 0; if(!on || document.hidden) return;
      var dt = Math.min(.05, (t - t0) / 1000); t0 = t;
      x.clearRect(0, 0, W, H);
      for(var i = 0; i < P.length; i++){
        var p = P[i]; p.y -= p.v * dt; p.x += Math.sin(t / 1800 + p.ph) * 6 * dt; p.ph += dt;
        if(p.y < -10){ P[i] = p = mk(false); }
        var tw = .55 + .45 * Math.sin(t / 500 + p.ph * 3), al = p.a * tw * Math.min(1, (H - p.y) / 60, p.y / 60 + .2);
        x.beginPath(); x.fillStyle = "rgba(246,221,149," + Math.max(0, al).toFixed(3) + ")"; x.arc(p.x, p.y, p.r, 0, 6.283); x.fill();
        if(p.r > 1.2){ x.beginPath(); x.fillStyle = "rgba(246,221,149," + (al * .18).toFixed(3) + ")"; x.arc(p.x, p.y, p.r * 3.2, 0, 6.283); x.fill(); }
      }
      raf = requestAnimationFrame(step);
    }
    var go = function(){ if(!raf && on && !document.hidden){ t0 = performance.now(); raf = requestAnimationFrame(step); } };
    if(window.IntersectionObserver) new IntersectionObserver(function(es){ on = es[0].isIntersecting; if(on) go(); }).observe(cover);
    document.addEventListener("visibilitychange", go);
    window.addEventListener("resize", function(){ size(); });
    go();
  }
  function parallax(){
    if(RM) return;
    var raf = 0, tx = 0, ty = 0;
    function set(){ raf = 0; cover.style.setProperty("--mx", tx.toFixed(3)); cover.style.setProperty("--my", ty.toFixed(3)); }
    cover.addEventListener("pointermove", function(e){
      var r = cover.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width * 2 - 1; ty = (e.clientY - r.top) / r.height * 2 - 1;
      if(!raf) raf = requestAnimationFrame(set);
    }, { passive: true });
    cover.addEventListener("pointerleave", function(){ tx = 0; ty = 0; if(!raf) raf = requestAnimationFrame(set); });
    var sraf = 0;
    window.addEventListener("scroll", function(){
      if(sraf) return; sraf = requestAnimationFrame(function(){ sraf = 0;
        var r = cover.getBoundingClientRect(); if(r.bottom < 0) return;
        cover.style.setProperty("--sy", Math.max(-1, Math.min(1, r.top / 400)).toFixed(3)); });
    }, { passive: true });
  }
  function ensureFx(){
    if(!cover || cover.dataset.fx) return; cover.dataset.fx = "1";
    var fxEl = cover.querySelector(".cv-fx"), inEl = cover.querySelector(".cv-in"), foot = cover.querySelector(".cv-foot");
    if(!fxEl || !inEl || !foot) return;
    fxEl.insertAdjacentHTML("beforeend", '<b class="cv-frame"></b><b class="cv-sheen"></b><b class="cv-grain"></b><canvas class="cv-dust"></canvas>');
    inEl.insertAdjacentHTML("afterend", '<div class="cv-feat" id="cvFeat" hidden></div><div class="cv-pips" id="cvPips" hidden></div>');
    foot.insertAdjacentHTML("afterbegin", '<div class="cv-cd" id="cvCd" hidden></div>');
    var go = function(e){ var t = e.target.closest && e.target.closest("[data-i]"); if(t) goRow(Number(t.getAttribute("data-i"))); };
    $("cvFeat").addEventListener("click", go); $("cvPips").addEventListener("click", go);
    dust(); parallax();
  }
  if(cvTrack){
    cvTrack.addEventListener("click", function(e){
      var c = e.target.closest && e.target.closest(".cv-chip"); if(!c) return;
      goRow(Number(c.getAttribute("data-i")));
    });
  }
  function goRow(i){
    var rows = document.querySelectorAll("#rows .row"); var r = rows[i]; if(!r) return;
    try{ r.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "center" }); }catch(e){ r.scrollIntoView(); }
    r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
    setTimeout(function(){ r.classList.remove("flash"); }, 1600);
  }

  /* ---------- корзина в стиле старой газеты: купон в одну строку + «Скачать этот документ» ---------- */
  function sigCells(sig){
    var parts = String(sig || "").trim().split(/\s+/);
    return parts.map(function(p, k){
      var c = p.length >= 3 ? " c3" : (p.length === 2 ? " c2" : "");
      return '<span class="tc' + c + '" title="Матч ' + (k + 1) + ': ' + esc(p) + '">' + esc(p) + '</span>';
    }).join("");
  }
  function decorateBasket(){
    var ul = $("hist"); if(!ul || !window.DZ) return;
    Array.prototype.forEach.call(ul.children, function(li){
      if(li.dataset.tk) return;
      li.dataset.tk = "1"; li.classList.add("tkt");
      var cb = li.querySelector(".hist-cb"), acts = li.querySelector(".hist-acts"), sig = li.querySelector(".sig");
      var left = sig && sig.parentNode, meta = left && left.firstChild;
      if(!cb || !acts || !sig || !meta) return;
      var head = document.createElement("div"); head.className = "tk-head";
      meta.className = "tk-meta"; meta.removeAttribute("style");
      head.appendChild(cb); head.appendChild(meta); head.appendChild(acts);
      sig.classList.add("tk-sig"); sig.setAttribute("aria-label", "Купон: " + sig.textContent);
      sig.innerHTML = sigCells(sig.textContent);
      li.innerHTML = ""; li.appendChild(head); li.appendChild(sig);
    });
    var bd = $("btnHistDoc"); if(bd) bd.disabled = !window.DZ.get().played.length;
  }

  function loadFonts(){
    if(!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['700 40px "Old Standard TT"', '400 16px "Old Standard TT"', '400 15px "PT Serif"', '700 15px "PT Serif"', 'italic 400 14px "PT Serif"']
      .map(function(f){ return document.fonts.load(f).catch(function(){}); })).catch(function(){});
  }
  function basketDoc(){
    var g = window.DZ.get(), ms = g.matches;
    var list = g.played.filter(function(v){ return v.sel !== false; });
    if(!list.length) list = g.played.slice();
    if(!list.length) return;
    loadFonts().then(function(){
      var OS = '"Old Standard TT", Georgia, "Times New Roman", serif', PS = '"PT Serif", Georgia, serif', MONO = '"IBM Plex Mono", monospace';
      var W = 1000, M = 44, half = Math.ceil(ms.length / 2), mH = 26, rowH = 34;
      var cellW = 40, gridW = cellW * ms.length, gridX = W - M - gridW;
      var y0 = 238, matchesH = half * mH + 20, tblTop = y0 + 38 + matchesH + 46;
      var H = tblTop + 30 + list.length * rowH + 140;
      var dpr = 2, cv = document.createElement("canvas"); cv.width = W * dpr; cv.height = H * dpr;
      var x = cv.getContext("2d"); x.scale(dpr, dpr);
      var paper = "#F1E8D4", ink = "#1D1A15", mute = "#5E5446", rule = "#8D7F63", red = "#8E2A1E";
      x.fillStyle = paper; x.fillRect(0, 0, W, H);
      /* старение бумаги: виньетка и крап */
      var vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
      vg.addColorStop(0, "rgba(120,90,40,0)"); vg.addColorStop(1, "rgba(120,90,40,.22)");
      x.fillStyle = vg; x.fillRect(0, 0, W, H);
      x.fillStyle = "rgba(90,70,40,.06)";
      for(var n = 0; n < 900; n++){ x.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5); }
      x.strokeStyle = ink; x.fillStyle = ink;
      function line(y, w){ x.lineWidth = w || 1; x.beginPath(); x.moveTo(M, y); x.lineTo(W - M, y); x.stroke(); }
      function center(t, y, f, col){ x.font = f; x.fillStyle = col || ink; x.textAlign = "center"; x.fillText(t, W / 2, y); x.textAlign = "left"; }
      /* шапка газеты */
      x.font = "400 13px " + PS; x.fillStyle = mute;
      x.fillText("Тираж №" + (g.tirazh || "—"), M, 46);
      x.textAlign = "right"; x.fillText("dzhek15.github.io", W - M, 46); x.textAlign = "left";
      line(58, 1); line(62, 3);
      center("ДЖЕК 15", 132, "700 72px " + OS);
      center("ВЕДОМОСТЬ КУПОНОВ  ·  БАЛТБЕТ ТОТО 15", 162, "400 15px " + OS, mute);
      line(178, 3); line(183, 1);
      var d = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      var rows = 0, sum = 0;
      list.forEach(function(v){ rows += v.combos || 1; sum += v.cost != null ? Number(v.cost) : (v.combos || 1) * g.price; });
      center(d.charAt(0).toUpperCase() + d.slice(1) + "  ·  купонов: " + fmt(list.length) + "  ·  строк: " + fmt(rows) + "  ·  " + fmt(sum) + " ₽", 208, "italic 400 15px " + PS);
      line(222, 1);
      /* матчи тиража в две колонки */
      center("— МАТЧИ ТИРАЖА —", y0 + 18, "700 15px " + OS);
      var colW = (W - 2 * M - 30) / 2;
      x.save(); x.strokeStyle = rule; x.lineWidth = 1; x.beginPath(); x.moveTo(W / 2, y0 + 34); x.lineTo(W / 2, y0 + 34 + half * mH); x.stroke(); x.restore();
      ms.forEach(function(m, i){
        var col = i < half ? 0 : 1, r = i % half, cx = M + col * (colW + 30), cy = y0 + 34 + r * mH + 18;
        x.font = "700 14px " + PS; x.fillStyle = red; x.fillText(String(i + 1), cx, cy);
        x.font = "400 15px " + PS; x.fillStyle = ink;
        var t = m.home + " — " + m.away;
        while(x.measureText(t).width > colW - 34 && t.length > 6) t = t.slice(0, -2);
        if(t !== m.home + " — " + m.away) t += "…";
        x.fillText(t, cx + 28, cy);
      });
      /* таблица купонов */
      var ty = tblTop;
      line(ty - 26, 1); center("— КУПОНЫ —", ty - 6, "700 15px " + OS);
      x.font = "700 12px " + MONO; x.fillStyle = mute; x.textAlign = "center";
      ms.forEach(function(m, i){ x.fillText(String(i + 1), gridX + i * cellW + cellW / 2, ty + 18); });
      x.textAlign = "left"; x.font = "700 12px " + OS; x.fillText("№  ·  ВАРИАНТЫ  ·  СУММА", M, ty + 18);
      x.save(); x.strokeStyle = ink; x.lineWidth = 1.5; x.beginPath(); x.moveTo(M, ty + 26); x.lineTo(W - M, ty + 26); x.stroke(); x.restore();
      list.forEach(function(v, k){
        var ry = ty + 30 + k * rowH, picks = String(v.sig || "").split(" ");
        if(k % 2 === 1){ x.fillStyle = "rgba(141,127,99,.12)"; x.fillRect(M, ry, W - 2 * M, rowH); }
        x.font = "700 15px " + PS; x.fillStyle = ink; x.fillText(String(k + 1) + ".", M + 4, ry + 22);
        x.font = "400 14px " + PS; x.fillStyle = mute;
        var n2 = v.combos || 1, c2 = v.cost != null ? v.cost : n2 * g.price;
        x.fillText(fmt(n2) + " вар.  ·  " + fmt(c2) + " ₽", M + 34, ry + 22);
        picks.forEach(function(p, i){
          var bx = gridX + i * cellW;
          x.strokeStyle = rule; x.lineWidth = 1; x.strokeRect(bx + 2.5, ry + 5.5, cellW - 5, rowH - 11);
          x.fillStyle = ink; x.textAlign = "center";
          x.font = (p.length >= 3 ? "700 11px " : (p.length === 2 ? "700 13px " : "700 15px ")) + MONO;
          x.fillText(p, bx + cellW / 2, ry + 22); x.textAlign = "left";
        });
        x.save(); x.strokeStyle = "rgba(141,127,99,.45)"; x.beginPath(); x.moveTo(M, ry + rowH); x.lineTo(W - M, ry + rowH); x.stroke(); x.restore();
      });
      var fy = ty + 30 + list.length * rowH + 30;
      line(fy, 3); line(fy + 5, 1);
      x.font = "italic 400 13px " + PS; x.fillStyle = mute;
      x.fillText("Отпечатано " + new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " · на сайте ДЖЕК 15", M, fy + 30);
      /* штамп */
      x.save(); x.translate(W - M - 92, fy + 44); x.rotate(-0.1);
      x.strokeStyle = "rgba(142,42,30,.8)"; x.lineWidth = 2.5; x.strokeRect(-86, -26, 172, 52);
      x.lineWidth = 1; x.strokeRect(-81, -21, 162, 42);
      x.fillStyle = "rgba(142,42,30,.85)"; x.textAlign = "center"; x.font = "700 20px " + OS; x.fillText("ДЖЕК 15", 0, 0);
      x.font = "400 11px " + OS; x.fillText("ТИРАЖ №" + (g.tirazh || "—"), 0, 15); x.restore();
      cv.toBlob(function(b){
        if(!b) return;
        var name = "dzhek15_" + (g.tirazh || "") + "_korzina.png", f = null;
        try{ f = new File([b], name, { type: "image/png" }); }catch(e){}
        if(f && navigator.canShare && navigator.canShare({ files: [f] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)){
          navigator.share({ files: [f], title: "Корзина ДЖЕК 15" }).catch(function(){}); return;
        }
        var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name;
        document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      }, "image/png");
    });
  }
  if($("btnHistDoc")) $("btnHistDoc").addEventListener("click", basketDoc);

  /* Обои внутри таблиц в режиме просмотра: вместо чёрного фона таблиц — плавно сменяющиеся прозрачные картинки
     на тему футбольных новостей. Список берётся из data/wallpapers.json (после ИИ-разбора конвейер подставляет свежий набор). */
  var wp = { list: null, i: -1, front: 0, timer: 0, loading: false, cur: "" };
  function wpPanels(){ return [$("coupon"), $("prevCsv")].filter(Boolean); }
  function wpEnsure(){
    wpPanels().forEach(function(p){
      var f = null; for(var k = 0; k < p.children.length; k++){ if(p.children[k].classList.contains("wpPane")){ f = p.children[k]; break; } }
      if(!f){
        f = document.createElement("div"); f.className = "wpPane"; f.setAttribute("aria-hidden", "true"); f.innerHTML = "<i></i><i></i>";
        p.insertBefore(f, p.firstChild);
      }
      if(wp.cur){
        var ii = f.children, fr = wp.front;
        if(!ii[fr].style.backgroundImage){ ii[fr].style.backgroundImage = "url(" + wp.cur + ")"; ii[fr].classList.add("wp-on"); }
      }
    });
  }
  function wpLoad(cb){
    if(wp.list && Date.now() - (wp.at || 0) < 3600000){ cb(); return; }
    if(wp.list) wp.list = null;
    if(wp.loading) return;
    wp.loading = true;
    fetch("data/wallpapers.json?x=" + Math.floor(Date.now() / 600000), { cache: "no-cache" }).then(function(r){ return r.json(); }).then(function(j){
      var all = ((j && j.items) || []).filter(function(it){ return it && it.src; });
      /* база копится каждый день: свежие обои (первые четыре) идут первыми, остальные из базы — вперемешку */
      var fresh = all.slice(0, 4), rest = all.slice(4), q, r, t;
      for(q = rest.length - 1; q > 0; q--){ r = Math.floor(Math.random() * (q + 1)); t = rest[q]; rest[q] = rest[r]; rest[r] = t; }
      wp.list = fresh.concat(rest); wp.at = Date.now();
      wp.loading = false; if(wp.list.length) cb();
    }).catch(function(){ wp.loading = false; });
  }
  function wpSrc(it){ return (document.documentElement.getAttribute("data-theme") === "light" && it.light) ? it.light : it.src; }
  function wpShow(keep){
    if(!wp.list || !wp.list.length) return;
    if(keep !== true) wp.i = (wp.i + 1) % wp.list.length;
    if(wp.i < 0) wp.i = 0;
    var it = wp.list[wp.i], im = new Image(), src = wpSrc(it);
    im.onload = function(){
      wp.err = 0; wpEnsure();
      var nx = wp.front ^ 1;
      wpPanels().forEach(function(p){
        var f = p.querySelector(":scope > .wpPane"); if(!f) return;
        var a = f.children[nx], b = f.children[wp.front];
        a.style.backgroundImage = "url(" + src + ")";
        a.classList.remove("wp-on"); void a.offsetWidth; a.classList.add("wp-on");
        b.classList.remove("wp-on");
      });
      wp.front = nx; wp.cur = src;
    };
    im.onerror = function(){ if(!wp.err || wp.err < 3){ wp.err = (wp.err || 0) + 1; wpShow(); } };
    im.src = src;
  }
  function wpSync(){
    var on = document.body.classList.contains("is-prev");
    if(on){ wpEnsure(); }
    if(on && !wp.timer){
      wpLoad(function(){ if(!wp.timer){ wpShow(); wp.timer = setInterval(function(){ if(Date.now() - (wp.at || 0) >= 3600000) wpLoad(function(){}); wpShow(); }, 24000); } });
    }
    if(!on && wp.timer){ clearInterval(wp.timer); wp.timer = 0; }
  }
  try{
    new MutationObserver(wpSync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    if($("prevCsv")) new MutationObserver(function(){ if(document.body.classList.contains("is-prev")) wpEnsure(); }).observe($("prevCsv"), { childList: true });
    new MutationObserver(function(){ if(wp.timer) wpShow(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    wpSync();
  }catch(e){}

  function all(){ try{ renderCover(); decorateBasket(); }catch(e){ if(window.console) console.warn("ДЖЕК visual:", e); } }
  document.addEventListener("dz:render", function(){ all(); setTimeout(function(){ try{ renderCover(); }catch(e){} }, 0); });
  setInterval(function(){ try{ renderCover(); }catch(e){} }, 30000);
  /* длинные числа на обложке (суперприз 14 287 926) не обрезаются: шрифт уменьшается, пока число не поместится */
  function fitNum(el){
    if(!el) return;
    el.style.fontSize = "";
    var fs = parseFloat(getComputedStyle(el).fontSize) || 32;
    while(el.scrollWidth > el.clientWidth + 1 && fs > 14){ fs -= 1; el.style.fontSize = fs + "px"; }
  }
  function fitAll(){ try{ fitNum(cvJack); fitNum(cvNum); }catch(e){} }
  [cvJack, cvNum].forEach(function(el){ if(el && window.MutationObserver) new MutationObserver(fitAll).observe(el, { childList: true, characterData: true, subtree: true }); });
  window.addEventListener("resize", fitAll);
  setTimeout(fitAll, 400);
  all();
})();
