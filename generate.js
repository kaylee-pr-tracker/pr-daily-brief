// generate.js — 时尚情报每日抓取脚本
// 架构：DeepSeek 联网搜索（正确处理 tool_call 循环）
// 依赖环境变量：DS_API_KEY

const fs = require('fs');
const https = require('https');

const DS_KEY = process.env.DS_API_KEY;
if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// ── HTTP 请求封装 ─────────────────────────────────────────────
function httpPost(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body), 'utf8');
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': buf.length,
        ...headers
      },
      timeout: 120000
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch(e) { reject(new Error('JSON解析失败: ' + e.message)); }
      });
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ── DeepSeek API 调用（带 tool_call 循环）────────────────────
async function callDeepSeekWithSearch(messages, tools) {
  const MAX_ROUNDS = 6;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(`  第 ${round + 1} 轮对话...`);

    const res = await httpPost(
      'api.deepseek.com',
      '/chat/completions',
      {
        model: 'deepseek-chat',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 6000
      },
      { Authorization: `Bearer ${DS_KEY}` }
    );

    if (res.error) throw new Error(`DeepSeek错误: ${JSON.stringify(res.error)}`);

    const choice = res.choices?.[0];
    if (!choice) throw new Error('API 返回空 choices');

    const msg = choice.message;
    messages.push(msg); // 把 assistant 回复加入历史

    // 如果有 tool_calls，执行搜索并把结果喂回去
    if (choice.finish_reason === 'tool_calls' && msg.tool_calls?.length > 0) {
      for (const tc of msg.tool_calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        const query = args.query || args.q || '';
        console.log(`  🔍 搜索: "${query}"`);

        // 用 Bing 搜索（不需要 API key，直接抓搜索结果页）
        const searchResult = await bingSearch(query);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: searchResult
        });
      }
      continue; // 继续下一轮，让模型处理搜索结果
    }

    // 模型给出最终回答
    if (choice.finish_reason === 'stop' && msg.content) {
      return msg.content;
    }

    // 没有内容也没有 tool_calls，退出
    throw new Error(`意外的 finish_reason: ${choice.finish_reason}`);
  }

  throw new Error('超过最大对话轮数，未能获得最终回答');
}

// ── Bing 搜索（无需 API key）─────────────────────────────────
function bingSearch(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query + ' site:hualizhi.com OR site:socialbeta.com OR site:jiemian.com OR site:wwd-china.com OR site:businessoffashion.com OR site:voguebusiness.com');
    const options = {
      hostname: 'www.bing.com',
      path: `/search?q=${encoded}&count=8&mkt=zh-CN`,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept': 'text/html'
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        // 从 Bing 结果页提取标题和摘要
        const results = [];
        const itemRegex = /<li class="b_algo"[\s\S]*?<\/li>/g;
        let m;
        while ((m = itemRegex.exec(html)) !== null && results.length < 6) {
          const block = m[0];
          const titleM = block.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/);
          const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
          if (titleM && snippetM) {
            const url = titleM[1];
            const title = titleM[2].replace(/<[^>]+>/g, '').trim();
            const snippet = snippetM[1].replace(/<[^>]+>/g, '').trim().slice(0, 300);
            if (title && url.startsWith('http')) {
              results.push(`标题：${title}\n链接：${url}\n摘要：${snippet}`);
            }
          }
        }
        resolve(results.length > 0
          ? `搜索"${query}"的结果：\n\n${results.join('\n\n---\n\n')}`
          : `搜索"${query}"未找到相关结果`
        );
      });
    });
    req.setTimeout(10000, () => { req.destroy(); resolve(`搜索超时`); });
    req.on('error', () => resolve(`搜索失败`));
    req.end();
  });
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 时尚情报生成器 — ${today}\n`);

  const tools = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '搜索互联网获取最新时尚行业资讯',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词，建议用中文' }
          },
          required: ['query']
        }
      }
    }
  ];

  const messages = [
    {
      role: 'system',
      content: `你是一位有15年经验的奢侈品行业市场情报分析师。

核心原则：
1. 主动搜索今日最新资讯，优先搜索中国境内媒体内容
2. 每条情报极度具体：产品系列全名、具体城市/门店/平台、真实数字、涉及人物姓名
3. market_signal三层：①战略意图 ②竞品影响 ③可操作建议
4. 严禁套话，所有内容必须来自真实搜索结果
5. 最终只输出JSON，第一个字符{，最后字符}`
    },
    {
      role: 'user',
      content: `今天是${today}。

请搜索以下方向的最新资讯（优先搜索中国境内内容）：

1. 搜索"奢侈品 中国 营销 ${today.slice(0,7)}"
2. 搜索"时尚品牌 新品发布 活动 最新"
3. 搜索"观夏 山下有松 国货香氛 最新动态"
4. 搜索"luxury brand China campaign latest news"
5. 搜索"品牌 危机 舆情 时尚 最新"
6. 搜索"奢侈品 开店 电商 渠道 最新"

搜索完成后，按以下JSON格式输出（只返回JSON，无其他文字）：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "含具体品牌+事件+数据，2-3句，禁止套话",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "什么产品/系列？哪个城市/平台？什么数据？涉及哪些人？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "具体名称"},
        {"label": "地点/平台", "value": "具体城市或平台"},
        {"label": "数据", "value": "具体数字"},
        {"label": "核心差异", "value": "与以往或竞品的区别"}
      ],
      "market_signal": "①战略意图：[说明] ②竞品影响：[说明] ③市场建议：[可执行建议]",
      "source_url": "原文链接",
      "source_name": "来源媒体",
      "crisis_level": null
    }
  ]
}

要求：中国境内事件占70%以上，覆盖5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻，输出8-10条items。`
    }
  ];

  try {
    console.log('🔍 开始搜索分析...\n');
    const raw = await callDeepSeekWithSearch(messages, tools);
    console.log('\n✅ 获得最终回答，解析JSON...');

    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON\n原始:\n${raw.slice(0, 500)}`);
    jsonStr = jsonStr.slice(start, end + 1);

    const data = JSON.parse(jsonStr);
    data.updated = data.updated || today;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });

    console.log(`\n📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}`);
      if (item.source_url) console.log(`      └ ${item.source_name} | ${item.source_url}`);
    });
    console.log('\n✅ 完成\n');

  } catch(err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
