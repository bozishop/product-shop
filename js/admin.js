/* =====================================================
 * admin.js - 后台配置页逻辑
 * 功能：登录、概览、商品 CRUD、分类、站点设置、
 *       GitHub 一键上传/发布、数据导入导出、富文本(Word 兼容)
 * ===================================================== */
(function () {
  'use strict';

  var S = window.Store;
  var state = {
    data: S.load(),
    editingId: null,
    selectedIds: [],
    search: '',
    catFilter: '',
    gitSync: null   // 已验证可用的 GitHub 同步快照 {ok,owner,repo,token,branch}
  };

  /* ---------- 工具 ---------- */
  function $(sel) { return document.querySelector(sel); }

  function toast(msg, type) {
    var wrap = $('#toast-wrap');
    var t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(function () { t.remove(); }, 3100);
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('文件读取失败')); };
      fr.readAsDataURL(file);
    });
  }

  function fileExtOf(file) {
    var m = /\.([a-zA-Z0-9]+)$/.exec(file.name || '');
    var ext = m ? m[1].toLowerCase() : '';
    if (!ext && file.type) {
      var t = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '');
      ext = t === 'jpeg' ? 'jpg' : t;
    }
    return ext || 'png';
  }

  // dataURL -> { base64, ext }
  function dataURLInfo(dataUrl) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) return null;
    var mime = m[1] || 'image/png';
    var ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '');
    if (ext === 'jpeg') ext = 'jpg';
    if (m[2]) return { base64: m[3], ext: ext, mime: mime };
    return { base64: btoa(unescape(encodeURIComponent(m[3]))), ext: ext, mime: mime };
  }

  function saveCurrent() {
    S.save(state.data);
  }

  function githubConfigured() {
    return gitSyncState() === 'ok';
  }

  /* ---------- 只读锁：GitHub 同步验证可用之前，全部内容编辑锁定 ---------- */
  // 返回 'ok'（已验证可用）| 'unverified'（已填写但与验证快照不一致）| ''（未配置/未验证）
  function gitSyncState() {
    var st = state.gitSync;
    if (!st || !st.ok) return '';
    var c = S.getGitConfig();
    if (!c || !c.owner || !c.repo || !c.token) return '';
    // 当前配置与验证通过时的快照不一致（改过任何一项）则需重新验证
    if (st.owner !== c.owner || st.repo !== c.repo || st.token !== c.token ||
        (st.branch || 'main') !== (c.branch || 'main')) return 'unverified';
    return 'ok';
  }

  // 写操作统一闸门：只读时拦截并跳转到 GitHub 同步页
  function requireWritable() {
    if (githubConfigured()) return true;
    toast('后台处于只读模式：请先到「GitHub 同步」完成配置并通过「测试连接」', 'error');
    switchPage('github');
    return false;
  }

  // raw 直链基址（适配自定义域名）：后台优先按本机 GitHub 配置推导，否则用发布时写入的 site.rawBase
  function ensureRawBase() {
    var c = S.getGitConfig();
    if (c && c.owner && c.repo) {
      S.setRawBase('https://raw.githubusercontent.com/' + c.owner + '/' + c.repo + '/' + (c.branch || 'main'));
      return;
    }
    S.setRawBase(state.data.site && state.data.site.rawBase);
  }

  /* ---------- 登录后同步线上最新数据 ---------- */
  function hashText(s) {
    var h = 5381;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  // 参与同步比较的规范化文本（剔除 rawBase 等派生字段，保证跨设备可比）
  function comparableText(d) {
    var clone;
    try { clone = JSON.parse(JSON.stringify(d || {})); } catch (e) { return ''; }
    if (clone.site) delete clone.site.rawBase;
    return S.exportJSON(clone);
  }

  function getLastPubHash() {
    try { return localStorage.getItem('ps_lastpub_v1'); } catch (e) { return null; }
  }
  function setLastPubHash(h) {
    try { localStorage.setItem('ps_lastpub_v1', h || ''); } catch (e) {}
  }

  function fetchTimeout(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 6000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // 拉取线上最新发布数据：优先 raw 直链（免 Pages 部署延迟），失败回退同源 products.json
  function fetchPublishedData() {
    var c = S.getGitConfig();
    var raw = (c && c.owner && c.repo)
      ? 'https://raw.githubusercontent.com/' + c.owner + '/' + c.repo + '/' + (c.branch || 'main') + '/products.json'
      : '';
    var first = raw ? fetchTimeout(raw, 6000) : Promise.reject(new Error('no raw url'));
    return first.catch(function () {
      return fetchTimeout('products.json?v=' + Date.now(), 6000);
    });
  }

  // 登录后调用：对比线上与本浏览器数据并智能同步
  function syncAfterLogin() {
    fetchPublishedData().then(function (text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { return; }
      if (!parsed || !Array.isArray(parsed.products)) return;
      var pubText = comparableText(parsed);
      var localText = comparableText(state.data);
      if (pubText === localText) return; // 与线上一致，无需处理
      var base = getLastPubHash();
      var localHash = hashText(localText);
      if (base && localHash === base) { adoptPublished(parsed, true); return; } // 本地自上次发布后没改过 → 线上是最新
      if (!base && localHash === hashText(comparableText(S.defaultData()))) { adoptPublished(parsed, true); return; } // 全新浏览器 → 直接采用线上
      if ((state.data.products || []).length === 0 && parsed.products.length > 0) { adoptPublished(parsed, true); return; } // 本地商品列表为空（无效缓存）→ 直接采用线上
      if (pubHashOnline(base, pubText)) return; // 线上与上次发布一致 → 本地有未发布修改，不打扰
      showSyncBar(parsed);                      // 双方都有改动 → 让用户选择
    }).catch(function () { /* 离线或数据不可用：静默跳过 */ });
  }

  function pubHashOnline(base, pubText) {
    return base && hashText(pubText) === base;
  }

  function adoptPublished(parsed, silent) {
    state.data = S.normalizeData(parsed);
    state.selectedIds = [];
    saveCurrent();
    renderAll();
    hideSyncBar();
    toast(silent ? '已同步线上最新数据（' + state.data.products.length + ' 件商品）' : '已使用线上最新数据', 'success');
  }

  function showSyncBar(parsed) {
    var bar = $('#syncBar');
    if (!bar) return;
    var pubN = (parsed.products || []).length;
    var locN = (state.data.products || []).length;
    bar.innerHTML = '⚠️ <b>数据不一致</b>：线上已发布数据（' + pubN + ' 件商品）与本浏览器数据（' + locN + ' 件商品）不同，请选择要使用的版本：'
      + ' <button type="button" class="btn btn-sm btn-primary" id="syncUseRemote">⬇️ 使用线上最新</button>'
      + ' <button type="button" class="btn btn-sm" id="syncKeepLocal">💾 保留本浏览器数据</button>';
    bar.classList.remove('hidden');
    var use = $('#syncUseRemote');
    var keep = $('#syncKeepLocal');
    if (use) use.addEventListener('click', function () { adoptPublished(parsed, false); });
    if (keep) keep.addEventListener('click', function () {
      hideSyncBar();
      toast('已保留本浏览器数据，可编辑后重新发布覆盖线上', 'info');
    });
  }

  function hideSyncBar() {
    var bar = $('#syncBar');
    if (bar) bar.classList.add('hidden');
  }

  function saveGitState() {
    try { localStorage.setItem('ps_git_sync_v1', JSON.stringify(state.gitSync || null)); } catch (e) {}
  }

  function loadGitState() {
    try { state.gitSync = JSON.parse(localStorage.getItem('ps_git_sync_v1') || 'null'); }
    catch (e) { state.gitSync = null; }
  }

  function renderReadonlyBanner() {
    var bar = $('#roLockBar');
    if (!bar) return;
    var st = gitSyncState();
    if (st === 'ok') {
      bar.classList.add('hidden');
      document.body.classList.remove('readonly-mode');
      return;
    }
    bar.innerHTML = (st === 'unverified'
      ? '🔒 <b>只读模式</b>：GitHub 配置已修改但尚未重新验证，编辑已锁定。请在「GitHub 同步」点击「测试连接」，通过后自动解锁。'
      : '🔒 <b>只读模式</b>：尚未配置可用的 GitHub 同步，所有编辑/删除操作已锁定。请在「GitHub 同步」填写 owner / repo / Token 并通过「测试连接」解锁。')
      + ' <button type="button" class="btn btn-sm btn-primary" id="roGoGit">前往配置 →</button>';
    bar.classList.remove('hidden');
    document.body.classList.add('readonly-mode');
    var go = $('#roGoGit');
    if (go) go.addEventListener('click', function () { switchPage('github'); });
  }

  function toggleBtnLoading(btn, loading, text) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originText = btn.textContent;
      btn.textContent = '处理中…';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.originText || btn.textContent;
      btn.disabled = false;
    }
  }

  /* ---------- 登录 ---------- */
  function doLogin() {
    var val = $('#loginPwd').value;
    if (val === S.getPassword()) {
      S.setAdminAuthed(true);
      showApp();
      toast('登录成功', 'success');
    } else {
      toast('密码错误，请重试', 'error');
    }
  }

  function showApp() {
    $('#login-page').classList.add('hidden');
    $('#app').classList.remove('hidden');
    document.body.setAttribute('data-theme', S.getTheme());
    renderAll();
    syncAfterLogin(); // 登录后拉取线上最新发布数据并智能同步
  }

  // 是否有未发布的内容修改（无基线记录时按有修改处理，保守提醒）
  function hasUnpublishedChanges() {
    var base = getLastPubHash();
    if (!base) return true;
    return hashText(comparableText(state.data)) !== base;
  }

  function logout() {
    var gitOk = gitSyncState() === 'ok';
    var unpublished = hasUnpublishedChanges();
    var msg;
    if (!gitOk) {
      // GitHub 同步不可用：数据只存在本浏览器，清除 = 永久丢失
      msg = '⚠️ 警告：当前未配置可用的 GitHub 同步，数据仅保存在本浏览器！\n\n退出登录将清除本地缓存，所有内容修改将无法找回。\n\n确定退出登录吗？';
    } else if (unpublished) {
      // 有未发布的修改：提醒先发布，否则修改丢失（线上不受影响）
      msg = '⚠️ 检测到有未发布的内容修改！\n\n退出登录将清除本浏览器缓存的店铺数据，未发布的修改将丢失（已发布到线上的内容不受影响）。\n\n如需保留修改，请先到「GitHub 同步」点击「🚀 一键发布数据」。\n\n确定退出登录吗？';
    } else {
      // 已与线上一致：清除是安全的，下次登录自动拉取线上最新
      msg = '退出登录将清除本浏览器缓存的店铺数据，下次登录将自动获取线上最新数据。\n\n（已发布到线上的内容不受影响）\n\n确定退出登录吗？';
    }
    if (!confirm(msg)) return;
    // 确认退出：清除本地内容缓存（保留主题 / 登录密码 / GitHub 配置与验证状态）
    S.resetLocal();
    try { localStorage.removeItem('ps_lastpub_v1'); } catch (e) {}
    S.setAdminAuthed(false);
    state.data = S.defaultData();
    state.selectedIds = [];
    state.search = '';
    state.catFilter = '';
    $('#loginPwd').value = '';
    $('#login-page').classList.remove('hidden');
    $('#app').classList.add('hidden');
    hideSyncBar();
    toast('已退出登录，本地缓存已清除', 'info');
  }

  /* ---------- 导航 ---------- */
  function switchPage(pageId) {
    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-page') === pageId);
    });
    document.querySelectorAll('.page').forEach(function (p) {
      p.classList.toggle('active', p.id === 'page-' + pageId);
    });
  }

  /* ---------- 概览 ---------- */
  function renderOverview() {
    var st = S.stats(state.data);
    var cards = [
      { emoji: '📦', label: '全部商品', num: st.total },
      { emoji: '✅', label: '在售商品', num: st.onSale },
      { emoji: '⏸️', label: '已下架', num: st.offSale },
      { emoji: '🏷️', label: '分类数', num: st.categories },
      { emoji: '💰', label: '累计销量(件)', num: st.totalSales }
    ];
    $('#statsGrid').innerHTML = cards.map(function (c) {
      return '<div class="card stat-card"><div class="stat-emoji">' + c.emoji + '</div>' +
        '<div class="stat-num">' + c.num + '</div><div class="stat-label">' + c.label + '</div></div>';
    }).join('');
  }

  /* ---------- 商品表格渲染 ---------- */
  function renderCategoryOptions(selected) {
    var sel = $('#p_category');
    var opts = state.data.categories.map(function (c) {
      var s = c.name === selected ? ' selected' : '';
      return '<option value="' + S.escapeHtml(c.name) + '"' + s + '>' + S.escapeHtml(c.name) + '</option>';
    }).join('');
    sel.innerHTML = '<option value="">未分类</option>' + opts;
  }

  function fillCatFilter() {
    var sel = $('#productCatFilter');
    var cur = sel.value;
    sel.innerHTML = '<option value="">全部分类</option>' + state.data.categories.map(function (c) {
      return '<option value="' + S.escapeHtml(c.name) + '">' + S.escapeHtml(c.name) + '</option>';
    }).join('');
    sel.value = cur;
  }

  function renderProducts() {
    var kw = state.search.trim().toLowerCase();
    var list = state.data.products.filter(function (p) {
      if (state.catFilter && p.category !== state.catFilter) return false;
      if (kw && (p.name || '').toLowerCase().indexOf(kw) === -1) return false;
      return true;
    });

    var tbody = $('#productTbody');
    tbody.innerHTML = '';
    $('#productEmpty').style.display = list.length === 0 ? '' : 'none';

    list.forEach(function (p) {
      var tr = document.createElement('tr');

      var tdCk = document.createElement('td');
      var ck = document.createElement('input');
      ck.type = 'checkbox';
      ck.checked = state.selectedIds.indexOf(p.id) > -1;
      ck.className = 'row-check';
      ck.dataset.id = p.id;
      ck.addEventListener('change', function () {
        if (ck.checked) state.selectedIds.push(p.id);
        else state.selectedIds = state.selectedIds.filter(function (x) { return x !== p.id; });
        $('#bulkDeleteBtn').disabled = state.selectedIds.length === 0;
        $('#bulkDeleteBtn').textContent = '🗑 批量删除' + (state.selectedIds.length ? ' (' + state.selectedIds.length + ')' : '');
      });
      tdCk.appendChild(ck);

      var tdImg = document.createElement('td');
      var img = document.createElement('img');
      img.className = 'thumb';
      img.src = p.image || '';
      img.alt = p.name;
      img.onerror = function () {
        if (this._rawTried !== true && p.image) {
          this._rawTried = true;
          this.onerror = null;
          var raw = S.toRawGitUrl(p.image);
          if (raw && raw !== p.image) { this.src = raw; return; }
        }
        this.onerror = null;
        this.style.visibility = 'hidden';
      };
      tdImg.appendChild(img);

      var tdName = document.createElement('td');
      var nm = document.createElement('div');
      nm.textContent = p.name;
      nm.style.fontWeight = '600';
      tdName.appendChild(nm);
      if (p.tags && p.tags.length) {
        var tg = document.createElement('div');
        p.tags.slice(0, 3).forEach(function (t) {
          var s = document.createElement('span');
          s.className = 'tag-pill';
          s.textContent = t;
          tg.appendChild(s);
        });
        tdName.appendChild(tg);
      }

      var tdCat = document.createElement('td');
      tdCat.textContent = p.category || '未分类';

      var tdPrice = document.createElement('td');
      tdPrice.innerHTML = '<b>¥' + S.fmtPrice(p.price) + '</b>' + (p.originalPrice > p.price ? '<br><s style="color:var(--muted)">¥' + S.fmtPrice(p.originalPrice) + '</s>' : '');

      var tdStock = document.createElement('td');
      tdStock.textContent = p.stock;

      var tdSales = document.createElement('td');
      tdSales.textContent = p.sales;

      var tdRating = document.createElement('td');
      tdRating.textContent = '★ ' + (p.rating || '-');

      var tdStatus = document.createElement('td');
      var sp = document.createElement('span');
      sp.className = 'status-pill ' + (p.active ? 'status-on' : 'status-off');
      sp.textContent = p.active ? '在售' : '下架';
      tdStatus.appendChild(sp);

      var tdOps = document.createElement('td');
      tdOps.className = 'actions';
      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-sm';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', function () { openProductModal(p.id); });
      var delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function () { deleteProducts([p.id]); });
      tdOps.appendChild(editBtn);
      tdOps.appendChild(delBtn);

      [tdCk, tdImg, tdName, tdCat, tdPrice, tdStock, tdSales, tdRating, tdStatus, tdOps].forEach(function (td) { tr.appendChild(td); });
      tbody.appendChild(tr);
    });
  }

  /* ---------- 商品编辑弹窗 ---------- */
  function openProductModal(id) {
    state.editingId = id;
    $('#productModalTitle').textContent = id ? '编辑商品' : '新增商品';
    var p = id ? state.data.products.filter(function (x) { return x.id === id; })[0] : null;

    renderCategoryOptions(p ? p.category : '');
    var form = $('#productForm');
    form.reset();
    $('#p_id').value = p ? p.id : '';
    $('#p_name').value = p ? p.name : '';
    $('#p_category').value = p ? p.category : '';
    $('#p_price').value = p ? p.price : '';
    $('#p_original').value = p && p.originalPrice ? p.originalPrice : '';
    $('#p_stock').value = p ? p.stock : '';
    $('#p_sales').value = p ? p.sales : '';
    $('#p_rating').value = p ? p.rating : 5;
    $('#p_tags').value = p && p.tags ? p.tags.join(',') : '';
    $('#p_link').value = p ? p.link : '';
    $('#p_active').checked = p ? p.active : true;
    setImgCtrlValue(p && p.image ? p.image : '');

    var desc = $('#rteDesc');
    desc.innerHTML = p && p.description ? p.description : '';
    $('#productModal').classList.add('open');
  }

  function closeProductModal() {
    $('#productModal').classList.remove('open');
    state.editingId = null;
  }

  function saveProductFromForm() {
    if (!requireWritable()) return;
    var name = $('#p_name').value.trim();
    var price = Number($('#p_price').value);
    if (!name || isNaN(price)) {
      toast('请填写商品名称和售价', 'error');
      return;
    }
    var descHtml = $('#rteDesc').innerHTML.trim();

    var data = {
      id: $('#p_id').value || S.uid(),
      name: name,
      category: $('#p_category').value,
      price: price,
      originalPrice: Number($('#p_original').value) || 0,
      stock: Number($('#p_stock').value) || 0,
      sales: Number($('#p_sales').value) || 0,
      rating: Math.min(5, Math.max(0, Number($('#p_rating').value) || 5)),
      tags: $('#p_tags').value.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
      image: imageCtrl.getValue() || '',
      link: $('#p_link').value.trim(),
      active: $('#p_active').checked,
      description: descHtml,
      createdAt: null,
      updatedAt: new Date().toISOString()
    };

    var idx = state.data.products.findIndex(function (x) { return x.id === data.id; });
    if (idx > -1) {
      var old = state.data.products[idx];
      data.createdAt = old.createdAt || new Date().toISOString();
      state.data.products[idx] = Object.assign({}, old, data);
    } else {
      data.createdAt = new Date().toISOString();
      state.data.products.unshift(data);
    }
    saveCurrent();
    closeProductModal();
    renderProducts();
    renderOverview();
    toast('商品已保存', 'success');
  }

  function deleteProducts(ids) {
    if (!requireWritable()) return;
    var names = state.data.products.filter(function (p) { return ids.indexOf(p.id) > -1; }).map(function (p) { return p.name; });
    if (!confirm('确定删除以下 ' + ids.length + ' 个商品？\n—— ' + names.join('、'))) return;
    state.data.products = state.data.products.filter(function (p) { return ids.indexOf(p.id) === -1; });
    state.selectedIds = state.selectedIds.filter(function (x) { return ids.indexOf(x) === -1; });
    saveCurrent();
    renderProducts();
    renderOverview();
    toast('已删除 ' + ids.length + ' 个商品', 'success');
  }

  /* =====================================================
   * 富文本编辑器（contenteditable + execCommand，兼容 Word 粘贴）
   * ===================================================== */
  var imageCtrl = null; // 商品主图控件，由 initImageControl 赋值

  function buildRte() {
    var tb = $('#rteToolbar');
    tb.innerHTML = '';
    var btns = [
      { cmd: 'bold', label: '<b>B</b>', title: '加粗' },
      { cmd: 'italic', label: '<i>I</i>', title: '斜体' },
      { cmd: 'underline', label: '<u>U</u>', title: '下划线' },
      { cmd: 'strikeThrough', label: '<s>S</s>', title: '删除线' }
    ];
    btns.forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'rte-btn'; el.innerHTML = b.label; el.title = b.title;
      el.addEventListener('mousedown', function (e) { e.preventDefault(); });
      el.addEventListener('click', function () {
        $('#rteDesc').focus();
        document.execCommand(b.cmd, false, null);
      });
      tb.appendChild(el);
    });

    var color = document.createElement('input');
    color.type = 'color';
    color.title = '文字颜色';
    color.style.cssText = 'width:34px;height:30px;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer;background:transparent';
    color.addEventListener('input', function () { document.execCommand('foreColor', false, this.value); });
    tb.appendChild(color);

    var size = document.createElement('select');
    size.innerHTML = '<option value="">字号</option><option value="3">正常</option><option value="4">大</option><option value="5">特大</option><option value="1">小</option>';
    size.addEventListener('change', function () { if (this.value) document.execCommand('fontSize', false, this.value); this.selectedIndex = 0; });
    tb.appendChild(size);

    var block = document.createElement('select');
    block.innerHTML = '<option value="">样式</option><option value="p">正文</option><option value="h2">标题2</option><option value="h3">标题3</option><option value="blockquote">引用</option>';
    block.addEventListener('change', function () { if (this.value) document.execCommand('formatBlock', false, '<' + this.value + '>'); this.selectedIndex = 0; });
    tb.appendChild(block);

    var group2 = [
      { cmd: 'insertUnorderedList', label: '• 列表' },
      { cmd: 'insertOrderedList', label: '1. 列表' },
      { cmd: 'justifyLeft', label: '⬅' },
      { cmd: 'justifyCenter', label: '⬌' },
      { cmd: 'justifyRight', label: '➡' },
      { cmd: 'removeFormat', label: '⌫ 清除格式' }
    ];
    group2.forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'rte-btn'; el.textContent = b.label;
      el.addEventListener('mousedown', function (e) { e.preventDefault(); });
      el.addEventListener('click', function () { $('#rteDesc').focus(); document.execCommand(b.cmd, false, null); });
      tb.appendChild(el);
    });

    var linkBtn = document.createElement('button');
    linkBtn.type = 'button'; linkBtn.className = 'rte-btn'; linkBtn.textContent = '🔗 链接';
    linkBtn.addEventListener('click', function () {
      var url = prompt('输入链接地址（以 http:// 或 https:// 开头）');
      if (!url) return;
      var sel = window.getSelection && getSelection().toString();
      if (sel) document.execCommand('createLink', false, url);
      else document.execCommand('insertHTML', false, '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>');
    });
    tb.appendChild(linkBtn);

    var imgBtn = document.createElement('button');
    imgBtn.type = 'button'; imgBtn.className = 'rte-btn'; imgBtn.textContent = '🖼 插入图片';
    imgBtn.addEventListener('click', function () {
      var mode = confirm('确定从本地选择图片插入吗？\n（“确定”=本地文件，“取消”=输入图片链接）');
      if (mode) { $('#rteImgFile').click(); }
      else {
        var url = prompt('输入图片链接地址：');
        if (url) document.execCommand('insertImage', false, url);
      }
    });
    tb.appendChild(imgBtn);

    var upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'rte-btn';
    upBtn.title = '把详情中粘贴的 base64 图片上传到仓库并替换为相对路径';
    upBtn.textContent = '⬆️ 上传粘贴图片';
    upBtn.addEventListener('click', uploadPastedImages);
    tb.appendChild(upBtn);

    var f = document.createElement('input');
    f.type = 'file'; f.id = 'rteImgFile'; f.accept = 'image/*'; f.style.display = 'none';
    f.addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var self = this;
      readFileAsDataURL(file).then(function (dataUrl) {
        if (githubConfigured()) {
          var cfg = S.getGitConfig();
          var info = dataURLInfo(dataUrl);
          return S.uploadImage(cfg, info.base64, info.ext, 'rte').then(function (path) {
            $('#rteDesc').focus();
            document.execCommand('insertImage', false, path);
            toast('图片已上传到仓库：' + path, 'success');
          });
        }
        $('#rteDesc').focus();
        document.execCommand('insertImage', false, dataUrl);
        toast('未配置 GitHub，已用 base64 插入', 'info');
      }).catch(function (e) { toast(e.message, 'error'); });
      self.value = '';
    });
    tb.appendChild(f);
  }

  async function uploadPastedImages() {
    var area = $('#rteDesc');
    var imgs = Array.prototype.slice.call(area.querySelectorAll('img[src^="data:image"]'));
    if (imgs.length === 0) { toast('详情中没有检测到 base64 图片', 'info'); return; }
    if (!githubConfigured()) { toast('未配置 GitHub，无法上传。可导出数据后手动处理或改用外链图片。', 'error'); return; }
    var cfg = S.getGitConfig();
    for (var i = 0; i < imgs.length; i++) {
      var info = dataURLInfo(imgs[i].getAttribute('src'));
      if (!info) continue;
      try {
        var path = await S.uploadImage(cfg, info.base64, info.ext, 'rte');
        imgs[i].setAttribute('src', path);
        toast('第 ' + (i + 1) + ' 张已上传：' + path, 'success');
      } catch (e) {
        toast('第 ' + (i + 1) + ' 张上传失败：' + e.message, 'error');
      }
    }
  }

  /* ---------- Word 粘贴清洗（保留常用排版，移除 mso 垃圾样式） ---------- */
  var ALLOWED_TAGS = {
    P: 1, DIV: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, S: 1, STRIKE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1,
    IMG: 1, A: 1, SPAN: 1, FONT: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1
  };
  // 连同内容一起整体删除的标签（其内容是 CSS/JS 文本，展开会裸露成正文）
  var DROP_TAGS = { STYLE: 1, SCRIPT: 1, TITLE: 1, META: 1, LINK: 1, XML: 1, HEAD: 1 };
  var ALLOWED_STYLES = ['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-family'];

  function makeWordImgTip() {
    var ph = document.createElement('p');
    ph.className = 'word-img-tip';
    ph.style.cssText = 'border:1px dashed #f0a020;background:rgba(240,160,32,.08);color:#b06f00;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.6';
    ph.textContent = '⚠ Word 文档中的图片无法直接粘贴（浏览器安全限制，无法读取本地临时文件）。请对图片截图后按 Ctrl+V 粘贴，或使用工具栏「插入图片」上传。';
    return ph;
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    try { tmp.innerHTML = html; } catch (e) { return ''; }

    function clean(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === 8) { child.remove(); return; } // 注释
        if (child.nodeType === 3) return; // 文本
        if (child.nodeType !== 1) { child.remove(); return; }
        var tag = child.tagName.toUpperCase();
        if (DROP_TAGS[tag] === 1) { child.remove(); return; } // style/script 等连内容一起删，避免 CSS 裸露
        if (ALLOWED_TAGS[tag] !== 1) {
          var kids = Array.prototype.slice.call(child.childNodes);
          child.replaceWith.apply(child, kids);
          kids.forEach(clean);
          return;
        }

        // 图片 src 白名单：file://（Word 本地临时图，浏览器无法读取）等一律替换为操作指引
        if (tag === 'IMG') {
          var src = (child.getAttribute('src') || '').trim();
          var ok = /^https?:\/\//i.test(src) || /^data:image\//i.test(src)
            || /^images\//i.test(src) || /^\//.test(src) && !/^\/\//.test(src);
          if (!ok) { child.replaceWith(makeWordImgTip()); return; }
        }

        var attrs = Array.prototype.slice.call(child.attributes);
        attrs.forEach(function (a) {
          var name = a.name.toLowerCase();
          var keep =
            (name === 'href' && child.tagName.toUpperCase() === 'A' && /^https?:/i.test(a.value || '')) ||
            (name === 'target' && child.tagName.toUpperCase() === 'A') ||
            (name === 'src' && child.tagName.toUpperCase() === 'IMG') ||
            (name === 'alt' && child.tagName.toUpperCase() === 'IMG') ||
            (name === 'align') ||
            (name === 'style') ||
            (name === 'colspan' || name === 'rowspan');
          if (!keep) child.removeAttribute(a.name);
        });

        if (child.getAttribute('style')) {
          var styles = {};
          ALLOWED_STYLES.forEach(function (k) {
            var v = child.style[k];
            if (k === 'text-decoration' && v === 'underline') styles[k] = v;
            else if (k !== 'text-decoration' && v) styles[k] = v;
          });
          child.style.cssText = Object.keys(styles).map(function (k) { return k + ':' + styles[k]; }).join(';');
        }

        if (tag === 'DIV' || tag === 'SPAN') {
          var sp = child;
          var text = (sp.textContent || '').trim();
          var hasBlock = sp.style.display === 'block' || !text;
          if (hasBlock) {
            var p = document.createElement('p');
            while (sp.firstChild) p.appendChild(sp.firstChild);
            sp.replaceWith(p);
            child = p;
          }
        }
        if (child.childNodes && child.hasChildNodes()) clean(child);
      });
    }

    clean(tmp);
    var htmlOut = tmp.innerHTML
      .replace(/<p>\s*<\/p>/g, '<p><br></p>')
      .replace(/(<p><br><\/p>\s*){3,}/gi, '<p><br></p>');
    return htmlOut;
  }

  function bindRtePaste() {
    var area = $('#rteDesc');
    area.addEventListener('paste', function (e) {
      e.preventDefault();
      // ① 剪贴板直接带图片二进制（截图工具 / 复制的图片 / 微信 QQ 图片）→ 转 base64 插入
      var items = e.clipboardData && e.clipboardData.items;
      var imgItem = null;
      if (items) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image/') === 0) { imgItem = items[i]; break; }
        }
      }
      if (imgItem) {
        var f = imgItem.getAsFile();
        if (f) {
          var fr = new FileReader();
          fr.onload = function () {
            document.execCommand('insertHTML', false,
              '<img src="' + fr.result + '" alt="pasted" style="max-width:100%">');
            toast('图片已插入（base64 本地保存）。发布前可点「上传粘贴图片」转存到仓库', 'info');
          };
          fr.readAsDataURL(f);
          return;
        }
      }
      // ② 纯文本 / HTML（含 Word 内容，进入 sanitizeHtml 清洗）
      var html = '';
      var text = '';
      try {
        if (e.clipboardData) {
          html = e.clipboardData.getData('text/html') || '';
          text = e.clipboardData.getData('text/plain') || '';
        }
      } catch (err) { /* ignored */ }
      var insert = html ? sanitizeHtml(html) : text;
      if (insert) document.execCommand('insertHTML', false, insert);
    });
  }

  /* ---------- 图片上传控件（URL输入 + 文件选择 + 上传GitHub/Base64） ---------- */
  function initImageControl(opts) {
    var urlInput = opts.urlInput;
    var fileInput = opts.fileInput;
    var pickBtn = opts.pickBtn;
    var gitBtn = opts.gitBtn;
    var base64Btn = opts.base64Btn || null;
    var preview = opts.preview;
    var pending = { file: null, dataUrl: null };

    function refresh() {
      var src = urlInput.value.trim() || (pending.dataUrl || '');
      if (preview) {
        if (preview._rawTried) { delete preview._rawTried; }
        preview.src = src;
        preview.style.visibility = src ? 'visible' : 'hidden';
        preview.onerror = function () {
          if (this._rawTried !== true && src) {
            this._rawTried = true;
            this.onerror = null;
            var raw = S.toRawGitUrl(src);
            if (raw && raw !== src) { this.src = raw; return; }
          }
          this.onerror = null;
          this.style.visibility = 'hidden';
        };
      }
    }

    if (pickBtn) pickBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var self = this;
      readFileAsDataURL(f).then(function (dataUrl) {
        pending = { file: f, dataUrl: dataUrl };
        refresh();
      });
      self.value = '';
    });
    if (urlInput) urlInput.addEventListener('input', function () { pending = { file: null, dataUrl: null }; refresh(); });

    if (gitBtn) {
      gitBtn.addEventListener('click', function () {
        if (!pending.file) { toast('请先选择本地图片', 'error'); return; }
        if (!githubConfigured()) { toast('未配置 GitHub，请先到「GitHub 同步」填写仓库信息', 'error'); return; }
        var btn = this;
        toggleBtnLoading(btn, true);
        var info = dataURLInfo(pending.dataUrl);
        S.uploadImage(S.getGitConfig(), info.base64, info.ext, 'img')
          .then(function (path) {
            urlInput.value = path;
            pending = { file: null, dataUrl: null };
            refresh();
            toast('已上传：' + path, 'success');
          })
          .catch(function (e) { toast(e.message, 'error'); })
          .finally(function () { toggleBtnLoading(btn, false); });
      });
    }

    if (base64Btn) {
      base64Btn.addEventListener('click', function () {
        if (!pending.dataUrl) { toast('请先选择本地图片', 'error'); return; }
        urlInput.value = pending.dataUrl;
        pending = { file: null, dataUrl: null };
        refresh();
        toast('已用 base64 保存到商品图片字段', 'success');
      });
    }

    refresh();
    return {
      getValue: function () { return urlInput.value.trim(); },
      setValue: function (v) { urlInput.value = v || ''; pending = { file: null, dataUrl: null }; refresh(); }
    };
  }

  function setImgCtrlValue(v) {
    if (imageCtrl) imageCtrl.setValue(v);
  }

  /* ---------- 分类管理 ---------- */
  function renderCategories() {
    var box = $('#catList');
    box.innerHTML = '';
    if (state.data.categories.length === 0) {
      box.innerHTML = '<div class="alert info">暂无分类，请先添加。</div>';
      return;
    }
    state.data.categories.forEach(function (cat, i) {
      var count = state.data.products.filter(function (p) { return p.category === cat.name; }).length;
      var item = document.createElement('div');
      item.className = 'cat-item';
      item.innerHTML = '<span class="cat-name">' + S.escapeHtml(cat.name) + '</span>'
        + '<span class="cat-count">' + count + ' 件商品</span>';
      var renameBtn = document.createElement('button');
      renameBtn.className = 'btn btn-sm';
      renameBtn.textContent = '重命名';
      renameBtn.addEventListener('click', function () {
        var nn = prompt('输入新分类名称：', cat.name);
        if (!nn || !nn.trim() || nn.trim() === cat.name) return;
        renameCategory(cat.id, nn.trim());
      });
      var delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function () {
        if (!confirm('确定删除分类「' + cat.name + '」？该分类下 ' + count + ' 件商品将变为「未分类」。')) return;
        state.data.categories.splice(i, 1);
        state.data.products.forEach(function (p) { if (p.category === cat.name) p.category = ''; });
        saveCurrent();
        renderCategories(); renderProducts(); fillCatFilter(); renderOverview();
        toast('分类已删除', 'success');
      });
      item.appendChild(renameBtn);
      item.appendChild(delBtn);
      box.appendChild(item);
    });
  }

  function renameCategory(id, newName) {
    if (!requireWritable()) return;
    var cat = state.data.categories.filter(function (c) { return c.id === id; })[0];
    if (!cat) return;
    if (state.data.categories.some(function (c) { return c.id !== id && c.name === newName; })) {
      toast('已存在同名分类', 'error'); return;
    }
    var oldName = cat.name;
    cat.name = newName;
    state.data.products.forEach(function (p) { if (p.category === oldName) p.category = newName; });
    saveCurrent();
    renderCategories(); renderProducts(); fillCatFilter(); renderOverview();
    toast('分类已重命名', 'success');
  }

  /* ---------- 站点设置 ---------- */
  function renderSiteSettings() {
    var site = state.data.site;
    $('#site_title').value = site.title || '';
    $('#site_subtitle').value = site.subtitle || '';
    $('#site_notice').value = site.notice || '';
    $('#site_footer').value = site.footer || '';
    $('#site_theme').value = site.theme || 'light';
    $('#site_showBanner').checked = !!site.showBanner;
    $('#site_paymentImage').value = site.paymentImage || '';
    $('#site_paymentTip').value = site.paymentTip || '';
    $('#site_paymentNote').value = site.paymentNote || '';
    if (payCtrl) payCtrl.setValue(site.paymentImage || '');
    renderBannerInputs();
  }

  function renderBannerInputs() {
    var box = $('#bannerList');
    box.innerHTML = '';
    var banners = state.data.site.banners || [];
    for (var i = 0; i < 3; i++) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap';
      row.innerHTML = '<span style="flex:0 0 70px;font-size:13px;color:var(--muted)">Banner ' + (i + 1) + '</span>'
        + '<input class="input banner-input" data-idx="' + i + '" placeholder="图片地址（images/xxx.svg 或外链）" value="' + S.escapeHtml(banners[i] || '') + '" style="flex:1;min-width:200px">'
        + '<input type="file" accept="image/*" class="banner-file" data-idx="' + i + '" style="display:none">'
        + '<button type="button" class="btn btn-sm banner-pick" data-idx="' + i + '">本地图片</button>'
        + '<button type="button" class="btn btn-sm banner-git" data-idx="' + i + '">上传GitHub</button>'
        + '<button type="button" class="btn btn-sm btn-danger banner-del" data-idx="' + i + '">清空</button>';
      box.appendChild(row);
    }

    box.querySelectorAll('.banner-file').forEach(function (f) {
      f.addEventListener('change', function () {
        var file = this.files && this.files[0];
        if (!file) return;
        var self = this;
        readFileAsDataURL(file).then(function (dataUrl) {
          var input = box.querySelector('.banner-input[data-idx="' + self.getAttribute('data-idx') + '"]');
          input.value = dataUrl;
          input.dataset.pending = 'b64';
        });
        self.value = '';
      });
    });

    box.querySelectorAll('.banner-pick').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelector('.banner-file[data-idx="' + this.getAttribute('data-idx') + '"]').click();
      });
    });

    box.querySelectorAll('.banner-git').forEach(function (b) {
      b.addEventListener('click', function () {
        var idx = this.getAttribute('data-idx');
        var input = box.querySelector('.banner-input[data-idx="' + idx + '"]');
        var src = input.value.trim();
        if (!/^data:image/.test(src)) { toast('请先选择本地图片（粘贴的地址会直接使用）', 'info'); return; }
        if (!githubConfigured()) { toast('未配置 GitHub，请先到「GitHub 同步」填写仓库信息', 'error'); return; }
        var btn = this;
        toggleBtnLoading(btn, true);
        var info = dataURLInfo(src);
        S.uploadImage(S.getGitConfig(), info.base64, info.ext, 'banner')
          .then(function (path) {
            input.value = path;
            delete input.dataset.pending;
            toast('已上传：' + path, 'success');
          })
          .catch(function (e) { toast(e.message, 'error'); })
          .finally(function () { toggleBtnLoading(btn, false); });
      });
    });

    box.querySelectorAll('.banner-del').forEach(function (b) {
      b.addEventListener('click', function () {
        var idx = this.getAttribute('data-idx');
        box.querySelector('.banner-input[data-idx="' + idx + '"]').value = '';
      });
    });
  }

  function collectSiteSettings() {
    var clean = [];
    document.querySelectorAll('.banner-input').forEach(function (inp) {
      var v = inp.value.trim();
      if (v) clean.push(v);
    });
    state.data.site.title = $('#site_title').value.trim();
    state.data.site.subtitle = $('#site_subtitle').value.trim();
    state.data.site.notice = $('#site_notice').value.trim();
    state.data.site.footer = $('#site_footer').value.trim();
    state.data.site.theme = $('#site_theme').value;
    state.data.site.showBanner = $('#site_showBanner').checked;
    state.data.site.banners = clean;
    state.data.site.paymentImage = payCtrl.getValue();
    state.data.site.paymentTip = $('#site_paymentTip').value.trim();
    state.data.site.paymentNote = $('#site_paymentNote').value.trim();
  }

  /* ---------- GitHub 同步 ---------- */
  function loadGitForm() {
    var c = S.getGitConfig();
    $('#git_owner').value = c ? c.owner : '';
    $('#git_repo').value = c ? c.repo : '';
    $('#git_token').value = c ? c.token : '';
    $('#git_branch').value = c ? c.branch : 'main';
    setGitStatus('');
  }

  function readGitForm() {
    return {
      owner: $('#git_owner').value,
      repo: $('#git_repo').value,
      token: $('#git_token').value,
      branch: $('#git_branch').value || 'main'
    };
  }

  function setGitStatus(msg, type) {
    var box = $('#githubStatus');
    if (!msg) { box.style.display = 'none'; return; }
    box.className = 'alert ' + (type || 'info');
    box.innerHTML = msg;
    box.style.display = '';
  }

  function doTestConnection() {
    var cfg = readGitForm();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      toast('请完整填写 owner / repo / token', 'error');
      return;
    }
    var btn = $('#gitTestBtn');
    toggleBtnLoading(btn, true);
    S.testConnection(cfg)
      .then(function () {
        // 验证通过：记录快照并解锁后台编辑
        state.gitSync = { ok: true, owner: cfg.owner, repo: cfg.repo, token: cfg.token, branch: cfg.branch || 'main' };
        saveGitState();
        renderReadonlyBanner();
        setGitStatus('✅ 连接成功！仓库 <b>' + cfg.owner + '/' + cfg.repo + '</b>（分支 ' + cfg.branch + '）可正常写入，<b>后台编辑已解锁</b>。', 'success');
        toast('连接成功，后台编辑已解锁', 'success');
      })
      .catch(function (e) {
        // 验证失败：保持/进入只读
        state.gitSync = null;
        saveGitState();
        renderReadonlyBanner();
        setGitStatus('❌ ' + e.message, 'danger');
        toast(e.message, 'error');
      })
      .finally(function () { toggleBtnLoading(btn, false); });
  }

  function doPublish() {
    var cfg = readGitForm();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      toast('请先完整填写 GitHub 配置', 'error');
      return;
    }
    if (!confirm('确定把当前全部数据发布到 ' + cfg.owner + '/' + cfg.repo + ' 的 products.json 吗？\n发布后所有访客将看到最新内容。')) return;
    var btn = $('#gitPublishBtn');
    toggleBtnLoading(btn, true);
    S.saveGitConfig(cfg);
    S.publishJSON(cfg, state.data)
      .then(function (publishedText) {
        // 记录本次发布基线：下次登录对比用（剔除 rawBase 后比对）
        if (publishedText) setLastPubHash(hashText(comparableText(state.data)));
        hideSyncBar();
        setGitStatus('🚀 发布成功！约 1 分钟内 GitHub Pages 全站生效（刷新前台即可看到）。', 'success');
        toast('发布成功！', 'success');
      })
      .catch(function (e) {
        setGitStatus('❌ ' + e.message, 'danger');
        toast(e.message, 'error');
      })
      .finally(function () { toggleBtnLoading(btn, false); });
  }

  /* ---------- 数据管理 ---------- */
  function exportData() {
    S.downloadText('products.json', S.exportJSON(state.data), 'application/json;charset=utf-8');
    toast('已导出 products.json，请把它 push 到仓库根目录', 'success');
  }

  function copyJson() {
    var text = S.exportJSON(state.data);
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
      .then(function () { toast('已复制到剪贴板', 'success'); })
      .catch(function () {
        // 降级：选中文本复制
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('已复制到剪贴板', 'success'); } catch (e) { toast('复制失败，请手动复制导出文件', 'error'); }
        ta.remove();
      });
  }

  function doImport(text) {
    if (!requireWritable()) return;
    try {
      var incoming = S.parseImport(text);
      var base = state.data;
      // 合并策略：完整数据则整体替换；仅 products 并入则替换商品列表
      var merged = {
        version: 1,
        site: incoming.site && incoming.site.title ? incoming.site : base.site,
        categories: incoming.categories && incoming.categories.length ? incoming.categories
          : (incoming.site ? base.categories : base.categories),
        products: incoming.products
      };
      // 简单判断：JSON 顶层是完整数据（含 site/categories 至少其一且携带），则整体覆盖
      if ((incoming.site && incoming.site.title) || (incoming.categories && incoming.categories.length) || Array.isArray(incoming.products)) {
        if (incoming.site && incoming.site.title) {
          merged.site = incoming.site;
          merged.categories = incoming.categories && incoming.categories.length ? incoming.categories : base.categories;
        } else if (incoming.categories && incoming.categories.length) {
          merged.categories = incoming.categories;
        }
      }
      state.data = S.normalizeData(merged);
      saveCurrent();
      renderAll();
      $('#importText').value = '';
      toast('导入成功，共 ' + state.data.products.length + ' 件商品', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function restoreDefaults() {
    if (!requireWritable()) return;
    if (!confirm('恢复默认示例数据？当前本浏览器中的自定义数据将丢失（不影响已发布的仓库文件）。')) return;
    state.data = S.defaultData();
    state.selectedIds = [];
    S.resetLocal();
    saveCurrent();
    renderAll();
    toast('已恢复默认示例数据', 'success');
  }

  function clearProducts() {
    if (!requireWritable()) return;
    if (!confirm('清空全部商品？此操作不可撤销。')) return;
    state.data.products = [];
    state.selectedIds = [];
    saveCurrent();
    renderAll();
    toast('已清空全部商品', 'success');
  }

  /* ---------- 修改密码 ---------- */
  function changePassword() {
    var oldV = $('#pwd_old').value;
    var newV = $('#pwd_new').value;
    var cnf = $('#pwd_confirm').value;
    if (oldV !== S.getPassword()) { toast('当前密码错误', 'error'); return; }
    if (!newV || newV.length < 4) { toast('新密码至少 4 位', 'error'); return; }
    if (newV !== cnf) { toast('两次输入的新密码不一致', 'error'); return; }
    S.setPassword(newV);
    $('#pwd_old').value = $('#pwd_new').value = $('#pwd_confirm').value = '';
    toast('密码已更新', 'success');
  }

  /* ---------- 渲染总入口 ---------- */
  function renderAll() {
    renderReadonlyBanner();
    renderOverview();
    renderProducts();
    renderCategories();
    renderSiteSettings();
    fillCatFilter();
  }

  /* ---------- 初始化 ---------- */
  var payCtrl = null;

  function init() {
    loadGitState();
    ensureRawBase();
    document.documentElement.setAttribute('data-theme', S.getTheme());
    document.body.setAttribute('data-theme', S.getTheme());

    if (S.isAdminAuthed()) {
      showApp();
    } else {
      // 未登录：显示登录页（否则页面将一片空白）
      $('#login-page').classList.remove('hidden');
      $('#loginPwd').focus();
    }

    // 登录
    $('#loginBtn').addEventListener('click', doLogin);
    $('#loginPwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

    // 退出
    $('#logoutBtn').addEventListener('click', logout);

    // 导航
    $('#navList').addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-item');
      if (btn) switchPage(btn.getAttribute('data-page'));
    });

    // 富文本与图片控件
    buildRte();
    bindRtePaste();
    imageCtrl = initImageControl({
      urlInput: $('#p_image'),
      fileInput: $('#p_imgFile'),
      pickBtn: $('#p_imgPick'),
      gitBtn: $('#p_imgUploadGit'),
      base64Btn: $('#p_imgUseBase64'),
      preview: $('#p_imgPreview')
    });
    payCtrl = initImageControl({
      urlInput: $('#site_paymentImage'),
      fileInput: $('#site_payFile'),
      pickBtn: $('#site_payPick'),
      gitBtn: $('#site_payUploadGit'),
      preview: $('#site_payPreview')
    });

    // 商品弹窗
    $('#addProductBtn').addEventListener('click', function () { openProductModal(null); });
    $('#productModalClose').addEventListener('click', closeProductModal);
    $('#productModalCancel').addEventListener('click', closeProductModal);
    $('#productModalSave').addEventListener('click', saveProductFromForm);
    $('#productModal').addEventListener('click', function (e) { if (e.target === this) closeProductModal(); });

    // 商品列表筛选
    $('#productSearch').addEventListener('input', function () {
      state.search = this.value;
      renderProducts();
    });
    $('#productCatFilter').addEventListener('change', function () {
      state.catFilter = this.value;
      renderProducts();
    });

    // 全选
    $('#checkAll').addEventListener('change', function () {
      var checked = this.checked;
      state.selectedIds = [];
      document.querySelectorAll('.row-check').forEach(function (ck) {
        ck.checked = checked;
        if (checked) state.selectedIds.push(ck.dataset.id);
      });
      $('#bulkDeleteBtn').disabled = state.selectedIds.length === 0;
      $('#bulkDeleteBtn').textContent = '🗑 批量删除' + (state.selectedIds.length ? ' (' + state.selectedIds.length + ')' : '');
    });
    $('#bulkDeleteBtn').addEventListener('click', function () {
      if (state.selectedIds.length === 0) return;
      deleteProducts(state.selectedIds.slice());
    });

    // 分类
    $('#addCatBtn').addEventListener('click', function () {
      if (!requireWritable()) return;
      var name = $('#newCatName').value.trim();
      if (!name) { toast('请输入分类名称', 'error'); return; }
      if (state.data.categories.some(function (c) { return c.name === name; })) {
        toast('已存在同名分类', 'error'); return;
      }
      state.data.categories.push({ id: 'c_' + Date.now().toString(36), name: name });
      $('#newCatName').value = '';
      saveCurrent();
      renderCategories(); fillCatFilter(); renderOverview();
      toast('分类已添加', 'success');
    });

    // 站点设置
    $('#saveSiteBtn').addEventListener('click', function () {
      if (!requireWritable()) return;
      collectSiteSettings();
      saveCurrent();
      renderOverview();
      toast('站点设置已保存，前台（本浏览器）可刷新预览', 'success');
    });
    $('#resetSiteBtn').addEventListener('click', function () {
      if (!requireWritable()) return;
      if (!confirm('重置站点设置为本项目默认值？')) return;
      var d = S.defaultData();
      state.data.site = d.site;
      saveCurrent();
      renderSiteSettings();
      toast('站点设置已重置', 'success');
    });

    // GitHub
    $('#gitSaveBtn').addEventListener('click', function () {
      S.saveGitConfig(readGitForm());
      renderReadonlyBanner();   // 配置变更后立即刷新只读锁状态
      toast('配置已保存到本浏览器', 'success');
    });
    $('#gitTestBtn').addEventListener('click', doTestConnection);
    $('#gitPublishBtn').addEventListener('click', doPublish);
    $('#gitClearBtn').addEventListener('click', function () {
      if (!confirm('清除已保存的 GitHub 配置（Token）？清除后后台将进入只读模式。')) return;
      S.clearGitConfig();
      state.gitSync = null;
      saveGitState();
      loadGitForm();
      renderReadonlyBanner();
      toast('已清除配置，后台进入只读模式', 'success');
    });

    bindDataEvents();

    // 密码
    $('#pwdChangeBtn').addEventListener('click', changePassword);

    loadGitForm();
    renderAll();
  }

  function bindDataEvents() {
    $('#exportBtn').addEventListener('click', exportData);
    $('#copyJsonBtn').addEventListener('click', copyJson);
    $('#importTextBtn').addEventListener('click', function () { if ($('#importText').value.trim()) doImport($('#importText').value); else toast('请先粘贴 JSON 内容', 'error'); });
    $('#importFileBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        doImport(fr.result);
        this.value = '';
      };
      fr.readAsText(f, 'utf-8');
    });
    $('#defaultBtn').addEventListener('click', restoreDefaults);
    $('#clearProductsBtn').addEventListener('click', clearProducts);
  }

  document.addEventListener('DOMContentLoaded', init);
})();