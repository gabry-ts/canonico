"""Provider-agnostic structured completions with a hard cost cap and an on-disk cache.

LLM_PROVIDER=anthropic calls the Anthropic Messages API (ANTHROPIC_API_KEY).
LLM_PROVIDER=gateway calls the OpenAI-compatible Vercel AI Gateway (AI_GATEWAY_API_KEY).
Keys are read from the environment only and never logged.
"""

import hashlib
import json
import os
import re
import threading
from pathlib import Path

import httpx

from app import settings

GATEWAY_URL = "https://ai-gateway.vercel.sh/v1"
# USD per million tokens (input, output)
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-5-5": (4.00, 20.00),
}
FALLBACK_PRICE = (5.00, 25.00)
FALLBACK_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")


class LLMError(Exception):
    pass


class LLMUnavailable(LLMError):
    pass


class CostCapReached(LLMError):
    pass


class Meter:
    """Tracks spend of one run and refuses calls that could exceed the cap."""

    def __init__(self, cap_usd: float | None = None, spent_usd: float = 0.0) -> None:
        self.cap = float(os.environ.get("CANONICO_COST_CAP_USD", "2.00")) if cap_usd is None else cap_usd
        self.spent = spent_usd
        self.reserved = 0.0
        self.calls = 0
        self.cached = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.lock = threading.Lock()

    def reserve(self, estimate: float) -> None:
        with self.lock:
            if self.spent + self.reserved + estimate > self.cap:
                raise CostCapReached(f"Cost cap of ${self.cap:.2f} reached (spent ${self.spent:.4f}).")
            self.reserved += estimate

    def settle(self, estimate: float, cost: float, input_tokens: int, output_tokens: int) -> None:
        with self.lock:
            self.reserved = max(0.0, self.reserved - estimate)
            self.spent += cost
            self.calls += 1
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens

    def summary(self) -> dict:
        return {
            "calls": self.calls,
            "cached_calls": self.cached,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.spent, 4),
        }


def provider() -> str:
    return (os.environ.get("LLM_PROVIDER") or "gateway").strip().lower()


def available() -> bool:
    if os.environ.get("CANONICO_LLM_DISABLED") == "1":
        return False
    key = "ANTHROPIC_API_KEY" if provider() == "anthropic" else "AI_GATEWAY_API_KEY"
    return bool(os.environ.get(key))


def bare_model(model: str) -> str:
    name = model.split("/")[-1]
    return re.sub(r"-(\d+)\.(\d+)$", r"-\1-\2", name)


def price(model: str) -> tuple[float, float]:
    return PRICES.get(bare_model(model), FALLBACK_PRICE)


def cost_of(model: str, input_tokens: int, output_tokens: int) -> float:
    cost_in, cost_out = price(model)
    return (input_tokens * cost_in + output_tokens * cost_out) / 1_000_000


def cache_dir() -> Path:
    return Path(os.environ.get("CANONICO_LLM_CACHE") or settings.cache_dir() / "llm")


def _cache_key(model: str, system: str, user: str, schema: dict, max_tokens: int, effort: str) -> str:
    payload = json.dumps([bare_model(model), system, user, schema, max_tokens, effort], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def complete_json(model: str, system: str, user: str, schema: dict, meter: Meter, name: str = "result", max_tokens: int = 8000, effort: str = "low", timeout: float = 240.0, retries: int = 4) -> dict:
    """Return a JSON object that follows the schema. Cached by input hash, capped by the meter."""
    path = cache_dir() / f"{_cache_key(model, system, user, schema, max_tokens, effort)}.json"
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))["data"]
            with meter.lock:
                meter.cached += 1
            return data
        except (OSError, ValueError, KeyError):
            pass
    if not available():
        raise LLMUnavailable("No model provider is configured.")
    cost_in, cost_out = price(model)
    estimate = ((len(system) + len(user)) / 2.5 * cost_in + max_tokens * cost_out) / 1_000_000
    meter.reserve(estimate)
    input_tokens = output_tokens = 0
    try:
        if provider() == "anthropic":
            text, input_tokens, output_tokens = _anthropic(bare_model(model), system, user, schema, max_tokens, effort, timeout, retries)
        else:
            text, input_tokens, output_tokens = _gateway(model, system, user, schema, name, max_tokens, timeout)
    finally:
        meter.settle(estimate, cost_of(model, input_tokens, output_tokens), input_tokens, output_tokens)
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise LLMError("Model returned invalid JSON.") from exc
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {"model": bare_model(model), "data": data, "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}}
        path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return data


def _anthropic(model: str, system: str, user: str, schema: dict, max_tokens: int, effort: str, timeout: float = 240.0, retries: int = 4) -> tuple[str, int, int]:
    import anthropic

    client = anthropic.Anthropic(max_retries=retries, timeout=timeout)
    request = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    }
    try:
        response = None
        if model in FALLBACK_MODELS:
            try:
                response = client.beta.messages.create(**request, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            except anthropic.BadRequestError:
                response = None
        if response is None:
            response = client.messages.create(**request)
    except anthropic.RateLimitError as exc:
        raise LLMError("Model provider rate limit reached.") from exc
    except anthropic.APIStatusError as exc:
        raise LLMError(f"Model provider returned status {exc.status_code}.") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMError("Model provider is unreachable.") from exc
    usage = response.usage
    input_tokens = (usage.input_tokens or 0) + (getattr(usage, "cache_creation_input_tokens", 0) or 0) + (getattr(usage, "cache_read_input_tokens", 0) or 0)
    output_tokens = usage.output_tokens or 0
    if response.stop_reason == "refusal":
        raise LLMError("Model declined the request.")
    if response.stop_reason == "max_tokens":
        raise LLMError("Model output was truncated.")
    text = next((block.text for block in response.content if block.type == "text"), "")
    return text, input_tokens, output_tokens


def gateway_model(model: str) -> str:
    if "/" in model:
        return model
    return "anthropic/" + re.sub(r"-(\d+)-(\d+)$", r"-\1.\2", model)


def _gateway(model: str, system: str, user: str, schema: dict, name: str, max_tokens: int, timeout: float = 240.0) -> tuple[str, int, int]:
    body = {
        "model": gateway_model(model),
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}},
    }
    headers = {"Authorization": f"Bearer {os.environ.get('AI_GATEWAY_API_KEY', '')}"}
    try:
        response = httpx.post(f"{os.environ.get('AI_GATEWAY_URL') or GATEWAY_URL}/chat/completions", json=body, headers=headers, timeout=timeout)
    except httpx.HTTPError as exc:
        raise LLMError("Model gateway is unreachable.") from exc
    if response.status_code >= 400:
        raise LLMError(f"Model gateway returned status {response.status_code}.")
    payload = response.json()
    usage = payload.get("usage") or {}
    text = (payload.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    return text, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
