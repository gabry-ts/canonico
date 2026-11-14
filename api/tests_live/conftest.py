"""Live end-to-end suite: real HTTP against a running server with a real model provider.

Skipped unless CANONICO_LIVE_TESTS=1. Without CANONICO_LIVE_BASE_URL a local server is spawned
with its own state file and an empty model cache in a temporary directory; with it (for example
http://localhost:8080/api for the Docker stack) the suite talks to that server.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

import httpx
import pytest

API_DIR = Path(__file__).resolve().parents[1]
ROOT = API_DIR.parent
CAP_USD = float(os.environ.get("CANONICO_LIVE_CAP_USD", "50"))
LIVE = os.environ.get("CANONICO_LIVE_TESTS") == "1"
# CANONICO_FORCE_LLM=1 is passed to the spawned server (and must be set on the Docker api service):
# deterministic rules, known phrasings and the model cache are skipped, every decision goes to the model.
FORCED = os.environ.get("CANONICO_FORCE_LLM") == "1"
REPORT: dict = {"scenarios": defaultdict(lambda: {"tests": {}, "paths": {}, "cost_usd": 0.0, "calls": 0, "input_tokens": 0, "output_tokens": 0, "notes": []})}
# Scenarios that must reach the model: their spend and their count of model calls have to grow.
MODEL_SCENARIOS = {"test_01_corpus", "test_02_questions", "test_04_mail", "test_05_items", "test_06_library", "test_07_adversarial"}
# With the Docker stack, model calls are counted from the cache files inside the api container.
DOCKER_SERVICE = os.environ.get("CANONICO_LIVE_DOCKER_SERVICE")
_TOTALS = """
import glob, json, os
root = os.environ.get("CANONICO_LLM_CACHE") or os.path.join(os.environ.get("CANONICO_CACHE_DIR", "/var/lib/canonico/cache"), "llm")
n = i = o = 0
for path in glob.glob(os.path.join(root, "*.json")):
    try:
        usage = json.load(open(path)).get("usage") or {}
    except Exception:
        continue
    n += 1; i += int(usage.get("input_tokens") or 0); o += int(usage.get("output_tokens") or 0)
