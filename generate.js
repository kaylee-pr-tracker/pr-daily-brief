// generate.js — 时尚情报每日抓取脚本（Groq 版本）
// 运行：node generate.js
// 依赖环境变量：GROQ_API_KEY

const fs = require('fs');
const https = require('https');

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) { console.error('❌ 缺少 GROQ_API_KEY'); process.exit(1); }

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
- 营销动作：新campaign、联名合作、代言人官宣、快闪活动
- 社媒声量：小红书/抖音/微博/INS内容策略、KOL合作、话题营销
- 渠道零售：新店开业、电商布局、免税渠道、销售数据
- 危机舆情：负面事件、产品召回、公关危机
- 趋势前瞻：行业报告、消费趋势、审美变化

只返回JSON，不要任何额外文字和markdown代码块，第一个字符是{最后一个字符是}。`;

const USER_PROMPT = `今天是${today}。请整理时尚品牌近期市场情报，输出以下JSON结构：

{
  "updated": "${today}",
  "trend_forecast": [
    {"title": "趋势主题10字内", "horizon": "近期 · 1–4周", "summary": "2-3句含具体品牌或数据", "signals": ["信号1","信号2","信号3"]},
    {"title": "趋势主题10字内", "horizon": "中期 · 1–3个月", "summary": "2-3句含具体品牌或数据", "signals": ["信号1","信号2","信号3"]},
    {"title": "趋势主题10字内", "horizon": "长期 · 季度级", "summary": "2-3句含具体品牌或数据", "signals": ["信号1","信号2","信号3"]}
  ],
  "items": [
    {
      "title": "情报标题15字内",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "近期时间",
      "summary": "3-4句事件背景与市场逻辑",
      "facts": [
        {"label": "平台", "value": "具体平台"},
        {"label": "规模", "value": "数据或描述"},
        {"label": "受众", "value": "目标人群"},
        {"label": "亮点", "value": "创新点"}
      ],
      "market_signal": "1-2句专业市场判断",
      "source_url": null,
      "source_name": "行业观察",
      "crisis_level": null
    }
  ]
}

输出8-10条items，覆盖不同品牌和category。危机舆情类填crisis_level（轻微/中度/严重）。只返回JSON。`;

function callGroq() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
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
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`\n🔍 开始生成 ${today} 时尚情报（Groq）...\n`);
  try {
    const raw = await callGroq();
    console.log('✅ API 调用成功，开始解析...');

    let jsonStr = raw.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1) throw new Error(`未找到JSON\n原始输出:\n${raw.slice(0, 500)}`);
    jsonStr = jsonStr.slice(start, end + 1);

    const data = JSON.parse(jsonStr);
    data.updated = data.updated || today;
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
