// generate.js — 时尚情报每日抓取脚本
// 架构：DeepSeek 原生联网搜索（search_mode 参数）
// 依赖环境变量：DS_API_KEY

const fs = require('fs');
const https = require('https');

const DS_KEY = process.env.DS_API_KEY;
if (!DS_KEY) { console.error('❌ 缺少 DS_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师，曾供职于LVMH集团战略部。

核心原则：
1. 主动搜索今日（${today}）最新资讯，只使用7天内的内容
2. 优先搜索中国境内媒体：华丽志、SocialBeta、界面时尚、微博、小红书相关报道
3. 每条情报极度具体：产品系列全名、具体城市/门店/平台、真实数字、涉及人物姓名
4. market_signal三层：①战略意图 ②竞品影响 ③可操作建议
5. 严禁套话和编造，所有内容必须来自真实搜索结果
6. 只输出JSON，第一个字符{，最后字符}`;

const USER = `今天是${today}。

请立即搜索以下方向的最新资讯（只使用7天内发布的内容，优先中国境内来源）：

1. 奢侈品牌中国市场最新营销动作（LVMH/开云/历峰旗下品牌）
2. 国货新锐最新动态（观夏、山下有松、气味图书馆）
3. 时尚品牌代言人官宣、联名合作最新
4. 品牌危机舆情事件（微博热搜、消费者投诉）
5. 奢品零售渠道动态（开店、电商、免税）
6. 腕表珠宝香氛最新发布

搜索后按以下JSON格式输出（只返回JSON，无其他文字）：

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
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些具体人物？3-4句，每句有具体事实支撑",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地，或平台名+账号"},
        {"label": "数据", "value": "搜索结果中的具体数字"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[品牌这个动作背后的商业逻辑] ②竞品影响：[对哪个竞品构成什么具体威胁] ③市场建议：[给同赛道市场人一条可立即执行的建议]",
      "source_url": "搜索到的原文链接",
      "source_name": "来源媒体名称",
      "crisis_level": null
    }
  ]
}

要求：
- 中国境内事件占70%以上
- 输出8-10条items，覆盖不同品牌
- 覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重）
- source_url必须是真实存在的链接
- 只返回JSON`;

function callDeepSeek() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ],
      temperature: 0.2,
      max_tokens: 6000,
      // DeepSeek 官方原生联网搜索参数
      search: true,
      search_options: {
        search_recency_filter: 'week'  // 只搜索一周内的内容
      }
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
        console.log(`  HTTP状态: ${res.statusCode}`);
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            // 如果 search 参数不支持，打印完整错误
            reject(new Error(`DeepSeek错误: ${JSON.stringify(parsed.error)}\n完整响应: ${raw.slice(0, 500)}`));
            return;
          }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) {
            reject(new Error(`返回空内容: ${raw.slice(0, 500)}`));
            return;
          }
          resolve(text);
        } catch(e) {
          reject(new Error(`解析失败: ${e.message}\n原始: ${raw.slice(0, 500)}`));
        }
      });
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

async function main() {
  console.log(`\n🚀 时尚情报生成器（DeepSeek 原生搜索）— ${today}\n`);
  try {
    console.log('🔍 DeepSeek 原生联网搜索中（约30-60秒）...');
    const raw = await callDeepSeek();
    console.log('✅ 完成，解析JSON...');

    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON\n原始输出:\n${raw.slice(0, 600)}`);
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
