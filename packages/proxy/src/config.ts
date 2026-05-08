import dotenv from 'dotenv';
import {
  DEFAULT_OPENCLAW_GATEWAY_URL,
  DEFAULT_PROXY_PORT
} from '@webagent/shared/constants';

dotenv.config();

export interface ProxyConfig {
  host: string;
  port: number;
  databaseUrl: string;
  openClawGatewayUrl: string;
  openClawGatewayToken: string;
  openClawHooksToken: string;
  paperclipEnabled: boolean;
  paperclipUrl: string;
}

function getHost(): string {
  const host = process.env.PROXY_BIND_HOST?.trim();
  return host || '127.0.0.1';
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getGatewayToken(): string {
  const token = (
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
    || process.env.PROXY_CUSTOMER_API_TOKEN?.trim()
    || process.env.PROXY_API_TOKEN?.trim()
  );

  if (!token) {
    throw new Error(
      'Missing required gateway auth token. Set OPENCLAW_GATEWAY_TOKEN, PROXY_CUSTOMER_API_TOKEN, or PROXY_API_TOKEN.',
    );
  }

  return token;
}

function getHooksToken(gatewayToken: string): string {
  const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN?.trim();
  return hooksToken || gatewayToken;
}

function getGatewayUrl(): string {
  const raw = process.env.OPENCLAW_GATEWAY_URL?.trim();
  if (!raw) {
    return DEFAULT_OPENCLAW_GATEWAY_URL;
  }

  return raw;
}

export function loadConfig(): ProxyConfig {
  const portValue = process.env.PORT?.trim();
  const parsedPort = portValue ? Number.parseInt(portValue, 10) : DEFAULT_PROXY_PORT;

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error('PORT must be a positive integer when provided');
  }

  const gatewayToken = getGatewayToken();

  return {
    host: getHost(),
    port: parsedPort,
    databaseUrl: getRequiredEnv('DATABASE_URL'),
    openClawGatewayUrl: getGatewayUrl(),
    openClawGatewayToken: gatewayToken,
    openClawHooksToken: getHooksToken(gatewayToken),
    paperclipEnabled: process.env.PAPERCLIP_ENABLED?.trim().toLowerCase() === 'true',
    paperclipUrl: process.env.PAPERCLIP_URL?.trim() || 'http://localhost:3100',
  };
}
