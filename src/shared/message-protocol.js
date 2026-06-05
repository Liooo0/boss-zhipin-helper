// ============================================================
// message-protocol.js — 扩展内消息传递的类型定义和验证
// ============================================================

// 消息类型常量
export const MSG = {
  // === Content → Background ===
  /** 记录一次投递 */
  RECORD_APPLICATION: 'RECORD_APPLICATION',
  /** 记录一条聊天消息 */
  RECORD_MESSAGE: 'RECORD_MESSAGE',
  /** 请求对消息进行 AI 分类 */
  CLASSIFY_MESSAGE: 'CLASSIFY_MESSAGE',
  /** 批量查询职位是否已投递 */
  CHECK_APPLIED: 'CHECK_APPLIED',
  /** 页面发生变化（SPA 导航） */
  PAGE_CHANGE: 'PAGE_CHANGE',

  // === Background → Content ===
  /** AI 分类结果返回 */
  CLASSIFY_RESULT: 'CLASSIFY_RESULT',
  /** 已投递职位 ID 列表 */
  APPLIED_JOB_IDS: 'APPLIED_JOB_IDS',

  // === Any → Background (查询/操作) ===
  /** 获取统计数据 */
  GET_STATS: 'GET_STATS',
  /** 获取投递记录 */
  GET_APPLICATIONS: 'GET_APPLICATIONS',
  /** 获取会话列表 */
  GET_CONVERSATIONS: 'GET_CONVERSATIONS',
  /** 获取指定会话的消息 */
  GET_MESSAGES: 'GET_MESSAGES',
  /** 获取模板 */
  GET_TEMPLATES: 'GET_TEMPLATES',
  /** 保存模板 */
  SAVE_TEMPLATE: 'SAVE_TEMPLATE',
  /** 删除模板 */
  DELETE_TEMPLATE: 'DELETE_TEMPLATE',
  /** 获取设置 */
  GET_SETTINGS: 'GET_SETTINGS',
  /** 保存设置 */
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  /** 获取功能开关 */
  GET_FEATURE_FLAGS: 'GET_FEATURE_FLAGS',
  /** 切换功能开关 */
  TOGGLE_FEATURE: 'TOGGLE_FEATURE',
  /** 导出数据 */
  EXPORT_DATA: 'EXPORT_DATA',
  /** 导入数据 */
  IMPORT_DATA: 'IMPORT_DATA',
  /** 更新投递状态 */
  UPDATE_APPLICATION_STATUS: 'UPDATE_APPLICATION_STATUS',
  /** 删除某条数据 */
  DELETE_DATA: 'DELETE_DATA',
  /** 记录选择器失败（用于诊断） */
  RECORD_SELECTOR_FAILURE: 'RECORD_SELECTOR_FAILURE',
};

// 消息来源
export const SOURCE = {
  CONTENT: 'content',
  POPUP: 'popup',
  SIDEPANEL: 'sidepanel',
  OPTIONS: 'options',
};

/**
 * 构建标准消息
 */
export function buildMessage(type, payload = {}, source = SOURCE.CONTENT) {
  return {
    type,
    source,
    payload,
    requestId: generateRequestId(),
    timestamp: Date.now(),
  };
}

function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 验证消息格式
 */
export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.type || typeof msg.type !== 'string') return false;
  if (!msg.timestamp || typeof msg.timestamp !== 'number') return false;
  return true;
}

/**
 * 检查消息类型是否需要异步响应
 */
export function expectsResponse(msgType) {
  return [
    MSG.CHECK_APPLIED,
    MSG.CLASSIFY_MESSAGE,
    MSG.GET_STATS,
    MSG.GET_APPLICATIONS,
    MSG.GET_CONVERSATIONS,
    MSG.GET_MESSAGES,
    MSG.GET_TEMPLATES,
    MSG.GET_SETTINGS,
    MSG.GET_FEATURE_FLAGS,
    MSG.EXPORT_DATA,
  ].includes(msgType);
}

/**
 * 构建响应消息
 */
export function buildResponse(originalMsg, result) {
  return {
    type: `${originalMsg.type}_RESPONSE`,
    source: SOURCE.CONTENT, // will be overwritten by actual sender
    payload: result,
    requestId: originalMsg.requestId,
    timestamp: Date.now(),
  };
}

/**
 * 构建错误响应
 */
export function buildErrorResponse(originalMsg, error) {
  return {
    type: `${originalMsg.type}_ERROR`,
    source: SOURCE.CONTENT,
    payload: { error: error.message || String(error) },
    requestId: originalMsg.requestId,
    timestamp: Date.now(),
  };
}
