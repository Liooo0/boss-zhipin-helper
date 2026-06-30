# BOSS 直聘助手 — AI 求职 Chrome 扩展

> 自动生成招呼语、AI 对话辅助回复、智能岗位管理。让你的求职效率翻倍。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-green)](https://developer.chrome.com/docs/extensions/mv3/)

## 🎯 解决什么问题

在 BOSS 直聘 / 智联招聘上求职时，你每天要：

- 给几十个 HR 发打招呼语，每个都要看 JD 个性定制
- 跟 HR 聊天时字斟句酌，反复琢磨怎么回复
- 投了哪些公司、进度如何，全靠脑子记

这个扩展把这三件事自动化：

| 痛点 | 解决方案 |
|---|---|
| 打招呼语写不动了 | 一键抓取当前页面 JD → AI 生成个性化招呼语 |
| HR 消息不知道怎么回 | 粘贴 HR 消息 → AI 生成回复（专业/拟人双模式） |
| 投递进度一团乱 | 自动保存浏览过的岗位，面板统计投递数和面试率 |

## ✨ 功能

- **AI 招呼语** — 浏览职位时自动抓取 JD，点一下生成个性化打招呼语
- **AI 对话助手** — 聊天页面弹出侧边面板，粘贴 HR 消息自动生成回复
- **岗位管理** — 自动保存浏览过的职位，支持置顶、搜索、删除
- **简历解析** — 上传 PDF 简历，AI 提取信息用于生成更精准的回复
- **数据面板** — 投递记录、沟通统计、面试率，支持 JSON 导出
- **双模式回复** — 专业模式 / 拟人模式自由切换
- **双模型支持** — DeepSeek / MiMo 2.5
- **多平台适配** — BOSS直聘 (boss.cn / zhipin.com) + 智联招聘 (zhaopin.com)

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────┐
│              Chrome Extension MV3            │
├─────────────────────────────────────────────┤
│  Content Script (页面注入)                    │
│  ├── ai-reply-assistant.js   AI 对话助理     │
│  ├── job-badge-injector.js   岗位标记         │
│  ├── message-classifier.js   消息分类         │
│  └── page-detector.js        页面识别         │
├─────────────────────────────────────────────┤
│  Service Worker (后台)                        │
│  ├── ai-bridge.js            AI API 桥接     │
│  ├── alarm-manager.js        定时任务         │
│  └── stats-aggregator.js     数据统计         │
├─────────────────────────────────────────────┤
│  Shared (共享模块)                            │
│  ├── db.js                   IndexedDB 抽象  │
│  ├── message-protocol.js     消息路由协议     │
│  ├── template-engine.js      模板引擎         │
│  └── constants.js            全局常量         │
├─────────────────────────────────────────────┤
│  UI (界面)                                    │
│  ├── popup/   工具栏弹窗      快速统计+开关   │
│  ├── sidepanel/ 侧边面板      AI 对话界面     │
│  └── options/ 设置页面        个人信息配置     │
└─────────────────────────────────────────────┘
```

**设计亮点：**
- **MV3 规范**：Service Worker 无状态设计，所有状态来自 IndexedDB 或 chrome.storage
- **消息路由**：自定义消息协议，Content / Popup / SidePanel / Options 统一通信
- **IndexedDB 持久化**：单例模式，管理岗位数据、对话历史、投递统计
- **AI 安全**：API Key 仅存于 chrome.storage.local，不经过代码、不经过文件、不上传

## 📦 安装

1. 下载代码
```bash
git clone https://github.com/ConsoleSun/boss-zhipin-helper.git
```

2. Chrome 地址栏输入 `chrome://extensions`，开启「开发者模式」

3. 点击「加载已解压的扩展程序」，选择项目文件夹

4. 点击右上角扩展图标 → 设置 → 填写你的 API Key

## ⚙️ 配置

打开设置页，填入：

| 配置项 | 说明 |
|---|---|
| 个人信息 | 技能、经验、求职意向（AI 生成回复的依据） |
| API Key | DeepSeek 或 MiMo 的 API Key |
| 打招呼模板 | 可自定义，支持 `{jobTitle}` `{company}` `{skills}` 等变量 |
| 回复风格 | 专业模式 / 拟人模式 |

> 🔒 **隐私说明**：你的 API Key 和个人信息只存储在浏览器本地的 `chrome.storage`，不经过任何第三方服务器。

## 🛠️ 技术栈

| 层级 | 技术 |
|---|---|
| 平台 | Chrome Extension Manifest V3 |
| 前端 | Vanilla JS + CSS Custom Properties |
| 数据 | IndexedDB + chrome.storage |
| AI | DeepSeek API / MiMo 2.5 API |
| 通信 | chrome.runtime.sendMessage 自定义协议 |

## 📁 项目结构

```
boss-zhipin-helper/
├── manifest.json                 # Chrome 扩展配置
├── src/
│   ├── background/               # Service Worker
│   │   ├── service-worker.js     # 消息路由中心
│   │   ├── ai-bridge.js          # AI API 调用桥接
│   │   ├── alarm-manager.js      # 定时任务
│   │   └── stats-aggregator.js   # 数据统计
│   ├── content/                  # 页面注入脚本
│   │   ├── main.js               # 入口
│   │   ├── page-detector.js      # 页面类型识别
│   │   ├── observer-manager.js   # DOM 监听
│   │   ├── dom-selectors.js      # 平台适配选择器
│   │   └── features/             # 功能模块
│   │       ├── ai-reply-assistant.js
│   │       ├── job-badge-injector.js
│   │       ├── message-classifier.js
│   │       └── ...
│   ├── shared/                   # 共享模块
│   │   ├── db.js                 # IndexedDB 抽象
│   │   ├── message-protocol.js   # 通信协议
│   │   ├── template-engine.js    # 模板引擎
│   │   └── constants.js          # 全局常量
│   ├── popup/                    # 工具栏弹窗
│   ├── sidepanel/                # 侧边 AI 面板
│   └── options/                  # 设置页
├── styles/                       # 全局样式
├── icons/                        # 扩展图标
└── lib/                          # 第三方库 (pdf.js)
```

## 📄 License

MIT — 随意使用、修改、商用。保留原作者标注即可。
