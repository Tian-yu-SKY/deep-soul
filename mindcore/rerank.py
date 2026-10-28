"""覆盖度重排：用「这条记忆覆盖了查询里多少 idf 信息量」代替绝对分门限。

为什么：绝对门限（0.25）是在原始分数上剪枝，可分数又被 affect_w(<=3.8)、
分区 boost、驱力偏置乘过，跨查询不可比；而「覆盖度」是归一化到 0~1 的，
问句长一点、短一点都还能比。鱼脑用它在 30 条真实消息上把召回从 5/10 提到 9/10。

cov = sum(idf(共享 bigram)) / sum(idf(查询的全部 bigram))，idf = ln(1 + N/df)。
df 表按「节点数 + 最大 id」缓存 —— 库不长大就不重算。
"""
import math

from . import text as T


class Reranker:
    def __init__(self):
        self._key = None
        self._df = {}
        self._n = 0
        self._bg = {}

    def _grams_of(self, nid, text):
        key = (nid, len(text))
        g = self._bg.get(key)
        if g is None:
            g = T.bigrams(str(text)[:200])
            self._bg[key] = g
        return g

    def _table(self, docs):
        """docs: [(id, text)]。全量 bigram 文档频次，按节点数/最大 id 缓存。"""
        key = (len(docs), docs[-1][0] if docs else 0)
        if key == self._key:
            return self._df, self._n
        df = {}
        for nid, text in docs:
            for g in self._grams_of(nid, text):
                df[g] = df.get(g, 0) + 1
        self._df, self._n, self._key = df, max(1, len(docs)), key
        # 节点删改后旧缓存会无限长，超过 3 倍节点数就整体清一次
        if len(self._bg) > max(2000, len(docs) * 3):
            self._bg = {}
        return df, self._n

    def coverage_rank(self, hits, docs, queries, cov_min=0.18):
        """按覆盖度重排并过滤；返回 (排序后的 hits, 门槛以下丢掉数)。"""
        if not hits:
            return [], 0
        df, n = self._table(docs)
        qgrams = []
        for q in queries:
            gs = [g for g in T.bigrams(str(q or "")) if g]
            if gs:
                qgrams.append(gs)
        if not qgrams:
            return hits, 0

        idf = {}
        def weight(g):
            if g not in idf:
                idf[g] = math.log(1 + n / max(1, df.get(g, 0)))
            return idf[g]

        totals = [sum(weight(g) for g in gs) or 1e-6 for gs in qgrams]
        scored, dropped = [], 0
        for h in hits:
            hg = self._grams_of(h.get("id"), h.get("text", ""))
            cov = 0.0
            for gs, total in zip(qgrams, totals):
                c = sum(weight(g) for g in gs if g in hg)
                cov = max(cov, c / total)
            h["cov"] = round(cov, 4)
            if cov < cov_min:
                dropped += 1
                continue
            scored.append(h)
        scored.sort(key=lambda x: (-x["cov"], -float(x.get("score") or 0), x.get("id", 0)))
        return scored, dropped
