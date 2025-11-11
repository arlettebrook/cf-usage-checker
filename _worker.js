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

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cloudflare Usage Dashboard</title>
<style>
  :root {
    --bg-dark: #1b1e24;
    --bg-light: #e9eef5;
    --text-dark: #1f2937;
    --text-light: #e5e7eb;
    --accent: #3b82f6;
    --radius: 22px;
    --transition: all 0.3s ease;
  }

  body {
    margin:0;
    font-family: "Inter", "Segoe UI", system-ui, sans-serif;
    background: var(--bg-dark);
    color: var(--text-light);
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    transition: var(--transition);
  }

  body.light {
    background: var(--bg-light);
    color: var(--text-dark);
  }

  /* 拟物容器基础样式 */
  .soft {
    border-radius: var(--radius);
    background: var(--bg-dark);
    box-shadow: 8px 8px 18px rgba(0,0,0,0.45),
                -6px -6px 18px rgba(255,255,255,0.05);
    transition: var(--transition);
  }

  body.light .soft {
    background: var(--bg-light);
    box-shadow: 8px 8px 18px rgba(0,0,0,0.12),
                -6px -6px 18px rgba(255,255,255,0.8);
  }

  /* 顶部栏 */
  .topbar {
    margin: 50px 20px 30px;
    padding: 28px 26px;
    max-width: 480px;
    width: calc(100% - 40px);
    text-align: center;
  }

  .topbar h1 {
    margin: 0 0 20px;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent);
    text-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }

  /* 按钮 */
  .btns {
    display: flex;
    justify-content: center;
    gap: 14px;
  }

  .btn {
    flex: 1;
    border: none;
    border-radius: var(--radius);
    padding: 10px 0;
    font-weight: 600;
    cursor: pointer;
    background: var(--bg-dark);
    color: var(--text-light);
    box-shadow: inset 2px 2px 6px rgba(0,0,0,0.5),
                inset -2px -2px 6px rgba(255,255,255,0.1);
    transition: var(--transition);
  }

  body.light .btn {
    background: var(--bg-light);
    color: var(--text-dark);
    box-shadow: inset 2px 2px 5px rgba(0,0,0,0.15),
                inset -2px -2px 5px rgba(255,255,255,0.7);
  }

  .btn:hover {
    box-shadow: 6px 6px 12px rgba(0,0,0,0.5),
                -4px -4px 12px rgba(255,255,255,0.08);
    transform: translateY(-1px);
  }

  body.light .btn:hover {
    box-shadow: 6px 6px 12px rgba(0,0,0,0.15),
                -4px -4px 12px rgba(255,255,255,0.9);
  }

  /* 主体卡片 */
  main {
    width: calc(100% - 40px);
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    margin-bottom: 50px;
  }

  .card {
    padding: 26px;
    opacity: 0;
    transform: translateY(20px);
    transition: var(--transition);
  }

  .card.show {
    opacity: 1;
    transform: translateY(0);
  }

  .card h2 {
    margin: 0 0 14px;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--accent);
  }

  .meta {
    line-height: 1.8;
    font-size: .95rem;
    opacity: .85;
  }

  /* 拟物进度条 */
  .progress {
    margin-top: 14px;
    height: 12px;
    border-radius: 999px;
    background: var(--bg-dark);
    box-shadow: inset 2px 2px 5px rgba(0,0,0,0.5),
                inset -2px -2px 5px rgba(255,255,255,0.1);
    overflow: hidden;
  }

  body.light .progress {
    background: var(--bg-light);
    box-shadow: inset 2px 2px 5px rgba(0,0,0,0.1),
                inset -2px -2px 5px rgba(255,255,255,0.8);
  }

  .fill {
    height: 100%;
    width: 0%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 1s ease-out;
  }

  .usage-text {
    font-size: .85rem;
    margin-top: 8px;
    opacity: .75;
  }

  /* 骨架 */
  .skeleton {
    height: 140px;
    border-radius: var(--radius);
    background: linear-gradient(120deg, rgba(255,255,255,.08) 40%, rgba(255,255,255,.12) 50%, rgba(255,255,255,.08) 60%);
    background-size: 200% 100%;
    animation: skeletonMove 1.4s infinite linear;
  }

  @keyframes skeletonMove {
    100% { background-position: -200% 0; }
  }

  /* 加载遮罩 */
  #loader {
    position: fixed;
    inset: 0;
    background: var(--bg-dark);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-light);
    z-index: 99;
    font-weight: 600;
    animation: fadeOut .8s ease 1.2s forwards;
  }

  @keyframes fadeOut {
    to { opacity: 0; visibility: hidden; }
  }

  footer {
    text-align: center;
    font-size: .8rem;
    opacity: .6;
    margin-bottom: 20px;
  }

  footer a {
    color: var(--accent);
    text-decoration: none;
  }
</style>
</head>
<body>
  <div id="loader">加载中...</div>

  <div class="topbar soft">
    <h1>☁️ Cloudflare Usage Dashboard</h1>
    <div class="btns">
      <button id="refresh" class="btn">🔄 刷新数据</button>
      <button id="theme" class="btn">🌗 主题切换</button>
      <form id="logoutForm" method="POST" action="/logout" style="margin:0;">
        <button type="submit" class="btn">⎋ 登出</button>
      </form>
    </div>
  </div>

  <main id="grid">
    ${[...Array(Math.max(3, accounts.length || 3))].map(()=>`<div class="skeleton soft"></div>`).join("")}
  </main>

  <footer>©2025 <a href="https://github.com/arlettebrook" target="_blank">Arlettebrook</a></footer>

  <script>
    const grid=document.getElementById('grid');
    const themeBtn=document.getElementById('theme');
    const refresh=document.getElementById('refresh');
    const formatNumber=n=>n?.toLocaleString?.()||n;
    const escapeHtml=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

    if(localStorage.getItem('theme')==='light'){
      document.body.classList.add('light');
    }

    window.addEventListener('load',()=>{
      setTimeout(()=>{
        grid.innerHTML=\`${accounts.map(a=>{
          const used=((a.total/(a.total+a.free_quota_remaining||1))*100).toFixed(1);
          return `<div class="card soft">
            <h2>${escapeHtml(a.account_name)}</h2>
            <div class="meta">
              📄 Pages：<b>${formatNumber(a.pages)}</b><br>
              ⚙️ Workers：<b>${formatNumber(a.workers)}</b><br>
              📦 总计：<b>${formatNumber(a.total)}</b><br>
              🎁 免费额度剩余：<b>${formatNumber(a.free_quota_remaining)}</b>
            </div>
            <div class="progress"><div class="fill" style="width:${used}%"></div></div>
            <div class="usage-text">${used}% 已使用</div>
          </div>`;
        }).join("")}\`;
        document.querySelectorAll('.card').forEach((c,i)=>setTimeout(()=>c.classList.add('show'),120*i));
      },300);
    });

    refresh.onclick=()=>{document.body.style.opacity=.6;setTimeout(()=>location.reload(),200)};
    themeBtn.onclick=()=>{
      document.body.classList.toggle('light');
      localStorage.setItem('theme',document.body.classList.contains('light')?'light':'dark');
    };
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