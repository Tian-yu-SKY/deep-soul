"""SQLite（WAL）状态层：表结构、事务、快照与回滚。"""
import os
import json
import time
import sqlite3
import hashlib
import contextlib

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS nodes(
  id INTEGER PRIMARY KEY,
  uid TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  valence REAL DEFAULT 0,
  arousal REAL DEFAULT 0,
  affect_w REAL NOT NULL,
  belief_w REAL NOT NULL,
  belief_pending_until REAL DEFAULT 0,
  source TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'private',
  created_at REAL NOT NULL,
  last_hit REAL DEFAULT 0,
  hits INTEGER DEFAULT 0,
  valid_from REAL NOT NULL,
  valid_to REAL,
  status TEXT NOT NULL DEFAULT 'active',
  level TEXT NOT NULL DEFAULT 'normal',
  chat_id TEXT NOT NULL DEFAULT '',
  embedding BLOB,
  embed_model TEXT,
  embed_dim INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_region ON nodes(region);
CREATE INDEX IF NOT EXISTS idx_nodes_created ON nodes(created_at);

CREATE TABLE IF NOT EXISTS edges(
  src INTEGER NOT NULL,
  dst INTEGER NOT NULL,
  kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at REAL NOT NULL,
  PRIMARY KEY(src, dst, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);

CREATE TABLE IF NOT EXISTS cells(
  cell_id TEXT PRIMARY KEY,
  audience TEXT NOT NULL,
  region TEXT NOT NULL,
  centroid BLOB,
  summary TEXT,
  size INTEGER DEFAULT 0,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS cell_members(
  cell_id TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  PRIMARY KEY(cell_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_cell_members_node ON cell_members(node_id);

CREATE TABLE IF NOT EXISTS anchors(
  node_id INTEGER PRIMARY KEY,
  place TEXT, x REAL, y REAL, weather TEXT,
  cat_hunger REAL, coins REAL, at REAL NOT NULL, ttl REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence(
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL,
  message_id TEXT,
  speaker TEXT,
  ts REAL NOT NULL,
  excerpt TEXT,
  deleted_at REAL
);
CREATE INDEX IF NOT EXISTS idx_evidence_node ON evidence(node_id);

CREATE TABLE IF NOT EXISTS self_claims(
  id INTEGER PRIMARY KEY,
  claim TEXT NOT NULL,
  confidence REAL NOT NULL,
  since REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'self'
);

CREATE TABLE IF NOT EXISTS claim_evidence(
  claim_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  PRIMARY KEY(claim_id, node_id)
);

CREATE TABLE IF NOT EXISTS autobiography(
  id INTEGER PRIMARY KEY,
  chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  period_start REAL, period_end REAL, created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS preference_revisions(
  id INTEGER PRIMARY KEY,
  frm TEXT NOT NULL, to_ TEXT NOT NULL,
  cause_node INTEGER, at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS spine(
  id INTEGER PRIMARY KEY,
  node_id INTEGER UNIQUE NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  resolved_at REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS acl(
  node_id INTEGER NOT NULL,
  principal TEXT NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY(node_id, principal)
);

CREATE TABLE IF NOT EXISTS metrics(
  day TEXT PRIMARY KEY,
  sci REAL, si REAL, er REAL, ir REAL, gr REAL, rr REAL, cr REAL, cost REAL
);

CREATE TABLE IF NOT EXISTS snapshots(
  ts REAL PRIMARY KEY, path TEXT NOT NULL, reason TEXT, hash TEXT
);

CREATE TABLE IF NOT EXISTS review_queue(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, kind TEXT NOT NULL,
  initiator TEXT, evidence INTEGER, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, ts);

CREATE TABLE IF NOT EXISTS self_revisions(
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before TEXT, after TEXT,
  at REAL NOT NULL,
  by_ TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS self_snapshots(
  day TEXT PRIMARY KEY, text TEXT NOT NULL, vec BLOB
);
"""


class Store:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.conn = None
        self.open()

    def open(self):
        self.conn = sqlite3.connect(self.path, isolation_level=None, timeout=10)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self._migrate()
        return self

    def _migrate(self):
        """老库补列：节点等级（v4.3 命中晋升用）。"""
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(nodes)").fetchall()}
        if "level" not in cols:
            self.conn.execute("ALTER TABLE nodes ADD COLUMN level TEXT NOT NULL DEFAULT 'normal'")
        if "chat_id" not in cols:
            self.conn.execute("ALTER TABLE nodes ADD COLUMN chat_id TEXT NOT NULL DEFAULT ''")


    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None

    @contextlib.contextmanager
    def tx(self):
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            yield self.conn
        except Exception:
            self.conn.execute("ROLLBACK")
            raise
        else:
            self.conn.execute("COMMIT")

    # ---- meta / config ----
    def get_meta(self, key, default=None):
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_meta(self, key, value):
        self.conn.execute(
            "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value, ensure_ascii=False)),
        )

    # ---- 快照 ----
    def snapshot(self, reason="manual", keep=None):
        ts = time.time()
        snap_dir = os.path.join(os.path.dirname(self.path), "snapshots")
        os.makedirs(snap_dir, exist_ok=True)
        tag = time.strftime("%Y%m%d-%H%M%S", time.localtime(ts))
        dest = os.path.join(snap_dir, f"mind-{tag}-{int(ts)}.db")
        backup = sqlite3.connect(dest)
        with backup:
            self.conn.backup(backup)
        backup.close()
        with open(dest, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        self.conn.execute("INSERT OR REPLACE INTO snapshots(ts,path,reason,hash) VALUES(?,?,?,?)",
                          (ts, dest, reason, digest))
        if keep:
            self.prune_snapshots(keep)
        return dest

    def prune_snapshots(self, keep):
        rows = self.conn.execute("SELECT ts,path FROM snapshots ORDER BY ts DESC").fetchall()
        for r in rows[keep:]:
            try:
                os.remove(r["path"])
            except OSError:
                pass
            self.conn.execute("DELETE FROM snapshots WHERE ts=?", (r["ts"],))

    def restore(self, ts):
        row = self.conn.execute("SELECT path FROM snapshots WHERE ts=?", (ts,)).fetchone()
        if not row:
            raise KeyError(f"no snapshot at {ts}")
        self.close()
        src = sqlite3.connect(row["path"])
        dst = sqlite3.connect(self.path)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        self.open()
        return self.path

    # ---- 便捷查询 ----
    def node(self, node_id):
        row = self.conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        return dict(row) if row else None

    def active_nodes(self):
        return [dict(r) for r in self.conn.execute(
            "SELECT * FROM nodes WHERE status='active' AND (valid_to IS NULL OR valid_to > ?)",
            (time.time(),))]

    def count(self, sql, args=()):
        return self.conn.execute(sql, args).fetchone()[0]
