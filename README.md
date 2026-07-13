# sap-abap-mcp

SAP GUI나 VS Code 확장 세션 없이 SAP ADT(ABAP Development Tools) HTTP API에 직접 로그인하는 로컬 MCP 서버입니다.

현재 버전은 첫 번째 수직 슬라이스입니다. ABAP FS의 MCP 도구 42개 이름을 호환성 매니페스트로 고정했고, 그중 아래 4개를 실제 구현했습니다.

Windows에서 Codex/Claude가 stdio MCP를 자동 실행하고 여러 SAP 프로필을 사용하는 전체 과정은 [`docs/localhost-mcp-end-to-end.md`](docs/localhost-mcp-end-to-end.md)에 정리되어 있습니다.

Public preview 패키지는 다음 명령으로 실행할 수 있습니다.

```bash
npx -y @coaspe/sap-abap-mcp@0.1.1 help
```

`0.1.1`부터 macOS Keychain과 Windows DPAPI 자격증명 저장소를 지원합니다. Windows에서는 현재 사용자 계정으로만 복호화할 수 있는 암호화 파일을 사용합니다.

- `get_connected_systems`
- `get_sap_system_info`
- `search_abap_objects`
- `get_abap_object_lines`

나머지 도구는 아직 MCP 목록에 노출하지 않습니다. 동작하지 않는 스텁을 42개 노출하는 대신 ADT 연동과 테스트가 끝난 도구만 추가합니다.

## 동작 구조

```text
Codex / Claude Code
        │ MCP stdio
        ▼
  sap-abap-mcp 프로세스
        ├── 프로필: 사용자별 sap-abap-mcp 설정 폴더
        ├── 암호: macOS Keychain 또는 Windows DPAPI
        └── HTTPS + Basic Auth + SAP ADT API
                         │
                         ▼
                     SAP 서버
```

ABAP FS 확장을 먼저 열거나 로그인해 둘 필요가 없습니다. 사용자가 이 CLI에서 한 번 로그인하면 암호는 운영체제별 보안 저장소에 저장되고, Codex/Claude가 시작한 MCP 프로세스가 같은 사용자 계정으로 암호를 읽어 자체 ADT 세션을 만듭니다.

## 사전 조건

- macOS 또는 Windows와 Node.js 20 이상
- SAP 서버의 ADT ICF 서비스 활성화 및 HTTPS 접근 가능
- ADT 개발 권한이 있는 SAP 사용자
- 사내망/VPN, 인증서 체인, 프록시 등 SAP 서버까지의 네트워크 경로

macOS는 Keychain을 사용합니다. Windows는 PowerShell의 DPAPI를 사용해 `%APPDATA%\sap-abap-mcp\secrets`에 프로필별 암호화 파일을 저장합니다. 이 파일은 일반적으로 암호화한 Windows 사용자와 머신에서만 복호화할 수 있습니다. Linux Secret Service는 후속 범위입니다.

## 1. 설치와 빌드

```bash
cd "/Users/coaspe/Documents/Q&A/sap-abap-mcp"
npm install
npm run build
```

## 2. SAP 프로필 등록

```bash
node dist/src/index.js profile add DEV100 \
  --url https://sap.example.com \
  --client 100 \
  --language EN \
  --environment development \
  --username DEVELOPER \
  --packages Z_MY_PACKAGE
```

프로필에는 접속 URL과 사용자명만 저장되며 암호는 들어가지 않습니다. 프로필 확인:

```bash
node dist/src/index.js profile list
```

## 3. 자체 로그인

```bash
node dist/src/index.js auth login DEV100
```

암호 입력은 화면에 표시되지 않습니다. 서버가 먼저 실제 ADT 로그인을 검증하고 성공한 경우에만 운영체제별 보안 저장소에 저장합니다. CI처럼 TTY가 없는 환경에서는 암호를 명령행 인자로 남기지 말고 표준입력을 사용합니다.

