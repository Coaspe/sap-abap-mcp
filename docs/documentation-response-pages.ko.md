# ABAP 언어 문서 응답 개선 — 2026-10-06

`sap.semantic.documentation`은 기존 호출의 HTML 응답을 유지한다. `format:"text"`를 지정하면 HTML의 스타일·스크립트·태그를 제외한 텍스트를 최대 4,000 Unicode 문자까지 반환한다. 이 도구는 ABAP 언어 키워드 문서를 읽는다. 클래스·메서드의 구현 근거는 `sap.source.read`, 공개 계약은 `sap.semantic.components`로 확보한다.

```json
{
  "systemId": "DEV100",
  "fileUri": "adt://DEV100/sap/bc/adt/oo/classes/zcl_demo/source/main",
  "line": 3,
  "column": 8,
  "format": "text"
}
```

다음 내용이 필요하면 같은 문서 위치를 유지하고 `offset`에 응답의 `nextOffset`을 전달한다. `maxChars`는 1~16,000이며 기본값은 4,000이다. 오프셋은 Unicode 문자 단위다. 각 응답의 `documentHash`가 바뀌면 이전 페이지와 합치지 않고 첫 페이지부터 다시 읽는다. `nextOffset=null`이면 마지막 페이지다. 매 요청에서 SAP 문서를 다시 읽으므로 페이지 수를 늘리면 SAP 읽기도 늘어난다.

원래 HTML을 페이지로 읽으려면 `format:"html"`로 요청한다. HTML도 같은 페이지 제한을 적용하며 전 페이지를 연결해 원문을 복원할 수 있다. `format`·`offset`·`maxChars`를 모두 생략하면 v1의 기존 HTML 응답 동작을 유지한다. 텍스트 모드에서는 그림·스타일·스크립트 등 HTML 표현 요소를 생략한다. v0의 기존 문서 응답 동작도 유지했다. v1 입력 스키마가 바뀌므로 gateway 사용자는 현재 schemaHash를 describe로 받아야 한다.

## 검증

큰 스타일 영역과 ABAP 예제, 표, 한글 및 emoji가 있는 합성 HTML로 실제 MCP CallToolResult JSON을 측정했다. 기존 96KiB HTML 제한 분기의 결과를 같은 v1 envelope로 감싼 값과 `format:"text"`의 첫 응답을 비교했다.

| 지표 | 기존 응답 | 새 텍스트 페이지 |
| --- | ---: | ---: |
| JSON bytes | 197,364 | 28,868 |
| o200k_base 추정 토큰 | 47,882 | 8,276 |

이 fixture에서는 응답 bytes가 85.4%, 추정 토큰이 82.7% 줄었다. 페이지 전체 내용이 아니라 명시적으로 선택한 첫 텍스트 응답의 비교다. 실제 사용자 SAP 문서, Codex 전체 사용량 또는 기존 A/B 실패 원인을 검증한 수치가 아니다.

전체 회귀 테스트는 698/698 통과했다. 새 테스트는 기본 페이지 제한, 예제·표 유지, Unicode 경계, 텍스트·HTML 전 페이지 복원, 문서 변경 해시, 빈 문서·범위 밖 페이지, 입력 검증 및 v0 동작을 확인한다. SAP 서버에는 접속하거나 변경하지 않았다.

이 개선은 로컬 소스에 적용됐다. 기존 봉인 ZIP과 클라우드 npm 설치본에는 포함되지 않는다.
