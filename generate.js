// generate.js — 时尚情报每日抓取脚本（Groq + 联网搜索版）
// 运行：node generate.js
// 依赖环境变量：GROQ_API_KEY

const fs = require('fs');
const https = require('https');
const http = require('http');

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) { console.error('❌ 缺少 GROQ_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// ── 第一步：用 DuckDuckGo 搜索最新新闻标题 ──────────────────────
function searchNews(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const options = {
      hostname: 'api.duckduckgo.com',
      path: `/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 FashionIntelBot/1.0' }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const results = (data.RelatedTopics || [])
            .filter(t => t.Text && t.FirstURL)
            .slice(0, 3)
            .map(t => ({ title: t.Text.slice(0, 120), url: t.FirstURL }));
          resolve(results);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// ── 第二步：搜索多个品牌关键词，拼接成背景资料 ────────────────────
async function gatherContext() {
  const queries = [
    'luxury fashion brand campaign China 2025 2026',
    'LVMH Gucci Chanel Hermes China marketing 2026',
    '观夏 山下有松 国货香氛 营销 2026',
    'luxury brand crisis PR China social media 2026',
    'fashion retail China Xiaohongshu Douyin KOL 2026'
  ];

  console.log('🌐 正在搜索最新资讯背景...');
  const allResults = [];
  for (const q of queries) {
    const results = await searchNews(q);
    allResults.push(...results);
    await new Promise(r => setTimeout(r, 300));
  }

  // 去重
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`  找到 ${unique.length} 条背景资讯`);
  return unique;
}

// ── 第三步：调用 Groq 生成结构化情报 ────────────────────────────
function callGroq(contextSnippets) {
  const contextText = contextSnippets.length > 0
    ? `\n\n以下是今日搜索到的相关资讯背景（供参考，结合你的知识库综合分析）：\n${contextSnippets.map((r, i) => `[${i+1}] ${r.title}\n来源: ${r.url}`).join('\n\n')}`
    : '';

  const SYSTEM = `你是一位顶级时尚行业市场情报分析师，有15年奢侈品营销经验。你的分析以具体、专业、有洞察力著称。

关键要求：
1. 每条情报必须极度具体——品牌做了什么具体的事？哪个系列/产品/活动？在哪个城市/平台？邀请了哪些人？数据是多少？不能模糊带过。
2. market_signal必须是真正的市场洞察——这个动作背后的战略意图是什么？对竞品意味着什么具体威胁或机会？给出可操作的建议。
3. 拒绝套话——「品牌影响力」「消费者认知」「市场份额」这类空话一律不用。
4. 只返回JSON，无任何额外文字。`;

  const USER = `今天是${today}。${contextText}

请结合以上背景资讯和你的知识库，生成时尚行业竞品情报简报。

重点覆盖品牌：Louis Vuitton、Dior、Chanel、Hermès、Gucci、Loewe、Bottega Veneta、Cartier、积家、宝格丽、观夏、山下有松、气味图书馆

严格按此JSON格式输出（第一个字符{，最后一个字符}，无markdown）：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "趋势标题8字内",
      "horizon": "近期 · 1–4周",
      "summary": "必须包含：具体品牌名+具体动作+可量化数据或时间节点，2-3句",
      "signals": ["具体信号1", "具体信号2", "具体信号3"]
    },
    {
      "title": "趋势标题8字内",
      "horizon": "中期 · 1–3个月",
      "summary": "必须包含：具体品牌名+具体动作+可量化数据或时间节点，2-3句",
      "signals": ["具体信号1", "具体信号2", "具体信号3"]
    },
    {
      "title": "趋势标题8字内",
      "horizon": "长期 · 季度级",
      "summary": "必须包含：具体品牌名+具体动作+可量化数据或时间节点，2-3句",
      "signals": ["具体信号1", "具体信号2", "具体信号3"]
    }
  ],
  "items": [
    {
      "title": "情报标题：品牌+具体事件，15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期如2026年5月",
      "summary": "必须回答：做了什么具体的事？什么产品/系列？在哪个城市/平台？邀请了谁参与？规模多大？品牌意图是什么？3-4句，禁止模糊表达",
      "facts": [
        {"label": "产品/活动", "value": "具体产品线名称或活动名称"},
        {"label": "地点/平台", "value": "具体城市、门店或平台名称"},
        {"label": "规模/数据", "value": "具体数字，如曝光量、参与人数、销售数据"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体不同之处"}
      ],
      "market_signal": "必须包含：①这个动作的战略意图（一句话）②对竞品的具体威胁或机会（一句话）③给市场人的可操作建议（一句话）",
      "source_url": "如有真实来源URL填入，否则填null",
      "source_name": "来源媒体名，如WWD、华丽志、Vogue Business、SocialBeta等",
      "crisis_level": null
    }
  ]
}

输出8-10条items，每条必须涉及不同品牌，覆盖所有5个category。危机舆情类填crisis_level（轻微/中度/严重）。`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ],
      temperature: 0.6,
      max_tokens: 6000
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        // 用 Buffer 拼接解决编码问题
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error(`API错误: ${parsed.error.message}`));
            return;
          }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) {
            reject(new Error(`返回空内容，响应: ${raw.slice(0, 400)}`));
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

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 开始生成 ${today} 时尚情报...\n`);
  try {
    // 1. 搜索背景资讯
    const context = await gatherContext();

    // 2. 调用 Groq 生成情报
    console.log('\n🤖 调用 Groq 生成结构化情报...');
    const raw = await callGroq(context);
    console.log('✅ API 调用成功，开始解析...');

    // 3. 解析 JSON（处理可能的 markdown 包装）
    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON\n原始输出:\n${raw.slice(0, 600)}`);
    jsonStr = jsonStr.slice(start, end + 1);

    const data = JSON.parse(jsonStr);
    data.updated = data.updated || today;
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    // 4. 为没有 source_url 的条目，尝试匹配搜索到的链接
    data.items.forEach(item => {
      if (!item.source_url && context.length > 0) {
        const match = context.find(c =>
          c.title.toLowerCase().includes(item.brand.toLowerCase().split(' ')[0]) ||
          (item.brand.includes('观夏') && c.title.includes('summer')) ||
          (item.brand.includes('Chanel') && c.title.toLowerCase().includes('chanel'))
        );
        if (match) {
          item.source_url = match.url;
          item.source_name = item.source_name || 'DuckDuckGo News';
        }
      }
    });

    // 5. 写入文件（强制 UTF-8）
    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });

    console.log(`\n📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      const src = item.source_url ? ` → ${item.source_name}` : '';
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}${src}`);
    });
    console.log('\n✅ news-data.json 写入完成\n');

  } catch (err) {
    console.error('❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
