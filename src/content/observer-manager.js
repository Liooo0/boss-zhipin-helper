// ============================================================
// observer-manager.js — MutationObserver 管理
// 统筹页面 DOM 变化的监听，为各 feature 提供注册接口
// 使用防抖机制避免 React 批量渲染时重复处理
// ============================================================

import { OBSERVER_DEBOUNCE } from '../shared/constants.js';
import { getAddedElements } from '../shared/utils.js';

export class ObserverManager {
  /**
   * @param {import('./page-detector.js').PageInfo} pageInfo
   */
  constructor(pageInfo) {
    this.pageInfo = pageInfo;
    this.mainObserver = null;
    this.watchers = new Map(); // Map<string, { selector, callback, options }>
    this.debounceTimer = null;
    this.pendingMutations = [];
    this.initialized = false;
  }

  /**
   * 初始化观察器
   */
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    const targetNode = document.body || document.documentElement;
    if (!targetNode) {
      console.warn('[BossHelper] ObserverManager: body not available');
      return;
    }

    this.mainObserver = new MutationObserver((mutations) => {
      this._handleMutations(mutations);
    });

    this.mainObserver.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-*', 'ka-*'],
    });

    // 首次 DOM 扫描（延迟以确保 React 已渲染）
    setTimeout(() => this._performInitialScan(), 500);

    console.log('[BossHelper] ObserverManager initialized for:', this.pageInfo.pageType);
  }

  /**
   * 注册一个 DOM 变化监听器
   * @param {string} name - 监听器名称（用于去重）
   * @param {Object} opts - 选项 { selector, callback, debounce }
   */
  register(name, opts) {
    if (this.watchers.has(name)) {
      console.warn('[BossHelper] ObserverManager: watcher already registered:', name);
      return;
    }
    this.watchers.set(name, {
      name,
      selector: opts.selector,
      callback: opts.callback,
      debounceMs: opts.debounce || OBSERVER_DEBOUNCE,
      lastRun: 0,
    });
  }

  /**
   * 取消注册
   */
  unregister(name) {
    this.watchers.delete(name);
  }

  /**
   * 手动触发一次扫描
   */
  scanNow(name) {
    const watcher = this.watchers.get(name);
    if (!watcher) return;
    this._fireWatcher(watcher);
  }

  /**
   * 销毁观察器
   */
  destroy() {
    if (this.mainObserver) {
      this.mainObserver.disconnect();
      this.mainObserver = null;
    }
    this.watchers.clear();
    clearTimeout(this.debounceTimer);
    this.initialized = false;
  }

  // ==================== 私有方法 ====================

  /**
   * 处理批量 DOM 变更
   */
  _handleMutations(mutations) {
    this.pendingMutations.push(...mutations);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._processPendingMutations();
    }, OBSERVER_DEBOUNCE);
  }

  /**
   * 处理累积的变更
   */
  _processPendingMutations() {
    const mutations = this.pendingMutations;
    this.pendingMutations = [];

    // 检查是否有新增节点
    const addedElements = getAddedElements(mutations);
    if (addedElements.length === 0 && !this._hasRelevantChanges(mutations)) {
      return;
    }

    // 触发所有 watcher
    for (const [name, watcher] of this.watchers) {
      const now = Date.now();
      if (now - watcher.lastRun < watcher.debounceMs) continue;
      this._fireWatcher(watcher);
    }
  }

  /**
   * 触发单个 watcher 的回调
   */
  _fireWatcher(watcher) {
    try {
      const elements = document.querySelectorAll(watcher.selector);
      if (elements.length > 0) {
        watcher.lastRun = Date.now();
        watcher.callback(Array.from(elements));
      }
    } catch (err) {
      console.error('[BossHelper] watcher错误 [' + watcher.name + ']:', (err?.message || err?.toString?.() || JSON.stringify(err)));
    }
  }

  /**
   * 检查是否有相关属性变更
   */
  _hasRelevantChanges(mutations) {
    return mutations.some(m => m.type === 'attributes' &&
      (m.attributeName?.startsWith('data-') || m.attributeName?.startsWith('ka-')));
  }

  /**
   * 首次扫描：对所有已注册 watcher 执行一次
   */
  _performInitialScan() {
    for (const [name, watcher] of this.watchers) {
      this._fireWatcher(watcher);
    }
  }
}
