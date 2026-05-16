// generate.js — 时尚情报每日抓取脚本
// 架构：Tavily 7天内联网搜索 → DeepSeek 深度分析 → 结构化输出
// 依赖环境变量：DS_API_KEY, TAVILY_API_KEY

const fs = require('fs');
const https = require('https');

const DS_KEY = process.env.DS_API_KEY;
const TAVILY_KEY = process.env.TAVILY_API_KEY;

if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }
if (!TAVILY_KEY) { console.error('❌ 缺少 TAVILY_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// ── Tavily 搜索（强制7天内） ──────────────────────────────────
function tavilySearch(query, maxResults = 6) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      days: 7,                    // ← 只要7天内的内容
      include_answer: false,
      include_raw_content: false
    });

    const options = {
      hostname: 'api.tavily.com',
      path: '/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const results = (data.results || []).map(r => ({
            title: r.title || '',
            url: r.url || '',
            content: (r.content || '').slice(0, 500),
            published_date: r.published_date || '',
            source: (() => {
              try { return new URL(r.url).hostname.replace('www.', ''); }
              catch { return r.url; }
            })()
          }));
          resolve(results);
        } catch(e) {
          console.log(`  搜索解析失败: ${e.message}`);
          resolve([]);
        }
      });
    });
    req.on('error', (e) => { console.log(`  搜索请求失败: ${e.message}`); resolve([]); });
    req.write(body, 'utf8');
    req.end();
  });
}

// ── 多方向并行搜索 ────────────────────────────────────────────
async function gatherIntel() {
  const queries = [
    // 国际奢品最新动态
    'LVMH Louis Vuitton Dior Chanel new campaign launch 2026',
    'Hermès Gucci Loewe Bottega Veneta new collection 2026',
    'luxury brand China market news this week 2026',

    // 腕表珠宝
    'Cartier Bulgari Tiffany Rolex new launch event 2026',
    '积家 百达翡丽 腕表 新品发布 2026',

    // 中国市场社媒营销（近期）
    '奢侈品 小红书 营销 campaign 最新 2026',
    '时尚品牌 抖音 直播 联名 代言人 最新 2026',
    '品牌 微博 热搜 营销事件 本周',

    // 国货新锐
    '观夏 山下有松 气味图书馆 新品 2026',
    '国货 香氛 美妆 营销 小红书 最新',

    // 危机舆情
    'luxury brand controversy scandal China 2026',
    '奢侈品 危机 舆情 争议 最新 2026',

    // 渠道零售
    'luxury store opening China flagship 2026',
    '奢侈品 开店 电商 免税 渠道 最新 2026',

    // 行业报告趋势
    'luxury fashion China market trend report 2026',
    'Vogue Business WWD fashion news this week',
    '华丽志 时尚 行业 最新动态',
    'SocialBeta 品牌 营销 案例 本周',
  ];

  console.log(`🌐 Tavily 联网搜索（限定7天内）...\n`);
  const allResults = [];

  // 分批并发，避免超限
  const batchSize = 4;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(q => tavilySearch(q, 6)));
    batch.forEach((q, j) => {
      const count = batchResults[j].length;
      console.log(`  ✓ "${q.slice(0, 36)}..." → ${count} 条`);
      allResults.push(...batchResults[j]);
    });
    await new Promise(r => setTimeout(r, 300));
  }

  // 去重 + 过滤空内容
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (!r.url || !r.title || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`\n📥 共获取 ${unique.length} 条近期资讯`);

  // 打印来源分布
  const sourceCounts = {};
  unique.forEach(r => { sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1; });
  const topSources = Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).slice(0, 8);
  console.log(`📰 来源分布: ${topSources.map(([s,c])=>`${s}(${c})`).join(', ')}\n`);

  return unique;
}

