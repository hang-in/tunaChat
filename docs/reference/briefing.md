# tunaChat — 기술 브리핑

## 원본 프로젝트

- **tunadish** (`D:\privateProject\tunaDish\`) — UI 포크 원본
- **tunapi** (`D:\privateProject\tunapi\`) — 에이전트 런타임 참조 (sidecar로 추출)

## tunaDish → tunaChat 변경 요약

| 영역 | tunadish | tunaChat |
|------|----------|----------|
| 통신 | WS JSON-RPC → tunapi 서버 | Tauri invoke → Rust → sidecar stdio |
| SSOT | 서버 메모리 | 로컬 SQLite |
| 에이전트 런타임 | tunapi 서버 | Python sidecar (독립 프로세스) |
| HMR 시 대화 | 유실 | SQLite에서 복구 |
| 프로젝트 발견 | tunapi.toml 설정 | Rust scan_workspace (자동 스캔) |
| 페르소나 | 프롬프트 레벨 | 파일 기반 (docs/agents/*.md) |

## 레포 구조

`docs/reference/handoff.md` 의 "3. 파일 구조" 섹션 참조.

## JSON Lines 프로토콜

### Rust → Python (요청)
```jsonl
{"id":1,"method":"chat","params":{"engine":"claude","prompt":"hello","cwd":"/path","system_prompt":"...","allowed_tools":["Read","Grep"]}}
{"id":2,"method":"cancel","params":{"id":1}}
{"id":3,"method":"models","params":{"engine":"claude"}}
```

### Python → Rust (이벤트)
```jsonl
{"id":1,"event":"started","data":{"engine":"claude","resume":{"engine":"claude","value":"session-id"}}}
{"id":1,"event":"action","data":{"action":{"kind":"command","title":"git status"},"phase":"started"}}
{"id":1,"event":"completed","data":{"ok":true,"answer":"Hello!","resume":{"engine":"claude","value":"session-id"},"usage":{"total_cost_usd":0.06}}}
```

## DB 스키마

`docs/reference/handoff.md` 의 "4. DB 스키마 (v4)" 섹션 참조.

## 에이전트 파일 형식

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

파싱: `agentLoader.ts` → frontmatter + body → engine/model/tools/systemPrompt
