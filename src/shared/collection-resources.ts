import type { RunState } from './production-api.js';

export interface CollectionResources {
  active: number; queued: number; automaticLimit: number; activeProfiles: number;
  freeBytes: number; totalBytes: number; cpuBusy: number; pressureSince: number | null;
  admission: 'NORMAL' | 'SERIAL_MEMORY' | 'WAITING_MEMORY';
  memoryWaitMs: number; sampledAt: number;
}

export const memoryPauseMessage = 'Đã tạm dừng vì chưa đủ RAM trống để mở tìm kiếm. Đóng bớt ứng dụng hoặc cửa sổ mạng xã hội, rồi chọn Tiếp tục lượt này. Dữ liệu và kế hoạch đã được giữ lại.';
export function collectionResourceNotice(run: Pick<RunState, 'state' | 'platforms'> | null | undefined): string | null {
  if (!run || run.state !== 'RUNNING') return null;
  const sources = run.platforms.filter(p => p.state === 'RUNNING' || p.state === 'QUEUED');
  const resources = sources.flatMap(p => p.resources ? [p.resources] : []).sort((a, b) => b.sampledAt - a.sampledAt)[0];
  if (!resources) return null;
  if (resources.admission === 'WAITING_MEMORY' && resources.active === 0 && resources.queued > 0)
    return 'Đang chờ RAM trống để tìm bài. Đóng bớt ứng dụng hoặc cửa sổ mạng xã hội; FindLink sẽ tự tiếp tục khi đủ RAM, hoặc tạm dừng nếu phải chờ quá một phút.';
  if (resources.admission === 'SERIAL_MEMORY') return 'Đang tìm lần lượt để giảm sử dụng RAM.';
  return null;
}
