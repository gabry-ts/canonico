.PHONY: install api web mock types test test-docker docker-up docker-down docker-logs

install:
	uv venv api/.venv 2>/dev/null || python3 -m venv api/.venv
	uv pip install -p api/.venv/bin/python -e "api[dev]" 2>/dev/null || api/.venv/bin/pip install -e "api[dev]"
	cd web && npm install

api:
	cd api && .venv/bin/uvicorn app.main:app --reload --port 8000

test:
	cd api && .venv/bin/python -m pytest -q

# real SMTP and IMAP round trip against a throwaway GreenMail container (needs docker)
test-docker:
	docker run -d --rm --name canonico-greenmail -e GREENMAIL_OPTS='-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=brain:canonico-demo@inbound.meridianlabs.org -Dgreenmail.auth.disabled=false' -p 3025:3025 -p 3143:3143 greenmail/standalone:2.1.15
	@until docker logs canonico-greenmail 2>&1 | grep -q "Starting GreenMail API"; do sleep 1; done
	cd api && .venv/bin/python -m pytest tests/test_imap_real.py -m docker -q; status=$$?; docker stop canonico-greenmail >/dev/null; exit $$status

web:
	cd web && npm run dev

mock:
	npx @stoplight/prism-cli mock openapi.yaml -p 4010

types:
	cd api && .venv/bin/datamodel-codegen --input ../openapi.yaml --input-file-type openapi --output app/models.py --output-model-type pydantic_v2.BaseModel --use-standard-collections --use-union-operator --field-constraints --target-python-version 3.11 --custom-file-header "# generated from openapi.yaml, do not edit"
	cd web && npm run types

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f --tail=100
