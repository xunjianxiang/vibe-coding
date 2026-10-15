export type SsoAuthConfig = {
  clientId: string
  callbackPath: string
  hooks: SsoAuthHooks
  loginPagePath?: string
  options?: SsoAuthOptions
}

export type SsoAuthHooks = {
  token: SsoTokenHooks
  navigation?: SsoNavigationHooks
}

export type SsoTokenHooks = {
  read: () => MaybePromise<string | null | undefined>
  write: (token: string, context: SsoTokenWriteContext) => MaybePromise<void>
  clear: (context: SsoTokenClearContext) => MaybePromise<void>
}

export type SsoNavigationHooks = {
  getCallbackBaseUrl?: () => MaybePromise<string>
  redirect?: (url: string) => MaybePromise<void>
}

export type SsoTokenWriteContext = {
  payload: SsoTokenPayload
  expiresAt: Date
  source: "callback" | "refresh"
  user?: SsoUserProfile
}

export type SsoTokenClearContext = {
  reason: "logout" | "unauthenticated" | "invalid"
}

export type MaybePromise<T> = T | Promise<T>

export type SsoAuthOptions = {
  file?: SsoFileDefaults
}

export type SsoFileDefaults = {
  acl?: "default" | "private" | "public-read" | string
  ttl?: number
}

export type SsoTokenPayload = {
  sub?: string
  aud?: string
  exp?: number
  iat?: number
  nbf?: number
  iss?: string
  jti?: string
}

export type SsoBusinessResponse<T> = {
  code: number
  message?: string
  data: T
  count?: number
}

export type SsoCallbackResult =
  | { ok: true; token: string; referer: string; payload: SsoTokenPayload; expiresAt: Date; user?: SsoUserProfile }
  | { ok: false; error: string; referer: string }

export type SsoAuthContext = {
  token: string
  payload: SsoTokenPayload
  expiresAt: Date
}

export type SsoRawUser = {
  id?: string
  userid?: string
  name?: string
  title?: string
  email?: string
  avatar?: string
  extension?: string | SsoUserExtension | null
  [key: string]: unknown
}

export type SsoUserExtension = {
  userid?: string
  name?: string
  title?: string
  email?: string
  avatar?: string
}

export type SsoUserProfile = {
  sub?: string
  userid?: string
  name?: string
  title?: string
  email?: string
  avatar?: string
  raw?: SsoRawUser
}

export type SsoFileMeta = {
  id: string
  name?: string
  url?: string
  acl?: string
  ttl?: number
  [key: string]: unknown
}

export type SsoUploadConfig = Record<string, unknown>

export type SsoUploadOptions = {
  acl?: "default" | "private" | "public-read" | string
  ttl?: number
}

export type SsoAuthFetchOptions = RequestInit & {
  unwrapBusinessResponse?: boolean
  onUnauthenticated?: (error: SsoError) => MaybePromise<void>
}

export type SsoErrorCode =
  | "missing_auth_config"
  | "invalid_callback"
  | "invalid_referer"
  | "invalid_token"
  | "unauthenticated"
  | "business_error"
  | "upload_error"
  | "network_error"

export class SsoError extends Error {
  code: SsoErrorCode
  status?: number
  detail?: unknown

  constructor(code: SsoErrorCode, message: string, options?: { status?: number; detail?: unknown }) {
    super(message)
    this.name = "SsoError"
    this.code = code
    this.status = options?.status
    this.detail = options?.detail
  }
}

type NormalizedSsoAuthConfig = {
  clientId: string
  callbackPath: string
  loginPagePath: string
  hooks: SsoAuthHooks
  file: NormalizedSsoFileDefaults
}

type NormalizedSsoFileDefaults = {
  acl?: string
  ttl?: number
}

const DEFAULT_SERVICE_ORIGIN = "https://opgw.shuzilm.cn"
const DEFAULT_LOGIN_URL = `${DEFAULT_SERVICE_ORIGIN}/auth/login`
const DEFAULT_LOGIN_PAGE_PATH = "/login"

