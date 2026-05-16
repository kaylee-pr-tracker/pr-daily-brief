// generate.js — 时尚情报每日抓取脚本
// 每日：精简情报（事实+市场信号+下一步预判）
// 每周一：周度趋势报告（消费者行为+PESTEL+市场动态）
// 每月1日：月度报告  /  每季首日：季度报告
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
const dateKey = now.toISOString().slice(0, 10);
const dayOfWeek = now.getDay();
const dayOfMonth = now.getDate();
const isMonday = dayOfWeek === 1;
const isFirstOfMonth = dayOfMonth === 1;
const isFirstOfQuarter = isFirstOfMonth && [1,4,7,10].includes(now.getMonth() + 1);

if (!fs.existsSync('archive')) fs.mkdirSync('archive');

// ── 文章正文抓取 ──────────────────────────────────────────────
function fetchArticle(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET', timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FashionIntelBot/2.0)',
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
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          resolve(clean.slice(0, 1500));
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
      api_key: SERP_KEY, engine: 'google', q: query,
      tbs, num: '6', hl: 'zh-cn', gl: 'cn'
    });
    const req = https.request({
      hostname: 'serpapi.com', path: `/search.json?${params}`,
      method: 'GET', timeout: 15000,
      headers: { 'User-Agent': 'FashionIntelBot/2.0' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (data.error) { resolve([]); return; }
          resolve([...(data.organic_results||[]), ...(data.news_results||[])]
            .slice(0,6).map(r => ({
              title: r.title||'', url: r.link||'',
              snippet: (r.snippet||'').slice(0,400),
              date: r.date||'', source: r.displayed_link||r.source||''
            })));
        } catch { resolve([]); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// ── 多方向搜索 ────────────────────────────────────────────────
async function gatherIntel(extraQueries = []) {
  const queries = [
    { q: '奢侈品 品牌 中国 营销 活动 最新', label: '奢品中国营销' },
    { q: '时尚品牌 代言人 联名 官宣 最新', label: '代言联名' },
    { q: '观夏 山下有松 气味图书馆 新品 营销', label: '国货香氛' },
    { q: '品牌 危机 舆情 时尚 微博 最新', label: '危机舆情' },
    { q: '奢侈品 开店 旗舰店 中国 最新', label: '渠道零售' },
    { q: 'site:hualizhi.com 品牌 营销', label: '华丽志' },
    { q: 'site:socialbeta.com 品牌 案例', label: 'SocialBeta' },
    { q: 'site:jiemian.com 时尚 奢侈品', label: '界面时尚' },
    { q: 'site:cn.concall.com 时尚 奢侈品 品牌', label: 'Concall' },
    { q: 'luxury brand China campaign news latest', label: '国际奢品' },
    { q: 'LVMH Chanel Hermes Gucci China 2026', label: '奢品集团' },
    ...extraQueries
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
    seen.add(r.url); return true;
  });

  console.log(`\n📥 共 ${unique.length} 条，抓取正文...\n`);
  const withContent = await Promise.all(
    unique.slice(0, 25).map(async (r, i) => {
      await new Promise(res => setTimeout(res, i * 80));
      const body = await fetchArticle(r.url);
      if (body) console.log(`  ✓ [${i+1}] ${r.source} — ${r.title.slice(0,35)}...`);
      return { ...r, body };
    })
  );
  return [...withContent, ...unique.slice(25).map(r => ({ ...r, body: '' }))];
}

// ── DeepSeek 通用调用 ─────────────────────────────────────────
function callDS(systemPrompt, userPrompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: maxTokens
    });
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions',
      method: 'POST', timeout: 180000,
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
          if (parsed.error) { reject(new Error(JSON.stringify(parsed.error))); return; }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) { reject(new Error('返回空内容')); return; }
          resolve(text);
        } catch(e) { reject(new Error('解析失败: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

// ── JSON 解析（带控制字符清理和截断修复）────────────────────
function cleanJSON(str) {
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (escape) { result += ch; escape = false; continue; }
    if (ch === '\\') { escape = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && code < 0x20) {
      if (code === 0x0A) result += '\\n';
      else if (code === 0x0D) result += '\\r';
      else if (code === 0x09) result += '\\t';
      continue;
    }
    result += ch;
  }
  return result;
}

function parseJSON(raw, isArray = false) {
  let jsonStr = raw.trim();
  // 去掉 markdown 代码块
  jsonStr = jsonStr.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  // 找到 JSON 起点
  const startChar = isArray ? '[' : '{';
  const s = jsonStr.indexOf(startChar);
  if (s === -1) throw new Error('未找到JSON');
  jsonStr = cleanJSON(jsonStr.slice(s));

  // 直接解析
  try {
    const endChar = isArray ? ']' : '}';
    const e = jsonStr.lastIndexOf(endChar);
    return JSON.parse(jsonStr.slice(0, e + 1));
  } catch(e1) {
    // 截断修复
    console.log('  ⚠️  JSON不完整，修复中...');
    for (let trim = 0; trim < 3000; trim += 10) {
      const candidate = jsonStr.slice(0, jsonStr.length - trim);
      const opens = candidate.split('{').length - 1;
      const closes = candidate.split('}').length - 1;
      const aOpens = candidate.split('[').length - 1;
      const aCloses = candidate.split(']').length - 1;
      if (opens >= closes && aOpens >= aCloses) {
        const fixed = candidate + ']'.repeat(aOpens-aCloses) + '}'.repeat(opens-closes);
        try { const r = JSON.parse(fixed); console.log('  ✅ 修复成功'); return r; } catch {}
      }
    }
    throw new Error('JSON修复失败: ' + e1.message);
  }
}

// ── 每日情报生成 ──────────────────────────────────────────────
function generateDailyIntel(articles) {
  const contextText = articles.slice(0, 35).map((r, i) => {
    const content = r.body ? r.body.slice(0, 800) : r.snippet;
    return `[${i+1}]【${r.queryLabel}】${r.title}\n📅 ${r.date||'近期'} | ${r.source}\n🔗 ${r.url}\n${content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是奢侈品行业市场情报分析师，有15年经验。
每条情报必须极度具体：产品系列全名、具体城市/门店/平台、真实数字、涉及人物姓名。
market_signal三层：①战略意图 ②竞品影响 ③可操作建议。
next_move：预判品牌未来2-4周下一步，竞品应在哪里布防。
严禁套话，只输出JSON。`;

  const USER = `今天是${today}。

以下是今日最新时尚行业资讯：

${contextText}

---

输出每日情报JSON（只返回JSON）：

{
  "updated": "${today}",
  "date_key": "${dateKey}",
  "trend_forecast": [
    {"title": "8字内趋势标题", "horizon": "近期 · 1–4周", "summary": "含具体品牌+事件+数据，2-3句", "signals": ["信号1","信号2","信号3"]},
    {"title": "8字内趋势标题", "horizon": "中期 · 1–3个月", "summary": "2-3句", "signals": ["信号1","信号2","信号3"]},
    {"title": "8字内趋势标题", "horizon": "长期 · 季度级", "summary": "2-3句", "signals": ["信号1","信号2","信号3"]}
  ],
  "items": [
    {
      "title": "品牌+具体事件15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "3-4句：产品系列名、城市/平台、数据、涉及人物、品牌意图",
      "facts": [
        {"label": "产品/活动", "value": "具体名称"},
        {"label": "地点/平台", "value": "具体地点或平台"},
        {"label": "数据", "value": "具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与以往或竞品的区别"}
      ],
      "market_signal": "①战略意图：[说明] ②竞品影响：[具体品牌受何影响] ③市场建议：[可执行建议]",
      "next_move": "预判品牌未来2-4周下一步，竞品应在哪里布防，2-3句",
      "source_url": "原文URL",
      "source_name": "来源媒体",
      "crisis_level": null
    }
  ]
}

规则：中国境内事件占70%以上，输出6-8条items，覆盖不同品牌，覆盖5个category（营销动作/社媒声量/渠道零售/危机舆情/趋势前瞻），危机舆情填crisis_level（轻微/中度/严重）。只返回JSON。`;

  return callDS(SYSTEM, USER, 6000);
}

// ── 周期性趋势报告 ────────────────────────────────────────────
function generatePeriodicReport(articles, period) {
  const label = { weekly:'本周', monthly:'本月', quarterly:'本季度' }[period];

  const contextText = articles.slice(0, 25).map((r, i) =>
    `[${i+1}] ${r.title} | ${r.date||'近期'} | ${r.source}\n${r.snippet}`
  ).join('\n\n');

  const SYSTEM = `你是时尚行业战略顾问，专注消费者行为研究和市场传播分析。
报告客观平衡，基于数据和事实，指出机会也指出风险，不做片面美化。只输出JSON。`;

  const USER = `今天是${today}，请生成${label}时尚行业综合趋势报告。

参考资讯：
${contextText}

---

输出${label}趋势报告JSON（只返回JSON）：

{
  "period": "${period}",
  "period_label": "${label}",
  "generated_at": "${today}",

  "executive_summary": "${label}最重要的3个结论，每个一句话，直接说核心发现，不要废话",

  "pestel_scan": {
    "political": "政策层：影响中国时尚行业的政策动向（关税、平台监管、进口政策等）",
    "economic": "经济层：消费信心指数变化、奢品销售趋势、高净值人群财富变化、汇率影响",
    "social": "社会文化层：本周期最显著的消费观念转变、审美趋势、代际消费差异",
    "technological": "技术层：AI营销工具、直播电商、社交平台算法变化对品牌的实际影响",
    "environmental": "ESG层：消费者对可持续奢品的真实行为（不是表态，是实际购买数据）",
    "legal": "合规层：广告法、代言人风险、数据隐私对营销操作的具体约束"
  },

  "consumer_trends": {
    "overall_sentiment": "整体消费情绪：本周期中国奢品/时尚消费者的整体心态，是扩张还是收缩？",
    "z_gen": {
      "key_shift": "Z世代本周期最显著的消费行为变化",
      "what_they_want": "他们真正想要什么（不是品牌以为的，是实际搜索/购买/传播数据显示的）",
      "what_brands_miss": "品牌普遍忽视的Z世代需求",
      "platform_preference": "他们在哪个平台消费内容，偏好什么形式"
    },
    "hnw": {
      "key_shift": "高净值人群本周期行为变化",
      "scarcity_logic": "他们如何判断一个品牌是否还值得作为身份标签，标准在变吗",
      "channel_preference": "线下旗舰 vs 私域 vs 限定活动，他们的渠道偏好如何演变",
      "trust_drivers": "什么在驱动他们的购买决策，价格透明度/工艺叙事/文化资本？"
    },
    "new_middle": {
      "key_shift": "新中产本周期行为变化",
      "affordable_luxury": "哪些品类是他们的「入场券」，哪些已超出心理价位",
      "value_logic": "在消费压力下，他们如何重新定义「值得买」",
      "social_proof": "他们需要什么样的内容来justify自己的消费决定"
    }
  },

  "social_media_ecosystem": {
    "xiaohongshu": "小红书：时尚内容哪类在涨哪类在跌，算法偏好变化，品牌机会点",
    "douyin": "抖音：品牌自播 vs KOL带货格局，什么品类直播ROI在提升",
    "weibo": "微博：时尚话题舆情特征，什么类型事件容易引爆",
    "overall_budget_shift": "综合建议：品牌内容预算在各平台如何重新分配才合理"
  },

  "market_dynamics": {
    "rising_brands": "上升势头：声量/销售/话题度明显提升的品牌及核心原因",
    "under_pressure": "承压品牌：有衰退信号的品牌及潜在原因（客观分析，不是唱衰）",
    "positioning_shifts": "定位位移：哪些品牌在悄悄调整目标人群或价格带",
    "cross_category": "跨品类竞争：非时尚品类在抢夺哪些时尚消费份额，威胁程度如何"
  },

  "actionable_recommendations": [
    {"for": "奢品牌市场团队", "priority": "高", "action": "具体可执行建议，含时间节点"},
    {"for": "国货新锐品牌", "priority": "高", "action": "具体建议"},
    {"for": "PR/传播团队", "priority": "中", "action": "具体建议"}
  ]
}`;

  return callDS(SYSTEM, USER, 6000);
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 时尚情报生成器 — ${today}`);
  console.log(`📅 周${['日','一','二','三','四','五','六'][dayOfWeek]} | 每月第${dayOfMonth}天`);
  if (isMonday) console.log('📊 今日额外生成周度趋势报告');
  if (isFirstOfMonth) console.log('📊 今日额外生成月度趋势报告');
  if (isFirstOfQuarter) console.log('📊 今日额外生成季度趋势报告');
  console.log('');

  try {
    // 1. 搜索
    const extraQueries = isMonday ? [
      { q: '中国奢侈品消费 趋势 本周', label: '周度消费趋势' },
      { q: 'China luxury consumer trend weekly 2026', label: '周度英文趋势' }
    ] : [];
    const articles = await gatherIntel(extraQueries);
    if (articles.length < 3) throw new Error('搜索结果不足');

    // 2. 每日情报
    console.log('\n🤖 生成每日情报...');
    const dailyRaw = await generateDailyIntel(articles);
    const data = parseJSON(dailyRaw);
    data.updated = data.updated || today;
    data.date_key = dateKey;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    // 3. 周期性报告（周/月/季）
    const periodicReports = {};

    if (isMonday) {
      console.log('\n📊 生成周度趋势报告...');
      try {
        const raw = await generatePeriodicReport(articles, 'weekly');
        periodicReports.weekly = parseJSON(raw);
        console.log('✅ 周度报告完成');
      } catch(e) { console.log(`⚠️ 周度报告失败: ${e.message}`); }
    }

    if (isFirstOfMonth) {
      console.log('\n📊 生成月度趋势报告...');
      try {
        const raw = await generatePeriodicReport(articles, 'monthly');
        periodicReports.monthly = parseJSON(raw);
        fs.writeFileSync(path.join('archive', `monthly-${dateKey.slice(0,7)}.json`),
          JSON.stringify(periodicReports.monthly, null, 2), { encoding: 'utf8' });
        console.log('✅ 月度报告完成');
      } catch(e) { console.log(`⚠️ 月度报告失败: ${e.message}`); }
    }

    if (isFirstOfQuarter) {
      console.log('\n📊 生成季度趋势报告...');
      try {
        const raw = await generatePeriodicReport(articles, 'quarterly');
        periodicReports.quarterly = parseJSON(raw);
        fs.writeFileSync(path.join('archive', `quarterly-${dateKey.slice(0,7)}.json`),
          JSON.stringify(periodicReports.quarterly, null, 2), { encoding: 'utf8' });
        console.log('✅ 季度报告完成');
      } catch(e) { console.log(`⚠️ 季度报告失败: ${e.message}`); }
    }

    if (Object.keys(periodicReports).length > 0) {
      data.periodic_reports = periodicReports;
    }

    // 4. 写入文件
    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });
    fs.writeFileSync(path.join('archive', `${dateKey}.json`),
      JSON.stringify(data, null, 2), { encoding: 'utf8' });

    // 更新归档索引
    const indexPath = 'archive/index.json';
    let idx = [];
    if (fs.existsSync(indexPath)) {
      try { idx = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
    }
    if (!idx.find(d => d.date_key === dateKey)) {
      idx.unshift({
        date_key: dateKey, updated: today,
        count: data.items.length,
        has_weekly: !!periodicReports.weekly,
        has_monthly: !!periodicReports.monthly,
        has_quarterly: !!periodicReports.quarterly
      });
      idx = idx.slice(0, 90);
      fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), { encoding: 'utf8' });
    }

    console.log(`\n✅ 完成`);
    console.log(`📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}`);
      if (item.source_url) console.log(`      └ ${item.source_name} | ${item.source_url}`);
    });
    console.log('');

  } catch(err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
