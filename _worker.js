export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const PASSWORD = env.PASSWORD || "mysecret";

    // ⚡ 缓存 TextEncoder 以减少实例化开销
    const encoder = globalThis._encoder || (globalThis._encoder = new TextEncoder());

    // ⚡ 密码哈希计算仅初始化一次（Worker 冷启动后常驻）
    if (!globalThis._pwdHash) {
      const buf = await crypto.subtle.digest("SHA-256", encoder.encode(PASSWORD));
      // ⚡ 更快的哈希转 hex（使用 typed array 拼接而非 map + join）
      globalThis._pwdHash = Array.prototype.map
        .call(new Uint8Array(buf), x => x.toString(16).padStart(2, "0"))
        .join("");
    }

    const cookie = request.headers.get("Cookie") || "";
    // ⚡ 避免重复正则编译
    const authMatch = /auth=([a-f0-9]{64})/.exec(cookie);
    const isLogin = authMatch && authMatch[1] === globalThis._pwdHash;

    // 登录处理
    if (url.pathname === "/login" && request.method === "POST") {
      const fd = await request.formData();
      const pwd = (fd.get("password") || "").toString();

      // ⚡ 避免重复创建 TextEncoder
      const buf = await crypto.subtle.digest("SHA-256", encoder.encode(pwd));
      const hash = Array.prototype.map
        .call(new Uint8Array(buf), x => x.toString(16).padStart(2, "0"))
        .join("");

      if (hash === globalThis._pwdHash) {
        return new Response(loginSuccess(hash), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // ⚡ 设置缓存指令避免重复登录请求重放
            "cache-control": "no-store",
            "set-cookie": `auth=${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
          }
        });
      }

      return new Response(await loginPage("密码错误，请重试 🔒"), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    // 登出
    if (url.pathname === "/logout" && request.method === "POST") {
      return new Response(await loginPage(), {
        headers: {
          "set-cookie": "auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    // 未登录显示登录页
    if (!isLogin) {
      return new Response(await loginPage(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    // ⚡ 优化 Token 解析逻辑（减少中间数组与循环）
    const tokensStr = env.MULTI_CF_API_TOKENS || "";
    const tokens = tokensStr ? tokensStr.split(",").map(t => t.trim()).filter(Boolean) : [];
    if (!tokens.length) {
      return new Response(
        JSON.stringify({ success: false, error: "未提供 CF API Token", accounts: [] }, null, 2),
        { headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // ⚡ 异步并发获取用量信息（假设 usage 支持 Promise.all 并行）
    const data = await usage(tokens);

    // ⚡ 增加简易缓存头，减少频繁刷新带来的重复计算（前端可缓存几秒）
    return new Response(dashboardHTML(data), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "max-age=15" // 可按需调整
      }
    });
  }
};


// ======= Cloudflare 仪表盘风格 登录页 =======
async function loginPage(message = "") {
  if (!globalThis._baseLoginHTML) {
    const css = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        min-height: 100vh; padding: 1.5rem;
        background: radial-gradient(circle at 25% 25%, #1e1e2f 0%, #0d0d1b 80%);
        color: #cbd5f7;
      }

      .card {
        width: 100%; max-width: 22rem; padding: 2.5rem 2rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 1.25rem;
        backdrop-filter: blur(20px);
        box-shadow: 0 0 25px rgba(0,0,0,0.4), inset 0 0 12px rgba(255,255,255,0.02);
        text-align: center;
        transition: all .3s ease;
      }
      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 0 35px rgba(99,102,241,0.25);
      }

      h1 {
        font-size: 1.35rem;
        font-weight: 700;
        margin-bottom: .75rem;
        background: linear-gradient(90deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      p.desc {
        font-size: .9rem;
        color: #a5b4fc;
        margin-bottom: 1.8rem;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 1.1rem;
      }

      input {
        padding: .9rem 1rem;
        border-radius: .75rem;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.05);
        color: #f1f5f9;
        text-align: center;
        font-size: .95rem;
        transition: all .25s ease;
      }
      input::placeholder {
        color: rgba(255,255,255,0.35);
      }
      input:focus {
        background: rgba(255,255,255,0.1);
        border-color: rgba(99,102,241,0.5);
        box-shadow: 0 0 0 2px rgba(99,102,241,0.35);
        outline: none;
      }

      button {
        border: none;
        border-radius: 9999px;
        padding: .85rem 1rem;
        background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        color: #fff;
        font-weight: 600;
        font-size: .95rem;
        cursor: pointer;
        transition: all .25s ease;
        box-shadow: 0 0 12px rgba(99,102,241,0.3);
      }
      button:hover {
        transform: translateY(-1px);
        box-shadow: 0 0 18px rgba(99,102,241,0.45);
      }

      .msg {
        margin-top: 1rem;
        font-size: .88rem;
        color: #f87171;
      }

      .footer {
        margin-top: 2rem;
        font-size: .75rem;
        color: rgba(148,163,184,0.65);
      }
    `;

    globalThis._baseLoginHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>安全登录 - Cloudflare 仪表盘</title>
  <style>${css}</style>
</head>
<body>
  <div class="card">
    <h1>🌥️ Cloudflare Access</h1>
    <p class="desc">请输入访问密码以进入仪表盘</p>

    <form method="POST" action="/login" autocomplete="off">
      <input type="password" name="password" placeholder="输入访问密码" required />
      <button type="submit">登录</button>
      <!--MSG_PLACEHOLDER-->
    </form>

    <div class="footer">© Cloudflare Workers Dashboard</div>
  </div>
</body>
</html>`;
  }

  return globalThis._baseLoginHTML.replace(
    "<!--MSG_PLACEHOLDER-->",
    message ? `<div class="msg">${message}</div>` : ""
  );
}

// 登录成功页面（简洁过渡）
function loginSuccess(hash) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>登录成功</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  </head>
  <body class="h-screen flex items-center justify-center bg-gradient-to-tr from-indigo-500 via-purple-500 to-sky-400 text-white font-sans">
    <div class="p-8 rounded-3xl bg-white/15 backdrop-blur-lg shadow-2xl text-center animate-fade-in">
      <div class="text-6xl mb-3 drop-shadow-md">✅</div>
      <p class="text-xl font-semibold tracking-wide">登录成功，正在跳转…</p>
    </div>

    <script>
      setTimeout(() => location.href = '/', 1200);
    </script>

    <style>
      @keyframes fade-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }
      .animate-fade-in {
        animation: fade-in 0.6s ease-out forwards;
      }
    </style>
  </body>
</html>`;
}

// ======= 并发池（轻量微调性能）=======
async function promisePool(tasks, concurrency = 5) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then(
      res => {
        executing.delete(p);
        results.push(res);
      },
      err => {
        executing.delete(p);
        // ⚡ 保留错误信息但不中断其他任务
        results.push({ error: err.message });
      }
    );

    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }

  await Promise.allSettled(executing);
  // ⚡ 减少多层数组拼接的开销
  return results.flat();
}

