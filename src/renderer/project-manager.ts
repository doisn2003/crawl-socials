import type { ProjectsApi, ProjectWorkspaceState } from '../shared/projects.js';

type Project = ProjectWorkspaceState['projects'][number];

export function bindProjectManager(api: ProjectsApi, input: {
  busy(): boolean;
  execute(work: () => Promise<ProjectWorkspaceState>): Promise<ProjectWorkspaceState>;
}) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const list = element<HTMLDivElement>('project-list');
  const editor = element<HTMLDialogElement>('project-editor');
  const authDialog = element<HTMLDialogElement>('project-auth-dialog');
  const deleteDialog = element<HTMLDialogElement>('project-delete-dialog');
  const name = element<HTMLInputElement>('project-name');
  const avatarFile = element<HTMLInputElement>('project-avatar-file');
  const avatarPreview = element<HTMLImageElement>('project-avatar-preview');
  const username = element<HTMLInputElement>('project-username');
  const password = element<HTMLInputElement>('project-password');
  const invite = element<HTMLInputElement>('project-invite');
  let state: ProjectWorkspaceState | null = null;
  let pending = false, refreshing = false, lastRender = '', avatarLoading = false;
  let editingId: string | null = null, deletingId: string | null = null, avatar: string | null = null;
  let avatarRevision = 0, stateRevision = 0;

  function message(id: string, text: string) {
    const node = element<HTMLElement>(id);
    node.textContent = text;
    node.hidden = !text;
  }

  function friendlyError(error: unknown) {
    const code = error instanceof Error ? error.message : String(error);
    if (/UNSAVED_CONFIG/.test(code)) return 'Hãy kiểm tra và lưu cấu hình đang sửa trước khi đổi project.';
    if (/UNSAVED_PLAN/.test(code)) return 'Hãy lưu hoặc hoàn tác tiêu chí đang sửa trước khi đổi project.';
    if (/BUSY|ACTIVE/.test(code)) return 'Đợi lượt xử lý hoàn tất hoặc dừng lượt thu trước khi đổi project.';
    if (/CONFLICT/.test(code)) return 'Project đã thay đổi trên máy khác. Bản trên máy này được giữ lại để đối chiếu.';
    if (/EXISTS|TAKEN/.test(code)) return 'Tên đăng nhập đã được sử dụng.';
    if (/INVALID_CREDENTIALS|AUTH_FAILED|LOGIN_FAILED|PASSWORD/.test(code)) return 'Tên đăng nhập hoặc mật khẩu chưa đúng.';
    if (/DATABASE.*MISSING|NOT_CONFIGURED|BACKUP_UNAVAILABLE/.test(code)) return 'Chưa cấu hình kết nối sao lưu cho máy này.';
    if (/DATABASE_UNAVAILABLE/.test(code)) return 'Chưa kết nối được máy chủ sao lưu. Hãy kiểm tra kết nối rồi thử lại.';
    if (/INVITE_REQUIRED/.test(code)) return 'Nhập mã mời được gửi đến email của bạn.';
    if (/DEVICE_LIMIT_REACHED|DEVICE_REVOKED/.test(code)) return 'Thiết bị này chưa có quyền truy cập. Liên hệ FindLink để kiểm tra thiết bị đã đăng ký.';
    if (/AUTH_INPUT_INVALID/.test(code)) return 'Hãy nhập tên đăng nhập và mật khẩu.';
    if (/AVATAR/.test(code)) return 'Chọn ảnh PNG, JPEG, WebP hoặc GIF tối đa 2 MB.';
    if (/PROJECT_NAME|NAME_REQUIRED/.test(code)) return 'Hãy nhập tên project.';
    if (/LAST_PROJECT/.test(code)) return 'Hãy tạo một project khác trước khi xóa project cuối cùng.';
    return 'Chưa hoàn tất thao tác. Kiểm tra kết nối sao lưu rồi thử lại.';
  }

  async function action(work: () => Promise<ProjectWorkspaceState>, errorTarget = 'project-message'): Promise<boolean> {
    if (pending || input.busy()) return false;
    pending = true;
    stateRevision++;
    message(errorTarget, '');
    render();
    try {
      state = await input.execute(work);
      message('project-message', '');
      return true;
    } catch (error) {
      try { state = await api.state(); } catch { /* Preserve the original operation error. */ }
      message(errorTarget, friendlyError(error));
      return false;
    } finally {
      pending = false;
      render();
    }
  }

  function showEditor(project?: Project) {
    editingId = project?.id ?? null;
    avatar = project?.avatar ?? null;
    avatarRevision++;
    avatarLoading = false;
    name.value = project?.name ?? '';
    avatarFile.value = '';
    avatarPreview.hidden = !avatar;
    if (avatar) avatarPreview.src = avatar;
    else avatarPreview.removeAttribute('src');
    element('project-editor-title').textContent = project ? 'Sửa project' : 'Tạo project';
    message('project-editor-error', '');
    render();
    editor.showModal();
    name.focus();
  }

  function render() {
    const locked = pending || input.busy();
    element<HTMLButtonElement>('project-create').disabled = locked || !state;
    element<HTMLButtonElement>('project-auth-open').disabled = locked || !state?.backup.configured;
    element<HTMLButtonElement>('project-sync').disabled = locked || state?.backup.status === 'SYNCING';
    element<HTMLButtonElement>('project-logout').disabled = locked;
    element<HTMLButtonElement>('project-editor-save').disabled = locked || avatarLoading;
    element<HTMLButtonElement>('project-delete-confirm').disabled = locked;
    element<HTMLButtonElement>('project-register').disabled = locked;
    element<HTMLButtonElement>('project-login').disabled = locked;
    for (const control of [name, avatarFile, username, password]) control.disabled = locked;
    element<HTMLButtonElement>('project-avatar-remove').disabled = locked;
    for (const id of ['project-editor-cancel', 'project-auth-cancel', 'project-delete-cancel']) element<HTMLButtonElement>(id).disabled = pending;
    if (!state) return;
    element('project-account-name').textContent = state.user ? 'Tài khoản · ' + state.user.username : 'Làm việc trên máy này';
    element('project-auth-open').hidden = !!state.user && !document.body.classList.contains('managed-mode');
    element('project-logout').hidden = !state.user;
    element('project-sync').hidden = !state.backup.configured;
    const backupMessages = {
      LOCAL: 'Đã lưu trên máy. Đăng nhập để quản lý projects trên nhiều máy.',
      PENDING: 'Đã lưu trên máy · Đang chờ sao lưu.',
      SYNCING: 'Đang đồng bộ bản sao lưu…',
      SYNCED: 'Đã sao lưu' + (state.backup.lastSyncAt ? ' · ' + new Date(state.backup.lastSyncAt).toLocaleString('vi-VN') : ''),
      ERROR: state.backup.error ? friendlyError(state.backup.error) : 'Sao lưu chưa hoàn tất. Có thể thử lại bằng Sao lưu ngay.',
    };
    element('project-backup-status').textContent = state.backup.configured ? backupMessages[state.backup.status] : 'Đã lưu trên máy · Chưa cấu hình kết nối sao lưu.';
    const renderKey = JSON.stringify([state.projects, state.activeProjectId, locked]);
    if (lastRender === renderKey) return;
    lastRender = renderKey;
    list.replaceChildren(...state.projects.map(project => {
      const card = document.createElement('article');
      card.className = 'project-card';
      const selected = project.id === state!.activeProjectId;
      card.classList.toggle('is-selected', selected);
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'project-select';
      select.disabled = locked;
      select.setAttribute('aria-pressed', String(selected));
      const picture = document.createElement('span');
      picture.className = 'project-avatar project-avatar-placeholder';
      if (project.avatar) {
        const img = document.createElement('img');
        img.src = project.avatar;
        img.alt = '';
        picture.append(img);
      } else picture.textContent = project.name.slice(0, 1).toLocaleUpperCase('vi-VN');
      const text = document.createElement('span');
      text.className = 'project-card-copy';
      const title = document.createElement('strong');
      title.textContent = project.name;
      const detail = document.createElement('small');
      detail.textContent = selected ? 'Đang làm việc' : 'Mở project';
      text.append(title, detail);
      select.append(picture, text);
      select.addEventListener('click', () => { if (!selected) void action(() => api.select({ id: project.id })); });
      const controls = document.createElement('div');
      controls.className = 'project-card-actions';
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Sửa'; edit.disabled = locked;
      edit.setAttribute('aria-label', 'Sửa project ' + project.name);
      edit.addEventListener('click', () => showEditor(project));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Xóa'; remove.disabled = locked;
      remove.setAttribute('aria-label', 'Xóa project ' + project.name);
      remove.addEventListener('click', () => {
        deletingId = project.id;
        message('project-delete-error', '');
        element('project-delete-description').textContent = 'Xóa “' + project.name + '” khỏi danh sách projects trên các máy của bạn?';
        deleteDialog.showModal();
      });
      controls.append(edit, remove);
      card.append(select, controls);
      return card;
    }));
  }

  element('project-create').addEventListener('click', () => showEditor());
  element('project-editor-cancel').addEventListener('click', () => editor.close());
  element('project-auth-cancel').addEventListener('click', () => authDialog.close());
  element('project-delete-cancel').addEventListener('click', () => deleteDialog.close());
  for (const dialog of [editor, authDialog, deleteDialog]) dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  authDialog.addEventListener('close', () => { password.value = ''; invite.value = ''; });
  element('project-avatar-remove').addEventListener('click', () => {
    avatarRevision++; avatar = null; avatarLoading = false; avatarFile.value = ''; avatarPreview.hidden = true; avatarPreview.removeAttribute('src'); render();
  });
  avatarFile.addEventListener('change', () => {
    const file = avatarFile.files?.[0];
    const revision = ++avatarRevision;
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      message('project-editor-error', 'Chọn ảnh PNG, JPEG, WebP hoặc GIF tối đa 2 MB.'); avatarFile.value = ''; return;
    }
    avatarLoading = true; render();
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (revision !== avatarRevision) return;
      avatar = String(reader.result); avatarPreview.src = avatar; avatarPreview.hidden = false; message('project-editor-error', '');
    });
    reader.addEventListener('error', () => { if (revision === avatarRevision) message('project-editor-error', 'Chưa đọc được ảnh. Hãy chọn lại file.'); });
    reader.addEventListener('loadend', () => { if (revision === avatarRevision) { avatarLoading = false; render(); } });
    reader.readAsDataURL(file);
  });
  element<HTMLFormElement>('project-editor-form').addEventListener('submit', event => {
    event.preventDefault();
    if (avatarLoading) return;
    const projectName = name.value.trim();
    if (!projectName) { message('project-editor-error', 'Hãy nhập tên project.'); return; }
    void action(() => editingId ? api.update({ id: editingId, name: projectName, avatar }) : api.create({ name: projectName, avatar }), 'project-editor-error')
      .then(saved => { if (saved) editor.close(); });
  });
  element('project-delete-confirm').addEventListener('click', () => {
    if (!deletingId) return;
    const id = deletingId;
    void action(() => api.remove({ id }), 'project-delete-error').then(deleted => { if (deleted) deleteDialog.close(); });
  });
  element('project-auth-open').addEventListener('click', () => {
    message('project-auth-error', ''); password.value = ''; authDialog.showModal(); username.focus();
  });
  element<HTMLFormElement>('project-auth-form').addEventListener('submit', event => {
    event.preventDefault();
    const credentials = { username: username.value, password: password.value, ...(invite.value.trim() ? { invite: invite.value.trim() } : {}) };
    const register = (event.submitter as HTMLButtonElement | null)?.value === 'register';
    void action(() => register ? api.register(credentials) : api.login(credentials), 'project-auth-error').then(ok => {
      if (ok) { password.value = ''; authDialog.close(); }
    });
  });
  element('project-logout').addEventListener('click', () => { void action(() => api.logout()); });
  element('project-sync').addEventListener('click', () => { void action(() => api.sync()); });

  return {
    render,
    activeProjectId: () => state?.activeProjectId,
    async refresh() {
      render();
      if (refreshing || pending) return;
      refreshing = true;
      const revision = stateRevision;
      try { const next = await api.state(); if (revision === stateRevision) state = next; }
      catch { message('project-message', 'Chưa tải được danh sách projects. Hãy kết nối lại ứng dụng.'); }
      finally { refreshing = false; render(); }
    },
  };
}
