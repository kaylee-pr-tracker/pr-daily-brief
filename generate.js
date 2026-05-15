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
  '观夏To Summer', '山下有松', '气味图书馆', '野兽派THE BEAST',
  '半亩花田', 'MAIA ACTIVE', 'URBAN REVIVO'
].join('、');

const SYSTEM_PROMPT = `你是一位专业的时尚行业市场情报分析师，服务对象是奢侈品/时尚行业的市场营销从业者。

你的任务：搜索今天（${today}）的时尚品牌动态，过滤噪音，提取对市场人真正有价值的竞品情报，结构化输出。

重点监控品牌：${BRANDS}

情报分类（category只能用以下五类）：
- 营销动作：新campaign、联名合作、代言人官宣、快闪活动、品牌事件
- 社媒声量：小红书/抖音/微博/INS上的品牌内容策略、KOL合作、话题营销、病毒传播
- 渠道零售：新店开业、电商布局、免税渠道、DTC策略、销售数据
- 危机舆情：负面事件、产品召回、公关危机、舆情处理
- 趋势前瞻：行业报告、消费趋势、审美趋势、新兴市场

严格按以下JSON格式输出，只返回JSON，不要任何额外文字或markdown代码块：

{
  "updated": "${today}",
  "trend_forecast": [
    {
      "title": "趋势主题（10字以内）",
      "horizon": "近期 · 1–4周",
      "summary": "趋势描述，2-3句，包含数据或具体品牌行为支撑",
      "signals": ["信号1", "信号2", "信号3"]
    }
  ],
  "items": [
    {
      "title": "情报标题（15字以内，直接说明事件）",
      "brand": "品牌名",
      "category": "营销动作",
      "date": "具体日期或时间范围",
      "summary": "事件经过与背景，3-4句话，重点突出品牌意图和市场逻辑",
      "facts": [
        {"label": "平台", "value": "具体平台或渠道"},
        {"label": "规模", "value": "可量化的数据"},
        {"label": "受众", "value": "目标人群描述"},
        {"label": "亮点", "value": "与以往不同的创新点"}
      ],
      "market_signal": "从市场营销视角给出1-2句专业判断，说明这个动作对竞品/行业的意义",
      "source_url": "这条资讯的原文链接，必须是真实可访问的URL，如果有多个来源取最权威的一个",
      "source_name": "来源媒体名称，如：华丽志、WWD中文、Vogue Business、界面时尚、微博、小红书等",
      "crisis_level": null
    }
  ]
}

重要要求：
- trend_forecast 输出3条，分别对应近期/中期/长期
- items 输出8-10条，覆盖不同品牌和不同category
- 危机舆情类条目需填写 crisis_level（轻微/中度/严重）
- source_url 必须是搜索结果中真实存在的链接，不可编造；如确实无法获取原文链接，填 null
- source_name 填写来源媒体的中文常用名
- market_signal 要有专业洞察，不能是事件复述
- 所有内容必须基于真实搜索结果，不可编造`;

const USER_PROMPT = `请立即搜索今天（${today}）时尚行业的最新动态，重点关注：
1. 中国市场：小红书、抖音、微博上的品牌内容动态，以及国内时尚媒体（WWD中文、Vogue Business、华丽志、界面时尚）报道
2. 全球动态（有中国市场影响的）：巴黎/米兰/纽约的品牌发布、集团财报、并购消息
3. 现象级国货品牌（观夏、山下有松等）的最新营销动作
4. 任何正在发酵的时尚品牌舆情事件

搜索时请保留每条资讯的原始来源URL，在输出JSON时填入source_url字段。
请严格按规定JSON格式输出，不要任何markdown包裹。`;

function callClaude() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
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
        'anthropic-beta': 'web-search-2025-03-05'
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const text = (parsed.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`\n🔍 开始抓取 ${today} 时尚情报...\n`);
  try {
    const raw = await callClaude();

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1) throw new Error('未找到JSON内容\n原始输出片段：\n' + raw.slice(0, 500));

    const data = JSON.parse(raw.slice(start, end + 1));
    data.updated = data.updated || today;

    fs.writeFileSync('news-data.json', JSON.stringify(data, null, 2), 'utf-8');

    console.log(`✅ 生成完成`);
    console.log(`📊 趋势前瞻：${data.trend_forecast?.length || 0} 条`);
    console.log(`📰 情报条目：${data.items?.length || 0} 条\n`);
    data.items?.forEach((item, i) => {
      const src = item.source_url ? ` → ${item.source_name || item.source_url}` : ' → 无来源';
      console.log(`  ${i+1}. [${item.category}] ${item.brand} — ${item.title}${src}`);
    });
    console.log('');
  } catch (err) {
    console.error('❌ 抓取失败:', err.message);
    process.exit(1);
  }
}

main();
