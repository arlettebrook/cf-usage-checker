/**
 * Cloudflare Usage Checker - Ultra Fast Version
 * Optimized for instant load + async refresh
 */

const CF_API = "https://api.cloudflare.com/client/v4";
const FREE_LIMIT = 100000;
const CACHE_TTL = 300_000; // 5分钟缓存
const cache = { data: null, ts: 0 };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const PASSWORD = env.PASSWORD;
    const TOKENS = (env.MULTI_CF_API_TOKENS || "").split(",").map(x => x.trim()).filter(Boolean);

    if (!PASSWORD) return new Response("Missing PASSWORD", { status: 500 });

    const cookie = req.headers.get("Cookie") || "";
    const cookieHash = cookie.match(/auth=([a-f0-9]{64})/)?.[1];
    const hash = await sha256(PASSWORD);
    const loggedIn = cookieHash === hash;

    // --- 登录路由 ---
    if (url.pathname === "/login" && req.method === "POST") {
      const f = await req.formData();
      const pass = f.get("password") || "";
      if (await sha256(pass) === hash) {
        return html(`<meta http-equiv="refresh" content="1;url=/" />登录成功`, {
          "Set-Cookie": `auth=${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        });
      }
      return html(renderLogin("密码错误"));
    }

    if (url.pathname === "/logout") {
      return html("已登出", { "Set-Cookie": "auth=; Path=/; Max-Age=0" });
    }

    // --- API 接口 ---
    if (url.pathname === "/api/usage") {
      if (!loggedIn) return json({ success: false, error: "未登录" }, 401);
      const data = await getUsage(TOKENS);
      return json(data);
    }

    // --- 主界面 ---
    if (!loggedIn) return html(renderLogin());
    return html(renderFastDashboard());
  }
};

// ===== 异步接口逻辑 =====
async function getUsage(tokens) {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return { success: true, cached: true, accounts: cache.data };

  try {
    const accounts = (await Promise.all(tokens.map(fetchAccounts))).flat();
    cache.data = accounts;
    cache.ts = now;
    return { success: true, accounts };
  } catch (e) {
    return { success: false, error: e.message, accounts: [] };
  }
}

async function fetchAccounts(token) {
  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
  const res = await fetch(`${CF_API}/accounts`, { headers });
  const data = await res.json();
  const accounts = data.result || [];
  return Promise.all(accounts.map(acc => fetchUsage(acc, headers)));
}

async function fetchUsage(acc, headers) {
  const end = new Date().toISOString();
  const start = new Date(Date.now() - 86400000).toISOString();
  const body = {
    query: `query($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
      viewer {
        accounts(filter: { accountTag: $AccountID }) {
          pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
          workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
        }
      }
    }`,
    variables: { AccountID: acc.id, filter: { datetime_geq: start, datetime_leq: end } }
  };
  const res = await fetch(`${CF_API}/graphql`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json();
  const viewer = json.data?.viewer?.accounts?.[0];
  const sum = arr => arr?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;
  const pages = sum(viewer.pagesFunctionsInvocationsAdaptiveGroups);
  const workers = sum(viewer.workersInvocationsAdaptive);
  const total = pages + workers;
  return { account_name: acc.name, pages, workers, total, free_quota_remaining: Math.max(0, FREE_LIMIT - total) };
}

// ===== 工具函数 =====
const html = (body, headers = {}) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const sha256 = async str => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)))).map(b => b.toString(16).padStart(2, "0")).join("");

// ===== 页面模板 =====
function renderLogin(msg = "") {
  return `
<!doctype html><html><head><meta charset="utf-8"><title>登录</title>
<style>
body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f7fa;}
form{background:#fff;padding:2rem;border-radius:1rem;box-shadow:0 0 10px #0001;}
input,button{padding:.6rem;border-radius:.5rem;border:1px solid #ccc;width:200px;margin-top:.5rem;}
button{background:#4e9af1;color:white;border:none;cursor:pointer;width:100%;}
p{color:red;text-align:center;}
</style></head>
<body><form method="POST" action="/login">
<h3>🔒 Cloudflare Usage 登录</h3>
<input type="password" name="password" placeholder="密码" required>
<button type="submit">登录</button>
${msg ? `<p>${msg}</p>` : ""}
</form></body></html>`;
}

function renderFastDashboard() {
  return `
<!doctype html><html><head><meta charset="utf-8"><title>Cloudflare Usage</title>
<style>
body{font-family:sans-serif;margin:2rem;background:#fafafa;}
table{border-collapse:collapse;width:100%;margin-top:1rem;}
th,td{padding:.6rem 1rem;border-bottom:1px solid #ccc;text-align:left;}
th{background:#e9f1ff;}
tr:hover{background:#f0f8ff;}
header{display:flex;justify-content:space-between;align-items:center;}
button{padding:.4rem .8rem;border:none;border-radius:.4rem;background:#4e9af1;color:white;cursor:pointer;}
footer{margin-top:1rem;color:#666;text-align:center;font-size:.9rem;}
</style>
</head>
<body>
<header>
  <h2>☁️ Cloudflare Usage Dashboard</h2>
  <button onclick="logout()">登出</button>
</header>
<table id="tbl"><thead><tr><th>账户</th><th>Pages</th><th>Workers</th><th>总调用</th><th>剩余额度</th></tr></thead><tbody><tr><td colspan="5">加载中...</td></tr></tbody></table>
<footer>加载中数据来自 Cloudflare API · 缓存5分钟</footer>
<script>
async function load(){
  const r=await fetch('/api/usage');const j=await r.json();
  const t=document.querySelector('#tbl tbody');
  if(!j.success)return t.innerHTML='<tr><td colspan=5>'+j.error+'</td></tr>';
  t.innerHTML=j.accounts.map(a=>'<tr><td>'+a.account_name+'</td><td>'+a.pages+'</td><td>'+a.workers+'</td><td>'+a.total+'</td><td>'+a.free_quota_remaining+'</td></tr>').join('');
}
function logout(){location.href='/logout';}
load();
</script>
</body></html>`;
}
