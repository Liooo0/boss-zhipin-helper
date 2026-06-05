// ============================================================
// service-worker.js — 后台 Service Worker
// 消息路由中心，连接 Content Script / Popup / SidePanel / Options
// MV3 规范：无状态设计，所有状态来自 IndexedDB 或 chrome.storage
// ============================================================

import { db } from '../shared/db.js';
import { MSG, SOURCE, validateMessage, buildResponse, buildErrorResponse } from '../shared/message-protocol.js';
import { STORE_NAMES, DEFAULT_FEATURE_FLAGS, DEFAULT_GREETING_TEMPLATES, DEFAULT_REPLY_TEMPLATES, DATA_RETENTION_DAYS, STORAGE_KEYS } from '../shared/constants.js';
import { StatsAggregator } from './stats-aggregator.js';
import { AIBridge } from './ai-bridge.js';
import { registerAlarms } from './alarm-manager.js';

// ==================== 初始化 ====================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[BossHelper] Extension installed:', details.reason);

  // 初始化默认模板（仅在首次安装时）
  if (details.reason === 'install') {
    await _installDefaultTemplates();
    await _installDefaultSettings();
  }

  // 注册定时任务
  registerAlarms();
});

// Service Worker 启动时也注册 alarms（MV3 的 SW 可能随时被终止和重启）
registerAlarms();

// ==================== 消息路由 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!validateMessage(message)) {
    sendResponse({ error: 'Invalid message format' });
    return false;
  }

  // 异步处理，返回 true 告诉 Chrome 我们会异步调用 sendResponse
  _handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[BossHelper] Message handler error:', message.type, err);
    sendResponse(buildErrorResponse(message, err));
  });

  return true; // 保持消息通道打开
});

/**
 * 主消息处理器
 */
async function _handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    // === 数据记录 ===
    case MSG.RECORD_APPLICATION:
      return await _recordApplication(payload);

    case MSG.RECORD_MESSAGE:
      return await _recordMessage(payload);

    // === 查询 ===
    case MSG.CHECK_APPLIED:
      return await _checkApplied(payload);

    case MSG.GET_STATS:
      return await _getStats(payload);

    case MSG.GET_APPLICATIONS:
      return await _getApplications(payload);

    case MSG.GET_CONVERSATIONS:
      return await _getConversations(payload);

    case MSG.GET_MESSAGES:
      return await _getMessages(payload);

    // === 模板管理 ===
    case MSG.GET_TEMPLATES:
      return await _getTemplates(payload);

    case MSG.SAVE_TEMPLATE:
      return await _saveTemplate(payload);

    case MSG.DELETE_TEMPLATE:
      return await _deleteTemplate(payload);

    // === 设置管理 ===
    case MSG.GET_SETTINGS:
      return await _getSettings(payload);

    case MSG.SAVE_SETTINGS:
      return await _saveSettings(payload);

    case MSG.GET_FEATURE_FLAGS:
      return await _getFeatureFlags();

    case MSG.TOGGLE_FEATURE:
      return await _toggleFeature(payload);

    // === AI 分类 ===
    case MSG.CLASSIFY_MESSAGE:
      return await _classifyMessage(payload);

    // === 数据管理 ===
    case MSG.EXPORT_DATA:
      return await _exportData();

    case MSG.IMPORT_DATA:
      return await _importData(payload);

    case MSG.UPDATE_APPLICATION_STATUS:
      return await _updateApplicationStatus(payload);

    case MSG.DELETE_DATA:
      return await _deleteData(payload);

    case MSG.PAGE_CHANGE:
      // 仅用于 SW 上下文感知，不需要响应
      return { success: true };

    case MSG.RECORD_SELECTOR_FAILURE:
      await _recordSelectorFailure(payload);
      return { success: true };

    default:
      return { error: `Unknown message type: ${type}` };
  }
}

// ==================== 数据记录处理 ====================

async function _recordApplication(payload) {
  try {
    await db.put(STORE_NAMES.APPLICATIONS, payload);

    // 如果有关联的 conversationId，更新 conversation
    if (payload.conversationId) {
      try {
        const conv = await db.get(STORE_NAMES.CONVERSATIONS, payload.conversationId);
        if (conv) {
          conv.jobId = payload.jobId;
          conv.positionName = payload.jobTitle;
          conv.companyName = payload.companyName;
          conv.lastUpdated = Date.now();
          await db.put(STORE_NAMES.CONVERSATIONS, conv);
        }
      } catch { /* ignore */ }
    }

    // 清除统计缓存
    await db.clear(STORE_NAMES.STATS_CACHE);

    // 更新 badge
    _updateBadgeCount();

    return { success: true, id: payload.id };
  } catch (err) {
    console.error('[BossHelper] Record application error:', err);
    return { success: false, error: err.message };
  }
}

