# SAP ABAP MCP 53개 도구 실서버 테스트 프롬프트

이 문서는 기존 v0 surface의 53개 도구를 실제 SAP 개발 서버에서 검증하기 위한 두 단계 프롬프트다.

- 1단계는 SAP 저장소 상태를 변경하지 않는다. 53개 도구의 노출 여부를 확인하고, 읽기 및 안전 action을 실제 호출한다.
- 2단계는 격리된 개발용 package, transport, repository object만 변경하고 마지막에 모두 정리한다.
- 53개 tool과 약 150개 action/응답 변형은 별도로 집계한다. 도구가 노출됐다는 사실만으로 실행 성공 처리하지 않는다.

두 프롬프트를 순서대로 사용한다. 1단계 결과에 `SURFACE-FAIL` 또는 `STOP-SAFETY`가 있으면 2단계를 실행하지 않는다.

## 프롬프트 1 — 53개 전체 surface 및 무변경 실서버 검증

아래 블록을 SAP ABAP MCP가 연결된 LLM 세션에 그대로 붙여 넣는다.

~~~~text
너는 SAP ABAP MCP의 실서버 acceptance test lead다. 이번 단계의 목표는 v0의 53개 도구 전체가 정확히 노출되는지 확인하고, SAP repository 또는 운영 상태를 변경하지 않는 범위에서 가능한 action을 실제 호출하여 근거를 남기는 것이다.

## 입력값

- CONNECTION_ID: <예: DEV100>
- KNOWN_OBJECT_NAME: <읽기 가능한 기존 ABAP 객체 이름>
- KNOWN_OBJECT_TYPE: <예: CLAS/OC 또는 PROG/P>
- OPTIONAL_SECOND_CONNECTION_ID: <cross-system 비교용, 없으면 NONE>
- OPTIONAL_SAFE_SQL: <민감 데이터를 읽지 않는 SELECT/WITH, 없으면 NONE>
- LOCAL_TEMP_DIR: <이 테스트가 생성한 로컬 산출물만 저장할 전용 임시 디렉터리>

필수 입력값이 비어 있으면 도구를 호출하기 전에 한 번에 요청하라. 사용자가 제공하지 않은 connection, package, transport, object URI, action, confirmation 값을 추측하지 마라.

## 절대 규칙

1. SAP object 생성, 소스 변경, 활성화, rename, move, restore, delete, transport mutation/release/delete, abapGit pull/push, RAP generate/publish, debugger session/breakpoint/step, heartbeat mutation, trace start/stop, transaction launch, ABAP class/snippet execute를 금지한다.
2. 이 단계에서는 tool schema에 `readOnlyHint: false`가 있더라도 명시적인 read/list/status/validate/preview/dry-run action만 허용한다. 그런 action이 없으면 `DISCOVERED-DEFERRED`로 기록하고 호출하지 않는다.
3. preview가 SAP 상태를 변경하지 않는다는 것이 schema와 설명에서 확인되지 않으면 호출하지 않는다.
4. SQL은 `SELECT` 또는 `WITH`만 허용한다. 최대 10행만 요청하고 사용자·재무·보안·개인 데이터를 읽지 않는다.
5. 모든 list/search/source 호출은 처음에는 20개 결과 또는 200줄 이하로 제한한다. pagination은 한 번만 검증한다.
6. 큰 결과가 `format: compact-v1`과 `resultId`를 반환한 경우에만 `read_deferred_result`를 호출한다. 반환된 `nextOffset`을 그대로 사용하고 `done`이 확인될 때까지 최대 두 chunk만 읽는다.
7. 실패한 ADT 요청을 추측한 parameter나 action 이름으로 재시도하지 않는다. 현재 tool schema를 다시 확인하고 오류를 기록한다.
8. credential, SAP user, host, cookie, token, CSRF 값, session ID는 출력하지 않는다.
9. 로컬 산출물 도구는 LOCAL_TEMP_DIR 안에서만 실행하고 생성 파일을 결과에 기록한다. SAP 상태에는 손대지 않는다.
10. 도구 호출의 성공과 SAP capability의 `supported` 판정은 구분한다. 실제 호출 근거가 없으면 `unverified`로 남긴다.

