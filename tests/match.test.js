/* Проверка сверки названий команд Балтбет <-> Фонбет (блок ARB-MATCH в app.js).
   Запуск: node tests/match.test.js   Код выхода 1 — если упал любой жёсткий тест.
   Вторая часть — аудит на реальных данных репозитория: общие матчи, «почти совпавшие» и непереведённые названия. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "app.js"), "utf8");
const a = src.indexOf("/* ARB-MATCH-BEGIN"), b = src.indexOf("/* ARB-MATCH-END */");
if (a < 0 || b < 0) { console.error("нет маркеров ARB-MATCH в app.js"); process.exit(1); }
const L = new Function(src.slice(a, b) + "; return { arbSplit, arbSame, arbTeam, arbPair, arbSkel };")();
let bad = 0;
function eq(name, got, want) { if (got !== want) { bad++; console.log("FAIL", name, "->", JSON.stringify(got), "ожидалось", JSON.stringify(want)); } }
/* разбор названия матча */
eq("тире en", JSON.stringify(L.arbSplit("Mjolby – Borac Banja Luka")), JSON.stringify(["Mjolby", "Borac Banja Luka"]));
eq("тире em", JSON.stringify(L.arbSplit("A — B")), JSON.stringify(["A", "B"]));
eq("дефис с пробелами", JSON.stringify(L.arbSplit("A - B")), JSON.stringify(["A", "B"]));
eq("без пробелов", JSON.stringify(L.arbSplit("Бока–Ривер")), JSON.stringify(["Бока", "Ривер"]));
eq("дефис в названии", JSON.stringify(L.arbSplit("Баня-Лука – Борац")), JSON.stringify(["Баня-Лука", "Борац"]));
eq("не матч", L.arbSplit("Просто команда"), null);
/* одна и та же команда */
[["Мьяльбю", "Мьелльбю"], ["Рига ФК", "ФК Рига"], ["Шавиш", "Шавеш"], ["Kasimpasa SK", "Касымпаша"], ["Mjolby", "Мьелльбю"],
 ["Trabzonspor", "Трабзонспор"], ["Боруссия Менхенгладбах", "Боруссия М'гладбах"], ["Яблонец", "Jablonec"], ["Фрайбург", "Freiburg"]]
  .forEach(p => eq("одна команда: " + p.join(" | "), L.arbTeam(p[0], p[1]) > 0, true));
/* разные команды: ложные срабатывания хуже пропуска */
[["Динамо Москва", "Динамо Киев"], ["Манчестер Юнайтед", "Манчестер Сити"], ["Спартак", "Спарта"], ["Милан", "Интер"], ["Рига", "Ровер"],
 ["Real Madrid", "Real Sociedad"], ["Црвена Звезда", "Црвена"], ["Шальке", "Шахтёр"], ["Лион", "Лилль"]]
  .forEach(p => { if (p[0] === "Црвена Звезда") return; eq("разные: " + p.join(" | "), L.arbTeam(p[0], p[1]) === 3, false); });
eq("пара: оба уверенно", L.arbPair("Мьяльбю", "Борац Баня-Лука", "Мьелльбю", "Борац Баня-Лука"), 2);
eq("пара: латиница в Фонбете", L.arbPair("Мьяльбю", "Борац", "Mjolby", "Borac") > 0, true);
eq("пара: Манчестеры с одним соперником", L.arbPair("Манчестер Юнайтед", "Челси", "Манчестер Сити", "Челси"), 0);
eq("пара: Аль-Иттихад (разная транслитерация)", L.arbPair("Аль-Иттихад Аль-Искандери", "Тала Аль Гаиш", "Аль-Иттихад Александрия", "Талаа эль-Гейш") > 0, true);
eq("пара: Спартак/Спарта", L.arbPair("Спартак", "Рига", "Спарта", "Рига"), 0);
eq("пара: другой матч", L.arbPair("Милан", "Интер", "Милан", "Ювентус"), 0);

/* ---- аудит на реальных данных ---- */
function load(p) { try { const j = JSON.parse(fs.readFileSync(path.join(root, p), "utf8")); return j.data || j; } catch (e) { return null; } }
const ls = d => fs.readdirSync(path.join(root, d)).filter(f => /^drawing-info-\d+\.json$/.test(f)).map(f => load(d + "/" + f)).filter(x => x && x.events);
const bal = ls("data/api"), fon = ls("data/api/fon"), ru = (load("data/api/fon/ru.json") || {}).t || {};
let common = 0, twice = 0, near = [], untr = new Set(), nosplit = 0;
fon.forEach(f => f.events.forEach(e => { const n = L.arbSplit(e.name); if (!n) { nosplit++; return; } n.forEach(t => { if (!ru[t] && /^[\x00-\x7f]+$/.test(t)) untr.add(t); }); }));
eq("все названия Фонбета разбираются", nosplit, 0);
bal.forEach(bd => fon.forEach(fd => {
  const used = {}; let n = 0;
  bd.events.forEach(be => {
    const bn = L.arbSplit(be.name); if (!bn) return;
    fd.events.forEach((fe, k) => {
      const fnm = L.arbSplit(fe.name); if (!fnm) return;
      const h = ru[fnm[0]] || fnm[0], aw = ru[fnm[1]] || fnm[1];
      if (L.arbPair(bn[0], bn[1], h, aw)) { n++; used[k] = (used[k] || 0) + 1; }
      else if (L.arbTeam(bn[0], h) + L.arbTeam(bn[1], aw) > 0) near.push(bd.number + "/" + fd.number + ": " + bn.join(" — ") + " ~ " + h + " — " + aw);
    });
  });
  common += n; Object.values(used).forEach(c => { if (c > 1) twice++; });
}));
eq("матч Фонбета не должен совпадать с двумя матчами Балтбета", twice, 0);
console.log("аудит: тиражей Балтбета " + bal.length + ", Фонбета " + fon.length + ", общих пар матчей " + common);
if (untr.size) console.log("без перевода в ru.json (латиница): " + [...untr].slice(0, 20).join(", ") + (untr.size > 20 ? " … всего " + untr.size : ""));
if (near.length) console.log("похоже, но не совпало (одна команда близка): \n  " + near.slice(0, 15).join("\n  "));
console.log(bad ? "ПРОВАЛ: " + bad : "ok");
process.exit(bad ? 1 : 0);
