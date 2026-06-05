// ============================================================
// app-event-capturer.js — 捕获投递和消息事件并记录到 IndexedDB
// ============================================================

import { SELECTORS, findElement } from '../dom-selectors.js';
import { PAGE_TYPES } from '../../shared/constants.js';
import { MSG, SOURCE, buildMessage } from '../../shared/message-protocol.js';
import { sendToBackground, extractJobIdFromElement, extractConversationIdFromUrl } from '../../shared/utils.js';

export class AppEventCapturer {
  constructor(pageInfo, observerManager) {
    this.pageInfo = pageInfo;
    this.observerManager = observerManager;
    this.capturedMessages = new Map(); // 消息去重
    this._onCommunicateClick = this._onCommunicateClick.bind(this);
  }

  initialize() {
    const { pageType } = this.pageInfo;

    if (pageType === PAGE_TYPES.JOB_DETAIL) {
      this._bindCommunicationButton();
    }

    if (pageType === PAGE_TYPES.CHAT) {
      this._bindChatObserver();
    }
  }

  /**
   * 绑定"立即沟通"按钮的点击事件
   */
  _bindCommunicationButton() {
    // 使用事件委托，因为按钮可能延迟渲染
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('a[ka*="start-im"], a.btn-start-chat, a.btn-start-im');
      if (!btn) {
        // 检查点击的元素或父元素是否包含"立即沟通"文字
        const textEl = e.target.closest?.('a, button');
        if (textEl) {
          const text = textEl.textContent?.trim() || '';
          if (!text.includes('立即沟通') && !text.includes('立即沟通')) {
            return;
          }
        } else {
          return;
        }
      }
      this._onCommunicateClick(e);
    }, true); // 捕获阶段，确保先于 BOSS 的处理函数
  }

  /**
   * 处理"立即沟通"点击
   */
  async _onCommunicateClick(event) {
    try {
      const jobInfo = this._extractJobInfoFromDetail();
      window.__bhDebug?.('log', '捕获投递事件: jobId=' + jobInfo.jobId + ' position=' + jobInfo.positionName);

      if (!jobInfo.jobId) {
        window.__bhDebug?.('warn', '无法提取jobId，跳过记录');
        return;
      }

      // 避免重复记录（短时间内同一职位只记录一次）
      const key = `apply-${jobInfo.jobId}`;
      if (this._isDuplicate(key, 3000)) return;

      const application = {
        id: `${jobInfo.jobId}_${Date.now()}`,
        jobId: jobInfo.jobId,
        positionId: jobInfo.jobId,
        jobTitle: jobInfo.positionName,
        companyName: jobInfo.companyName,
        companyId: '',
        salary: jobInfo.salary,
        applyTime: Date.now(),
        status: 'sent',
        lastUpdated: Date.now(),
        url: window.location.href,
        conversationId: null,
        greetingUsed: '',
        notes: '',
      };

      const result = await sendToBackground(buildMessage(MSG.RECORD_APPLICATION, application));
      if (result?.success) {
        window.__bhDebug?.('log', '✅ 投递已记录: ' + application.jobTitle + ' @ ' + application.companyName);
      } else {
        window.__bhDebug?.('warn', '投递记录返回失败: ' + JSON.stringify(result));
      }
    } catch (err) {
      window.__bhDebug?.('error', '记录投递失败: ' + (err?.message || JSON.stringify(err) || '未知错误'));
    }
  }

  /**
   * 绑定聊天页的消息监听
   */
  _bindChatObserver() {
    this.observerManager.register('chat-messages', {
      selector: SELECTORS.chat.messageItems[0],
      callback: (elements) => this._handleNewMessageElements(elements),
      debounce: 500,
    });
  }

  /**
   * 处理新检测到的消息元素
   */
  _handleNewMessageElements(elements) {
    for (const el of elements) {
      if (this._isDuplicate(`msg-${el.dataset?.msgId || el.textContent?.substring(0, 20)}`, 60000)) {
        continue;
      }

      const msgData = this._extractMessageFromElement(el);
      if (!msgData || !msgData.content) continue;

      const conversationId = this.pageInfo.conversationId ||
        extractConversationIdFromUrl(window.location.href);

      const message = {
        id: `${conversationId || 'chat'}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        conversationId: conversationId || 'unknown',
        role: msgData.role,
        content: msgData.content,
        timestamp: msgData.timestamp || Date.now(),
        classification: null,
        classificationConfidence: 0,
        classificationSource: null,
        replySuggested: null,
        replyUsed: false,
      };

      sendToBackground(buildMessage(MSG.RECORD_MESSAGE, message))
        .catch(err => console.debug('[BossHelper] Message recording deferred:', err.message));
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 从职位详情页提取职位信息
   */
  _extractJobInfoFromDetail() {
    const positionName = this._safeText(findElement(SELECTORS.jobDetail.positionName));
    const companyName = this._safeText(findElement(SELECTORS.jobDetail.companyName));
    const salary = this._safeText(findElement(SELECTORS.jobDetail.salary));
    const jobId = extractJobIdFromElement(document.body) ||
      this.pageInfo.jobId ||
      `unknown_${Date.now()}`;

    return { positionName, companyName, salary, jobId };
  }

  /**
   * 从消息 DOM 元素提取消息数据
   */
  _extractMessageFromElement(el) {
    const isHr = el.classList.contains('hr') ||
      el.classList.contains('msg-receive') ||
      el.querySelector('[class*="hr"]') !== null ||
      el.getAttribute('class')?.includes('receive');

    const isUser = el.classList.contains('user') ||
      el.classList.contains('msg-send') ||
      el.getAttribute('class')?.includes('send') ||
      el.getAttribute('class')?.includes('self');

    const textEl = findElement(SELECTORS.chat.messageText, el);
    const content = textEl?.textContent?.trim() || '';

    const timeEl = findElement(SELECTORS.chat.messageTime, el);
    const timeText = timeEl?.textContent?.trim() || '';

    return {
      role: isHr ? 'hr' : (isUser ? 'user' : 'unknown'),
      content,
      timestamp: this._parseTime(timeText) || Date.now(),
    };
  }

  /**
   * 去重检查
   */
  _isDuplicate(key, windowMs) {
    const lastTime = this.capturedMessages.get(key);
    if (lastTime && Date.now() - lastTime < windowMs) return true;
    this.capturedMessages.set(key, Date.now());
    // 清理过期条目
    if (this.capturedMessages.size > 500) {
      const cutoff = Date.now() - 60000;
      for (const [k, t] of this.capturedMessages) {
        if (t < cutoff) this.capturedMessages.delete(k);
      }
    }
    return false;
  }

  _safeText(el) {
    return el?.textContent?.trim() || '';
  }

  _parseTime(timeStr) {
    if (!timeStr) return null;
    // 尝试解析常见时间格式
    const now = new Date();
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      const d = new Date(now);
      d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
      return d.getTime();
    }
    return Date.parse(timeStr) || null;
  }

  destroy() {
    this.capturedMessages.clear();
    this.observerManager.unregister('chat-messages');
  }
}
