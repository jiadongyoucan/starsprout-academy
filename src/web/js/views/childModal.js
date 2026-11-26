import { request } from '../api.js';
import { openModal, toast } from '../ui.js';

export function openChildModal(onDone) {
  const body = `
    <form id="childForm">
      <div class="form-row">
        <div class="field"><label>孩子昵称</label><input class="input" name="name" maxlength="12" placeholder="例如：米粒" required></div>
        <div class="field"><label>当前学段</label>
          <select class="select" name="classCode">
            <option value="nursery">托班（2–3 岁）</option>
            <option value="junior" selected>小班（3–4 岁）</option>
            <option value="middle">中班（4–5 岁）</option>
            <option value="senior">大班（5–6 岁）</option>
          </select>
        </div>
      </div>
      <div class="field"><label>出生年份（可选）</label><input class="input" name="birthYear" type="number" min="2016" max="2026" placeholder="2022"></div>
      <div style="background:var(--surface-2);border-radius:12px;padding:12px;margin-bottom:12px">
        <p class="small strong" style="margin-bottom:6px">监护人授权</p>
        <label class="checkline" style="margin-bottom:8px"><input type="checkbox" name="ai_processing"> 允许 AI 使用孩子学习摘要进行计划与汇报（可选，发送前会去标识）</label>
        <label class="checkline" style="margin-bottom:8px"><input type="checkbox" name="analytics" checked> 允许在学习看板中分析该孩子的学习数据（本地分析）</label>
        <label class="checkline"><input type="checkbox" name="camera"> 允许在设备端拍照留痕（随时可关闭，默认 30 天清理）</label>
      </div>
      <p class="form-hint">摄像头授权涉及儿童隐私，默认关闭；开启后平板每次拍照都会显示快门提示。</p>
    </form>`;
  openModal({
    title: '添加孩子档案', subtitle: '课程和计划会按学段自动适配', body,
    footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="childSave" type="button">保存</button>`,
    onMount(modal, close) {
      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.querySelector('#childSave').addEventListener('click', async () => {
        const form = modal.querySelector('#childForm');
        const values = Object.fromEntries(new FormData(form).entries());
        if (!values.name?.trim()) { toast('请填写孩子昵称', 'error'); return; }
        const button = modal.querySelector('#childSave');
        button.disabled = true;
        button.textContent = '保存中…';
        try {
          await request('/api/children', {
            method: 'POST',
            body: {
              name: values.name.trim(), classCode: values.classCode,
              birthYear: values.birthYear ? Number(values.birthYear) : undefined,
              consents: {
                ai_processing: !!form.querySelector('[name=ai_processing]').checked,
                analytics: !!form.querySelector('[name=analytics]').checked,
                camera: !!form.querySelector('[name=camera]').checked,
              },
            },
          });
          close();
          toast('孩子档案已创建', 'success');
          if (onDone) onDone();
          else window.dispatchEvent(new CustomEvent('children:updated'));
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
          button.textContent = '保存';
        }
      });
    },
  });
}
