/*
  Автономный разбор тиража Балтсистемы — запускается GitHub Actions по расписанию.

  Как ищет команды (главная сложность: totobrief даёт русские названия,
  открытые базы — английские):
    1. Берёт с api-football ВСЕ футбольные матчи за дату тиража и соседние дни.
    2. Русское название переводит в латиницу по правилам, которыми русский
       передаёт английские слова («х» → h, «э» → e), и сводит обе стороны
       к «скелету»: гласные схлопываются, v/w, c/k/q, s/z считаются одной
       буквой. «Вест Хэм» и «West Ham United» после этого почти совпадают.
    3. Сопоставляет матч целиком, парой названий сразу — так надёжнее,
       чем по одной команде.
    4. Если по расписанию дня не нашлось, пробует прямой поиск по словарю
       data/teams.json.

  Дальше по найденным командам считает ЧИСТЫЕ серии по правилам методики:
  3+ подряд побед, ИЛИ поражений, ИЛИ ничьих, отдельно по площадке,
  без склейки через межсезонье (окно 150 дней).

  Нужен бесплатный ключ api-football в секрете APIFOOTBALL_KEY:
  100 запросов в сутки, нам хватает примерно тридцати на прогон.
*/

import { readFile, writeFile } from "node:fs/promises";

const TB = "https://totobrief.com/api/v1/community/";
const AF = "https://v3.football.api-sports.io/";
const AF_KEY = process.env.APIFOOTBALL_KEY || "";
const MAX_PAGES = 8;     /* страниц расписания за один день, чтобы не съесть дневной лимит */

const WINDOW_DAYS = 150;
const STREAK_MIN = 3;
const PAIR_MIN = 0.50;   /* средняя похожесть пары, ниже которой матч не принимаем */
const SIDE_MIN = 0.30;   /* и ни одна из сторон не должна быть совсем мимо */

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "tototik-analyzer" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries) throw new Error(`${url} — ${e.message}`);
      await sleep(700 * i);
    }
  }
}

let afCalls = 0;
let afLast = 0;

/* бесплатный тариф: не больше 10 запросов в минуту, поэтому держим паузу */
const AF_GAP = 7000;

/* запрос к api-football: ключ уходит заголовком, в лог не попадает */
async function af(path, retry = true) {
  if (!AF_KEY) throw new Error("не задан секрет APIFOOTBALL_KEY");
  const wait = AF_GAP - (Date.now() - afLast);
  if (wait > 0) await sleep(wait);
  afLast = Date.now();
  afCalls++;
  const r = await fetch(AF + path, { headers: { "x-apisports-key": AF_KEY } });
  if (r.status === 429 && retry) {
    log("    лимит запросов в минуту — жду минуту");
    await sleep(62000);
    return af(path, false);
  }
  if (!r.ok) throw new Error(`api-football ${path}: HTTP ${r.status}`);
  const j = await r.json();
  const errs = j && j.errors;
  const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
  if (hasErr) throw new Error(`api-football ${path}: ${JSON.stringify(errs)}`);
  return j;
}

/* ---------- названия ---------- */

/* Пары сначала длинные: порядок важен */
const RULES = [
  ["дж", "j"], ["кс", "x"], ["ей", "ey"], ["ай", "ai"], ["ой", "oy"], ["ый", "y"],
  ["ия", "ia"], ["ья", "ia"], ["ьи", "i"], ["тч", "tch"], ["сч", "sh"],
  ["щ", "sh"], ["ч", "ch"], ["ш", "sh"], ["ж", "zh"], ["ц", "ts"],
  ["ю", "yu"], ["я", "ya"], ["ё", "e"], ["х", "h"], ["э", "e"],
  ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["е", "e"],
  ["з", "z"], ["и", "i"], ["й", "y"], ["к", "k"], ["л", "l"], ["м", "m"],
  ["н", "n"], ["о", "o"], ["п", "p"], ["р", "r"], ["с", "s"], ["т", "t"],
  ["у", "u"], ["ф", "f"], ["ы", "y"], ["ъ", ""], ["ь", ""],
];

function translit(name) {
  let s = String(name || "").toLowerCase();
  for (const [from, to] of RULES) s = s.split(from).join(to);
  return s.replace(/\s+/g, " ").trim();
}

