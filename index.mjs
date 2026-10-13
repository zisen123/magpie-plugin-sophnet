// SophNet provider plugin for OpenCode and magpie.
//
// One API key (www.sophnet.com → Access Token), every model on the wire it
// speaks: OpenAI-family models on /responses (or /chat/completions), Claude
// models on Anthropic Messages, Gemini models on generateContent. magpie's
// gateway translates whatever the agent sent into the model's own wire.
//
// The loader's fetch also hardens Responses requests for SophNet's gateway:
// tool schemas are rewritten to OpenAI structured-outputs shape (combinators
// folded, every object given properties/additionalProperties/required,
// "strict" key dropped) and a previous_response_id the gateway cannot honor
// is dropped with the conversation carried in full. Both are cheap no-ops on
// lenient upstreams and prevent 400 "请求参数有误" /
// previous_response_id-not-found rounds.

import { MODELS, byId, configModels } from "./models.mjs"

const PROVIDER = "sophnet"
const BASE = "https://www.sophnet.com/api/open-apis/v1"
const ANTHROPIC_BASE = "https://www.sophnet.com/api/open-apis/anthropic"
const GEMINI_BASE = "https://www.sophnet.com/api/open-apis/google" // not measured; Gemini wire is best-effort

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v)

// ---- Responses request hardening -------------------------------------------

// foldCombinators rewrites oneOf/anyOf/allOf (any depth) into a single
// object schema: alternative properties merged, required unioned, optional
// fields said in the description. Scalar alternatives ({type:"string"},
// {type:"null"}, …) collapse to the first non-null type, nullable noted.
function foldCombinators(schema) {
  if (Array.isArray(schema)) return schema.map(foldCombinators)
  if (!isObj(schema)) return schema
  const branches = schema.oneOf || schema.anyOf || schema.allOf
  if (Array.isArray(branches) && branches.length) {
    const scalar = (b) => isObj(b) && !b.properties && !b.oneOf && !b.anyOf && !b.allOf && typeof b.type === "string"
    if (branches.every(scalar)) {
      const types = branches.map((b) => b.type)
      const nonNull = types.filter((t) => t !== "null")
      const out = { ...schema }
      for (const k of ["oneOf", "anyOf", "allOf", "enum", "const", "not"]) delete out[k]
      out.type = nonNull[0] || "string"
      if (types.includes("null")) out.description = [out.description, "nullable"].filter(Boolean).join(" | ")
      return out
    }
    const merged = { type: "object", properties: {}, required: [], additionalProperties: false }
    const notes = []
    for (const b of branches.filter((b) => !scalar(b))) {
      if (!isObj(b)) continue
      const f = foldCombinators(b)
      if (isObj(f.properties)) for (const [k, v] of Object.entries(f.properties)) merged.properties[k] ??= v
      if (Array.isArray(f.required)) for (const r of f.required) if (!merged.required.includes(r)) merged.required.push(r)
      if (f.description) notes.push(f.description)
    }
    const out = { ...schema, ...merged, properties: { ...(schema.properties || {}), ...merged.properties } }
    out.required = [...new Set([...(schema.required || []), ...merged.required])]
    for (const k of ["oneOf", "anyOf", "allOf", "enum", "const", "not"]) delete out[k]
    const optional = Object.keys(out.properties).filter((k) => !out.required.includes(k))
    if (optional.length && !notes.length) notes.push(`Fields ${optional.join(", ")} may be omitted.`)
    if (notes.length) out.description = [out.description, ...notes].filter(Boolean).join(" | ")
    return out
  }
  const out = {}
  for (const [k, v] of Object.entries(schema)) out[k] = foldCombinators(v)
  for (const k of ["enum", "const", "not"]) delete out[k]
  return out
}

// strictify makes every object node structured-outputs compliant: non-empty
// properties, additionalProperties:false, every property in required.
function strictify(schema) {
  if (Array.isArray(schema)) return schema.map(strictify)
  if (!isObj(schema)) return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) out[k] = strictify(v)
  if (out.type === "object" || (out.properties && !out.type)) {
    out.type = "object"
    if (!isObj(out.properties)) out.properties = {}
    if (!Object.keys(out.properties).length) out.properties = { _unused: { type: "string", description: "unused" } }
    out.additionalProperties = false
    out.required = [...new Set([...(out.required || []), ...Object.keys(out.properties)])]
  }
  return out
}

// hardenResponses rewrites a /responses request body for SophNet's gateway.
// claudeVersion reads a claude model id's (major, minor): false when the id
// isn't a Claude one. claude ids on sophnet: bare, -aws, -awsb, -cc.
function claudeVersion(model) {
  const m = /^claude-(?:fable|haiku|opus|sonnet)-(\d+)-(\d+)/.exec(String(model ?? ""))
  if (!m) return false
  return { major: Number(m[1]), minor: Number(m[2]) }
}

// effortForBudget maps a legacy thinking budget to an adaptive effort tier.
function effortForBudget(budget) {
  if (budget <= 2048) return "low"
  if (budget <= 8192) return "medium"
  if (budget <= 16384) return "high"
  if (budget <= 24576) return "xhigh"
  return "max"
}

