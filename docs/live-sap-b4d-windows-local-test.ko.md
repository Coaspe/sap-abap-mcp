# Windows 로컬 clone 기반 B4D 실서버 테스트 실행서

이 문서는 `codex/v1-read-only-slice` 브랜치의 로컬 빌드를 Windows에서
실행하여 SAP profile `B4D`를 검증하는 절차와 복사형 테스트 프롬프트를
제공한다.

## 현재 구현 범위

- 옵션 없는 `serve`: callable v1 도구 115개와 Resource 7개
- `--api-version v0`: 하위 호환용 기존 53개 도구
- `--toolsets core,analysis` 같은 명시적 선택은 schema 수를 줄여야 하는
  host에서만 사용하며, 생략 시 기본값은 `all`이다.
- v1의 각 target은 실제 handler, input/output schema와 자동 호출 테스트를
  가지며 catalog 이름만 선언된 상태를 구현으로 세지 않는다.

따라서 실서버 테스트는 세션을 분리한다.

1. 기본 v1 세션: 115개 v1 도구와 7개 Resource surface를 확인하고,
   mutation은 이 실행이 직접 만든 SAP local package `$TMP` 객체로만 제한한다.
2. 선택적 v0 세션: `--api-version v0`로 53개 하위 호환 기능을 회귀 검증한다.

기본 v1과 legacy v0 연결을 한 LLM 세션에 동시에 등록하지 않는다. 중복 capability,
잘못된 tool 선택, schema token 증가를 피하기 위해 같은 MCP 이름을 제거하고
다음 모드로 다시 등록한다.

## 1. 브랜치를 Windows로 가져오기

이 branch의 완료 commit이 remote에 push된 뒤 아래 명령으로 clone한다.

### 방법 A — 브랜치를 사용자가 remote에 push한 경우

```powershell
git clone --branch codex/v1-read-only-slice --single-branch https://github.com/Coaspe/sap-abap-mcp.git C:\src\sap-abap-mcp-v1
Set-Location C:\src\sap-abap-mcp-v1
```

### 방법 B — remote에 push하지 않고 Git bundle을 전달하는 경우

브랜치가 있는 원본 머신의 repository에서 bundle을 만든다.

```bash
git bundle create sap-abap-mcp-v1.bundle codex/v1-read-only-slice
git bundle verify sap-abap-mcp-v1.bundle
```

회사 승인 경로로 bundle을 Windows에 전달한 후 clone한다.

```powershell
git clone --branch codex/v1-read-only-slice C:\Transfer\sap-abap-mcp-v1.bundle C:\src\sap-abap-mcp-v1
Set-Location C:\src\sap-abap-mcp-v1
```

## 2. Windows clone 업데이트

pull 전에 현재 브랜치와 local 변경을 확인한다.

```powershell
Set-Location C:\src\sap-abap-mcp-v1
git branch --show-current
git status --short
```

브랜치는 `codex/v1-read-only-slice`여야 한다. `git status --short`에 직접
수정한 파일이 표시되면 덮어쓰거나 삭제하지 말고 먼저 별도 commit 또는
stash로 보존한다.

### remote branch에서 clone한 경우

```powershell
git switch codex/v1-read-only-slice
git pull --ff-only origin codex/v1-read-only-slice
git log -1 --oneline
npm.cmd ci
npm.cmd run build
npm.cmd test
```

`--ff-only`가 실패하면 강제 reset하지 않는다. local commit 또는 remote
history가 갈라진 상태이므로 pull을 중단하고 이력을 먼저 검토한다.

### Git bundle에서 clone한 경우

원본 머신에서 같은 명령으로 최신 bundle을 다시 만들고 Windows의 새 파일로
전달한다.

```bash
git bundle create sap-abap-mcp-v1-update.bundle codex/v1-read-only-slice
git bundle verify sap-abap-mcp-v1-update.bundle
```

Windows clone에서 새 bundle의 branch를 가져온 후 fast-forward만 허용한다.

```powershell
Set-Location C:\src\sap-abap-mcp-v1
git switch codex/v1-read-only-slice
git status --short
git fetch C:\Transfer\sap-abap-mcp-v1-update.bundle codex/v1-read-only-slice
git merge --ff-only FETCH_HEAD
git log -1 --oneline
npm.cmd ci
npm.cmd run build
npm.cmd test
```

