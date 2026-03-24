"""Codex CLI runner — extracted from tunapi, stdlib json only."""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sidecar.events import EventFactory
from sidecar.model import ResumeToken, TunapiEvent

ENGINE = "codex"

_RESUME_RE = re.compile(r"(?im)^\s*`?codex\s+resume\s+(?P<token>[^`\s]+)`?\s*$")


@dataclass(frozen=True, slots=True)
class _AgentMessageSummary:
    text: str
    phase: str | None


def _select_final_answer(agent_messages: list[_AgentMessageSummary]) -> str | None:
    for msg in reversed(agent_messages):
        if msg.phase == "final_answer":
            return msg.text
    for msg in reversed(agent_messages):
        if msg.phase in {None, ""}:
            return msg.text
    return None


@dataclass(slots=True)
class CodexRunState:
    factory: EventFactory = field(default_factory=lambda: EventFactory(ENGINE))
    note_seq: int = 0
    final_answer: str | None = None
    turn_agent_messages: list[_AgentMessageSummary] = field(default_factory=list)
    turn_index: int = 0
    last_assistant_text: str | None = None  # for runner.py fallback


def translate_codex_event(
    data: dict[str, Any], *, state: CodexRunState,
) -> list[TunapiEvent]:
    factory = state.factory
    event_type = data.get("type", "")

    # ThreadStarted — session ID
    if event_type == "thread_started":
        thread_id = data.get("thread_id", "")
        token = ResumeToken(engine=ENGINE, value=thread_id)
        return [factory.started(token, title="codex")]

    # TurnStarted
    if event_type == "turn_started":
        action_id = f"turn_{state.turn_index}"
        state.turn_index += 1
        state.final_answer = None
        state.turn_agent_messages.clear()
        return [factory.action_started(action_id=action_id, kind="turn", title="turn started")]

    # ItemStarted — tool use
    if event_type == "item_started":
        item = data.get("item", {})
        item_type = item.get("type", "")
        item_id = item.get("id", "")
        if item_type == "command_execution":
            cmd = item.get("command", "")
            return [factory.action_started(action_id=item_id, kind="command", title=str(cmd))]
        if item_type == "file_change":
            path = item.get("file_path", "")
            return [factory.action_started(action_id=item_id, kind="file_change", title=str(path))]
        if item_type == "web_search":
            query = item.get("query", "")
            return [factory.action_started(action_id=item_id, kind="web_search", title=str(query))]
        return []

    # ItemCompleted
    if event_type == "item_completed":
        item = data.get("item", {})
        item_type = item.get("type", "")
        item_id = item.get("id", "")

        if item_type == "agent_message":
            text = item.get("text", "")
            phase = item.get("phase")
            state.turn_agent_messages.append(_AgentMessageSummary(text=text, phase=phase))
            selected = _select_final_answer(state.turn_agent_messages)
            if selected is not None:
                state.final_answer = selected
                state.last_assistant_text = selected
            return []

        if item_type == "command_execution":
            exit_code = item.get("exit_code", -1)
            return [factory.action_completed(
                action_id=item_id, kind="command", title=item.get("command", ""),
                ok=exit_code == 0,
            )]

        if item_type == "file_change":
            return [factory.action_completed(
                action_id=item_id, kind="file_change",
                title=item.get("file_path", ""), ok=True,
            )]

        return []

    # TurnCompleted
    if event_type == "turn_completed":
        usage = data.get("usage", {})
        resume_token = factory.resume
        return [factory.completed(
            ok=True, answer=state.final_answer or "",
            resume=resume_token, usage=usage or None,
        )]

    # TurnFailed
    if event_type == "turn_failed":
        error = data.get("error", {})
        message = error.get("message", "codex turn failed")
        resume_token = factory.resume
        return [factory.completed(
            ok=False, answer=state.final_answer or "",
            resume=resume_token, error=message,
        )]

    return []


class CodexRunner:
    """Spawns `codex exec --json` and translates events."""

    def __init__(self, *, extra_args: list[str] | None = None):
        self.engine = ENGINE
        self._extra_args = extra_args or ["-c", "notify=[]"]

        # Windows: bypass .cmd wrapper
        self._codex_cmd: str
        self._codex_script: str | None = None
        if os.name == "nt":
            npm_root = Path.home() / "AppData" / "Roaming" / "npm"
            entry = npm_root / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
            if entry.exists():
                self._codex_cmd = shutil.which("node") or "node"
                self._codex_script = str(entry)
            else:
                self._codex_cmd = shutil.which("codex") or "codex"
        else:
            self._codex_cmd = shutil.which("codex") or "codex"

    def build_command(self, prompt: str, resume_token: str | None = None,
                      model: str | None = None, system_prompt: str | None = None,
                      allowed_tools: list[str] | None = None) -> list[str]:
        # Note: Codex CLI does not support system prompt injection
        # system_prompt and allowed_tools are accepted but not used for Codex
        cmd = [self._codex_cmd]
        if self._codex_script:
            cmd.append(self._codex_script)
        cmd.extend(self._extra_args)
        if model:
            cmd.extend(["--model", model])
        cmd.extend(["exec", "--json", "--skip-git-repo-check", "--color=never"])
        if resume_token:
            cmd.extend(["resume", resume_token, "-"])
        else:
            cmd.append("-")
        return cmd

    def build_env(self) -> dict[str, str] | None:
        return None

    def build_stdin(self, prompt: str) -> bytes:
        """Codex reads prompt from stdin."""
        return prompt.encode("utf-8")

    def new_state(self) -> CodexRunState:
        return CodexRunState()

    def translate_line(self, line: bytes, state: CodexRunState) -> list[TunapiEvent]:
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            return []
        return translate_codex_event(data, state=state)

    @staticmethod
    def extract_resume(text: str | None) -> ResumeToken | None:
        if not text:
            return None
        m = _RESUME_RE.search(text)
        if m:
            return ResumeToken(engine=ENGINE, value=m.group("token"))
        return None
