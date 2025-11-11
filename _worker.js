export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const PASSWORD = env.PASSWORD || "mysecret";

    // 缓存哈希
    if (!globalThis._pwdHash) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PASSWORD));
      globalThis._pwdHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
    }
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/auth=([a-f0-9]{64})/);
    const isLogin = m && m[1] === globalThis._pwdHash;

    // 登录
    if (url.pathname==="/login" && request.method==="POST") {
      const fd = await request.formData();
      const pwd = fd.get("password") || "";
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pwd));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
      if (hash === globalThis._pwdHash)
        return new Response(successPage(hash),{headers:{
          "content-type":"text/html;charset=utf-8",
          "set-cookie":`auth=${hash};Path=/;HttpOnly;Secure;SameSite=Lax;Max-Age=86400`
        }});
      return new Response(await loginPage("密码错误，请重试 🔒"),{headers:{"content-type":"text/html;charset=utf-8"}});
    }

    // 登出
    if (url.pathname==="/logout" && request.method==="POST")
      return new Response("<script>location='/'</script>",{headers:{"set-cookie":"auth=;Path=/;Max-Age=0"}});

    // 未登录
    if (!isLogin) return new Response(await loginPage(),{headers:{"content-type":"text/html;charset=utf-8"}});

    // 数据
    const tokens=(env.MULTI_CF_API_TOKENS||"").split(",").map(t=>t.trim()).filter(Boolean);
    if(!tokens.length) return new Response(JSON.stringify({success:false,error:"无Token",accounts:[]}),{headers:{"content-type":"application/json"}});
    const data=await usage(tokens);
    return new Response(dashboard(data),{headers:{"content-type":"text/html;charset=utf-8"}});
  }
};

// 登录成功动画页
function successPage(hash){
  return `<!DOCTYPE html><html><head><meta charset=utf-8><title>登录成功</title>
  <style>
  body{margin:0;height:100vh;display:flex;justify-content:center;align-items:center;
  background:linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899);background-size:300% 300%;
  animation:bg 6s ease infinite;font-family:"Inter","Segoe UI";overflow:hidden;color:#fff;}
  @keyframes bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  .circle{width:120px;height:120px;border-radius:50%;border:4px solid #fff;display:flex;justify-content:center;align-items:center;
  box-shadow:0 0 30px rgba(255,255,255,.5);animation:pulse 1.2s ease infinite alternate;}
  @keyframes pulse{from{transform:scale(.9);opacity:.8}to{transform:scale(1.05);opacity:1}}
  </style><script>setTimeout(()=>location.href='/',1300)</script></head>
  <body><div class=circle>✨</div></body></html>`;
}

// 登录页
async function loginPage(msg=""){
  return `<!DOCTYPE html><html><head><meta charset=UTF-8><meta name=viewport content=width=device-width,initial-scale=1>
  <title>登录</title><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{height:100vh;display:flex;justify-content:center;align-items:center;
  background:linear-gradient(135deg,#4f46e5,#06b6d4,#a855f7);background-size:300% 300%;
  animation:bgmove 10s ease infinite;font-family:"Inter","Segoe UI";overflow:hidden;color:#fff;}
  @keyframes bgmove{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  .card{padding:2.5rem;background:rgba(255,255,255,.12);backdrop-filter:blur(20px);
  border-radius:20px;box-shadow:0 0 30px rgba(0,0,0,.4);text-align:center;width:90%;max-width:360px;
  animation:fadein 1s ease forwards;opacity:0;transform:translateY(20px);}
  @keyframes fadein{to{opacity:1;transform:translateY(0)}}
  h2{margin-bottom:1rem;text-shadow:0 0 12px rgba(255,255,255,.8);}
  input{width:100%;padding:.8rem;margin-top:1rem;border:none;border-radius:12px;
  background:rgba(255,255,255,.25);color:#fff;font-size:1rem;text-align:center;outline:none;transition:.3s;}
  input:focus{background:rgba(255,255,255,.35);box-shadow:0 0 12px #93c5fd;}
  button{margin-top:1.5rem;width:100%;padding:.9rem;border:none;border-radius:9999px;
  background:linear-gradient(90deg,#3b82f6,#8b5cf6,#ec4899);color:#fff;font-weight:600;
  letter-spacing:.5px;cursor:pointer;transition:.4s;position:relative;overflow:hidden;}
  button::before{content:"";position:absolute;top:-50%;left:-50%;width:200%;height:200%;
  background:radial-gradient(circle,#fff3,transparent 70%);transform:translate(-100%,-100%) rotate(45deg);}
  button:hover::before{animation:shine 1s linear}
  @keyframes shine{to{transform:translate(100%,100%) rotate(45deg)}}
  button:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(147,51,234,.5);}
  .err{margin-top:1rem;color:#fee2e2;background:rgba(239,68,68,.25);padding:.5rem;border-radius:8px;}
  </style></head><body>
  <div class="card"><h2>🔐 请输入访问密码</h2>
  <form method=POST action=/login>
  <input type=password name=password placeholder="输入密码..." required>
  <button>登录</button>${msg?`<div class=err>${msg}</div>`:""}
  </form></div></body></html>`;
}

// 并发执行池
async function pool(tasks,c=5){
  const res=[],exec=new Set();
  for(const t of tasks){
    const p=t().then(r=>{exec.delete(p);res.push(r);});
    exec.add(p);if(exec.size>=c)await Promise.race(exec);
  }await Promise.all(exec);return res.flat();
}

