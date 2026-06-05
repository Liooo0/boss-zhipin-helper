// ============================================================
// message-classifier.js — 消息智能分类
// 对 HR 消息进行意图识别：ask_resume, ask_interview, ask_salary, spam, other
// 优先使用 AI 分类，不可用时降级为关键词匹配
// ============================================================

import { SELECTORS, findElement } from '../dom-selectors.js';
import { MSG, SOURCE, buildMessage } from '../../shared/message-protocol.js';
import { sendToBackground } from '../../shared/utils.js';
import { DEFAULT_KEYWORD_RULES } from '../../shared/constants.js';

export class MessageClassifier {
  constructor(pageInfo, observerManager) {
    this.pageInfo = pageInfo;
    this.observerManager = observerManager;
    this.classifiedMessages = new Map(); // messageId -> classification
    this.pendingClassifications = new Set(); // 正在分类中的消息
    this._onClassificationResult = this._onClassificationResult.bind(this);
  }

  initialize() {
    // 监听聊天消息容器的新消息
    this.observerManager.register('classifier-new-messages', {
      selector: SELECTORS.chat.messageItems[0],
      callback: (elements) => this._onNewMessageElements(elements),
      debounce: 300,
    });

    // 监听分类结果（来自 background）
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === MSG.CLASSIFY_RESULT && msg.source === SOURCE.CONTENT) {
        this._onClassificationResult(msg.payload);
      }
    });
  }

  /**
   * 检测到新消息元素
   */
  _onNewMessageElements(elements) {
    const newMessages = [];

    for (const el of elements) {
      // 判断是否是 HR 消息（非用户发送的）
      const isHr = this._isHrMessage(el);
      if (!isHr) continue;

      // 提取消息内容
      const textEl = findElement(SELECTORS.chat.messageText, el);
      const content = textEl?.textContent?.trim();
      if (!content || content.length < 2) continue;

      // 去重
      const msgId = this._generateMessageId(content);
      if (this.classifiedMessages.has(msgId) || this.pendingClassifications.has(msgId)) continue;

      newMessages.push({ el, content, msgId });
    }

    // 批量分类
    for (const msg of newMessages) {
      this._classifyMessage(msg);
    }
  }

  /**
   * 对单条消息进行分类
   */
  async _classifyMessage({ content, msgId }) {
    this.pendingClassifications.add(msgId);

    try {
      // 先用本地关键词快速分类（无延迟）
      const localResult = this._keywordClassify(content);
      if (localResult) {
        this.classifiedMessages.set(msgId, localResult);
        this.pendingClassifications.delete(msgId);
        this._dispatchClassification(content, localResult);
        return;
      }

      // 关键词无法识别，发送到 background 进行 AI 分类
      const result = await sendToBackground(buildMessage(MSG.CLASSIFY_MESSAGE, {
        text: content,
        conversationId: this.pageInfo.conversationId,
        context: {},
      }));

      if (result?.payload) {
        const classification = {
          intent: result.payload.intent || 'other',
          confidence: result.payload.confidence || 0.5,
          source: 'ai',
        };
        this.classifiedMessages.set(msgId, classification);
        this._dispatchClassification(content, classification);
      }
    } catch (err) {
      // AI 分类失败，使用关键词回退
      const fallback = this._keywordClassify(content) || { intent: 'other', confidence: 0, source: 'keyword' };
      this.classifiedMessages.set(msgId, fallback);
      this._dispatchClassification(content, fallback);
    } finally {
      this.pendingClassifications.delete(msgId);
    }
  }

  /**
   * 本地关键词分类（同步，无延迟）
   */
  _keywordClassify(text) {
    const textLower = text.toLowerCase();

    for (const rule of DEFAULT_KEYWORD_RULES) {
      for (const keyword of rule.keywords) {
        if (textLower.includes(keyword.toLowerCase())) {
          return {
            intent: rule.intent,
            confidence: 0.7,
            source: 'keyword',
          };
        }
      }
    }

    return null; // 关键词无法匹配
  }

  /**
   * 分发分类结果（触发快捷回复面板等）
   */
  _dispatchClassification(content, classification) {
    // 触发自定义事件，让 QuickReplyPanel 等模块响应
    window.dispatchEvent(new CustomEvent('boss-helper:message-classified', {
      detail: {
        content,
        classification,
        conversationId: this.pageInfo.conversationId,
      },
    }));
  }

  /**
   * 接收来自 background 的 AI 分类结果
   */
  _onClassificationResult(payload) {
    // 更新对应的分类结果
    // （主要处理异步 AI 返回的延迟结果）
    if (payload.conversationId && payload.intent) {
      window.dispatchEvent(new CustomEvent('boss-helper:message-classified', {
        detail: {
          content: payload.originalText || '',
          classification: {
            intent: payload.intent,
            confidence: payload.confidence || 0.5,
            source: 'ai',
          },
          suggestedReply: payload.suggestedReply || '',
          conversationId: payload.conversationId,
        },
      }));
    }
  }

  /**
   * 判断是否是 HR 消息
   */
  _isHrMessage(el) {
    const className = el.className || '';
    if (/hr/i.test(className) || /receive/i.test(className) || /left/i.test(className)) {
      return true;
    }
    if (/user/i.test(className) || /self/i.test(className) || /send/i.test(className) || /right/i.test(className)) {
      return false;
    }
    // 无法判断时假设可能是 HR 消息
    return true;
  }

  /**
   * 生成消息去重 ID
   */
  _generateMessageId(content) {
    return content.substring(0, 50).replace(/\s+/g, '');
  }

  destroy() {
    this.classifiedMessages.clear();
    this.pendingClassifications.clear();
    this.observerManager.unregister('classifier-new-messages');
  }
}