업데이트 후 이미 실행 중인 MCP process는 자동 교체되지 않는다. Codex 또는
Claude Code를 완전히 종료하고 다시 시작하여 새 `dist`를 실행한다.

## 3. Windows에서 로컬 소스 빌드

Node.js 20 이상과 Git이 설치되어 있어야 한다.

```powershell
node --version
npm.cmd ci
npm.cmd run build
npm.cmd test
git rev-parse HEAD
```

실제 테스트 보고서에는 실행한 exact `git rev-parse HEAD`를 기록하고 remote
branch의 HEAD와 같은지 확인한다.

## 4. 이미 설정된 B4D profile 검증

profile과 DPAPI credential은 Git repository 안에 있지 않다. setup을 수행한
동일한 Windows 사용자와 동일한 머신에서 Codex 또는 Claude를 실행해야 한다.

먼저 공개 CLI와 로컬 빌드 양쪽에서 상태를 확인한다. password, token 또는
SAP URL을 채팅이나 명령 인자에 넣지 않는다.

```powershell
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest auth status B4D
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor B4D --include-components
node .\dist\src\index.js profile list
node .\dist\src\index.js auth status B4D
node .\dist\src\index.js doctor B4D --include-components
```

다음을 모두 확인한다.

- `B4D`가 정확한 Server name이다.
- `doctor` 결과가 `ok: true`다.
- environment가 `production`이면 mutation 세션을 실행하지 않는다.
- `allowedPackages`가 비어 있으면 전체 package가 허용된 상태다.
- `allowedPackages`가 비어 있지 않으면 literal `$TMP`가 포함되어야 mutation
  세션을 실행할 수 있다.

`/mcp`가 connected인 것만으로 SAP 인증 성공으로 판정하지 않는다.

## 5. Codex MCP 연결

아래 예시는 MCP 이름을 `sap-abap-b4d-local` 하나로 고정한다. 모드를 바꿀
때는 기존 연결을 제거하고 새 세션에서 다시 등록한다.

### 기본 v1 전체 세션

```powershell
codex mcp remove sap-abap-b4d-local
codex mcp add sap-abap-b4d-local -- node "C:\src\sap-abap-mcp-v1\dist\src\index.js" serve --profile B4D
codex mcp list
```

`remove`가 서버 없음 오류를 내면 처음 한 번은 무시할 수 있다. Codex를
재시작한 뒤 `/mcp`에서 프로세스 연결을 확인한다. 이 모드의 기대 surface는
v1 도구 115개와 Resource 7개다.

### v0 53개 및 `$TMP` mutation 세션

```powershell
codex mcp remove sap-abap-b4d-local
codex mcp add sap-abap-b4d-local -- node "C:\src\sap-abap-mcp-v1\dist\src\index.js" serve --profile B4D --api-version v0
codex mcp list
```

Codex를 완전히 재시작한다. 이 모드의 기대 surface는 v0 도구 53개다.

## 6. Claude Code MCP 연결

Codex 대신 Claude Code를 사용하면 같은 로컬 Node command를 등록한다.

### 기본 v1 전체 세션

```powershell
claude mcp remove sap-abap-b4d-local
claude mcp add --transport stdio --scope user sap-abap-b4d-local -- node "C:\src\sap-abap-mcp-v1\dist\src\index.js" serve --profile B4D
claude mcp get sap-abap-b4d-local
claude mcp list
```

### v0 53개 및 `$TMP` mutation 세션

```powershell
claude mcp remove sap-abap-b4d-local
claude mcp add --transport stdio --scope user sap-abap-b4d-local -- node "C:\src\sap-abap-mcp-v1\dist\src\index.js" serve --profile B4D --api-version v0
claude mcp get sap-abap-b4d-local
```

등록 후 Claude Code를 재시작한다.

### `Failed to connect` 진단

`claude mcp list`가 `Failed to connect`를 표시하면 SAP mutation을 시작하지
말고 아래 순서로 실패 층을 분리한다.

