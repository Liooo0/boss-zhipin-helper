// ============================================================
// panel.js — 侧边栏仪表盘逻辑
// 趋势图表、投递/沟通记录列表、数据导出
// ============================================================

import { MSG, buildMessage } from '../shared/message-protocol.js';
import { SOURCE } from '../shared/message-protocol.js';
import { formatDate, formatDateTime, formatRelativeTime } from '../shared/utils.js';
import { STATUS } from '../shared/constants.js';

let port = null;

document.addEventListener('DOMContentLoaded', () => {
  connectToBackground();
  loadAllData();
  bindEvents();
});

/**
 * 建立与 Service Worker 的长连接
 */
function connectToBackground() {
  port = chrome.runtime.connect({ name: 'sidepanel' });

  port.onDisconnect.addListener(() => {
    setTimeout(connectToBackground, 2000);
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'stats_update') {
      loadAllData();
    }
  });
}

/**
 * 加载所有数据
 */
async function loadAllData() {
  await Promise.all([
    loadOverview(),
    loadTrend(),
    loadApplications(),
    loadConversations(),
  ]);
}

/**
 * 加载概览数据
 */
async function loadOverview() {
  try {
    const result = await sendMsg(MSG.GET_STATS, { range: 'alltime' });
    if (!result?.success || !result.payload) return;

    const stats = result.payload;
    document.getElementById('ov-total-apps').textContent = stats.totalApplications || 0;
    document.getElementById('ov-response-rate').textContent = `${stats.responseRate || 0}%`;
    document.getElementById('ov-interviews').textContent = stats.interviewCount || 0;
    document.getElementById('ov-interview-rate').textContent = `${stats.interviewRate || 0}%`;
  } catch (err) {
    console.error('Load overview error:', err);
  }
}

/**
 * 加载趋势图
 */
async function loadTrend() {
  try {
    const result = await sendMsg(MSG.GET_STATS, { range: 'weekly' });
    if (!result?.success || !result.payload?.dailyCounts) return;

    const dailyCounts = result.payload.dailyCounts;
    drawTrendChart(dailyCounts);
  } catch (err) {
    console.error('Load trend error:', err);
  }
}

/**
 * 绘制趋势图（Canvas）
 */
function drawTrendChart(dailyCounts) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dates = Object.keys(dailyCounts).sort();

  if (dates.length === 0) return;

  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const w = canvas.width - padding.left - padding.right;
  const h = canvas.height - padding.top - padding.bottom;

  const values = dates.map(d => dailyCounts[d] || 0);
  const maxVal = Math.max(...values, 1);
  const barWidth = Math.max(4, w / dates.length - 4);

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Y axis labels
  ctx.fillStyle = '#999';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const val = Math.round((maxVal / 3) * i);
    const y = padding.top + h - (h / 3) * i;
    ctx.fillText(String(val), padding.left - 6, y + 4);
  }

  // Grid lines
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padding.top + h - (h / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + w, y);
    ctx.stroke();
  }

  // Bars
  for (let i = 0; i < dates.length; i++) {
    const val = values[i];
    const barH = val > 0 ? (val / maxVal) * h : 1;
    const x = padding.left + (w / dates.length) * i + 2;
    const y = padding.top + h - barH;

    // Gradient
    const grad = ctx.createLinearGradient(x, y, x, padding.top + h);
    grad.addColorStop(0, '#1890ff');
    grad.addColorStop(1, '#69c0ff');
    ctx.fillStyle = val > 0 ? grad : '#f0f0f0';
    ctx.fillRect(x, y, barWidth, barH);

    // Date label (show every 5th to avoid crowding)
    if (i % 5 === 0 || i === dates.length - 1) {
      ctx.fillStyle = '#999';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      const dateLabel = dates[i].slice(5); // MM-DD
      ctx.fillText(dateLabel, x + barWidth / 2, canvas.height - 8);
    }
  }
}

/**
 * 加载投递记录列表
 */
