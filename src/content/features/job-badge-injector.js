// ============================================================
// job-badge-injector.js — 职位列表页已投递标记
// 在职位列表/搜索结果页，为已投递过的职位添加"已沟通"徽章
// 支持无限滚动加载的新卡片
// ============================================================

import { SELECTORS, findAllElements } from '../dom-selectors.js';
import { MSG, SOURCE, buildMessage } from '../../shared/message-protocol.js';
import { sendToBackground, extractJobIdFromElement } from '../../shared/utils.js';

export class JobBadgeInjector {
  constructor(pageInfo, observerManager) {
    this.pageInfo = pageInfo;
    this.observerManager = observerManager;
    this.processedCards = new Set(); // 已处理过的卡片 jobId
    this.badgeInjected = new Set();  // 已注入徽章的卡片 jobId
    this.processing = false;
  }

  initialize() {
    // 监听职位列表容器
    this.observerManager.register('badge-job-cards', {
      selector: SELECTORS.jobList.jobCards[0],
      callback: (elements) => this._onNewJobCards(elements),
      debounce: 500,
    });

    // 首次扫描
    setTimeout(() => this._scanExistingCards(), 1000);
  }

  /**
   * 扫描当前页面已有的职位卡片
   */
  async _scanExistingCards() {
    const cards = findAllElements(SELECTORS.jobList.jobCards);
    if (cards.length > 0) {
      await this._processCards(cards);
    }
  }

  /**
   * 处理新出现的职位卡片
   */
  async _onNewJobCards(elements) {
    await this._processCards(elements);
  }

  /**
   * 批量处理职位卡片
   */
  async _processCards(cards) {
    if (this.processing) return;
    this.processing = true;

    try {
      // 收集新卡片及其 jobId
      const newCards = [];
      const jobIds = [];

      for (const card of cards) {
        const jobId = extractJobIdFromElement(card);
        if (!jobId || this.processedCards.has(jobId)) continue;

        // 也尝试从卡片内的链接提取
        const link = card.querySelector('a[href*="job_detail"]') || card.querySelector('a[href*="job-detail"]');
        const urlJobId = link ? (link.href.match(/\/job[_-]?detail\/([A-Za-z0-9_-]+)/) || [])[1] : null;

        const finalJobId = jobId || urlJobId;
        if (!finalJobId) continue;

        this.processedCards.add(finalJobId);
        newCards.push({ card, jobId: finalJobId });
        jobIds.push(finalJobId);
      }

      if (jobIds.length === 0) return;

      // 批量查询是否已投递
      const appliedMap = await this._checkApplied(jobIds);

      // 为已投递的卡片注入徽章
      for (const { card, jobId } of newCards) {
        if (appliedMap.get(jobId)) {
          this._injectBadge(card, jobId);
          this.badgeInjected.add(jobId);
        }
      }

      // 清理过大的 Set（> 500 条目）
      if (this.processedCards.size > 500) {
        const entries = [...this.processedCards];
        this.processedCards = new Set(entries.slice(-250));
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * 注入"已沟通"徽章到职位卡片
   */
  _injectBadge(card, jobId) {
    // 避免重复注入
    if (card.querySelector('.boss-helper-badge')) return;

    // 创建徽章元素
    const badge = document.createElement('div');
    badge.className = 'boss-helper-badge';
    badge.dataset.jobId = jobId;
    badge.innerHTML = '✓ 已沟通';
    badge.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 10;
      background: rgba(82, 196, 26, 0.9);
      color: #fff;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 4px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.5px;
      line-height: 1.5;
    `;

    // 确保卡片是相对定位
    const cardPosition = window.getComputedStyle(card).position;
    if (cardPosition === 'static') {
      card.style.position = 'relative';
    }

    card.appendChild(badge);
  }

  /**
   * 批量查询职位是否已投递
   */
  async _checkApplied(jobIds) {
    try {
      const result = await sendToBackground(buildMessage(MSG.CHECK_APPLIED, {
        jobIds,
      }));
      if (result?.payload instanceof Map) return result.payload;
      if (result?.payload) return new Map(Object.entries(result.payload));
      return new Map();
    } catch {
      return new Map();
    }
  }

  destroy() {
    this.processedCards.clear();
    this.badgeInjected.clear();
    this.observerManager.unregister('badge-job-cards');
    // 移除已注入的徽章
    document.querySelectorAll('.boss-helper-badge').forEach(b => b.remove());
  }
}
