export default {
  async fetch(request, env, ctx) {
    const result = await getCloudflareUsage(env.CF_API_TOKEN);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};

async function getCloudflareUsage(APIToken) {
  const API = "https://api.cloudflare.com/client/v4";
  const cfg = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${APIToken}`
  };
  const sum = (a) => a?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;

  try {
    // 1️⃣ 获取账户 ID
    const accRes = await fetch(`${API}/accounts`, { headers: cfg });
    if (!accRes.ok) throw new Error(`账户获取失败: ${accRes.status}`);
    const accData = await accRes.json();
    if (!accData?.result?.length) throw new Error("未找到账户");
    const AccountID = accData.result[0].id;

    // 2️⃣ 时间范围（当天 UTC 0点 ~ 当前时间）
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    // 3️⃣ 发起 GraphQL 查询
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
          AccountID,
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

    // 4️⃣ 汇总结果
    const acc = result?.data?.viewer?.accounts?.[0];
    if (!acc) throw new Error("未找到账户数据");

    const pages = sum(acc.pagesFunctionsInvocationsAdaptiveGroups);
    const workers = sum(acc.workersInvocationsAdaptive);
    const total = pages + workers;

    return { success: true, pages, workers, total, account: AccountID };
  } catch (err) {
    return { success: false, error: err.message, pages: 0, workers: 0, total: 0 };
  }
}