# tunaChat — 핸드오프 문서

> 작성일: 2026-03-24 (최종 업데이트)
> 마지막 검증: tsc ✅ | vitest 99/99 ✅ | playwright 3/3 ✅ | cargo check ✅ | sidecar ✅

---

## 1. 프로젝트 상태 요약

tunadish(UI) + tunapi(에이전트 런타임)을 합친 **스탠드얼론 데스크탑 AI 에이전트 오케스트레이션 챗앱**.
서버 의존성을 완전히 제거하고, 로컬 SQLite SSOT + Python sidecar IPC 아키텍처로 전환 완료.

### 완료된 Phase

| Phase | 내용 | 상태 |
|-------|------|:---:|
| **0** | 프로젝트 세팅 — 이름 변경, WS 제거, sidecar 스캐폴딩 | ✅ |
| **1** | 기본 채팅 — Claude runner, Rust IPC, Tauri event → Zustand | ✅ |
| **2** | 멀티 에이전트 — Gemini/Codex runner, 라운드테이블, rawq, 로컬 RPC | ✅ |
| **3** | 설정 UI — 설정 페이지, 모델 디스커버리, 저널 뷰어, 브랜치별 설정 | ✅ |
| **4** | 모바일 릴레이 | 📄 계획 문서만 |
| **5** | 하네스 아키텍처 MVP-1 — 프로젝트 발견, agent 파일 로딩, RBAC | 🔧 진행 중 |

---

## 2. 아키텍처

```
tunaChat (Tauri v2)
  ├─ React UI (client/src/)
  │   ├─ Zustand stores (chat, run, system, context)
  │   ├─ tauriClient.ts — Tauri invoke + sidecar:event 수신
  │   ├─ SQLite (tunachat.db) — 로컬 SSOT
  │   └─ 설정 페이지 (일반/엔진/저널/고급)
  │
  ├─ Rust 백엔드 (client/src-tauri/)
  │   ├─ lib.rs — Tauri commands (chat_send, start_sidecar, code_search 등)
  │   └─ sidecar.rs — Python sidecar 프로세스 관리 (stdin/stdout IPC)
  │
  └─ Python sidecar (sidecar/)
       ├─ protocol.py — stdio JSON Lines (스레드 기반 stdin, Windows 호환)
       ├─ router.py — 엔진 라우팅 + 라운드테이블
       ├─ runner.py — CLI subprocess 공통 실행 루프
       └─ runners/ — claude.py, gemini.py, codex.py
```

### 데이터 흐름

```
User Input → tauriClient.sendRpc('chat.send')
  → invoke('chat_send') [Tauri]
    → Rust: sidecar.send("chat", params) [stdin JSONL]
      → Python: router.chat() → ClaudeRunner.build_command()
        → subprocess: claude -p --output-format stream-json [cwd=project_path]
          ← JSONL events (stdout)
        ← Python: translate_line() → TunapiEvent [stdout JSONL]
      ← Rust: emit('sidecar:event') [Tauri event]
    ← React: handleSidecarEvent() → Zustand + dbSync
```

---

## 3. 파일 구조

