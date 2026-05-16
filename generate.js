// generate.js — 时尚情报每日抓取脚本（Groq · 高质量版）
// 运行：node generate.js
// 依赖环境变量：GROQ_API_KEY

const fs = require('fs');
const https = require('https');

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) { console.error('❌ 缺少 GROQ_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// ── 高质量 few-shot 范例（让模型理解我们要什么程度的具体性）────────
const FEW_SHOT_EXAMPLES = `
以下是符合要求的情报范例，请严格参照这个具体程度和分析深度：

范例1（营销动作）：
{
  "title": "Loewe以限量艺术书切入文化资本赛道",
  "brand": "Loewe",
  "category": "营销动作",
  "date": "2025年5月",
  "summary": "Loewe基金会与西班牙诗人Ida Vitale合作推出限量艺术书《Agua y sed》，全球限量500册，定价约3200元，专门通过独立书店及品牌官网发售，刻意回避精品店渠道。这是Loewe基金会连续第7年通过出版物项目强化「文化机构」身份，与2024年和艺术家William Kentridge合作的陶瓷系列形成同一叙事体系。",
  "facts": [
    {"label": "产品", "value": "《Agua y sed》限量艺术书，全球500册"},
    {"label": "渠道", "value": "莎士比亚书店（巴黎）、Page One（北京）等独立书店，非精品店"},
    {"label": "定价", "value": "约3200元，远超同类出版物市场价"},
    {"label": "差异点", "value": "连续7年同一策略，与竞品「联名产品」逻辑形成鲜明对比"}
  ],
  "market_signal": "①战略意图：将品牌溢价锚点从产品工艺转移到文化生产能力，使其无法被价格比较。②竞品威胁：Bottega Veneta、Celine跟进「文化出版」赛道的窗口期正在关闭，先发优势已形成。③给市场人的建议：观察Loewe如何在小红书将这批书店内容本土化，其选择何种KOL类型（书评人vs时尚博主）将预示奢品内容策略的下一波风向。",
  "source_url": "https://www.businessoffashion.com/articles/luxury/loewe-foundation-arts-award",
  "source_name": "Business of Fashion",
  "crisis_level": null
}

范例2（社媒声量）：
{
  "title": "观夏「昆仑煮雪」验证零投放破亿模型",
  "brand": "观夏 To Summer",
  "category": "社媒声量",
  "date": "2025年5月",
  "summary": "观夏新品「昆仑煮雪」（以新疆昆仑山融雪为调香灵感，前调雪松/中调白茶/尾调麝香）5月8日上线，品牌未启动任何KOL付费合作，仅在官方小红书发布3条产品概念视频。截至5月12日，#昆仑煮雪 话题自然曝光1.2亿，素人开箱笔记超6.8万篇，超过80%内容在讨论「把新疆的山带回家」这一情感叙事而非产品参数。",
  "facts": [
    {"label": "产品", "value": "昆仑煮雪香氛，雪松/白茶/麝香调，60ml售价580元"},
    {"label": "平台数据", "value": "小红书话题曝光1.2亿，素人笔记6.8万篇，5天内"},
    {"label": "投放成本", "value": "零KOL付费，仅官方内容3条"},
    {"label": "差异点", "value": "80%+UGC讨论情感叙事而非产品本身，用户自发完成品牌传播"}
  ],
  "market_signal": "①战略意图：以地理文化IP（昆仑山）替代明星/KOL背书，将情感认同转化为传播燃料，边际传播成本趋近于零。②竞品威胁：气味图书馆、闻献等同赛道品牌KOL依赖度仍高，ROI劣势将在下半年财务数据中显现。③给市场人的建议：观夏的「地理IP+产品诗意化命名」是可复制框架，但窗口期不超过12个月——一旦赛道品牌集体模仿，消费者对这类叙事将出现审美疲劳。",
  "source_url": "https://www.xiaohongshu.com/search_result?keyword=昆仑煮雪",
  "source_name": "小红书",
  "crisis_level": null
}

范例3（危机舆情）：
{
  "title": "Balenciaga中国区定价差异35%引发舆情",
  "brand": "Balenciaga",
  "category": "危机舆情",
  "date": "2025年5月13日",
  "summary": "微博博主@奢侈品内幕 发布对比图，显示Balenciaga Le City手袋中国定价19800元，法国官网同款折合约14600元，差价约35%。帖子48小时内获转发12万次，#Balenciaga中国加价 话题冲至微博热搜第14位。品牌公关团队在舆情发酵36小时后仍无任何官方回应，多家时尚媒体已致电采访。",
  "facts": [
    {"label": "事件", "value": "Le City手袋中国售价19800元 vs 法国14600元，差价35%"},
    {"label": "扩散", "value": "48小时转发12万，微博热搜第14位"},
    {"label": "现状", "value": "36小时内品牌零回应，多家媒体排队采访"},
    {"label": "参考", "value": "2024年Dior同类事件48小时回应后热度下降70%，沉默只会延长危机"}
  ],
  "market_signal": "①战略意图分析：品牌可能在等待内部法务评估再发声，但每延误6小时，舆情烈度约增加15-20%。②竞品机会：LVMH旗下品牌应立即审计自身中欧定价差异，主动发布「全球统一定价路线图」可借势建立信任优势。③给市场人的建议：危机公关黄金窗口为24小时内，超过48小时沉默的案例中有78%最终演变为品牌长期形象损伤。",
  "source_url": "https://weibo.com/search?q=Balenciaga中国加价",
  "source_name": "微博",
  "crisis_level": "中度"
}`;

const SYSTEM = `你是一位有15年经验的奢侈品行业市场情报分析师，曾供职于LVMH集团战略部和麦肯锡奢侈品团队。

你的情报以三个特质著称：
1. 极度具体——每条情报都能回答：什么产品/系列名称？哪个城市/门店/平台？什么数据？邀请了谁？
2. 逻辑严谨——每个结论都有事实支撑，拒绝「品牌影响力提升」「消费者认知加深」等空话
3. 洞察独到——market_signal必须包含战略意图分析、竞品威胁/机会、可操作建议三层

你只输出JSON，第一个字符是{，最后一个字符是}，无任何其他内容。`;

const USER = `今天是${today}。

${FEW_SHOT_EXAMPLES}

请参照以上范例的具体程度和分析深度，生成今日时尚行业竞品情报简报。

覆盖品牌：Louis Vuitton、Dior、Chanel、Hermès、Gucci、Loewe、Bottega Veneta、Cartier、积家、宝格丽、Tiffany、观夏To Summer、山下有松、气味图书馆、兰蔻、海蓝之谜

JSON格式如下（严格遵守，只返回JSON）：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "8字内趋势标题，要有冲击力",
      "horizon": "近期 · 1–4周",
      "summary": "必须含品牌名+具体动作+数据，2-3句，禁止套话",
      "signals": ["具体可观测信号", "具体可观测信号", "具体可观测信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "中期 · 1–3个月",
      "summary": "必须含品牌名+具体动作+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    },
    {
      "title": "8字内趋势标题",
      "horizon": "长期 · 季度级",
      "summary": "必须含品牌名+具体动作+数据，2-3句",
      "signals": ["具体信号", "具体信号", "具体信号"]
    }
  ],
  "items": [
    {
      "title": "品牌+具体事件，15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体时间",
      "summary": "回答：什么产品/系列？在哪里/哪个平台？规模数据？品牌意图？3-4句，禁止模糊表达",
      "facts": [
        {"label": "产品/活动", "value": "具体产品线名称或活动全名"},
        {"label": "地点/平台", "value": "具体城市+地址，或平台名+账号"},
        {"label": "规模/数据", "value": "具体数字：曝光量/销售额/参与人数等"},
        {"label": "核心差异", "value": "与该品牌以往做法或竞品的具体区别"}
      ],
      "market_signal": "①战略意图：[一句话] ②竞品威胁/机会：[一句话] ③给市场人的建议：[一句话]",
      "source_url": null,
      "source_name": "华丽志",
      "crisis_level": null
    }
  ]
}

输出8-10条items，每条涉及不同品牌，覆盖全部5个category（营销动作/社媒声量/渠道零售/危机舆情/趋势前瞻）。
危机舆情类必须填crisis_level。只返回JSON。`;

function callGroq() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ],
      temperature: 0.5,
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
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) { reject(new Error(`API错误: ${parsed.error.message}`)); return; }
          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) { reject(new Error(`返回空内容: ${raw.slice(0, 300)}`)); return; }
          resolve(text);
        } catch(e) {
          reject(new Error(`解析失败: ${e.message}\n原始: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

async function main() {
  console.log(`\n🔍 开始生成 ${today} 时尚情报...\n`);
  try {
    const raw = await callGroq();
    console.log('✅ API 调用成功，解析中...');

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

    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });

    console.log(`\n📊 趋势前瞻：${data.trend_forecast.length} 条`);
    console.log(`📰 情报条目：${data.items.length} 条\n`);
    data.items.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}`);
    });
    console.log('\n✅ news-data.json 写入完成\n');

  } catch (err) {
    console.error('❌ 失败:', err.message);
    process.exit(1);
  }
}

main();
