"""面板数据层（只读为主）：把 mind.db 聚合成「识海」需要的一张图。

设计要点：
  · 只读盘；唯一会写的是 touch()（悬停/点击「想起来」加一次命中），且只动 hits/last_hit。
  · 布局交给浏览器：这里只给团（分舱）、节点、少量边和统计，不掺坐标。
  · 衰减口径和检索一致：0.5 ** (age_days / tau_region)，时间旅行只换 as_of，不改数据。
"""
import datetime
import json
from collections import Counter
import math
import time

from . import text as T

REGION_LABEL = {
    "episode": "情景", "fact": "事实", "relation": "关系", "self": "自我",
    "habit": "习惯", "preference": "偏好", "flash": "闪回", "spine": "刺",
    "texture": "质感", "core": "核心", "trivia": "琐事",
}


def _as_of_ts(as_of):
    if not as_of:
        return time.time()
    try:
        d = datetime.date.fromisoformat(str(as_of))
    except ValueError:
        raise ValueError("as_of 要是 YYYY-MM-DD")
    return time.mktime((d.year, d.month, d.day, 23, 59, 59, 0, 0, -1))


def _tau_days(cfg, region):
    if region == "core":
        return cfg.tau_core
    if region == "trivia":
        return cfg.tau_trivia
    if region == "texture":
        return cfg.tau_texture
    if region == "flash":
        return cfg.tau_flash
    if region == "spine":
        return 3650.0
    return 180.0


def _cluster_of(store, nodes):
    """舱 -> 节点；没有舱就按 (受众, 分区) 临时分团。"""
    rows = store.conn.execute("SELECT cell_id, audience, region, size FROM cells").fetchall()
    cells = {r["cell_id"]: dict(r) for r in rows}
    member = {}
    for r in store.conn.execute("SELECT cell_id, node_id FROM cell_members").fetchall():
        member[r["node_id"]] = r["cell_id"]
    clusters = {}
    region_votes = {}
    for n in nodes:
        cid = member.get(n["id"])
        if cid and cid in cells:
            c = cells[cid]
            key = cid
            audience = c.get("audience") or n["audience"]
        else:
            key = f"{n['audience']}:{n['region']}"
            audience = n["audience"]
        cl = clusters.get(key)
        if cl is None:
            cl = clusters[key] = {"id": key, "label": "", "region": "",
                                  "audience": audience, "size": 0}
            region_votes[key] = Counter()
        cl["size"] += 1
        n["cluster"] = key
        region_votes[key][n["region"]] += 1
    # 舱是按语义聚出来的，不必然同分区。标签取成员里的多数分区，
    # 而不是 cells.region（vector 模式建表时留空）或第一个节点。
    for key, cl in clusters.items():
        top = region_votes[key].most_common(1)
        region = top[0][0] if top else "other"
        cl["region"] = region
        cl["label"] = REGION_LABEL.get(region, region or "舱")
        cl["mix"] = dict(region_votes[key])
    return list(clusters.values())


