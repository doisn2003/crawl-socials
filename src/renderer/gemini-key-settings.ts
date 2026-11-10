import type { ProductionApi, GeminiKeyStatus } from '../shared/production-api.js';
export function bindGeminiKeySettings(api: ProductionApi['geminiKey'], isBusy: () => boolean) {
  const input = document.getElementById('gemini-api-key') as HTMLInputElement;
  const save = document.getElementById('save-gemini-key') as HTMLButtonElement;
  const remove = document.getElementById('remove-gemini-key') as HTMLButtonElement;
  const note = document.getElementById('gemini-key-status')!;
  let pending = false, status: GeminiKeyStatus | null = null;
  function controls() { input.disabled = pending || isBusy(); save.disabled = pending || isBusy(); remove.disabled = pending || isBusy() || status?.source !== 'SAVED'; }
  function show(value: GeminiKeyStatus) {
    status = value;
    note.textContent = value.readError ? 'Chưa đọc được key đã lưu. Nhập lại key để lưu trên máy này.' : value.source === 'SAVED'
      ? 'Đã lưu key trên máy này, được Windows bảo vệ. Dùng cho lập kế hoạch và lọc AI.' : value.source === 'ENVIRONMENT'
      ? 'Đang dùng key từ biến môi trường. Bạn có thể nhập key riêng cho FindLink tại đây.' : 'Chưa có key. Nhập Gemini API Key rồi bấm Lưu key.';
    controls();
  }
  async function change(deleting: boolean) {
    if (pending || isBusy()) return;
    pending = true; controls();
    const key = input.value; input.value = '';
    try { show(deleting ? await api.remove() : await api.save({ key })); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      note.textContent = message.includes('GEMINI_KEY_INPUT_INVALID') ? 'Key không hợp lệ. Dán đúng API key, không kèm khoảng trắng bên trong.'
        : /GEMINI_KEY_RUN_ACTIVE|GEMINI_KEY_BUSY/.test(message) ? 'Hãy dừng lượt chạy hoặc chờ lập kế hoạch xong trước khi thay key.'
        : 'Chưa lưu/xóa được key. Kiểm tra cơ chế bảo vệ thông tin của Windows rồi thử lại.';
    } finally { pending = false; controls(); }
  }
  save.addEventListener('click', () => { void change(false); });
  remove.addEventListener('click', () => { void change(true); });
  void api.status().then(show).catch(() => { note.textContent = 'Chưa đọc được trạng thái API key. Hãy mở lại ứng dụng.'; });
  return { refresh: controls };
}
