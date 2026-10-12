# opencode-sophnet-auth

[SophNet](https://www.sophnet.com)（算能 AI 云）provider plugin for
[OpenCode](https://opencode.ai) and [magpie](https://usemagpie.ai)。
Provider id: `sophnet`。

一把 Access Token，接入 SophNet 的 **18 个模型**（13 个本地实测 + 5 个 2026-10-12 新上架的 next-gen）（与本地实测表
`~/sophnet-model-table` 一致——每个模型都有实测的速度/缓存命中/effort
档位/价格数据）；每个模型走它自己支持的协议 wire，magpie 网关负责把任意
agent 的请求翻译过去。

> 有意不收录其余 ~120 个模型（gpt-5.2 及以下、gemini 系、qwen3.5/3.6/3.7
> 系、doubao 系、MiniMax、Hy3、嵌入/图像/视频模型）：无实测数据，无使用
> 计划。要加回某个模型，往 `models.mjs` 的 `MODELS` 表加一行即可。

## 登录

- **SophNet Access Token**：sophnet.com 控制台 → API → Access Token。
  以 `Authorization: Bearer` 发送。

## 模型与协议

每个模型按实测声明 wire（2026-10-12 核对）：

| 模型族 | wire | 端点 |
|---|---|---|
| GPT-5.x / GPT-6.x / Kimi-K3 / DeepSeek / GLM / Qwen3.8 | OpenAI Responses | `/responses` |
| claude-opus-4-8 / 5-5、claude-sonnet-5-5、claude-fable-5-1 | Anthropic Messages | `.../anthropic/v1/messages` |

Claude / Gemini 模型在 `/responses` 上返回 20004 `MODEL_NOT_SUPPORT`
（实测），所以按 wire 分流是必需的，不是偏好。

## 内建的请求加固（Responses 出口）

- **工具 schema 消毒**：折叠 `oneOf/anyOf/allOf`（标量分支收敛、
  nullable 写进 description）、每个 object 节点补
  `properties`/`additionalProperties:false`/全量 `required`、剥掉
  `strict` 键——对宽松上游是无操作，对严格副本防 400「请求参数有误」。
- **剥 `previous_response_id`**：SophNet 的 /responses 是有状态网关，按
  (model, org) 校验历史 response id，换模型/换 key 续会话会 400。
  请求的 input 数组本就携带完整对话，剥掉后总是安全。

## 思考档位

按 2026-09-13 实测（每档 5 次采样）声明：

- GLM 系**始终思考**：只有 `low/high/max`（发 none/minimal/medium/xhigh
  得 400「该模型始终思考」）
- GPT 系拒 `max`，只到 `xhigh`
- DeepSeek-V4-Flash(-0731/Vision-Exp)、Kimi-K3、qwen3.8 系全档可用
- MiniMax-M3 只有 `high`；M2.x 无档位细分

## 价格

`models.mjs` 里带 CNY/Mtok 价格（输入/输出/缓存命中），来自 SophNet
公开定价 API（2026-10-12 快照）。gpt/claude/gemini 系 SophNet 按 USD
计价，表里是 ×7.1 折算的估计值。

## 未收录的模型

嵌入（bge-m3/text-embeddings）、图像（Qwen-Image-Edit）、视频
（Wan2.2）、语音与 `-global` 镜像不在列表里：它们不是编码对话模型。
SophNet 上新模型后，往 `models.mjs` 的 `MODELS` 表加一行即可。

## 登录态存哪

- OpenCode：`~/.local/share/opencode/auth.json`
- magpie：`~/.config/magpie/plugin-auth.json`（mode 600）

## 已知边界

- gemini wire 的根地址（`.../open-apis/google`）未实测，Gemini 系模型
  标注为尽力支持；claude 系 anthropic wire 已实测可用。
- SophNet `/responses` 的档位可用性按上游副本有概率性抖动（实测同一
  档位 0–5/5 通过），档位表是 5/5 通过的保守集合。
