// generate.js — 时尚情报每日抓取脚本
// 架构：直接抓取中国时尚媒体 RSS/网页 → DeepSeek 分析
// 依赖环境变量：DS_API_KEY
// （不再依赖 Tavily，改为直接抓取国内媒体源）

const fs = require('fs');
const https = require('https');
const http = require('http');

const DS_KEY = process.env.DS_API_KEY;
if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }

const now = new Date();
const today = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const CUTOFF = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7天

// ── 媒体 RSS 源配置 ───────────────────────────────────────────
const RSS_SOURCES = [
  {
    name: '华丽志',
    url: 'https://www.hualizhi.com/feed',
    protocol: 'https'
  },
  {
    name: 'SocialBeta',
    url: 'https://socialbeta.com/feed',
    protocol: 'https'
  },
  {
    name: 'WWD中文',
    url: 'https://wwd-china.com/feed',
    protocol: 'https'
  },
  {
    name: '界面时尚',
    url: 'https://www.jiemian.com/lists/columns-77.rss',
    protocol: 'https'
  },
  {
    name: 'Vogue Business',
    url: 'https://www.voguebusiness.com/feed',
    protocol: 'https'
  },
  {
    name: 'Business of Fashion',
    url: 'https://www.businessoffashion.com/feed/',
    protocol: 'https'
  },
  {
    name: 'Jing Daily',
    url: 'https://jingdaily.com/feed/',
    protocol: 'https'
  },
  {
    name: '时尚头条',
    url: 'https://www.fashionchinaagency.com/feed',
    protocol: 'https'
  }
];

// ── HTTP/HTTPS 请求封装 ───────────────────────────────────────
function fetchUrl(urlStr, maxRedirects = 3) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const lib = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FashionIntelBot/2.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Encoding': 'identity'
        }
      };

      const req = lib.request(options, (res) => {
        // 处理重定向
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          return resolve(fetchUrl(res.headers.location, maxRedirects - 1));
        }

        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: Buffer.concat(chunks).toString('utf8')
          });
        });
      });

      req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, text: '' }); });
      req.on('error', () => resolve({ ok: false, text: '' }));
      req.end();
    } catch(e) {
      resolve({ ok: false, text: '' });
    }
  });
}

// ── RSS XML 解析 ──────────────────────────────────────────────
function parseRSS(xml, sourceName) {
  const items = [];
  try {
    // 提取所有 <item> 块
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];

      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s) ||
                     block.match(/<title>(.*?)<\/title>/s) || [])[1] || '';

      const link = (block.match(/<link>(.*?)<\/link>/s) ||
                    block.match(/<guid>(.*?)<\/guid>/s) || [])[1] || '';

      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/s) ||
                       block.match(/<published>(.*?)<\/published>/s) ||
                       block.match(/<dc:date>(.*?)<\/dc:date>/s) || [])[1] || '';

      const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/s) ||
                    block.match(/<description>([\s\S]*?)<\/description>/s) || [])[1] || '';

      // 清理 HTML 标签
      const cleanDesc = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
      const cleanLink = link.replace(/<[^>]+>/g, '').trim();

      if (!cleanTitle || !cleanLink) continue;

      // 时效过滤
      if (pubDate) {
        const d = new Date(pubDate);
        if (!isNaN(d.getTime()) && d < CUTOFF) continue; // 跳过7天前的
      }

      items.push({
        title: cleanTitle,
        url: cleanLink,
        content: cleanDesc,
        published_date: pubDate,
        source: sourceName
      });
    }
  } catch(e) {}
  return items;
}

// ── 抓取所有 RSS 源 ───────────────────────────────────────────
async function fetchAllRSS() {
  console.log('📡 直接抓取中国时尚媒体 RSS...\n');
  const allItems = [];

  await Promise.all(RSS_SOURCES.map(async (source) => {
    const res = await fetchUrl(source.url);
    if (!res.ok || !res.text) {
      console.log(`  ✗ ${source.name} — 无法访问`);
      return;
    }

    const items = parseRSS(res.text, source.name);
    if (items.length > 0) {
      console.log(`  ✓ ${source.name} — ${items.length} 条近期资讯`);
      allItems.push(...items);
    } else {
      console.log(`  ✗ ${source.name} — 解析失败或无近期内容`);
    }
  }));

  // 去重
  const seen = new Set();
  const unique = allItems.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // 按日期排序（最新在前）
  unique.sort((a, b) => {
    const da = new Date(a.published_date || 0);
    const db = new Date(b.published_date || 0);
    return db - da;
  });

  console.log(`\n📥 共获取 ${unique.length} 条有效近期资讯`);

  // 来源统计
  const counts = {};
  unique.forEach(r => counts[r.source] = (counts[r.source] || 0) + 1);
  console.log(`📰 来源：${Object.entries(counts).map(([k,v])=>`${k}(${v})`).join(' · ')}\n`);

  return unique;
}

// ── DeepSeek 分析 ─────────────────────────────────────────────
function callDeepSeek(articles) {
  const contextText = articles.slice(0, 50).map((r, i) => {
    const dateStr = r.published_date
      ? new Date(r.published_date).toLocaleDateString('zh-CN')
      : '日期未知';
    return `[${i+1}] 【${r.source}】${r.title}\n📅 ${dateStr} | 🔗 ${r.url}\n${r.content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师，曾供职于LVMH集团战略部。

核心原则：
1. 只基于提供的真实文章内容生成情报，严禁编造
2. 每条情报必须极度具体：产品系列全名、具体城市/门店/平台名称、真实数字、涉及人物姓名
3. market_signal三层：①战略意图 ②竞品影响 ③可操作建议
4. 严禁套话，只输出JSON`;

  const USER = `今天是${today}。

以下是今日从华丽志、SocialBeta、WWD中文、界面时尚等媒体直接抓取的最新文章（均为近7天内）：

${contextText}

---

基于以上真实文章，输出时尚行业竞品情报简报JSON：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "基于文章内容，含具体品牌+事件+数据，2-3句，禁止套话",
      "signals": ["可在文章中验证的具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "基于文章内容，含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "基于文章内容，含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "从文章提取的具体日期",
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些人？3-4句，每句有具体事实支撑",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地，或平台名"},
        {"label": "数据", "value": "文章中的具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与以往或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[具体说明] ②竞品影响：[对哪个竞品构成什么影响] ③市场建议：[可立即执行的一条建议]",
      "source_url": "文章原文URL，必须来自上方列表",
      "source_name": "媒体名称",
      "crisis_level": null
    }
  ]
}

规则：
- 输出6-10条items，覆盖不同品牌
- 覆盖5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重）
- source_url必须来自上方文章列表中的真实URL
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
  console.log(`\n🚀 时尚情报生成器 — ${today}\n`);
  try {
    // 1. 直接抓取 RSS
    const articles = await fetchAllRSS();

    if (articles.length < 3) {
      console.log('⚠️  RSS 抓取内容不足，尝试备用方案...');
      // 备用：还是用 Tavily（如果配置了的话）
      throw new Error('RSS 源返回内容不足，请检查网络或 RSS 地址');
    }

    // 2. DeepSeek 分析
    console.log('🤖 DeepSeek 分析中...');
    const raw = await callDeepSeek(articles);
    console.log('✅ 分析完成，解析JSON...');

    // 3. 解析
    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON`);
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
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}`);
      if (item.source_url) console.log(`      └ ${item.source_name} | ${item.source_url}`);
    });
    console.log('\n✅ 完成\n');

  } catch (err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
