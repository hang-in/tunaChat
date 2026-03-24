# tunaChat — 기능 레퍼런스 & 아키텍처

## 개요

tunaChat은 tunadish(클라이언트)와 tunapi(에이전트 런타임)의 검증된 기능을 합쳐
**스탠드얼론 데스크탑 터미널 에이전트 오케스트레이션 챗앱**으로 만드는 새 프로젝트.

- 베이스: tunadish 포크 (React + Tauri + shadcn + SQLite)
- 에이전트 런타임: tunapi 코어 추출 → Python sidecar
- 사이드: 개인 서버 → 모바일 릴레이 (선택적)

---

## 아키텍처

### 핵심 구조

```
tunaChat (Tauri)
  ├─ React UI (tunadish 포크)
  │   ├─ 채팅, 브랜치, 메모, FileViewer
  │   ├─ 커맨드 팔레트, QuickChips
  │   └─ Zustand + SQLite (로컬 SSOT)
  │
  ├─ Rust 백엔드 (Tauri commands)
  │   ├─ 파일시스템 접근 (read_text_file 등)
  │   ├─ SQLite 관리
  │   ├─ Python sidecar 프로세스 관리
  │   ├─ rawq 실행
  │   └─ 모바일 릴레이 서버 (선택적)
  │
  └─ Python sidecar (tunapi 코어 추출)
       ├─ CLI 프로세스 스폰 (claude, gemini, codex)
       ├─ JSONL stdout 실시간 파싱
       ├─ 엔진별 이벤트 번역 → 통합 이벤트
       ├─ Resume token 관리
       └─ 라운드테이블 (순차 멀티에이전트)
```

### 왜 Python sidecar인가

tunapi의 핵심은 **API 호출이 아니라 CLI 프로세스 오케스트레이션**:

```
tunapi (Python)
  └─ subprocess: claude -p "prompt" --output-format stream-json
  └─ subprocess: gemini -p "prompt" --output-format stream-json
  └─ subprocess: codex exec --json -- (stdin)
```

각 엔진별 JSONL 이벤트 형식이 다르고 수시로 변경됨 → Python으로 빠른 대응이 유리.
사용자 PC에 이미 claude/gemini/codex CLI가 설치되어 있으므로 Python 런타임도 존재.

### 통신 방식

```
React UI ←→ Rust (Tauri invoke/event)
Rust ←→ Python sidecar (stdio JSON Lines)
Python ←→ CLI agents (subprocess stdin/stdout)
```

WS JSON-RPC 레이어 **전체 제거**. 로컬 IPC만 사용.

---

## tunapi에서 가져올 것

### Python sidecar로 추출 (에이전트 런타임 코어)

| 기능 | tunapi 파일 | 코드량 | 비고 |
|------|------------|--------|------|
| **JsonlSubprocessRunner** | `runner.py` | ~200줄 | CLI 스폰 + JSONL 스트리밍 기반 클래스 |
| **Claude runner** | `runners/claude.py` | ~200줄 | `claude -p --output-format stream-json` |
| **Gemini runner** | `runners/gemini.py` | ~150줄 | Windows node 우회 포함 |
| **Codex runner** | `runners/codex.py` | ~250줄 | turn_index, stdin 입력 |
| **이벤트 번역** | 각 runner 내 | ~300줄 | 엔진별 JSONL → 통합 TunapiEvent |
| **Resume token** | `runner.py` (ResumeTokenMixin) | ~80줄 | `--resume TOKEN` 관리 |
| **라운드테이블** | `core/roundtable.py` | ~150줄 | 순차 멀티에이전트 실행 |
| **엔진 라우터** | `router.py` (AutoRouter) | ~100줄 | 엔진 선택 + 모델 해석 |
| **모델 디스커버리** | `engine_models.py` | ~100줄 | 엔진별 가용 모델 목록 |
| **subprocess 관리** | `utils/subprocess.py` | ~80줄 | SIGTERM/SIGKILL 생명주기 |
| **합계** | | **~1,610줄** | |

