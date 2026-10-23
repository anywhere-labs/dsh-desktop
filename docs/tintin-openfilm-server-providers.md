# TinTin 服务端 × OpenFilm Provider 兼容端点规格

状态:**asr + tts 已对齐并接线(门控默认关)** · 更新:2026-10-22 20:25 · 实测服务端版本 `imitate-milestone-20261014-57-g39c9a79d-dirty` · 关联:[tintin-openfilm-agent-alignment.md](tintin-openfilm-agent-alignment.md)、2026-10-18「服务端驱动 + 侧栏内嵌」用户裁决

## 1. 背景与机制

客户端把 TinTin 服务端注册为 OpenFilm 的 `custom[]` 自定义服务(`lib/openfilm/providers-seed.js`),但那只有 agent 主动 `openfilm get call` 才走;Studio 内建功能(时间线右键「生成字幕」、配音)读 provider 层(`keys`/`use`),服务端要以「服务商」身份出现在那里,只能走 OpenFilm 官方留的两条运行时自定义点(不改上游,vendored npm 包):

- 服务地址覆盖:`OPENFILM_OPENAI_URL`(`packages/openfilm/studio/server/providers/common.mjs:11-12`;OpenAI provider 的路径 `/v1/audio/*` 写死在源码,**必须挂 /v1**,v2 路径 OpenFilm 调不到)。
- key:env `OPENAI_API_KEY` 占位(`keys.mjs:100-114`;env key 尊重 Settings 里的 `off[]` 断开)。

## 2. 转录(字幕)— ✅ 已对齐,可用

`POST {server}/v1/audio/transcriptions`(2026-10-22 19:2x 实测,真实语音 248 KB wav):

- 请求 `multipart/form-data`:**`file`(必填)、`model`、`language`、`response_format` 均为 form 字段**(OpenAI 规范姿势;19:23 更新前它们只在 query 上,form 字段被忽略导致 OpenFilm 拿到裸字符串、字幕空转写 — 已修)。
- `response_format=verbose_json` 时 200 JSON:

```json
{
  "task": "transcribe", "language": null, "duration": 5.2,
  "text": "今天天气非常好,我们一起去公园散步,然后一起吃午饭。",
  "segments": [ { "id": 0, "start": 0.0, "end": 5.2, "text": "…" } ],
  "words": [ { "word": "今", "start": 0.301, "end": 0.442 }, … ]
}
```

- OpenFilm 侧解析(`openai.mjs:101-110`)只读 `text`/`words[]`/`duration`/`language` — `words` 逐字时间戳(WhisperX word_timestamps)与 `duration` 已在,**逐词字幕全链路可用**。
- 默认(`response_format=text`)返回 `text/plain` 纯文本 — 语义诚实。
- 鉴权:无墙(带 `Authorization: Bearer <占位>` 直通);`model` 字段被忽略(服务端固定 whisper-large-v3),可忽略。

## 3. 配音(TTS)— ✅ 已对齐

`POST {server}/v1/audio/speech`(JSON `{model, input, voice, response_format}`;端点走队列,转发 `/indextts/tts`):

- 2026-10-22 20:1x 实测:`response_format:'wav'` 生效(200 `audio/wav`,RIFF 头);显式缺省时回 OpenAI 默认的 mp3 — 与官方 API 语义一致(19:2x 曾误判为「回归」,根因是当时探测请求未带该字段,更正记录)。
- Studio 音色选择器传 OpenAI 静态音色名(如 `alloy`)→ 服务端优雅回落默认音色(200 WAV),不炸。
- OpenFilm 侧 `wavSeconds()` 从 WAV 字节解时长 — 时长进剪辑素材,字幕铺轨有据。
- 音色语义:选择器列出的是 OpenAI 音色名,与服务器声音样本库无对应 — 可用但名实不符;要让人在 Studio 里选真音色属上游扩展(custom provider 的 voices 动态列表),本期不做。

**`/v2/*` 观察**:同次更新服务端新开 `/v2/music`、`/v2/sound-generation`、`/v2/videos`、`/v2/videos/{id}`、`/v2/videos/{id}/content` — 是另一套媒体域(Sora 形状的视频作业面),与 OpenFilm 的 openai provider(`/v1` 音频)无交集;OpenFilm 的 video/music 走 fal/google provider,本期不涉及。

## 4. 客户端接线(已实现,门控默认关)

- 配置:`server.openfilmCompat`(布尔,默认 false,设置卡可改;[index.js](../../dsh-tintin-bundle/index.js) `TintinConfig`)。
- `server.openfilmCompat=true` 时:
  1. **隔离 home**(`$OPENFILM_HOME/providers.json`)seed `use.asr: 'openai'`(仅未设置时补,人的选择永不覆盖;共享 home 不动)([providers-seed.js](../../dsh-tintin-bundle/lib/openfilm/providers-seed.js) `mergeOpenaiCompat`);
  2. Studio 子进程注入 `OPENFILM_OPENAI_URL=<server.url>` + 占位 `OPENAI_API_KEY=tintin-server`([studio-runtime.js](../../dsh-tintin-bundle/lib/openfilm/studio-runtime.js) `studioEnv`);
  3. **让位保护**:本进程已有 `OPENAI_API_KEY`/`OPENFILM_OPENAI_URL`,或人在隔离 home 粘过真 openai key(`keys.openai`)时不注入 — file key 优先于 env,人的 key 必须去 api.openai.com 而非服务端。
- `tintin` custom service 保留,继续作为 agent 的 `get call` 兜底;agent 的 `openfilm get` CLI 环境(film-tools)本期不注入(agent 已有 tintin_* 工具)。

## 5. 验收清单

- [x] 服务端 asr:form 字段 + verbose_json `words`/`duration`(19:2x 实测通过)。
- [x] 服务端 tts:`response_format=wav` 生效、未知 voice 回落(20:1x 实测通过)。
- [x] 客户端:`corepack yarn workspace dsh-tintin-bundle test` 全绿(含 use 种入幂等、env 注入、双重让位保护;`OPENAI_COMPAT_VERBS=['asr','tts']`)。
- [ ] 端到端:开 `server.openfilmCompat` → 嵌入 Studio 选中带音频剪辑 → 生成字幕/配音,逐词时间轴正确,全程无 agent 会话请求。
- [x] vendored 运行时 0.2.2 → 0.2.5(fetch 脚本版本比对修复 + 重装 + 测试通过)。

## 6. 不做 / 风险

- 不写 `keys.openai` 到任何 providers.json(env 注入 + 让位保护,见 §4.3)。
- 不模拟 OpenAI chat/completions 给 agent(agent 是 DSH,模型由服务端下发,client.js 自动注册 `tintin-server` provider)。
- 25 MB 上限是 OpenFilm 客户端硬编码(`openai.mjs:34`),长片先切段。
- `/v2/*` 不接入;若未来要在 Studio 内直连服务端视频生成,须先核对 fal/google provider 的形状或另立 provider(上游议题)。