```
tunaChat/
  ├─ client/                          # Tauri + React
  │   ├─ src/
  │   │   ├─ App.tsx                  # 엔트리 — hydrateFromDb → tauriClient.init
  │   │   ├─ lib/
  │   │   │   ├─ tauriClient.ts       # ★ 핵심 — Tauri invoke + sidecar event → Zustand + 로컬 RPC
  │   │   │   ├─ agentLoader.ts      # docs/agents/*.md frontmatter 파싱 → persona/RBAC
  │   │   │   ├─ db.ts                # SQLite 스키마 v1-v4, CRUD, FTS5
  │   │   │   ├─ dbSync.ts            # fire-and-forget DB 동기화
  │   │   │   ├─ dbHydrate.ts         # 앱 시작 시 SQLite → Zustand 복원
  │   │   │   └─ useConvSettings.ts   # 대화별 설정 (엔진/모델/페르소나)
  │   │   ├─ store/
  │   │   │   ├─ chatStore.ts         # 프로젝트, 대화, 메시지
  │   │   │   ├─ runStore.ts          # 실행 상태 (idle/running/cancelling)
  │   │   │   ├─ systemStore.ts       # UI 상태 (사이드바, 설정, 브랜치 패널)
  │   │   │   └─ contextStore.ts      # 코드 검색, 엔진 목록, 브랜치
  │   │   └─ components/
  │   │       ├─ settings/
  │   │       │   ├─ SettingsPage.tsx  # 설정 페이지 (일반/엔진/저널/고급)
  │   │       │   └─ JournalViewer.tsx # 대화 히스토리 타임라인
  │   │       ├─ chat/                # InputArea, QuickChips, MessageView 등
  │   │       └─ layout/              # DesktopShell, Sidebar, BranchPanel 등
  │   ├─ src-tauri/
  │   │   ├─ src/
  │   │   │   ├─ lib.rs               # Tauri commands 전체
  │   │   │   └─ sidecar.rs           # SidecarManager (spawn, send, stop)
  │   │   ├─ Cargo.toml
  │   │   ├─ tauri.conf.json          # productName: tunaChat
  │   │   └─ binaries/
  │   │       └─ rawq-x86_64-pc-windows-msvc.exe
  │   ├─ e2e/                         # Playwright e2e 테스트
  │   └─ package.json
  │
  ├─ sidecar/                         # Python 에이전트 런타임
  │   ├─ __main__.py                  # 엔트리 — asyncio.run(main)
  │   ├─ protocol.py                  # stdin 읽기 (스레드), stdout 쓰기
  │   ├─ router.py                    # 엔진 라우팅 + 라운드테이블
  │   ├─ runner.py                    # CLI subprocess 공통 루프
  │   ├─ model.py                     # TunapiEvent, ResumeToken, Action
  │   ├─ events.py                    # EventFactory
  │   └─ runners/
  │       ├─ claude.py                # Claude stream-json 파싱
  │       ├─ gemini.py                # Gemini stream-json 파싱
  │       ├─ codex.py                 # Codex JSONL 파싱
  │       └─ tool_actions.py          # tool_kind_and_title 분류
  │
  ├─ vendor/rawq/                     # 코드 검색 엔진 (git clone)
  ├─ docs/
  │   ├─ agents/                      # 에이전트 정의 파일 (frontmatter + system prompt)
  │   │   ├─ architect.md             # 총괄 설계 (opus-4-6, read-only)
  │   │   ├─ developer.md             # 구현 (sonnet-4-6, full tools)
  │   │   ├─ code-reviewer.md         # 리뷰어 1 (선택적 고급 모드)
  │   │   ├─ code-reviewerer.md       # 리뷰어 2 (선택적 고급 모드)
  │   │   ├─ repo-scout.md            # 저장소 정찰 (sonnet-4-6)
  │   │   └─ diff-summarizer.md       # diff 요약 (sonnet-4-5)
  │   ├─ plans/
  │   │   ├─ aoc-reference.md         # Phase 0-5 마이그레이션 체크리스트
  │   │   ├─ harness-architecture.md  # 하네스 아키텍처 설계
  │   │   └─ phase4-mobile-relay.md   # Phase 4 모바일 릴레이 계획
  │   └─ HANDOFF.md                   # 이 문서
  └─ CLAUDE.md                        # 프로젝트 규칙
```

---

## 4. DB 스키마 (v4)

