import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

/**
 * Recursively scan all .md files in a workspace directory and return
 * a list of errors for any unresolved {{placeholder}} tokens found.
 *
 * Ignores:
 * - Files under any `templates/` subdirectory (those ARE templates).
 * - Occurrences inside fenced code blocks (``` ... ```).
 */
export async function validateGeneratedWorkspace(workspacePath: string): Promise<string[]> {
  const errors: string[] = [];
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

      const regex = /\{\{[^}]+\}\}/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        errors.push(`${rel}:${i + 1}: unresolved placeholder ${match[0]}`);
      }
    }
  }

  return errors;
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
    } else if (entry.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}
