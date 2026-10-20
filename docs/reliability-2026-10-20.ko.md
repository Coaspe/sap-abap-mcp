# 2026-10-20 설치·업무 신뢰성 변경

미게시 후보 변경이다. npm latest/main을 재조회한 기준은 2.0.1 /
`383598fc3ddc2acdf5cf51b086ddcc64528ce089`이며 실제 tarball SHA-512가
registry integrity와 일치했다. 기존 작업 checkout의 변경은 보존하고 별도
`codex/install-workflow-reliability` 브랜치에서 작업했다. 게시·외부 메시지·실제 SAP
쓰기·사람 모집은 수행하지 않았다. Context7/sequential-thinking 도구는 이 세션에
없어 실제 소스·프로토콜 검사·공식 문서를 사용했다.

## 1. 기존 기능과 확인된 결함

| 분류 | 근거와 조치 |
|---|---|
| 존재함 | `src/onboard.ts`, `src/onboard-page.ts`, `src/oauth-authorization-code.ts`, `src/secret-store.ts`: onboard/doctor, OAuth PKCE, DPAPI/Keychain이 이미 있다. 재작성하지 않고 실행 등록과 Keychain 결함을 수정했다. |
| 존재함 | `src/mcp/v1/adaptive-tools.ts`, `migration-catalog.ts`, `src/source-cache.ts`, `src/sap-client.ts`: 5 gateways, 120 capabilities, cache, batch/conditional read, KTD/public contract가 있다. 새 MCP 도구를 추가하지 않았다. |
| 존재함 | `src/mcp/v1/workflow-prompts.ts`, `src/tool-service.ts`, `src/http/server.ts`, `src/sap-client.ts`: 설명/변경/transport prompt, debugger, RAP, HTTP 권한/audit와 transport assure가 있다. 기존 workflow·정책·분석 기능을 재사용했다. |
| 존재함 | `server.json`, `mcpb/manifest.json`, `scripts/build-mcpb.sh`: Registry와 MCPB가 이미 있다. 신규 등록/재구축 과제로 만들지 않았다. |
| 결함 재현 | 배포된 2.0.1을 실제 설치해 `npx -y @coaspe/sap-abap-mcp` 형태의 인자 없는 실행이 stdout help 후 exit 0으로 닫히는 것을 확인했다. [외부 안내](acquisition-drafts-2026-10-20.md)의 serve 누락과 일치한다. |
| 결함 재현 | Keychain 쓰기 성공 응답에도 실제 조회 값이 빈 문자열이었다. 임의 테스트 항목만 사용해 재현했고, `src/keychain.ts`의 Security framework 호출로 수정했다. 기존 CLI 생성 항목과 호환되며 비밀은 argv에 넣지 않는다. |
| 결함 재현 | `src/sap-client.ts`의 SAP_BASIS-only ECC 판정과 다른 inactive source 덮어쓰기, `src/tool-service.ts`의 다중 쓰기 실패 후 자동 rollback을 회귀 fixture로 재현한 뒤 수정했다. 이전 live 시스템의 오분류를 추정하지 않는다. |
| 결함 재현 | 이전 절대 Node/npm cache 등록은 실제 격리 cache 삭제 및 등록 Node 경로 제거 시 깨진다. doctor/repair가 원인을 구분하고 설정을 보존한다. 실제 GUI 재시작과는 별도다. |
| 실환경 미검증 | Windows DPAPI/npx.cmd, 네이티브 MCPB 설치, GUI 호스트 재시작, 현재 2.x SAP 인증·첫 read·T1–T5·모델/provider usage. [현장 실행](field-acceptance-2026-10-20.ko.md)에 명령과 합격 기준이 있다. |
| 실제 부재 | 현재 버전에 결속된 공개 live acceptance, 실행된 동등 조건 모델 비교, 동의받은 외부 10명 결과, 독립 채택 사례가 없다. 새 로컬 수집/집계와 evidence index를 추가했지만 사용자 성과로 세지 않는다. |

