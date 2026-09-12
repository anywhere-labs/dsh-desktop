import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createVideoApi,
  type ProviderDescriptor,
  type VideoGenerationRequest,
} from "./api/client";

type IconName =
  | "activity"
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "cloud"
  | "download"
  | "film"
  | "focus"
  | "image"
  | "mic"
  | "more"
  | "play"
  | "plus"
  | "refresh"
  | "search"
  | "spark"
  | "upload"
  | "video"
  | "wave";

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    activity: (
      <>
        <path d="M3 12h3l2-7 4 14 2-7h7" />
        <path d="M3 4h3" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h13" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    cloud: (
      <>
        <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18Z" />
        <path d="M12 9v6m0 0 2-2m-2 2-2-2" />
      </>
    ),
    download: (
      <>
        <path d="M12 4v10" />
        <path d="m8 11 4 4 4-4" />
        <path d="M5 20h14" />
      </>
    ),
    film: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 4v16M16 4v16M4 8h4m8 0h4M4 16h4m8 0h4" />
      </>
    ),
    focus: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    image: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.4" />
        <path d="m5 17 5-5 3 3 2-2 4 4" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    play: <path d="m9 6 9 6-9 6V6Z" fill="currentColor" />,
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    refresh: (
      <>
        <path d="M19 8a7 7 0 1 0 1 5" />
        <path d="M19 4v4h-4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4 4" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.35 5.65L19 10l-5.65 1.35L12 17l-1.35-5.65L5 10l5.65-1.35L12 3Z" />
        <path d="m19 16 .5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5L19 16Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V5" />
        <path d="m8 9 4-4 4 4" />
        <path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    wave: (
      <>
        <path d="M3 12h2m2-3v6m3-9v12m4-8v4m3-7v10m3-5v1" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

type SlotKind = "scene" | "character" | "product" | "motion" | "audio";
type FileState = { file: File; url: string };
type GenerateStatus = "idle" | "running" | "done" | "failed";

const platformOptions = [
  { name: "抖音", abbr: "DY", tone: "orange" },
  { name: "小红书", abbr: "XHS", tone: "pink" },
  { name: "视频号", abbr: "WX", tone: "green" },
];

const pipelineStages = ["资产预检", "动作重定向", "镜头合成", "QA 回传"];

const defaultPrompt =
  "保留人物身份与商品外观，按照动作参考视频的节奏完成一段 9:16 竖屏产品展示。镜头从中景推进到近景，手部动作自然，背景保持冷灰工业质感，最后停留 1 秒展示瓶身正面。";

const apiBase =
  (import.meta as { env?: Record<string, string> }).env?.VITE_VIDEO_API_BASE ??
  new URLSearchParams(window.location.search).get("api") ??
  "";

const publishedDemoVideoUrl =
  (import.meta as { env?: Record<string, string> }).env?.VITE_DEMO_VIDEO_URL ??
  new URLSearchParams(window.location.search).get("video") ??
  "";

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}

const videoApi = createVideoApi(apiBase);

function resultUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.startsWith("http") ? value : apiUrl(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [platforms, setPlatforms] = useState(["抖音", "小红书"]);
  const [files, setFiles] = useState<Partial<Record<SlotKind, FileState>>>({});
  const [hotspotReady, setHotspotReady] = useState(false);
  const [hookReady, setHookReady] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [duration, setDuration] = useState("08");
  const [quality, setQuality] = useState("1080p");
  const [style, setStyle] = useState("写实广告");
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>(
    publishedDemoVideoUrl ? "done" : "idle",
  );
  const [activeStage, setActiveStage] = useState(-1);
  const [resultVersion, setResultVersion] = useState(
    publishedDemoVideoUrl ? 1 : 0,
  );
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(
    publishedDemoVideoUrl,
  );
  const [taskError, setTaskError] = useState("");
  const [providerOptions, setProviderOptions] = useState<ProviderDescriptor[]>(
    [],
  );
  const [providerId, setProviderId] = useState(() =>
    new URLSearchParams(window.location.search).get("provider") === "libtv"
      ? "libtv-cli"
      : (new URLSearchParams(window.location.search).get("provider") ??
        "libtv-cli"),
  );
  const [modelKey, setModelKey] = useState("");
  const [qaExpanded, setQaExpanded] = useState(true);
  const generationTimer = useRef<number | undefined>(undefined);
  const realJobTimer = useRef<number | undefined>(undefined);
  const realProvider = useMemo(
    () => Boolean(new URLSearchParams(window.location.search).get("provider")),
    [],
  );
  const realProjectId = useMemo(
    () => new URLSearchParams(window.location.search).get("project") ?? "",
    [],
  );
  const realNode = useMemo(
    () => new URLSearchParams(window.location.search).get("node") ?? "",
    [],
  );
  const approvalId = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("approval") ??
      "operator-ui-confirmed",
    [],
  );

  useEffect(
    () => () => {
      window.clearInterval(generationTimer.current);
      window.clearInterval(realJobTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!realProvider) return;
    void videoApi
      .capabilities()
      .then((value) => setProviderOptions(value.providers ?? []))
      .catch(() => setProviderOptions([]));
  }, [realProvider]);

  const hasCoreAssets = Boolean(
    files.character && files.product && files.motion,
  );
  const resultCode = useMemo(
    () => (resultVersion ? `MOCK-082${resultVersion}` : "WAITING"),
    [resultVersion],
  );

  function selectFile(kind: SlotKind, file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFiles((current) => {
      const previous = current[kind];
      if (previous) URL.revokeObjectURL(previous.url);
      return { ...current, [kind]: { file, url } };
    });
  }

  async function runGeneration() {
    if (generateStatus === "running") return;
    if (realProvider) {
      if (!realProjectId || !realNode) {
        setGenerateStatus("failed");
        return;
      }
      setGenerateStatus("running");
      setResultVersion(0);
      setGeneratedVideoUrl("");
      setTaskError("");
      setActiveStage(0);
      try {
        const assets = Object.entries(files).map(([kind, entry]) => ({
          assetId: `${kind}:${entry?.file.name ?? ""}`,
          kind: kind.toUpperCase(),
          name: entry?.file.name ?? "",
          mimeType: entry?.file.type || "application/octet-stream",
          size: entry?.file.size ?? 0,
          authorized: true,
        }));
        const requestBody: VideoGenerationRequest = {
          providerId,
          projectId: realProjectId,
          node: realNode,
          idempotencyKey: `${realProjectId}:${realNode}:${prompt.length}:${duration}:${quality}`,
          confirmed: true,
          approvalId,
          model: modelKey || undefined,
          prompt,
          assets,
          settings: { duration, quality, style, platforms },
        };
        const preflight = await videoApi.preflight(requestBody);
        if (preflight.allowed !== true)
          throw new Error(preflight.errors?.join("；") ?? "真实任务预检未通过");
        const job = await videoApi.generate(requestBody);
        if (!job.runId) throw new Error(job.error ?? "真实 Provider 请求失败");
        setActiveStage(1);
        realJobTimer.current = window.setInterval(async () => {
          const status = await videoApi.job(job.runId!);
          if (status.state === "COMPLETED") {
            window.clearInterval(realJobTimer.current);
            setActiveStage(pipelineStages.length - 1);
            setGenerateStatus("done");
            setGeneratedVideoUrl(resultUrl(status.outputUrl));
            setResultVersion((version) => version + 1);
          } else if (status.state === "FAILED") {
            window.clearInterval(realJobTimer.current);
            setTaskError(status.error ?? "LibTV 任务失败");
            setGenerateStatus("failed");
          } else {
            setActiveStage(2);
          }
        }, 2000);
      } catch (error) {
        setTaskError(
          error instanceof Error ? error.message : "真实 Provider 请求失败",
        );
        setGenerateStatus("failed");
      }
      return;
    }
    setGenerateStatus("running");
    setResultVersion(0);
    setGeneratedVideoUrl("");
    setTaskError("");
    setActiveStage(0);
    let stage = 0;
    generationTimer.current = window.setInterval(() => {
      stage += 1;
      if (stage < pipelineStages.length) {
        setActiveStage(stage);
      } else {
        window.clearInterval(generationTimer.current);
        setGenerateStatus("done");
        setActiveStage(pipelineStages.length - 1);
        setResultVersion((version) => version + 1);
      }
    }, 880);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <span>DSH</span>
            <i />
          </div>
          <div>
            <div className="brand-name">VIDEO WORKBENCH</div>
            <div className="brand-subtitle">
              DeepSeek Harness / CREATIVE OPS
            </div>
          </div>
        </div>
        <div className="topbar-center">
          <div className="system-pulse">
            <span className="pulse-dot" />{" "}
            {realProvider ? "LIBTV PROVIDER" : "LOCAL DEMO ADAPTER"} <b>v0.1</b>
          </div>
          <div className="last-sync">
            <Icon name="clock" size={13} /> 最后同步 14:32:08
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="搜索">
            <Icon name="search" />
          </button>
          <button className="icon-button" aria-label="更多">
            <Icon name="more" />
          </button>
          <div className="operator">
            <div className="avatar">CY</div>
            <span>陈言</span>
            <Icon name="chevron" size={13} />
          </div>
        </div>
      </header>

      <section className="command-strip">
        <div className="strip-label">
          <span className="section-index">01</span>
          <strong>分发目标</strong>
          <span>选择平台</span>
        </div>
        <div className="platform-list">
          {platformOptions.map((platform) => {
            const selected = platforms.includes(platform.name);
            return (
              <button
                key={platform.name}
                className={`platform-chip ${selected ? "selected" : ""} ${platform.tone}`}
                onClick={() =>
                  setPlatforms((current) =>
                    selected
                      ? current.filter((item) => item !== platform.name)
                      : [...current, platform.name],
                  )
                }
              >
                <span className="platform-box">
                  {selected && <Icon name="check" size={12} />}
                </span>
                <b>{platform.abbr}</b>
                {platform.name}
              </button>
            );
          })}
        </div>
        <div className="strip-divider" />
        <button
          className={`strip-action ${hotspotReady ? "is-ready" : ""}`}
          onClick={() => setHotspotReady((ready) => !ready)}
        >
          <span className="action-icon">
            <Icon name="activity" size={15} />
          </span>
          <span>
            <b>热点抓取</b>
            <small>
              {hotspotReady ? "今日信号已接入" : "捕捉今日内容信号"}
            </small>
          </span>
          <span className="action-state">
            {hotspotReady ? "READY" : "RUN"} <Icon name="arrow" size={13} />
          </span>
        </button>
        <button
          className={`strip-action ${hookReady ? "is-ready" : ""}`}
          onClick={() => setHookReady((ready) => !ready)}
        >
          <span className="action-icon hook-icon">
            <Icon name="spark" size={15} />
          </span>
          <span>
            <b>Hook 分析</b>
            <small>{hookReady ? "开场钩子已分析" : "分析前 3 秒抓力"}</small>
          </span>
          <span className="action-state">
            {hookReady ? "READY" : "RUN"} <Icon name="arrow" size={13} />
          </span>
        </button>
        <div className="strip-status">
          <span className="status-ring" /> {platforms.length} 个平台已选
        </div>
      </section>

      <section className="signal-board">
        <div className="signal-board-head">
          <div>
            <span className="section-index">01A</span>
            <strong>热点 &amp; Hook Listing</strong>
            <small>PLATFORM SIGNALS / DEMO FEED</small>
          </div>
          <span className="feed-status">
            <i />{" "}
            {hotspotReady || hookReady ? "LOCAL SIGNALS READY" : "AWAITING RUN"}
          </span>
        </div>
        <div
          className="signal-table"
          role="table"
          aria-label="热点与 Hook 列表"
        >
          <div className="signal-row signal-header" role="row">
            <span>平台</span>
            <span>热点 / Hook</span>
            <span>类型</span>
            <span>适配分</span>
            <span>状态</span>
          </div>
          <div className="signal-row" role="row">
            <span className="signal-platform orange">DY</span>
            <span>
              <b>别急着换件，先看故障码</b>
              <small>前 3 秒反常识开场</small>
            </span>
            <span>问题型 Hook</span>
            <strong>92</strong>
            <em className={hookReady ? "signal-ready" : ""}>
              {hookReady ? "ANALYZED" : "CANDIDATE"}
            </em>
          </div>
          <div className="signal-row" role="row">
            <span className="signal-platform pink">XHS</span>
            <span>
              <b>维修判断不能只靠猜</b>
              <small>数据证据 + 技师身份</small>
            </span>
            <span>证据型 Hook</span>
            <strong>87</strong>
            <em className={hotspotReady ? "signal-ready" : ""}>
              {hotspotReady ? "CAPTURED" : "WAITING"}
            </em>
          </div>
          <div className="signal-row" role="row">
            <span className="signal-platform green">WX</span>
            <span>
              <b>15 秒产品诊断演示</b>
              <small>人物 / 产品 / 场景一致性</small>
            </span>
            <span>产品型 Hook</span>
            <strong>81</strong>
            <em>DEMO</em>
          </div>
        </div>
      </section>

      <main className="workspace">
        <aside className="left-rail panel-rail">
          <div className="rail-heading">
            <div>
              <span className="section-index">02</span>
              <h2>素材输入</h2>
            </div>
            <span className="count-badge">{Object.keys(files).length}/5</span>
          </div>
          <p className="rail-intro">
            Drag files into the slots
            <br />
            or upload from this device.
          </p>
          <div className="asset-slots">
            <MediaSlot
              kind="scene"
              label="场景"
              meta="背景 / 光线参考"
              files={files}
              onSelect={selectFile}
            />
            <MediaSlot
              kind="character"
              label="人物"
              meta="身份锁定 / 参考图"
              files={files}
              onSelect={selectFile}
            />
            <MediaSlot
              kind="product"
              label="产品"
              meta="外观锁定 / 参考图"
              files={files}
              onSelect={selectFile}
            />
            <MediaSlot
              kind="motion"
              label="动作视频"
              meta="动作驱动源"
              files={files}
              onSelect={selectFile}
            />
            <MediaSlot
              kind="audio"
              label="音频"
              meta="BGM / 原声"
              files={files}
              onSelect={selectFile}
            />
          </div>
          <div className="upload-tip">
            <Icon name="cloud" size={15} />
            <span>
              本地预览 · 文件不会上传
              <br />
              <b>支持 JPG / PNG / MP4 / MP3</b>
            </span>
          </div>
          <div className="rail-footer">
            <span className="mini-led" />{" "}
            {realProvider ? "LIBTV ROUTE ONLINE" : "DEMO ADAPTER ONLINE"}
          </div>
        </aside>

        <section className="center-stage">
          <div className="stage-toolbar">
            <div className="stage-title">
              <span className="section-index">03</span>
              <h1>生成预览</h1>
              <span className="canvas-spec">CANVAS / 9:16</span>
            </div>
            <div className="stage-tools">
              <button className="tool-button">
                <Icon name="focus" size={14} /> 适应画布
              </button>
              <button className="tool-button">
                <Icon name="refresh" size={14} /> 重置
              </button>
            </div>
          </div>
          <div className="preview-layout">
            <div className="phone-stage">
              <div className="phone-frame">
                <div className="phone-screen">
                  <div className="scan-lines" />
                  {generatedVideoUrl ? (
                    <video
                      src={generatedVideoUrl}
                      className="product-preview"
                      controls
                      playsInline
                    />
                  ) : files.product?.url ? (
                    <img
                      src={files.product.url}
                      alt="产品预览"
                      className="product-preview"
                    />
                  ) : (
                    <div className="preview-object">
                      <div className="object-glow" />
                      <div className="bottle">
                        <div className="bottle-cap" />
                        <div className="bottle-body">
                          <span>
                            FORM
                            <br />
                            <em>02</em>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="preview-ui">
                    <span>00:00:00:00</span>
                    <span className="preview-live">
                      <i /> DEMO PREVIEW
                    </span>
                  </div>
                  <div className="preview-caption">
                    YOUR PRODUCT
                    <br />
                    <strong>IN MOTION</strong>
                  </div>
                </div>
              </div>
              <div className="phone-measure measure-top">
                <span /> 1080 × 1920 <span />
              </div>
            </div>
            <div className="stage-notes">
              <div className="note-card active-note">
                <div className="note-head">
                  <span>SCENE NOTE</span>
                  <span className="note-code">A-01</span>
                </div>
                <p>
                  {files.scene
                    ? files.scene.file.name
                    : "冷灰工业棚拍 / soft top light"}
                </p>
                <div className="note-meter">
                  <span style={{ width: files.scene ? "100%" : "72%" }} />
                </div>
                <small>
                  {files.scene ? "LOCAL FILE READY" : "SUGGESTED REFERENCE"}
                </small>
              </div>
              <div className="note-card">
                <div className="note-head">
                  <span>MOTION MAP</span>
                  <span className="note-code">M-04</span>
                </div>
                <div className="motion-wave">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <small>
                  {files.motion
                    ? "MOTION SOURCE READY"
                    : "AWAITING MOTION SOURCE"}
                </small>
              </div>
              <div className="stage-legend">
                <span>
                  <i className="legend-orange" />
                  主镜头
                </span>
                <span>
                  <i className="legend-green" />
                  资产锁定
                </span>
                <span>
                  <i className="legend-gray" />
                  待生成
                </span>
              </div>
            </div>
          </div>
          <div className="timeline-panel">
            <div className="timeline-header">
              <span>
                <Icon name="film" size={14} /> TIMELINE / 00:08:00
              </span>
              <span>
                {generateStatus === "running"
                  ? "PROCESSING…"
                  : generateStatus === "done"
                    ? "MOCK OUTPUT READY"
                    : "DRAFT / 24 FPS"}
              </span>
            </div>
            <div className="timeline">
              <div className="time-ticks">
                <span>00:00</span>
                <span>00:02</span>
                <span>00:04</span>
                <span>00:06</span>
                <span>00:08</span>
              </div>
              <div className="timeline-track">
                <div
                  className="timeline-progress"
                  style={{
                    width: `${generateStatus === "done" ? 100 : generateStatus === "running" ? Math.max(18, (activeStage + 1) * 21) : 18}%`,
                  }}
                />
                <div
                  className="playhead"
                  style={{
                    left: `${generateStatus === "done" ? 100 : generateStatus === "running" ? Math.max(18, (activeStage + 1) * 21) : 18}%`,
                  }}
                />
                <div className="clip clip-one">
                  <span>SCENE / 01</span>
                </div>
                <div className="clip clip-two">
                  <span>ACTION / 02</span>
                </div>
                <div className="clip clip-three">
                  <span>HERO / 03</span>
                </div>
              </div>
            </div>
          </div>
          <section className="prompt-panel">
            <div className="prompt-heading">
              <div>
                <span className="section-index">04</span>
                <h2>导演 Prompt</h2>
              </div>
              <button
                className="prompt-action"
                onClick={() => setPrompt(defaultPrompt)}
              >
                <Icon name="spark" size={14} /> AI 重写
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="prompt-footer">
              <span>
                <Icon name="check" size={13} /> 语义校验通过
              </span>
              <span>{prompt.length} / 500</span>
            </div>
          </section>
        </section>

        <aside className="right-rail panel-rail">
          <div className="rail-heading">
            <div>
              <span className="section-index">05</span>
              <h2>Agent 控制台</h2>
            </div>
            <span className="live-label">
              <i /> LIVE
            </span>
          </div>
          <div className="orchestrator-card">
            <div className="orchestrator-top">
              <div className="agent-orb">
                <Icon name="spark" size={18} />
              </div>
              <div>
                <b>总控 Agent</b>
                <small>DSH / VIDEO DIRECTOR</small>
              </div>
              <span className="agent-health">NOMINAL</span>
            </div>
            <div className="orchestrator-line">
              <span>当前任务</span>
              <b>
                {generateStatus === "running"
                  ? "正在编排生成链路"
                  : generateStatus === "done"
                    ? "结果已回传，等待导出"
                    : "等待接收生成指令"}
              </b>
            </div>
            <div className="orchestrator-foot">
              <span>context window</span>
              <span>42% used</span>
              <div className="context-bar">
                <i />
              </div>
            </div>
          </div>
          <div className="subagent-heading">
            <span>SUB-AGENTS</span>
            <span>STATUS / LATENCY</span>
          </div>
          <div className="agent-table">
            <AgentRow
              icon="image"
              name="Asset Keeper"
              detail="资产一致性"
              status={hasCoreAssets ? "READY" : "WAIT"}
              latency={hasCoreAssets ? "0.2s" : "—"}
              ready={hasCoreAssets}
            />
            <AgentRow
              icon="wave"
              name="Motion Mapper"
              detail="动作映射"
              status={files.motion ? "READY" : "WAIT"}
              latency={files.motion ? "0.4s" : "—"}
              ready={Boolean(files.motion)}
            />
            <AgentRow
              icon="film"
              name="Scene Director"
              detail="镜头编排"
              status={
                generateStatus === "running"
                  ? "RUN"
                  : generateStatus === "done"
                    ? "DONE"
                    : "IDLE"
              }
              latency={generateStatus === "done" ? "2.8s" : "—"}
              ready={generateStatus !== "idle"}
              running={generateStatus === "running"}
            />
            <AgentRow
              icon="activity"
              name="QA Sentinel"
              detail="质量回传"
              status={generateStatus === "done" ? "PASS" : "WAIT"}
              latency={generateStatus === "done" ? "0.1s" : "—"}
              ready={generateStatus === "done"}
            />
          </div>
          <div className="skills-heading">
            <span>SKILL REGISTRY</span>
            <button>
              <Icon name="plus" size={13} /> 添加
            </button>
          </div>
          <div className="skill-list">
            <div>
              <span className="skill-dot orange" /> video-scene-consistency{" "}
              <b>ACTIVE</b>
            </div>
            <div>
              <span className="skill-dot green" /> hook-analyzer <b>READY</b>
            </div>
            <div>
              <span className="skill-dot gray" /> export-packager <b>STANDBY</b>
            </div>
          </div>
          <div className="control-note">
            <Icon name="cloud" size={15} />
            <div>
              <b>
                {realProvider ? "真实 Provider 模式" : "所有运行均为本地演示"}
              </b>
              <p>
                {taskError ||
                  (realProvider
                    ? "先预检输入与审批，再通过本地路由调用 LibTV CLI。"
                    : "Demo Adapter 不调用真实模型，结果仅用于体验状态流。")}
              </p>
            </div>
          </div>
        </aside>
      </main>

      <footer className="bottom-console">
        <div className="settings-block">
          <div className="footer-label">
            <span className="section-index">06</span>
            <b>生成设置</b>
          </div>
          {realProvider && (
            <>
              <div className="setting-field">
                <label>Provider</label>
                <div className="select-like style-select">
                  <select value={providerId} onChange={(event) => { setProviderId(event.target.value); setModelKey("") }}>
                    <option value="libtv-cli">LibTV CLI</option>
                    {providerOptions.filter((item) => item.providerId !== "libtv-cli").map((item) => <option key={item.providerId} value={item.providerId}>{item.displayName}</option>)}
                  </select>
                  <Icon name="chevron" size={13} />
                </div>
              </div>
              <div className="setting-field">
                <label>模型</label>
                <div className="select-like style-select">
                  <select value={modelKey} onChange={(event) => setModelKey(event.target.value)}>
                    <option value="">Provider 默认</option>
                    {providerOptions.find((item) => item.providerId === providerId)?.models?.map((model) => <option key={model.modelKey} value={model.modelKey}>{model.displayName}</option>)}
                  </select>
                  <Icon name="chevron" size={13} />
                </div>
              </div>
            </>
          )}
          <div className="setting-field">
            <label>时长</label>
            <div className="select-like">
              <select
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              >
                <option value="06">06 秒</option>
                <option value="08">08 秒</option>
                <option value="12">12 秒</option>
              </select>
              <Icon name="chevron" size={13} />
            </div>
          </div>
          <div className="setting-field">
            <label>质量</label>
            <div className="select-like">
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
              >
                <option>720p</option>
                <option>1080p</option>
                <option>4K</option>
              </select>
              <Icon name="chevron" size={13} />
            </div>
          </div>
          <div className="setting-field">
            <label>风格</label>
            <div className="select-like style-select">
              <select
                value={style}
                onChange={(event) => setStyle(event.target.value)}
              >
                <option>写实广告</option>
                <option>电影质感</option>
                <option>低多边形</option>
              </select>
              <Icon name="chevron" size={13} />
            </div>
          </div>
        </div>
        <div className="generation-action">
          <div className="generation-metadata">
            <span>
              <i className={hasCoreAssets ? "green-dot" : "orange-dot"} />{" "}
              {hasCoreAssets ? "核心资产就绪" : "建议补齐人物 / 产品 / 动作"}
            </span>
            <span>
              <Icon name="clock" size={13} />{" "}
              {realProvider ? "真实任务 · 轮询中" : "预计 30–60 秒"}
            </span>
          </div>
          <button
            className={`generate-button ${generateStatus === "running" ? "is-running" : ""}`}
            onClick={runGeneration}
            disabled={generateStatus === "running"}
          >
            <span className="generate-icon">
              {generateStatus === "running" ? (
                <span className="spinner" />
              ) : generateStatus === "done" ? (
                <Icon name="check" size={18} />
              ) : (
                <Icon name="play" size={16} />
              )}
            </span>
            <span>
              {generateStatus === "running"
                ? realProvider
                  ? "正在调用 LibTV…"
                  : "正在生成 Demo…"
                : generateStatus === "done"
                  ? realProvider
                    ? "再次运行真实任务"
                    : "再次运行 Demo"
                  : generateStatus === "failed"
                    ? "任务失败，重试"
                    : realProvider
                      ? "生成真实视频"
                      : "生成视频 Demo"}
            </span>
            <small>
              {realProvider
                ? "LOCAL DSH ROUTE / LIBTV"
                : "MOCK / NO REAL MODEL"}
            </small>
          </button>
        </div>
        <div
          className={`result-panel ${generateStatus === "done" ? "visible" : ""}`}
        >
          <div className="result-thumb">
            {generatedVideoUrl ? (
              <video
                src={generatedVideoUrl}
                controls
                preload="metadata"
                playsInline
                aria-label="生成视频预览"
              />
            ) : (
              <Icon name="play" size={15} />
            )}
          </div>
          <div className="result-copy">
            <span>RESULT / {generatedVideoUrl ? "LIBTV" : resultCode}</span>
            <b>
              {generateStatus === "done"
                ? generatedVideoUrl
                  ? "真实视频已回传"
                  : "Demo 视频已生成"
                : "暂无结果"}
            </b>
            <small>
              {generateStatus === "done"
                ? generatedVideoUrl
                  ? "点击播放器控制条播放；后端返回的视频地址已绑定预览区"
                  : "本地状态演示 · 未产生真实模型文件"
                : "点击生成后查看 QA 回传"}
            </small>
          </div>
          <div className="qa-summary">
            <div
              className="qa-summary-head"
              onClick={() => setQaExpanded((expanded) => !expanded)}
            >
              <span className="qa-pass">
                <Icon name="check" size={13} /> QA{" "}
                {generateStatus === "done" ? "PASS" : "PENDING"}
              </span>
              <Icon name="chevron" size={13} />
            </div>
            {qaExpanded && (
              <div className="qa-details">
                <span>
                  画幅 9:16 <b>PASS</b>
                </span>
                <span>
                  资产一致 <b>{generateStatus === "done" ? "PASS" : "—"}</b>
                </span>
              </div>
            )}
          </div>
          <a
            className="download-button"
            aria-disabled={!generatedVideoUrl}
            href={generatedVideoUrl || undefined}
            download={generatedVideoUrl ? "libtv-result.mp4" : undefined}
          >
            <Icon name="download" size={15} /> 导出
          </a>
        </div>
      </footer>
    </div>
  );
}

function MediaSlot({
  kind,
  label,
  meta,
  files,
  onSelect,
}: {
  kind: SlotKind;
  label: string;
  meta: string;
  files: Partial<Record<SlotKind, FileState>>;
  onSelect: (kind: SlotKind, file?: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = files[kind];
  const isAudio = kind === "audio";
  const isVideo = kind === "motion" || selected?.file.type.startsWith("video/");
  const accept = isAudio
    ? "audio/*"
    : kind === "motion"
      ? "video/*"
      : "image/*,video/*";
  return (
    <div className={`media-slot ${selected ? "has-file" : ""} ${kind}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => onSelect(kind, event.target.files?.[0])}
      />
      <button
        className="slot-trigger"
        onClick={() => inputRef.current?.click()}
        aria-label={`上传${label}`}
      >
        <span className="slot-index">
          {String(
            ["scene", "character", "product", "motion", "audio"].indexOf(kind) +
              1,
          ).padStart(2, "0")}
        </span>
        <span className="slot-preview">
          {!selected && (
            <Icon
              name={isAudio ? "mic" : isVideo ? "video" : "image"}
              size={18}
            />
          )}
          {selected && isAudio && <audio src={selected.url} controls />}
          {selected && !isAudio && !isVideo && (
            <img src={selected.url} alt={`${label}预览`} />
          )}
          {selected && isVideo && <video src={selected.url} muted />}
          {selected && (
            <span className="file-ready">
              <Icon name="check" size={11} />
            </span>
          )}
        </span>
        <span className="slot-copy">
          <b>{label}</b>
          <small>{selected ? selected.file.name : meta}</small>
          {selected && <em>{formatBytes(selected.file.size)} · LOCAL</em>}
        </span>
        <span className="slot-action">
          <Icon name={selected ? "refresh" : "upload"} size={14} />
        </span>
      </button>
    </div>
  );
}

function AgentRow({
  icon,
  name,
  detail,
  status,
  latency,
  ready,
  running = false,
}: {
  icon: IconName;
  name: string;
  detail: string;
  status: string;
  latency: string;
  ready: boolean;
  running?: boolean;
}) {
  return (
    <div className="agent-row">
      <div
        className={`agent-icon ${ready ? "ready" : ""} ${running ? "running" : ""}`}
      >
        <Icon name={icon} size={15} />
      </div>
      <div className="agent-name">
        <b>{name}</b>
        <small>{detail}</small>
      </div>
      <div
        className={`agent-status ${ready ? "ready" : ""} ${running ? "running" : ""}`}
      >
        <span>{status}</span>
        <small>{latency}</small>
      </div>
    </div>
  );
}

export default App;
