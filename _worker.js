export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const PASSWORD = env.PASSWORD || "mysecret";

    // 缓存密码哈希（首次计算后全局复用）
    if (!globalThis._pwdHash) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PASSWORD));
      globalThis._pwdHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
    }
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/auth=([a-f0-9]{64})/);
    const isLogin = m && m[1] === globalThis._pwdHash;

    // 登录请求
    if (url.pathname==="/login" && request.method==="POST") {
      const fd = await request.formData();
      const pwd = fd.get("password") || "";
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pwd));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
      if (hash === globalThis._pwdHash) {
        return new Response(`<!DOCTYPE html><html><head><meta charset=utf-8><title>登录成功</title>
        <style>body{margin:0;display:flex;justify-content:center;align-items:center;height:100vh;
        background:linear-gradient(135deg,#89f7fe,#66a6ff);color:#fff;font-family:Segoe UI,sans-serif}
        .c{padding:2rem 3rem;border-radius:1rem;background:rgba(255,255,255,.15);backdrop-filter:blur(10px)}
        </style></head><body><div class=c><h2>✅ 登录成功</h2><p>跳转中...</p></div>
        <script>setTimeout(()=>location.href='/',1200)</script></body></html>`,{
          headers:{
            "content-type":"text/html;charset=utf-8",
            "set-cookie":`auth=${hash};Path=/;HttpOnly;Secure;SameSite=Lax;Max-Age=86400`
          }
        });
      }
      return new Response(await login("密码错误，请重试 🔒"),{headers:{"content-type":"text/html;charset=utf-8"}});
    }

    // 登出
    if (url.pathname==="/logout" && request.method==="POST")
      return new Response("<script>location='/'</script>",{headers:{"set-cookie":"auth=;Path=/;Max-Age=0"}});

    // 未登录
    if (!isLogin) return new Response(await login(),{headers:{"content-type":"text/html;charset=utf-8"}});

    // 获取 Token
    const tokens=(env.MULTI_CF_API_TOKENS||"").split(",").map(t=>t.trim()).filter(Boolean);
    if(!tokens.length) return new Response(JSON.stringify({success:false,error:"无Token",accounts:[]}),{headers:{"content-type":"application/json"}});

    const data=await usage(tokens);
    return new Response(dash(data),{headers:{"content-type":"text/html;charset=utf-8"}});
  }
};

// 登录页
async function login(msg=""){
  return `<!DOCTYPE html><html><head><meta charset=UTF-8><meta name=viewport content=width=device-width,initial-scale=1>
  <title>登录</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
  background:linear-gradient(135deg,#89f7fe,#66a6ff);font-family:Segoe UI}.c{background:#fff;padding:2rem;border-radius:1rem;
  box-shadow:0 8px 24px rgba(0,0,0,.2);width:90%;max-width:320px;text-align:center}input,button{width:100%;padding:.7rem;
  border-radius:.5rem;border:1px solid #ccc;margin-top:1rem;font-size:1rem}button{background:#0078f2;color:#fff;border:0}
  button:hover{background:#005fcc}.e{margin-top:1rem;color:#e53935;font-size:.9rem}</style></head>
  <body><div class=c><h2>🔐 请输入密码</h2><form method=POST action=/login>
  <input type=password name=password placeholder=输入密码... required><button>登录</button>${msg?`<div class=e>${msg}</div>`:""}
  </form></div></body></html>`;
}

// 并发池
async function pool(tasks,c=5){
  const res=[],exec=new Set();
  for(const t of tasks){
    const p=t().then(r=>{exec.delete(p);res.push(r);});
    exec.add(p);if(exec.size>=c)await Promise.race(exec);
  }await Promise.all(exec);return res.flat();
}

