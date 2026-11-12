/* итог матча по Flashscore — счёт основного времени (без овертайма, буллитов, доп. времени, пенальти) */
var fs = require("fs"), src = fs.readFileSync(__dirname + "/../app.js", "utf8");
var a = src.indexOf("function fsFinished(f)"), b = src.indexOf("function fsLiveTick()");
if(a < 0 || b < 0) throw new Error("блок fsFinished не найден");
var api = new Function(src.slice(a, b) + "; return { fin: fsFinished, reg: fsRegScore };")();
var bad = 0;
function eq(name, got, want){ if(JSON.stringify(got) !== JSON.stringify(want)){ bad++; console.log("FAIL", name, JSON.stringify(got), "ожидали", JSON.stringify(want)); } }
/* хоккей: 3:4 после буллитов, основное время 3:3 → ничья */
eq("хоккей буллиты", api.reg({ st: "3", sc: "11", hs: "3", as: "4", rh: "3", ra: "3" }), [3, 3]);
/* хоккей: овертайм 4:5, основное время 4:4 */
eq("хоккей ОТ", api.reg({ st: "3", sc: "10", hs: "4", as: "5", rh: "4", ra: "4" }), [4, 4]);
/* обычный финал */
eq("обычный", api.reg({ st: "3", sc: "3", hs: "2", as: "1", rh: "2", ra: "1" }), [2, 1]);
eq("обычный без AT/AU", api.reg({ st: "3", sc: "3", hs: "2", as: "1" }), [2, 1]);
/* ОТ/буллиты без счёта основного времени — итог не фиксируем */
eq("ОТ без AT/AU", api.reg({ st: "3", sc: "10", hs: "4", as: "5" }), null);
eq("финал 10", api.fin({ st: "3", sc: "10" }), true);
eq("финал 11", api.fin({ st: "3", sc: "11" }), true);
eq("перенесён", api.fin({ st: "3", sc: "4" }), false);
eq("отменён", api.fin({ st: "3", sc: "5" }), false);
eq("идёт", api.fin({ st: "2", sc: "12" }), false);
if(bad){ process.exit(1); } console.log("ok fsfinal");
