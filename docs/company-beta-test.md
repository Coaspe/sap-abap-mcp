# 회사 Claude Code에서 1.7.0-beta.1 검증하기

공개 npm 배포 없이 전달받은 `coaspe-sap-abap-mcp-1.7.0-beta.1.tgz`를 회사에서 SAP에 접근 가능한 PC/개발 환경에 설치합니다. 별도 클라우드 서비스 배포는 필요하지 않습니다. MCP 프로세스가 그 환경에서 실행되어 기존 SAP ADT에 접속합니다. Node.js 20 이상이 필요하며, 최초 설치에는 의존성을 받을 npm 또는 사내 미러 접근이 필요합니다. 압축 파일 하나에 모든 의존성이 포함되지는 않습니다.

## 전달할 파일

같은 전달 폴더의 `.tgz`, `BUILD-INFO.json`, `SHA256SUMS.txt`를 함께 복사합니다. BUILD-INFO의 소스 커밋과 SHA-256을 확인하세요. 과거 `1.3.1.tgz`는 이번 검증 대상이 아닙니다. npm `@latest`도 이번 베타가 아닙니다.

## Claude Code에 붙여넣을 프롬프트

```text
현재 회사 환경에서 전달받은 SAP ABAP MCP 1.7.0-beta.1을 공개 배포 없이 검증해 줘.

1. 현재 폴더의 coaspe-sap-abap-mcp-1.7.0-beta.1.tgz와 BUILD-INFO.json,
   SHA256SUMS.txt를 확인하고 SHA-256 및 패키지 버전이 일치하는지 검증해.
   Node.js는 20 이상이어야 해. 별도 sap-abap-beta-test 폴더에
   npm install --prefix <테스트폴더> --omit=dev --ignore-scripts --no-audit --no-fund <tgz절대경로>
   로 설치해. 기존 npm 설치나 MCP 설정을 덮어쓰지 마.

2. 설치된 node_modules/@coaspe/sap-abap-mcp/package.json이 1.7.0-beta.1인지
   확인하고, 해당 패키지 폴더에서 node scripts/smoke-v1-stdio.mjs 및
   node scripts/check-profile-conformance.mjs를 실행해.
   이것은 SAP 연결 없이 검증하는 단계야.

3. 실제 실행은 node <설치된패키지절대경로>/dist/src/index.js를 사용해.
   @latest, npx 원격 버전, 예전 1.3.1을 사용하지 마.
   기존 사용 가능한 개발/품질 프로필을 먼저 확인해.
   없으면 이 엔트리포인트의 setup 또는 onboard로 내가 직접 인증정보를
   입력하도록 안내해. 비밀번호/토큰을 채팅이나 결과 파일에 기록하지 마.
   내가 읽어도 되는 기존 CLAS 또는 INTF 하나를 선택하게 해.

4. 해당 패키지 폴더에서 아래 명령을 실제 프로필과 객체로 바꿔 실행해:
   node scripts/live-read-context.mjs --profile <프로필ID> --object <객체명> --type <객체타입> --output <결과JSON절대경로>
   소스 조건부 재조회, public API/관련 타입, KTD 상태를 확인해.
   KTD 미지원/없음, 잘림, 미해결 관련 타입을 성공으로 숨기지 마.
   코드 쓰기/생성/활성화/삭제, SQL 데이터 조회, 전송 릴리스는 하지 마.

5. Claude Code의 현재 지원 설정 방식을 확인해서 별도 이름 sap-abap-beta로
   이 절대 엔트리포인트 + serve --preset minimal을 연결해.
   재시작이 필요하면 알려줘. 실제 이 서버의 도구 목록 5개와 capability discovery,
   선택한 객체의 소스 읽기를 확인해. 기존 서버와 결과를 섞지 마.
   마지막으로 버전, 소스 커밋, 실행 경로, 로컬 검사와 실제 SAP 검사 결과,
   실패 단계/오류 코드/시간/응답 크기 및 미검증 항목을 보고해.
   외부 공유용 요약에는 회사 코드, 인증정보, 내부 URL 및 객체/시스템 식별자를 제외해.
```

이 범위의 통과는 읽기 기능 검증입니다. 쓰기/활성화/ABAP Unit/전송 및 BTP 사용자 토큰 교환의 성공을 의미하지 않습니다. 결과 JSON에도 프로필/객체 식별자가 있으므로 외부 전달 전 제거하세요.