// ── DeepSeek 深度分析 ─────────────────────────────────────────
function callDeepSeek(searchResults) {
  // 构建资讯上下文，标注发布时间
  const contextText = searchResults.slice(0, 40).map((r, i) => {
    const dateStr = r.published_date ? `发布时间：${r.published_date}` : '';
    return `[${i+1}] ${r.title}\n来源：${r.source} | URL：${r.url}\n${dateStr}\n内容摘要：${r.content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师，曾供职于LVMH集团战略部和麦肯锡奢侈品团队。

核心原则：
1. 只基于提供的搜索结果生成情报，不编造任何内容
2. 每条情报必须极度具体：产品系列全名、具体城市/门店/平台名称、真实数据数字、涉及人物姓名
3. market_signal必须三层分析：①战略意图 ②对竞品的具体威胁或机会 ③给市场人的可操作建议
4. 严禁套话：「品牌影响力」「消费者认知」「市场份额」等模糊词汇一律禁止
5. 只输出JSON，第一个字符{，最后字符}`;

  const USER = `今天是${today}。

以下是今日抓取的最新时尚行业资讯（均为近7天内发布）：

${contextText}

---

基于以上真实资讯，按以下JSON格式输出情报简报。
每条item必须来自搜索结果中的真实事件，source_url填入对应原文链接。
如果搜索结果中某类资讯不足，可以适当减少该类条目，但不得编造。

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内，有冲击力的趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "基于搜索结果中的具体品牌动作，包含品牌名+事件+数据，2-3句，禁止套话",
      "signals": ["可在搜索结果中验证的具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "基于搜索结果，包含具体品牌名+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "基于搜索结果，包含具体品牌名+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌名+具体事件，15字内，直接点明发生了什么",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "从搜索结果中提取的具体日期",
      "summary": "基于搜索原文，回答：什么产品/系列？在哪里？什么规模？涉及哪些人？意图是什么？3-4句，每句都有具体事实支撑",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称，来自原文"},
        {"label": "地点/平台", "value": "具体城市+场地名，或平台名+账号"},
        {"label": "数据", "value": "原文中的具体数字，如无则注明「暂无公开数据」"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[说明这个动作背后的商业逻辑] ②竞品影响：[对哪个竞品构成什么具体威胁或机会] ③市场建议：[给同赛道市场人一条可立即执行的行动建议]",
      "source_url": "从搜索结果中提取的原文URL，必须真实存在",
      "source_name": "来源媒体名称",
      "crisis_level": null
    }
  ]
}

重要规则：
- 输出8-10条items，尽量覆盖不同品牌
- 必须覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情类必须填crisis_level（轻微/中度/严重）
- 若某类资讯搜索结果不足，优先保证内容真实，不足的条目可减少
- 只返回JSON，无任何其他文字`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ],
      temperature: 0.2,
      max_tokens: 6000
    });

    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${DS_KEY}`,
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error(`DeepSeek错误: ${JSON.stringify(parsed.error)}`));
            return;
          }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) {
            reject(new Error(`返回空内容: ${raw.slice(0, 400)}`));
            return;
          }
          resolve(text);
        } catch(e) {
          reject(new Error(`解析失败: ${e.message}\n原始: ${raw.slice(0, 400)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 时尚情报生成器 — ${today}\n`);
  try {
    // 1. 联网搜索（7天内）
    const searchResults = await gatherIntel();

    if (searchResults.length === 0) {
      throw new Error('搜索结果为空，请检查 TAVILY_API_KEY 是否有效');
    }

    // 2. DeepSeek 分析
    console.log('🤖 DeepSeek 分析中...');
    const raw = await callDeepSeek(searchResults);
    console.log('✅ 分析完成，解析JSON...');

    // 3. 解析JSON
    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON\n原始输出:\n${raw.slice(0, 600)}`);
    jsonStr = jsonStr.slice(start, end + 1);

    const data = JSON.parse(jsonStr);
    data.updated = data.updated || today;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    // 4. 写入文件
    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });

    console.log(`\n📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      const src = item.source_url ? ` → ${item.source_name || ''}` : ' → 无来源';
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}${src}`);
    });
    console.log('\n✅ news-data.json 写入完成\n');

  } catch (err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
