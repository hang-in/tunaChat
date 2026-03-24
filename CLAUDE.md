# CLAUDE.md — tunaChat

## 프로젝트 개요

tunaChat은 터미널 AI 에이전트(claude, gemini, codex) 오케스트레이션 스탠드얼론 데스크탑 챗앱.
tunadish(UI/UX)와 tunapi(에이전트 런타임)의 검증된 기능을 합친 프로젝트. 서버 없이 로컬 동작.

## 기술 스택

- 클라이언트: React + TypeScript + Tauri v2
- 컴포넌트: shadcn/ui (base-ui 기반)
- 상태 관리: Zustand
- DB: SQLite (로컬 SSOT, v1-v5 마이그레이션)
- Rust 백엔드: Tauri commands (fs, SQLite, sidecar, rawq, scan_workspace, get_project_context)
- Python sidecar: CLI 에이전트 프로세스 관리 (tunapi 코어 추출, stdlib only)
- 코드 검색: rawq (로컬 바이너리)

## 아키텍처

```
tunaChat (Tauri)
  ├─ React UI
  │   ├─ tauriClient.ts (38개 RPC 핸들러 + sidecar:event 수신)
  │   └─ agentLoader.ts (docs/agents/*.md 파싱 → persona/RBAC)
  ├─ Rust 백엔드 (Tauri commands + sidecar IPC)
  └─ Python sidecar (CLI 에이전트 오케스트레이션)
       ├─ claude (--append-system-prompt, --allowedTools 지원)
       ├─ gemini
       └─ codex
```

통신: React ↔ Rust (Tauri invoke/event), Rust ↔ Python (stdio JSON Lines)

## 레포 구조

```
tunaChat/
  ├─ client/                # Tauri + React
  │   ├─ src/               # React 프론트엔드
  │   │   ├─ lib/tauriClient.ts  # ★ 핵심 — RPC 라우터
  │   │   └─ lib/agentLoader.ts  # agent 파일 파싱
  │   └─ src-tauri/         # Rust 백엔드
  ├─ sidecar/               # Python 에이전트 런타임
  │   ├─ runner.py          # CLI subprocess 공통 루프
  │   ├─ runners/           # claude, gemini, codex
  │   ├─ router.py          # 엔진 라우팅 + 라운드테이블
  │   └─ protocol.py        # stdio JSON Lines 프로토콜
  ├─ docs/
  │   ├─ agents/            # 에이전트 정의 파일 (frontmatter + system prompt)
  │   ├─ plans/             # aoc-reference, harness-architecture, phase4-mobile-relay
  │   ├─ explanation/       # agent-system, project-discovery, sidecar-protocol
  │   └─ reference/         # prd, briefing, handoff
  └─ vendor/rawq/           # 코드 검색 엔진
```

## 핵심 문서

- `docs/reference/handoff.md` — 현재 상태, 아키텍처, 파일 구조 (새 세션 복원용)
- `docs/plans/aoc-reference.md` — Phase 0-5 마이그레이션 체크리스트
- `docs/plans/harness-architecture.md` — 하네스 설계 (에이전트 + 스킬 + RBAC + MVP 계획)
- `docs/reference/prd.md` — 제품 요구사항

## 현재 단계

Phase 5 MVP-1 완료 — 프로젝트 자동 발견, agent 파일 로딩, RBAC, 토큰 추적.
Phase 5 MVP-2 계획 중 — 스킬 시스템, Task Brief 위임, git branch 연동.

## 에이전트 시스템

- **에이전트 파일** (`docs/agents/*.md`): persona + system prompt + 도구 권한
- **스킬** (`~/.tunachat/skills/`): 외부 도메인 지식 패키지 (별개 시스템)
- 상세: `docs/explanation/agent-system.md`

## 베이스 프로젝트

- **tunadish** (포크 원본): `D:\privateProject\tunaDish\`
- **tunapi** (참조): `D:\privateProject\tunapi\`

## 작업 규칙

- 수정 전 반드시 관련 파일 전체를 읽고 시작할 것
- 추측으로 코딩하지 말 것
- tunadish/tunapi 코드는 레퍼런스로만 참조 (직접 수정 금지)
- Rust 백엔드 코드는 안전하고 비동기적으로 작성
- API 키는 절대 하드코딩 금지
- Python sidecar는 stdlib only — 최소 의존성 유지
- 코드 수정이나 구현은 반드시 사용자 승인 후 진행

## rawq 코드 검색

바이너리: `client/src-tauri/binaries/rawq-x86_64-pc-windows-msvc.exe`
소스: `vendor/rawq/` (git clone)

| 상황 | 도구 |
|------|------|
| 구현 위치 불명 | `rawq search` (자연어) |
| 프로젝트 구조 파악 | `rawq map` |
| 정확한 파일/문자열 | `grep` / `Read` |
