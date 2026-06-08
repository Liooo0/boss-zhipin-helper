// ============================================================
// options.js — 设置页逻辑
// 模板管理、快速回复管理、个人信息、关键词规则、数据导入导出
// ============================================================

import { MSG, buildMessage } from '../shared/message-protocol.js';
import { SOURCE } from '../shared/message-protocol.js';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadAllData();
});

// ==================== 导航 ====================

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;

      // 切换导航激活状态
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // 切换内容区
      document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
      document.getElementById(`section-${section}`).classList.add('active');
    });
  });
}

// ==================== 数据加载 ====================

async function loadAllData() {
  await loadUserProfile();
  await loadStorageInfo();
}

async function sendMsg(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage(buildMessage(type, payload, SOURCE.OPTIONS));
  } catch (err) {
    console.error('Options send error:', type, err);
    return null;
  }
}

// ==================== 个人信息 ====================

async function loadUserProfile() {
  const result = await sendMsg(MSG.GET_SETTINGS);
  if (!result?.success) return;
  const settings = result.payload || {};

  // 如果已有简历数据，显示查看按钮
  await initResumeButton();

  document.getElementById('setting-userName').value = settings.userName || '';
  document.getElementById('setting-userSkills').value = settings.userSkills || '';
  document.getElementById('setting-userExperience').value = settings.userExperience || '';
  document.getElementById('setting-expectedSalary').value = settings.expectedSalary || '';
  document.getElementById('setting-deepseek-key').value = settings.deepseekApiKey || '';
  document.getElementById('setting-mimo-key').value = settings.mimoApiKey || '';
  document.getElementById('setting-ai-provider').value = settings.aiProvider || 'deepseek';
  document.getElementById('setting-reply-mode').value = settings.replyMode || 'professional';

  document.getElementById('btn-save-profile').onclick = async () => {
    await sendMsg(MSG.SAVE_SETTINGS, {
      userName: document.getElementById('setting-userName').value.trim(),
      userSkills: document.getElementById('setting-userSkills').value.trim(),
      userExperience: document.getElementById('setting-userExperience').value.trim(),
      expectedSalary: document.getElementById('setting-expectedSalary').value.trim(),
      deepseekApiKey: document.getElementById('setting-deepseek-key').value.trim(),
      mimoApiKey: document.getElementById('setting-mimo-key').value.trim(),
      aiProvider: document.getElementById('setting-ai-provider').value,
      replyMode: document.getElementById('setting-reply-mode').value,
    });
    alert('设置已保存！');
  };
}

// ==================== 简历上传 ====================

document.getElementById('btn-upload-resume').addEventListener('click', () => {
  document.getElementById('resume-file').click();
});

document.getElementById('resume-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await parseResume(file);
  e.target.value = ''; // 清除选择，允许重新上传同一文件
});

async function parseResume(file) {
  const status = document.getElementById('resume-status');
  status.textContent = '⏳ 解析 PDF...';

  try {
    // 1. 读取 PDF 文本
    const arrayBuf = await file.arrayBuffer();
    const text = await extractPdfText(arrayBuf);
    if (!text || text.length < 20) {
      status.textContent = '❌ PDF 解析失败或内容过少';
      return;
    }
    status.textContent = '✅ PDF解析完成（' + text.length + '字），AI提取中...';

    // 2. 获取 DeepSeek Key
    const settingsRes = await sendMsg(MSG.GET_SETTINGS);
    const provider = settingsRes?.payload?.aiProvider || 'deepseek';
    const apiKey = provider === 'mimo' ? settingsRes?.payload?.mimoApiKey : settingsRes?.payload?.deepseekApiKey;
    if (!apiKey) {
      status.textContent = '❌ 未配置 API Key，请先在下方填写';
      return;
    }

    // 3. 调用 DeepSeek 提取结构化信息
    const structured = await callDeepSeekForResume(text, apiKey, provider);
    if (!structured) {
      status.textContent = '❌ AI 提取失败';
      return;
    }

    // 4. 保存结构化简历数据
    await sendMsg(MSG.SAVE_SETTINGS, { resumeData: structured });

    // 5. 显示查看/编辑按钮
    const viewBtn = document.getElementById('btn-view-resume');
    viewBtn.style.display = 'inline-block';
    viewBtn.onclick = () => showResumeModal(structured);

    status.textContent = '✅ 解析完成！点击右侧按钮查看结果';
    setTimeout(() => { status.textContent = ''; }, 8000);
  } catch (err) {
    const errMsg = err.message || '未知错误';
    status.innerHTML = '<span style="color:#ff4d4f;">❌ 解析失败: ' + errMsg + '</span>'
      + '<br><small style="color:#999;">💡 请按 F12 打开控制台查看 [Resume] 开头的日志，了解 AI 原始返回内容</small>';
    console.error('Resume parse error:', err);
  }
}

