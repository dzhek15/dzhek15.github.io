"""Окно авторазбора; одинаковое правило для gate, конвейера и keepalive."""
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
AUTO_START_MINUTE = 11 * 60 + 7
MIN_REMAINING = timedelta(minutes=75)


def auto_window_reason(draw, now=None):
    """Пустая строка разрешает автоматический разбор, не ручной запуск.

    Totobrief отдаёт московское настенное время ended_at с суффиксом Z.
    Сохраняем действующий контракт источника, а не прибавляем к нему 3 часа.
    """
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(MSK)
    if draw.get("status") != "active":
        return "тираж больше не открыт для приёма"
    try:
        raw = str(draw["ended_at"])
        end = datetime.strptime(raw[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=MSK)
    except (KeyError, ValueError, TypeError):
        return "не подтверждено время закрытия тиража"
    if end.date() > local.date():
        return "авторазбор только в день закрытия приёма: %s МСК" % end.strftime("%d.%m.%Y")
    if end.date() < local.date():
        return "день закрытия приёма уже прошёл"
    if local.hour * 60 + local.minute < AUTO_START_MINUTE:
        return "авторазбор ещё не наступил: ждём 11:07 МСК"
    if end - local < MIN_REMAINING:
        return "до закрытия приёма меньше 75 минут"
    return ""
