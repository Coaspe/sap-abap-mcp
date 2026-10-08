# 릴리즈 준비 상태 — 2026-10-06

현재 상태 그대로 안정판을 릴리즈하는 것은 권장하지 않는다. 배포는 수행하지 않았다. 릴리즈 버전 및 게시 대상도 확정하지 않았다.

## 통과한 검증

- 최신 문서 응답 개선 소스의 격리된 테스트 복사본에서 전체 회귀 테스트 698/698 통과.
- stdio 시작 검사 5개 모드 통과: default/minimal 5, adaptive 17, full 120, single 1개 도구.
- 기존 문서 호출의 HTML 응답을 유지한다. format=text를 명시한 호출만 기본 4,000자 페이지를 사용한다. 문서 합성 fixture의 첫 MCP 응답 추정 토큰은 47,882에서 8,276으로 감소했다. 실서비스 전체 모델 사용량 감소를 의미하지 않는다.
- 검증 복사본에서 만든 tarball을 빈 프로젝트에 설치해 기존 HTML 호출, 텍스트 페이지, 전체 문서 복원 및 stdio 5개 모드를 확인했다. 이는 비공개 검증용 패키지이며 최종 원본 릴리즈 패키지는 아니다.
- 원본 src 80개 파일과 검증 복사본의 일치를 확인하고 원본 dist/src를 검증된 빌드와 동기화했다. 원본 node_modules는 보존한 뒤 같은 lockfile로 npm ci를 완료했다.

## 릴리즈를 막는 항목

1. 같은 의존성 lockfile의 새 production audit에서 취약 의존성 8개 항목(높음 4, 보통 2, 낮음 2)이 남았다. 높음 항목은 node-forge와 이를 포함한 jks-js 및 SAP Cloud SDK 경로이며, 서로 독립된 취약점 4건이라는 의미는 아니다. CI는 npm audit --omit=dev를 실행한다. npm이 제시한 상위 패키지 대폭 다운그레이드를 안전한 호환 업데이트로 취급하거나 audit fix --force로 일괄 적용하지 않는다.
2. 프로젝트의 제안된 v1 프로필 적합성 검사에서 sap.quality.unit_test 및 sap.transport.assess의 읽기 전용성이 미검증으로 남아 passed=false다. 같은 검사가 현재 CI와 설치된 패키지 검증에 포함돼 있다. 일반 MCP 프로토콜 전체 부적합 판정으로 확대하지 않는다.
3. 원본 작업 공간의 버전 메타데이터는 여전히 1.7.1이며 변경은 미커밋 상태다. 새 의존성 설치 후에도 원본 컴파일러가 4분 이상 진행하지 않아 종료했다. 원본 npm pack은 파일 읽기 취소로 실패했다. 원본 환경의 빌드·포장 성공은 미검증이다. 검증 복사본의 성공을 원본 전체 패키지 성공으로 확대하지 않는다. 새 버전, changelog, manifests, 해당 커밋의 CI와 최종 tarball 설치 검증을 완료해야 한다.

## 보안 대안 검증

별도 복사본에서 SAP Cloud SDK connectivity/http-client를 4.2.0으로 변경했다. 빌드 및 회귀 테스트 698/698이 통과했고 감사는 높음 0, 보통 2, 낮음 2가 됐다. 원본에는 적용하지 않았다. 이전 SDK는 JKS/keystore 인증서를 거절하고 OnPremise agent caching 동작도 다르다. 공개된 저수준 destination transport에 전달 가능한 인증서의 지원 범위가 줄어들 수 있으므로 단순 보안 수정으로 합치지 않는다. 실제 SAP/BTP 연결 검증도 수행하지 않았다. 근거는 sdk-security-alternative.json, sdk-4.2-audit.json 및 sdk-4.2-regression.log에 있다.

## 다음 순서

취약 의존성은 공식 수정 또는 지원 범위를 보존한 패치 배포 경로를 확보한다. 프로젝트 프로필은 실행 기능을 필수 읽기 전용 core에서 분리하는 기존 후보를 검토한다. readOnlyHint를 거짓으로 바꾸거나 CI 검사를 생략하지 않는다. 이후 최종 빌드·포장 환경을 확인하고 버전 메타데이터를 맞춰 새 tarball을 설치 검증한다. 안정판 토큰 절감 주장은 실제 사용량 근거 범위에 한정한다. 현재 사용자 제공 Windows/SAP 결과는 이전 B ZIP 대상이며 새 문서 응답 코드를 검증한 결과는 아니다.

근거 파일: artifacts/release-readiness-2026-10-06/audit.json 및 conformance.json. node-forge 공식 권고: https://github.com/advisories/GHSA-86w9-cpqp-85rv . 버전 호환성 정책 참고: https://semver.org/ .