async function extractPdfText(arrayBuf) {
  // 动态加载本地 PDF.js
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('lib/pdf.min.js');
      script.onload = resolve;
      script.onerror = () => reject(new Error('PDF.js 加载失败'));
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }

  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // 用换行符连接，保留文本结构
    const text = content.items.map(item => item.str).join(' ')
      .replace(/\s{2,}/g, '\n'); // 多空格→换行（简历排版特征）
    pages.push(text);
  }
  return pages.join('\n--- 分页 ---\n');
}

async function callDeepSeekForResume(resumeText, apiKey, provider = 'deepseek') {
  // MiMo 上下文窗口可能较小，限制输入长度
  const maxLen = provider === 'mimo' ? 3000 : 8000;
  const text = resumeText.length > maxLen ? resumeText.substring(0, maxLen) : resumeText;

  const endpoint = provider === 'mimo' ? 'https://api.xiaomimimo.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions';
  const model = provider === 'mimo' ? 'mimo-v2.5-pro' : 'deepseek-chat';

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `你是简历解析器。阅读简历文本，提取信息并输出JSON。只输出JSON，不要解释。` },
        { role: 'user', content: `简历文本：
${text}

请输出以下格式的JSON（找不到的字段填空字符串或空数组）：
{"name":"","phone":"","email":"","education":[{"school":"","major":"","degree":"","time":""}],"experience":[{"company":"","position":"","time":"","description":""}],"projects":[{"name":"","role":"","description":""}],"skills":"","certificates":"","languages":"","summary":"","expectedSalary":""}` },
      ],
      // MiMo 推理模型需要更多 token（推理过程 + 最终输出）
      temperature: 0.1, max_tokens: provider === 'mimo' ? 4000 : 1500,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('API请求失败: HTTP ' + resp.status + (errText ? ' — ' + errText.substring(0, 200) : ''));
  }
  const data = await resp.json();

  // 诊断：打印完整响应结构（排查 MiMo 是否用了不同的字段名）
  const msgObj = data?.choices?.[0]?.message || {};
  console.log('[Resume] API响应结构:', JSON.stringify({
    hasChoices: !!data?.choices,
    choicesLen: data?.choices?.length,
    hasMessage: !!data?.choices?.[0]?.message,
    msgKeys: Object.keys(msgObj),
    msgContent: msgObj.content,
    msgText: msgObj.text,
    msgReply: msgObj.reply,
    choiceKeys: Object.keys(data?.choices?.[0] || {}),
    altFields: Object.keys(data || {}).filter(k => !['choices', 'id', 'object', 'created', 'model'].includes(k)),
  }));

  // 兼容不同的 API 响应格式
  // MiMo 是推理模型：content 可能为空，实际输出在 reasoning_content 中
  const reasoningContent = data?.choices?.[0]?.message?.reasoning_content || '';
  let content = data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.message?.text
    || data?.choices?.[0]?.message?.reply
    || data?.choices?.[0]?.text
    || data?.reply
    || data?.data?.reply
    || data?.message
    || '';

  // MiMo 推理模型特殊处理：content 为空时从 reasoning_content 提取
  if (!content && reasoningContent) {
    console.log('[Resume] content为空，从reasoning_content提取（总长' + reasoningContent.length + '）');
    // reasoning_content 末尾通常包含最终输出，尝试从中提取 JSON
    // 也记录末尾内容以便排查
    console.log('[Resume] reasoning_content末尾500字:', reasoningContent.substring(Math.max(0, reasoningContent.length - 500)));
    content = reasoningContent;
  }

  console.log('[Resume] 提取到的content(前500字):', content.substring(0, 500));
  console.log('[Resume] content总长度:', content.length, '是否为空:', !content);

  // 用更健壮的方式提取 JSON（兼容 DeepSeek / MiMo 的各种返回格式）
  content = _extractJSON(content);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (jsonErr) {
    // 渐进式 JSON 修复
    let fixed = content;
    try {
      // 修复1: 尾部逗号
      fixed = content.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(fixed);
    } catch (e1) {
      try {
        // 修复2: 字符串内特殊字符转义（单次遍历，避免顺序问题）
        fixed = content.replace(/,\s*([}\]])/g, '$1');
        fixed = fixed.replace(/"([^"]*?)"/g, (m) => {
          const inner = m.slice(1, -1);
          const escaped = inner.replace(/[\n\r\t\\"]/g, (c) => {
            switch (c) {
              case '\n': return '\\n';
              case '\r': return '\\r';
              case '\t': return '\\t';
              case '\\': return '\\\\';
              case '"': return '\\"';
              default: return c;
            }
          });
          return '"' + escaped + '"';
        });
        parsed = JSON.parse(fixed);
      } catch (e2) {
        try {
          // 修复3: 移除控制字符 + 尝试补全截断的 JSON
          fixed = fixed.replace(/[\x00-\x1F]/g, ' ').replace(/\s+/g, ' ');
          // 如果 JSON 被截断（缺 } 或 ]），尝试补全
          const openBraces = (fixed.match(/\{/g) || []).length;
          const closeBraces = (fixed.match(/\}/g) || []).length;
          const openBrackets = (fixed.match(/\[/g) || []).length;
          const closeBrackets = (fixed.match(/\]/g) || []).length;
          let repaired = fixed;
          for (let i = closeBrackets; i < openBrackets; i++) repaired += ']';
          for (let i = closeBraces; i < openBraces; i++) repaired += '}';
          // 确保最后一个值是完整的（截断的字符串值补上引号）
          if (repaired.endsWith('}') || repaired.endsWith(']')) {
            // already closed, good
          } else if (!repaired.endsWith('"')) {
            repaired += '"';
          }
          parsed = JSON.parse(repaired);
        } catch (e3) {
          console.error('[Resume] JSON解析失败。原始(前300字):', content.substring(0, 300));
          console.error('[Resume] JSON解析失败。末尾(后300字):', content.substring(Math.max(0, content.length - 300)));
          throw new Error('AI返回格式异常，请尝试切换模型: ' + content.substring(0, 80) + '...');
        }
      }
    }
  }

  parsed.fullText = resumeText;
  return parsed;
}

