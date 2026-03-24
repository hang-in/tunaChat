"""Tool action classification — extracted from tunapi/runners/tool_actions.py."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sidecar.model import ActionKind


def tool_kind_and_title(
    tool_name: str, tool_input: Mapping[str, Any],
) -> tuple[ActionKind, str]:
    name_lower = tool_name.lower()

    if name_lower in {"bash", "shell", "killshell"}:
        command = tool_input.get("command")
        return "command", str(command or tool_name)

    if name_lower in {"edit", "write", "notebookedit", "multiedit"}:
        path = tool_input.get("file_path") or tool_input.get("path")
        return "file_change", str(path) if path else str(tool_name)

    if name_lower == "read":
        path = tool_input.get("file_path") or tool_input.get("path")
        return ("tool", f"read: `{path}`") if path else ("tool", "read")

    if name_lower == "glob":
        pattern = tool_input.get("pattern")
        return ("tool", f"glob: `{pattern}`") if pattern else ("tool", "glob")

    if name_lower == "grep":
        pattern = tool_input.get("pattern")
        return ("tool", f"grep: {pattern}") if pattern else ("tool", "grep")

    if name_lower in {"websearch", "web_search"}:
        return "web_search", str(tool_input.get("query") or "search")

    if name_lower in {"webfetch", "web_fetch"}:
        return "web_search", str(tool_input.get("url") or "fetch")

    if name_lower in {"todowrite", "todoread"}:
        return "note", "update todos" if "write" in name_lower else "read todos"

    if name_lower == "askuserquestion":
        return "note", "ask user"

    if name_lower in {"task", "agent"}:
        desc = tool_input.get("description") or tool_input.get("prompt")
        return "subagent", str(desc or tool_name)

    return "tool", tool_name
