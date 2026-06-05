// ============================================================
// ai-bridge.js — Chrome Prompt API 封装
// 使用 chrome.languageModel 进行本地 AI 推理
// 不可用时降级为关键词匹配
// ============================================================

import { DEFAULT_KEYWORD_RULES } from '../shared/constants.js';

export class AIBridge {
  /**
   * 检查 Prompt API 是否可用
   * @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'>}
   */
  static async getAvailability() {
    try {
      // Chrome 138+ 的 languageModel API
      if (!chrome?.languageModel) {
        return 'unavailable';
      }
      const { available } = await chrome.languageModel.capabilities();
      return available; // 'no' | 'readily' | 'after-download'
    } catch {
      return 'unavailable';
    }
  }

  /**
   * 对 HR 消息进行 AI 分类
   * @param {string} text - 消息文本
   * @returns {Promise<{intent: string, confidence: number, source: string}>}
   */
  static async classifyMessage(text) {
    const availability = await this.getAvailability();

    if (availability === 'unavailable') {
      return this.keywordClassify(text);
    }

    try {
      const session = await chrome.languageModel.create({
        systemPrompt: _buildSystemPrompt(),
        temperature: 0.1,
        topK: 1,
      });

      const prompt = `请对以下招聘者消息进行分类。只返回 JSON 格式，不要其他内容：
{"intent": "类别", "confidence": 0.0-1.0}

消息：${text}`;

      const response = await session.prompt(prompt);
      session.destroy();

      const result = this._parseAIResponse(response);
      return {
        intent: result.intent || 'other',
        confidence: result.confidence || 0.5,
        source: 'ai',
      };
    } catch (err) {
      console.debug('[BossHelper] AI classification failed, using keyword fallback:', err.message);
      return this.keywordClassify(text);
    }
  }

  /**
   * 关键词分类（同步，作为降级方案）
   */
  static keywordClassify(text) {
    const lower = text.toLowerCase();

    for (const rule of DEFAULT_KEYWORD_RULES) {
      for (const keyword of rule.keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          return {
            intent: rule.intent,
            confidence: 0.7,
            source: 'keyword',
          };
        }
      }
    }

    return {
      intent: 'other',
      confidence: 0.3,
      source: 'keyword',
    };
  }

  /**
   * 解析 AI 返回的 JSON
   */
  static _parseAIResponse(response) {
    try {
      // 尝试提取 JSON（AI 可能返回多余文本）
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          intent: _normalizeIntent(parsed.intent),
          confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
        };
      }
    } catch {
      // JSON 解析失败
    }

    // 直接在响应中查找关键词
    for (const intent of ['ask_resume', 'ask_interview', 'ask_salary', 'spam']) {
      if (response.includes(intent)) {
        return { intent, confidence: 0.6 };
      }
    }

    return { intent: 'other', confidence: 0.3 };
  }
}

function _buildSystemPrompt() {
  return `你是一个求职辅助助手，负责对招聘者发来的消息进行智能分类。

分类类别：
- ask_resume: 索要简历、让发送简历、让提供附件或作品集
- ask_interview: 邀请面试、约时间面谈、约视频/电话面试
- ask_salary: 询问薪资期望、询问当前薪资、谈薪资待遇
- spam: 垃圾消息、兼职广告、中介收费、要求加微信/QQ，要求交押金/培训费
- other: 其他类型消息

规则：
1. 根据消息的主要意图选择最匹配的类别
2. confidence 表示分类置信度（0.0-1.0）
3. 只返回 {"intent": "...", "confidence": 0.XX} 格式的 JSON`;
}

function _normalizeIntent(intent) {
  const validIntents = ['ask_resume', 'ask_interview', 'ask_salary', 'spam', 'other'];
  if (validIntents.includes(intent)) return intent;
  if (intent?.includes('resume')) return 'ask_resume';
  if (intent?.includes('interview')) return 'ask_interview';
  if (intent?.includes('salary')) return 'ask_salary';
  if (intent?.includes('spam')) return 'spam';
  return 'other';
}
