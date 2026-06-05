// ============================================================
// popup.js — 工具栏弹窗逻辑
// 显示快速统计，功能开关
// ============================================================

import { MSG, buildMessage } from '../shared/message-protocol.js';
import { SOURCE } from '../shared/message-protocol.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await loadFeatureFlags();
  bindEvents();
});

/**
 * 加载统计数据
 */
async function loadStats() {
  try {
    // 每日统计
    const dailyResult = await chrome.runtime.sendMessage(
      buildMessage(MSG.GET_STATS, { range: 'daily' }, SOURCE.POPUP)
    );
    if (dailyResult?.success && dailyResult.payload) {
      const stats = dailyResult.payload;
      document.getElementById('stat-applications').textContent = stats.applicationsSent || 0;
      document.getElementById('stat-messages').textContent = stats.hrMessages || 0;
      document.getElementById('stat-response').textContent = `${stats.responseRate || 0}%`;
      document.getElementById('stat-interviews').textContent = stats.interviewInvites || 0;
    }

    // 每周统计
    const weeklyResult = await chrome.runtime.sendMessage(
      buildMessage(MSG.GET_STATS, { range: 'weekly' }, SOURCE.POPUP)
    );
    if (weeklyResult?.success && weeklyResult.payload) {
      document.getElementById('stat-weekly-apps').textContent = weeklyResult.payload.totalApplications || 0;
      document.getElementById('stat-total-apps').textContent = weeklyResult.payload.allTimeApplications || 0;
    }
  } catch (err) {
    console.error('[BossHelper Popup] Failed to load stats:', err);
    showError('统计数据加载失败');
  }
}

/**
 * 加载功能开关状态
 */
async function loadFeatureFlags() {
  try {
    const result = await chrome.runtime.sendMessage(
      buildMessage(MSG.GET_FEATURE_FLAGS, {}, SOURCE.POPUP)
    );
    if (result?.success && result.payload) {
      const flags = result.payload;
      setToggle('toggle-quick-reply', flags.quickReply !== false);
      setToggle('toggle-badges', flags.jobBadges !== false);
      setToggle('toggle-ai', flags.messageClassification !== false);
    }
  } catch {
    // 默认全部开启
  }
}

function setToggle(id, enabled) {
  const checkbox = document.getElementById(id);
  if (checkbox) checkbox.checked = enabled;
}

/**
 * 绑定事件
 */
function bindEvents() {
  // 功能开关
  document.getElementById('toggle-quick-reply').addEventListener('change', (e) => {
    toggleFeature('quickReply', e.target.checked);
  });
  document.getElementById('toggle-badges').addEventListener('change', (e) => {
    toggleFeature('jobBadges', e.target.checked);
  });
  document.getElementById('toggle-ai').addEventListener('change', (e) => {
    toggleFeature('messageClassification', e.target.checked);
  });

  // 打开完整面板（Side Panel）
  document.getElementById('btn-dashboard').addEventListener('click', async () => {
    try {
      // 打开侧边栏
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.sidePanel.open({ tabId: tabs[0].id });
      }
      window.close();
    } catch (err) {
      // Fallback: 打开选项页
      chrome.runtime.openOptionsPage();
      window.close();
    }
  });

  // 打开设置页
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

/**
 * 切换功能开关
 */
async function toggleFeature(feature, enabled) {
  try {
    await chrome.runtime.sendMessage(
      buildMessage(MSG.TOGGLE_FEATURE, { feature, enabled }, SOURCE.POPUP)
    );
  } catch (err) {
    console.error('[BossHelper Popup] Toggle failed:', err);
  }
}

function showError(msg) {
  // 静默处理
  console.warn('[BossHelper Popup]', msg);
}
