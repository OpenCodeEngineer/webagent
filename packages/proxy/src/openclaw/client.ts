import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { loadConfig } from '../config.js';

interface AgentResponse {
  success: boolean;
  response?: string;
  error?: string;
}

type AgentEventPayload = {
  runId: string;
  stream?: unknown;
  data?: unknown;
};

type PendingRequest = {
  expectFinal: boolean;
  timeout: NodeJS.Timeout | null;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  method: string;
};

type RunEventListener = (event: AgentEventPayload) => void;

const PROTOCOL_VERSION = 3;
const CONNECT_CHALLENGE_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_REQUESTS = 5;
const CONNECT_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
  'operator.talk.secrets',
] as const;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

let activeRequests = 0;
const requestWaitQueue: Array<() => void> = [];
let sharedGatewayTransport: GatewayWsTransport | null = null;
let sharedGatewayTransportKey = '';

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

interface StoredDeviceIdentity {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDeviceMetadataForAuth(value?: string | null): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: 'spki', format: 'der' }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32
    && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
  return base64UrlEncode(signature);
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}): string {
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const platform = normalizeDeviceMetadataForAuth(params.platform);
  const deviceFamily = normalizeDeviceMetadataForAuth(params.deviceFamily);
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join('|');
}

function resolveOpenClawStateDir(): string {
  const configured = process.env.OPENCLAW_STATE_DIR?.trim();
  if (configured) {
    return configured;
  }

  const home = process.env.HOME?.trim();
  if (home) {
    return path.join(home, '.openclaw');
  }

  return path.join(process.cwd(), '.openclaw');
}

function resolveDeviceIdentityPath(): string {
  return path.join(resolveOpenClawStateDir(), 'identity', 'device.json');
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  return { deviceId, publicKeyPem, privateKeyPem };
}

