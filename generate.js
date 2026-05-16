// generate.js — 时尚情报每日抓取脚本
// 架构：DeepSeek tool_call 循环搜索 → 强制 JSON 输出
// 依赖环境变量：DS_API_KEY

const fs = require('fs');
const https = require('https');

const DS_KEY = process.env.DS_API_KEY;
if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// ── HTTP POST 封装 ────────────────────────────────────────────
function httpPost(hostname, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request({
      hostname, path, method: 'POST',
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': buf.length,
        ...extraHeaders
      }
    }, (res) => {
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

// ── Bing 搜索 ─────────────────────────────────────────────────
function bingSearch(query) {
  return new Promise((resolve) => {
    // 在查询里优先中文媒体
    const siteFilter = 'site:hualizhi.com OR site:socialbeta.com OR site:jiemian.com OR site:wwd-china.com OR site:36kr.com OR site:huxiu.com OR site:businessoffashion.com OR site:voguebusiness.com OR site:jingdaily.com';
    const fullQuery = encodeURIComponent(`${query} ${siteFilter}`);

    const req = https.request({
      hostname: 'www.bing.com',
      path: `/search?q=${fullQuery}&count=8&mkt=zh-CN&setlang=zh-hans`,
      method: 'GET',
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        const results = [];

        // 提取搜索结果
        const blocks = html.match(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>)/g) || [];
        for (const block of blocks.slice(0, 6)) {
          const urlM = block.match(/href="(https?:\/\/[^"]+)"/);
          const titleM = block.match(/<h2[^>]*>.*?<a[^>]*>([\s\S]*?)<\/a>/);
          const snippetM = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
                           block.match(/<p>([\s\S]*?)<\/p>/);

          if (urlM && titleM) {
            const url = urlM[1];
            const title = titleM[1].replace(/<[^>]+>/g, '').trim();
            const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, '').trim().slice(0, 250) : '';
            if (title && url) {
              results.push(`• ${title}\n  链接: ${url}\n  摘要: ${snippet}`);
            }
          }
        }

        resolve(results.length > 0
          ? `关键词"${query}"的搜索结果 (${results.length}条):\n\n${results.join('\n\n')}`
          : `关键词"${query}"未找到相关结果，请尝试其他关键词`
        );
      });
    });
    req.setTimeout(12000, () => { req.destroy(); resolve(`搜索"${query}"超时`); });
    req.on('error', () => resolve(`搜索"${query}"网络错误`));
    req.end();
  });
}

// ── DeepSeek 对话（tool_call 循环 + 强制输出）────────────────
async function runDeepSeek() {
  const MAX_SEARCH_ROUNDS = 8;

  const tools = [{
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取最新时尚行业资讯，优先使用中文关键词搜索中国境内媒体内容',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['query']
      }
    }
  }];

  const JSON_TEMPLATE = `{
  "updated": "${today}",
  "trend_forecast": [
    {"title": "标题", "horizon": "近期 · 1–4周", "summary": "摘要", "signals": ["信号1","信号2","信号3"]},
    {"title": "标题", "horizon": "中期 · 1–3个月", "summary": "摘要", "signals": ["信号1","信号2","信号3"]},
    {"title": "标题", "horizon": "长期 · 季度级", "summary": "摘要", "signals": ["信号1","信号2","信号3"]}
  ],
  "items": [
    {
      "title": "品牌+具体事件15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "3-4句具体描述",
      "facts": [
        {"label": "产品/活动", "value": "具体名称"},
        {"label": "地点/平台", "value": "具体地点"},
        {"label": "数据", "value": "具体数字"},
        {"label": "核心差异", "value": "区别说明"}
      ],
      "market_signal": "①战略意图：说明 ②竞品影响：说明 ③市场建议：建议",
      "source_url": "原文链接",
      "source_name": "媒体名称",
      "crisis_level": null
    }
  ]
}`;

  const messages = [
    {
      role: 'system',
      content: `你是奢侈品行业市场情报分析师。搜索今日时尚行业最新动态，重点关注中国境内事件（占70%以上）。
搜索完成后输出JSON情报简报，要求极度具体，每条包含：产品系列全名、具体城市/平台、真实数字、人物姓名。
market_signal必须包含：①战略意图 ②竞品影响 ③市场建议。严禁套话，只输出JSON。`
    },
    {
      role: 'user',
      content: `今天是${today}。请搜索以下方向后输出情报简报：

搜索重点（优先中文关键词）：
- 奢侈品/时尚品牌 中国市场 最新营销活动
- 观夏 山下有松 国货香氛 最新动态
- 时尚品牌 代言人 联名 最新
- 品牌 危机 舆情 时尚 最新
- luxury fashion China news ${today.slice(0,7)}
- 奢侈品 开店 电商 渠道 最新

搜索完成后，严格按此JSON格式输出8-10条情报（category只能用：营销动作/社媒声量/渠道零售/危机舆情/趋势前瞻）：

${JSON_TEMPLATE}`
    }
  ];

  let searchCount = 0;

  for (let round = 0; round < MAX_SEARCH_ROUNDS + 1; round++) {
    // 最后一轮：强制关闭 tools，让模型直接输出 JSON
    const isLastRound = round === MAX_SEARCH_ROUNDS;
    if (isLastRound) {
      console.log('\n⚡ 强制输出JSON...');
      messages.push({
        role: 'user',
        content: `你已完成${searchCount}次搜索，信息已足够。请立即根据以上所有搜索结果，输出完整的JSON情报简报。只输出JSON，第一个字符{，最后字符}，不要任何其他文字。`
      });
    }

    console.log(`  第 ${round + 1} 轮对话...`);
    const res = await httpPost(
      'api.deepseek.com',
      '/chat/completions',
      {
        model: 'deepseek-chat',
        messages,
        tools: isLastRound ? undefined : tools,
        tool_choice: isLastRound ? undefined : 'auto',
        temperature: 0.2,
        max_tokens: 6000
      },
      { Authorization: `Bearer ${DS_KEY}` }
    );

    if (res.error) throw new Error(`DeepSeek错误: ${JSON.stringify(res.error)}`);

    const choice = res.choices?.[0];
    if (!choice) throw new Error('API返回空choices');

    const msg = choice.message;
    messages.push(msg);

    // 有 tool_calls → 执行搜索
    if (choice.finish_reason === 'tool_calls' && msg.tool_calls?.length > 0) {
      for (const tc of msg.tool_calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        const query = args.query || '';
        console.log(`  🔍 搜索[${++searchCount}]: "${query}"`);
        const result = await bingSearch(query);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      continue;
    }

    // 有文字内容 → 尝试解析 JSON
    if (msg.content) {
      let text = msg.content.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        return text.slice(s, e + 1); // 成功拿到 JSON
      }
      // 有文字但不是 JSON，继续
      console.log(`  ℹ️  模型输出文字（非JSON），继续...`);
      continue;
    }
  }

  throw new Error('未能获得JSON输出');
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 时尚情报生成器 — ${today}\n`);
  try {
    console.log('🔍 开始搜索分析...\n');
    const jsonStr = await runDeepSeek();

    console.log('\n✅ 获得JSON，解析中...');
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
