function scriptValue(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

export function onboardPage(token: string, nonce: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SAP 개발 환경 시작하기</title>
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
    button, input, select { font: inherit; }
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
    .view[hidden] { display: none; }
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
    .button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid rgba(10, 110, 209, .28); outline-offset: 2px; }
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
    .advanced { margin: 0; border: 0; padding: 0; }
    .client-card { min-height: 178px; display: flex; flex-direction: column; }
    .client-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .client-name { font: 700 20px/1 Bahnschrift, "Segoe UI", sans-serif; }
    .pill { padding: 5px 8px; border-radius: 999px; background: #eef2f7; color: var(--muted); font-size: 10px; font-weight: 800; }
    .pill.ready { background: #e5f5e5; color: var(--green); }
    .pill.warn { background: #fff3dc; color: var(--amber); }
    .client-card .button { margin-top: auto; align-self: flex-start; }
    .notice { min-height: 0; margin-top: 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
    .notice:not(:empty) { padding: 12px 14px; background: #fff3dc; color: #704200; }
    .notice.error:not(:empty) { background: #ffebeb; color: var(--red); }
    .notice.success:not(:empty) { background: #e5f5e5; color: #135f13; }
    .busy { opacity: .62; pointer-events: none; }
    .finish {
      min-height: 330px; display: grid; place-items: center; text-align: center;
      background: radial-gradient(circle at 50% 42%, rgba(0, 166, 214, .12), transparent 42%);
    }
    .finish-mark { width: 74px; height: 74px; display: grid; place-items: center; margin: 0 auto 22px; border-radius: 50%; background: var(--green); color: white; font-size: 36px; box-shadow: 0 0 0 12px rgba(24, 137, 24, .1); }
    .finish h2 { margin: 0; font: 700 30px/1.2 Bahnschrift, sans-serif; }
    .finish p { max-width: 520px; margin: 12px auto 0; color: var(--muted); line-height: 1.7; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (max-width: 820px) {
      .workspace { grid-template-columns: 1fr; }
      .rail { position: static; display: flex; overflow-x: auto; }
      .rail-title, .step small { display: none; }
      .step { flex: 0 0 auto; padding: 8px 13px 8px 6px; align-items: center; }
      .step:not(:last-child)::after { left: 34px; top: 21px; bottom: auto; width: calc(100% - 18px); height: 2px; }
    }
    @media (max-width: 620px) {
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
      <div class="brand"><div class="brand-mark">ABAP</div><div><strong>SAP 개발 환경 시작하기</strong><span>Claude · Codex · SAP ABAP MCP</span></div></div>
      <div class="local-badge">이 PC에서만 실행 중</div>
    </header>
    <main class="workspace">
      <nav class="rail" aria-label="설정 단계">
        <p class="rail-title">ONBOARDING</p>
        <div class="step active" data-step="1"><div class="step-dot">1</div><div><strong>PC 확인</strong><small>설치 상태 점검</small></div></div>
        <div class="step" data-step="2"><div class="step-dot">2</div><div><strong>SAP 연결</strong><small>로그인 및 검증</small></div></div>
        <div class="step" data-step="3"><div class="step-dot">3</div><div><strong>도구 연결</strong><small>MCP 자동 설정</small></div></div>
        <div class="step" data-step="4"><div class="step-dot">4</div><div><strong>완료</strong><small>바로 시작</small></div></div>
      </nav>
      <section class="panel">
        <header class="panel-head">
          <p class="eyebrow" id="eyebrow">Step 1 · PC 확인</p>
          <h1 id="title">필요한 준비가 되어 있는지 먼저 확인할게요.</h1>
          <p class="lede" id="lede">설치된 항목은 그대로 사용하고, 부족한 부분만 안내합니다. 기존 설정 파일은 덮어쓰지 않습니다.</p>
        </header>
        <div class="panel-body">
          <section class="view" data-view="1">
            <h2 class="section-title">자동 점검 결과</h2>
            <p class="section-copy">Claude 또는 Codex 중 하나만 준비되어 있어도 계속할 수 있습니다.</p>
            <div class="check-grid" id="checks" aria-live="polite"></div>
            <details><summary>설정 파일 상세 보기</summary><div class="file-list" id="files"></div></details>
            <div class="notice" id="environment-notice" role="status"></div>
            <div class="actions"><button class="button secondary" id="refresh" type="button">다시 확인</button><button class="button" id="to-sap" type="button" disabled>SAP 연결 설정</button></div>
          </section>
          <section class="view" data-view="2" hidden>
            <h2 class="section-title">사용할 SAP 시스템</h2>
            <p class="section-copy">저장된 연결이 있으면 다시 확인해 사용하고, 없으면 새로 추가하세요.</p>
            <div class="profiles" id="profiles"></div>
            <div class="divider" id="profile-divider">새 연결 추가</div>
            <form id="sap-form">
              <div class="fields">
                <label>연결 이름<input name="id" required maxlength="32" placeholder="DEV100" autocomplete="off"><small>이 SAP 시스템을 구분할 짧은 이름</small></label>
                <label>SAP 클라이언트<input name="client" required inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" placeholder="100"></label>
                <label class="wide">SAP URL<input name="url" type="url" required placeholder="https://sap.company.com" autocomplete="url"></label>
                <label>SAP 사용자 ID<input name="username" required autocomplete="username" placeholder="사번 또는 SAP ID"></label>
                <label>SAP 비밀번호<input name="password" type="password" required autocomplete="current-password"></label>
                <label>언어<select name="language"><option value="KO">한국어 (KO)</option><option value="EN" selected>English (EN)</option></select></label>
                <label>시스템 구분<select name="environment"><option value="development" selected>개발 — 변경 가능</option><option value="quality">품질 — 변경 가능</option><option value="production">운영 — 읽기 전용</option></select></label>
              </div>
              <details class="advanced"><summary>고급 설정</summary><div class="fields"><label class="wide">변경 허용 패키지<input name="allowedPackages" placeholder="Z_PACKAGE, Z_SHARED"><small>비워두면 시스템 구분 정책이 적용됩니다.</small></label></div></details>
              <div class="secret-note">비밀번호는 이 PC에서 SAP 연결 확인에만 사용하며, Windows에서는 현재 사용자 전용 암호화 저장소에 보관합니다.</div>
              <div class="notice" id="sap-notice" role="alert"></div>
              <div class="actions"><button class="button secondary" data-back="1" type="button">이전</button><button class="button" id="save-profile" type="submit">저장하고 연결 확인</button></div>
            </form>
          </section>
          <section class="view" data-view="3" hidden>
            <h2 class="section-title">AI 도구에 SAP 연결하기</h2>
            <p class="section-copy"><strong id="selected-profile"></strong> 연결과 현재 SAP ABAP MCP 설치본을 등록합니다. 이미 등록된 도구는 건너뜁니다.</p>
            <div class="fields">
              <label>새 등록의 도구 모드<select id="tool-preset" aria-describedby="tool-preset-help">
                <option value="minimal">토큰 절약 — 5개 도구 (기본)</option>
                <option value="adaptive">자주 쓰는 도구 바로 호출 — 17개 도구</option>
                <option value="single">최소 노출 — 1개 도구</option>
              </select></label>
            </div>
            <p class="section-copy" id="tool-preset-help">세 모드 모두 같은 기능에 접근합니다. 초기 도구가 적으면 고정 토큰이 줄지만 기능 탐색 호출이 늘 수 있습니다. 1개 도구 모드는 읽기에도 승인 요청이 표시될 수 있습니다. 기존 등록에는 적용되지 않습니다.</p>
            <div class="client-grid" id="clients"></div>
            <div class="notice" id="client-notice" role="status"></div>
            <div class="actions"><button class="button secondary" data-back="2" type="button">이전</button><button class="button" id="finish" type="button" disabled>설정 완료</button></div>
          </section>
          <section class="view finish" data-view="4" hidden>
            <div><div class="finish-mark">✓</div><h2>등록을 마쳤습니다.</h2><p>Claude 또는 Codex를 열고 SAP 시스템을 조회해 실제 접속을 확인하세요. 이 온보딩 창과 터미널은 이제 닫아도 됩니다.</p></div>
          </section>
        </div>
      </section>
    </main>
  </div>
  <script nonce="${nonce}">
    const TOKEN = ${scriptValue(token)};
    const headings = {
      1: ["Step 1 · PC 확인", "필요한 준비가 되어 있는지 먼저 확인할게요.", "설치된 항목은 그대로 사용하고, 부족한 부분만 안내합니다. 기존 설정 파일은 덮어쓰지 않습니다."],
      2: ["Step 2 · SAP 연결", "평소 사용하는 SAP 계정으로 연결합니다.", "입력한 정보는 이 PC에서 직접 SAP로 확인합니다. 연결에 성공한 뒤에만 안전하게 저장합니다."],
      3: ["Step 3 · 도구 연결", "한 번만 연결하면 다음부터 바로 사용할 수 있어요.", "공식 Claude와 Codex 명령으로 MCP를 등록합니다. 이미 같은 연결이 있으면 변경하지 않습니다."],
      4: ["Step 4 · 완료", "준비가 모두 끝났습니다.", ""]
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
        const error = new Error(body.message || "요청을 처리하지 못했습니다.");
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
        if (number < step) item.querySelector(".step-dot").textContent = "✓";
      });
      const [eyebrow, title, lede] = headings[step];
      document.querySelector("#eyebrow").textContent = eyebrow;
      document.querySelector("#title").textContent = title;
      document.querySelector("#lede").textContent = lede;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function renderChecks() {
      const checks = document.querySelector("#checks");
      checks.replaceChildren();
      const items = [
        { name: "Node.js", ready: true, detail: status.environment.nodeVersion },
        { name: "npm", ready: status.environment.npm.installed, detail: status.environment.npm.version || "확인 필요" },
        ...status.clients.map(client => ({
          name: client.label,
          ready: client.installed,
          detail: client.installed ? (client.version || "설치됨") : "설치가 필요합니다"
        }))
      ];
      items.forEach(item => {
        const card = el("div", "check " + (item.ready ? "ready" : "warn"));
        card.append(el("div", "status-icon", item.ready ? "✓" : "!"));
        const copy = el("div"); copy.append(el("strong", "", item.name), el("span", "", item.detail)); card.append(copy); checks.append(card);
      });
      const files = document.querySelector("#files"); files.replaceChildren();
      status.files.forEach(file => {
        const row = el("div", "file-row"); row.append(el("span", "", file.path), el("b", "", file.exists ? "있음" : "없음")); files.append(row);
      });
      const anyClient = status.clients.some(client => client.installed);
      document.querySelector("#to-sap").disabled = !anyClient || !status.environment.credentialStorageSupported;
      const notice = document.querySelector("#environment-notice");
      if (!status.environment.credentialStorageSupported) {
        notice.textContent = "현재 운영체제에서는 웹 온보딩으로 비밀번호를 안전하게 저장할 수 없습니다. Windows 또는 macOS에서 실행하세요.";
      } else if (!anyClient) {
        notice.replaceChildren(text("Claude Code 또는 Codex를 설치한 뒤 ‘다시 확인’을 눌러주세요. 계속 찾지 못하면 터미널을 새로 열어 onboard를 다시 실행하세요. "));
        const claude = el("a", "", "Claude 설치 안내"); claude.href = "https://code.claude.com/docs/en/setup"; claude.target = "_blank"; claude.rel = "noreferrer";
        const codex = el("a", "", "Codex 설치 안내"); codex.href = "https://learn.chatgpt.com/docs/codex/cli"; codex.target = "_blank"; codex.rel = "noreferrer";
        notice.append(claude, text(" · "), codex);
      } else notice.textContent = "";
    }

    function renderProfiles() {
      const container = document.querySelector("#profiles"); container.replaceChildren();
      document.querySelector("#profile-divider").hidden = status.profiles.length === 0;
      status.profiles.forEach(profile => {
        const card = el("div", "profile-card");
        const copy = el("div"); copy.append(el("strong", "", profile.id), el("span", "", profile.url + " · Client " + profile.client + (profile.username ? " · " + profile.username : "")));
        const basicProfile = profile.authType === "basic";
        const button = el("button", "button secondary small", profile.credentialAvailable ? "연결 확인" : basicProfile ? "비밀번호 다시 입력" : "고급 인증 필요"); button.type = "button";
        if (!profile.credentialAvailable && !basicProfile) button.disabled = true;
        button.addEventListener("click", async () => {
          if (!profile.credentialAvailable) { if (basicProfile) fillProfile(profile); return; }
          setBusy(button, true, "확인 중…");
          try {
            await api("/api/profile/verify", { method: "POST", body: JSON.stringify({ profileId: profile.id }) });
            selectedProfile = profile.id; await openClients();
          } catch (error) {
            if (basicProfile && error.code === "AUTH_REQUIRED") fillProfile(profile);
            showNotice("#sap-notice", error.message + " 저장된 설정은 유지됩니다. 연결 상태를 확인한 뒤 다시 시도하세요.", "error");
          }
          finally { setBusy(button, false, "연결 확인"); }
        });
        card.append(copy, button);
        if (basicProfile) {
          const edit = el("button", "button secondary small", "설정·비밀번호 수정"); edit.type = "button";
          edit.addEventListener("click", () => fillProfile(profile)); card.append(edit);
        }
        container.append(card);
      });
    }

    function fillProfile(profile) {
      const form = document.querySelector("#sap-form");
      ["id", "url", "client", "username", "language", "environment"].forEach(name => { if (profile[name]) form.elements[name].value = profile[name]; });
      form.elements.allowedPackages.value = (profile.allowedPackages || []).join(", ");
      form.elements.password.focus();
      showNotice("#sap-notice", "기존 설정을 불러왔습니다. 비밀번호를 입력한 뒤 저장하고 연결을 확인하세요.");
    }

    function renderClients() {
      const container = document.querySelector("#clients"); container.replaceChildren();
      status.clients.forEach(client => {
        const card = el("article", "client-card");
        const top = el("div", "client-top"); top.append(el("div", "client-name", client.label));
        const blocked = ["failed", "authentication-required"].includes(client.mcpConnectionStatus);
        const state = client.issue ? ["확인 실패", "warn"] : client.mcpConnectionStatus === "failed" ? ["연결 실패", "warn"] : client.mcpConnectionStatus === "authentication-required" ? ["인증 필요", "warn"] : client.configured ? [client.mcpConnectionStatus === "connected" ? "MCP 연결 확인" : "등록됨", "ready"] : client.installed ? ["설정 필요", "warn"] : ["설치 필요", "warn"];
        top.append(el("span", "pill " + state[1], state[0])); card.append(top);
        card.append(el("p", "", client.configured ? (client.mcpConnectionStatus === "connected" ? "MCP 서버 연결이 확인됐습니다. SAP 접속은 시스템 조회로 확인하세요." : "SAP ABAP MCP가 등록되어 있습니다. 실제 연결 성공은 아직 확인되지 않았습니다.") : client.installed ? "버전 " + (client.version || "확인됨") : "먼저 공식 설치 안내를 따라 설치하세요."));
        if (client.installed && (client.issue || blocked)) {
          card.append(el("p", "", client.issue ? "기존 MCP 설정을 읽지 못했습니다: " + client.issue : client.mcpConnectionStatus === "authentication-required" ? "AI 도구에서 MCP 인증을 완료한 뒤 다시 확인하세요." : "AI 도구의 MCP 오류에서 실행 파일 경로와 서버 시작 로그를 확인한 뒤 다시 확인하세요."));
          const retry = el("button", "button secondary small", "다시 확인"); retry.type = "button";
          retry.addEventListener("click", async () => {
            setBusy(retry, true, "확인 중…");
            try { status = await api("/api/status"); renderClients(); }
            catch (error) { showNotice("#client-notice", error.message, "error"); }
            finally { setBusy(retry, false, "다시 확인"); }
          });
          card.append(retry);
        } else if (client.installed && !client.configured) {
          const button = el("button", "button small", "SAP 연결하기"); button.type = "button";
          button.addEventListener("click", () => configureClient(client.id, button)); card.append(button);
        } else if (!client.installed) {
          const link = el("a", "button secondary small", "설치 안내 열기"); link.href = client.installUrl; link.target = "_blank"; link.rel = "noreferrer"; card.append(link);
        }
        container.append(card);
      });
      document.querySelector("#finish").disabled = !status.clients.some(client => client.configured && !client.issue && !["failed", "authentication-required"].includes(client.mcpConnectionStatus));
    }

    async function configureClient(clientId, button) {
      setBusy(button, true, "연결 중…");
      try {
        await api("/api/client/configure", { method: "POST", body: JSON.stringify({ clientId, profileId: selectedProfile, preset: document.querySelector("#tool-preset").value }) });
        showNotice("#client-notice", "등록을 완료했습니다. 실제 연결 상태는 아래 진단을 확인하세요.", "success");
        status = await api("/api/status"); renderClients();
      } catch (error) { showNotice("#client-notice", error.message, "error"); }
      finally { setBusy(button, false, "SAP 연결하기"); }
    }

    async function openClients() {
      status = await api("/api/status");
      document.querySelector("#selected-profile").textContent = selectedProfile;
      renderClients(); showStep(3);
    }

    function setBusy(button, busy, label) { button.disabled = busy; button.textContent = label; button.closest("form, .profile-card, .client-card")?.classList.toggle("busy", busy); }
    function showNotice(selector, message, kind = "") { const node = document.querySelector(selector); node.className = "notice " + kind; node.textContent = message || ""; }

    async function refresh() {
      const button = document.querySelector("#refresh"); setBusy(button, true, "확인 중…");
      try { status = await api("/api/status"); renderChecks(); renderProfiles(); }
      catch (error) { showNotice("#environment-notice", error.message, "error"); }
      finally { setBusy(button, false, "다시 확인"); }
    }

    document.querySelector("#refresh").addEventListener("click", refresh);
    document.querySelector("#to-sap").addEventListener("click", () => showStep(2));
    document.querySelectorAll("[data-back]").forEach(button => button.addEventListener("click", () => showStep(Number(button.dataset.back))));
    document.querySelector("#sap-form").addEventListener("submit", async event => {
      event.preventDefault(); const form = event.currentTarget; const button = document.querySelector("#save-profile");
      setBusy(button, true, "SAP 연결 확인 중…"); showNotice("#sap-notice", "");
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const result = await api("/api/profile", { method: "POST", body: JSON.stringify(data) });
        form.elements.password.value = ""; selectedProfile = result.profile.id; await openClients();
      } catch (error) { showNotice("#sap-notice", error.message, "error"); }
      finally { setBusy(button, false, "저장하고 연결 확인"); }
    });
    document.querySelector("#finish").addEventListener("click", async () => {
      const button = document.querySelector("#finish"); setBusy(button, true, "마무리 중…");
      try { await api("/api/finish", { method: "POST", body: "{}" }); showStep(4); }
      catch (error) { showNotice("#client-notice", error.message, "error"); setBusy(button, false, "설정 완료"); }
    });
    refresh();
  </script>
</body>
</html>`
}
