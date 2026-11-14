"""Shared checks of addresses and routing values, so every endpoint refuses the same inputs with the same words."""

import re

from app.http import ApiError

_EMAIL = re.compile(r"^[^@\s<>()\[\],;:\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")
_DOMAIN = re.compile(r"^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")

BAD_ADDRESS = "{field}: enter an email address like brain@inbound.example.com."
BAD_DOMAIN = "value: enter a sender domain like @client.com."
BAD_RULE_ADDRESS = "value: enter an email address like name@client.com."


def is_email(value: str | None) -> bool:
    return bool(value) and bool(_EMAIL.match(value.strip()))


def is_domain(value: str | None) -> bool:
    return bool(value) and bool(_DOMAIN.match(value.strip()))


def email(value: str | None, field: str) -> str | None:
    """An optional email address: None or blank stays None, anything else must be an address."""
    if value is None or not value.strip():
        return None
    if not is_email(value):
        raise ApiError(422, BAD_ADDRESS.format(field=field))
    return value.strip()


def rule_value(match_type: str, value: str) -> str:
    """The value of a mail routing rule, checked against its match type."""
    value = (value or "").strip()
    if not value:
        raise ApiError(422, "value: must not be empty")
    if match_type == "sender_domain":
        if not is_domain(value if value.startswith("@") else "@" + value):
            raise ApiError(422, BAD_DOMAIN)
        return value if value.startswith("@") else "@" + value
    if match_type in ("sender_address", "recipient") and not is_email(value):
        raise ApiError(422, BAD_RULE_ADDRESS)
    return value
