import type { ProductionState, UserConfig } from '../shared/production-api.js';
import type { ContinueCampaignRequest, IntentAnswer, IntentField, IntentQuestion } from '../shared/semantic-intent.js';

const labels: Record<IntentField, string> = { target_roles: 'Tìm ai', purpose: 'Để làm gì', include: 'Nhận trường hợp nào',
  exclude: 'Loại trường hợp nào', topics: 'Chủ đề', geography: 'Địa bàn', time: 'Thời gian' };
const statuses = { CONFIRMED: 'Đã xác nhận', UNSPECIFIED: 'Chưa giới hạn', PROPOSED: 'Đề xuất chưa bật', UNRESOLVED: 'Cần làm rõ' };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
};
export function createIntentDialogue(host: { state(): ProductionState | null; config(): UserConfig; busy(): boolean; changed(): void;
  submit(request: ContinueCampaignRequest): Promise<void> }) {
  const root = document.getElementById('campaign-dialogue');
  let key = '', dirty = false;
  function render() {
    if (!root) return;
    const view = host.state()?.campaignDialogue, config = host.config().opportunity;
    root.hidden = !view || !config || Object.keys(view.config).some(k => config[k as keyof typeof config] !== view.config[k as keyof typeof view.config]);
    if (root.hidden || !view) { dirty = false; return; }
    if (key !== view.revision) {
      key = view.revision; dirty = false; root.replaceChildren();
      root.append(element('h3', `Hiểu nhu cầu · phiên bản ${view.input.revision}`), element('p', view.plan.understanding));
      const send = async (request: Partial<ContinueCampaignRequest>) => {
        await host.submit({ ...request, runId: view.runId, expectedRevision: view.revision });
      };
      function question(q: IntentQuestion, previous?: IntentAnswer) {
        const group = element('fieldset'); group.append(element('legend', q.prompt + (q.required ? ' *' : '')));
        group.append(element('p', q.reason));
        const options = q.options.map(option => {
          const label = element('label'), input = element('input'); input.type = q.type === 'multi_select' ? 'checkbox' : 'radio';
          input.name = `${view!.revision}-${previous?.answer_id ?? 'new'}-${q.id}`; input.value = option.id;
          input.checked = previous?.selected_option_ids.includes(option.id) ?? false;
          label.append(input, element('span', option.label)); group.append(label); return input;
        });
        const label = element('label', q.type === 'free_text' ? 'Câu trả lời' : 'Hoặc mô tả bằng lời của bạn');
        const text = element('textarea'); text.maxLength = 1500; text.rows = 2; text.value = previous?.raw_text ?? '';
        label.append(text); group.append(label);
        return { group, value: () => ({ question_id: q.id, selected_option_ids: options.filter(option => option.checked).map(option => option.value), raw_text: text.value.trim() }) };
      }
      if (view.plan.questions.length) {
        const form = element('form'), questions = view.plan.questions.map(q => question(q));
        form.append(...questions.map(q => q.group));
        const button = element('button', 'Gửi câu trả lời & cập nhật từ khóa'); button.type = 'submit'; form.append(button);
        form.addEventListener('submit', event => { event.preventDefault(); void send({ answers: questions.map(q => q.value()) }); });
        root.append(form);
      }
      const details = element('details'); details.append(element('summary', 'Xem / sửa mục tiêu đã hiểu'));
      const edits = element('form');
      const fields = view.plan.intent.map(item => {
        const label = element('label', `${labels[item.field]} · ${statuses[item.status]}`), input = element('textarea');
        input.rows = 2; input.maxLength = 600; input.value = item.value; label.append(input); edits.append(label);
        return { item, input };
      });
      edits.append(element('p', 'Sửa mục tiêu sẽ gọi AI để cập nhật cả từ khóa và tiêu chí. Muốn bỏ giới hạn, ghi “Không giới hạn”.'));
      const save = element('button', 'Cập nhật mục tiêu bằng AI'); save.type = 'submit'; edits.append(save);
      edits.addEventListener('submit', event => { event.preventDefault(); void send({ edits: fields.filter(f => f.input.value.trim() !== f.item.value)
        .map(f => ({ field: f.item.field, value: f.input.value.trim() })) }); });
      details.append(edits); root.append(details);
      if (view.input.answers.length) {
        const history = element('details'); history.append(element('summary', 'Lịch sử trả lời / sửa câu trả lời'));
        for (const answer of view.input.answers) {
          const item = element('details'); item.append(element('summary', `Phiên bản ${answer.revision}: ${answer.question} — ${answer.answer}`));
          const form = element('form'), q = question(answer.question_snapshot, answer), button = element('button', 'Dùng câu trả lời đã sửa');
          button.type = 'submit'; form.append(q.group, button); item.append(form); history.append(item);
          form.addEventListener('submit', event => { event.preventDefault(); void send({ editAnswerId: answer.answer_id, answers: [q.value()] }); });
        }
        root.append(history);
      }
      const restore = element('button', 'Hoàn tác nội dung chưa gửi'); restore.type = 'button';
      restore.addEventListener('click', () => { key = ''; dirty = false; render(); host.changed(); }); root.append(restore);
    }
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('input, button, textarea')) control.disabled = host.busy();
  }
  root?.addEventListener('input', () => { dirty = true; host.changed(); });
  return { render, hasUnsavedEdits: () => dirty };
}