// ======= 获取 Cloudflare 使用量（优化版）=======
async function usage(tokens) {
  const API = "https://api.cloudflare.com/client/v4";
  const FREE_LIMIT = 100000;
  const sum = arr => (arr ? arr.reduce((t, i) => t + (i?.sum?.requests || 0), 0) : 0);

  // ⚡ 内存级缓存：短时间内相同 token 请求直接复用结果（防止 dashboard 刷新时重复 API 调用）
  const cache = globalThis._cfUsageCache || (globalThis._cfUsageCache = new Map());
  const cacheTTL = 60_000; // 60秒缓存
  const now = Date.now();

  try {
    const tokenTasks = tokens.map(APIToken => async () => {
      const cached = cache.get(APIToken);
      if (cached && now - cached.time < cacheTTL) return cached.data;

      const headers = { Authorization: `Bearer ${APIToken}` };

      // ⚡ 提前发送 accounts 请求
      const accRes = await fetch(`${API}/accounts`, { headers });
      if (!accRes.ok) throw new Error(`账户获取失败: ${accRes.status}`);
      const accData = await accRes.json();

      const accountsList = accData?.result || [];
      if (!accountsList.length) return [];

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const varsBase = {
        datetime_geq: dayStart.toISOString(),
        datetime_leq: new Date().toISOString()
      };

      // ⚡ 预构建 GraphQL 查询请求体模板
      const makeQueryBody = id => JSON.stringify({
        query: `query($id:String!,$f:AccountWorkersInvocationsAdaptiveFilter_InputObject){
          viewer{accounts(filter:{accountTag:$id}){
            pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:$f){sum{requests}}
            workersInvocationsAdaptive(limit:10000,filter:$f){sum{requests}}
          }}}`,
        variables: { id, f: varsBase }
      });

      // ⚡ accountTasks 批量并发请求 + 高并发控制
      const accountTasks = accountsList.map(account => async () => {
        const gqlBody = makeQueryBody(account.id);
        const res = await fetch(`${API}/graphql`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: gqlBody
        });

        if (!res.ok) return { account_name: account.name || "未知账号", error: `查询失败: ${res.status}` };
        const json = await res.json();

        if (json.errors?.length) return { account_name: account.name || "未知账号", error: json.errors[0].message };

        const accUsage = json?.data?.viewer?.accounts?.[0];
        const pages = sum(accUsage?.pagesFunctionsInvocationsAdaptiveGroups);
        const workers = sum(accUsage?.workersInvocationsAdaptive);
        const total = pages + workers;

        return {
          account_name: account.name || "未知账号",
          pages,
          workers,
          total,
          free_quota_remaining: Math.max(0, FREE_LIMIT - total)
        };
      });

      const accounts = await promisePool(accountTasks, 5);

      // ⚡ 写入缓存
      const result = accounts.filter(Boolean);
      cache.set(APIToken, { data: result, time: now });
      return result;
    });

    // ⚡ tokens 层并发限制稍调大 (API 支持)
    const accounts = await promisePool(tokenTasks, Math.min(tokens.length, 5));

    // ⚡ 更快的结果展平
    const flatAccounts = accounts.flat().filter(Boolean);

    return { success: true, accounts: flatAccounts };
  } catch (err) {
    return { success: false, error: err.message, accounts: [] };
  }
}

