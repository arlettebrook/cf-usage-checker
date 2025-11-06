
export default {
  async fetch(request, env, ctx) {
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
      --bg-light: linear-gradient(135deg, #f0f4ff, #e0f2fe, #faf5ff);
      --bg-dark: linear-gradient(135deg, #0f172a, #1e293b);
      --card-light: rgba(255, 255, 255, 0.85);
      --card-dark: rgba(31, 41, 55, 0.8);
      --text-light: #1e293b;
      --text-dark: #f3f4f6;
    }

    body {
      background: var(--bg-light);
      font-family: 'Inter', sans-serif;
      transition: all 0.5s ease-in-out;
      min-height: 100vh;
      background-attachment: fixed;
      color: var(--text-light);
    }

    html.dark body {
      background: var(--bg-dark);
      color: var(--text-dark);
    }

    /* 顶部导航栏 */
    .navbar {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(90deg, #6366f1, #3b82f6, #06b6d4);
      padding: 1rem 1.5rem;
      border-radius: 1.25rem;
      color: white;
      box-shadow: 0 6px 30px rgba(99,102,241,0.25);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 1rem;
      z-index: 50;
      text-align: center;
    }

    .navbar h1 {
      font-weight: 700;
      font-size: clamp(1.2rem, 2.5vw, 1.6rem);
      letter-spacing: 0.3px;
      text-shadow: 0 0 8px rgba(255,255,255,0.3);
      flex: 1 1 100%;
      margin-bottom: 0.5rem;
    }

    @media (min-width: 640px) {
      .navbar h1 {
        flex: none;
        margin-bottom: 0;
      }
    }

    .nav-btn {
      display: flex;
      justify-content: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .nav-btn button {
      background: rgba(255,255,255,0.25);
      padding: 0.5rem 1.1rem;
      border-radius: 9999px;
      backdrop-filter: blur(6px);
      transition: all 0.3s ease;
      border: none;
      color: white;
      font-weight: 500;
      cursor: pointer;
    }

    .nav-btn button:hover {
      background: rgba(255,255,255,0.4);
      transform: translateY(-2px) scale(1.05);
    }

    /* 卡片 */
    .card {
      background: var(--card-light);
      border-radius: 1.25rem;
      padding: 1.75rem;
      box-shadow: 0 12px 30px rgba(0,0,0,0.08);
      border: 1px solid rgba(255,255,255,0.5);
      transition: all 0.5s ease;
      backdrop-filter: blur(12px);
      overflow: hidden;
      position: relative;
    }

    html.dark .card {
      background: var(--card-dark);
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .card:hover {
      transform: translateY(-6px) scale(1.03);
      box-shadow: 0 20px 50px rgba(99,102,241,0.25);
    }

    .progress {
      transition: width 1s ease-in-out;
    }

    .num {
      font-weight: 600;
      transition: all 0.4s ease-out;
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

    /* 动画背景 */
    .animated-bg {
      position: absolute;
      inset: 0;
      z-index: -1;
      background: radial-gradient(circle at top left, #a5b4fc22, transparent 40%),
                  radial-gradient(circle at bottom right, #67e8f922, transparent 40%);
      animation: floatBg 10s ease-in-out infinite alternate;
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
  <nav class="navbar mb-8">
    <h1>🌤️ Cloudflare Workers & Pages Usage 仪表盘</h1>
    <div class="nav-btn">
      <button id="refresh-btn">🔄 刷新数据</button>
      <button id="theme-toggle">🌗 切换主题</button>
    </div>
  </nav>

  <!-- 主内容 -->
  <main id="data-section" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
    ${data.accounts.map(acc => {
      const usedPercent = (acc.total / (acc.total + acc.free_quota_remaining) * 100).toFixed(1);
      return `
      <div class="card">
        <h2 class="text-2xl font-semibold mb-4">${acc.account_name}</h2>
        <div class="space-y-2 text-gray-700 dark:text-gray-200">
          <p><strong>📄 Pages:</strong> <span class="num" data-value="${acc.pages}">0</span></p>
          <p><strong>⚙️ Workers:</strong> <span class="num" data-value="${acc.workers}">0</span></p>
          <p><strong>📦 总计:</strong> <span class="num" data-value="${acc.total}">0</span></p>
          <p><strong>🎁 免费额度剩余:</strong> <span class="num" data-value="${acc.free_quota_remaining}">0</span></p>
        </div>

        <div class="mt-5">
          <div class="w-full bg-gray-300 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div class="bg-gradient-to-r from-green-400 to-blue-500 h-3 rounded-full progress" style="width: ${usedPercent}%"></div>
          </div>
          <p class="text-sm mt-2 text-right opacity-80">${usedPercent}% 已使用</p>
        </div>
      </div>`;
    }).join('')}
  </main>

  <footer class="mt-12 text-gray-500 text-sm text-center">
    © 2025 Cloudflare Worker Dashboard • Designed with 💜 by 
    <a href="https://github.com/arlettebrook" target="_blank">Arlettebrook</a>
  </footer>

  <script>
    // 数字动画
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

    // 刷新
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