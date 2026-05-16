// generate.js — 时尚情报每日抓取脚本
// 架构：Tavily 联网搜索 → DeepSeek 深度分析 → 结构化输出
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

// ── Tavily 搜索 ───────────────────────────────────────────────
function tavilySearch(query, maxResults = 5) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_domains: [
        'hualizhi.com', 'socialbeta.com', 'vogue.com.cn',
        'businessoffashion.com', 'jingdaily.com', 'wwd.com',
        'weibo.com', 'xiaohongshu.com', '36kr.com',
        'jiemian.com', 'luxe.co', 'fashionnetwork.com'
      ]
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
            title: r.title,
            url: r.url,
            content: r.content?.slice(0, 400) || '',
            source: new URL(r.url).hostname.replace('www.', '')
          }));
          resolve(results);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.write(body, 'utf8');
    req.end();
  });
}

// ── 并行搜索多个方向 ──────────────────────────────────────────
async function gatherIntel() {
  const queries = [
    // 国际奢品
    'luxury brand campaign China marketing 2026 LVMH Chanel Hermes Gucci',
    'Dior Loewe Bottega Veneta China launch event 2026',
    // 腕表珠宝
    'Cartier Tiffany Bulgari watch jewelry China 2026 new collection',
    // 社媒营销
    '小红书 奢侈品 品牌营销 2026 KOL campaign',
    '抖音 时尚品牌 直播 联名 2026',
    // 国货新锐
    '观夏 山下有松 气味图书馆 新品 营销 2026',
    // 危机舆情
    '奢侈品 危机 舆情 中国 2026',
    // 渠道零售
    'luxury retail China store opening ecommerce 2026',
  ];

  console.log('🌐 Tavily 联网搜索中...');
  const allResults = [];

  for (const q of queries) {
    const results = await tavilySearch(q, 4);
    allResults.push(...results);
    console.log(`  ✓ "${q.slice(0, 30)}..." → ${results.length} 条`);
    await new Promise(r => setTimeout(r, 200));
  }

  // 去重
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`\n📥 共获取 ${unique.length} 条原始资讯\n`);
  return unique;
}

// ── DeepSeek 分析生成 ─────────────────────────────────────────
function callDeepSeek(searchResults) {
  const contextText = searchResults.map((r, i) =>
    `[${i+1}] 标题：${r.title}\n来源：${r.source} (${r.url})\n摘要：${r.content}`
  ).join('\n\n---\n\n');

  const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师，曾供职于LVMH集团战略部。

你的情报以三个特质著称：
1. 极度具体——必须包含：产品系列全名、具体城市/门店/平台、真实数据（曝光量/销售额/参与人数）、涉及人物（代言人/KOL/设计师姓名）
2. 严禁套话——「品牌影响力」「消费者认知」「市场份额提升」等模糊表达一律替换为具体事实
3. 洞察三层——market_signal必须包含：①战略意图 ②对竞品的具体威胁或机会 ③给市场营销人员的可操作建议

只输出JSON，第一个字符{，最后字符}，无任何其他文字。`;

  const USER = `今天是${today}。

以下是今日通过联网搜索获取的时尚行业真实资讯，请基于这些真实内容生成情报简报：

${contextText}

---

请基于以上真实搜索结果，严格按以下JSON格式输出。每条情报必须来自搜索结果中的真实事件，并在source_url填入对应的原文链接：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "必须包含具体品牌名+具体动作+可量化数据，2-3句，禁止套话",
      "signals": ["可观测的具体信号", "可观测的具体信号", "可观测的具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "必须包含具体品牌名+具体动作+可量化数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "必须包含具体品牌名+具体动作+可量化数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内，有冲击力",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "必须回答：什么产品/系列全名？在哪个城市/门店/平台？什么数据？涉及哪些具体人物？品牌意图是什么？3-4句，禁止任何模糊表达",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+地址，或平台名+账号名称"},
        {"label": "数据", "value": "具体数字：曝光量/销售额/参与人数/场次等"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体不同之处"}
      ],
      "market_signal": "①战略意图：[具体一句话，说明品牌这个动作背后的商业逻辑] ②竞品影响：[具体说明对哪个竞品构成什么威胁或机会] ③市场建议：[给同赛道市场人员一条可立即执行的建议]",
      "source_url": "必填：从搜索结果中提取的原文URL",
      "source_name": "来源媒体名称",
      "crisis_level": null
    }
  ]
}

要求：
- 输出8-10条items，每条来自不同品牌
- 必须覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情类必须填写crisis_level（轻微/中度/严重）
- source_url必须是搜索结果中真实存在的URL，不可编造
- 只返回JSON，无任何其他内容`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ],
      temperature: 0.3,
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
          if (parsed.error) { reject(new Error(`DeepSeek API错误: ${JSON.stringify(parsed.error)}`)); return; }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) { reject(new Error(`返回空内容: ${raw.slice(0, 400)}`)); return; }
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
  console.log(`\n🚀 时尚情报生成器启动 — ${today}\n`);
  try {
    // 1. Tavily 联网搜索
    const searchResults = await gatherIntel();

    // 2. DeepSeek 深度分析
    console.log('🤖 DeepSeek 分析中...');
    const raw = await callDeepSeek(searchResults);
    console.log('✅ 分析完成，解析JSON...');

    // 3. 解析
    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON\n原始:\n${raw.slice(0, 600)}`);
    jsonStr = jsonStr.slice(start, end + 1);

    const data = JSON.parse(jsonStr);
    data.updated = data.updated || today;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    // 4. 写入
    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });

    console.log(`\n📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      const src = item.source_url ? ` → ${item.source_name || item.source_url}` : ' → 无来源';
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}${src}`);
    });
    console.log('\n✅ 完成\n');

  } catch (err) {
    console.error('❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