```powershell
Set-Location C:\src\sap-abap-mcp-v1
node --version
git rev-parse HEAD
Test-Path .\dist\src\index.js
node .\dist\src\index.js profile list
node .\dist\src\index.js doctor B4D --include-components
node .\scripts\smoke-v1-stdio.mjs
```

기대 결과는 Node.js 20 이상, `Test-Path`의 `True`, `doctor`의 `ok: true`,
그리고 smoke의 `115 v1 tools, 7 Resources`다. smoke가 실패하면 Claude
등록 문제가 아니라 clone/build/runtime 문제다. `npm.cmd ci`와
`npm.cmd run build`를 다시 실행하고 첫 오류를 해결한다.

smoke가 통과하면 Claude에 저장된 command와 arguments를 확인한다.

```powershell
claude mcp get sap-abap-b4d-local
claude mcp remove sap-abap-b4d-local
claude mcp add --transport stdio --scope user sap-abap-b4d-local -- node "C:\src\sap-abap-mcp-v1\dist\src\index.js" serve --profile B4D
claude mcp get sap-abap-b4d-local
claude mcp list
```

저장된 command는 `node`, 첫 인수는 존재하는 절대 `index.js` 경로여야 한다.
상대 경로는 Claude를 시작한 directory에 따라 달라지므로 사용하지 않는다.
그래도 실패하면 새 PowerShell에서 아래처럼 MCP debug log를 켠 뒤 `/mcp`를
열어 `sap-abap-b4d-local`의 stderr 첫 오류를 확인한다.

```powershell
claude --debug mcp
```