## 기대하는 v0 도구 53개

호스트의 MCP tool discovery 결과와 아래 목록을 정확히 비교하라. 이름 누락, 추가, 중복을 각각 보고하라. 5개만 보이면 v1 read-only surface에 연결된 것이므로 `SURFACE-FAIL: expected v0 53, received v1 5`로 종료하라.

1. abap_activate
2. abap_debug_breakpoint
3. abap_debug_session
4. abap_debug_stack
5. abap_debug_status
6. abap_debug_step
7. abap_debug_variable
8. abap_download
9. abap_fs_documentation
10. adt_discovery_export
11. analyze_abap_dumps
12. analyze_abap_traces
13. compare_abap_systems
14. create_mermaid_diagram
15. create_object_programmatically
16. create_test_documentation
17. create_test_include
18. detect_mermaid_diagram_type
19. execute_data_query
20. find_where_used
21. get_abap_dependency_graph
22. get_abap_diagnostics
23. get_abap_object_info
24. get_abap_object_lines
25. get_abap_object_url
26. get_abap_object_workspace_uri
27. get_abap_sql_syntax
28. get_atc_decorations
29. get_batch_lines
30. get_connected_systems
31. get_mermaid_documentation
32. get_object_by_uri
33. get_sap_capabilities
34. get_sap_system_info
35. get_version_history
36. inspect_abap_code
37. manage_abap_versions
38. manage_abapgit
39. manage_heartbeat
40. manage_rap_generator
41. manage_text_elements
42. manage_transport_requests
43. open_object
44. read_deferred_result
45. refactor_abap_code
46. replace_string_in_abap_object
47. run_abap_application
48. run_atc_analysis
49. run_sap_transaction
50. run_unit_tests
51. search_abap_object_lines
52. search_abap_objects
53. validate_mermaid_syntax

