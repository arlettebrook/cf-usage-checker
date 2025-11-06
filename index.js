
export default {
  async fetch(request, env, ctx) {


    const url = new URL(request.url);
    const PASSWORD = env.PASSWORD || "mysecret";

    // 计算 SHA-256 哈希函数
    async function hash(str) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }

    const cookie = request.headers.get("Cookie") || "";
    const cookieMatch = cookie.match(/auth=([a-f0-9]{64})/);
    const cookieHash = cookieMatch ? cookieMatch[1] : null;
    const passwordHash = await hash(PASSWORD);
    const isLoggedIn = cookieHash === passwordHash;

    // 🔑 登录逻辑
    if (url.pathname === "/login" && request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password");
      const inputHash = await hash(password);

      if (inputHash === passwordHash) {
        // ✅ 登录成功页面（带动画过渡）
        return new Response(`
          <!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录成功</title>
  <style>
    :root {
      --bg-light: linear-gradient(135deg, #89f7fe, #66a6ff);
      --bg-dark: linear-gradient(135deg, #1f1c2c, #928dab);
      --card-bg: rgba(255, 255, 255, 0.15);
      --text-light: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body {
        background: var(--bg-dark);
      }
    }
    body {
      height: 100vh;
      margin: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: var(--bg-light);
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      color: var(--text-light);
      animation: fadeIn 0.8s ease;
      overflow: hidden;
    }
    .card {
      backdrop-filter: blur(10px);
      background: var(--card-bg);
      border-radius: 16px;
      padding: 3rem 2.5rem;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
      animation: popIn 0.7s ease;
    }
    svg {
      width: 80px;
      height: 80px;
      margin-bottom: 1rem;
      stroke-dasharray: 100;
      stroke-dashoffset: 100;
      animation: draw 1s ease forwards, bounce 1s ease;
    }
    h2 {
      margin: 0.5rem 0;
      font-size: 1.8rem;
      font-weight: 600;
      animation: fadeSlide 1s ease forwards;
    }
    p {
      font-size: 1rem;
      opacity: 0.85;
      animation: fadeSlide 1.2s ease forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes popIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    @keyframes bounce {
      0% { transform: scale(0.8); }
      60% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    @keyframes draw {
      to { stroke-dashoffset: 0; }
    }
    @keyframes fadeSlide {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
  <script>
    setTimeout(() => location.href = '/', 1500);
  </script>
</head>
<body>
  <div class="card">
    <svg viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="25" fill="none" stroke="white" stroke-width="2"/>
      <path fill="none" stroke="white" stroke-width="4" d="M14 27l7 7 17-17"/>
    </svg>
    <h2>登录成功！</h2>
    <p>正在跳转，请稍候...</p>
  </div>
</body>
</html>
        `, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Set-Cookie": `auth=${inputHash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
          },
        });
      } else {
        // ❌ 密码错误：重新显示登录页并带上错误提示
        return new Response(await renderLoginPage("密码错误，请重试 🔒"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // 🧹 登出逻辑（可选）
    if (url.pathname === "/logout" && request.method === "POST") {
      return new Response("<script>location.href='/'</script>", {
        headers: {
          "Set-Cookie": `auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    // 🚪 未登录：显示登录页
    if (!isLoggedIn) {
      return new Response(await renderLoginPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }





    // 多个 Token 以逗号分隔
    const tokens = (env.MULTI_CF_API_TOKENS || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    if (!tokens.length) {
      return new Response(
        JSON.stringify({ success: false, error: "未提供任何 CF API Token", accounts: [] }, null, 2),
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const data = await getCloudflareUsage(tokens);

    const html = `
<!DOCTYPE html>
<html lang="zh-CN" class="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>🌤️ Cloudflare Workers & Pages Usage Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>

  <style>
    :root {
      /* ===== 亮色主题 ===== */
      --bg-light: linear-gradient(135deg, #f9fafb, #eff6ff, #ecfdf5);
      --card-light: rgba(255, 255, 255, 0.8);
      --text-light: #1e293b;
      --accent-light: #2563eb;
      --border-light: rgba(0, 0, 0, 0.08);
      --progress-light: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6);

      /* ===== 暗色主题 ===== */
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

    /* ===== 导航栏 ===== */
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

    /* ===== 卡片样式 ===== */
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
      align-items: center;
      margin: 0.25rem 0;
    }

    .card strong {
      font-weight: 600;
      opacity: 0.9;
    }

    .num {
      font-weight: 700;
      font-size: 1.05rem;
      text-shadow: 0 1px 4px rgba(0,0,0,0.08);
      color: inherit;
    }

    /* ===== 进度条 ===== */
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

    /* ===== 页脚 ===== */
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
      text-decoration: none;
      font-weight: 600;
      transition: all 0.3s ease;
    }

    footer a:hover {
      filter: brightness(1.3);
      text-shadow: 0 0 8px rgba(99,102,241,0.4);
    }

    /* ===== 动态光影背景 ===== */
    .animated-bg {
      position: absolute;
      inset: 0;
      z-index: -1;
      background: radial-gradient(circle at 20% 30%, #a5b4fc22, transparent 40%),
                  radial-gradient(circle at 80% 70%, #67e8f922, transparent 40%);
      animation: floatBg 12s ease-in-out infinite alternate;
    }

    @keyframes floatBg {
      from { transform: translateY(0px); }
      to { transform: translateY(-20px); }
    }
  </style>
</head>

<body class="flex flex-col items-center p-6 relative overflow-x-hidden">
  <div class="animated-bg"></div>

  <!-- 顶部导航栏 -->
  <nav class="navbar">
    <h1>🌤️ Cloudflare Workers & Pages Usage 仪表盘</h1>
    <div class="nav-btn">
      <button id="refresh-btn">🔄 刷新数据</button>
      <button id="theme-toggle">🌗 切换主题</button>
    </div>
  </nav>

  <!-- 主内容区域：保持原有渲染方式 -->
  <main id="data-section" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
    ${data.accounts.map(acc => {
      const usedPercent = (acc.total / (acc.total + acc.free_quota_remaining) * 100).toFixed(1);
      return `
      <div class="card">
        <h2>${acc.account_name}</h2>
        <div class="content text-gray-700 dark:text-gray-200">
          <p><strong>📄 Pages：</strong><span class="num" data-value="${acc.pages}">0</span></p>
          <p><strong>⚙️ Workers：</strong><span class="num" data-value="${acc.workers}">0</span></p>
          <p><strong>📦 总计：</strong><span class="num" data-value="${acc.total}">0</span></p>
          <p><strong>🎁 免费额度剩余：</strong><span class="num" data-value="${acc.free_quota_remaining}">0</span></p>
        </div>
        <div class="progress-bar">
          <div class="progress" style="width: ${usedPercent}%"></div>
        </div>
        <p class="progress-text">${usedPercent}% 已使用</p>
      </div>`;
    }).join('')}
  </main>

  <footer>
    © 2025 Cloudflare Worker Dashboard • Designed with 💜 by 
    <a href="https://github.com/arlettebrook" target="_blank">Arlettebrook</a>
  </footer>

  <script>
    // 动态数字动画
    function animateNumbers() {
      document.querySelectorAll('.num').forEach(el => {
        const target = +el.getAttribute('data-value');
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
    animateNumbers();

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
</html>
`;








    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
    
};



// 🌈 登录页渲染函数
async function renderLoginPage(errorMsg = "") {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>安全登录</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          background: linear-gradient(135deg, #89f7fe, #66a6ff);
          font-family: "Segoe UI", sans-serif;
          color: #333;
        }
        .card {
          background: #fff;
          padding: 2.5rem;
          border-radius: 16px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          width: 90%;
          max-width: 350px;
          text-align: center;
          animation: fadeIn 0.6s ease;
        }
        .card h2 {
          margin-bottom: 1rem;
          font-size: 1.5rem;
        }
        input[type="password"] {
          width: 100%;
          padding: 0.75rem;
          margin-top: 1rem;
          border: 1px solid #ccc;
          border-radius: 8px;
          font-size: 1rem;
          transition: all 0.3s;
        }
        input[type="password"]:focus {
          outline: none;
          border-color: #0078f2;
          box-shadow: 0 0 6px rgba(0,120,242,0.3);
        }
        button {
          width: 100%;
          padding: 0.8rem;
          margin-top: 1.5rem;
          background: #0078f2;
          border: none;
          color: white;
          font-size: 1rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.3s, transform 0.1s;
        }
        button:hover { background: #005fcc; }
        button:active { transform: scale(0.98); }
        .error {
          color: #e53935;
          background: #ffe6e6;
          border: 1px solid #f5b5b5;
          border-radius: 8px;
          padding: 0.5rem;
          margin-top: 1rem;
          font-size: 0.9rem;
          animation: shake 0.3s ease;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .footer {
          margin-top: 1.5rem;
          font-size: 0.85rem;
          color: #666;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(15px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>🔐 请输入访问密码</h2>
        <form method="POST" action="/login">
          <input type="password" name="password" placeholder="输入密码..." required />
          <button type="submit">登录</button>
          ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
        </form>
        <div class="footer">Cloudflare Workers 保护页面</div>
      </div>
    </body>
    </html>
  `;
}



/**
 * 并发执行多个异步任务，限制同时运行数量
 * @param {Array<Function>} tasks - 返回 Promise 的函数数组
 * @param {number} concurrency - 最大同时执行数量
 */
async function promisePool(tasks, concurrency = 5) {
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const p = task().then(res => results.push(res));
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // 移除已完成的 Promise
      for (let i = executing.length - 1; i >= 0; i--) {
        if (executing[i].done) executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results.flat();
}

async function getCloudflareUsage(tokens) {
  const API = "https://api.cloudflare.com/client/v4";
  const FREE_LIMIT = 100000;
  const sum = (a) => a?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;

  try {
    const allTasks = tokens.map(APIToken => async () => {
      const cfg = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${APIToken}`
      };

      // 获取该 Token 下所有账户
      const accRes = await fetch(`${API}/accounts`, { headers: cfg });
      if (!accRes.ok) throw new Error(`账户获取失败: ${accRes.status}`);
      const accData = await accRes.json();
      if (!accData?.result?.length) return [];

      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);

      // 为每个账户创建一个异步任务
      const accountTasks = accData.result.map(account => async () => {
        const AccountName = account.name || "未知账户";

        const res = await fetch(`${API}/graphql`, {
          method: "POST",
          headers: cfg,
          body: JSON.stringify({
            query: `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
              viewer {
                accounts(filter: { accountTag: $AccountID }) {
                  pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
                  workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
                }
              }
            }`,
            variables: {
              AccountID: account.id,
              filter: {
                datetime_geq: now.toISOString(),
                datetime_leq: new Date().toISOString()
              }
            }
          })
        });

        if (!res.ok) throw new Error(`查询失败: ${res.status}`);
        const result = await res.json();
        if (result.errors?.length) throw new Error(result.errors[0].message);

        const accUsage = result?.data?.viewer?.accounts?.[0];
        const pages = sum(accUsage?.pagesFunctionsInvocationsAdaptiveGroups);
        const workers = sum(accUsage?.workersInvocationsAdaptive);
        const total = pages + workers;
        const free_quota_remaining = Math.max(0, FREE_LIMIT - total);

        return {
          account_name: AccountName,
          pages,
          workers,
          total,
          free_quota_remaining
        };
      });

      // 并发执行账户查询任务（限制每个 Token 下最大 5 个并发）
      return promisePool(accountTasks, 5);
    });

    // 并发执行 Token 查询任务（限制同时执行 3 个 Token）
    const accountsResults = await promisePool(allTasks, 3);

    return { success: true, accounts: accountsResults };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      accounts: []
    };
  }
}