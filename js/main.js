/* =====================================================
 * main.js - 前台商品页逻辑
 * 数据来源：优先 localStorage（后台预览），否则 fetch products.json
 * ===================================================== */
(function () {
  'use strict';

  var S = window.Store;
  var PER_PAGE = 12;

  var state = {
    data: S.defaultData(),
    category: '全部',
    keyword: '',
    sort: 'default',
    page: 1
  };

  var els = {};
  var bannerTimer = null;
  var bannerIndex = 0;

  var PLACEHOLDER_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#e5e7eb"/><text x="200" y="208" font-size="28" text-anchor="middle" fill="#9ca3af">暂无图片</text></svg>'
  );

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

  function imgWithFallback(src, alt) {
    var img = new Image();
    img.src = src || PLACEHOLDER_IMG;
    img.alt = alt || '';
    img.loading = 'lazy';
    img.onerror = function () {
      // 相对路径在 Pages 部署延迟窗口内会 404 → 自动升级到 raw 直链（commit 落盘即可秒开）
      if (img._rawTried !== true && src) {
        img._rawTried = true;
        img.onerror = null;
        var raw = S.toRawGitUrl(src);
        if (raw && raw !== src) { img.src = raw; return; }
      }
      img.onerror = null;
      img.src = PLACEHOLDER_IMG;
    };
    return img;
  }

  /* ---------- 数据加载 ---------- */
  async function loadData() {
    var local = S.getLocal();
    if (local) {
      state.data = local;
      return;
    }
    try {
      var res = await fetch('products.json' + '?v=' + Date.now());
      if (res.ok) {
        var json = await res.json();
        state.data = S.normalizeData(json);
        return;
      }
    } catch (e) { /* 离线或不存在时使用默认数据 */ }
    state.data = S.defaultData();
  }

  /* ---------- 渲染：站点头部 ---------- */
  function renderSite() {
    var site = state.data.site;
    document.title = site.title || '拾光小铺';
    $('#brandTitle').textContent = site.title;
    $('#brandSub').textContent = site.subtitle;
    var notice = site.notice;
    if (notice) {
      $('#noticeBar').textContent = notice;
      $('#noticeBar').style.display = '';
    } else {
      $('#noticeBar').style.display = 'none';
    }
    $('#footerText').textContent = site.footer;
  }

  /* ---------- 渲染：轮播 ---------- */
  function renderBanner() {
    var wrap = $('#bannerWrap');
    var banners = (state.data.site.banners || []).filter(function (b) { return b; });
    if (!state.data.site.showBanner || banners.length === 0) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    $('#bannerTrack').innerHTML = '';
    $('#bannerDots').innerHTML = '';
    banners.forEach(function (src, i) {
      var slide = document.createElement('div');
      slide.className = 'banner-slide';
      slide.appendChild(imgWithFallback(src, 'banner'));
      $('#bannerTrack').appendChild(slide);
      var dot = document.createElement('span');
      dot.className = i === 0 ? 'active' : '';
      dot.addEventListener('click', function () {
        bannerIndex = i;
        updateBanner();
        restartBanner();
      });
      $('#bannerDots').appendChild(dot);
    });
    bannerIndex = 0;
    updateBanner();
    startBanner();
  }

  function updateBanner() {
    var track = $('#bannerTrack');
    var total = track.children.length;
    if (total === 0) return;
    bannerIndex = (bannerIndex + total) % total;
    track.style.transform = 'translateX(-' + bannerIndex * 100 + '%)';
    Array.prototype.forEach.call($('#bannerDots').children, function (d, i) {
      d.className = i === bannerIndex ? 'active' : '';
    });
  }

  function startBanner() {
    stopBanner();
    var total = $('#bannerTrack').children.length;
    if (total <= 1) return;
    bannerTimer = setInterval(function () {
      bannerIndex++;
      updateBanner();
    }, 4000);
  }

  function stopBanner() {
    if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
  }

  function restartBanner() {
    stopBanner();
    startBanner();
  }

  /* ---------- 渲染：分类 ---------- */
  function renderCats() {
    var cats = ['全部'].concat(state.data.categories.map(function (c) { return c.name; }));
    var box = $('#catTabs');
    box.innerHTML = '';
    cats.forEach(function (cat) {
      var t = document.createElement('button');
      t.className = 'cat-tab' + (state.category === cat ? ' active' : '');
      t.textContent = cat;
      t.addEventListener('click', function () {
        state.category = cat;
        state.page = 1;
        renderCats();
        renderProducts();
      });
      box.appendChild(t);
    });
  }

  /* ---------- 筛选 + 排序 ---------- */
  function getFilteredAndSorted() {
    var kw = state.keyword.trim().toLowerCase();
    var list = state.data.products.filter(function (p) {
      if (!p.active) return false;
      if (state.category !== '全部' && p.category !== state.category) return false;
      if (kw) {
        var hay = (p.name || '') + ' ' + (p.description || '').replace(/<[^>]*>/g, '') + ' ' + (p.tags || []).join(' ');
        if (hay.toLowerCase().indexOf(kw) === -1) return false;
      }
      return true;
    });

    list = list.slice();
    switch (state.sort) {
      case 'new': list.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }); break;
      case 'price-asc': list.sort(function (a, b) { return a.price - b.price; }); break;
      case 'price-desc': list.sort(function (a, b) { return b.price - a.price; }); break;
      case 'sales-desc': list.sort(function (a, b) { return b.sales - a.sales; }); break;
      case 'rating-desc': list.sort(function (a, b) { return b.rating - a.rating; }); break;
    }
    return list;
  }

  /* ---------- 渲染：商品网格 ---------- */
  function renderProducts() {
    var list = getFilteredAndSorted();
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / PER_PAGE));
    if (state.page > pages) state.page = pages;

    var start = (state.page - 1) * PER_PAGE;
    var pageItems = list.slice(start, start + PER_PAGE);

    $('#resultInfo').textContent = '共 ' + total + ' 件商品';
    $('#loading').style.display = 'none';

    var grid = $('#productGrid');
    grid.innerHTML = '';

    if (pageItems.length === 0) {
      $('#emptyState').style.display = '';
      $('#emptyText').textContent = state.keyword ? '没有找到与「' + state.keyword + '」相关的商品' : '该分类下暂无商品';
    } else {
      $('#emptyState').style.display = 'none';
    }

    pageItems.forEach(function (p) {
      grid.appendChild(buildCard(p));
    });

    renderPagination(pages);
  }

  function buildCard(p) {
    var card = document.createElement('div');
    card.className = 'product-card';
    if (!(p.stock > 0)) card.classList.add('out-stock');

    var media = document.createElement('div');
    media.className = 'card-media';
    media.appendChild(imgWithFallback(p.image, p.name));

    var badges = document.createElement('div');
    badges.className = 'card-badges';
    var catObj = state.data.categories.filter(function (c) { return c.name === p.category; })[0];
    if (catObj && catObj.badgeText) {
      var b0 = document.createElement('span');
      b0.className = 'badge tag'; b0.textContent = catObj.badgeText;
      badges.appendChild(b0);
    }
    (p.tags || []).forEach(function (tag, idx) {
      if (idx > 1) return;
      var b = document.createElement('span');
      var t = String(tag);
      var cls = 'tag';
      if (t.indexOf('新品') > -1) cls = 'new';
      else if (t.indexOf('热') > -1) cls = 'hot';
      else if (t.indexOf('促销') > -1 || t.indexOf('清仓') > -1) cls = 'sale';
      b.className = 'badge ' + cls;
      b.textContent = t;
      badges.appendChild(b);
    });
    media.appendChild(badges);
    card.appendChild(media);

    var body = document.createElement('div');
    body.className = 'card-body';

    var cat = document.createElement('div');
    cat.className = 'card-cat';
    cat.textContent = p.category || '未分类';
    body.appendChild(cat);

    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = p.name;
    body.appendChild(name);

    var priceRow = document.createElement('div');
    priceRow.className = 'card-price-row';
    var price = document.createElement('span');
    price.className = 'price';
    price.innerHTML = '<span class="unit">¥</span>' + S.fmtPrice(p.price);
    priceRow.appendChild(price);
    if (p.originalPrice > p.price) {
      var op = document.createElement('span');
      op.className = 'original-price';
      op.textContent = '¥' + S.fmtPrice(p.originalPrice);
      priceRow.appendChild(op);
    }
    body.appendChild(priceRow);

    var meta = document.createElement('div');
    meta.className = 'card-meta';
    var left = document.createElement('span');
    left.innerHTML = '<span class="rating">★ ' + (p.rating || '-') + '</span> · 销量 ' + (p.sales || 0);
    var right = document.createElement('span');
    right.textContent = p.stock > 0 ? '库存 ' + p.stock : '已售罄';
    meta.appendChild(left);
    meta.appendChild(right);
    body.appendChild(meta);

    var footer = document.createElement('div');
    footer.className = 'card-footer';
    var buyBtn = document.createElement('button');
    buyBtn.className = 'btn btn-primary btn-sm';
    buyBtn.textContent = '立即购买';
    buyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openPayModal(p);
    });
    footer.appendChild(buyBtn);
    if (p.link) {
      var lnk = document.createElement('a');
      lnk.className = 'btn btn-sm';
      lnk.textContent = '查看详情 ↗';
      lnk.href = p.link;
      lnk.target = '_blank';
      lnk.rel = 'noopener';
      lnk.addEventListener('click', function (e) { e.stopPropagation(); });
      footer.appendChild(lnk);
    }
    body.appendChild(footer);

    card.appendChild(body);
    card.addEventListener('click', function () { openDetailModal(p); });
    return card;
  }

  /* ---------- 渲染：分页 ---------- */
  function renderPagination(pages) {
    var box = $('#pagination');
    box.innerHTML = '';
    if (pages <= 1) return;

    function addBtn(text, page, opts) {
      var b = document.createElement('button');
      b.className = 'page-btn' + (opts.active ? ' active' : '');
      b.textContent = text;
      b.disabled = !!opts.disabled;
      b.addEventListener('click', function () {
        if (opts.disabled || opts.active) return;
        state.page = page;
        renderProducts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      box.appendChild(b);
    }

    addBtn('‹', state.page - 1, { disabled: state.page === 1 });
    var start = Math.max(1, state.page - 2);
    var end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    for (var i = start; i <= end; i++) {
      addBtn(String(i), i, { active: i === state.page });
    }
    addBtn('›', state.page + 1, { disabled: state.page === pages });
  }

  /* ---------- 详情弹窗 ---------- */
  function openDetailModal(p) {
    $('#detailImg').src = p.image || PLACEHOLDER_IMG;
    $('#detailImg').onerror = function () {
      var that = this;
      if (that._rawTried !== true && p.image) {
        that._rawTried = true;
        that.onerror = null;
        var raw = S.toRawGitUrl(p.image);
        if (raw && raw !== p.image) { that.src = raw; return; }
      }
      that.onerror = null;
      that.src = PLACEHOLDER_IMG;
    };
    $('#detailName').textContent = p.name;
    $('#detailCat').textContent = p.category || '未分类';

    var tags = $('#detailTags');
    tags.innerHTML = '';
    (p.tags || []).forEach(function (t) {
      var s = document.createElement('span');
      s.className = 'badge tag';
      s.textContent = t;
      tags.appendChild(s);
    });

    $('#detailPrice').textContent = S.fmtPrice(p.price);
    var op = $('#detailOriginal');
    if (p.originalPrice > p.price) {
      op.style.display = '';
      op.textContent = '原价 ¥' + S.fmtPrice(p.originalPrice);
    } else {
      op.style.display = 'none';
    }

    var meta = $('#detailMeta');
    meta.innerHTML = '';
    [
      ['库存', p.stock > 0 ? (p.stock + ' 件') : '已售罄'],
      ['销量', p.sales + ' 件'],
      ['评分', '★ ' + (p.rating || '-')],
      ['上架时间', S.fmtDate(p.createdAt)]
    ].forEach(function (kv) {
      var d = document.createElement('div');
      d.className = 'meta-item';
      d.innerHTML = '<b>' + S.escapeHtml(kv[0]) + '：</b>' + S.escapeHtml(kv[1]);
      meta.appendChild(d);
    });

    $('#detailDesc').innerHTML = p.description || '<p>暂无详情描述。</p>';

    var link = $('#externalLink');
    if (p.link) {
      link.style.display = '';
      link.href = p.link;
      link.textContent = '查看外链详情 ↗';
    } else {
      link.style.display = 'none';
    }

    $('#buyBtn').onclick = function () { openPayModal(p); };
    openModal('detailModal');
  }

  /* ---------- 支付弹窗 ---------- */
  function openPayModal(p) {
    var site = state.data.site;
    $('#payImg').src = site.paymentImage || PLACEHOLDER_IMG;
    $('#payImg').onerror = function () {
      var that = this;
      if (that._rawTried !== true && site.paymentImage) {
        that._rawTried = true;
        that.onerror = null;
        var raw = S.toRawGitUrl(site.paymentImage);
        if (raw && raw !== site.paymentImage) { that.src = raw; return; }
      }
      that.onerror = null;
      that.src = PLACEHOLDER_IMG;
    };
    $('#payTip').textContent = '订单：「' + p.name + '」 金额 ¥' + S.fmtPrice(p.price) + '\n' + (site.paymentTip || '');
    var note = $('#payNote');
    if (site.paymentNote) {
      note.style.display = '';
      note.textContent = site.paymentNote;
    } else {
      note.style.display = 'none';
    }
    openModal('payModal');
  }

  /* ---------- 弹窗通用 ---------- */
  function openModal(id) {
    $('#' + id).classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    $('#' + id).classList.remove('open');
    document.body.style.overflow = '';
  }

  /* ---------- 主题 ---------- */
  function applyTheme() {
    var t = S.getTheme();
    S.setTheme(t);
    document.body.setAttribute('data-theme', t);
    $('#themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
  }

  /* ---------- 绑定事件 ---------- */
  function bindEvents() {
    $('#themeBtn').addEventListener('click', function () {
      var t = S.getTheme() === 'dark' ? 'light' : 'dark';
      S.setTheme(t);
      applyTheme();
    });

    var searchTimer = null;
    $('#searchInput').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.keyword = v;
        state.page = 1;
        renderProducts();
      }, 250);
    });

    $('#sortSelect').addEventListener('change', function () {
      state.sort = this.value;
      state.page = 1;
      renderProducts();
    });

    $('#bannerPrev').addEventListener('click', function () { bannerIndex--; updateBanner(); restartBanner(); });
    $('#bannerNext').addEventListener('click', function () { bannerIndex++; updateBanner(); restartBanner(); });

    // 弹窗关闭
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(this.getAttribute('data-close')); });
    });
    ['detailModal', 'payModal'].forEach(function (id) {
      $('#' + id).addEventListener('click', function (e) {
        if (e.target === this) closeModal(id);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeModal('payModal');
        closeModal('detailModal');
      }
    });
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    S.setTheme(S.getTheme());
    await loadData();
    renderSite();
    renderBanner();
    renderCats();
    renderProducts();
    bindEvents();
    applyTheme();
  }

  document.addEventListener('DOMContentLoaded', init);
})();