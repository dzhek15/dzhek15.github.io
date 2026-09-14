/*
  Автономный разбор тиража Балтсистемы — запускается GitHub Actions по расписанию.

  Что делает:
    1. Забирает активный тираж с открытого API totobrief (15 матчей).
    2. Для каждой команды ищет её в TheSportsDB: сначала по таблице соответствий
       data/teams.json, потом по транслитерации.
    3. Тянет последние матчи каждой команды и считает ЧИСТЫЕ серии по правилам
       методики: 3+ подряд побед, ИЛИ 3+ поражений, ИЛИ 3+ ничьих, отдельно
       по площадке (дома для хозяев, на выезде для гостей), без склейки через
       межсезонье — берётся окно последних 150 дней.
    4. Пишет preset.json, который читает сайт.

  Ключей и платных сервисов не требует. Всё, что не удалось сопоставить,
  печатается в лог — по нему пополняется data/teams.json.
*/

import { readFile, writeFile } from "node:fs/promises";

const TB = "https://totobrief.com/api/v1/community/";
const SDB_KEY = process.env.SPORTSDB_KEY || "3";
const SDB = `https://www.thesportsdb.com/api/v1/json/${SDB_KEY}/`;

const WINDOW_DAYS = 150;   /* глубже не смотрим: там межсезонье и другой дивизион */
const STREAK_MIN = 3;      /* чистая серия по методике — от трёх матчей */

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

/* ---------- названия ---------- */

