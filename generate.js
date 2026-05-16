// generate.js — 时尚情报每日抓取脚本
// 架构：Tavily 搜索 → 严格日期过滤 → DeepSeek 分析 → 结构化输出
// 依赖环境变量：DS_API_KEY, TAVILY_API_KEY

const fs = require('fs');
const https = require('https');

const DS_KEY = process.env.DS_API_KEY;
const TAVILY_KEY = process.env.TAVILY_API_KEY;

if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }
if (!TAVILY_KEY) { console.error('❌ 缺少 TAVILY_API_KEY'); process.exit(1); }

const now = new Date();
const today = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const CUTOFF_DAYS = 14; // 只保留14天内的内容
const cutoffDate = new Date(now.getTime() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);

// ── 日期解析与过滤 ────────────────────────────────────────────
function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    // 处理各种格式：ISO 8601、"2024-01-15"、"January 15, 2024" 等
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function isRecent(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return true; // 无日期信息的保留，让 DeepSeek 判断
  return d >= cutoffDate;
}

function formatDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '日期不明';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Tavily 搜索 ───────────────────────────────────────────────
function tavilySearch(query, maxResults = 7) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      days: 14,
      include_answer: false,
      include_raw_content: false,
      include_published_date: true
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
            content: (r.content || '').slice(0, 600),
            published_date: r.published_date || '',
            source: (() => {
              try { return new URL(r.url).hostname.replace('www.', ''); }
              catch { return ''; }
            })()
          }));
          resolve(results);
        } catch(e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.write(body, 'utf8');
    req.end();
  });
}

// ── 严格日期过滤 ──────────────────────────────────────────────
function filterByDate(results) {
  const fresh = results.filter(r => isRecent(r.published_date));
  const stale = results.filter(r => !isRecent(r.published_date));

  if (stale.length > 0) {
    console.log(`  ⚠️  过滤掉 ${stale.length} 条过期内容（${CUTOFF_DAYS}天前）:`);
    stale.forEach(r => {
      console.log(`     - [${r.published_date || '无日期'}] ${r.title.slice(0, 50)}`);
    });
  }
  return fresh;
}

// ── 多方向搜索 ────────────────────────────────────────────────
async function gatherIntel() {
  const queries = [
    // 国际奢品最新
    'Louis Vuitton Dior Chanel Hermes new launch campaign this week',
    'Gucci Loewe Bottega Veneta Prada new collection event 2026',
    'luxury brand China marketing news latest',

    // 腕表珠宝
    'Cartier Bulgari Tiffany Rolex new watch jewelry launch',
    '积家 百达翡丽 宝格丽 腕表 新品 发布',

    // 中国市场
    'luxury brand China Xiaohongshu Weibo campaign latest news',
    '奢侈品 品牌 中国 营销 新品 最新 本周',
    '时尚品牌 联名 代言人 活动 最新',

    // 国货
    '观夏 山下有松 气味图书馆 新品 营销',
    '国货 香氛 美妆 新品 小红书 最新',

    // 媒体来源
    'site:businessoffashion.com luxury fashion news',
    'site:voguebusiness.com fashion news latest',
    'site:wwd.com fashion luxury news',
    'site:jingdaily.com luxury China news',
    'site:hualizhi.com 时尚 奢侈品',
    'site:socialbeta.com 品牌 营销 案例',

    // 危机舆情
    'luxury fashion brand controversy scandal backlash latest',
    '奢侈品 品牌 危机 舆情 争议 最新',

    // 渠道零售
    'luxury flagship store opening China 2026',
    'fashion brand ecommerce China retail news latest',
  ];

  console.log(`🌐 开始搜索（过滤${CUTOFF_DAYS}天以上旧内容）...\n`);
  const allResults = [];

  // 分批并发执行
  const batchSize = 5;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(q => tavilySearch(q, 7)));

    batch.forEach((q, j) => {
      const raw = batchResults[j];
      const filtered = filterByDate(raw);
      const kept = filtered.length;
      const total = raw.length;
      console.log(`  ✓ "${q.slice(0, 40)}..." → ${total}条 / 保留${kept}条`);
      allResults.push(...filtered);
    });

    await new Promise(r => setTimeout(r, 400));
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
  unique.forEach(r => { sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1; });
  const topSources = Object.entries(sourceCounts).sort((a,b) => b[1]-a[1]).slice(0, 10);

  console.log(`\n📥 有效资讯：${unique.length} 条（已过滤${CUTOFF_DAYS}天前内容）`);
  console.log(`📰 来源分布：${topSources.map(([s,c]) => `${s}(${c})`).join(' · ')}\n`);

  return unique;
}

// ── DeepSeek 分析 ─────────────────────────────────────────────
function callDeepSeek(searchResults) {
  const contextText = searchResults.slice(0, 45).map((r, i) => {
    const dateLabel = r.published_date
      ? `📅 发布时间：${formatDate(r.published_date)}`
      : `📅 发布时间：未知`;
    return `[${i+1}] ${r.title}\n${dateLabel}\n来源：${r.source} | ${r.url}\n内容：${r.content}`;
  }).join('\n\n---\n\n');

  const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师。

核心原则：
1. 【时效性第一】只使用搜索结果中的最新内容，忽略任何超过2周的信息
2. 【极度具体】每条情报必须包含：产品系列全名、具体城市/门店/平台、真实数字、涉及人物姓名
3. 【三层洞察】market_signal必须包含：①战略意图 ②竞品影响 ③可操作建议
4. 【拒绝编造】若搜索结果不足，宁可少输出条目，不得虚构内容
5. 只输出JSON，第一个字符{，最后字符}，无其他文字`;

  const USER = `今天是${today}。

以下是经过时效过滤的最新时尚行业资讯（均为近${CUTOFF_DAYS}天内）：

${contextText}

---

基于以上内容，严格按JSON格式输出情报简报：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题",
      "horizon": "近期 · 1–4周",
      "summary": "必须包含具体品牌+事件+数据，禁止套话，2-3句",
      "signals": ["可验证的具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "必须包含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "必须包含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "从原文提取的具体日期",
      "summary": "回答：什么产品/系列全名？在哪个城市/门店/平台？什么数据？涉及哪些人？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地，或平台名+账号"},
        {"label": "数据", "value": "原文中的具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与以往或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[品牌这个动作背后的商业逻辑] ②竞品影响：[对哪个竞品构成什么具体威胁或机会] ③市场建议：[给同赛道市场人一条可立即执行的建议]",
      "source_url": "原文URL，必须来自搜索结果",
      "source_name": "媒体名称",
      "crisis_level": null
    }
  ]
}

规则：
- 输出6-10条items，每条来自不同品牌
- 覆盖5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重）
- source_url必须是搜索结果中真实存在的URL
- 搜索结果不足时，减少条目数量，绝不编造
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
  console.log(`\n🚀 时尚情报生成器 — ${today}\n`);
  try {
    // 1. 搜索 + 日期过滤
    const searchResults = await gatherIntel();

    if (searchResults.length < 3) {
      throw new Error(`有效资讯不足（仅${searchResults.length}条），请检查 TAVILY_API_KEY`);
    }

    // 2. DeepSeek 分析
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
