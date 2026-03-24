# tunaChat — 제품 요구사항 문서 (PRD)

## 개요

tunaChat은 터미널 AI 에이전트(Claude, Gemini, Codex)를 오케스트레이션하는 **스탠드얼론 데스크탑 챗앱**.
tunadish(클라이언트 UI)와 tunapi(에이전트 런타임)의 검증된 기능을 합쳐 서버 의존성 없이 동작.

## 핵심 철학

> "코딩하지 않는 IDE — 함께 고민하는 동업자 플랫폼"

- 사용자가 거버넌스를 주도, AI는 실행을 보완
- 위임이 아닌 협업
- 코드리뷰는 사용자가 직접 수행 (AI 자동 리뷰는 선택적 고급 모드)

## 기술 스택

| 영역 | 기술 |
|------|------|
| UI | React + TypeScript + Tauri v2 |
| 컴포넌트 | shadcn/ui (base-ui) |
| 상태 관리 | Zustand |
| DB | SQLite (로컬 SSOT) |
| Rust 백엔드 | Tauri commands (fs, SQLite, sidecar, rawq) |
| Python sidecar | CLI 에이전트 오케스트레이션 (tunapi 코어 추출) |
| 코드 검색 | rawq (시맨틱 + 렉시컬 하이브리드) |

## 아키텍처

```
tunaChat (Tauri v2)
  ├─ React UI ←→ Rust (Tauri invoke/event)
  ├─ Rust 백엔드 ←→ Python sidecar (stdio JSON Lines)
  └─ Python sidecar ←→ CLI agents (subprocess)
```

## 핵심 기능

- 프로젝트별 독립 세션 + 대화 브랜치 시스템
- 멀티 엔진 (Claude/Gemini/Codex) + 라운드테이블
- 에이전트 정의 파일 (docs/agents/*.md) + RBAC
- 프로젝트 자동 발견 (워크스페이스 스캔)
- rawq 코드 검색
- !커맨드 14개 (로컬 처리)
- 설정 페이지 (일반/엔진/저널/고급)
- SQLite 영속화 + FTS5 전문 검색
- HMR 내성 (대화 유실 방지)

## 참조 문서

- `docs/reference/handoff.md` — 현재 상태, 아키텍처, 파일 구조
- `docs/plans/aoc-reference.md` — Phase 0-5 마이그레이션 체크리스트
- `docs/plans/harness-architecture.md` — 하네스 아키텍처 설계
- `docs/agents/*.md` — 에이전트 정의 파일
