## ☁️ CF Usage Checker

通过 Cloudflare API 获取指定账户下 Workers 与 Pages Functions 的调用次数（使用情况）。
支持多账户查询，并可通过密码访问结果页面。

> 🔧 支持多个 Cloudflare 账户（API Token）
🔒 访问需密码保护（通过环境变量 PASSWORD）
⚡️ 一键部署至 Cloudflare Workers




---

## 🚀 功能介绍

获取 Cloudflare Workers 与 Pages Functions 的使用量数据

支持多个 Cloudflare 账户（通过多个 API Token）

使用简单：访问 URL 输入密码即可查看统计

轻量级、无依赖，仅需 Cloudflare Worker 即可运行

### 📄 示例输出

查询成功后，页面将显示类似以下内容：

![Screenshot_2025-11-06-23-19-08-17_40deb401b9ffe8e1df2f1cc5ba480b12.jpg](https://twilight.vvvv.ee/file/1762442543582_Screenshot_2025-11-06-23-19-08-17_40deb401b9ffe8e1df2f1cc5ba480b12.jpg)

![Screenshot_2025-11-06-23-18-53-93_40deb401b9ffe8e1df2f1cc5ba480b12.jpg](https://twilight.vvvv.ee/file/1762442529530_Screenshot_2025-11-06-23-18-53-93_40deb401b9ffe8e1df2f1cc5ba480b12.jpg)

---

## 🧩 部署方式

方式一：通过 GitHub 仓库自动部署

1. Fork 本仓库
2. 前往 Cloudflare Dashboard → Workers & Pages → Pages
3. 点击「创建项目」→「连接到 Git」
4. 选择你 Fork 的仓库
5. 配置构建设置：
   · 项目名称：cf-usage-checker（可自定义）
   · 生产分支：main（根据你的仓库设置）
   · 构建设置：
     · 构建命令：留空
     · 构建输出目录：留空
6. 点击「保存并部署」

方法二：使用 GitHub 仓库导入部署（推荐）

1. Fork 本仓库


2. 前往 Cloudflare Dashboard → Workers & Pages


3. 点击「创建应用 → 创建 Worker」


4. 选择「从 GitHub 仓库导入」


5. 选择你 Fork 的仓库
项目名填写为：`cf-usage-checker`


6. 其他设置保持默认，点击 部署

~~（注意：使用此方式部署每次更新部署都需要重新设置环境变量）~~ 已解决



---

方法二：手动部署（复制源码）

1. 登录 Cloudflare Dashboard


2. 创建新的 Worker


3. 模板选择「Hello World」


4. 删除默认代码，粘贴仓库中的 _worker.js 源码


5. 点击 保存并部署




---

## ⚙️ 环境变量配置

在 Cloudflare Workers 控制台中，进入
Settings → Variables → Environment Variables
添加以下环境变量：

变量名	示例值	说明：
```shell
MULTI_CF_API_TOKENS = token1,token2,token3...
# 多个 Cloudflare API Token，用英文逗号分隔

PASSWORD = mysecret # 用于访问保护的默认密码
```

---

### 🧰 API Token 获取方式
快速直接的方式:
- 进入Cloudflare账户管理-账户API令牌-创建令牌
- API令牌权限：使用 "阅读分析数据和日志" 模板即可（需要指定账户的所有区域）



---

## 🔐 使用说明

1. 部署完成后，访问你的部署地址（可自定域）
2. 页面会提示输入访问密码
3. 输入你在环境变量中设置的 PASSWORD
4. 即可查看各账户的 Workers 与 Pages Functions 调用统计信息







