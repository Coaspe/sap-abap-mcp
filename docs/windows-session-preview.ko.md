# 클라우드 Windows에서 이 세션의 수정본 실행하기

현재 Windows의 npm `latest` 배포본은 SAP에 연결되어 있다. 이 절차는 그
연결의 프로필과 보호된 자격 증명을 재사용하여 로컬 수정본을 시험한다.
다시 온보딩하거나 SAP 연결을 새로 만드는 절차가 아니다.

검증 ZIP은 `artifacts/windows-session-preview-2026-10-06/`에서 제공한다.
폴더 안의 `verification.json`에 정확한 ZIP 이름, SHA-256, 소스 스냅샷과
로컬 검사 결과가 기록된다. 패키지 내부 버전은 배포본과 같은 `1.7.1`이므로
버전 문자열만으로 수정본을 판별하지 않는다. ZIP에는 실행 코드, 컴파일된
코드, 고정된 의존성 목록과 검증 스크립트가 들어 있다. 과거 연구 보고서와
Mac의 프로필·자격 증명·node_modules는 전달하지 않는다.

## 1. ZIP을 Windows로 전달하고 압축 풀기

회사에서 허용한 파일 전달 경로로 ZIP을 옮긴다. PowerShell에서 다운로드한
파일의 해시를 확인하고 `verification.json`의 값과 비교한다.

```powershell
Get-FileHash -Algorithm SHA256 "<전달받은 ZIP 경로>"
Expand-Archive -LiteralPath "<전달받은 ZIP 경로>" -DestinationPath "<새 검증 폴더>"
```

기존 설치 폴더 위에 압축을 풀지 않는다. 새 폴더의 `LOCAL-PREVIEW.json`과
빌드 코드를 사용한다.

## 2. 새 폴더에 실행 의존성 설치하기

```powershell
Set-Location "<새 검증 폴더>"
npm.cmd ci --omit=dev --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "의존성 설치 실패" }
node .\scripts\smoke-v1-stdio.mjs
if ($LASTEXITCODE -ne 0) { throw "MCP 프로토콜 검사 실패" }
```

`npm ci`는 포함된 `package-lock.json`을 사용한다. 이 ZIP은 소스에서 이미
빌드되어 있으므로 Windows에서 TypeScript 빌드를 할 필요가 없다.
smoke 검사는 임시 빈 프로필로 실행되어 SAP를 호출하지 않는다. 기본 모드
5개, adaptive 17개, full 120개, minimal 5개, single 1개 도구가 기대값이다.
이 검사는 실제 SAP 기능 성공을 증명하지 않는다.

## 3. 기존 MCP 실행 경로만 수정본으로 바꾸기

기존 MCP 등록의 실행 프로그램을 `node`로, 첫 인자를 새 폴더의
`dist\src\index.js` 절대 경로로 바꾼다. 기존 `serve` 옵션, `--profile` 값,
환경 변수와 역할은 유지한다. MCP 클라이언트에 따라 설정 위치가 다르므로
현재 등록을 확인하고 해당 항목 하나를 바꾼다. 중복 MCP를 동시에 등록하면
도구 스키마와 선택 비용이 늘어난다.

실행 명령의 형태는 다음과 같다. `<기존 프로필>`은 현재 사용 중인 값이다.

```powershell
node "<새 검증 폴더>\dist\src\index.js" serve --profile "<기존 프로필>"
```

위 명령은 MCP 호스트가 실행할 명령이다. 터미널에서 직접 실행하면 stdio
요청을 기다리는 것이 정상이다. 기존 등록에 추가 옵션이나 환경 변수가
있으면 그대로 전달한다. `SAP_ABAP_MCP_HOME`을 새 검증 폴더로 설정하지 않는다.
이미 사용 중인 맞춤 프로필 경로가 있다면 그 값을 유지한다.

기존 Windows 사용자와 머신에서 실행해야 DPAPI 자격 증명을 재사용할 수
있다. 기본 프로필 위치는 `%APPDATA%\sap-abap-mcp`다. MCP 호스트를 재시작해
기존 프로세스를 교체한다. 이전 배포본으로 돌아갈 때는 저장해 둔 기존
실행 명령을 복원한다. 프로필 삭제나 자격 증명 재입력은 필요하지 않다.

## 4. 수정본의 실제 SAP 검증

먼저 수정본 ZIP의 해시와 실제 실행 경로가 일치하는지 기록한다. 기본
minimal 모드라면 도구 5개가 직접 노출된다. `--toolsets all` 등 명시적
옵션이 있으면 해당 모드의 도구 수로 판단한다.

현재 세션의 첫 실서버 검증은 읽기로 제한한다. 이미 연결된 대상에서
시스템 메타데이터, 허용된 객체의 작은 소스 구간, 조건부 재조회와 관련
타입 읽기를 실행하고 각 요청의 성공·부분 성공·지원 불가·오류를 구분한다.
기존 `scripts/live-read-context.mjs`는 이런 제한된 읽기의 증거를 수집한다.
해당 스크립트의 인자와 대상 객체는 실행 전에 확인한다. SAP 객체 변경이나
ABAP Unit 실행은 이 절차에 포함하지 않는다.

SAP에 연결된 배포본의 과거 성공을 수정본의 성공으로 옮겨 적지 않는다.
Mac의 빌드와 smoke 성공은 Windows 실행, DPAPI 재사용, SAP 기능 성공을
대신하지 않는다. 공개 표준의 conformance 결과와 의존성 audit 결과도
`verification.json`에 별도로 기록한다.

참고: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/),
[npm scripts 설정](https://docs.npmjs.com/cli/v11/using-npm/config/#ignore-scripts).
