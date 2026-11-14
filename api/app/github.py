"""Public GitHub repositories as a source: README and issues become documents.

Only the unauthenticated REST API is used, so only public repositories work. Responses are cached
on disk and reused when the rate limit is reached, when the network is down or in offline mode.
A snapshot committed in data/seed/github is the last resort, so a sync never fails on stage.
"""

import base64
import hashlib
import json
import re
import time
from pathlib import Path

import httpx

from app import settings, store

API = "https://api.github.com"
FRESH_SECONDS = 600
_REPO = re.compile(r"^https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")


class GithubError(Exception):
    pass


def parse_repo(url: str) -> tuple[str, str]:
    match = _REPO.match(str(url).strip())
    if not match:
        raise GithubError("repo_url must look like https://github.com/owner/repository")
    return match.group(1), match.group(2)


def cache_dir() -> Path:
    return settings.API_DIR / ".cache" / "github"


def snapshot_path(owner: str, repo: str) -> Path:
    return store.seed_dir() / "github" / f"{owner}__{repo}.json"


def _get(path: str, offline: bool) -> dict | list:
    """GET a GitHub API path as JSON, through the disk cache."""
    file = cache_dir() / (hashlib.sha256(path.encode()).hexdigest()[:24] + ".json")
    cached = None
    if file.exists():
        try:
            cached = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cached = None
    if cached and (offline or time.time() - cached.get("fetched_at", 0) < FRESH_SECONDS):
        return cached["body"]
    if offline:
        raise GithubError("offline and nothing cached for this repository")
    try:
        response = httpx.get(API + path, headers={"Accept": "application/vnd.github+json", "User-Agent": "canonico-demo", "X-GitHub-Api-Version": "2022-11-28"}, timeout=15.0)
    except httpx.HTTPError as exc:
        if cached:
            return cached["body"]
        raise GithubError("GitHub is unreachable") from exc
    if response.status_code == 200:
        body = response.json()
        try:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps({"fetched_at": time.time(), "body": body}, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
        return body
    if cached:
        return cached["body"]
    if response.status_code in (403, 429):
        raise GithubError("GitHub rate limit reached, try again later")
    if response.status_code == 404:
        raise GithubError("repository not found or not public")
    raise GithubError(f"GitHub returned status {response.status_code}")


def _documents(owner: str, repo: str, readme: dict | None, issues: list, include: list[str]) -> list[dict]:
    base = f"github/{owner}/{repo}"
    docs = []
    if readme and "readme" in include:
        try:
            text = base64.b64decode(readme.get("content", "")).decode("utf-8", errors="replace")
        except ValueError:
            text = ""
        if text.strip():
            docs.append({"id": f"{base}/readme", "title": f"{owner}/{repo} README", "date": store.now()[:10], "path": f"{base}/README.md", "text": text})
    for issue in issues:
        is_pull = "pull_request" in issue
        if (is_pull and "pulls" not in include) or (not is_pull and "issues" not in include):
            continue
        labels = ", ".join(label.get("name", "") for label in issue.get("labels", []))
        header = f"#{issue['number']} {issue.get('title', '')}\nState: {issue.get('state', '')}\nLabels: {labels}\nAuthor: {(issue.get('user') or {}).get('login', '')}\n"
        docs.append(
            {
                "id": f"{base}/{'pulls' if is_pull else 'issues'}/{issue['number']}",
                "title": f"#{issue['number']} {issue.get('title', '')}",
                "date": (issue.get("created_at") or store.now())[:10],
                "path": f"{base}/issues/{issue['number']}",
                "text": header + "\n" + (issue.get("body") or ""),
            }
        )
    return docs


def fetch(repo_url: str, include: list[str] | None = None, limit: int = 30, offline: bool = False) -> list[dict]:
    """Documents of a public repository: README and the most recently updated issues."""
    owner, repo = parse_repo(repo_url)
    include = include or ["issues", "readme"]
    try:
        info = _get(f"/repos/{owner}/{repo}", offline)
        if isinstance(info, dict) and info.get("private"):
            raise GithubError("only public repositories are supported")
        readme = _get(f"/repos/{owner}/{repo}/readme", offline) if "readme" in include else None
        issues = _get(f"/repos/{owner}/{repo}/issues?state=all&per_page={limit}&sort=updated", offline) if {"issues", "pulls"} & set(include) else []
        return _documents(owner, repo, readme if isinstance(readme, dict) else None, issues if isinstance(issues, list) else [], include)
    except GithubError:
        snapshot = snapshot_path(owner, repo)
        if snapshot.exists():
            return json.loads(snapshot.read_text(encoding="utf-8"))
        raise


def preview(owner: str, repo: str, offline: bool = False) -> dict:
    """Public facts about a repository, to show before it is added as a source."""
    try:
        info = _get(f"/repos/{owner}/{repo}", offline)
    except GithubError:
        if not snapshot_path(owner, repo).exists():
            raise
        documents = json.loads(snapshot_path(owner, repo).read_text(encoding="utf-8"))
        return {
            "repo_url": f"https://github.com/{owner}/{repo}",
            "full_name": f"{owner}/{repo}",
            "public": True,
            "description": None,
            "default_branch": "main",
            "open_issues": sum(1 for d in documents if "/issues/" in d["id"] and "State: open" in d["text"]),
            "has_readme": any(d["id"].endswith("/readme") for d in documents),
            "last_pushed_at": None,
        }
    if not isinstance(info, dict) or info.get("private"):
        raise GithubError("not public")
    has_readme = True
    try:
        _get(f"/repos/{owner}/{repo}/readme", offline)
    except GithubError:
        has_readme = False
    return {
        "repo_url": f"https://github.com/{owner}/{repo}",
        "full_name": info.get("full_name") or f"{owner}/{repo}",
        "public": True,
        "description": info.get("description"),
        "default_branch": info.get("default_branch") or "main",
        "open_issues": int(info.get("open_issues_count") or 0),
        "has_readme": has_readme,
        "last_pushed_at": info.get("pushed_at"),
    }