## 2. 바뀐 동작과 재현 명령

`src/launch-contract.ts`가 exact version의 `npx`/Windows `npx.cmd`와 stdio
`serve` 계약을 제공한다. registry/plugin/MCPB는 이를 테스트로 검증한다.
비대화형 무인자 실행은 stdio server이며 명시적 help/잘못된 명령/대화형 help는
보존된다. 프로필이 없으면 initialize instructions에서 setup_required를 발견할
수 있지만 실제 설치·SAP 인증 성공에는 포함하지 않는다.

npm 설치에서 onboard는 캐시 경로 대신 exact version을 등록한다. 안정된 source
checkout에서는 PATH의 Node와 그 checkout을 등록한다. doctor는 wizard/등록 서버
버전·실행 경로·엔트리 존재·실제 initialize/tools/list·프로필 저장소를 구분한다.
repair/update는 preview hash, exact version, 새 프로세스 사전 검증, 동시 수정 확인,
private 복구 사본과 atomic replacement를 사용한다. custom wrapper/disabled/다른
프로필과 감지된 Claude 프로젝트 override는 자동 변경하지 않는다.

```sh
npm ci
npm test
node scripts/smoke-v1-stdio.mjs
node scripts/check-evidence-index.mjs
node scripts/user-outcomes.mjs
```

소스 변경은 ADT lock 아래 active revision과 inactive state를 다시 확인한다.
외부 inactive 변경은 conflict로 보존한다. 다중 쓰기 중 응답이 유실되면 실제 저장
상태가 불확실한 객체를 명시하고 중단한다. 이미 완료한 쓰기/미시도 쓰기를 구분하며
자동 rollback이나 무조건 재시도를 하지 않는다. diagnose/activate/Unit/ATC, 테스트
0개·미실행·부분 조회, 문법 확인과 업무 요구 검증을 prompt와 recovery에서 분리한다.
이 안전성 회귀는 로컬 fixture 결과이며 실제 모델의 완주율 개선을 증명하지 않는다.

## 3. 패키징과 측정의 범위

`pack:runtime`은 npm tarball을 stage한 후 bundled dependency의 demo/test/examples/
bench/.github와 source map만 제외하고 다시 pack한다. 문서 glob은 과거 실험 폴더와
중복 산출물을 제외한다. patched vendor/license/runtime assets는 보존하고 설치된
실제 runtime에서 backport hash와 Mermaid parser를 재검증한다. 릴리스 workflow는
생성한 tarball을 `npm publish --provenance`로 게시하도록 유지했다. 게시 자체는 미실행이다.

측정: macOS arm64, Node 24.22.0, 로컬 tarball, 비어 있는 별도 npm cache,
`--omit=dev --ignore-scripts`, regular-file 논리 바이트. 파일시스템 block 사용량이나
최초 tarball 다운로드 시간은 아니다. 초기 비교에서 2.0.1은 압축 26,292,723 /
압축 해제 85,505,251 / 12,585 files, 초기 후보는 13,306,398 / 58,206,910 /
11,929였다. 최종 후보 수치는 [현재 검증 기록](evidence/candidate-reliability.json)에 있다.

초기 설치 후 전체 node_modules는 118,886,570 → 91,728,872 bytes였다.
빈 cache 설치는 14.30 → 15.06초, 3회 warm protocol session은 391–397 →
213–248ms였다. 두 초기 설치가 동시 실행되어 cold 속도 개선 근거로 쓰지 않는다.
최종 별도 재측정 값/한계도 evidence에 기록한다. Mermaid eager import는 별도
측정에서 126–304ms, DOCX는 10–12ms여서 Mermaid만 lazy load했다.

