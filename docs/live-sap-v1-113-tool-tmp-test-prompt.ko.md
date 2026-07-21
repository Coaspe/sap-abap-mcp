# B4D v1 113개 도구 `$TMP` 격리 실서버 테스트 프롬프트

이 문서는 Windows의 Claude Code에서 옵션 없는 v1/all MCP 연결을 대상으로
한다. `$TMP`는 Windows 임시 directory가 아니라 SAP의 local package다. 로컬
artifact만 Windows `%TEMP%` 아래의 이번 실행 전용 directory에 기록한다.

아래 블록을 repository root에서 시작한 새 Claude Code 세션에 그대로 붙여
넣는다.

~~~~text
너는 SAP ABAP MCP v1의 B4D 실서버 acceptance controller다. 목표는 실제
광고된 v1 도구 113개와 Resource 7개를 한 행도 빠뜨리지 않고 검증하되,
기존 SAP 객체를 절대로 수정하거나 삭제하지 않는 것이다.

## 1. 고정 범위

- MCP server name은 `sap-abap-b4d-local`, SAP systemId/profile은 오직 `B4D`다.
- MCP는 `serve --profile B4D`로 실행된다. 옵션을 생략한 현재 기본값인
  v1/all만 사용한다. v0 이름을 호출하지 않는다.
- repository의 `git rev-parse HEAD`를 첫 보고서에 기록한다.
- password, token, cookie, CSRF, SAP URL, username, session identifier를
  요청하거나 출력하지 않는다.
- 기존 객체는 read/search/analysis의 입력으로 사용할 수 있다.
- mutation 대상은 이번 실행이 직접 SAP package `$TMP`에 생성하고 소유권을
  증명한 객체뿐이다. 이름이나 검색 결과만으로 소유권을 증명할 수 없다.
- transport, abapGit remote, 다른 SAP system, 기존 RAP service, 기존 debug
  session을 변경하지 않는다.
- production environment이거나 profile의 non-empty allowedPackages에 literal
  `$TMP`가 없으면 모든 SAP mutation을 중단하고 읽기 검증만 계속한다.

## 2. 113행 surface ledger

MCP discovery와 `docs/v1-parity-matrix.md`를 함께 읽어 113행 ledger를 먼저
만든다. runtime에 광고된 이름을 진실의 원천으로 삼고, matrix의 중복 행은
중복 도구로 세지 않는다. 다음 exact gate를 통과하기 전에는 live call을 하지
않는다.

- 광고된 tool 이름의 unique count = 113
- toolset별 count = core 20, write 23, analysis 29, debug 10, operations 24,
  artifacts 7
- 모든 이름이 `sap.`으로 시작하며 v0 이름은 0개
- 각 tool에 inputSchema, outputSchema, title, description, 네 annotation
  필드가 존재
- Resource registry name의 exact set = `sap-adt-source`,
  `sap-capability-evidence`, `sap-docs-compat`, `sap-docs-data-query`,
  `sap-docs-mermaid`, `sap-evidence`, `sap-transport`

ledger 열은 다음과 같다.

`tool | toolset | annotation | schema checked | planned case | terminal status | requestId/evidence | mutation target`

terminal status는 `PASS`, `EXPECTED-ERROR`, `SKIP-SCOPE`,
`SKIP-PREREQUISITE`, `UNSUPPORTED`, `FAIL` 중 하나만 사용한다. 모든 113행은
정확히 하나의 terminal status를 가져야 하며 합계가 반드시 113이어야 한다.
호출하지 않은 도구를 `PASS`로 표시하지 않는다.

## 3. RUN_OWNED 소유권 상태 기계

영문 표기는 보고서와 자동 검색을 위해 그대로 사용한다.

1. 8자리 대문자 영숫자 `RUN_ID`를 생성한다.
2. 후보 이름은 실행 ID를 포함하고 ABAP 이름 길이를 지킨다. 예:
   `ZCL_M1_<RUN_ID>`, `ZCL_M2_<RUN_ID>`, `ZMCP1_<RUN_ID>`.
3. `sap.repository.create` 성공 전 상태는 `CANDIDATE`다.
4. 성공 응답의 create receipt에서 exact systemId, object type/name, package,
   canonical URI, requestId를 기록하면 `CREATE_RETURNED`다.
5. 즉시 `sap.repository.inspect`와 `sap.source.read`로 exact object를 read-back
   한다. systemId=`B4D`, package=`$TMP`, type/name/URI가 create receipt와
   모두 일치할 때만 `RUN_OWNED`로 승격한다. 이것이 immediate exact
   read-back 규칙이다.
