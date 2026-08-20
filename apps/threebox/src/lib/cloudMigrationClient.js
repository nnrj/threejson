const bytesToBase64 = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

function safeSettings(settings) {
  if (!settings) return null;
  return {
    theme: settings.general?.theme,
    language: settings.general?.locale,
    sceneGenerationMode: settings.ai?.sceneGenerationMode,
    adjustmentMode: settings.ai?.updateOutputMode,
    attachSpatialSummary: settings.ai?.includeSpatialSummary,
    attachSceneJson: settings.ai?.includeFullJson,
    textureStrategy: settings.ai?.textureStrategy,
    textureLicensePolicy: settings.ai?.textureAllowUnknownLicense ? "allow-unknown" : "known-only",
    textureCacheEnabled: settings.ai?.textureLocalCache,
    notificationBellEnabled: settings.general?.builtinNotificationsEnabled
  };
}

async function resourceForEnvelope(resource) {
  if (!resource?.blob) return resource;
  const blobDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(resource.blob);
  });
  const { blob: _blob, ...metadata } = resource;
  return { ...metadata, blobDataUrl };
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || "CLOUD_MIGRATION_FAILED"), { code: body.error, status: response.status, details: body.details });
  return body;
}

let turnstileLoader;
function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  if (!turnstileLoader) turnstileLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true; script.defer = true;
    script.onload = () => resolve(globalThis.turnstile);
    script.onerror = () => reject(new Error("TURNSTILE_LOAD_FAILED"));
    document.head.appendChild(script);
  });
  return turnstileLoader;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Application-layer community-to-Cloud migration client. It has no ThreeJSON core dependency. */
