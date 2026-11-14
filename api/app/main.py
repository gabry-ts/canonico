from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import http, i18n, settings
from app.routers import (
    admin,
    answers,
    ask,
    audit,
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


class Health(BaseModel):
    status: Literal["ok"]
    version: str


app = FastAPI(title="Canonico API", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins(),
    allow_origin_regex=settings.cors_origin_regex(),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(i18n.LocaleMiddleware)
http.install(app)


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
):
    app.include_router(module.router)
