import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import JSON5 from 'json5';

import {
  extractLeadingHeader,
  resolveOpenClawConfigPath,
  resolveOpenClawWorkspacesDir,
} from '../routes/api.js';
import { atomicWriteFile } from './atomic-write.js';

export interface ReconcileResult {
  added: string[];
  updated: string[];
  removed: string[];
  errors: string[];
}

interface OpenClawAgentEntry {
  id: string;
  name?: string;
  workspace?: string;
  sandbox?: { mode?: string };
  skills?: string[];
  heartbeat?: { every?: string; target?: string };
  userTokenKey?: string;
  [k: string]: unknown;
}

interface OpenClawConfig {
  agents?: { list?: OpenClawAgentEntry[] };
  [k: string]: unknown;
}

interface DesiredEntry {
  id: string;
  name: string;
  skills?: string[];
  userTokenKey?: string;
}

const RESERVED_SLUGS = new Set(['meta']);

/**
 * Reconcile `openclaw.json5` against the per-agent workspaces on disk.
 *
 * - For every `openclaw/workspaces/<slug>/agent-config.json` (skipping
 *   `meta` and dirs without that file), ensure an entry exists in
 *   openclaw.json5 with up-to-date `name`, `skills`, `userTokenKey`,
 *   `workspace`, and `sandbox`.
 * - When env `OPENCLAW_RECONCILE_REMOVE_ORPHANS=true`, also delete
 *   entries whose workspace dir no longer exists (excluding RESERVED_SLUGS
 *   and any whose `id` matches an agent-config we couldn't read — those
 *   are surfaced as errors instead).
 * - Performs ONE atomic JSON5 write and ONE gateway SIGHUP, regardless
 *   of how many entries changed. No-ops when nothing changed.
 * - Never throws on per-workspace errors; surfaces them in `errors`.
 */
