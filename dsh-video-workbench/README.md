# DSH Video Workbench

架构、服务、LibTV CLI、Skills、文件与验收枚举见：[VIDEO_WORKBENCH_ARCHITECTURE.md](./docs/VIDEO_WORKBENCH_ARCHITECTURE.md)。

一个独立的 React + TypeScript + Vite 前端工作台 Demo，用于演示「素材输入 → 导演 Prompt → Agent 编排 → 结果 / QA 回传」的视频生产控制台。

> 前端仍可独立运行 MOCK Demo；连接后端时，必须通过 `?api=http://127.0.0.1:8080&provider=libtv` 明确进入真实 Provider 模式。后端默认 LibTV CLI 优先，第三方 API 只从 `VIDEO_PROVIDER_CONFIG_FILE` 读取白名单配置，凭据只允许通过环境变量引用。发布平台仍需人工确认。

## 启动

需要 Node.js 22+：

```bash
cd /Volumes/SSK\ SSD/deepseek\ harness\ 桌面端/dsh-video-workbench
npm install
npm run dev
```

然后打开终端提示的本地地址。生产构建与预览：

```bash
npm run build
npm run preview
```

## Demo 交互

- 顶部可切换抖音、小红书、视频号，运行热点抓取与 Hook 分析的本地 UI 状态。
- 左侧 5 个槽位支持本地图片、视频、音频选择和浏览器内预览。
- 中央预览固定为 9:16，时间轴、Prompt 和素材状态会随输入更新。
- 底部「生成视频 Demo」按阶段推进：资产预检 → 动作重定向 → 镜头合成 → QA 回传。
- 结束后展示 `MOCK-...` 结果编号、QA 状态与禁用/可用的导出按钮；该结果不是模型文件。

## GitHub Pages

构建产物位于 `dist/`，Vite 已配置 `base: './'`，可将 `dist/` 作为 GitHub Pages 的静态发布目录。该目录刻意不依赖根仓库的 workspace、配置或上游 `deepseek-harness/`。

## 后端

```bash
cd /Volumes/SSK\ SSD/deepseek\ harness\ 桌面端/dsh-video-workbench
python3.12 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
PYTHONPATH=server VIDEO_WORKBENCH_STATE_DIR="$PWD/.video-workbench" \
  .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8080
```

后端会在 state directory 建立 SQLite、任务事件、素材清单、provider receipt、artifact manifest 和 Skill2Loop episode。第三方 provider 的示例配置在 `server/providers.example.json`，复制后通过 `VIDEO_PROVIDER_CONFIG_FILE` 指向，并设置对应 `credentialRef` 环境变量；示例配置默认关闭。
