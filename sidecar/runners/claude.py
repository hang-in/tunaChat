"""Claude CLI runner — extracted from tunapi, adapted for stdlib json."""

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
from sidecar.runners.tool_actions import tool_kind_and_title

ENGINE = "claude"
DEFAULT_ALLOWED_TOOLS = ["Bash", "Read", "Edit", "Write"]

_RESUME_RE = re.compile(
    r"(?im)^\s*`?claude\s+(?:--resume|-r)\s+(?P<token>[^`\s]+)`?\s*$"
)


@dataclass(slots=True)
class ClaudeStreamState:
    factory: EventFactory = field(default_factory=lambda: EventFactory(ENGINE))
    pending_actions: dict[str, Action] = field(default_factory=dict)
    last_assistant_text: str | None = None
    note_seq: int = 0


def _normalize_tool_result(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text:
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(p for p in parts if p)
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
    return str(content)


def _tool_action(content: dict[str, Any], *, parent_tool_use_id: str | None) -> Action:
    tool_id = content["id"]
    tool_name = str(content.get("name") or "tool")
    tool_input = content.get("input", {})

    kind, title = tool_kind_and_title(tool_name, tool_input)

    detail: dict[str, Any] = {"name": tool_name, "input": tool_input}
    if parent_tool_use_id:
        detail["parent_tool_use_id"] = parent_tool_use_id
    if kind == "file_change":
        path = tool_input.get("file_path") or tool_input.get("path")
        if path:
            detail["changes"] = [{"path": path, "kind": "update"}]

    return Action(id=tool_id, kind=kind, title=title, detail=detail)


def _tool_result_event(
    content: dict[str, Any], *, action: Action, factory: EventFactory,
) -> TunapiEvent:
    is_error = content.get("is_error") is True
    normalized = _normalize_tool_result(content.get("content"))

    detail = action.detail | {
        "tool_use_id": content.get("tool_use_id"),
        "result_preview": normalized,
        "result_len": len(normalized),
        "is_error": is_error,
    }
    return factory.action_completed(
        action_id=action.id, kind=action.kind, title=action.title,
        ok=not is_error, detail=detail,
    )


def translate_claude_event(
    data: dict[str, Any], *, state: ClaudeStreamState, factory: EventFactory,
) -> list[TunapiEvent]:
    """Translate a single Claude stream-json line (parsed dict) to TunapiEvents."""
    msg_type = data.get("type")

    if msg_type == "system":
        if data.get("subtype") != "init":
            return []
        session_id = data.get("session_id")
        if not session_id:
            return []
        meta: dict[str, Any] = {}
        for key in ("cwd", "tools", "permissionMode", "model", "mcp_servers"):
            val = data.get(key)
            if val is not None:
                meta[key] = val
        model = data.get("model")
        title = str(model) if isinstance(model, str) and model else "claude"
        token = ResumeToken(engine=ENGINE, value=session_id)
        return [factory.started(token, title=title, meta=meta or None)]

    if msg_type == "assistant":
        message = data.get("message", {})
        parent_tool_use_id = data.get("parent_tool_use_id")
        out: list[TunapiEvent] = []
        for block in message.get("content", []):
            block_type = block.get("type")
            if block_type == "tool_use":
                action = _tool_action(block, parent_tool_use_id=parent_tool_use_id)
                state.pending_actions[action.id] = action
                out.append(factory.action_started(
                    action_id=action.id, kind=action.kind,
                    title=action.title, detail=action.detail,
                ))
            elif block_type == "thinking":
                thinking = block.get("thinking", "")
                if not thinking:
                    continue
                state.note_seq += 1
                action_id = f"claude.thinking.{state.note_seq}"
                detail: dict[str, Any] = {}
                if parent_tool_use_id:
                    detail["parent_tool_use_id"] = parent_tool_use_id
                sig = block.get("signature")
                if sig:
                    detail["signature"] = sig
                out.append(factory.action_completed(
                    action_id=action_id, kind="note", title=thinking, ok=True, detail=detail,
                ))
            elif block_type == "text":
                text = block.get("text", "")
                if text:
                    state.last_assistant_text = text
        return out

    if msg_type == "user":
        message = data.get("message", {})
        content_list = message.get("content")
        if not isinstance(content_list, list):
            return []
        out: list[TunapiEvent] = []
        for block in content_list:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            tool_use_id = block.get("tool_use_id", "")
            action = state.pending_actions.pop(tool_use_id, None)
            if action is None:
                action = Action(id=tool_use_id, kind="tool", title="tool result", detail={})
            out.append(_tool_result_event(block, action=action, factory=factory))
        return out

    if msg_type == "result":
        ok = not data.get("is_error", False)
        result_text = data.get("result") or ""
        if not result_text and state.last_assistant_text:
            result_text = state.last_assistant_text

        session_id = data.get("session_id", "")
        resume = ResumeToken(engine=ENGINE, value=session_id)
        error = None
        if not ok:
            error = result_text or data.get("subtype") or "claude run failed"

        usage: dict[str, Any] = {}
        for key in ("total_cost_usd", "duration_ms", "num_turns"):
            val = data.get(key)
            if val is not None:
                usage[key] = val
        if data.get("usage"):
            usage["usage"] = data["usage"]

        return [factory.completed(
            ok=ok, answer=result_text, resume=resume,
            error=error, usage=usage or None,
        )]

    return []


class ClaudeRunner:
    """Spawns `claude -p --output-format stream-json` and translates events."""

    def __init__(
        self, *,
        model: str | None = None,
        allowed_tools: list[str] | None = None,
        dangerously_skip_permissions: bool = False,
        use_api_billing: bool = False,
    ):
        self.engine = ENGINE
        self.model = model
        self.allowed_tools = allowed_tools or DEFAULT_ALLOWED_TOOLS
        self.dangerously_skip_permissions = dangerously_skip_permissions
        self.use_api_billing = use_api_billing
        self._claude_cmd = shutil.which("claude") or "claude"

    def build_command(self, prompt: str, resume_token: str | None = None,
                      model: str | None = None, system_prompt: str | None = None,
                      allowed_tools: list[str] | None = None) -> list[str]:
        cmd = [self._claude_cmd, "-p", "--output-format", "stream-json", "--verbose"]
        if resume_token:
            cmd.extend(["--resume", resume_token])
        m = model or self.model
        if m:
            cmd.extend(["--model", m])
        # Agent-level tool override takes priority
        tools = allowed_tools or self.allowed_tools
        if tools:
            cmd.extend(["--allowedTools", ",".join(tools)])
        if self.dangerously_skip_permissions:
            cmd.append("--dangerously-skip-permissions")
        # System prompt injection (agent persona)
        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])
        cmd.append("--")
        cmd.append(prompt)
        return cmd

    def build_env(self) -> dict[str, str] | None:
        if not self.use_api_billing:
            env = dict(os.environ)
            env.pop("ANTHROPIC_API_KEY", None)
            return env
        return None

    def new_state(self) -> ClaudeStreamState:
        return ClaudeStreamState()

    def translate_line(self, line: bytes, state: ClaudeStreamState) -> list[TunapiEvent]:
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            return []
        return translate_claude_event(data, state=state, factory=state.factory)

    @staticmethod
    def extract_resume(text: str | None) -> ResumeToken | None:
        if not text:
            return None
        m = _RESUME_RE.search(text)
        if m:
            return ResumeToken(engine=ENGINE, value=m.group("token"))
        return None
