// SophNet model catalog.
//
// Sources, in order of authority:
//   - prices CNY: SophNet public pricing API via the model-info skill
//     (~/.claude/skills/model-info), 2026-10-12 snapshot
//   - prices of USD-billed models (gpt/claude/gemini on SophNet): SophNet
//     marks them in USD; the CNY here is USD × 7.1, `est: true` marks the
//     estimate
//   - context/output limits: model-info + measured (~/sophnet-model-table)
//   - reasoning efforts per wire: measured 2026-09-13, 5 samples per tier
//     (~/sophnet-model-table data.json effort3) — tier availability is
//     probabilistic per replica; the lists here are the tiers that passed
//     5/5, plus flaky ones only where no better set exists
//
// wire is the API the model speaks on SophNet:
//   - "responses":  POST {base}/responses            (OpenAI family)
//   - "chat":       POST {base}/chat/completions     (OpenAI family)
//   - "anthropic":  POST {anthropicBase}/v1/messages (Claude family)
//   - "gemini":     POST {geminiBase}/models/{id}:streamGenerateContent
//
// claude/gemini ids are refused on /responses with 20004 MODEL_NOT_SUPPORT
// (measured), so each model goes on its own wire. OpenAI-family models all
// answer /responses (measured 2026-10-12, including DeepSeek-V4-Pro-0813).

const R = (tiers) => ({ npm: "@ai-sdk/openai", wire: "responses", efforts: tiers })
const C = (tiers) => ({ npm: "@ai-sdk/openai-compatible", wire: "chat", efforts: tiers })
const A = (tiers) => ({ npm: "@ai-sdk/anthropic", wire: "anthropic", efforts: tiers })
const G = (tiers) => ({ npm: "@ai-sdk/google", wire: "gemini", efforts: tiers })

const E_ALL = ["minimal", "low", "medium", "high", "xhigh", "max"]
const E_GLM = ["low", "high", "max"] // GLM always thinks: none/minimal/medium/xhigh are 400 (1210)
const E_GPT = ["low", "medium", "high", "xhigh"] // OpenAI models refuse "max"