각 도구에 대해 discovery에서 title, input schema, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` 존재 여부를 확인하라. 기준 fixture상 31개는 read-only이고 22개는 non-read-only이며, 15개는 destructive다. 실제 discovery 집계가 다르면 차이를 보고하라.

## 결과 상태

각 tool/action에는 다음 중 하나만 사용하라.

- `EXECUTED-LIVE`: 실제 호출에 성공했고 핵심 응답 구조를 검증함
- `EXECUTED-EXPECTED-ERROR`: 안전하게 호출했으며 권한·capability·전제조건 오류가 계약대로 반환됨
- `DISCOVERED-DEFERRED`: 도구와 schema는 확인했지만 이 단계에서 허용된 무변경 action이 없음
- `SKIP-PREREQUISITE`: 두 번째 system, debugger session, dump, trace, repository 등 명시적 전제조건이 없음
- `UNSUPPORTED`: 선택한 SAP release 또는 ADT endpoint가 명시적으로 지원하지 않음
- `FAIL`: schema 불일치, 잘못된 응답, 예상하지 못한 오류 또는 계약 위반

`EXECUTED-EXPECTED-ERROR`, `SKIP-PREREQUISITE`, `UNSUPPORTED`를 PASS로 바꾸지 마라.

## 실행 순서

### A. Surface 및 system baseline

1. 53개 tool inventory를 먼저 완성한다.
2. `get_connected_systems`로 CONNECTION_ID가 존재하고 credential이 사용 가능한지 확인한다.
3. `get_sap_system_info`를 `includeComponents: false`로 호출한다.
4. 반환된 profile environment가 `production`이면 이 무변경 단계만 계속할 수 있지만, 보고서 상단에 `MUTATION-PROHIBITED`를 표시한다. 2단계 실행은 금지한다.
5. `get_sap_capabilities`를 `includeEvidence: true`로 호출하고 category별 상태를 저장한다.
6. tool schema와 1단계 discovery를 기준으로 감사 기준인 150개 action/응답 변형의 ledger를 만든다. 현재 surface에서 확인할 수 없는 변형은 성공으로 채우지 말고 `NOT-DISCOVERABLE`과 근거를 기록한다. 지금 실행하지 않는 변형도 누락하지 말고 defer/skip 이유를 기록한다.

### B. Repository read chain

아래 도구는 KNOWN_OBJECT_NAME과 실제 반환 URI를 연결하여 호출한다. URI를 직접 조립하지 마라.

- `search_abap_objects`: exact 또는 좁은 pattern, 최대 20개
- `get_abap_object_info`: 기본 응답 후 `includeStructure: true`는 선택적으로 한 번
- `get_abap_object_lines`: 첫 100줄 이내
- `search_abap_object_lines`: literal 한 번, regexp 한 번
- `get_batch_lines`: 같은 object의 작은 두 range
- `get_object_by_uri`: 앞 단계가 반환한 실제 `/sap/bc/adt/...` URI
- `get_abap_object_url`
- `get_abap_object_workspace_uri`
- `open_object`: headless/URL 반환만 허용
- `find_where_used`: references 기본 경로와, 지원될 때 bounded snippets 경로
- `get_abap_dependency_graph`: 작은 depth/node limit
- `get_abap_diagnostics`: active source, bounded page
- `get_version_history`: list와 안전한 source/compare read action
- `inspect_abap_code`: schema에 노출된 semantic action 8개를 ledger에 올리고, 유효한 line/column을 찾을 수 있는 action만 bounded 호출

빈 검색 결과는 호출 성공일 수 있지만 capability 지원 근거로는 사용하지 마라.

### C. Analysis 및 quality

- `get_abap_sql_syntax`를 먼저 읽는다.
- OPTIONAL_SAFE_SQL이 있으면 `execute_data_query`를 internal/headless mode, 최대 10행으로 호출한다. 없으면 `SKIP-PREREQUISITE`다.
- `run_atc_analysis`는 KNOWN_OBJECT_NAME 하나만 대상으로 실행한다. finding documentation은 실제 `docUri`가 반환된 경우에만 한 번 읽는다.
- `get_atc_decorations`는 같은 object/file에 대해 bounded 호출한다.
- `run_unit_tests`는 KNOWN_OBJECT_TYPE이 unit-test 가능한 경우에만 summary 모드로 실행한다.
- OPTIONAL_SECOND_CONNECTION_ID가 있으면 `compare_abap_systems`를 같은 object에 대해 실행한다. 없으면 skip한다.

ATC와 Unit 실행은 repository mutation은 아니지만 server load를 발생시킨다. 대량 package/transport scope로 확대하지 마라.

### D. Operations의 안전 action

현재 schema를 읽고 아래의 read/list/status/detail action만 선택한다.

- `analyze_abap_dumps`: list, 실제 dump가 있을 때 bounded analyze
- `analyze_abap_traces`: list/configuration/read-only detail만; start/stop/delete 금지
- `manage_heartbeat`: list/status/detail/history만; create/update/delete/schedule/execute 금지
- `adt_discovery_export`: summary만 먼저 실행; full/file export는 LOCAL_TEMP_DIR에만 허용
- `run_sap_transaction`: URL 생성 action만; OS/SAP GUI launch 금지

schema에 안전 action이 없거나 객체가 없으면 발견 사실과 skip 이유만 기록한다.

### E. Debugger의 무변경 상태 확인

- `abap_debug_status`를 호출한다.
- `abap_debug_session`은 status action이 schema에 있을 때만 호출한다. start/stop은 금지한다.
- 기존 disposable debug session이 명시적으로 제공된 경우에만 `abap_debug_stack`과 `abap_debug_variable`을 읽는다.
- `abap_debug_breakpoint`와 `abap_debug_step`은 `DISCOVERED-DEFERRED`로 둔다.

없는 session을 만들기 위해 debugger action을 실행하지 마라.

### F. Grouped write tool의 안전 action 또는 defer

action enum과 설명을 먼저 읽고, 다음 원칙을 적용한다.

- `manage_text_elements`: read action만
- `manage_transport_requests`: list/read/status/check/assurance 계열만; create/update/release/delete 금지
- `manage_abapgit`: list/status/log/read 계열만; clone/pull/stage/push 금지
- `manage_rap_generator`: schema/read/validate/dry-run/preview까지만; generate/publish 금지
- `manage_abap_versions`: list/source/compare까지만; restore 금지
- `refactor_abap_code`: 결과가 명백히 무변경인 preview action만; execute 금지
- `run_abap_application`: `repl_health`와 preview까지만 허용; execute 금지
- `create_object_programmatically`, `create_test_include`, `replace_string_in_abap_object`, `abap_activate`는 안전 action이 없으므로 `DISCOVERED-DEFERRED`

preview가 planId와 confirmation을 반환해도 이 단계에서는 execute하지 말고 값 자체도 보고서에서 마스킹하라.

### G. 로컬 artifact 및 download

SAP 상태를 변경하지 않는 다음 도구는 LOCAL_TEMP_DIR에서 최소 입력으로 실행한다.

- `validate_mermaid_syntax`: 유효한 flowchart와 잘못된 syntax 각 한 번
- `detect_mermaid_diagram_type`
- `get_mermaid_documentation`: 예제 제외 기본 호출
- `create_mermaid_diagram`: 작은 flowchart 한 개
- `create_test_documentation`: screenshot 없는 최소 scenario 한 개
- `abap_fs_documentation`: get 한 번, search 한 번
- `abap_download`: KNOWN_OBJECT_NAME 한 개만 LOCAL_TEMP_DIR로 받고 manifest/summary를 확인

생성된 로컬 파일의 경로와 크기만 기록하고 내용을 보고서에 그대로 복사하지 마라.

### H. Deferred result

앞선 bounded 요청 중 `compact-v1`/`resultId`가 실제 반환되면 `read_deferred_result`의 offset 연속성과 `done`을 검증한다. 그런 결과가 없으면 일부러 무제한 대형 SAP 호출을 만들지 말고 `SKIP-PREREQUISITE`로 기록한다.

## 최종 보고서 형식

다음 순서로 한국어 보고서를 작성하라.

1. `Verdict`: `PASS-SAFE`, `PARTIAL`, `SURFACE-FAIL`, `FAIL`, `STOP-SAFETY` 중 하나
2. system baseline: connection ID, client, SAP release, profile environment, 민감정보를 제거한 capability 요약
3. surface summary: `expected 53 / advertised N / missing N / extra N / duplicate N`
4. annotation summary: `read-only N / non-read-only N / destructive N`
5. variant summary: `catalogued N/150 / executed N / deferred N / skipped N / failed N`
6. 53행 coverage table:
   `# | tool | annotation | tested action/variant | status | evidence summary | phase-2 reason`
