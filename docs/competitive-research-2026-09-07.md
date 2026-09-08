# SAP ABAP MCP 경쟁 조사 및 개선 결과

조사일: 2026-09-07. 결론: 기능 개수보다 **작업을 끝내는 흐름, 실행 근거,
배포 재현성**을 개선해야 한다. 현재 확인한 자료만으로 세계 최고라는 순위를
입증할 수는 없다. 경쟁 제품을 동일 SAP 시스템에서 실행한 성능 비교가 아니라,
공식 문서·개발자 저장소와 우리 구현을 대조한 조사다.

## 비교 기준과 소스

후속 고정 스키마 실측: npm ARC-1 1.2.0의 스키마 생성 결과와 우리 실제
`tools/list`를 같은 토크나이저로 비교했다. 우리 adaptive 모드는 6,583 대
ARC-1 10,756토큰이다. 우리 기존 minimal 모드는 883토큰으로 ARC-1의
hyperfocused 209토큰보다 컸다. 후속 구현한 선택형 single 모드는 같은
측정에서 209토큰이다. 고정 스키마 비용은 같지만 전체 작업 비용이나
기능·권한 범위가 동등하다는 뜻은 아니다.
[버전·측정 방식·재현 명령·한계](arc-1-schema-comparison.md)를 함께 확인한다.

후속 기본값 변경: 현재 로컬 CLI와 새 브라우저 등록은 minimal(5개 게이트웨이,
883 스키마 토큰)을 기본으로 사용한다. 소스 검토·문법 검사 fixture에서
추가 탐색 호출을 포함해 adaptive보다 집계 토큰이 16.4% 적었다.
[동일 작업의 모드 비교와 한계](workflow-mode-benchmark.md)를 참고한다.
이는 실제 모델 과금이나 SAP 작업 성공률을 입증한 결과는 아니다.

2026-09-08 재확인: **ARC-1은 핵심 직접 경쟁자다.** 아래 초기 조사와
후속 구현 기록을 함께 읽어야 한다. ARC-1의 현재 README는 12개 의도 기반
도구와 1개 도구 모드, KTD·의존 공개 계약의 단일 컨텍스트 호출, BTP 사용자
신원 전달을 설명한다. 도구 수만으로 우리보다 토큰 비용이 낮다고 단정할 수는
없으며, 같은 작업의 스키마·요청·응답과 실제 모델 사용량을 비교해야 한다.
우리 로컬에는 이후 ETag 캐시, 조건부 소스 응답, 선택적 KTD와 공개 선언
보기가 추가됐고, 명시적 공개 타입의 한 단계 의존 계약을 모으는 기능도 구현했다.
KTD도 같은 공개 API 응답에 선택적으로 포함할 수 있다. 남은 차이는 전체
의존성 범위와 재귀 상속 해석,
BTP 신원 연동의 실환경 검증 및 실제 SAP에서의 비교 검증이다.
현재 로컬에는 Destination Service 기반 사용자별 전송과 BTP 프로필·진단을
실험적으로 구현했다. 아래의 ‘미구현’ 표현은
각 기록 시점의 판정이며 후속 구현 결과로 대체된다.

핵심 경쟁자 재확인 결과, BTP 연동은 단순한 HTTP 전송 교체로 끝나지 않는다.
현재 ADT 라이브러리의 custom transport가 `statelessClone`에 전달되지 않아
정의 탐색·자동완성 경로가 실패하는 것을 로컬에서 재현했다. 별도로 생성되는
디버그 실행 클라이언트까지 같은 사용자 신원으로 연결해야 한다.
[BTP 연동 설계와 재현 근거](btp-destination-integration.md)에 이 완료 조건을
추가했다. 이 조사는 BTP 기능 구현 또는 ARC-1 대비 우위 달성을 뜻하지 않는다.

후속 구현: 전송 팩토리를 주 클라이언트·stateless clone·디버그 실행에서
유지하도록 수정했다. 로컬 HTTP 및 디버그 fixture로 쿠키·CSRF·304·사용자
토큰 유지와 세션 분리·로그아웃을 검증했고 전체 516개 테스트가 통과했다.
MCP 도구는 추가하지 않았다. Destination Service와 신원 교환 구현,
실제 BTP에서의 권한 검증은 여전히 남아 있다.