```sql
-- v1
schema_version (version PK, applied_at)
projects       (key PK, name, path, default_engine, source, type, updated_at)
conversations  (id PK, project_key, label, type, parent_id, source, created_at,
                updated_at, engine, model, persona, trigger_mode)
messages       (id PK, conversation_id, role, content, timestamp, status,
                progress_content, engine, model, persona, metadata, created_at)
branches       (id PK, conversation_id, label, status, checkpoint_id,
                session_id, git_branch, parent_branch_id, created_at)
messages_fts   (FTS5 가상 테이블, INSERT/UPDATE/DELETE 트리거 자동 동기화)

-- v2
conversations  ADD COLUMN custom_label TEXT
branches       ADD COLUMN custom_label TEXT

-- v3
memos          (id PK, message_id, conversation_id, project_key, content,
                type, tags, created_at)

-- v4
conversations  ADD COLUMN resume_token TEXT    -- CLI --resume 인자
conversations  ADD COLUMN resume_engine TEXT   -- 토큰 소유 엔진
projects       ADD COLUMN path_abs TEXT        -- 절대 경로
```

---

## 5. tunadish → tunaChat 변경점 요약

| 영역 | tunadish | tunaChat |
|------|----------|----------|
| 통신 | WS JSON-RPC → tunapi 서버 | Tauri invoke → Rust → sidecar stdio |
| SSOT | 서버 메모리 (WS 끊기면 유실) | 로컬 SQLite |
| 에이전트 런타임 | tunapi Python 서버 | Python sidecar (독립 프로세스) |
| HMR 시 대화 | ❌ 유실 | ✅ SQLite에서 복구 + streaming 메시지 자동 매칭 |
| 코드 검색 | WS RPC → tunapi → rawq | Tauri invoke → rawq 직접 실행 |
| 설정 | 서버에서 관리 | 로컬 SQLite + Zustand |
| resume token | 서버 메모리 | conversations.resume_token (DB 영속) |
| 프로젝트 cwd | 서버에서 관리 | chat_send → sidecar → subprocess cwd |

### 삭제된 것
- `wsClient.ts`, `wsHandlers/` (10파일), `ConnectionScreen.tsx`
- `ws` npm 패키지, `@types/ws`
- `e2e/mock-ws-server.ts`

### 추가된 것
- `tauriClient.ts` — WS 대체, Tauri invoke + event 기반
- `sidecar/` — tunapi 코어 추출 (stdlib only, 12파일)
- `sidecar.rs` — Rust sidecar 프로세스 관리
- `SettingsPage.tsx`, `JournalViewer.tsx` — 설정 UI
- Tauri commands: `start_sidecar`, `chat_send`, `chat_cancel`, `list_models`, `code_search`, `code_map`

---

## 6. 주요 로직 위치

| 기능 | 파일 | 핵심 함수/클래스 |
|------|------|-----------------|
| 앱 초기화 | `App.tsx` | `hydrateFromDb()` → `tauriClient.init()` |
| 메시지 송수신 | `tauriClient.ts` | `sendRpc('chat.send')` → `handleSidecarEvent()` |
| HMR 복구 | `tauriClient.ts:92-98` | streaming 메시지 역순 탐색 매칭 |
| resume token 저장 | `tauriClient.ts:122-127` | completed 이벤트에서 자동 저장 |
| DB 마이그레이션 | `db.ts:116-163` | `MIGRATIONS[]` 배열 |
| sidecar 스폰 | `sidecar.rs:55-100` | `SidecarManager.start()` |
| sidecar 경로 탐색 | `lib.rs:24-48` | candidates 배열 + `__main__.py` 존재 확인 |
| Claude JSONL 파싱 | `runners/claude.py:98-147` | `translate_claude_event()` |
| 라운드테이블 | `router.py:63-97` | `Router.roundtable()` |
| 코드 검색 | `lib.rs:88-123` | `code_search()` Tauri command |

---

## 7. 개발 환경 실행

```bash
# 프론트엔드 + Rust 백엔드 (Tauri dev)
cd client
npm run tauri dev

# Python sidecar 독립 테스트
cd tunaChat  # 프로젝트 루트
echo '{"id":1,"method":"models","params":{"engine":"claude"}}' | python -m sidecar

# 테스트
cd client
npx tsc --noEmit          # TypeScript
npx vitest run            # 유닛 (99개)
npx playwright test       # e2e (3개)

# Rust 빌드 확인
cd client/src-tauri
cargo check
```

