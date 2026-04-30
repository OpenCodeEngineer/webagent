import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

export interface WorkspaceValidationResult {
  valid: boolean;
  errors: string[];
}

/** Required files that must exist and be non-empty in every workspace. */
const REQUIRED_FILES = ['AGENTS.md', 'IDENTITY.md', 'SOUL.md'] as const;

/**
 * Recursively scan all .md files in a workspace directory and return
 * validation results including unresolved {{PLACEHOLDER}} tokens and
 * missing/empty required files.
 *
 * Ignores:
 * - Files under any `templates/` subdirectory (those ARE templates).
 * - Occurrences inside fenced code blocks (``` ... ```).
 */
export async function validateGeneratedWorkspace(
  workspacePath: string,
): Promise<WorkspaceValidationResult> {
  const errors: string[] = [];

  // Check required files exist and are non-empty
  for (const requiredFile of REQUIRED_FILES) {
    const filePath = join(workspacePath, requiredFile);
    try {
      const content = await readFile(filePath, 'utf8');
      if (content.trim().length === 0) {
        errors.push(`${requiredFile}: required file is empty`);
      }
    } catch {
      errors.push(`${requiredFile}: required file is missing`);
    }
  }

  // Scan for unresolved placeholder tokens
  const mdFiles = await collectMdFiles(workspacePath);

  for (const filePath of mdFiles) {
    // Skip files in templates/ subdirectory
    const rel = relative(workspacePath, filePath);
    if (rel.startsWith('templates/') || rel.startsWith('templates\\')) {
      continue;
    }

    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const regex = /\{\{[A-Z_]+\}\}/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        errors.push(`${rel}:${i + 1} — un-replaced placeholder ${match[0]}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) {
      results.push(...(await collectMdFiles(fullPath)));
    } else if (entry.endsWith('.md') || entry.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}