7. 오류 table:
   `tool/action | MCP error code | HTTP status | ADT endpoint | sanitized SAP text | 재현 조건`
8. 생성된 로컬 산출물 목록
9. 2단계 진입 가능 여부와 그 근거

53행 table이 완성되기 전에는 테스트가 끝났다고 말하지 마라. 테스트하지 않은 도구를 성공으로 계산하지 마라.
~~~~

## 프롬프트 2 — 격리 fixture 실제 변경, 실행 및 완전 정리

1단계가 `PASS-SAFE` 또는 안전상 허용 가능한 `PARTIAL`로 끝났을 때만 아래 블록을 새 메시지로 붙여 넣는다.

~~~~text
너는 SAP ABAP MCP의 mutation acceptance test lead다. v0의 53개 tool 중 1단계에서 defer된 write, execute, debugger, transport, Git, RAP action을 전용 fixture에서 검증하고, 생성한 SAP 상태를 모두 정리해야 한다. 안전한 cleanup이 확인되지 않으면 어떤 기능 성공보다 우선하여 `FAIL-SAFETY`로 판정하라.

## 필수 입력값

- CONNECTION_ID: <development profile>
- EXPECTED_CLIENT: <SAP client>
- TEST_PACKAGE: <이 실행 전용 package, 권장 Z_MCP_ACCEPTANCE>
- TRANSPORT_REQUEST: <이 실행 전용 open transport>
- RUN_ID: <대문자 영숫자 6자리>
- LOCAL_TEMP_DIR: <이 실행 전용 local directory>

