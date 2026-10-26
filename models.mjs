// SophNet 国产模型目录（7 个通道）。渠道数据来自本机实测表，协议与能力
// 按精确 ID 单独验证；暂用估值不能视为实测上限。
//
// Prices CNY per M token (input / output / cache-read), 2026-09-16 snapshot
// cross-checked against the SophNet console service/all API. Channels whose
// pricing was projected are marked (est: true).
//
// Effort tiers are the 2026-09-13 measured sets (5 samples per tier,
// ~/sophnet-model-table data.json effort3): the "supported" list per model
// and channel. GLM always thinks — none/minimal/medium/xhigh are 400 (1210).

const R = (tiers) => ({ npm: "@ai-sdk/openai", wire: "responses", efforts: tiers })

const E_ALL = ["minimal", "low", "medium", "high", "xhigh", "max"]
const E_GLM = ["low", "high", "max"] // GLM always thinks: other tiers are 400 (1210)

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
].map(([id, name, context, output, cost, est, images]) => {
  // wire per measured channel support: Kimi 系（含 kimi-k3.1-pro /
  // -highspeed）on Chat Completions — 旧 Kimi-K3 的 /responses 流式中途截断，
  // 新 ID 虽实测 responses 完整，仍沿用 chat 保持同一生产路径；
  // DeepSeek-V4.1-Flash-1017 的 Responses 2026-10-20 复测通过
  // （流式/图片/工具）。其余走 Responses。
  const wire = /^kimi/i.test(id) ? "chat" : "responses"
  const npm = wire === "chat" ? "@ai-sdk/openai-compatible" : "@ai-sdk/openai"
  // V4.1 Flash: every tier passes SophNet's enum check, and none verified as
  // genuinely off (0 reasoning tokens) — unlike the retired Flash-1017, which
  // still thought ~1500 tokens at none.
  const efforts = id === "DeepSeek-V4.1-Flash-1017" || /^kimi/i.test(id) ? ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
    : id.startsWith("GLM") || id.startsWith("glm") ? E_GLM
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
