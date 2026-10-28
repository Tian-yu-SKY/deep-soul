"""相对时间窗与核心查询（借鉴鱼脑的 timequery，按 Deep-Soul 的秒级时间戳重写）。

为什么要有：
  · 用户问「昨天谁说的 X」时，原句里的「昨天/谁/说的」和今天的记忆高度重合，
    会把真正那段挤出候选；而且绝对分数门限对这类问句没有意义。
  · 所以先解析出时间窗做硬过滤，再剥掉时间/疑问/人称虚词，得到一个「核心查询」，
    用它再算一路覆盖度，分母才只剩实体词。

接口与 fish 版保持一致：resolve_window(query, now) / core_query(query) / within(ts, win)。
"""
import datetime as _dt
import re
import time as _time

DAY = 86400.0

_TIME_WORDS = re.compile(
    r"(前天|昨天|昨儿|昨晚|昨夜|今天|今儿|今早|今晚|刚刚|刚才|上周|上星期|"
    r"这周|本周|这星期|最近|这几天|近几天|前两天|上个月|上月|那天|当时|后来)"
)

_QUESTION_WORDS = re.compile(
    r"(谁|哪个人|哪个|什么|怎么|为什么|是不是|有没有|还记得|记不记得|记得|知道|"
    r"说过|问过|提过|说的|问的|提的|讲的|发的|时候|之前|以前|上次|那次|一下|"
    r"请问|帮我|告诉我|你|我|他|她|它|们|吗|呢|吧|啊|呀|哦|嗯|啥|嘛|呗|啦|"
    r"的|了|是|在|有|和|跟|给|对|就|都|也|还|要|会|能)"
)


def _week_start(now: float, offset_weeks: int = 0) -> float:
    lt = _time.localtime(now)
    monday = _start_of_day(now) - _dt.date(lt.tm_year, lt.tm_mon, lt.tm_mday).weekday() * DAY
    return monday + offset_weeks * 7 * DAY


def _month_start(now: float, offset_months: int = 0) -> float:
    lt = _time.localtime(now)
    y, m = lt.tm_year, lt.tm_mon + offset_months
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return _time.mktime((y, m, 1, 0, 0, 0, 0, 0, -1))


def _start_of_day(now: float, offset_days: int = 0) -> float:
    lt = _time.localtime(now)
    base = _time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    return base + offset_days * DAY


def resolve_window(query: str, now: float | None = None):
    """把「昨天 / 前天 / 今天 / 上周 / 最近」解析成 {start, end, label}；认不出返回 None。"""
    q = str(query or "")
    if not q:
        return None
    now = now if now is not None else _time.time()

    # 「昨天」在口语里常指昨夜到今晨，尾巴多留到今天 06:00
    if "前天" in q:
        return {"start": _start_of_day(now, -2), "end": _start_of_day(now, -1) + 6 * 3600, "label": "前天"}
    if re.search(r"昨天|昨儿|昨晚|昨夜", q):
        return {"start": _start_of_day(now, -1), "end": min(now, _start_of_day(now, 0) + 6 * 3600), "label": "昨天"}
    if re.search(r"今天|今儿|刚刚|刚才|今早|今晚", q):
        return {"start": _start_of_day(now, 0), "end": now, "label": "今天"}
    if re.search(r"上周|上星期|上个星期", q):
        return {"start": _week_start(now, -1), "end": _week_start(now, 0) - 1, "label": "上周"}
    if re.search(r"这周|本周|这星期", q):
        return {"start": _week_start(now, 0), "end": now, "label": "这周"}
    if re.search(r"最近|这几天|近几天|前两天", q):
        return {"start": _start_of_day(now, -3), "end": now, "label": "最近三天"}
    if re.search(r"上个月|上月", q):
        return {"start": _month_start(now, -1), "end": _month_start(now, 0) - 1, "label": "上个月"}
    return None


def core_query(query: str) -> str:
    """剥掉时间词 / 疑问词 / 人称代词，留下真正在说什么；太短返回空串。"""
    q = str(query or "")
    if not q:
        return ""
    s = re.sub(r"@\d{5,}", " ", q)
    s = re.sub(r"#-?\d{5,}", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = _TIME_WORDS.sub(" ", s)
    s = _QUESTION_WORDS.sub(" ", s)
    s = re.sub(r"[，。！？、；：「」『』（）()\s,.!?;:~～…—\-]+", " ", s).strip()
    if len(s) < 2:
        return ""
    return s


def within(ts, win) -> bool:
    """ts（unix 秒）是否落在时间窗内；win 为空时恒真。"""
    if not win:
        return True
    try:
        t = float(ts)
    except (TypeError, ValueError):
        return False
    return win["start"] <= t <= win["end"]
