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
  let limit = 2, lastSample = 0, nextStart = 0, lastPlatform = '', sequence = 0;
  let metrics = sample(), timer: ReturnType<typeof setTimeout> | undefined;
  const active = new Set<number>();
  type Waiter = { platform: string; all: boolean; stopped: () => boolean; resolve: (lease: { release(): void; shouldYield(): boolean }) => void; reject: (e: Error) => void };
  const queue: Waiter[] = [];
  function refresh() {
    if (now() - lastSample < 1000) return;
    lastSample = now(); metrics = sample();
    if (metrics.freeBytes < 512 * 1024 * 1024) limit = 0;
    else if (metrics.freeBytes / metrics.totalBytes < 0.12 || metrics.cpuBusy > 0.88) limit = Math.max(1, Math.floor(limit / 2));
    else if (metrics.freeBytes / metrics.totalBytes > 0.20 && metrics.cpuBusy < 0.70) limit = Math.min(32, Math.max(2, limit + 1));
  }
  function capacity(all: boolean) {
    refresh();
    // ALL removes the automatic ramp; it still respects measured memory/CPU pressure.
    return all && metrics.cpuBusy < 0.88 && metrics.freeBytes / metrics.totalBytes >= 0.12 ? 200 : limit;
  }
  function drain() {
    if (timer) clearTimeout(timer); timer = undefined;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.stopped()) queue.splice(i, 1)[0]!.reject(Error('USER_STOP'));
    while (queue.length) {
      const index = Math.max(0, queue.findIndex(w => w.platform !== lastPlatform)), w = queue[index]!;
      if (active.size >= capacity(w.all) || now() < nextStart) break;
      queue.splice(index, 1); const id = ++sequence; active.add(id); lastPlatform = w.platform;
      nextStart = now() + (options.staggerMs ?? 600);
      let released = false;
      w.resolve({ release() { if (!released) { released = true; active.delete(id); drain(); } },
        shouldYield() {
          const slots = capacity(w.all);
          // CPU bursts during page load must not tear down ALL windows and trigger
          // another expensive reload. Pressure limits new admissions; already open
          // per-query windows finish their bounded slice unless memory is critical.
          if (w.all) return metrics.freeBytes < 512 * 1024 * 1024;
          return [...active].indexOf(id) >= slots;
        } });
    }
    if (queue.length) timer = setTimeout(drain, 100);
  }
  return {
    acquire(platform: string, all: boolean, stopped: () => boolean) {
      return new Promise<{ release(): void; shouldYield(): boolean }>((resolve, reject) => { queue.push({ platform, all, stopped, resolve, reject }); drain(); });
    },
    status: () => ({ active: active.size, queued: queue.length, automaticLimit: limit, ...metrics }),
  };
}
export const sharedWindows = createWindowScheduler();
