.PHONY: install api web mock types test

install:
	uv venv api/.venv 2>/dev/null || python3 -m venv api/.venv
	uv pip install -p api/.venv/bin/python -e "api[dev]" 2>/dev/null || api/.venv/bin/pip install -e "api[dev]"
	cd web && npm install

api:
	cd api && .venv/bin/uvicorn app.main:app --reload --port 8000

test:
	cd api && .venv/bin/python -m pytest -q

web:
	cd web && npm run dev

mock:
	npx @stoplight/prism-cli mock openapi.yaml -p 4010

types:
	cd api && .venv/bin/datamodel-codegen --input ../openapi.yaml --input-file-type openapi --output app/models.py --output-model-type pydantic_v2.BaseModel --use-standard-collections --use-union-operator --field-constraints --target-python-version 3.11 --custom-file-header "# generated from openapi.yaml, do not edit"
	cd web && npm run types
