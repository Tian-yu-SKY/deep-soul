"""可选向量通道。

生产环境应接 text-embedding-v4；本机没有凭据，因此默认离线，并提供
HashEmbedder 作为测试与降级演示用的确定性替身（不是语义模型，只是
让分舱、余弦、PPR 的代码路径可被验证）。
"""
import math
import hashlib
import struct

from .text import bigrams


class HashEmbedder:
    """签名哈希词袋：把字二元组散列到 dim 维，L2 归一化。"""

    def __init__(self, dim: int = 64):
        self.dim = dim
        self.model = "hash-bow"
        self.version = 1

    def encode(self, text: str) -> list:
        v = [0.0] * self.dim
        for bg in bigrams(text):
            h = int(hashlib.blake2b(bg.encode("utf-8"), digest_size=8).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 63) & 1 else -1.0
            v[idx] += sign
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def to_blob(self, vec) -> bytes:
        return struct.pack("<%df" % len(vec), *vec)

    def from_blob(self, blob: bytes) -> list:
        n = len(blob) // 4
        return list(struct.unpack("<%df" % n, blob))


def cosine(a, b) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def mean_vec(vecs):
    vecs = [v for v in vecs if v]
    if not vecs:
        return None
    n = len(vecs[0])
    out = [0.0] * n
    for v in vecs:
        for i, x in enumerate(v):
            out[i] += x
    norm = math.sqrt(sum(x * x for x in out)) or 1.0
    return [x / norm for x in out]