/* слова-пустышки, которые в одной базе есть, а в другой нет */
const NOISE = new RegExp(
  "\\b(fc|cf|afc|sc|ac|as|ss|ssd|us|ud|cd|sd|rc|ca|cp|club|de|the|team|city|town|united|athletic|wanderers|rovers|county|fk|fc)\\b",
  "g"
);

/* «скелет» названия: то, что остаётся, если не придираться к гласным и к v/w, c/k */
function skel(s, dropNoise) {
  let x = String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  if (dropNoise) x = x.replace(NOISE, " ");
  return x
    .replace(/wh/g, "v")          /* Whitehawk ≈ Уайтхок */
    .replace(/ph/g, "f")
    .replace(/[wv]/g, "v")
    .replace(/[ckq]/g, "k")
    .replace(/[zs]/g, "s")
    .replace(/[gh]/g, "g")        /* английское H русский пишет и как «х», и как «г» */
    .replace(/[aeiouy]+/g, "a")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tri(s) {
  const x = "  " + s + "  ";
  const out = new Set();
  for (let i = 0; i < x.length - 2; i++) out.add(x.slice(i, i + 3));
  return out;
}

function simRaw(a, b) {
  const A = tri(a), B = tri(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.max(A.size, B.size);
}

/* похожесть русского названия и английского: сравниваем скелеты,
   отдельно со словами-пустышками и без них, берём лучшее */
function sim(ruLat, en) {
  const a1 = skel(ruLat, false), b1 = skel(en, false);
  const a2 = skel(ruLat, true), b2 = skel(en, true);
  let best = Math.max(simRaw(a1, b1), simRaw(a2, b2));
  /* короткое название внутри длинного — «Барнсли» в «Barnsley FC» */
  if (a2 && b2 && (b2.includes(a2) || a2.includes(b2))) best = Math.max(best, 0.8);
  return best;
}

/* ---------- расписание дня ---------- */

function daysAround(iso) {
  const base = iso ? Date.parse(String(iso).slice(0, 10) + "T00:00:00Z") : Date.now();
  const out = [];
  for (const shift of [-1, 0, 1]) {
    out.push(new Date(base + shift * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/* бесплатный тариф отдаёт расписание только на вчера/сегодня/завтра */
function withinFreeWindow(d) {
  const today = Date.now();
  const t = Date.parse(d + "T12:00:00Z");
  const diff = Math.round((t - today) / 86400000);
  return diff >= -1 && diff <= 1;
}

async function fixturesFor(dates) {
  const all = [];
  for (const d of dates) {
    if (!withinFreeWindow(d)) { log(`  ${d}: вне окна бесплатного тарифа (вчера–завтра), пропускаю`); continue; }
    for (let page = 1; page <= MAX_PAGES; page++) {
      let j;
      try {
        j = await af(`fixtures?date=${d}` + (page > 1 ? `&page=${page}` : ""));
      } catch (e) {
        log(`  расписание за ${d}, стр. ${page}: ${e.message}`);
        break;
      }
      const list = j.response || [];
      if (page === 1) log(`  ${d}: матчей ${j.results || list.length}, страниц ${(j.paging && j.paging.total) || 1}`);
      for (const e of list) {
        const t = e.teams || {};
        if (!t.home || !t.away) continue;
        all.push({
          home: t.home.name, away: t.away.name,
          homeId: t.home.id, awayId: t.away.id,
          league: ((e.league && e.league.country) ? e.league.country + ". " : "") + ((e.league && e.league.name) || ""),
          date: (e.fixture && e.fixture.date || "").slice(0, 10),
        });
      }
      const total = (j.paging && j.paging.total) || 1;
      if (page >= total) break;
      await sleep(200);
    }
  }
  return all;
}

function bestFixture(homeRu, awayRu, fixtures) {
  const h = translit(homeRu), a = translit(awayRu);
  let best = null, bestScore = 0, second = 0;
  for (const f of fixtures) {
    const sh = sim(h, f.home), sa = sim(a, f.away);
    if (sh < SIDE_MIN || sa < SIDE_MIN) continue;
    const score = (sh + sa) / 2;
    if (score > bestScore) { second = bestScore; bestScore = score; best = { ...f, sh, sa }; }
    else if (score > second) second = score;
  }
  if (!best || bestScore < PAIR_MIN) return null;
  best.score = Number(bestScore.toFixed(2));
  best.margin = Number((bestScore - second).toFixed(2));
  return best;
}

/* ---------- запасной путь: поиск команды по названию ---------- */

const searchCache = new Map();

/* Прямой поиск идёт ТОЛЬКО по словарю data/teams.json: транслит вида
   «uaithok» вместо Whitehawk находит случайные клубы, а пустая подсказка
   лучше неверной. Нет команды в словаре — матч остаётся без подсказки. */
async function searchTeam(ruName, dict) {
  const lat = translit(ruName);
  if (searchCache.has(lat)) return searchCache.get(lat);
  const plain = String(ruName || "").toLowerCase().replace(/ё/g, "е")
    .replace(/\bфк\b/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const q = dict[plain];
  if (!q) { searchCache.set(lat, null); return null; }
  let found = null;
  try {
    const j = await af(`teams?search=${encodeURIComponent(q)}`);
    let bestT = null, bestS = 0;
    for (const row of j.response || []) {
      const t = row.team || {};
      const s2 = sim(q, t.name || "");
      if (s2 > bestS) { bestS = s2; bestT = t; }
    }
    if (bestT && bestS >= 0.7) found = { id: bestT.id, name: bestT.name, score: Number(bestS.toFixed(2)) };
  } catch (e) {
    log(`    поиск «${q}»: ${e.message}`);
  }
  searchCache.set(lat, found);
  return found;
}

/* ---------- форма и серии ---------- */

const lastCache = new Map();

async function lastEvents(teamId) {
  if (lastCache.has(teamId)) return lastCache.get(teamId);
  let j;
  try { j = await af(`fixtures?team=${teamId}&last=12`); }
  catch (e) { log(`    матчи команды ${teamId}: ${e.message}`); lastCache.set(teamId, []); return []; }
  const edge = Date.now() - WINDOW_DAYS * 86400000;
  const rows = (j.response || [])
    .map((e) => ({
      date: Date.parse((e.fixture && e.fixture.date) || ""),
      homeId: e.teams && e.teams.home && e.teams.home.id,
      awayId: e.teams && e.teams.away && e.teams.away.id,
      hs: Number(e.goals && e.goals.home),
      as: Number(e.goals && e.goals.away),
    }))
    .filter((e) => isFinite(e.date) && e.date >= edge && isFinite(e.hs) && isFinite(e.as))
    .sort((a, b) => b.date - a.date);
  lastCache.set(teamId, rows);
  return rows;
}

function outcomeFor(ev, teamId) {
  const atHome = String(ev.homeId) === String(teamId);
  const my = atHome ? ev.hs : ev.as;
  const their = atHome ? ev.as : ev.hs;
  return my > their ? "W" : my < their ? "L" : "D";
}

function venueStreak(events, teamId, venue) {
  const rows = events.filter((e) =>
    venue === "home" ? String(e.homeId) === String(teamId) : String(e.awayId) === String(teamId)
  );
  if (rows.length < STREAK_MIN) return null;
  const first = outcomeFor(rows[0], teamId);
  let n = 1;
  for (let i = 1; i < rows.length; i++) {
    if (outcomeFor(rows[i], teamId) !== first) break;
    n++;
  }
  return n >= STREAK_MIN ? { kind: first, len: n } : null;
}

const WORD = {
  home: { W: "побед подряд дома", L: "поражений подряд дома", D: "ничьих подряд дома" },
  away: { W: "побед подряд на выезде", L: "поражений подряд на выезде", D: "ничьих подряд на выезде" },
};

/* ---------- сборка ---------- */

async function main() {
  const dict = JSON.parse(await readFile(new URL("../data/teams.json", import.meta.url), "utf8"));

  log("Беру список тиражей с totobrief…");
  const list = await getJson(TB + "baltbet-main/drawings?page=1");
  const rows = (list && list.data) || [];
  const draw = rows.find((d) => d.status === "active") || rows[0];
  if (!draw) throw new Error("тиражи не найдены");
  log(`Тираж №${draw.number} (id ${draw.id}), приём до ${draw.ended_at}`);

  const info = await getJson(TB + "drawing-info/" + draw.id);
  const data = info.data || info;
  const events = (data.events || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!events.length) throw new Error("в тираже нет матчей");

  log("\nТяну расписание матчей за эти даты:");
  const fixtures = await fixturesFor(daysAround(draw.ended_at));
  log(`Всего кандидатов: ${fixtures.length}`);

  const out = {
    tirazh: String(draw.number),
    drawingId: draw.id,
    endedAt: draw.ended_at || "",
    generatedAt: new Date().toISOString(),
    source: "totobrief + api-football",
    rules: `чистая серия от ${STREAK_MIN} матчей, по площадке, окно ${WINDOW_DAYS} дней`,
    matches: [],
  };

  const misses = [];

  for (const ev of events) {
    const parts = String(ev.name || "").split(/\s+[—–−-]\s+/);
    const home = (parts[0] || "").trim();
    const away = (parts.slice(1).join(" - ") || "").trim();
    log(`\n${home} — ${away}  [${ev.championship || ""}]`);

    const rec = { home, away, hints: [], suggest: null, resolved: false };
    let hId = null, aId = null;

    const fx = bestFixture(home, away, fixtures);
    if (fx) {
      hId = fx.homeId; aId = fx.awayId;
      log(`  ✓ по расписанию: ${fx.home} — ${fx.away} (${fx.league}, ${fx.date}), сходство ${fx.score}, отрыв ${fx.margin}`);
    } else {
      log("  · в расписании дня не нашёл, пробую словарь");
      const [h, a] = [await searchTeam(home, dict), await searchTeam(away, dict)];
      if (h) { hId = h.id; log(`  ✓ ${home} → ${h.name} (${h.score})`); } else { log(`  ✗ не нашёл: ${home}`); misses.push(home); }
      if (a) { aId = a.id; log(`  ✓ ${away} → ${a.name} (${a.score})`); } else { log(`  ✗ не нашёл: ${away}`); misses.push(away); }
    }

    if (!hId || !aId) { out.matches.push(rec); continue; }
    rec.resolved = true;

    const hs = venueStreak(await lastEvents(hId), hId, "home");
    const as = venueStreak(await lastEvents(aId), aId, "away");

    const lean = [];
    if (hs) {
      rec.hints.push(`${home}: ${hs.len} ${WORD.home[hs.kind]}`);
      if (hs.kind === "W") lean.push("1");
      if (hs.kind === "D") lean.push("X");
    }
    if (as) {
      rec.hints.push(`${away}: ${as.len} ${WORD.away[as.kind]}`);
      if (as.kind === "W") lean.push("2");
      if (as.kind === "D") lean.push("X");
    }
    const uniq = [...new Set(lean)];
    rec.suggest = uniq.length === 1 ? uniq[0] : null;

    if (rec.hints.length) rec.hints.forEach((h) => log("  · " + h));
    else log("  · чистых серий нет");
    if (rec.suggest) log(`  → подсказка: ${rec.suggest}`);

    out.matches.push(rec);
  }

  const resolved = out.matches.filter((m) => m.resolved).length;
  const withHints = out.matches.filter((m) => m.hints.length).length;
  const withSuggest = out.matches.filter((m) => m.suggest).length;

  log("\n================ ИТОГ ================");
  log(`Запросов к api-football: ${afCalls} (дневной лимит бесплатного тарифа — 100)`);
  log(`Сопоставлено: ${resolved} матчей из ${out.matches.length}`);
  log(`Чистые серии найдены в ${withHints}, направление даёт ${withSuggest}`);
  if (misses.length) {
    log("\nНе сопоставлены — можно вписать в data/teams.json:");
    [...new Set(misses)].forEach((n) => log(`  "${n.toLowerCase()}": "",`));
  }

  await writeFile(new URL("../preset.json", import.meta.url), JSON.stringify(out, null, 2) + "\n", "utf8");
  log("\npreset.json записан.");
}

main().catch((e) => {
  console.error("Сорвалось:", e.message);
  process.exit(1);
});
