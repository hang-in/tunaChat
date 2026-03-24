# tunaChat — 제품 요구사항 문서 (PRD)

## 개요

tunaChat은 터미널 AI 에이전트(Claude, Gemini, Codex)를 오케스트레이션하는 **스탠드얼론 데스크탑 챗앱**.
tunadish(클라이언트 UI)와 tunapi(에이전트 런타임)의 검증된 기능을 합쳐 서버 의존성 없이 동작.

## 핵심 철학

> "코딩하지 않는 IDE — 함께 고민하는 동업자 플랫폼"

- 사용자가 거버넌스를 주도, AI는 실행을 보완
- 위임이 아니라 협업
- 코드리뷰는 사용자가 직접 수행 (AI 자동 리뷰는 선택적 고급 모드)

## 기술 스택

| 영역 | 기술 |
|------|------|
| UI | React + TypeScript + Tauri v2 |
| 컴포넌트 | shadcn/ui (base-ui) |
| 상태 관리 | Zustand |
| DB | SQLite (로컬 SSOT, v1-v5 마이그레이션) |
| Rust 백엔드 | Tauri commands (fs, SQLite, sidecar, rawq, scan_workspace, get_project_context) |
| Python sidecar | CLI 에이전트 오케스트레이션 (tunapi 코어 추출, stdlib only) |
| 코드 검색 | rawq (시맨틱 + 렉시컬 하이브리드) |

## 아키텍처

```
tunaChat (Tauri v2)
  ├─ React UI ←→ Rust (Tauri invoke/event)
  │   ├─ tauriClient.ts (38개 RPC 핸들러)
  │   ├─ agentLoader.ts (agent 파일 파싱 → persona/RBAC)
  │   └─ SQLite (tunachat.db, SSOT)
  ├─ Rust ←→ Python sidecar (stdio JSON Lines)
  │   ├─ system_prompt + allowed_tools 전달
  │   └─ sidecar:event Tauri emit
  └─ Python sidecar ←→ CLI agents (subprocess, cwd=project_path)
```

## 핵심 기능

### 채팅 & 에이전트
- 멀티 엔진 (Claude/Gemini/Codex) + 라운드테이블 (순차 토론)
- 실시간 진행 표시 (ProgressBlock: streaming 5줄 롤링 → 완료 3줄 축소)
- 대화 브랜치 시스템 (checkpoint 분기 → 채택/보관/삭제)
- HMR/F5 내성 (SQLite SSOT + streaming 메시지 자동 매칭)

### 프로젝트 관리
- 프로젝트 자동 발견 (`!project scan` → .git + 에이전트 세션 기반 분류)
- 프로젝트별 독립 세션 + 대화별 엔진/모델/페르소나 설정

### 에이전트 시스템
- 에이전트 정의 파일 (`docs/agents/*.md` — frontmatter + system prompt)
- RBAC (frontmatter tools → sidecar allowed_tools 런타임 제어)
- persona 적용 (`--append-system-prompt` + `--allowedTools`)

### 외부 스킬 시스템 (MVP-2 계획)
- 스킬 = 외부 도메인 지식 패키지 (Anthropic/OpenAI/Vercel 등 공식 스킬 팩)
- 프로젝트/브랜치 단위 activeSkills → SKILL.md body를 context prefix로 주입
- 에이전트 파일(persona) ≠ 스킬(도메인 지식) — 역할 분리

### 인프라
- SQLite v1-v5 (FTS5 전문 검색, memos, resume token, artifacts, trace_log, 토큰 누적)
- rawq 코드 검색 (Tauri invoke → 직접 실행)
- 토큰 추적 (per-conversation input/output 누적, Claude USD 포함)
- !커맨드 14개 (로컬 처리)
- 설정 페이지 (일반/엔진/저널/고급)

## 참조 문서

- `docs/reference/handoff.md` — 현재 상태, 아키텍처, 파일 구조
- `docs/reference/briefing.md` — 기술 브리핑, 프로토콜, 에이전트 파일 형식
- `docs/plans/aoc-reference.md` — Phase 0-5 마이그레이션 체크리스트
- `docs/plans/harness-architecture.md` — 하네스 아키텍처 설계 (에이전트 + 스킬 + RBAC)
- `docs/agents/*.md` — 에이전트 정의 파일
- `docs/explanation/` — 설계 설명 (agent-system, project-discovery, sidecar-protocol)
