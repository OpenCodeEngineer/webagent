import dotenv from 'dotenv';
import {
  DEFAULT_OPENCLAW_GATEWAY_URL,
  DEFAULT_PROXY_PORT
} from '@webagent/shared/constants';

dotenv.config();

export interface ProxyConfig {
  port: number;
  databaseUrl: string;
  openClawGatewayUrl: string;
  openClawGatewayToken: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function loadConfig(): ProxyConfig {
  const portValue = process.env.PORT?.trim();
  const parsedPort = portValue ? Number.parseInt(portValue, 10) : DEFAULT_PROXY_PORT;

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error('PORT must be a positive integer when provided');
  }

  return {
    port: parsedPort,
    databaseUrl: getRequiredEnv('DATABASE_URL'),
    openClawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL?.trim() || DEFAULT_OPENCLAW_GATEWAY_URL,
    openClawGatewayToken: getRequiredEnv('OPENCLAW_GATEWAY_TOKEN')
  };
}