export async function reconcileOpenClawConfig(app: FastifyInstance): Promise<ReconcileResult> {
  const result: ReconcileResult = { added: [], updated: [], removed: [], errors: [] };

  const configPath = resolveOpenClawConfigPath();
  const workspacesDir = resolveOpenClawWorkspacesDir();

  // 1. Load openclaw.json5 (must exist — refuse to run otherwise).
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    const msg = `cannot read openclaw config at ${configPath}: ${(err as Error).message}`;
    app.log.warn({ err, configPath }, 'reconciler: openclaw config unreadable; skipping');
    result.errors.push(msg);
    return result;
  }

  let config: OpenClawConfig;
  try {
    config = JSON5.parse(raw) as OpenClawConfig;
  } catch (err) {
    const msg = `openclaw config is not valid JSON5: ${(err as Error).message}`;
    app.log.error({ err, configPath }, 'reconciler: openclaw config parse failed');
    result.errors.push(msg);
    return result;
  }

  if (!config.agents || !Array.isArray(config.agents.list)) {
    result.errors.push('openclaw config missing agents.list');
    return result;
  }

  // 2. Walk workspaces and build the desired-state map.
  const desiredById = new Map<string, DesiredEntry>();
  let workspaceSlugs: string[];
  try {
    workspaceSlugs = await readdir(workspacesDir);
  } catch (err) {
    const msg = `failed to list workspaces dir ${workspacesDir}: ${(err as Error).message}`;
    app.log.warn({ err, workspacesDir }, 'reconciler: workspaces dir unreadable');
    result.errors.push(msg);
    return result;
  }

  for (const slug of workspaceSlugs) {
    if (RESERVED_SLUGS.has(slug)) continue;
    const workspacePath = join(workspacesDir, slug);
    try {
      const st = await stat(workspacePath);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const agentConfigPath = join(workspacePath, 'agent-config.json');
    let agentRaw: string;
    try {
      agentRaw = await readFile(agentConfigPath, 'utf8');
    } catch {
      // No agent-config.json — not a registerable agent (e.g. scratch dir).
      continue;
    }

    let parsed: { agentSlug?: unknown; agentName?: unknown; skills?: unknown; userTokenKey?: unknown };
    try {
      parsed = JSON.parse(agentRaw);
    } catch (err) {
      result.errors.push(`${slug}: invalid agent-config.json: ${(err as Error).message}`);
      continue;
    }

    const id = typeof parsed.agentSlug === 'string' && parsed.agentSlug.trim().length > 0
      ? parsed.agentSlug.trim()
      : slug;
    const name = typeof parsed.agentName === 'string' && parsed.agentName.trim().length > 0
      ? parsed.agentName.trim()
      : id;
    const skills = Array.isArray(parsed.skills)
      ? parsed.skills.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : undefined;
    const userTokenKey = typeof parsed.userTokenKey === 'string' && parsed.userTokenKey.trim().length > 0
      ? parsed.userTokenKey.trim()
      : undefined;

    desiredById.set(id, {
      id,
      name,
      skills: skills && skills.length > 0 ? skills : undefined,
      userTokenKey,
    });
  }

  // 3. Diff desired vs. current.
  const current = config.agents.list;
  const currentById = new Map(current.map((e) => [e.id, e]));
  const removeOrphans = (process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS ?? '').toLowerCase() === 'true';
  const newList: OpenClawAgentEntry[] = [];
  let changed = false;

  for (const existing of current) {
    if (RESERVED_SLUGS.has(existing.id)) {
      newList.push(existing);
      continue;
    }
    const desired = desiredById.get(existing.id);
    if (!desired) {
      // Orphan — entry in openclaw.json5 with no workspace on disk.
      if (removeOrphans) {
        result.removed.push(existing.id);
        changed = true;
        continue;
      }
      newList.push(existing);
      continue;
    }
    // Update mutable fields in place; preserve any extra fields.
    const desiredWorkspace = join(workspacesDir, existing.id);
    const desiredSkills = desired.skills ?? ['website-api'];
    const merged: OpenClawAgentEntry = {
      ...existing,
      name: desired.name,
      workspace: desiredWorkspace,
      sandbox: existing.sandbox ?? { mode: 'off' },
      skills: desiredSkills,
    };
    if (desired.userTokenKey !== undefined) merged.userTokenKey = desired.userTokenKey;

    if (!shallowEntryEqual(existing, merged)) {
      result.updated.push(existing.id);
      changed = true;
    }
    newList.push(merged);
  }

  for (const desired of desiredById.values()) {
    if (currentById.has(desired.id)) continue;
    const entry: OpenClawAgentEntry = {
      id: desired.id,
      name: desired.name,
      workspace: join(workspacesDir, desired.id),
      sandbox: { mode: 'off' },
      skills: desired.skills ?? ['website-api'],
      heartbeat: { every: '30m' },
    };
    if (desired.userTokenKey !== undefined) entry.userTokenKey = desired.userTokenKey;
    newList.push(entry);
    result.added.push(desired.id);
    changed = true;
  }

  if (!changed) {
    app.log.info(
      {
        configPath,
        workspacesDir,
        workspaces: desiredById.size,
        currentEntries: current.length,
      },
      'openclaw reconciler: no changes',
    );
    return result;
  }

  config.agents.list = newList;

  // 4. Write atomically (single write for all changes).
  // 4d note: leading header (license/copyright) is preserved; inline
  // comments inside the object are still lost.
  const header = extractLeadingHeader(raw);
  const serialized = JSON5.stringify(config, null, 2);
  const output = `${header}${serialized}\n`;

  try {
    await atomicWriteFile(configPath, output);
  } catch (err) {
    result.errors.push(`atomic write failed: ${(err as Error).message}`);
    app.log.error({ err, configPath }, 'reconciler: atomic write failed');
    return result;
  }

  app.log.info(
    {
      configPath,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
    },
    `openclaw reconciler: +${result.added.length} ~${result.updated.length} -${result.removed.length}`,
  );

  // 5. Best-effort gateway reload (single SIGHUP for all changes).
  await new Promise<void>((resolve) => {
    execFile('pgrep', ['-f', 'openclaw.*gateway'], { timeout: 5_000 }, (err, stdout) => {
      if (err || !stdout?.trim()) {
        app.log.warn('reconciler: pgrep could not find openclaw gateway PID');
        resolve();
        return;
      }
      const pid = stdout.trim().split('\n')[0] ?? '';
      if (!pid) {
        resolve();
        return;
      }
      execFile('kill', ['-HUP', pid], { timeout: 5_000 }, (killErr) => {
        if (killErr) {
          app.log.warn({ err: killErr, pid }, 'reconciler: SIGHUP failed');
        } else {
          app.log.info({ pid }, 'reconciler: sent SIGHUP to openclaw gateway');
        }
        resolve();
      });
    });
  });

  return result;
}

/**
 * Compare two entries for the fields the reconciler controls. Extra fields
 * present on `a` but not produced by us are ignored (we always preserve
 * them via spread, so they cannot drift).
 */
function shallowEntryEqual(a: OpenClawAgentEntry, b: OpenClawAgentEntry): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.workspace !== b.workspace) return false;
  if (a.userTokenKey !== b.userTokenKey) return false;
  if ((a.sandbox?.mode ?? null) !== (b.sandbox?.mode ?? null)) return false;
  const sa = a.skills ?? [];
  const sb = b.skills ?? [];
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}
