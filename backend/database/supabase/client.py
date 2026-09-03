"""Small Supabase REST client for backend repositories."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

def _load_project_environment() -> None:
    env_path = (
        Path(sys.executable).resolve().parents[1] / ".env"
        if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parents[3] / ".env"
    )
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


_load_project_environment()

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv(
    "VITE_SUPABASE_PUBLISHABLE_KEY", ""
)


def is_configured() -> bool:
    return bool(
        SUPABASE_URL
        and SUPABASE_KEY
        and not SUPABASE_URL.startswith("REPLACE_")
        and not SUPABASE_KEY.startswith("REPLACE_")
    )


def request(
    method: str,
    table: str,
    *,
    query: dict[str, str] | None = None,
    payload: Any = None,
    prefer: str | None = None,
) -> Any:
    if not is_configured():
        if method.upper() == "GET":
            return None
        raise RuntimeError("Supabase is not configured; the local change will retry later.")

    query_string = f"?{urlencode(query)}" if query else ""
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    http_request = Request(
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table}{query_string}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(http_request, timeout=15) as response:
            content = response.read()
            return json.loads(content) if content else None
    except HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed ({error.code}): {details}") from error
