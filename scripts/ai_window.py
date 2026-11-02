"""Окна авторазбора; одно правило для gate, конвейера и keepalive.

Два прохода на каждый тираж:
  вечерний — накануне закрытия с 22:01 МСК: полный разбор и заливка на сайт, чтобы разбор был готов с вечера;
  контрольный — в день закрытия с 11:01 МСК: тот же полный разбор заново со свежими составами, новостями и линией,
                готовое заменяет вечернее.
Если вечерний проход опоздал (GitHub нередко задерживает расписание), его можно сделать и после полуночи, до 11:01 дня закрытия.
Ручной запуск окном не ограничивается.
"""
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
EVENING_START = 22 * 60 + 1
AUTO_START_MINUTE = 11 * 60 + 1      # контрольный проход
MIN_REMAINING = timedelta(minutes=75)


def _end(draw):
    raw = str(draw["ended_at"])
    return datetime.strptime(raw[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=MSK)


def auto_window_reason(draw, now=None):
    """Пустая строка разрешает автоматический разбор (вечерний или контрольный), не ручной запуск.

    Totobrief отдаёт московское настенное время ended_at с суффиксом Z.
    Сохраняем действующий контракт источника, а не прибавляем к нему 3 часа.
    """
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(MSK)
    if draw.get("status") != "active":
        return "тираж больше не открыт для приёма"
    try:
        end = _end(draw)
    except (KeyError, ValueError, TypeError):
        return "не подтверждено время закрытия тиража"
    days = (end.date() - local.date()).days
    minute = local.hour * 60 + local.minute
    if days < 0:
        return "день закрытия приёма уже прошёл"
    if days >= 2:
        return "авторазбор только накануне вечером и в день закрытия приёма: %s МСК" % end.strftime("%d.%m.%Y")
    if days == 1 and minute < EVENING_START:
        return "вечерний разбор накануне закрытия начинается в 22:01 МСК"
    if days == 0 and minute >= AUTO_START_MINUTE and end - local < MIN_REMAINING:
        return "до закрытия приёма меньше 75 минут"
    return ""


def stage_at(draw, when, manual=False):
    """'evening' или 'morning' для момента when. Ручной запуск в день закрытия считается контрольным."""
    try:
        end = _end(draw)
    except (KeyError, ValueError, TypeError):
        return "evening"
    local = when.astimezone(MSK)
    days = (end.date() - local.date()).days
    if days >= 1:
        return "evening"
    if manual or local.hour * 60 + local.minute >= AUTO_START_MINUTE:
        return "morning"
    return "evening"


def ai_stage(ai, draw):
    """Какой проход сделан в опубликованном разборе: поле stage, а для старых записей — по времени публикации."""
    st = (ai or {}).get("stage")
    if st in ("evening", "morning"):
        return st
    try:
        at = datetime.fromisoformat(str(ai["at"]))
        if at.tzinfo is None:
            at = at.replace(tzinfo=MSK)
        return stage_at(draw, at)
    except (KeyError, ValueError, TypeError):
        return "evening"


def auto_plan(draw, ai, now=None):
    """(причина отказа, проход). Пустая причина — запуск нужен, проход — 'evening' или 'morning'."""
    now = now or datetime.now(timezone.utc)
    why = auto_window_reason(draw, now)
    if why:
        return why, ""
    stage = stage_at(draw, now)
    if str((ai or {}).get("number", "")) == str(draw.get("number")):
        done = ai_stage(ai, draw)
        if stage == "evening":
            return "тираж %s уже разобран" % draw["number"], ""
        if done == "morning":
            return "контрольный разбор тиража %s уже сделан" % draw["number"], ""
    return "", stage
