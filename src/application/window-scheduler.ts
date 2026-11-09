import { cpus, freemem, totalmem } from 'node:os';
import type { CollectionResources } from '../shared/collection-resources.js';

export interface ResourceSample { freeBytes: number; totalBytes: number; cpuBusy: number; }
const OS_HEADROOM = 512 * 1024 * 1024, WINDOW_ALLOWANCE = 384 * 1024 * 1024;
let previousCpu: { idle: number; total: number } | null = null;
export function sampleResources(): ResourceSample {
  const current = cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
  const busy = previousCpu && current.total > previousCpu.total ? 1 - (current.idle - previousCpu.idle) / (current.total - previousCpu.total) : 0;
  previousCpu = current; return { freeBytes: freemem(), totalBytes: totalmem(), cpuBusy: Math.max(0, Math.min(1, busy)) };
}
/** One FIFO admission pool across every platform. Resources limit active windows, never task coverage. */
export function createWindowScheduler(options: { sample?: () => ResourceSample; staggerMs?: number; now?: () => number; maxIdleWaitMs?: number } = {}) {
  const now = options.now ?? Date.now, sample = options.sample ?? sampleResources;
  const maxIdleWaitMs = options.maxIdleWaitMs ?? 60_000;
  if (!Number.isFinite(maxIdleWaitMs) || maxIdleWaitMs < 1) throw Error('RESOURCE_WAIT_LIMIT_INVALID');
  let limit = 2, lastSample = 0, nextStart = 0, lastPlatform = '', lastOwner = '', sequence = 0, pressureSince: number | null = null;
  let memoryWaitSince: number | null = null;
  let metrics = sample(), timer: ReturnType<typeof setTimeout> | undefined;
  const active = new Set<number>(), owners = new Map<number, string>();
  type Waiter = { platform: string; owner: string; all: boolean; background: boolean; stopped: () => boolean; resolve: (lease: { release(): void; shouldYield(): boolean }) => void; reject: (e: Error) => void };
  const queue: Waiter[] = [];
  function refresh() {
    if (now() - lastSample < 1000) return;
    lastSample = now(); metrics = sample();
    const pressure = metrics.freeBytes / metrics.totalBytes < 0.12 || metrics.cpuBusy > 0.88;
    pressureSince = pressure ? pressureSince ?? now() : null;
    if (metrics.freeBytes < OS_HEADROOM) limit = 0;
    else if (pressure && pressureSince !== null && now() - pressureSince >= 3000) limit = Math.max(1, Math.floor(limit / 2));
    else if (metrics.freeBytes / metrics.totalBytes > 0.20 && metrics.cpuBusy < 0.70) limit = Math.min(32, Math.max(2, limit + 1));
    else limit = Math.max(1, limit); // A past critical-memory sample must not latch admission at zero.
  }
  const memorySlots = () => Math.max(0, Math.floor((metrics.freeBytes - Math.max(OS_HEADROOM, metrics.totalBytes * .12)) / WINDOW_ALLOWANCE));
  function capacity(all: boolean) {
    refresh();
    // The percentage reserve controls parallelism, not whether work may ever start.
    // Permit ONE window with absolute OS headroom + its loading allowance. Never
    // use this fallback to open a second window, including in ALL/FAST mode.
    const serialFloor = metrics.freeBytes >= OS_HEADROOM + WINDOW_ALLOWANCE ? 1 : 0;
    return Math.min(32, Math.max(active.size + memorySlots(), serialFloor),
      all && metrics.cpuBusy < .88 && metrics.freeBytes / metrics.totalBytes >= .12 ? 32 : limit);
  }
  function drain() {
    if (timer) clearTimeout(timer); timer = undefined;
    refresh();
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.stopped()) queue.splice(i, 1)[0]!.reject(Error('USER_STOP'));
    const idleMemoryWait = queue.length > 0 && active.size === 0 && metrics.freeBytes < OS_HEADROOM + WINDOW_ALLOWANCE;
    memoryWaitSince = idleMemoryWait ? memoryWaitSince ?? now() : null;
    if (memoryWaitSince !== null && now() - memoryWaitSince >= maxIdleWaitMs) {
      for (const waiter of queue.splice(0)) waiter.reject(Error('RESOURCE_MEMORY_WAIT'));
      memoryWaitSince = null;
      return;
    }
    while (queue.length) {
      const background = queue.every(waiter => waiter.background);
      const otherOwner = queue.findIndex(w => w.background === background && w.owner !== lastOwner);
      const otherPlatform = queue.findIndex(w => w.background === background && w.platform !== lastPlatform);
      const index = otherOwner >= 0 ? otherOwner : otherPlatform >= 0 ? otherPlatform : queue.findIndex(w => w.background === background);
      const w = queue[index]!;
      if (active.size >= capacity(w.all) || now() < nextStart) break;
      queue.splice(index, 1); const id = ++sequence; active.add(id); owners.set(id, w.owner); lastPlatform = w.platform; lastOwner = w.owner;
      nextStart = now() + (options.staggerMs ?? 600);
      let released = false;
      w.resolve({ release() { if (!released) { released = true; active.delete(id); owners.delete(id); drain(); } },
        shouldYield() {
          const slots = capacity(w.all);
          // CPU bursts during page load must not tear down ALL windows and trigger
          // another expensive reload. Pressure limits new admissions; already open
          // per-query windows finish their bounded slice unless memory is critical.
          if (metrics.freeBytes < OS_HEADROOM) return true;
          // One loading CPU spike stops admissions, not healthy loaded windows.
          return pressureSince !== null && now() - pressureSince >= 5000 && [...active].indexOf(id) >= slots;
        } });
    }
    if (queue.length) timer = setTimeout(drain, 100);
  }
  return {
    acquire(platform: string, all: boolean, stopped: () => boolean, profileId?: string, background = false) {
      return new Promise<{ release(): void; shouldYield(): boolean }>((resolve, reject) => { queue.push({ platform, owner: profileId ?? platform, all, background, stopped, resolve, reject }); drain(); });
    },
    status: (): CollectionResources => {
      refresh();
      return { active: active.size, queued: queue.length, automaticLimit: limit,
        activeProfiles: new Set(owners.values()).size, pressureSince, ...metrics, sampledAt: lastSample,
        admission: metrics.freeBytes < OS_HEADROOM + WINDOW_ALLOWANCE ? 'WAITING_MEMORY' : memorySlots() === 0 ? 'SERIAL_MEMORY' : 'NORMAL',
        memoryWaitMs: memoryWaitSince === null ? 0 : Math.max(0, now() - memoryWaitSince) };
    },
  };
}
export const sharedWindows = createWindowScheduler();
