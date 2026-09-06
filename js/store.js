/* =====================================================
 * store.js - 数据层（前台 / 后台共用）
 * 职责：
 *   1. 提供默认数据（与 products.json 保持一致的结构）
 *   2. localStorage 读写、合并（站点配置字段缺失时补齐默认）
 *   3. JSON 导入 / 导出 / 下载
 *   4. GitHub Contents API 封装：上传图片、一键发布 products.json
 * ===================================================== */
(function (global) {
  'use strict';

  var LS_DATA_KEY = 'ps_shop_data_v1';
  var LS_THEME_KEY = 'ps_theme_v1';
  var LS_PWD_KEY = 'ps_admin_pwd_v1';
  var LS_GITHUB_KEY = 'ps_github_cfg_v1';
  var LS_AUTH_KEY = 'ps_admin_auth_v1';

  var DEFAULT_PASSWORD = 'admin123';

  /* ---------- 工具函数 ---------- */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtPrice(n) {
    var v = Number(n);
    if (isNaN(v)) v = 0;
    return v.toFixed(v % 1 === 0 ? 0 : 2);
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 站点配置字段补齐（保证新增字段有默认值）
  function normalizeData(raw) {
    var data = raw && typeof raw === 'object' ? raw : {};
    if (!data.version) data.version = 1;
    data.site = data.site || {};
    data.site = Object.assign({
      title: '拾光小铺', subtitle: '用心挑选每一件好物',
      notice: '🎉 全场满 99 元包邮，新用户立减 10 元',
      footer: '© 2026 拾光小铺 · GitHub Pages 静态展示站',
      theme: 'light', showBanner: true,
      banners: ['images/banner-1.svg', 'images/banner-2.svg', 'images/banner-3.svg'],
      paymentImage: 'images/pay-code.svg',
      paymentTip: '请用微信或支付宝扫码支付',
      paymentNote: '以上二维码为示例，请在后台替换为您的真实收款码'
    }, data.site);
    if (!Array.isArray(data.categories)) data.categories = [];
    if (!Array.isArray(data.products)) data.products = [];
    data.categories = data.categories.map(function (c, i) {
      if (typeof c === 'string') return { id: 'c_' + i, name: c };
      return { id: c.id || 'c_' + i, name: c.name || '未命名分类' };
    });
    data.products = data.products.map(function (p) {
      p = p || {};
      p.id = p.id || uid();
      p.active = p.active !== false;
      p.price = Number(p.price) || 0;
      p.originalPrice = Number(p.originalPrice) || 0;
      p.stock = Number(p.stock) || 0;
      p.sales = Number(p.sales) || 0;
      p.rating = Number(p.rating) || 5;
      p.tags = Array.isArray(p.tags) ? p.tags : [];
      p.image = p.image || '';
      p.link = p.link || '';
      p.description = p.description || '';
      p.createdAt = p.createdAt || new Date().toISOString();
      p.updatedAt = p.updatedAt || '';
      return p;
    });
    return data;
  }

  function defaultData() {
    return normalizeData({
      version: 1,
      site: {
        title: '拾光小铺',
        subtitle: '用心挑选每一件好物',
        notice: '🎉 全场满 99 元包邮，新用户立减 10 元',
        footer: '© 2026 拾光小铺 · GitHub Pages 静态展示站',
        theme: lightThemeFallback(),
        showBanner: true,
        banners: ['images/banner-1.svg', 'images/banner-2.svg', 'images/banner-3.svg'],
        paymentImage: 'images/pay-code.svg',
        paymentTip: '请使用微信或支付宝扫码支付，付款后截图联系客服确认订单哦～',
        paymentNote: '以上二维码为示例，请在后台配置页替换为您的真实收款码'
      },
      categories: ['新品', '热卖', '清仓'],
      products: [
        { id: 'p_1001', name: '极简陶瓷马克杯', category: '新品', price: 39, originalPrice: 59, stock: 120, sales: 86, rating: 4.9, tags: ['新品', '简约'], image: 'images/product-1.svg', createdAt: '2026-01-10T10:00:00.000Z', description: '<p>一杯温柔的日常，从一只好杯子开始。</p><ul><li>材质：高温白瓷</li><li>容量：350ml</li></ul><blockquote>设计师手作款。</blockquote>' },
        { id: 'p_1002', name: '北欧实木香薰摆件', category: '新品', price: 89, originalPrice: 129, stock: 60, sales: 42, rating: 4.8, tags: ['新品', '家居'], image: 'images/product-2.svg', createdAt: '2026-01-08T09:30:00.000Z', description: '<p>天然黑胡桃木，纹理清晰。</p><p>随赠 <strong>雪松精油 5ml</strong>。</p>' },
        { id: 'p_1003', name: '便携蓝牙音箱', category: '热卖', price: 199, originalPrice: 299, stock: 80, sales: 342, rating: 4.7, tags: ['热卖', '数码'], image: 'images/product-3.svg', createdAt: '2026-01-05T14:00:00.000Z', description: '<p>小巧机身，澎湃音效。</p><ul><li>蓝牙 5.3</li><li>续航约 12 小时</li><li>IPX5 防水</li></ul>' },
        { id: 'p_1004', name: '纯棉宽松卫衣', category: '热卖', price: 129, originalPrice: 189, stock: 200, sales: 518, rating: 4.8, tags: ['热卖', '服饰'], image: 'images/product-4.svg', createdAt: '2026-01-03T11:20:00.000Z', description: '<p>320g 精梳棉，宽松版型。</p><ul><li>成分：95% 棉</li><li>尺码：S/M/L/XL</li></ul>' },
        { id: 'p_1005', name: '复古帆布托特包', category: '清仓', price: 49, originalPrice: 109, stock: 30, sales: 264, rating: 4.5, tags: ['清仓'], image: 'images/product-5.svg', createdAt: '2025-12-28T16:40:00.000Z', description: '<p>加厚帆布，大容量。</p><p><strong>清仓特惠，售完即止。</strong></p>' },
        { id: 'p_1006', name: '迷你香薰加湿器', category: '清仓', price: 69, originalPrice: 139, stock: 45, sales: 178, rating: 4.6, tags: ['清仓', '数码'], image: 'images/product-6.svg', createdAt: '2025-12-20T09:00:00.000Z', description: '<p>超声波细雾加湿，静音运行。</p><ul><li>容量：300ml</li><li>缺水自动断电</li></ul>' }
      ]
    });
  }

  function lightThemeFallback() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  /* ---------- 数据读写 ---------- */
  function getLocal() {
    try {
      var raw = localStorage.getItem(LS_DATA_KEY);
      return raw ? normalizeData(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  function load() {
    return getLocal() || defaultData();
  }

  function save(data) {
    try {
      localStorage.setItem(LS_DATA_KEY, JSON.stringify(normalizeData(data)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function resetLocal() {
    localStorage.removeItem(LS_DATA_KEY);
  }

  /* ---------- 导入 / 导出 ---------- */
  function exportJSON(data) {
    return JSON.stringify(normalizeData(clone(data)), null, 2);
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // 解析导入内容（支持完整对象、数组 或 {products:[...]} 局部结构）
  function parseImport(text) {
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 解析失败，请检查格式：' + e.message);
    }
    if (!obj || typeof obj !== 'object') throw new Error('数据为空或格式不正确');
    if (Array.isArray(obj)) return normalizeData({ products: obj });
    if (obj.products || obj.site || obj.categories) return normalizeData(obj);
    throw new Error('无法识别的数据结构，缺少 products / categories / site 字段');
  }

  /* ---------- 统计 ---------- */
  function stats(data) {
    var d = normalizeData(clone(data));
    var onSale = d.products.filter(function (p) { return p.active; });
    var totalSales = d.products.reduce(function (s, p) { return s + (Number(p.sales) || 0); }, 0);
    return {
      total: d.products.length,
      onSale: onSale.length,
      offSale: d.products.length - onSale.length,
      categories: d.categories.length,
      totalSales: totalSales
    };
  }

  /* =====================================================
   * GitHub Contents API
   * ===================================================== */
  function getGitConfig() {
    try {
      var raw = localStorage.getItem(LS_GITHUB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveGitConfig(cfg) {
    localStorage.setItem(LS_GITHUB_KEY, JSON.stringify({
      owner: (cfg.owner || '').trim(),
      repo: (cfg.repo || '').trim(),
      token: (cfg.token || '').trim(),
      branch: (cfg.branch || 'main').trim() || 'main'
    }));
  }

  function clearGitConfig() {
    localStorage.removeItem(LS_GITHUB_KEY);
  }

  function githubErrorText(status, data) {
    var msg = data && data.message ? data.message : '';
    if (status === 401) return '认证失败：Token 无效或已过期';
    if (status === 403) return '没有权限：请确认 Token 已勾选 repo 权限，或触发频率限制';
    if (status === 404) return '仓库不存在或路径错误，请确认 owner/repo 填写正确，或文件尚未创建';
    if (status === 409) return '分支冲突：请确认分支名（默认 main）正确且仓库可写';
    if (status === 422) {
      var detail = (data && data.errors && data.errors)
        .map(function (e) { return e.message || e.field || e.code || ''; })
        .filter(Boolean).join('；');
      return '内容校验失败：' + (detail || msg || '请重试');
    }
    return '请求失败 (' + status + ')：' + (msg || '未知错误');
  }

  async function ghRequest(cfg, method, path, body) {
    var url = 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) +
      '/' + encodeURIComponent(cfg.repo) + '/contents/' + path;
    var res = await fetch(url, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    var data = {};
    try { data = await res.json(); } catch (e) { /* ignored */ }
    if (!res.ok) {
      throw new Error(githubErrorText(res.status, data));
    }
    return data;
  }

  // 获取仓库中某文件当前的 sha（更新已有文件时所必需）；文件不存在返回 null
  async function getFileSha(cfg, path) {
    var url = 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) +
      '/' + encodeURIComponent(cfg.repo) + '/contents/' + path +
      '?ref=' + encodeURIComponent(cfg.branch);
    var res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      var data = {};
      try { data = await res.json(); } catch (e) { /* ignored */ }
      throw new Error(githubErrorText(res.status, data));
    }
    var body = {};
    try { body = await res.json(); } catch (e) { /* ignored */ }
    return (body && body.sha) ? body.sha : null;
  }

  // 上传文件到仓库 images/ 目录，返回相对路径 images/xxx.ext
  async function uploadImage(cfg, content, fileExt, prefix) {
    fileExt = (fileExt || 'png').replace(/[^\w.]/g, '');
    var name = (prefix || 'img') + '_' + Date.now().toString(36) + '.' + fileExt;
    var path = 'images/' + name;
    var body = {
      message: 'chore: upload ' + path + ' (from admin)',
      content: content,
      branch: cfg.branch
    };
    // 若同名文件已存在（重名覆盖场景），更新时必须携带旧文件 sha
    var sha = await getFileSha(cfg, path);
    if (sha) body.sha = sha;
    await ghRequest(cfg, 'PUT', path, body);
    return path;
  }

  // 一键发布：把完整数据写入仓库 products.json
  async function publishJSON(cfg, data) {
    // 发布时注入 raw 直链基址：绑定自定义域名后，前台仍可在 Pages 部署窗口内秒开新上传的图片
    var payload = Object.assign({}, data);
    payload.site = Object.assign({}, data && data.site, {
      rawBase: 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/' + (cfg.branch || 'main')
    });
    var content = exportJSON(payload);
    var base64 = btoa(unescape(encodeURIComponent(content)));
    var body = {
      message: 'chore: publish products.json (from admin)',
      content: base64,
      branch: cfg.branch
    };
    // 关键修复：products.json 已存在时必须携带旧文件 sha，否则 GitHub 返回 422
    var sha = await getFileSha(cfg, 'products.json');
    if (sha) body.sha = sha;
    await ghRequest(cfg, 'PUT', 'products.json', body);
    return content; // 返回发布内容文本，供后台记录同步基线
  }

  async function testConnection(cfg) {
    var url = 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) +
      '/' + encodeURIComponent(cfg.repo) + '/git/ref/heads/' + encodeURIComponent(cfg.branch);
    var res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) {
      var data = {};
      try { data = await res.json(); } catch (e) { /* ignored */ }
      throw new Error(githubErrorText(res.status, data));
    }
    return true;
  }

  /* ---------- Raw 直链解析 ---------- */
  // raw 直链基址：绑定自定义域名时 hostname 不再是 *.github.io，无法自动推导，
  // 由后台「一键发布」时把基址写入 site.rawBase，前台加载后通过 setRawBase 提供。
  var RAW_BASE = '';
  function setRawBase(url) {
    RAW_BASE = String(url || '').replace(/\/+$/, '');
  }

  // 把相对路径（如 images/xxx.jpg）转换为 GitHub raw 直链，用于 Pages 部署延迟窗口内秒开图片。
  // 解析顺序：显式 rawBase（自定义域名）→ *.github.io 自动推导 → 其他环境（localhost 等）原样返回
  function toRawGitUrl(path) {
    if (!path) return '';
    if (/^(https?:)?\/\//i.test(path) || /^data:/i.test(path)) return path; // 已有协议/外链/base64 不动
    var clean = String(path).replace(/^\/+/, '');
    try {
      // 1) 显式基址优先（适配自定义域名）
      if (RAW_BASE) return RAW_BASE + '/' + clean;

      // 2) github.io 域名自动推导（bozishop.github.io/product-shop 或 bozishop.github.io）
      var host = window.location.hostname || '';
      var hostLow = host.toLowerCase();
      if (hostLow.indexOf('github.io') === -1) return path; // 非 github.io（如 localhost）原样返回

      var owner = hostLow.split('.')[0];
      var pathname = window.location.pathname || '/';
      var repo = pathname.split('/').filter(function (s) { return s; })[0] || '';
      if (!owner || !repo) return path;

      var branch = 'main';
      return 'https://raw.githubusercontent.com/' + encodeURIComponent(owner) +
        '/' + encodeURIComponent(repo) + '/' + encodeURIComponent(branch) + '/' + clean;
    } catch (e) {
      return path;
    }
  }

  /* ---------- 主题 ---------- */
  function getTheme() {
    var saved = localStorage.getItem(LS_THEME_KEY);
    return saved ? saved : 'light';
  }

  function setTheme(t) {
    localStorage.setItem(LS_THEME_KEY, t);
    if (document.documentElement) {
      document.documentElement.setAttribute('data-theme', t);
    }
    var site = getLocal();
    if (site) {
      site.site.theme = t;
      save(site);
    }
  }

  /* ---------- 认证 ---------- */
  function getPassword() {
    return localStorage.getItem(LS_PWD_KEY) || DEFAULT_PASSWORD;
  }

  function setPassword(pwd) {
    localStorage.setItem(LS_PWD_KEY, pwd);
  }

  function isAdminAuthed() {
    return sessionStorage.getItem(LS_AUTH_KEY) === '1';
  }

  function setAdminAuthed(v) {
    if (v) sessionStorage.setItem(LS_AUTH_KEY, '1');
    else sessionStorage.removeItem(LS_AUTH_KEY);
  }

  /* ---------- 对外暴露 ---------- */
  global.Store = {
    defaultData: defaultData,
    normalizeData: normalizeData,
    clone: clone,
    uid: uid,
    escapeHtml: escapeHtml,
    fmtPrice: fmtPrice,
    fmtDate: fmtDate,
    getLocal: getLocal,
    load: load,
    save: save,
    resetLocal: resetLocal,
    exportJSON: exportJSON,
    downloadText: downloadText,
    parseImport: parseImport,
    stats: stats,
    getGitConfig: getGitConfig,
    saveGitConfig: saveGitConfig,
    clearGitConfig: clearGitConfig,
    getFileSha: getFileSha,
    toRawGitUrl: toRawGitUrl,
    setRawBase: setRawBase,
    uploadImage: uploadImage,
    publishJSON: publishJSON,
    testConnection: testConnection,
    getTheme: getTheme,
    setTheme: setTheme,
    getPassword: getPassword,
    setPassword: setPassword,
    isAdminAuthed: isAdminAuthed,
    setAdminAuthed: setAdminAuthed,
    DEFAULT_PASSWORD: DEFAULT_PASSWORD
  };
})(window);