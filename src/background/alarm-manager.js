// ============================================================
// alarm-manager.js — 定时任务管理
// 利用 chrome.alarms API 编排周期性任务
// ============================================================

export function registerAlarms() {
  // 心跳：每 4.5 分钟触发，保持 Service Worker 存活
  // MV3 SW 空闲 30 秒后可能被终止，但 alarms 能在终止后唤醒
  chrome.alarms.create('heartbeat', {
    periodInMinutes: 4.5,
  });

  // 重新计算统计缓存：每 30 分钟
  chrome.alarms.create('restats', {
    periodInMinutes: 30,
  });

  // 数据清理：每天凌晨 3:17
  chrome.alarms.create('cleanup', {
    periodInMinutes: 24 * 60,
    when: _getNextAlarmTime(3, 17),
  });

  // 更新角标：每 5 分钟
  chrome.alarms.create('update-badge', {
    periodInMinutes: 5,
  });
}

/**
 * 计算下一个指定时间的 timestamp
 * @param {number} hour - 小时
 * @param {number} minute - 分钟
 */
function _getNextAlarmTime(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}
