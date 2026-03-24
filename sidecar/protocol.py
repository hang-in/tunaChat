"""
stdio JSON Lines protocol for Rust <-> Python sidecar communication.

Uses thread-based stdin reading for Windows compatibility.
"""

from __future__ import annotations

import sys
import json
import asyncio
import threading
from dataclasses import asdict
from typing import Any, AsyncIterator

from sidecar.model import TunapiEvent


def _serialize_event(event: TunapiEvent) -> dict[str, Any]:
    """Convert a TunapiEvent dataclass to a JSON-serializable dict."""
    return asdict(event)


async def read_requests(stream: Any = None) -> AsyncIterator[dict[str, Any]]:
    """Yield parsed JSON objects from stdin, one per line.

    Uses a background thread to read stdin (Windows ProactorEventLoop compatible).
    """
    if stream is None:
        stream = sys.stdin

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def _reader() -> None:
        try:
            for line in stream:
                line = line.strip()
                if line:
                    loop.call_soon_threadsafe(queue.put_nowait, line)
        except (EOFError, ValueError):
            pass
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()

    while True:
        line = await queue.get()
        if line is None:
            break
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            write_error(f"invalid JSON: {line!r}")


def _write(obj: dict[str, Any]) -> None:
    """Write a JSON line to stdout and flush."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def write_event(req_id: int | None, event: str, data: dict[str, Any] | None = None) -> None:
    msg: dict[str, Any] = {"id": req_id, "event": event}
    if data is not None:
        msg["data"] = data
    _write(msg)


def write_tunapi_event(req_id: int | None, event: TunapiEvent) -> None:
    """Emit a TunapiEvent as a JSON Lines message."""
    payload = _serialize_event(event)
    _write({"id": req_id, "event": event.type, "data": payload})


def write_result(req_id: int | None, result: dict[str, Any]) -> None:
    _write({"id": req_id, "result": result})


def write_error(message: str, req_id: int | None = None) -> None:
    msg: dict[str, Any] = {"error": message}
    if req_id is not None:
        msg["id"] = req_id
    _write(msg)
