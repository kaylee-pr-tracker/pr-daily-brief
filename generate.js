// generate.js — 时尚情报每日抓取脚本
// 架构：SerpAPI → 抓取正文 → DeepSeek 深度分析（Marketing/PR视角）→ 归档存储
// 依赖环境变量：DS_API_KEY, SERP_API_KEY

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DS_KEY = process.env.DS_API_KEY;
const SERP_KEY = process.env.SERP_API_KEY;

if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }
if (!SERP_KEY) { console.error('❌ 缺少 SERP_API_KEY'); process.exit(1); }

const now = new Date();
const today = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const dateKey = now.toISOString().slice(0, 10); // 2026-05-16

// ── 确保 archive 目录存在 ─────────────────────────────────────
if (!fs.existsSync('archive')) fs.mkdirSync('archive');

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

  const seen = new Set();
  const unique = allResults.filter(r => {
    if (!r.url || !r.title || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`\n📥 共 ${unique.length} 条，抓取文章正文...\n`);

  const withContent = await Promise.all(
    unique.slice(0, 30).map(async (r, i) => {
      await new Promise(res => setTimeout(res, i * 100));
      const body = await fetchArticle(r.url);
      if (body) console.log(`  ✓ [${i+1}] ${r.source} — ${r.title.slice(0,30)}...`);
      return { ...r, body };
    })
  );

  return [...withContent, ...unique.slice(30).map(r => ({ ...r, body: '' }))];
}

// ── DeepSeek 深度分析（Marketing/PR专业视角）────────────────
function callDeepSeek(articles) {
  const contextText = articles.slice(0, 40).map((r, i) => {
    const content = r.body ? `正文：${r.body.slice(0, 800)}` : `摘要：${r.snippet}`;
    return `[${i+1}]【${r.queryLabel}】${r.title}\n📅 ${r.date||'近期'} | ${r.source}\n🔗 ${r.url}\n${content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是一位同时精通 Marketing 和 PR 的奢侈品行业资深顾问，有15年经验，曾供职于LVMH集团和博达大桥公关公司。

你用两套思维框架分析每一个品牌动作：

【Marketing 思维】
- 这个动作的目标受众是谁？用了什么触达路径？
- 创意策略是什么？与品牌整体策略的关系？
- 预算结构推断：重金KOL还是内容驱动？渠道分配？
- ROI 逻辑：如何衡量这个campaign的成效？

【PR 思维】
- 这个动作的媒体传播价值是什么？
- 品牌叙事（Brand Narrative）如何构建？
- 潜在舆情风险点在哪里？如何提前布防？
- 危机情境下：如何回应？时间窗口？关键信息？

每条情报必须极度具体，严禁套话。只输出JSON。`;

  const USER = `今天是${today}。

以下是今日搜索到的最新时尚行业资讯：

${contextText}

---

基于以上内容，从 Marketing + PR 双重专业视角输出竞品情报简报：

{
  "updated": "${today}",
  "date_key": "${dateKey}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"],
      "marketing_implication": "这个趋势对市场营销策略的具体影响，给出可操作的方向建议",
      "pr_implication": "这个趋势对品牌传播和舆情管理的具体影响"
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"],
      "marketing_implication": "营销策略影响",
      "pr_implication": "传播和舆情影响"
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"],
      "marketing_implication": "营销策略影响",
      "pr_implication": "传播和舆情影响"
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些具体人物？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地，或平台名+账号"},
        {"label": "数据", "value": "具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与以往或竞品的具体区别"}
      ],
      "marketing_analysis": {
        "target_audience": "目标受众画像：年龄/消费层级/心理特征，要具体",
        "strategy": "创意策略：用了什么营销手法？为什么这样做？",
        "channel_logic": "渠道逻辑：选择这个平台/渠道的原因，预算重心判断",
        "roi_measure": "如何衡量这次营销的效果？关键指标是什么？",
        "competitor_threat": "对竞品的具体威胁：哪个品牌受影响最大？如何应对？"
      },
      "pr_analysis": {
        "narrative": "品牌叙事：这个动作在讲什么故事？强化了什么品牌形象？",
        "media_value": "媒体传播价值：哪些媒体会跟进？内容角度是什么？",
        "risk_points": "潜在舆情风险：可能引发什么负面反应？敏感点在哪？",
        "crisis_prep": "危机预案：如果出现舆情，品牌应在什么时间窗口用什么口径回应？"
      },
      "next_move": "基于今天的动作，预判未来2-4周品牌最可能的下一步，以及竞品应该在哪里布防，2-3句",
      "source_url": "原文URL",
      "source_name": "来源媒体",
      "crisis_level": null
    }
  ]
}

规则：
- 中国境内事件占70%以上
- 输出8-10条items，覆盖不同品牌
- 覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重），pr_analysis必须特别详细
- 所有分析字段必须具体，禁止套话
- source_url必须来自搜索结果的真实URL
- 只返回JSON`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ],
      temperature: 0.2,
      max_tokens: 10000
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      timeout: 180000,
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

    console.log('\n🤖 DeepSeek 深度分析（Marketing + PR 双视角）...');
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
    data.date_key = data.date_key || dateKey;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    // ── 写入今日数据（覆盖）
    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });
    console.log('✅ news-data.json 已更新');

    // ── 写入归档（按日期，永久保存）
    const archivePath = path.join('archive', `${dateKey}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
    console.log(`✅ 已归档至 archive/${dateKey}.json`);

    // ── 更新归档索引
    const indexPath = 'archive/index.json';
    let archiveIndex = [];
    if (fs.existsSync(indexPath)) {
      try { archiveIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
    }
    if (!archiveIndex.find(d => d.date_key === dateKey)) {
      archiveIndex.unshift({ date_key: dateKey, updated: today, count: data.items.length });
      // 只保留最近90天
      archiveIndex = archiveIndex.slice(0, 90);
      fs.writeFileSync(indexPath, JSON.stringify(archiveIndex, null, 2), { encoding: 'utf8' });
      console.log(`✅ 归档索引已更新（共 ${archiveIndex.length} 天）`);
    }

    console.log(`\n📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}`);
    });
    console.log('\n✅ 全部完成\n');

  } catch(err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
