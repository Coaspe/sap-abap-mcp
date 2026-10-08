import { ONBOARD_ENGLISH } from "./onboard-english.js"

function scriptValue(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

export function onboardPage(token: string, nonce: string, locale: "ko" | "en" = "ko", hostManaged = false): string {
  const text = (korean: string) => locale === "en" ? ONBOARD_ENGLISH[korean] ?? korean : korean
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${text("SAP 개발 환경 시작하기")}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light;
      --ink: #10233f;
      --muted: #607089;
      --line: #dbe4ef;
      --paper: #f4f7fb;
      --panel: #ffffff;
      --blue: #0a6ed1;
      --blue-deep: #074f9d;
      --cyan: #00a6d6;
      --green: #188918;
      --amber: #a15c00;
      --red: #bb0000;
      --shadow: 0 18px 55px rgba(23, 52, 87, .12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(115deg, rgba(10, 110, 209, .08), transparent 42%),
        var(--paper);
      color: var(--ink);
      font-family: "Segoe UI", "Malgun Gothic", sans-serif;
    }
    button, input, select, textarea { font: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
    .masthead { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
    .brand { display: flex; align-items: center; gap: 13px; }
    .brand-mark {
      display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px;
      background: var(--ink); color: white; font: 700 13px/1 Bahnschrift, "Segoe UI", sans-serif;
      letter-spacing: .08em;
    }
    .brand strong { display: block; font-size: 15px; }
    .brand span { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
    .locale-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
    .local-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #b7d7f5;
      border-radius: 999px; background: #eef7ff; color: var(--blue-deep); font-size: 12px; font-weight: 700;
    }
    .local-badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
    .workspace { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 24px; align-items: start; }
    .rail, .panel { background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); }
    .rail { position: sticky; top: 24px; border-radius: 18px; padding: 18px; }
    .rail-title { margin: 2px 4px 18px; font: 700 12px/1 Bahnschrift, "Segoe UI", sans-serif; color: var(--muted); letter-spacing: .08em; }
    .step { position: relative; display: flex; gap: 12px; padding: 11px 8px 18px; color: var(--muted); }
    .step:not(:last-child)::after { content: ""; position: absolute; left: 21px; top: 39px; bottom: -1px; width: 2px; background: var(--line); }
    .step-dot {
      position: relative; z-index: 1; flex: 0 0 28px; display: grid; place-items: center; width: 28px; height: 28px;
      border: 2px solid var(--line); border-radius: 50%; background: white; font: 700 11px/1 Bahnschrift, sans-serif;
    }
    .step strong { display: block; margin-top: 1px; font-size: 14px; color: inherit; }
    .step small { display: block; margin-top: 3px; font-size: 11px; }
    .step.active { color: var(--blue); }
    .step.active .step-dot { border-color: var(--blue); box-shadow: 0 0 0 5px rgba(10, 110, 209, .1); }
    .step.done { color: var(--ink); }
    .step.done .step-dot { border-color: var(--green); background: var(--green); color: white; }
    .step.done:not(:last-child)::after { background: var(--green); }
    .panel { border-radius: 22px; overflow: hidden; }
    .panel-head { padding: 34px 38px 28px; border-bottom: 1px solid var(--line); }
    .eyebrow { margin: 0 0 10px; color: var(--blue); font: 700 12px/1 Bahnschrift, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    h1 { max-width: 650px; margin: 0; font: 700 clamp(28px, 4vw, 44px)/1.13 Bahnschrift, "Segoe UI", sans-serif; letter-spacing: -.025em; }
    .lede { max-width: 670px; margin: 14px 0 0; color: var(--muted); font-size: 15px; line-height: 1.7; }
    .panel-body { padding: 30px 38px 38px; }
    .view[hidden], .fields[hidden], #write-packages[hidden] { display: none; }
    .section-title { margin: 0 0 6px; font-size: 19px; }
    .section-copy { margin: 0 0 20px; color: var(--muted); font-size: 14px; line-height: 1.6; }
    .check-grid, .client-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .check, .client-card, .profile-card {
      border: 1px solid var(--line); border-radius: 14px; background: #fbfdff; padding: 16px;
    }
    .check { display: flex; gap: 12px; align-items: flex-start; }
    .status-icon { flex: 0 0 22px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #eef2f7; color: var(--muted); font-size: 12px; font-weight: 800; }
    .ready .status-icon { background: #e5f5e5; color: var(--green); }
    .warn .status-icon { background: #fff3dc; color: var(--amber); }
    .check strong, .client-card strong { display: block; font-size: 14px; }
    .check span, .client-card p { display: block; margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 24px; }
    .button {
      display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border: 0;
      border-radius: 10px; background: var(--blue); color: white; font-weight: 700; text-decoration: none; cursor: pointer;
      transition: background .15s ease, transform .15s ease;
    }
    .button:hover { background: var(--blue-deep); transform: translateY(-1px); }
    .button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, #title:focus-visible { outline: 3px solid rgba(10, 110, 209, .28); outline-offset: 2px; }
    .button.secondary { border: 1px solid var(--line); background: white; color: var(--ink); }
    .button.secondary:hover { background: #f4f8fc; }
    .button.small { min-height: 36px; padding: 0 13px; font-size: 12px; }
    .button:disabled { background: #bac5d1; color: white; cursor: not-allowed; transform: none; }
    details { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 14px; }
    summary { width: fit-content; color: var(--blue-deep); font-size: 13px; font-weight: 700; cursor: pointer; }
    .file-list { display: grid; gap: 7px; margin-top: 12px; }
    .file-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 10px; border-radius: 8px; background: #f5f8fb; font: 12px/1.4 Consolas, monospace; }
    .file-row b { flex: 0 0 auto; font-family: "Segoe UI", sans-serif; color: var(--muted); }
    .profiles { display: grid; gap: 10px; margin-bottom: 22px; }
    .profile-card { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
    .profile-card strong { display: block; }
    .profile-card span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; color: var(--muted); font-size: 12px; }
    .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }
    form { display: grid; gap: 16px; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
    label { display: grid; gap: 7px; color: var(--ink); font-size: 13px; font-weight: 700; }
    label.wide { grid-column: 1 / -1; }
    label small { color: var(--muted); font-weight: 400; line-height: 1.4; }
    input, select { width: 100%; min-height: 43px; border: 1px solid #bdcadd; border-radius: 9px; background: white; color: var(--ink); padding: 9px 11px; }
    input::placeholder { color: #98a6b8; }
    .secret-note { display: flex; gap: 9px; align-items: flex-start; padding: 12px; border-radius: 10px; background: #eef7ff; color: var(--blue-deep); font-size: 12px; line-height: 1.5; }
    .secret-note::before { content: "●"; color: var(--green); }
    .client-card { min-height: 178px; display: flex; flex-direction: column; }
    .client-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .client-name { font: 700 20px/1 Bahnschrift, "Segoe UI", sans-serif; }
    .pill { padding: 5px 8px; border-radius: 999px; background: #eef2f7; color: var(--muted); font-size: 10px; font-weight: 800; }
    .pill.ready { background: #e5f5e5; color: var(--green); }
    .pill.warn { background: #fff3dc; color: var(--amber); }
    .client-card .button { margin-top: auto; align-self: flex-start; }
    .registration-values { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
    .notice { min-height: 0; margin-top: 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
    .notice:not(:empty) { padding: 12px 14px; background: #fff3dc; color: #704200; }
    .notice.error:not(:empty) { background: #ffebeb; color: var(--red); }
    .notice.success:not(:empty) { background: #e5f5e5; color: #135f13; }
    .busy { opacity: .62; pointer-events: none; }
    #sap-form.busy #cancel-profile { pointer-events: auto; }
    #cancel-profile[hidden] { display: none; }
    [data-auth][hidden] { display: none; }
    #sap-form textarea { min-height: 140px; width: 100%; resize: vertical; }
    .finish {
      min-height: 330px; display: grid; place-items: center; text-align: center;
      background: radial-gradient(circle at 50% 42%, rgba(0, 166, 214, .12), transparent 42%);
    }
    .finish-mark { width: 74px; height: 74px; display: grid; place-items: center; margin: 0 auto 22px; border-radius: 50%; background: var(--green); color: white; font-size: 36px; box-shadow: 0 0 0 12px rgba(24, 137, 24, .1); }
    .finish h2 { margin: 0; font: 700 30px/1.2 Bahnschrift, sans-serif; }
    .finish p { max-width: 520px; margin: 12px auto 0; color: var(--muted); line-height: 1.7; }
    #first-prompt { display: block; width: 100%; min-height: 110px; margin: 18px 0 12px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; background: white; color: var(--ink); line-height: 1.6; resize: vertical; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (max-width: 820px) {
      .workspace { grid-template-columns: 1fr; }
      .rail { position: static; display: flex; overflow-x: auto; }
      .rail-title, .step small { display: none; }
      .step { flex: 0 0 auto; padding: 8px 13px 8px 6px; align-items: center; }
      .step:not(:last-child)::after { display: none; }
    }
    @media (max-width: 620px) {
      .rail { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: visible; }
      .shell { width: min(100% - 20px, 1120px); padding-top: 18px; }
      .masthead { align-items: flex-start; }
      .local-badge { display: none; }
      .panel-head, .panel-body { padding-left: 22px; padding-right: 22px; }
      .check-grid, .client-grid, .fields { grid-template-columns: 1fr; }
      label.wide { grid-column: auto; }
      .profile-card { align-items: flex-start; flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
  </style>
</head>
<body>
  <div class="shell">
    <header class="masthead">
      <div class="brand"><div class="brand-mark">ABAP</div><div><strong>${text("SAP 개발 환경 시작하기")}</strong><span>${hostManaged ? "SAP ABAP MCP" : "Claude · Codex · SAP ABAP MCP"}</span></div></div>
      <div class="locale-actions"><div class="local-badge">${text("이 PC에서만 실행 중")}</div><a class="button secondary small" id="locale-switch" href="/?token=${encodeURIComponent(token)}&amp;lang=${locale === "ko" ? "en" : "ko"}" lang="${locale === "ko" ? "en" : "ko"}">${locale === "ko" ? "English" : "한국어"}</a></div>
    </header>
    <main class="workspace">
      <nav class="rail" aria-label="${text("설정 단계")}">
        <p class="rail-title">ONBOARDING</p>
        <div class="step active" data-step="1" aria-current="step"><div class="step-dot">1</div><div><strong>${text("PC 확인")}</strong><small>${text("설치 상태 점검")}</small></div></div>
        <div class="step" data-step="2"><div class="step-dot">2</div><div><strong>${text("SAP 연결")}</strong><small>${text("로그인 및 검증")}</small></div></div>
        <div class="step" data-step="3"><div class="step-dot">3</div><div><strong>${text("도구 연결")}</strong><small>${text(hostManaged ? "앱이 등록을 관리합니다" : "MCP 자동 설정")}</small></div></div>
        <div class="step" data-step="4"><div class="step-dot">4</div><div><strong>${text("완료")}</strong><small>${text("바로 시작")}</small></div></div>
      </nav>
      <section class="panel">
        <header class="panel-head">
          <p class="eyebrow" id="eyebrow">${text("Step 1 · PC 확인")}</p>
          <h1 id="title" tabindex="-1">${text("필요한 준비가 되어 있는지 먼저 확인할게요.")}</h1>
          <p class="lede" id="lede">${text("설치된 항목은 그대로 사용하고, 부족한 부분만 안내합니다. 기존 설정 파일은 덮어쓰지 않습니다.")}</p>
        </header>
        <div class="panel-body">
          <section class="view" data-view="1">
            <h2 class="section-title">${text("자동 점검 결과")}</h2>
            <p class="section-copy">${text(hostManaged ? "앱이 제공하는 실행 환경을 사용합니다. Node/npm이나 별도 CLI를 설치할 필요가 없습니다." : "Claude 또는 Codex 중 하나만 준비되어 있어도 계속할 수 있습니다.")}</p>
            <div class="check-grid" id="checks" aria-live="polite"></div>
            <details ${hostManaged ? "hidden" : ""}><summary>${text("설정 파일 상세 보기")}</summary><div class="file-list" id="files"></div></details>
            <div class="notice" id="environment-notice" role="status"></div>
            <div class="actions"><button class="button secondary" id="refresh" type="button">${text("다시 확인")}</button><button class="button" id="to-sap" type="button" disabled>${text("SAP 연결 설정")}</button></div>
          </section>
          <section class="view" data-view="2" hidden>
            <h2 class="section-title">${text("사용할 SAP 시스템")}</h2>
            <p class="section-copy">${text("저장된 연결이 있으면 다시 확인해 사용하고, 없으면 새로 추가하세요.")}</p>
            <div class="profiles" id="profiles"></div>
            <div class="divider" id="profile-divider">${text("새 연결 추가")}</div>
            <form id="sap-form">
              <div class="fields">
                <label class="wide">${text("인증 방식")}<select name="authType"><option value="basic">${text("SAP ID · 비밀번호")}</option><option value="btp_service_key">${text("BTP ABAP 서비스 키 가져오기")}</option><option value="oauth_authorization_code">${text("브라우저 로그인 · OAuth PKCE")}</option><option value="oauth_client_credentials">${text("OAuth 클라이언트 인증")}</option></select><small>${text("회사에서 허용한 인증 방식을 선택하세요.")}</small></label>
                <label>${text("연결 이름")}<input name="id" required maxlength="32" placeholder="DEV100" autocomplete="off"><small>${text("이 SAP 시스템을 구분할 짧은 이름")}</small></label>
                <label data-auth="basic oauth_client_credentials oauth_authorization_code">${text("SAP 클라이언트")}<input name="client" required inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" placeholder="100"></label>
                <label class="wide" data-auth="basic oauth_client_credentials oauth_authorization_code">SAP URL<input name="url" type="url" required placeholder="https://sap.company.com" autocomplete="url"></label>
                <label data-auth="basic">${text("SAP 사용자 ID")}<input name="username" required autocomplete="username" placeholder="${text("사번 또는 SAP ID")}"></label>
                <label data-auth="basic">${text("SAP 비밀번호")}<input name="password" type="password" required autocomplete="current-password"></label>
                <label class="wide" data-auth="btp_service_key" hidden>${text("BTP 서비스 키 JSON")}<textarea name="serviceKey" required disabled maxlength="24576" autocomplete="off" spellcheck="false" placeholder="${text("BTP에서 발급받은 ABAP 환경 서비스 키 JSON")}"></textarea><small>${text("SAP URL·클라이언트·토큰 주소를 자동으로 설정합니다. 저장 뒤 원본 파일도 안전하게 관리하세요.")}</small></label>
                <label class="wide" data-auth="oauth_client_credentials oauth_authorization_code" hidden>${text("OAuth 토큰 URL")}<input name="tokenUrl" type="url" required disabled placeholder="https://login.company.com/oauth/token"></label>
                <label data-auth="oauth_client_credentials oauth_authorization_code" hidden>OAuth Client ID<input name="clientId" required disabled autocomplete="off"></label>
                <label data-auth="oauth_client_credentials" hidden>OAuth Client Secret<input name="clientSecret" type="password" required disabled autocomplete="off"></label>
                <label class="wide" data-auth="oauth_authorization_code" hidden>${text("OAuth 로그인 URL")}<input name="authorizationUrl" type="url" required disabled placeholder="https://login.company.com/oauth/authorize"></label>
                <label class="wide" data-auth="oauth_client_credentials oauth_authorization_code" hidden>${text("OAuth Scope · 선택")}<input name="scope" disabled autocomplete="off"><small>${text("브라우저 로그인은 관리자에게 등록된 네이티브 OAuth 클라이언트와 127.0.0.1 콜백이 필요합니다. 회사 SAML·Kerberos SSO와의 호환성은 인증 제공자 설정에 따라 달라집니다.")}</small></label>
                <label>${text("언어")}<select name="language"><option value="KO">${text("한국어 (KO)")}</option><option value="EN" selected>English (EN)</option></select></label>
                <label>${text("시스템 구분")}<select name="environment"><option value="development" selected>${text("개발 시스템")}</option><option value="quality">${text("품질 시스템")}</option><option value="production">${text("운영 — 읽기 전용")}</option></select></label>
              </div>
              <div class="fields">
                <label class="wide">${text("사용 범위")}<select name="accessMode"><option value="read_only" selected>${text("조회부터 시작 (기본)")}</option><option value="packages">${text("선택한 패키지의 변경 허용")}</option><option value="unrestricted">${text("모든 패키지의 변경 허용")}</option></select><small>${text("조회부터 시작하면 SAP 객체·Transport 변경, 디버거 제어와 ABAP 실행·Unit 테스트를 차단합니다. 나중에 이 화면에서 변경 범위를 선택할 수 있습니다.")}</small></label>
                <label class="wide" id="write-packages" hidden>${text("변경 허용 패키지")}<input name="allowedPackages" disabled placeholder="Z_PACKAGE, Z_SHARED"><small>${text("변경할 개발 패키지를 하나 이상 입력하세요. 예: Z_PACKAGE 또는 $TMP. 여러 패키지는 쉼표로 구분합니다.")}</small></label>
              </div>
              <div class="secret-note">${text("자격 증명은 이 PC에서 인증 확인에 사용하고 macOS Keychain 또는 Windows DPAPI로 보호합니다. 브라우저 로그인은 별도 창에서 진행하며, 토큰과 서비스 키는 AI 대화에 입력하지 마세요.")}</div>
              <p class="section-copy">${text("SAP URL·클라이언트·ADT 권한을 모르면 SAP 관리자에게 확인하세요.")} <a href="https://github.com/Coaspe/sap-abap-mcp/blob/main/docs/setup-and-profiles.md" target="_blank" rel="noreferrer">${text("OAuth·BTP 고급 인증 안내")}</a></p>
              <div class="notice" id="sap-notice" role="alert"></div>
              <div class="actions"><button class="button secondary" data-back="1" type="button">${text("이전")}</button><button class="button" id="save-profile" type="submit">${text("연결 확인 후 저장")}</button><button class="button secondary" id="cancel-profile" type="button" hidden>${text("인증 취소")}</button></div>
            </form>
          </section>
          <section class="view" data-view="3" hidden>
            <h2 class="section-title">${text(hostManaged ? "SAP 연결 설정 확인" : "AI 도구에 SAP 연결하기")}</h2>
            <p class="section-copy"><strong id="selected-profile"></strong> ${text(hostManaged ? "이 MCP의 등록은 설치한 앱에서 관리합니다. 추가 CLI 설치나 MCP 등록은 필요하지 않습니다." : "선택한 SAP 연결과 현재 설치본을 확인합니다. 기존 등록은 보존하고, 다른 설정이면 수정할 값을 안내합니다.")}</p>
            <div class="fields" ${hostManaged ? "hidden" : ""}>
              <label>${text("새 등록의 도구 모드")}<select id="tool-preset" aria-describedby="tool-preset-help">
                <option value="minimal">${text("토큰 절약 — 5개 도구 (기본)")}</option>
                <option value="adaptive">${text("자주 쓰는 도구 바로 호출 — 17개 도구")}</option>
                <option value="single">${text("최소 노출 — 1개 도구")}</option>
              </select></label>
            </div>
            <p class="section-copy" id="tool-preset-help" ${hostManaged ? "hidden" : ""}>${text("세 모드 모두 같은 기능에 접근합니다. 초기 도구가 적으면 고정 토큰이 줄지만 기능 탐색 호출이 늘 수 있습니다. 1개 도구 모드는 읽기에도 승인 요청이 표시될 수 있습니다. 기존 등록에는 적용되지 않습니다.")}</p>
            <div class="client-grid" id="clients"></div>
            <div class="notice" id="client-notice" role="status"></div>
            <div class="actions"><button class="button secondary" data-back="2" type="button">${text("이전")}</button><button class="button" id="finish" type="button" disabled>${text("설정 완료")}</button></div>
          </section>
          <section class="view finish" data-view="4" hidden>
            <div><div class="finish-mark">✓</div><h2>${text("등록을 마쳤습니다.")}</h2><p>${text(hostManaged ? "설치한 앱의 새 대화에 아래 문구를 붙여넣으세요. 실제 SAP 시스템 조회 결과로 접속을 확인하세요. 이 설정 창은 닫아도 됩니다." : "Claude 또는 Codex를 다시 열고 아래 문구를 새 대화에 붙여넣으세요. SAP 시스템 정보가 조회되면 AI 도구에서도 실제 접속이 확인됩니다. 이 창과 터미널은 닫아도 됩니다.")}</p><label class="sr-only" for="first-prompt">${text("첫 SAP 조회 문구")}</label><textarea id="first-prompt" readonly></textarea><button class="button" id="copy-first-prompt" type="button">${text("첫 조회 문구 복사")}</button><div class="notice" id="copy-notice" role="status"></div></div>
          </section>
        </div>
      </section>
    </main>
  </div>
  <script nonce="${nonce}">
    const HOST_MANAGED = ${hostManaged};
    const TOKEN = ${scriptValue(token)};
    const headings = {
      1: [${scriptValue(text("Step 1 · PC 확인"))}, ${scriptValue(text("필요한 준비가 되어 있는지 먼저 확인할게요."))}, ${scriptValue(text("설치된 항목은 그대로 사용하고, 부족한 부분만 안내합니다. 기존 설정 파일은 덮어쓰지 않습니다."))}],
      2: [${scriptValue(text("Step 2 · SAP 연결"))}, ${scriptValue(text("SAP 연결과 인증 방식을 설정합니다."))}, ${scriptValue(text("입력한 정보는 이 PC에서 직접 SAP로 확인합니다. 연결에 성공한 뒤에만 안전하게 저장합니다."))}],
      3: [${scriptValue(text("Step 3 · 도구 연결"))}, ${scriptValue(text("한 번만 연결하면 다음부터 바로 사용할 수 있어요."))}, ${scriptValue(text(hostManaged ? "이 MCP의 등록은 설치한 앱에서 관리합니다. 추가 CLI 설치나 MCP 등록은 필요하지 않습니다." : "공식 Claude와 Codex 명령으로 MCP를 등록합니다. 이미 같은 연결이 있으면 변경하지 않습니다."))}],
      4: [${scriptValue(text("Step 4 · 완료"))}, ${scriptValue(text("첫 SAP 조회로 연결을 확인하세요."))}, ""]
    };
    let status;
    let selectedProfile = "";

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { "x-onboard-token": TOKEN, ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.message || ${scriptValue(text("요청을 처리하지 못했습니다."))});
        error.code = body.code;
        throw error;
      }
      return body;
    }

    function text(value) {
      return document.createTextNode(String(value));
    }

    function el(tag, className, content) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.append(text(content));
      return node;
    }

    function showStep(step) {
      document.querySelectorAll(".view").forEach(view => { view.hidden = view.dataset.view !== String(step); });
      document.querySelectorAll(".step").forEach(item => {
        const number = Number(item.dataset.step);
        item.classList.toggle("active", number === step);
        item.classList.toggle("done", number < step);
        item.setAttribute("aria-current", number === step ? "step" : "false");
        item.querySelector(".step-dot").textContent = number < step ? "✓" : String(number);
      });
      const [eyebrow, title, lede] = headings[step];
      if (step === 4) document.querySelector("#first-prompt").value = selectedProfile + ${scriptValue(text(" SAP 시스템의 연결 상태와 시스템 정보를 조회해 줘. 설정 목록만으로 접속 성공이라고 판단하지 말고 실제 시스템 조회 결과를 보여 줘. 소스 수정이나 데이터 조회는 하지 마."))};
      document.querySelector("#eyebrow").textContent = eyebrow;
      document.querySelector("#title").textContent = title;
      document.querySelector("#lede").textContent = lede;
      document.querySelector("#title").focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function renderChecks() {
      const checks = document.querySelector("#checks");
      checks.replaceChildren();
      const items = [
        { name: "Node.js", ready: true, detail: status.environment.nodeVersion },
        ...(HOST_MANAGED ? [{ name: "MCP", ready: true, detail: ${scriptValue(text("앱이 등록을 관리합니다"))} }] : [{ name: "npm", ready: status.environment.npm.installed, detail: status.environment.npm.version || ${scriptValue(text("확인 필요"))} }]),
        ...status.clients.map(client => ({
          name: client.label,
          ready: client.installed,
          detail: client.installed ? (client.version || ${scriptValue(text("설치됨"))}) : ${scriptValue(text("설치가 필요합니다"))}
        }))
      ];
      items.forEach(item => {
        const card = el("div", "check " + (item.ready ? "ready" : "warn"));
        card.append(el("div", "status-icon", item.ready ? "✓" : "!"));
        const copy = el("div"); copy.append(el("strong", "", item.name), el("span", "", item.detail)); card.append(copy); checks.append(card);
      });
      const files = document.querySelector("#files"); files.replaceChildren();
      status.files.forEach(file => {
        const row = el("div", "file-row"); row.append(el("span", "", file.path), el("b", "", file.exists ? ${scriptValue(text("있음"))} : ${scriptValue(text("없음"))})); files.append(row);
      });
      const anyClient = HOST_MANAGED || status.clients.some(client => client.installed);
      document.querySelector("#to-sap").disabled = !anyClient || !status.environment.credentialStorageSupported;
      const notice = document.querySelector("#environment-notice");
      if (!status.environment.credentialStorageSupported) {
        notice.textContent = ${scriptValue(text("현재 운영체제에서는 웹 온보딩으로 비밀번호를 안전하게 저장할 수 없습니다. Windows 또는 macOS에서 실행하세요."))};
      } else if (!anyClient) {
        notice.replaceChildren(text(${scriptValue(text("Claude Code 또는 Codex를 설치한 뒤 ‘다시 확인’을 눌러주세요. 계속 찾지 못하면 터미널을 새로 열어 onboard를 다시 실행하세요. "))}));
        const claude = el("a", "", ${scriptValue(text("Claude 설치 안내"))}); claude.href = "https://code.claude.com/docs/en/setup"; claude.target = "_blank"; claude.rel = "noreferrer";
        const codex = el("a", "", ${scriptValue(text("Codex 설치 안내"))}); codex.href = "https://learn.chatgpt.com/docs/codex/cli"; codex.target = "_blank"; codex.rel = "noreferrer";
        notice.append(claude, text(" · "), codex);
      } else notice.textContent = "";
    }

    function renderProfiles() {
      const container = document.querySelector("#profiles"); container.replaceChildren();
      document.querySelector("#profile-divider").hidden = status.profiles.length === 0;
      status.profiles.forEach(profile => {
        const card = el("div", "profile-card");
        const copy = el("div"); copy.append(el("strong", "", profile.id), el("span", "", profile.url + " · Client " + profile.client + (profile.username ? " · " + profile.username : "")));
        const editable = ["basic", "oauth_client_credentials", "oauth_authorization_code"].includes(profile.authType);
        const button = el("button", "button secondary small", profile.credentialAvailable ? ${scriptValue(text("연결 확인"))} : editable ? ${scriptValue(text("인증 다시 설정"))} : ${scriptValue(text("HTTP 인증 필요"))}); button.type = "button";
        if (!profile.credentialAvailable && !editable) button.disabled = true;
        button.addEventListener("click", async () => {
          if (!profile.credentialAvailable) { if (editable) fillProfile(profile); return; }
          setBusy(button, true, ${scriptValue(text("확인 중…"))});
          try {
            await api("/api/profile/verify", { method: "POST", body: JSON.stringify({ profileId: profile.id }) });
            selectedProfile = profile.id; await openClients();
          } catch (error) {
            if (editable && error.code === "AUTH_REQUIRED") fillProfile(profile);
            showNotice("#sap-notice", setupError(error) + ${scriptValue(text(" 저장된 설정은 유지됩니다."))}, "error");
          }
          finally { setBusy(button, false, ${scriptValue(text("연결 확인"))}); }
        });
        card.append(copy, button);
        if (editable) {
          const edit = el("button", "button secondary small", ${scriptValue(text("설정·인증 수정"))}); edit.type = "button";
          edit.addEventListener("click", () => fillProfile(profile)); card.append(edit);
        }
        container.append(card);
      });
    }

    function fillProfile(profile) {
      const form = document.querySelector("#sap-form");
      form.elements.authType.value = profile.authType;
      updateAuthFields();
      ["id", "url", "client", "username", "language", "environment", "tokenUrl", "authorizationUrl", "clientId", "scope"].forEach(name => { form.elements[name].value = profile[name] || ""; });
      form.elements.allowedPackages.value = (profile.allowedPackages || []).join(", ");
      form.elements.accessMode.value = profile.readOnly ? "read_only" : profile.allowedPackages?.length ? "packages" : "unrestricted";
      updateWriteScope();
      form.elements[profile.authType === "basic" ? "password" : profile.authType === "oauth_client_credentials" ? "clientSecret" : "clientId"].focus();
      showNotice("#sap-notice", ${scriptValue(text("기존 설정을 불러왔습니다. 선택한 방식으로 다시 인증하면 기존 권한 설정을 보존해 저장합니다."))});
    }

    function renderClients() {
      const container = document.querySelector("#clients"); container.replaceChildren();
      if (HOST_MANAGED) {
        container.append(el("p", "", ${scriptValue(text("SAP 설정은 이 PC에 저장했습니다. 등록을 바꾸거나 도구를 추가하지 않았습니다."))}));
        document.querySelector("#finish").disabled = !selectedProfile;
        return;
      }
      status.clients.forEach(client => {
        const card = el("article", "client-card");
        const top = el("div", "client-top"); top.append(el("div", "client-name", client.label));
        const blocked = ["failed", "authentication-required"].includes(client.mcpConnectionStatus);
        const registrationNeedsReview = client.configured && client.registration?.state !== "matches";
        const state = client.issue ? [${scriptValue(text("확인 실패"))}, "warn"] : client.mcpConnectionStatus === "failed" ? [${scriptValue(text("연결 실패"))}, "warn"] : client.mcpConnectionStatus === "authentication-required" ? [${scriptValue(text("인증 필요"))}, "warn"] : client.configured ? [client.mcpConnectionStatus === "connected" ? ${scriptValue(text("MCP 연결 확인"))} : ${scriptValue(text("등록됨"))}, "ready"] : client.installed ? [${scriptValue(text("설정 필요"))}, "warn"] : [${scriptValue(text("설치 필요"))}, "warn"];
        top.append(el("span", "pill " + (registrationNeedsReview ? "warn" : state[1]), registrationNeedsReview ? ${scriptValue(text("등록 설정 확인 필요"))} : state[0])); card.append(top);
        if (!registrationNeedsReview) card.append(el("p", "", client.configured ? (client.mcpConnectionStatus === "connected" ? ${scriptValue(text("MCP 서버 연결이 확인됐습니다. SAP 접속은 시스템 조회로 확인하세요."))} : ${scriptValue(text("SAP ABAP MCP가 등록되어 있습니다. 실제 연결 성공은 아직 확인되지 않았습니다."))}) : client.installed ? ${scriptValue(text("버전 "))} + (client.version || ${scriptValue(text("확인됨"))}) : ${scriptValue(text("먼저 공식 설치 안내를 따라 설치하세요."))}));
        if (registrationNeedsReview && client.registration) {
          card.append(el("p", "", client.registration.state === "different" ? ${scriptValue(text("기존 등록이 선택한 연결 또는 현재 실행 설정과 다릅니다. 기존 설정은 변경하지 않았습니다."))} : ${scriptValue(text("등록은 있지만 선택한 연결의 실행 설정을 비교하지 못했습니다. 완료 전에 설정을 확인하세요."))}));
          const labels = { runtime: ${scriptValue(text("실행파일 또는 API 버전"))}, profile: ${scriptValue(text("SAP 연결 이름"))}, "profile-home": ${scriptValue(text("프로필 저장 위치"))}, disabled: ${scriptValue(text("사용 중지 또는 승인 대기"))} };
          if (client.registration.differences.length) card.append(el("p", "", client.registration.differences.map(value => labels[value]).join(", ")));
          card.append(el("p", "", ${scriptValue(text("AI 도구의 MCP 설정에서 아래 값을 확인한 뒤 다시 확인하세요. 다른 시작 옵션과 권한 설정은 유지하세요."))}));
          const details = el("details"); details.append(el("summary", "", ${scriptValue(text("이 연결에 필요한 값 보기"))}));
          const expected = client.registration.expected;
          details.append(el("pre", "registration-values", "command: " + expected.command + "\\nserver file: " + expected.serverFile + "\\n--profile: " + expected.profileId + "\\nSAP_ABAP_MCP_HOME: " + expected.profileHome)); card.append(details);
          const guide = el("a", "", ${scriptValue(text("MCP 설정 안내 열기"))}); guide.href = client.id === "codex" ? "https://learn.chatgpt.com/docs/extend/mcp?surface=cli" : "https://code.claude.com/docs/en/mcp"; guide.target = "_blank"; guide.rel = "noreferrer"; card.append(guide);
        }
        if (client.installed && (client.issue || blocked || registrationNeedsReview)) {
          if (client.issue || blocked) card.append(el("p", "", client.issue ? ${scriptValue(text("기존 MCP 설정을 읽지 못했습니다: "))} + client.issue : client.mcpConnectionStatus === "authentication-required" ? ${scriptValue(text("AI 도구에서 MCP 인증을 완료한 뒤 다시 확인하세요."))} : ${scriptValue(text("AI 도구의 MCP 오류에서 실행 파일 경로와 서버 시작 로그를 확인한 뒤 다시 확인하세요."))}));
          const retry = el("button", "button secondary small", ${scriptValue(text("다시 확인"))}); retry.type = "button";
          retry.addEventListener("click", async () => {
            setBusy(retry, true, ${scriptValue(text("확인 중…"))});
            try { status = await api(selectedStatusPath()); renderClients(); }
            catch (error) { showNotice("#client-notice", error.message, "error"); }
            finally { setBusy(retry, false, ${scriptValue(text("다시 확인"))}); }
          });
          card.append(retry);
        } else if (client.installed && !client.configured) {
          const button = el("button", "button small", ${scriptValue(text("SAP 연결하기"))}); button.type = "button";
          button.addEventListener("click", () => configureClient(client.id, button)); card.append(button);
        } else if (!client.installed) {
          const link = el("a", "button secondary small", ${scriptValue(text("설치 안내 열기"))}); link.href = client.installUrl; link.target = "_blank"; link.rel = "noreferrer"; card.append(link);
        }
        container.append(card);
      });
      document.querySelector("#finish").disabled = !status.clients.some(client => client.configured && client.registration?.state === "matches" && !client.issue && !["failed", "authentication-required"].includes(client.mcpConnectionStatus));
    }

    async function configureClient(clientId, button) {
      setBusy(button, true, ${scriptValue(text("연결 중…"))});
      try {
        await api("/api/client/configure", { method: "POST", body: JSON.stringify({ clientId, profileId: selectedProfile, preset: document.querySelector("#tool-preset").value }) });
        showNotice("#client-notice", ${scriptValue(text("등록을 완료했습니다. 실제 연결 상태는 아래 진단을 확인하세요."))}, "success");
        status = await api(selectedStatusPath()); renderClients();
      } catch (error) { showNotice("#client-notice", setupError(error), "error"); }
      finally { setBusy(button, false, ${scriptValue(text("SAP 연결하기"))}); }
    }

    async function openClients() {
      status = await api(selectedStatusPath());
      document.querySelector("#selected-profile").textContent = selectedProfile;
      renderProfiles(); renderClients(); showStep(3);
    }

    function selectedStatusPath() { return "/api/status?profileId=" + encodeURIComponent(selectedProfile); }

    function setBusy(button, busy, label) { button.disabled = busy; button.textContent = label; button.closest("form, .profile-card, .client-card")?.classList.toggle("busy", busy); }
    function showNotice(selector, message, kind = "") { const node = document.querySelector(selector); node.className = "notice " + kind; node.textContent = message || ""; }
    function setupError(error) {
      const hints = {
        CANCELLED: ${scriptValue(text("기존 설정과 자격 증명은 유지됩니다. 인증 방식을 확인하고 다시 시도하세요."))},
        SERVICE_KEY_INVALID: ${scriptValue(text("ABAP 환경 서비스의 서비스 키 JSON을 확인하세요."))},
        SERVICE_KEY_CERTIFICATE_UNSUPPORTED: ${scriptValue(text("현재는 Client Secret을 포함한 서비스 키를 지원합니다. 인증서 방식은 관리자와 별도 설정을 확인하세요."))},
        OAUTH_CALLBACK_TIMEOUT: ${scriptValue(text("로그인 창을 완료한 뒤 다시 시도하세요. 관리자가 네이티브 클라이언트의 루프백 콜백을 허용했는지 확인하세요."))},
        OAUTH_CALLBACK_INVALID: ${scriptValue(text("로그인을 다시 시작하고, 관리자에게 Client ID·콜백·로그인 URL을 확인하세요."))},
        OAUTH_TOKEN_REQUEST_FAILED: ${scriptValue(text("Token URL·Client ID·Scope·Client Secret과 회사 인증서를 확인하세요."))},
        PROFILE_AUTH_TYPE_UNSUPPORTED: ${scriptValue(text("기존 연결과 같은 인증 방식을 선택하거나 새 연결 이름을 사용하세요."))},
        AUTH_REQUIRED: ${scriptValue(text("SAP 계정과 클라이언트 번호를 확인하세요. 회사 SSO 전용 계정이면 고급 인증 안내를 사용하고 비밀번호를 반복 입력하지 마세요."))},
        SAP_AUTHORIZATION_DENIED: ${scriptValue(text("SAP 관리자에게 이 계정의 ADT 권한과 /sap/bc/adt 서비스 상태를 확인해 달라고 요청하세요."))},
        SAP_OPERATION_FAILED: ${scriptValue(text("VPN·SAP URL·서버 상태를 확인하세요. 인증서를 신뢰하지 못하는 경우 회사 인증서 설정을 확인하세요."))},
        INTERNAL_ERROR: ${scriptValue(text("오류 내용에 맞춰 VPN·SAP URL·회사 인증서 설정을 확인하세요. 저장된 설정은 유지됩니다."))},
        PROFILE_WRITE_POLICY_INVALID: ${scriptValue(text("운영 시스템은 읽기 전용입니다. 개발·품질 시스템의 변경을 허용하려면 패키지를 입력하거나 모든 패키지를 명시적으로 선택하세요."))},
        INPUT_INVALID: ${scriptValue(text("연결 이름은 영문·숫자·밑줄·하이픈, URL은 HTTPS, 클라이언트는 숫자로 입력하세요."))},
        CLIENT_CONFIG_UNREADABLE: ${scriptValue(text("AI 도구의 MCP 설정을 읽을 수 없습니다. 해당 도구의 오류를 해결한 뒤 다시 확인하세요."))},
        CLIENT_CONFIG_FAILED: ${scriptValue(text("AI 도구의 MCP 등록 명령이 실패했습니다. 실행 경로와 권한을 확인한 뒤 다시 시도하세요."))},
        CLIENT_CONFIG_NOT_FOUND: ${scriptValue(text("등록 명령 뒤 설정을 찾지 못했습니다. AI 도구의 MCP 목록을 확인하세요."))},
        PROFILE_CREDENTIAL_RECOVERY_REQUIRED: ${scriptValue(text("설정 저장과 비밀번호 복원에 실패했습니다. 저장된 연결을 선택해 비밀번호를 다시 입력하세요."))}
      };
      return error.message + (hints[error.code] ? " — " + hints[error.code] : "");
    }

    async function refresh() {
      const button = document.querySelector("#refresh"); setBusy(button, true, ${scriptValue(text("확인 중…"))});
      try { status = await api("/api/status"); renderChecks(); renderProfiles(); }
      catch (error) { showNotice("#environment-notice", error.message, "error"); }
      finally { setBusy(button, false, ${scriptValue(text("다시 확인"))}); }
    }

    document.querySelector("#refresh").addEventListener("click", refresh);
    document.querySelector("#to-sap").addEventListener("click", () => showStep(2));
    document.querySelectorAll("[data-back]").forEach(button => button.addEventListener("click", () => showStep(Number(button.dataset.back))));
    function updateAuthFields() {
      const form = document.querySelector("#sap-form");
      const mode = form.elements.authType.value;
      form.querySelectorAll("[data-auth]").forEach(group => {
        group.hidden = !group.dataset.auth.split(" ").includes(mode);
        group.querySelectorAll("input, textarea").forEach(input => { input.disabled = group.hidden; });
      });
      ["password", "clientSecret", "serviceKey"].forEach(name => { form.elements[name].value = ""; });
    }
    function updateWriteScope() {
      const form = document.querySelector("#sap-form");
      const production = form.elements.environment.value === "production";
      Array.from(form.elements.accessMode.options).forEach(option => { option.disabled = production && option.value !== "read_only"; });
      if (production) form.elements.accessMode.value = "read_only";
      const packages = form.elements.accessMode.value === "packages";
      document.querySelector("#write-packages").hidden = !packages;
      form.elements.allowedPackages.disabled = !packages;
      form.elements.allowedPackages.required = packages;
    }
    document.querySelector('[name="accessMode"]').addEventListener("change", updateWriteScope);
    document.querySelector('[name="environment"]').addEventListener("change", updateWriteScope);
    document.querySelector('[name="authType"]').addEventListener("change", updateAuthFields);
    document.querySelector("#cancel-profile").addEventListener("click", async () => {
      try { await api("/api/profile/cancel", { method: "POST", body: "{}" }); showNotice("#sap-notice", ${scriptValue(text("인증 취소를 요청했습니다. 처리 중인 연결 확인이 끝나면 다시 시도할 수 있습니다."))}); }
      catch (error) { showNotice("#sap-notice", setupError(error), "error"); }
    });
    document.querySelector("#sap-form").addEventListener("submit", async event => {
      event.preventDefault(); const form = event.currentTarget; const button = document.querySelector("#save-profile");
      setBusy(button, true, form.elements.authType.value === "oauth_authorization_code" ? ${scriptValue(text("브라우저 로그인 대기 중…"))} : ${scriptValue(text("SAP 연결 확인 중…"))});
      document.querySelector("#cancel-profile").hidden = false; showNotice("#sap-notice", "");
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const result = await api("/api/profile", { method: "POST", body: JSON.stringify(data) });
        ["password", "clientSecret", "serviceKey"].forEach(name => { form.elements[name].value = ""; }); selectedProfile = result.profile.id; await openClients();
      } catch (error) { showNotice("#sap-notice", setupError(error), "error"); }
      finally { setBusy(button, false, ${scriptValue(text("연결 확인 후 저장"))}); document.querySelector("#cancel-profile").hidden = true; }
    });
    document.querySelector("#finish").addEventListener("click", async () => {
      const button = document.querySelector("#finish"); setBusy(button, true, ${scriptValue(text("마무리 중…"))});
      try { await api("/api/finish", { method: "POST", body: JSON.stringify(HOST_MANAGED ? { profileId: selectedProfile } : {}) }); showStep(4); }
      catch (error) { showNotice("#client-notice", error.message, "error"); setBusy(button, false, ${scriptValue(text("설정 완료"))}); }
    });
    document.querySelector("#copy-first-prompt").addEventListener("click", async () => {
      const prompt = document.querySelector("#first-prompt");
      try { await navigator.clipboard.writeText(prompt.value); showNotice("#copy-notice", ${scriptValue(text("복사했습니다. AI 도구의 새 대화에 붙여넣으세요."))}, "success"); }
      catch { prompt.focus(); prompt.select(); showNotice("#copy-notice", ${scriptValue(text("문구를 선택했습니다. Ctrl+C 또는 ⌘C로 복사하세요."))}); }
    });
    refresh();
  </script>
</body>
</html>`
}
