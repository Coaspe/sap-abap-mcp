> 2026-10-06 당시 기록입니다. 이후 수정 및 검증 상태는 [2026-10-08 릴리즈 준비 기록](release-readiness-2026-10-08.ko.md)을 확인하세요.

# 릴리즈 차단 항목 처리 — 2026-10-06

## 완료한 수정

문서 응답 호환성을 보존했다. v1 sap.semantic.documentation에서 새 format/offset/maxChars를 생략하면 기존 HTML 응답을 유지한다. format=text를 명시하면 기본 4,000자 페이지를 반환한다. 큰 원문 HTML도 명시적인 페이지 읽기로 전체를 복원할 수 있다. 서버 메타데이터는 텍스트 페이지 사용을 안내한다. 수정 후 698/698 회귀 테스트가 통과했다.

## 보안 의존성 처리 판단

2026-10-06 공개 npm 메타데이터와 실제 설치 소스를 확인했다. 현재 보안 감사의 8개 항목은 세 가지 근본 권고가 상위 의존성까지 전파된 결과다. 공식 수정이 없는 상태에서 대폭 다운그레이드하거나 audit 경고를 숨겨 릴리즈 가능한 것으로 만들지 않는다.

| 근본 패키지 | 현재 경로 | 안전한 처리에 필요한 것 |
| --- | --- | --- |
| node-forge 1.4.0 | SAP SDK → jks-js → PKCS#12 및 인증서 변환 코드 | 공식 수정 버전 또는 검증·유지 가능한 패치 배포 경로. 프로젝트의 user-destination은 ClientCertificateAuthentication을 거절하며 jks-js에서는 RSA verify 호출을 찾지 못했지만, 이 정적 관찰만으로 전체 앱의 비악용성 또는 감사 통과를 선언하지 않는다. |
| sprintf-js 1.1.3 | abap-adt-api의 objectcreator가 서버 metadata의 creationPath를 포맷 | 공식 수정 버전 또는 ADT 라이브러리의 안전한 포맷 처리 수정. 최신 abap-adt-api 8.4.3에도 같은 의존성이 있어 업데이트만으로 경고가 없어지지 않는다. |
| KaTeX 0.16.x | Mermaid 런타임과 배포용 mermaid.min.js 안에 번들된 코드 | 수정된 KaTeX를 포함한 Mermaid 배포물 검증. KaTeX 자체는 0.18.2부터 수정됐지만 Mermaid 최신 12.1.0도 의존성 ^0.16.47을 선언한다. root overrides만 바꾸면 이미 번들된 취약 코드가 남는다. |

npm overrides는 root package에서만 적용되므로 이 프로젝트의 override만으로 npm 소비자의 설치를 보호한다고 가정하지 않는다. 수정된 배포물을 검증하려면 별도의 빈 프로젝트에 tarball을 dependency로 설치해야 한다. 이번에는 의존성 fork, 런타임 monkey patch, 감사 예외 또는 CI 완화를 적용하지 않았다.

SDK 4.2.0 대안은 별도 복사본에서 빌드 및 698/698 회귀 테스트를 통과했고 높음 감사 항목이 0개가 됐다. 그러나 JKS/keystore 인증서 지원과 OnPremise agent caching 동작이 달라 원본 의존성은 유지했다. 감사 항목 감소만으로 공개 API의 호환성 또는 실제 BTP 연결이 검증됐다고 보지 않는다. 후보 결과는 artifacts/release-readiness-2026-10-06/sdk-security-alternative.json에 보존했다.

공식 근거:

- node-forge 권고: https://github.com/advisories/GHSA-86w9-cpqp-85rv
- 미병합 수정 PR: https://github.com/digitalbazaar/forge/pull/1152
- sprintf-js 권고: https://github.com/advisories/GHSA-hp3w-g68c-fv3c
- KaTeX 권고: https://github.com/advisories/GHSA-238p-pmpm-9mq7
- npm override의 적용 범위: https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides

## 프로필 검사 처리 판단

서버가 ABAP Unit 및 transport assessment를 readOnlyHint=false로 표시하는 것은 적절하다. 응용 테스트 실행은 쓰기 부작용이 있을 수 있다. 이를 true로 바꿔 기존 프로필을 통과시키지 않는다.

기존 profile/v1 1.0.0 제안은 이 두 실행 기능을 필수 읽기 전용 core에 잘못 포함한다. 수정 후보와 공개 토론 초안은 docs/competitive-profile-review-2026-10-02에 준비돼 있다. 공개 게시·승인·규격 변경은 수행하지 않았다. spec/GOVERNANCE.md는 토론을 최소 14일 열고, 규격 변경에 validator·test·CHANGELOG를 함께 요구한다. 현재 CI 검사를 건너뛰거나 이 미승인 후보의 통과를 기존 규격 통과로 보고하지 않는다.

## 릴리즈 순서

1. 기존 호출 호환성 유지와 로컬 회귀 검증은 완료했다.
2. 같은 src 80개 파일의 검증용 빌드와 tarball 설치 검증은 완료했다. 원본 dist/src도 동기화했다. 원본 node_modules를 보존한 뒤 같은 lockfile로 다시 설치했지만 원본 빌드·포장은 아직 성공을 확인하지 못했다. 최종 릴리즈 패키지를 별도로 확인해야 한다. 검증용 package는 공개 npm 릴리즈가 아니다.
3. 공식 의존성 수정 또는 별도로 검토한 유지 가능한 수정 경로를 정하고 감사·설치 검증을 다시 통과시킨다.
4. 프로필 계약의 공개 검토를 거쳐 규격과 검사 기준을 함께 정정한다.
5. 그 후 릴리즈 버전을 정하고 메타데이터·changelog·CI를 맞춰 공개 배포한다.

현재 판단은 안정판 보류다. 로컬 단위 테스트 통과와 합성 fixture의 추정 토큰 감소가 보안·규격·실제 사용량의 남은 검증을 대신하지 않는다.
