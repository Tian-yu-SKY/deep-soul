"""回想闸门：回声、近重复、噪音、多样性。

为什么要有：预取拿用户刚说的这句当查询去检索。如果这条消息本身或一句几乎一样的话
已经在库里，最像的命中就是它自己 —— 推回去等于复读。鱼脑实测 30 条真实消息，
Top1 里有 21 条是这种回声。

G1 回声：命中文本 ≈ 当前消息（归一化相等 / 包含 / bigram Jaccard >= 0.8）→ 丢
G2 近重复：几条命中彼此太像 → 只留分最高的那条
G3 多样性：同一分区最多 2 条，避免一次推 5 条都在说同一件事
"""
import re

from . import text as T

_STRIP = re.compile(r"@\d{5,}|#-?\d{5,}|\[[^\]]{0,30}\]|[\s\u3000]+")
_PUNCT_ALL = re.compile(r"[!-/:-@\[-\x60{-~。，、；：！？…—～·「」『』（）【】《》\s]+")


def norm(s):
    """归一化：去 @QQ、#消息号、方括号标记、标点空白，转小写。"""
    t = _STRIP.sub("", str(s or ""))
    t = _PUNCT_ALL.sub("", t)
    return t.lower()


def grams(s):
    return T.bigrams(norm(s))


def jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


def shared(a, b):
    return len(a & b)


def is_echo(text, query):
    """命中是不是「这句话自己」或几乎一样的一句。"""
    tn, qn = norm(text), norm(query)
    if not tn or not qn:
        return False
    ratio = min(len(tn), len(qn)) / max(1, max(len(tn), len(qn)))
    # 包含判定只在两段长度接近时成立，否则「你还记得…吗」会把短记忆整条误杀
    if len(qn) >= 6 and ratio >= 0.85 and (tn == qn or qn in tn or tn in qn):
        return True
    return jaccard(grams(text), grams(query)) >= 0.80


def echo_filter(hits, query):
    """丢掉与当前消息互为回声的命中；返回 (保留, 丢掉数)。"""
    kept, dropped = [], 0
    for h in hits:
        if is_echo(h.get("text", ""), query):
            dropped += 1
        else:
            kept.append(h)
    return kept, dropped


def dedupe(hits, threshold=0.85):
    """命中彼此近重复：保留分数高的，低分那条丢掉。调用方须已按分数降序。

    只在同分区、同极性之间合并 —— 「风很大 / 风很小」这种矛盾的两条都要留着，
    不然用户永远看不到另一半。
    """
    kept, dropped = [], 0
    for h in hits:
        hg = grams(h.get("text", ""))
        hp = T.polarity(h.get("text", ""))
        dup = False
        for k in kept:
            if h.get("region") != k.get("region"):
                continue
            if T.polarity(k.get("text", "")) != hp:
                continue
            if jaccard(hg, grams(k.get("text", ""))) >= threshold:
                dup = True
                break
        if dup:
            dropped += 1
        else:
            kept.append(h)
    return kept, dropped


def diversify(hits, k, max_per_region=2):
    """同一分区最多 max_per_region 条，再取前 k 条。"""
    out, count, rest = [], {}, []
    for h in hits:
        r = h.get("region", "fact")
        if count.get(r, 0) >= max_per_region:
            rest.append(h)
            continue
        count[r] = count.get(r, 0) + 1
        out.append(h)
        if len(out) >= k:
            break
    # 配额没填满（比如库里全是关系类）就回头把剩下的补上，别让 k 形同虚设
    if len(out) < k:
        for h in rest:
            out.append(h)
            if len(out) >= k:
                break
    return out