print(json.dumps([n, i, o]))
"""


def pytest_configure(config):
    config.addinivalue_line("markers", "live: end-to-end tests against a running server with a real model")


def pytest_collection_modifyitems(config, items):
    skip = pytest.mark.skip(reason="live suite: set CANONICO_LIVE_TESTS=1")
    for item in items:
        if "tests_live" in str(item.fspath):
            item.add_marker(pytest.mark.live)
            if not LIVE:
                item.add_marker(skip)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def spawn_server(workdir: Path, extra_env: dict | None = None) -> tuple[subprocess.Popen, str]:
    """Start uvicorn on a free port with its own state and cache under workdir."""
    port = free_port()
    env = {
        **os.environ,
        "CANONICO_STATE_FILE": str(workdir / "state.json"),
        "CANONICO_CACHE_DIR": str(workdir / "cache"),
        "CANONICO_COST_CAP_USD": str(CAP_USD),
        "LLM_PROVIDER": "anthropic",
        **(extra_env or {}),
    }
    env.pop("CANONICO_LLM_DISABLED", None)
    env.pop("CANONICO_LLM_CACHE", None)
    log = open(workdir / "server.log", "ab")
    proc = subprocess.Popen(
        [str(API_DIR / ".venv" / "bin" / "uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=API_DIR, env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 60
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited early, see {workdir / 'server.log'}")
        try:
            if httpx.get(base + "/health", timeout=2).status_code == 200:
                return proc, base
        except httpx.HTTPError:
            pass
        time.sleep(0.3)
    proc.kill()
    raise RuntimeError("server did not become healthy")


def stop_server(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    assert proc.poll() is not None, "server still running"


class Api:
    """Thin HTTP client with spend accounting across demo resets."""

    def __init__(self, base: str, workdir: Path | None) -> None:
        self.base = base.rstrip("/")
        self.workdir = workdir
        self.http = httpx.Client(base_url=self.base, timeout=180)
        self.banked = 0.0

    @property
    def local(self) -> bool:
        return self.workdir is not None

    @property
    def cache_dir(self) -> Path | None:
        return self.workdir / "cache" / "llm" if self.workdir else None

    def model_totals(self) -> tuple[int, int, int] | None:
        """Model responses written so far (one file per live call) and their tokens, or None when not measurable."""
        if self.cache_dir is not None:
            n = i = o = 0
            for path in self.cache_dir.glob("*.json") if self.cache_dir.exists() else []:
                try:
                    usage = json.loads(path.read_text(encoding="utf-8")).get("usage") or {}
                except (OSError, ValueError):
                    continue
                n, i, o = n + 1, i + int(usage.get("input_tokens") or 0), o + int(usage.get("output_tokens") or 0)
            return n, i, o
        if DOCKER_SERVICE:
            done = subprocess.run(["docker", "compose", "exec", "-T", DOCKER_SERVICE, "python", "-c", _TOTALS], cwd=ROOT, capture_output=True, text=True, timeout=60)
            if done.returncode == 0 and done.stdout.strip():
                return tuple(json.loads(done.stdout.strip().splitlines()[-1]))
        return None

    def calls(self) -> int | None:
        totals = self.model_totals()
        return totals[0] if totals else None

    def get(self, path, **kw):
        return self.http.get(path, **kw)

    def post(self, path, **kw):
        return self.http.post(path, **kw)

    def patch(self, path, **kw):
        return self.http.patch(path, **kw)

    def stats(self, **params) -> dict:
        response = self.get("/stats", params=params)
        assert response.status_code == 200, response.text
        return response.json()

    def spent(self) -> float:
        return float(self.stats()["cost"]["spent_usd"])

    def spend(self) -> float:
        return self.banked + self.spent()

    def reset(self) -> dict:
        self.banked += self.spent()
        response = self.post("/demo/reset")
        assert response.status_code == 200, response.text
        self.configure(cost_cap_usd=CAP_USD, offline_mode=False)
        return response.json()

    def configure(self, **changes) -> dict:
        response = self.patch("/config", json=changes)
        assert response.status_code == 200, response.text
        return response.json()

    def ask(self, question: str, **extra) -> dict:
        headers = extra.pop("headers", None)
        response = self.post("/ask", json={"question": question, **extra}, headers=headers)
        assert response.status_code == 200, f"/ask {question!r}: {response.status_code} {response.text[:300]}"
        return response.json()

    def all_facts(self, **params) -> list[dict]:
        rows, offset = [], 0
        while True:
            response = self.get("/facts", params={**params, "limit": 500, "offset": offset})
            assert response.status_code == 200, response.text
            page = response.json()
            rows.extend(page["items"])
            offset += 500
            if offset >= page["total"]:
                return rows

    def document(self, doc_id: str) -> dict:
        response = self.get(f"/documents/{doc_id}")
        assert response.status_code == 200, f"document {doc_id}: {response.status_code}"
        return response.json()

    def wait_job(self, path: str, timeout: float = 900, done=("done", "error")) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.get(path)
            assert response.status_code != 404, f"{path} disappeared: the server was restarted or reset"
            body = response.json()
            if body.get("status") in done:
                return body
            time.sleep(2)
        raise AssertionError(f"{path} still running after {timeout}s")


@pytest.fixture(scope="session")
def api():
    base = os.environ.get("CANONICO_LIVE_BASE_URL")
    proc, workdir = None, None
    if base:
        client = Api(base, None)
    else:
        workdir = Path(tempfile.mkdtemp(prefix="canonico-live-"))
        proc, base = spawn_server(workdir)
        client = Api(base, workdir)
    login = client.post("/auth/demo-login")
    if login.status_code == 200:
        # servers with CANONICO_AUTH_REQUIRED need a session on every write; reads stay public
        client.http.headers["Authorization"] = f"Bearer {login.json()['token']}"
        REPORT["session"] = login.json()["member"].get("display_name") or login.json()["member"].get("id")
    config = client.get("/config").json()
    models = config.get("models", {})
    if config.get("provider") != "anthropic" or any("/" in str(m) for m in models.values()):
        if proc:
            stop_server(proc)
        pytest.exit(f"live suite requires the anthropic provider with native model ids, server reports provider={config.get('provider')} models={models}", returncode=2)
    REPORT["base_url"] = base
    REPORT["mode"] = "local" if workdir else "external"
    REPORT["models"] = models
    REPORT["forced"] = FORCED
    REPORT["workdir"] = str(workdir) if workdir else None
    client.reset()
    yield client
    REPORT["total_cost_usd"] = round(client.spend(), 4)
    if not proc:
        # an external server goes back to the seed, then the session is closed
        REPORT["final_reset"] = client.post("/demo/reset").status_code
        REPORT["logout"] = client.post("/auth/logout").status_code
    if proc:
        stop_server(proc)
        REPORT["server_stopped"] = proc.poll() is not None


@pytest.fixture(autouse=True)
def _meter(request, api):
    scenario = REPORT["scenarios"][Path(str(request.node.fspath)).stem]
    totals_before = api.model_totals()
    before = api.spend()
    yield
    after = api.spend()
    totals_after = api.model_totals()
    calls = tin = tout = None
    if totals_before is not None and totals_after is not None:
        calls, tin, tout = (a - b for a, b in zip(totals_after, totals_before))
        scenario["calls"] += calls
        scenario["input_tokens"] += tin
        scenario["output_tokens"] += tout
    else:
        scenario["calls"] = None
    scenario["cost_usd"] = round(scenario["cost_usd"] + after - before, 6)
    scenario["models"] = api.get("/config").json().get("models")
    report = getattr(request.node, "rep_call", None)
    scenario["tests"][request.node.name] = report.outcome if report else "error"
    model = (calls or 0) > 0 or after - before > 0
    scenario["paths"][request.node.name] = {"path": "model" if model else "deterministic path", "calls": calls, "usd": round(after - before, 6), "input_tokens": tin, "output_tokens": tout}


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call" or (rep.when == "setup" and rep.outcome != "passed"):
        item.rep_call = rep


@pytest.fixture(scope="module", autouse=True)
def _module_invariants(request, api):
    """Every scenario starts from the seed and ends with the memory invariants checked."""
    api.reset()
    yield
    name = Path(str(request.node.fspath)).stem
    problems = check_invariants(api)
    REPORT["scenarios"][name]["invariants"] = problems or "ok"
    assert not problems, "invariants broken after scenario: " + "; ".join(problems[:10])
    row = REPORT["scenarios"][name]
    # without CANONICO_FORCE_LLM a scenario may pass on the deterministic rules: the report marks it
    if FORCED and name in MODEL_SCENARIOS and row["tests"]:
        assert row["cost_usd"] > 0, f"{name} ran without model spend: served by the cache or by deterministic rules only"
        assert row["calls"] is None or row["calls"] > 0, f"{name} made no live model call"


def note(request, key: str, value) -> None:
    """Attach a measurement to the scenario of the running test."""
    REPORT["scenarios"][Path(str(request.node.fspath)).stem]["notes"].append({key: value})


def check_invariants(api: Api, project_id: str | None = None) -> list[str]:
    """One binding per topic, one pin per topic, and links that point to existing facts."""
    params = {"project_id": project_id} if project_id else {}
    facts = api.all_facts(**params)
    by_id = {f["id"]: f for f in facts}
    if project_id:
        by_id.update({f["id"]: f for f in api.all_facts()})
    topics = api.get("/topics", params=params).json()
    problems = []
    by_topic = defaultdict(list)
    for fact in facts:
        by_topic[fact["topic"]].append(fact)
        for key in ("supersedes", "superseded_by"):
            if fact.get(key) and fact[key] not in by_id:
                problems.append(f"{fact['id']}.{key} -> missing {fact[key]}")
    for topic in topics:
        for fact_id in topic["fact_ids"]:
            if fact_id not in by_id:
                problems.append(f"topic {topic['id']} lists missing fact {fact_id}")
        pinned = [f for f in by_topic[topic["id"]] if f["pinned"] and f["status"] == "active"]
        if len(pinned) > 1:
            problems.append(f"topic {topic['id']} has {len(pinned)} pinned facts")
        if not topic["fact_ids"]:
            continue
        response = api.post("/ask", json={"question": topic["label"], "topic": topic["id"], **params})
        if response.status_code != 200:
            problems.append(f"ask topic {topic['id']}: {response.status_code}")
            continue
        binding = response.json().get("binding")
        if binding is None:
            continue
        if binding["status"] != "active" or binding["type"] == "SUPERSEDED":
            problems.append(f"topic {topic['id']} binding {binding['id']} is {binding['status']}/{binding['type']}")
        if binding["topic"] != topic["id"]:
            # a topic that governs another one (the onboarding standard feeds the onboarding time) answers from it
            governed = api.post("/ask", json={"question": topic["label"], "topic": binding["topic"], **params})
            if governed.status_code != 200 or (governed.json().get("binding") or {}).get("id") != binding["id"]:
                problems.append(f"topic {topic['id']} binding {binding['id']} belongs to {binding['topic']}")
        if pinned and binding["id"] != pinned[0]["id"]:
            problems.append(f"topic {topic['id']} binding {binding['id']} is not the pinned {pinned[0]['id']}")
    return problems


def pytest_sessionfinish(session, exitstatus):
    if not LIVE or not REPORT["scenarios"]:
        return
    path = Path(os.environ.get("CANONICO_LIVE_REPORT") or Path(REPORT.get("workdir") or tempfile.gettempdir()) / "live-report.json")
    data = {**REPORT, "scenarios": dict(REPORT["scenarios"])}
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    lines = [f"\nlive report ({REPORT.get('mode')}, {REPORT.get('base_url')}, models {REPORT.get('models')})", f"{'scenario':<22}{'pass':>5}{'fail':>5}{'calls':>7}{'usd':>10}{'tok in':>10}{'tok out':>9}  invariants"]
    for name, row in sorted(data["scenarios"].items()):
        outcomes = list(row["tests"].values())
        calls = "n/a" if row["calls"] is None else row["calls"]
        lines.append(f"{name:<22}{outcomes.count('passed'):>5}{len(outcomes) - outcomes.count('passed') - outcomes.count('skipped'):>5}{calls:>7}{row['cost_usd']:>10.4f}{row['input_tokens']:>10}{row['output_tokens']:>9}  {'ok' if row.get('invariants') == 'ok' else row.get('invariants')}")
        for test, info in row["paths"].items():
            lines.append(f"    {test[:60]:<60} {info['path']:<19} calls={info['calls']} usd={info['usd']:.4f}")
    lines.append(f"total spend ${REPORT.get('total_cost_usd')} (cap ${CAP_USD})  report: {path}")
    sys.stdout.write("\n".join(lines) + "\n")
