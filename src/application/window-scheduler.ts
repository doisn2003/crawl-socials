import { cpus, freemem, totalmem } from 'node:os';

export interface ResourceSample { freeBytes: number; totalBytes: number; cpuBusy: number; }
let previousCpu: { idle: number; total: number } | null = null;
export function sampleResources(): ResourceSample {
  const current = cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
  const busy = previousCpu && current.total > previousCpu.total ? 1 - (current.idle - previousCpu.idle) / (current.total - previousCpu.total) : 0;
  previousCpu = current; return { freeBytes: freemem(), totalBytes: totalmem(), cpuBusy: Math.max(0, Math.min(1, busy)) };
}
/** One FIFO admission pool across every platform. Resources limit active windows, never task coverage. */
export function createWindowScheduler(options: { sample?: () => ResourceSample; staggerMs?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now, sample = options.sample ?? sampleResources;
  let limit = 2, lastSample = 0, nextStart = 0, lastPlatform = '', lastOwner = '', sequence = 0, pressureSince: number | null = null;
  let metrics = sample(), timer: ReturnType<typeof setTimeout> | undefined;
  const active = new Set<number>(), owners = new Map<number, string>();
  type Waiter = { platform: string; owner: string; all: boolean; stopped: () => boolean; resolve: (lease: { release(): void; shouldYield(): boolean }) => void; reject: (e: Error) => void };
  const queue: Waiter[] = [];
  function refresh() {
    if (now() - lastSample < 1000) return;
    lastSample = now(); metrics = sample();
    const pressure = metrics.freeBytes / metrics.totalBytes < 0.12 || metrics.cpuBusy > 0.88;
    pressureSince = pressure ? pressureSince ?? now() : null;
    if (metrics.freeBytes < 512 * 1024 * 1024) limit = 0;
    else if (pressure && pressureSince !== null && now() - pressureSince >= 3000) limit = Math.max(1, Math.floor(limit / 2));
    else if (metrics.freeBytes / metrics.totalBytes > 0.20 && metrics.cpuBusy < 0.70) limit = Math.min(32, Math.max(2, limit + 1));
  }
  function capacity(all: boolean) {
    refresh();
    // Reserve OS headroom plus a conservative allocation for another loading page.
    // FAST skips the slow ramp, never the measured memory ceiling.
    const reserve = Math.max(512 * 1024 * 1024, metrics.totalBytes * .12);
    const memorySlots = Math.max(0, Math.floor((metrics.freeBytes - reserve) / (384 * 1024 * 1024)));
    return Math.min(32, active.size + memorySlots,
      all && metrics.cpuBusy < .88 && metrics.freeBytes / metrics.totalBytes >= .12 ? 32 : limit);
  }
  function drain() {
    if (timer) clearTimeout(timer); timer = undefined;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.stopped()) queue.splice(i, 1)[0]!.reject(Error('USER_STOP'));
    while (queue.length) {
      const otherOwner = queue.findIndex(w => w.owner !== lastOwner);
      const index = otherOwner >= 0 ? otherOwner : Math.max(0, queue.findIndex(w => w.platform !== lastPlatform)), w = queue[index]!;
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
          if (metrics.freeBytes < 512 * 1024 * 1024) return true;
          // One loading CPU spike stops admissions, not healthy loaded windows.
          return pressureSince !== null && now() - pressureSince >= 5000 && [...active].indexOf(id) >= slots;
        } });
    }
    if (queue.length) timer = setTimeout(drain, 100);
  }
  return {
    acquire(platform: string, all: boolean, stopped: () => boolean, profileId?: string) {
      return new Promise<{ release(): void; shouldYield(): boolean }>((resolve, reject) => { queue.push({ platform, owner: profileId ?? platform, all, stopped, resolve, reject }); drain(); });
    },
    status: () => ({ active: active.size, queued: queue.length, automaticLimit: limit,
      activeProfiles: new Set(owners.values()).size, pressureSince, ...metrics }),
  };
}
export const sharedWindows = createWindowScheduler();
