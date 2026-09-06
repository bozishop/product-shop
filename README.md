# 🛒 拾光小铺 · GitHub Pages 静态商品展示站

纯 HTML + CSS + 原生 JavaScript 实现的商品展示站点，**零依赖、零构建**，克隆/上传到 GitHub 仓库并开启 Pages 即可访问。包含：

- **前台 `index.html`**：商品卡片网格、分类筛选、搜索、排序、分页、详情弹窗（富文本，支持 Word 排版）、点击「立即购买」弹出收款二维码、明暗主题、响应式布局。
- **后台 `admin.html`**：登录保护、商品增删改查、富文本详情（兼容 Word 粘贴）、分类管理、站点设置（标题/公告/轮播/收款码）、图片上传（GitHub API 一键上传 + base64 降级）、一键发布、数据导入导出。

---

## 一、快速开始（本地预览）

本目录为纯静态文件，直接双击 `index.html` 即可预览。若需要 `fetch(products.json)` 正常工作，请使用本地静态服务器（否则会回退到内置默认数据，功能一致）：

```bash
# Python 3
cd product-shop
python -m http.server 8000
# 然后访问 http://localhost:8000/index.html
# 后台 http://localhost:8000/admin.html  默认密码 admin123
```

> 也可以用 VS Code 的 Live Server 插件。

---

## 二、部署到 GitHub Pages

### 1. 创建仓库并上传
```bash
git init
git add .
git commit -m "init: product shop site"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin main
```

### 2. 开启 Pages
仓库页面 → **Settings → Pages** → **Source** 选择 `Deploy from a branch` → 分支选 `main`，目录 `/ (root)` → Save。

稍等 1~2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可看到前台页面。

> 💡 若仓库名就是 `<你的用户名>.github.io`，则站点地址为 `https://<你的用户名>.github.io/`（根路径），本项目的相对路径写法两种都兼容。

---

## 三、如何更新网站内容

网站数据存在 `products.json`（仓库根目录），后台的每次编辑会先写入**当前浏览器 localStorage**（仅自己可见的预览），要让大家看到，有两种方式：

### 方式 A：后台「一键发布」（推荐）
1. 打开 `admin.html` → GitHub 同步 页面；
2. 填写 **owner / repo / Token / 分支(默认 main)**；
3. 点「测试连接」→ 成功后点「🚀 一键发布数据」；
4. 约 1 分钟内所有访客即可看到新内容。

同时「上传图片」功能也会直接提交到仓库 `images/` 目录并自动写回相对路径。

> 💡 **上传图片后无需等待 Pages 部署，前台可立即显示**：前台/后台的所有商品图、轮播图、收款码均内置了「raw 直链自动升级」——当相对路径 `images/xxx.jpg` 在 Pages 部署延迟窗口内 404 时，会自动改用 `raw.githubusercontent.com/<owner>/<repo>/main/images/xxx.jpg` 直链加载（图片 commit 落盘即可访问，秒级生效），部署完成后自动回到正式路径。此机制仅在 `*.github.io` 域名下启用，本地开发与外链图片不受影响。

### 方式 B：手动导出 + push
1. 后台「数据管理」→ 下载 `products.json`；
2. 替换仓库根目录里的 `products.json`；
3. 提交并推送：
```bash
git add products.json
git commit -m "update products"
git push
```

---

## 四、获取 GitHub Token（用于一键上传/发布）

1. 打开 GitHub → 右上角头像 → **Settings**；
2. 左侧最下方 → **Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**；
3. 勾选 `repo` 权限，有效期可设为 90 天或自定义；
4. 生成后复制（只显示一次！），粘贴到后台「GitHub 同步」页面；
5. Token 仅保存在**你浏览器的 localStorage**，不会写入任何公开文件。请勿泄露给他人。

> 安全建议：也可以使用 **Fine-grained token**（更精细），仅授权目标仓库、Contents 读写权限。

---

## 四、目录结构

```
product-shop/
├── index.html           前台商品展示页
├── admin.html           后台配置页
├── products.json        公开商品数据（前台读取）
├── css/
│   ├── main.css         前台样式
│   └── admin.css        后台样式
├── js/
│   ├── store.js         数据层（localStorage / 导入导出 / GitHub API）
│   ├── main.js          前台逻辑
│   └── admin.js         后台逻辑（富文本 / 图片上传 / 发布）
├── images/              图片目录（上传的图片会提交到这里）
└── README.md
```

---

## 五、常见问题

| 问题 | 说明 |
|---|---|
| 双击打开没有轮播/公告？ | 浏览器 file 协议禁止 fetch，改用 `python -m http.server` 或部署后访问 |
| 前台看不到后台改的数据？ | 只改了本浏览器 localStorage；请「一键发布」或手动 push products.json |
| 上传图片报 403？ | Token 权限不足，请确认勾选 `repo`；或检查分支名 |
| 刚上传的图片 404？ | Pages 部署有 1~2 分钟延迟；前台会自动改用 raw 直链立即显示，正式路径稍后自动恢复 |
| 改了密码其他设备没生效？ | 密码哈希随 products.json 保存；修改后需「一键发布」同步到线上，其他设备才使用新密码（发布前仍是旧密码/默认 admin123） |
| 前台没有商品？ | 检查 `products.json` 是否有 `products` 数组，且商品 `active: true` |
| 想清掉本地预览数据？ | 后台「数据管理」→ 恢复默认示例数据；或浏览器清除该站点 localStorage |

如有问题欢迎在仓库提 Issue。