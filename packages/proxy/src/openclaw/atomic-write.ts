import { randomBytes } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';

/**
 * Atomic file write: write to a sibling temp file in the same directory,
 * fsync, then rename over the target. The directory rename is atomic on
 * POSIX, so a concurrent reader either sees the old file or the new one —
 * never a half-written one.
 *
 * The temp file lives next to the destination so the rename stays inside
 * the same filesystem (cross-fs renames are not atomic).
 */
export async function atomicWriteFile(targetPath: string, contents: string): Promise<void> {
  const tmp = `${targetPath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tmp, 'w', 0o644);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  try {
    await rename(tmp, targetPath);
  } catch (err) {
    // Best-effort cleanup of the orphaned temp file.
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