## 선택 입력값

- SECOND_CONNECTION_ID: <compare용, 없으면 NONE>
- DISPOSABLE_ABAPGIT_REPOSITORY: <전용 remote URL, 없으면 NONE>
- RELEASE_VALID_RAP_FIXTURE: <현재 SAP release에서 사전 syntax-check된 fixture, 없으면 NONE>
- SAFE_TRANSACTION_CODE: <URL 생성/선택적 launch용, 없으면 NONE>
- REPL_EXPECTED: <true|false>

필수 입력이 하나라도 없으면 도구를 호출하지 말고 한 번에 요청하라. placeholder transport나 예시 object를 실제 값처럼 사용하지 마라.

## fixture 이름

모든 새 객체는 이름에 `MCP_TEST`와 현재 RUN_ID를 모두 포함해야 한다. SAP 이름 길이를 넘지 않도록 다음 패턴을 사용하라.

- 주 class: `ZCL_MCP_TEST_<RUN_ID>`
- batch class A: `ZCL_MCP_TEST_A_<RUN_ID>`
- batch class B: `ZCL_MCP_TEST_B_<RUN_ID>`
- report: `ZMCP_TEST_<RUN_ID>`
- RAP fixture: 제공된 release-valid 이름에 RUN_ID를 반영하되 모든 dependent object를 manifest에 명시

RUN_ID를 소문자로 바꾼 값은 ABAP source 안의 식별자에만 사용한다.

## 절대 안전 규칙

1. `get_sap_system_info`의 profile environment가 `production`이면 즉시 `STOP-SAFETY`로 종료한다. 이 값은 독립적인 SAP production 탐지가 아니라 MCP profile 설정임을 보고서에 명시한다.
2. TEST_PACKAGE가 profile의 non-empty `allowedPackages`에 포함되지 않으면 mutation을 시작하지 않는다.
3. TEST_PACKAGE, TRANSPORT_REQUEST, 이름에 `MCP_TEST`와 RUN_ID가 모두 있는 fixture 외에는 절대로 변경하지 않는다.
4. 시작 전 exact-name 및 `*MCP_TEST*<RUN_ID>*` 검색이 0건이어야 한다. 충돌이 있으면 기존 object를 재사용하거나 지우지 말고 중단한다.
5. TRANSPORT_REQUEST에 fixture와 무관한 object가 하나라도 있으면 중단한다.
6. 첫 write 전에 생성·변경·실행·삭제 예정 목록, 예상 tool/action, transport를 표로 보여주고 사용자에게 정확히 `START-MUTATION <RUN_ID>`를 입력해 달라고 요청한다. 그 문구를 받기 전에는 write tool을 호출하지 않는다.
7. preview/execute 도구는 fresh preview가 반환한 planId와 confirmation을 수정하지 않고 사용한다. plan은 10분 안에 실행하며 stale/consumed plan 오류를 우회하지 않는다.
8. transport release/delete, abapGit push, RAP publish, SAP transaction 실제 launch는 각각 irreversible 또는 외부 영향이 있으므로 일반 mutation 승인과 별도로 직전 사용자 승인을 받는다. 승인받지 못하면 해당 action은 `SKIP-EXPLICIT-APPROVAL`이다.
9. class 실행과 snippet 실행은 preview된 exact target/code만 한 번 실행한다. 같은 execute 요청의 replay가 거부되는지도 확인한다.
10. 오류가 나면 parameter shape나 ADT URI를 추측해 재시도하지 않는다. MCP error code, HTTP status, endpoint, sanitized SAP response를 보존하고 cleanup으로 이동한다.
11. 생성한 object를 cleanup하지 못하면 테스트를 성공으로 판정하지 않는다.
12. credential, 사용자, host, token, cookie, CSRF, session ID, confirmation 원문은 최종 보고서에서 제거한다.