---

## 8. 미완료 항목

### Phase 5 (하네스 아키텍처)
**문서**: `docs/plans/harness-architecture.md`

#### MVP-1 — 완료
- [x] Rust scan_workspace, get_project_context
- [x] agentLoader.ts (frontmatter 파싱 → persona/RBAC)
- [x] sidecar: system_prompt + allowed_tools 전달
- [x] 토큰 추적 (DB v5)
- [x] project.context Rust 연동

#### MVP-2 (다음 단계)
- [ ] architect → developer Task Brief 위임 + 브랜치 자동 생성
- [ ] 사용자 승인 게이트 UI (Plan Approve / Merge Gate 버튼)
- [ ] 대화 브랜치 ↔ git branch 연동
- [ ] 스킬 시스템 (프로젝트/브랜치 단위 로딩)
- [ ] 아티팩트 테이블 (artifacts, workflow_state)

### 기존 Phase 잔여
- [ ] 통합 E2E 채팅 확인 (tauri dev 실행)
- [ ] 모델 디스커버리 동적화 (sidecar models 응답 연동)
- [ ] rawq git submodule 재등록
- [ ] 프로덕션 빌드 시 sidecar 번들링 전략

### Phase 4 (계획만)
- [ ] Rust WS relay server (`docs/plans/phase4-mobile-relay.md` 참조)

---

## 9. 알려진 이슈

1. **sidecar 경로**: `tauri dev` 시 cwd가 `client/src-tauri/`이므로 `../../sidecar`로 탐색. `__main__.py` 존재 확인으로 후보 배열에서 선택.

2. **rawq externalBin**: `binaries/rawq-x86_64-pc-windows-msvc.exe`로 복사 필요. `rawq` 소스가 변경되면 `vendor/rawq`에서 `cargo build --release` 후 재복사.

3. **Windows Python 경로**: 시스템에 여러 Python이 설치된 경우, sidecar가 의도하지 않은 Python을 사용할 수 있음. `sidecar.rs`에서 `Command::new("python")` 대신 특정 경로를 사용하도록 설정 가능.

4. **HMR 시 event listener**: `tauriClient` 모듈이 교체되면 Tauri event listener가 재등록됨. `_sidecarStarted` 플래그 + `isTauriEnv()` 가드로 중복 방지하고 있으나, 빠른 연속 HMR 시 이벤트 누락 가능.

5. **tunadish 대비 사이드이펙트**: WS 제거 시 no-op으로 처리했던 RPC 핸들러들이 많았음. 세션 중 발견되어 일괄 수정 완료: branch CRUD, message delete/retry, conversation.list conv_settings 병합, run 완료 후 context 갱신, `!` 커맨드 로컬 처리 (14개 전부).

6. **에이전트 메시지 2중 출력 수정**: `invoke('chat_send')` async 반환 전에 sidecar completed 이벤트가 도착하는 race condition → `streamingMsgIds` 매칭 실패 → 새 메시지 생성 → 중복. 해결: else 분기에서 새 메시지 생성 제거, 대신 마지막 streaming 메시지를 역순 탐색하여 업데이트.

7. **progressContent 패턴**: 에이전트 action 이벤트 → `updateProgress()`로 `progressContent`에 누적 → MessageView의 ProgressBlock이 streaming 중 롤링 5줄, 완료 후 축소 3줄 + 최종 답변 표시.

---

## 10. 셀프 디버깅 (tunaChat → tunaChat)

프로젝트 등록 시 `path`에 tunaChat 루트를 설정하면:
- CLI 에이전트가 `cwd=D:\privateProject\tunaChat`에서 코드 탐색
- rawq로 자기 코드 검색
- 라운드테이블로 Claude+Gemini 크로스 리뷰
- resume token으로 디버깅 세션 재개

단, `tauri dev` 실행 중 CLI가 소스를 수정하면 Vite HMR이 즉시 반영됨 — 의도적이면 유용하지만 주의 필요.
