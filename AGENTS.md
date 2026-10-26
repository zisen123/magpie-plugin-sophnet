# AGENTS.md

给在本仓库工作的 AI agent / 维护者的操作指南。目标：改动不破坏
magpie 与 OpenCode 两端的加载契约，不把密钥或对话内容带进包。

## 这是什么

`opencode-sophnet-auth`：SophNet（算能 AI 云）的 magpie / OpenCode
provider 插件。一把 Access Token 接入 20 个精选模型通道，每个模型走它
实际支持的协议：

| wire | npm | 端点 | 模型族 |
|---|---|---|---|
| `responses` | `@ai-sdk/openai` | `{BASE}/responses` | GPT-6.x、GLM、DeepSeek |
| `chat` | `@ai-sdk/openai-compatible` | `{BASE}/chat/completions` | kimi-k3.1-pro / -highspeed |
| `anthropic` | `@ai-sdk/anthropic` | `{BASE}/anthropic/v1/messages` | claude-* |

`BASE = https://www.sophnet.com/api/open-apis/v1`。Claude 在 `/responses`
上确定性返回 20004 `MODEL_NOT_SUPPORT`，wire 分流是硬需求。

## 分支策略

- `master`：**对外脱敏版**，只保留国产模型。GitHub 默认分支，也是 npm
  发布版。
- `full`：**本地完整版**，含 GPT / Claude 等国外模型。本机 magpie 默认
  加载这个分支的工作目录。
- `rls`：与 master 同内容的别名分支，保留用于旧引用，不再单独维护。

改动规则：

1. 新增/修改模型或协议逻辑，先在 `full` 上验证、跑测试、本机实测；
2. 确认后把同样的改动同步到 `master`，并按脱敏口径去掉国外模型；
3. 发布：`git checkout master` → bump 版本 → `npm publish` → Staged Approve；
4. 不要让 `full` 直接覆盖 `master`，也不要把 `master` merge 回 `full`。

## 结构

```
index.mjs           插件入口：config / auth(config+usage+loader) / provider.models
models.mjs          MODELS 表 + configModels()（config 钩子的简写结构）
index.test.mjs      离线单测（目录不变式 + schema + loader）
responses-history.test.mjs  call_id 重映射专项
schema-fixtures.mjs / schema.live.test.mjs  真实工具 schema 与线上探针
README.md           用户文档
package.json        main + files + magpie.icon/maxConcurrency
```

`files` 只发布 `index.mjs` / `models.mjs` / `README.md`。测试文件**不进包**，
README 的测试命令都标注了「仓库内运行」。

## 加载契约（不要破坏）

- 入口只有命名导出 `SophnetAuthPlugin = async () => ({...})`。官方规则：
  **模块导出的每个函数都会被当作插件调用**；普通对象（无 `server`）不会。
  辅助内容只能放在 `_internal` 里，测试从那里取。
- `config` 用 `??=` 空值初始化，不能覆盖用户已有配置。
- `provider.models(provider, { auth })` 必须返回 **ID-keyed 的 OpenCode
  Model 对象 map**，不是 config 的简写结构。最稳的做法是展开
  `provider.models` 条目再改字段。
- `auth.loader` 返回 `{ baseURL, apiKey, fetch }`。自定义 `fetch` 必须保留
  `init.signal` / `Request.signal`；改写请求体后删除 `content-length`
  （若上游 body 可能被压缩，还要删 `content-encoding`）。
- 令牌被拒时用 `throw Object.assign(new Error(...), { signIn: "expired" })`；
  `auth.usage` 里返回 `{ signIn: "expired" }`。不要把它降级成普通 error。
- 不要在插件里 `require()`：这是 ESM。需要 Node API 用 `import`。
- 不要把请求正文/对话内容写盘或打日志。

## loader 的请求加固（Responses 出口）

按顺序，全部在 `hardenResponses()`：

1. 函数工具强制 `strict: false`，原始 JSON Schema 一字不改
2. 删除 `previous_response_id`
3. 按 `(model, call_id)` 确定性重映射 `function_call` /
   `function_call_output` 的 `call_id`（避免切模型后 400）
4. Kimi 系剥 `reasoning.summary`（SophNet Go 网关严格反序列化拒绝）

Anthropic 出口（`stripContextManagement` / `rewriteAdaptiveThinking`）：

