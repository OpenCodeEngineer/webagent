import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

import {
  registerAgentInOpenClaw,
  resolveOpenClawWorkspacesDir,
} from '../routes/api.js';

export interface ReconcileResult {
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Walk every per-agent workspace directory under the configured workspaces
 * root and ensure each `agent-config.json` is reflected in `openclaw.json5`.
 *
 * - Skips workspaces without an `agent-config.json` (e.g. `meta`).
 * - A single broken workspace must NOT abort the rest of the reconcile.
 * - Errors are accumulated and returned; never thrown.
 */
export async function reconcileOpenClawConfig(app: FastifyInstance): Promise<ReconcileResult> {
  const result: ReconcileResult = { updated: 0, skipped: 0, errors: [] };
  const workspacesDir = resolveOpenClawWorkspacesDir();

  let entries: string[];
  try {
    entries = await readdir(workspacesDir);
  } catch (err) {
    const msg = `failed to read workspaces dir ${workspacesDir}: ${(err as Error).message}`;
    app.log.warn({ err, workspacesDir }, 'reconciler: cannot list workspaces');
    result.errors.push(msg);
    return result;
  }

  for (const slug of entries) {
    const workspacePath = join(workspacesDir, slug);
    try {
      const st = await stat(workspacePath);
      if (!st.isDirectory()) {
        result.skipped++;
        continue;
      }
    } catch {
      result.skipped++;
      continue;
    }

    const configPath = join(workspacePath, 'agent-config.json');
    let raw: string;
    try {
      raw = await readFile(configPath, 'utf8');
    } catch {
      // No agent-config.json (e.g. the `meta` workspace) — skip silently.
      result.skipped++;
      continue;
    }

    let parsed: { agentSlug?: unknown; agentName?: unknown; skills?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = `${slug}: invalid agent-config.json: ${(err as Error).message}`;
      app.log.warn({ err, slug, configPath }, 'reconciler: parse failed');
      result.errors.push(msg);
      continue;
    }

    const agentSlug = typeof parsed.agentSlug === 'string' && parsed.agentSlug.trim().length > 0
      ? parsed.agentSlug.trim()
      : slug;
    const agentName = typeof parsed.agentName === 'string' && parsed.agentName.trim().length > 0
      ? parsed.agentName.trim()
      : agentSlug;
    const skills = Array.isArray(parsed.skills)
      ? parsed.skills.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : undefined;

    try {
      await registerAgentInOpenClaw(agentSlug, agentName, app, skills && skills.length > 0 ? skills : undefined);
      result.updated++;
    } catch (err) {
      const msg = `${slug}: registerAgentInOpenClaw failed: ${(err as Error).message}`;
      app.log.warn({ err, slug }, 'reconciler: register failed');
      result.errors.push(msg);
    }
  }

  app.log.info(
    { updated: result.updated, skipped: result.skipped, errorCount: result.errors.length, workspacesDir },
    'openclaw config reconciler complete',
  );
  return result;
}
