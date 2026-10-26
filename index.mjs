// SophNet provider plugin for OpenCode and magpie.
//
// One API key (www.sophnet.com → Access Token), every domestic model on the
// wire it speaks: DeepSeek / GLM on /responses, Kimi on /chat/completions.
// magpie's gateway translates whatever the agent sent into the model's wire.
//
// The loader's fetch also hardens Responses requests for SophNet's gateway:
// function tools use non-strict mode with their original JSON Schema. A
// previous_response_id the gateway cannot honor is dropped with the
// conversation carried in full.

import { createHash } from "node:crypto"
import { MODELS, byId, configModels } from "./models.mjs"

const PROVIDER = "sophnet"
const BASE = "https://www.sophnet.com/api/open-apis/v1"
// The account's balance sits beside the API root, not under /v1: the
// projects query every SophNet console page reads it from.
const BALANCE_URL = "https://www.sophnet.com/api/open-apis/projects/balance"

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v)

// ---- Responses request hardening -------------------------------------------

// hardenResponses rewrites a /responses request body for SophNet's gateway.
function hardenResponses(text) {
  let body
  try { body = JSON.parse(text) } catch { return text }
  if (Array.isArray(body?.tools) && body.tools.length) {
    body.tools = body.tools.map((t) => {
      if (t?.type !== "function" || !isObj(t.parameters)) return t
      // Responses defaults to strict schemas when this flag is omitted.
      return { ...t, strict: false }
    })
  }
  // SophNet 校验显式 response ID，也会根据历史工具 call_id 隐式续接。
  // 完整历史回放时按目标模型稳定重绑 ID，避免切换模型后的 400；调用
  // 和结果使用同一映射，不改参数、工具结果或模型返回的新工具 ID。
  delete body.previous_response_id
  if (typeof body.model === "string" && Array.isArray(body.input)) {
    const ids = new Map()
    for (const item of body.input) {
      if (!isObj(item) || !["function_call", "function_call_output"].includes(item.type)) continue
      if (typeof item.call_id !== "string" || !item.call_id) continue
      const id = item.call_id
      if (!ids.has(id)) {
        const digest = createHash("sha256").update(JSON.stringify([body.model, id])).digest("hex").slice(0, 48)
        ids.set(id, `call_mp_${digest}`)
      }
      item.call_id = ids.get(id)
    }
  }
  // SophNet's Go gateway strict-decodes reasoning per model and refuses
  // "summary" on some (Kimi: json: unknown field "summary"), so strip per
  // model.
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
      searches: true,
      models: configModels(),
    }
  },

  auth: {
    provider: PROVIDER,
    methods: [{ type: "api", label: "SophNet Access Token", placeholder: "fT93…" }],

    // The account's balance, as magpie's usage cards show it (magpie's
    // own hook; OpenCode ignores it). currentBalance is the total the
    // console puts on top, gift included; the vendor answers in CNY.
    async usage(getAuth) {
      const auth = await getAuth()
      if (auth?.type !== "api") return {}
      const res = await fetch(BALANCE_URL, {
        headers: { authorization: `Bearer ${auth.key}`, accept: "application/json" },
      })
      if (res.status === 401 || res.status === 403) return { signIn: "expired" }
      const text = await res.text()
      let body
      try { body = JSON.parse(text) } catch { return { error: `balance: the reply is not JSON (${res.status})` } }
      if (!res.ok || body?.status !== 0) {
        return { error: `balance: ${body?.message || res.status}` }
      }
      const amount = Number(body?.result?.currentBalance)
      if (!isFinite(amount)) return { error: "balance: the reply carried no currentBalance" }
      return { balance: `¥${amount.toFixed(2)}` }
    },

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

        const wirePath = new URL(url).pathname
        if (wirePath.endsWith("/responses") && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
          body = new TextDecoder().decode(body)
        }

        if (typeof body === "string" && wirePath.endsWith("/responses")) {
          body = hardenResponses(body)
          headers.delete("content-length")
        }
        const method = init?.method ?? (input instanceof Request ? input.method : "POST")
        return fetch(url, { ...init, method, body, headers, signal: init?.signal ?? (input instanceof Request ? input.signal : undefined) })
      }

      return { baseURL: BASE, apiKey: key, fetch: sophnetFetch }
    },
  },

  provider: {
    id: PROVIDER,
    // magpie calls this once per account. Ask that account's /v1/models so a
    // retired channel leaves the picker and a revoked token is reported as an
    // expired sign-in instead of a generic network failure. Any other failure
    // keeps the declared catalog: the plugin must stay usable without network.
    // SophNet lists ~138 ids there (including -global mirrors and
    // embedding/rerank/image/video models the chat APIs don't serve), so the
    // result is intersected with the curated catalog, never used directly.
    async models(provider, { auth } = {}) {
      const catalog = provider?.models ?? {}
      if (auth?.type !== "api" || !auth.key) return catalog
      let ids
      try {
        const res = await fetch(`${BASE}/models`, {
          headers: { authorization: `Bearer ${auth.key}`, accept: "application/json" },
        })
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error("SophNet rejected this token"), { signIn: "expired" })
        }
        if (!res.ok) return catalog
        const body = await res.json()
        const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
        const raw = list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean)
        // SophNet's catalog is case-sensitive, but vendors have shipped both
        // "GLM-5.3" and "glm-5.3-flashx"; match either spelling.
        ids = new Set(raw.flatMap((id) => [id, id.toLowerCase()]))
      } catch (err) {
        if (err?.signIn) throw err
        return catalog
      }
      const served = {}
      for (const [id, model] of Object.entries(catalog)) {
        if (ids.has(id) || ids.has(id.toLowerCase())) served[id] = model
      }
      return Object.keys(served).length ? served : catalog
    },
  },
})

export const _internal = { hardenResponses, MODELS, byId }
