import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local';
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import { describe, expect, it } from 'vitest';

/**
 * Regression coverage for https://github.com/anywhere-labs/dsh-desktop/issues/865.
 *
 * Invariant: an externally deleted `%TEMP%/dsh-subprocess-*` spill directory must
 * never crash the host process. `OutputCollector.spillAll` recreates the owned
 * directory and retries once on `ENOENT` only; any other IO error (or a second
 * failure) degrades to the in-memory tail with no spill path, keeping the
 * truncation contract intact.
 */
function bigOutputSpec(bytes: number, maxBytes = 64): SubprocessSpawnSpec {
  return {
    argv: [process.execPath, '-e', `process.stdout.write("x".repeat(${bytes})); process.stderr.write("e".repeat(${bytes}))`],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes, spill: { maxBytes: 64 * 1024 * 1024 } },
      stderr: { maxBytes, spill: { maxBytes: 64 * 1024 * 1024 } },
    },
    graceMs: 5_000,
  };
}

async function bootSpillService(spillDir: string): Promise<{
  service: InstanceType<typeof LocalSubprocessRuntime>
  dispose(): Promise<void>
}> {
  const ctx = new Context();
  const fiber = await ctx.plugin(LocalSubprocessRuntime);
  const service = (ctx as unknown as { subprocess: InstanceType<typeof LocalSubprocessRuntime> }).subprocess;
  service.internals = { spillDir };
  return { service, dispose: async () => { await fiber.dispose(); } };
}

describe('subprocess spill recovery after external temp deletion (#865)', () => {
  it('keeps normal spill behavior unchanged', async () => {
    const spillDir = mkdtempSync(join(tmpdir(), 'dsh-865-normal-'));
    const { service, dispose } = await bootSpillService(spillDir);
    try {
      const running = service.spawn(bigOutputSpec(5_000));
      const outcome = await running.done;
      expect(outcome.exitCode).toBe(0);
      const out = running.collected.stdout?.readFrom(0);
      const err = running.collected.stderr?.readFrom(0);
      expect(out?.text).toBe('x'.repeat(64));
      expect(out?.lossy).toBe(true);
      expect(out?.spillPath).toBeDefined();
      expect(readFileSync(out?.spillPath ?? '', 'utf8')).toBe('x'.repeat(5_000));
      expect(err?.text).toBe('e'.repeat(64));
      expect(err?.spillPath).toBeDefined();
      expect(readFileSync(err?.spillPath ?? '', 'utf8')).toBe('e'.repeat(5_000));
      if (process.platform !== 'win32' && out?.spillPath !== undefined) {
        expect(statSync(out.spillPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      await dispose();
      rmSync(spillDir, { recursive: true, force: true });
    }
  });

  it('recovers stdout and stderr spill after the spill directory is deleted', async () => {
    const spillDir = mkdtempSync(join(tmpdir(), 'dsh-865-recover-'));
    const { service, dispose } = await bootSpillService(spillDir);
    try {
      const first = service.spawn(bigOutputSpec(5_000));
      await first.done;
      expect(first.collected.stdout?.readFrom(0).spillPath).toBeDefined();
      rmSync(spillDir, { recursive: true, force: true });
      expect(existsSync(spillDir)).toBe(false);
      const running = service.spawn(bigOutputSpec(5_000));
      const outcome = await running.done;
      expect(outcome.exitCode).toBe(0);
      expect(existsSync(spillDir)).toBe(true);
      const out = running.collected.stdout?.readFrom(0);
      const err = running.collected.stderr?.readFrom(0);
      expect(out?.spillPath).toBeDefined();
      expect(out?.spillPath?.startsWith(spillDir)).toBe(true);
      expect(readFileSync(out?.spillPath ?? '', 'utf8')).toBe('x'.repeat(5_000));
      expect(out?.text).toBe('x'.repeat(64));
      expect(err?.spillPath).toBeDefined();
      expect(readFileSync(err?.spillPath ?? '', 'utf8')).toBe('e'.repeat(5_000));
    } finally {
      await dispose();
      rmSync(spillDir, { recursive: true, force: true });
    }
  });

  it('recovers repeatedly after consecutive deletions', async () => {
    const spillDir = mkdtempSync(join(tmpdir(), 'dsh-865-repeat-'));
    const { service, dispose } = await bootSpillService(spillDir);
    try {
      for (let round = 0; round < 3; round += 1) {
        rmSync(spillDir, { recursive: true, force: true });
        const running = service.spawn(bigOutputSpec(2_000));
        const outcome = await running.done;
        const out = running.collected.stdout?.readFrom(0);
        expect(outcome.exitCode).toBe(0);
        expect(out?.spillPath).toBeDefined();
        expect(existsSync(out?.spillPath ?? '')).toBe(true);
        expect(readFileSync(out?.spillPath ?? '', 'utf8')).toBe('x'.repeat(2_000));
      }
    } finally {
      await dispose();
      rmSync(spillDir, { recursive: true, force: true });
    }
  });

  it('degrades to the in-memory tail when the spill directory cannot be recreated', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'dsh-865-blocked-'));
    const blocked = join(parent, 'blocked');
    writeFileSync(blocked, 'a file, not a directory');
    const { service, dispose } = await bootSpillService(blocked);
    try {
      const running = service.spawn(bigOutputSpec(2_000));
      const outcome = await running.done;
      expect(outcome.exitCode).toBe(0);
      const out = running.collected.stdout?.readFrom(0);
      expect(out?.spillPath).toBeUndefined();
      expect(out?.text).toBe('x'.repeat(64));
      expect(out?.lossy).toBe(true);
      expect(statSync(blocked).isFile()).toBe(true);
    } finally {
      await dispose();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps disposal safe after a recovery', async () => {
    const spillDir = mkdtempSync(join(tmpdir(), 'dsh-865-dispose-'));
    const { service, dispose } = await bootSpillService(spillDir);
    let spillPath: string | undefined;
    try {
      const first = service.spawn(bigOutputSpec(2_000));
      await first.done;
      rmSync(spillDir, { recursive: true, force: true });
      const running = service.spawn(bigOutputSpec(2_000));
      await running.done;
      spillPath = running.collected.stdout?.readFrom(0).spillPath;
      expect(spillPath).toBeDefined();
      expect(existsSync(spillPath ?? '')).toBe(true);
    } finally {
      await dispose();
    }
    expect(spillPath).toBeDefined();
    expect(existsSync(spillPath ?? '')).toBe(true);
    rmSync(spillDir, { recursive: true, force: true });
  });

  it('does not treat non-ENOENT open failures as recoverable', async () => {
    // A file standing where a directory is expected surfaces ENOTDIR (never
    // ENOENT) from openSync. EACCES/ENOSPC take the same non-ENOENT branch:
    // only code === 'ENOENT' may recreate the directory; everything else
    // degrades to memory without a retry.
    const parent = mkdtempSync(join(tmpdir(), 'dsh-865-nonenoent-'));
    const notDir = join(parent, 'afile');
    writeFileSync(notDir, 'x');
    const { service, dispose } = await bootSpillService(join(notDir, 'child'));
    try {
      const running = service.spawn(bigOutputSpec(2_000));
      const outcome = await running.done;
      expect(outcome.exitCode).toBe(0);
      const out = running.collected.stdout?.readFrom(0);
      expect(out?.spillPath).toBeUndefined();
      expect(out?.text).toBe('x'.repeat(64));
      expect(out?.lossy).toBe(true);
    } finally {
      await dispose();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
