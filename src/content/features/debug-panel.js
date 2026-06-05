// ============================================================
// debug-panel.js — 页面内浮动调试面板
// 通过 window.__bhDebug 暴露全局日志接口
// 任何模块都可以直接调用 window.__bhDebug('消息') 来记录日志
// ============================================================

export class DebugPanel {
  constructor() {
    this.logs = [];
    this.maxLogs = 200;
    this.visible = false;
    this.panel = null;
    this.trigger = null;
    this._ready = false;

    // 暴露全局调试接口
    window.__bhDebug = this.add.bind(this);

    // 也拦截 console 中带 [BossHelper] 的消息作为补充
    this._hookConsole();

    // 等待 body 就绪后注入面板
    this._waitForBody();

    this.add('log', '🔌 DebugPanel 初始化完成');
  }

  _waitForBody() {
    if (document.body) {
      this._inject();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        this._inject();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      if (!this._ready) this._inject();
    }, 2000);
  }

  _inject() {
    if (this._ready) return;
    this._ready = true;

    try {
      this._createPanel();
      this._createTrigger();
      this.add('log', '✅ 面板注入成功，body已就绪');
    } catch (err) {
      this.add('error', '面板注入失败: ' + err.message);
    }
  }

  _createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'bh-debug-panel';
    Object.assign(this.panel.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      zIndex: '2147483647', maxHeight: '280px', height: '220px',
      background: '#0d1117', color: '#e6edf3',
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: '11px', lineHeight: '1.5', overflowY: 'auto',
      display: 'none', padding: '0', borderTop: '2px solid #1890ff',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      position: 'sticky', top: '0', zIndex: '2',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 10px', background: '#161b22', borderBottom: '1px solid #30363d',
      cursor: 'row-resize',
    });
    header.innerHTML = `
      <span style="color:#58a6ff;font-weight:bold;font-size:12px;">🐛 BOSS助手调试</span>
      <span>
        <button id="bh-clear-btn" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:2px 8px;cursor:pointer;border-radius:4px;font-size:11px;">清空</button>
        <button id="bh-close-btn" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:2px 8px;cursor:pointer;border-radius:4px;font-size:11px;margin-left:4px;">关闭</button>
      </span>
    `;

    this.logContainer = document.createElement('div');
    this.logContainer.id = 'bh-log-container';
    Object.assign(this.logContainer.style, {
      padding: '6px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    });

    this.panel.appendChild(header);
    this.panel.appendChild(this.logContainer);
    document.body.appendChild(this.panel);

    // 拖拽调整高度
    let dragging = false, startY = 0, startH = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; startY = e.clientY; startH = this.panel.offsetHeight;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.panel.style.height = Math.max(80, Math.min(600, startH + (startY - e.clientY))) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // 按钮事件
    this.panel.querySelector('#bh-clear-btn').addEventListener('click', () => {
      this.logs = []; this._render();
    });
    this.panel.querySelector('#bh-close-btn').addEventListener('click', () => this.hide());
  }

  _createTrigger() {
    this.trigger = document.createElement('div');
    this.trigger.textContent = '🐛';
    this.trigger.title = 'BOSS助手调试';
    Object.assign(this.trigger.style, {
      position: 'fixed', bottom: '12px', right: '12px',
      zIndex: '2147483646', width: '34px', height: '34px',
      background: '#1890ff', color: '#fff', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', fontSize: '16px',
      boxShadow: '0 3px 12px rgba(24,144,255,0.4)', border: '2px solid #fff',
    });
    this.trigger.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.trigger);
  }

  _hookConsole() {
    const self = this;
    const PREFIX = '[BossHelper]';

    // 安全序列化任意值（包括 Error 对象）
    const safeStr = (a) => {
      if (a instanceof Error) return a.message || a.stack || String(a);
      if (typeof a === 'object' && a !== null) return JSON.stringify(a);
      return String(a);
    };

    const origLog = console.log.bind(console);
    const origErr = console.error.bind(console);

    console.log = function (...args) {
      origLog(...args);
      const msg = args.map(safeStr).join(' ');
      if (msg.includes(PREFIX)) self.add('log', msg.replace(PREFIX + ' ', ''));
    };

    console.error = function (...args) {
      origErr(...args);
      const msg = args.map(safeStr).join(' ');
      if (msg.includes(PREFIX)) self.add('error', msg.replace(PREFIX + ' ', ''));
    };
  }

  /**
   * 添加日志（公开接口，也可以直接 window.__bhDebug('msg') 调用）
   */
  add(level, msg) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.logs.push({ time, level, msg });
    if (this.logs.length > this.maxLogs) this.logs.splice(0, 50);
    if (this.visible) this._render();
  }

  _render() {
    if (!this.logContainer) return;
    const colors = { log: '#e6edf3', error: '#f85149', warn: '#d2991d', debug: '#8b949e' };
    this.logContainer.innerHTML = this.logs.slice(-150).map(l =>
      `<div><span style="color:#484f58;">${l.time}</span> <span style="color:${colors[l.level] || '#e6edf3'};">${l.msg}</span></div>`
    ).join('');
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  toggle() {
    if (!this.panel) return;
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this._render();
  }

  show() {
    if (!this.panel) return;
    this.visible = true;
    this.panel.style.display = 'block';
    this._render();
  }

  hide() {
    if (!this.panel) return;
    this.visible = false;
    this.panel.style.display = 'none';
  }
}
