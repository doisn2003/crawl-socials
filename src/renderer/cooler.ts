import type { CoolerProgress } from '../shared/production-api.js';
import { allocatePlatformTargets } from '../shared/platform-targets.js';
declare global { interface Window { readonly cooler: { progress(): Promise<CoolerProgress> }; } }
const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = node<HTMLCanvasElement>('binary'), region = node('binary-region');
const context = canvas.getContext('2d', { alpha: false })!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let running = false, frame = 0, previous = 0, pending = false, width = 0, height = 0;
let columns = 0, rows = 0, fontSize = 13, rowHeight = 19, bits = new Uint8Array(0);
function paint() {
  context.fillStyle = '#020804'; context.fillRect(0, 0, width, height);
  context.font = `${fontSize}px Consolas, monospace`; context.textBaseline = 'top';
  for (let y = 0; y < rows; y++) {
    context.fillStyle = y % 5 === 0 ? '#39c66a' : '#227d43';
    let line = '';
    for (let x = 0; x < columns; x++) line += bits[y * columns + x] ? '1 ' : '0 ';
    context.fillText(line, 10, y * rowHeight + 8);
  }
}
function resize() {
  width = region.clientWidth; height = region.clientHeight;
  const scale = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  fontSize = Math.max(13, Math.ceil(width / 180 / 1.1), Math.ceil(height / 100 / 1.45));
  rowHeight = Math.ceil(fontSize * 1.45); context.font = `${fontSize}px Consolas, monospace`;
  columns = Math.min(180, Math.ceil(width / context.measureText('0 ').width)); rows = Math.min(100, Math.ceil(height / rowHeight));
  bits = Uint8Array.from({ length: columns * rows }, () => Math.random() < .5 ? 0 : 1); paint();
}
function animate(now: number) {
  frame = 0;
  if (!running || document.hidden || reducedMotion.matches) return;
  if (now - previous >= 125) {
    previous = now;
    for (let i = 0; i < Math.ceil(bits.length / 12); i++) { const index = Math.floor(Math.random() * bits.length); bits[index] = bits[index] ? 0 : 1; }
    paint();
  }
  frame = requestAnimationFrame(animate);
}
function syncAnimation() {
  if (frame) cancelAnimationFrame(frame); frame = 0;
  if (running && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(animate);
}
function render(progress: CoolerProgress) {
  const monitoring = progress?.opportunity?.watchActive || progress?.opportunity?.assessmentActive;
  running = progress?.state === 'RUNNING' || progress?.state === 'STOPPING' || !!monitoring;
  node('phase').textContent = progress ? ({ RUNNING: 'ĐANG THU THẬP', STOPPING: 'ĐANG LƯU VÀ DỪNG', COMPLETED: 'ĐÃ HOÀN THÀNH', STOPPED: 'ĐÃ DỪNG', FAILED: 'CÓ LỖI', INTERRUPTED: 'BỊ GIÁN ĐOẠN' }[progress.state]) : 'CHƯA CÓ LƯỢT THU';
  if (monitoring) node('phase').textContent = 'ĐANG THEO DÕI CUỘC THẢO LUẬN';
  const targets = progress?.opportunity?.resultPolicy === 'GLOBAL_FIRST_QUALIFIED' ? { facebook: progress.opportunity.totalTarget, threads: progress.opportunity.totalTarget } : progress?.opportunity ? allocatePlatformTargets(progress.opportunity.totalTarget,
    { threads: progress.opportunity.threadsShare, facebook: 1 - progress.opportunity.threadsShare }, progress.platforms.map(item => item.platform)) : null;
  for (const platform of ['facebook', 'threads'] as const) {
    const item = progress?.platforms.find(p => p.platform === platform), opportunity = progress?.opportunity;
    const target = targets ? targets[platform] : progress?.minimumPosts || 1;
    const count = opportunity ? opportunity.filterMode === 'OFF' ? opportunity.byPlatform[platform].raw : opportunity.byPlatform[platform].suitable : item?.count || 0;
    const bar = node<HTMLProgressElement>(platform + '-progress'); bar.max = Math.max(1, target); bar.value = count; bar.hidden = target === 0;
    node(platform + '-count').textContent = count.toLocaleString('vi-VN') + ' / ' + (progress ? target.toLocaleString('vi-VN') : '—') + (opportunity?.filterMode === 'OFF' ? ' bài chưa đánh giá' : opportunity ? ' bài được nhận' : ' bài') + (opportunity?.resultPolicy === 'GLOBAL_FIRST_QUALIFIED' ? ' · mục tiêu chung' : '');
    node(platform + '-state').textContent = item ? ({ QUEUED: 'Đang chờ', RUNNING: 'Đang thu thập', COMPLETED: 'Đã đạt mục tiêu', STOPPED: 'Đã dừng', FAILED: 'Có lỗi · xem cửa sổ CSD' }[item.state]) : 'Không chọn nguồn này';
  }
  syncAnimation();
}
async function refresh() {
  if (pending || document.hidden) return;
  pending = true;
  try { render(await window.cooler.progress()); node('connection').textContent = 'Tiến độ thực tế · Cập nhật mỗi giây'; }
  catch { running = false; syncAnimation(); node('connection').textContent = 'Mất kết nối · đang kết nối lại…'; }
  finally { pending = false; }
}
new ResizeObserver(resize).observe(region);
reducedMotion.addEventListener('change', syncAnimation);
document.addEventListener('visibilitychange', () => { syncAnimation(); void refresh(); });
window.addEventListener('pagehide', () => { running = false; syncAnimation(); clearInterval(poll); });
const poll = setInterval(() => { void refresh(); }, 1000);
resize(); void refresh();