### 추출 시 제거 대상 (sidecar에 불필요)

| 기능 | 이유 |
|------|------|
| Transport/Presenter 인터페이스 | sidecar는 단일 클라이언트 |
| WebSocket 서버 | Rust → Python은 stdio IPC |
| Mattermost/Slack/Telegram transport | 스탠드얼론 앱 |
| tunadish transport 전체 | 교체됨 |
| ProjectSessionStore | conv 단위로 통합 |
| 커맨드 파싱 (`!model`, `!help`) | React UI가 처리 |
| rawq enrichment | Rust에서 직접 rawq 실행 |

### 참고 (후순위 UX 개선)

| 기능 | tunapi 위치 | 비고 |
|------|------------|------|
| 크로스 세션 요약 | `_build_cross_session_summary()` | 같은 프로젝트 다른 대화 컨텍스트 주입 |
| 코드 맵 주입 | 새 세션 시작 시 | rawq map 결과 프롬프트 삽입 |
| 자동 엔진 전환 | `auto-engine-switch` | 모델이 다른 엔진에 속하면 자동 전환 |
| Per-conv lock | `_execute_run` | 한 대화당 동시 실행 방지 |

---

## tunadish에서 가져올 것

### 그대로 포크 (Working, 검증됨)

| 기능 | 파일 | 비고 |
|------|------|------|
| **SQLite 스키마 + migration** | `lib/db.ts` | v1-v3 (memos 포함) |
| **DB write-through** | `lib/dbSync.ts` | fire-and-forget 패턴 |
| **DB hydration** | `lib/dbHydrate.ts` | 앱 시작 시 복원 |
| **사이드바 트리** | `layout/Sidebar*.tsx` | 프로젝트/세션/카테고리 |
| **브랜치 시스템** | `layout/BranchPanel.tsx` | checkpoint 기반 분기 |
| **메모 (클라이언트 전용)** | `sidebar/MemoTab.tsx` | SQLite memos 테이블 |
| **아카이브** | `sidebar/ArchiveTab.tsx` | 클라이언트 전용 |
| **FileViewer** | `chat/FileViewer.tsx` | Tauri read_text_file + 경로 감지 |
| **마크다운 렌더링** | `chat/MarkdownComponents.tsx` | shiki + remark-gfm + 파일 링크 |
| **커맨드 팔레트** | `chat/CommandPalette.tsx` | ! 커맨드 14개 |
| **QuickChips** | `chat/QuickChips.tsx` | 엔진/모델/페르소나/트리거 + isRunning 가드 |
| **메시지 액션** | `hooks/useMessageActions.ts` | 복사/답장/편집/삭제/메모 토글/브랜치 |
| **모바일 UI** | `layout/Mobile*.tsx` | Android 최적화 |
| **Zustand 스토어** | `store/*.ts` | chatStore, contextStore, runStore, systemStore |
| **Tauri 셋업** | `src-tauri/` | 윈도우 제어, SQLite, rawq |

### 교체 필요 (서버 의존 → 로컬)

| 기능 | 현재 (tunadish) | tunaChat |
|------|-----------------|---------|
| **메시지 송수신** | `chat.send` RPC → tunapi → CLI | Rust → Python sidecar → CLI |
| **히스토리 로드** | `conversation.history` RPC | SQLite SELECT (로컬 SSOT) |
| **엔진 목록** | `engine.list` RPC | Python sidecar `engine_models.py` |
| **대화 생성/삭제** | `conversation.create/delete` RPC | SQLite INSERT/DELETE |
| **프로젝트 컨텍스트** | `project.context` RPC | Tauri fs 직접 읽기 |
| **코드 검색** | `code.search` RPC | Tauri invoke → rawq 직접 실행 |
| **실행 취소** | `run.cancel` RPC | sidecar cancel signal |

### 제거 (불필요)

