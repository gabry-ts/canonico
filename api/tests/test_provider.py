import json

import httpx
import pytest

from app import llm


def test_anthropic_is_default(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL_FAST", raising=False)
    monkeypatch.delenv("LLM_MODEL_SMART", raising=False)
    assert llm.provider() == "anthropic"
    assert llm.default_models() == {"extraction": "claude-haiku-5-5", "classification": "claude-sonnet-5-5", "answer": "claude-sonnet-5-5"}


def test_gateway_default_models_and_overrides(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gateway")
    monkeypatch.delenv("LLM_MODEL_FAST", raising=False)
    monkeypatch.setenv("LLM_MODEL_SMART", "anthropic/custom")
    models = llm.default_models()
    assert models["extraction"] == "anthropic/claude-haiku-5.5"
    assert models["answer"] == models["classification"] == "anthropic/custom"


def test_provider_key_selection(monkeypatch):
    monkeypatch.delenv("CANONICO_LLM_DISABLED", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    assert llm.available()
    monkeypatch.setenv("LLM_PROVIDER", "gateway")
    assert not llm.available() and llm.key_name() == "AI_GATEWAY_API_KEY"
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "g")
    assert llm.available()


def test_gateway_request_shape(monkeypatch):
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, body=json, headers=headers)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{\"ok\": true}"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 2}}, request=httpx.Request("POST", url))

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "secret-g")
    monkeypatch.delenv("AI_GATEWAY_URL", raising=False)
    monkeypatch.setattr(llm.httpx, "post", fake_post)
    schema = {"type": "object"}
    text, tokens_in, tokens_out = llm._gateway("claude-haiku-5-5", "sys", "usr", schema, "res", 100)
    assert seen["url"] == "https://ai-gateway.vercel.sh/v1/chat/completions"
    assert seen["headers"] == {"Authorization": "Bearer secret-g"}
    body = seen["body"]
    assert body["model"] == "anthropic/claude-haiku-5.5"
    assert body["max_tokens"] == 100
    assert body["messages"] == [{"role": "system", "content": "sys"}, {"role": "user", "content": "usr"}]
    assert body["response_format"]["json_schema"] == {"name": "res", "schema": schema, "strict": True}
    assert json.loads(text) == {"ok": True} and (tokens_in, tokens_out) == (3, 2)


@pytest.mark.parametrize("status, message", [(402, "credit is used up"), (429, "rate limit"), (500, "status 500")])
def test_gateway_errors(monkeypatch, status, message):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "secret-g")
    monkeypatch.setattr(llm.httpx, "post", lambda url, **k: httpx.Response(status, text="no", request=httpx.Request("POST", url)))
    with pytest.raises(llm.LLMError, match=message):
        llm._gateway("claude-haiku-5-5", "sys", "usr", {"type": "object"}, "res", 100)


def test_complete_json_routes_to_gateway(monkeypatch, tmp_path):
    monkeypatch.delenv("CANONICO_LLM_DISABLED", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "gateway")
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "g")
    monkeypatch.setenv("CANONICO_LLM_CACHE", str(tmp_path))
    monkeypatch.setattr(llm, "_gateway", lambda *a, **k: ('{"v": 1}', 10, 5))
    monkeypatch.setattr(llm, "_anthropic", lambda *a, **k: pytest.fail("anthropic must not be called"))
    meter = llm.Meter(cap_usd=1.0)
    assert llm.complete_json("anthropic/claude-haiku-5.5", "s", "u", {"type": "object"}, meter) == {"v": 1}
    assert meter.calls == 1


def test_disabled_blocks_calls(monkeypatch, tmp_path):
    monkeypatch.setenv("CANONICO_LLM_DISABLED", "1")
    monkeypatch.setenv("CANONICO_LLM_CACHE", str(tmp_path))
    for name in ("anthropic", "gateway"):
        monkeypatch.setenv("LLM_PROVIDER", name)
        with pytest.raises(llm.LLMUnavailable):
            llm.complete_json("m", "s", "u", {"type": "object"}, llm.Meter(cap_usd=1.0))
