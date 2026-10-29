"""主动行为闸门（v4.4）：安静时段、最短间隔、时/日上限、无人回应退避、重启持久化。

设计取自 v11 双层架构的接入层，但只保留“硬闸”，不做 utility 打分：
  1. safeMode 时不主动；
  2. 安静时段（默认 23:00–08:00）不发；
  3. 两次之间至少 45 分钟；每小时 1 次；每天 4 次；
  4. 发出去 2 小时没人回 → 记为一次落空，退避时间翻倍（120 → 1440 分钟封顶）；
  5. 所有计数写 meta，重启不清零；
  6. 有人回复 → 落空清零、退避回到起点。
"""
import json
import time

KEY = "initiative_state"


def _day(now):
    return time.strftime("%Y-%m-%d", time.localtime(now))


class InitiativeGate:
    def __init__(self, store, cfg):
        self.store = store
        self.cfg = cfg

    def _load(self, now):
        st = self.store.get_meta(KEY) or {}
        if not isinstance(st, dict):
            st = {}
        day = _day(now)
        if st.get("day") != day:
            st.update(day=day, day_count=0, hour=-1, hour_count=0)
        st.setdefault("last_at", 0)
        st.setdefault("pending", False)
        st.setdefault("silent_streak", 0)
        st.setdefault("backoff_min", 0)
        return st

    def _save(self, st):
        self.store.set_meta(KEY, st)

    def _stale(self, st, now):
        """上一条主动超过 2 小时没人回 → 记为落空并退避。"""
        if not st.get("pending") or not st.get("last_at"):
            return st
        if now - st["last_at"] <= 2 * 3600:
            return st
        start = int(getattr(self.cfg, "proactive_backoff_start", 120))
        cap = int(getattr(self.cfg, "proactive_backoff_max", 1440))
        st["silent_streak"] = int(st.get("silent_streak", 0)) + 1
        st["backoff_min"] = min(cap, max(start, int(st.get("backoff_min") or 0) * 2))
        st["pending"] = False
        self._save(st)
        return st

    def check(self, now=None):
        now = now or time.time()
        st = self._stale(self._load(now), now)
        if self.store.safe_mode():
            return {"allowed": False, "why": "safe_mode", "state": st}
        h = time.localtime(now).tm_hour
        qs = int(getattr(self.cfg, "quiet_start", 23))
        qe = int(getattr(self.cfg, "quiet_end", 8))
        quiet = (h >= qs or h < qe) if qs > qe else (qs <= h < qe)
        if quiet:
            return {"allowed": False, "why": "quiet_hours", "state": st}
        gap = int(getattr(self.cfg, "proactive_min_minutes", 45)) * 60
        if st.get("last_at") and now - st["last_at"] < gap:
            return {"allowed": False, "why": "min_interval", "state": st}
        if st.get("silent_streak") and st.get("last_at"):
            need = int(st.get("backoff_min") or 0) * 60
            if now - st["last_at"] < need:
                return {"allowed": False, "why": "backoff", "state": st}
        hour = time.localtime(now).tm_hour
        if st.get("hour") == hour and int(st.get("hour_count", 0)) >= int(getattr(self.cfg, "proactive_hourly", 1)):
            return {"allowed": False, "why": "hourly_cap", "state": st}
        if int(st.get("day_count", 0)) >= int(getattr(self.cfg, "proactive_daily", 4)):
            return {"allowed": False, "why": "daily_cap", "state": st}
        return {"allowed": True, "why": "ok", "state": st}

    def mark_sent(self, now=None):
        now = now or time.time()
        st = self._load(now)
        hour = time.localtime(now).tm_hour
        if st.get("hour") != hour:
            st["hour"] = hour
            st["hour_count"] = 0
        st["hour_count"] = int(st.get("hour_count", 0)) + 1
        st["day_count"] = int(st.get("day_count", 0)) + 1
        st["last_at"] = now
        st["pending"] = True
        self._save(st)
        return st

    def mark_replied(self):
        now = time.time()
        st = self._load(now)
        st["pending"] = False
        st["silent_streak"] = 0
        st["backoff_min"] = 0
        self._save(st)
        return st

    def status(self):
        now = time.time()
        st = self._stale(self._load(now), now)
        return {"state": st, "check": self.check(now)}