async function _recordMessage(payload) {
  try {
    await db.put(STORE_NAMES.MESSAGES, payload);

    // 更新 conversation 的最后消息时间
    if (payload.conversationId && payload.conversationId !== 'unknown') {
      try {
        let conv = await db.get(STORE_NAMES.CONVERSATIONS, payload.conversationId);
        if (conv) {
          conv.lastMessageTime = payload.timestamp;
          conv.messageCount = (conv.messageCount || 0) + 1;
          if (payload.classification) {
            conv.lastClassification = payload.classification;
          }
          await db.put(STORE_NAMES.CONVERSATIONS, conv);
        } else {
          // 创建新会话
          conv = {
            id: payload.conversationId,
            jobId: '',
            positionName: '',
            companyName: '',
            hrName: '',
            hrTitle: '',
            startTime: payload.timestamp,
            lastMessageTime: payload.timestamp,
            messageCount: 1,
            status: 'active',
            lastClassification: payload.classification || '',
          };
          await db.put(STORE_NAMES.CONVERSATIONS, conv);
        }
      } catch { /* ignore */ }
    }

    return { success: true, id: payload.id };
  } catch (err) {
    console.error('[BossHelper] Record message error:', err);
    return { success: false, error: err.message };
  }
}

// ==================== 查询处理 ====================

async function _checkApplied({ jobIds }) {
  try {
    const result = await db.checkJobsApplied(jobIds);
    // 转为普通对象（Map 无法序列化通过 sendMessage 传递）
    const obj = {};
    result.forEach((v, k) => { obj[k] = v; });
    return { success: true, payload: obj };
  } catch (err) {
    return { success: false, error: err.message, payload: {} };
  }
}