// id, name, wire, context, output, cost [in, out, cached] CNY per M, est, images
const MODELS = [
  // ---- OpenAI family: Responses wire -------------------------------------
  ["gpt-5.5", "GPT-5.5", R(E_GPT), 1100000, 128000, [35.5, 213, 3.55], true, true],
  ["gpt-5.4", "GPT-5.4", R(E_GPT), 922000, 128000, [17.8, 106.5, 1.77], true, true],
  ["gpt-5.3-codex", "GPT-5.3 Codex", R(E_GPT), 400000, 128000, [12.4, 99.4, 1.24], true, true],
  ["gpt-5.2", "GPT-5.2", R(E_GPT), 400000, 128000, null, true, true],
  ["gpt-5.1", "GPT-5.1", R(E_GPT), 400000, 128000, null, true, true],
  ["gpt-5", "GPT-5", R(E_GPT), 400000, 128000, null, true, true],
  ["Kimi-K3", "Kimi K3", R(E_ALL), 1000000, 64000, [20, 100, 2], false, true],
  ["Kimi-K2.7-Code", "Kimi K2.7 Code", R([]), 256000, 64000, [6.5, 27, 1.3], false, true],
  ["Kimi-K2.6", "Kimi K2.6", R(["low", "high", "max"]), 256000, 64000, [6.5, 27, 1.1], false, true],
  ["Kimi-K2.5", "Kimi K2.5", R(["low", "high", "max"]), 256000, 64000, [4, 21, 0.7], false, true],
  ["DeepSeek-V4-Pro", "DeepSeek V4 Pro", R(E_GLM), 1000000, 32000, [12, 24, 1], false, false],
  ["DeepSeek-V4-Pro-0813", "DeepSeek V4 Pro 0813", R(E_ALL), 1000000, 32000, [4.5, 13.5, 0.15], false, false],
  ["DeepSeek-V4-Pro-global", "DeepSeek V4 Pro Global", R(E_GLM), 1000000, 32000, null, false, false],
  ["DeepSeek-V4-Flash", "DeepSeek V4 Flash", R(E_GLM), 1000000, 32000, [1, 2, 0.02], false, false],
  ["DeepSeek-V4-Flash-0731", "DeepSeek V4 Flash 0731", R(E_GLM), 1000000, 32000, [1, 4, 0.02], false, true],
  ["DeepSeek-Flash", "DeepSeek Flash", R(E_GLM), 1000000, 32000, [1, 4, 0.02], false, false],
  ["DeepSeek-V4-Flash-Vision-Exp", "DeepSeek V4 Flash Vision Exp", R(E_ALL), 1000000, 32000, [1, 4, 0.02], false, true],
  ["DeepSeek-V3.2", "DeepSeek V3.2", R([]), 128000, 32000, null, false, false],
  ["GLM-5.3", "GLM 5.3", R(E_GLM), 1000000, 32000, [8, 28, 2], false, true],
  ["glm-5.3-flash", "GLM 5.3 Flash", R(E_GLM), 1000000, 32000, [0.8, 2.8, 0.23], false, true],
  ["glm-5.3-flashx", "GLM 5.3 FlashX", R(E_GLM), 1000000, 32000, [0.8, 2.8, 0.23], false, true],
  ["GLM-5.2", "GLM 5.2", R(["high", "max"]), 1000000, 32000, [8, 28, 2], false, true],
  ["GLM-5.1", "GLM 5.1", C(["low", "high", "max"]), 200000, 32000, [8, 28, 2], false, false],
  ["GLM-5", "GLM 5", C(["low", "high", "max"]), 200000, 32000, [6, 22, 1.5], false, false],
  ["GLM-5-Turbo", "GLM 5 Turbo", C(["low", "high", "max"]), 200000, 32000, [7, 26, 1.8], false, false],
  ["qwen3.8-max-0902", "Qwen3.8 Max 0902", R(E_ALL), 1000000, 64000, [12, 36, 1.5], false, true],
  ["qwen3.8-max", "Qwen3.8 Max", R(E_ALL), 1000000, 64000, null, false, true],
  ["qwen3.8-flash", "Qwen3.8 Flash", R(E_ALL), 1000000, 64000, [0.8, 2.7, 0.1], false, true],
  ["qwen3.8-27b", "Qwen3.8 27B", R(["low", "medium", "xhigh"]), 1000000, 64000, [3, 12, 0.6], false, false],
  ["qwen3.7-max", "Qwen3.7 Max", R(E_ALL), 1000000, 64000, [6, 18, 1.2], false, true],
  ["qwen3.6-max-preview", "Qwen3.6 Max Preview", R(E_ALL), 256000, 64000, [15, 90, 3], false, true],
  ["qwen3.6-plus", "Qwen3.6 Plus", R(E_ALL), 1000000, 64000, [8, 48, 1.6], false, true],
  ["qwen3.6-flash", "Qwen3.6 Flash", R(E_ALL), 1000000, 64000, [4.8, 28.8, 0.96], false, true],
  ["qwen3.5-plus", "Qwen3.5 Plus", R(E_ALL), 1000000, 64000, null, false, true],
  ["qwen3.5-flash", "Qwen3.5 Flash", R(E_ALL), 1000000, 64000, null, false, true],
  ["MiniMax-M3", "MiniMax M3", R(["high"]), 512000, 64000, [4.2, 16.8, 0.84], false, true],
  ["MiniMax-M2.7", "MiniMax M2.7", R([]), 200000, 64000, [2.1, 8.4, 0.42], false, true],
  ["MiniMax-M2.5", "MiniMax M2.5", R([]), 200000, 64000, [2.1, 8.4, 0.21], false, true],
  ["Hy3", "Hunyuan Hy3", R(["low", "high"]), 256000, 32000, [1, 4, 0.25], false, false],
  ["Hy3-preview", "Hunyuan Hy3 Preview", R(["low", "medium", "high"]), 256000, 32000, [2, 8, 0.8], false, false],
  ["mimo-v2.5-pro", "MiMo V2.5 Pro", R([]), 256000, 32000, null, false, false],

  // ---- Claude family: Anthropic wire -------------------------------------
  ["claude-opus-4-8", "Claude Opus 4.8", A(["low", "medium", "high", "xhigh"]), 1000000, 64000, [35.5, 177.5, 3.55], true, true],
  ["anthropic.claude-opus-4-8", "Claude Opus 4.8 (anthropic.)", A(["low", "medium", "high", "xhigh"]), 1000000, 64000, [35.5, 177.5, 3.55], true, true],
  ["claude-opus-4-7", "Claude Opus 4.7", A(["low", "medium", "high", "xhigh"]), 1000000, 64000, null, true, true],
  ["claude-opus-4-6", "Claude Opus 4.6", A(["low", "medium", "high", "xhigh"]), 1000000, 64000, null, true, true],
  ["anthropic.claude-opus-4-6", "Claude Opus 4.6 (anthropic.)", A(["low", "medium", "high", "xhigh"]), 1000000, 64000, null, true, true],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6", A(["low", "medium", "high", "xhigh"]), 1000000, 64000, null, true, true],
  ["claude-haiku-4-5-20251001", "Claude Haiku 4.5", A(["low", "medium", "high"]), 200000, 64000, null, true, true],

  // ---- Gemini family: Gemini wire ----------------------------------------
  ["gemini-3.5-flash", "Gemini 3.5 Flash", G(["low", "high"]), 1000000, 64000, null, true, true],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", G(["low", "high"]), 1000000, 64000, null, true, true],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", G(["low", "high"]), 1000000, 64000, null, true, true],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview", G(["low", "high"]), 1000000, 64000, null, true, true],
  ["gemini-2.5-pro", "Gemini 2.5 Pro", G(["low", "high"]), 1000000, 64000, null, true, true],
].map(([id, name, w, context, output, cost, est, images]) => ({
  id, name, npm: w.npm, wire: w.wire, efforts: w.efforts,
  context, output, cost, est, images,
}))

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
      ...(m.cost
        ? {
            cost: {
              input: m.cost[0],
              output: m.cost[1],
              cache_read: m.cost[2],
              ...(m.est ? { note: "USD × 7.1 estimate" } : {}),
            },
          }
        : {}),
      limit: { context: m.context, output: m.output },
      variants: Object.fromEntries(m.efforts.map((e) => [e, {}])),
    }
  }
  return out
}
