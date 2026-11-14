from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import logging
import os

from app import auth as session_auth
from app import http, i18n, library_s3, llm, settings
from app.routers import (
    admin,
    answers,
    ask,
    audit,
    auth,
    conflicts,
    documents,
    eval,
    facts,
    hooks,
    ingest,
    mail,
    maintenance,
    members,
    open_questions,
    org,
    search,
    topics,
)

VERSION = settings.VERSION

if not llm.available() and os.environ.get("CANONICO_LLM_DISABLED") != "1":
    logging.getLogger("uvicorn.error").warning("LLM_PROVIDER=%s but %s is not set: running without a model, seeded demo flows only.", llm.provider(), llm.key_name())


class Health(BaseModel):
    status: Literal["ok"]
    version: str


app = FastAPI(title="Canonico API", version=VERSION)

app.add_middleware(session_auth.AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins(),
    allow_origin_regex=settings.cors_origin_regex(),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(i18n.LocaleMiddleware)
http.install(app)
library_s3.start()


@app.get("/health", operation_id="getHealth", response_model=Health)
def get_health() -> Health:
    return Health(status="ok", version=VERSION)


for module in (
    ask,
    facts,
    topics,
    documents,
    audit,
    ingest,
    eval,
    conflicts,
    open_questions,
    maintenance,
    search,
    answers,
    admin,
    org,
    mail,
    members,
    hooks,
    auth,
):
    app.include_router(module.router)
