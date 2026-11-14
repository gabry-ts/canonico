import os
import tempfile
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker

os.environ["CANONICO_STATE_FILE"] = str(Path(tempfile.mkdtemp(prefix="canonico-test-")) / "state.json")
os.environ["CANONICO_LLM_DISABLED"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SPEC = yaml.safe_load((ROOT / "openapi.yaml").read_text(encoding="utf-8"))


def _response_schema(method: str, path: str, status: int) -> dict:
    response = SPEC["paths"][path][method.lower()]["responses"][str(status)]
    if "$ref" in response:
        response = SPEC["components"]["responses"][response["$ref"].rsplit("/", 1)[1]]
    return response["content"]["application/json"]["schema"]


def assert_contract(response, method: str, path: str, status: int = 200):
    """Check status and body of a response against the schema in openapi.yaml."""
    assert response.status_code == status, response.text
    schema = {**_response_schema(method, path, status), "components": SPEC["components"]}
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(response.json()), key=str)
    assert not errors, "; ".join(f"{list(e.absolute_path)}: {e.message}" for e in errors[:5])
    return response.json()


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        test_client.post("/demo/reset")
        yield test_client


@pytest.fixture(scope="session")
def spec():
    return SPEC
