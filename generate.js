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

// ── DeepSeek 每日情报分析 ─────────────────────────────────────
function callDeepSeekDaily(articles) {
  const contextText = articles.slice(0, 40).map((r, i) => {
    const content = r.body ? `正文：${r.body.slice(0, 1000)}` : `摘要：${r.snippet}`;
    return `[${i+1}]【${r.queryLabel}】${r.title}\n📅 ${r.date||'近期'} | ${r.source}\n🔗 ${r.url}\n${content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是一位同时精通 Marketing 和 PR 的奢侈品行业资深顾问，拥有消费者心理学、宏观经济分析和危机公关的深厚背景。

你的分析必须做到：
1. 站在消费者视角：区分Z世代（95后）、高净值人群（HNW）、新中产三类群体的不同心理动机和反应，而非笼统概括
2. 综合多个框架：4P营销组合 + PESTEL宏观背景 + PR的RACE模型 + 消费者情感/身份认同理论
3. 客观平衡：指出品牌动作的优势，也要指出潜在的矛盾、风险和未被满足的需求
4. 跨品类比较：当前事件在整个时尚生态中的位置，而非孤立分析
5. 严禁一刀切的评论，每个分析结论都要有具体的人群细分和情境说明

只输出JSON，第一个字符{，最后字符}。`;

  const USER = `今天是${today}。

以下是今日最新时尚行业资讯：

${contextText}

---

输出每日情报简报JSON，分析必须系统深入，覆盖消费者心理、多个框架维度、客观平衡评价：

{
  "updated": "${today}",
  "date_key": "${dateKey}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "含具体品牌+事件+数据，2-3句，禁止套话",
      "signals": ["具体可观测信号", "具体信号", "具体信号"],
      "consumer_psychology": {
        "z_gen": "Z世代（95后）对这个趋势的心理反应：动机/情感/身份认同层面的具体分析，包括正面共鸣和潜在排斥",
        "hnw": "高净值人群（HNW）的反应：他们的核心需求是什么？这个趋势满足还是威胁了他们的身份认同？",
        "new_middle": "新中产群体的反应：消费升级还是降级的语境下，他们如何解读这个趋势？"
      },
      "pestel_context": "这个趋势背后的宏观PESTEL驱动力：是政策变化、经济压力、社会文化转型、还是技术驱动？2-3句，要有具体背景",
      "marketing_implication": "对Marketing策略的影响：4P哪个维度最受冲击？品牌应该如何调整？给出具体可操作的方向",
      "pr_implication": "对PR传播的影响：品牌叙事应该如何响应这个趋势？潜在舆情风险点在哪里？"
    },
    {
      "title": "中期趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "2-3句",
      "signals": ["信号1", "信号2", "信号3"],
      "consumer_psychology": {"z_gen": "", "hnw": "", "new_middle": ""},
      "pestel_context": "",
      "marketing_implication": "",
      "pr_implication": ""
    },
    {
      "title": "长期趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "2-3句",
      "signals": ["信号1", "信号2", "信号3"],
      "consumer_psychology": {"z_gen": "", "hnw": "", "new_middle": ""},
      "pestel_context": "",
      "marketing_implication": "",
      "pr_implication": ""
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期",
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些人？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "具体名称"},
        {"label": "地点/平台", "value": "具体地点或平台"},
        {"label": "数据", "value": "具体数字"},
        {"label": "核心差异", "value": "与以往或竞品的区别"}
      ],
      "consumer_analysis": {
        "primary_target": "这次动作的核心目标消费群体，要具体到年龄/消费力/心理特征",
        "z_gen_reaction": "Z世代的预期反应：会产生共鸣还是反感？为什么？有没有潜在的文化错位风险？",
        "hnw_reaction": "高净值人群的预期反应：这个动作强化还是稀释了品牌的稀缺感和身份标签？",
        "new_middle_reaction": "新中产的预期反应：对于「够不着又想要」的这个群体，这个动作如何影响他们的品牌印象和购买意愿？",
        "unmet_needs": "这个动作没有覆盖到的消费者需求：哪个群体的需求被忽视了？这是机会还是风险？"
      },
      "marketing_analysis": {
        "4p_focus": "这次动作主要在4P哪个维度发力（Product/Price/Place/Promotion），为什么选择这个维度",
        "strategy": "创意策略：背后的营销逻辑，与品牌长期策略的关系",
        "channel_logic": "渠道选择逻辑：为什么选这个平台/渠道？预算分配重心判断",
        "roi_measure": "效果衡量框架：关键指标是什么？短期和长期指标如何平衡？",
        "cross_category_threat": "跨品类威胁：除了直接竞品，哪些看似无关的品牌或品类正在抢夺同一批消费者？"
      },
      "pr_analysis": {
        "narrative_built": "品牌叙事：这个动作在强化什么故事？这个故事与目标受众的价值观是否真正契合，还是存在表面迎合的风险？",
        "race_model": {
          "reach": "触达：这次传播能触达哪些媒体圈层和人群？覆盖面的盲点在哪里？",
          "act": "行动：引导受众做出什么具体行动？转化路径是否清晰？",
          "convert": "转化：从关注到购买的关键障碍是什么？品牌如何设计了转化路径？",
          "engage": "互动：如何维持长期用户关系？有没有设计持续互动的机制？"
        },
        "risk_assessment": "舆情风险评估：列出2-3个具体的潜在风险点，以及每个风险点触发的条件",
        "crisis_protocol": "危机处置预案：如果最大风险点爆发，品牌应在什么时间窗口（T+0/T+6/T+24小时）用什么核心口径响应？"
      },
      "next_move": "基于今天的动作，预判该品牌未来2-4周最可能的下一步，竞品应在哪里布防，2-3句",
      "source_url": "原文URL",
      "source_name": "来源媒体",
      "crisis_level": null
    }
  ]
}

规则：
- 中国境内事件占70%以上，输出8-10条items，覆盖不同品牌
- 覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情类填crisis_level（轻微/中度/严重），pr_analysis.crisis_protocol必须详细
- 所有consumer_analysis字段必须区分三类人群，不能笼统概括
- 分析要客观平衡，指出优势也要指出矛盾和风险
- source_url必须来自搜索结果真实URL
- 只返回JSON`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
      temperature: 0.2,
      max_tokens: 12000
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

// ── JSON 解析工具 ─────────────────────────────────────────────
function parseJSON(raw) {
  let jsonStr = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const s = jsonStr.indexOf('{');
  const e = jsonStr.lastIndexOf('}');
  if (s === -1) throw new Error(`未找到JSON\n原始:\n${raw.slice(0, 500)}`);
  return JSON.parse(jsonStr.slice(s, e + 1));
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

    // 2. 每日情报
    console.log('\n🤖 DeepSeek 生成每日情报（多框架深度分析）...');
    const dailyRaw = await callDeepSeekDaily(articles);
    const data = parseJSON(dailyRaw);
    data.updated = data.updated || today;
    data.date_key = dateKey;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

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
