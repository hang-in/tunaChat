# 에이전트 시스템

## 개요

tunaChat의 에이전트 정의는 **파일 기반** (`docs/agents/*.md`).
각 파일은 frontmatter(설정) + body(시스템 프롬프트)로 구성됩니다.

## 파일 형식

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

## 현재 에이전트

| 파일 | 역할 | 모델 | 도구 |
|------|------|------|------|
| `architect.md` | 총괄 설계/판단 | opus-4-6 | Read만 (런타임 RBAC) |
| `developer.md` | 구현 담당 | sonnet-4-6 | 전체 |
| `repo-scout.md` | 저장소 정찰 | sonnet-4-6 | Read + Bash |
| `diff-summarizer.md` | diff 요약 | sonnet-4-5 | Read |
| `code-reviewer.md` | 리뷰어 (선택적) | GPT Codex | Read + Bash |
| `code-reviewerer.md` | 리뷰어 (선택적) | opus-4-6 | Read + Bash |

## 로딩 흐름

```
대화 persona 필드 = "architect"
  → tauriClient: docs/agents/architect.md 로드
    → agentLoader.ts: frontmatter 파싱
      → model → engine/model 변환
      → tools → allowed_tools 리스트
      → body → system_prompt
    → invoke('chat_send', { systemPrompt, allowedTools })
      → sidecar: --append-system-prompt + --allowedTools
```

## RBAC

frontmatter `tools` 선언이 sidecar의 `allowed_tools` 파라미터로 변환됩니다.
architect의 `tools.write: true` 선언은 frontmatter에 있지만, 본문에서 "직접 구현 금지"라고 명시.
런타임에서 실제로 차단하려면 `allowed_tools`에서 Write/Edit를 제외하면 됩니다.

## 스킬 시스템과의 관계

에이전트 파일은 **스킬의 확장 형태**.
- 에이전트: persona + system prompt + 도구 권한
- 스킬: 도메인 지식 패키지 (특정 작업에 대한 지침)

둘 다 마크다운 파일이며, 브랜치 생성 시 에이전트 + 스킬을 조합하여 사용.
