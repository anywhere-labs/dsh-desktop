# comfygen 文生图/文生视频 服务端部署清单（路线 a）

- 日期：2026-10-19
- 目的：补齐《tintin-openfilm-agent-alignment.md》§2.4/§3 缺口——剪辑智能体的文生图/文生视频能力
- 现状基线：服务端 `/agent/registry` 39 项能力中已有 `product_image_generate`（产品图）与 `comfyui_workflow`（裸工作流提交），**无纯文生图/文生视频**；服务端 ComfyUI 0.30.0（仅本机可达，外部探不到端口）
- 原则：**零新开发**。全部节点代码/工作流组装/模型来自 `D:\ComfyUI-aki-v3`（ComfyUI v0.37.4，commit 8ff6dc384）已验证产物，本文只做"搬运+版本+登记"

---

## 1. 能力设计（最终形态）

| 能力 id | 端点 | 同步性 | 引擎链 | 说明 |
|---|---|---|---|---|
| `text2image` | `POST /comfygen/t2i` | sync（15-40s） | Klein-9B（FLUX.2）文生图，可带产品参考图 | prompt/ratio/ref_images |
| `text2video` | `POST /comfygen/t2v` | async（4-8min/镜） | 两段式：text2image 出首帧 → H3 i2v | prompt/duration(≤10s)/ratio/first_image 可选 |

- 两段式复用 comfygen 既有的 storyboard→frames→video 链路（质量闸门/单产品约束/负面词基线随链生效）
- 异步任务形态照抄现有 `storyboard_generate`/`vsr_remove` 模式，客户端已有 `tintin_task_status` 轮询

## 2. 服务器侧差距清单（按执行顺序）

### 2.1 ComfyUI 本体升级（前置，必做）
- 0.30.0 → ≥0.37.x。原因：Klein 链用到 `CLIPLoader type=flux2` 与 `ReferenceLatent`，均为新版核心节点，0.30 无此二者
- 参考版本：本机 v0.37.4（commit 8ff6dc384）实测可用

### 2.2 自定义节点
| 节点 | 用途 | 来源 |
|---|---|---|
| ComfyUI-WanVideoWrapper | H3 三节点（MiniMaxH3ImageToVideo / MiniMaxH3ReferenceToVideo 等） | 本机 custom_nodes 同版本 |
| ComfyUI-VideoHelperSuite | 视频落盘（VHS_VideoCombine） | 本机同版本 |
- 安装后注意各自 requirements 的 diffusers/transformers 版本与本机对齐

### 2.3 模型拷贝（最小集，约 46G）
| 文件 | 本机来源（ComfyUI\models\ 下） | 大小 | 目标目录 |
|---|---|---|---|
| flux-2-klein-9b-fp8.safetensors | diffusion_models\FLUX2-Klein\ | 8.8G | diffusion_models/FLUX2-Klein/ |
| qwen_3_8b_fp8mixed.safetensors | text_encoders\flux2_klein\ | 8.1G | text_encoders/flux2_klein/ |
| flux2-vae.safetensors | vae\ | 321M | vae/ |
| minimax_h3_ref2va_pruned_int8_convrot.safetensors | diffusion_models\ | 20G | diffusion_models/ |
| qwen3vl_8b_int8_convrot.safetensors | text_encoders\ | 8.8G | text_encoders/ |
- H3 备选：fl2va（首尾插值）/10Eros TURBO 各 20G，首期可不搬
- 以上以 `klein_scene.py` / `graphs_video.py` 内模型常量为最终准绳

### 2.4 tintin_comfygen 应用部署
- 整目录拷贝 `tintin_comfygen`（纯 Python FastAPI；`COMFY_URL` 指服务器本地 8188，端口 8190）
- 依赖：fastapi/uvicorn/pillow/av + aki python 或服务器 venv
- 部署后跑 `python -m pytest tests -q`（99 条，应全绿）

### 2.5 调度器显存预算登记（吸取 Ollama vram_mb=0 教训）
- comfyui 服务现有预算 8000MB → 按 t2i/t2v 分档：Klein 推理约 12G、H3 i2v 约 16G（3090 24G 单卡独占设计）
- ensure/unload 与其他 GPU0 服务互斥；H3 运行期间勿排 8G 以上邻任务

### 2.6 能力注册（服务端 /agent/registry +2 项）
```json
{"id":"text2image","method":"POST","path":"/comfygen/t2i","sync":true,
 "input_schema":{"prompt":"string","ratio":"9:16|16:9|1:1","ref_images":"url[] 可选"}}
{"id":"text2video","method":"POST","path":"/comfygen/t2v","sync":false,
 "input_schema":{"prompt":"string","duration":"number ≤10","ratio":"string","first_image":"url 可选"}}
```
- 客户端配套薄工具 `tintin_text2_image`/`tintin_text2_video` 加入 openfilm-tools.js（对齐文档 §2.4 缺口行同步销项）

### 2.7 冒烟测试（装完即验）
1. Klein 文生图：512×768、20 步，仅 prompt 无参考，出图即通
2. H3 i2v：用上一步产物作首帧，392×704×73 帧 fast 档出片即通

## 3. 分工

| 方 | 事项 |
|---|---|
| 本机（comfygen 侧，已完成/可随时产出） | 本清单、tintin_comfygen 打包、冒烟 workflow JSON、能力注册 JSON、客户端两工具代码 |
| 服务器（需 /home/freya 访问） | §2.1-2.2 升级与节点安装、§2.3 模型拷贝、§2.5-2.6 登记注册 |
| 若提供 SSH/远程访问 | 本机侧可代跑 §2 全部步骤并回执冒烟结果 |

## 4. 过渡方案（若服务器排期慢）
- /agent/registry 临时注册代理能力指向本机 `http://192.168.111.26:8190`（LAN 可达），先通智能体链路；服务器栈就绪后切回。缺点：可用性绑死本工作站，仅限过渡。
