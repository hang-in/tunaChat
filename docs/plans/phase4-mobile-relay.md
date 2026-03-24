# Phase 4 — 모바일 릴레이

## 개요

tunaChat 데스크탑 앱에 내장된 릴레이 서버를 통해
모바일(Android) 클라이언트가 PC의 CLI 에이전트를 원격으로 사용.

```
[PC] tunaChat (Tauri)
  ├─ Rust relay server (내장, 토글 On/Off)
  │   └─ WebSocket 중계 + 인증
  └─ Python sidecar (CLI 에이전트)

[Mobile] tunaChat Android
  └─ React UI (동일 코드베이스)
      └─ WS → PC relay → Python sidecar → CLI
```

## 아키텍처

### Rust Relay Server (`relay.rs`)

- `lib.rs`의 Tauri setup에서 토글 가능한 WS 서버
- 포트: 설정 가능 (기본 8800)
- 인증: 간단한 토큰 기반 (QR 코드로 페어링)
- 프로토콜: 기존 sidecar JSON Lines를 WS로 중계

### 통신 흐름

```
Mobile UI
  → WS connect (ws://PC_IP:8800?token=XXX)
    → Rust relay: 인증 확인
      → sidecar stdin에 JSON Lines 전달
        ← sidecar stdout 이벤트
      ← WS로 중계
    ← Mobile UI 업데이트
```

### 데이터 동기화

- 메시지: 릴레이 서버가 SQLite에 저장 (PC가 SSOT)
- 모바일은 세션 동안만 메시지 캐시 (영속화 없음)
- 히스토리 요청 시 PC SQLite에서 SELECT 후 WS로 전송

## 구현 계획

### Step 1: Rust WS 서버 기본
- [ ] Cargo.toml에 `tokio-tungstenite` 추가
- [ ] `relay.rs` 모듈 생성
- [ ] Tauri command: `relay_start(port)`, `relay_stop`, `relay_status`
- [ ] 설정 페이지에 릴레이 토글 UI

### Step 2: 인증
- [ ] 랜덤 토큰 생성 (앱 시작 시)
- [ ] QR 코드 생성 (IP + port + token)
- [ ] 연결 시 토큰 검증
- [ ] 연결된 클라이언트 목록 표시

### Step 3: 메시지 중계
- [ ] WS → sidecar stdin 변환
- [ ] sidecar stdout → WS 브로드캐스트
- [ ] 요청 ID 기반 라우팅 (다중 모바일 클라이언트)
- [ ] 히스토리 요청 처리 (SQLite SELECT → WS)

### Step 4: 모바일 UI 적응
- [ ] `tauriClient.ts`에 WS 모드 추가
  - Tauri 환경 → invoke (기존)
  - 브라우저 환경 → WS 클라이언트
- [ ] `MobileShell.tsx` 연결 UI
- [ ] Android 빌드 설정 (tauri.android.conf.json)

### Step 5: 안정성
- [ ] WS 재연결 로직
- [ ] 연결 끊김 시 UI 표시
- [ ] 배터리 최적화 (WS keepalive 간격)
- [ ] 네트워크 전환 처리

## 의존성

```toml
# Cargo.toml 추가
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.24"
```

## 보안 고려사항

- 토큰은 메모리에만 보관 (디스크 저장 안 함)
- 같은 LAN만 접근 가능 (0.0.0.0 바인딩하되 외부 포트 포워딩 미지원)
- HTTPS 없음 (LAN 전용이므로) → 향후 mTLS 고려 가능
- 토큰 만료: 앱 재시작 시 갱신

## UI 설계

### 데스크탑 설정 페이지

```
[릴레이] 탭
  ┌─────────────────────────────┐
  │ 모바일 릴레이    [● 활성화] │
  │                             │
  │ 주소: 192.168.0.10:8800     │
  │ [QR 코드 이미지]            │
  │                             │
  │ 연결된 기기: 1              │
  │  └ Galaxy S24 (3분 전)      │
  └─────────────────────────────┘
```

### 모바일 연결 화면

```
  ┌────────────────────┐
  │    🐟 tunaChat     │
  │                    │
  │  [QR 스캔으로 연결]│
  │  또는              │
  │  [주소 직접 입력]  │
  │                    │
  │  최근 서버         │
  │  • 192.168.0.10    │
  └────────────────────┘
```