현재 작업 폴더는 Git `e93e5c6` 기반 `1.3.1`이며 기존 미커밋 변경이 있었다.
조사 시 npm `latest`는 `1.6.0`이었다. npm 패키지도 직접 받아 확인했으며,
그 패키지에도 이번에 추가한 네이티브 MCP 프롬프트는 없고 의존성 순회 구현은
동일했다. 작업 폴더와 배포 패키지의 다른 기능을 혼동하지 않도록 구분했다.
배포 계열에는 적응형 도구 표면 구현도 있으므로 도구 선택 최적화 전체를
미구현으로 분류하지 않았다.

| 비교 대상 | 공개된 강점과 근거 | 우리 프로젝트와의 실질적 차이 |
|---|---|---|
| ARC-1 | 12개 의도 기반 도구·1개 도구 모드, KTD와 의존 공개 계약 컨텍스트, ETag 캐시, BTP 사용자 신원 전달 및 live SAP 검증 경로를 공개한다. [개발자 README](https://github.com/arc-mcp/arc-1) | 핵심 직접 경쟁자다. 우리 개별 KTD·공개 선언 조회를 ARC-1의 통합 컨텍스트와 동등하게 계산하지 않는다. 아래 별도 비교에서 초기 격차와 후속 구현 상태를 구분한다. |
| SAP 공식 ADT MCP | SAP의 ADT 환경 안에서 제공하며 외부 MCP 호스트도 로컬 HTTP·bearer token으로 연결한다. [SAP 설정 문서](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802) | 공식 제품 통합이 강점이다. 우리 제품은 독립 Node.js 실행과 자체 정책·증거 보고서가 강점이며, 공식 인증이나 공식 도구의 완전 호환을 주장해서는 안 된다. |
| OpenADT | 공식 SAP 도구와 자체 LSP 도구를 묶고, 객체 생성·RAP·OData·활성화 및 테스트 프롬프트를 제공한다. [개발자 문서](https://github.com/abapify/openadt/blob/main/docs/openadt-mcp.md) | IDE 화면이 열려 있어야만 경쟁 제품을 쓸 수 있다는 비교는 부정확하다. 우리는 ADT 런타임 의존성이 없는 점으로 차별화해야 한다. 네이티브 프롬프트 부재는 이번에 개선했다. |
| VSP / vibing-steampunk | AMDP 디버깅, dump와 application log 상관 분석, job/spool 및 RFC 흐름을 설명하고 일부 시스템별 실행 근거와 한계도 공개한다. [개발자 README](https://github.com/oisee/vibing-steampunk/blob/main/README.md) | 우리도 ABAP 디버거·dump·trace를 제공하지만 이들 운영 분석을 같은 깊이로 제공한다고 입증하지 못했다. 공개된 경쟁 실행 기록은 저자의 주장으로, 독립 재현 결과와 구별해야 한다. |
| fr0ster/mcp-abap-adt | BTP·온프레미스 연결, service-key/auth-broker 흐름, 브라우저 OAuth와 HTTP/RFC 연결 옵션을 문서화한다. [개발자 README](https://github.com/fr0ster/mcp-abap-adt/blob/main/README.md) | 우리도 Basic·OAuth·PKCE·HTTP 인증을 구현했다. 단순히 OAuth가 없다고 평가하면 틀리며, 실제 고객 환경의 로그인 성공률과 갱신·복구 경험으로 비교해야 한다. |
| williansaez/abap-adt-mcp | 다중 시스템, 서버 정책, 작업 예시·내장 프롬프트, 출력 크기 제어와 배포/테스트 절차를 공개한다. [개발자 README](https://github.com/williansaez/abap-adt-mcp) | 도구 개수는 품질의 증거가 아니다. 사용자 목표를 도구 호출 순서로 연결하는 경험과 실행 결과를 설명하는 방식이 비교할 지점이다. |

링크는 조사일에 읽은 공개 문서이며 이후 변경될 수 있다. SAP의 일부 도구
목록 페이지는 본문 추출이 되지 않아 상세 도구별 동등성이나 라이선스 조건은
추정하지 않았다. 이번 조사를 위해 경쟁 MCP를 고객 SAP에 연결하거나 실제
SAP의 소스를 변경하지 않았다.

## 발견한 격차와 우선순위

### ARC-1 누락 정정

초기 조사에서 **ARC-1을 누락했다**. 현재 저장소는
[arc-mcp/arc-1](https://github.com/arc-mcp/arc-1)이며, 독립 ADT MCP 서버라는
점에서 직접 경쟁자다. 아래 항목을 포함하면 비교 대상은 총 6종이다.
프롬프트 추가와 의존성 중복 조회 수정은 유효하지만, 그것만으로 주요 경쟁
격차를 해소했다고 볼 수 없다.

| 비교 축 | ARC-1 공개 근거 | 우리 구현 확인 및 판정 |
|---|---|---|
| 기업용 BTP 운영 | XSUAA, Destination Service, Cloud Connector, 사용자별 token exchange와 BTP Audit Log 연동을 문서화한다. [README](https://github.com/arc-mcp/arc-1#authentication) | HTTP·OIDC·Docker·사용자별 제한은 이미 있다. 그러나 `README.md`의 token exchange 제한에서 Cloud Connector 및 `OAuth2UserTokenExchange` 미구현을 명시한다. 단순 JWT 전달과 이 기능은 다르며, 기업 배포에서는 중요한 격차다. |
| 반복 조회와 컨텍스트 효율 | SAP ETag 재검증, 활성/비활성별 캐시 및 변경 후 무효화, 소스 해시 기반 의존성 캐시를 설명한다. [캐시 문서](https://github.com/arc-mcp/arc-1/blob/main/docs/caching.md) | 현재 소스 읽기 경로에는 동등한 ETag 재검증 캐시를 확인하지 못했다. 기존 결과/작업계획 캐시는 다른 기능이다. 이번 중복 순회 수정은 한 요청 안의 최적화로, 요청 사이의 재사용까지 해결하지 않는다. |
| 객체 이해 | `SAPContext`에서 KTD 문서와 의존 객체의 공개 계약을 결합하는 흐름을 제공한다. [도구 설명](https://github.com/arc-mcp/arc-1#tools-refined-for-real-world-usage) | 우리 where-used 그래프와 읽기·설명 프롬프트는 동일한 기능이 아니다. 압축된 객체 이해 컨텍스트를 실제 동일 과제로 비교할 필요가 있다. |
| 실제 SAP 검증 체계 | live integration/E2E, CRUD·BTP smoke, 느린 SAP 테스트의 별도 실행 경로를 문서화한다. [테스트 설명](https://github.com/arc-mcp/arc-1#testing) | 우리 421개 로컬 테스트와 stdio 검사는 실제 SAP 성공률을 증명하지 않는다. 경쟁사의 테스트 개수와 실행 성공 여부도 구분해야 하며, 이번에는 경쟁 CI를 직접 실행하지 않았다. |

ARC-1 본문 README와 세부 캐시 문서에는 자동 캐시 저장 방식 설명이 서로
다른 부분이 있어, HTTP에서 SQLite가 기본이라는 단정은 하지 않는다. 세부
캐시 문서는 전송 방식과 무관하게 메모리가 기본이고 SQLite는 명시적 선택이라고
설명한다. 공개 문서의 배수 성능 주장도 독립 측정값으로 인용하지 않는다.

보완된 우선순위는 다음과 같다. 완료된 두 개선은 유지하되, **객체 이해·캐시와
BTP 사용자 신원 연동**을 별도 핵심 격차로 올린다.

| 우선순위 | 격차 | 이번 결과 및 남은 완료 기준 |
|---|---|---|
| P0 | 배포 패키지와 작업 폴더의 소스 기준이 다름 | 차이를 실측했다. 자동 병합·덮어쓰기를 하지 않았다. 다음 릴리스는 1.6.0 원본과 로컬 작업의 의도된 차이를 보존하며 하나의 커밋·태그·패키지로 재현해야 한다. |
| P1 | 객체 이해 컨텍스트와 안전한 반복 조회 캐시 | ARC-1의 KTD·의존 계약 컨텍스트 및 ETag 재검증과 비교한다. 우리 프롬프트·중복 순회 개선은 완료했지만, 사용자/시스템/소스 버전 격리와 외부 변경 재검증을 갖춘 요청 간 캐시는 별도 구현·검증이 필요하다. |
| P1 | BTP 기업 운영과 사용자 신원 연동 | 기존 OIDC·Docker를 재구현하는 대신 Destination Service·Cloud Connector·token exchange·BTP Audit Log 격차를 해결한다. 실제 BTP 환경에서 사용자별 SAP 권한 및 신원 전달을 검증해야 한다. |
| P1 | 실제 SAP 환경별 비교 근거 부족 | 로컬 테스트를 실환경 검증으로 표시하지 않는다. 동일한 개발 과제를 ECC·S/4HANA·ABAP Cloud에서 실행해 성공률·왕복 호출·실패 원인을 기록해야 한다. |
| P2 | AMDP와 운영 장애 분석의 폭 | VSP의 공개 기능과 격차를 기록했다. endpoint·세션·권한을 실제 개발 환경에서 검증한 뒤 작은 기능 단위로 구현해야 하며, 확인하지 않은 SAP API를 만들어 내지 않는다. |

## 구현한 개선

`src/mcp/v1/workflow-prompts.ts`는 기존 도구를 조합하는 네 가지 프롬프트를
제공한다. 프롬프트 조회 자체는 SAP를 호출하지 않는다. 전체 도구 표면에 새
도구를 추가하지 않아 기존 도구 스키마 크기가 증가하지 않는다. 필요한 도구가
빠진 프리셋에서는 해당 워크플로를 노출하지 않으며 viewer에게 변경 워크플로를
제공하지 않는다. 실제 쓰기 권한은 기존 서버 정책이 계속 집행한다.

변경 워크플로는 현재 소스·호출자 확인, 정확한 단일 치환, 진단, 활성화,
ABAP Unit·ATC 결과 확인을 안내한다. 테스트 없음·검사 불가·불완전 결과를
성공과 구별하도록 한다. 이것은 모델을 위한 실행 지침이며, 새로 구현한 서버
측 자동 트랜잭션이나 모든 모델의 준수를 보증하는 장치는 아니다.

의존성 그래프는 객체 식별자 기준으로 한 번만 큐에 넣는다. 호출 위치 fragment를
후속 객체 조회에서 제거한다. 순환·URI 별칭 재현 사례에서 where-used 호출이
**5회에서 2회**로 줄었다. 이 숫자는 테스트 사례의 결과이며 실 SAP 전체에서
60% 성능 향상을 보장한다는 뜻이 아니다. `coverage`가 탐색 범위를 드러내고,
기존 `truncated` 의미와 v0/v1 입력 계약은 유지한다.

구현 API는 [MCP SDK 공식 문서](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md)와
[ABAP ADT API 공식 저장소](https://github.com/marcellourbani/abap-adt-api/blob/master/_autodocs/api-reference/api-syntax-refactor.md)를
Context7에서 확인했다. 사용법과 제한은 [워크플로 문서](workflow-prompts.md)에 있다.

## 재현 가능한 검증과 다음 품질 기준

기존 테스트는 402개가 통과했다. 추가 검증은 실제 MCP Client와 in-memory
transport, SAP test double을 사용한다. 기본 stdio 검사는 별도 프로세스에서
120개 도구·7개 Resource와 프롬프트를 조회한다. `conformance:v1`은 저장소가
정의한 호환 프로파일 검사이며 경쟁사 인증이나 SAP 인증이 아니다.

최종 결과: **421/421 테스트 통과**, stdio에서 **120개 도구·7개 Resource·
4개 프롬프트** 확인, 호환 프로파일 통과, 도구 표면 측정 완료. `npm pack
--dry-run`으로 새 프롬프트 실행 파일과 두 문서가 패키지에 포함되는 것도
확인했다. 이 검증에서는 실제 SAP 호출을 하지 않았다.

```sh
npm test
npm run smoke:v1
npm run conformance:v1
npm run benchmark:surface
```

“최고”를 평가할 다음 비교 실험은 동일한 SAP 개발 시스템, 권한, 객체,
모델과 과제로 실시해야 한다. 설명·버그 수정·transport 평가·RAP 계획 과제에
대해 성공/실패/검사 불가를 나누고, 호출 수·소요 시간·도구 스키마 바이트 및
불필요한 변경을 기록한다. 스키마 바이트를 토큰으로 환산한 추정치와 모델의
실제 토큰 사용량을 혼동하지 않는다. 원본 고객 소스나 식별 정보를 공개하지
않는 증거로 비교 결과를 남긴다.

이번 결과물은 로컬 구현과 재현 가능한 검증까지다. npm 게시·GitHub push·
실제 SAP 작업 완료 또는 세계 1위 달성으로 표시하지 않는다.

## 후속 구현 상태 — 2026-09-07

위 421개 테스트 및 초기 격차 표는 최초 조사 시점의 기록이다. 이후 로컬
구현에서는 다음과 같이 진전했다. ARC-1과 동일 과제를 실행한 승률 비교는
아직 하지 않았다.

- [Adaptive 탐색](adaptive-mode.md): 기본 17개 도구에서 전체 120개 기능을
  필요할 때 발견·호출한다. 전체 스키마 167,672바이트 대비 기본
  26,457바이트이며 실제 모델 토큰 사용량 측정은 아니다.
- [소스 ETag 캐시](source-cache.md): 연결별 메모리 격리, 매번 재검증,
  버전 분리와 변경 후 무효화를 구현했다. 초기 표의 캐시 미구현 판정은
  이 후속 구현으로 대체한다. 실제 SAP 호환성 검증은 남아 있다.
- [조건부 소스 응답](conditional-source-reads.md): 이전 범위를 보유한
  호출자에게 변경 여부를 반환하고 중복 코드를 생략한다. 고정 테스트
  사례의 응답 바이트 감소는 실제 업무 토큰 절감 보장이 아니다.
- [구성요소 탐색](component-navigation.md): 중첩 경로·공개 범위 필터와
  페이지 처리를 제공한다. KTD와 의존 객체 공개 계약을 결합하는
  ARC-1 SAPContext와 동등하다고 보지는 않는다.
- 현재 로컬 검증 기준은 453개 테스트, 기본 17/전체 120 도구 stdio 검사,
  직접 도구 모드의 호환 프로파일 검사다. BTP 사용자 신원 교환,
  실제 SAP 환경별 성공률, 소스·패키지 릴리스 기준 통합은 미완료다.

### KTD 조회 경로 확인

후속 코드 조사에서 현재 `sap.semantic.documentation`은
`abap-adt-api.abapDocumentation`을 호출하는 언어 도움말 기능임을 확인했다.
ARC-1의 KTD는 별도의 설계 문서이며 같은 기능으로 표시하면 안 된다.
[ARC-1 ADT 클라이언트](https://github.com/arc-mcp/arc-1/blob/main/src/adt/client.ts)는
`/sap/bc/adt/documentation/ktd/documents/{lowercase-name}`에서
`application/vnd.sap.adt.sktdv2+xml` 표현을 읽고,
[컨텍스트 처리](https://github.com/arc-mcp/arc-1/blob/main/src/handlers/context.ts)는
XML에서 문서 내용을 해석한 뒤 의존성 문맥과 합친다.
우리 KTD 지원은 아직 미구현이다. 추가 시 SAP discovery·권한·XML 표현·
네임스페이스·문서 부재·응답 길이 제한을 확인해야 한다.

이 경로 조사에서 발견한 공통 소스 조회 오류 처리는 먼저 수정했다.
권한 거부·요청 제한·서버 장애가 대체 경로 탐색에 가려지지 않으며,
404/405/501 호환성 응답에서만 다음 소스 후보를 시도한다. 이는 KTD
지원 자체를 구현한 것으로 계산하지 않는다.

### KTD 후속 구현

위 미구현 판정 이후 [선택적 KTD 조회](knowledge-transfer-documents.md)를
`sap.repository.inspect`에 추가했다. Unicode 페이지·문서 해시·엄격한 XML 및
Base64 해석·권한 오류 보존을 로컬 검증했다. 기본 도구 수는 17개를 유지하며
스키마는 364바이트 늘었다. 실제 SAP 지원 버전과 통합된 의존 계약 문맥은
여전히 별도 검증·구현 과제다.

### 선언된 공개 API 문맥 — 2026-09-08

[공개 API 보기](public-api-view.md)를 기존 구성요소 도구에 추가했다.
ABAP 구문 분석기로 공개 메서드·타입 선언의 정확한 원본 구간을 반환하고,
비공개 선언과 구현을 제외한다. 상속·의존 객체를 재귀적으로 해석한 API
계약은 아니며 해당 격차는 남아 있다. 분석기는 요청 시 로드하고 기본
17개 도구의 스키마 크기는 늘리지 않았다.

후속 구현으로 ABAP Doc과 명시적 상위 클래스·공개 인터페이스 참조 위치를
포함했다. `includeRelated=true`는 현재 페이지에서 최대 5개 참조를 SAP
정의 이동으로 확인하고 관련 공개 선언을 한 응답에 모은다. 원본과 관련
계약은 32KiB 텍스트 예산을 공유하며 중복 대상을 다시 읽지 않는다.
기본 17개 스키마는 26,821바이트를 유지하고 전체 120개 스키마는
168,411바이트다. 478개 로컬 테스트와 기본/전체 stdio 검사가 통과했다.
이는 한 단계의 명시적 공개 타입 관계 지원으로, 모든 호출·DDIC 의존성,
재귀 상속 병합 또는 ARC-1과의 실 SAP 동등성 검증을 완료한 것은 아니다.
