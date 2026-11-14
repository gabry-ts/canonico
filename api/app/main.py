from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.routers import (
    admin,
    answers,
    ask,
    audit,
    conflicts,
    documents,
    eval,
    facts,
    ingest,
    maintenance,
    open_questions,
    search,
    topics,
)

VERSION = "0.1.0"


class Health(BaseModel):
    status: Literal["ok"]
    version: str


app = FastAPI(title="Canonico API", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
):
    app.include_router(module.router)
