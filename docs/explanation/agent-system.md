# 에이전트 시스템

## 개요

tunaChat에는 두 가지 독립된 시스템이 있습니다:

1. **에이전트** (`docs/agents/*.md`) — 에이전트의 정체성 + 도구 권한 + system prompt
2. **스킬** (`~/.tunachat/skills/`) — 외부 도메인 지식 패키지

이 두 시스템은 **별개**이며, 역할이 다릅니다.

## 에이전트 파일

### 형식

```yaml
---
description: 역할 설명
mode: primary | subagent
model: anthropic/claude-opus-4-6
temperature: 0.1
tools:
  write: true
  edit: true
  bash: true
---
시스템 프롬프트 본문 (마크다운)
```

### 현재 에이전트

| 파일 | 역할 | 모델 | 도구 |
|------|------|------|------|
| `architect.md` | 총괄 설계/판단 | opus-4-6 | Read만 (RBAC) |
| `developer.md` | 구현 담당 | sonnet-4-6 | 전체 |
| `repo-scout.md` | 저장소 정찰 | sonnet-4-6 | Read + Bash |
| `diff-summarizer.md` | diff 요약 | sonnet-4-5 | Read |
| `code-reviewer.md` | 리뷰어 (선택적 고급 모드) | GPT Codex | Read + Bash |
| `code-reviewerer.md` | 리뷰어 (선택적 고급 모드) | opus-4-6 | Read + Bash |

### 적용 방식

```
대화 persona = "architect"
  → agentLoader.ts: docs/agents/architect.md 로드
    → frontmatter 파싱: model, tools, temperature
    → body: system prompt
  → tauriClient: invoke('chat_send', { systemPrompt, allowedTools })
    → sidecar: --append-system-prompt + --allowedTools
```

### RBAC

frontmatter `tools` → `toolsToAllowedList()` 변환:
- `tools.bash: true` → `["Bash"]` 추가
- `tools.write: true` → `["Write"]` 추가
- `tools.edit: true` → `["Edit"]` 추가
- 기본: `["Read", "Grep", "Glob"]` 항상 포함

---

## 스킬 시스템 (외부 도메인 지식)

### 스킬이란

스킬 ≠ 에이전트. 스킬은 **에이전트가 특정 기술을 사용할 때 필요한 공식 가이드/패턴/API 참조**.
Anthropic, OpenAI, Vercel, Supabase 등이 배포하는 공식 스킬 팩이 존재.

### SKILL.md 형식

```yaml
---
name: claude-api
description: "Build apps with Claude API. TRIGGER when: code imports anthropic..."
license: Complete terms in LICENSE.txt
---
# 스킬 본문 (도메인 지식)
...
```

### 적용 방식 (계획)

```
프로젝트 activeSkills: ["claude-api", "supabase"]
  → chat.send 시 활성 스킬 로드
  → SKILL.md body를 context prefix로 조립
  → agent system prompt + skill content + user prompt
```

### 비교

| | 에이전트 (docs/agents/*.md) | 스킬 (~/.tunachat/skills/) |
|---|---|---|
| **역할** | 에이전트의 정체성 + 도구 권한 | 도메인 지식 |
| **적용 단위** | 대화 persona | 프로젝트/브랜치 activeSkills |
| **내용** | system prompt + RBAC | API 참조, 패턴, 가이드 |
| **주입 방식** | `--append-system-prompt` | context prefix |
| **출처** | 사용자 정의 | 공식 스킬 팩 |

상세: `docs/plans/harness-architecture.md` 4장 참조.