6. create가 timeout/error/partial이면 객체가 존재하더라도 자동으로
   `RUN_OWNED`로 승격하지 않는다. exact read로 상태를 조사하고
   `OWNERSHIP-AMBIGUOUS`로 격리한다. 이 객체에는 어떤 mutation과 cleanup도
   하지 말고 사용자에게 보고한다.
7. 검색, wildcard, `$TMP` package membership, 이름 prefix, 이전 실행의 기록은
   소유권 증거가 아니다.

각 RUN_OWNED entry에는 `create receipt`와 `immediate exact read-back` 증거를
둘 다 보존한다. mutation 직전마다 다음 preflight를 다시 검사한다.

- target이 RUN_OWNED ledger의 exact 한 행과 일치
- systemId가 B4D이고 package가 literal `$TMP`
- 입력에 wildcard 또는 ledger 밖 URI/name이 없음
- preview/plan 도구가 있으면 방금 만든 planId와 confirmation을 그대로 사용
- 작업 결과를 exact read-back하여 예상한 변경만 있었는지 확인

한 조건이라도 실패하면 해당 mutation을 실행하지 말고 `SKIP-SCOPE` 또는
`FAIL`로 기록한다.

## 4. Mutation 시작 gate

먼저 PowerShell에서 `node .\dist\src\index.js profile list`와
`node .\dist\src\index.js doctor B4D --include-components`를 실행하고, 이어서
read-only surface gate, `sap.system.list`, `sap.system.inspect`,
`sap.system.capabilities`를 실행한다. local profile에서 environment와
allowedPackages를 확인하고 doctor가 `ok: true`인지 확인한다.
그 다음 생성할 fixture, source, expected URI와 cleanup 순서를 보여주고 사용자에게
정확히 `START-MUTATION <RUN_ID>`를 요청한다. 그 응답 전에는
`sap.repository.create`를 포함한 어떤 mutation도 실행하지 않는다.

fixture source는 최소한 다음 검증을 가능하게 해야 한다.

- 서로 참조하는 두 `$TMP` class: search/read/batch/where-used/dependency,
  semantic, diagnostics, ATC, ABAP Unit, execution preview/execute, debugger
- 한 `$TMP` report: text element read/write와 source/version 검증
- 모든 source에 실행 ID marker를 포함하여 read-back fingerprint를 비교

## 5. 전 도구 실행 규칙

각 tool은 호출 전 실제 inputSchema를 읽어 허용된 필드만 사용한다. schema를
추측하거나 실패 후 임의의 parameter 변형을 연속 시도하지 않는다. 같은
logical test를 불필요하게 반복하지 않는다.

### core 20

20개 모두 실제 호출한다. 기존 객체를 대상으로 하는 호출은 read-only로만
사용한다. source, batch, search, diagnostics, semantic, text read, object URL,
repository inspect/resolve/where-used는 가능하면 RUN_OWNED fixture를 사용한다.

### write 23

다음 mutation은 RUN_OWNED preflight와 도구 자체 confirmation을 모두 만족할
때만 실제 호출한다: repository create, source patch/activate, text element
write, test include create, refactor execute, version restore execute, class/snippet
execution execute. patch/refactor/restore/execute는 항상 대응 preview/read 호출과
fresh exact read-back을 둔다.

아래 계열은 `$TMP` 객체 소유권만으로 외부 대상의 안전을 증명할 수 없으므로
schema/discovery만 검증하고 `SKIP-SCOPE`로 기록한다.

- `sap.transport.create/delete/object.add/owner.set/release/user.add`
- `sap.git.create/pull/push/stage/unlink/branch.switch`
- `sap.rap.generate/binding.publish/binding.unpublish`

대상 객체가 RUN_OWNED임을 증명할 수 없는 write tool도 동일하게
`SKIP-SCOPE`다. 성공하지 않은 도구를 성공으로 포장하지 않는다.

### analysis 29

read-only 분석은 실제 호출한다. RUN_OWNED fixture에 ATC, unit test,
refactor preview, version list/read/compare/inactive/restore preview, dependency
graph를 적용한다. data query는 read-only/structured mode만 사용하고 변경 SQL은
금지한다. transport list/inspect/assess/compare/resolve와 Git list/inspect/check는
기존 대상을 변경하지 않는 범위에서 호출한다.

B4D 하나밖에 없어 cross-system compare가 불가능하면
`SKIP-PREREQUISITE`, suitable transport/Git/RAP fixture가 없으면 해당 행을
`SKIP-PREREQUISITE`로 기록한다. endpoint가 release에서 명시적으로 지원되지
않으면 실제 error code와 함께 `UNSUPPORTED`로 기록한다.

