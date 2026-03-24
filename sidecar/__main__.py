"""
tunaChat sidecar — CLI agent orchestration process.

Rust backend spawns this as a child process.
Communication: stdio JSON Lines (one JSON object per line).

Usage:
    python -m sidecar
"""

import sys
import asyncio

from sidecar.protocol import read_requests, write_result, write_error
from sidecar.router import Router


async def main() -> None:
    router = Router()

    async for req in read_requests(sys.stdin):
        req_id = req.get("id")
        method = req.get("method", "")
        params = req.get("params", {})

        try:
            if method == "chat":
                await router.chat(req_id, params)
            elif method == "cancel":
                router.cancel(params.get("id"))
            elif method == "models":
                models = router.list_models(params.get("engine"))
                write_result(req_id, {"models": models})
            elif method == "roundtable":
                await router.roundtable(req_id, params)
            else:
                write_error(f"unknown method: {method}", req_id=req_id)
        except Exception as e:
            write_error(str(e), req_id=req_id)


if __name__ == "__main__":
    asyncio.run(main())
