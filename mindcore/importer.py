"""把 QQ 会话里「本次消息快照」的历史消息导入记忆库（v4.3.2）。

背景：Deep-Soul 从 v4.2 才开始记东西，之前 QQ 里聊过的事一条都没有。
桥接的每条唤醒 prompt 末尾都带一段消息快照 JSON，里面有说话人、时间、消息 id，
正好可以按原样补进记忆：群聊 -> audience=group + chat_id，私聊 -> private。

只补「别人说的、像事实的」句子；纯语气/表情/命令/太短的不进。
"""
import glob
import json
import re
import subprocess

_TONE = re.compile(r"^(哈+|嗯+|哦+|啊+|草+|6+|？+|。+|…+|好+|行+|在吗|吃了吗)$")
_MARK = re.compile(r"\[(?:图片|表情|动画表情|语音|视频|文件|转发消息)[^\]]*\]")


def _read(path):
    if path.endswith(".zstd"):
        return subprocess.run(["zstd", "-dc", path], capture_output=True, timeout=60).stdout.decode("utf-8", "ignore")
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def _snapshot(text):
    i = text.rfind("【本次消息快照】")
    if i < 0:
        return None
    s = text[text.find("{", i):]
    depth = 0
    instr = esc = False
    for k, ch in enumerate(s):
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[:k + 1])
                except ValueError:
                    return None
    return None


def _clean(t):
    return re.sub(r"\s+", " ", _MARK.sub(" ", str(t or ""))).strip()


def _factish(t):
    if len(t) < 8 or len(t) > 200:
        return False
    if t.startswith(("/", "!", ".", "#", "@")):
        return False
    if not re.search(r"[\u4e00-\u9fffA-Za-z]", t):
        return False
    if _TONE.match(t):
        return False
    return True


def collect(root, cap=2000):
    """扫描目录下所有 session.v4.jsonl.zstd，返回去重后的 (chat, msg) 列表。"""
    seen = set()
    out = []
    for path in sorted(glob.glob(root + "/**/session.v4.jsonl.zstd", recursive=True)):
        try:
            raw = _read(path)
        except Exception:
            continue
        for line in raw.splitlines():
            try:
                o = json.loads(line)
            except ValueError:
                continue
            d = o.get("data") or {}
            m = d.get("message") or d
            if (m.get("role") or "") != "user":
                continue
            c = m.get("content")
            txt = "".join(x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else str(c)
            if "【本次消息快照】" not in txt:
                continue
            km = re.search(r"【(?:当前)?会话】\s*([a-z]+:\d+)", txt)
            if not km:
                continue
            chat = km.group(1)
            snap = _snapshot(txt)
            if not snap:
                continue
            for x in snap.get("messages") or []:
                if not x or x.get("isSelf"):
                    continue
                text = _clean(x.get("text"))
                if not _factish(text):
                    continue
                mid = str(x.get("messageId") or x.get("seq") or "")
                key = (chat, mid or text[:80])
                if key in seen:
                    continue
                seen.add(key)
                sender = str(x.get("sender") or "").strip()[:24]
                body = (sender + "：" + text) if chat.startswith("group:") and sender else text
                out.append({
                    "chat": chat,
                    "text": body[:200],
                    "speaker": sender,
                    "message_id": mid,
                    "ts": (float(x.get("time") or 0) / 1000.0) or None,
                    "owner": bool(x.get("isOwner")),
                })
                if len(out) >= cap:
                    return out
    return out


def import_all(P, root, cap=2000, dry_run=False):
    enc, store = P["encoder"], P["store"]
    items = collect(root, cap)
    existing = {re.sub(r"\s+", "", str(r["text"])) for r in store.active_nodes()}
    added = skipped = 0
    for it in items:
        norm = re.sub(r"\s+", "", it["text"])
        if norm in existing:
            skipped += 1
            continue
        if dry_run:
            added += 1
            continue
        chat = it["chat"]
        is_group = chat.startswith("group:")
        num = chat.split(":", 1)[1]
        enc.write(
            it["text"],
            source="owner" if it["owner"] else "other",
            audience="group" if is_group else "private",
            chat_id=num if is_group else "",
            ts=it["ts"],
            evidence={"message_id": it["message_id"], "speaker": it["speaker"], "excerpt": it["text"]},
        )
        existing.add(norm)
        added += 1
    return {"collected": len(items), "added": added, "skipped": skipped, "dry_run": dry_run}