## 변경 전 baseline 및 manifest

1. 1단계의 53-tool inventory와 150-variant ledger를 불러오거나 다시 만든다.
2. `get_connected_systems`, `get_sap_system_info`, `get_sap_capabilities(includeEvidence: true)`를 같은 MCP process에서 호출한다.
3. TEST_PACKAGE의 존재와 package metadata를 read-only 도구로 확인한다.
4. TRANSPORT_REQUEST의 owner/status/object list를 read-only action으로 확인한다.
5. 네 개 기본 fixture 이름과 RUN_ID wildcard를 검색하여 충돌이 0건인지 확인한다.
6. mutation manifest와 cleanup 역순을 제시하고 `START-MUTATION <RUN_ID>` 승인을 기다린다.

## 실행 시나리오

### 1. 객체 생성 계약

- `create_object_programmatically`로 세 class와 report를 `activate: false`, `source` 없이 생성한다.
- `CLAS/OC`와 `PROG/P`에 create-time source를 넣지 않는다. create-time source와 create-time activation은 현재 `BDEF/BDO`에서만 허용된다.
- 각 create 결과의 object type, name, package, source URI, transport 기록을 검증한다.
- 생성 직후 read 도구로 SAP가 만든 skeleton을 읽는다.

### 2. Source write, diagnostics 및 activation

- `replace_string_in_abap_object`는 방금 읽은 skeleton의 exact current text를 대상으로 사용한다. blind overwrite를 하지 않는다.
- 주 class에는 `IF_OO_ADT_CLASSRUN` 출력 `MCP_TEST_<RUN_ID>_OK`와 단순 public method를 넣는다.
- report에는 상태를 변경하지 않는 단순 출력문을 넣는다.
- batch class A/B에는 method body 안에만 harmless marker comment를 둔다. class section 사이에 고립된 comment를 두지 않는다.
- 각 write 뒤 `get_abap_diagnostics`를 실행하고 E/error가 0일 때만 활성화한다.
- single `abap_activate`와 두 class를 한 요청으로 보내는 batch `abap_activate`를 각각 검증한다.
- batch 결과는 `status: complete`이며 두 object 모두 activated일 때만 성공이다.

### 3. Test include, ABAP Unit 및 ATC

- `create_test_include`로 주 class의 test include를 만든다.
- 생성된 include URI를 읽고, production method를 검증하는 최소 local test class source를 exact replacement로 작성한다.
- diagnostics 0 error, activation 성공 후 `run_unit_tests`의 summary/failures/all 변형을 bounded 방식으로 검증한다.
- `run_atc_analysis`를 object scope로 실행하고 finding이 있으면 실제 반환된 docUri로 documentation을 한 건만 읽는다.
- `get_atc_decorations`의 one-file/all-files 변형을 bounded page로 검증한다.

### 4. Repository 및 semantic chain

- 1단계의 repository read chain을 새 fixture에 대해 다시 실행한다.
- `inspect_abap_code`의 schema에 노출된 8개 semantic action을 유효한 method token line/column으로 검증한다.
- definition은 referenced identifier 내부 column만 주고 `endColumn`을 생략하는 경로도 포함한다.
- `find_where_used`, `get_abap_dependency_graph`, `get_version_history`, optional `compare_abap_systems`를 fixture에 대해 실행한다.
- pagination, compact-v1, deferred-result가 발생하면 offset 연속성과 bounded response를 검증한다.