async function _getStats({ range = 'weekly' }) {
  try {
    let stats;
    switch (range) {
      case 'daily':
        stats = await StatsAggregator.getDailyStats();
        break;
      case 'weekly':
        stats = await StatsAggregator.getWeeklyStats();
        break;
      case 'alltime':
        stats = await StatsAggregator.getAllTimeStats();
        break;
      default:
        stats = await StatsAggregator.getWeeklyStats();
    }
    return { success: true, payload: stats };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _getApplications({ jobId, status, startDate, endDate, limit = 50 } = {}) {
  try {
    let apps;
    if (jobId) {
      apps = await db.getByIndex(STORE_NAMES.APPLICATIONS, 'idx_jobId', jobId);
    } else if (status) {
      apps = await db.getByIndex(STORE_NAMES.APPLICATIONS, 'idx_status', status);
    } else if (startDate && endDate) {
      apps = await db.getByDateRange(STORE_NAMES.APPLICATIONS, 'idx_applyTime', startDate, endDate);
    } else {
      apps = await db.getAll(STORE_NAMES.APPLICATIONS);
    }
    // 按时间倒序
    apps.sort((a, b) => b.applyTime - a.applyTime);
    apps = apps.slice(0, limit);
    return { success: true, payload: apps };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _getConversations({ status, limit = 50 } = {}) {
  try {
    let conversations;
    if (status) {
      conversations = await db.getByIndex(STORE_NAMES.CONVERSATIONS, 'idx_status', status);
    } else {
      conversations = await db.getAll(STORE_NAMES.CONVERSATIONS);
    }
    conversations.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    conversations = conversations.slice(0, limit);
    return { success: true, payload: conversations };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _getMessages({ conversationId }) {
  try {
    if (!conversationId) {
      return { success: false, error: 'conversationId is required' };
    }
    const messages = await db.getMessagesByConversation(conversationId);
    return { success: true, payload: messages };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== 模板管理 ====================

async function _getTemplates({ category, subcategory } = {}) {
  try {
    let templates;
    if (category) {
      templates = await db.getByIndex(STORE_NAMES.TEMPLATES, 'idx_category', category);
      if (subcategory) {
        templates = templates.filter(t => t.subcategory === subcategory);
      }
    } else {
      templates = await db.getAll(STORE_NAMES.TEMPLATES);
    }
    return { success: true, payload: templates };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _saveTemplate(template) {
  try {
    if (!template.id) {
      template.id = crypto.randomUUID();
    }
    template.lastModified = Date.now();
    await db.put(STORE_NAMES.TEMPLATES, template);
    return { success: true, payload: template };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _deleteTemplate({ id }) {
  try {
    await db.delete(STORE_NAMES.TEMPLATES, id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== 设置管理 ====================

async function _getSettings() {
  try {
    const settings = await db.getAll(STORE_NAMES.SETTINGS);
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    return { success: true, payload: obj };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _saveSettings(settings) {
  try {
    for (const [key, value] of Object.entries(settings)) {
      await db.put(STORE_NAMES.SETTINGS, { key, value });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _getFeatureFlags() {
  try {
    const { feature_flags } = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_FLAGS);
    return { success: true, payload: feature_flags || DEFAULT_FEATURE_FLAGS };
  } catch {
    return { success: true, payload: DEFAULT_FEATURE_FLAGS };
  }
}

async function _toggleFeature({ feature, enabled }) {
  try {
    const { feature_flags = {} } = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_FLAGS);
    feature_flags[feature] = enabled;
    await chrome.storage.local.set({ [STORAGE_KEYS.FEATURE_FLAGS]: feature_flags });
    return { success: true, payload: feature_flags };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== AI 分类 ====================

async function _classifyMessage({ text, conversationId, context = {} }) {
  try {
    const result = await AIBridge.classifyMessage(text);
    return {
      success: true,
      payload: {
        ...result,
        conversationId,
        context,
      },
    };
  } catch (err) {
    // 降级到关键词分类
    const fallback = AIBridge.keywordClassify(text);
    return {
      success: true,
      payload: {
        intent: fallback.intent,
        confidence: fallback.confidence,
        source: 'keyword_fallback',
        conversationId,
      },
    };
  }
}

// ==================== 数据管理 ====================

async function _exportData() {
  try {
    const applications = await db.getAll(STORE_NAMES.APPLICATIONS);
    const conversations = await db.getAll(STORE_NAMES.CONVERSATIONS);
    const messages = await db.getAll(STORE_NAMES.MESSAGES);
    const templates = await db.getAll(STORE_NAMES.TEMPLATES);

    // 同时导出 chrome.storage.local 中的数据（职位信息 + AI对话历史）
    const { bh_jobs, bh_ai_history } = await chrome.storage.local.get(['bh_jobs', 'bh_ai_history']);

    return {
      success: true,
      payload: {
        exportDate: new Date().toISOString(),
        version: '1.0.0',
        applications,
        conversations,
        messages,
        templates,
        savedJobs: bh_jobs || [],
        aiConversations: bh_ai_history || [],
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _importData({ data }) {
  try {
    if (!data || !data.applications) {
      return { success: false, error: 'Invalid data format' };
    }
    if (data.applications.length > 0) {
      await db.bulkPut(STORE_NAMES.APPLICATIONS, data.applications);
    }
    if (data.conversations?.length > 0) {
      await db.bulkPut(STORE_NAMES.CONVERSATIONS, data.conversations);
    }
    if (data.messages?.length > 0) {
      await db.bulkPut(STORE_NAMES.MESSAGES, data.messages);
    }
    if (data.templates?.length > 0) {
      await db.bulkPut(STORE_NAMES.TEMPLATES, data.templates);
    }
    await db.clear(STORE_NAMES.STATS_CACHE);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _updateApplicationStatus({ id, status, notes }) {
  try {
    const app = await db.get(STORE_NAMES.APPLICATIONS, id);
    if (!app) return { success: false, error: 'Application not found' };
    app.status = status;
    app.lastUpdated = Date.now();
    if (notes !== undefined) app.notes = notes;
    await db.put(STORE_NAMES.APPLICATIONS, app);
    await db.clear(STORE_NAMES.STATS_CACHE);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function _deleteData({ store, id }) {
  try {
    if (id) {
      await db.delete(store, id);
    } else {
      await db.clear(store);
    }
    if (store === STORE_NAMES.STATS_CACHE) {
      // already cleared
    } else {
      await db.clear(STORE_NAMES.STATS_CACHE);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== 初始化和维护 ====================

async function _installDefaultTemplates() {
  try {
    await db.bulkPut(STORE_NAMES.TEMPLATES, [
      ...DEFAULT_GREETING_TEMPLATES,
      ...DEFAULT_REPLY_TEMPLATES,
    ]);
    console.log('[BossHelper] Default templates installed');
  } catch (err) {
    console.error('[BossHelper] Template install error:', err);
  }
}

async function _installDefaultSettings() {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.FEATURE_FLAGS]: DEFAULT_FEATURE_FLAGS,
    });
  } catch (err) {
    console.error('[BossHelper] Settings install error:', err);
  }
}

async function _recordSelectorFailure(payload) {
  try {
    const { selectorGroup, url, timestamp } = payload;
    const failures = (await chrome.storage.local.get(STORAGE_KEYS.SELECTOR_FAILURES))[STORAGE_KEYS.SELECTOR_FAILURES] || [];
    failures.push({ selectorGroup, url, timestamp });
    // 只保留最近 50 条
    if (failures.length > 50) failures.splice(0, failures.length - 50);
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_FAILURES]: failures });
  } catch { /* ignore */ }
}

/**
 * 更新扩展图标角标（显示今日投递数）
 */
async function _updateBadgeCount() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const count = await db.getApplicationCountByDateRange(
      todayStart.getTime(),
      todayEnd.getTime()
    );

    if (count > 0) {
      await chrome.action.setBadgeText({ text: String(count) });
      await chrome.action.setBadgeBackgroundColor({ color: '#1890ff' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch { /* ignore */ }
}

// ==================== Side Panel 长连接 ====================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    port.onMessage.addListener(async (message) => {
      try {
        const result = await _handleMessage(message, {});
        port.postMessage(result);
      } catch (err) {
        port.postMessage({ error: err.message });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[BossHelper] Side panel disconnected');
    });
  }
});

// ==================== Alarms ====================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'restats':
      await db.clear(STORE_NAMES.STATS_CACHE);
      break;
    case 'cleanup':
      await db.pruneOldData(DATA_RETENTION_DAYS);
      console.log('[BossHelper] Old data pruned');
      break;
    case 'update-badge':
      await _updateBadgeCount();
      break;
  }
});