- `-aws` / `-awsb` 渠道剥 `context_management`（Bedrock 后端不接受）
- claude >= 4.6 的旧式 `thinking.enabled + budget_tokens` 改成
  `thinking.adaptive + output_config.effort`

这些是生产路径，改之前先跑 `bun test`，再按下方线上流程验收。

## 模型目录维护

`models.mjs` 的 `MODELS` 每行：

```
[id, name, context, output, cost[in,out,cacheRead] CNY/M, est, images]
```

- `wire` / `npm` / `efforts` 由 id 前缀推导，新增模型先确认它属于哪条
  wire，再决定要不要加特例
- effort 档位只能是实测通过的集合：GLM 仅 low/high/max（始终思考），
  gpt-5.x 无 max，gpt-6.x 有 max 无 minimal，claude-5.x low..max
- `est: true` 表示 USD × 7.1 估值，不要写成实测
- 价格单位是 **CNY / 百万 token**；峰谷价写在注释里
- `.test.mjs` 的目录不变式会校验 wire↔npm、Claude 不走 responses、
  GLM 档位、模型总数；改目录后同步改断言

加模型的最低验证：`/v1/models` 里出现该精确 ID + 对应 wire 一次小请求
200。不要凭模型名猜 wire 或上限。

## 测试

```bash
bun test                                   # 离线，必须全绿
SOPHNET_LIVE_TESTS=1 bun test schema.live.test.mjs   # 线上，会花钱
```

线上探针要**间隔 ≥ 10–12 秒、N ≥ 10**：密集请求会触发 SophNet WAF，
之后所有请求都变成 400「请求参数有误」+ 连接重置，冷却分钟级自愈。
单次失败不能当结论。

隔离调试（不经 magpie）：

```bash
~/.cache/magpie/bun/*/magpie-bun -e 'import(...).then(...)'
```

## 发布

```bash
npm version patch        # 或手改 package.json
npm publish --access public
```

- npm 账号是 `zisen`，发布需要 **Granular Access Token 勾选
  "Bypass two-factor authentication when publishing"**；Classic /
  Automation token 会 403
- npm 11 的 staged publishing：publish 成功后 registry 只显示
  `0.0.0-stage` 占位，必须到 npmjs.com → Staged Packages → Approve
  （或 npm ≥ 11.15 的 `npm stage approve`）才真正发布
- npm search 索引比 registry 慢，几小时到几天；magpie 插件页搜索依赖它，
  但 `magpie plugin add <包名>` 不依赖
- 发布前自查：`npm pack --dry-run` 的 4 个文件里没有 `.npmrc`、key、
  测试文件；`package.json` 的 description/version/icon 是最新的

## 本地接入与热重载

```bash
magpie plugin add ~/github-projects/magpie-plugin-sophnet
magpie plugin login sophnet            # key 走 stdin
magpie provider test sophnet
magpie plugin off <path> && magpie plugin on <path>   # 改代码后
```

本机 daemon 常驻 `3425`，web 在 `3430`。不要用 `pgrep -f "magpie web ..."`
取 pid（会匹配到执行命令的 shell 自身），用
`ps -eo pid=,args= | awk` 按可执行文件精确匹配。

## 已知坑

1. **组不在包里**。`group/*` 是 magpie 实例配置（`providers.json` 的
   `groups`），插件只能声明 provider + models。README 里有 `magpie group add`
   复现命令。
2. 节流污染：见「测试」。探测失败先等冷却，不要改代码。
3. `magpie provider rm <name>` 按**显示名**匹配，手工 provider 叫 sophnet
   时会误删插件。
4. `magpie claude` 会重写 `~/.claude/settings.json`：tier 变量和 discovery
   flag 会复活，手改要复查。
5. 远端 magpie 的模型列表是工作站 caller-key 授权的交集；没授权的新 id
   远端刷不出来。
6. 图标必须 HTTPS、≤ 1 MB；`.ico` 未在官方文档中确认，优先 SVG/PNG。
7. 上游图片最小 10×10 px；小图 + 小输出预算会被思考吃光预算。
8. `env.SOPHNET_DEBUG` 这类调试开关不要留：ESM 里 `require` 未定义，
   且写盘会把对话正文带到 `/tmp`。