```bash
printf '%s\n' "$SAP_PASSWORD" | \
  node dist/src/index.js auth login DEV100 --password-stdin
```

상태 확인과 삭제:

```bash
node dist/src/index.js auth status DEV100
node dist/src/index.js auth logout DEV100
```

## 4. 연결 진단

```bash
node dist/src/index.js doctor DEV100
```

여기서 `ok: true`와 SAP 릴리스/클라이언트 정보가 나오면 MCP 클라이언트 등록 전에 네트워크, ADT, 인증이 모두 확인된 것입니다.

## 5. Codex에 등록

[Codex 공식 MCP 문서](https://developers.openai.com/codex/mcp/)의 stdio 등록 방식에 따라 실행합니다.

```bash
codex mcp add sap-abap -- \
  node "/Users/coaspe/Documents/Q&A/sap-abap-mcp/dist/src/index.js" \
  serve --profile DEV100
```

확인:

```bash
codex mcp list
```

Codex 데스크톱 앱에서는 Settings → MCP servers → Add server에서 STDIO를 선택하고 같은 명령과 인수를 입력한 뒤 재시작할 수도 있습니다. Codex CLI, 데스크톱 앱, IDE 확장은 같은 Codex 호스트의 MCP 설정을 공유합니다.

직접 `~/.codex/config.toml`에 넣으려면:

```toml
[mcp_servers.sap-abap]
command = "node"
args = [
  "/Users/coaspe/Documents/Q&A/sap-abap-mcp/dist/src/index.js",
  "serve",
  "--profile",
  "DEV100"
]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

## 6. Claude Code에 등록

[Claude Code 공식 MCP 문서](https://docs.anthropic.com/en/docs/claude-code/mcp)의 로컬 stdio 방식입니다.

```bash
claude mcp add sap-abap --scope user -- \
  node "/Users/coaspe/Documents/Q&A/sap-abap-mcp/dist/src/index.js" \
  serve --profile DEV100
```

확인:

```bash
claude mcp get sap-abap
```

## 7. 첫 사용 예시

Codex 또는 Claude에 다음처럼 요청합니다.

```text
DEV100에서 ZCL_DEMO 클래스를 찾아줘.
RUN 메서드의 실제 소스를 읽고 동작을 설명해줘.
```

에이전트는 보통 `get_connected_systems` → `search_abap_objects` → `get_abap_object_lines` 순서로 호출합니다.

## 보안 원칙

- SAP 암호를 MCP 도구 인자, 프로필 JSON, 로그에 넣지 않습니다.
- `serve --profile DEV100`으로 MCP 프로세스를 한 시스템에 제한합니다.
- 프로덕션 프로필은 후속 쓰기 도구에서 별도의 승인과 정책을 적용할 예정입니다.
- 소스 변경 도구를 구현할 때는 `read → lock → write → syntax check → activate → unlock` 순서와 transport 강제를 적용합니다.

## 개발과 테스트

```bash
npm test
```

테스트는 실제 SAP 암호를 사용하지 않습니다. 메모리 자격증명 저장소와 가짜 ADT 클라이언트, MCP 인메모리 전송 계층으로 프로필 저장, 연결 캐시, 도구 검색, 객체 검색, 메서드 소스 조회를 검증합니다.

## 다음 구현 순서

1. 소스 내부 검색과 객체 메타데이터: `search_abap_object_lines`, `get_abap_object_info`, `get_object_by_uri`
2. 안전한 수정 루프: `replace_string_in_abap_object`, `abap_activate`, diagnostics
3. 신규 객체와 transport 관리
4. ABAP Unit, ATC, SQL query
5. where-used, version history, download, 문서화
6. debugger, dump/trace, 나머지 ABAP FS 호환 도구

42개 기준 목록은 `src/compat/abap-fs-tools.ts`에 있습니다. 기준 버전은 ABAP FS 2.6.5, commit `3041418d35558e043993a4d7f9fa6b727fcf9cf1`입니다.