class SsoAuthSdk {
  readonly config: NormalizedSsoAuthConfig
  readonly auth: SsoAuthModule
  readonly api: SsoAuthApiModule
  readonly users: SsoUsersModule
  readonly files: SsoFilesModule
  readonly permissions: SsoPermissionsModule
  readonly errors: SsoErrorsModule

  constructor(config: SsoAuthConfig) {
    this.config = createSsoAuthConfig(config)
    this.auth = new SsoAuthModule(this.config)
    this.api = new SsoAuthApiModule(this.config)
    this.users = new SsoUsersModule(this.config)
    this.files = new SsoFilesModule(this.config)
    this.permissions = new SsoPermissionsModule(this.config)
    this.errors = new SsoErrorsModule()
  }
}

export function createSsoAuth(config: SsoAuthConfig) {
  return new SsoAuthSdk(config)
}

export function createSsoTokenKey(clientId: string, tokenKey?: string) {
  if (!clientId) {
    throw new SsoError("missing_auth_config", "SSO clientId is required to create a token key.")
  }

  return (tokenKey ?? `SZLM_${clientId}`).toUpperCase()
}

class SsoAuthModule {
  constructor(private readonly config: NormalizedSsoAuthConfig) {}

  async getCallbackBaseUrl(explicitCallbackBaseUrl?: string) {
    const callbackBaseUrl = explicitCallbackBaseUrl ?? (await this.config.hooks.navigation?.getCallbackBaseUrl?.())

    if (!callbackBaseUrl) {
      throw new SsoError(
        "missing_auth_config",
        "SSO callbackBaseUrl is required. Pass it to login/createLoginUrl or provide navigation.getCallbackBaseUrl()."
      )
    }

    return callbackBaseUrl
  }

  async createLoginUrl(input: { callbackBaseUrl?: string; returnTo?: string } = {}) {
    const callbackBaseUrl = await this.getCallbackBaseUrl(input.callbackBaseUrl)
    return createSsoLoginUrl(this.config, {
      callbackBaseUrl,
      returnTo: input.returnTo ?? "/",
    })
  }

  async login(input: { callbackBaseUrl?: string; returnTo?: string } = {}) {
    const url = await this.createLoginUrl(input)

    if (!this.config.hooks.navigation?.redirect) {
      throw new SsoError("missing_auth_config", "SSO navigation.redirect hook is required to call login().")
    }

    await this.config.hooks.navigation.redirect(url)
  }

  parseCallback(
    url: string | URL,
    options: { callbackBaseUrl?: string; fallback?: string; allowedCallbackBaseUrls?: string[] } = {}
  ) {
    return parseSsoCallbackUrl(url, options)
  }

  async handleCallback(
    url: string | URL,
    options: {
      callbackBaseUrl?: string
      fallback?: string
      allowedCallbackBaseUrls?: string[]
      redirect?: boolean
    } = {}
  ) {
    const result = this.parseCallback(url, options)

    if (!result.ok) {
      return result
    }

    let user: SsoUserProfile

    try {
      user = await verifySsoCallbackToken(result.token, this.config.clientId)
    } catch (error) {
      return {
        ok: false as const,
        error: toSsoError(error, "SSO callback token verification failed.").message,
        referer: result.referer,
      }
    }

    await this.config.hooks.token.write(result.token, {
      payload: result.payload,
      expiresAt: result.expiresAt,
      source: "callback",
      user,
    })

    if (options.redirect !== false && this.config.hooks.navigation?.redirect) {
      await this.config.hooks.navigation.redirect(result.referer)
    }

    return { ...result, user }
  }

  async readContext(): Promise<SsoAuthContext | null> {
    const token = await this.config.hooks.token.read()

    if (!token || !isSsoTokenValid(token)) {
      return null
    }

    return createAuthContext(token)
  }

  async requireContext() {
    const context = await this.readContext()

    if (!context) {
      throw new SsoError("unauthenticated", "SSO auth context is missing or expired.")
    }

    return context
  }

