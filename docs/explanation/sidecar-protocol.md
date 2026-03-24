# Sidecar 프로토콜

## 개요

Rust 백엔드와 Python sidecar는 **stdio JSON Lines**로 통신합니다.
각 줄이 하나의 JSON 객체.

## 요청 (Rust → Python)

```jsonl
{"id":1,"method":"chat","params":{"engine":"claude","prompt":"hello","model":"opus-4-6","cwd":"/path","resume_token":null,"system_prompt":"You are...","allowed_tools":["Read","Grep"]}}
{"id":2,"method":"cancel","params":{"id":1}}
{"id":3,"method":"models","params":{"engine":"claude"}}
{"id":4,"method":"roundtable","params":{"engines":["claude","gemini"],"prompt":"review","rounds":1}}
```

## 이벤트 (Python → Rust)

```jsonl
{"id":1,"event":"started","data":{"engine":"claude","resume":{"engine":"claude","value":"session-id"},"title":"claude-opus-4-6","meta":{...}}}
{"id":1,"event":"action","data":{"engine":"claude","action":{"id":"tool-1","kind":"command","title":"git status","detail":{}},"phase":"started"}}
{"id":1,"event":"action","data":{"engine":"claude","action":{"id":"tool-1","kind":"command","title":"git status","detail":{}},"phase":"completed","ok":true}}
{"id":1,"event":"completed","data":{"engine":"claude","ok":true,"answer":"Hello!","resume":{"engine":"claude","value":"session-id"},"usage":{"total_cost_usd":0.06,"duration_ms":1855}}}
{"id":3,"result":{"models":["claude-opus-4-6","claude-sonnet-4-6","claude-haiku-4-5-20251001"]}}
{"error":"engine 'unknown' not available","id":5}
```

## 이벤트 타입

| 이벤트 | 설명 | UI 반응 |
|--------|------|---------|
| `started` | 세션 시작, resume token 수신 | runStatus → running, progress 표시 |
| `action` | 도구 사용 (tool_use, thinking 등) | progressContent에 누적, ProgressBlock 롤링 |
| `completed` | 최종 답변 | content 설정, finalize, runStatus → idle |
| `result` | 비스트리밍 응답 (models 등) | 직접 처리 |
| `error` | 오류 | 에러 메시지 표시 |

## Windows 호환

Python의 `asyncio.connect_read_pipe`가 Windows ProactorEventLoop에서 동작하지 않으므로,
`protocol.py`에서 **스레드 기반 stdin 읽기**를 사용합니다.
