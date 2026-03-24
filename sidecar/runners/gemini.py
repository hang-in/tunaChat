"""Gemini CLI runner — extracted from tunapi, stdlib json only."""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sidecar.events import EventFactory
from sidecar.model import Action, ActionKind, ResumeToken, TunapiEvent

ENGINE = "gemini"

_RESUME_RE = re.compile(
    r"(?im)^\s*`?gemini\s+(?:--resume|-r)\s+(?P<token>[^`\s]+)`?\s*$"
)


@dataclass(slots=True)
class GeminiStreamState:
    factory: EventFactory = field(default_factory=lambda: EventFactory(ENGINE))
    pending_actions: dict[str, Action] = field(default_factory=dict)
    last_assistant_text: str = ""
    session_id: str = ""
    note_seq: int = 0


def _tool_kind(name: str) -> ActionKind:
    name_lower = name.lower()
    if any(k in name_lower for k in ("read", "write", "edit", "list_directory")):
        return "file_change"
    if any(k in name_lower for k in ("bash", "shell", "exec", "run")):
        return "command"
    if "search" in name_lower:
        return "web_search"
    return "tool"


def translate_gemini_event(
    data: dict[str, Any], *, state: GeminiStreamState,
) -> list[TunapiEvent]:
    factory = state.factory
    event_type = data.get("type", "")

    if event_type == "init":
        session_id = data.get("session_id", "")
        state.session_id = session_id
        model = data.get("model") or "gemini"
        token = ResumeToken(engine=ENGINE, value=session_id)
        meta = {"model": model} if model else None
        return [factory.started(token, title=model, meta=meta)]

    if event_type == "message" and data.get("role") == "assistant":
        content = data.get("content", "")
        if content:
            state.last_assistant_text += content
        return []

    if event_type == "tool_use":
        tool_name = data.get("tool_name", "tool")
        tool_id = data.get("tool_id", "")
        params = data.get("parameters", {})
        kind = _tool_kind(tool_name)
        title = tool_name
        detail: dict[str, Any] = {"name": tool_name, "input": params}
        if kind == "file_change":
            path = params.get("file_path") or params.get("path") or params.get("dir_path")
            if isinstance(path, str):
                title = path
                detail["changes"] = [{"path": path, "kind": "update"}]

        action = Action(id=tool_id, kind=kind, title=title, detail=detail)
        state.pending_actions[tool_id] = action
        return [factory.action_started(
            action_id=action.id, kind=action.kind,
            title=action.title, detail=action.detail,
        )]

    if event_type == "tool_result":
        tool_id = data.get("tool_id", "")
        action = state.pending_actions.pop(tool_id, None)
        if action is None:
            action = Action(id=tool_id, kind="tool", title="tool", detail={})
        ok = data.get("status") == "success"
        output = data.get("output", "")
        return [factory.action_completed(
            action_id=action.id, kind=action.kind,
            title=action.title, ok=ok,
            detail=action.detail | {"result_preview": output[:200]},
        )]

    if event_type == "result":
        ok = data.get("status") == "success"
        answer = state.last_assistant_text.strip()
        resume = ResumeToken(engine=ENGINE, value=state.session_id)
        usage: dict[str, Any] = {}
        stats = data.get("stats", {})
        if stats.get("duration_ms"):
            usage["duration_ms"] = stats["duration_ms"]
        if stats.get("total_tokens"):
            usage["total_tokens"] = stats["total_tokens"]
            usage["input_tokens"] = stats.get("input_tokens")
            usage["output_tokens"] = stats.get("output_tokens")
        return [factory.completed(
            ok=ok, answer=answer, resume=resume,
            error=None if ok else "gemini run failed",
            usage=usage or None,
        )]

    return []


class GeminiRunner:
    """Spawns `gemini -p --output-format stream-json` and translates events."""

    def __init__(
        self, *,
        model: str | None = "auto",
        yolo: bool = False,
        approval_mode: str | None = "auto_edit",
    ):
        self.engine = ENGINE
        self.model = model
        self.yolo = yolo
        self.approval_mode = approval_mode

        # Windows: bypass .cmd wrapper for stdout buffering issues
        self._gemini_cmd: str
        self._gemini_script: str | None = None
        if os.name == "nt":
            npm_root = Path.home() / "AppData" / "Roaming" / "npm"
            entry = npm_root / "node_modules" / "@google" / "gemini-cli" / "dist" / "index.js"
            if entry.exists():
                self._gemini_cmd = shutil.which("node") or "node"
                self._gemini_script = str(entry)
            else:
                self._gemini_cmd = shutil.which("gemini") or "gemini"
        else:
            self._gemini_cmd = shutil.which("gemini") or "gemini"

    def build_command(self, prompt: str, resume_token: str | None = None,
                      model: str | None = None, system_prompt: str | None = None,
                      allowed_tools: list[str] | None = None) -> list[str]:
        # Note: Gemini CLI does not support --append-system-prompt or --allowedTools
        # system_prompt and allowed_tools are accepted but not used for Gemini
        cmd = [self._gemini_cmd]
        if self._gemini_script:
            cmd.extend(["--no-warnings=DEP0040", self._gemini_script])
        cmd.extend(["-p", prompt, "--output-format", "stream-json"])
        if self.yolo:
            cmd.append("-y")
        elif self.approval_mode:
            cmd.extend(["--approval-mode", self.approval_mode])
        if resume_token:
            cmd.extend(["--resume", resume_token])
        m = model or self.model
        if m:
            cmd.extend(["--model", m])
        return cmd

    def build_env(self) -> dict[str, str] | None:
        return None

    def new_state(self) -> GeminiStreamState:
        return GeminiStreamState()

    def translate_line(self, line: bytes, state: GeminiStreamState) -> list[TunapiEvent]:
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            return []
        return translate_gemini_event(data, state=state)

    @staticmethod
    def extract_resume(text: str | None) -> ResumeToken | None:
        if not text:
            return None
        m = _RESUME_RE.search(text)
        if m:
            return ResumeToken(engine=ENGINE, value=m.group("token"))
        return None
