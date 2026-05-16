// generate.js — 时尚情报每日抓取脚本
// 架构：SerpAPI → 抓取文章正文 → DeepSeek 深度分析（含 next_move）
// 依赖环境变量：DS_API_KEY, SERP_API_KEY

const fs = require('fs');
const https = require('https');
const http = require('http');

const DS_KEY = process.env.DS_API_KEY;
const SERP_KEY = process.env.SERP_API_KEY;

if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }
if (!SERP_KEY) { console.error('❌ 缺少 SERP_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

// ── 抓取文章正文 ──────────────────────────────────────────────
function fetchArticle(url, maxChars = 1500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FashionIntelBot/2.0)',
          'Accept': 'text/html',
          'Accept-Language': 'zh-CN,zh;q=0.9'
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          // 提取正文：去掉 script/style/nav/header/footer
          const clean = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          resolve(clean.slice(0, maxChars));
        });
      });
      req.setTimeout(8000, () => { req.destroy(); resolve(''); });
      req.on('error', () => resolve(''));
      req.end();
    } catch { resolve(''); }
  });
}

// ── SerpAPI 搜索 ──────────────────────────────────────────────
function serpSearch(query, tbs = 'qdr:w') {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      api_key: SERP_KEY,
      engine: 'google',
      q: query,
      tbs,
      num: '6',
      hl: 'zh-cn',
      gl: 'cn'
    });

    const req = https.request({
      hostname: 'serpapi.com',
      path: `/search.json?${params}`,
      method: 'GET',
      timeout: 15000,
      headers: { 'User-Agent': 'FashionIntelBot/2.0' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (data.error) { resolve([]); return; }
          const results = [
            ...(data.organic_results || []),
            ...(data.news_results || [])
          ].slice(0, 6).map(r => ({
            title: r.title || '',
            url: r.link || '',
            snippet: (r.snippet || '').slice(0, 300),
            date: r.date || '',
            source: r.displayed_link || r.source || ''
          }));
          resolve(results);
        } catch { resolve([]); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// ── 多方向搜索 + 抓取正文 ─────────────────────────────────────
async function gatherIntel() {
  const queries = [
    { q: '奢侈品 品牌 中国 营销 活动 最新', label: '奢品中国营销' },
    { q: '时尚品牌 代言人 联名 官宣 最新', label: '代言联名' },
    { q: '观夏 山下有松 气味图书馆 新品 营销', label: '国货香氛' },
    { q: '品牌 危机 舆情 时尚 微博', label: '危机舆情' },
    { q: '奢侈品 开店 旗舰店 中国', label: '渠道零售' },
    { q: 'site:hualizhi.com 品牌 营销', label: '华丽志' },
    { q: 'site:socialbeta.com 品牌 案例', label: 'SocialBeta' },
    { q: 'site:jiemian.com 时尚 奢侈品', label: '界面时尚' },
    { q: 'luxury brand China campaign news latest', label: '国际奢品' },
    { q: 'LVMH Chanel Hermes Gucci China 2026', label: '奢品集团' },
  ];

  console.log('🌐 SerpAPI 搜索中（限定1周内）...\n');
  const allResults = [];

  for (const { q, label } of queries) {
    const results = await serpSearch(q, 'qdr:w');
    console.log(`  ✓ [${label}] → ${results.length} 条`);
    results.forEach(r => { r.queryLabel = label; });
    allResults.push(...results);
    await new Promise(r => setTimeout(r, 300));
  }

  // 去重
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (!r.url || !r.title || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`\n📥 共 ${unique.length} 条结果，开始抓取文章正文...\n`);

  // 并发抓取前30条文章正文（提升内容深度）
  const withContent = await Promise.all(
    unique.slice(0, 30).map(async (r, i) => {
      await new Promise(res => setTimeout(res, i * 100)); // 错开请求
      const body = await fetchArticle(r.url);
      if (body) console.log(`  ✓ 正文[${i+1}] ${r.source} — ${r.title.slice(0, 30)}...`);
      return { ...r, body };
    })
  );

  // 补上没抓正文的条目
  const remaining = unique.slice(30).map(r => ({ ...r, body: '' }));
  const final = [...withContent, ...remaining];

  // 来源统计
  const counts = {};
  final.forEach(r => { counts[r.queryLabel] = (counts[r.queryLabel] || 0) + 1; });
  console.log(`\n📰 分布：${Object.entries(counts).map(([k,v]) => `${k}(${v})`).join(' · ')}\n`);

  return final;
}

// ── DeepSeek 深度分析 ─────────────────────────────────────────
function callDeepSeek(articles) {
  const contextText = articles.slice(0, 40).map((r, i) => {
    const content = r.body
      ? `正文摘录：${r.body.slice(0, 800)}`
      : `摘要：${r.snippet}`;
    return `[${i+1}]【${r.queryLabel}】${r.title}
📅 ${r.date || '近期'} | 来源: ${r.source}
🔗 ${r.url}
${content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师，曾供职于LVMH集团战略部和麦肯锡奢侈品团队。

你的情报以三个特质著称：
1. 极度具体——产品系列全名、具体城市/门店/平台、真实数字、涉及人物姓名，每句话都有事实支撑
2. 洞察深刻——不只记录发生了什么，更要推演「接下来会发生什么」
3. 对市场人有用——每条情报都给出可立即执行的行动建议

严禁套话：「品牌影响力」「消费者认知」「市场份额」等模糊词汇一律禁止。
只输出JSON，第一个字符{，最后字符}。`;

  const USER = `今天是${today}。

以下是今日从Google搜索获取的最新时尚行业资讯（含文章正文）：

${contextText}

---

基于以上真实内容，输出竞品情报简报JSON。每条情报必须包含 next_move 字段——这是最重要的字段，回答「今天发生了这件事，明天它将走向哪里」。

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
      "title": "品牌+具体事件，15字内，直接点明发生了什么",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "从原文提取的具体日期",
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些具体人物？品牌意图是什么？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地，或平台名+账号"},
        {"label": "数据", "value": "原文中的具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[品牌这个动作背后的商业逻辑，一句话] ②竞品影响：[对哪个具体竞品构成什么威胁或机会] ③市场建议：[给同赛道市场人一条可立即执行的建议]",
      "next_move": "基于今天的动作，预判该品牌未来2-4周最可能的下一步是什么？竞品应该在哪里布防？给出具体的预判和建议，2-3句",
      "source_url": "原文URL，必须来自搜索结果",
      "source_name": "来源媒体名称",
      "crisis_level": null
    }
  ]
}

规则：
- 中国境内事件占70%以上
- 输出8-10条items，每条来自不同品牌
- 覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重）
- next_move每条必填，这是核心价值所在
- source_url必须是搜索结果中真实存在的URL
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
      max_tokens: 8000
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${DS_KEY}`,
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) { reject(new Error(`DeepSeek: ${JSON.stringify(parsed.error)}`)); return; }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) { reject(new Error('返回空内容')); return; }
          resolve(text);
        } catch(e) { reject(new Error(`解析失败: ${e.message}`)); }
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
    const articles = await gatherIntel();
    if (articles.length < 3) throw new Error('搜索结果不足，请检查 SERP_API_KEY');

    console.log('🤖 DeepSeek 深度分析中...');
    const raw = await callDeepSeek(articles);
    console.log('✅ 完成，解析JSON...');

    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const s = jsonStr.indexOf('{');
    const e = jsonStr.lastIndexOf('}');
    if (s === -1) throw new Error(`未找到JSON\n原始:\n${raw.slice(0, 500)}`);
    jsonStr = jsonStr.slice(s, e + 1);

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
