# Affisto — Project Bootstrap Prompt

아래 프롬프트를 새 세션에 붙여넣으세요.

---

## Prompt

```
# Affisto — AI Worker Platform

## 제품 비전

"24/7 AI 직원을 할당받아 Slack/Telegram/Discord에 초대하고, 스킬을 가르쳐서 일을 시키는 플랫폼"

누구나 쉽게 AI 에이전트를 만들고, 스킬을 설치하고, 채널에 초대해서 운영할 수 있는 오픈소스 플랫폼.
도메인: affisto (확보 완료)

## 핵심 요구사항

### 1. 컨테이너 격리 환경
- 각 에이전트는 독립된 Docker 컨테이너에서 실행
- 에이전트 간 격리 (하나가 죽어도 다른 건 안전)
- 파일시스템 격리, 네트워크 격리
- 나중에 호스트 macOS 화면 조작도 확장 가능하도록 설계

### 2. 멀티 LLM 프로바이더
- Claude (OAuth 토큰 / API 키)
- OpenAI Codex (토큰 / API 키)
- Gemini (API 키)
- 로컬 LLM (Ollama)
- 인증 방식: OAuth 토큰 우선, API 키도 선택 가능
- 에이전트별로 다른 LLM 사용 가능

### 3. 멀티 채널 메시징
- Slack (에이전트를 워크스페이스에 초대)
- Telegram (봇)
- Discord (봇)
- 웹 UI (관리 콘솔)

### 4. 스킬 시스템
- 에이전트에 스킬을 설치해서 능력 부여
- 스킬 마켓/레지스트리에서 선택 설치
- 커스텀 스킬 작성 가능
- 예시 스킬: CloudWatch 로그 모니터링, Slack 참여, 웹 페이지 생성, 이메일 작성 등

### 5. 공유 리소스 DB + 웹 렌더러
- 하나의 머신에 공유 DB (SQLite or PostgreSQL)
- 에이전트가 DB에 HTML/템플릿+데이터를 저장
- 웹 렌더러가 이를 서빙 (브라우저에서 접근 가능)
- 에이전트가 웹 페이지를 직접 생성/업데이트 가능

스키마 개요:
  pages: id, slug, title, agent_id, html, template, data(JSON), render_mode('html'|'template'), auto_refresh_sec, timestamps
  shared_resources: key, value(JSON), agent_id, updated_at

### 6. 관리 웹 UI
- 에이전트 생성/관리
- 스킬 설치/제거
- 가르치기 (CLAUDE.md 에디터, 지식 업로드)
- 대시보드 (에이전트 상태, 에이전트가 생성한 페이지 목록)

### 7. CLI
- affisto init — Docker 확인, DB 초기화
- affisto create "name" --llm claude — 에이전트 생성
- affisto teach name ./knowledge.md — 가르치기
- affisto skill install cloudwatch --agent name — 스킬 설치
- affisto invite name --slack #channel — 채널 초대
- affisto web — 관리 콘솔 시작

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│  Web UI (관리 콘솔, Next.js)                     │
│  - 에이전트 할당/관리                            │
│  - 스킬 마켓플레이스                             │
│  - 대시보드 (에이전트 생성 페이지 보기)          │
│  - 가르치기 (CLAUDE.md 에디터)                   │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│  Agent Runtime (컨테이너 격리)                   │
│  ┌────────┐ ┌────────┐ ┌────────┐               │
│  │Agent A │ │Agent B │ │Agent C │               │
│  │Claude  │ │Codex   │ │Gemini  │               │
│  │스킬:   │ │스킬:   │ │스킬:   │               │
│  │로그감시│ │코드리뷰│ │리서치  │               │
│  └───┬────┘ └───┬────┘ └───┬────┘               │
│      │          │          │                     │
│  ┌───▼──────────▼──────────▼───┐                 │
│  │    Shared Resource DB        │                 │
│  │    (페이지, 공유 데이터)     │                 │
│  └──────────────┬──────────────┘                 │
│                 ▼                                 │
│  ┌─────────────────────────────┐                 │
│  │  Web Renderer (port 80)     │                 │
│  │  slug 기반 라우팅            │                 │
│  │  템플릿 + data → HTML 렌더  │                 │
│  └─────────────────────────────┘                 │
└──────────────────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
  Slack     Telegram    Discord
```

## 프로젝트 구조 (예상)

```
affisto/
├── runtime/              # 에이전트 컨테이너 관리
│   ├── container.ts      # Docker 추상화
│   ├── agent.ts          # 에이전트 생명주기
│   └── llm-router.ts     # 멀티 LLM 라우팅
│
├── skills/               # 스킬 시스템
│   ├── registry.ts       # 스킬 목록/설치
│   └── built-in/         # 기본 스킬
│       ├── cloudwatch/   # AWS 로그 모니터링
│       ├── slack/        # Slack 참여
│       ├── telegram/     # Telegram 봇
│       ├── discord/      # Discord 봇
│       └── web-page/     # 웹 페이지 생성
│
├── shared-db/            # 공유 리소스 DB
│   ├── schema.sql        # pages, shared_resources 테이블
│   └── renderer.ts       # 웹 렌더러
│
├── web/                  # 관리 콘솔 (Next.js)
│   ├── dashboard/
│   ├── agents/
│   ├── skills/
│   └── teach/
│
├── channels/             # 채널 통합
│   ├── slack.ts
│   ├── telegram.ts
│   └── discord.ts
│
└── cli/                  # CLI (affisto 명령어)
    └── index.ts
```

## 참고한 기존 프로젝트

- NanoClaw (25K stars) — 컨테이너 격리, 스킬 기반 확장, Telegram/Slack 지원
- ClaudeClaw (93 stars) — Telegram 봇, 에이전트 시스템, launchd 서비스
- 둘 다 Claude Code에 종속되어 있어서 멀티 LLM 미지원 → Affisto는 처음부터 멀티 프로바이더 설계

## 타겟 환경

- 초기 배포: 완전 초기화된 Mac Mini (Apple Silicon, macOS)
- Docker Desktop 사용
- 셀프호스트 우선, 나중에 클라우드 호스팅도 고려

## 미결 사항 (이 세션에서 결정 필요)

1. 첫 타겟 — 본인만? 처음부터 다른 사람도 쓸 수 있게?
2. 호스팅 — 셀프호스트 only? 중앙 서버에서 에이전트 할당?
3. 과금 — 무료 오픈소스? 호스팅 서비스로 과금?
4. 첫 번째 스킬 — CloudWatch 로그 모니터링?
5. 기술 스택 확정 — TypeScript? Go? 혼합?
6. MVP 범위 — 어디까지 만들어야 "사용 가능"한가?

이 질문들에 답변한 후 MVP 구현을 시작해줘.
```
```

---

이 프롬프트를 새 세션(affisto 레포 위치)에서 붙여넣으면 바로 이어서 진행할 수 있습니다.

`log-watcher/AFFISTO_PROMPT.md`에 저장했습니다. 새 세션에서 미결 사항 6개에 답하면 바로 MVP 구현으로 넘어갑니다.