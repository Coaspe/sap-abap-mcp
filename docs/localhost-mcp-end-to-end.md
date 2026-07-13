# Windows localhost ABAP MCP 설치 및 사용 가이드

> 처음 설치한다면 먼저 [README의 가장 쉬운 시작 방법](../README.md#가장-쉬운-시작-방법)을 따라 하세요. 이 문서는 여러 SAP 시스템, 배포 구조, 운영 설정까지 필요한 사용자를 위한 상세 설명입니다.

작성 기준일: 2026-07-13
대상: 회사 Windows 클라우드 PC/VM에서 Codex 또는 Claude Code를 사용하는 ABAP 개발자
목표: SAP GUI, VS Code, ABAP FS 가상 워크스페이스 없이 여러 SAP 서버에 접속한다.

## 1. 최종 결정

이 프로젝트의 localhost 방식은 별도의 HTTP 서버를 `127.0.0.1` 포트에 계속 실행하는 구조가 아니다.

Sequential Thinking MCP와 같은 방식으로 Codex 또는 Claude Code가 npm 패키지를 로컬 자식 프로세스로 자동 실행하고, MCP stdio로 통신한다.

```text
회사 Windows 클라우드 PC/VM

Codex 또는 Claude Code
        │
        │ 필요할 때 로컬 프로세스 자동 실행
        │ MCP stdio
        ▼
@coaspe/sap-abap-mcp
        ├── DEV100 프로필 ── SAP DEV 서버
        ├── QAS200 프로필 ── SAP QAS 서버
        └── PRD100 프로필 ── SAP PRD 서버
```

따라서 다음 항목은 필요 없다.

- 중앙 MCP 서버
- Secure MCP Tunnel
- 외부 공개 URL
- localhost HTTP 포트
- Windows 방화벽 인바운드 규칙
- Windows Service 또는 작업 스케줄러
- 사용자의 수동 `serve` 실행

여기서 localhost란 MCP 프로세스와 Codex/Claude가 같은 Windows 머신에서 실행된다는 의미다.

## 2. Sequential Thinking처럼 자동 실행되는 원리

Sequential Thinking은 사용자가 서버를 직접 호스팅하는 것이 아니다. MCP 클라이언트 설정에 npm 실행 명령이 등록되어 있고, Codex가 그 명령을 자식 프로세스로 실행한다.

같은 구조를 ABAP MCP에 적용한다.

```toml
[mcp_servers.sap-abap]
command = "npx.cmd"
args = ["-y", "@coaspe/sap-abap-mcp@0.2.0", "serve"]
```

수명주기는 다음과 같다.

1. 사용자가 Codex 또는 Claude Code를 실행한다.
2. MCP 클라이언트가 `npx.cmd`로 ABAP MCP를 실행한다.
3. MCP는 표준입력과 표준출력으로 클라이언트와 통신한다.
4. SAP 도구가 처음 호출될 때 해당 프로필로 SAP에 로그인한다.
5. 클라이언트가 종료되면 MCP 프로세스와 SAP 세션도 종료한다.

`npx.cmd`가 패키지를 찾을 수 있도록 npm registry에 접근할 수 있어야 한다. 운영에서는 버전을 `@0.2.0`처럼 고정한다.

## 3. ABAP FS와의 차이

| 항목 | ABAP FS MCP | 이 프로젝트 |
|---|---|---|
| 실행 주체 | VS Code 확장 | Codex/Claude가 npm 명령으로 자동 실행 |
| SAP 연결 | VS Code 확장의 로그인 세션 재사용 | 독립 프로필과 자격증명으로 직접 ADT 로그인 |
| VS Code | 필요 | 불필요 |
| 가상 워크스페이스 | 필요 | 불필요 |
| SAP GUI | 불필요 | 불필요 |
| 여러 SAP 서버 | 확장 연결에 의존 | 프로필 여러 개를 직접 관리 |

사용자는 이 MCP의 `auth login`을 최초 한 번 실행해야 한다. VS Code나 ABAP FS에 먼저 로그인할 필요는 없다.

## 4. 실행 조건

모든 프로그램이 같은 Windows 클라우드 PC/VM에 있어야 한다.

```text
같은 Windows 머신
├── Codex 또는 Claude Code
├── Node.js와 npm
└── sap-abap-mcp
```

Codex/Claude가 개인 PC에서 실행되고 MCP만 원격 Windows VM에 설치되어 있다면 stdio localhost 방식으로 연결할 수 없다.

필요 조건:

- Windows 10/11 또는 Windows Server 기반 회사 클라우드 환경
- Node.js 20 이상
- Codex 또는 Claude Code
- npm registry 접근 가능한 네트워크
- Windows 머신에서 각 SAP ADT URL로 HTTPS 접근 가능
- SAP ADT 서비스 `/sap/bc/adt` 활성화
- 사용할 SAP 사용자와 필요한 개발 권한
- 회사 프록시와 사내 CA 인증서 설정

## 5. npm 배포 방식

MCP 프로세스를 중앙 클라우드에 배포하지 않는다. 프로젝트 코드를 public npm 패키지로 게시하고, 각 사용자의 Windows 머신에서 실행한다.

공개 npm의 `sap-abap-mcp` 이름은 사용하지 않고 게시된 scope를 사용한다.

```text
@coaspe/sap-abap-mcp
```

배포 담당자는 다음 작업을 한다.

1. 회사 npm scope와 registry를 준비한다.
2. 패키지를 빌드하고 테스트한다.
3. 버전을 고정해 public package로 게시한다.
4. 사용자는 npm 계정 로그인 없이 public 패키지를 설치한다.

사용자는 서버를 배포하지 않는다. 패키지를 설치하거나 `npx.cmd`로 실행할 뿐이다.

## 6. 현재 구현 상태

현재 저장소와 npm `0.2.0` 기준 상태다.

| 기능 | 상태 |
|---|---|
| MCP stdio 자동 실행 구조 | 구현 |
| 여러 SAP 프로필 저장 | 구현 |
| 프로필별 SAP 클라이언트 격리 | 구현 및 테스트 완료 |
| 프로필별 자격증명 조회 | 구조 구현 |
| 실제 ADT 로그인 검증 | 구현 |
| 연결 진단 `doctor` | 구현 |
| 실제 MCP 도구 | ABAP FS 2.6.5 기준 42개 구현 및 인메모리 MCP 통합 테스트 완료 |
| ABAP FS 도구 42개 목록 | 호환성 기준선으로 고정 |
| Windows DPAPI SecretStore | 구현 및 단위 테스트 완료 |
| scoped 패키지명 `@coaspe/sap-abap-mcp` | 변경 완료 |
| public npm 게시 | `latest` 채널 사용 |
| Windows 실제 SAP 통합 테스트 | 미실행 |

`createDefaultSecretStore()`는 Windows에서 DPAPI 저장소를 자동 선택한다. 저장·조회·삭제와 프로필 격리는 단위 테스트를 통과했지만, 실제 Windows와 SAP 서버를 함께 사용하는 통합 테스트는 아직 필요하다.

42개 전체 이름과 기준선은 [`src/compat/abap-fs-tools.ts`](../src/compat/abap-fs-tools.ts)에 고정되어 있다. 기능 범주는 연결/discovery, 저장소 읽기·쓰기, Unit/ATC, 전송·버전·다운로드, SQL, 디버거, dump/trace, heartbeat, Mermaid와 DOCX 문서 생성이다.

## 7. 최초 사용자 설정

아래 예제는 게시 대상인 `@coaspe/sap-abap-mcp`를 사용한다. 회사 조직 scope로 이전하면 해당 scope로 바꾼다.

### 7.1 Node.js와 npm 확인

PowerShell에서 실행한다.

```powershell
node --version
npm --version
```

Node.js 버전은 20 이상이어야 한다.

### 7.2 public npm 패키지 접근 확인

public 패키지 설치에는 npm 로그인이나 access token이 필요하지 않다.

패키지 접근 확인:

```powershell
npm view @coaspe/sap-abap-mcp@0.2.0 version
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 help
```

### 7.3 SAP 프로필 여러 개 등록

프로필 ID는 시스템과 클라이언트를 함께 식별하도록 만든다. 예: `DEV100`, `QAS200`, `PRD100`.

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile add DEV100 `
  --url https://sap-dev.company.internal `
  --client 100 `
  --language EN `
  --environment development `
  --username DEV_USER `
  --packages Z_MY_PACKAGE

npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile add QAS200 `
  --url https://sap-qas.company.internal `
  --client 200 `
  --language EN `
  --environment quality `
  --username QAS_USER `
  --packages Z_MY_PACKAGE

npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile add PRD100 `
  --url https://sap-prd.company.internal `
  --client 100 `
  --language EN `
  --environment production `
  --username PRD_USER
```

등록 확인:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile list
```

프로필은 다음 경로에 저장한다.

```text
%APPDATA%\sap-abap-mcp\profiles.json
```

프로필 파일에는 URL, 클라이언트, 언어, 환경, 사용자명과 허용 패키지만 저장하며 SAP 암호는 저장하지 않는다.

### 7.4 프로필별 SAP 로그인

각 SAP 서버는 사용자명이나 암호가 다를 수 있으므로 별도로 로그인한다.

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth login DEV100
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth login QAS200
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth login PRD100
```

로그인 과정:

1. PowerShell에서 SAP 암호를 숨김 입력한다.
2. MCP가 해당 SAP 서버에 실제 ADT 로그인을 시도한다.
3. 로그인이 성공한 경우에만 암호를 Windows DPAPI로 암호화해 저장한다.
4. 자격증명은 프로필 ID별로 분리한다.

암호화 파일 경로:

```text
%APPDATA%\sap-abap-mcp\secrets\<PROFILE_ID>.dpapi
```

이 파일에는 평문 암호가 없으며 일반적으로 암호화한 Windows 사용자와 머신에서만 복호화할 수 있다. Windows 자격 증명 관리자 UI에 표시되는 항목은 아니다.

확인:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth status DEV100
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth status QAS200
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth status PRD100
```

SAP가 Basic Auth를 허용하지 않고 SSO, MFA 또는 SAP Logon Ticket만 허용한다면 별도의 인증 어댑터가 필요하다. 현재 구현의 인증 방식은 Basic Auth다.

### 7.5 서버별 연결 진단

MCP 등록 전에 모든 프로필을 진단한다.

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 doctor DEV100
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 doctor QAS200
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 doctor PRD100
```

`ok: true`와 SAP 시스템 정보가 나오면 네트워크, TLS, 사용자 인증과 ADT 접근이 확인된 것이다.

## 8. Codex에 자동 실행 MCP 등록

### 8.1 CLI로 등록

PowerShell에서 한 번 실행한다.

```powershell
codex mcp add sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 serve
```

`serve` 뒤에 `--profile`을 넣지 않는 것이 중요하다. 그래야 등록된 여러 SAP 프로필을 하나의 MCP에서 모두 사용할 수 있다.

등록 확인:

```powershell
codex mcp list
```

Codex를 다시 시작한 뒤 `/mcp`에서 `sap-abap` 상태를 확인한다.

### 8.2 config.toml로 직접 등록

Windows 사용자 설정 파일:

```text
%USERPROFILE%\.codex\config.toml
```

내용:

```toml
[mcp_servers.sap-abap]
command = "npx.cmd"
args = ["-y", "@coaspe/sap-abap-mcp@0.2.0", "serve"]
startup_timeout_sec = 30
tool_timeout_sec = 120
required = true
```

Codex 데스크톱 앱이나 IDE 확장에서는 MCP 서버 추가 화면에서 STDIO를 선택하고 같은 명령과 인수를 등록할 수도 있다.

## 9. Claude Code에 자동 실행 MCP 등록

PowerShell에서 한 번 실행한다.

```powershell
claude mcp add --transport stdio --scope user sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 serve
```

확인:

```powershell
claude mcp list
claude mcp get sap-abap
```

Claude Code 안에서는 `/mcp`로 상태를 확인한다.

Codex와 Claude Code를 동시에 실행하면 각각 별도의 MCP 프로세스와 SAP 세션을 만들 수 있다.

## 10. 일상적인 사용 방법

최초 설정 이후 사용자는 MCP 서버를 직접 실행하지 않는다.

1. 회사 Windows 클라우드 PC에 로그인한다.
2. Codex 또는 Claude Code를 실행한다.
3. 클라이언트가 ABAP MCP를 자동 실행한다.
4. 자연어로 대상 SAP 프로필을 지정해 요청한다.

첫 확인 요청:

```text
등록된 SAP 시스템 목록과 로그인 가능 상태를 보여줘.
```

에이전트는 `get_connected_systems`를 호출해 `DEV100`, `QAS200`, `PRD100` 같은 connection ID를 확인한다.

시스템을 명시한 요청 예시:

```text
DEV100에서 ZCL_DEMO 클래스를 검색하고 RUN 메서드의 실제 소스를 읽어서 설명해줘.
```

```text
QAS200에서 Z_MY_REPORT 프로그램을 찾아서 1번부터 120번 줄까지 읽어줘.
```

```text
DEV100과 QAS200의 ZCL_ORDER 클래스가 같은지 비교해줘.
```

여러 시스템이 등록되어 있을 때는 시스템을 추측하지 않고 `connectionId`를 명시하는 것이 원칙이다.

현재 버전은 읽기 전용이다. 실제 수정, 활성화, Transport, ABAP Unit과 ATC 기능은 해당 도구가 구현된 이후 사용할 수 있다.

## 11. 프로필 관리

목록 조회:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile list
```

같은 ID로 `profile add`를 다시 실행하면 해당 프로필을 갱신한다.

암호 변경 후 다시 로그인:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth login DEV100
```

자격증명 삭제:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth logout DEV100
```

프로필과 자격증명 삭제:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile remove DEV100
```

## 12. 특정 시스템 하나만 노출하는 제한 모드

일반 사용자는 하나의 MCP에서 여러 프로필을 사용한다.

보안 또는 업무 분리를 위해 특정 시스템 하나만 노출하려면 MCP 등록 명령에 `--profile`을 사용한다.

```toml
[mcp_servers.sap-dev-only]
command = "npx.cmd"
args = [
  "-y",
  "@coaspe/sap-abap-mcp@0.2.0",
  "serve",
  "--profile",
  "DEV100"
]
```

이 프로세스에서 `QAS200`이나 `PRD100`을 요청하면 거부된다.

## 13. npm 실행 방식 선택

### 방식 A: npx 자동 실행

Sequential Thinking과 가장 비슷한 방식이다.

```toml
command = "npx.cmd"
args = ["-y", "@coaspe/sap-abap-mcp@0.2.0", "serve"]
```

장점:

- 사용자가 MCP 서버를 직접 시작하지 않는다.
- 설치 경로를 따로 관리하지 않는다.
- 버전을 설정에서 고정할 수 있다.

주의:

- 최초 실행 시 패키지 다운로드 시간이 필요할 수 있다.
- 최초 실행 시 npm registry 접근이 필요하다.

### 방식 B: 전역 설치 후 자동 실행

폐쇄망 또는 매 실행 시 registry 확인을 피하고 싶을 때 사용한다.

```powershell
npm install -g @coaspe/sap-abap-mcp@0.2.0
```

Codex 설정:

```toml
[mcp_servers.sap-abap]
command = "sap-abap-mcp.cmd"
args = ["serve"]
```

이 경우에도 사용자가 `serve`를 직접 실행하지 않는다. Codex가 전역 설치된 명령을 자동 실행한다.

## 14. 보안 원칙

- SAP 암호를 `profiles.json`, MCP 도구 인자, 프롬프트 또는 로그에 넣지 않는다.
- Windows DPAPI 암호화 파일에는 프로필 ID별로 암호를 분리 저장한다.
- npm 토큰을 MCP 설정이나 저장소에 넣지 않는다.
- public 패키지라도 버전을 고정하고 npm 공식 registry에서만 설치한다.
- 프로필의 `allowedPackages`로 쓰기 가능 패키지를 제한한다. 빈 목록은 쓰기를 전면 거부한다.
- `production` 프로필은 저장소 쓰기를 거부한다.
- 쓰기 도구는 대상 `connectionId`를 명시하고, `$TMP`가 아닌 패키지에는 Transport Request를 요구한다.
- stdout은 MCP 프로토콜 전용으로 사용하고 진단 로그는 stderr로 보낸다.

stdio 방식은 네트워크 포트를 열지 않으므로 localhost HTTP Bearer token이나 방화벽 규칙이 필요 없다.

## 15. 장애 대응

### `npx.cmd`를 찾을 수 없음

Node.js 설치와 PATH를 확인한다.

```powershell
where.exe node
where.exe npm
where.exe npx.cmd
```

### npm `401` 또는 `404`

- npm 공식 registry 접근 경로를 확인한다.
- 패키지명과 `@coaspe` scope를 확인한다.
- 패키지 버전이 실제 게시되었는지 확인한다.

### `PROFILE_NOT_FOUND`

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile list
```

요청에 사용한 `connectionId`와 등록 ID를 비교한다.

### `AUTH_REQUIRED`

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 auth login DEV100
```

### TLS 또는 사내 인증서 오류

회사 CA 인증서를 Node.js가 신뢰하도록 사내 표준 방식으로 구성한다. 인증서 검증을 비활성화하지 않는다.

### SAP `401`, `403` 또는 ADT 오류

다음을 순서대로 확인한다.

1. SAP URL과 클라이언트 번호
2. 사용자명과 암호
3. `/sap/bc/adt` 서비스 활성화
4. SAP 개발 및 객체 조회 권한
5. Basic Auth 허용 여부
6. 회사 프록시와 네트워크 경로

### MCP가 연결되지 않음

먼저 CLI 자체를 확인한다.

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 doctor DEV100
codex mcp list
```

MCP 설정을 변경했다면 Codex 또는 Claude Code를 재시작한다.

## 16. MCP 등록 해제와 사용자 데이터 삭제

Codex 등록 해제:

```powershell
codex mcp remove sap-abap
```

Claude Code 등록 해제:

```powershell
claude mcp remove sap-abap
```

SAP 프로필은 각각 삭제한다.

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile remove DEV100
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile remove QAS200
npx.cmd -y @coaspe/sap-abap-mcp@0.2.0 profile remove PRD100
```

전역 설치를 사용했다면 패키지를 제거한다.

```powershell
npm uninstall -g @coaspe/sap-abap-mcp
```

## 17. Windows 릴리스 전 남은 개발 순서

1. 실제 Windows에서 DPAPI 저장·조회·삭제 smoke test
2. Windows PowerShell에서 숨김 암호 입력 테스트
3. Windows에서 `npx.cmd` 기반 Codex 자동 실행 통합 테스트
4. Claude Code 자동 실행 통합 테스트
5. 실제 SAP 개발 서버로 다중 프로필 smoke test
6. ABAP FS 호환 도구를 검증된 순서로 추가
7. 쓰기 기능에 프로덕션 차단, 패키지 제한, Transport 및 승인 정책 적용

## 18. 완료 기준

다음 조건을 만족하면 Windows localhost 릴리스가 준비된 것이다.

- 사용자가 VS Code나 SAP GUI 없이 SAP 프로필을 등록할 수 있다.
- 여러 SAP 서버와 클라이언트를 프로필로 등록할 수 있다.
- 각 프로필의 암호가 Windows DPAPI로 암호화되어 분리 저장된다.
- `doctor`가 각 프로필의 실제 ADT 연결을 검증한다.
- Codex 또는 Claude Code 시작 시 MCP가 자동 실행된다.
- 사용자가 별도의 서버, 포트 또는 Windows Service를 관리하지 않는다.
- `get_connected_systems`가 모든 허용 프로필을 반환한다.
- 모든 SAP 도구가 명시적인 `connectionId`로 올바른 서버에 연결된다.
- MCP 종료 시 SAP 세션이 정리된다.
- Windows 실제 환경의 설치·업데이트·삭제 절차가 통과한다.

## 19. 참고 자료

- [Codex MCP 공식 문서](https://developers.openai.com/codex/mcp/)
- [Claude Code MCP 공식 문서](https://code.claude.com/docs/en/mcp)
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Microsoft ConvertFrom-SecureString](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring)
- [Microsoft DPAPI CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
