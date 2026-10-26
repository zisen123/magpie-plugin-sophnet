// SophNet 精选模型目录（20 个模型）。旧渠道数据来自本机实测表，
// 新渠道的协议与能力按精确 ID 单独验证；暂用估值不能视为实测上限。
//
// Prices CNY per M token (input / output / cache-read), 2026-09-16 snapshot
// cross-checked against the SophNet console service/all API. The four
// USD-billed models (gpt-5.5, gpt-5.4, gpt-5.3-codex, claude-opus-4-8) are
// USD × 7.1 estimates (est: true).
//
// Effort tiers are the 2026-09-13 measured sets (5 samples per tier,
// ~/sophnet-model-table data.json effort3): the "supported" list per model
// and channel. GLM always thinks — none/minimal/medium/xhigh are 400 (1210).

const R = (tiers) => ({ npm: "@ai-sdk/openai", wire: "responses", efforts: tiers })

const E_ALL = ["minimal", "low", "medium", "high", "xhigh", "max"]
const E_GLM = ["low", "high", "max"] // GLM always thinks: other tiers are 400 (1210)
const E_GPT = ["low", "medium", "high", "xhigh"] // OpenAI models refuse "max"

// id, name, context, output, cost [in, out, cached] CNY/M, est, images
const MODELS = [
  // 2026-10-20 官方公开 API（api/public/model-external-info）确认：
  // 1M 上下文、384K 输出、text+image、Tools、联网搜索、思考/非思考双模，
  // CNY 1/4/0.02（峰时 09:00-12:00、14:00-18:00 为 2/8/0.04）。
  // 直连实测：Responses 流式、函数调用、64x64 图片识别、none..max 全档通过
  // （none 产生 0 reasoning tokens）。2026-10-21 起作为主力通道。
  ["DeepSeek-V4.1-Flash-1017", "DeepSeek V4.1 Flash 1017", 1000000, 384000, [1, 4, 0.02], false, true],
  // 2026-10-23：授权 /v1/models 列出以下两个精确 ID，Responses low 短请求
  // 均返回 200/OK。作为备用通道保留；规格/价格沿用主力估值，最大输出、
  // 图片和完整 effort 档位未逐项验证，不能认定为同一上游或独立限流池。
  ["DeepSeek-V4.1-Flash-1017-global", "DeepSeek V4.1 Flash 1017 Global", 1000000, 384000, [1, 4, 0.02], true, true],
  ["DeepSeek-Flash-1017", "DeepSeek Flash 1017", 1000000, 384000, [1, 4, 0.02], true, true],
  ["GLM-5.3", "GLM 5.3", 1000000, 32000, [8, 28, 2], false, false],
  ["glm-5.3-flashx", "GLM 5.3 FlashX", 1000000, 32000, [0.8, 2.8, 0.23], false, true],
  // 2026-10-25 控制台 service/all 实价（CNY 13/68/1.3、26/136/1.3，无峰谷）。
  // 官方 supportedLlms 只列 ChatCompletion；responses 基础与流式实测也通，但
  // 沿用 chat wire（与 Kimi-K3 的生产路径一致）。纯文本，无图片理解；输出上限
  // 官方 chatParameters 为 1-48000（48000/64000 实测均被接受，取官方值）。
  // 实测 none..max 七档全部 200，none 档 0 reasoning tokens。
  ["kimi-k3.1-pro", "Kimi K3.1 Pro", 1000000, 48000, [13, 68, 1.3], false, false],
  ["kimi-k3.1-pro-highspeed", "Kimi K3.1 Pro Highspeed", 1000000, 48000, [26, 136, 1.3], false, false],

  // ---- next-gen (added 2026-10-12, wire-verified; prices = USD × 7.1 est) --
  // gpt-6.x on /responses (200 verified); claude-5.x on Anthropic Messages
  // (200 verified; /responses refuses them with 20004). gpt-6.1-sol tiers
  // probed on sophnet: low/medium/high/xhigh/max pass, minimal 400s.
  ["gpt-6.1-sol", "GPT-6.1 Sol", 1050000, 128000, [14.2, 71, 1.42], true, true],
  ["gpt-6-astra", "GPT-6 Astra", 1050000, 128000, [71, 355, 7.1], true, true],
  // Luna limits and USD price from models.dev; SophNet public pricing omits it.
  ["gpt-6-luna", "GPT-6 Luna", 1050000, 128000, [0.71, 3.55, 0.071], true, true],
  // 每个 Claude 家族独立组成 -cc → bare → -aws（Fable 另含 -awsb）渠道组；
  // 精确 ID 来自授权目录。价格按 2026-10-25 控制台 service/all 的 USD 标价
  // ×7.1 折算（est: true）：Fable 10/50/0.25、Sonnet 2/10/0.2、Opus 4/20/0.2。
  // 缓存命中价与旧估值不同，已按控制台更正。AWS 的 context_management 由
  // loader 剥离；基础短请求不代表长上下文、完整档位和工具续轮已通过。
  ["claude-fable-5-1-cc", "Claude Fable 5.1 (CC)", 1000000, 128000, [71, 355, 1.775], true, true],
  ["claude-fable-5-1", "Claude Fable 5.1", 1000000, 128000, [71, 355, 1.775], true, true],
  ["claude-fable-5-1-aws", "Claude Fable 5.1 (AWS)", 1000000, 128000, [71, 355, 1.775], true, true],
  ["claude-fable-5-1-awsb", "Claude Fable 5.1 (AWS B)", 1000000, 128000, [71, 355, 1.775], true, true],
  ["claude-sonnet-5-5-cc", "Claude Sonnet 5.5 (CC)", 1000000, 128000, [14.2, 71, 1.42], true, true],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5", 1000000, 128000, [14.2, 71, 1.42], true, true],
  ["claude-sonnet-5-5-aws", "Claude Sonnet 5.5 (AWS)", 1000000, 128000, [14.2, 71, 1.42], true, true],
  ["claude-opus-5-5-cc", "Claude Opus 5.5 (CC)", 1000000, 128000, [28.4, 142, 1.42], true, true],
  ["claude-opus-5-5", "Claude Opus 5.5", 1000000, 128000, [28.4, 142, 1.42], true, true],
  ["claude-opus-5-5-aws", "Claude Opus 5.5 (AWS)", 1000000, 128000, [28.4, 142, 1.42], true, true],
].map(([id, name, context, output, cost, est, images]) => {
  // wire per measured channel support: claude-* on Anthropic Messages
  // (20004 MODEL_NOT_SUPPORT on /responses); Kimi 系（含 kimi-k3.1-pro /
  // -highspeed）on Chat Completions — 旧 Kimi-K3 的 /responses 流式中途截断，
  // 新 ID 虽实测 responses 完整，仍沿用 chat 保持同一生产路径；
  // DeepSeek-V4.1-Flash-1017 的 Responses 2026-10-20 复测通过
  // （流式/图片/工具），与其余 GPT 系一样走 Responses。其余走 Responses。
  const wire = id.startsWith("claude") ? "anthropic" : /^kimi/i.test(id) ? "chat" : "responses"
  const npm = wire === "anthropic" ? "@ai-sdk/anthropic"
    : wire === "chat" ? "@ai-sdk/openai-compatible"
    : "@ai-sdk/openai"
  // V4.1 Flash: every tier passes SophNet's enum check, and none verified as
  // genuinely off (0 reasoning tokens) — unlike the retired Flash-1017, which
  // still thought ~1500 tokens at none.
  const efforts = id === "DeepSeek-V4.1-Flash-1017" || /^kimi/i.test(id) ? ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
    : id.startsWith("GLM") || id.startsWith("glm") ? E_GLM
    : id === "gpt-6.1-sol" || id === "gpt-6-astra" || id === "gpt-6-luna" ? ["low", "medium", "high", "xhigh", "max"] // verified on SophNet
    : id.startsWith("gpt-") ? E_GPT
    : wire === "anthropic" ? ["low", "medium", "high", "xhigh", "max"]
    : E_ALL
  return { id, name, npm, wire, efforts, context, output, cost, est, images }
})

export { MODELS }

export const byId = new Map(MODELS.map((m) => [m.id, m]))

// configModels builds the `models` map a config hook hands magpie.
export function configModels() {
  const out = {}
  for (const m of MODELS) {
    out[m.id] = {
      id: m.id,
      name: m.name,
      provider: { npm: m.npm, api: undefined }, // api comes from the loader's baseURL
      reasoning: m.efforts.length > 0,
      attachment: m.images,
      tool_call: true,
      temperature: true,
      modalities: { input: m.images ? ["text", "image"] : ["text"], output: ["text"] },
      cost: {
        input: m.cost[0],
        output: m.cost[1],
        cache_read: m.cost[2],
        ...(m.est ? { note: "USD × 7.1 estimate" } : {}),
      },
      limit: { context: m.context, output: m.output },
      variants: Object.fromEntries(m.efforts.map((e) => [e, {}])),
    }
  }
  return out
}
