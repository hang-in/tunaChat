# Phase 0-3 완료 기록

> 완료일: 2026-03-24

## Phase 0: 프로젝트 세팅
- tunadish 포크 → tunaChat 레포
- 이름/설정 변경 (package.json, Cargo.toml, tauri.conf.json)
- wsClient.ts, wsHandlers/ (10파일) 삭제
- tauriClient.ts 스텁 생성
- sidecar/ 디렉토리 + tunapi 코어 추출
- Rust sidecar IPC 스캐폴딩

## Phase 1: 기본 채팅
- Claude runner (stdlib json, stream-json 파싱)
- Rust sidecar 프로세스 관리 + stdout reader 스레드 → Tauri emit
- React Tauri event → Zustand + dbSync
- 히스토리 SSOT → SQLite

## Phase 2: 멀티 에이전트
- Gemini runner (Windows node 우회 포함)
- Codex runner (stdin 프롬프트, turn-based)
- 라운드테이블 (순차 멀티에이전트 + 컨텍스트 누적)
- rawq 코드 검색 (서브모듈 클론 + 빌드 + Tauri invoke)
- 로컬 RPC 핸들러 38개 구현 (모든 sendRpc 커버)

## Phase 3: 설정 + 개선
- 설정 페이지 (일반/엔진/저널/고급)
- 모델 디스커버리 UI
- Journal 뷰어
- 브랜치별 독립 설정

## 주요 디버깅
- WS no-op 핸들러 일괄 수정 (branch CRUD, message ops, context 갱신)
- 에이전트 메시지 2중 출력 수정 (race condition → streaming 메시지 역순 탐색)
- !커맨드 14개 로컬 처리 + handleCmdSelect 우회 수정
- HMR 복구 로직 (streamingMsgIds 유실 대비)
- progressContent 패턴 (ProgressBlock streaming/done 분리)
- F5 리로딩 시 세션 복원 (dbHydrate 타이밍 수정)
- conversation.list conv_settings 병합 (persona/triggerMode 누락 수정)
