// ============================================================
// db.js — IndexedDB 抽象层
// 单例模式，管理所有数据持久化
// ============================================================

import { DB_NAME, DB_VERSION, STORE_NAMES } from './constants.js';

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPromise = null;
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * 获取数据库连接（延迟初始化）
   */
  async getDB() {
    if (this.db) return this.db;
    if (!this.dbPromise) {
      this.dbPromise = this._openDB();
    }
    this.db = await this.dbPromise;
    return this.db;
  }

  /**
   * 打开数据库并创建/升级 Schema
   */
  async _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // === applications store ===
        if (!db.objectStoreNames.contains(STORE_NAMES.APPLICATIONS)) {
          const appStore = db.createObjectStore(STORE_NAMES.APPLICATIONS, {
            keyPath: 'id',
          });
          appStore.createIndex('idx_jobId', 'jobId', { unique: false });
          appStore.createIndex('idx_applyTime', 'applyTime', { unique: false });
          appStore.createIndex('idx_companyName', 'companyName', { unique: false });
          appStore.createIndex('idx_status', 'status', { unique: false });
          appStore.createIndex('idx_conversationId', 'conversationId', { unique: false });
        }

        // === conversations store ===
        if (!db.objectStoreNames.contains(STORE_NAMES.CONVERSATIONS)) {
          const convStore = db.createObjectStore(STORE_NAMES.CONVERSATIONS, {
            keyPath: 'id',
          });
          convStore.createIndex('idx_companyName', 'companyName', { unique: false });
          convStore.createIndex('idx_lastMessageTime', 'lastMessageTime', { unique: false });
          convStore.createIndex('idx_status', 'status', { unique: false });
          convStore.createIndex('idx_jobId', 'jobId', { unique: false });
        }

        // === messages store ===
        if (!db.objectStoreNames.contains(STORE_NAMES.MESSAGES)) {
          const msgStore = db.createObjectStore(STORE_NAMES.MESSAGES, {
            keyPath: 'id',
          });
          msgStore.createIndex('idx_conversationId', 'conversationId', { unique: false });
          msgStore.createIndex('idx_timestamp', 'timestamp', { unique: false });
          msgStore.createIndex('idx_classification', 'classification', { unique: false });
          msgStore.createIndex('idx_role', 'role', { unique: false });
        }

        // === templates store ===
        if (!db.objectStoreNames.contains(STORE_NAMES.TEMPLATES)) {
          const tmplStore = db.createObjectStore(STORE_NAMES.TEMPLATES, {
            keyPath: 'id',
          });
          tmplStore.createIndex('idx_category', 'category', { unique: false });
          tmplStore.createIndex('idx_subcategory', 'subcategory', { unique: false });
          tmplStore.createIndex('idx_isDefault', 'isDefault', { unique: false });
        }

        // === stats_cache store ===
        if (!db.objectStoreNames.contains(STORE_NAMES.STATS_CACHE)) {
          const statsStore = db.createObjectStore(STORE_NAMES.STATS_CACHE, {
            keyPath: 'id',
          });
          statsStore.createIndex('idx_statType_dateKey', 'statType', { unique: false });
        }

        // === settings store ===
        if (!db.objectStoreNames.contains(STORE_NAMES.SETTINGS)) {
          db.createObjectStore(STORE_NAMES.SETTINGS, {
            keyPath: 'key',
          });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        // 处理连接丢失
        db.onclose = () => {
          this.db = null;
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('[BossHelper] IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = () => {
        console.warn('[BossHelper] IndexedDB blocked — close other tabs');
      };
    });
  }

  // ==================== 通用 CRUD ====================

  /**
   * 获取单条记录
   */
  async get(storeName, key) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取全部记录
   */
  async getAll(storeName) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 插入或更新记录
   */
  async put(storeName, value) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 批量插入
   */
  async bulkPut(storeName, values) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let count = 0;
      for (const value of values) {
        store.put(value).onsuccess = () => {
          count++;
          if (count === values.length) resolve();
        };
      }
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * 删除记录
   */
  async delete(storeName, key) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 清空 store
   */
  async clear(storeName) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 计数
   */
  async count(storeName, query = null) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      if (query?.index && query?.range) {
        const index = store.index(query.index);
        const request = index.count(query.range);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    });
  }

  /**
   * 通过索引查询
   */
  async getByIndex(storeName, indexName, value) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 通过日期范围查询
   */
  async getByDateRange(storeName, indexName, startTime, endTime) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.bound(startTime, endTime);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== 业务查询 ====================

  /**
   * 按日期范围统计投递数量
   */
  async getApplicationCountByDateRange(startTime, endTime) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAMES.APPLICATIONS, 'readonly');
      const store = tx.objectStore(STORE_NAMES.APPLICATIONS);
      const index = store.index('idx_applyTime');
      const range = IDBKeyRange.bound(startTime, endTime);
      let count = 0;
      const request = index.openCursor(range);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          count++;
          cursor.continue();
        } else {
          resolve(count);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 批量查询职位是否已投递
   * @param {string[]} jobIds
   * @returns {Promise<Map<string, boolean>>}
   */
  async checkJobsApplied(jobIds) {
    const db = await this.getDB();
    const result = new Map();
    // 全部初始化为 false
    jobIds.forEach(id => result.set(id, false));

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAMES.APPLICATIONS, 'readonly');
      const store = tx.objectStore(STORE_NAMES.APPLICATIONS);
      const index = store.index('idx_jobId');

      let completed = 0;
      for (const jobId of jobIds) {
        const request = index.getKey(jobId);
        request.onsuccess = () => {
          if (request.result) {
            result.set(jobId, true);
          }
          completed++;
          if (completed === jobIds.length) resolve(result);
        };
        request.onerror = () => {
          completed++;
          if (completed === jobIds.length) resolve(result);
        };
      }

      if (jobIds.length === 0) resolve(result);
    });
  }

  /**
   * 获取指定会话的所有消息（按时间排序）
   */
  async getMessagesByConversation(conversationId) {
    const messages = await this.getByIndex(
      STORE_NAMES.MESSAGES,
      'idx_conversationId',
      conversationId
    );
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 清理过期数据
   * @param {number} daysToKeep 保留天数
   */
  async pruneOldData(daysToKeep) {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const db = await this.getDB();

    // 清理旧投递记录
    await this._deleteByTimeRange(STORE_NAMES.APPLICATIONS, 'idx_applyTime', 0, cutoff);

    // 清理旧会话记录
    await this._deleteByTimeRange(STORE_NAMES.CONVERSATIONS, 'idx_lastMessageTime', 0, cutoff);

    // 清理旧消息
    await this._deleteByTimeRange(STORE_NAMES.MESSAGES, 'idx_timestamp', 0, cutoff);

    // 清理统计缓存
    await this.clear(STORE_NAMES.STATS_CACHE);
  }

  async _deleteByTimeRange(storeName, indexName, start, end) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.bound(start, end);
      const request = index.openCursor(range);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取存储使用量估算
   */
  async getStorageEstimate() {
    try {
      return await navigator.storage.estimate();
    } catch {
      return { usage: 0, quota: 0 };
    }
  }
}

export const db = DatabaseService.getInstance();
