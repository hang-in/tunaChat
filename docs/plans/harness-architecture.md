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

tunaDish `feature-ideas.md` 기획 기반:

### 에이전트별 스킬 경로

| 에이전트 | 경로 | 포맷 |
|---------|------|------|
| Claude Code | `~/.claude/commands/` | Markdown |
| Codex CLI | `~/.codex/skills/` | SKILL.md + frontmatter |
| Gemini CLI | `~/.gemini/extensions/` | gemini-extension.json |
| rawq | `vendor/rawq/SKILL.md` | Markdown |

### 프로젝트/브랜치 단위 스킬

```
Project skills:
  .tunaChat/skills/      ← 프로젝트 로컬 스킬
  docs/agents/*.md       ← 에이전트 정의 (스킬의 확장 형태)

Branch-level override:
  브랜치 생성 시 사용할 스킬 선택 → Task Brief에 포함
```

### 로딩 우선순위

1. 브랜치 지정 스킬 (가장 높음)
2. 프로젝트 `.tunaChat/skills/`
3. 사용자 홈 디렉토리 (`~/.claude/commands/` 등)
4. 시스템 기본 (rawq SKILL.md)

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
- [ ] architect → developer 위임 (Task Brief 자동 생성 → 브랜치 생성)
- [ ] 사용자 승인 게이트 UI (Plan Approve / Merge Gate 버튼)
- [ ] 대화 브랜치 ↔ git branch 자동 연동
- [ ] 아티팩트 테이블 (v5 마이그레이션)
- [ ] 스킬 로딩 (프로젝트/브랜치 단위)

### MVP-3 (고급 — 선택적)
- [ ] 자동 리뷰 에이전트 (code-reviewer, 다른 모델)
- [ ] diff-summarizer 자동 호출
- [ ] long-running session resume
- [ ] Budget governor (토큰 기반)
