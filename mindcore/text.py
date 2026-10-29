"""文本工具：分词、相似度、分区判定、极性、归因闸门、地点识别。"""
import re

_CJK = re.compile(r"[\u4e00-\u9fff]+")
_LATIN = re.compile(r"[a-zA-Z0-9_]+")

# 归因闸门：把“他的态度”写成事实的句子（§3.11 事实纪律）
_INFERENCE = re.compile(
    r"(他觉得|她觉得|他认为|她认为|他故意|她故意|说明他|说明她|可见他|可见她|"
    r"表示他|表示她|他就是|她就是|他不爱我|她不爱我|在敷衍|在冷落)"
)

_NEG = set("不 没 别 厌 烦 恼 气 恨 怕 糟 差 坏 错 难 累 困 饿 疼 哭".split())
_POS = set("好 爱 喜 欢 笑 暖 甜 香 美 棒 开心 舒服 喜欢 高兴 满意".split())

PLACES = ("厨房", "菜棚", "阳台", "水井", "老树", "崖边", "码头", "屋子", "客厅", "卧室")

_REGION_RULES = [
    ("spine", ("吵", "生气", "不许", "边界", "冒犯", "讨厌你", "别碰", "道歉", "翻脸")),
    ("self", ("我是", "我不", "我讨厌", "我喜欢", "我的原则", "我不会", "我习惯")),
    ("relation", ("主人", "他", "她", "朋友", "群友", "大家")),
    ("preference", ("爱吃", "喜欢", "讨厌", "偏爱", "口味", "不爱")),
    ("habit", ("应该", "必须", "不能", "规矩", "每天", "总是")),
    ("episode", ("今天", "昨天", "前天", "上次", "那天", "刚才", "上周", "早上", "晚上")),
]


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def bigrams(text: str) -> set:
    """中文字二元组 + 拉丁词，作为词法通道的基础单元。"""
    t = normalize(text)
    out = set()
    for run in _CJK.findall(t):
        if len(run) == 1:
            out.add(run)
        for i in range(len(run) - 1):
            out.add(run[i:i + 2])
    for w in _LATIN.findall(t):
        out.add(w)
    return out


def dice(a: str, b: str) -> float:
    A, B = bigrams(a), bigrams(b)
    if not A or not B:
        return 0.0
    return 2.0 * len(A & B) / (len(A) + len(B))


def jaccard(a: str, b: str) -> float:
    A, B = bigrams(a), bigrams(b)
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


_SENTIMENT_WORDS = ("不喜欢", "喜欢", "讨厌", "不爱", "很爱", "爱", "恨", "烦", "怕",
                    "不", "没", "别", "超", "特别", "有点", "觉得")


def topic_of(text: str) -> str:
    """剥离情感词，只留话题。用于“同话题、反极性”的冲突判定。"""
    t = normalize(text)
    for w in _SENTIMENT_WORDS:
        t = t.replace(w, " ")
    return re.sub(r"\s+", " ", t).strip()


def topic_dice(a: str, b: str) -> float:
    return dice(topic_of(a), topic_of(b))


# 群聊转述标记：一条记录以「昵称：内容」开头（中文/英文冒号都算）。
# 用来区分「她自己说的话」和「别人说的、被记下来的话」——后者不能进 self 区。
_SPEAKER_PREFIX = re.compile(r"^\s*[^\s：:]{1,24}[：:]")


def has_speaker_prefix(text: str) -> bool:
    return bool(_SPEAKER_PREFIX.match(text or ""))


def region_of(text: str) -> str:
    t = normalize(text)
    for region, cues in _REGION_RULES:
        if any(c in t for c in cues):
            return region
    return "fact"


def polarity(text: str) -> int:
    t = normalize(text)
    neg = sum(1 for ch in t if ch in _NEG)
    pos = sum(1 for ch in t if ch in _POS)
    if neg > pos:
        return -1
    if pos > neg:
        return 1
    return 0


def has_inference(text: str) -> bool:
    return bool(_INFERENCE.search(text or ""))


def place_of(text: str):
    t = normalize(text)
    for p in PLACES:
        if p in t:
            return p
    return None


def top_terms(text: str, n: int = 6):
    """粗略的“主题词”：按二元组出现顺序去重取前 n 个。"""
    seen = []
    for run in _CJK.findall(normalize(text)):
        for i in range(len(run) - 1):
            bg = run[i:i + 2]
            if bg not in seen:
                seen.append(bg)
    return seen[:n]
