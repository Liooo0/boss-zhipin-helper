// ============================================================
// stats-aggregator.js — 统计计算
// 从 IndexedDB 原始数据计算各类统计指标
// 结果缓存在 stats_cache store 中
// ============================================================

import { db } from '../shared/db.js';
import { STORE_NAMES, STATUS } from '../shared/constants.js';
import { getStartOfDay, getDaysAgo, formatDate } from '../shared/utils.js';

export class StatsAggregator {
  /**
   * 获取今日统计
   */
  static async getDailyStats() {
    const todayStart = getStartOfDay();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [applications, conversations, messages] = await Promise.all([
      db.getByDateRange(STORE_NAMES.APPLICATIONS, 'idx_applyTime', todayStart, todayEnd.getTime()),
      db.getByDateRange(STORE_NAMES.CONVERSATIONS, 'idx_lastMessageTime', todayStart, todayEnd.getTime()),
      db.getByDateRange(STORE_NAMES.MESSAGES, 'idx_timestamp', todayStart, todayEnd.getTime()),
    ]);

    const hrMessages = messages.filter(m => m.role === 'hr');
    const userMessages = messages.filter(m => m.role === 'user');
    const interviewInvites = messages.filter(m =>
      m.classification === 'ask_interview' || m.classification === 'interview'
    );

    return {
      date: formatDate(new Date()),
      applicationsSent: applications.length,
      totalMessages: messages.length,
      hrMessages: hrMessages.length,
      userMessages: userMessages.length,
      conversationsActive: conversations.filter(c => c.status === 'active').length,
      interviewInvites: interviewInvites.length,
      responseRate: this._calcRate(
        conversations.filter(c => c.messageCount >= 2).length,
        applications.length
      ),
    };
  }

  /**
   * 获取本周统计
   */
  static async getWeeklyStats() {
    const weekStart = getDaysAgo(7);
    const now = Date.now();

    const [applications, conversations, allApps] = await Promise.all([
      db.getByDateRange(STORE_NAMES.APPLICATIONS, 'idx_applyTime', weekStart, now),
      db.getByDateRange(STORE_NAMES.CONVERSATIONS, 'idx_lastMessageTime', weekStart, now),
      db.getAll(STORE_NAMES.APPLICATIONS),
    ]);

    // 按天分组
    const dailyCounts = {};
    for (let i = 0; i < 7; i++) {
      const date = formatDate(new Date(Date.now() - i * 86400000));
      dailyCounts[date] = 0;
    }
    applications.forEach(a => {
      const date = formatDate(a.applyTime);
      if (dailyCounts[date] !== undefined) dailyCounts[date]++;
    });

    // 本周各状态统计
    const weeklyInterviewInvites = applications.filter(a => a.status === STATUS.APPLICATION.INTERVIEW).length;
    const weeklyReplied = applications.filter(a =>
      a.status === STATUS.APPLICATION.REPLIED || a.status === STATUS.APPLICATION.INTERVIEW
    ).length;

    return {
      period: 'weekly',
      startDate: formatDate(weekStart),
      endDate: formatDate(now),
      totalApplications: applications.length,
      allTimeApplications: allApps.length,
      weeklyReplied,
      weeklyInterviewInvites,
      conversationsActive: conversations.filter(c => c.status === 'active').length,
      responseRate: this._calcRate(weeklyReplied, applications.length),
      interviewRate: this._calcRate(weeklyInterviewInvites, applications.length),
      dailyCounts,
    };
  }

  /**
   * 获取全部历史统计
   */
  static async getAllTimeStats() {
    const [applications, conversations] = await Promise.all([
      db.getAll(STORE_NAMES.APPLICATIONS),
      db.getAll(STORE_NAMES.CONVERSATIONS),
    ]);

    // 按状态分组
    const statusCounts = {};
    Object.values(STATUS.APPLICATION).forEach(s => { statusCounts[s] = 0; });
    applications.forEach(a => {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    });

    // 按公司分组
    const companyMap = {};
    applications.forEach(a => {
      if (!a.companyName) return;
      if (!companyMap[a.companyName]) {
        companyMap[a.companyName] = { company: a.companyName, applications: 0, replied: 0 };
      }
      companyMap[a.companyName].applications++;
      if (a.status === STATUS.APPLICATION.REPLIED ||
          a.status === STATUS.APPLICATION.INTERVIEW) {
        companyMap[a.companyName].replied++;
      }
    });
    const companyStats = Object.values(companyMap).sort((a, b) => b.applications - a.applications);

    // 回复率和面试率
    const repliedCount = statusCounts[STATUS.APPLICATION.REPLIED] +
      statusCounts[STATUS.APPLICATION.INTERVIEW];
    const interviewCount = statusCounts[STATUS.APPLICATION.INTERVIEW];

    return {
      period: 'alltime',
      totalApplications: applications.length,
      totalConversations: conversations.length,
      repliedCount,
      interviewCount,
      responseRate: this._calcRate(repliedCount, applications.length),
      interviewRate: this._calcRate(interviewCount, applications.length),
      statusBreakdown: statusCounts,
      topCompanies: companyStats.slice(0, 10),
    };
  }

  /**
   * 获取每日投递趋势（最近 N 天）
   */
  static async getDailyTrend(days = 30) {
    const startTime = getDaysAgo(days);
    const applications = await db.getByDateRange(
      STORE_NAMES.APPLICATIONS,
      'idx_applyTime',
      startTime,
      Date.now()
    );

    const trend = {};
    for (let i = 0; i < days; i++) {
      const date = formatDate(new Date(Date.now() - i * 86400000));
      trend[date] = { applications: 0, replies: 0, interviews: 0 };
    }

    applications.forEach(a => {
      const date = formatDate(a.applyTime);
      if (trend[date]) {
        trend[date].applications++;
        if (a.status === STATUS.APPLICATION.REPLIED || a.status === STATUS.APPLICATION.INTERVIEW) {
          trend[date].replies++;
        }
        if (a.status === STATUS.APPLICATION.INTERVIEW) {
          trend[date].interviews++;
        }
      }
    });

    return trend;
  }

  /**
   * 计算比率并保留两位小数
   */
  static _calcRate(numerator, denominator) {
    if (!denominator || denominator === 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 100;
  }
}
