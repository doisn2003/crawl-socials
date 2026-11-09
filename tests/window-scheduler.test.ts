import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createWindowScheduler } from '../src/application/window-scheduler.js';

// Exact non-secret memory samples from the two zero-attempt demo runs.
for (const freeBytes of [1532497920, 1709322240]) {
  test(`demo machine with ${freeBytes} free bytes starts one window instead of starving`, async () => {
    const windows = createWindowScheduler({ staggerMs: 0,
      sample: () => ({ freeBytes, totalBytes: 12674457600, cpuBusy: .15 }) });
    let stopped = false;
    const first = windows.acquire('facebook', false, () => stopped, 'first');
    const outcome = await Promise.race([first.then(lease => ({ lease })), sleep(150).then(() => null)]);
    stopped = true;
    if (outcome) outcome.lease.release();
    await first.catch(() => undefined);
    assert.ok(outcome, 'zero active windows must not wait forever on the percentage RAM reserve');
    assert.equal(windows.status().active, 0);
  });
}

for (const all of [false, true]) {
  test(`low-memory admission is serial across accounts even with ALL=${all}`, async () => {
    const windows = createWindowScheduler({ staggerMs: 0,
      sample: () => ({ freeBytes: 1532497920, totalBytes: 12674457600, cpuBusy: .1 }) });
    let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const lease = await windows.acquire(i % 2 ? 'facebook' : 'threads', all, () => false, 'account-' + (i % 3));
      peak = Math.max(peak, ++active);
      try { assert.equal(windows.status().admission, 'SERIAL_MEMORY'); await sleep(1); }
      finally { active--; lease.release(); }
    }));
    assert.equal(peak, 1); assert.equal(windows.status().active, 0); assert.equal(windows.status().queued, 0);
  });
}

test('critical memory waits visibly, cancels promptly and recovers without restarting the pool', async () => {
  let clock = 10000, freeBytes = 100e6, stopped = false;
  const windows = createWindowScheduler({ now: () => clock, staggerMs: 0,
    sample: () => ({ freeBytes, totalBytes: 12674457600, cpuBusy: .1 }) });
  const pending = windows.acquire('facebook', false, () => stopped);
  const canceled = assert.rejects(pending, /USER_STOP/);
  assert.equal(windows.status().admission, 'WAITING_MEMORY'); assert.equal(windows.status().active, 0);
  stopped = true; await canceled;
  // Recovery into the 12%-20% band used to leave the CPU limit latched at zero.
  freeBytes = 1709322240; clock += 2000;
  const lease = await windows.acquire('threads', false, () => false);
  assert.equal(windows.status().active, 1); lease.release();
});

test('less than OS headroom plus one loading window cannot be admitted; one-minute wait is bounded', async () => {
  let clock = 10000;
  const windows = createWindowScheduler({ now: () => clock, staggerMs: 0,
    sample: () => ({ freeBytes: 800 * 1024 * 1024, totalBytes: 12674457600, cpuBusy: .1 }) });
  const first = assert.rejects(windows.acquire('facebook', false, () => false), /RESOURCE_MEMORY_WAIT/);
  clock += 59_999;
  assert.equal(windows.status().memoryWaitMs, 59_999); assert.equal(windows.status().active, 0);
  clock++;
  const second = assert.rejects(windows.acquire('threads', true, () => false), /RESOURCE_MEMORY_WAIT/);
  await Promise.all([first, second]);
  assert.equal(windows.status().queued, 0); assert.equal(windows.status().active, 0);
});