### 5. Text elements, versions 및 refactoring

- `manage_text_elements`의 read를 먼저 실행하고 report에 전용 text symbol을 create/update한 뒤 다시 읽어 exact state를 확인한다.
- harmless source comment를 한 번 변경·활성화하여 version history와 compare 변형을 만든다.
- `manage_abap_versions`의 read/list/source/compare를 검증한다. restore mutation은 schema가 요구하는 preview/confirmation 또는 state check를 그대로 따르고 fixture의 직전 known-good version만 대상으로 한다.
- `refactor_abap_code`의 preview action들을 ledger에 올린다. format, quick-fix, rename, package move, extract-method, delete는 fixture와 현재 source가 안전한 action만 실행한다.
- preview diff가 fixture 밖의 object를 포함하거나 예상과 다르면 execute하지 않는다.
- rename/move를 실행했다면 manifest와 cleanup target을 즉시 실제 반환 이름/package로 갱신한다.

### 6. Application 실행

- `run_abap_application`으로 주 class를 preview한다.
- exact planId/confirmation으로 한 번 실행하고 output에 `MCP_TEST_<RUN_ID>_OK`가 있는지 확인한다.
- 같은 execute를 두 번째 호출하여 one-use plan 거부를 확인한다. 새 preview를 만들어 replay 검사를 통과시키지 않는다.
- `REPL_EXPECTED=true`이면 `repl_health`가 valid이고 `health.production=false`일 때만 exact snippet `WRITE / 'MCP_REPL_<RUN_ID>_OK'.`를 preview/execute한다.
- 실행 성공 후 fresh `get_sap_capabilities(includeEvidence: true)`에서 해당 capability evidence를 확인한다.

### 7. Debugger

- schema와 SAP authorization을 확인한 뒤 disposable fixture만 대상으로 debug session을 시작한다.
- 주 class/report의 정확한 실행 line에 breakpoint를 설정한다.
- session이 실제로 suspended된 경우에만 stack, variables, status, 각 step type을 순서대로 검증한다.
- 모든 breakpoint를 제거하고 session을 stop한 뒤 status에서 잔여 session이 없는지 확인한다.
- 외부 trigger가 없어 suspend할 수 없으면 반복 실행하지 말고 `SKIP-PREREQUISITE`로 기록한다.

### 8. Transport

- `manage_transport_requests`의 schema상 13개 action을 ledger에 모두 기록한다.
- list/detail/status/object/check/assurance 등 read action을 먼저 실행한다.
- create/update/assignment 계열은 TRANSPORT_REQUEST 또는 그 하위 disposable task에서만 실행하고 결과를 다시 읽어 확인한다.
- release/delete는 별도 승인을 받기 전에는 실행하지 않는다. SAP에서 되돌릴 수 없다는 점과 exact target을 승인 요청에 명시한다.

### 9. abapGit

- DISPOSABLE_ABAPGIT_REPOSITORY가 NONE이면 모든 Git mutation은 `SKIP-PREREQUISITE`다.
- 값이 있으면 전용 repository인지 먼저 확인하고 list/status/log/read를 실행한다.
- staging은 fresh SAP snapshot을 사용하고 fixture object를 명시적으로 선택한다. `stageAll=true`는 전용 repository임이 검증된 경우에만 허용한다.
- pull/push는 exact diff와 remote를 제시하고 별도 승인을 받은 뒤 실행한다.

### 10. RAP