const RU2LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function normRu(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\bфк\b/g, "")
    .replace(/[()]/g, " ")
    .replace(/[«»"'`.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function translit(name) {
  return normRu(name)
    .split("")
    .map((ch) => (RU2LAT[ch] !== undefined ? RU2LAT[ch] : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/* грубая мера похожести: доля общих триграмм */
function similar(a, b) {
  const tri = (s) => {
    const x = " " + String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    const out = new Set();
    for (let i = 0; i < x.length - 2; i++) out.add(x.slice(i, i + 3));
    return out;
  };
  const A = tri(a), B = tri(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.max(A.size, B.size);
}

/* ---------- поиск команды ---------- */

const teamCache = new Map();

async function resolveTeam(ruName, dict) {
  const key = normRu(ruName);
  if (teamCache.has(key)) return teamCache.get(key);

  const queries = [];
  if (dict[key]) queries.push(dict[key]);
  queries.push(translit(ruName));

  let found = null;
  for (const q of queries) {
    let data;
    try {
      data = await getJson(SDB + "searchteams.php?t=" + encodeURIComponent(q));
    } catch (e) {
      log(`    поиск «${q}» не удался: ${e.message}`);
      continue;
    }
    const list = (data && data.teams) || [];
    const football = list.filter((t) => /soccer/i.test(t.strSport || ""));
    if (!football.length) continue;

    let best = null, bestScore = 0;
    for (const t of football) {
      const score = Math.max(similar(q, t.strTeam), similar(q, t.strAlternate || ""));
      if (score > bestScore) { bestScore = score; best = t; }
    }
    /* точное совпадение по словарю принимаем и при среднем сходстве */
    const threshold = dict[key] && q === dict[key] ? 0.35 : 0.55;
    if (best && bestScore >= threshold) {
      found = { id: best.idTeam, name: best.strTeam, score: Number(bestScore.toFixed(2)), via: q };
      break;
    }
    await sleep(250);
  }

  teamCache.set(key, found);
  return found;
}

/* ---------- форма и серии ---------- */

async function lastEvents(teamId) {
  let data;
  try {
    data = await getJson(SDB + "eventslast.php?id=" + encodeURIComponent(teamId));
  } catch (e) {
    log(`    матчи команды ${teamId} не получены: ${e.message}`);
    return [];
  }
  const evs = (data && (data.results || data.events)) || [];
  const edge = Date.now() - WINDOW_DAYS * 86400000;
  return evs
    .map((e) => ({
      date: e.dateEvent ? Date.parse(e.dateEvent + "T00:00:00Z") : NaN,
      homeId: e.idHomeTeam, awayId: e.idAwayTeam,
      home: e.strHomeTeam, away: e.strAwayTeam,
      hs: Number(e.intHomeScore), as: Number(e.intAwayScore),
      league: e.strLeague || "",
    }))
    .filter((e) => isFinite(e.date) && e.date >= edge && isFinite(e.hs) && isFinite(e.as))
    .sort((a, b) => b.date - a.date);
}

/* исход матча глазами команды: W / D / L */
function outcomeFor(ev, teamId) {
  const atHome = String(ev.homeId) === String(teamId);
  const my = atHome ? ev.hs : ev.as;
  const their = atHome ? ev.as : ev.hs;
  if (my > their) return "W";
  if (my < their) return "L";
  return "D";
}

/* чистая серия по площадке: только матчи дома (или только на выезде) подряд */
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
  return n >= STREAK_MIN ? { kind: first, len: n, games: rows.length } : null;
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

  const out = {
    tirazh: String(draw.number),
    drawingId: draw.id,
    endedAt: draw.ended_at || "",
    generatedAt: new Date().toISOString(),
    source: "totobrief + thesportsdb",
    rules: `чистая серия от ${STREAK_MIN} матчей, по площадке, окно ${WINDOW_DAYS} дней`,
    matches: [],
  };

  const unresolved = [];

  for (const ev of events) {
    const parts = String(ev.name || "").split(/\s+[—–−-]\s+/);
    const home = (parts[0] || "").trim();
    const away = (parts.slice(1).join(" - ") || "").trim();
    log(`\n${home} — ${away}  [${ev.championship || ""}]`);

    const rec = { home, away, hints: [], suggest: null, resolved: false };

    const [hT, aT] = [await resolveTeam(home, dict), await resolveTeam(away, dict)];
    if (!hT) { unresolved.push(home); log(`  ✗ не нашёл: ${home}`); }
    else log(`  ✓ ${home} → ${hT.name} (id ${hT.id}, сходство ${hT.score}, запрос «${hT.via}»)`);
    if (!aT) { unresolved.push(away); log(`  ✗ не нашёл: ${away}`); }
    else log(`  ✓ ${away} → ${aT.name} (id ${aT.id}, сходство ${aT.score}, запрос «${aT.via}»)`);

    if (!hT || !aT) { out.matches.push(rec); continue; }
    rec.resolved = true;

    const [hEv, aEv] = [await lastEvents(hT.id), await lastEvents(aT.id)];
    const hs = venueStreak(hEv, hT.id, "home");
    const as = venueStreak(aEv, aT.id, "away");

    const lean = [];
    if (hs) {
      rec.hints.push(`${home}: ${hs.len} ${WORD.home[hs.kind]}`);
      if (hs.kind === "W") lean.push("1");
      if (hs.kind === "D") lean.push("X");
      /* серия поражений — самое слабое правило методики, направления не даёт */
    }
    if (as) {
      rec.hints.push(`${away}: ${as.len} ${WORD.away[as.kind]}`);
      if (as.kind === "W") lean.push("2");
      if (as.kind === "D") lean.push("X");
    }
    const uniq = [...new Set(lean)];
    rec.suggest = uniq.length === 1 ? uniq[0] : null;   /* при споре сигналов — молчим */

    if (rec.hints.length) rec.hints.forEach((h) => log("  · " + h));
    else log("  · чистых серий нет");
    if (rec.suggest) log(`  → подсказка: ${rec.suggest}`);

    out.matches.push(rec);
  }

  const resolved = out.matches.filter((m) => m.resolved).length;
  const withHints = out.matches.filter((m) => m.hints.length).length;
  const withSuggest = out.matches.filter((m) => m.suggest).length;

  log("\n================ ИТОГ ================");
  log(`Сопоставлено команд: ${resolved} матчей из ${out.matches.length}`);
  log(`Чистые серии найдены в ${withHints} матчах, направление даёт ${withSuggest}`);
  if (unresolved.length) {
    log("\nНе сопоставлены — впиши их в data/teams.json:");
    [...new Set(unresolved)].forEach((n) => log(`  "${normRu(n)}": "",`));
  }

  await writeFile(new URL("../preset.json", import.meta.url), JSON.stringify(out, null, 2) + "\n", "utf8");
  log("\npreset.json записан.");
}

main().catch((e) => {
  console.error("Сорвалось:", e.message);
  process.exit(1);
});
