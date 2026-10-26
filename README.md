# opencode-sophnet-auth

[SophNet](https://www.sophnet.com)（算能 AI 云）provider plugin for
[OpenCode](https://opencode.ai) and [magpie](https://usemagpie.ai)。
Provider id: `sophnet`。

一把 Access Token，接入 SophNet 的 **7 个国产模型通道**；模型目录以
`models.mjs` 为准：DeepSeek 3 条（主力 + 两条备用）、GLM 2 条、Kimi 2 条。
价格与能力中带估计的字段仍需按各渠道实测核对。

> 本分支（rls）**只保留国产模型**，不含 GPT、Claude 等国外模型。其余
> 未收录的模型（qwen 系、doubao 系、MiniMax、嵌入/图像/视频）也因无实测
> 数据未列入。要加模型，往 `models.mjs` 的 `MODELS` 表加一行。

## 安装

```bash
magpie plugin add opencode-sophnet-auth        # npm 包
magpie plugin add ~/github-projects/magpie-plugin-sophnet   # 本地目录
```

装好后执行 `magpie plugin login sophnet` 并粘贴 Access Token。

## 登录

- **SophNet Access Token**：sophnet.com 控制台 → API → Access Token。
  以 `Authorization: Bearer` 发送。

## 模型与协议

每个模型按精确渠道实测声明 wire（V4.1 Flash 1017 于 2026-10-20 核对）：

| 模型族 | wire | 端点 |
|---|---|---|
| DeepSeek / GLM | OpenAI Responses | `/responses` |
| kimi-k3.1-pro / kimi-k3.1-pro-highspeed | OpenAI Chat Completions | `/chat/completions` |

Kimi 沿用 chat wire：旧 Kimi-K3 的 `/responses` 会流式中途截断，新 ID
虽实测 responses 完整，仍保持同一生产路径。

`DeepSeek-V4.1-Flash-1017`（2026-10-21 起作为主力通道）的官方规格经
`api/public/model-external-info` 确认：1M
上下文、384K 输出、text+image、Function Calling、联网搜索、思考/非思考
双模式，价格 CNY 1/4/0.02（峰时 09:00-12:00、14:00-18:00 为 2/8/0.04）。
直连实测：Chat / Responses / Anthropic 三协议均 200；Responses 流式与
函数调用、`max_output_tokens=384000`、64×64 纯色图识别、
`none/minimal/max` 等档位均通过（`none` 为 0 reasoning tokens）。注意
模型会编造图片尺寸（问 64×64 图答 128×128/512×512），内容判断可靠但
分辨率元信息不可信；小图配小输出预算时思考可能吃光预算导致答错。

### Flash 备用通道（2026-10-23）

另保留 `DeepSeek-V4.1-Flash-1017-global` 与 `DeepSeek-Flash-1017`。
三个精确 ID 均出现在授权 `/v1/models`，Responses `low` 短请求均返回
200/OK；公开模型介绍页只列主力 ID，未说明三者是否同模型不同上游。
两个备用通道的窗口、输出、图片能力与价格暂沿用主力估值，完整档位
未逐项验收。不要把短请求成功当作这些上限已经实测。

本机 Magpie 另建 `group/deepseek-v4-flash`，显示名 `DeepSeek-V4-Flash`，
按主力 → global → 旧 Flash 顺序，`routing=order`、`stays=auto`。
不设 `listed=no`，避免影响旧任务。
普通 429 可能冷却整个 provider/key：当前请求仍可尝试后面的模型，
但全部失败后后续请求会减少冷却成员的探测；不能保证绕过共用 key
的整体限流，也不能在已开始输出内容后切换模型。

### Kimi 渠道组

`group/kimi-k3.1-pro`：pro → highspeed，`routing=order`、`listed=no`。

工作站客户端请求 `group/<id>`；办公机/NAS remote 请求
`server/group/<id>`。远端 caller key 只授权组 ID，组请求内部会放行
其成员；单渠道不再独立授权。

### 在别的 magpie 上复现这些组（可选）

组是 **magpie 实例配置**（`~/.config/magpie/providers.json` 的 `groups`），
不在 npm 包里；装完插件只会得到 7 个单模型。要同样的组入口，逐条执行：

```bash
magpie group add DeepSeek-V4-Flash models=sophnet/DeepSeek-V4.1-Flash-1017,sophnet/DeepSeek-V4.1-Flash-1017-global,sophnet/DeepSeek-Flash-1017 routing=order
magpie group add "Kimi K3.1 Pro"   models=sophnet/kimi-k3.1-pro,sophnet/kimi-k3.1-pro-highspeed routing=order listed=no
```

组 id 由显示名生成，执行后用 `magpie groups` 核对；与本机 id 不同时用
`magpie group set <id> id=<想要的id>` 调整。客户端请求 `group/<id>`。

## 内建的请求加固（Responses 出口）

- **工具 schema 保真**：函数工具显式设置 `strict: false`，保留原始
  `oneOf/anyOf/allOf`、枚举、正则、可选字段及字典定义。Responses 默认
  严格模式会改变可选字段语义，因此必须显式关闭。字符串与结构化消息
  的联合类型保持原样，适用于 Claude Code 的 `SendMessage` / `Agent`。
- **剥 `previous_response_id`**：SophNet 的 /responses 是有状态网关，按
  (model, org) 校验历史 response id，换模型/换 key 续会话会 400。
  请求的 input 数组本就携带完整对话，剥掉后总是安全。
- **历史工具 ID 隔离**：仅删除 `previous_response_id` 不够，SophNet
  还会根据历史 `call_id` 隐式续接旧 response。同一会话在工具调用后
  切换模型，可能报 `previous_response_id model mismatch`。
  插件按目标模型和原始 ID 确定性重映射 `function_call` 与
  `function_call_output` 的 `call_id`，保留配对和全部历史内容。
  不使用共享会话状态，也不改写响应中的新工具 ID；同模型重复回放
  保持稳定，跨模型使用不同 ID。当前修复仅处理 Responses 函数工具。

专项离线回归（仓库内）：`bun test responses-history.test.mjs`。覆盖模型切换、
切回原模型、并行工具、重复回放及 loader 的字符串／二进制请求。测试文件
不随 npm 包发布，见下方「回归测试」。

## 回归测试（在仓库内运行）

npm 包只含运行时代码（`index.mjs`、`models.mjs`），测试文件不发布。
需要验证时先 clone 仓库：

```bash
git clone https://github.com/zisen123/magpie-plugin-sophnet.git && cd magpie-plugin-sophnet
bun test                                            # 离线：目录不变式、schema、loader
SOPHNET_LIVE_TESTS=1 bun test schema.live.test.mjs  # 线上，会打真实网关
```

默认仅运行离线测试。线上验收通过本机 Magpie 的 `/v1/messages` 转译到
SophNet，交替测试 `SendMessage` 和 `Agent` 共 10 次，间隔至少 12 秒；
随后验证流式参数及工具结果续轮；只检查模型生成的参数，不执行工具，
会产生少量模型费用。
可用 `SOPHNET_TEST_GATEWAY` 和 `SOPHNET_TEST_GATEWAY_KEY` 指定测试网关。

## 思考档位

按 2026-09-13 实测（每档 5 次采样）声明：

- GLM 系**始终思考**：只有 `low/high/max`（发 none/minimal/medium/xhigh
  得 400「该模型始终思考」）
- kimi-k3.1-pro / -highspeed 七档全可用（2026-10-25 逐档实测，`none` 为 0
  reasoning tokens）；旧 Kimi-K3 同样全档
- DeepSeek-V4.1-Flash-1017 声明 `none/minimal/low/medium/high/xhigh/max`
  （2026-10-20 实测：`none` 产生 0 reasoning tokens，是真正的"不思考"档；
  非法值返回 400，说明上游校验枚举）

## 价格

`models.mjs` 里带 CNY/Mtok 价格（输入/输出/缓存命中），来自 SophNet
公开定价 API（2026-10-12 快照）。DeepSeek 两条备用通道沿用主力估值，
以 `est: true` 标注。

## 未收录的模型

嵌入（bge-m3/text-embeddings）、图像（Qwen-Image-Edit）、视频
（Wan2.2）、语音与其余 `-global` 镜像不在列表里；Flash 1017 global
作为编码模型的备用通道单独收录。
SophNet 上新模型后，往 `models.mjs` 的 `MODELS` 表加一行即可。

## 账号探测与失效标记（0.1.1）

`provider.models` 每次按账号向 SophNet 的 `/v1/models` 查询，再与内置
精选目录取交集：上游已下线的渠道不再出现在 picker 里。令牌被拒
（401/403）时插件抛出 `signIn: "expired"`，magpie 会提示重新登录；
网络失败或其他非 2xx 响应则回退到内置目录，不影响离线可用。
`auth.usage` 的余额查询同样把 401/403 报为登录失效。

## 登录态存哪

- OpenCode：`~/.local/share/opencode/auth.json`
- magpie：`~/.config/magpie/plugin-auth.json`（mode 600）

## 已知边界

- SophNet `/responses` 的档位可用性按上游副本有概率性抖动（实测同一
  档位 0–5/5 通过），档位表是 5/5 通过的保守集合。

## 变更记录

### 0.2.0（rls）

- **只保留国产模型**：删除全部 GPT-6.x 与 Claude 5.x 通道（13 个），
  目录从 20 个减到 7 个（DeepSeek ×3、GLM ×2、Kimi ×2）。
- 随之移除 Anthropic wire 相关代码（`ANTHROPIC_BASE`、adaptive thinking
  重写、`context_management` 剥离），loader 只处理 Responses；Kimi 仍走
  chat wire。
- 包描述改为国产模型口径。

### 0.1.1

- 移除会写请求正文到 `/tmp` 的 `SOPHNET_DEBUG` 调试残留（ESM 下还会抛
  `require is not defined`）。
- `provider.models` 改为按账号探测 `/v1/models`：令牌 401/403 标记为登录
  失效，其他失败回退内置目录，结果与精选目录取交集。
- `auth.usage` 对 401/403 返回 `signIn: "expired"`。
- 包图标改用 SVG（`https://www.sophnet.com/logo.svg`）。
- 描述不再写死模型数量。

### 0.1.0

- 首次发布：20 个模型通道，按 native wire 路由。