// ======= 仪表盘 HTML（细节优化） =======
function dashboardHTML(data) {
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];

accounts.sort((a, b) => (b.total || 0) - (a.total || 0));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>🌤️ Cloudflare Workers & Pages Usage Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --bg-light: linear-gradient(135deg, #f9fafb, #eff6ff, #ecfdf5);
      --card-light: rgba(255, 255, 255, 0.8);
      --text-light: #1e293b;
      --accent-light: #2563eb;
      --border-light: rgba(0, 0, 0, 0.08);
      --progress-light: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6);

      --bg-dark: radial-gradient(circle at top left, #0f172a, #1e293b, #111827);
      --card-dark: rgba(30, 41, 59, 0.8);
      --text-dark: #f1f5f9;
      --accent-dark: #60a5fa;
      --border-dark: rgba(255, 255, 255, 0.08);
      --progress-dark: linear-gradient(90deg, #38bdf8, #818cf8, #c084fc);

      --radius: 1.25rem;
    }

    body {
      background: var(--bg-light);
      color: var(--text-light);
      font-family: 'Inter', 'Segoe UI', sans-serif;
      transition: all 0.4s ease-in-out;
      min-height: 100vh;
      background-attachment: fixed;
    }
    html.dark body {
      background: var(--bg-dark);
      color: var(--text-dark);
    }

    .navbar {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(90deg, #6366f1, #3b82f6, #06b6d4);
      padding: 1rem 1.5rem;
      border-radius: var(--radius);
      color: white;
      box-shadow: 0 10px 30px rgba(99,102,241,0.25);
      backdrop-filter: blur(16px);
      margin-bottom: 2rem;
      position: sticky;
      top: 1rem;
      z-index: 50;
    }

    .navbar h1 {
      font-weight: 700;
      font-size: clamp(1.2rem, 4vw, 1.75rem);
      text-align: center;
      text-shadow: 0 2px 10px rgba(255,255,255,0.35);
      flex: 1 1 100%;
      margin-bottom: 0.75rem;
    }
    @media (min-width: 640px) {
      .navbar h1 {
        flex: 0 1 auto;
        margin-bottom: 0;
        text-align: left;
      }
    }

    .nav-btn {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
    }

    .nav-btn button {
      background: rgba(255,255,255,0.25);
      padding: 0.6rem 1.2rem;
      border-radius: 9999px;
      border: none;
      color: white;
      font-weight: 500;
      letter-spacing: 0.3px;
      cursor: pointer;
      backdrop-filter: blur(6px);
      transition: all 0.3s ease;
    }

    .nav-btn button:hover {
      background: rgba(255,255,255,0.4);
      transform: translateY(-2px);
      box-shadow: 0 4px 10px rgba(255,255,255,0.25);
    }

    .card {
      background: var(--card-light);
      border-radius: var(--radius);
      padding: 1.75rem;
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      border: 1px solid var(--border-light);
      transition: all 0.4s ease;
      backdrop-filter: blur(10px);
      text-align: left;
      position: relative;
      overflow: hidden;
    }
    html.dark .card {
      background: var(--card-dark);
      border: 1px solid var(--border-dark);
      box-shadow: 0 12px 30px rgba(0,0,0,0.4);
    }
    .card:hover {
      transform: translateY(-5px) scale(1.02);
      box-shadow: 0 20px 40px rgba(99,102,241,0.25);
    }
    .card::before {
      content: "";
      position: absolute;
      top: -40%;
      left: -40%;
      width: 180%;
      height: 180%;
      background: radial-gradient(circle at top left, rgba(99,102,241,0.15), transparent 70%);
      transform: rotate(25deg);
      z-index: 0;
    }
    .card h2 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: var(--accent-light);
      position: relative;
      z-index: 1;
    }
    html.dark .card h2 {
      color: var(--accent-dark);
    }

    .card .content {
      position: relative;
      z-index: 1;
      font-size: 1rem;
      line-height: 1.7;
      color: inherit;
    }
    .card p {
      display: flex;
      justify-content: space-between;
      margin: 0.25rem 0;
    }
    .num {
      font-weight: 700;
      font-size: 1.05rem;
      color: inherit;
    }

    .progress-bar {
      width: 100%;
      height: 0.75rem;
      background-color: rgba(0,0,0,0.1);
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 0.8rem;
      position: relative;
    }
    html.dark .progress-bar {
      background-color: rgba(255,255,255,0.1);
    }
    .progress {
      height: 100%;
      background: var(--progress-light);
      border-radius: 9999px;
      transition: width 1s ease-in-out;
      box-shadow: 0 0 10px rgba(59,130,246,0.4);
    }
    html.dark .progress {
      background: var(--progress-dark);
      box-shadow: 0 0 10px rgba(129,140,248,0.3);
    }

    .progress-text {
      font-size: 0.85rem;
      margin-top: 0.4rem;
      text-align: right;
      opacity: 0.75;
    }

    footer {
      margin-top: 3rem;
      text-align: center;
      opacity: 0.85;
      font-size: 0.9rem;
    }
    footer a {
      background: linear-gradient(90deg, #6366f1, #10b981);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 600;
      text-decoration: none;
    }
    footer a:hover {
      filter: brightness(1.3);
    }

    /* ===== Loading 层 ===== */
    #loading-screen {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.85);
      color: #1e293b;
      backdrop-filter: blur(10px);
      z-index: 9999;
      transition: opacity 0.7s ease;
    }
    html.dark #loading-screen {
      background: rgba(0,0,0,0.7);
      color: #f1f5f9;
    }
    #loading-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(96,165,250,0.3);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>

