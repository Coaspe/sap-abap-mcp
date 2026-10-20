# 현장 검증: 아직 확인하지 못한 항목

이 문서는 실행 절차다. 실제 Windows, GUI 호스트 재시작, MCPB 설치, SAP 또는
모델 업무 성공을 기록한 문서가 아니다. 현재 Mac의 SAP 프로필은 0개이며 승인된
공통 시스템·fixture·모델 세션이 제공되지 않았다. 자격증명을 대화나 공개 파일에 넣지 않는다.

## 1. Windows 설치와 DPAPI

후보 checkout에서 PowerShell로 실행한다. 승인된 로컬 Windows 사용자 계정에서
테스트한다. native-store는 임의 테스트 식별자만 만들고 마지막에 삭제한다.

```powershell
npm ci
npm run build
node --test dist/test/stdio-launch.test.js dist/test/launch-contract.test.js dist/test/registration.test.js
node scripts/verify-native-store.mjs
node scripts/pack-runtime.mjs artifacts
node scripts/verify-installation.mjs artifacts/coaspe-sap-abap-mcp-2.0.1.tgz artifacts/windows-install.json
```

합격: `npx.cmd` 및 직접 Node 실행의 8개 조합에서 initialize/tools/list와 종료,
공백·한글 경로, 명시적 도움말·오류가 통과한다. 프로필 없음은 setup_required이며
설치 성공으로 집계하지 않는다. DPAPI 저장·읽기·갱신·삭제가 모두 true여야 한다.
실패 시 보고서와 exit code를 보관하고 성공 판정을 내리지 않는다.

## 2. 실제 호스트 재시작과 자격증명 갱신

후보 checkout에서 `node dist/src/index.js onboard`를 실행한다. 승인된 개발
프로필만 등록하고 해당 호스트를 완전히 종료한 뒤 다시 시작한다. `DEV100`은
현장의 프로필 별칭으로 대체한다. 별칭은 SID 증거가 아니다.

```powershell
node dist/src/index.js doctor DEV100 --registration --client codex
node dist/src/index.js doctor DEV100 --include-components
```

Claude Code이면 `--client claude`로 바꾸고 해당 프로젝트에서 실행한다.
첫 doctor는 실제 등록 서버의 버전·실행 경로·프로필 저장소와 MCP 초기화만 검사한다.
두 번째는 실제 SAP 접근이며 현장 소유자의 접근 허가 후 실행한다.
호스트에서 system inspect 결과의 실제 SID/client를 확인하고 허가된 객체 1개를 읽는다.
이후 기존 setup으로 자격증명을 갱신하고 다시 시작하여 같은 read를 반복한다.
작업 전후 원문은 비공개로 보관하고 공개 기록에는 익명 결과만 남긴다.

합격: 등록 파일이 정상이어도 SAP 인증/첫 조회가 실패하면 해당 단계를 실패로 남긴다.
캐시 삭제 후에는 고정 버전 재다운로드에 네트워크가 필요할 수 있다. PATH Node가
바뀌어도 새 프로세스가 시작되고 동일 프로필을 읽어야 한다. 사용자의 실제 캐시는
지우지 말고, 격리한 테스트 cache와 Node 경로에서 먼저 재현한다.

## 3. 실제 MCPB 설치

```sh
npm run build:mcpb
```

생성된 `artifacts/sap-abap-mcp-2.0.1.mcpb`는 미게시 후보임을 표시하고 지원되는
Claude Desktop에 직접 설치한다. 설치, 최초 설정, 앱 종료/재실행, 기존 프로필
읽기, Open SAP setup on startup을 통한 갱신을 각각 관찰한다. 독립 bundle checker
통과는 네이티브 앱 설치 성공을 대신하지 않는다. 기존 정상 서버와 이름이 충돌하면
자동으로 교체하지 말고 테스트용 호스트 계정/설정에서 검증한다.

## 4. T1–T5: 제품별 3개의 새 모델 세션

