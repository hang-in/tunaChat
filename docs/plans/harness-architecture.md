# tunaChat 하네스 아키텍처

> tunaDish 철학 기반: "코딩하지 않는 IDE — 함께 고민하는 동업자 플랫폼"

---

## 1. 설계 원칙

tunaDish에서 계승:
- **사용자가 거버넌스 주도** — AI는 실행을 보완, 코드리뷰는 사용자가 직접
- **함께 고민하는 것** — 위임이 아닌 협업
- worktree 격리 없음, **대화 브랜치 ↔ git branch 동기화**가 계획
- **에이전트 정의 = 파일** (docs/agents/*.md) — 프롬프트가 아닌 구조화된 문서
- **스킬 = 도메인 지식 패키지** — 프로젝트/브랜치 단위로 로딩

---

## 2. 프로젝트-브랜치 매핑

```
Project: "작업명"
  ├─ main (architect)
  │   - agent: docs/agents/architect.md
  │   - 사용자와 대화, 계획 수립, 판단
  │
  ├─ branch: "plan-v1" (계획 아티팩트)
  │   - 자동 생성: architect가 계획 확정 시
  │   - 승인 게이트: [Approve] / [Reject]
  │
  ├─ branch: "task-1-impl" (developer)
  │   - agent: docs/agents/developer.md
  │   - git branch: feat/task-1 (자동 연동)
  │   - Task Brief만 받아서 구현
  │
  └─ branch: "scout" (repo-scout)
      - agent: docs/agents/repo-scout.md
      - ARCHITECTURE.md 갱신
```

### 사용자 직접 리뷰 (기본 모드)
- developer 완료 → diff를 사용자에게 표시
- 사용자가 직접 검토하고 승인/거부
- 자동 리뷰 에이전트는 **선택적 고급 모드**에서만 활성화

---

## 3. 에이전트 시스템 (docs/agents/*.md)

### 파일 형식

```yaml
---
description: 역할 설명
mode: primary | subagent
model: anthropic/claude-opus-4-6  # 또는 google/gemini-2.5-pro
temperature: 0.1
tools:
  write: true | false
  edit: true | false
  bash: true | false
---
시스템 프롬프트 본문 (마크다운)
```

### 로딩 흐름

```
브랜치 생성 시 agent 파일 선택
  → frontmatter 파싱 (model, tools, temperature)
  → conversation settings 자동 설정 (engine, model, persona)
  → sidecar chat 요청 시 system prompt 주입 + allowed_tools 제어
```

### RBAC (frontmatter tools 기반)

| agent | write | edit | bash | 실제 효과 |
|-------|:---:|:---:|:---:|---------|
| architect | ✗ 런타임 차단 | ✗ | ✗ | Read/Grep/Glob만 |
| developer | ✓ | ✓ | ✓ | 전체 도구 |
| repo-scout | ✗ 런타임 차단 | ✗ | ✓ read-only | Read + Bash(read-only) |
| summarizer | ✗ | ✗ | ✗ | Read만 |

→ frontmatter의 `tools` 선언을 sidecar의 `allowed_tools` 파라미터로 변환

---

## 4. 스킬 시스템

### 스킬이란

스킬 = **외부 도메인 지식 패키지**. 에이전트가 특정 기술을 사용할 때 필요한 공식 가이드/API 참조/패턴을 구조화한 문서.
Anthropic, OpenAI, Vercel, Supabase 등이 배포하는 공식 스킬 팩이 존재.

> tunaDish의 "에이전트별 스킬 경로"와는 다른 개념.
> CLI 에이전트의 내장 스킬이 아니라, **tunaChat이 관리하는 외부 도메인 지식 라이브러리**.

### 스킬 팩 소스

현재 `_research/_skills/`에 수집된 공식 팩:

| 스킬 팩 | 출처 | 내용 |
|---------|------|------|
| `skills-anthropic` | Anthropic | Claude API, Agent SDK, PDF, Canvas, Brand Guidelines 등 |
| `skills-openai` | OpenAI | Codex 관련 스킬 |
| `skills-microsoft` | Microsoft | Agents, Marketplace |
| `skills-vercel` | Vercel | Next.js, v0 등 |
| `skills-supabase` | Supabase | Supabase SDK, Edge Functions |
| `skills-remotion` | Remotion | 비디오 렌더링 |

### 스킬 파일 형식 (SKILL.md)

```yaml
---
name: claude-api
description: "Build apps with Claude API. TRIGGER when: code imports anthropic..."
license: Complete terms in LICENSE.txt
---
# 스킬 본문 (도메인 지식)
...
```

### 프로젝트/브랜치 단위 활성화

```
프로젝트 설정:
  activeSkills: ["claude-api", "supabase"]
    → 해당 프로젝트의 모든 대화에서 이 스킬이 context로 주입됨

브랜치 오버라이드:
  branch "task-1-impl":
    activeSkills: ["claude-api", "supabase", "pdf"]
    → 이 브랜치에서만 pdf 스킬 추가 활성화

대화 수준:
  사용자가 "PDF 만들어줘" 입력
    → tunaChat이 관련 스킬 추천 ("pdf 스킬 활성화할까요?")
    → 활성화 → 다음 메시지부터 스킬 content가 프롬프트에 주입
```

### 스킬 로딩 흐름

```
chat.send 호출
  → conversation.activeSkills 확인
    → 프로젝트 레벨 + 브랜치 레벨 병합
  → 각 스킬의 SKILL.md frontmatter + body 로드
  → body를 system prompt에 context로 추가
    (agent system prompt + skill content + user prompt)
  → sidecar에 전달
```

### 스킬 저장 위치

```
스킬 라이브러리 (글로벌):
  ~/.tunachat/skills/          ← 사용자 홈
    ├─ skills-anthropic/
    ├─ skills-openai/
    └─ skills-vercel/

프로젝트 로컬 스킬:
  <project>/.tunachat/skills/  ← 프로젝트별 커스텀 스킬
```

### 로딩 우선순위

1. 브랜치 activeSkills (가장 높음)
2. 프로젝트 activeSkills
3. 프로젝트 로컬 `.tunachat/skills/`
4. 글로벌 `~/.tunachat/skills/`

### DB 스키마

```sql
-- conversations 테이블에 추가 (v6 마이그레이션)
ALTER TABLE conversations ADD COLUMN active_skills TEXT DEFAULT '[]';  -- JSON array
-- projects 테이블에 추가
ALTER TABLE projects ADD COLUMN active_skills TEXT DEFAULT '[]';       -- JSON array
```

### 에이전트 파일 vs 스킬

| | 에이전트 (docs/agents/*.md) | 스킬 (~/.tunachat/skills/) |
|---|---|---|
| **역할** | 에이전트의 정체성 + 도구 권한 | 도메인 지식 |
| **적용 단위** | 대화 persona | 프로젝트/브랜치 activeSkills |
| **내용** | system prompt + RBAC | API 참조, 패턴, 가이드 |
| **주입 방식** | `--append-system-prompt` | context prefix |
| **출처** | 사용자 정의 | 공식 스킬 팩 (Anthropic, OpenAI 등) |

---

## 5. 프로젝트 자동 발견

### 워크스페이스 루트

앱 최초 실행 또는 설정에서 **워크스페이스 루트 폴더** 선택.

### 1단계 하부 폴더 스캔

```
workspace_root: D:\privateProject\
  ├─ tunaChat/     → .git ✓, .claude/ ✓ → type: "project"
  ├─ tunaDish/     → .git ✓, .claude/ ✓ → type: "project"
  ├─ rawq/         → .git ✓, .claude/ ✗ → type: "discovered"
  ├─ my-notes/     → .git ✗           → 무시
  └─ temp-session/ → .claude/ ✓        → type: "chat"
```

### 분류 기준

| 조건 | type |
|------|------|
| `.git/` + 에이전트 세션 (`.claude/`, `.gemini/`, `.codex-cli/`) | **project** |
| `.git/`만 | **discovered** |
| 에이전트 세션만 | **chat** |
| 둘 다 없음 | 무시 |

### 구현 위치

| 기능 | 위치 | 이유 |
|------|------|------|
| 워크스페이스 폴더 선택 | Rust (Tauri dialog) | 네이티브 OS 다이얼로그 |
| 하부 폴더 스캔 + 분류 | Rust (`scan_workspace` command) | fs 접근 빠름 |
| git 상태 확인 | Rust (`Command::new("git")`) | 직접 실행 |
| 결과 저장 | SQLite `projects` 테이블 | 기존 인프라 활용 |

---

## 6. git 브랜치 연동

tunaDish `feature-ideas.md` 기획:

| 사용자 행동 | git 동작 |
|-----------|---------|
| 대화 브랜치 생성 | `git checkout -b feat/<label>` |
| 코드 변경 (developer) | `git add + commit` |
| 브랜치 채택 (adopt) | `git merge` |
| 브랜치 삭제 | `git branch -d` |

원칙: **사용자에게 git 명령 노출 안 함**
worktree 사용 안 함 — 같은 working directory에서 branch 전환만.

---

## 7. 토큰 추적

| 엔진 | USD | 토큰 |
|------|:---:|:---:|
| Claude | ✓ `total_cost_usd` | ✓ input/output/cache |
| Gemini | ✗ | ✓ total/input/output |
| Codex | ✗ | ✓ input/output |

→ **토큰 기반 추적이 현실적**. USD는 Claude만 가능.

저장: `conversations` 테이블에 `total_input_tokens`, `total_output_tokens` 누적.

---

## 8. DB 스키마 확장 (v5)

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  branch_id       TEXT,
  type            TEXT NOT NULL,  -- 'plan' | 'task_brief' | 'diff' | 'test_report'
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  status          TEXT DEFAULT 'draft',  -- 'draft' | 'approved' | 'rejected'
  metadata        TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_artifact_conv ON artifacts(conversation_id);

-- 토큰 추적 (conversations에 추가)
ALTER TABLE conversations ADD COLUMN total_input_tokens INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN total_output_tokens INTEGER DEFAULT 0;

-- 워크스페이스 루트 (앱 설정)
ALTER TABLE projects ADD COLUMN workspace_root TEXT;
```

---

## 9. MVP 계획

### MVP-1 (기본)
- [ ] 워크스페이스 루트 설정 + 프로젝트 자동 발견 (Rust)
- [ ] agent 파일 로딩 (docs/agents/*.md → frontmatter 파싱 → persona 적용)
- [ ] sidecar: persona system prompt 주입 + allowed_tools RBAC
- [ ] 토큰 추적 (completed 이벤트 usage → 대화별 누적)
- [ ] `!project set` / `!project scan` 커맨드

### MVP-2
- [ ] **스킬 시스템**: 글로벌 스킬 라이브러리 스캔 (`~/.tunachat/skills/`)
- [ ] **스킬 시스템**: 프로젝트/브랜치 단위 activeSkills 설정 (DB v6)
- [ ] **스킬 시스템**: SKILL.md frontmatter 파싱 → 매칭 → context prefix 주입
- [ ] **스킬 시스템**: `!skill list`, `!skill add <name>`, `!skill remove <name>` 커맨드
- [ ] architect → developer 위임 (Task Brief 자동 생성 → 브랜치 생성)
- [ ] 사용자 승인 게이트 UI (Plan Approve / Merge Gate 버튼)
- [ ] 대화 브랜치 ↔ git branch 자동 연동
- [ ] 아티팩트 테이블 활용 (v5 마이그레이션에 이미 생성됨)

### MVP-3 (고급 — 선택적)
- [ ] 자동 리뷰 에이전트 (code-reviewer, 다른 모델)
- [ ] diff-summarizer 자동 호출
- [ ] long-running session resume
- [ ] Budget governor (토큰 기반)
