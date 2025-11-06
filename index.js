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

    const result = await getCloudflareUsage(tokens);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};

async function getCloudflareUsage(tokens) {
  const API = "https://api.cloudflare.com/client/v4";
  const FREE_LIMIT = 100000;

  const sum = (a) => a?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;

  try {
    // 并行处理每个 Token
    const allAccounts = await Promise.all(tokens.map(async (APIToken) => {
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

      // 并行获取每个账户的使用量
      const accountsResults = await Promise.all(
        accData.result.map(async (account) => {
          const AccountID = account.id;
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

          const accUsage = result?.data?.viewer?.accounts?.[0];
          const pages = sum(accUsage?.pagesFunctionsInvocationsAdaptiveGroups);
          const workers = sum(accUsage?.workersInvocationsAdaptive);
          const total = pages + workers;
          const free_quota_remaining = Math.max(0, FREE_LIMIT - total);

          return {
            account_id: AccountID,
            account_name: AccountName,
            pages,
            workers,
            total,
            free_quota_remaining
          };
        })
      );

      return accountsResults;
    }));

    // flatten 所有 Token 的账户数据
    return { success: true, accounts: allAccounts.flat() };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      accounts: []
    };
  }
}