"""Shared HTTP helpers: error shape of the contract and validated JSON responses."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter
from starlette.exceptions import HTTPException as StarletteHTTPException

CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 415: "unsupported_media_type", 422: "validation_error", 500: "internal_error"}


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None) -> None:
        self.status = status
        self.message = message
        self.code = code or CODES.get(status, "error")


def not_found(what: str) -> ApiError:
    return ApiError(404, f"{what} not found.")


def dump(model: Any, data: Any) -> Any:
    """Validate data against a contract model and serialise it without unset optional fields."""
    adapter = TypeAdapter(model)
    return adapter.dump_python(adapter.validate_python(data), mode="json", by_alias=True, exclude_unset=True)


def out(model: Any, data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(dump(model, data), status_code=status)


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = CODES.get(exc.status_code, "error")
        return JSONResponse({"code": code, "message": str(exc.detail)}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        if any(e.get("type") == "json_invalid" for e in errors):
            return JSONResponse({"code": "bad_request", "message": "Malformed JSON body."}, status_code=400)
        parts = []
        for error in errors:
            loc = ".".join(str(p) for p in error.get("loc", ()) if p not in ("body", "query", "path"))
            parts.append(f"{loc}: {error.get('msg', 'invalid')}" if loc else str(error.get("msg", "invalid")))
        return JSONResponse({"code": "validation_error", "message": "; ".join(parts) or "Validation failed."}, status_code=422)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"code": "internal_error", "message": "Unexpected server error."}, status_code=500)
