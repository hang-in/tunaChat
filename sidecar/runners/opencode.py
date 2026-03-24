"""OpenCode CLI runner — extracted from tunapi, stdlib json only.

OpenCode outputs JSON events in a streaming format:
- step_start: Beginning of a processing step
- tool_use: Tool invocation with input/output
- text: Text output from the model
- step_finish: End of a step (reason: "stop" or "tool-calls")
- error: Error event

Session IDs: ses_XXXX format (e.g., ses_494719016ffe85dkDMj0FPRbHK)
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from typing import Any

from sidecar.events import EventFactory
from sidecar.model import Action, ActionKind, ResumeToken, TunapiEvent, CompletedEvent, StartedEvent
from sidecar.runners.tool_actions import tool_kind_and_title

ENGINE = "opencode"

_RESUME_RE = re.compile(
    r"(?im)^\s*`?opencode(?:\s+run)?\s+(?:--session|-s)\s+(?P<token>ses_[A-Za-z0-9]+)`?\s*$"
)


@dataclass(slots=True)
class OpenCodeStreamState:
    factory: EventFactory = field(default_factory=lambda: EventFactory(ENGINE))
    pending_actions: dict[str, Action] = field(default_factory=dict)
    last_text: str | None = None
    note_seq: int = 0
    session_id: str | None = None
    emitted_started: bool = False
    saw_step_finish: bool = False
    last_assistant_text: str | None = None  # for runner.py fallback


def _extract_tool_action(part: dict[str, Any]) -> Action | None:
    state = part.get("state") or {}
    call_id = part.get("callID") or part.get("id")
    if not isinstance(call_id, str) or not call_id:
        return None

    tool_name = part.get("tool") or "tool"
    tool_input = state.get("input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}

    kind, title = tool_kind_and_title(tool_name, tool_input)

    state_title = state.get("title")
    if isinstance(state_title, str) and state_title:
        title = state_title

    detail: dict[str, Any] = {"name": tool_name, "input": tool_input, "callID": call_id}
    if kind == "file_change":
        path = tool_input.get("file_path") or tool_input.get("filePath")
        if path:
            detail["changes"] = [{"path": path, "kind": "update"}]

    return Action(id=call_id, kind=kind, title=title, detail=detail)


def translate_opencode_event(
    data: dict[str, Any], *, state: OpenCodeStreamState,
) -> list[TunapiEvent]:
    event_type = data.get("type", "")
    session_id = data.get("sessionID")

    if isinstance(session_id, str) and session_id and state.session_id is None:
        state.session_id = session_id

    if event_type == "step_start":
        if not state.emitted_started and state.session_id:
            state.emitted_started = True
            return [StartedEvent(
                engine=ENGINE,
                resume=ResumeToken(engine=ENGINE, value=state.session_id),
                title="opencode",
            )]
        return []

    if event_type == "tool_use":
        part = data.get("part") or {}
        tool_state = part.get("state") or {}
        status = tool_state.get("status")

        action = _extract_tool_action(part)
        if action is None:
            return []

        factory = state.factory

        if status == "completed":
            output = tool_state.get("output")
            metadata = tool_state.get("metadata") or {}
            exit_code = metadata.get("exit")
            is_error = isinstance(exit_code, int) and exit_code != 0

            detail = dict(action.detail)
            if output is not None:
                detail["output_preview"] = str(output)[:500]
            detail["exit_code"] = exit_code

            state.pending_actions.pop(action.id, None)
            return [factory.action_completed(
                action_id=action.id, kind=action.kind, title=action.title,
                ok=not is_error, detail=detail,
            )]

        if status == "error":
            error = tool_state.get("error")
            detail = dict(action.detail)
            if error is not None:
                detail["error"] = error

            state.pending_actions.pop(action.id, None)
            return [factory.action_completed(
                action_id=action.id, kind=action.kind, title=action.title,
                ok=False, detail=detail, message=str(error) if error else None,
            )]

        # status == "pending" or other → tool started
        state.pending_actions[action.id] = action
        return [factory.action_started(
            action_id=action.id, kind=action.kind, title=action.title, detail=action.detail,
        )]

    if event_type == "text":
        part = data.get("part") or {}
        text = part.get("text")
        if isinstance(text, str) and text:
            if state.last_text is None:
                state.last_text = text
            else:
                state.last_text += text
            state.last_assistant_text = state.last_text
        return []

    if event_type == "step_finish":
        part = data.get("part") or {}
        reason = part.get("reason")
        state.saw_step_finish = True

        if reason == "stop":
            resume = None
            if state.session_id:
                resume = ResumeToken(engine=ENGINE, value=state.session_id)
            return [CompletedEvent(
                engine=ENGINE, ok=True,
                answer=state.last_text or "",
                resume=resume,
            )]
        return []

    if event_type == "error":
        error_value = data.get("error")
        message_value = data.get("message")
        raw_message = message_value if message_value is not None else error_value

        message = raw_message
        if isinstance(message, dict):
            message = message.get("message") or message.get("name") or "opencode error"
        elif message is None:
            message = "opencode error"

        resume = None
        if state.session_id:
            resume = ResumeToken(engine=ENGINE, value=state.session_id)
        return [CompletedEvent(
            engine=ENGINE, ok=False,
            answer=state.last_text or "",
            resume=resume, error=str(message),
        )]

    return []


class OpenCodeRunner:
    """Spawns `opencode run --format json` and translates events."""

    def __init__(self, *, model: str | None = None):
        self.engine = ENGINE
        self.model = model
        self._opencode_cmd = shutil.which("opencode") or "opencode"

    def build_command(self, prompt: str, resume_token: str | None = None,
                      model: str | None = None, system_prompt: str | None = None,
                      allowed_tools: list[str] | None = None) -> list[str]:
        # OpenCode doesn't support system prompt or allowed tools injection
        cmd = [self._opencode_cmd, "run", "--format", "json"]
        if resume_token:
            cmd.extend(["--session", resume_token])
        m = model or self.model
        if m:
            cmd.extend(["--model", m])
        cmd.extend(["--", prompt])
        return cmd

    def build_env(self) -> dict[str, str] | None:
        return None

    def new_state(self) -> OpenCodeStreamState:
        return OpenCodeStreamState()

    def translate_line(self, line: bytes, state: OpenCodeStreamState) -> list[TunapiEvent]:
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            return []
        return translate_opencode_event(data, state=state)

    @staticmethod
    def extract_resume(text: str | None) -> ResumeToken | None:
        if not text:
            return None
        m = _RESUME_RE.search(text)
        if m:
            return ResumeToken(engine=ENGINE, value=m.group("token"))
        return None
