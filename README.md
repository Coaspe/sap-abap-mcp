# sap-abap-mcp

Codex나 Claude가 SAP ADT를 통해 ABAP 저장소를 읽고 수정하며 품질 검사와 운영 분석까지 수행하게 해 주는 로컬 MCP 서버입니다.

처음 한 번만 SAP 접속 정보를 등록하고 로그인하면 됩니다. 별도 서버, SAP GUI, VS Code, 수동 `serve` 실행은 필요하지 않습니다.

## 가장 쉬운 시작 방법

아래 설명은 **Windows에서 Codex 또는 Claude로 SAP 시스템 1개를 연결하는 경우**를 기준으로 합니다. 명령은 PowerShell에 한 줄씩 복사해서 실행하세요.

### 0. 먼저 준비할 것

SAP 관리자에게 아래 3가지만 받으세요.

| 필요한 값 | 예시 | 뜻 |
|---|---|---|
| SAP 주소 | `https://sap-dev.company.com` | SAP 서버의 HTTPS 기본 주소 |
| 클라이언트 번호 | `100` | 숫자 3자리 |
| 사용자명 | `DEV_USER` | SAP 로그인 ID |

이 사용자에게 ADT 개발 권한이 있고, SAP 서버에서 `/sap/bc/adt`와 Basic Auth를 사용할 수 있어야 합니다. 잘 모르겠다면 이 문장을 그대로 SAP 관리자에게 보여 주세요.

컴퓨터에는 다음 프로그램이 필요합니다.

