# tunaChat — 기술 브리핑

## 원본 프로젝트

- **tunadish** (`D:\privateProject\tunaDish\`) — UI 포크 원본
- **tunapi** (`D:\privateProject\tunapi\`) — 에이전트 런타임 참조 (sidecar로 추출)

## tunaDish → tunaChat 변경 요약

| 영역 | tunadish | tunaChat |
|------|----------|----------|
| 통신 | WS JSON-RPC → tunapi 서버 | Tauri invoke → Rust → sidecar stdio |
| SSOT | 서버 메모리 | 로컬 SQLite (v1-v5) |
| 에이전트 런타임 | tunapi 서버 | Python sidecar (독립 프로세스) |
| HMR 시 대화 | 유실 | SQLite에서 복구 + streaming 메시지 자동 매칭 |
| 프로젝트 발견 | tunapi.toml 설정 | Rust `scan_workspace` (자동 스캔) |
| 페르소나 | 프롬프트 레벨 (미구현) | 파일 기반 (`docs/agents/*.md`) + RBAC |
| 컨텍스트 | 서버에서 수집 | Rust `get_project_context` (git, CLAUDE.md, memos) |
| 비용 추적 | 없음 | 토큰 누적 (completed 이벤트 usage → DB) |

## 레포 구조

`docs/reference/handoff.md`의 "3. 파일 구조" 참조.

## Tauri Commands (Rust 백엔드)

| command | 파라미터 | 용도 |
|---------|---------|------|
| `start_sidecar` | — | Python sidecar 프로세스 시작 |
| `chat_send` | engine, model, prompt, resumeToken, projectPath, systemPrompt, allowedTools | 채팅 메시지 전송 |
| `chat_cancel` | requestId | 실행 취소 |
| `list_models` | engine | 모델 목록 조회 |
| `code_search` | query, projectPath, lang | rawq 코드 검색 |
| `code_map` | projectPath, depth, lang | rawq 코드 맵 |
| `scan_workspace` | root | 워크스페이스 1단계 스캔 + 프로젝트 분류 |
| `get_project_context` | projectPath | git branch/status, 에이전트 세션, CLAUDE.md |
| `read_text_file` | path | 파일 읽기 |

## JSON Lines 프로토콜 (Rust ↔ Python)

### 요청
```jsonl
{"id":1,"method":"chat","params":{"engine":"claude","prompt":"hello","cwd":"/path","system_prompt":"...","allowed_tools":["Read","Grep"]}}
{"id":2,"method":"cancel","params":{"id":1}}
{"id":3,"method":"models","params":{"engine":"claude"}}
{"id":4,"method":"roundtable","params":{"engines":["claude","gemini"],"prompt":"review","rounds":1}}
```

### 이벤트
```jsonl
{"id":1,"event":"started","data":{"engine":"claude","resume":{"engine":"claude","value":"session-id"},"title":"opus-4-6"}}
{"id":1,"event":"action","data":{"action":{"kind":"command","title":"git status"},"phase":"started"}}
{"id":1,"event":"completed","data":{"ok":true,"answer":"Hello!","resume":{"engine":"claude","value":"session-id"},"usage":{"total_cost_usd":0.06,"input_tokens":100,"output_tokens":20}}}
```

## 에이전트 파일 형식 (`docs/agents/*.md`)

```yaml
---
description: 역할 설명
mode: primary | subagent
model: anthropic/claude-opus-4-6
temperature: 0.1
tools:
  write: true | false
  edit: true | false
  bash: true | false
---
시스템 프롬프트 본문
```

파싱: `agentLoader.ts` → frontmatter + body → engine/model/allowed_tools/systemPrompt
적용: `tauriClient.ts` chat.send → `invoke('chat_send', { systemPrompt, allowedTools })`

## 외부 스킬 시스템 (계획)

에이전트 파일 ≠ 스킬. 별개 시스템:
- **에이전트**: persona + system prompt + 도구 권한 (대화 단위)
- **스킬**: 외부 도메인 지식 패키지 (프로젝트/브랜치 단위 activeSkills)

스킬 소스: Anthropic/OpenAI/Vercel/Supabase 등 공식 스킬 팩 (`SKILL.md` frontmatter 형식)
저장: `~/.tunachat/skills/` (글로벌) + `<project>/.tunachat/skills/` (로컬)

상세: `docs/plans/harness-architecture.md` 4장 참조.