| 기능 | 이유 |
|------|------|
| `wsClient.ts` 전체 | WS 레이어 제거 |
| `wsHandlers/` 전체 (10개 파일) | 서버 알림 수신 불필요 |
| 서버 연결 인디케이터 | 로컬 앱 |

---

## 데이터 흐름

### 채팅 메시지

```
User Input (React)
  → Tauri invoke('chat_send', { convId, text })
    → Rust: SQLite INSERT (user message)
    → Rust: Python sidecar에 JSON 전송 (stdio)
      → Python: CLI subprocess 스폰
        ← JSONL events (stdout)
      ← Python: 통합 이벤트 → Rust (stdout JSON Lines)
    ← Rust: Tauri event emit ('message:stream', 'message:done')
    → Rust: SQLite INSERT (assistant message)
  ← React: Zustand update → UI render
```

### 라운드테이블 (멀티에이전트)

```
User: "이 설계를 3개 에이전트로 검토해줘"
  → Rust → Python sidecar
    → sidecar: claude 실행 → 답변 수집
    → sidecar: gemini 실행 (claude 답변 포함) → 답변 수집
    → sidecar: codex 실행 (이전 답변들 포함) → 답변 수집
  ← 각 단계별 스트리밍 이벤트 → React UI
```

### 모바일 릴레이 (선택적)

```
[PC] tunaChat (Tauri)
  ├─ Rust relay server (내장, 토글 On/Off)
  │   └─ WS 중계 + 인증
  └─ Python sidecar (CLI 에이전트)

[Mobile] tunaChat Android
  └─ React UI (동일 코드베이스)
      └─ WS → PC relay → Python sidecar → CLI
```

---

## 레포 구조

```
tunaChat/
  ├─ client/                    # Tauri + React (tunadish 포크)
  │   ├─ src/                   # React 프론트엔드
  │   │   ├─ components/
  │   │   ├─ store/
  │   │   ├─ hooks/
  │   │   └─ lib/
  │   ├─ src-tauri/             # Rust 백엔드
  │   │   ├─ src/
  │   │   │   ├─ lib.rs         # Tauri 커맨드 + sidecar 관리
  │   │   │   ├─ sidecar.rs     # Python sidecar IPC
  │   │   │   ├─ relay.rs       # 모바일 릴레이 (선택적)
  │   │   │   └─ commands/      # Tauri invoke 핸들러
  │   │   └─ Cargo.toml
  │   └─ package.json
  │
  ├─ sidecar/                   # Python 에이전트 런타임 (tunapi 코어 추출)
  │   ├─ runner.py              # 기반 클래스 (JsonlSubprocessRunner)
  │   ├─ runners/
  │   │   ├─ claude.py
  │   │   ├─ gemini.py
  │   │   └─ codex.py
  │   ├─ router.py              # 엔진 라우팅
  │   ├─ roundtable.py          # 멀티에이전트
  │   ├─ models.py              # 모델 디스커버리
  │   ├─ protocol.py            # stdio JSON Lines 프로토콜
  │   └─ requirements.txt       # anyio, msgspec
  │
  ├─ vendor/rawq/               # 코드 검색 엔진
  ├─ docs/
  └─ CLAUDE.md
```

---

## Sidecar 프로토콜 (stdio JSON Lines)

### Rust → Python (요청)

```jsonl
{"id":1,"method":"chat","params":{"engine":"claude","model":"opus-4","prompt":"hello","resume_token":null}}
{"id":2,"method":"cancel","params":{"id":1}}
{"id":3,"method":"roundtable","params":{"engines":["claude","gemini"],"prompt":"review this","rounds":1}}
{"id":4,"method":"models","params":{"engine":"claude"}}
```

### Python → Rust (응답/이벤트)

```jsonl
{"id":1,"event":"started","data":{"resume_token":"abc123"}}
{"id":1,"event":"progress","data":{"text":"thinking...","tool":"code_search"}}
{"id":1,"event":"completed","data":{"answer":"Hello!","ok":true,"resume_token":"abc123"}}
{"id":4,"result":{"models":["opus-4","sonnet-4","haiku-4"]}}
{"error":"engine 'codex' not found"}
```

