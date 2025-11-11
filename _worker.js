/**
 * Cloudflare Workers & Pages Functions Usage Dashboard
 * Optimized by GPT-5 — 2025
 * 
 * ✅ Features:
 * - Password login with secure cookie (SHA-256)
 * - Multi-token Cloudflare API usage summary
 * - Request concurrency control
 * - Simple in-memory cache (5 min)
 * - Dark/light theme toggle
 * - Clean modular code & comments
 */

const CACHE_TTL = 300_000; // 5分钟缓存
const FREE_LIMIT = 100000;
const CF_API = "https://api.cloudflare.com/client/v4";

// ===== 全局缓存对象 =====
const cache = {
  data: null,
  timestamp: 0
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const PASSWORD = env.PASSWORD;
    const TOKENS = (env.MULTI_CF_API_TOKENS || "").split(",").map(t => t.trim()).filter(Boolean);

    // ---- 校验基础配置 ----
    if (!PASSWORD) return jsonResponse({ success: false, error: "缺少 PASSWORD 环境变量" }, 500);
    if (TOKENS.length === 0) return jsonResponse({ success: false, error: "未设置 MULTI_CF_API_TOKENS" }, 500);

    // ---- 工具函数 ----
    const hashString = async str => {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    };
    const html = (body, headers = {}) => new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...headers }
    });
    const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });

    const cookie = request.headers.get("Cookie") || "";
    const cookieMatch = cookie.match(/auth=([a-f0-9]{64})/);
    const cookieHash = cookieMatch ? cookieMatch[1] : null;
    const passwordHash = await hashString(PASSWORD);
    const isLoggedIn = cookieHash === passwordHash;

    // ---- 登录路由 ----
    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const pass = String(form.get("password") || "");
      const inputHash = await hashString(pass);
      if (inputHash === passwordHash) {
        return html(renderSuccess(), {
          "Set-Cookie": `auth=${inputHash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        });
      }
      return html(renderLogin("❌ 密码错误，请重试"));
    }

    // ---- 登出 ----
    if (url.pathname === "/logout") {
      return html(renderLogout(), {
        "Set-Cookie": `auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
      });
    }

    // ---- API 路径 ----
    if (url.pathname === "/api/usage") {
      if (!isLoggedIn) return jsonResponse({ success: false, error: "未登录" }, 401);
      const data = await getCloudflareUsage(TOKENS);
      return jsonResponse(data);
    }

    // ---- 默认主页 ----
    if (!isLoggedIn) return html(renderLogin());
    const dashboardData = await getCloudflareUsage(TOKENS);
    return html(renderDashboard(dashboardData.accounts));
  }
};

// ====== 获取 Cloudflare 使用量 ======
async function getCloudflareUsage(tokens) {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    return { success: true, accounts: cache.data, cached: true };
  }

  const sumRequests = arr => arr?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;

  try {
    const allTasks = tokens.map(token => async () => {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      };

      const accRes = await fetch(`${CF_API}/accounts`, { headers });
      if (!accRes.ok) throw new Error(`账户获取失败 ${accRes.status}`);
      const accData = await accRes.json();
      const accounts = accData.result || [];

      const end = new Date().toISOString();
      const start = new Date(Date.now() - 86400000).toISOString(); // 最近24h

      const accountTasks = accounts.map(acc => async () => {
        const body = {
          query: `query($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
            viewer {
              accounts(filter: { accountTag: $AccountID }) {
                pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
                workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
              }
            }
          }`,
          variables: {
            AccountID: acc.id,
            filter: { datetime_geq: start, datetime_leq: end }
          }
        };

        const res = await fetch(`${CF_API}/graphql`, { method: "POST", headers, body: JSON.stringify(body) });
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);

        const usage = json.data.viewer.accounts[0];
        const pages = sumRequests(usage.pagesFunctionsInvocationsAdaptiveGroups);
        const workers = sumRequests(usage.workersInvocationsAdaptive);
        const total = pages + workers;

        return {
          account_name: acc.name,
          pages,
          workers,
          total,
          free_quota_remaining: Math.max(0, FREE_LIMIT - total)
        };
      });

      return promisePool(accountTasks, 5);
    });

    const accountsResults = await promisePool(allTasks, 3);
    const result = accountsResults.flat();

    cache.data = result;
    cache.timestamp = now;

    return { success: true, accounts: result };
  } catch (err) {
    return { success: false, error: err.message, accounts: [] };
  }
}