// 获取使用量
async function usage(tokens){
  const API="https://api.cloudflare.com/client/v4",FREE=100000,sum=a=>a?.reduce((t,i)=>t+(i?.sum?.requests||0),0)||0;
  const now=new Date();now.setUTCHours(0,0,0,0);
  try{
    const all=tokens.map(T=>async()=>{const h={"Authorization":`Bearer ${T}`};
      const acc=await fetch(`${API}/accounts`,{headers:h}).then(r=>r.json());
      if(!acc?.result?.length)return [];
      const jobs=acc.result.map(a=>async()=>{
        const q={query:`query($id:String!,$f:AccountWorkersInvocationsAdaptiveFilter_InputObject){
          viewer{accounts(filter:{accountTag:$id}){pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:$f){sum{requests}}
          workersInvocationsAdaptive(limit:10000,filter:$f){sum{requests}}}}}`,
          variables:{id:a.id,f:{datetime_geq:now.toISOString(),datetime_leq:new Date().toISOString()}}};
        const j=await fetch(`${API}/graphql`,{method:"POST",headers:{...h,"content-type":"application/json"},body:JSON.stringify(q)}).then(r=>r.json());
        const v=j?.data?.viewer?.accounts?.[0]||{},pages=sum(v.pagesFunctionsInvocationsAdaptiveGroups),workers=sum(v.workersInvocationsAdaptive);
        const total=pages+workers;return{account_name:a.name,pages,workers,total,free_quota_remaining:Math.max(0,FREE-total)};});
      return pool(jobs,5);
    });
    const r=await pool(all,3);
    return{success:true,accounts:r};
  }catch(e){return{success:false,error:e.message,accounts:[]}}
}

// 仪表盘HTML
function dash(d){
  return `<!DOCTYPE html><html lang=zh-CN><head><meta charset=UTF-8><meta name=viewport content=width=device-width,initial-scale=1>
  <title>Cloudflare Usage</title><link href=https://cdn.jsdelivr.net/npm/tailwindcss@3.4.1/dist/tailwind.min.css rel=stylesheet>
  <style>body{font-family:Inter,Segoe UI,sans-serif;transition:.3s;background:#f9fafb;color:#1e293b;min-height:100vh}
  html.dark body{background:#111827;color:#f9fafb}</style></head>
  <body class=p-6><nav class="flex justify-between items-center bg-blue-500 text-white p-4 rounded-xl shadow mb-6">
  <h1 class="font-bold text-lg">☁️ CF Usage 仪表盘</h1><div><button id=r class="mr-2 px-3 py-1 bg-white/20 rounded-full">刷新</button>
  <button id=t class="px-3 py-1 bg-white/20 rounded-full">主题</button></div></nav>
  <main class="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
  ${d.accounts.map(a=>{
    const u=(a.total/(a.total+a.free_quota_remaining)*100).toFixed(1);
    return `<div class="p-5 rounded-xl bg-white dark:bg-slate-800 shadow">
      <h2 class="font-bold text-blue-600 dark:text-blue-400 mb-2">${a.account_name}</h2>
      <p>📄 Pages: <b>${a.pages.toLocaleString()}</b></p>
      <p>⚙️ Workers: <b>${a.workers.toLocaleString()}</b></p>
      <p>📦 总计: <b>${a.total.toLocaleString()}</b></p>
      <p>🎁 剩余额度: <b>${a.free_quota_remaining.toLocaleString()}</b></p>
      <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-2"><div style="width:${u}%"
      class="h-full rounded-full bg-gradient-to-r from-green-400 to-blue-500"></div></div>
      <p class="text-sm opacity-75 mt-1">${u}% 已使用</p></div>`;}).join("")}
  </main><footer class="text-center mt-8 text-sm opacity-75">©2025 <a href=https://github.com/arlettebrook class=text-blue-500>Arlettebrook</a></footer>
  <script>
    r.onclick=()=>{document.body.style.opacity=0.6;setTimeout(()=>location.reload(),300)};
    const rt=document.documentElement;if(localStorage.theme==='dark'||(!localStorage.theme&&matchMedia('(prefers-color-scheme:dark)').matches))rt.classList.add('dark');
    t.onclick=()=>{rt.classList.toggle('dark');localStorage.theme=rt.classList.contains('dark')?'dark':'light'};
  </script></body></html>`;
}