제품 전체의 로컬 크기를 비교하면 외부 dependency도 포함해야 한다. 실제 ARC-1
1.6.0 npm 설치는 70,510,642 bytes/8,513 files였다. Coaspe/ARC 공통 Node/npm
24.22.0 공식 배포는 추가 197,365,224 regular-file bytes(압축 53,049,576)이며
공식 checksum과 일치했다. VSP darwin-arm64 v2.61.0은 26,205,698-byte 바이너리,
LICENSE/NOTICE 2,296 bytes를 더한다. 기본 ADT 구성의 optional RFC library는
설치하지 않았고 세 제품 공통 OS library/모델 호스트/캐시 중복은 제외한다. 기능과
실행 범위가 다르므로 이 용량/한 번의 설치시간으로 업무 우열을 정하지 않는다.

## 4. 비교·공개 지표·사용자 성공

T1–T5 × 제품 3개 × 새 세션 3회 = 예정 45회, 시도 0회, blocked 45회다.
동일한 승인 SAP/fixture/권한/host/model/prompt/예산이 없어 실행하지 못했다.
unsupported나 실패율 100%로 바꾸지 않았고 정확성·완주율·청구 토큰·전체 순위는
null이다. Coaspe 2.0.1, ARC-1 1.6.0, VSP v2.61.0의 실제 release commit/integrity는
[고정 기록](evidence/task-comparison-2026-10-20.json)에 있다. 현재 후보는 이
배포 버전 비교에 섞지 않는다.

`node scripts/npm-downloads.mjs --output /private/path/downloads.json`은 일별
다운로드, release 시각, UTC 월–일 고정 주간, rolling 7/28일, 실제 available end를
기록한다. 이번 API의 available end는 10/18, rolling 7=407, rolling 28=1,488이다.
10/13–15는 react/express 대조군도 함께 0이어서 incomplete_suspected다. 실제 0과
누락을 확정 구분하지 않으며 보간하지 않는다. 최근 구간을 다시 조회할 수 있다.
출시 직후 감소, 설치 실패, 실제 사용자 감소를 같은 원인으로 단정하지 않는다.

기존 feedback form/빈 scorecard에 단계 구분을 추가하고 strict local export를
구현했다. 원격 telemetry는 없다. 외부 ABAP 개발자 10명 중 첫 업무 8명/7일 후
다른 업무 재사용 5명은 사전 사업 판단 기준이며 보장/시장 평균이 아니다. 현재
실제 관찰 0명이며 실패·미응답을 고정 분모에 남긴다. [정정·제출·영어 demo 초안](
acquisition-drafts-2026-10-20.md)은 준비만 했고 전송·녹화·도입 사례 게시를 하지 않았다.

## 5. 검증 경계와 소유자 현장 작업

전체 test suite, 5-mode 실제 stdio smoke, release metadata conformance,
MCPB/LobeHub catalogue 동기화, standalone MCPB runtime/manifest/pack, backport
hash/OSV audit, npm production audit와 registry signatures를 로컬에서 실행했다.
구체 결과와 테스트한 source commit, package integrity는 evidence에 결속한다.
`npm audit` 통과는 보안 무결함이나 live SAP 지원 보장이 아니다.

Windows CI에 npx.cmd tarball matrix와 실제 DPAPI throwaway 검사를 추가했지만
원격 CI를 실행한 결과는 없다. macOS에서는 실제 Keychain의 기존 항목/UTF-8/
9,000-byte 값/갱신/삭제만 검증했다. 호스트 재시작과 실제 credential renewal은
현장 단계로 남는다. MCPB 독립 실행 통과와 실제 Desktop 설치를 구분한다.

[현장 가이드](field-acceptance-2026-10-20.ko.md)의 순서대로 Windows 설치,
호스트 재시작·갱신, 실제 MCPB, T1–T5, 10명 실험을 진행한다. 현재 다음 행동은
승인된 개발 프로필이 있는 컴퓨터에서 registration doctor 한 번 실행하는 것이다.
