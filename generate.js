// generate.js — 时尚情报每日抓取脚本
// 架构：DeepSeek 自带联网搜索 → 结构化输出
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
1. 主动联网搜索今日最新资讯，优先搜索中国境内媒体和社交平台
2. 每条情报必须极度具体：产品系列全名、具体城市/门店/平台、真实数字、涉及人物姓名
3. market_signal三层分析：①战略意图 ②竞品影响 ③可操作建议
4. 严禁套话和编造，所有内容必须来自真实搜索结果
5. 只输出JSON，第一个字符{，最后字符}`;

const USER = `今天是${today}。

请立即联网搜索以下方向的最新资讯，重点搜索中国境内来源：

【必须搜索的中国境内来源】
- 华丽志（hualizhi.com）：奢侈品行业深度报道
- SocialBeta（socialbeta.com）：品牌营销案例
- 界面时尚（jiemian.com）：时尚快讯
- 微博热搜：品牌相关热点话题
- 小红书：品牌营销话题和KOL内容
- 36氪：时尚商业数据
- 虎嗅：品牌商业分析

【需要搜索的内容方向】
1. 奢侈品牌（LVMH/历峰/开云旗下）中国市场最新营销动作、新品发布、活动
2. 国货新锐（观夏、山下有松、气味图书馆）最新社媒动态和营销策略
3. 时尚品牌最新代言人官宣、联名合作
4. 品牌危机舆情事件（负面新闻、消费者投诉、争议话题）
5. 奢品零售渠道动态（开店、电商、免税）
6. 腕表珠宝香氛品牌最新动态

【境外内容筛选标准】
只收录明显影响中国市场的重大事件，例如：
- 集团财报中涉及中国区数据
- 品牌全球创意总监更换
- 重大并购或战略调整

搜索完成后，按以下JSON格式输出情报简报（只返回JSON）：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题，有冲击力",
      "horizon": "近期 · 1–4周",
      "summary": "基于搜索结果，含具体品牌+事件+数据，2-3句，禁止套话",
      "signals": ["可验证的具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "基于搜索结果，含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "基于搜索结果，含具体品牌+事件+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内，直接点明发生了什么",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "从搜索结果提取的具体日期",
      "summary": "什么产品/系列全名？哪个城市/平台？什么数据？涉及哪些具体人物？3-4句，每句有具体事实",
      "facts": [
        {"label": "产品/活动", "value": "产品系列全名或活动完整名称"},
        {"label": "地点/平台", "value": "具体城市+场地名，或平台名+账号"},
        {"label": "数据", "value": "搜索结果中的具体数字，无则填「暂无公开数据」"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[说明品牌这个动作背后的商业逻辑] ②竞品影响：[对哪个竞品构成什么具体威胁或机会] ③市场建议：[给同赛道市场人一条可立即执行的建议]",
      "source_url": "搜索到的原文链接",
      "source_name": "来源媒体名称（优先标注中文媒体）",
      "crisis_level": null
    }
  ]
}

要求：
- 输出8-10条items，中国境内事件占70%以上
- 覆盖全部5个category：营销动作、社媒声量、渠道零售、危机舆情、趋势前瞻
- 危机舆情必须填crisis_level（轻微/中度/严重）
- source_url必须是真实存在的链接
- 只返回JSON，无任何其他文字`;

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
      // DeepSeek 联网搜索
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: '搜索互联网获取最新信息',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '搜索关键词' }
              },
              required: ['query']
            }
          }
        }
      ],
      tool_choice: 'auto'
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
          if (parsed.error) {
            reject(new Error(`DeepSeek错误: ${JSON.stringify(parsed.error)}`));
            return;
          }
          // 取最后一条 assistant message 的文字内容
          const content = parsed?.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error(`返回空内容，完整响应: ${raw.slice(0, 500)}`));
            return;
          }
          resolve(content);
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

async function main() {
  console.log(`\n🚀 时尚情报生成器（DeepSeek 联网版）— ${today}\n`);
  try {
    console.log('🔍 DeepSeek 联网搜索 + 分析中（约30-60秒）...');
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
    console.log('\n✅ news-data.json 写入完成\n');

  } catch (err) {
    console.error('\n❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