- RELEASE_VALID_RAP_FIXTURE가 NONE이면 schema/read/validate/dry-run/preview까지만 실행하고 generation은 `SKIP-PREREQUISITE`다.
- 값이 있으면 현재 SAP release에서 사전 검증된 content만 사용한다. syntax를 즉석에서 발명하거나 다른 release fixture를 수정해 사용하지 않는다.
- validation, content validation, dry-run preview를 generation 직전에 다시 실행한다.
- preview manifest가 전용 package/transport와 RUN_ID dependent object만 포함할 때만 generate한다.
- service publication은 별도 승인 없이는 실행하지 않는다.

### 11. Operations 및 local artifacts

- dump/trace가 있으면 list/detail/analyze를 bounded 호출한다. 테스트를 위해 dump를 의도적으로 만들지 않는다.
- trace start/stop과 heartbeat mutation은 전용 ID와 cleanup action이 schema에서 확인되는 경우에만 수행하고 종료/삭제 상태를 다시 읽는다.
- transaction은 URL 생성을 검증한다. 실제 launch는 SAFE_TRANSACTION_CODE와 별도 승인이 있을 때만 한 번 실행한다.
- Mermaid, documentation, discovery export, download 산출물은 LOCAL_TEMP_DIR에만 생성하고 manifest를 기록한다.

## 실패 시와 정상 종료 시 cleanup

cleanup은 성공 여부와 관계없이 실행하되, 다른 object를 지울 위험이 생기면 즉시 멈추고 수동 조치 목록을 작성한다.

1. debugger breakpoint/session, trace, heartbeat task 등 runtime state를 먼저 종료한다.
2. RAP dependent object가 생성됐다면 dependency 역순으로 제거한다. `BDEF/BDO` generic deletion이 live-verified되지 않았다면 추측 호출하지 말고 정확한 수동 ADT cleanup으로 이관한다.
3. rename/move 이후의 실제 이름과 package를 다시 조회한다.
4. 각 repository object마다 `refactor_abap_code`의 fresh `preview_delete`를 얻고 exact confirmation으로 한 개씩 삭제한다.
5. class 세 개, report, test include, text element 및 모든 generated dependent object를 accounting한다.
6. exact-name 검색과 `*MCP_TEST*<RUN_ID>*` wildcard 검색 결과가 모두 0인지 확인한다.
7. transport에 fixture 외 object가 없는지 재검사하고 최종 disposition을 기록한다. release/delete는 별도 승인 없이는 하지 않는다.
8. disposable Git remote와 local artifact의 최종 상태를 기록한다.

## 최종 판정

- `PASS-FULL`: 53/53 advertised, 계획한 live action 모두 성공, 선택 prerequisite도 제공되어 검증됐고 cleanup 0 residue
- `PASS-CORE`: repository create/write/diagnostics/activate/test/analysis/execute/delete가 성공하고 cleanup 0 residue, 선택 기능은 명확히 skip
- `PARTIAL`: 안전과 cleanup은 확인됐지만 필수 core action 일부가 authorization/capability 문제로 미검증
- `FAIL`: 기능 또는 계약 실패가 있으나 cleanup은 완전함
- `FAIL-SAFETY`: object/runtime/transport/Git/RAP residue가 남았거나 cleanup 상태를 증명하지 못함
- `STOP-SAFETY`: production, allowlist, collision, shared transport 등으로 mutation 전 중단

## 최종 보고서

1. verdict와 cleanup verdict를 첫 줄에 분리하여 표시
2. source MCP version/commit, connection/client/release/profile environment
3. `53/53` tool coverage table과 `N/150` variant coverage ledger
4. 생성·변경·실행·삭제된 fixture manifest
5. capability별 `supported|unsupported|unverified` 및 sanitized evidence
6. 오류별 MCP code, HTTP status, ADT endpoint, sanitized SAP text
7. 별도 승인으로 실행하지 않은 irreversible action 목록
8. exact-name와 wildcard cleanup 0건 증거
9. transport, debugger, trace, heartbeat, Git, RAP, local artifact 최종 상태

cleanup 증거가 없으면 어떤 경우에도 “전체 성공”이라고 말하지 마라.
~~~~