  async isAuthenticated() {
    return Boolean(await this.readContext())
  }

  async logout() {
    await this.config.hooks.token.clear({ reason: "logout" })

    if (this.config.hooks.navigation?.redirect) {
      await this.config.hooks.navigation.redirect(this.config.loginPagePath)
    }
  }
}

class SsoAuthApiModule {
  constructor(private readonly config: NormalizedSsoAuthConfig) {}

  createRequest(context: SsoAuthContext, input: string | URL | Request, options: RequestInit = {}) {
    return createAuthRequest(context.token, this.config.clientId, input, options)
  }

  async fetch<T>(input: string | URL | Request, options: SsoAuthFetchOptions = {}) {
    const context = await createRequiredContext(this.config)
    return ssoAuthFetchWithHooks<T>(this.config, context.token, input, options)
  }

  async fetchWithContext<T>(context: SsoAuthContext, input: string | URL | Request, options: SsoAuthFetchOptions = {}) {
    return ssoAuthFetchWithHooks<T>(this.config, context.token, input, options)
  }
}

class SsoUsersModule {
  constructor(private readonly config: NormalizedSsoAuthConfig) {}

  async getCurrent() {
    const context = await createRequiredContext(this.config)

    if (!context.payload.sub) {
      throw new SsoError("unauthenticated", "Current SSO token does not contain sub.")
    }

    return this.get(context.payload.sub, context.payload.sub)
  }

  async list() {
    const context = await createRequiredContext(this.config)
    const rawUsers = await ssoAuthFetchWithHooks<SsoRawUser[]>(
      this.config,
      context.token,
      `${DEFAULT_SERVICE_ORIGIN}/api/assets/v1/user/list`
    )
    return rawUsers.map((user) => normalizeSsoUser(user))
  }

  async get(userId: string, sub?: string) {
    const context = await createRequiredContext(this.config)
    const raw = await ssoAuthFetchWithHooks<SsoRawUser>(
      this.config,
      context.token,
      `${DEFAULT_SERVICE_ORIGIN}/api/assets/v1/user/get?user_id=${encodeURIComponent(userId)}`
    )
    return normalizeSsoUser(raw, sub)
  }

  async getMany(userIds: string[]) {
    const users = await Promise.all(userIds.map((id) => this.get(id)))
    return new Map(users.flatMap((user) => [user.userid, user.sub].filter(Boolean).map((id) => [id, user] as const)))
  }

  normalize(raw: SsoRawUser, sub?: string) {
    return normalizeSsoUser(raw, sub)
  }

  displayName(user: SsoUserProfile) {
    return getSsoUserDisplayName(user)
  }
}

class SsoFilesModule {
  constructor(private readonly config: NormalizedSsoAuthConfig) {}

  getDefaults() {
    return { ...this.config.file }
  }

  async getUploadConfig(filename: string, options: SsoUploadOptions = {}) {
    const context = await createRequiredContext(this.config)
    const uploadOptions = mergeFileOptions(this.config.file, options)
    const url = new URL(`${DEFAULT_SERVICE_ORIGIN}/api/file/v1/oss/config`)
    url.searchParams.set("filename", filename)
    if (uploadOptions.acl) url.searchParams.set("acl", uploadOptions.acl)
    if (typeof uploadOptions.ttl === "number") url.searchParams.set("ttl", String(uploadOptions.ttl))
    return ssoAuthFetchWithHooks<SsoUploadConfig>(this.config, context.token, url)
  }

  async resolveUrls(ids: string[]) {
    if (ids.length === 0) {
      return new Map<string, string>()
    }

    const context = await createRequiredContext(this.config)
    const items = await ssoAuthFetchWithHooks<Array<{ id: string; url: string }>>(
      this.config,
      context.token,
      `${DEFAULT_SERVICE_ORIGIN}/api/file/v1/oss/url?ids=${encodeURIComponent(ids.join(","))}`
    )
    return new Map(items.map((item) => [item.id, item.url]))
  }