// rewriteAdaptiveThinking: claude >= 4.6 on sophnet refuses the legacy
// thinking block ("requires adaptive thinking; omit thinking or use
// *.type=adaptive and output_config.effort"). CC still sends the legacy
// form, and magpie's passthrough relays it untouched, so the plugin rewrites
// it here: thinking.type=adaptive + output_config.effort from the budget.
// stripContextManagement: sophnet's -aws / -awsb / -cc claude routes are
// Bedrock-backed and refuse context_management (CC's context editing
// feature) with a generic "Invalid request", while the bare ids accept it.
// The field is optional: dropped, the conversation runs without client-side
// context editing.
function stripContextManagement(text) {
  let body
  try { body = JSON.parse(text) } catch { return text }
  if (!/-aws|-awsb|-cc$/.test(String(body.model ?? ""))) return text
  if (body.context_management === undefined) return text
  delete body.context_management
  return JSON.stringify(body)
}

function rewriteAdaptiveThinking(text) {
  let body
  try { body = JSON.parse(text) } catch { return text }
  const th = body?.thinking
  if (!isObj(th) || th.type !== "enabled") return text
  const v = claudeVersion(body.model)
  if (!v || v.major < 4 || (v.major === 4 && v.minor < 6)) return text
  const budget = Number(th.budget_tokens) || 8192
  body.thinking = { type: "adaptive", display: "summarized" }
  body.output_config = { ...(isObj(body.output_config) ? body.output_config : {}), effort: effortForBudget(budget) }
  return JSON.stringify(body)
}

function hardenResponses(text) {
  let body
  try { body = JSON.parse(text) } catch { return text }
  if (Array.isArray(body?.tools) && body.tools.length) {
    body.tools = body.tools.map((t) => {
      if (t?.type !== "function" || !isObj(t.parameters)) return t
      const { strict: _drop, ...rest } = t
      return { ...rest, parameters: strictify(foldCombinators(t.parameters)) }
    })
  }
  // SophNet's /responses keeps per-response state and validates a
  // previous_response_id against (model, org): switching models or keys
  // mid-conversation 400s. Dropping it and resending the full input is
  // always safe — the input array already carries the conversation.
  delete body.previous_response_id
  // SophNet's Go gateway strict-decodes reasoning per model and refuses
  // "summary" on some (Kimi: json: unknown field "summary"); others (gpt)
  // need it for reasoning display, so strip per model.
  if (/^Kimi/i.test(String(body.model ?? "")) && isObj(body.reasoning) && "summary" in body.reasoning) {
    const { summary: _s, ...rest } = body.reasoning
    body.reasoning = rest
  }
  return JSON.stringify(body)
}

// ---- the plugin --------------------------------------------------------------

export const SophnetAuthPlugin = async () => ({
  config: async (cfg) => {
    cfg.provider ??= {}
    cfg.provider[PROVIDER] ??= {
      name: "SophNet",
      npm: "@ai-sdk/openai", // default wire; each model overrides below
      api: BASE,
      models: configModels(),
    }
  },

  auth: {
    provider: PROVIDER,
    methods: [{ type: "api", label: "SophNet Access Token", placeholder: "fT93…" }],
    async loader(getAuth) {
      const auth = await getAuth()
      if (auth?.type !== "api") return {}
      const key = auth.key

      async function sophnetFetch(input, init) {
        const url = input instanceof Request ? input.url : String(input)
        let body = init?.body
        if (body == null && input instanceof Request && input.body) body = new Uint8Array(await input.arrayBuffer())
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        headers.set("authorization", `Bearer ${key}`)
        headers.set("X-Sophnet-Source", "opencode-sophnet-auth")

        // per-wire base: an Anthropic Messages request the AI SDK built
        // against BASE is re-pointed at the Anthropic root. The SDK joins
        // baseURL and its path loosely (a /v1 may appear twice), so the
        // rewrite replaces the whole BASE prefix instead of splicing paths.
        let out = url
        const path = new URL(url).pathname
        if (path.endsWith("/messages") && url.startsWith(BASE)) {
          out = ANTHROPIC_BASE + "/v1/messages"
        }
        const wirePath = new URL(out).pathname

        if (typeof body === "string" && wirePath.endsWith("/responses")) {
          body = hardenResponses(body)
          headers.delete("content-length")
        }
        if (typeof body === "string" && wirePath.endsWith("/messages")) {
          let adapted = stripContextManagement(body)
          adapted = rewriteAdaptiveThinking(adapted)
          if (adapted !== body) { body = adapted; headers.delete("content-length") }
        }
        const method = init?.method ?? (input instanceof Request ? input.method : "POST")
        return fetch(out, { ...init, method, body, headers })
      }

      return { baseURL: BASE, apiKey: key, fetch: sophnetFetch }
    },
  },

  provider: {
    id: PROVIDER,
    // SophNet's /v1/models lists ~138 ids (including -global mirrors,
    // embedding/rerank/image/video models the chat APIs don't serve); the
    // curated list is what agents should see. A model SophNet retires stays
    // offered until removed here — harmless: requests fail over.
    async models(provider) {
      return provider.models
    },
  },
})

export const _internal = { foldCombinators, strictify, hardenResponses, rewriteAdaptiveThinking, stripContextManagement, MODELS, byId }
