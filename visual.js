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
    var e = function(n){ var t = D && D.team(n); return t && t.id ? '<img class="cv-emb" src="icons/teams/' + t.id + '.webp" width="18" height="18" alt="" decoding="async">' : ''; };
    return '<button type="button" class="cv-chip" data-i="' + i + '"><i>' + (i + 1) + '</i>' + e(m.home) + '<span>' + esc(m.home) +
           '</span><em>—</em><span>' + esc(m.away) + '</span>' + e(m.away) + '</button>';
  }
  function renderCover(){
    if(!cover || !window.DZ) return;
    var g = window.DZ.get();
    cvNum.innerHTML = '<small>№</small>' + (g.tirazh ? esc(g.tirazh) : "—");
    var jt = g.jackpot ? fmt(g.jackpot) + "\u00a0₽" : "—";
    if(jt !== lastJack){
      if(g.jackpot && !cover.dataset.anim){ cover.dataset.anim = "1"; scramble(cvJack, jt); } else cvJack.textContent = jt;
      lastJack = jt;
    }
    var ko = ($("koTime") || {}).textContent || "—", left = ($("koLeft") || {}).textContent || "";
    cvSub.innerHTML = '<span class="cv-s1"><em>приём до</em> ' + esc(ko.replace(/\s+/g, " ").trim()) + '</span>' +
      (left && left.trim() !== "—" ? '<i class="cv-sep" aria-hidden="true"></i><span class="cv-s2"><em>осталось</em> ' + esc(left.trim()) + '</span>' : "");
    var pool = ($("tkFund") || {}).textContent || "";
    var pe = $("cvPool"), has = pool && pool.trim() !== "—";
    pe.innerHTML = has ? '<em>Пул</em><b>' + esc(pool.trim()) + '</b>' : "&nbsp;";
    pe.classList.toggle("is-on", !!has);
    var d = new Date();
    cvDate.textContent = d.toLocaleDateString("ru-RU", { weekday:"long", day:"numeric", month:"long" });
    var sig = g.matches.map(function(m){ return m.home + "|" + m.away + (window.DZ.team(m.home) ? "+" : ""); }).join(";");
    if(sig !== lastTicker && g.matches.length){
      lastTicker = sig;
      var one = g.matches.map(chipHtml).join('<b class="cv-dot" aria-hidden="true">◆</b>');
      cvTrack.innerHTML = '<div class="cv-run">' + one + '<b class="cv-dot" aria-hidden="true">◆</b></div>' +
                          '<div class="cv-run" aria-hidden="true">' + one + '<b class="cv-dot">◆</b></div>';
      var n = g.matches.length;
      cvTrack.style.setProperty("--cv-dur", Math.max(40, n * 5) + "s");
    }
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

  function all(){ try{ renderCover(); decorateBasket(); }catch(e){ if(window.console) console.warn("ДЖЕК visual:", e); } }
  document.addEventListener("dz:render", all);
  setInterval(function(){ try{ renderCover(); }catch(e){} }, 30000);
  all();
})();