def brain(store, cfg, index=None, as_of=None, limit=1600):
    now = _as_of_ts(as_of)
    rows = [dict(r) for r in store.conn.execute(
        "SELECT id,region,kind,text,audience,source,level,affect_w,arousal,created_at,last_hit,hits,status "
        "FROM nodes WHERE status='active'").fetchall()]
    spine = {}
    for r in store.conn.execute("SELECT node_id,state,note FROM spine").fetchall():
        spine[r["node_id"]] = r["state"]

    nodes = []
    for n in rows:
        if (n["created_at"] or 0) > now:
            continue
        tau = max(1.0, _tau_days(cfg, n["region"]))
        stamp = n["last_hit"] or n["created_at"] or now
        age = max(0.0, (now - stamp) / 86400.0)
        fade = max(0.06, 0.5 ** (age / tau))
        if n["region"] == "spine" and spine.get(n["id"]) != "resolved":
            fade = 1.0
        score = float(n["affect_w"] or 1.0) * (0.35 + 0.65 * fade)
        nodes.append({
            "id": n["id"], "text": T.normalize(n["text"])[:80], "region": n["region"],
            "kind": n["kind"], "audience": n["audience"], "source": n["source"],
            "level": n["level"] or "normal", "affect": round(float(n["affect_w"] or 1), 2),
            "arousal": round(float(n["arousal"] or 0), 2),
            "fade": round(fade, 3), "score": round(score, 3),
            "hits": int(n["hits"] or 0), "created_at": n["created_at"],
            "last_hit": n["last_hit"] or 0,
            "status": n["status"],
            "spike": n["region"] == "spine" and spine.get(n["id"]) != "resolved",
            "age_days": round(age, 1),
        })

    nodes.sort(key=lambda x: -x["score"])
    total_nodes = len(nodes)
    all_n = nodes
    nodes = nodes[:limit]
    keep = {n["id"] for n in nodes}
    clusters = _cluster_of(store, nodes)

    edges = []
    for r in store.conn.execute("SELECT src,dst,kind FROM edges LIMIT 8000").fetchall():
        if r["src"] in keep and r["dst"] in keep:
            edges.append([r["src"], r["dst"], r["kind"]])
            if len(edges) >= 400:
                break

    # 最近想起（读事件流水，evidence 指向当次 top1）
    recalls = []
    for r in store.conn.execute(
            "SELECT ts, evidence, note FROM events WHERE kind='recall' AND ts<=? ORDER BY ts DESC LIMIT 6",
            (now,)).fetchall():
        t = store.conn.execute("SELECT text FROM nodes WHERE id=?", (r["evidence"],)).fetchone()
        recalls.append({"ts": r["ts"], "query": r["note"] or "",
                        "id": r["evidence"], "text": (t["text"] if t else "")[:60]})

    stats = {
        "nodes": total_nodes, "shown": len(nodes), "cells": len(clusters),
        "spine_open": sum(1 for n in all_n if n["spike"]),
        "disputed": sum(1 for n in all_n if n["status"] == "disputed"),
        "core": sum(1 for n in all_n if n["level"] == "core"),
        "claims": store.count("SELECT COUNT(*) FROM self_claims WHERE status='active'"),
        "self": sum(1 for n in all_n if n["region"] == "self"),
        "relation": sum(1 for n in all_n if n["region"] == "relation"),
        "episode": sum(1 for n in all_n if n["region"] == "episode"),
        "emotion": sum(1 for n in all_n if n["region"] in ("flash", "spine", "texture")),
        "fact": sum(1 for n in all_n if n["region"] in ("fact", "habit", "preference")),
        "core_level": sum(1 for n in all_n if (n["level"] or "normal") == "core"),
        "important_level": sum(1 for n in all_n if (n["level"] or "normal") == "important"),
        "loops": 0,
        "mode": index.mode() if index is not None else "?",
        "safe_mode": store.safe_mode(),
        "injections_today": dict(store.conn.execute(
            "SELECT COUNT(*) n, COALESCE(SUM(chars),0) chars, COALESCE(SUM(hits),0) hits "
            "FROM injection_log WHERE ts>=?", (time.time() - 86400,)).fetchone()),
        "initiative": dict(store.get_meta("initiative_state") or {}),
        "db": store.path,
    }
    last_self = store.conn.execute("SELECT MAX(at) FROM self_revisions").fetchone()[0]
    stats["last_self_update"] = last_self or 0
    gen = datetime.datetime.fromtimestamp(now).isoformat(timespec="seconds")
    return {"generated_at": gen,
            "as_of": as_of or datetime.date.today().isoformat(),
            "stats": stats, "clusters": clusters, "nodes": nodes, "edges": edges,
            "drives": dict(store.get_meta("drives") or {}), "recalls": recalls}


def detail(store, node_id):
    n = store.node(node_id)
    if not n:
        return None
    ev = [dict(r) for r in store.conn.execute(
        "SELECT excerpt,speaker,ts,message_id FROM evidence WHERE node_id=? ORDER BY id", (node_id,)).fetchall()]
    anchor = store.conn.execute("SELECT place,at,ttl FROM anchors WHERE node_id=?", (node_id,)).fetchone()
    sp = store.conn.execute("SELECT state,note,resolved_at FROM spine WHERE node_id=?", (node_id,)).fetchone()
    cell = store.conn.execute("SELECT cell_id FROM cell_members WHERE node_id=?", (node_id,)).fetchone()
    return {
        "id": n["id"], "text": n["text"], "region": n["region"], "kind": n["kind"],
        "audience": n["audience"], "source": n["source"], "chat_id": n.get("chat_id") or "", "level": n.get("level") or "normal",
        "affect": round(float(n["affect_w"] or 0), 2), "belief": round(float(n["belief_w"] or 0), 2),
        "hits": int(n["hits"] or 0), "created_at": n["created_at"], "last_hit": n["last_hit"] or 0,
        "status": n["status"], "valence": n["valence"], "arousal": n["arousal"],
        "evidence": ev,
        "anchor": dict(anchor) if anchor else None,
        "spine": dict(sp) if sp else None,
        "cluster": (cell["cell_id"] if cell else f"{n['audience']}:{n['region']}"),
    }


def touch(store, node_id):
    now = time.time()
    with store.tx() as c:
        c.execute("UPDATE nodes SET hits=hits+1, last_hit=? WHERE id=?", (now, node_id))
        c.execute("INSERT INTO events(ts,kind,initiator,evidence,note) VALUES(?,?,?,?,?)",
                  (now, "touch", "panel", node_id, "面板上点了一下"))
    n = store.node(node_id)
    return {"id": node_id, "hits": int(n["hits"] or 0) if n else 0, "last_hit": now}


def recent_recalls(store, limit=10):
    out = []
    for r in store.conn.execute(
            "SELECT ts, evidence, note FROM events WHERE kind='recall' ORDER BY ts DESC LIMIT ?",
            (int(limit),)).fetchall():
        t = store.conn.execute("SELECT text, region FROM nodes WHERE id=?", (r["evidence"],)).fetchone()
        out.append({"ts": r["ts"], "query": r["note"] or "", "id": r["evidence"],
                    "text": (t["text"] if t else ""), "region": (t["region"] if t else "")})
    return out