[Claude Code MCP 공식 문서](https://code.claude.com/docs/en/mcp)는 stdio 등록
옵션을 server name 앞에 두고 `--` 뒤에 실제 command/arguments를 두도록
규정한다. [configuration debug 공식 문서](https://code.claude.com/docs/en/debug-your-config)는
실패 서버의 stderr 확인에 `claude --debug mcp`를 안내한다.

## 7. 프롬프트 A — 현재 v1 실서버 검증

115개 전 행과 엄격한 RUN_OWNED `$TMP` mutation까지 한 세션에서 검증하려면
[`live-sap-v1-115-tool-tmp-test-prompt.ko.md`](live-sap-v1-115-tool-tmp-test-prompt.ko.md)의
복사형 프롬프트를 사용한다. 아래 Prompt A는 mutation 전에 연결과 read-only
surface만 빠르게 확인할 때 사용한다.

v1 모드로 연결한 새 세션의 repository root에서 아래 블록을 그대로 붙여
넣는다.

~~~~text
너는 SAP ABAP MCP v1 실서버 acceptance test lead다.

고정 조건:
- repository의 exact HEAD를 `git rev-parse HEAD`로 읽어 보고서에 기록한다.
- MCP profile/system은 오직 `B4D`다.
- 연결 모드는 옵션 없는 `serve --profile B4D`, 즉 v1 전체 기본값이다.
- SAP mutation, execution, debugger, trace, transaction launch, SQL, transport,
  Git, RAP mutation을 모두 금지한다.
- SAP package `$TMP`를 포함한 어떤 SAP 객체도 생성·수정·활성화·삭제하지
  않는다.
- local filesystem을 변경하지 않는다.
- credential, SAP URL, username, cookie, token, CSRF 또는 session 값을
  출력하거나 사용자에게 요청하지 않는다.

먼저 MCP discovery를 실제로 확인하라. `docs/v1-parity-matrix.md`의 115개
v1 target과 실제 광고 이름을 exact set으로 비교한다. toolset별 기대 수는
core 20, write 24, analysis 30, debug 10, operations 24, artifacts 7이다.
v0 이름이 하나라도 있거나 총수가 115개보다 많거나 적으면 live call을
시작하지 말고 `SURFACE-FAIL`로 종료하라. 모든 tool은 input/output schema와
네 annotation 필드를 가져야 하고, write/control annotation을 read-only로
오인하지 않는다.

Resource API가 host에 노출되면 아래 registry name 7개를 exact set으로
확인하라.

- sap-adt-source
- sap-capability-evidence
- sap-docs-compat
- sap-docs-data-query
- sap-docs-mermaid
- sap-evidence
- sap-transport

host가 raw Resource API를 제공하지 않으면 성공으로 추측하지 말고
`SKIP-HOST-CAPABILITY`로 기록한다.

다음 순서로 실제 호출한다.

1. sap.system.list를 호출하고 B4D가 정확히 한 번 존재하며 credentialAvailable
   true인지 확인한다. 다른 system은 호출하지 않는다.
2. sap.system.inspect를 B4D/includeComponents false와 true로 각각 호출한다.
3. sap.system.capabilities를 includeEvidence false와 true로 각각 호출하고,
   가능하면 7개 category filter도 한 번씩 검증한다.
4. sap.repository.search로 CL_ABAP_CHAR_UTILITIES/CLAS를 최대 20개 검색한다.
   없으면 CL_ABAP*, 그래도 없으면 Z*를 사용한다. 실제로 읽을 수 있는 첫
   class 하나를 read-only fixture로 선택하고 절대로 변경하지 않는다.
5. 선택한 class를 sap.source.read로 1행부터 최대 50행 읽는다. truncated면
   nextLine으로 다음 page를 한 번만 읽고 range가 겹치지 않는지 확인한다.
6. 실제 반환된 capability/source Resource URI만 사용해 resources/read를
   검증한다. URI를 직접 조립하지 않는다.
7. local validation 오류는 sap.system.inspect에 systemId `B4D/INVALID`를
   한 번 전달하는 경우만 허용한다. SAP object 이름을 추측해 오류를 만들지
   않는다.

모든 성공 tool result에서 다음을 검증한다.

- content[0].text JSON과 structuredContent의 의미상 동일성
- schemaVersion `1.0`
- 중복 없는 non-empty requestId
- status succeeded 또는 partial
- warnings 배열
- 반환 systemId가 있으면 B4D
- URL, profileId, username, credential 또는 raw connectionId 비노출

최종 보고서는 한국어로 작성한다.

1. Verdict: PASS-READ-ONLY | PARTIAL | SURFACE-FAIL | FAIL | STOP-SAFETY
2. source commit과 실행 조건
3. expected 115/advertised/missing/extra/duplicate tool 수와 toolset별 수
4. expected 7 Resource discovery/read/completion 검증 결과
5. 민감정보를 제거한 B4D environment/client/release/system type
6. tool별 calls/schema/envelope/resource link/status 표
7. skip/failure와 재현 조건
8. 안전 확인: B4D 외 호출 0, SAP mutation 0, `$TMP` 접근 0,
   local filesystem 변경 0

실제 검증하지 못한 항목이 하나라도 있으면 PASS-READ-ONLY라고 말하지 마라.
~~~~

## 8. 프롬프트 B — v0 53개와 `$TMP` 격리 mutation 검증

v0 모드로 다시 연결한 **새 세션**에서 아래 블록을 붙여 넣는다. 이 프롬프트는
repository에 포함된 상세 53-tool acceptance prompt를 실행 계약으로 사용한다.

~~~~text
너는 SAP ABAP MCP B4D 실서버 acceptance controller다.

## 고정 조건

- 현재 MCP는 local clone의 `dist/src/index.js`를 profile B4D,
  `--api-version v0`를 명시해 실행해야 한다.
- 먼저 `git rev-parse HEAD`를 기록한다.
- `docs/live-sap-53-tool-test-prompts.ko.md`를 읽고, 그 문서의 프롬프트 1과
  프롬프트 2를 이 지시와 함께 완전한 실행 계약으로 사용한다.
- 사용자가 제공해야 하는 SAP 값은 없다. B4D profile은 이미 설정되어 있다.
- credential, URL, SAP username 또는 password를 요청하거나 출력하지 않는다.

## Surface gate

1. SAP call 전에 advertised MCP tool 이름을 실제로 집계한다.
2. 문서에 적힌 v0 53개와 정확히 일치해야 한다.
3. v1 `sap.*` 이름이 보이거나 총수가 53이 아니면 즉시 SURFACE-FAIL로
   종료한다.
4. 프롬프트 1의 read-only/safe-action 단계가 PASS 또는 허용 가능한 PARTIAL로
   끝나기 전에는 프롬프트 2를 시작하지 않는다.

## `$TMP` 절대 안전 경계

1. 모든 SAP 호출은 B4D만 사용한다. 다른 system은 발견해도 호출하지 않는다.
2. B4D environment가 production이면 mutation을 시작하지 않는다.
3. non-empty allowedPackages가 literal `$TMP`를 허용하지 않으면 mutation을
   시작하지 않는다.
4. RUN_ID는 `[A-Z0-9]` 6자리로 자동 생성한다.
5. 새 객체 이름에는 `MCP_TEST`와 RUN_ID가 모두 포함되어야 하고 package는
   literal `$TMP`여야 한다.
6. 첫 write 전에 exact-name 및 RUN_ID pattern 검색 결과가 0건이어야 한다.
   충돌 객체를 재사용·수정·삭제하지 말고 새 RUN_ID로 최대 세 번 재시도한다.
7. transport parameter는 모든 `$TMP` create/write payload에서 생략한다.
   transport가 요구되거나 응답에 transport가 연결되면 STOP-SAFETY다.
8. create 성공 receipt와 즉시 read-back으로 B4D, exact name/type/URI,
   package `$TMP`가 확인된 객체만 mutation manifest에
   `createdByThisRun: true`로 등록한다.
9. manifest-owned 객체가 아니면 이름이 test pattern과 일치해도 절대로
   수정·실행·rename·restore·delete하지 않는다.
10. 모든 mutation 직전에 현재 identity와 package `$TMP`를 다시 읽어
    확인한다.
11. 프롬프트 2의 첫 write 직전 생성/변경/실행/cleanup 계획을 보여주고
    사용자에게 정확히 `START-MUTATION <RUN_ID>` 승인을 요청한다. 이 문구를
    받기 전에는 write를 호출하지 않는다.
12. Transport/Git mutation, cross-system compare, trace/heartbeat mutation,
    transaction launch, RAP publish는 실행하지 않는다.
13. Windows local artifact가 필요하면
    `%TEMP%\sap-abap-mcp-b4d-<RUN_ID>` 안에서만 생성하고 별도 manifest로
    기록한다. repository 또는 기존 파일을 수정·삭제하지 않는다.

## 실행

1. 상세 문서의 프롬프트 1을 실행해 53개 inventory와 가능한 read/list/status/
   validate/preview action을 검증한다.
2. 안전 gate를 모두 통과한 경우에만 상세 문서의 프롬프트 2 계획을 만든다.
3. `START-MUTATION <RUN_ID>` 승인 후에만 manifest-owned `$TMP` fixture를
   create, source write, diagnostics, activation, unit/ATC, semantic,
   safe execution 및 지원되는 refactor 경로로 검증한다.
4. 성공·실패와 무관하게 finally 단계에서 현재 run의 receipt와 identity가
   모두 있는 runtime/object/local artifact만 역순 cleanup한다.
5. cleanup 후 exact-name와 RUN_ID wildcard 검색은 잔존 검증에만 사용한다.
   검색 결과를 새 삭제 대상으로 사용하지 않는다.
6. 잔존 객체나 소유권 불명 상태가 하나라도 있으면 기능 성공 여부와 무관하게
   FAIL-SAFETY로 판정하고 자동 삭제를 중단한다.

## 최종 보고서

한국어로 다음을 보고한다.

1. 기능 verdict와 cleanup verdict
2. source commit, B4D client/release/environment
3. 53/53 tool coverage와 N/150 variant ledger
4. RUN_ID와 sanitized mutation manifest
5. 각 객체의 create/read-back/mutation/delete receipt 존재 여부
6. `$TMP` 외 SAP mutation 0, transport 0, Git mutation 0,
   B4D 외 호출 0 증거
7. exact-name 및 wildcard cleanup residue 수
8. skip/unsupported/failure와 재현 조건

cleanup 증거가 없으면 PASS-LOCAL 또는 PASS-CORE라고 말하지 마라.
~~~~

## 9. 테스트 종료 후 MCP 정리

테스트가 끝났을 때 로컬 MCP 등록만 제거한다. 이 명령은 SAP profile이나
DPAPI credential을 삭제하지 않는다.

Codex:

```powershell
codex mcp remove sap-abap-b4d-local
```

Claude Code:

```powershell
claude mcp remove sap-abap-b4d-local
```

`setup remove B4D` 또는 `profile remove B4D`는 실행하지 않는다.