function loadOrCreateDeviceIdentity(filePath = resolveDeviceIdentityPath()): DeviceIdentity {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoredDeviceIdentity;
      if (
        parsed?.version === 1
        && typeof parsed.deviceId === 'string'
        && typeof parsed.publicKeyPem === 'string'
        && typeof parsed.privateKeyPem === 'string'
      ) {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedId !== parsed.deviceId) {
          const updated: StoredDeviceIdentity = { ...parsed, deviceId: derivedId };
          fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
          try {
            fs.chmodSync(filePath, 0o600);
          } catch {
            // best-effort on non-posix environments
          }
          return {
            deviceId: derivedId,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {
    // fall through and regenerate identity
  }

  const created = createDeviceIdentity();
  ensureParentDirectory(filePath);
  const stored: StoredDeviceIdentity = {
    version: 1,
    deviceId: created.deviceId,
    publicKeyPem: created.publicKeyPem,
    privateKeyPem: created.privateKeyPem,
    createdAtMs: Date.now(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on non-posix environments
  }
  return created;
}

function rawToString(raw: WebSocket.RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  return Buffer.from(raw).toString('utf8');
}

function resolveAssistantDelta(data: unknown, hasExistingOutput: boolean): string {
  if (!isRecord(data)) {
    return '';
  }
  if (typeof data.delta === 'string' && data.delta.length > 0) {
    return data.delta;
  }
  if (!hasExistingOutput && typeof data.text === 'string' && data.text.length > 0) {
    return data.text;
  }
  return '';
}

function coerceGatewayErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Gateway request failed';
}

function collectUniqueTokens(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const value of values) {
    const token = typeof value === 'string' ? value.trim() : '';
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

function extractGatewayTokenFromConfig(raw: string): string | undefined {
  const gatewayAuthBlockMatch = raw.match(
    /gateway\s*:\s*\{[\s\S]*?auth\s*:\s*\{[\s\S]*?\}[\s\S]*?\}/m,
  );
  const source = gatewayAuthBlockMatch?.[0] ?? raw;
  const tokenMatch = source.match(/token\s*:\s*["']([^"']+)["']/m);
  const token = tokenMatch?.[1]?.trim();
  if (!token || token.startsWith('$')) {
    return undefined;
  }
  return token;
}

function readGatewayTokenFromConfigFile(): string | undefined {
  const home = process.env.HOME?.trim();
  const candidates = [
    process.env.OPENCLAW_CONFIG_PATH?.trim(),
    home ? path.join(home, '.openclaw', 'config', 'openclaw.json5') : undefined,
    home ? path.join(home, 'openclaw', 'config', 'openclaw.json5') : undefined,
    path.join(process.cwd(), 'openclaw', 'config', 'openclaw.json5'),
  ];

  for (const filePath of candidates) {
    if (!filePath) {
      continue;
    }
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const token = extractGatewayTokenFromConfig(raw);
      if (token) {
        return token;
      }
    } catch {
      // ignore unreadable config candidates
    }
  }

  return undefined;
}

function readEnvValueFromProcess(pid: string, key: string): string | undefined {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/environ`);
    const entries = raw.toString('utf8').split('\0');
    const prefix = `${key}=`;
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) {
        continue;
      }
      const value = entry.slice(prefix.length).trim();
      if (value) {
        return value;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readGatewayTokenFromRunningProcess(): string | undefined {
  try {
    const procEntries = fs.readdirSync('/proc', { withFileTypes: true });
    for (const entry of procEntries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
        continue;
      }
      const pid = entry.name;
      let cmdline = '';
      try {
        cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      } catch {
        continue;
      }
      if (!cmdline.includes('openclaw-gateway')) {
        continue;
      }
      const token = readEnvValueFromProcess(pid, 'OPENCLAW_GATEWAY_TOKEN');
      if (token) {
        return token;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isGatewayTokenAuthError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('gateway token mismatch') || normalized.includes('gateway token missing');
}

function isUnknownAgentError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('unknown agent') || normalized.includes('invalid agent params');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGatewayUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  return new URL(withScheme);
}

function toGatewayWsUrl(raw: string): string {
  const url = normalizeGatewayUrl(raw);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }
  return url.toString().replace(/\/$/, '');
}

function toGatewayHttpUrl(raw: string): string {
  const url = normalizeGatewayUrl(raw);
  if (url.protocol === 'ws:') {
    url.protocol = 'http:';
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:';
  }
  return url.toString().replace(/\/$/, '');
}

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    requestWaitQueue.push(resolve);
  });
}

function releaseSlot(): void {
  const next = requestWaitQueue.shift();
  if (next) {
    next();
    return;
  }
  activeRequests = Math.max(0, activeRequests - 1);
}

class GatewayWsTransport {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private connectRequestId: string | null = null;
  private connectNonce: string | null = null;
  private connectChallengeTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, PendingRequest>();
  private runListeners = new Map<string, Set<RunEventListener>>();

  constructor(
    private readonly gatewayWsUrl: string,
    private readonly token: string,
  ) {}

  dispose(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000, 'closing');
      this.ws = null;
    }
    this.handleDisconnected(new Error('Gateway transport disposed'));
  }

  subscribeToRun(runId: string, listener: RunEventListener): () => void {
    const existing = this.runListeners.get(runId);
    if (existing) {
      existing.add(listener);
    } else {
      this.runListeners.set(runId, new Set([listener]));
    }

    return () => {
      const listeners = this.runListeners.get(runId);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.runListeners.delete(runId);
      }
    };
  }

  async request<T = unknown>(
    method: string,
    params: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number },
  ): Promise<T> {
    await this.ensureConnected();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway is not connected');
    }

    const requestId = crypto.randomUUID();
    const requestFrame = {
      type: 'req',
      id: requestId,
      method,
      params,
    };

    const timeoutMs = opts?.timeoutMs && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : DEFAULT_REQUEST_TIMEOUT_MS;

    const pending = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`gateway request timeout for ${method}`));
      }, timeoutMs);

      this.pending.set(requestId, {
        expectFinal: opts?.expectFinal === true,
        timeout,
        method,
        resolve,
        reject,
      });
    });

    this.ws.send(JSON.stringify(requestFrame));
    return pending;
  }

  private async ensureConnected(): Promise<void> {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });

    this.openSocket();
    return this.connectPromise;
  }

  private openSocket(): void {
    const ws = new WebSocket(this.gatewayWsUrl, {
      maxPayload: 25 * 1024 * 1024,
    });
    this.ws = ws;
    this.isConnected = false;
    this.connectRequestId = null;
    this.connectNonce = null;

    ws.on('open', () => {
      this.armConnectChallengeTimeout();
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      this.handleMessage(rawToString(raw));
    });

    ws.on('close', (code: number, reason: WebSocket.RawData) => {
      const reasonText = rawToString(reason);
      this.handleDisconnected(new Error(`Gateway closed (${code}): ${reasonText || 'no reason'}`));
      if (this.ws === ws) {
        this.ws = null;
      }
    });

    ws.on('error', (error: Error) => {
      if (!this.isConnected && this.connectPromise) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.handleDisconnected(err);
      }
    });
  }

  private handleMessage(raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(frame) || typeof frame.type !== 'string') {
      return;
    }

    if (frame.type === 'event') {
      this.handleEvent(frame);
      return;
    }

    if (frame.type === 'res') {
      this.handleResponse(frame);
    }
  }

  private handleEvent(frame: Record<string, unknown>): void {
    if (frame.event === 'connect.challenge') {
      const payload = isRecord(frame.payload) ? frame.payload : null;
      const nonce = payload && typeof payload.nonce === 'string' ? payload.nonce.trim() : '';
      if (!nonce) {
        this.handleDisconnected(new Error('Gateway connect challenge missing nonce'));
        this.ws?.close(1008, 'connect challenge missing nonce');
        return;
      }
      this.connectNonce = nonce;
      this.sendConnectRequest();
      return;
    }

    if (frame.event !== 'agent') {
      return;
    }

    const payload = isRecord(frame.payload) ? frame.payload : null;
    const runId = payload && typeof payload.runId === 'string' ? payload.runId : null;
    if (!runId || !payload) {
      return;
    }

    const listeners = this.runListeners.get(runId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const eventPayload: AgentEventPayload = {
      runId,
      stream: payload.stream,
      data: payload.data,
    };
    for (const listener of listeners) {
      listener(eventPayload);
    }
  }

  private handleResponse(frame: Record<string, unknown>): void {
    const responseId = typeof frame.id === 'string' ? frame.id : '';
    if (!responseId) {
      return;
    }

    if (this.connectRequestId && responseId === this.connectRequestId) {
      this.connectRequestId = null;
      this.clearConnectChallengeTimeout();
      if (frame.ok !== true) {
        this.handleDisconnected(new Error(coerceGatewayErrorMessage(frame.error)));
        this.ws?.close(1008, 'connect failed');
        return;
      }
      const payload = isRecord(frame.payload) ? frame.payload : null;
      if (!payload || payload.type !== 'hello-ok') {
        this.handleDisconnected(new Error('Invalid gateway connect response'));
        this.ws?.close(1008, 'invalid connect response');
        return;
      }
      this.isConnected = true;
      const resolve = this.resolveConnect;
      this.connectPromise = null;
      this.resolveConnect = null;
      this.rejectConnect = null;
      resolve?.();
      return;
    }

    const pending = this.pending.get(responseId);
    if (!pending) {
      return;
    }

    const payload = isRecord(frame.payload) ? frame.payload : null;
    if (pending.expectFinal && payload?.status === 'accepted') {
      return;
    }

    this.pending.delete(responseId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    if (frame.ok === true) {
      pending.resolve(frame.payload);
      return;
    }

    pending.reject(new Error(coerceGatewayErrorMessage(frame.error)));
  }

  private sendConnectRequest(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.connectRequestId || !this.connectNonce) {
      return;
    }

    const identity = loadOrCreateDeviceIdentity();
    const signedAt = Date.now();
    const scopes = [...CONNECT_SCOPES];
    const signaturePayload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes,
      signedAtMs: signedAt,
      token: this.token,
      nonce: this.connectNonce,
      platform: process.platform,
      deviceFamily: undefined,
    });
    const signature = signDevicePayload(identity.privateKeyPem, signaturePayload);
    const requestId = crypto.randomUUID();
    this.connectRequestId = requestId;

    const connectRequest = {
      type: 'req',
      id: requestId,
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'gateway-client',
          version: '1.0.35',
          platform: process.platform,
          mode: 'backend',
        },
        role: 'operator',
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: {
          token: this.token,
        },
        device: {
          id: identity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
          signature,
          signedAt,
          nonce: this.connectNonce,
        },
      },
    };

    this.ws.send(JSON.stringify(connectRequest));
  }

  private armConnectChallengeTimeout(): void {
    this.clearConnectChallengeTimeout();
    this.connectChallengeTimer = setTimeout(() => {
      if (this.connectRequestId || this.isConnected) {
        return;
      }
      this.handleDisconnected(new Error('gateway connect challenge timeout'));
      this.ws?.close(1008, 'connect challenge timeout');
    }, CONNECT_CHALLENGE_TIMEOUT_MS);
  }

  private clearConnectChallengeTimeout(): void {
    if (this.connectChallengeTimer) {
      clearTimeout(this.connectChallengeTimer);
      this.connectChallengeTimer = null;
    }
  }

  private handleDisconnected(error: Error): void {
    this.isConnected = false;
    this.connectRequestId = null;
    this.connectNonce = null;
    this.clearConnectChallengeTimeout();

    if (this.connectPromise && this.rejectConnect) {
      this.rejectConnect(error);
    }
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;

    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function getSharedGatewayTransport(gatewayWsUrl: string, token: string): GatewayWsTransport {
  const key = `${gatewayWsUrl}::${token}`;
  if (!sharedGatewayTransport || sharedGatewayTransportKey !== key) {
    sharedGatewayTransport?.dispose();
    sharedGatewayTransport = new GatewayWsTransport(gatewayWsUrl, token);
    sharedGatewayTransportKey = key;
  }
  return sharedGatewayTransport;
}

export class OpenClawClient {
  private gatewayWsUrl: string;
  private hooksWakeUrl: string;
  private token: string;
  private hooksToken: string;
  private tokenCandidates: string[];

  constructor(gatewayUrl?: string, token?: string) {
    const config = loadConfig();
    const configFileToken = readGatewayTokenFromConfigFile();
    const runtimeGatewayToken = readGatewayTokenFromRunningProcess();
    this.gatewayWsUrl = toGatewayWsUrl(gatewayUrl || config.openClawGatewayUrl);
    const gatewayHttpUrl = toGatewayHttpUrl(gatewayUrl || config.openClawGatewayUrl);
    this.hooksWakeUrl = new URL('/hooks/wake', gatewayHttpUrl).toString();
    this.tokenCandidates = collectUniqueTokens([
      token,
      runtimeGatewayToken,
      config.openClawGatewayToken,
      configFileToken,
      process.env.OPENCLAW_GATEWAY_TOKEN,
      process.env.PROXY_CUSTOMER_API_TOKEN,
      process.env.PROXY_API_TOKEN,
    ]);
    this.token = this.tokenCandidates[0] ?? config.openClawGatewayToken;
    this.hooksToken = process.env.OPENCLAW_HOOKS_TOKEN?.trim() || config.openClawHooksToken;
  }

  /**
   * Send a message to an agent via the OpenClaw gateway WebSocket protocol.
   */
  async sendMessage(opts: {
    message: string;
    agentId: string;
    sessionKey?: string;
    name?: string;
    timeoutSeconds?: number;
    onDelta?: (delta: string) => void;
  }): Promise<AgentResponse> {
    const UNKNOWN_AGENT_RETRY_DELAY_MS = 3_000;
    const MAX_UNKNOWN_AGENT_RETRIES = 2;

    let unknownAgentAttempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.sendMessageOnce(opts);
      if (
        !result.success
        && result.error
        && isUnknownAgentError(result.error)
        && unknownAgentAttempt < MAX_UNKNOWN_AGENT_RETRIES
      ) {
        // Gateway may not have reloaded its config yet after agent registration.
        unknownAgentAttempt += 1;
        await delay(UNKNOWN_AGENT_RETRY_DELAY_MS);
        continue;
      }
      return result;
    }
  }

  private async sendMessageOnce(opts: {
    message: string;
    agentId: string;
    sessionKey?: string;
    name?: string;
    timeoutSeconds?: number;
    onDelta?: (delta: string) => void;
  }): Promise<AgentResponse> {
    const timeoutMs = (opts.timeoutSeconds ?? 120) * 1000;
    let lastError = '';

    for (let index = 0; index < this.tokenCandidates.length; index += 1) {
      const token = this.tokenCandidates[index] ?? this.token;
      const runId = crypto.randomUUID();
      const transport = getSharedGatewayTransport(this.gatewayWsUrl, token);
      let streamedText = '';
      const unsubscribe = transport.subscribeToRun(runId, (event) => {
        if (event.stream !== 'assistant') {
          return;
        }
        const delta = resolveAssistantDelta(event.data, streamedText.length > 0);
        if (!delta) {
          return;
        }
        streamedText += delta;
        opts.onDelta?.(delta);
      });

      await acquireSlot();
      try {
        const payload = await transport.request<{
          status?: unknown;
          summary?: unknown;
          result?: {
            error?: unknown;
            payloads?: Array<{ text?: unknown }>;
          };
        }>(
          'agent',
          {
            message: opts.message,
            agentId: opts.agentId,
            sessionKey: opts.sessionKey,
            idempotencyKey: runId,
          },
          { expectFinal: true, timeoutMs },
        );

        if (payload.status === 'error') {
          const errorText =
            (typeof payload.result?.error === 'string' && payload.result.error) ||
            (typeof payload.summary === 'string' && payload.summary) ||
            'OpenClaw gateway returned an error';
          if (isGatewayTokenAuthError(errorText) && index + 1 < this.tokenCandidates.length) {
            lastError = errorText;
            continue;
          }
          return { success: false, error: errorText };
        }

        const payloads = Array.isArray(payload.result?.payloads) ? payload.result.payloads : [];
        const finalText = payloads
          .map((p) => (typeof p?.text === 'string' ? p.text : ''))
          .join('');
        const response = finalText || streamedText;

        this.promoteToken(token);
        return { success: true, response };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('timeout')) {
          const timeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000));
          return { success: false, error: `OpenClaw gateway timed out after ${timeoutSeconds}s` };
        }
        if (isGatewayTokenAuthError(message) && index + 1 < this.tokenCandidates.length) {
          lastError = message;
          continue;
        }
        return { success: false, error: message };
      } finally {
        unsubscribe();
        releaseSlot();
      }
    }

    return {
      success: false,
      error: lastError || 'unauthorized: gateway token mismatch (provide gateway auth token)',
    };
  }

  private promoteToken(token: string): void {
    if (!token || token === this.token) {
      return;
    }
    this.token = token;
    this.tokenCandidates = [token, ...this.tokenCandidates.filter((candidate) => candidate !== token)];
  }

  /** Fire-and-forget: enqueue a system event via the hooks API */
  async wake(text: string, mode: 'now' | 'next-heartbeat' = 'now'): Promise<boolean> {
    const res = await fetch(this.hooksWakeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.hooksToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, mode }),
    });
    return res.ok;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.hooksWakeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.hooksToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'health-check', mode: 'next-heartbeat' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