// Cloudflare 数据获取
async function usage(tokens){
  const API="https://api.cloudflare.com/client/v4",FREE=100000,sum=a=>a?.reduce((t,i)=>t+(i?.sum?.requests||0),0)||0;
  const now=new Date();now.setUTCHours(0,0,0,0);
  try{
    const all=tokens.map(T=>async()=>{const h={"Authorization":`Bearer ${T}`};
      const acc=await fetch(`${API}/accounts`,{headers:h}).then(r=>r.json());
      if(!acc?.result?.length)return [];
      const jobs=acc.result.map(a=>async()=>{
        const q={query:`query($id:String!,$f:AccountWorkersInvocationsAdaptiveFilter_InputObject){
        viewer{accounts(filter:{accountTag:$id}){
        pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:$f){sum{requests}}
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

// 仪表盘页（动态动效版）
function dashboard(d){
  return `<!DOCTYPE html><html lang=zh-CN><head><meta charset=UTF-8><meta name=viewport content=width=device-width,initial-scale=1>
  <title>Cloudflare Usage Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.1/dist/tailwind.min.css" rel=stylesheet>
  <style>
  body{font-family:Inter,Segoe UI,sans-serif;background:linear-gradient(135deg,#6366f1,#06b6d4,#8b5cf6);
  background-size:300% 300%;animation:grad 10s ease infinite;color:#fff;min-height:100vh;padding:2rem;overflow-x:hidden;}
  @keyframes grad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  .fadein{opacity:0;transform:translateY(40px);transition:.8s;}
  .show{opacity:1;transform:translateY(0);}
  .card{background:rgba(255,255,255,.12);backdrop-filter:blur(20px);border-radius:1.2rem;
  padding:1.5rem;box-shadow:0 0 40px rgba(0,0,0,.3);transition:.4s;}
  .card:hover{transform:translateY(-6px);box-shadow:0 0 50px rgba(255,255,255,.3);}
  .progress{height:.75rem;border-radius:9999px;overflow:hidden;background:rgba(255,255,255,.25);position:relative;}
  .fill{height:100%;background:linear-gradient(90deg,#22c55e,#3b82f6,#8b5cf6);background-size:200% 100%;
  animation:flow 3s linear infinite;}
  @keyframes flow{0%{background-position:0%}100%{background-position:-200%}}
  nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;
  background:rgba(255,255,255,.2);padding:1rem 1.5rem;border-radius:1rem;backdrop-filter:blur(10px);}
  button{background:rgba(255,255,255,.25);padding:.5rem 1rem;border-radius:9999px;transition:.3s;}
  button:hover{background:rgba(255,255,255,.4);box-shadow:0 0 10px rgba(255,255,255,.5);}
  footer{text-align:center;margin-top:2rem;opacity:.85;font-size:.9rem;}
  a{color:#fff;text-decoration:underline}
  .loader{position:fixed;inset:0;background:radial-gradient(circle,#4f46e5,#06b6d4,#8b5cf6);
  display:flex;justify-content:center;align-items:center;z-index:9999;animation:fadeOut 1s ease 1.2s forwards;}
  .dot{width:15px;height:15px;margin:5px;border-radius:50%;background:#fff;animation:blink 1s infinite alternate;}
  .dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
  @keyframes blink{from{opacity:.3;transform:scale(.8)}to{opacity:1;transform:scale(1.2)}}
  @keyframes fadeOut{to{opacity:0;visibility:hidden}}
  </style></head>
  <body>
  <div class="loader"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  <nav><h1 class="text-lg font-bold">☁️ Cloudflare Usage Dashboard</h1>
  <div><button id=r>🔄 刷新</button><button id=t>🌗 主题</button></div></nav>
  <main class="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
  ${d.accounts.map(a=>{
    const u=(a.total/(a.total+a.free_quota_remaining)*100).toFixed(1);
    return `<div class="card fadein">
      <h2 class="font-bold text-xl mb-2">${a.account_name}</h2>
      <p>📄 Pages：<b>${a.pages.toLocaleString()}</b></p>
      <p>⚙️ Workers：<b>${a.workers.toLocaleString()}</b></p>
      <p>📦 总计：<b>${a.total.toLocaleString()}</b></p>
      <p>🎁 剩余额度：<b>${a.free_quota_remaining.toLocaleString()}</b></p>
      <div class="progress mt-3"><div class="fill" style="width:${u}%"></div></div>
      <p class="text-sm mt-1">${u}% 已使用</p>
    </div>`;}).join("")}
  </main>
  <footer>©2025 <a href="https://github.com/arlettebrook" target="_blank">Arlettebrook</a></footer>
  <script>
    document.getElementById('r').onclick=()=>{document.body.style.opacity=.6;setTimeout(()=>location.reload(),400)};
    const rt=document.documentElement;let dark=false;
    document.getElementById('t').onclick=()=>{dark=!dark;
      document.body.style.background=dark?"#111827":"linear-gradient(135deg,#6366f1,#06b6d4,#8b5cf6)";
      document.body.style.transition="background 1s ease";}
    const cards=document.querySelectorAll('.fadein');
    const obs=new IntersectionObserver(e=>{e.forEach(i=>{if(i.isIntersecting)i.target.classList.add('show');});},{threshold:.1});
    cards.forEach(c=>obs.observe(c));
  </script></body></html>`;
}