  async getDownloadUrl(file: SsoFileMeta) {
    if (isPublicSsoFile(file) && file.url) {
      return file.url
    }

    const urls = await this.resolveUrls([file.id])
    return urls.get(file.id) ?? null
  }

  normalizeMeta(data: Partial<SsoFileMeta>, file?: Pick<File, "name">) {
    return normalizeSsoFileMeta(data, file)
  }

  isPublic(file: SsoFileMeta) {
    return isPublicSsoFile(file)
  }
}

class SsoPermissionsModule {
  constructor(private readonly config: NormalizedSsoAuthConfig) {}

  async load() {
    const context = await createRequiredContext(this.config)
    return ssoAuthFetchWithHooks<string[]>(
      this.config,
      context.token,
      `${DEFAULT_SERVICE_ORIGIN}/api/assets/v1/mine/permission`,
      { method: "POST" }
    )
  }

  has(permissions: string[], permission: string) {
    return permissions.includes(permission)
  }

  all(permissions: string[], required: string[]) {
    return required.every((permission) => this.has(permissions, permission))
  }

  any(permissions: string[], required: string[]) {
    return required.some((permission) => this.has(permissions, permission))
  }
}

class SsoErrorsModule {
  normalize(error: unknown, fallbackMessage?: string) {
    return toSsoError(error, fallbackMessage)
  }

  isSsoError(error: unknown): error is SsoError {
    return error instanceof SsoError
  }
}

function createSsoAuthConfig(config: SsoAuthConfig): NormalizedSsoAuthConfig {
  if (!config.clientId || !config.callbackPath) {
    throw new SsoError(
      "missing_auth_config",
      "SSO auth clientId and callbackPath are required. Do not provide a default clientId in code."
    )
  }

  if (!config.hooks?.token?.read || !config.hooks.token.write || !config.hooks.token.clear) {
    throw new SsoError("missing_auth_config", "SSO auth token read/write/clear hooks are required.")
  }

  return {
    clientId: config.clientId,
    callbackPath: config.callbackPath,
    loginPagePath: config.loginPagePath ?? DEFAULT_LOGIN_PAGE_PATH,
    hooks: config.hooks,
    file: normalizeFileDefaults(config.options?.file),
  }
}

export function createSsoLoginUrl(
  config: Pick<NormalizedSsoAuthConfig, "clientId" | "callbackPath">,
  input: { callbackBaseUrl: string; returnTo?: string }
) {
  const callbackUrl = new URL(config.callbackPath, input.callbackBaseUrl)
  callbackUrl.searchParams.set("referer", input.returnTo ?? "/")

  const loginUrl = new URL(DEFAULT_LOGIN_URL)
  loginUrl.searchParams.set("client_id", config.clientId)
  loginUrl.searchParams.set("referer", callbackUrl.toString())

  return loginUrl.toString()
}

export function parseSsoCallbackUrl(
  url: string | URL,
  options: { callbackBaseUrl?: string; fallback?: string; allowedCallbackBaseUrls?: string[] } = {}
): SsoCallbackResult {
  const callbackUrl = typeof url === "string" ? new URL(url) : url
  const referer = resolveSafeReferer(callbackUrl.searchParams.get("referer"), {
    callbackBaseUrl: options.callbackBaseUrl ?? getUrlTrustScope(callbackUrl),
    fallback: options.fallback ?? "/",
    allowedCallbackBaseUrls: options.allowedCallbackBaseUrls,
  })
  const token = callbackUrl.searchParams.get("token")
  const context = token ? createAuthContextOrNull(token) : null

  if (!token || !context) {
    return { ok: false, error: "SSO callback token is missing or expired.", referer }
  }

  return { ok: true, token, referer, payload: context.payload, expiresAt: context.expiresAt }
}