/**
 * 从 AI 返回的文本中提取 JSON 字符串
 * 兼容 DeepSeek 和 MiMo 模型的各种返回格式
 */
function _extractJSON(raw) {
  // 空内容直接报错
  if (!raw || !raw.trim()) {
    throw new Error('AI 返回内容为空（可能是API响应异常或Key无效），请检查API Key是否正确');
  }

  let content = raw;

  // 策略1: 提取 markdown 代码块（大小写不敏感）
  const fencePatterns = [
    /```(?:json|JSON)?\s*\n?([\s\S]*?)```/i,
    /```\s*\n?(\{[\s\S]*?\})\s*\n?```/,
    /`([^`]*)`/,
  ];
  for (const pattern of fencePatterns) {
    const match = content.match(pattern);
    if (match) {
      const extracted = (match[1] || '').trim();
      if (extracted.includes('{') && extracted.includes('}')) {
        content = extracted;
        break;
      }
    }
  }

  // 策略2: ASCII 花括号 — 找到顶层 JSON 对象
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return content.substring(start, end + 1);
  }

  // 策略3: 全角花括号（MiMo 可能返回 Unicode 全角标点）
  const fullWidthOpen = content.indexOf('｛');  // ｛
  const fullWidthClose = content.lastIndexOf('｝'); // ｝
  if (fullWidthOpen >= 0 && fullWidthClose > fullWidthOpen) {
    content = content.substring(fullWidthOpen, fullWidthClose + 1);
    content = content
      .replace(/｛/g, '{').replace(/｝/g, '}')
      .replace(/｜/g, ':').replace(/、/g, ',')
      .replace(/“/g, '"').replace(/”/g, '"');
    return content;
  }

  // 策略4: 查找 JSON 关键字段名（即使没有花括号，尝试从自然语言中提取）
  const jsonKeywords = ['"name"', '"phone"', '"email"', '"skills"', '"education"', '"experience"', '"summary"'];
  const hasJsonKeywords = jsonKeywords.some(kw => content.includes(kw));
  if (hasJsonKeywords) {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') && !trimmed.endsWith('}')) {
      return '{' + trimmed + '}';
    }
    if (!trimmed.startsWith('{')) return '{' + trimmed;
    if (!trimmed.endsWith('}')) return trimmed + '}';
  }

  // 策略5: 降级 — MiMo 可能完全没输出 JSON，而是以自然语言总结了简历
  // 检查是否包含中文简历关键词（姓名/电话/邮箱/技能等）
  const chineseResumeKeys = ['姓名', '电话', '邮箱', '学校', '专业', '技能', '公司', '职位', '项目'];
  const hasChineseKeys = chineseResumeKeys.some(k => content.includes(k));

  if (hasChineseKeys) {
    console.warn('[Resume] MiMo返回了自然语言而非JSON，尝试从中文文本中构建结构化数据');
    // 构建一个最小可用的 resumeData 对象
    return JSON.stringify({
      name: _extractField(content, ['姓名[：:]\\s*(\\S+)', '名字[：:]\\s*(\\S+)']),
      phone: _extractField(content, ['电话[：:]\\s*(\\S+)', '手机[：:]\\s*(\\S+)', '联系方式[：:]\\s*(\\S+)']),
      email: _extractField(content, ['邮箱[：:]\\s*(\\S+)', 'Email[：:]\\s*(\\S+)', '邮件[：:]\\s*(\\S+)']),
      education: [],
      experience: [],
      projects: [],
      skills: _extractField(content, ['技能[：:]\\s*(\\S+)', '技术栈[：:]\\s*(\\S+)', '擅长[：:]\\s*(\\S+)']),
      certificates: '',
      languages: '',
      summary: '',
      expectedSalary: '',
    });
  }

  // 所有策略均失败
  console.error('[Resume] 所有提取策略失败。原始返回:', raw);
  throw new Error('AI 返回不含JSON: ' + raw.substring(0, 100) + (raw.length > 100 ? '...' : ''));
}

/**
 * 从中文文本中用正则提取字段值
 * @param {string} text 原始文本
 * @param {string[]} patterns 正则模式（应包含一个捕获组）
 */
function _extractField(text, patterns) {
  for (const pattern of patterns) {
    try {
      const m = text.match(new RegExp(pattern, 'i'));
      if (m) return (m[1] || '').trim().substring(0, 100);
    } catch {
      // 正则无效则跳过
    }
  }
  return '';
}

function showResumeModal(data) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  // 分离 fullText，不放入 JSON 编辑器
  const { fullText = '', ...structuredData } = data;
  const jsonStr = JSON.stringify(structuredData, null, 2);
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:700px;max-height:90vh;">
      <h3>📋 简历识别结果</h3>
      <p class="help-text">上部为结构化数据（可编辑），下部为PDF原始文本（仅供参考）。保存后 AI 对话将参考全部内容。</p>
      <label style="font-weight:600;font-size:13px;">📊 结构化数据（可编辑）</label>
      <textarea id="resume-json-editor" style="width:100%;height:220px;font-family:Consolas,monospace;font-size:12px;padding:10px;border:1px solid #d9d9d9;border-radius:6px;resize:vertical;">${jsonStr}</textarea>
      <label style="font-weight:600;font-size:13px;margin-top:12px;display:block;">📝 PDF 原始文本（仅供参考，共${(fullText || '').length}字）</label>
      <textarea readonly id="resume-full-text" style="width:100%;height:200px;font-size:11px;padding:8px;border:1px solid #e8e8e8;border-radius:6px;background:#f9f9f9;color:#666;resize:vertical;">${(fullText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
      <div class="modal-footer" style="margin-top:12px;">
        <button class="btn" id="modal-cancel-resume">取消</button>
        <button class="btn btn-primary" id="modal-save-resume">💾 保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('modal-cancel-resume').onclick = () => modal.remove();
  document.getElementById('modal-save-resume').onclick = async () => {
    try {
      const edited = JSON.parse(document.getElementById('resume-json-editor').value);
      // 保留原始文本
      edited.fullText = fullText;
      await sendMsg(MSG.SAVE_SETTINGS, { resumeData: edited });
      modal.remove();
      document.getElementById('resume-status').textContent = '✅ 简历数据已保存';
      setTimeout(() => { document.getElementById('resume-status').textContent = ''; }, 3000);
    } catch (e) {
      alert('JSON 格式错误: ' + e.message);
    }
  };
}

// 页面加载时也加载已保存的简历数据，显示查看按钮
async function initResumeButton() {
  const result = await sendMsg(MSG.GET_SETTINGS);
  if (result?.success && result.payload?.resumeData) {
    const btn = document.getElementById('btn-view-resume');
    btn.style.display = 'inline-block';
    btn.onclick = () => showResumeModal(result.payload.resumeData);
  }
}

// ==================== 数据管理 ====================

async function loadStorageInfo() {
  // Auto-save storage settings on change
  const saveStorage = async () => {
    const maxJobs = parseInt(document.getElementById('setting-max-jobs').value) || 30;
    const maxAiHistory = parseInt(document.getElementById('setting-max-ai-history').value) || 50;
    await sendMsg(MSG.SAVE_SETTINGS, {
      maxJobs: Math.max(5, Math.min(200, maxJobs)),
      maxAiHistory: Math.max(5, Math.min(500, maxAiHistory)),
    });
  };
  document.getElementById('setting-max-jobs').addEventListener('change', saveStorage);
  document.getElementById('setting-max-ai-history').addEventListener('change', saveStorage);
  // 加载存储设置
  const settingsRes = await sendMsg(MSG.GET_SETTINGS);
  if (settingsRes?.success) {
    const s = settingsRes.payload || {};
    document.getElementById('setting-max-jobs').value = s.maxJobs || 30;
    document.getElementById('setting-max-ai-history').value = s.maxAiHistory || 50;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usageMB = (estimate.usage / 1024 / 1024).toFixed(1);
    const quotaMB = (estimate.quota / 1024 / 1024).toFixed(0);
    document.getElementById('storage-info').innerHTML =
      `已使用 <strong>${usageMB} MB</strong> / 总量 ${quotaMB} MB`;
  } catch {
    document.getElementById('storage-info').textContent = '无法获取存储信息';
  }

  document.getElementById('btn-export').onclick = async () => {
    const result = await sendMsg(MSG.EXPORT_DATA);
    if (!result?.success || !result.payload) {
      alert('导出失败');
      return;
    }
    const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boss-helper-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('btn-import').onclick = () => {
    document.getElementById('import-file').click();
  };

  document.getElementById('import-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await sendMsg(MSG.IMPORT_DATA, { data });
      alert('数据导入成功！');
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
    e.target.value = '';
  };

  document.getElementById('btn-clear').onclick = async () => {
    if (!confirm('确定要清除所有投递记录和沟通记录吗？此操作不可恢复！')) return;
    if (!confirm('再次确认：删除所有数据？')) return;

    await sendMsg(MSG.DELETE_DATA, { store: 'applications' });
    await sendMsg(MSG.DELETE_DATA, { store: 'conversations' });
    await sendMsg(MSG.DELETE_DATA, { store: 'messages' });
    await sendMsg(MSG.DELETE_DATA, { store: 'templates' });
    await chrome.storage.local.remove(['bh_jobs', 'bh_ai_history']);
    alert('所有数据已清除');
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
