# 프로젝트 자동 발견

## 개요

tunaChat은 워크스페이스 루트 폴더를 스캔하여 프로젝트를 자동으로 발견하고 분류합니다.

## 분류 기준

| 조건 | type | 설명 |
|------|------|------|
| `.git/` + 에이전트 세션 (`.claude/`, `.gemini/`, `.codex-cli/`) | **project** | 활성 개발 프로젝트 |
| `.git/`만 | **discovered** | git 저장소이지만 에이전트 세션 없음 |
| 에이전트 세션만 | **chat** | 프로젝트 없이 세션만 존재 |
| 둘 다 없음 | — | 무시 |

## 사용법

```
!project scan D:\privateProject
```

또는 설정 페이지에서 워크스페이스 루트 폴더 선택.

## 구현

- **Rust**: `scan_workspace(root)` Tauri command — 1단계 하부 폴더 스캔
- **Rust**: `get_project_context(project_path)` — git branch, dirty count, 에이전트 세션, CLAUDE.md 로드
- **Frontend**: `!project scan` 커맨드 → `invoke('scan_workspace')` → SQLite 저장 + 사이드바 갱신
