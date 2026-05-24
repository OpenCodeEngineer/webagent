// packages/proxy/src/openclaw/workspace-writer.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';

export interface SyncFields {
  name?: string;
  websiteUrl?: string | null;
  description?: string | null;
}

export interface SyncArgs {
  workspacesDir: string;
  slug: string;
  fields: SyncFields;
}

const HEADER_START = '<!-- LAMOOM:HEADER -->';
const HEADER_END = '<!-- /LAMOOM:HEADER -->';

function renderHeader(fields: Required<SyncFields>): string {
  return [
    HEADER_START,
    `Name: ${fields.name ?? ''}`,
    `Website: ${fields.websiteUrl ?? ''}`,
    `Description: ${fields.description ?? ''}`,
    HEADER_END,
  ].join('\n');
}

function replaceHeader(original: string, rendered: string): string {
  const startIdx = original.indexOf(HEADER_START);
  if (startIdx === -1) {
    const firstNl = original.indexOf('\n');
    if (firstNl === -1) return `${original}\n\n${rendered}\n`;
    return `${original.slice(0, firstNl + 1)}\n${rendered}\n${original.slice(firstNl + 1)}`;
  }
  const endIdx = original.indexOf(HEADER_END, startIdx);
  if (endIdx === -1) {
    throw new Error(`AGENTS.md has ${HEADER_START} but no ${HEADER_END}`);
  }
  return original.slice(0, startIdx) + rendered + original.slice(endIdx + HEADER_END.length);
}

export async function syncAgentWorkspaceFields(args: SyncArgs): Promise<void> {
  const workspace = join(args.workspacesDir, args.slug);
  const agentsMdPath = join(workspace, 'AGENTS.md');
  const configPath = join(workspace, 'agent-config.json');

  let mergedFields: Required<SyncFields> = { name: '', websiteUrl: '', description: '' };
  try {
    const rawConfig = await readFile(configPath, 'utf8');
    const cfg = JSON.parse(rawConfig) as Record<string, unknown>;
    mergedFields = {
      name: typeof cfg.agentName === 'string' ? cfg.agentName : '',
      websiteUrl: typeof cfg.websiteUrl === 'string' ? cfg.websiteUrl : '',
      description: typeof cfg.description === 'string' ? cfg.description : '',
    };
    if (args.fields.name !== undefined) mergedFields.name = args.fields.name;
    if (args.fields.websiteUrl !== undefined) mergedFields.websiteUrl = args.fields.websiteUrl ?? '';
    if (args.fields.description !== undefined) mergedFields.description = args.fields.description ?? '';
    const nextCfg = { ...cfg, agentName: mergedFields.name, websiteUrl: mergedFields.websiteUrl, description: mergedFields.description };
    await atomicWriteFile(configPath, JSON.stringify(nextCfg, null, 2) + '\n');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    mergedFields = {
      name: args.fields.name ?? '',
      websiteUrl: args.fields.websiteUrl ?? '',
      description: args.fields.description ?? '',
    };
  }

  try {
    const rawMd = await readFile(agentsMdPath, 'utf8');
    const next = replaceHeader(rawMd, renderHeader(mergedFields));
    if (next !== rawMd) await atomicWriteFile(agentsMdPath, next);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