// ===== 并发池控制 =====
async function promisePool(tasks, limit = 5) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then(r => {
      results.push(r);
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results.flat();
}

// ===== 页面模板 =====
function renderLogin(msg = "") {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>登录 - Cloudflare Usage</title>
<style>
body {
  font-family: system-ui, sans-serif;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; margin: 0;
  background: linear-gradient(135deg,#89f7fe,#66a6ff);
  color: #333;
}
form { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 0 10px #0001; }
input { padding: .6rem; border-radius: .5rem; border: 1px solid #ccc; width: 200px; }
button { padding: .6rem 1.2rem; background: #4e9af1; color: white; border: none; border-radius: .5rem; cursor: pointer; }
p.error { color: red; }
</style>
</head>
<body>
  <form method="POST" action="/login">
    <h2>🔒 Cloudflare Usage 登录</h2>
    <input name="password" type="password" placeholder="请输入密码" required />
    <button type="submit">登录</button>
    ${msg ? `<p class="error">${msg}</p>` : ""}
  </form>
</body>
</html>`;
}

function renderSuccess() {
  return `
<html><meta http-equiv="refresh" content="1;url=/" />
<body style="font-family:sans-serif;text-align:center;margin-top:50px;">
<h2>✅ 登录成功！正在跳转...</h2>
</body></html>`;
}

function renderLogout() {
  return `
<html><meta http-equiv="refresh" content="1;url=/" />
<body style="font-family:sans-serif;text-align:center;margin-top:50px;">
<h2>👋 已登出</h2>
</body></html>`;
}

function renderDashboard(accounts = []) {
  const rows = accounts.map(a => `
    <tr>
      <td>${escape(a.account_name)}</td>
      <td>${a.pages}</td>
      <td>${a.workers}</td>
      <td>${a.total}</td>
      <td>${a.free_quota_remaining}</td>
    </tr>`).join("");
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Cloudflare Usage Dashboard</title>
<style>
:root { color-scheme: light dark; }
body {
  font-family: system-ui,sans-serif;
  margin: 2rem;
  background: var(--bg, #fafafa);
  color: var(--fg, #111);
}
header { display:flex; justify-content:space-between; align-items:center; }
table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
th, td { padding: .6rem 1rem; border-bottom: 1px solid #ccc; text-align: left; }
tr:hover { background: #f0f8ff; }
button { background: #4e9af1; border: none; padding: .4rem .8rem; color: white; border-radius: .4rem; cursor:pointer; }
footer { margin-top: 1rem; font-size: .9rem; color: #666; text-align:center; }
</style>
<script>
function toggleTheme(){
  const dark = document.documentElement.classList.toggle('dark');
  document.documentElement.style.setProperty('--bg', dark ? '#111' : '#fafafa');
  document.documentElement.style.setProperty('--fg', dark ? '#fafafa' : '#111');
}
</script>
</head>
<body>
  <header>
    <h1>☁️ Cloudflare Usage Dashboard</h1>
    <div>
      <button onclick="toggleTheme()">切换主题</button>
      <a href="/logout"><button>登出</button></a>
    </div>
  </header>
  <table>
    <thead>
      <tr><th>账户</th><th>Pages</th><th>Workers</th><th>总调用</th><th>剩余额度</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <footer>缓存：5分钟自动更新 · © 2025</footer>
</body>
</html>`;
}

function escape(str) {
  return String(str || "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}