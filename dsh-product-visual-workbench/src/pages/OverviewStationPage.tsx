const planGroups = [
  {
    title: "客户交付 PRD",
    status: "已归档",
    items: ["独立项目开发运行版", "本地可运行 MVP", "客户可运行交付版", "商业正式部署版预留"],
    output: "PRD / 交付说明 / 客户验收标准",
  },
  {
    title: "原始提示词库",
    status: "已登记",
    items: ["系统开发总提示词", "HyperFrames 动画提示词", "程前式商业访谈风格", "SRT 清理与黑金字幕提示词"],
    output: "提示词索引 / 执行边界 / 脱敏说明",
  },
  {
    title: "风格方案库",
    status: "可复用",
    items: ["黑底白字 + 蓝色重点", "黑金知识课", "商业访谈纪录片", "120-150 秒获客短视频"],
    output: "风格规则 / 字幕规则 / 动效规则 / 音效规则",
  },
  {
    title: "编导决策系统",
    status: "新增核心层",
    items: ["内容标签", "重要性分级", "因果归因", "素材需求判断"],
    output: "director_decision_map.csv",
  },
  {
    title: "输出模板库",
    status: "已建模板",
    items: ["director_decision_map", "overlay_plan_with_frames", "sfx_cue_sheet", "asset_request_list"],
    output: "固定字段模板 / 后续 Agent 输出合同",
  },
  {
    title: "交付物与验收",
    status: "已形成路径",
    items: ["竖屏成片", "16:9 横屏版", "验收拼图", "QA 报告"],
    output: "mp4 / contact sheet / qa_report.md",
  },
];

const promptSources = [
  ["项目 PRD", "定义本地 MVP、工具检测、素材库、Skill 接入和剪映 Draft 预留"],
  ["增长 Agent OS", "定义账号诊断、选题、脚本、素材、剪辑、复盘、归因闭环"],
  ["视频分析评分模板", "输出 100 分评分、可学习点、提升建议和口播模板"],
  ["抽帧与 Agent 能力方案", "定义抽帧数量、素材解析、转写、画面分析和持续学习 Agent"],
  ["HyperFrames 动画方案", "基于口播稿输出风格、分镜、转场、关键词、图标和卡片"],
  ["商业访谈剪辑风格", "沉稳纪录片感、黑金字幕、章节卡、数字冲击和低频音效"],
  ["编导介入型剪辑系统", "先判断每一句为什么重要，再决定视觉、动效、音效和归因"],
];

const workflowRows = [
  ["SRT", "负责时间", "原始字幕时间轴"],
  ["音频", "负责节奏", "气口、停顿、重音、重复词"],
  ["编导", "负责意义", "内容类型、重要性、因果理由"],
  ["剪辑", "负责表达", "删除、压缩、补镜头、对齐字幕"],
  ["动效", "负责强化", "重点字、流程卡、HUD、转场"],
  ["归因", "负责解释", "为什么这样剪、预期用户反应、风险"],
];

export function OverviewStationPage() {
  return (
    <section className="overview-station" aria-label="方案与提示词总揽站">
      <div className="overview-head">
        <div>
          <p className="eyebrow">Master Overview Station</p>
          <h2>方案与原始提示词总揽站</h2>
          <p>
            集中管理 PRD、原始提示词、剪辑风格方案、编导决策层、输出模板和客户验收物。这里负责看全局，不直接执行视频。
          </p>
        </div>
        <div className="overview-lock">
          <span>执行边界</span>
          <strong>不在总揽站渲染视频</strong>
        </div>
      </div>

      <div className="overview-grid">
        {planGroups.map((group) => (
          <article className="overview-card" key={group.title}>
            <div className="overview-card-head">
              <h3>{group.title}</h3>
              <span>{group.status}</span>
            </div>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="overview-output">
              <small>产出物</small>
              <strong>{group.output}</strong>
            </div>
          </article>
        ))}
      </div>

      <div className="overview-columns">
        <section className="card">
          <div className="card-title-row">
            <h3>原始提示词索引</h3>
            <span className="status-badge">脱敏展示</span>
          </div>
          <div className="prompt-list">
            {promptSources.map(([name, desc]) => (
              <div className="prompt-row" key={name}>
                <strong>{name}</strong>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title-row">
            <h3>编导剪辑责任链</h3>
            <span className="status-badge status-ok">已固化</span>
          </div>
          <div className="workflow-table">
            {workflowRows.map(([layer, duty, artifact]) => (
              <div className="workflow-row" key={layer}>
                <strong>{layer}</strong>
                <span>{duty}</span>
                <small>{artifact}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
