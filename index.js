
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
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>账户数据展示</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #f9fafb; }
    .card {
      transition: all 0.3s ease;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
    }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center p-8">
  <h1 class="text-3xl font-bold text-gray-800 mb-6">📊 Cloudflare 账户数据</h1>
  
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl">
    ${data.accounts.map(acc => `
      <div class="card bg-white rounded-2xl shadow p-6">
        <h2 class="text-xl font-semibold text-indigo-600 mb-3">${acc.account_name}</h2>
        <p class="text-gray-700 mb-1"><strong>📄 Pages:</strong> ${acc.pages}</p>
        <p class="text-gray-700 mb-1"><strong>⚙️ Workers:</strong> ${acc.workers}</p>
        <p class="text-gray-700 mb-1"><strong>📦 总计:</strong> ${acc.total}</p>
        <p class="text-gray-700 mb-1"><strong>🎁 免费额度剩余:</strong> ${acc.free_quota_remaining}</p>
        <div class="mt-3">
          <div class="w-full bg-gray-200 rounded-full h-3">
            <div class="bg-green-500 h-3 rounded-full" style="width:${(acc.total / (acc.total + acc.free_quota_remaining) * 100).toFixed(1)}%"></div>
          </div>
          <p class="text-sm text-gray-500 mt-1 text-right">${(acc.total / (acc.total + acc.free_quota_remaining) * 100).toFixed(1)}% 已使用</p>
        </div>
      </div>
    `).join('')}
  </div>

  <footer class="mt-10 text-gray-500 text-sm">
    © ${new Date().getFullYear()} Cloudflare Worker 数据展示
  </footer>
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