export function createCloudMigrationClient({
  apiBaseUrl = "https://api.threebox.org",
  cloudUrl = "https://cloud.threebox.org",
  deviceIdProvider,
  snapshotProvider,
  settingsProvider
} = {}) {
  const api = String(apiBaseUrl).replace(/\/$/, "");
  const cloud = String(cloudUrl).replace(/\/$/, "");

  async function createMigration({ username, nickname, useRandomUsername, termsVersion, privacyVersion, adultConfirmed, turnstileToken }) {
    const deviceId = await deviceIdProvider();
    const reservation = await requestJson(`${api}/v1/cloud/migrations/reserve`, {
      method: "POST",
      body: JSON.stringify({ username, nickname, useRandomUsername, termsVersion, privacyVersion, adultConfirmed, turnstileToken, deviceId })
    });
    const snapshot = await snapshotProvider();
    const resources = await Promise.all((snapshot.resources || []).map(resourceForEnvelope));
    const publicKey = await requestJson(`${api}/v1/cloud/migrations/public-key`);
    const rsa = await crypto.subtle.importKey("jwk", publicKey.jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = {
      version: 2,
      createdAt: Date.now(),
      nickname: reservation.nickname,
      settings: safeSettings(settingsProvider?.()),
      items: snapshot.items || [],
      resources
    };
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(payload)));
    const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsa, await crypto.subtle.exportKey("raw", aes));
    const result = await requestJson(`${api}/v1/cloud/migrations`, {
      method: "POST",
      body: JSON.stringify({
        payloadVersion: 2,
        deviceId,
        reservationToken: reservation.reservationToken,
        ciphertext: bytesToBase64(ciphertext),
        iv: bytesToBase64(iv),
        wrappedKey: bytesToBase64(wrappedKey)
      })
    });
    const fragment = new URLSearchParams({ migration: result.id, claim: result.claimToken, reservation: reservation.reservationToken });
    location.assign(`${cloud}/#${fragment}`);
  }

  async function open() {
    const bootstrap = await requestJson(`${api}/v1/cloud/bootstrap`);
    const legal = bootstrap.legal?.documents || [];
    const terms = legal.find((item) => item.kind === "terms");
    const privacy = legal.find((item) => item.kind === "privacy");
    if (!terms || !privacy) throw new Error("CLOUD_LEGAL_DOCUMENTS_UNAVAILABLE");

    const overlay = element("div", "modalOverlay cloudMigrationOverlay");
    const dialog = element("div", "modalDialog cloudMigrationDialog");
    const header = element("div", "modalHeader");
    header.append(element("span", "", "切换到 ThreeBox Cloud"));
    const close = element("button", "", "×"); close.type = "button"; header.append(close);
    const body = element("div", "modalBody cloudMigrationBody");
    const intro = element("div", "cloudMigrationChoices");
    intro.append(element("p", "", "ThreeBox Cloud 可在未登录时继续本地使用。只有您明确选择迁移后，社区版才会加密上传本机数据。"));
    const jump = element("button", "cloudMigrationChoice"); jump.type = "button";
    jump.append(element("strong", "", "仅跳转"), element("small", "", "不注册、不登录、不传输任何本机数据"));
    const migrateChoice = element("button", "cloudMigrationChoice primary"); migrateChoice.type = "button";
    migrateChoice.append(element("strong", "", "创建临时 Cloud 账户并迁移"), element("small", "", "先选择永久用户名，再用一次性加密信封迁移"));
    if (!bootstrap.features?.migration) {
      migrateChoice.disabled = true;
      migrateChoice.replaceChildren(
        element("strong", "", "Cloud 迁移尚未开放"),
        element("small", "", "仍可仅跳转并在本机使用 ThreeBox Cloud")
      );
    }
    intro.append(jump, migrateChoice);

    const form = element("form", "cloudMigrationForm"); form.hidden = true;
    const warning = element("div", "cloudMigrationWarning", "用户名是永久身份标识。确认后，用户和管理员均不能修改。若必须更换，只能创建新账户。临时账户须在 30 天内绑定邮箱或 OAuth。 ");
    const usernameLabel = element("label", "", "永久用户名");
    const usernameRow = element("div", "cloudMigrationInline");
    const username = element("input"); username.required = true; username.autocomplete = "username"; username.placeholder = "例如 three_user";
    const random = element("button", "", "使用随机用户名"); random.type = "button";
    usernameRow.append(username, random); usernameLabel.append(usernameRow);
    const usernameStatus = element("small", "cloudMigrationStatus", "由英文字母、数字和下划线组成，不能以数字开头。 ");
    const nicknameLabel = element("label", "", "昵称"); const nickname = element("input"); nickname.required = true; nickname.maxLength = 64; nicknameLabel.append(nickname);
    const agreements = element("div", "cloudMigrationAgreements");
    for (const document of [terms, privacy]) {
      const details = element("details"); const summary = element("summary", "", `${document.title}（${document.version}）`);
      details.append(summary, element("pre", "", document.markdown)); agreements.append(details);
    }
    const agreeLabel = element("label", "cloudMigrationCheck"); const agree = element("input"); agree.type = "checkbox"; agreeLabel.append(agree, document.createTextNode("我已阅读并同意当前使用协议和隐私政策"));
    const adultLabel = element("label", "cloudMigrationCheck"); const adult = element("input"); adult.type = "checkbox"; adultLabel.append(adult, document.createTextNode("我已满 18 岁"));
    const permanentLabel = element("label", "cloudMigrationCheck"); const permanent = element("input"); permanent.type = "checkbox"; permanentLabel.append(permanent, document.createTextNode("我理解该用户名确认后永久不可修改"));
    const captcha = element("div", "cloudMigrationCaptcha");
    const error = element("div", "cloudMigrationError"); error.setAttribute("role", "alert");
    const actions = element("div", "modalFooter"); const back = element("button", "", "返回"); back.type = "button"; const submit = element("button", "primary", "确认并加密迁移"); submit.type = "submit"; actions.append(back, submit);
    form.append(warning, usernameLabel, usernameStatus, nicknameLabel, agreements, agreeLabel, adultLabel, permanentLabel, captcha, error, actions);
    body.append(intro, form); dialog.append(header, body); overlay.append(dialog); document.body.append(overlay);

    let humanToken = ""; let usernameAvailable = false; let usernameTimer;
    const dispose = () => overlay.remove();
    close.addEventListener("click", dispose);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) dispose(); });
    jump.addEventListener("click", () => location.assign(cloud));
    migrateChoice.addEventListener("click", async () => {
      intro.hidden = true; form.hidden = false; username.focus();
      if (bootstrap.turnstile?.enabled && bootstrap.turnstile.siteKey) {
        try { (await loadTurnstile()).render(captcha, { sitekey: bootstrap.turnstile.siteKey, action: "community_migration", callback: (token) => { humanToken = token; } }); }
        catch (cause) { error.textContent = cause.message || String(cause); }
      }
    });
    back.addEventListener("click", () => { form.hidden = true; intro.hidden = false; });
    random.addEventListener("click", async () => {
      try { const result = await requestJson(`${api}/v1/cloud/usernames/random`, { method: "POST", body: "{}" }); username.value = result.username; username.dispatchEvent(new Event("input")); }
      catch (cause) { error.textContent = cause.message || String(cause); }
    });
    username.addEventListener("input", () => {
      clearTimeout(usernameTimer); usernameAvailable = false; usernameStatus.textContent = "正在检查…";
      usernameTimer = setTimeout(async () => {
        try { const result = await requestJson(`${api}/v1/cloud/usernames/check?username=${encodeURIComponent(username.value)}`); usernameAvailable = Boolean(result.available); usernameStatus.textContent = result.available ? "该用户名可用；确认后永久不可修改。" : `不可用：${result.reason || "USERNAME_UNAVAILABLE"}`; }
        catch (cause) { usernameStatus.textContent = cause.message || String(cause); }
      }, 320);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); error.textContent = "";
      if (!usernameAvailable || !nickname.value.trim()) { error.textContent = "请填写可用用户名和昵称。"; return; }
      if (!agree.checked || !adult.checked || !permanent.checked) { error.textContent = "请完成协议、年龄和永久用户名确认。"; return; }
      if (bootstrap.turnstile?.enabled && !humanToken) { error.textContent = "请完成人机验证。"; return; }
      if (!confirm(`用户名 ${username.value} 确认后永久不可修改。确定继续迁移吗？`)) return;
      submit.disabled = true; submit.textContent = "正在加密并迁移…";
      try {
        await createMigration({ username: username.value, nickname: nickname.value, termsVersion: terms.version, privacyVersion: privacy.version, adultConfirmed: true, turnstileToken: humanToken });
      } catch (cause) {
        error.textContent = cause.message || String(cause); submit.disabled = false; submit.textContent = "确认并加密迁移";
      }
    });
  }

  return { open, createMigration };
}

