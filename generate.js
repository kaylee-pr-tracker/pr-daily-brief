// generate.js — 时尚情报每日抓取脚本
// 架构：SerpAPI（Google搜索，精确时效）→ DeepSeek 分析
// 依赖环境变量：DS_API_KEY, SERP_API_KEY

const fs = require('fs');
const https = require('https');

const DS_KEY = process.env.DS_API_KEY;
const SERP_KEY = process.env.SERP_API_KEY;

if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }
if (!SERP_KEY) { console.error('❌ 缺少 SERP_API_KEY'); process.exit(1); }

const now = new Date();
const today = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

// ── SerpAPI Google 搜索 ───────────────────────────────────────
function serpSearch(query, timeFilter = 'qdr:w') {
  // timeFilter: qdr:d=1天内 qdr:w=1周内 qdr:m=1个月内
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      api_key: SERP_KEY,
      engine: 'google',
      q: query,
      tbs: timeFilter,       // 时间过滤：只要1周内
      num: '8',
      hl: 'zh-cn',           // 中文界面
      gl: 'cn',              // 地区：中国
      google_domain: 'google.com'
    });

    const options = {
      hostname: 'serpapi.com',
      path: `/search.json?${params.toString()}`,
      method: 'GET',
      timeout: 15000,
      headers: { 'User-Agent': 'FashionIntelBot/1.0' }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));

          if (data.error) {
            console.log(`  ⚠️  SerpAPI错误: ${data.error}`);
            resolve([]);
            return;
          }

          const results = [];

          // 普通搜索结果
          (data.organic_results || []).slice(0, 6).forEach(r => {
            results.push({
              title: r.title || '',
              url: r.link || '',
              snippet: (r.snippet || '').slice(0, 400),
              date: r.date || '',
              source: r.displayed_link || ''
            });
          });

          // 新闻结果（如果有）
          (data.news_results || []).slice(0, 4).forEach(r => {
            results.push({
              title: r.title || '',
              url: r.link || '',
              snippet: (r.snippet || '').slice(0, 400),
              date: r.date || '',
              source: r.source || ''
            });
          });

          resolve(results);
        } catch(e) {
          resolve([]);
        }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// ── 多方向搜索 ────────────────────────────────────────────────
async function gatherIntel() {
  const queries = [
    // 中国境内时尚热点（优先）
    { q: '奢侈品 品牌 中国 营销 活动 最新', label: '奢品中国营销' },
    { q: '时尚品牌 代言人 联名 官宣 最新', label: '代言联名' },
    { q: '观夏 山下有松 气味图书馆 新品 2026', label: '国货香氛' },
    { q: '品牌 危机 舆情 时尚 微博 最新', label: '危机舆情' },
    { q: '奢侈品 开店 旗舰店 中国 最新', label: '渠道零售' },
    { q: 'site:hualizhi.com 时尚 品牌 最新', label: '华丽志' },
    { q: 'site:socialbeta.com 品牌 营销 案例', label: 'SocialBeta' },
    { q: 'site:jiemian.com 时尚 奢侈品', label: '界面时尚' },

    // 国际重点（只要影响中国市场的）
    { q: 'luxury brand China campaign launch latest news', label: '国际奢品中国' },
    { q: 'LVMH Chanel Hermes Gucci China 2026 latest', label: '奢品集团动态' },
    { q: 'luxury fashion crisis controversy China 2026', label: '国际危机' },
  ];

  console.log(`🌐 SerpAPI Google搜索（限定1周内）...\n`);
  const allResults = [];

  for (const { q, label } of queries) {
    const results = await serpSearch(q, 'qdr:w');
    console.log(`  ✓ [${label}] → ${results.length} 条`);
    results.forEach(r => { r.queryLabel = label; });
    allResults.push(...results);
    await new Promise(r => setTimeout(r, 300)); // 避免超速
  }

  // 去重
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (!r.url || !r.title || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // 来源统计
  const sourceCounts = {};
  unique.forEach(r => {
    const domain = r.source || r.url.split('/')[2] || 'unknown';
    sourceCounts[domain] = (sourceCounts[domain] || 0) + 1;
  });
  const top = Object.entries(sourceCounts).sort((a,b) => b[1]-a[1]).slice(0,8);

  console.log(`\n📥 共获取 ${unique.length} 条近期资讯`);
  console.log(`📰 来源：${top.map(([s,c]) => `${s}(${c})`).join(' · ')}\n`);

  return unique;
}

// ── DeepSeek 分析 ─────────────────────────────────────────────
function callDeepSeek(articles) {
  const contextText = articles.slice(0, 50).map((r, i) =>
    `[${i+1}] 【${r.queryLabel || ''}】${r.title}\n📅 ${r.date || '近期'} | 来源: ${r.source}\n🔗 ${r.url}\n${r.snippet}`
  ).join('\n\n---\n\n');

  const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师。

核心原则：
1. 只基于提供的真实搜索结果生成情报，严禁编造
2. 每条情报极度具体：产品系列全名、具体城市/门店/平台、真实数字、人物姓名
3. market_signal三层：①战略意图 ②竞品影响 ③可操作建议
4. 严禁套话，只输出JSON`;

  const USER = `今天是${today}。

以下是通过 Google 搜索获取的最新时尚行业资讯（均为近1周内）：

${contextText}

---

基于以上真实资讯，输出时尚行业竞品情报简报（只返回JSON）：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题，有冲击力",
      "horizon": "近期 · 1–4周",
      "summary": "含具体品牌+事件+数据，2-3句，禁止套话",
      "signals": ["可验证的具体信号", "具体信号", "具体信号"]
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
      "date": "从搜索结果提取的具体日期",
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些具体人物？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地，或平台名+账号"},
        {"label": "数据", "value": "搜索结果中的具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[说明] ②竞品影响：[说明] ③市场建议：[可执行建议]",
      "source_url": "从搜索结果提取的原文URL",
      "source_name": "来源媒体名称",
      "crisis_level": null
    }
  ]
}

规则：
- 中国境内事件占70%以上
- 输出8-10条items，覆盖不同品牌
- 覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重）
- source_url必须来自搜索结果中的真实URL
- 内容不足时减少条目，绝不编造
- 只返回JSON`;

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
      timeout: 120000,
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
          if (parsed.error) { reject(new Error(`DeepSeek错误: ${JSON.stringify(parsed.error)}`)); return; }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) { reject(new Error(`返回空内容`)); return; }
          resolve(text);
        } catch(e) {
          reject(new Error(`解析失败: ${e.message}`));
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
  console.log(`\n🚀 时尚情报生成器（SerpAPI + DeepSeek）— ${today}\n`);
  try {
    const articles = await gatherIntel();

    if (articles.length < 3) {
      throw new Error(`搜索结果不足（${articles.length}条），请检查 SERP_API_KEY`);
    }

    console.log('🤖 DeepSeek 分析中...');
    const raw = await callDeepSeek(articles);
    console.log('✅ 分析完成，解析JSON...');

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