<body class="flex flex-col items-center p-6 relative overflow-x-hidden">
  <!-- Loading 层 -->
  <div id="loading-screen">
    <div id="loading-spinner"></div>
    <p>正在加载数据，请稍候...</p>
  </div>

  <nav class="navbar">
    <h1>🌤️ Cloudflare Workers & Pages Usage 仪表盘</h1>
    <div class="nav-btn">
      <button id="refresh-btn">🔄 刷新数据</button>
      <button id="theme-toggle">🌗 切换主题</button>
    </div>
  </nav>

  <main id="data-section" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
    ${accounts.map(a => {
      const used = ((a.total / (a.total + a.free_quota_remaining || 1)) * 100).toFixed(1);
      return `
      <div class="card">
        <h2>${a.account_name}</h2>
        <div class="content">
          <p>📄 Pages：<span class="num" data-value="${a.pages}">0</span></p>
          <p>⚙️ Workers：<span class="num" data-value="${a.workers}">0</span></p>
          <p>📦 总计：<span class="num" data-value="${a.total}">0</span></p>
          <p>🎁 免费额度剩余：<span class="num" data-value="${a.free_quota_remaining}">0</span></p>
        </div>
        <div class="progress-bar"><div class="progress" style="width:${used}%"></div></div>
        <p class="progress-text">${used}% 已使用</p>
      </div>`;
    }).join('')}
  </main>

  <footer>©2025 Cloudflare Worker Dashboard • Designed with 💜 by <a href="https://github.com/arlettebrook" target="_blank">Arlettebrook</a></footer>

  <script>
    // 数字动画
    function animateNumbers() {
      document.querySelectorAll('.num').forEach(el => {
        const target = +el.dataset.value;
        let count = 0;
        const step = target / 60;
        const timer = setInterval(() => {
          count += step;
          if (count >= target) {
            count = target;
            clearInterval(timer);
          }
          el.textContent = Math.floor(count).toLocaleString();
        }, 20);
      });
    }

    // Loading 淡出
    window.addEventListener('load', () => {
      animateNumbers();
      const loader = document.getElementById('loading-screen');
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 700);
    });

    // 刷新按钮
    document.getElementById('refresh-btn').addEventListener('click', () => {
      document.body.style.opacity = '0.6';
      setTimeout(() => location.reload(), 300);
    });

    // 主题切换
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    if (localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    }
    toggle.addEventListener('click', () => {
      root.classList.toggle('dark');
      localStorage.setItem('theme', root.classList.contains('dark') ? 'dark' : 'light');
    });
  </script>
</body>
</html>`;
}

// ======= 工具函数（后端/渲染帮助） =======
function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (s) => {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
  });
}