[기존 과제·판정 기준](abap-task-comparison.md)을 그대로 사용한다. 배포물 고정은
[evidence/task-comparison-2026-10-20.json](evidence/task-comparison-2026-10-20.json)에 있다.
Coaspe npm 2.0.1, ARC-1 1.6.0, VSP v2.61.0을 일차 비교한다. 후보 결과는 별도
실험으로 추가하고 배포된 2.0.1 결과에 섞지 않는다. 로컬 설치 용량 검사는 T1의
실제 SAP read가 아니므로 45개 예정 run은 현재 모두 blocked, attempted=0이다.

현장 소유자가 동일 SAP/권한/fixture hash, 허용 패키지와 transport, 호스트 빌드,
모델/provider/version, 설정·prompt·예산을 먼저 고정한다. 비밀은 각 제품의 지원
설정 경로로 로컬 입력한다. Coaspe는 `npx -y @coaspe/sap-abap-mcp@2.0.1 serve`,
ARC-1은 `npx -y arc-1@1.6.0`, VSP는 검증한 해당 OS의 v2.61.0 바이너리를 사용한다.
[ARC 설치 문서](https://github.com/arc-mcp/arc-1/tree/v1.6.0)와
[VSP 릴리스](https://github.com/oisee/vibing-steampunk/releases/tag/v2.61.0)의
인증·사전 요건을 실제 사용 조건에 맞춘다. 기능이 없다고 추정하여 unsupported로
미리 표시하지 않는다. 사용자 기준 도구가 ABAP FS/공식 SAP ADT이면 같은 조건의
추가 arm으로 기록한다.

각 run을 별도 세션에서 실행하고 원래 15개/제품 분모를 유지한다. 결과는 success,
partial, failed, unsupported, blocked, not_run 중 하나다. 기대 결과를 사전에 고정한
독립 검토자가 정확성과 업무 요구를 먼저 판정한다. 이후 시간, 개입, 호출, 실제
provider usage를 기록한다. 미제공 usage는 null이며 tokenizer 추정으로 채우지 않는다.
T3의 외부 변경은 허가된 fixture에서만 만들고 inactive/lock을 확인한다. 시간 초과 후
실제 저장 상태부터 확인한다. SAP 여러 쓰기를 원자적 rollback이라고 표현하지 않는다.

## 5. 10명 사용자 관찰과 자발적 내보내기

외부 ABAP 개발자 10명을 소유자가 모집하기 전에 고정 cohort 1–10으로 배정한다.
동의받아 설치 시도 → MCP ready → SAP 인증 → 첫 유용한 조회 → 첫 업무 결과를
분리해서 관찰하고 7일 후 다른 업무 재사용을 확인한다. 기준은 첫 업무 8/10명,
다른 업무 재사용 5/10명이다. 실패·차단·미응답을 분모에서 제외하지 않는다.
공개 form의 응답은 자가 보고이며 실환경 인증이나 ADOPTERS 게시 동의와 다르다.

`scorecard.json`의 기존 빈 `reports` 배열에 동의한 익명 구조화 결과만 기록한다.
필드와 허용값은 `src/user-outcomes.ts`에 있다. 새 비공개 파일을 사용할 수도 있다.

```sh
node scripts/user-outcomes.mjs /private/path/scorecard.json /private/path/aggregate.json
node scripts/npm-downloads.mjs --start 2026-07-13 --end 2026-10-19 --output /private/path/downloads.json
```

첫 명령은 네트워크 없이 집계만 만든다. 동의하지 않은 원문·사람 정보는 저장하지
않는다. 공개 기록에 SAP 소스, hostname/URL, 계정, 객체명, transport, 업무 데이터,
비밀을 넣지 않는다. 익명 결과의 집계 동의와 실명·인용문 게시 동의는 별도로 받는다.
모집·관찰·follow-up·사례 게시를 이 작업에서 수행했다고 주장하지 않는다.
