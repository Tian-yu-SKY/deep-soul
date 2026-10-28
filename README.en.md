# Deep-Soul · Sea of Consciousness

**Long-term memory for a persona living inside DeepSeek Harness.**

Deep-Soul is a DSH plugin that stores what is worth remembering, retrieves it when relevant, and keeps privacy at the retrieval layer. It does not change the model or take over the chat.

![panel](docs/figures/fig4-shihai-ui.png)

## Features

- Traceable memories: source, time, speaker, and evidence for every entry.
- Separate weights: emotional salience (alpha) and belief strength (beta).
- Forgetting curves per region: trivia fades in ~21 days, shared episodes ~180 days.
- Privacy by audience: private / group (chat-scoped) / public, enforced in recall.
- Sidebar "Sea of Consciousness" panel: clusters, decay, time travel, evidence.

## Architecture

![arch](docs/figures/fig1-architecture.png)

DSH host (Node) talks to a Python kernel over stdin/stdout; all state lives in one SQLite (WAL) file under ~/.dsh/deep-soul/.

## Install

Requirements: DSH web profile, Node 22+, Python 3.10+ (stdlib only).

    git clone <repo> deep-soul
    cd deep-soul
    dsh plugin --profile web add link:$PWD/dsh-deep-soul

If the kernel lives elsewhere, set DEEP_SOUL_ROOT. DSH host tools path can be overridden with DSH_TOOLS_PATH.

## Tests

    python3 mindcore/tests/selftest.py
    python3 mindcore/tests/test_self.py
    python3 mindcore/tests/test_v43.py

## Docs

Technical report (Chinese, with figures): docs/Deep-Soul-识海-技术论述.docx

## License

MIT.
