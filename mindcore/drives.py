"""状态层：七维驱力、自主预算、去结论化渲染（§3.5, §3.11）。"""
import json
import time

DIMS = ("social", "curiosity", "play", "rest", "recognition", "achievement", "autonomy")

RATES = {"social": 0.05, "curiosity": 0.04, "play": 0.03, "rest": 0.08,
         "recognition": 0.02, "achievement": 0.02, "autonomy": 0.06}


class Drives:
    def __init__(self, store, cfg):
        self.store = store
        self.cfg = cfg
        self.state = store.get_meta("drives") or {d: 0.3 for d in DIMS}
        self.last_tick = store.get_meta("drives_tick", time.time())

    def save(self):
        self.store.set_meta("drives", self.state)
        self.store.set_meta("drives_tick", self.last_tick)

    # ---------- 演化 ----------
    def tick(self, now=None, dt_hours=None):
        now = now or time.time()
        dt = dt_hours if dt_hours is not None else (now - self.last_tick) / 3600.0
        dt = max(0.0, min(dt, 24.0))
        for d in DIMS:
            target = min(1.0, self.state.get(d, 0.3) + RATES[d] * dt)
            self.state[d] = self.cfg.drive_inertia * self.state.get(d, 0.3) + (1 - self.cfg.drive_inertia) * target
        # 自主性：主人主导太久 / 24 小时无自选活动 -> 上升
        last_self = self.store.get_meta("last_self_activity", 0)
        if now - last_self > 86400:
            self.state["autonomy"] = min(1.0, self.state["autonomy"] + 0.02 * dt)
        self.last_tick = now
        self.save()
        return dict(self.state)

    def satisfy(self, dim, amount=0.25):
        if dim in self.state:
            self.state[dim] = max(0.0, self.state[dim] - amount)
            self.save()

    def autonomy_mode(self):
        return self.state.get("autonomy", 0.0) > self.cfg.autonomy_threshold

    # ---------- 检索偏置（去结论化：只给数值，不给文字） ----------
    def bias(self, region):
        b = 1.0
        if region in ("fact", "episode") and self.state.get("curiosity", 0) > 0.7:
            b *= 1.05
        if region == "relation" and self.state.get("social", 0) > 0.7:
            b *= 1.05
        if region == "texture" and self.state.get("play", 0) > 0.7:
            b *= 1.03
        if region == "spine" and self.state.get("autonomy", 0) > 0.7:
            b *= 1.05
        return b

    # ---------- 事实式处境块（禁止结论句） ----------
    def render_facts(self, ctx=None):
        ctx = ctx or {}
        now = time.strftime("%H:%M", time.localtime(ctx.get("now", time.time())))
        parts = []
        if ctx.get("place"):
            parts.append(f"你在{ctx['place']}")
        if ctx.get("room_note"):
            parts.append(ctx["room_note"])
        if ctx.get("last_done"):
            parts.append(f"最近做过：{'、'.join(ctx['last_done'])}")
        if ctx.get("pending"):
            parts.append(f"想做又没做：{'、'.join(ctx['pending'])}")
        parts.append(f"现在是 {now}")
        nums = "，".join(f"{d} {self.state.get(d, 0):.2f}" for d in DIMS)
        parts.append(f"驱力读数：{nums}")
        return "；".join(parts) + "。"

    # ---------- 主动性预算 ----------
    def initiative_today(self):
        day_start = time.time() - (time.time() % 86400)
        rows = self.store.conn.execute(
            "SELECT initiator, COUNT(*) n FROM events WHERE kind='self_activity' AND ts>=? GROUP BY initiator",
            (day_start,)).fetchall()
        total = sum(r["n"] for r in rows)
        self_n = sum(r["n"] for r in rows if r["initiator"] == "self")
        return {"total": total, "self": self_n,
                "remaining": max(0, self.cfg.initiative_daily - total),
                "ratio": (self_n / total) if total else 0.0}
