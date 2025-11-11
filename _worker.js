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
      return new Response("<script>location.href='/'</script>", {
        headers: { "set-cookie": "auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" }
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
  html,body{height:100%;margin:0;font-family:Inter,"Segoe UI",system-ui,sans-serif;
    background:linear-gradient(120deg,#6366f1,#06b6d4,#8b5cf6);
    background-size:300% 300%;animation:bg 14s ease infinite;color:#fff;overflow-x:hidden;transition:background 1s ease}
  @keyframes bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  .topbar{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;
    background:rgba(255,255,255,.1);backdrop-filter:blur(8px);border-radius:16px;margin:20px;
    box-shadow:0 6px 20px rgba(0,0,0,.25);transition:background .5s ease}
  .btn{background:rgba(255,255,255,.15);border:none;border-radius:999px;padding:8px 14px;
    color:#fff;font-weight:600;cursor:pointer;transition:all .25s}
  .btn:hover{background:rgba(255,255,255,.25);transform:translateY(-2px)}
  main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;padding:20px}
  .card{padding:18px;border-radius:18px;background:rgba(255,255,255,.12);
    box-shadow:0 10px 25px rgba(0,0,0,.25);backdrop-filter:blur(10px);
    transform:translateY(20px) scale(.97);opacity:0;transition:all .8s cubic-bezier(.2,.9,.2,1)}
  .card.show{opacity:1;transform:translateY(0) scale(1)}
  h2{margin:0 0 8px 0;font-size:1.1rem}
  .meta{font-size:.95rem;line-height:1.6}
  .progress{height:10px;border-radius:999px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:10px}
  .fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#22c55e,#3b82f6,#8b5cf6);
    background-size:200% 100%;animation:move 3s linear infinite;transition:width .8s ease}
  @keyframes move{0%{background-position:0%}100%{background-position:-200%}}
  footer{text-align:center;opacity:.85;margin:20px auto;font-size:.85rem}
  /* loader */
  #loader{position:fixed;inset:0;background:#0b1120;display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:600;letter-spacing:.5px;font-size:1rem;z-index:99;animation:fadeOut .7s ease 1.2s forwards}
  @keyframes fadeOut{to{opacity:0;visibility:hidden}}
  .dots{display:flex;gap:8px;margin-left:8px}
  .dot{width:10px;height:10px;border-radius:50%;background:#fff;opacity:.3;animation:blink .9s infinite alternate}
  .dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
  @keyframes blink{from{opacity:.3;transform:scale(.9)}to{opacity:1;transform:scale(1.2)}}
  /* skeleton */
  .skeleton{height:140px;border-radius:18px;background:linear-gradient(100deg,rgba(255,255,255,.12) 40%,rgba(255,255,255,.18) 50%,rgba(255,255,255,.12) 60%);
    background-size:200% 100%;animation:skeletonMove 1.5s infinite linear}
  @keyframes skeletonMove{100%{background-position:-200% 0}}
  /* 暗色模式 */
  body.dark{background:#0b1120;color:#f1f5f9;}
  body.dark .topbar{background:rgba(255,255,255,.08)}
  body.dark .card{background:rgba(255,255,255,.06);box-shadow:0 8px 18px rgba(255,255,255,.08)}
  body.dark .btn{background:rgba(255,255,255,.1)}
</style>
</head>
<body>
  <div id="loader">加载中<div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>

  <div class="topbar">
    <strong>☁️ Cloudflare Usage</strong>
    <div>
      <button id="refresh" class="btn">🔄 刷新</button>
      <button id="theme" class="btn">🌗 主题</button>
      <form id="logoutForm" method="POST" action="/logout" style="display:inline">
        <button type="submit" class="btn">⎋ 登出</button>
      </form>
    </div>
  </div>

  <main id="grid">
    <!-- skeleton placeholders -->
    ${[...Array(Math.max(3, accounts.length || 3))].map(()=>`<div class="skeleton"></div>`).join("")}
  </main>

  <footer>©2025 <a href="https://github.com/arlettebrook" target="_blank" style="color:#fff;text-decoration:underline">Arlettebrook</a></footer>

  <script>
    const loader=document.getElementById('loader');
    const grid=document.getElementById('grid');
    const themeBtn=document.getElementById('theme');
    const refresh=document.getElementById('refresh');
    // 主题记忆加载
    let dark=localStorage.getItem('theme')==='dark';
    if(dark) document.body.classList.add('dark');

    // 数据渲染
    window.addEventListener('load',()=>{
      loader.style.pointerEvents='none';
      // 延时替换骨架为真实内容
      setTimeout(()=>{
        grid.innerHTML=\`${accounts.map(a=>{
          const u=(a.total/(a.total+a.free_quota_remaining||1)*100).toFixed(1);
          return `<div class="card">
            <h2>${escapeHtml(a.account_name)}</h2>
            <div class="meta">
              📄 Pages：<b>${formatNumber(a.pages)}</b><br>
              ⚙️ Workers：<b>${formatNumber(a.workers)}</b><br>
              📦 总计：<b>${formatNumber(a.total)}</b><br>
              🎁 剩余额度：<b>${formatNumber(a.free_quota_remaining)}</b>
            </div>
            <div class="progress"><div class="fill" style="width:${u}%"></div></div>
            <div style="font-size:.85rem;margin-top:6px;opacity:.9">${u}% 已使用</div>
          </div>`;}).join("")}\`;
        // 显示动画
        document.querySelectorAll('.card').forEach((c,i)=>setTimeout(()=>c.classList.add('show'),80*i));
      },200);
    });

    // 刷新按钮
    refresh.onclick=()=>{document.body.style.opacity=.6;setTimeout(()=>location.reload(),200)};

    // 主题切换 + 记忆
    themeBtn.onclick=()=>{
      dark=!dark;
      document.body.classList.toggle('dark',dark);
      localStorage.setItem('theme',dark?'dark':'light');
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