async function loadApplications(statusFilter = 'all', searchQuery = '') {
  try {
    const result = await sendMsg(MSG.GET_APPLICATIONS, { limit: 100 });
    if (!result?.success) return;

    let apps = result.payload || [];

    // 筛选
    if (statusFilter !== 'all') {
      apps = apps.filter(a => a.status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      apps = apps.filter(a =>
        (a.jobTitle || '').toLowerCase().includes(q) ||
        (a.companyName || '').toLowerCase().includes(q)
      );
    }

    const container = document.getElementById('applications-list');
    if (apps.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无匹配的投递记录</div>';
      return;
    }

    const statusLabels = {
      sent: '已投递', replied: '已回复', interview: '面试中',
      rejected: '不合适', archived: '已归档',
    };

    container.innerHTML = apps.map(a => `
      <div class="list-item" data-id="${a.id}">
        <div class="item-main">
          <div class="item-title">${escapeHtml(a.jobTitle || '未知职位')}</div>
          <div class="item-sub">${escapeHtml(a.companyName || '未知公司')} · ${escapeHtml(a.salary || '')}</div>
        </div>
        <span class="item-status status-${a.status}">${statusLabels[a.status] || a.status}</span>
        <span class="item-time">${formatRelativeTime(a.applyTime)}</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load applications error:', err);
  }
}

/**
 * 加载沟通记录列表
 */
async function loadConversations() {
  try {
    const result = await sendMsg(MSG.GET_CONVERSATIONS, { limit: 50 });
    if (!result?.success) return;

    const conversations = result.payload || [];
    const container = document.getElementById('conversations-list');

    if (conversations.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无沟通记录</div>';
      return;
    }

    const classificationLabels = {
      ask_resume: '要简历', ask_interview: '约面试',
      ask_salary: '谈薪资', spam: '疑似垃圾', other: '其他',
    };

    container.innerHTML = conversations.map(c => `
      <div class="list-item" data-id="${c.id}">
        <div class="item-main">
          <div class="item-title">${escapeHtml(c.companyName || '未知公司')} · ${escapeHtml(c.positionName || '未知职位')}</div>
          <div class="item-sub">
            ${c.lastClassification ? `🏷️ ${classificationLabels[c.lastClassification] || c.lastClassification} · ` : ''}
            共 ${c.messageCount || 0} 条消息
          </div>
        </div>
        <span class="item-status status-${c.status || 'active'}">${c.status === 'active' ? '进行中' : '已归档'}</span>
        <span class="item-time">${formatRelativeTime(c.lastMessageTime)}</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load conversations error:', err);
  }
}

/**
 * 发送消息到 Service Worker
 */
async function sendMsg(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage(buildMessage(type, payload, SOURCE.SIDEPANEL));
  } catch (err) {
    console.error('Send message error:', type, err);
    return null;
  }
}

/**
 * 绑定事件
 */
function bindEvents() {
  // 刷新按钮
  document.getElementById('btn-refresh').addEventListener('click', loadAllData);

  // 导出按钮
  document.getElementById('btn-export').addEventListener('click', async () => {
    try {
      const result = await sendMsg(MSG.EXPORT_DATA);
      if (!result?.success || !result.payload) {
        alert('导出失败');
        return;
      }

      const blob = new Blob([JSON.stringify(result.payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `boss-helper-export-${formatDate(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + err.message);
    }
  });

  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('tab-applications').classList.toggle('hidden', tab !== 'applications');
      document.getElementById('tab-conversations').classList.toggle('hidden', tab !== 'conversations');
    });
  });

  // 筛选
  document.getElementById('filter-status').addEventListener('change', (e) => {
    const search = document.getElementById('filter-search').value;
    loadApplications(e.target.value, search);
  });

  document.getElementById('filter-search').addEventListener('input', (e) => {
    const status = document.getElementById('filter-status').value;
    loadApplications(status, e.target.value);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
