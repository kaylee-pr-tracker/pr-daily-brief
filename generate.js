// generate.js — 时尚情报每日抓取脚本
// 架构：SerpAPI → 正文抓取 → DeepSeek 多框架深度分析 + 周期性报告
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
const dayOfWeek = now.getDay(); // 0=周日, 1=周一...
const dayOfMonth = now.getDate();

// 判断是否需要生成周期报告
const isMonday = dayOfWeek === 1;
const isFirstOfMonth = dayOfMonth === 1;
const isFirstOfQuarter = isFirstOfMonth && [1, 4, 7, 10].includes(now.getMonth() + 1);

if (!fs.existsSync('archive')) fs.mkdirSync('archive');

// ── 抓取文章正文 ──────────────────────────────────────────────
function fetchArticle(url, maxChars = 2000) {
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
          'Accept': 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9'
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
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
          resolve([...(data.organic_results || []), ...(data.news_results || [])]
            .slice(0, 6).map(r => ({
              title: r.title || '', url: r.link || '',
              snippet: (r.snippet || '').slice(0, 400),
              date: r.date || '', source: r.displayed_link || r.source || ''
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
async function gatherIntel() {
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
    { q: 'luxury brand China consumer behavior trend 2026', label: '消费趋势' },
    { q: 'LVMH Chanel Hermes Gucci China strategy 2026', label: '奢品集团' },
  ];

  // 如果是周一，额外搜索周度趋势数据
  if (isMonday) {
    queries.push(
      { q: '时尚行业 中国市场 本周 趋势 消费', label: '周度趋势' },
      { q: 'luxury China weekly market trend consumer', label: '周度市场' }
    );
  }

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

  console.log(`\n📥 共 ${unique.length} 条，抓取文章正文...\n`);
  const withContent = await Promise.all(
    unique.slice(0, 30).map(async (r, i) => {
      await new Promise(res => setTimeout(res, i * 100));
      const body = await fetchArticle(r.url);
      if (body) console.log(`  ✓ [${i+1}] ${r.source} — ${r.title.slice(0,35)}...`);
      return { ...r, body };
    })
  );
  return [...withContent, ...unique.slice(30).map(r => ({ ...r, body: '' }))];
}

// ── DeepSeek Pass 1：生成精简情报列表 ─────────────────────────
function callDeepSeekPass1(articles) {
  const contextText = articles.slice(0, 35).map((r, i) => {
    const content = r.body ? r.body.slice(0, 600) : r.snippet;
    return `[${i+1}]【${r.queryLabel}】${r.title}\n📅 ${r.date||'近期'} | ${r.source}\n🔗 ${r.url}\n${content}`;
  }).join('\n\n---\n\n');

  const USER = `今天是${today}。

以下是今日最新时尚行业资讯：

${contextText}

---

请输出精简的每日情报JSON，每条情报只包含核心事实，不需要深度分析字段。
category只能用：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻

{
  "updated": "${today}",
  "date_key": "${dateKey}",
  "trend_forecast": [
    {"title": "8字内标题", "horizon": "近期 · 1–4周", "summary": "含具体品牌+事件+数据2-3句", "signals": ["信号1","信号2","信号3"]},
    {"title": "8字内标题", "horizon": "中期 · 1–3个月", "summary": "2-3句", "signals": ["信号1","信号2","信号3"]},
    {"title": "8字内标题", "horizon": "长期 · 季度级", "summary": "2-3句", "signals": ["信号1","信号2","信号3"]}
  ],
  "items": [
    {
      "title": "品牌+具体事件15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "3-4句具体事实：产品名、城市、数据、涉及人物",
      "facts": [
        {"label": "产品/活动", "value": "具体名称"},
        {"label": "地点/平台", "value": "具体地点"},
        {"label": "数据", "value": "具体数字"},
        {"label": "核心差异", "value": "区别说明"}
      ],
      "source_url": "原文URL",
      "source_name": "媒体名称",
      "crisis_level": null
    }
  ]
}

输出6-8条items，覆盖不同品牌和5个category，危机舆情填crisis_level。只返回JSON。`;

  return callDS(USER, 5000, '生成精简情报列表');
}

// ── DeepSeek Pass 2：逐条深度分析 ───────────────────────────
async function callDeepSeekPass2(items, articles) {
  const contextSummary = articles.slice(0, 20).map(r =>
    `${r.title} | ${r.source} | ${r.url}`
  ).join('\n');

  const itemsText = items.map((item, i) =>
    `[${i+1}] ${item.brand} — ${item.title}\n${item.summary}`
  ).join('\n\n');

  const USER = `今天是${today}。

以下是今日时尚情报条目（已从搜索结果中提取）：

${itemsText}

搜索来源参考：
${contextSummary}

---

请为以上每条情报生成深度分析，输出JSON数组（数组长度与输入条目数相同，顺序一致）：

[
  {
    "consumer_analysis": {
      "primary_target": "核心目标消费群体，具体到年龄/消费力/心理特征",
      "z_gen_reaction": "Z世代（95后）预期反应：共鸣还是反感？有无文化错位风险？要客观，不能一刀切",
      "hnw_reaction": "高净值人群：强化还是稀释品牌稀缺感？具体说明",
      "new_middle_reaction": "新中产：消费升降级语境下的解读，影响购买意愿如何？",
      "unmet_needs": "被忽视的消费者需求：哪个群体被这个动作忽视了？"
    },
    "marketing_analysis": {
      "4p_focus": "主要在4P哪个维度发力（Product/Price/Place/Promotion）及原因",
      "strategy": "创意策略和营销逻辑，与品牌长期策略的关系",
      "channel_logic": "渠道选择逻辑和预算重心判断",
      "roi_measure": "效果衡量框架和关键指标",
      "cross_category_threat": "跨品类竞争：非直接竞品中谁在抢同一批消费者"
    },
    "pr_analysis": {
      "narrative_built": "品牌叙事：强化什么故事？与受众价值观是否真正契合还是表面迎合？",
      "race_model": {
        "reach": "触达：覆盖哪些媒体圈层？盲点在哪？",
        "act": "行动：引导什么具体行动？转化路径是否清晰？",
        "convert": "转化：从关注到购买的关键障碍是什么？",
        "engage": "互动：长期用户关系维护机制是否存在？"
      },
      "risk_assessment": "舆情风险：2-3个具体风险点及触发条件",
      "crisis_protocol": "危机预案：T+0/T+6/T+24小时各应做什么，用什么口径"
    },
    "next_move": "预判品牌未来2-4周下一步，竞品应在哪里布防，2-3句"
  }
]

分析要客观平衡，区分三类人群，指出优势也要指出矛盾和风险。只返回JSON数组。`;

  return callDS(USER, 6000, '深度分析');
}

// ── DeepSeek 通用调用 ─────────────────────────────────────────
function callDS(userPrompt, maxTokens, label) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是奢侈品行业顶级市场顾问，精通消费者心理学、4P营销、PESTEL宏观分析和PR RACE模型。分析客观平衡，区分Z世代/高净值/新中产三类人群，指出优势也指出风险。严禁套话。只输出JSON。'
        },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: maxTokens
    });

    console.log(`  → DeepSeek [${label}] max_tokens=${maxTokens}...`);

    const req = require('https').request({
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
          if (parsed.error) { reject(new Error(`DeepSeek[${label}]: ${JSON.stringify(parsed.error)}`)); return; }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) { reject(new Error(`[${label}] 返回空内容`)); return; }
          resolve(text);
        } catch(e) { reject(new Error(`[${label}] 解析失败: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

// ── DeepSeek 周期性趋势报告 ───────────────────────────────────
function callDeepSeekPeriodic(articles, period) {
  const periodLabel = { weekly: '本周', monthly: '本月', quarterly: '本季度' }[period];
  const contextText = articles.slice(0, 30).map((r, i) =>
    `[${i+1}] ${r.title} | ${r.date||'近期'} | ${r.source}\n${r.snippet}`
  ).join('\n\n');

  const USER = `今天是${today}，请基于以下近期资讯，生成${periodLabel}时尚行业综合趋势报告。

资讯背景：
${contextText}

---

输出${periodLabel}趋势报告JSON（只返回JSON）：

{
  "period": "${period}",
  "period_label": "${periodLabel}",
  "generated_at": "${today}",
  "executive_summary": "高管摘要：${periodLabel}最重要的3件事，每件事一句话，直接说结论",
  "pestel_scan": {
    "political": "政治/政策层面：影响中国时尚行业的政策动向，如关税、进口政策、平台监管等",
    "economic": "经济层面：消费信心、奢品销售数据、汇率对定价的影响、高净值人群财富变化",
    "social": "社会文化层面：消费观念变化、审美趋势、代际差异、身份认同的演变",
    "technological": "技术层面：AI在营销中的应用、直播电商、虚拟试衣、数字藏品等新技术的影响",
    "environmental": "环境/可持续层面：ESG压力、消费者对可持续奢品的真实态度（不是表态而是行为）",
    "legal": "法律/合规层面：广告法、代言人监管、数据隐私对营销的约束"
  },
  "consumer_psychology_report": {
    "z_gen_profile": {
      "core_desire": "Z世代核心消费欲望：他们真正想要什么，而不是品牌以为他们想要什么",
      "identity_logic": "身份认同逻辑：奢品/时尚在他们的自我表达中扮演什么角色",
      "pain_points": "被忽视的痛点：品牌普遍没做好的地方",
      "emerging_behavior": "新兴消费行为：本周期内观察到的新变化"
    },
    "hnw_profile": {
      "core_desire": "高净值人群核心需求：在经济不确定背景下，他们的购买逻辑如何变化",
      "scarcity_sensitivity": "稀缺性敏感度：他们如何判断一个品牌是否还值得作为身份标签",
      "channel_preference": "渠道偏好变化：线下旗舰店 vs 私域 vs 限定活动",
      "emerging_behavior": "本周期新变化"
    },
    "new_middle_profile": {
      "core_desire": "新中产核心矛盾：想要奢品的身份感但面临消费压力，他们如何取舍",
      "affordable_luxury_logic": "轻奢逻辑：哪些品类是他们的「入门票」，哪些已经超出心理价位",
      "social_proof_need": "社交证明需求：他们需要什么样的内容来justify自己的消费决定",
      "emerging_behavior": "本周期新变化"
    }
  },
  "social_ecosystem_report": {
    "xiaohongshu": "小红书：本周期平台算法/内容生态变化，哪类时尚内容在涨，哪类在跌",
    "douyin": "抖音：直播电商动态，品牌自播 vs KOL带货的格局变化",
    "weibo": "微博：时尚话题的舆情特征，哪些类型的事件容易上热搜",
    "wechat": "微信：私域运营趋势，品牌如何通过企业微信做高净值客户管理",
    "overall_shift": "整体生态位移：内容消费重心在向哪里移动，品牌内容预算应如何重新分配"
  },
  "market_share_dynamics": {
    "rising_brands": "上升势头品牌：本周期声量/热度明显上升的品牌及原因",
    "declining_brands": "下滑信号品牌：有衰退迹象的品牌及潜在原因",
    "positioning_shift": "定位位移：有品牌在悄悄改变目标人群或价格定位吗？",
    "cross_category_competition": "跨品类竞争：哪些非时尚品类正在蚕食时尚品牌的消费份额和心智"
  },
  "actionable_recommendations": [
    {
      "audience": "针对奢品牌市场团队",
      "priority": "高",
      "action": "具体可执行的建议，包括时间节点和衡量标准"
    },
    {
      "audience": "针对国货新锐品牌",
      "priority": "高",
      "action": "具体建议"
    },
    {
      "audience": "针对PR/传播团队",
      "priority": "中",
      "action": "具体建议"
    }
  ]
}`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是一位顶级时尚行业战略顾问，专注于消费者行为研究和品牌传播。你的报告以客观平衡、洞察深刻著称，从不给出片面或粉饰的结论。只输出JSON。'
        },
        { role: 'user', content: USER }
      ],
      temperature: 0.3,
      max_tokens: 8000
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

// ── JSON 解析工具（带截断修复）────────────────────────────────
function cleanJSON(str) {
  // 清理字符串值内的非法控制字符（换行、制表等）
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
      // 替换非法控制字符
      if (code === 0x0A) { result += '\\n'; }
      else if (code === 0x0D) { result += '\\r'; }
      else if (code === 0x09) { result += '\\t'; }
      // 其他控制字符直接跳过
      continue;
    }
    result += ch;
  }
  return result;
}

function parseJSON(raw) {
  let jsonStr = raw.trim().replace(/^[^{]*/, '');
  const s = jsonStr.indexOf('{');
  if (s === -1) throw new Error('未找到JSON');
  jsonStr = cleanJSON(jsonStr.slice(s));
  try {
    const e = jsonStr.lastIndexOf('}');
    return JSON.parse(jsonStr.slice(0, e + 1));
  } catch(e1) {
    console.log('  ⚠️  JSON不完整，尝试修复...');
    for (let trim = 0; trim < 3000; trim += 5) {
      const candidate = jsonStr.slice(0, jsonStr.length - trim);
      const opens = candidate.split('{').length - 1;
      const closes = candidate.split('}').length - 1;
      const arrOpens = candidate.split('[').length - 1;
      const arrCloses = candidate.split(']').length - 1;
      if (opens >= closes && arrOpens >= arrCloses) {
        const fixedStr = candidate + ']'.repeat(arrOpens - arrCloses) + '}'.repeat(opens - closes);
        try { const r = JSON.parse(fixedStr); console.log('  ✅ 修复成功'); return r; } catch {}
      }
    }
    throw new Error('JSON修复失败: ' + e1.message);
  }
}

// ── JSON 数组解析 ────────────────────────────────────────────
function parseJSONArray(raw) {
  let jsonStr = raw.trim().replace(/^[^[{]*/, '');
  // 如果是数组
  if (jsonStr.startsWith('[')) {
    try { return JSON.parse(jsonStr.slice(0, jsonStr.lastIndexOf(']') + 1)); } catch {}
  }
  // 如果包在对象里
  const s = jsonStr.indexOf('[');
  const e = jsonStr.lastIndexOf(']');
  if (s !== -1) {
    try { return JSON.parse(jsonStr.slice(s, e + 1)); } catch {}
  }
  return [];
}


// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 时尚情报生成器 — ${today}`);
  console.log(`📅 周${['日','一','二','三','四','五','六'][dayOfWeek]} | 每月第${dayOfMonth}天`);
  if (isMonday) console.log('📊 今日生成周度趋势报告');
  if (isFirstOfMonth) console.log('📊 今日生成月度趋势报告');
  if (isFirstOfQuarter) console.log('📊 今日生成季度趋势报告');
  console.log('');

  try {
    // 1. 搜索
    const articles = await gatherIntel();
    if (articles.length < 3) throw new Error('搜索结果不足');

    // 2. 每日情报 — 两阶段生成
    console.log('\n🤖 Pass 1：生成精简情报列表...');
    const pass1Raw = await callDeepSeekPass1(articles);
    const data = parseJSON(pass1Raw);
    data.updated = data.updated || today;
    data.date_key = dateKey;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    console.log(`\n🤖 Pass 2：深度分析 ${data.items.length} 条情报...`);
    try {
      const pass2Raw = await callDeepSeekPass2(data.items, articles);
      const analyses = parseJSONArray(pass2Raw);
      if (Array.isArray(analyses)) {
        data.items.forEach((item, i) => {
          if (analyses[i]) {
            item.consumer_analysis = analyses[i].consumer_analysis || {};
            item.marketing_analysis = analyses[i].marketing_analysis || {};
            item.pr_analysis = analyses[i].pr_analysis || {};
            item.next_move = analyses[i].next_move || '';
          }
        });
        console.log('✅ 深度分析合并完成');
      }
    } catch(e2) {
      console.log(`⚠️ 深度分析失败，使用基础情报: ${e2.message}`);
    }

    // 3. 周期性报告
    const periodicReports = {};

    if (isMonday) {
      console.log('\n📊 生成周度趋势报告...');
      try {
        const weeklyRaw = await callDeepSeekPeriodic(articles, 'weekly');
        periodicReports.weekly = parseJSON(weeklyRaw);
        console.log('✅ 周度报告完成');
      } catch(e) { console.log(`⚠️ 周度报告失败: ${e.message}`); }
    }

    if (isFirstOfMonth) {
      console.log('\n📊 生成月度趋势报告...');
      try {
        const monthlyRaw = await callDeepSeekPeriodic(articles, 'monthly');
        periodicReports.monthly = parseJSON(monthlyRaw);
        // 保存月度报告
        fs.writeFileSync(
          path.join('archive', `monthly-${dateKey.slice(0,7)}.json`),
          JSON.stringify(periodicReports.monthly, null, 2), { encoding: 'utf8' }
        );
        console.log('✅ 月度报告完成');
      } catch(e) { console.log(`⚠️ 月度报告失败: ${e.message}`); }
    }

    if (isFirstOfQuarter) {
      console.log('\n📊 生成季度趋势报告...');
      try {
        const quarterlyRaw = await callDeepSeekPeriodic(articles, 'quarterly');
        periodicReports.quarterly = parseJSON(quarterlyRaw);
        fs.writeFileSync(
          path.join('archive', `quarterly-${dateKey.slice(0,7)}.json`),
          JSON.stringify(periodicReports.quarterly, null, 2), { encoding: 'utf8' }
        );
        console.log('✅ 季度报告完成');
      } catch(e) { console.log(`⚠️ 季度报告失败: ${e.message}`); }
    }

    // 合并周期报告到每日数据
    if (Object.keys(periodicReports).length > 0) {
      data.periodic_reports = periodicReports;
    }

    // 4. 写入文件
    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });

    const archivePath = path.join('archive', `${dateKey}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });

    // 更新归档索引
    const indexPath = 'archive/index.json';
    let archiveIndex = [];
    if (fs.existsSync(indexPath)) {
      try { archiveIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
    }
    if (!archiveIndex.find(d => d.date_key === dateKey)) {
      archiveIndex.unshift({
        date_key: dateKey, updated: today,
        count: data.items.length,
        has_weekly: !!periodicReports.weekly,
        has_monthly: !!periodicReports.monthly,
        has_quarterly: !!periodicReports.quarterly
      });
      archiveIndex = archiveIndex.slice(0, 90);
      fs.writeFileSync(indexPath, JSON.stringify(archiveIndex, null, 2), { encoding: 'utf8' });
    }

    console.log(`\n✅ 完成`);
    console.log(`📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条`);
    data.items.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}`);
    });
    console.log('');

  } catch(err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
