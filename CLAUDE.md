# CLAUDE.md — tunaChat

## 프로젝트 개요

tunaChat은 터미널 AI 에이전트(claude, gemini, codex) 오케스트레이션 스탠드얼론 데스크탑 챗앱.
tunadish(UI/UX)와 tunapi(에이전트 런타임)의 검증된 기능을 합친 새 프로젝트.

## 기술 스택

- 클라이언트: React + TypeScript + Tauri v2
- 컴포넌트: shadcn/ui (base-ui 기반)
- 상태 관리: Zustand
- DB: SQLite (로컬 SSOT)
- Rust 백엔드: Tauri commands (파일 접근, SQLite, sidecar 관리, rawq)
- Python sidecar: CLI 에이전트 프로세스 관리 (tunapi 코어 추출)
- 코드 검색: rawq (로컬 바이너리)
- 모바일: Android (릴레이 모드, 선택적)

## 아키텍처

```
tunaChat (Tauri)
  ├─ React UI (tunadish 포크)
  ├─ Rust 백엔드 (Tauri commands + sidecar IPC)
  └─ Python sidecar (CLI 에이전트 오케스트레이션)
       ├─ claude CLI subprocess
       ├─ gemini CLI subprocess
       └─ codex CLI subprocess
```

통신: React ↔ Rust (Tauri invoke/event), Rust ↔ Python (stdio JSON Lines)

## 레포 구조

```
tunaChat/
  ├─ client/                # Tauri + React
  │   ├─ src/               # React 프론트엔드
  │   ├─ src-tauri/         # Rust 백엔드
  │   └─ package.json
  ├─ sidecar/               # Python 에이전트 런타임
  │   ├─ runner.py          # CLI subprocess 기반 클래스
  │   ├─ runners/           # claude, gemini, codex
  │   ├─ router.py          # 엔진 라우팅
  │   ├─ roundtable.py      # 멀티에이전트
  │   └─ protocol.py        # stdio JSON Lines 프로토콜
  ├─ vendor/rawq/           # 코드 검색 엔진
  └─ docs/plans/            # aoc-reference.md (기능 레퍼런스)
```

## 핵심 문서

- `docs/plans/aoc-reference.md` — tunapi/tunadish 기능 레퍼런스 + 아키텍처 + 마이그레이션 계획

## 현재 단계

Phase 0 — 프로젝트 세팅 진행 중.

## 베이스 프로젝트

- **tunadish** (포크 원본): `D:\privateProject\tunaDish\`
  - UI, SQLite 스키마, 브랜치, 메모, FileViewer 등
- **tunapi** (참조): `D:\privateProject\tunapi\`
  - 에이전트 런타임 → sidecar/ 로 추출

## 작업 규칙

- 수정 전 반드시 관련 파일 전체를 읽고 시작할 것
- 추측으로 코딩하지 말 것
- tunadish/tunapi 코드는 레퍼런스로만 참조 (직접 수정 금지)
- Rust 백엔드 코드는 안전하고 비동기적으로 작성
- API 키는 절대 하드코딩 금지
- Python sidecar는 tunapi 코어 추출 — 최소 의존성 유지

## rawq 코드 검색

tunadish와 동일. `vendor/rawq/` 참조.
바이너리: `vendor/rawq/target/debug/rawq.exe`
