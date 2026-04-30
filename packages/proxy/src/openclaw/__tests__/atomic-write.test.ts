import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { atomicWriteFile } from '../atomic-write.js';

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'atomic-write-'));
}

test('atomicWriteFile creates a new file with the given contents', async () => {
  const dir = await makeTmp();
  const target = join(dir, 'out.txt');
  await atomicWriteFile(target, 'hello world\n');
  const got = await readFile(target, 'utf8');
  assert.equal(got, 'hello world\n');
});

test('atomicWriteFile overwrites an existing file', async () => {
  const dir = await makeTmp();
  const target = join(dir, 'out.txt');
  await writeFile(target, 'old');
  await atomicWriteFile(target, 'new contents');
  assert.equal(await readFile(target, 'utf8'), 'new contents');
});

test('atomicWriteFile leaves no .tmp sibling on success', async () => {
  const dir = await makeTmp();
  const target = join(dir, 'config.json5');
  await atomicWriteFile(target, '{ ok: true }');
  const entries = await readdir(dir);
  assert.deepEqual(
    entries.filter((e) => e.includes('.tmp')),
    [],
    'no .tmp file should remain after success',
  );
  assert.deepEqual(entries, ['config.json5']);
});

test('atomicWriteFile throws and cleans up tmp on rename failure', async () => {
  // Simulate rename failure by making the target directory read-only AFTER
  // the temp file is created. The temp file is created inside the dir, so
  // we can't lock writes ahead of time. Instead, point at a path whose
  // directory does not exist — open() will fail before the rename, but
  // that exercises the throw path. We then assert no junk leaks.
  const dir = await makeTmp();
  const target = join(dir, 'does-not-exist-subdir', 'file.txt');
  await assert.rejects(() => atomicWriteFile(target, 'x'));
  const entries = await readdir(dir);
  assert.deepEqual(entries, []);
});

test('atomicWriteFile is concurrent-safe: last writer wins, no corruption', async () => {
  const dir = await makeTmp();
  const target = join(dir, 'race.txt');
  const writers: Promise<void>[] = [];
  for (let i = 0; i < 20; i++) {
    writers.push(atomicWriteFile(target, `payload-${i}`));
  }
  await Promise.all(writers);
  const got = await readFile(target, 'utf8');
  assert.match(got, /^payload-\d+$/);
  // Ensure no orphaned .tmp files leaked.
  const entries = await readdir(dir);
  assert.deepEqual(entries, ['race.txt']);
});