export function resolveSafeReferer(
  referer: string | null | undefined,
  options: { callbackBaseUrl: string; fallback?: string; allowedCallbackBaseUrls?: string[] }
) {
  const fallback = options.fallback ?? "/"

  if (!referer) {
    return fallback
  }

  try {
    const callbackUrl = new URL(options.callbackBaseUrl)
    const url = new URL(referer, options.callbackBaseUrl)
    const allowedOrigins = new Set([
      getUrlTrustScope(callbackUrl),
      ...(options.allowedCallbackBaseUrls ?? []).map((allowed) => getUrlTrustScope(new URL(allowed))),
    ])

    if (!allowedOrigins.has(getUrlTrustScope(url))) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

function getUrlTrustScope(url: URL) {
  return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin
}

export async function createRequiredContext(config: Pick<NormalizedSsoAuthConfig, "hooks">) {
  const token = await config.hooks.token.read()
  const context = token ? createAuthContextOrNull(token) : null

  if (!context) {
    throw new SsoError("unauthenticated", "SSO auth context is missing or expired.")
  }

  return context
}

async function ssoAuthFetchWithHooks<T>(
  config: NormalizedSsoAuthConfig,
  token: string,
  input: string | URL | Request,
  options: SsoAuthFetchOptions = {}
) {
  return ssoAuthFetch<T>(token, config.clientId, input, {
    ...options,
    onTokenRefresh: async (nextToken, payload, expiresAt) => {
      await config.hooks.token.write(nextToken, { payload, expiresAt, source: "refresh" })
    },
    onUnauthenticated: async (error) => {
      await config.hooks.token.clear({ reason: "unauthenticated" })
      await options.onUnauthenticated?.(error)
    },
  })
}

export function createAuthContext(token: string): SsoAuthContext {
  const context = createAuthContextOrNull(token)

  if (!context) {
    throw new SsoError("invalid_token", "SSO token is missing or expired.")
  }

  return context
}

export function createAuthContextOrNull(token: string): SsoAuthContext | null {
  const payload = decodeSsoToken(token)
  const expiresAt = getSsoTokenExpiresAt(token)

  if (!payload || !expiresAt || expiresAt.getTime() <= Date.now()) {
    return null
  }

  return { token, payload, expiresAt }
}

export function createUserAuthHeaders(token: string, clientId: string) {
  const context = createAuthContext(token)
  const headers = new Headers()
  headers.set("Authorization", `Bearer ${token}`)
  if (context.payload.sub) headers.set("Sub", context.payload.sub)
  if (context.payload.aud) headers.set("Aud", context.payload.aud)
  headers.set("X-Client", clientId)
  headers.set("X-Client-Id", clientId)
  return headers
}

export function createAuthRequest(token: string, clientId: string, input: string | URL | Request, options: RequestInit = {}) {
  const headers = input instanceof Request ? new Headers(input.headers) : new Headers()

  for (const [key, value] of new Headers(options.headers)) {
    headers.set(key, value)
  }

  for (const [key, value] of createUserAuthHeaders(token, clientId)) {
    headers.set(key, value)
  }

  return new Request(input, { ...options, headers })
}

export async function ssoAuthFetch<T>(
  token: string,
  clientId: string,
  input: string | URL | Request,
  options: SsoAuthFetchOptions & {
    onTokenRefresh?: (token: string, payload: SsoTokenPayload, expiresAt: Date) => MaybePromise<void>
  } = {}
): Promise<T> {
  const { unwrapBusinessResponse: _unwrapBusinessResponse, onUnauthenticated, onTokenRefresh, ...requestOptions } = options
  const request = createAuthRequest(token, clientId, input, requestOptions)

  try {
    const response = await fetch(request)
    const nextToken = parseSetToken(response)

    if (nextToken) {
      const context = createAuthContext(nextToken)
      await onTokenRefresh?.(nextToken, context.payload, context.expiresAt)
    }

    if (response.status === 401) {
      throw new SsoError("unauthenticated", "SSO user request was not authenticated.", {
        status: response.status,
      })
    }

    if (options.unwrapBusinessResponse === false) {
      return response as T
    }

    return await parseSsoBusinessResponse<T>(response)
  } catch (error) {
    const ssoError = toSsoError(error)

    if (ssoError.code === "unauthenticated") {
      await onUnauthenticated?.(ssoError)
    }

    throw ssoError
  }
}

export function parseSetToken(response: Response) {
  const nextToken = response.headers.get("Set-Token")
  return nextToken && isSsoTokenValid(nextToken) ? nextToken : null
}

export async function parseSsoBusinessResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as SsoBusinessResponse<T>

  if (payload.code === 401) {
    throw new SsoError("unauthenticated", payload.message ?? "SSO user request was not authenticated.", {
      detail: payload,
    })
  }

  if (payload.code !== 0) {
    throw new SsoError("business_error", payload.message ?? "SSO request failed.", { detail: payload })
  }

  return payload.data
}

export async function verifySsoCallbackToken(token: string, clientId: string) {
  const context = createAuthContext(token)

  if (!context.payload.sub) {
    throw new SsoError("invalid_token", "SSO callback token does not contain sub.")
  }

  const raw = await ssoAuthFetch<SsoRawUser>(
    token,
    clientId,
    `${DEFAULT_SERVICE_ORIGIN}/api/assets/v1/user/get?user_id=${encodeURIComponent(context.payload.sub)}`
  )
  return normalizeSsoUser(raw, context.payload.sub)
}

export function decodeSsoToken(token: string): SsoTokenPayload | null {
  const [, payload] = token.split(".")

  if (!payload) {
    return null
  }

  try {
    return JSON.parse(base64UrlDecode(payload)) as SsoTokenPayload
  } catch {
    return null
  }
}

export function isSsoTokenValid(token: string | null | undefined) {
  const payload = token ? decodeSsoToken(token) : null
  return Boolean(payload?.exp && payload.exp > Math.floor(Date.now() / 1000))
}

export function getSsoTokenExpiresAt(token: string) {
  const payload = decodeSsoToken(token)
  return payload?.exp ? new Date(payload.exp * 1000) : null
}

export function normalizeSsoUser(raw: SsoRawUser, sub?: string): SsoUserProfile {
  const extension = parseUserExtension(raw.extension)

  return {
    sub,
    userid: extension.userid ?? raw.userid ?? raw.id,
    name: extension.name ?? raw.name,
    title: extension.title ?? raw.title,
    email: extension.email ?? raw.email,
    avatar: extension.avatar ?? raw.avatar,
    raw,
  }
}

export function getSsoUserDisplayName(user: SsoUserProfile) {
  return user.name ?? user.email ?? user.userid ?? user.sub ?? "Unknown user"
}

export function normalizeSsoFileMeta(data: Partial<SsoFileMeta>, file?: Pick<File, "name">): SsoFileMeta {
  if (!data.id) {
    throw new Error("SSO file response is missing data.id.")
  }

  return {
    id: data.id,
    name: data.name ?? file?.name,
    url: data.url,
    acl: data.acl,
    ttl: data.ttl,
    ...data,
  }
}

export function isPublicSsoFile(file: SsoFileMeta) {
  return file.acl === "public" || file.acl === "public-read"
}

export function toSsoError(error: unknown, fallbackMessage = "SSO auth request failed.") {
  if (error instanceof SsoError) {
    return error
  }

  if (error instanceof Error) {
    return new SsoError("network_error", error.message)
  }

  return new SsoError("network_error", fallbackMessage, { detail: error })
}

function normalizeFileDefaults(defaults: SsoFileDefaults | undefined): NormalizedSsoFileDefaults {
  return {
    acl: defaults?.acl,
    ttl: defaults?.ttl,
  }
}

function mergeFileOptions(defaults: NormalizedSsoFileDefaults, options: SsoFileDefaults) {
  return {
    acl: options.acl ?? defaults.acl,
    ttl: options.ttl ?? defaults.ttl,
  }
}

function parseUserExtension(extension: SsoRawUser["extension"]): SsoUserExtension {
  if (!extension) {
    return {}
  }

  if (typeof extension === "object") {
    return extension
  }

  try {
    return JSON.parse(extension) as SsoUserExtension
  } catch {
    return {}
  }
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

