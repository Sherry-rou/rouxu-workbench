/* ==========================================================================
   柔序工作台 — 应用逻辑
   导航切换 / localStorage 存储 / 备份导入导出 / 隐私弹窗 / PWA 注册
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * 存储层：所有数据存 localStorage，每板块独立 key，格式 workbench.模块名
   * ------------------------------------------------------------------ */
  const SNAP_KEY = '__snapshots';  // 自动快照键（完整 key：workbench.__snapshots）
  const SNAP_MAX = 5;              // 最多保留的快照份数

  const Storage = {
    prefix: 'workbench.',

    get(module, fallback) {
      try {
        const raw = localStorage.getItem(this.prefix + module);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    set(module, data) {
      try {
        localStorage.setItem(this.prefix + module, JSON.stringify(data));
      } catch (e) {
        console.warn('[柔序工作台] 本地存储写入失败：', module, e);
      }
    },

    remove(module) {
      try {
        localStorage.removeItem(this.prefix + module);
      } catch (e) {
        console.warn('[柔序工作台] 本地存储删除失败：', module, e);
      }
    },

    // 数据条目 ID：时间戳 + 随机字符串，保证唯一
    genId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    },

    // 检测 localStorage 是否可用
    available() {
      try {
        const k = this.prefix + '__test__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch (e) {
        return false;
      }
    },

    // 导出：收集所有 workbench.* 键（不含自动快照）
    getAll() {
      const result = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.indexOf(this.prefix) === 0 && key !== this.prefix + SNAP_KEY) {
            result[key] = localStorage.getItem(key);
          }
        }
      } catch (e) {
        console.warn('[柔序工作台] 读取本地存储失败：', e);
      }
      return result;
    },

    // 导入：恢复 workbench.* 键（不覆盖自动快照）
    importAll(data) {
      let count = 0;
      try {
        Object.keys(data || {}).forEach(function (key) {
          if (key.indexOf(Storage.prefix) === 0 && key !== Storage.prefix + SNAP_KEY) {
            const val = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
            localStorage.setItem(key, val);
            count += 1;
          }
        });
      } catch (e) {
        console.warn('[柔序工作台] 导入数据失败：', e);
      }
      return count;
    },

    // 自动快照：本地历史版本列表
    snapshots() {
      try {
        const arr = JSON.parse(localStorage.getItem(this.prefix + SNAP_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    },
    saveSnapshots(list) {
      try { localStorage.setItem(this.prefix + SNAP_KEY, JSON.stringify(list)); } catch (e) {}
    }
  };

  /* 记录一份自动快照（数据未变化时跳过；超出上限则丢弃最旧的） */
  function takeSnapshot() {
    const data = Storage.getAll();
    const keys = Object.keys(data);
    if (!keys.length) return;
    const json = JSON.stringify(data);
    let list = Storage.snapshots();
    const last = list[list.length - 1];
    if (last && JSON.stringify(last.data) === json) return;
    list.push({ at: Date.now(), data: data });
    if (list.length > SNAP_MAX) list = list.slice(-SNAP_MAX);
    Storage.saveSnapshots(list);
  }

  /* ------------------------------------------------------------------
   * 首次使用：给「清单 / 工具类」板块预置一些默认内容（仅一次）
   * 记账、生理期、专注属于个人真实记录，不做预置
   * ------------------------------------------------------------------ */
  function seedDefaults() {
    const flags = Storage.get('__seeded', null);
    if (flags && flags.v1) return;

    // 打卡 & 待办
    const todo = getTodo();
    if (!(todo.daily || []).length && !(todo.tasks || []).length) {
      todo.daily = todo.daily || [];
      todo.tasks = todo.tasks || [];
      todo.daily.push({
        date: todayKey(),
        items: [
          { id: Storage.genId(), text: '喝水 8 杯', done: false },
          { id: Storage.genId(), text: '早睡早起', done: false },
          { id: Storage.genId(), text: '运动 30 分钟', done: false },
          { id: Storage.genId(), text: '阅读 20 分钟', done: false }
        ]
      });
      todo.tasks.push({ id: Storage.genId(), text: '整理本周计划', type: 'work', done: false, createdAt: Date.now() });
      todo.tasks.push({ id: Storage.genId(), text: '学习一项新技能', type: 'long', done: false, createdAt: Date.now() });
      setTodo(todo);
    }

    // 转盘：默认方案
    const wheel = getWheel();
    if (!(wheel.options || []).length && !(wheel.schemes || []).length) {
      const opts = ['火锅', '日料', '快餐', '面条', '家常菜', '外卖'];
      wheel.options = opts.slice();
      wheel.schemes = [{ id: Storage.genId(), name: '今天吃什么', options: opts.slice() }];
      setWheel(wheel);
    }

    // 饮食规划：采购清单
    const plan = getMealPlan();
    if (!(plan.groceries || []).length) {
      ['鸡蛋', '牛奶', '大米', '青菜', '番茄', '水果'].forEach(function (n) {
        plan.groceries.push({ id: Storage.genId(), name: n, bought: false });
      });
      setMealPlan(plan);
    }

    // 倒数日：一个通用例子
    const cd = getCountdown();
    if (!(cd.items || []).length) {
      cd.items = [{ id: Storage.genId(), name: '新年', targetDate: (new Date().getFullYear() + 1) + '-01-01', note: '', tag: '', pinned: false }];
      setCountdown(cd);
    }

    // 愿望清单：几个通用示例
    const wl = getWishlist();
    if (!(wl.items || []).length) {
      [['去看一次海', '旅行'], ['学会做一桌菜', '目标'], ['坚持早起一个月', '体验']].forEach(function (p) {
        wl.items.push({ id: Storage.genId(), text: p[0], tag: p[1], done: false, createdAt: Date.now() });
      });
      setWishlist(wl);
    }

    Storage.set('__seeded', { v1: true });
  }

  /* ------------------------------------------------------------------
   * 图标库（24x24 线性图标，stroke 继承 currentColor）
   * ------------------------------------------------------------------ */
  function icon(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  const ICON = {
    checkSquare: icon('<polyline points="9 11 12 14 22 4"></polyline>' +
      '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>'),
    creditCard: icon('<rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>' +
      '<line x1="1" y1="10" x2="23" y2="10"></line>'),
    bowl: icon('<path d="M4 11h16a8 8 0 0 1-16 0z"></path>' +
      '<line x1="4" y1="11" x2="20" y2="11"></line>' +
      '<path d="M9 8V5"></path><path d="M15 8V5"></path>'),
    wheel: icon('<path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>' +
      '<path d="M22 12A10 10 0 0 0 12 2v10z"></path>'),
    calendar: icon('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>' +
      '<line x1="16" y1="2" x2="16" y2="6"></line>' +
      '<line x1="8" y1="2" x2="8" y2="6"></line>' +
      '<line x1="3" y1="10" x2="21" y2="10"></line>'),
    leaf: icon('<path d="M5 20C5 11 12 4 20 3c-1 8-7 16-15 17z"></path>' +
      '<path d="M5 20c2-4 5-8 8-11"></path>'),
    mealPlan: icon('<circle cx="9" cy="12" r="6.5"></circle>' +
      '<circle cx="9" cy="12" r="2"></circle>' +
      '<line x1="18" y1="8" x2="22" y2="8"></line>' +
      '<line x1="18" y1="12" x2="22" y2="12"></line>' +
      '<line x1="18" y1="16" x2="22" y2="16"></line>'),
    heart: icon('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>'),
    star: icon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>'),
    hourglass: icon('<path d="M7 2h10"></path><path d="M7 22h10"></path>' +
      '<path d="M7 2v3c0 3 5 5 5 7 0-2 5-4 5-7V2"></path>' +
      '<path d="M7 22v-3c0-3 5-5 5-7 0 2 5 4 5 7v3"></path>'),
    gear: icon('<circle cx="12" cy="12" r="3"></circle>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>')
  };

  /* ------------------------------------------------------------------
   * 模块配置：8 个功能板块
   * ------------------------------------------------------------------ */
  const MODULES = [
    { id: 'checkin',    name: '打卡&待办',   key: 'todo',       color: '#99B6B4', darkColor: '#2C3B39', icon: 'checkSquare', desc: '每日打卡与待办清单，记录坚持与完成。' },
    { id: 'accounting', name: '记账管理',     key: 'accounting', color: '#A2DCCF', darkColor: '#23403A', icon: 'creditCard',  desc: '记录每一笔收入与支出，轻松掌握日常财务。' },
    { id: 'eatwell',    name: '好好吃饭',     key: 'eatwell',    color: '#B1CBA2', darkColor: '#333F2C', icon: 'bowl',       desc: '记录每日三餐与饮食心情，好好吃饭好好生活。' },
    { id: 'wheel',      name: '转盘转转转',   key: 'wheel',      color: '#D0F9F1', darkColor: '#23403E', icon: 'wheel',      desc: '选择困难时，转一转，让转盘帮你做决定。' },
    { id: 'countdown',  name: '倒数日',       key: 'countdown',  color: '#D6F0EF', darkColor: '#25403F', icon: 'calendar',   desc: '纪念每一个重要的日子，倒数期待的那一天。' },
    { id: 'diet',       name: '饮食规划',     key: 'mealPlan',   color: '#B8E7D2', darkColor: '#284237', icon: 'mealPlan',   desc: '本周餐单、食谱库、采购清单与饮食小笔记。' },
    { id: 'period',     name: '生理期记录',   key: 'menstrual',  color: '#CFEDEF', darkColor: '#25403F', icon: 'heart',      desc: '记录生理周期，预测经期与排卵日。' },
    { id: 'wishlist',   name: '愿望清单',     key: 'wishlist',   color: '#cdf4eb', darkColor: '#254038', icon: 'star',       desc: '记录人生梦想、旅行目的地、目标与想体验的事。' },
    { id: 'focus',      name: '专注',         key: 'focus',      color: '#DFD7EC', darkColor: '#2E2A3E', icon: 'hourglass',  desc: '专注学习计时，记录每一段心流时光。' }
  ];

  const SETTINGS = { id: 'settings', name: '设置', icon: 'gear' };

  // 各板块精美图标（AI 生成，柔和马卡龙风格）
  const MODULE_IMAGES = {
    checkin: 'icons/modules/module-checkin.png',
    accounting: 'icons/modules/module-accounting.png',
    eatwell: 'icons/modules/module-eatwell.png',
    wheel: 'icons/modules/module-wheel.png',
    countdown: 'icons/modules/module-countdown.png',
    diet: 'icons/modules/module-diet.png',
    period: 'icons/modules/module-period.png',
    wishlist: 'icons/modules/module-wishlist.png',
    focus: 'icons/modules/module-focus.png',
    settings: 'icons/modules/module-settings.png'
  };

  function getModule(id) {
    return MODULES.find(function (m) { return m.id === id; });
  }

  /* ------------------------------------------------------------------
   * 通用工具
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayKey() { return dateKey(new Date()); }

  function shiftDate(key, delta) {
    const p = key.split('-').map(Number);
    return dateKey(new Date(p[0], p[1] - 1, p[2] + delta));
  }

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function dateLabelCN(key) {
    const p = key.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return p[1] + '月' + p[2] + '日 周' + WEEK[d.getDay()];
  }

  function timeLabelCN(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ------------------------------------------------------------------
   * 空状态：统一插图 + 柔和提示文字（各板块无数据时使用）
   *   emptyBox(text)        常规（插图在上，文字在下）
   *   emptyBox(text, true)  紧凑（插图与文字同一行，用于卡片内小分区）
   * ------------------------------------------------------------------ */
  function emptyArt() {
    return '<svg class="empty-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      '<ellipse cx="32" cy="50" rx="19" ry="5.5" style="fill:var(--accent)" opacity="0.13"></ellipse>' +
      '<path d="M15 41c0-9.4 7.6-17 17-17s17 7.6 17 17z" style="fill:var(--accent)" opacity="0.2"></path>' +
      '<rect x="12" y="41" width="40" height="6" rx="3" style="fill:var(--accent)" opacity="0.34"></rect>' +
      '<path d="M32 24v-9" stroke-width="2.4" stroke-linecap="round" style="stroke:var(--accent)" opacity="0.45" fill="none"></path>' +
      '<path d="M32 17c0-4.4 3.4-8 7.6-8 0 4.4-3.4 8-7.6 8z" style="fill:var(--accent)" opacity="0.42"></path>' +
      '<circle cx="20" cy="17" r="1.7" style="fill:var(--accent)" opacity="0.34"></circle>' +
      '<circle cx="46" cy="24" r="1.3" style="fill:var(--accent)" opacity="0.3"></circle>' +
    '</svg>';
  }
  function emptyBox(text, small) {
    return '<div class="empty-box' + (small ? ' small' : '') + '">' +
      emptyArt() + '<span class="empty-text">' + text + '</span>' +
    '</div>';
  }

  /* ------------------------------------------------------------------
   * 页面内对话框：替代原生 alert / confirm / prompt
   * 原因：预览面板 iframe / 手机 PWA 独立窗口常静默拦截原生弹窗
   * ------------------------------------------------------------------ */
  const UI = (function () {
    let overlay = null;

    function ensure() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.className = 'ui-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="ui-dialog" role="dialog" aria-modal="true">' +
          '<div class="ui-title"></div>' +
          '<div class="ui-msg"></div>' +
          '<input class="input ui-input" type="text" maxlength="30">' +
          '<div class="ui-options"></div>' +
          '<div class="ui-actions">' +
            '<button type="button" class="btn btn-secondary ui-cancel"></button>' +
            '<button type="button" class="btn btn-primary ui-ok"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      return overlay;
    }

    function open(opts) {
      const el = ensure();
      const titleEl = el.querySelector('.ui-title');
      const msgEl = el.querySelector('.ui-msg');
      const inputEl = el.querySelector('.ui-input');
      const optionsEl = el.querySelector('.ui-options');
      const cancelBtn = el.querySelector('.ui-cancel');
      const okBtn = el.querySelector('.ui-ok');

      titleEl.textContent = opts.title || '';
      titleEl.style.display = opts.title ? '' : 'none';
      msgEl.textContent = opts.message || '';
      msgEl.style.display = opts.message ? '' : 'none';
      inputEl.style.display = opts.input ? '' : 'none';
      inputEl.value = opts.value == null ? '' : String(opts.value);
      cancelBtn.textContent = opts.cancelText || '取消';
      cancelBtn.style.display = opts.cancelText === '' ? 'none' : '';
      okBtn.textContent = opts.okText || '确定';
      okBtn.style.display = opts.okText === '' ? 'none' : '';
      el.hidden = false;

      if (opts.input) {
        setTimeout(function () { inputEl.focus(); try { inputEl.select(); } catch (e) {} }, 30);
      }

      function cleanup() {
        el.hidden = true;
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        inputEl.onkeydown = null;
        el.onclick = null;
        optionsEl.innerHTML = '';
        optionsEl.style.display = 'none';
      }
      let submitted = false;
      function submit() {
        if (submitted) return;
        submitted = true;
        const val = opts.input ? inputEl.value : '';
        cleanup();
        if (opts.onOk) opts.onOk(val);
      }
      function cancel() {
        cleanup();
        if (opts.onCancel) opts.onCancel();
      }

      if (opts.options && opts.options.length) {
        optionsEl.innerHTML = '';
        optionsEl.style.display = '';
        opts.options.forEach(function (o) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ui-option';
          b.textContent = o.label;
          b.onclick = function () {
            if (submitted) return;
            submitted = true;
            cleanup();
            if (opts.onPick) opts.onPick(o.value);
          };
          optionsEl.appendChild(b);
        });
      } else {
        optionsEl.innerHTML = '';
        optionsEl.style.display = 'none';
      }

      okBtn.onclick = submit;
      cancelBtn.onclick = cancel;
      inputEl.onkeydown = function (e) {
        if (e.isComposing || e.keyCode === 229) return;  // 输入法组字中的回车只是选词
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { cancel(); }
      };
      el.onclick = function (e) { if (e.target === el) cancel(); };
    }

    return {
      alert: function (message, title, onOk) {
        open({ title: title || '提示', message: message, okText: '知道了', cancelText: '', onOk: onOk });
      },
      confirm: function (message, onOk, title) {
        open({ title: title || '确认', message: message, okText: '确定', cancelText: '取消', onOk: onOk });
      },
      prompt: function (title, value, onOk, message) {
        open({ title: title, message: message || '', input: true, value: value, okText: '确定', cancelText: '取消', onOk: onOk });
      },
      /* 多选一：options = [{ label, value }]，点选后回调 onPick(value) */
      choose: function (title, options, onPick, message) {
        open({ title: title, message: message || '', options: options, okText: '', cancelText: '取消', onPick: onPick });
      }
    };
  })();

  /* ------------------------------------------------------------------
   * 轻提示 Toast：统一操作反馈（可带「撤销」等操作按钮）
   * 替代传统 alert，操作有回音但不打断
   * ------------------------------------------------------------------ */
  const Toast = (function () {
    let el = null;
    let timer = null;

    function ensure() {
      if (el) return el;
      el = document.createElement('div');
      el.className = 'toast';
      el.hidden = true;
      el.innerHTML =
        '<span class="toast-msg"></span>' +
        '<button type="button" class="toast-action" hidden></button>';
      document.body.appendChild(el);
      return el;
    }

    function hide() {
      const node = ensure();
      node.classList.remove('show');
      clearTimeout(timer);
      timer = setTimeout(function () { node.hidden = true; }, 220);
    }

    return {
      show: function (message, opts) {
        opts = opts || {};
        const node = ensure();
        const msgEl = node.querySelector('.toast-msg');
        const actEl = node.querySelector('.toast-action');
        msgEl.textContent = message;

        if (opts.action && opts.action.label) {
          actEl.hidden = false;
          actEl.textContent = opts.action.label;
          actEl.onclick = function () {
            hide();
            if (opts.action.onClick) opts.action.onClick();
          };
        } else {
          actEl.hidden = true;
          actEl.onclick = null;
        }

        clearTimeout(timer);
        node.hidden = false;
        requestAnimationFrame(function () { node.classList.add('show'); });
        timer = setTimeout(hide, opts.duration || (opts.action ? 4000 : 1800));
      },
      hide: hide
    };
  })();

  /* ------------------------------------------------------------------
   * 删除 + 撤销：删除后 4 秒内可一键恢复
   *   opts.get/set 读写该板块数据；opts.apply 执行删除；opts.render 重绘
   *   撤销时用删除前的整体快照回滚，简单可靠
   * ------------------------------------------------------------------ */
  function deleteWithUndo(opts) {
    const snapshot = JSON.parse(JSON.stringify(opts.get()));
    opts.apply();
    opts.render();
    Toast.show(opts.message || '已删除', {
      action: {
        label: '撤销',
        onClick: function () {
          opts.set(snapshot);
          opts.render();
          if (opts.onRestore) opts.onRestore();
        }
      },
      duration: 4000
    });
  }

  /* ------------------------------------------------------------------
   * 主题：浅色 / 深色 / 跟随系统（由 html[data-theme] 驱动）
   * ------------------------------------------------------------------ */
  const Theme = (function () {
    const KEY = 'workbench.theme';
    let mql = null;
    let changeCb = null;

    try { mql = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mql = null; }

    function pref() {
      try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
    }
    function resolved() {
      const p = pref();
      if (p === 'auto') return (mql && mql.matches) ? 'dark' : 'light';
      return p;
    }
    function apply() {
      const mode = resolved();
      document.documentElement.setAttribute('data-theme', mode);
      return mode;
    }
    function set(p) {
      try { localStorage.setItem(KEY, p); } catch (e) {}
      apply();
      if (changeCb) changeCb();
    }
    if (mql && mql.addEventListener) {
      mql.addEventListener('change', function () {
        if (pref() === 'auto') { apply(); if (changeCb) changeCb(); }
      });
    }

    return {
      pref: pref,
      resolved: resolved,
      apply: apply,
      set: set,
      onChange: function (fn) { changeCb = fn; }
    };
  })();

  /* 板块背景色随主题切换 */
  function applyModuleColors() {
    const dark = Theme.resolved() === 'dark';
    MODULES.forEach(function (m) {
      const section = document.getElementById('section-' + m.id);
      if (section) section.style.background = dark ? (m.darkColor || m.color) : m.color;
    });
  }

  /* ------------------------------------------------------------------
   * 板块渲染器：有真实功能的板块在此注册
   * ------------------------------------------------------------------ */
  const RENDERERS = {};

  function placeholderHTML(m) {
    return '<div class="section-head">' +
      '<span class="section-icon">' + ICON[m.icon] + '</span>' +
      '<div>' +
        '<h2 class="section-title">' + m.name + '</h2>' +
        '<p class="section-desc">' + m.desc + '</p>' +
      '</div>' +
    '</div>' +
    '<div class="placeholder-box">' +
      '<span class="placeholder-text">板块功能开发中</span>' +
      '<span class="placeholder-sub">该模块将在后续版本中完善</span>' +
    '</div>';
  }

  /* ------------------------------------------------------------------
   * 打卡&待办 板块
   * 存储 key：workbench.todo
   * { daily: [{date, items:[{id,text,done}]}], tasks:[{id,text,type,done,createdAt}] }
   * ------------------------------------------------------------------ */
  function getTodo() { return Storage.get('todo', { daily: [], tasks: [] }); }
  function setTodo(data) { Storage.set('todo', data); }

  const ICON_TRASH = icon('<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>');
  const ICON_CHEV_L = icon('<polyline points="15 18 9 12 15 6"></polyline>');
  const ICON_CHEV_R = icon('<polyline points="9 18 15 12 9 6"></polyline>');

  function renderCheckinSection(section) {
    const today = todayKey();
    let currentDate = today;
    const collapsed = { work: false, long: false };
    let editingTaskId = null;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.checkSquare + '</span>' +
        '<div>' +
          '<h2 class="section-title">打卡&待办</h2>' +
          '<p class="section-desc">每日打卡与待办清单，记录坚持与完成。</p>' +
        '</div>' +
      '</div>' +
      '<div class="sub-card" id="daily-box"></div>' +
      '<div class="sub-card" id="todo-box"></div>';

    const dailyBox = section.querySelector('#daily-box');
    const todoBox = section.querySelector('#todo-box');

    /* ---- 数据操作 ---- */
    function addDaily(text) {
      const data = getTodo();
      let rec = data.daily.find(function (r) { return r.date === currentDate; });
      if (!rec) { rec = { date: currentDate, items: [] }; data.daily.push(rec); }
      rec.items.push({ id: Storage.genId(), text: text, done: false });
      setTodo(data);
    }
    function toggleDaily(id) {
      const data = getTodo();
      const rec = data.daily.find(function (r) { return r.date === currentDate; });
      if (!rec) return;
      const it = rec.items.find(function (i) { return i.id === id; });
      if (it) { it.done = !it.done; setTodo(data); }
    }
    function removeDaily(id) {
      const data = getTodo();
      const rec = data.daily.find(function (r) { return r.date === currentDate; });
      if (!rec) return;
      rec.items = rec.items.filter(function (i) { return i.id !== id; });
      setTodo(data);
    }

    function addTask(type, text) {
      const data = getTodo();
      data.tasks.push({ id: Storage.genId(), text: text, type: type, done: false, createdAt: Date.now() });
      setTodo(data);
    }

    /* 新增后 renderDaily/renderTodo 会替换整个容器，销毁正在聚焦的输入框
       （手机上输入框被移除 → 虚拟键盘立刻收起，观感就是"回车没反应"）。
       所以渲染完必须把焦点还给同一类输入框，并给一条 Toast 反馈。 */
    function addDailyFromInput() {
      const input = section.querySelector('.daily-input');
      if (!input) return;
      const v = input.value.trim();
      if (!v) return;
      addDaily(v);
      renderDaily();
      const ni = dailyBox.querySelector('.daily-input');
      if (ni) { ni.value = ''; try { ni.focus(); } catch (err) {} }
      Toast.show('已添加「' + v + '」');
    }

    function addTaskFromInput(input) {
      if (!input) return;
      const v = input.value.trim();
      if (!v) return;
      const type = input.dataset.type;
      addTask(type, v);
      renderTodo();
      const ni = section.querySelector('.group-input[data-type="' + type + '"]');
      if (ni) { ni.value = ''; try { ni.focus(); } catch (err) {} }
      Toast.show('已添加「' + v + '」');
    }
    function toggleTask(id) {
      const data = getTodo();
      const t = data.tasks.find(function (x) { return x.id === id; });
      if (t) { t.done = !t.done; setTodo(data); }
    }
    function removeTask(id) {
      const data = getTodo();
      data.tasks = data.tasks.filter(function (x) { return x.id !== id; });
      setTodo(data);
    }
    function updateTask(id, text) {
      const data = getTodo();
      const t = data.tasks.find(function (x) { return x.id === id; });
      if (t) { t.text = text; setTodo(data); }
    }

    /* ---- 渲染：每日打卡 ---- */
    /* 打卡足迹：连续天数 + 有打卡的日期集合（当天事项全部完成即算打卡） */
    function streakInfo() {
      const data = getTodo();
      const doneDates = {};
      (data.daily || []).forEach(function (r) {
        const its = r.items || [];
        if (its.length && its.every(function (it) { return it.done; })) doneDates[r.date] = true;
      });
      let streak = 0;
      const cursor = new Date();
      if (!doneDates[dateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
      while (doneDates[dateKey(cursor)]) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
      return { doneDates: doneDates, streak: streak };
    }

    /* 近 12 周打卡热力图（内联 SVG） */
    function heatmapSVG(doneDates) {
      const weeks = 12, cell = 13, gap = 3;
      const W = weeks * (cell + gap) - gap;
      const H = 7 * (cell + gap) - gap;
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay() - (weeks - 1) * 7);
      let cells = '';
      for (let w = 0; w < weeks; w++) {
        for (let r = 0; r < 7; r++) {
          const d = new Date(start);
          d.setDate(start.getDate() + w * 7 + r);
          if (d > now) continue;
          const on = !!doneDates[dateKey(d)];
          cells += '<rect x="' + (w * (cell + gap)) + '" y="' + (r * (cell + gap)) + '" width="' + cell + '" height="' + cell + '" rx="3" style="fill:' + (on ? 'var(--accent)' : 'rgba(128,128,128,0.14)') + '"></rect>';
        }
      }
      return '<svg class="heatmap-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' + cells + '</svg>';
    }

    function renderDaily() {
      const data = getTodo();
      const rec = data.daily.find(function (r) { return r.date === currentDate; });
      const items = rec ? rec.items : [];
      const isToday = currentDate === today;
      const st = streakInfo();

      let listHtml = '';
      items.forEach(function (it) {
        listHtml +=
          '<li class="daily-item' + (it.done ? ' is-done' : '') + '" data-id="' + it.id + '">' +
            '<input type="checkbox" class="cb" data-daily="' + it.id + '"' + (it.done ? ' checked' : '') + '>' +
            '<span class="daily-text">' + esc(it.text) + '</span>' +
            '<button class="del" data-del-daily="' + it.id + '" title="删除">' + ICON_TRASH + '</button>' +
          '</li>';
      });

      dailyBox.innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">每日打卡</h3>' +
            '<span class="sub-hint">备忘录 · 左滑或点右侧删除</span>' +
          '</div>' +
          '<div class="date-nav">' +
            '<button class="icon-btn" data-act="prev" title="前一天">' + ICON_CHEV_L + '</button>' +
            '<span class="date-label">' + (isToday ? '<em class="today-tag">今天</em> ' : '') + dateLabelCN(currentDate) + '</span>' +
            '<button class="icon-btn" data-act="next" title="后一天">' + ICON_CHEV_R + '</button>' +
            (isToday ? '' : '<button class="link-btn" data-act="today">回到今天</button>') +
          '</div>' +
        '</div>' +
        '<div class="input-row input-row-add">' +
          '<input class="input daily-input" type="text" placeholder="添加今日事项" maxlength="100" enterkeyhint="done" autocomplete="off">' +
          '<button type="button" class="btn btn-primary" data-add-daily>添加</button>' +
        '</div>' +
        '<ul class="daily-list">' + listHtml + '</ul>' +
        (items.length === 0 ? emptyBox('这一天还没有记录，添加一条吧') : '') +
        '<div class="streak-card">' +
          '<div class="streak-head">' +
            '<span class="streak-num">' + st.streak + '</span>' +
            '<span class="streak-label">天连续打卡</span>' +
          '</div>' +
          heatmapSVG(st.doneDates) +
          '<div class="streak-hint">近 12 周足迹 · 当天事项全部完成即算打卡</div>' +
        '</div>';

      bindSwipe();
    }

    /* ---- 渲染：待办清单 ---- */
    function renderTodo() {
      const data = getTodo();
      const groups = [
        { type: 'work', label: '工作任务' },
        { type: 'long', label: '长期计划' }
      ];

      let groupsHtml = '';
      groups.forEach(function (g) {
        const tasks = data.tasks.filter(function (t) { return t.type === g.type; });
        const isCollapsed = collapsed[g.type];
        groupsHtml +=
          '<div class="group' + (isCollapsed ? ' collapsed' : '') + '">' +
            '<button class="group-head" data-grouptoggle="' + g.type + '">' +
              '<span class="caret-wrap">' + ICON_CHEV_R + '</span>' +
              '<span class="group-name">' + g.label + '</span>' +
              '<span class="group-count">' + tasks.length + '</span>' +
            '</button>' +
            '<div class="group-body">' +
              '<div class="input-row input-row-add">' +
                '<input class="input group-input" type="text" data-type="' + g.type + '" placeholder="添加' + g.label + '" maxlength="100" enterkeyhint="done" autocomplete="off">' +
                '<button type="button" class="btn btn-primary" data-add-group="' + g.type + '">添加</button>' +
              '</div>' +
              '<ul class="task-list">' +
                tasks.map(function (t) { return taskHtml(t); }).join('') +
              '</ul>' +
              (tasks.length === 0 ? emptyBox('暂无任务', true) : '') +
            '</div>' +
          '</div>';
      });

      todoBox.innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">待办清单</h3>' +
            '<span class="sub-hint">点击任务文字可编辑 · 展示创建时间</span>' +
          '</div>' +
        '</div>' +
        groupsHtml;
    }

    function taskHtml(t) {
      return '<li class="task-item' + (t.done ? ' is-done' : '') + '" data-id="' + t.id + '">' +
        '<input type="checkbox" class="cb" data-task="' + t.id + '"' + (t.done ? ' checked' : '') + '>' +
        '<div class="task-main">' +
          '<span class="task-text" data-edit="' + t.id + '" title="点击编辑">' + esc(t.text) + '</span>' +
          '<span class="task-time">创建于 ' + timeLabelCN(t.createdAt) + '</span>' +
        '</div>' +
        '<button class="del" data-del-task="' + t.id + '" title="删除">' + ICON_TRASH + '</button>' +
      '</li>';
    }

    /* ---- 左滑删除（移动端触摸） ---- */
    function bindSwipe() {
      dailyBox.querySelectorAll('.daily-item').forEach(function (li) {
        let sx = null, sy = null;
        li.addEventListener('touchstart', function (e) {
          sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        }, { passive: true });
        li.addEventListener('touchend', function (e) {
          if (sx === null) return;
          const dx = e.changedTouches[0].clientX - sx;
          const dy = e.changedTouches[0].clientY - sy;
          sx = null;
          if (dx < -50 && Math.abs(dy) < 40) {
            removeDaily(li.dataset.id);
            renderDaily();
          }
        });
      });
    }

    /* ---- 编辑任务内容 ---- */
    function startEdit(id) {
      if (editingTaskId === id) return;
      editingTaskId = id;
      const span = todoBox.querySelector('[data-edit="' + id + '"]');
      if (!span) return;
      const data = getTodo();
      const t = data.tasks.find(function (x) { return x.id === id; });
      if (!t) return;

      const input = document.createElement('input');
      input.className = 'input edit-input';
      input.type = 'text';
      input.value = t.text;
      input.maxLength = 100;
      span.replaceWith(input);
      input.focus();
      input.setSelectionRange(t.text.length, t.text.length);

      let finished = false;
      function finish(save) {
        if (finished) return;
        finished = true;
        if (save) {
          const v = input.value.trim();
          if (v) updateTask(id, v);
        }
        editingTaskId = null;
        renderTodo();
      }
      input.addEventListener('keydown', function (e) {
        if (e.isComposing || e.keyCode === 229) return;  // 输入法组字中的回车只是选词
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { finish(false); }
      });
      input.addEventListener('blur', function () { finish(true); });
    }

    /* ---- 事件委托 ---- */
    section.addEventListener('click', function (e) {
      if (e.target.closest('[data-add-daily]')) { addDailyFromInput(); return; }
      const addGroup = e.target.closest('[data-add-group]');
      if (addGroup) {
        addTaskFromInput(section.querySelector('.group-input[data-type="' + addGroup.dataset.addGroup + '"]'));
        return;
      }
      const actEl = e.target.closest('[data-act]');
      if (actEl) {
        const act = actEl.dataset.act;
        if (act === 'prev') { currentDate = shiftDate(currentDate, -1); renderDaily(); }
        else if (act === 'next') { currentDate = shiftDate(currentDate, 1); renderDaily(); }
        else if (act === 'today') { currentDate = today; renderDaily(); }
        return;
      }
      const delD = e.target.closest('[data-del-daily]');
      if (delD) {
        const id = delD.dataset.delDaily;
        deleteWithUndo({ get: getTodo, set: setTodo, apply: function () { removeDaily(id); }, render: renderDaily, message: '已删除该打卡记录' });
        return;
      }
      const delT = e.target.closest('[data-del-task]');
      if (delT) {
        const id = delT.dataset.delTask;
        deleteWithUndo({ get: getTodo, set: setTodo, apply: function () { removeTask(id); }, render: renderTodo, message: '已删除该待办' });
        return;
      }
      const tg = e.target.closest('[data-grouptoggle]');
      if (tg) { collapsed[tg.dataset.grouptoggle] = !collapsed[tg.dataset.grouptoggle]; renderTodo(); return; }
      const ed = e.target.closest('[data-edit]');
      if (ed) { startEdit(ed.dataset.edit); return; }
    });

    section.addEventListener('change', function (e) {
      if (e.target.matches('[data-daily]')) { toggleDaily(e.target.dataset.daily); renderDaily(); }
      else if (e.target.matches('[data-task]')) { toggleTask(e.target.dataset.task); renderTodo(); }
    });

    section.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;  // 输入法组字中的回车只是选词
      if (e.target.matches('.daily-input')) {
        e.preventDefault();
        addDailyFromInput();
      } else if (e.target.matches('.group-input')) {
        e.preventDefault();
        addTaskFromInput(e.target);
      }
    });

    renderDaily();
    renderTodo();
  }

  RENDERERS.checkin = renderCheckinSection;

  /* ------------------------------------------------------------------
   * 记账管理 板块
   * 存储 key：workbench.finance
   * { records:[{id,amount,type,category,note,date}], budget:0 }
   * ------------------------------------------------------------------ */
  function getFinance() { return Storage.get('finance', { records: [], budget: 0 }); }
  function setFinance(d) { Storage.set('finance', d); }

  const PIE_COLORS = ['#7BAE8C', '#E88B8B', '#A2DCCF', '#D6F0EF', '#F6DDCE', '#B8E7D2', '#CFEDEF', '#C6D7B2', '#D3E8B7', '#99B6B4'];
  const ICON_EDIT = icon('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>');

  function fmtMoney(n) {
    n = Number(n) || 0;
    const s = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + '¥' + s.replace(/\.00$/, '');
  }

  function monthOf(key) { return key.slice(0, 7); }

  function dateShortCN(key) {
    const p = key.split('-').map(Number);
    return p[1] + '月' + p[2] + '日';
  }

  function renderAccountingSection(section) {
    const today = todayKey();
    const curMonth = monthOf(today);
    let formType = 'expense';
    let editingId = null;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.creditCard + '</span>' +
        '<div>' +
          '<h2 class="section-title">记账管理</h2>' +
          '<p class="section-desc">记录每一笔收入与支出，轻松掌握日常财务。</p>' +
        '</div>' +
      '</div>' +
      '<div class="sub-card" id="flow-box"></div>' +
      '<div class="sub-card" id="overview-box"></div>';

    const flowBox = section.querySelector('#flow-box');
    const overviewBox = section.querySelector('#overview-box');

    /* ---- 数据操作 ---- */
    function saveRecord(fields) {
      const data = getFinance();
      if (editingId) {
        const r = data.records.find(function (x) { return x.id === editingId; });
        if (r) {
          r.amount = fields.amount; r.type = fields.type; r.category = fields.category;
          r.note = fields.note; r.date = fields.date;
        }
        editingId = null;
      } else {
        data.records.push({
          id: Storage.genId(), amount: fields.amount, type: fields.type,
          category: fields.category, note: fields.note, date: fields.date
        });
      }
      setFinance(data);
    }
    function removeRecord(id) {
      const data = getFinance();
      data.records = data.records.filter(function (x) { return x.id !== id; });
      setFinance(data);
    }
    function removeCategory(cat) {
      const data = getFinance();
      data.records = data.records.filter(function (x) { return x.category !== cat; });
      setFinance(data);
    }
    function setBudget(v) {
      const data = getFinance();
      data.budget = v;
      setFinance(data);
    }

    /* ---- 分类统计（去重，按使用次数降序） ---- */
    function categoryStats() {
      const data = getFinance();
      const map = {};
      data.records.forEach(function (r) {
        if (!r.category) return;
        map[r.category] = (map[r.category] || 0) + 1;
      });
      return Object.keys(map).map(function (k) { return { name: k, count: map[k] }; })
        .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    }

    /* ---- 当月统计 ---- */
    function monthStats() {
      const data = getFinance();
      let income = 0, expense = 0;
      const byCat = {};
      data.records.forEach(function (r) {
        if (monthOf(r.date) !== curMonth) return;
        const amt = Number(r.amount) || 0;
        if (r.type === 'income') { income += amt; }
        else {
          expense += amt;
          if (r.category) byCat[r.category] = (byCat[r.category] || 0) + amt;
        }
      });
      return { income: income, expense: expense, balance: income - expense, byCat: byCat };
    }

    /* ---- 渲染：日常流水 ---- */
    function renderFlow() {
      const data = getFinance();
      const cats = categoryStats();
      const recs = data.records.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      });

      let listHtml = '';
      recs.forEach(function (r) {
        const sign = r.type === 'income' ? '+' : '-';
        const amount = sign + fmtMoney(r.amount);
        listHtml +=
          '<li class="rec-item">' +
            '<span class="rec-sign ' + r.type + '">' + sign + '</span>' +
            '<div class="rec-main">' +
              '<span class="rec-cat">' + esc(r.category || '未分类') + (r.note ? '<span class="rec-note">' + esc(r.note) + '</span>' : '') + '</span>' +
              '<span class="rec-date">' + dateShortCN(r.date) + '</span>' +
            '</div>' +
            '<span class="rec-amount ' + r.type + '">' + amount + '</span>' +
            '<button class="act" data-edit-rec="' + r.id + '" title="编辑">' + ICON_EDIT + '</button>' +
            '<button class="del" data-del-rec="' + r.id + '" title="删除">' + ICON_TRASH + '</button>' +
          '</li>';
      });

      const datalist = cats.map(function (c) {
        return '<option value="' + esc(c.name) + '"></option>';
      }).join('');

      let editRec = null;
      if (editingId) {
        editRec = data.records.find(function (x) { return x.id === editingId; });
      }
      const fAmount = editRec ? editRec.amount : '';
      const fCat = editRec ? editRec.category : '';
      const fNote = editRec ? editRec.note : '';
      const fDate = editRec ? editRec.date : today;
      const fType = editRec ? editRec.type : formType;
      if (editRec) formType = editRec.type;

      flowBox.innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">日常流水</h3>' +
            '<span class="sub-hint">' + (editingId ? '正在编辑一条记录' : '收入绿色 + ，支出红色 -') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="flow-form">' +
          '<div class="type-toggle">' +
            '<button type="button" class="type-btn expense' + (fType === 'expense' ? ' active' : '') + '" data-type="expense">支出 -</button>' +
            '<button type="button" class="type-btn income' + (fType === 'income' ? ' active' : '') + '" data-type="income">收入 +</button>' +
          '</div>' +
          '<input class="input" id="f-amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="金额" value="' + fAmount + '">' +
          '<input class="input" id="f-category" type="text" list="cat-list" placeholder="分类（如 餐饮 / 工资）" value="' + esc(fCat) + '">' +
          '<datalist id="cat-list">' + datalist + '</datalist>' +
          '<input class="input" id="f-note" type="text" placeholder="备注（可选）" maxlength="50" value="' + esc(fNote) + '">' +
          '<input class="input" id="f-date" type="date" value="' + fDate + '">' +
          '<button type="button" class="btn btn-primary" id="f-save">' + (editingId ? '更新' : '保存') + '</button>' +
          (editingId ? '<button type="button" class="btn btn-secondary" id="f-cancel">取消</button>' : '') +
        '</div>' +
        '<ul class="rec-list">' + listHtml + '</ul>' +
        (recs.length === 0 ? emptyBox('还没有流水记录，从上方记一笔吧') : '');
    }

    /* ---- 渲染：月度总览 ---- */
    /* 近 6 个月收支数据 */
    function monthsTrend() {
      const data = getFinance();
      const now = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key: d.getFullYear() + '-' + pad2(d.getMonth() + 1),
          label: (d.getMonth() + 1) + '月',
          income: 0, expense: 0
        });
      }
      const map = {};
      months.forEach(function (m) { map[m.key] = m; });
      (data.records || []).forEach(function (r) {
        const m = map[(r.date || '').slice(0, 7)];
        if (!m) return;
        const amt = Number(r.amount) || 0;
        if (r.type === 'income') m.income += amt; else m.expense += amt;
      });
      return months;
    }

    /* 近 6 个月收支柱状图（内联 SVG，无外部库） */
    function trendSVG(months) {
      const W = 320, H = 148, padT = 10, padB = 22, padL = 6, padR = 6;
      const chartH = H - padT - padB;
      let max = 1;
      months.forEach(function (m) { max = Math.max(max, m.income, m.expense); });
      const groupW = (W - padL - padR) / months.length;
      const bw = Math.min(13, groupW * 0.3);
      const gap = 4;
      let bars = '', labels = '', grid = '';
      [0.25, 0.5, 0.75, 1].forEach(function (f) {
        const y = padT + chartH * (1 - f);
        grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" style="stroke:rgba(128,128,128,0.16);stroke-width:1"></line>';
      });
      months.forEach(function (m, i) {
        const cx = padL + i * groupW + groupW / 2;
        const hi = chartH * (m.income / max);
        const he = chartH * (m.expense / max);
        bars += '<rect x="' + (cx - bw - gap / 2) + '" y="' + (padT + chartH - hi) + '" width="' + bw + '" height="' + Math.max(hi, m.income > 0 ? 2 : 0) + '" rx="3" style="fill:var(--income)"></rect>';
        bars += '<rect x="' + (cx + gap / 2) + '" y="' + (padT + chartH - he) + '" width="' + bw + '" height="' + Math.max(he, m.expense > 0 ? 2 : 0) + '" rx="3" style="fill:var(--expense)"></rect>';
        labels += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" style="fill:var(--text-secondary)">' + m.label + '</text>';
      });
      return '<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
        grid + bars + labels + '</svg>';
    }

    function renderOverview() {
      const data = getFinance();
      const s = monthStats();
      const trend = monthsTrend();
      const prevM = trend.length > 1 ? trend[trend.length - 2] : null;
      let deltaText;
      if (prevM && prevM.expense > 0) {
        const pct = Math.round((s.expense - prevM.expense) / prevM.expense * 100);
        deltaText = '支出较上月 ' + (pct >= 0 ? '+' : '') + pct + '%';
      } else if (s.expense > 0) {
        deltaText = '上月暂无支出';
      } else {
        deltaText = '本月暂无支出';
      }
      const cats = categoryStats();
      const balanceCls = s.balance >= 0 ? 'pos' : 'neg';
      const over = data.budget > 0 && s.expense > data.budget;

      const pieData = Object.keys(s.byCat).map(function (name, i) {
        return { name: name, value: s.byCat[name], color: PIE_COLORS[i % PIE_COLORS.length] };
      }).sort(function (a, b) { return b.value - a.value; });
      const totalExp = pieData.reduce(function (sum, d) { return sum + d.value; }, 0);

      let pieHtml = '';
      if (pieData.length === 0) {
        pieHtml = '<div class="pie-empty">本月暂无支出</div>';
      } else {
        let legend = '';
        pieData.forEach(function (d) {
          const pct = totalExp > 0 ? Math.round(d.value / totalExp * 100) : 0;
          legend +=
            '<div class="legend-item">' +
              '<span class="legend-dot" style="background:' + d.color + '"></span>' +
              '<span class="legend-name">' + esc(d.name) + '</span>' +
              '<span class="legend-val">' + fmtMoney(d.value) + ' · ' + pct + '%</span>' +
            '</div>';
        });
        pieHtml =
          '<canvas id="pie-canvas" width="180" height="180"></canvas>' +
          '<div class="legend">' + legend + '</div>';
      }

      let catChips = '';
      if (cats.length === 0) {
        catChips = emptyBox('暂无分类标签，录入流水时输入分类即自动生成', true);
      } else {
        cats.forEach(function (c) {
          catChips += '<span class="cat-chip">' + esc(c.name) + '<em class="cat-count">' + c.count + '</em>' +
            '<button type="button" data-del-cat="' + esc(c.name) + '" title="删除该分类及其记录">×</button></span>';
        });
      }

      overviewBox.innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">月度总览</h3>' +
            '<span class="sub-hint">' + curMonth.replace('-', '年') + '月 · 自动统计</span>' +
          '</div>' +
        '</div>' +
        '<div class="stats-row">' +
          '<div class="stat income"><div class="stat-label">总收入</div><div class="stat-value">' + fmtMoney(s.income) + '</div></div>' +
          '<div class="stat expense"><div class="stat-label">总支出</div><div class="stat-value">' + fmtMoney(s.expense) + '</div></div>' +
          '<div class="stat balance"><div class="stat-label">结余</div><div class="stat-value ' + balanceCls + '">' + fmtMoney(s.balance) + '</div></div>' +
        '</div>' +
        '<div class="overview-main">' +
          '<div class="pie-wrap">' + pieHtml + '</div>' +
          '<div class="overview-side">' +
            '<div class="budget-card">' +
              '<div class="budget-title">月度预算上限</div>' +
              '<div class="budget-row">' +
                '<input class="input" id="budget-input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="预算金额" value="' + (data.budget > 0 ? data.budget : '') + '">' +
                '<button type="button" class="btn btn-primary" id="budget-save">保存</button>' +
              '</div>' +
              '<div class="budget-info">已支出 ' + fmtMoney(s.expense) + (data.budget > 0 ? ' / 预算 ' + fmtMoney(data.budget) : ' · 未设置预算') + '</div>' +
              (over ? '<div class="budget-over">已超支 ' + fmtMoney(s.expense - data.budget) + '</div>' : '') +
            '</div>' +
            '<div class="cat-card">' +
              '<div class="budget-title">分类标签</div>' +
              '<div class="sub-hint">点 × 删除该分类及其所有记录</div>' +
              '<div class="cat-list">' + catChips + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="trend-card">' +
          '<div class="trend-head">' +
            '<span class="trend-title">近 6 个月收支趋势</span>' +
            '<span class="trend-delta">' + deltaText + '</span>' +
          '</div>' +
          trendSVG(trend) +
          '<div class="trend-legend">' +
            '<span><i class="tl-dot income"></i>收入</span>' +
            '<span><i class="tl-dot expense"></i>支出</span>' +
          '</div>' +
        '</div>';

      drawPie(pieData);
    }

    /* ---- Canvas 饼图（无外部库） ---- */
    function drawPie(pieData) {
      const canvas = overviewBox.querySelector('#pie-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
      ctx.clearRect(0, 0, w, h);
      const total = pieData.reduce(function (sum, d) { return sum + d.value; }, 0);
      if (total <= 0) return;
      let start = -Math.PI / 2;
      pieData.forEach(function (d) {
        const angle = d.value / total * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        start += angle;
      });
    }

    /* ---- 表单读写 ---- */
    function readForm() {
      const amount = parseFloat(flowBox.querySelector('#f-amount').value);
      const category = flowBox.querySelector('#f-category').value.trim();
      const note = flowBox.querySelector('#f-note').value.trim();
      const date = flowBox.querySelector('#f-date').value || today;
      return { amount: amount, category: category, note: note, date: date };
    }

    function submitForm() {
      const f = readForm();
      if (!f.amount || f.amount <= 0) { UI.alert('请输入有效金额'); return; }
      if (!f.category) { UI.alert('请填写分类标签'); return; }
      f.type = formType;
      const wasEdit = !!editingId;
      saveRecord(f);
      if (wasEdit) formType = 'expense';
      renderFlow();
      renderOverview();
    }

    function cancelEdit() {
      editingId = null;
      formType = 'expense';
      renderFlow();
    }

    function saveBudget() {
      const inp = overviewBox.querySelector('#budget-input');
      const v = parseFloat(inp.value);
      setBudget(v > 0 ? v : 0);
      renderOverview();
    }

    /* ---- 事件委托 ---- */
    section.addEventListener('click', function (e) {
      const typeBtn = e.target.closest('.type-btn');
      if (typeBtn) {
        formType = typeBtn.dataset.type;
        flowBox.querySelectorAll('.type-btn').forEach(function (b) {
          b.classList.toggle('active', b.dataset.type === formType);
        });
        return;
      }
      if (e.target.closest('#f-save')) { submitForm(); return; }
      if (e.target.closest('#f-cancel')) { cancelEdit(); return; }
      if (e.target.closest('#budget-save')) { saveBudget(); return; }

      const editEl = e.target.closest('[data-edit-rec]');
      if (editEl) { editingId = editEl.dataset.editRec; renderFlow(); return; }

      const delEl = e.target.closest('[data-del-rec]');
      if (delEl) {
        const rid = delEl.dataset.delRec;
        deleteWithUndo({
          get: getFinance, set: setFinance,
          apply: function () { removeRecord(rid); if (editingId === rid) editingId = null; },
          render: function () { renderFlow(); renderOverview(); },
          message: '已删除该记录'
        });
        return;
      }

      const delCat = e.target.closest('[data-del-cat]');
      if (delCat) {
        const cname = delCat.dataset.delCat;
        deleteWithUndo({
          get: getFinance, set: setFinance,
          apply: function () { removeCategory(cname); },
          render: function () { renderFlow(); renderOverview(); },
          message: '已删除该分类及其记录'
        });
        return;
      }
    });

    section.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;  // 输入法组字中的回车只是选词
      if (e.target.id === 'budget-input') { e.preventDefault(); saveBudget(); }
      else if (e.target.closest('.flow-form') && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        submitForm();
      }
    });

    renderFlow();
    renderOverview();
  }

  RENDERERS.accounting = renderAccountingSection;

  /* ------------------------------------------------------------------
   * 好好吃饭 板块
   * 存储 key：workbench.food
   * { dishes:[{id,name,disabled}], records:[{id,meal,name,amount,calories,date}], target:1500 }
   * ------------------------------------------------------------------ */
  const PRESET_DISHES = ['火锅', '麻辣烫', '螺蛳粉', '自选快餐', '酸菜鱼', '烤肉饭', '饺子', '面条', '披萨', '寿司', '炸鸡', '窑鸡', '麻辣香锅', '煲仔饭', '轻食沙拉'];
  const MEALS = [
    { key: 'breakfast', label: '早餐' },
    { key: 'lunch', label: '午餐' },
    { key: 'dinner', label: '晚餐' },
    { key: 'snack', label: '加餐' }
  ];

  function getFood() {
    let data = Storage.get('food', null);
    if (!data) {
      data = {
        dishes: PRESET_DISHES.map(function (n) { return { id: Storage.genId(), name: n, disabled: false }; }),
        records: [],
        target: 1500
      };
      Storage.set('food', data);
    } else {
      if (!Array.isArray(data.dishes)) data.dishes = [];
      if (!Array.isArray(data.records)) data.records = [];
      if (!data.target) data.target = 1500;
    }
    return data;
  }
  function setFood(d) { Storage.set('food', d); }

  function defaultMeal() {
    const h = new Date().getHours();
    if (h < 10) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 17) return 'snack';
    return 'dinner';
  }

  function renderEatwellSection(section) {
    const today = todayKey();
    let mealType = defaultMeal();
    let calMode = 'total';
    let editingRecId = null;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.bowl + '</span>' +
        '<div>' +
          '<h2 class="section-title">好好吃饭</h2>' +
          '<p class="section-desc">记录每日三餐与饮食心情，好好吃饭好好生活。</p>' +
        '</div>' +
      '</div>' +
      '<div class="cal-progress" id="progress-box"></div>' +
      '<div class="sub-card" id="rank-box"></div>' +
      '<div class="sub-card" id="dishes-box"></div>' +
      '<div class="sub-card" id="records-box"></div>';

    const progressBox = section.querySelector('#progress-box');
    const rankBox = section.querySelector('#rank-box');
    const dishesBox = section.querySelector('#dishes-box');
    const recordsBox = section.querySelector('#records-box');

    /* ---- 常吃菜品排行（按记录次数统计 Top 5） ---- */
    function renderRanking() {
      const counts = {};
      (getFood().records || []).forEach(function (r) {
        const n = (r.name || '').trim();
        if (!n) return;
        counts[n] = (counts[n] || 0) + 1;
      });
      const list = Object.keys(counts).map(function (n) {
        return { name: n, count: counts[n] };
      }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
      const max = list.length ? list[0].count : 1;
      let rows = '';
      list.forEach(function (d, i) {
        const pct = Math.round(d.count / max * 100);
        rows += '<li class="rank-item">' +
          '<span class="rank-no">' + (i + 1) + '</span>' +
          '<span class="rank-name">' + esc(d.name) + '</span>' +
          '<span class="rank-bar-wrap"><i class="rank-bar" style="width:' + pct + '%"></i></span>' +
          '<span class="rank-count">' + d.count + ' 次</span>' +
        '</li>';
      });
      rankBox.innerHTML =
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">常吃排行</h3>' +
          '<span class="sub-hint">按记录次数统计 Top 5</span>' +
        '</div></div>' +
        (list.length ? '<ul class="rank-list">' + rows + '</ul>' : emptyBox('还没有饮食记录，记录几餐就能看到排行', true));
    }

    /* ---- 数据操作 ---- */
    function addDish(name) {
      const d = getFood();
      const dish = { id: Storage.genId(), name: name, disabled: false };
      d.dishes.push(dish);
      setFood(d);
      return dish;
    }

    /* 单个菜品卡的 HTML（整体渲染与「新增」共用，避免重复维护） */
    function dishCardHtml(x) {
      return '<div class="dish-card' + (x.disabled ? ' disabled' : '') + '" data-id="' + x.id + '">' +
        '<button type="button" class="dish-plan-btn" data-plan-dish="' + x.id + '" title="加入今天餐单">＋</button>' +
        '<span class="dish-name">' + esc(x.name) + '</span>' +
        '<span class="dish-flag">暂时不想吃</span>' +
      '</div>';
    }

    /* 给一张菜品卡绑定事件（含「＋ 加入餐单」小按钮） */
    function bindDishEl(card) {
      bindDishCard(card, card.dataset.id);
      const pbtn = card.querySelector('.dish-plan-btn');
      if (pbtn) {
        pbtn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          addDishToPlan(pbtn.dataset.planDish);
        });
      }
    }

    /* 从输入框新增菜品。
       要点：只把新卡片插进去，**不整体重建** ——
       renderDishes() 会替换 dishesBox.innerHTML，销毁正在聚焦的输入框，
       手机上输入框被移除会导致虚拟键盘立刻收起、光标丢失，
       用户看到的现象就是「按了回车没反应」。 */
    function addDishFromInput() {
      const input = dishesBox.querySelector('.dish-input');
      if (!input) return;
      const v = input.value.trim();
      if (!v) return;
      const dish = addDish(v);
      const grid = dishesBox.querySelector('.dish-grid');
      if (grid) {
        const eb = dishesBox.querySelector('.empty-box');
        if (eb) eb.remove();
        const tmp = document.createElement('div');
        tmp.innerHTML = dishCardHtml(dish);
        const card = tmp.firstChild;
        grid.appendChild(card);
        bindDishEl(card);
      }
      input.value = '';
      input.focus();
      Toast.show('已添加「' + dish.name + '」');
    }

    function removeDish(id) { const d = getFood(); d.dishes = d.dishes.filter(function (x) { return x.id !== id; }); setFood(d); }
    function renameDish(id, name) { const d = getFood(); const x = d.dishes.find(function (y) { return y.id === id; }); if (x) x.name = name; setFood(d); }
    function toggleDish(id) { const d = getFood(); const x = d.dishes.find(function (y) { return y.id === id; }); if (x) x.disabled = !x.disabled; setFood(d); }
    function addRecord(f) { const d = getFood(); d.records.push({ id: Storage.genId(), meal: f.meal, name: f.name, amount: f.amount, calories: f.calories, date: f.date }); setFood(d); }
    function updateRecord(id, f) { const d = getFood(); const r = d.records.find(function (x) { return x.id === id; }); if (r) { r.meal = f.meal; r.name = f.name; r.amount = f.amount; r.calories = f.calories; r.date = f.date; } setFood(d); }
    function removeRecord(id) { const d = getFood(); d.records = d.records.filter(function (x) { return x.id !== id; }); setFood(d); }
    function setTarget(v) { const d = getFood(); d.target = v; setFood(d); }

    function todayRecords() { return getFood().records.filter(function (r) { return r.date === today; }); }
    function todayCalories() { return todayRecords().reduce(function (s, r) { return s + (Number(r.calories) || 0); }, 0); }

    /* ---- 渲染：热量进度条 ---- */
    function renderProgress() {
      const d = getFood();
      const total = Math.round(todayCalories());
      const target = d.target || 1500;
      const over = total > target;
      const pct = Math.min(100, total / target * 100);
      const left = Math.max(0, target - total);
      progressBox.innerHTML =
        '<div class="progress-head">' +
          '<span class="progress-label">今日摄入</span>' +
          '<span class="progress-num' + (over ? ' over' : '') + '">' + total + ' / ' + target + ' kcal</span>' +
        '</div>' +
        '<div class="progress-bar"><div class="progress-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div>' +
        '<div class="progress-meta">' +
          '<span class="' + (over ? 'over-note' : '') + '">' + (over ? '已超出 ' + (total - target) + ' kcal' : '剩余 ' + left + ' kcal') + '</span>' +
          '<button type="button" class="set-target" data-set-target="1">目标 ' + target + ' kcal · 修改</button>' +
        '</div>';
    }

    /* ---- 渲染：菜品管理 ---- */
    function renderDishes() {
      const d = getFood();
      let cards = '';
      d.dishes.forEach(function (x) { cards += dishCardHtml(x); });
      dishesBox.innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">菜品管理</h3>' +
            '<span class="sub-hint">点按标记“暂时不想吃” · 长按或双击改名称 · 左滑删除 · ＋ 加入餐单</span>' +
          '</div>' +
        '</div>' +
        '<div class="lucky-box">' +
          '<span class="lucky-text" id="lucky-result">不知道吃什么？抽一个吧</span>' +
          '<button type="button" class="btn btn-primary" id="lucky-btn">抽一个</button>' +
        '</div>' +
        '<div class="input-row input-row-add">' +
          '<input class="input dish-input" type="text" placeholder="输入菜品名" maxlength="20" enterkeyhint="done" autocomplete="off">' +
          '<button type="button" class="btn btn-primary" data-add-dish>添加</button>' +
        '</div>' +
        '<div class="dish-grid">' + cards + '</div>' +
        (d.dishes.length === 0 ? emptyBox('还没有菜品，添加一个吧') : '');

      dishesBox.querySelectorAll('.dish-card').forEach(function (card) { bindDishEl(card); });
    }

    /* ---- 跨板块联动：菜品 → 饮食规划今天餐单 ---- */
    function addDishToPlan(id) {
      const dish = getFood().dishes.find(function (x) { return x.id === id; });
      if (!dish) return;
      const dayKey = todayDayKey();
      const day = MEAL_DAYS.find(function (x) { return x.key === dayKey; }) || { label: '今天' };
      UI.choose('把「' + dish.name + '」加入' + day.label + '哪一餐？',
        MEAL_TIMES.map(function (t) { return { label: t.label + '餐', value: t.key }; }),
        function (timeKey) {
          const m = getMealPlan();
          m.week[dayKey][timeKey].push(dish.name);
          setMealPlan(m);
          const t = MEAL_TIMES.find(function (x) { return x.key === timeKey; }) || { label: '' };
          Toast.show('已加入' + day.label + '「' + t.label + '餐」餐单', {
            action: {
              label: '撤销',
              onClick: function () {
                const m2 = getMealPlan();
                const arr = m2.week[dayKey][timeKey];
                const i = arr.lastIndexOf(dish.name);
                if (i >= 0) { arr.splice(i, 1); setMealPlan(m2); }
              }
            },
            duration: 4000
          });
        }, '之后可在「饮食规划」中查看和调整');
    }

    /* ---- 抽签：今天吃什么 ---- */
    function drawLucky() {
      const names = getFood().dishes.filter(function (x) { return !x.disabled; }).map(function (x) { return x.name; });
      const resultEl = dishesBox.querySelector('#lucky-result');
      if (!names.length) {
        resultEl.textContent = '没有可选菜品，先恢复或添加一些吧';
        resultEl.classList.remove('picked');
        return;
      }
      const final = names[Math.floor(Math.random() * names.length)];
      let delay = 60;
      let steps = 14;
      function tick() {
        steps -= 1;
        if (steps <= 0) {
          resultEl.textContent = '就吃「' + final + '」！';
          resultEl.classList.add('picked');
          return;
        }
        resultEl.textContent = names[Math.floor(Math.random() * names.length)];
        resultEl.classList.remove('picked');
        delay += 15;
        setTimeout(tick, delay);
      }
      tick();
    }

    /* ---- 菜品卡交互：点按/长按/左滑/双击 ---- */
    function editDishName(id) {
      const d = getFood();
      const dish = d.dishes.find(function (x) { return x.id === id; });
      if (!dish) return;
      UI.prompt('修改菜品名称', dish.name, function (n) {
        if (n && n.trim() && n.trim() !== dish.name) { renameDish(id, n.trim()); renderDishes(); }
      });
    }
    function deleteDish(id) {
      deleteWithUndo({ get: getFood, set: setFood, apply: function () { removeDish(id); }, render: renderDishes, message: '已删除该菜品' });
    }
    function bindDishCard(card, id) {
      let sx = 0, sy = 0, longTimer = null, longFired = false, suppress = false;
      card.addEventListener('touchstart', function (e) {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        longFired = false; suppress = false;
        longTimer = setTimeout(function () { longFired = true; editDishName(id); }, 550);
      }, { passive: true });
      card.addEventListener('touchmove', function (e) {
        if (longTimer && (Math.abs(e.touches[0].clientX - sx) > 12 || Math.abs(e.touches[0].clientY - sy) > 12)) {
          clearTimeout(longTimer); longTimer = null;
        }
      }, { passive: true });
      card.addEventListener('touchend', function (e) {
        if (longTimer) { clearTimeout(longTimer); longTimer = null; }
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (dx < -50 && Math.abs(dy) < 40) { suppress = true; deleteDish(id); }
        else if (longFired) { suppress = true; }
      });
      card.addEventListener('click', function () {
        if (suppress) { suppress = false; return; }
        toggleDish(id);
        card.classList.toggle('disabled');
      });
      card.addEventListener('dblclick', function () { editDishName(id); });
    }

    /* ---- 渲染：热量记录 ---- */
    function renderRecords() {
      const d = getFood();
      const recs = todayRecords().slice().reverse();

      let editRec = null;
      if (editingRecId) editRec = d.records.find(function (r) { return r.id === editingRecId; });
      const fName = editRec ? editRec.name : '';
      const fAmount = editRec ? editRec.amount : '';
      const fCal = editRec ? Math.round(editRec.calories) : '';
      const fMeal = editRec ? editRec.meal : mealType;
      const fMode = editRec ? 'total' : calMode;
      if (editRec) { mealType = editRec.meal; calMode = 'total'; }

      let groupsHtml = '';
      MEALS.forEach(function (m) {
        const items = recs.filter(function (r) { return r.meal === m.key; });
        let listHtml = '';
        items.forEach(function (r) {
          listHtml += '<li class="food-item">' +
            '<div class="food-main">' +
              '<span class="food-name">' + esc(r.name) + '</span>' +
              '<span class="food-sub">' + Math.round(r.amount) + ' g</span>' +
            '</div>' +
            '<span class="food-cal">' + Math.round(r.calories) + ' kcal</span>' +
            '<button class="act" data-edit-rec="' + r.id + '" title="编辑">' + ICON_EDIT + '</button>' +
            '<button class="del" data-del-rec="' + r.id + '" title="删除">' + ICON_TRASH + '</button>' +
          '</li>';
        });
        groupsHtml += '<div class="meal-group">' +
          '<div class="meal-group-title">' + m.label + ' · ' + items.length + '</div>' +
          (items.length ? '<ul class="meal-list">' + listHtml + '</ul>' : emptyBox('暂无记录', true)) +
        '</div>';
      });

      recordsBox.innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">热量记录</h3>' +
            '<span class="sub-hint">按餐次记录当日摄入 · 支持每 100g 自动算热量</span>' +
          '</div>' +
        '</div>' +
        '<div class="record-form">' +
          '<div class="seg meal-toggle">' +
            MEALS.map(function (m) {
              return '<button type="button" class="seg-btn' + (fMeal === m.key ? ' active' : '') + '" data-meal="' + m.key + '">' + m.label + '</button>';
            }).join('') +
          '</div>' +
          '<input class="input" id="r-name" type="text" placeholder="食物名称" maxlength="30" value="' + esc(fName) + '">' +
          '<input class="input" id="r-amount" type="number" inputmode="decimal" step="1" min="1" placeholder="分量 g" value="' + fAmount + '">' +
          '<div class="seg cal-mode">' +
            '<button type="button" class="seg-btn' + (fMode === 'total' ? ' active' : '') + '" data-calmode="total">总热量</button>' +
            '<button type="button" class="seg-btn' + (fMode === 'per100' ? ' active' : '') + '" data-calmode="per100">每100g</button>' +
          '</div>' +
          '<input class="input" id="r-calories" type="number" inputmode="decimal" step="1" min="1" placeholder="热量 kcal" value="' + fCal + '"' + (fMode === 'total' ? '' : ' style="display:none"') + '>' +
          '<input class="input" id="r-per100" type="number" inputmode="decimal" step="1" min="1" placeholder="每100g热量 kcal"' + (fMode === 'per100' ? '' : ' style="display:none"') + '>' +
          '<button type="button" class="btn btn-primary" id="r-save">' + (editingRecId ? '更新' : '添加') + '</button>' +
          (editingRecId ? '<button type="button" class="btn btn-secondary" id="r-cancel">取消</button>' : '') +
        '</div>' +
        groupsHtml;
    }

    /* ---- 提交记录 ---- */
    function submitRecord() {
      const name = recordsBox.querySelector('#r-name').value.trim();
      const amount = parseFloat(recordsBox.querySelector('#r-amount').value);
      let calories;
      if (calMode === 'per100') {
        const per100 = parseFloat(recordsBox.querySelector('#r-per100').value);
        calories = Math.round(per100 * amount / 100);
      } else {
        calories = parseFloat(recordsBox.querySelector('#r-calories').value);
      }
      if (!name) { UI.alert('请填写食物名称'); return; }
      if (!amount || amount <= 0) { UI.alert('请填写有效分量 (g)'); return; }
      if (!calories || calories <= 0) { UI.alert('请填写有效热量'); return; }
      const f = { meal: mealType, name: name, amount: amount, calories: calories, date: today };
      const wasEdit = !!editingRecId;
      if (editingRecId) { updateRecord(editingRecId, f); editingRecId = null; }
      else { addRecord(f); }
      if (wasEdit) mealType = defaultMeal();
      renderRecords();
      renderProgress();
      renderRanking();
    }

    function cancelEdit() { editingRecId = null; renderRecords(); }

    /* ---- 事件委托 ---- */
    section.addEventListener('click', function (e) {
      const mealBtn = e.target.closest('[data-meal]');
      if (mealBtn) {
        mealType = mealBtn.dataset.meal;
        recordsBox.querySelectorAll('[data-meal]').forEach(function (b) { b.classList.toggle('active', b.dataset.meal === mealType); });
        return;
      }
      const modeBtn = e.target.closest('[data-calmode]');
      if (modeBtn) {
        calMode = modeBtn.dataset.calmode;
        recordsBox.querySelectorAll('[data-calmode]').forEach(function (b) { b.classList.toggle('active', b.dataset.calmode === calMode); });
        recordsBox.querySelector('#r-calories').style.display = calMode === 'total' ? '' : 'none';
        recordsBox.querySelector('#r-per100').style.display = calMode === 'per100' ? '' : 'none';
        return;
      }
      if (e.target.closest('#r-save')) { submitRecord(); return; }
      if (e.target.closest('#r-cancel')) { cancelEdit(); return; }
      if (e.target.closest('#lucky-btn')) { drawLucky(); return; }
      if (e.target.closest('[data-add-dish]')) { addDishFromInput(); return; }
      if (e.target.closest('[data-set-target]')) {
        const cur = getFood().target || 1500;
        UI.prompt('设置每日热量目标', cur, function (val) {
          const v = parseFloat(val);
          if (v > 0) { setTarget(v); renderProgress(); }
        }, '单位：kcal');
        return;
      }
      const editRec = e.target.closest('[data-edit-rec]');
      if (editRec) { editingRecId = editRec.dataset.editRec; renderRecords(); return; }
      const delRec = e.target.closest('[data-del-rec]');
      if (delRec) {
        const frId = delRec.dataset.delRec;
        deleteWithUndo({
          get: getFood, set: setFood,
          apply: function () { removeRecord(frId); if (editingRecId === frId) editingRecId = null; },
          render: function () { renderRecords(); renderProgress(); renderRanking(); },
          message: '已删除该记录'
        });
        return;
      }
    });

    section.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      // 中文输入法组字中（拼音尚未上屏）的回车只是「选词确认」，
      // 此时把 value 提交会把拼音当成菜名，必须跳过。
      if (e.isComposing || e.keyCode === 229) return;
      if (e.target.matches('.dish-input')) {
        e.preventDefault();
        addDishFromInput();
      } else if (e.target.closest('.record-form') && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        submitRecord();
      }
    });

    renderProgress();
    renderRanking();
    renderDishes();
    renderRecords();
  }

  RENDERERS.eatwell = renderEatwellSection;

  /* ------------------------------------------------------------------
   * 转盘转转转 板块
   * 存储 key：workbench.wheel
   * { options:[String], schemes:[{id,name,options:[String]}] }
   * ------------------------------------------------------------------ */
  function getWheel() {
    let data = Storage.get('wheel', null);
    if (!data) data = { options: [], schemes: [], history: [] };
    if (!Array.isArray(data.options)) data.options = [];
    if (!Array.isArray(data.schemes)) data.schemes = [];
    if (!Array.isArray(data.history)) data.history = [];
    return data;
  }
  function setWheel(d) { Storage.set('wheel', d); }

  const WHEEL_COLORS = ['#7BAE8C', '#A2DCCF', '#F6DDCE', '#D6F0EF', '#B8E7D2', '#CFEDEF', '#C6D7B2', '#D3E8B7', '#99B6B4', '#E88B8B', '#CAFCC3', '#D0F9F1'];

  function polarPoint(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function truncateText(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

  function buildWheelSVG(options) {
    const cx = 150, cy = 150, R = 138;
    const n = options.length;
    let s = '<svg viewBox="0 0 300 300" class="wheel-svg" preserveAspectRatio="xMidYMid meet">';
    s += '<circle cx="150" cy="150" r="140" fill="#ffffff"></circle>';
    if (n === 0) {
      s += '<text x="150" y="150" text-anchor="middle" dominant-baseline="middle" fill="#8A8A8A" font-size="14">请在上方输入选项</text>';
    } else {
      const seg = 360 / n;
      for (let i = 0; i < n; i++) {
        const a0 = i * seg, a1 = (i + 1) * seg, center = (i + 0.5) * seg;
        const p0 = polarPoint(cx, cy, R, a0);
        const p1 = polarPoint(cx, cy, R, a1);
        const large = seg > 180 ? 1 : 0;
        s += '<path d="M' + cx + ' ' + cy +
          ' L' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
          ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
          ' Z" fill="' + WHEEL_COLORS[i % WHEEL_COLORS.length] + '" stroke="#ffffff" stroke-width="1.5"></path>';
        const tp = polarPoint(cx, cy, R * 0.62, center);
        const flip = (center > 90 && center < 270) ? 180 : 0;
        s += '<text x="' + tp[0].toFixed(2) + '" y="' + tp[1].toFixed(2) +
          '" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="#3D3D3D"' +
          ' transform="rotate(' + (center + flip).toFixed(2) + ' ' + tp[0].toFixed(2) + ' ' + tp[1].toFixed(2) + ')">' +
          esc(truncateText(options[i], 6)) + '</text>';
      }
    }
    s += '</svg>';
    return s;
  }

  function renderWheelSection(section) {
    let rotation = 0;
    let spinning = false;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.wheel + '</span>' +
        '<div>' +
          '<h2 class="section-title">转盘转转转</h2>' +
          '<p class="section-desc">选择困难时，转一转，让转盘帮你做决定。</p>' +
        '</div>' +
      '</div>' +
      '<div class="sub-card" id="opts-box"></div>' +
      '<div class="sub-card" id="wheel-box"></div>' +
      '<div class="sub-card" id="schemes-box"></div>' +
      '<div class="sub-card" id="history-box"></div>';

    const optsBox = section.querySelector('#opts-box');
    const historyBox = section.querySelector('#history-box');
    const wheelBox = section.querySelector('#wheel-box');
    const schemesBox = section.querySelector('#schemes-box');

    /* ---- 选项 ---- */
    function chipsHtml(options) {
      if (!options.length) return '<span class="sub-hint">还没有选项</span>';
      return options.map(function (o, i) {
        return '<span class="opt-chip">' +
          '<span class="opt-text" data-edit-opt="' + i + '" title="点击编辑">' + esc(o) + '</span>' +
          '<button type="button" data-del-opt="' + i + '" title="删除">×</button>' +
        '</span>';
      }).join('');
    }
    function renderOptions() {
      const data = getWheel();
      optsBox.innerHTML =
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">输入选项</h3>' +
          '<span class="sub-hint">一行一个选项 · 输入后自动生成标签</span>' +
        '</div></div>' +
        '<textarea class="opt-textarea" id="opt-input" rows="4" placeholder="一行一个选项，例如：&#10;看电影&#10;去散步&#10;在家休息">' + esc(data.options.join('\n')) + '</textarea>' +
        '<div class="opt-chips" id="opt-chips">' + chipsHtml(data.options) + '</div>';
    }
    function syncTextarea() {
      const ta = optsBox.querySelector('#opt-input');
      if (ta) ta.value = getWheel().options.join('\n');
    }
    function refreshChips() {
      const box = optsBox.querySelector('#opt-chips');
      if (box) box.innerHTML = chipsHtml(getWheel().options);
    }

    /* ---- 转盘 ---- */
    function refreshWheel() {
      const data = getWheel();
      wheelBox.innerHTML =
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">转盘选择</h3>' +
          '<span class="sub-hint">点「转一下」，指针停在哪就选哪个</span>' +
        '</div></div>' +
        '<div class="wheel-wrap">' +
          '<div class="wheel-rotor" id="wheel-rotor" style="transform: rotate(' + rotation + 'deg)">' + buildWheelSVG(data.options) + '</div>' +
          '<div class="wheel-pointer"></div>' +
        '</div>' +
        '<div class="wheel-result" id="wheel-result"></div>' +
        '<div class="wheel-actions" id="spin-row">' +
          '<button type="button" class="btn btn-primary" id="spin-btn">转一下</button>' +
        '</div>' +
        '<div class="wheel-actions" id="result-row" style="display:none">' +
          '<button type="button" class="btn btn-secondary" id="again-btn">再转一次</button>' +
          '<button type="button" class="btn btn-primary" id="ok-btn">就这个了</button>' +
        '</div>';
    }

    function spin() {
      if (spinning) return;
      const data = getWheel();
      const n = data.options.length;
      if (n === 0) { UI.alert('请先在上方输入选项'); return; }
      const rotor = wheelBox.querySelector('#wheel-rotor');
      const resultEl = wheelBox.querySelector('#wheel-result');
      if (!rotor) return;

      spinning = true;
      const seg = 360 / n;
      const idx = Math.floor(Math.random() * n);
      const snapshot = data.options.slice();
      const center = (idx + 0.5) * seg;
      const wantMod = ((270 - center) % 360 + 360) % 360;
      const spins = 3 + Math.floor(Math.random() * 3);
      const base = rotation + spins * 360;
      const curMod = ((base % 360) + 360) % 360;
      const adjust = ((wantMod - curMod) % 360 + 360) % 360;
      rotation = base + adjust;

      wheelBox.querySelector('#spin-row').style.display = 'none';
      wheelBox.querySelector('#result-row').style.display = 'none';
      resultEl.textContent = '转动中…';
      resultEl.classList.remove('show');

      rotor.style.transition = 'transform 3.6s cubic-bezier(0.16, 0.84, 0.28, 1)';
      rotor.style.transform = 'rotate(' + rotation + 'deg)';

      setTimeout(function () {
        spinning = false;
        rotation = ((rotation % 360) + 360) % 360;
        rotor.style.transition = 'none';
        rotor.style.transform = 'rotate(' + rotation + 'deg)';
        void rotor.offsetWidth;
        rotor.style.transition = '';
        resultEl.textContent = snapshot[idx] || '';
        resultEl.classList.add('show');
        recordHistory(snapshot[idx] || '');
        wheelBox.querySelector('#result-row').style.display = 'flex';
      }, 3700);
    }

    /* ---- 方案 ---- */
    function renderSchemes() {
      const data = getWheel();
      let list = '';
      data.schemes.forEach(function (sc) {
        list += '<li class="scheme-item">' +
          '<div class="scheme-main">' +
            '<span class="scheme-name">' + esc(sc.name) + '</span>' +
            '<span class="scheme-sub">' + sc.options.length + ' 个选项</span>' +
          '</div>' +
          '<button type="button" class="btn-mini" data-use-scheme="' + sc.id + '">调用</button>' +
          '<button type="button" class="btn-mini" data-rename-scheme="' + sc.id + '">编辑</button>' +
          '<button type="button" class="act" data-del-scheme="' + sc.id + '" title="删除">' + ICON_TRASH + '</button>' +
        '</li>';
      });
      schemesBox.innerHTML =
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">保存方案</h3>' +
          '<span class="sub-hint">点「就这个了」可把当前选项保存为命名方案</span>' +
        '</div></div>' +
        (data.schemes.length ? '<ul class="scheme-list">' + list + '</ul>' : emptyBox('还没有保存的方案', true));
    }

    function saveScheme() {
      if (!getWheel().options.length) { UI.alert('还没有选项可保存'); return; }
      const def = '方案' + (getWheel().schemes.length + 1);
      UI.prompt('保存为方案', def, function (name) {
        if (!name || !name.trim()) { UI.alert('方案名称不能为空'); return; }
        const d = getWheel();
        d.schemes.push({ id: Storage.genId(), name: name.trim(), options: d.options.slice() });
        setWheel(d);
        renderSchemes();
        UI.alert('已保存方案「' + name.trim() + '」', '保存成功');
      }, '给这组选项起个名字');
    }

    /* ---- 转动历史 ---- */
    function histTime(ts) {
      const d = new Date(ts);
      const now = new Date();
      const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      return d.toDateString() === now.toDateString() ? ('今天 ' + hm) : ((d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm);
    }
    function recordHistory(result) {
      if (!result) return;
      const d = getWheel();
      d.history.unshift({ id: Storage.genId(), result: result, at: Date.now() });
      if (d.history.length > 30) d.history = d.history.slice(0, 30);
      setWheel(d);
      renderHistory();
    }
    function renderHistory() {
      const list = getWheel().history || [];
      let rows = '';
      list.forEach(function (h) {
        rows += '<li class="wheel-hist-item">' +
          '<span class="wheel-hist-result">' + esc(h.result) + '</span>' +
          '<span class="wheel-hist-time">' + histTime(h.at) + '</span>' +
        '</li>';
      });
      historyBox.innerHTML =
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">转动历史</h3>' +
          '<span class="sub-hint">最近 ' + list.length + ' 次</span>' +
        '</div>' +
        (list.length ? '<button type="button" class="link-btn" data-clear-hist="1">清空</button>' : '') +
        '</div>' +
        (list.length ? '<ul class="wheel-hist-list">' + rows + '</ul>' : emptyBox('还没有转动记录，转一次试试', true));
    }

    /* ---- 事件 ---- */
    optsBox.addEventListener('input', function (e) {
      if (e.target.id !== 'opt-input') return;
      const lines = e.target.value.split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
      const data = getWheel();
      data.options = lines;
      setWheel(data);
      refreshChips();
      refreshWheel();
    });

    section.addEventListener('click', function (e) {
      if (e.target.closest('#spin-btn') || e.target.closest('#again-btn')) { spin(); return; }
      if (e.target.closest('#ok-btn')) { saveScheme(); return; }
      if (e.target.closest('[data-clear-hist]')) {
        UI.confirm('清空全部转动历史？', function () {
          const d = getWheel();
          d.history = [];
          setWheel(d);
          renderHistory();
          Toast.show('已清空转动历史');
        });
        return;
      }

      const delOpt = e.target.closest('[data-del-opt]');
      if (delOpt) {
        const data = getWheel();
        data.options.splice(Number(delOpt.dataset.delOpt), 1);
        setWheel(data); syncTextarea(); refreshChips(); refreshWheel();
        return;
      }
      const editOpt = e.target.closest('[data-edit-opt]');
      if (editOpt) {
        const i = Number(editOpt.dataset.editOpt);
        UI.prompt('编辑选项', getWheel().options[i], function (v) {
          if (v !== null && v.trim()) {
            const d = getWheel();
            d.options[i] = v.trim();
            setWheel(d); syncTextarea(); refreshChips(); refreshWheel();
          }
        });
        return;
      }

      const useSc = e.target.closest('[data-use-scheme]');
      if (useSc) {
        const data = getWheel();
        const sc = data.schemes.find(function (x) { return x.id === useSc.dataset.useScheme; });
        if (sc) { data.options = sc.options.slice(); setWheel(data); renderOptions(); refreshWheel(); }
        return;
      }
      const renameSc = e.target.closest('[data-rename-scheme]');
      if (renameSc) {
        const scId = renameSc.dataset.renameScheme;
        const sc0 = getWheel().schemes.find(function (x) { return x.id === scId; });
        if (sc0) {
          UI.prompt('修改方案名称', sc0.name, function (v) {
            if (v !== null && v.trim()) {
              const d = getWheel();
              const s = d.schemes.find(function (x) { return x.id === scId; });
              if (s) { s.name = v.trim(); setWheel(d); renderSchemes(); }
            }
          });
        }
        return;
      }
      const delSc = e.target.closest('[data-del-scheme]');
      if (delSc) {
        const scId = delSc.dataset.delScheme;
        deleteWithUndo({
          get: getWheel, set: setWheel,
          apply: function () { const d = getWheel(); d.schemes = d.schemes.filter(function (x) { return x.id !== scId; }); setWheel(d); },
          render: renderSchemes,
          message: '已删除该方案'
        });
        return;
      }
    });

    renderOptions();
    refreshWheel();
    renderSchemes();
    renderHistory();
  }

  RENDERERS.wheel = renderWheelSection;

  /* ------------------------------------------------------------------
   * 倒数日 板块
   * 存储 key：workbench.countdown
   * { items:[{id,name,targetDate,note,tag,pinned}] }
   * ------------------------------------------------------------------ */
  const CD_TAGS = ['工作', '生活', '学习', '其他'];
  const ICON_PIN = icon('<path d="M12 17v5"></path>' +
    '<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path>');

  function getCountdown() {
    let d = Storage.get('countdown', null);
    if (!d) d = { items: [] };
    if (!Array.isArray(d.items)) d.items = [];
    return d;
  }
  function setCountdown(d) { Storage.set('countdown', d); }

  function daysUntil(dateKey) {
    if (!dateKey) return NaN;
    const p = dateKey.split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return NaN;
    const target = new Date(p[0], p[1] - 1, p[2]);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function renderCountdownSection(section) {
    let filterTag = '';
    let editingId = null;
    let panelTag = '';
    let panelRepeat = 'none';
    let expiredOpen = false;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.calendar + '</span>' +
        '<div>' +
          '<h2 class="section-title">倒数日</h2>' +
          '<p class="section-desc">纪念每一个重要的日子，倒数期待的那一天。</p>' +
        '</div>' +
        '<button type="button" class="cd-add" id="cd-add" title="添加倒数日">＋</button>' +
      '</div>' +
      '<div class="sub-card" id="cd-box"></div>' +
      '<div class="cd-overlay" id="cd-overlay" hidden>' +
        '<div class="cd-sheet">' +
          '<h3 class="cd-sheet-title" id="cd-sheet-title">添加倒数日</h3>' +
          '<label class="cd-field"><span>事件名称</span>' +
            '<input class="input" id="cd-name" type="text" maxlength="30" placeholder="例如：生日 / 考试 / 旅行"></label>' +
          '<label class="cd-field"><span>目标日期</span>' +
            '<input class="input" id="cd-date" type="date"></label>' +
          '<label class="cd-field"><span>备注</span>' +
            '<input class="input" id="cd-note" type="text" maxlength="50" placeholder="可选"></label>' +
          '<div class="cd-field"><span>标签分类</span>' +
            '<div class="cd-tagpick">' +
              CD_TAGS.map(function (t) { return '<button type="button" class="cd-tagopt" data-tag="' + t + '">' + t + '</button>'; }).join('') +
            '</div>' +
            '<input class="input" id="cd-tag-custom" type="text" maxlength="8" placeholder="自定义标签（可选）">' +
          '</div>' +
          '<div class="cd-field"><span>重复</span>' +
            '<div class="cd-tagpick">' +
              '<button type="button" class="cd-tagopt" data-repeat="none">不重复</button>' +
              '<button type="button" class="cd-tagopt" data-repeat="yearly">每年重复</button>' +
            '</div>' +
          '</div>' +
          '<div class="cd-sheet-actions">' +
            '<button type="button" class="btn btn-secondary" id="cd-cancel">取消</button>' +
            '<button type="button" class="btn btn-primary" id="cd-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    const box = section.querySelector('#cd-box');
    const overlay = section.querySelector('#cd-overlay');

    /* ---- 面板 ---- */
    function updateTagChips() {
      section.querySelectorAll('.cd-tagopt[data-tag]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tag === panelTag);
      });
    }
    function updateRepeatChips() {
      section.querySelectorAll('.cd-tagopt[data-repeat]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.repeat === panelRepeat);
      });
    }
    /* 每年重复：取今年的纪念日，若已过则取下一年 */
    function nextOccurrence(dateStr) {
      const p = dateStr.split('-').map(Number);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let d = new Date(now.getFullYear(), p[1] - 1, p[2]);
      if (d < today) d = new Date(now.getFullYear() + 1, p[1] - 1, p[2]);
      return dateKey(d);
    }
    function openPanel(item) {
      editingId = item ? item.id : null;
      section.querySelector('#cd-sheet-title').textContent = item ? '编辑倒数日' : '添加倒数日';
      section.querySelector('#cd-name').value = item ? item.name : '';
      section.querySelector('#cd-date').value = item ? item.targetDate : todayKey();
      section.querySelector('#cd-note').value = item ? (item.note || '') : '';
      const customEl = section.querySelector('#cd-tag-custom');
      if (item && item.tag && CD_TAGS.indexOf(item.tag) < 0) {
        customEl.value = item.tag;
        panelTag = '';
      } else {
        customEl.value = '';
        panelTag = item ? (item.tag || '') : '';
      }
      panelRepeat = item ? (item.repeat || 'none') : 'none';
      updateTagChips();
      updateRepeatChips();
      overlay.hidden = false;
      setTimeout(function () { section.querySelector('#cd-name').focus(); }, 30);
    }
    function closePanel() {
      overlay.hidden = true;
      editingId = null;
    }
    function savePanel() {
      const name = section.querySelector('#cd-name').value.trim();
      const targetDate = section.querySelector('#cd-date').value;
      const note = section.querySelector('#cd-note').value.trim();
      const custom = section.querySelector('#cd-tag-custom').value.trim();
      const tag = custom || panelTag || '其他';
      if (!name) { UI.alert('请填写事件名称'); return; }
      if (!targetDate) { UI.alert('请选择目标日期'); return; }
      const data = getCountdown();
      if (editingId) {
        const it = data.items.find(function (x) { return x.id === editingId; });
        if (it) { it.name = name; it.targetDate = targetDate; it.note = note; it.tag = tag; it.repeat = panelRepeat; }
      } else {
        data.items.push({ id: Storage.genId(), name: name, targetDate: targetDate, note: note, tag: tag, pinned: false, repeat: panelRepeat });
      }
      setCountdown(data);
      closePanel();
      renderList();
    }

    /* ---- 列表 ---- */
    function filtersHtml() {
      const data = getCountdown();
      const tags = [];
      data.items.forEach(function (x) { if (x.tag && tags.indexOf(x.tag) < 0) tags.push(x.tag); });
      let html = '<button type="button" class="cd-filter' + (filterTag === '' ? ' active' : '') + '" data-filter="">全部</button>';
      tags.forEach(function (t) {
        html += '<button type="button" class="cd-filter' + (filterTag === t ? ' active' : '') + '" data-filter="' + esc(t) + '">' + esc(t) + '</button>';
      });
      return '<div class="cd-filters">' + html + '</div>';
    }

    function itemHtml(x) {
      const it = x.item, d = x.days;
      let dayText, dayCls;
      if (d > 0) {
        dayText = '还有 ' + d + ' 天';
        dayCls = d <= 3 ? 'danger' : (d <= 7 ? 'warn' : '');
      } else if (d === 0) {
        dayText = '就是今天！';
        dayCls = 'today';
      } else {
        dayText = '已过去 ' + (-d) + ' 天';
        dayCls = 'expired';
      }
      return '<div class="cd-item' + (it.pinned ? ' pinned' : '') + (dayCls ? ' ' + dayCls : '') + '">' +
        '<div class="cd-item-main">' +
          '<div class="cd-item-top">' +
            '<span class="cd-name">' + esc(it.name) + '</span>' +
            (it.tag ? '<span class="cd-tag">' + esc(it.tag) + '</span>' : '') +
          '</div>' +
          '<div class="cd-item-sub">' +
            '<span class="cd-date">' + ((x.effDate && x.effDate !== it.targetDate) ? '下次 ' + dateShortCN(x.effDate) : dateShortCN(it.targetDate)) + '</span>' +
            (it.repeat === 'yearly' ? '<em class="cd-repeat">每年</em>' : '') +
            (it.note ? '<span class="cd-note">' + esc(it.note) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cd-days ' + (dayCls || '') + '">' + dayText + '</div>' +
        '<div class="cd-actions">' +
          '<button type="button" class="act cd-pin' + (it.pinned ? ' on' : '') + '" data-pin="' + it.id + '" title="' + (it.pinned ? '取消置顶' : '置顶') + '">' + ICON_PIN + '</button>' +
          '<button type="button" class="act" data-edit="' + it.id + '" title="编辑">' + ICON_EDIT + '</button>' +
          '<button type="button" class="del" data-del="' + it.id + '" title="删除">' + ICON_TRASH + '</button>' +
        '</div>' +
      '</div>';
    }

    function renderList() {
      const data = getCountdown();
      let items = data.items.slice();
      if (filterTag) items = items.filter(function (x) { return x.tag === filterTag; });

      const withDays = [];
      items.forEach(function (x) {
        // 每年重复：按最近一次纪念日计算
        const effDate = x.repeat === 'yearly' ? nextOccurrence(x.targetDate) : x.targetDate;
        const d = daysUntil(effDate);
        if (!isNaN(d)) withDays.push({ item: x, days: d, effDate: effDate });
      });

      const active = withDays.filter(function (x) { return x.days >= 0; }).sort(function (a, b) {
        if (!!a.item.pinned !== !!b.item.pinned) return a.item.pinned ? -1 : 1;
        return a.days - b.days;
      });
      const expired = withDays.filter(function (x) { return x.days < 0; }).sort(function (a, b) { return b.days - a.days; });

      let html = filtersHtml();
      html += '<div class="cd-list">' +
        (active.length ? active.map(itemHtml).join('') : emptyBox(filterTag ? '该标签下暂无进行中的倒数日' : '还没有倒数日，点右上角「＋」添加')) +
        '</div>';

      if (expired.length) {
        html += '<div class="cd-expired">' +
          '<button type="button" class="cd-expired-head" data-toggle-expired>' +
            '<span class="cd-caret' + (expiredOpen ? '' : ' collapsed') + '">' + ICON_CHEV_R + '</span>' +
            '已过期 · ' + expired.length +
          '</button>' +
          '<div class="cd-list cd-expired-body"' + (expiredOpen ? '' : ' hidden') + '>' + expired.map(itemHtml).join('') + '</div>' +
        '</div>';
      }

      box.innerHTML = html;
    }

    /* ---- 事件 ---- */
    section.addEventListener('click', function (e) {
      if (e.target.closest('#cd-add')) { openPanel(null); return; }
      if (e.target.closest('#cd-save')) { savePanel(); return; }
      if (e.target.closest('#cd-cancel')) { closePanel(); return; }

      const repOpt = e.target.closest('.cd-tagopt[data-repeat]');
      if (repOpt) {
        panelRepeat = repOpt.dataset.repeat;
        updateRepeatChips();
        return;
      }

      const tagOpt = e.target.closest('.cd-tagopt[data-tag]');
      if (tagOpt) {
        panelTag = tagOpt.dataset.tag;
        section.querySelector('#cd-tag-custom').value = '';
        updateTagChips();
        return;
      }

      const filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) { filterTag = filterBtn.dataset.filter; renderList(); return; }

      if (e.target.closest('[data-toggle-expired]')) { expiredOpen = !expiredOpen; renderList(); return; }

      const pinBtn = e.target.closest('[data-pin]');
      if (pinBtn) {
        const data = getCountdown();
        const it = data.items.find(function (x) { return x.id === pinBtn.dataset.pin; });
        if (it) { it.pinned = !it.pinned; setCountdown(data); }
        renderList();
        return;
      }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const data = getCountdown();
        const it = data.items.find(function (x) { return x.id === editBtn.dataset.edit; });
        if (it) openPanel(it);
        return;
      }
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        const id = delBtn.dataset.del;
        deleteWithUndo({
          get: getCountdown, set: setCountdown,
          apply: function () { const data = getCountdown(); data.items = data.items.filter(function (x) { return x.id !== id; }); setCountdown(data); },
          render: renderList,
          message: '已删除该倒数日'
        });
        return;
      }
    });

    section.addEventListener('input', function (e) {
      if (e.target.id === 'cd-tag-custom' && e.target.value.trim()) {
        panelTag = '';
        updateTagChips();
      }
    });

    renderList();
  }

  RENDERERS.countdown = renderCountdownSection;

  /* ------------------------------------------------------------------
   * 饮食规划 板块（本周餐单 / 我的食谱库 / 采购食材清单 / 饮食小笔记）
   * 存储 key：workbench.mealPlan
   * { week:{mon:{breakfast:[],lunch:[],dinner:[]},...},
   *   recipes:[{id,name,ingredients,steps,tags:[]}],
   *   groceries:[{id,name,bought}], note:'' }
   * ------------------------------------------------------------------ */
  const MEAL_DAYS = [
    { key: 'mon', label: '周一' }, { key: 'tue', label: '周二' },
    { key: 'wed', label: '周三' }, { key: 'thu', label: '周四' },
    { key: 'fri', label: '周五' }, { key: 'sat', label: '周六' },
    { key: 'sun', label: '周日' }
  ];
  const MEAL_TIMES = [
    { key: 'breakfast', label: '早' },
    { key: 'lunch', label: '午' },
    { key: 'dinner', label: '晚' }
  ];
  const RECIPE_TAGS = ['家常菜', '快手菜', '素食'];

  function emptyWeek() {
    const w = {};
    MEAL_DAYS.forEach(function (d) { w[d.key] = { breakfast: [], lunch: [], dinner: [] }; });
    return w;
  }
  function todayDayKey() {
    const idx = (new Date().getDay() + 6) % 7; // 0=周一 … 6=周日
    return MEAL_DAYS[idx].key;
  }
  /* 首次使用时预置的默认食谱（常见家常菜，覆盖三个标签） */
  function defaultRecipes() {
    const raw = [
      {
        name: '番茄炒蛋', tags: ['家常菜', '快手菜'],
        ingredients: '番茄 2 个\n鸡蛋 3 个\n葱花、盐、糖、食用油',
        steps: '1. 鸡蛋打散加少许盐，热油炒至凝固盛出。\n2. 番茄切块下锅炒出汁，加少许糖。\n3. 倒回鸡蛋翻炒均匀，加盐调味，撒葱花出锅。'
      },
      {
        name: '青椒土豆丝', tags: ['家常菜', '素食'],
        ingredients: '土豆 2 个\n青椒 2 个\n蒜、干辣椒、醋、盐',
        steps: '1. 土豆切细丝，清水冲去淀粉后沥干。\n2. 热油爆香蒜末与干辣椒。\n3. 下土豆丝大火翻炒，沿锅边淋少许醋。\n4. 加青椒丝炒断生，加盐出锅。'
      },
      {
        name: '蒜蓉西兰花', tags: ['快手菜', '素食'],
        ingredients: '西兰花 1 颗\n蒜 4 瓣\n盐、蚝油、食用油',
        steps: '1. 西兰花掰小朵，盐水泡后焯水 1 分钟捞出。\n2. 热油爆香蒜末。\n3. 下西兰花翻炒，加盐和少许蚝油调味即可。'
      },
      {
        name: '可乐鸡翅', tags: ['家常菜'],
        ingredients: '鸡中翅 8 个\n可乐 1 罐\n姜片、生抽、料酒',
        steps: '1. 鸡翅两面划刀，冷水下锅焯水去腥。\n2. 热油煎至两面金黄，加姜片炒香。\n3. 倒入可乐没过鸡翅，加生抽、料酒。\n4. 中小火煮 15 分钟，大火收汁即可。'
      },
      {
        name: '紫菜蛋花汤', tags: ['快手菜'],
        ingredients: '紫菜 1 小把\n鸡蛋 2 个\n虾皮、葱花、盐、香油',
        steps: '1. 水烧开，放入紫菜和虾皮。\n2. 蛋液缓缓淋入锅中形成蛋花。\n3. 加盐调味，撒葱花、滴几滴香油出锅。'
      },
      {
        name: '麻婆豆腐', tags: ['家常菜'],
        ingredients: '嫩豆腐 1 盒\n肉末 100g\n豆瓣酱、花椒粉、蒜末、葱花、淀粉',
        steps: '1. 豆腐切块，淡盐水浸泡 5 分钟。\n2. 热油炒香肉末，加豆瓣酱和蒜末炒出红油。\n3. 加水烧开，下豆腐煮 3 分钟。\n4. 水淀粉勾芡，撒花椒粉和葱花即可。'
      },
      {
        name: '凉拌黄瓜', tags: ['快手菜', '素食'],
        ingredients: '黄瓜 2 根\n蒜末、醋、生抽、糖、香油、辣椒油',
        steps: '1. 黄瓜拍碎切段，加盐腌 10 分钟后倒掉水分。\n2. 加蒜末、醋、生抽、糖、香油拌匀。\n3. 喜辣可加辣椒油，冷藏后更爽口。'
      },
      {
        name: '香菇滑鸡', tags: ['家常菜'],
        ingredients: '鸡腿肉 300g\n干香菇 6 朵\n姜丝、生抽、蚝油、淀粉',
        steps: '1. 鸡肉切块，加生抽、蚝油、淀粉腌 15 分钟。\n2. 香菇泡发后切片。\n3. 与鸡肉一起铺盘、放姜丝，上锅蒸 15 分钟。\n4. 出锅撒葱花即可。'
      }
    ];
    return raw.map(function (r) {
      return {
        id: Storage.genId(),
        name: r.name,
        ingredients: r.ingredients,
        steps: r.steps,
        tags: r.tags.slice()
      };
    });
  }

  function getMealPlan() {
    let d = Storage.get('mealPlan', null);
    if (!d) d = { week: emptyWeek(), recipes: [], groceries: [], note: '', templates: [] };
    if (!d.week || typeof d.week !== 'object') d.week = emptyWeek();
    MEAL_DAYS.forEach(function (day) {
      if (!d.week[day.key]) d.week[day.key] = { breakfast: [], lunch: [], dinner: [] };
      MEAL_TIMES.forEach(function (t) {
        if (!Array.isArray(d.week[day.key][t.key])) d.week[day.key][t.key] = [];
      });
    });
    if (!Array.isArray(d.recipes)) d.recipes = [];
    if (!Array.isArray(d.groceries)) d.groceries = [];
    if (!Array.isArray(d.templates)) d.templates = [];
    if (typeof d.note !== 'string') d.note = '';
    // 首次使用：预置默认食谱（仅初始化一次，之后清空也不会再自动填充）
    if (!d.seeded) {
      if (!d.recipes.length) d.recipes = defaultRecipes();
      d.seeded = true;
      Storage.set('mealPlan', d);
    }
    return d;
  }
  function setMealPlan(d) { Storage.set('mealPlan', d); }

  function renderDietSection(section) {
    const todayDay = todayDayKey();
    const dayOpen = {};
    MEAL_DAYS.forEach(function (d) { dayOpen[d.key] = d.key === todayDay; });
    const recipeOpen = {};
    let recipeSearch = '';
    let editingRecipeId = null;
    let recipeTags = [];

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.mealPlan + '</span>' +
        '<div>' +
          '<h2 class="section-title">饮食规划</h2>' +
          '<p class="section-desc">本周餐单 · 食谱库 · 采购清单 · 饮食小笔记</p>' +
        '</div>' +
      '</div>' +
      '<section class="sub-card" id="mp-week"></section>' +
      '<section class="sub-card" id="mp-recipes">' +
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">我的食谱库</h3>' +
            '<span class="sub-hint">点击卡片展开做法</span>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-mini" id="mp-recipe-add">＋ 新增食谱</button>' +
        '</div>' +
        '<div class="input-row">' +
          '<input class="input" id="mp-recipe-search" type="search" placeholder="搜索食谱名称…">' +
        '</div>' +
        '<div id="mp-recipe-list"></div>' +
      '</section>' +
      '<section class="sub-card" id="mp-groceries"></section>' +
      '<section class="sub-card" id="mp-note"></section>' +
      '<div class="cd-overlay" id="mp-recipe-overlay" hidden>' +
        '<div class="cd-sheet">' +
          '<h3 class="cd-sheet-title" id="mp-recipe-title">新增食谱</h3>' +
          '<label class="cd-field"><span>菜名</span>' +
            '<input class="input" id="mp-recipe-name" type="text" maxlength="20" placeholder="例如：番茄炒蛋"></label>' +
          '<label class="cd-field"><span>食材</span>' +
            '<textarea class="input mp-ta" id="mp-recipe-ing" rows="2" placeholder="每行一种食材"></textarea></label>' +
          '<label class="cd-field"><span>简易做法</span>' +
            '<textarea class="input mp-ta" id="mp-recipe-steps" rows="4" placeholder="写下简单的步骤…"></textarea></label>' +
          '<div class="cd-field"><span>标签</span>' +
            '<div class="cd-tagpick" id="mp-recipe-tags">' +
              RECIPE_TAGS.map(function (t) { return '<button type="button" class="cd-tagopt" data-recipe-tag="' + t + '">' + t + '</button>'; }).join('') +
            '</div></div>' +
          '<div class="cd-sheet-actions">' +
            '<button type="button" class="btn btn-secondary" id="mp-recipe-cancel">取消</button>' +
            '<button type="button" class="btn btn-primary" id="mp-recipe-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* ---- 本周餐单 ---- */
    function renderWeek() {
      const d = getMealPlan();
      const week = d.week;
      let html = '<div class="sub-head">' +
        '<div class="sub-head-left">' +
          '<h3 class="sub-title">本周餐单</h3>' +
          '<span class="sub-hint">回车添加 · 点餐食改名 · 点 × 删除</span>' +
        '</div>' +
        '<button type="button" class="link-btn danger" id="mp-week-clear">清空本周</button>' +
        '</div>';
      MEAL_DAYS.forEach(function (day) {
        const isOpen = dayOpen[day.key];
        const isToday = day.key === todayDay;
        const dayMeals = week[day.key];
        html += '<div class="mp-day' + (isOpen ? ' open' : '') + '">' +
          '<button type="button" class="mp-day-head" data-day-toggle="' + day.key + '">' +
            '<span class="caret-wrap">' + ICON_CHEV_R + '</span>' +
            '<span class="mp-day-name">' + day.label + '</span>' +
            (isToday ? '<em class="today-tag">今天</em>' : '') +
          '</button>' +
          '<div class="mp-day-body">' +
            MEAL_TIMES.map(function (t) {
              const items = dayMeals[t.key];
              const chips = items.map(function (name, i) {
                return '<span class="mp-chip" data-meal="' + day.key + '" data-time="' + t.key + '" data-idx="' + i + '">' + esc(name) +
                  '<button type="button" class="mp-chip-del" data-del-meal="' + day.key + '" data-time="' + t.key + '" data-idx="' + i + '" title="删除">×</button></span>';
              }).join('');
              return '<div class="mp-meal-row">' +
                '<span class="mp-meal-label">' + t.label + '</span>' +
                '<div class="mp-meal-chips">' + chips + '</div>' +
                '<input class="input mp-add-input" type="text" data-add-day="' + day.key + '" data-add-time="' + t.key + '" placeholder="添加" maxlength="20" enterkeyhint="done" autocomplete="off">' +
                '<button type="button" class="mp-add-btn" data-meal-add="' + day.key + '" data-meal-time="' + t.key + '">添加</button>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>';
      });

      // 餐单模板：把常用的一周餐单存下来，换季 / 换周一键套用
      const tpls = d.templates;
      html += '<div class="mp-tpl">' +
        '<div class="mp-tpl-head">' +
          '<span class="mp-tpl-title">餐单模板</span>' +
          '<button type="button" class="link-btn" id="mp-tpl-save">存为模板</button>' +
        '</div>' +
        (tpls.length
          ? '<div class="mp-tpl-list">' + tpls.map(function (t) {
              return '<span class="mp-tpl-chip">' +
                '<button type="button" class="mp-tpl-apply" data-tpl-apply="' + t.id + '" title="套用该模板">' + esc(t.name) + '</button>' +
                '<button type="button" class="mp-tpl-del" data-tpl-del="' + t.id + '" title="删除模板">×</button>' +
              '</span>';
            }).join('') + '</div>'
          : emptyBox('还没有模板，把常用的一周餐单存下来吧', true)) +
        '</div>';

      section.querySelector('#mp-week').innerHTML = html;
    }

    /* ---- 餐单模板 ---- */
    function cloneWeek(week) {
      const out = {};
      MEAL_DAYS.forEach(function (day) {
        const src = (week && week[day.key]) || {};
        out[day.key] = {
          breakfast: (src.breakfast || []).slice(),
          lunch: (src.lunch || []).slice(),
          dinner: (src.dinner || []).slice()
        };
      });
      return out;
    }
    function weekCount(week) {
      let n = 0;
      MEAL_DAYS.forEach(function (day) {
        MEAL_TIMES.forEach(function (t) {
          n += ((week[day.key] || {})[t.key] || []).length;
        });
      });
      return n;
    }
    function saveTemplate() {
      const d = getMealPlan();
      if (weekCount(d.week) === 0) { UI.alert('本周餐单还是空的，先添加几餐再存模板吧'); return; }
      const def = '模板 ' + (d.templates.length + 1);
      UI.prompt('保存为餐单模板', def, function (val) {
        const name = (val || '').trim();
        if (!name) return;
        const d2 = getMealPlan();
        d2.templates.push({ id: Storage.genId(), name: name.slice(0, 12), week: cloneWeek(d2.week) });
        setMealPlan(d2);
        renderWeek();
        Toast.show('已保存模板「' + name.slice(0, 12) + '」');
      }, '之后可一键套用到本周餐单');
    }
    function applyTemplate(id) {
      const d = getMealPlan();
      const t = d.templates.find(function (x) { return x.id === id; });
      if (!t) return;
      const n = weekCount(t.week);
      UI.confirm('套用模板「' + t.name + '」将覆盖本周现有餐单（' + n + ' 餐），是否继续？', function () {
        const d2 = getMealPlan();
        d2.week = cloneWeek(t.week);
        setMealPlan(d2);
        renderWeek();
        Toast.show('已套用模板「' + t.name + '」');
      });
    }
    function deleteTemplate(id) {
      const d = getMealPlan();
      const t = d.templates.find(function (x) { return x.id === id; });
      if (!t) return;
      UI.confirm('删除模板「' + t.name + '」？', function () {
        deleteWithUndo({
          get: getMealPlan, set: setMealPlan,
          apply: function () { const d2 = getMealPlan(); d2.templates = d2.templates.filter(function (x) { return x.id !== id; }); setMealPlan(d2); },
          render: renderWeek,
          message: '已删除该模板'
        });
      });
    }

    /* ---- 食谱库 ---- */
    function recipeHtml(r) {
      const isOpen = recipeOpen[r.id];
      const tags = (r.tags || []).map(function (t) { return '<span class="mp-recipe-tag">' + esc(t) + '</span>'; }).join('');
      return '<div class="mp-recipe-card' + (isOpen ? ' open' : '') + '">' +
        '<button type="button" class="mp-recipe-head" data-recipe-toggle="' + r.id + '">' +
          '<span class="mp-recipe-name">' + esc(r.name) + '</span>' +
          '<span class="mp-recipe-tags">' + tags + '</span>' +
          '<span class="caret-wrap mp-recipe-caret">' + ICON_CHEV_R + '</span>' +
        '</button>' +
        '<div class="mp-recipe-ing">' + esc(r.ingredients || '') + '</div>' +
        '<div class="mp-recipe-body">' +
          '<div class="mp-recipe-steps">' + esc(r.steps || '').replace(/\n/g, '<br>') + '</div>' +
          '<div class="mp-recipe-actions">' +
            '<button type="button" class="act" data-recipe-edit="' + r.id + '" title="编辑">' + ICON_EDIT + '</button>' +
            '<button type="button" class="del" data-recipe-del="' + r.id + '" title="删除">' + ICON_TRASH + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    function renderRecipes() {
      const d = getMealPlan();
      const kw = recipeSearch.trim().toLowerCase();
      const list = d.recipes.filter(function (r) { return !kw || r.name.toLowerCase().indexOf(kw) >= 0; });
      const box = section.querySelector('#mp-recipe-list');
      if (!list.length) {
        box.innerHTML = emptyBox(d.recipes.length ? '没有匹配的食谱' : '还没有收藏食谱，点右上角新增一个吧');
      } else {
        box.innerHTML = '<div class="mp-recipe-list">' + list.map(recipeHtml).join('') + '</div>';
      }
    }
    function openRecipe(r) {
      editingRecipeId = r ? r.id : null;
      recipeTags = r ? (r.tags || []).slice() : [];
      section.querySelector('#mp-recipe-title').textContent = r ? '编辑食谱' : '新增食谱';
      section.querySelector('#mp-recipe-name').value = r ? r.name : '';
      section.querySelector('#mp-recipe-ing').value = r ? (r.ingredients || '') : '';
      section.querySelector('#mp-recipe-steps').value = r ? (r.steps || '') : '';
      section.querySelectorAll('#mp-recipe-tags .cd-tagopt').forEach(function (b) {
        b.classList.toggle('active', recipeTags.indexOf(b.dataset.recipeTag) >= 0);
      });
      section.querySelector('#mp-recipe-overlay').hidden = false;
      setTimeout(function () { section.querySelector('#mp-recipe-name').focus(); }, 30);
    }
    function closeRecipe() { section.querySelector('#mp-recipe-overlay').hidden = true; editingRecipeId = null; }
    function toggleRecipeTag(t) {
      const i = recipeTags.indexOf(t);
      if (i >= 0) recipeTags.splice(i, 1); else recipeTags.push(t);
      section.querySelectorAll('#mp-recipe-tags .cd-tagopt').forEach(function (b) {
        b.classList.toggle('active', recipeTags.indexOf(b.dataset.recipeTag) >= 0);
      });
    }
    function saveRecipe() {
      const name = section.querySelector('#mp-recipe-name').value.trim();
      const ing = section.querySelector('#mp-recipe-ing').value.trim();
      const steps = section.querySelector('#mp-recipe-steps').value.trim();
      if (!name) { UI.alert('请填写菜名'); return; }
      const d = getMealPlan();
      if (editingRecipeId) {
        const r = d.recipes.find(function (x) { return x.id === editingRecipeId; });
        if (r) { r.name = name; r.ingredients = ing; r.steps = steps; r.tags = recipeTags.slice(); }
      } else {
        d.recipes.push({ id: Storage.genId(), name: name, ingredients: ing, steps: steps, tags: recipeTags.slice() });
      }
      setMealPlan(d);
      closeRecipe();
      renderRecipes();
    }

    /* ---- 采购清单 ---- */
    function renderGroceries() {
      const d = getMealPlan();
      const items = d.groceries;
      const pending = items.filter(function (g) { return !g.bought; }).length;
      const bought = items.length - pending;
      let html = '<div class="sub-head">' +
        '<div class="sub-head-left">' +
          '<h3 class="sub-title">采购食材清单</h3>' +
          '<span class="sub-hint">' + pending + ' 待购 · ' + bought + ' 已购</span>' +
        '</div>' +
        (bought > 0 ? '<button type="button" class="link-btn" id="mp-grocery-clear">归档已购</button>' : '') +
        '</div>' +
        '<div class="input-row input-row-add">' +
          '<input class="input" id="mp-grocery-input" type="text" placeholder="新增食材" maxlength="30" enterkeyhint="done" autocomplete="off">' +
          '<button type="button" class="btn btn-primary" data-add-grocery>添加</button>' +
        '</div>';
      if (!items.length) {
        html += emptyBox('清单还是空的，先加几样要买的食材吧');
      } else {
        html += '<ul class="mp-grocery-list">' + items.map(function (g) {
          return '<li class="mp-grocery-item' + (g.bought ? ' bought' : '') + '">' +
            '<label class="mp-grocery-check">' +
              '<input type="checkbox" data-grocery-toggle="' + g.id + '"' + (g.bought ? ' checked' : '') + '>' +
              '<span class="mp-cbx"></span>' +
            '</label>' +
            '<span class="mp-grocery-name">' + esc(g.name) + '</span>' +
            '<button type="button" class="del" data-grocery-del="' + g.id + '" title="删除">' + ICON_TRASH + '</button>' +
          '</li>';
        }).join('') + '</ul>';
      }
      section.querySelector('#mp-groceries').innerHTML = html;
    }

    /* ---- 饮食小笔记 ---- */
    function renderNote() {
      const d = getMealPlan();
      section.querySelector('#mp-note').innerHTML =
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">饮食小笔记</h3>' +
            '<span class="sub-hint">记录忌口、爱吃 / 不爱吃、饮食感受</span>' +
          '</div>' +
        '</div>' +
        '<textarea class="input mp-note-area" id="mp-note-area" placeholder="例如：不吃香菜、忌辛辣；最近爱吃番茄…">' + esc(d.note) + '</textarea>';
    }

    function editMealChip(dayKey, timeKey, idx) {
      const d = getMealPlan();
      const cur = d.week[dayKey][timeKey][idx];
      UI.prompt('编辑餐食', cur, function (val) {
        const v = (val || '').trim();
        if (!v) return;
        const d2 = getMealPlan();
        if (d2.week[dayKey] && d2.week[dayKey][timeKey]) d2.week[dayKey][timeKey][idx] = v;
        setMealPlan(d2);
        renderWeek();
      });
    }

    /* ---- 事件 ---- */
    section.addEventListener('click', function (e) {
      const dayToggle = e.target.closest('[data-day-toggle]');
      if (dayToggle) { const k = dayToggle.dataset.dayToggle; dayOpen[k] = !dayOpen[k]; renderWeek(); return; }
      const delMeal = e.target.closest('[data-del-meal]');
      if (delMeal) {
        const d = getMealPlan();
        const arr = d.week[delMeal.dataset.delMeal][delMeal.dataset.time];
        arr.splice(Number(delMeal.dataset.idx), 1);
        setMealPlan(d);
        renderWeek();
        return;
      }
      const chip = e.target.closest('.mp-chip');
      if (chip) { editMealChip(chip.dataset.meal, chip.dataset.time, Number(chip.dataset.idx)); return; }
      const weekClear = e.target.closest('#mp-week-clear');
      if (weekClear) {
        UI.confirm('清空本周所有餐单？', function () {
          const d = getMealPlan(); d.week = emptyWeek(); setMealPlan(d); renderWeek();
        });
        return;
      }

      if (e.target.closest('#mp-recipe-add')) { openRecipe(null); return; }
      const recipeToggle = e.target.closest('[data-recipe-toggle]');
      if (recipeToggle) { const id = recipeToggle.dataset.recipeToggle; recipeOpen[id] = !recipeOpen[id]; renderRecipes(); return; }
      const recipeEdit = e.target.closest('[data-recipe-edit]');
      if (recipeEdit) {
        const r = getMealPlan().recipes.find(function (x) { return x.id === recipeEdit.dataset.recipeEdit; });
        if (r) openRecipe(r);
        return;
      }
      const recipeDel = e.target.closest('[data-recipe-del]');
      if (recipeDel) {
        const id = recipeDel.dataset.recipeDel;
        deleteWithUndo({
          get: getMealPlan, set: setMealPlan,
          apply: function () { const d = getMealPlan(); d.recipes = d.recipes.filter(function (x) { return x.id !== id; }); setMealPlan(d); },
          render: renderRecipes,
          message: '已删除该食谱'
        });
        return;
      }
      const recipeTag = e.target.closest('[data-recipe-tag]');
      if (recipeTag) { toggleRecipeTag(recipeTag.dataset.recipeTag); return; }
      if (e.target.closest('#mp-recipe-cancel')) { closeRecipe(); return; }
      if (e.target.closest('#mp-recipe-save')) { saveRecipe(); return; }

      const gToggle = e.target.closest('[data-grocery-toggle]');
      if (gToggle) {
        const d = getMealPlan();
        const g = d.groceries.find(function (x) { return x.id === gToggle.dataset.groceryToggle; });
        if (g) { g.bought = !g.bought; setMealPlan(d); renderGroceries(); }
        return;
      }
      const gDel = e.target.closest('[data-grocery-del]');
      if (gDel) {
        const d = getMealPlan(); d.groceries = d.groceries.filter(function (x) { return x.id !== gDel.dataset.groceryDel; }); setMealPlan(d); renderGroceries();
        return;
      }
      const gClear = e.target.closest('#mp-grocery-clear');
      if (gClear) {
        const d0 = getMealPlan();
        const bought = d0.groceries.filter(function (x) { return x.bought; }).length;
        if (!bought) return;
        UI.confirm('把已购的 ' + bought + ' 样食材归档（从清单移除）？', function () {
          deleteWithUndo({
            get: getMealPlan, set: setMealPlan,
            apply: function () { const d = getMealPlan(); d.groceries = d.groceries.filter(function (x) { return !x.bought; }); setMealPlan(d); },
            render: renderGroceries,
            message: '已归档 ' + bought + ' 样已购食材'
          });
        });
        return;
      }

      const mealAdd = e.target.closest('[data-meal-add]');
      if (mealAdd) { addMealFromInput(mealAdd.dataset.mealAdd, mealAdd.dataset.mealTime); return; }
      if (e.target.closest('[data-add-grocery]')) { addGroceryFromInput(); return; }
      if (e.target.closest('#mp-tpl-save')) { saveTemplate(); return; }
      const tplDel = e.target.closest('[data-tpl-del]');
      if (tplDel) { deleteTemplate(tplDel.dataset.tplDel); return; }
      const tplApply = e.target.closest('[data-tpl-apply]');
      if (tplApply) { applyTemplate(tplApply.dataset.tplApply); return; }
    });

    /* 餐单：往「某天某餐」加一道菜。渲染后按 data 属性精确找回同一个输入框
       并 focus（手机上键盘不会收起），再给 Toast 反馈。 */
    function addMealFromInput(day, time) {
      const sel = '.mp-add-input[data-add-day="' + day + '"][data-add-time="' + time + '"]';
      const input = section.querySelector(sel);
      if (!input) return;
      const val = input.value.trim();
      if (!val) return;
      const d = getMealPlan();
      d.week[day][time].push(val);
      setMealPlan(d);
      renderWeek();
      const ni = section.querySelector(sel);
      if (ni) { ni.value = ''; try { ni.focus(); } catch (err) {} }
      Toast.show('已加入「' + val + '」');
    }

    /* 新增后重渲染会销毁聚焦中的输入框（手机键盘随之收起），
       故渲染完把焦点还给同一个输入框，并给 Toast 反馈。 */
    function addGroceryFromInput() {
      const input = section.querySelector('#mp-grocery-input');
      if (!input) return;
      const val = input.value.trim();
      if (!val) return;
      const d = getMealPlan();
      d.groceries.push({ id: Storage.genId(), name: val, bought: false });
      setMealPlan(d);
      renderGroceries();
      const ni = section.querySelector('#mp-grocery-input');
      if (ni) { ni.value = ''; try { ni.focus(); } catch (err) {} }
      Toast.show('已添加「' + val + '」');
    }

    section.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;  // 输入法组字中的回车只是选词
      const addMeal = e.target.closest('[data-add-day]');
      if (addMeal) {
        e.preventDefault();
        addMealFromInput(addMeal.dataset.addDay, addMeal.dataset.addTime);
        return;
      }
      if (e.target.closest('#mp-grocery-input')) {
        e.preventDefault();
        addGroceryFromInput();
        return;
      }
    });

    section.addEventListener('input', function (e) {
      if (e.target.id === 'mp-note-area') {
        const d = getMealPlan(); d.note = e.target.value; setMealPlan(d);
        return;
      }
      if (e.target.id === 'mp-recipe-search') {
        recipeSearch = e.target.value;
        renderRecipes();
        return;
      }
    });

    renderWeek();
    renderRecipes();
    renderGroceries();
    renderNote();
  }

  RENDERERS.diet = renderDietSection;

  /* ------------------------------------------------------------------
   * 生理期记录 板块
   * 存储 key：workbench.menstrual
   * { records: [{ id, startDate, endDate, cycleLength }] }
   * ------------------------------------------------------------------ */
  // 农历数据（1900-2100），用于月历农历显示
  const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520
  ];
  const LUNAR_MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  const LUNAR_DAY_NAMES = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

  function lunarYearDays(y) { let s = 348; for (let i = 0x8000; i > 0x8; i >>= 1) s += (LUNAR_INFO[y - 1900] & i) ? 1 : 0; return s + lunarLeapDays(y); }
  function lunarLeapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
  function lunarLeapDays(y) { return lunarLeapMonth(y) ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0; }
  function lunarMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }

  function solarToLunar(y, m, d) {
    const base = new Date(1900, 0, 31);
    const target = new Date(y, m - 1, d);
    let offset = Math.round((target - base) / 86400000);
    if (offset < 0) return null;
    let ly = 1900, temp = 0;
    for (ly = 1900; ly < 2101 && offset > 0; ly++) { temp = lunarYearDays(ly); offset -= temp; }
    if (offset < 0) { offset += temp; ly--; }
    const leap = lunarLeapMonth(ly);
    let isLeap = false, lm;
    for (lm = 1; lm < 13 && offset > 0; lm++) {
      if (leap > 0 && lm === leap + 1 && isLeap === false) { --lm; isLeap = true; temp = lunarLeapDays(ly); }
      else { temp = lunarMonthDays(ly, lm); }
      if (isLeap === true && lm === leap + 1) isLeap = false;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && lm === leap + 1) { if (isLeap) { isLeap = false; } else { isLeap = true; --lm; } }
    if (offset < 0) { offset += temp; --lm; }
    return { year: ly, month: lm, day: offset + 1, isLeap: isLeap };
  }

  function lunarLabel(y, m, d) {
    const l = solarToLunar(y, m, d);
    if (!l) return '';
    if (l.day === 1) return (l.isLeap ? '闰' : '') + LUNAR_MONTH_NAMES[l.month - 1];
    return LUNAR_DAY_NAMES[l.day];
  }

  function getMenstrual() {
    let d = Storage.get('menstrual', null);
    if (!d) d = { records: [] };
    if (!Array.isArray(d.records)) d.records = [];
    d.records.forEach(function (r) { if (!Array.isArray(r.symptoms)) r.symptoms = []; });
    return d;
  }
  function setMenstrual(d) { Storage.set('menstrual', d); }

  /* 经期常见症状（可多选记录） */
  const SYMPTOMS = ['痛经', '腰酸', '情绪波动', '疲倦', '头痛', '食欲变化'];

  function parseDate(key) {
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function daysBetween(keyA, keyB) {
    return Math.round((parseDate(keyB) - parseDate(keyA)) / 86400000);
  }

  function renderPeriodSection(section) {
    const today = todayKey();
    let curMonth = new Date();
    let editingId = null;
    let panelSymptoms = [];
    let touchX = null;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.heart + '</span>' +
        '<div>' +
          '<h2 class="section-title">生理期记录</h2>' +
          '<p class="section-desc">记录生理周期，预测经期与排卵日。</p>' +
        '</div>' +
      '</div>' +
      '<div class="pd-status" id="pd-status"></div>' +
      '<div class="pd-tip" id="pd-tip" hidden></div>' +
      '<div class="pd-cal">' +
        '<div class="pd-cal-head">' +
          '<button type="button" class="icon-btn" data-nav="-1" title="上个月">' + ICON_CHEV_L + '</button>' +
          '<span class="pd-cal-title" id="pd-cal-title"></span>' +
          '<button type="button" class="icon-btn" data-nav="1" title="下个月">' + ICON_CHEV_R + '</button>' +
        '</div>' +
        '<div id="pd-cal-body"></div>' +
      '</div>' +
      '<div class="sub-card" id="pd-trend-card">' +
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">周期趋势</h3>' +
            '<span class="sub-hint" id="pd-trend-hint">每次经期之间的间隔天数</span>' +
          '</div>' +
        '</div>' +
        '<div id="pd-trend"></div>' +
      '</div>' +
      '<div class="sub-card" id="pd-records-card">' +
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">历史记录</h3>' +
            '<span class="sub-hint">倒序展示 · 点击编辑或删除</span>' +
          '</div>' +
        '</div>' +
        '<div id="pd-records"></div>' +
      '</div>' +
      '<div class="cd-overlay" id="pd-overlay" hidden>' +
        '<div class="cd-sheet">' +
          '<h3 class="cd-sheet-title" id="pd-sheet-title">记录经期</h3>' +
          '<label class="cd-field"><span>开始日期</span>' +
            '<input class="input" id="pd-start" type="date"></label>' +
          '<label class="cd-field"><span>结束日期（可留空表示进行中）</span>' +
            '<input class="input" id="pd-end" type="date"></label>' +
          '<div class="pd-dur" id="pd-dur"></div>' +
          '<div class="cd-field"><span>身体感受（可多选）</span>' +
            '<div class="cd-tagpick" id="pd-sym">' +
              SYMPTOMS.map(function (s) { return '<button type="button" class="cd-tagopt" data-sym="' + s + '">' + s + '</button>'; }).join('') +
            '</div></div>' +
          '<div class="cd-sheet-actions">' +
            '<button type="button" class="btn btn-secondary" id="pd-cancel">取消</button>' +
            '<button type="button" class="btn btn-primary" id="pd-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* ---- 计算 ---- */
    function sortedRecords() {
      return getMenstrual().records.slice().sort(function (a, b) {
        return a.startDate < b.startDate ? -1 : 1;
      });
    }
    function avgCycle() {
      const recs = sortedRecords();
      if (recs.length < 2) return null;
      const recent = recs.slice(-6);
      const gaps = [];
      for (let i = 1; i < recent.length; i++) {
        const g = daysBetween(recent[i - 1].startDate, recent[i].startDate);
        if (g > 10 && g < 90) gaps.push(g);
      }
      if (!gaps.length) return null;
      return Math.round(gaps.reduce(function (s, g) { return s + g; }, 0) / gaps.length);
    }
    function prediction() {
      const recs = sortedRecords();
      if (!recs.length) return { nextStart: null, ovulation: null, avg: null };
      const last = recs[recs.length - 1];
      const avg = avgCycle() || 28; // 记录不足 2 条时按默认 28 天估算
      return {
        avg: avg,
        nextStart: shiftDate(last.startDate, avg),
        ovulation: shiftDate(last.startDate, avg - 14)
      };
    }

    /* ---- 渲染 ---- */
    function renderStatus() {
      const recs = sortedRecords();
      const pred = prediction();
      let title, main, sub;
      const current = recs.find(function (r) {
        const end = r.endDate || today;
        return r.startDate <= today && end >= today;
      });

      if (current) {
        const day = daysBetween(current.startDate, today) + 1;
        title = '经期中';
        main = '经期第 ' + day + ' 天';
        sub = current.endDate
          ? current.startDate + ' ~ ' + current.endDate + ' · 持续 ' + (daysBetween(current.startDate, current.endDate) + 1) + ' 天'
          : current.startDate + ' 开始 · 进行中';
      } else if (pred.nextStart) {
        const d = daysBetween(today, pred.nextStart);
        if (d > 0) {
          title = '预测';
          main = '距离下次经期还有 ' + d + ' 天';
          sub = '预计 ' + pred.nextStart + ' · 周期 ' + pred.avg + ' 天';
        } else if (d === 0) {
          title = '预测';
          main = '预计今天经期来临';
          sub = '预测日 ' + pred.nextStart;
        } else {
          title = '提示';
          main = '经期可能延迟 ' + (-d) + ' 天';
          sub = '预测日 ' + pred.nextStart + ' 已过';
        }
      } else {
        title = '等待记录';
        main = '还没有经期记录';
        sub = '点击日历日期开始记录';
      }

      section.querySelector('#pd-status').innerHTML =
        '<div class="pd-status-title">' + title + '</div>' +
        '<div class="pd-status-main">' + main + '</div>' +
        '<div class="pd-status-sub">' + sub + '</div>';
    }

    function renderTip() {
      const tip = section.querySelector('#pd-tip');
      const pred = prediction();
      if (pred.nextStart) {
        const d = daysBetween(today, pred.nextStart);
        if (d >= 0 && d <= 3) {
          tip.textContent = d === 0 ? '预计今天经期来临，记得提前准备～' : ('预计 ' + d + ' 天后经期来临，记得提前准备～');
          tip.hidden = false;
          return;
        }
      }
      tip.hidden = true;
    }

    function renderCalendar() {
      const y = curMonth.getFullYear();
      const m = curMonth.getMonth();
      section.querySelector('#pd-cal-title').textContent = y + '年' + (m + 1) + '月';

      const firstDay = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();

      const periodSet = {};
      getMenstrual().records.forEach(function (r) {
        let d = r.startDate;
        const end = r.endDate || r.startDate;
        while (d <= end) {
          periodSet[d] = true;
          d = shiftDate(d, 1);
        }
      });
      const pred = prediction();
      const nextDate = pred.nextStart;
      const ovuDate = pred.ovulation;

      let html = '<div class="pd-weekrow">';
      ['日', '一', '二', '三', '四', '五', '六'].forEach(function (w) {
        html += '<span class="pd-week">' + w + '</span>';
      });
      html += '</div><div class="pd-grid">';

      for (let i = 0; i < firstDay; i++) html += '<span class="pd-cell empty"></span>';

      for (let d = 1; d <= daysInMonth; d++) {
        const key = dateKey(new Date(y, m, d));
        const cls = [];
        if (key === today) cls.push('today');
        if (periodSet[key]) cls.push('period');
        if (key === nextDate) cls.push('next');
        if (key === ovuDate) cls.push('ovulation');
        html += '<button type="button" class="pd-cell' + (cls.length ? ' ' + cls.join(' ') : '') + '" data-date="' + key + '">' +
          '<span class="pd-day">' + d + '</span>' +
          '<span class="pd-lunar">' + lunarLabel(y, m + 1, d) + '</span>' +
          '<span class="pd-marks">' +
            (periodSet[key] ? '<i class="pd-dot p"></i>' : '') +
            (key === ovuDate ? '<i class="pd-dot o"></i>' : '') +
          '</span>' +
        '</button>';
      }
      html += '</div>';

      let nextHint = '';
      if (pred.nextStart) {
        const nd = parseDate(pred.nextStart);
        const sameMonth = nd.getFullYear() === y && nd.getMonth() === m;
        if (!sameMonth) {
          nextHint = '<button type="button" class="pd-next-hint" data-jump="' + pred.nextStart + '">下次经期 ' + (nd.getMonth() + 1) + '月' + nd.getDate() + '日 · 点此查看</button>';
        }
      }

      html += nextHint +
        '<div class="pd-legend">' +
          '<span><i class="pd-dot p"></i>经期</span>' +
          '<span><i class="pd-legend-ring"></i>预测经期</span>' +
          '<span><i class="pd-dot o"></i>排卵日</span>' +
        '</div>';

      section.querySelector('#pd-cal-body').innerHTML = html;
    }

    function renderRecords() {
      const recs = sortedRecords().slice().reverse();
      const box = section.querySelector('#pd-records');
      if (!recs.length) {
        box.innerHTML = emptyBox('还没有记录，点击日历日期开始记录');
        return;
      }
      box.innerHTML = recs.map(function (r) {
        const dur = r.endDate ? (daysBetween(r.startDate, r.endDate) + 1) : null;
        const syms = (r.symptoms || []).map(function (s) {
          return '<span class="pd-sym-tag">' + esc(s) + '</span>';
        }).join('');
        return '<div class="pd-record">' +
          '<div class="pd-record-main">' +
            '<span class="pd-record-range">' + r.startDate + (r.endDate ? ' ~ ' + r.endDate : ' ~ 进行中') + '</span>' +
            '<span class="pd-record-dur">' + (dur ? '持续 ' + dur + ' 天' : '进行中') + '</span>' +
            (syms ? '<div class="pd-sym-row">' + syms + '</div>' : '') +
          '</div>' +
          '<button type="button" class="act" data-edit="' + r.id + '" title="编辑">' + ICON_EDIT + '</button>' +
          '<button type="button" class="del" data-del="' + r.id + '" title="删除">' + ICON_TRASH + '</button>' +
        '</div>';
      }).join('');
    }

    /* ---- 周期趋势：相邻两次经期开始日的间隔 ---- */
    function cycleList() {
      const recs = sortedRecords();
      const out = [];
      for (let i = 1; i < recs.length; i++) {
        const g = daysBetween(recs[i - 1].startDate, recs[i].startDate);
        if (g > 10 && g < 90) {
          const p = recs[i].startDate.split('-').map(Number);
          out.push({ days: g, label: p[1] + '/' + p[2] });
        }
      }
      return out.slice(-8);
    }
    function cycleSVG(list, avg) {
      const W = 320, H = 132, padT = 16, padB = 24, padL = 8, padR = 8;
      const chartH = H - padT - padB;
      let max = 1;
      list.forEach(function (c) { max = Math.max(max, c.days); });
      const scaleMax = max + 4;
      const slot = (W - padL - padR) / list.length;
      const bw = Math.min(26, slot * 0.52);
      let bars = '';
      list.forEach(function (c, i) {
        const cx = padL + i * slot + slot / 2;
        const h = Math.max(chartH * (c.days / scaleMax), 4);
        const y = padT + chartH - h;
        const isLast = i === list.length - 1;
        bars += '<rect x="' + (cx - bw / 2) + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="5" ' +
          'style="fill:var(--accent)" opacity="' + (isLast ? '1' : '0.45') + '"></rect>' +
          '<text x="' + cx + '" y="' + (y - 4) + '" text-anchor="middle" font-size="10" style="fill:var(--text-secondary)">' + c.days + '</text>' +
          '<text x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle" font-size="9" style="fill:var(--text-secondary)">' + c.label + '</text>';
      });
      let avgLine = '';
      if (avg) {
        const ay = padT + chartH - chartH * (avg / scaleMax);
        avgLine = '<line x1="' + padL + '" y1="' + ay + '" x2="' + (W - padR) + '" y2="' + ay + '" ' +
          'stroke-dasharray="4 4" style="stroke:var(--accent-active);stroke-width:1.4;opacity:0.75"></line>' +
          '<text x="' + (W - padR) + '" y="' + (ay - 4) + '" text-anchor="end" font-size="9" style="fill:var(--accent-active)">平均 ' + avg + ' 天</text>';
      }
      return '<svg class="pd-trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
        bars + avgLine + '</svg>';
    }
    function renderTrend() {
      const list = cycleList();
      const box = section.querySelector('#pd-trend');
      const hint = section.querySelector('#pd-trend-hint');
      if (list.length < 2) {
        hint.textContent = '至少需要 3 条记录才能看出周期变化';
        box.innerHTML = emptyBox('记录 3 次以上经期，这里会画出周期长短的变化', true);
        return;
      }
      const days = list.map(function (c) { return c.days; });
      const min = Math.min.apply(null, days);
      const max = Math.max.apply(null, days);
      const sum = days.reduce(function (a, b) { return a + b; }, 0);
      const avg = Math.round(sum / days.length);
      hint.textContent = '平均 ' + avg + ' 天 · 最短 ' + min + ' · 最长 ' + max + ' · 共 ' + days.length + ' 次';
      box.innerHTML = cycleSVG(list, avg);
    }

    function renderAll() {
      renderStatus();
      renderTip();
      renderCalendar();
      renderTrend();
      renderRecords();
    }

    /* ---- 面板 ---- */
    function updateDuration() {
      const s = section.querySelector('#pd-start').value;
      const e = section.querySelector('#pd-end').value;
      const el = section.querySelector('#pd-dur');
      if (s && e && e >= s) {
        el.textContent = '持续 ' + (daysBetween(s, e) + 1) + ' 天';
        el.className = 'pd-dur ok';
      } else if (s) {
        el.textContent = '开始 ' + s + ' · 进行中';
        el.className = 'pd-dur';
      } else {
        el.textContent = '';
        el.className = 'pd-dur';
      }
    }
    function updateSymChips() {
      section.querySelectorAll('#pd-sym .cd-tagopt').forEach(function (b) {
        b.classList.toggle('active', panelSymptoms.indexOf(b.dataset.sym) >= 0);
      });
    }
    function openPanel(rec) {
      editingId = rec ? rec.id : null;
      panelSymptoms = rec ? (rec.symptoms || []).slice() : [];
      section.querySelector('#pd-sheet-title').textContent = rec ? '编辑记录' : '记录经期';
      section.querySelector('#pd-start').value = rec ? rec.startDate : '';
      section.querySelector('#pd-end').value = rec ? (rec.endDate || '') : '';
      updateSymChips();
      updateDuration();
      section.querySelector('#pd-overlay').hidden = false;
    }
    function openPanelForDate(dateKey) {
      const d = getMenstrual();
      const ongoing = d.records.find(function (r) { return !r.endDate; });
      if (ongoing && dateKey >= ongoing.startDate) {
        section.querySelector('#pd-sheet-title').textContent = '标记经期结束';
        editingId = ongoing.id;
        panelSymptoms = (ongoing.symptoms || []).slice();
        section.querySelector('#pd-start').value = ongoing.startDate;
        section.querySelector('#pd-end').value = dateKey;
      } else {
        section.querySelector('#pd-sheet-title').textContent = '记录经期';
        editingId = null;
        panelSymptoms = [];
        section.querySelector('#pd-start').value = dateKey;
        section.querySelector('#pd-end').value = '';
      }
      updateSymChips();
      updateDuration();
      section.querySelector('#pd-overlay').hidden = false;
    }
    function closePanel() { section.querySelector('#pd-overlay').hidden = true; editingId = null; panelSymptoms = []; }
    function savePanel() {
      const s = section.querySelector('#pd-start').value;
      const e = section.querySelector('#pd-end').value;
      if (!s) { UI.alert('请选择开始日期'); return; }
      if (e && e < s) { UI.alert('结束日期不能早于开始日期'); return; }
      const d = getMenstrual();
      if (editingId) {
        const r = d.records.find(function (x) { return x.id === editingId; });
        if (r) { r.startDate = s; r.endDate = e || ''; r.cycleLength = avgCycle() || 0; r.symptoms = panelSymptoms.slice(); }
      } else {
        d.records.push({ id: Storage.genId(), startDate: s, endDate: e || '', cycleLength: avgCycle() || 0, symptoms: panelSymptoms.slice() });
      }
      setMenstrual(d);
      closePanel();
      renderAll();
    }

    /* ---- 事件 ---- */
    function changeMonth(delta) {
      curMonth = new Date(curMonth.getFullYear(), curMonth.getMonth() + delta, 1);
      renderCalendar();
    }

    section.addEventListener('click', function (e) {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) { changeMonth(Number(navBtn.dataset.nav)); return; }

      const symBtn = e.target.closest('#pd-sym .cd-tagopt');
      if (symBtn) {
        const s = symBtn.dataset.sym;
        const i = panelSymptoms.indexOf(s);
        if (i >= 0) panelSymptoms.splice(i, 1); else panelSymptoms.push(s);
        updateSymChips();
        return;
      }

      const jumpBtn = e.target.closest('[data-jump]');
      if (jumpBtn) {
        const jd = parseDate(jumpBtn.dataset.jump);
        curMonth = new Date(jd.getFullYear(), jd.getMonth(), 1);
        renderCalendar();
        return;
      }

      const cell = e.target.closest('.pd-cell[data-date]');
      if (cell) { openPanelForDate(cell.dataset.date); return; }

      if (e.target.closest('#pd-save')) { savePanel(); return; }
      if (e.target.closest('#pd-cancel')) { closePanel(); return; }

      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const rec = getMenstrual().records.find(function (x) { return x.id === editBtn.dataset.edit; });
        if (rec) openPanel(rec);
        return;
      }
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        const id = delBtn.dataset.del;
        deleteWithUndo({
          get: getMenstrual, set: setMenstrual,
          apply: function () { const d = getMenstrual(); d.records = d.records.filter(function (x) { return x.id !== id; }); setMenstrual(d); },
          render: renderAll,
          message: '已删除该记录'
        });
        return;
      }
    });

    section.addEventListener('input', function (e) {
      if (e.target.id === 'pd-start' || e.target.id === 'pd-end') updateDuration();
    });

    section.addEventListener('touchstart', function (e) {
      touchX = e.touches[0].clientX;
    }, { passive: true });
    section.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) changeMonth(dx < 0 ? 1 : -1);
      touchX = null;
    }, { passive: true });

    renderAll();
  }

  RENDERERS.period = renderPeriodSection;

  /* ------------------------------------------------------------------
   * 愿望清单 板块
   * 存储 key：workbench.wishlist
   * { items: [{ id, text, tag, done, createdAt }] }
   * ------------------------------------------------------------------ */
  const WISH_TAGS = ['旅行', '梦想', '目标', '体验', '学习', '其他'];
  const ICON_UP = icon('<polyline points="18 15 12 9 6 15"></polyline>');
  const ICON_DOWN = icon('<polyline points="6 9 12 15 18 9"></polyline>');

  function getWishlist() {
    let d = Storage.get('wishlist', null);
    if (!d) d = { items: [] };
    if (!Array.isArray(d.items)) d.items = [];
    return d;
  }
  function setWishlist(d) { Storage.set('wishlist', d); }

  function renderWishlistSection(section) {
    let filter = 'all';
    let selectedTag = '';

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.star + '</span>' +
        '<div>' +
          '<h2 class="section-title">愿望清单</h2>' +
          '<p class="section-desc">记录人生梦想、旅行目的地、目标与想体验的事。</p>' +
        '</div>' +
      '</div>' +
      '<div class="wl-progress" id="wl-progress"></div>' +
      '<div class="sub-card">' +
        '<div class="sub-head">' +
          '<div class="sub-head-left"><h3 class="sub-title">新增愿望</h3></div>' +
        '</div>' +
        '<div class="input-row">' +
          '<input class="input" id="wl-input" type="text" maxlength="60" placeholder="写下你的愿望" enterkeyhint="done" autocomplete="off">' +
        '</div>' +
        '<div class="wl-tags" id="wl-tags"></div>' +
        '<div class="wl-add-row">' +
          '<button type="button" class="btn btn-primary" id="wl-add">添加愿望</button>' +
        '</div>' +
      '</div>' +
      '<div class="sub-card">' +
        '<div class="sub-head">' +
          '<div class="sub-head-left">' +
            '<h3 class="sub-title">我的愿望</h3>' +
            '<span class="sub-hint">点圆圈标记完成 · ↑↓ 调整顺序</span>' +
          '</div>' +
        '</div>' +
        '<div class="wl-filter" id="wl-filter"></div>' +
        '<div id="wl-list"></div>' +
      '</div>' +
      '<div class="sub-card">' +
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">达成纪念墙</h3>' +
          '<span class="sub-hint">已实现的愿望会留在这里</span>' +
        '</div></div>' +
        '<div id="wl-wall"></div>' +
      '</div>';

    /* ---- 数据操作 ---- */
    function addItem() {
      const input = section.querySelector('#wl-input');
      const text = input.value.trim();
      if (!text) { UI.alert('请填写愿望内容'); return; }
      const d = getWishlist();
      d.items.push({ id: Storage.genId(), text: text, tag: selectedTag, done: false, createdAt: Date.now() });
      setWishlist(d);
      input.value = '';
      renderAll();
    }
    function toggleDone(id) {
      const d = getWishlist();
      const item = d.items.find(function (i) { return i.id === id; });
      if (item) {
        item.done = !item.done;
        item.doneAt = item.done ? Date.now() : null;
        setWishlist(d);
        renderAll();
      }
    }
    function removeItem(id) {
      const d = getWishlist();
      d.items = d.items.filter(function (i) { return i.id !== id; });
      setWishlist(d);
      renderAll();
    }
    function moveItem(id, dir) {
      const d = getWishlist();
      const idx = d.items.findIndex(function (i) { return i.id === id; });
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= d.items.length) return;
      const tmp = d.items[idx];
      d.items[idx] = d.items[target];
      d.items[target] = tmp;
      setWishlist(d);
      renderAll();
    }

    /* ---- 渲染 ---- */
    function renderProgress() {
      const items = getWishlist().items;
      const total = items.length;
      const done = items.filter(function (i) { return i.done; }).length;
      const pct = total ? Math.round(done / total * 100) : 0;
      let meta;
      if (!total) meta = '还没有愿望，添加一个开始吧';
      else if (done === total) meta = '全部实现啦，真棒！';
      else meta = pct + '% 完成 · 还有 ' + (total - done) + ' 个待实现';
      section.querySelector('#wl-progress').innerHTML =
        '<div class="wl-progress-head">' +
          '<span class="wl-progress-label">整体完成进度</span>' +
          '<span class="wl-progress-num">已完成 ' + done + ' / ' + total + '</span>' +
        '</div>' +
        '<div class="wl-progress-bar"><div class="wl-progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="wl-progress-meta">' + meta + '</div>';
    }
    function renderTags() {
      const box = section.querySelector('#wl-tags');
      let html = '<button type="button" class="cd-tagopt' + (selectedTag === '' ? ' active' : '') + '" data-wltag="">无标签</button>';
      WISH_TAGS.forEach(function (t) {
        html += '<button type="button" class="cd-tagopt' + (selectedTag === t ? ' active' : '') + '" data-wltag="' + t + '">' + t + '</button>';
      });
      box.innerHTML = html;
    }
    function renderFilter() {
      const box = section.querySelector('#wl-filter');
      const opts = [
        { key: 'all', label: '全部' },
        { key: 'todo', label: '待实现' },
        { key: 'done', label: '已实现' }
      ];
      box.innerHTML = opts.map(function (o) {
        return '<button type="button" class="cd-tagopt' + (filter === o.key ? ' active' : '') + '" data-wlfilter="' + o.key + '">' + o.label + '</button>';
      }).join('');
    }
    function renderList() {
      const items = getWishlist().items;
      const filtered = items.filter(function (i) {
        if (filter === 'todo') return !i.done;
        if (filter === 'done') return i.done;
        return true;
      });
      const box = section.querySelector('#wl-list');
      if (!filtered.length) {
        let msg = '还没有愿望，添加一个吧';
        if (items.length) msg = filter === 'done' ? '还没有已实现的愿望' : '没有待实现的愿望';
        box.innerHTML = emptyBox(msg);
        return;
      }
      box.innerHTML = filtered.map(function (item) {
        const realIdx = items.indexOf(item);
        const first = realIdx === 0;
        const last = realIdx === items.length - 1;
        return '<div class="wl-item' + (item.done ? ' done' : '') + '">' +
          '<button type="button" class="wl-check' + (item.done ? ' done' : '') + '" data-toggle="' + item.id + '" title="标记完成/待实现"></button>' +
          '<div class="wl-item-main">' +
            '<span class="wl-item-text">' + esc(item.text) + '</span>' +
            (item.tag ? '<span class="wl-item-tag">' + esc(item.tag) + '</span>' : '') +
          '</div>' +
          '<div class="wl-item-actions">' +
            '<button type="button" class="wl-move" data-move="' + item.id + '" data-dir="-1" title="上移"' + (first ? ' disabled' : '') + '>' + ICON_UP + '</button>' +
            '<button type="button" class="wl-move" data-move="' + item.id + '" data-dir="1" title="下移"' + (last ? ' disabled' : '') + '>' + ICON_DOWN + '</button>' +
            '<button type="button" class="del" data-del="' + item.id + '" title="删除">' + ICON_TRASH + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    /* 达成纪念墙：展示已实现的愿望（含达成日期） */
    function renderWall() {
      const done = getWishlist().items.filter(function (i) { return i.done; })
        .sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
      const box = section.querySelector('#wl-wall');
      if (!done.length) {
        box.innerHTML = emptyBox('还没有实现的心愿，完成一个就会点亮这里', true);
        return;
      }
      box.innerHTML = '<div class="wl-wall-grid">' + done.map(function (i) {
        let t = '';
        if (i.doneAt) {
          const d = new Date(i.doneAt);
          t = d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
        }
        return '<div class="wl-wall-card">' +
          '<span class="wl-wall-star">★</span>' +
          '<span class="wl-wall-text">' + esc(i.text) + '</span>' +
          (i.tag ? '<span class="wl-wall-tag">' + esc(i.tag) + '</span>' : '') +
          (t ? '<span class="wl-wall-date">达成于 ' + t + '</span>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    function renderAll() {
      renderProgress();
      renderTags();
      renderFilter();
      renderList();
      renderWall();
    }

    /* ---- 事件 ---- */
    section.addEventListener('click', function (e) {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) { toggleDone(toggle.dataset.toggle); return; }
      const move = e.target.closest('[data-move]');
      if (move) { moveItem(move.dataset.move, Number(move.dataset.dir)); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        const id = del.dataset.del;
        deleteWithUndo({ get: getWishlist, set: setWishlist, apply: function () { removeItem(id); }, render: renderAll, message: '已删除该愿望' });
        return;
      }
      const tagOpt = e.target.closest('[data-wltag]');
      if (tagOpt) { selectedTag = tagOpt.dataset.wltag; renderTags(); return; }
      const filterOpt = e.target.closest('[data-wlfilter]');
      if (filterOpt) { filter = filterOpt.dataset.wlfilter; renderFilter(); renderList(); return; }
      if (e.target.closest('#wl-add')) { addItem(); return; }
    });

    section.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;  // 输入法组字中的回车只是选词
      if (e.target.id === 'wl-input') { e.preventDefault(); addItem(); }
    });

    renderAll();
  }

  RENDERERS.wishlist = renderWishlistSection;

  /* ------------------------------------------------------------------
   * 专注 板块
   * 存储 key：workbench.focus
   * { sessions: [{ id, minutes, tag, endedAt }], settings: { focusMin, breakMin, tag } }
   * ------------------------------------------------------------------ */
  const FOCUS_TAGS = ['学习', '阅读', '写作', '工作', '整理'];
  const FOCUS_PRESETS = [15, 25, 45, 60];
  const FOCUS_RING = 2 * Math.PI * 90; // 环形周长（r = 90）

  function getFocus() {
    let d = Storage.get('focus', null);
    if (!d || typeof d !== 'object') d = {};
    if (!Array.isArray(d.sessions)) d.sessions = [];
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    if (!d.settings.focusMin) d.settings.focusMin = 25;
    if (!d.settings.breakMin) d.settings.breakMin = 5;
    if (!d.settings.tag) d.settings.tag = '学习';
    return d;
  }
  function setFocus(d) { Storage.set('focus', d); }

  function renderFocusSection(section) {
    let phase = 'idle';   // idle | focus | brk | paused
    let pausedFrom = null;
    let total = 0;        // 当前阶段总秒数
    let remain = 0;       // 剩余秒数
    let endAt = 0;        // 结束时间戳
    let timer = null;

    section.innerHTML =
      '<div class="section-head">' +
        '<span class="section-icon">' + ICON.hourglass + '</span>' +
        '<div>' +
          '<h2 class="section-title">专注</h2>' +
          '<p class="section-desc">专注学习计时，记录每一段心流时光。</p>' +
        '</div>' +
      '</div>' +
      '<div class="fc-timer-card">' +
        '<div class="fc-ring-wrap">' +
          '<svg class="fc-ring" viewBox="0 0 200 200" aria-hidden="true">' +
            '<circle class="fc-ring-bg" cx="100" cy="100" r="90"></circle>' +
            '<circle class="fc-ring-fg" id="fc-ring-fg" cx="100" cy="100" r="90"></circle>' +
          '</svg>' +
          '<div class="fc-ring-inner">' +
            '<div class="fc-time" id="fc-time">25:00</div>' +
            '<div class="fc-phase" id="fc-phase">准备开始</div>' +
          '</div>' +
        '</div>' +
        '<div class="fc-controls">' +
          '<button type="button" class="btn btn-primary" id="fc-start">开始专注</button>' +
          '<button type="button" class="btn btn-secondary" id="fc-reset">重置</button>' +
        '</div>' +
      '</div>' +
      '<div class="sub-card">' +
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">时长与标签</h3>' +
          '<span class="sub-hint">计时进行中不可修改</span>' +
        '</div></div>' +
        '<div class="fc-presets" id="fc-presets"></div>' +
        '<div class="fc-tags" id="fc-tags"></div>' +
      '</div>' +
      '<div class="sub-card">' +
        '<div class="sub-head"><div class="sub-head-left"><h3 class="sub-title">专注统计</h3></div></div>' +
        '<div class="fc-stats" id="fc-stats"></div>' +
      '</div>' +
      '<div class="sub-card">' +
        '<div class="sub-head"><div class="sub-head-left">' +
          '<h3 class="sub-title">专注记录</h3>' +
          '<span class="sub-hint">倒序展示</span>' +
        '</div></div>' +
        '<div id="fc-records"></div>' +
      '</div>';

    /* ---- 数据 ---- */
    function settings() { return getFocus().settings; }
    function saveSettings(patch) {
      const d = getFocus();
      Object.keys(patch).forEach(function (k) { d.settings[k] = patch[k]; });
      setFocus(d);
    }
    function dayOf(ts) { return dateKey(new Date(ts)); }
    function stampText(ts) {
      const d = new Date(ts);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
        (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
        (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }

    /* ---- 计时 ---- */
    function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function fmt(sec) {
      const m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function startPhase(kind) {
      const st = settings();
      total = (kind === 'focus' ? st.focusMin : st.breakMin) * 60;
      remain = total;
      phase = kind;
      pausedFrom = null;
      endAt = Date.now() + remain * 1000;
      clearTimer();
      timer = setInterval(tick, 250);
      renderAll();
    }
    function tick() {
      remain = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      renderTimer();
      if (remain <= 0) completePhase();
    }
    function togglePause() {
      if (phase === 'paused') {
        phase = pausedFrom || 'focus';
        pausedFrom = null;
        endAt = Date.now() + remain * 1000;
        clearTimer();
        timer = setInterval(tick, 250);
        renderAll();
      } else if (phase === 'focus' || phase === 'brk') {
        pausedFrom = phase;
        phase = 'paused';
        clearTimer();
        renderAll();
      }
    }
    function reset() {
      clearTimer();
      phase = 'idle';
      pausedFrom = null;
      total = 0;
      remain = 0;
      renderAll();
    }
    function completePhase() {
      clearTimer();
      const st = settings();
      if (phase === 'focus') {
        const d = getFocus();
        d.sessions.push({
          id: Storage.genId(),
          minutes: Math.round(total / 60),
          tag: st.tag,
          endedAt: Date.now()
        });
        setFocus(d);
        phase = 'idle'; total = 0; remain = 0;
        renderAll();
        Toast.show('专注完成，真棒！休息 ' + st.breakMin + ' 分钟？', {
          action: { label: '开始休息', onClick: function () { startPhase('brk'); } },
          duration: 6000
        });
      } else {
        phase = 'idle'; total = 0; remain = 0;
        renderAll();
        Toast.show('休息结束，继续加油！');
      }
    }

    /* ---- 渲染 ---- */
    function renderTimer() {
      const st = settings();
      const displaySec = (phase === 'idle') ? st.focusMin * 60 : remain;
      section.querySelector('#fc-time').textContent = fmt(displaySec);
      section.querySelector('#fc-phase').textContent =
        phase === 'focus' ? '专注中' :
        phase === 'brk' ? '休息中' :
        phase === 'paused' ? '已暂停' : '准备开始';
      const ratio = total ? Math.max(0, Math.min(1, remain / total)) : 1;
      const ring = section.querySelector('#fc-ring-fg');
      ring.style.strokeDasharray = String(FOCUS_RING);
      ring.style.strokeDashoffset = String(FOCUS_RING * (1 - ratio));
      const card = section.querySelector('.fc-timer-card');
      card.classList.toggle('running', phase === 'focus');
      card.classList.toggle('breaking', phase === 'brk');
      card.classList.toggle('paused', phase === 'paused');
      section.querySelector('#fc-start').textContent =
        phase === 'idle' ? '开始专注' : (phase === 'paused' ? '继续' : '暂停');
    }
    function renderPresets() {
      const cur = settings().focusMin;
      section.querySelector('#fc-presets').innerHTML = FOCUS_PRESETS.map(function (m) {
        return '<button type="button" class="cd-tagopt' + (cur === m ? ' active' : '') + '" data-fc-min="' + m + '">' + m + ' 分钟</button>';
      }).join('');
    }
    function renderTags() {
      const cur = settings().tag;
      section.querySelector('#fc-tags').innerHTML = FOCUS_TAGS.map(function (t) {
        return '<button type="button" class="cd-tagopt' + (cur === t ? ' active' : '') + '" data-fc-tag="' + t + '">' + t + '</button>';
      }).join('');
    }
    function renderStats() {
      const sessions = getFocus().sessions;
      const tk = dateKey(new Date());
      let todayMin = 0, todayCnt = 0, allMin = 0;
      sessions.forEach(function (s) {
        allMin += s.minutes || 0;
        if (dayOf(s.endedAt) === tk) { todayMin += s.minutes || 0; todayCnt++; }
      });
      const hours = Math.round(allMin / 6) / 10;
      section.querySelector('#fc-stats').innerHTML =
        '<div class="fc-stat"><span class="fc-stat-num">' + todayMin + '</span><span class="fc-stat-label">今日分钟</span></div>' +
        '<div class="fc-stat"><span class="fc-stat-num">' + todayCnt + '</span><span class="fc-stat-label">今日次数</span></div>' +
        '<div class="fc-stat"><span class="fc-stat-num">' + (hours || 0) + '</span><span class="fc-stat-label">累计小时</span></div>' +
        '<div class="fc-stat"><span class="fc-stat-num">' + sessions.length + '</span><span class="fc-stat-label">累计次数</span></div>';
    }
    function renderRecords() {
      const sessions = getFocus().sessions.slice().sort(function (a, b) { return (b.endedAt || 0) - (a.endedAt || 0); });
      const box = section.querySelector('#fc-records');
      if (!sessions.length) {
        box.innerHTML = emptyBox('还没有专注记录，开始第一段专注吧');
        return;
      }
      box.innerHTML = sessions.slice(0, 60).map(function (s) {
        return '<div class="fc-record">' +
          '<span class="fc-record-dot"></span>' +
          '<div class="fc-record-main">' +
            '<span class="fc-record-time">' + (s.minutes || 0) + ' 分钟</span>' +
            '<span class="fc-record-meta">' + (s.tag ? esc(s.tag) + ' · ' : '') + stampText(s.endedAt) + '</span>' +
          '</div>' +
          '<button type="button" class="del" data-fc-del="' + s.id + '" title="删除">' + ICON_TRASH + '</button>' +
        '</div>';
      }).join('');
    }
    function renderAll() {
      renderTimer();
      renderPresets();
      renderTags();
      renderStats();
      renderRecords();
    }

    /* ---- 事件 ---- */
    section.addEventListener('click', function (e) {
      if (e.target.closest('#fc-start')) {
        if (phase === 'idle') startPhase('focus');
        else togglePause();
        return;
      }
      if (e.target.closest('#fc-reset')) { reset(); return; }

      const minBtn = e.target.closest('[data-fc-min]');
      if (minBtn) {
        if (phase === 'idle') { saveSettings({ focusMin: Number(minBtn.dataset.fcMin) }); renderAll(); }
        else { Toast.show('计时进行中，暂时不能改时长'); }
        return;
      }
      const tagBtn = e.target.closest('[data-fc-tag]');
      if (tagBtn) { saveSettings({ tag: tagBtn.dataset.fcTag }); renderAll(); return; }

      const delBtn = e.target.closest('[data-fc-del]');
      if (delBtn) {
        const id = delBtn.dataset.fcDel;
        deleteWithUndo({
          get: getFocus, set: setFocus,
          apply: function () {
            const d = getFocus();
            d.sessions = d.sessions.filter(function (x) { return x.id !== id; });
            setFocus(d);
          },
          render: function () { renderStats(); renderRecords(); },
          message: '已删除该专注记录'
        });
        return;
      }
    });

    renderAll();
  }

  RENDERERS.focus = renderFocusSection;

  /* ------------------------------------------------------------------
   * 渲染
   * ------------------------------------------------------------------ */

  function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    MODULES.forEach(function (m) {
      nav.appendChild(buildNavItem(m));
    });

    const footer = document.getElementById('sidebar-footer');
    footer.appendChild(buildNavItem(SETTINGS));
  }

  function buildNavItem(item) {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.id = item.id;
    // 手机端导航只显示图标，故补上名称提示（无障碍 / 长按可见）
    btn.title = item.name;
    btn.setAttribute('aria-label', item.name);
    const iconHtml = MODULE_IMAGES[item.id]
      ? '<img class="nav-item-icon" src="' + MODULE_IMAGES[item.id] + '" alt="" loading="lazy">'
      : ICON[item.icon];
    btn.innerHTML = iconHtml + '<span>' + item.name + '</span>';
    btn.addEventListener('click', function () { activate(item.id); });
    return btn;
  }

  function renderSections() {
    const content = document.getElementById('content');

    MODULES.forEach(function (m) {
      const section = document.createElement('section');
      section.className = 'section';
      section.id = 'section-' + m.id;
      section.dataset.module = m.key;
      section.style.background = Theme.resolved() === 'dark' ? (m.darkColor || m.color) : m.color;

      if (RENDERERS[m.id]) {
        RENDERERS[m.id](section);
      } else {
        section.innerHTML = placeholderHTML(m);
      }

      // 替换板块标题图标为精美图片图标
      const iconEl = section.querySelector('.section-icon');
      if (iconEl && MODULE_IMAGES[m.id]) {
        iconEl.innerHTML = '<img class="section-icon-img" src="' + MODULE_IMAGES[m.id] + '" alt="" loading="lazy">';
      }

      content.appendChild(section);
    });

    // 设置页
    const settingsSection = document.createElement('section');
    settingsSection.className = 'section';
    settingsSection.id = 'section-settings';
    settingsSection.innerHTML =
      '<div class="settings-head">' +
        '<span class="section-icon"><img class="section-icon-img" src="icons/modules/module-settings.png" alt="" loading="lazy"></span>' +
        '<h2 class="settings-title">设置</h2>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-card">' +
          '<h3>外观</h3>' +
          '<p>选择界面配色主题，深色模式更适合夜间使用。</p>' +
          '<div class="theme-picker" id="theme-picker">' +
            '<button type="button" class="theme-opt" data-theme-opt="light">浅色</button>' +
            '<button type="button" class="theme-opt" data-theme-opt="dark">深色</button>' +
            '<button type="button" class="theme-opt" data-theme-opt="auto">跟随系统</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card">' +
          '<h3>数据备份</h3>' +
          '<p>将所有板块数据导出为 JSON 文件保存，或从备份文件恢复数据。也可以导出成 CSV 表格，方便在 Excel 里统计。所有数据仅保存在本地浏览器。</p>' +
          '<div class="settings-actions">' +
            '<button class="btn btn-primary" id="btn-export">导出全部数据备份</button>' +
            '<button class="btn btn-secondary" id="btn-import">导入备份文件</button>' +
            '<button class="btn btn-secondary" id="btn-csv">导出为 CSV 表格</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card">' +
          '<h3>自动快照</h3>' +
          '<p>每次打开工作台会自动保存一份历史版本，最多保留 5 份。误操作时可一键回滚到某个时间点。</p>' +
          '<div class="snap-list" id="snap-list"></div>' +
        '</div>' +
        '<div class="settings-card">' +
          '<h3>数据分享图</h3>' +
          '<p>把工作台的关键数据生成一张长图，方便保存或分享给朋友。</p>' +
          '<div class="settings-actions">' +
            '<button class="btn btn-secondary" id="btn-share">生成分享图</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card">' +
          '<h3>本地提醒</h3>' +
          '<p>开启后，倒数日临近时会在浏览器推送通知提醒你（需授权通知权限，仅保存在本机，每天最多一次）。</p>' +
          '<div class="settings-actions">' +
            '<button class="btn btn-secondary" id="btn-notify">开启提醒</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="privacy-note">柔序工作台 · 数据仅保存在你的本地浏览器，不会上传任何服务器</p>';

    content.appendChild(settingsSection);
  }

  /* ------------------------------------------------------------------
   * 导航切换：同一时间只显示一个板块
   * ------------------------------------------------------------------ */
  function activate(id) {
    // 内容区
    document.querySelectorAll('.section').forEach(function (s) {
      s.classList.toggle('active', s.id === 'section-' + id);
    });

    // 侧边导航
    document.querySelectorAll('#sidebar-nav .nav-item, #sidebar-footer .nav-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.id === id);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------
   * 隐私提醒弹窗：首次打开弹出，关闭后本地标记不再重复
   * ------------------------------------------------------------------ */
  function initPrivacy() {
    const accepted = localStorage.getItem('workbench.privacyAccepted');
    const modal = document.getElementById('privacy-modal');

    if (accepted === '1') {
      modal.hidden = true;
      return;
    }

    modal.hidden = false;
    document.getElementById('privacy-close').addEventListener('click', function () {
      localStorage.setItem('workbench.privacyAccepted', '1');
      modal.hidden = true;
    });
  }

  /* ------------------------------------------------------------------
   * 设置页：导出 / 导入备份
   * ------------------------------------------------------------------ */
  function bindSettings() {
    const exportBtn = document.getElementById('btn-export');
    const importBtn = document.getElementById('btn-import');
    const fileInput = document.getElementById('import-file');

    // 主题切换
    const picker = document.getElementById('theme-picker');
    function syncThemePicker() {
      const p = Theme.pref();
      Array.prototype.forEach.call(picker.querySelectorAll('[data-theme-opt]'), function (b) {
        b.classList.toggle('active', b.dataset.themeOpt === p);
      });
    }
    picker.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-theme-opt]');
      if (!btn) return;
      Theme.set(btn.dataset.themeOpt);
      syncThemePicker();
    });
    syncThemePicker();

    exportBtn.addEventListener('click', exportData);

    document.getElementById('btn-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-share').addEventListener('click', generateShareImage);

    // 本地提醒开关
    const notifyBtn = document.getElementById('btn-notify');
    function syncNotifyBtn() {
      notifyBtn.textContent = Notify.enabled() ? '关闭提醒' : '开启提醒';
      if (!Notify.supported()) notifyBtn.disabled = true;
    }
    notifyBtn.addEventListener('click', function () {
      Notify.request(!Notify.enabled());
      setTimeout(syncNotifyBtn, 400);
    });
    syncNotifyBtn();

    // 快照列表
    renderSnapshots();
    document.getElementById('snap-list').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-snap-restore]');
      if (btn) restoreSnapshot(Number(btn.dataset.snapRestore));
    });

    importBtn.addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        UI.confirm('导入将覆盖当前本地数据，是否继续？', function () {
          importData(file);
        });
      }
      fileInput.value = '';
    });
  }

  /* ------------------------------------------------------------------
   * 本地提醒：倒数日临近时推送浏览器通知（需授权、每天一次）
   * ------------------------------------------------------------------ */
  const Notify = (function () {
    const KEY = 'workbench.notify';
    const LAST = 'workbench.notifyLast';

    function supported() { return typeof Notification !== 'undefined'; }
    function enabled() {
      try {
        return localStorage.getItem(KEY) === '1' && supported() && Notification.permission === 'granted';
      } catch (e) { return false; }
    }
    function request(on) {
      if (!supported()) { Toast.show('当前浏览器不支持通知'); return; }
      if (!on) {
        try { localStorage.setItem(KEY, '0'); } catch (e) {}
        Toast.show('提醒已关闭');
        return;
      }
      Notification.requestPermission().then(function (p) {
        try { localStorage.setItem(KEY, p === 'granted' ? '1' : '0'); } catch (e) {}
        Toast.show(p === 'granted' ? '提醒已开启' : '未获得通知权限');
      });
    }
    function fire(title, body) {
      if (!enabled()) return;
      try { new Notification(title, { body: body, icon: 'icons/icon-192.png' }); } catch (e) {}
    }
    function check() {
      if (!enabled()) return;
      let last = null;
      try { last = localStorage.getItem(LAST); } catch (e) {}
      const today = dateKey(new Date());
      if (last === today) return; // 每天最多一次
      const msgs = [];
      (getCountdown().items || []).forEach(function (it) {
        if (!it.targetDate) return;
        const d = daysUntil(it.targetDate);
        if (d === 0) msgs.push('今天就是「' + it.name + '」');
        else if (d > 0 && d <= 3) msgs.push('还有 ' + d + ' 天：' + it.name);
      });
      if (!msgs.length) return;
      fire('柔序工作台 · 日程提醒', msgs.slice(0, 3).join('\n'));
      try { localStorage.setItem(LAST, today); } catch (e) {}
    }
    return { supported: supported, enabled: enabled, request: request, check: check };
  })();

  /* 通用：触发文件下载 */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------------------------------------------------
   * CSV 导出：把各板块核心数据汇总为一张表（分节，带 BOM 供 Excel 识别）
   * ------------------------------------------------------------------ */
  function csvCell(v) {
    let s = (v == null ? '' : String(v));
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function exportCSV() {
    const rows = [];
    function block(title, header, list) {
      if (!list || !list.length) return;
      rows.push(['【' + title + '】']);
      rows.push(header);
      list.forEach(function (r) { rows.push(r); });
      rows.push([]);
    }

    const fin = getFinance();
    block('记账管理', ['日期', '类型', '分类', '金额', '备注'],
      (fin.records || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
        .map(function (r) { return [r.date, r.type === 'income' ? '收入' : '支出', r.category || '', r.amount == null ? '' : r.amount, r.note || '']; }));

    const td = getTodo();
    const dailyRows = [];
    (td.daily || []).forEach(function (day) {
      (day.items || []).forEach(function (it) { dailyRows.push([day.date, it.text, it.done ? '已完成' : '未完成']); });
    });
    block('打卡记录', ['日期', '事项', '状态'], dailyRows.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }));
    block('待办清单', ['事项', '类型', '状态'],
      (td.tasks || []).map(function (t) { return [t.text, t.type || '', t.done ? '已完成' : '未完成']; }));

    const cd = getCountdown();
    block('倒数日', ['名称', '目标日期', '标签', '备注'],
      (cd.items || []).slice().sort(function (a, b) { return a.targetDate < b.targetDate ? -1 : 1; })
        .map(function (i) { return [i.name, i.targetDate, i.tag || '', i.note || '']; }));

    const mp = getMenstrual();
    block('生理期记录', ['开始日期', '结束日期', '持续天数', '周期天数', '症状'],
      (mp.records || []).slice().sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; })
        .map(function (r) {
          const days = r.endDate ? (daysBetween(r.startDate, r.endDate) + 1) : '';
          return [r.startDate, r.endDate || '进行中', days, r.cycleLength || '', (r.symptoms || []).join(' ')];
        }));

    const wl = getWishlist();
    block('愿望清单', ['愿望', '分类', '状态'],
      (wl.items || []).map(function (i) { return [i.text, i.tag || '', i.done ? '已实现' : '待实现']; }));

    const fc = getFocus();
    block('专注记录', ['时长(分钟)', '标签', '完成时间'],
      (fc.sessions || []).slice().sort(function (a, b) { return a.endedAt - b.endedAt; })
        .map(function (s) { return [s.minutes, s.tag || '', new Date(s.endedAt).toLocaleString('zh-CN')]; }));

    const eat = getFood();
    block('好好吃饭·饮食记录', ['日期', '餐次', '食物', '份量', '热量'],
      (eat.records || []).slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; })
        .map(function (r) { return [r.date || '', r.meal || '', r.name || '', r.amount == null ? '' : r.amount, r.calories == null ? '' : r.calories]; }));

    const plan = getMealPlan();
    const weekRows = [];
    MEAL_DAYS.forEach(function (day) {
      MEAL_TIMES.forEach(function (t) {
        ((plan.week[day.key] || {})[t.key] || []).forEach(function (name) {
          weekRows.push([day.label, t.label + '餐', name]);
        });
      });
    });
    block('本周餐单', ['星期', '餐次', '餐食'], weekRows);
    block('采购清单', ['食材', '状态'], (plan.groceries || []).map(function (g) { return [g.name, g.bought ? '已购' : '待购']; }));
    block('我的食谱', ['菜名', '食材', '标签'],
      (plan.recipes || []).map(function (r) { return [r.name, r.ingredients || '', (r.tags || []).join(' ')]; }));

    if (!rows.length) { Toast.show('还没有可导出的数据'); return; }

    const csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, '柔序工作台_表格_' + dateKey(new Date()) + '.csv');
    Toast.show('CSV 表格已导出');
  }

  /* ------------------------------------------------------------------
   * 自动快照列表 / 恢复
   * ------------------------------------------------------------------ */
  function snapTimeText(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function renderSnapshots() {
    const box = document.getElementById('snap-list');
    if (!box) return;
    const all = Storage.snapshots();
    if (!all.length) {
      box.innerHTML = emptyBox('暂无历史快照，下次打开工作台会自动保存', true);
      return;
    }
    const html = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const s = all[i];
      const n = Object.keys(s.data || {}).length;
      html.push('<div class="snap-item">' +
        '<div class="snap-main">' +
          '<span class="snap-time">' + snapTimeText(s.at) + '</span>' +
          '<span class="snap-meta">' + n + ' 项数据</span>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary" data-snap-restore="' + i + '">恢复</button>' +
      '</div>');
    }
    box.innerHTML = html.join('');
  }
  function restoreSnapshot(idx) {
    const s = Storage.snapshots()[idx];
    if (!s) return;
    UI.confirm('恢复到此快照（' + snapTimeText(s.at) + '）会覆盖当前数据，是否继续？', function () {
      const count = Storage.importAll(s.data);
      UI.alert('已恢复 ' + count + ' 项数据，即将刷新页面。', '恢复完成', function () { location.reload(); });
    });
  }

  /* ------------------------------------------------------------------
   * 数据分享长图：canvas 绘制工作台概览
   * ------------------------------------------------------------------ */
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function generateShareImage() {
    const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    const today = dateKey(new Date());

    const fin = getFinance();
    let income = 0, expense = 0;
    (fin.records || []).forEach(function (r) {
      const amt = Number(r.amount) || 0;
      if (r.type === 'income') income += amt; else expense += amt;
    });
    const wl = getWishlist();
    const wlDone = (wl.items || []).filter(function (i) { return i.done; }).length;
    const fc = getFocus();
    const fcMin = (fc.sessions || []).reduce(function (s, x) { return s + (x.minutes || 0); }, 0);
    const td = getTodo();
    let dDone = 0, dTotal = 0;
    (td.daily || []).forEach(function (day) {
      if (day.date === today) (day.items || []).forEach(function (it) { dTotal++; if (it.done) dDone++; });
    });
    const tDone = (td.tasks || []).filter(function (t) { return t.done; }).length;

    const rows = [
      ['今日打卡', dTotal ? (dDone + ' / ' + dTotal) : '暂无'],
      ['待办完成', tDone + ' 项'],
      ['记账收支', '收 ¥' + income + ' · 支 ¥' + expense],
      ['愿望实现', wlDone + ' / ' + (wl.items || []).length],
      ['专注累计', fcMin + ' 分钟'],
      ['倒数日', (getCountdown().items || []).length + ' 个'],
    ];

    const dpr = 2, W = 640, rowH = 66, pad = 56;
    const H = 232 + rows.length * rowH + 72;
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#ECF7E1';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, 24, 24, W - 48, H - 48, 24);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#3D3D3D';
    ctx.font = '600 30px ' + FONT;
    ctx.fillText('柔序工作台', pad, 96);
    ctx.fillStyle = '#8A8A8A';
    ctx.font = '400 16px ' + FONT;
    ctx.fillText('我的数据概览 · ' + today, pad, 128);

    ctx.strokeStyle = 'rgba(61,61,61,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, 156); ctx.lineTo(W - pad, 156); ctx.stroke();

    let y = 206;
    rows.forEach(function (r) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8A8A8A';
      ctx.font = '400 17px ' + FONT;
      ctx.fillText(r[0], pad, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#3D3D3D';
      ctx.font = '600 21px ' + FONT;
      ctx.fillText(r[1], W - pad, y);
      y += rowH;
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#8A8A8A';
    ctx.font = '400 14px ' + FONT;
    ctx.fillText('数据仅保存在本地浏览器 · 柔序工作台', W / 2, H - 52);

    canvas.toBlob(function (blob) {
      if (!blob) { Toast.show('生成失败，请重试'); return; }
      downloadBlob(blob, '柔序工作台_概览_' + today + '.png');
      Toast.show('分享图已生成');
    }, 'image/png');
  }

  function exportData() {
    const payload = {
      app: '柔序工作台',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: Storage.getAll()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = '柔序工作台_备份_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(e.target.result);
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          UI.alert('导入失败：文件格式不正确。');
          return;
        }
        const count = Storage.importAll(data);
        if (count === 0) {
          UI.alert('未在文件中找到可恢复的数据。', '导入提示');
          return;
        }
        UI.alert('已成功恢复 ' + count + ' 项数据，即将刷新页面。', '导入完成', function () {
          location.reload();
        });
      } catch (err) {
        UI.alert('导入失败：文件格式不正确。');
      }
    };
    reader.onerror = function () {
      UI.alert('导入失败：无法读取文件。');
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------
   * PWA：注册 Service Worker（离线缓存）
   * ------------------------------------------------------------------ */
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('service-worker.js').catch(function () {
          // 注册失败时静默处理，不影响使用
        });
      });
    }
  }

  /* ------------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------------ */
  function initAddToHomeTip() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const shown = localStorage.getItem('workbench.addToHomeTipShown');
    if (isStandalone || !isMobile || shown === '1') return;
    setTimeout(function () {
      UI.alert('可将「柔序工作台」添加到手机桌面：使用浏览器菜单中的「添加到主屏幕」即可。', '小提示', function () {
        localStorage.setItem('workbench.addToHomeTipShown', '1');
      });
    }, 600);
  }

  function init() {
    Theme.apply();
    Theme.onChange(applyModuleColors);
    if (!Storage.available()) {
      UI.alert('浏览器本地存储不可用，数据将无法保存。请检查隐私设置后重试。', '提示');
    }
    seedDefaults();
    renderSidebar();
    renderSections();
    activate('checkin');
    initPrivacy();
    bindSettings();
    registerSW();
    initAddToHomeTip();
    takeSnapshot();
    Notify.check();
  }

  init();
})();
