// SophNet model catalog — the 13 models of the local measured table
// (~/sophnet-model-table, the data source behind the model-info skill):
// every model here has measured speed / cache-hit / effort-tier / price data.
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
  ["DeepSeek-Flash", "DeepSeek Flash", 1000000, 32000, [1, 4, 0.02], false, false],
  ["DeepSeek-V4-Flash-Vision-Exp", "DeepSeek V4 Flash Vision Exp", 1000000, 32000, [1, 4, 0.02], false, true],
  ["DeepSeek-V4-Pro-0813", "DeepSeek V4 Pro 0813", 1000000, 32000, [4.5, 13.5, 0.15], false, false],
  ["GLM-5.3", "GLM 5.3", 1000000, 32000, [8, 28, 2], false, false],
  ["glm-5.3-flash", "GLM 5.3 Flash", 1000000, 32000, [0.8, 2.8, 0.23], false, true],
  ["glm-5.3-flashx", "GLM 5.3 FlashX", 1000000, 32000, [0.8, 2.8, 0.23], false, true],
  ["qwen3.8-flash", "Qwen3.8 Flash", 1000000, 64000, [0.8, 2.7, 0.1], false, true],
  ["qwen3.8-max-0902", "Qwen3.8 Max 0902", 1000000, 64000, [12, 36, 1.5], false, true],
  ["Kimi-K3", "Kimi K3", 1000000, 64000, [20, 100, 2], false, true],
  ["claude-opus-4-8-aws", "Claude Opus 4.8 (AWS)", 1000000, 64000, [35.5, 177.5, 3.55], true, true],

  // ---- next-gen (added 2026-10-12, wire-verified; prices = USD × 7.1 est) --
  // gpt-6.x on /responses (200 verified); claude-5.x on Anthropic Messages
  // (200 verified; /responses refuses them with 20004). gpt-6.1-sol tiers
  // probed on sophnet: low/medium/high/xhigh/max pass, minimal 400s.
  ["gpt-6.1-sol", "GPT-6.1 Sol", 1050000, 128000, [14.2, 71, 1.42], true, true],
  ["gpt-6-astra", "GPT-6 Astra", 1050000, 128000, [71, 355, 7.1], true, true],
  ["claude-fable-5-1-aws", "Claude Fable 5.1 (AWS)", 1000000, 128000, [71, 355, 7.1], true, true],
  ["claude-sonnet-5-5-aws", "Claude Sonnet 5.5 (AWS)", 1000000, 128000, [14.2, 71, 1.42], true, true],
  ["claude-opus-5-5-aws", "Claude Opus 5.5 (AWS)", 1000000, 128000, [28.4, 142, 2.84], true, true],
].map(([id, name, context, output, cost, est, images]) => {
  // wire per measured channel support: claude-* on Anthropic Messages
  // (20004 MODEL_NOT_SUPPORT on /responses); Kimi-K3 on Chat Completions —
  // measured 2026-10-12: its /responses streams end mid-reply through the
  // plugin ("the reply ended before it was complete") while chat is
  // stable; everything else Responses
  const wire = id.startsWith("claude") ? "anthropic" : id === "Kimi-K3" ? "chat" : "responses"
  const npm = wire === "anthropic" ? "@ai-sdk/anthropic"
    : wire === "chat" ? "@ai-sdk/openai-compatible"
    : "@ai-sdk/openai"
  const efforts = id.startsWith("GLM") || id.startsWith("glm") ? E_GLM
    : id === "gpt-6.1-sol" || id === "gpt-6-astra" ? ["low", "medium", "high", "xhigh", "max"] // probed; minimal 400
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
