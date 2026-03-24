"""
Subprocess runner — manages CLI agent processes.

Uses asyncio subprocess (stdlib only, no anyio dependency).
Extracted from tunapi's runner.py + utils/subprocess.py.
"""

from __future__ import annotations

import asyncio
import os
import signal
import sys
from typing import Any, AsyncIterator

from sidecar.model import TunapiEvent, CompletedEvent
from sidecar.protocol import write_tunapi_event, write_error


async def run_cli_agent(
    req_id: int,
    cmd: list[str],
    *,
    runner: Any,  # ClaudeRunner (or similar)
    env: dict[str, str] | None = None,
    stdin_data: bytes | None = None,
    cwd: str | None = None,
) -> None:
    """
    Spawn a CLI subprocess, parse JSONL stdout, translate and emit events.

    This is the main execution loop for any CLI agent runner.
    If stdin_data is provided, it is written to the subprocess stdin (e.g., Codex).
    """
    state = runner.new_state()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if stdin_data else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=cwd,
        )
    except FileNotFoundError:
        write_error(f"CLI not found: {cmd[0]}", req_id=req_id)
        return
    except Exception as e:
        write_error(f"failed to spawn: {e}", req_id=req_id)
        return

    # Write stdin data if provided (e.g., Codex reads prompt from stdin)
    if stdin_data and proc.stdin:
        proc.stdin.write(stdin_data)
        proc.stdin.close()

    # Drain stderr in background
    async def drain_stderr() -> None:
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            # Log to stderr of sidecar (visible in Rust logs)
            sys.stderr.write(f"[{runner.engine}] {line.decode(errors='replace').rstrip()}\n")
            sys.stderr.flush()

    stderr_task = asyncio.create_task(drain_stderr())

    has_completed = False

    try:
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break

            events = runner.translate_line(line, state)
            for event in events:
                write_tunapi_event(req_id, event)
                if isinstance(event, CompletedEvent):
                    has_completed = True
    except Exception as e:
        write_error(f"stream error: {e}", req_id=req_id)

    await proc.wait()
    await stderr_task

    # If process exited without a CompletedEvent, emit one
    if not has_completed:
        rc = proc.returncode or -1
        factory = state.factory
        if factory.resume:
            write_tunapi_event(req_id, factory.completed_error(
                error=f"{runner.engine} exited (rc={rc}) without result",
                answer=state.last_assistant_text or "",
                resume=factory.resume,
            ))
        else:
            write_error(f"{runner.engine} exited (rc={rc}) without session", req_id=req_id)


def terminate_process(proc: asyncio.subprocess.Process) -> None:
    """Send SIGTERM (or terminate on Windows)."""
    if proc.returncode is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        else:
            proc.terminate()
    except (ProcessLookupError, OSError):
        pass


def kill_process(proc: asyncio.subprocess.Process) -> None:
    """Force kill the process."""
    if proc.returncode is not None:
        return
    try:
        proc.kill()
    except (ProcessLookupError, OSError):
        pass