### debug 10

RUN_OWNED class의 exact URI/line만 breakpoint 대상으로 사용한다. 이번 실행이
시작한 debug session과 breakpoint만 inspect/step/evaluate/variables/stack/stop
대상으로 삼는다. attach/trigger prerequisite가 없으면 SAP에 인위적 dump나
다른 사용자 session을 만들지 말고 10행 각각을 `SKIP-PREREQUISITE`로
기록한다. 시작했다면 오류가 나도 stop/remove cleanup을 시도한다.

### operations 24

execution health/preview, discovery, transaction URL, dump/trace list와 가능한
read-only detail은 실제 호출한다. dump/trace fixture를 만들기 위해 오류나
trace를 인위적으로 발생시키지 않는다. 실제 ID가 없으면 detail 행은
`SKIP-PREREQUISITE`다. transaction launch는 외부 UI side effect이므로
`SKIP-SCOPE`, URL 생성은 `PASS` 가능하다.

watch 도구는 이번 MCP process에서 `RUN_ID`가 포함된 task만 add/list/update/
enable/disable/trigger/history/remove하고, 이번 실행이 만든 watch/task ID만
변경한다. 마지막에 stop과 remove를 수행한다.

### artifacts 7

Windows local output root는 새 directory
`$env:TEMP\sap-abap-mcp-b4d-<RUN_ID>` 하나뿐이다. 기존 경로를 덮어쓰지 않는다.
Mermaid detect/validate/create와 test document create를 실제 호출한다. source
export는 RUN_OWNED fixture만, data/discovery export는 bounded input만 사용한다.
생성된 file path가 output root 아래인지 확인한다.

## 6. Resource 7개

Resource list와 template list를 실제 조회하고 7개 registry name을 exact set으로
검증한다. 가능한 canonical read를 각각 한 번 수행한다.

- ADT source: RUN_OWNED source URI
- capability: B4D
- compat/data-query/mermaid docs: bundled documentation URI
- evidence: 이번 실행에서 tool이 반환한 evidence URI
- transport: read-only list에서 얻은 실제 transport가 있을 때만 읽고, 없으면
  `SKIP-PREREQUISITE`

Resource read는 SAP mutation으로 대체하지 않는다.

## 7. 오류와 envelope 검증

실제 호출마다 다음을 확인한다.

- text JSON과 structuredContent가 의미상 동일
- `schemaVersion`, `requestId`, `status`, `data`, `warnings` 존재
- error이면 declared v1 error envelope, sanitized message, retryable 분류 기록
- credential/URL/user/session secret이 응답과 보고서에 없음
- 안전한 missing prerequisite 또는 validation case가 있으면 한 번만
  `EXPECTED-ERROR`로 검증하며, SAP mutation이 시작될 수 있는 invalid case는
  만들지 않음

## 8. Cleanup

cleanup 순서는 이번 실행의 debug breakpoint/session, watch task/watch process,
local artifact directory, RUN_OWNED SAP object 순이다. SAP object 삭제는 반드시
각 RUN_OWNED 행에 대해 fresh delete preview를 만들고 exact planId/confirmation을
사용한다. wildcard/package-wide delete를 금지한다.

삭제 후 exact inspect/read가 not-found인지 확인한다. 보조 검색은 잔존 확인에만
쓰고, 검색 결과에 나온 ledger 밖 객체는 절대로 삭제하지 않는다. cleanup
실패나 OWNERSHIP-AMBIGUOUS 객체는 exact identity와 sanitized error만 보고하고
추가 mutation을 중단한다.

## 9. 최종 보고서

다음 순서로 보고한다.

1. HEAD, B4D, environment, surface 113/7 exact-set 결과
2. toolset별 `PASS / EXPECTED-ERROR / SKIP-SCOPE / SKIP-PREREQUISITE /
   UNSUPPORTED / FAIL` 수와 총합 113 검산
3. 113행 ledger 전체
4. Resource 7행 결과
5. RUN_OWNED manifest: create receipt + immediate exact read-back + mutation별
   read-back + cleanup 결과
6. 호출하지 못한 도구의 정확한 이유
7. 남은 객체/파일/session/task와 수동 조치가 필요한 항목

113행 중 하나라도 누락되거나 cleanup을 확인하지 못하면 “전체 통과”라고
말하지 않는다. strict `$TMP` 경계 때문에 의도적으로 건너뛴 도구는 정상적인
`SKIP-SCOPE`이며, 이것을 `PASS`로 바꾸지 않는다.
~~~~