---

## 마이그레이션 단계

### Phase 0: 프로젝트 세팅
- [x] tunadish 포크 → tunaChat 레포 생성
- [x] 프로젝트 이름/설정 변경 (package.json, Cargo.toml, tauri.conf.json)
- [x] wsClient.ts, wsHandlers/ 제거 → tauriClient.ts 스텁
- [x] sidecar/ 디렉토리 생성 + tunapi 코어 추출
- [x] Rust sidecar IPC 스캐폴딩

### Phase 1: 기본 채팅 (단일 에이전트)
- [x] Python sidecar: Claude runner 동작 (stdlib only, Claude stream-json 파싱)
- [x] Rust: sidecar 프로세스 시작/종료 관리 (auto-start on setup)
- [x] Rust: stdio JSON Lines IPC (sidecar:event → Tauri emit)
- [x] React: Tauri event 수신 → Zustand 업데이트 (tauriClient.ts)
- [x] 히스토리 SSOT를 SQLite로 전환 (dbSync fire-and-forget 연동)
- [ ] 기본 채팅 동작 확인 (통합 E2E)

### Phase 2: 멀티 에이전트 + 기존 기능
- [x] Python sidecar: Gemini, Codex runner (Windows node 우회 포함)
- [x] Python sidecar: 라운드테이블 (순차 멀티에이전트 + 컨텍스트 누적)
- [x] 브랜치/메모/FileViewer (로컬 전용, 로컬 RPC 핸들러 연동 완료)
- [x] rawq 코드 검색 (서브모듈 클론 + 빌드 + Tauri invoke 연동)

### Phase 3: 설정 + 개선
- [x] 설정 페이지 UI (일반/엔진/고급 탭, TopNav 기어 버튼)
- [x] 로컬 RPC 핸들러 (model.set, persona.set, trigger.set, conversation CRUD)
- [x] 모델 디스커버리 UI (엔진별 모델 목록 표시, 새로고침)
- [x] 브랜치별 독립 설정 (useConvSettings + QuickChips 이미 동작)
- [x] Journal 뷰어 (설정 페이지 저널 탭, 대화별 메시지 미리보기)

### Phase 4: 모바일 릴레이
- [ ] Rust relay server (내장)
- [ ] 모바일 연결 모드 토글
- [ ] 인증/세션 관리

### Phase 5: 하네스 아키텍처 (docs/plans/harness-architecture.md)

#### MVP-1 (기본)
- [x] Rust `scan_workspace` — 워크스페이스 1단계 스캔, 프로젝트 자동 분류
- [x] Rust `get_project_context` — git branch/status, 에이전트 세션, CLAUDE.md
- [x] `agentLoader.ts` — docs/agents/*.md frontmatter 파싱 → persona 적용
- [x] sidecar: `--append-system-prompt` + `--allowedTools` RBAC 전달
- [x] `!project set/scan` 커맨드
- [x] 토큰 추적 (DB v5: artifacts + trace_log + conversations 토큰 누적)
- [x] `project.context` RPC를 Rust `get_project_context`로 교체 (git branch, markdown, memos, conv_settings 병합)

#### MVP-2
- [ ] architect → developer Task Brief 위임 + 브랜치 자동 생성
- [ ] 사용자 승인 게이트 UI (Plan Approve / Merge Gate 버튼)
- [ ] 대화 브랜치 ↔ git branch 자동 연동
- [ ] 스킬 시스템 (프로젝트/브랜치 단위 로딩)
- [ ] 아티팩트 테이블 (v5 마이그레이션)

#### MVP-3 (고급 — 선택적)
- [ ] 자동 리뷰 에이전트 (code-reviewer, 다른 모델)
- [ ] diff-summarizer 자동 호출
- [ ] long-running session resume
- [ ] Budget governor (토큰 기반)