- [Node.js](https://nodejs.org/en/download) 20 이상
- Codex 또는 Claude Code
- 회사 SAP에 접속하기 위한 사내망 또는 VPN

Node.js가 준비됐는지 확인합니다.

```powershell
node --version
```

`v20` 이상의 숫자가 나오면 준비 완료입니다. `node`를 찾을 수 없다는 메시지가 나오면 Node.js를 설치한 뒤 PowerShell을 다시 여세요.

### 1. SAP를 등록하세요

아래 명령에서 SAP 주소, 클라이언트 번호, 사용자명만 자신의 값으로 바꾸세요.

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile add DEV100 --url "https://sap-dev.company.com" --client 100 --username "DEV_USER"
```

`DEV100`은 이 SAP에 붙인 별명입니다. 그대로 사용해도 됩니다.

성공하면 화면에 `"id": "DEV100"`이 표시됩니다.

### 2. SAP에 로그인하세요

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth login DEV100
```

`SAP password:`가 나오면 SAP 암호를 입력하고 Enter를 누르세요. 입력하는 동안 글자가 보이지 않는 것이 정상입니다.

성공하면 `"credentialStored": true`가 표시됩니다.

### 3. 연결을 확인하세요

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 doctor DEV100
```

`"ok": true`가 나오면 SAP 연결은 끝났습니다.

### 4. Codex 또는 Claude에 연결하세요

둘 중 자신이 사용하는 프로그램 하나만 선택하면 됩니다.

#### Codex

```powershell
codex mcp add sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 serve --profile DEV100
```

등록됐는지 확인합니다.

```powershell
codex mcp list
```

목록에 `sap-abap`이 보이면 Codex를 다시 시작하세요. Codex 안에서 `/mcp`를 입력해 연결 상태를 볼 수도 있습니다.

`codex` 명령을 사용할 수 없다면 Codex 앱에서 직접 등록할 수 있습니다.

1. **Settings → MCP servers → Add server**를 엽니다.
2. 이름은 `sap-abap`, 종류는 **STDIO**를 선택합니다.
3. Command에는 `npx.cmd`를 입력합니다.
4. Arguments에는 아래 값을 순서대로 추가합니다.

```text
-y
@coaspe/sap-abap-mcp@0.2.0
serve
--profile
DEV100
```

5. 저장한 뒤 Codex를 다시 시작합니다.

#### Claude Code

```powershell
claude mcp add --transport stdio --scope user sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 serve --profile DEV100
```

등록됐는지 확인합니다.

```powershell
claude mcp get sap-abap
```

등록 정보가 나오면 Claude Code를 다시 시작하세요. Claude Code 안에서 `/mcp`를 입력해 연결 상태를 볼 수도 있습니다.

### 5. 이제 말로 요청하세요

Codex 또는 Claude에 다음처럼 물어보세요.

```text
DEV100에 연결됐는지 확인해줘.
DEV100에서 ZCL_DEMO 클래스를 찾아줘.
ZCL_DEMO의 RUN 메서드 소스를 읽고 쉽게 설명해줘.
```

여기까지가 전부입니다. MCP 서버는 Codex나 Claude가 필요할 때 자동으로 실행하므로 사용자가 `serve` 명령을 직접 실행할 필요가 없습니다.

## 막혔을 때

| 화면에 보이는 문제 | 먼저 해 볼 것 |
|---|---|
| `node`를 찾을 수 없음 | Node.js 20 이상을 설치하고 PowerShell을 다시 엽니다. |
| npm 패키지를 내려받지 못함 | 인터넷, 회사 프록시, npm registry 접근 여부를 확인합니다. |
| `PROFILE_NOT_FOUND` | 1단계의 `profile add` 명령을 다시 실행합니다. |
| 로그인이 실패함 | SAP 주소, 클라이언트 번호, 사용자명, 암호가 맞는지 확인합니다. |
| `doctor`가 인증서 또는 연결 오류를 표시함 | VPN 연결 후 다시 시도하고, 계속 실패하면 사내 CA·프록시·ADT 활성화 여부를 SAP 관리자에게 문의합니다. |
| Codex 또는 Claude에서 도구가 보이지 않음 | `/mcp`에서 연결 상태를 확인하고 프로그램을 완전히 종료했다가 다시 실행합니다. |

현재 인증 방식은 Basic Auth입니다. 회사 SAP가 SSO나 MFA만 허용한다면 현재 버전으로는 로그인할 수 없으므로 SAP 관리자에게 Basic Auth 사용 가능 여부를 확인하세요.

## macOS에서 사용하기

위 명령의 `npx.cmd`를 모두 `npx`로 바꾸면 됩니다. Codex 등록 명령은 다음과 같습니다.

```bash
codex mcp add sap-abap -- npx -y @coaspe/sap-abap-mcp@0.2.0 serve --profile DEV100
```

## macOS에서 Claude Code 사용하기

macOS에서는 다음 명령으로 등록합니다.

```bash
claude mcp add --transport stdio --scope user sap-abap -- npx -y @coaspe/sap-abap-mcp@0.2.0 serve --profile DEV100
```

등록 확인:

```bash
claude mcp get sap-abap
```

## SAP 시스템이 여러 개인 경우

각 SAP에 서로 다른 별명을 붙여 1~3단계를 반복합니다. 예를 들어 개발기는 `DEV100`, 품질기는 `QAS200`, 운영기는 `PRD100`으로 등록할 수 있습니다.

여러 SAP를 하나의 MCP에서 함께 사용하려면 기존 등록을 지우고 `--profile DEV100` 없이 다시 등록하세요.

```powershell
codex mcp remove sap-abap
codex mcp add sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 serve
```

Windows 다중 시스템 설정과 운영 시 주의사항은 [상세 가이드](docs/localhost-mcp-end-to-end.md)를 참고하세요.

## 암호는 어디에 저장되나요?

- macOS: Keychain
- Windows: 현재 사용자만 복호화할 수 있는 DPAPI 암호화 파일

프로필 파일에는 SAP 주소, 클라이언트 번호, 사용자명만 저장되며 암호는 저장하지 않습니다.

로그인 상태 확인과 삭제:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth status DEV100
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth logout DEV100
```

## 현재 저장소에서 할 수 있는 일

현재 소스는 ABAP FS 2.6.5의 MCP 도구 42개를 모두 구현합니다.

- 연결·discovery 3개: 시스템 목록/정보, ADT discovery export
- 저장소 읽기·탐색 10개: 객체/소스 검색, 구간·배치 읽기, where-used, URL/URI 탐색
- 저장소 쓰기 6개: 객체·테스트 include 생성, 정확 일치 소스 교체, 진단, 활성화, 텍스트 요소
- 품질·수명주기 6개: ABAP Unit, ATC, 전송 요청, 버전 이력, 다운로드
- 데이터·참조 3개: read-only SQL, SQL 문법, 호환성 문서 검색
- 런타임 운영 9개: 디버거, dump/trace 분석, heartbeat
- 산출물 5개: Mermaid 검증·문서·HTML viewer, DOCX 테스트 문서

쓰기 안전 정책은 다음과 같습니다.

- `production` 프로필에서는 저장소 쓰기를 거부합니다.
- `allowedPackages`에 없는 패키지는 수정하지 않습니다. 빈 목록은 쓰기 전면 금지입니다.
- `$TMP`가 아닌 패키지는 transport request가 필수입니다.
- 소스 교체는 현재 소스에서 정확히 한 곳만 일치해야 하며 lock → 재확인 → write → syntax check → 선택적 activate 순서를 사용합니다.
- SQL은 `SELECT`와 `WITH`만 허용합니다.

## 토큰 사용량이 많은 환경

`0.2.0`부터 MCP 응답은 compact JSON이며, 대형 소스·검색·SQL·ATC·dump·trace·transport·version 결과는 기본적으로 페이지 또는 요약을 반환합니다. 응답의 `nextStartIndex`, `nextLine`, `nextRowStart`를 다음 호출에 사용하면 전체 데이터를 이어서 읽을 수 있습니다. discovery와 대형 다운로드 목록은 로컬 파일로 내보낼 수 있습니다.

Claude Code는 기본 Tool Search를 사용할 수 있으므로 일반적으로 42개 전체를 등록하는 것이 편합니다. Tool Search가 없는 호스트에서 도구 스키마 토큰도 줄이려면 `--toolsets`를 사용하세요.

```bash
sap-abap-mcp serve --profile DEV100 --toolsets core,write,analysis
```

사용 가능한 값은 `core`, `write`, `analysis`, `debug`, `operations`, `artifacts`, `all`입니다. 기본값은 `all`이라 기존 설정과 기능은 그대로 유지됩니다.

## 개발자용: 저장소에서 실행하기

일반 사용자는 이 과정이 필요 없습니다. 소스를 수정하거나 테스트할 때만 실행하세요.

```bash
npm install
npm run build
npm test
```

로컬 빌드로 Codex에 등록하는 예시는 다음과 같습니다.

```bash
codex mcp add sap-abap-local -- node "/absolute/path/to/sap-abap-mcp/dist/src/index.js" serve --profile DEV100
```

ABAP FS 호환 도구 기준 목록은 `src/compat/abap-fs-tools.ts`에 있습니다. 기준 버전은 ABAP FS 2.6.5, commit `3041418d35558e043993a4d7f9fa6b727fcf9cf1`입니다.
