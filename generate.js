// generate.js — 时尚情报每日抓取脚本
// 运行：node generate.js
// 依赖环境变量：ANTHROPIC_API_KEY

const fs = require('fs');
const https = require('https');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ 缺少 ANTHROPIC_API_KEY'); process.exit(1); }

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric'
});

const BRANDS = [
  'LVMH旗下品牌(Louis Vuitton/Dior/Fendi/Loewe/Celine)',
  '历峰集团(Cartier/IWC/积家/伯爵/梵克雅宝)',
  '开云集团(Gucci/Saint Laurent/Balenciaga/Bottega Veneta)',
  'CHANEL', '爱马仕Hermès',
  '劳力士Rolex', '百达翡丽Patek Philippe', '宝格丽BVLGARI', '蒂芙尼Tiffany',
  '香奈儿美妆', '兰蔻Lancôme', '海蓝之谜La Mer', '祖玛珑Jo Malone',
  '观夏To Summer', '山下有松', '气味图书馆', '野兽派THE BEAST', 'URBAN REVIVO'
].join('、');

const SYSTEM_PROMPT = `你是一位专业的时尚行业市场情报分析师，服务对象是奢侈品/时尚行业的市场营销从业者。

基于你的知识库，整理时尚品牌近期动态，提取对市场人有价值的竞品情报。

重点监控品牌：${BRANDS}

情报分类（category只能用以下五类之一）：
- 营销动作：新campaign、联名合作、代言人官宣、快闪活动、品牌事件
- 社媒声量：小红书/抖音/微博/INS上的品牌内容策略、KOL合作、话题营销
- 渠道零售：新店开业、电商布局、免税渠道、DTC策略、销售数据
- 危机舆情：负面事件、产品召回、公关危机、舆情处理
- 趋势前瞻：行业报告、消费趋势、审美趋势、新兴市场

只返回如下JSON，不要任何额外文字、不要markdown代码块、不要解释：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "趋势主题（10字以内）",
      "horizon": "近期 · 1–4周",
      "summary": "趋势描述，2-3句，包含具体品牌行为或数据支撑",
      "signals": ["信号1", "信号2", "信号3"]
    }
  ],
  "items": [
    {
      "title": "情报标题（15字以内）",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "2025年近期",
      "summary": "事件经过与背景，3-4句，重点突出品牌意图和市场逻辑",
      "facts": [
        {"label": "平台", "value": "具体平台或渠道"},
        {"label": "规模", "value": "相关数据或规模描述"},
        {"label": "受众", "value": "目标人群"},
        {"label": "亮点", "value": "创新或差异化之处"}
      ],
      "market_signal": "从市场营销视角给出1-2句专业判断",
      "source_url": null,
      "source_name": "行业观察",
      "crisis_level": null
    }
  ]
}`;

const USER_PROMPT = `请整理以下方向的时尚品牌近期市场情报，输出8-10条items和3条trend_forecast：

1. 奢侈品牌（LVMH/历峰/开云旗下）在中国市场的营销动作和渠道策略
2. 国货新锐品牌（观夏、山下有松等）的社媒传播策略和爆款逻辑
3. 腕表珠宝品牌的数字化转型和内容营销
4. 香氛美妆赛道的竞争动态
5. 时尚品牌的危机公关案例
6. 行业整体趋势：静奢、可持续、二手市场、Z世代消费等

trend_forecast三条分别对应：
- 近期 · 1–4周（当下正在发生的）
- 中期 · 1–3个月（即将到来的趋势）
- 长期 · 季度级（结构性变化）

只返回JSON，第一个字符必须是 {，最后一个字符必须是 }`;

function callClaude() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error(`API错误: ${parsed.error.type} — ${parsed.error.message}`));
            return;
          }
          const text = (parsed.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');
          if (!text) {
            reject(new Error(`API返回空内容，完整响应: ${raw.slice(0, 300)}`));
            return;
          }
          resolve(text);
        } catch(e) {
          reject(new Error(`解析响应失败: ${e.message}\n原始响应: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`\n🔍 开始生成 ${today} 时尚情报...\n`);
  try {
    const raw = await callClaude();
    console.log('✅ API 调用成功，开始解析...');

    // 提取JSON，兼容模型可能输出的各种包装格式
    let jsonStr = raw.trim();
    // 去掉可能的 markdown 代码块
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON内容\n原始输出片段:\n${raw.slice(0, 400)}`);
    jsonStr = jsonStr.slice(start, end + 1);

    const data = JSON.parse(jsonStr);
    data.updated = data.updated || today;

    // 确保结构完整
    if (!Array.isArray(data.trend_forecast)) data.trend_forecast = [];
    if (!Array.isArray(data.items)) data.items = [];

    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), 'utf-8');

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
