"""Engine router — select runner and dispatch requests."""

from __future__ import annotations

import asyncio
from typing import Any

from sidecar.protocol import write_error, write_result, write_tunapi_event
from sidecar.runner import run_cli_agent, terminate_process
from sidecar.runners.claude import ClaudeRunner
from sidecar.runners.gemini import GeminiRunner
from sidecar.runners.codex import CodexRunner
from sidecar.runners.opencode import OpenCodeRunner


class Router:
    """Route chat requests to the appropriate engine runner."""

    def __init__(self) -> None:
        self._runners: dict[str, Any] = {
            "claude": ClaudeRunner(),
            "gemini": GeminiRunner(),
            "codex": CodexRunner(),
            "opencode": OpenCodeRunner(),
        }
        self._active: dict[int, asyncio.subprocess.Process | None] = {}

    async def chat(self, req_id: int | None, params: dict[str, Any]) -> None:
        engine = params.get("engine", "claude")
        runner = self._runners.get(engine)
        if runner is None:
            write_error(f"engine '{engine}' not available", req_id=req_id)
            return

        prompt = params.get("prompt", "")
        if not prompt:
            write_error("empty prompt", req_id=req_id)
            return

        resume_token = params.get("resume_token")
        model = params.get("model")
        cwd = params.get("cwd")  # project directory for CLI agent
        system_prompt = params.get("system_prompt")  # agent persona
        allowed_tools = params.get("allowed_tools")  # RBAC tool list

        cmd = runner.build_command(
            prompt, resume_token=resume_token, model=model,
            system_prompt=system_prompt, allowed_tools=allowed_tools,
        )
        env = runner.build_env()

        # Codex reads prompt from stdin
        stdin_data: bytes | None = None
        if hasattr(runner, "build_stdin"):
            stdin_data = runner.build_stdin(prompt)

        assert req_id is not None
        await run_cli_agent(req_id, cmd, runner=runner, env=env, stdin_data=stdin_data, cwd=cwd)

    def cancel(self, req_id: int | None) -> None:
        pass

    def list_models(self, engine: str | None) -> list[str]:
        fallback = {
            "claude": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
            "gemini": [],
            "codex": [],
        }
        return fallback.get(engine or "claude", [])

    async def roundtable(self, req_id: int | None, params: dict[str, Any]) -> None:
        """Sequential multi-agent roundtable."""
        engines = params.get("engines", ["claude"])
        prompt = params.get("prompt", "")
        rounds = params.get("rounds", 1)

        if not prompt:
            write_error("empty prompt", req_id=req_id)
            return

        transcript: list[tuple[str, str]] = []
        assert req_id is not None

        for round_idx in range(rounds):
            for engine_id in engines:
                runner = self._runners.get(engine_id)
                if runner is None:
                    write_error(f"engine '{engine_id}' not available", req_id=req_id)
                    continue

                # Build context from previous responses
                round_prompt = prompt
                if transcript:
                    context = "\n\n".join(
                        f"[{eng}] {resp}" for eng, resp in transcript
                    )
                    round_prompt = (
                        f"## 이전 라운드 답변\n\n{context}\n\n"
                        f"## 현재 요청\n\n{prompt}"
                    )

                cmd = runner.build_command(round_prompt)
                env = runner.build_env()
                stdin_data: bytes | None = None
                if hasattr(runner, "build_stdin"):
                    stdin_data = runner.build_stdin(round_prompt)

                await run_cli_agent(req_id, cmd, runner=runner, env=env, stdin_data=stdin_data)

                # Collect answer from the last completed event state
                state = runner.new_state()
                answer = getattr(state, "last_assistant_text", "") or ""
                transcript.append((engine_id, answer))
