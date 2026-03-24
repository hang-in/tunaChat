<div align="center">

# tunaChat

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue.svg)](https://v2.tauri.app)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-2021-orange.svg)](https://www.rust-lang.org)

터미널 AI 에이전트를 오케스트레이션하는 스탠드얼론 데스크탑 챗앱

[**한국어**](#한국어) | [English](#english)

<!-- TODO: 데모 GIF 추가 -->

</div>

---

## 한국어

### 배경

[tunaDish](https://github.com/hang-in/tunaDish)(UI)와 [tunaPi](https://github.com/hang-in/tunaPi)(에이전트 런타임)의 검증된 기능을 합쳐, 서버 없이 로컬에서 동작하는 스탠드얼론 앱으로 만든 프로젝트입니다.

### 어떻게 동작하나요?

```
내 입력 → tunaChat → CLI 에이전트 실행 (로컬) → 결과를 UI에 표시
```

서버가 필요 없습니다. 모든 데이터는 로컬 SQLite에 저장되고, AI 에이전트는 내 PC에서 직접 실행됩니다.

```
나:      InputArea 리팩토링 해줘

Claude:  working · claude/opus-4-6 · 0s · step 1
         ↳ Reading src/components/chat/InputArea.tsx...

Claude:  working · claude/opus-4-6 · 8s · step 3
         ↳ Writing fix...

Claude:  ✓ done · 15s · 2 files changed
         InputArea를 분리하고 QuickChips를 독립 컴포넌트로 추출했습니다.
```

### 이런 때 좋아요

- 서버 없이 로컬에서 AI 에이전트를 쓰고 싶을 때
- 여러 프로젝트를 사이드바에서 나눠 관리하고 싶을 때
- 대화를 브랜치로 분기해서 다른 방향을 탐색하고 싶을 때
- 여러 AI를 순차적으로 토론시키고 싶을 때
- HMR/새로고침 해도 대화가 유실되지 않길 원할 때

### 주요 기능

- **멀티 에이전트** — Claude, Gemini, Codex를 자유롭게 전환하거나 라운드테이블로 순차 토론
- **대화 브랜치** — 특정 메시지에서 분기 → 독립 대화 → 채택(adopt)으로 메인에 병합
- **프로젝트 자동 발견** — 워크스페이스 폴더를 스캔해서 .git + 에이전트 세션 기반으로 자동 분류
- **에이전트 정의 파일** — `docs/agents/*.md`에 역할/모델/도구 권한을 선언하면 자동 적용
- **코드 검색** — rawq 기반 시맨틱 + 렉시컬 하이브리드 검색
- **실시간 진행 표시** — 도구 사용 과정을 롤링 로그로 표시, 완료 후 축소
- **로컬 SSOT** — SQLite에 모든 데이터 저장, HMR/새로고침에도 대화 보존
- **토큰 추적** — 대화별 입출력 토큰 누적 기록
- **!커맨드 14개** — `!help`, `!project scan`, `!model`, `!status`, `!branch` 등 로컬 처리

### 아키텍처

```
tunaChat (Tauri v2)
  ├─ React UI ←→ Rust 백엔드 (Tauri invoke/event)
  ├─ Rust ←→ Python sidecar (stdio JSON Lines)
  └─ Python sidecar ←→ CLI 에이전트 (subprocess)
```

### 기술 스택

| 영역 | 기술 |
|------|------|
| UI | React + TypeScript + Tauri v2 |
| 컴포넌트 | shadcn/ui (base-ui) |
| 상태 관리 | Zustand |
| DB | SQLite (tauri-plugin-sql) |
| Rust 백엔드 | Tauri commands |
| Python sidecar | CLI 에이전트 오케스트레이션 |
| 코드 검색 | rawq |

### 지원하는 AI 도구

Claude Code · Codex · Gemini CLI

### 준비물

- Node.js 18+
- Rust (stable)
- Python 3.11+
- `claude` / `codex` / `gemini` 중 하나 이상

### 설치 및 실행

```sh
git clone https://github.com/hang-in/tunaChat.git
cd tunaChat/client
npm install
npm run tauri dev
```

### 자주 쓰는 커맨드

| 하고 싶은 일 | 예시 |
|---|---|
| AI에게 작업 요청 | `리팩토링 해줘` |
| 엔진 바꾸기 | `!model gemini` |
| 세부 모델 지정 | `!model claude/claude-opus-4-6` |
| 프로젝트 스캔 | `!project scan D:\projects` |
| 프로젝트 전환 | `!project set myapp` |
| 프로젝트 정보 | `!project` |
| 멀티 에이전트 토론 | `!rt "아키텍처 검토"` |
| 브랜치 목록 | `!branch` |
| 메모리 확인 | `!memory` |
| 상태 확인 | `!status` |
| 도움말 | `!help` |

### 문서

- [핸드오프 문서](docs/reference/handoff.md) — 현재 상태, 아키텍처, 파일 구조
- [PRD](docs/reference/prd.md) — 제품 요구사항
- [하네스 아키텍처](docs/plans/harness-architecture.md) — 에이전트 오케스트레이션 설계
- [마이그레이션 체크리스트](docs/plans/aoc-reference.md) — Phase 0-5

### 관련 프로젝트

- [tunaPi](https://github.com/hang-in/tunaPi) — 채팅앱 브릿지 (Mattermost/Slack/Telegram)
- [tunaDish](https://github.com/hang-in/tunaDish) — 웹 클라이언트 (tunaChat의 UI 원본)
- [rawq](https://github.com/auyelbekov/rawq) — 코드 검색 엔진

### 라이선스

MIT — [LICENSE](LICENSE)

---

## English

### Background

tunaChat combines the proven UI from [tunaDish](https://github.com/hang-in/tunaDish) and the agent runtime from [tunaPi](https://github.com/hang-in/tunaPi) into a standalone desktop app that runs entirely locally — no server required.

### How does it work?

```
Your input → tunaChat → CLI agent runs locally → results displayed in UI
```

No server needed. All data is stored in local SQLite. AI agents run directly on your machine.

```
You:     Fix the login bug

Claude:  working · claude/opus-4-6 · 0s · step 1
         ↳ Reading src/auth/login.py...

Claude:  working · claude/opus-4-6 · 12s · step 4
         ↳ Writing fix...

Claude:  ✓ done · 23s · 3 files changed
         Fixed the token expiration logic in login.py.
```

### When is this useful?

- When you want to use AI agents locally without a server
- When you want to manage multiple projects in a sidebar
- When you want to branch conversations and explore different approaches
- When you want multiple AIs to discuss the same topic sequentially
- When you want conversations to survive HMR/refresh without data loss

### Key Features

- **Multi-agent** — Switch freely between Claude, Gemini, Codex, or run roundtable discussions
- **Conversation branches** — Fork from any message → independent conversation → adopt back to main
- **Project auto-discovery** — Scan workspace folders, auto-classify by .git + agent sessions
- **Agent definition files** — Declare role/model/tools in `docs/agents/*.md`, auto-applied
- **Code search** — rawq-powered semantic + lexical hybrid search
- **Live progress** — Rolling log of tool usage, collapses on completion
- **Local SSOT** — All data in SQLite, survives HMR/refresh
- **Token tracking** — Per-conversation input/output token accumulation
- **14 ! commands** — `!help`, `!project scan`, `!model`, `!status`, `!branch`, etc.

### Architecture

```
tunaChat (Tauri v2)
  ├─ React UI ←→ Rust backend (Tauri invoke/event)
  ├─ Rust ←→ Python sidecar (stdio JSON Lines)
  └─ Python sidecar ←→ CLI agents (subprocess)
```

### Tech Stack

| Area | Technology |
|------|-----------|
| UI | React + TypeScript + Tauri v2 |
| Components | shadcn/ui (base-ui) |
| State | Zustand |
| DB | SQLite (tauri-plugin-sql) |
| Rust backend | Tauri commands |
| Python sidecar | CLI agent orchestration |
| Code search | rawq |

### Supported AI Tools

Claude Code · Codex · Gemini CLI

### Prerequisites

- Node.js 18+
- Rust (stable)
- Python 3.11+
- At least one of: `claude` / `codex` / `gemini`

### Install & Run

```sh
git clone https://github.com/hang-in/tunaChat.git
cd tunaChat/client
npm install
npm run tauri dev
```

### Common Commands

| What you want to do | Example |
|---|---|
| Ask AI to work | `refactor this` |
| Switch engine | `!model gemini` |
| Specific model | `!model claude/claude-opus-4-6` |
| Scan projects | `!project scan D:\projects` |
| Switch project | `!project set myapp` |
| Project info | `!project` |
| Multi-agent discussion | `!rt "architecture review"` |
| List branches | `!branch` |
| Check memory | `!memory` |
| Status | `!status` |
| Help | `!help` |

### Documentation

- [Handoff](docs/reference/handoff.md) — Current state, architecture, file structure
- [PRD](docs/reference/prd.md) — Product requirements
- [Harness Architecture](docs/plans/harness-architecture.md) — Agent orchestration design
- [Migration Checklist](docs/plans/aoc-reference.md) — Phase 0-5

### Related Projects

- [tunaPi](https://github.com/hang-in/tunaPi) — Chat app bridge (Mattermost/Slack/Telegram)
- [tunaDish](https://github.com/hang-in/tunaDish) — Web client (tunaChat's UI origin)
- [rawq](https://github.com/auyelbekov/rawq) — Code search engine

### License

MIT — [LICENSE](LICENSE)
