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
    cvNum.textContent = g.tirazh ? "№" + g.tirazh : "№—";
    var jt = g.jackpot ? fmt(g.jackpot) + "\u00a0₽" : "—";
    if(jt !== lastJack){
      if(g.jackpot && !cover.dataset.anim){ cover.dataset.anim = "1"; scramble(cvJack, jt); } else cvJack.textContent = jt;
      lastJack = jt;
    }
    var ko = ($("koTime") || {}).textContent || "—", left = ($("koLeft") || {}).textContent || "";
    cvSub.innerHTML = '<span>приём до ' + esc(ko.replace(/\s+/g, " ").trim()) + '</span>' +
      (left && left.trim() !== "—" ? ' <span>· осталось ' + esc(left.trim()) + '</span>' : "");
    var d = new Date();
    cvDate.textContent = d.toLocaleDateString("ru-RU", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
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

  /* ---------- корзина: купоны как билеты, скачать картинкой ---------- */
  function ticketPng(v, idx){
    var g = window.DZ.get(), ms = g.matches, picks = String(v.sig || "").split(" ");
    var dpr = 2, W = 720, rowH = 34, top = 150, H = top + ms.length * rowH + 96;
    var cv = document.createElement("canvas"); cv.width = W * dpr; cv.height = H * dpr;
    var x = cv.getContext("2d"); x.scale(dpr, dpr);
    var paper = "#f6f1e4", ink = "#1c1a16", gold = "#b08a3a", mute = "#6b6354";
    x.fillStyle = "#1a1410"; x.fillRect(0, 0, W, H);
    /* бумага с вырезами по бокам */
    x.fillStyle = paper;
    x.beginPath(); x.moveTo(16, 16); x.lineTo(W - 16, 16); x.lineTo(W - 16, top - 22);
    x.arc(W - 16, top - 10, 12, -Math.PI / 2, Math.PI / 2, true); x.lineTo(W - 16, H - 16); x.lineTo(16, H - 16);
    x.lineTo(16, top + 2); x.arc(16, top - 10, 12, Math.PI / 2, -Math.PI / 2, true); x.closePath(); x.fill();
    x.setLineDash([6, 6]); x.strokeStyle = gold; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(34, top - 10); x.lineTo(W - 34, top - 10); x.stroke(); x.setLineDash([]);
    x.fillStyle = ink; x.textBaseline = "alphabetic";
    x.font = "700 34px Georgia, 'Times New Roman', serif"; x.fillText("ДЖЕК 15", 40, 66);
    x.font = "600 15px 'IBM Plex Mono', monospace"; x.fillStyle = mute;
    x.fillText("ТИРАЖ №" + (g.tirazh || "—") + "  ·  " + (v.at || "") + "  ·  " + String(v.label || "").slice(0, 34), 40, 96);
    var n = v.combos || 1, cost = v.cost != null ? v.cost : n * g.price;
    x.font = "700 18px 'IBM Plex Mono', monospace"; x.fillStyle = ink;
    x.textAlign = "right"; x.fillText(fmt(n) + " вар. · " + fmt(cost) + " ₽", W - 40, 66); x.textAlign = "left";
    ms.forEach(function(m, i){
      var y = top + 8 + i * rowH, p = picks[i] || "";
      if(i % 2 === 0){ x.fillStyle = "rgba(176,138,58,.08)"; x.fillRect(30, y - 4, W - 60, rowH); }
      x.fillStyle = mute; x.font = "600 14px 'IBM Plex Mono', monospace"; x.fillText(String(i + 1).padStart(2, " "), 40, y + 19);
      x.fillStyle = ink; x.font = "600 16px 'IBM Plex Sans', Arial, sans-serif";
      var name = m.home + " — " + m.away; while(x.measureText(name).width > 430 && name.length > 8) name = name.slice(0, -2);
      if(name !== m.home + " — " + m.away) name += "…";
      x.fillText(name, 74, y + 19);
      OUT.forEach(function(o, k){
        var bx = W - 186 + k * 50, on = p.indexOf(o) >= 0;
        x.strokeStyle = on ? ink : "rgba(28,26,22,.25)"; x.lineWidth = 1.5;
        x.fillStyle = on ? ink : "transparent";
        x.beginPath(); if(x.roundRect) x.roundRect(bx, y, 40, 26, 4); else x.rect(bx, y, 40, 26); x.fill(); x.stroke();
        x.fillStyle = on ? paper : "rgba(28,26,22,.35)"; x.font = "700 15px 'IBM Plex Mono', monospace"; x.textAlign = "center";
        x.fillText(o, bx + 20, y + 18); x.textAlign = "left";
      });
    });
    /* печать */
    var sy = H - 56;
    x.save(); x.translate(W - 120, sy); x.rotate(-0.12);
    x.strokeStyle = "rgba(160,40,30,.75)"; x.lineWidth = 2.5; x.beginPath(); if(x.roundRect) x.roundRect(-74, -22, 148, 44, 8); else x.rect(-74, -22, 148, 44); x.stroke();
    x.fillStyle = "rgba(160,40,30,.8)"; x.font = "700 16px Georgia, serif"; x.textAlign = "center"; x.fillText("ДЖЕК 15", 0, -2);
    x.font = "600 10px 'IBM Plex Mono', monospace"; x.fillText("ТИРАЖ №" + (g.tirazh || "—"), 0, 14); x.restore();
    x.fillStyle = mute; x.font = "500 12px 'IBM Plex Mono', monospace"; x.fillText("dzhek15.github.io", 40, H - 34);
    cv.toBlob(function(b){
      if(!b) return;
      var name = "dzhek15_" + (g.tirazh || "") + "_" + (idx + 1) + ".png";
      var f = null; try{ f = new File([b], name, { type: "image/png" }); }catch(e){}
      if(f && navigator.canShare && navigator.canShare({ files: [f] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)){
        navigator.share({ files: [f], title: "Купон ДЖЕК 15" }).catch(function(){});
        return;
      }
      var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }, "image/png");
  }
  var IMG_ICO = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="15" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.5"/><path d="M17.5 13l-4-4-7 7"/></svg>';
  function decorateBasket(){
    var ul = $("hist"); if(!ul || !window.DZ) return;
    var g = window.DZ.get();
    Array.prototype.forEach.call(ul.children, function(li, i){
      li.classList.add("tkt");
      if(li.querySelector(".tk-img")) return;
      var acts = li.querySelector(".hist-acts"); if(!acts) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "tk-img"; b.innerHTML = IMG_ICO;
      b.title = "Скачать этот купон картинкой — билетом ДЖЕК 15";
      b.setAttribute("aria-label", "Скачать купон картинкой");
      b.addEventListener("click", function(){ var v = window.DZ.get().played[i]; if(v) ticketPng(v, i); });
      acts.insertBefore(b, acts.firstChild);
    });
  }

  function all(){ try{ renderCover(); decorateBasket(); }catch(e){ if(window.console) console.warn("ДЖЕК visual:", e); } }
  document.addEventListener("dz:render", all);
  setInterval(function(){ try{ renderCover(); }catch(e){} }, 30000);
  all();
})();
