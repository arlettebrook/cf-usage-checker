export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const PASSWORD = env.PASSWORD || "mysecret";

    // 缓存密码哈希（首次计算后复用）
    if (!globalThis._pwdHash) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PASSWORD));
      globalThis._pwdHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/auth=([a-f0-9]{64})/);
    const isLogin = m && m[1] === globalThis._pwdHash;

    // 登录处理
    if (url.pathname === "/login" && request.method === "POST") {
      const fd = await request.formData();
      const pwd = (fd.get("password") || "").toString();
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pwd));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (hash === globalThis._pwdHash) {
        return new Response(loginSuccess(hash), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "set-cookie": `auth=${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
          }
        });
      }
      return new Response(await loginPage("密码错误，请重试 🔒"), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // 登出
    if (url.pathname === "/logout" && request.method === "POST") {
      return new Response(await loginPage(), {
        headers: { "set-cookie": "auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "content-type": "text/html; charset=utf-8" }
      });
    }

    // 未登录显示登录页
    if (!isLogin) {
      return new Response(await loginPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // 读取 tokens
    const tokens = (env.MULTI_CF_API_TOKENS || "").split(",").map(t => t.trim()).filter(Boolean);
    if (!tokens.length) {
      return new Response(JSON.stringify({ success: false, error: "未提供 CF API Token", accounts: [] }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const data = await usage(tokens);
    return new Response(dashboardHTML(data), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
};

// ======= 登录页（美化 + 交互） =======
async function loginPage(message = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>安全登录</title>
  <style>
    :root{
      --card-radius:18px;
      --glass: rgba(255,255,255,0.12);
      --glass-strong: rgba(255,255,255,0.18);
      --accent1:#6366f1;
      --accent2:#06b6d4;
      --accent3:#8b5cf6;
      --text: #ffffff;
      --muted: rgba(255,255,255,0.85);
      --error-bg: rgba(239,68,68,0.12);
      --error: #fee2e2;
    }
    *{box-sizing:border-box}
    html,body{height:100%;margin:0}
    body{
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:Inter,"Segoe UI",system-ui, -apple-system, "Helvetica Neue", Arial;
      background:linear-gradient(120deg,var(--accent1),var(--accent2),var(--accent3));
      background-size:300% 300%;
      animation: bgMove 14s ease-in-out infinite;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
      color:var(--text);
      padding:24px;
    }
    @keyframes bgMove{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    .stage{
      width:100%;
      max-width:420px;
      margin:auto;
      position:relative;
    }
    .ghost-glow{
      position:absolute;inset:auto 0 -10% 0;height:200px;border-radius:50%;
      background:radial-gradient(closest-side, rgba(255,255,255,0.08), transparent 40%);
      filter:blur(40px);pointer-events:none;
    }
    .card{
      background:var(--glass);
      border-radius:var(--card-radius);
      padding:28px;
      box-shadow:
        0 6px 24px rgba(14, 18, 35, 0.28),
        inset 0 1px 0 rgba(255,255,255,0.03);
      backdrop-filter: blur(12px) saturate(120%);
      border: 1px solid rgba(255,255,255,0.06);
      transform:translateY(6px);
      transition: transform .45s cubic-bezier(.2,.9,.2,1), box-shadow .45s;
    }
    .card:hover{ transform:translateY(0); box-shadow:0 18px 60px rgba(14,18,35,0.38) }
    h1{font-size:20px;margin:0 0 8px 0;letter-spacing:0.2px}
    p.lead{margin:0 0 16px 0;color:var(--muted);font-size:14px;line-height:1.6}
    form{display:flex;flex-direction:column;gap:12px}
    input[type="password"]{
      width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);
      background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02));
      color:var(--text);font-size:15px;outline:none;transition:box-shadow .25s, transform .15s;
      line-height:1.3;text-align:center;
    }
    input[type="password"]::placeholder{color:rgba(255,255,255,0.75)}
    input[type="password"]:focus{box-shadow:0 8px 30px rgba(99,102,241,0.16);transform:translateY(-1px)}
    .controls{display:flex;gap:12px;align-items:center}
    button.cta{
      flex:1;padding:10px 14px;border-radius:999px;border:0;background:
      linear-gradient(90deg, rgba(59,130,246,0.95), rgba(139,92,246,0.95));
      color:white;font-weight:600;cursor:pointer;box-shadow:0 8px 30px rgba(99,102,241,0.18);
      transition:transform .18s cubic-bezier(.2,.9,.2,1), box-shadow .25s;
    }
    button.cta:active{transform:translateY(1px)}
    button.cta:focus{outline:3px solid rgba(99,102,241,0.15);outline-offset:3px}
    .secondary{background:transparent;border:1px solid rgba(255,255,255,0.06);padding:9px 12px;border-radius:999px;color:var(--text)}
    .error{
      margin-top:6px;padding:10px;border-radius:10px;background:var(--error-bg);
      color:var(--error);font-size:13px;border:1px solid rgba(255,255,255,0.04)
    }
    .footer{margin-top:14px;text-align:center;color:rgba(255,255,255,0.78);font-size:13px}
    @media (max-width:420px){ .card{padding:20px} h1{font-size:18px} }
  </style>
</head>
<body>
  <div class="stage">
    <div class="ghost-glow" aria-hidden="true"></div>
    <div class="card" role="region" aria-label="登录面板">
      <h1>🔐 受保护的仪表盘访问</h1>
      <p class="lead">请输入预设密码以访问 Cloudflare 使用量仪表盘。</p>
      <form method="POST" action="/login" autocomplete="off">
        <input type="password" name="password" placeholder="输入访问密码" required aria-label="密码">
        <div class="controls">
          <button type="submit" class="cta">登录</button>
          <button type="button" class="secondary" onclick="document.querySelector('input[name=password]').value='';document.querySelector('input[name=password]').focus();">清除</button>
        </div>
        ${message ? `<div class="error" role="alert">${message}</div>` : ''}
      </form>
      <div class="footer">Cloudflare Workers • 受保护访问</div>
    </div>
  </div>
</body>
</html>`;
}

// 登录成功页面（简洁过渡）
function loginSuccess(hash) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>登录成功</title><style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;
  font-family:Inter,Segoe UI;background:linear-gradient(120deg,#7c3aed,#06b6d4);color:#fff}
  .badge{padding:28px;border-radius:16px;background:rgba(255,255,255,0.08);backdrop-filter:blur(8px);text-align:center}
  .tick{font-size:40px;margin-bottom:8px}p{margin:0}</style></head><body>
  <div class="badge"><div class="tick">✅</div><p>登录成功，正在跳转…</p></div>
  <script>setTimeout(()=>location.href='/',1200)</script></body></html>`;
}

// ======= 并发池（修复完成处理） =======
async function promisePool(tasks, concurrency = 5) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().then(res => {
      executing.delete(p);
      results.push(res);
    });
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results.flat();
}

// ======= 获取 Cloudflare 使用量 =======
async function usage(tokens) {
  const API = "https://api.cloudflare.com/client/v4";
  const FREE_LIMIT = 100000;
  const sum = (arr) => (arr || []).reduce((t, i) => t + (i?.sum?.requests || 0), 0);

  try {
    const tokenTasks = tokens.map(APIToken => async () => {
      const headers = {
        "Authorization": `Bearer ${APIToken}`
      };
      const accRes = await fetch(`${API}/accounts`, { headers });
      if (!accRes.ok) throw new Error(`账户获取失败: ${accRes.status}`);
      const accData = await accRes.json();
      if (!accData?.result?.length) return [];

      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const varsBase = { datetime_geq: dayStart.toISOString(), datetime_leq: new Date().toISOString() };

      const accountTasks = accData.result.map(account => async () => {
        const gql = {
          query: `query($id:String!,$f:AccountWorkersInvocationsAdaptiveFilter_InputObject){
            viewer{accounts(filter:{accountTag:$id}){
              pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:$f){sum{requests}}
              workersInvocationsAdaptive(limit:10000,filter:$f){sum{requests}}
            }}}`,
          variables: { id: account.id, f: varsBase }
        };

        const res = await fetch(`${API}/graphql`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(gql)
        });

        if (!res.ok) throw new Error(`查询失败: ${res.status}`);
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);

        const accUsage = json?.data?.viewer?.accounts?.[0] || {};
        const pages = sum(accUsage.pagesFunctionsInvocationsAdaptiveGroups);
        const workers = sum(accUsage.workersInvocationsAdaptive);
        const total = pages + workers;
        return {
          account_name: account.name || "未知账号",
          pages, workers, total,
          free_quota_remaining: Math.max(0, FREE_LIMIT - total)
        };
      });

      // 每个 token 下并发限制
      return promisePool(accountTasks, 5);
    });

    const accounts = await promisePool(tokenTasks, 3);
    return { success: true, accounts: accounts };
  } catch (err) {
    return { success: false, error: err.message, accounts: [] };
  }
}

// ======= 仪表盘 HTML（细节优化） =======
function dashboardHTML(data) {
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];

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
      --bg-dark: radial-gradient(circle at top left, #0f172a, #1e293b, #111827);
      --card-light: rgba(255, 255, 255, 0.8);
      --card-dark: rgba(30, 41, 59, 0.8);
      --text-light: #1e293b;
      --text-dark: #f1f5f9;
      --accent-light: #2563eb;
      --accent-dark: #60a5fa;
      --border-light: rgba(0, 0, 0, 0.08);
      --border-dark: rgba(255, 255, 255, 0.08);
      --progress-light: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6);
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

    .nav-btn button {
      background: rgba(255,255,255,0.25);
      padding: 0.6rem 1.2rem;
      border-radius: 9999px;
      border: none;
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .nav-btn button:hover {
      background: rgba(255,255,255,0.4);
      transform: translateY(-2px);
    }

    .card {
      background: var(--card-light);
      border-radius: var(--radius);
      padding: 1.75rem;
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      border: 1px solid var(--border-light);
      backdrop-filter: blur(10px);
      text-align: left;
      transition: all 0.4s ease;
      overflow: hidden;
      position: relative;
    }
    html.dark .card {
      background: var(--card-dark);
      border: 1px solid var(--border-dark);
      box-shadow: 0 12px 30px rgba(0,0,0,0.4);
    }
    .card:hover {
      transform: translateY(-5px) scale(1.02);
    }

    .card h2 {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: var(--accent-light);
    }
    html.dark .card h2 {
      color: var(--accent-dark);
    }

    .progress-bar {
      width: 100%;
      height: 0.75rem;
      background-color: rgba(0,0,0,0.1);
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 0.8rem;
    }
    html.dark .progress-bar {
      background-color: rgba(255,255,255,0.1);
    }

    .progress {
      height: 100%;
      background: var(--progress-light);
      border-radius: 9999px;
      transition: width 1s ease-in-out;
    }
    html.dark .progress {
      background: var(--progress-dark);
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

    /* Skeleton 样式 */
    .skeleton {
      background: linear-gradient(100deg, rgba(255,255,255,0.2) 40%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.2) 60%);
      background-size: 200% 100%;
      animation: shimmer 1.6s infinite;
      border-radius: 0.5rem;
    }
    html.dark .skeleton {
      background: linear-gradient(100deg, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.1) 60%);
    }
    @keyframes shimmer {
      100% {
        background-position: -200% 0;
      }
    }

    .skeleton-line {
      height: 1rem;
      margin-bottom: 0.6rem;
    }
    .skeleton-title {
      width: 70%;
      height: 1.4rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body class="flex flex-col items-center p-6">
  <nav class="navbar">
    <h1>🌤️ Cloudflare Usage Dashboard</h1>
    <div class="nav-btn">
      <button id="refresh-btn">🔄 刷新</button>
      <button id="theme-toggle">🌗 主题</button>
    </div>
  </nav>

  <main id="data-section" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
    <!-- 骨架屏初始加载 -->
    ${Array(6).fill(0).map(() => `
      <div class="card">
        <div class="skeleton skeleton-title"></div>
        ${Array(4).fill(0).map(() => `<div class="skeleton skeleton-line w-${Math.floor(Math.random() * 40) + 60}%"></div>`).join('')}
        <div class="skeleton h-3 w-full mt-4 rounded-full"></div>
      </div>
    `).join('')}
  </main>

  <footer>©2025 Cloudflare Dashboard • by <a href="https://github.com/arlettebrook" target="_blank">Arlettebrook</a></footer>

  <script>
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    }
    toggle.addEventListener('click', () => {
      root.classList.toggle('dark');
      localStorage.setItem('theme', root.classList.contains('dark') ? 'dark' : 'light');
    });

    // 模拟数据加载后替换骨架屏
    window.addEventListener('load', () => {
      setTimeout(() => {
        const main = document.getElementById('data-section');
        main.innerHTML = \`${accounts.map(a => {
          const used = ((a.total / (a.total + a.free_quota_remaining || 1)) * 100).toFixed(1);
          return `
          <div class="card">
            <h2>${a.account_name}</h2>
            <p>📄 Pages：<span>${a.pages}</span></p>
            <p>⚙️ Workers：<span>${a.workers}</span></p>
            <p>📦 总计：<span>${a.total}</span></p>
            <p>🎁 免费额度剩余：<span>${a.free_quota_remaining}</span></p>
            <div class="progress-bar"><div class="progress" style="width:${used}%"></div></div>
            <p class="progress-text">${used}% 已使用</p>
          </div>`;
        }).join('')}\`;
      }, 1000); // 模拟网络延迟
    });

    document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
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