import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');
export class ConnectionError extends Error {
  constructor(message, code = 'CHATGPT_CONNECTION_ERROR', status = 503) { super(message); this.code = code; this.status = status; }
}
export function sameSecret(a, b) { if (typeof a !== 'string' || typeof b !== 'string') return false; const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
export async function validateIdentity(idToken, key, { clientId, nonce, subject }) {
  const { payload } = await jwtVerify(idToken, key, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat', 'nonce'], algorithms: ['RS256', 'ES256', 'EdDSA'], clockTolerance: 5 });
  if (typeof payload.sub !== 'string' || !payload.sub || !sameSecret(payload.nonce, nonce) || (subject && payload.sub !== subject)) throw new ConnectionError('Вход не подтверждён. Попробуй войти в выбранный аккаунт ещё раз.', 'INVALID_IDENTITY', 401);
  return payload;
}
export function buildAuthorizationURL(attempt, hostId, endpoint) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ client_id: attempt.clientId || 'dynamic_agent_client', ...(attempt.clientId ? {} : { agent_name_hint: 'Конспект' }), ext_agent_host_id: hostId, response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'), ...(attempt.enablePlan ? { prompt: 'consent' } : {}) }).toString();
  return url.toString();
}

export class ChatGPTConnection {
  constructor({ store, fetcher = fetch, verifyIdentity = validateIdentity, now = Date.now }) {
    this.store = store; this.fetcher = fetcher; this.verifyIdentity = verifyIdentity; this.now = now;
    this.attempts = new Map(); this.refreshes = new Map(); this.catalogs = new Map(); this.controllers = new Map(); this.disconnecting = new Set();
  }
  async init() { this.state = await this.store.load(); }
  account(id = this.state.activeId) { return this.state.accounts.find(account => account.id === id); }
  async discovery() {
    if (this.metadata) return this.metadata;
    try {
      const response = await this.fetcher(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000) });
      const metadata = await response.json();
      const trusted = value => typeof value === 'string' && new URL(value).origin === ISSUER;
      if (!response.ok || metadata.issuer !== ISSUER || !trusted(metadata.authorization_endpoint) || !trusted(metadata.token_endpoint) || !trusted(metadata.jwks_uri) || (metadata.revocation_endpoint && !trusted(metadata.revocation_endpoint))) throw new Error();
      this.metadata = metadata; this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
      return metadata;
    } catch { throw new ConnectionError('Не удалось связаться со входом ChatGPT. Проверь интернет и попробуй снова.'); }
  }
  async start(browserId, origin, { accountId, enablePlan = false } = {}) {
    const account = accountId ? this.account(accountId) : null;
    if (accountId && !account) throw new ConnectionError('Этот аккаунт не найден.', 'ACCOUNT_NOT_FOUND', 400);
    const metadata = await this.discovery();
    for (const [state, attempt] of this.attempts) if (attempt.expiresAt < this.now() || attempt.browserId === browserId) this.attempts.delete(state);
    if (this.attempts.size >= 10) throw new ConnectionError('Слишком много попыток входа. Закрой лишние вкладки.', 'AUTH_BUSY', 429);
    const attempt = { browserId, state: random(), nonce: random(), verifier: random(), redirectUri: `${origin}/auth/callback`, accountId: account?.id, clientId: account?.clientId, subject: account?.subject, enablePlan, expiresAt: this.now() + 600000 };
    this.attempts.set(attempt.state, attempt);
    return buildAuthorizationURL(attempt, this.store.hostId, metadata.authorization_endpoint);
  }
  async tokenRequest(form) {
    const metadata = await this.discovery();
    let response;
    try { response = await this.fetcher(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(20000) }); }
    catch { throw new ConnectionError('Не удалось завершить вход в ChatGPT. Попробуй снова.'); }
    let data; try { data = await response.json(); } catch { throw new ConnectionError('ChatGPT вернул неполный ответ при входе.'); }
    if (!response.ok) throw new ConnectionError('ChatGPT не подтвердил подключение. Войди ещё раз.', typeof data.error === 'string' ? data.error : 'TOKEN_EXCHANGE_FAILED', response.status);
    if (typeof data.access_token !== 'string' || data.access_token.length < 20 || data.token_type?.toLowerCase() !== 'bearer' || typeof data.expires_in !== 'number' || data.expires_in <= 0) throw new ConnectionError('ChatGPT не выдал доступ к подписке.', 'INVALID_TOKEN_RESPONSE');
    return data;
  }
  async callback(browserId, url) {
    const state = url.searchParams.get('state'); const attempt = this.attempts.get(state);
    if (attempt) this.attempts.delete(state);
    if (!attempt || !sameSecret(attempt.browserId, browserId) || attempt.expiresAt <= this.now()) throw new ConnectionError('Попытка входа истекла или не подтверждена. Нажми Continue with ChatGPT ещё раз.', 'INVALID_STATE', 400);
    if (url.searchParams.has('error')) throw new ConnectionError('Подключение отменено. Можно попробовать снова, когда будешь готов.', 'CONSENT_DECLINED', 400);
    const clientId = url.searchParams.get('client_id') || attempt.clientId;
    const code = url.searchParams.get('code');
    if (!clientId || clientId === 'dynamic_agent_client' || clientId.length > 300 || !code || code.length > 5000 || (attempt.clientId && clientId !== attempt.clientId)) throw new ConnectionError('Регистрация ChatGPT не завершена. Начни вход ещё раз.', 'INVALID_CALLBACK', 400);
    const tokens = await this.tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE });
    if (typeof tokens.id_token !== 'string') throw new ConnectionError('ChatGPT не подтвердил личность аккаунта.', 'INVALID_IDENTITY', 401);
    let identity;
    try { identity = await this.verifyIdentity(tokens.id_token, this.jwks, { clientId, nonce: attempt.nonce, subject: attempt.subject }); }
    catch { throw new ConnectionError('Не удалось проверить подпись входа ChatGPT. Попробуй снова.', 'INVALID_IDENTITY', 401); }
    let account = this.state.accounts.find(item => item.clientId === clientId && item.subject === identity.sub);
    if (!account) { account = { id: randomUUID(), clientId, subject: identity.sub, label: `Аккаунт ${this.state.accounts.length + 1}`, welcomeSeen: false }; this.state.accounts.push(account); }
    account.email = typeof identity.email === 'string' ? identity.email : '';
    account.name = typeof identity.name === 'string' ? identity.name : '';
    account.scopes = []; // A new authorization must explicitly grant plan usage again.
    delete account.refreshToken;
    this.setTokens(account, tokens);
    this.stopActive(); this.state.activeId = account.id; this.catalogs.delete(account.id);
    await this.store.save(this.state);
    return { planEnabled: account.scopes.includes(PLAN_SCOPE) };
  }
  setTokens(account, tokens) {
    account.accessToken = tokens.access_token;
    if (typeof tokens.refresh_token === 'string') account.refreshToken = tokens.refresh_token;
    if (typeof tokens.id_token === 'string') account.idToken = tokens.id_token;
    account.scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : account.scopes || [];
    account.expiresAt = this.now() + tokens.expires_in * 1000;
    account.earliestRefreshAt = typeof tokens.earliest_refresh_at === 'number' ? tokens.earliest_refresh_at * 1000 : 0;
  }
  clearTokens(account) { for (const key of ['accessToken', 'refreshToken', 'idToken', 'expiresAt', 'earliestRefreshAt']) delete account[key]; account.scopes = []; this.catalogs.delete(account.id); }
  async access(account) {
    if (this.disconnecting.has(account?.id)) throw new ConnectionError('Аккаунт отключается. Дождись завершения.', 'ACCOUNT_DISCONNECTING', 409);
    if (!account?.accessToken) throw new ConnectionError('Войди в ChatGPT, чтобы использовать подписку.', 'CHATGPT_SIGN_IN_REQUIRED', 401);
    if (account.expiresAt > this.now() + 60000 || (account.expiresAt > this.now() && account.earliestRefreshAt > this.now())) return account.accessToken;
    if (!account.refreshToken) throw new ConnectionError('Сессия ChatGPT истекла. Войди ещё раз.', 'CHATGPT_REAUTH_REQUIRED', 401);
    if (!this.refreshes.has(account.id)) {
      const operation = (async () => {
        try {
          const tokens = await this.tokenRequest({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE });
          this.setTokens(account, tokens); await this.store.save(this.state); return account.accessToken;
        } catch (error) {
          if (['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(error.code)) { this.clearTokens(account); await this.store.save(this.state); }
          throw error;
        } finally { this.refreshes.delete(account.id); }
      })();
      this.refreshes.set(account.id, operation);
    }
    return this.refreshes.get(account.id);
  }
  async models(account) {
    const cached = this.catalogs.get(account.id);
    if (cached && cached.expiresAt > this.now()) return cached.models;
    const token = await this.access(account);
    let response;
    try { response = await this.fetcher(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }); }
    catch { throw new ConnectionError('Не удалось загрузить модели ChatGPT. Проверь подключение и обнови статус.'); }
    if (!response.ok) throw new ConnectionError(response.status === 401 ? 'Обнови вход в ChatGPT, чтобы загрузить модели.' : 'ChatGPT пока не предоставил список доступных моделей для этого аккаунта.', 'CHATGPT_MODELS_UNAVAILABLE', response.status);
    const data = await response.json();
    const models = (Array.isArray(data.models) ? data.models : []).filter(item => item.visibility === 'list' && typeof item.slug === 'string' && typeof item.display_name === 'string').map(item => ({ slug: item.slug, name: item.display_name }));
    if (!models.length) throw new ConnectionError('У этого аккаунта пока нет доступных моделей для приложения.', 'CHATGPT_MODELS_UNAVAILABLE');
    this.catalogs.set(account.id, { models, expiresAt: this.now() + 300000 });
    if (!models.some(model => model.slug === account.model)) { account.model = models[0].slug; await this.store.save(this.state); }
    return models;
  }
  publicAccount(account) { return account ? { id: account.id, email: account.email, name: account.name, label: account.label, signedIn: Boolean(account.accessToken), planEnabled: Boolean(account.accessToken && account.scopes?.includes(PLAN_SCOPE)), model: account.model || '', welcomeSeen: Boolean(account.welcomeSeen) } : null; }
  async status() {
    const account = this.account(); let models = []; let connectionError = '';
    if (account?.scopes?.includes(PLAN_SCOPE) && account.accessToken) try { await this.access(account); models = await this.models(account); } catch (error) { connectionError = error instanceof ConnectionError ? error.message : 'Не удалось проверить подключение ChatGPT.'; }
    return { provider: 'chatgpt', configured: Boolean(models.length && account?.accessToken && account.scopes?.includes(PLAN_SCOPE)), account: this.publicAccount(account), accounts: this.state.accounts.map(item => this.publicAccount(item)), models, connectionError, usageURL: 'https://chatgpt.com/settings/usage' };
  }
  stopActive() { const account = this.account(); if (account) { this.controllers.get(account.id)?.abort(); this.controllers.delete(account.id); } }
  async activate(id) { if (!this.account(id)) throw new ConnectionError('Аккаунт не найден.', 'ACCOUNT_NOT_FOUND', 400); this.stopActive(); this.state.activeId = id; await this.store.save(this.state); }
  async selectModel(slug) { const account = this.account(); if (!account || !(await this.models(account)).some(model => model.slug === slug)) throw new ConnectionError('Выбери модель из списка.', 'MODEL_NOT_FOUND', 400); account.model = slug; await this.store.save(this.state); }
  async welcomeSeen() { const account = this.account(); if (account) { account.welcomeSeen = true; await this.store.save(this.state); } }
  async disconnect() {
    const account = this.account(); if (!account) return { revoked: true };
    this.disconnecting.add(account.id);
    this.stopActive();
    // Complete any rotating-token refresh before revoking its replacement.
    await this.refreshes.get(account.id)?.catch(() => {});
    let revoked = !account.refreshToken;
    if (account.refreshToken) {
      try {
        const metadata = await this.discovery();
        if (metadata.revocation_endpoint) for (let attempt = 0; attempt < 2; attempt++) {
          try { const response = await this.fetcher(metadata.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }), signal: AbortSignal.timeout(10000) }); if (response.status === 200) { revoked = true; break; } if (response.status < 500) break; } catch { /* One bounded retry; no provider detail is logged. */ }
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch { /* Local sign-out still clears the tokens. */ }
    }
    this.clearTokens(account); try { await this.store.save(this.state); } finally { this.disconnecting.delete(account.id); } return { revoked };
  }
  async inferenceConfig() {
    const account = this.account();
    if (!account?.scopes?.includes(PLAN_SCOPE)) throw new ConnectionError('Разреши использование подписки при входе в ChatGPT.', 'CHATGPT_PLAN_PERMISSION_REQUIRED', 403);
    const accessToken = await this.access(account); await this.models(account);
    if (this.state.activeId !== account.id || this.disconnecting.has(account.id)) throw new ConnectionError('Аккаунт изменился. Повтори запрос с выбранным аккаунтом.', 'ACCOUNT_CHANGED', 409);
    if (!this.controllers.has(account.id)) this.controllers.set(account.id, new AbortController());
    const stopSignal = this.controllers.get(account.id).signal;
    return { authMode: 'chatgpt', accessToken, model: account.model, fetcher: (url, options) => this.fetcher(url, { ...options, signal: AbortSignal.any([stopSignal, ...(options.signal ? [options.signal] : [])]) }) };
  }
}
