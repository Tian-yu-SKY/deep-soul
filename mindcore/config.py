"""参数集中管理：与规格文档 §6 表 6-1 一一对应。"""
from dataclasses import dataclass, asdict, field


@dataclass
class Config:
    # ---- 双通道权重 (§3.2) ----
    alpha_owner_base: float = 2.0
    alpha_owner_gain: float = 1.8
    alpha_owner_cap: float = 3.8
    alpha_other: float = 1.4
    beta_owner: float = 1.3
    beta_other: float = 1.0
    owner_share_cap: float = 0.40
    owner_cap_damp: float = 0.70

    # ---- 检索 (§3.3, §5.5) ----
    w_cos: float = 0.50
    w_lex: float = 0.20
    w_ppr: float = 0.30
    # 语义通道离线时的降级权重（和为一）
    w_lex_degraded: float = 0.55
    w_ppr_degraded: float = 0.45
    gate: float = 0.25
    cov_min: float = 0.18          # 覆盖度门槛（v4.3）
    max_per_region: int = 2        # 同一分区最多几条（v4.3）
    pool_mult: int = 6             # 候选池 = k * pool_mult（v4.3）
    recall_dedupe_sim: float = 0.85  # 回想阶段近重复阈值（写入合并用 dedupe_sim）
    share_private: bool = True       # 私聊记忆在群里也能想起（只给主人，标明“别报细节”）
    share_private_max: int = 1       # 群聊里一次最多带几条私聊记忆
    # ---- v4.4 接入与治理 ----
    prefetch_max_chars: int = 900    # 每轮注入硬预算（字符）
    max_content_chars: int = 500     # 单条记忆最大长度
    quiet_start: int = 23            # 安静时段开始（含）
    quiet_end: int = 8               # 安静时段结束（不含）
    proactive_min_minutes: int = 45  # 两次主动最短间隔
    proactive_hourly: int = 1
    proactive_daily: int = 4
    proactive_backoff_start: int = 120
    proactive_backoff_max: int = 1440
    promote_important_hits: int = 4
    promote_core_hits: int = 12
    jitter: float = 0.10
    ppr_damping: float = 0.85
    ppr_iters: int = 20

    # ---- 分舱 (§3.8) ----
    cell_min: int = 8
    cell_max: int = 32
    cell_route_top: int = 2
    cell_min_hits: int = 2

    # ---- 分区与遗忘 (§3.6) ----
    tau_core: float = 3650.0
    tau_texture: float = 180.0
    tau_trivia: float = 21.0
    tau_flash: float = 180.0
    spine_cap: int = 20
    flash_active_cap: int = 12

    # ---- 巩固 (§3.4) ----
    merge_sim: float = 0.78
    dedupe_sim: float = 0.60
    conflict_sim: float = 0.72
    abstract_max: int = 3
    prune_max: int = 3
    prune_max_ratio: float = 0.30
    emotion_regress: float = 0.02
    confidence_tau: float = 180.0

    # ---- 驱力 (§3.5) ----
    drive_inertia: float = 0.70
    autonomy_threshold: float = 0.70
    initiative_daily: int = 5
    self_activity_min_ratio: float = 0.3333

    # ---- 物理锚 / 证据 (§3.9) ----
    anchor_ttl: float = 30 * 86400.0
    evidence_retention: float = 90 * 86400.0
    grounding_same_place: float = 1.12
    grounding_place_word: float = 1.30

    # ---- 其它 ----
    hot_cap: int = 5000
    pending_window: float = 24 * 3600.0
    regions: tuple = ("episode", "fact", "relation", "self", "habit", "preference", "flash", "spine", "texture", "core")

    def to_dict(self):
        d = asdict(self)
        d["regions"] = list(self.regions)
        return d

    @classmethod
    def from_dict(cls, d):
        d = dict(d)
        if "regions" in d:
            d["regions"] = tuple(d["regions"])
        allowed = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in allowed})
