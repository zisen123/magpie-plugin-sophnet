import { describe, test, expect } from "bun:test"
import { _internal } from "./index.mjs"
import { configModels } from "./models.mjs"

const { hardenResponses, MODELS, byId } = _internal

import { sendMessageSchema, agentSchema } from "./schema-fixtures.mjs"

const toolBody = (parameters, extra = {}) => JSON.stringify({
  model: "gpt-6.1-sol",
  tools: [{ type: "function", name: "Probe", parameters, ...extra }],
})

const hardenedTool = (parameters, extra) => JSON.parse(hardenResponses(toolBody(parameters, extra))).tools[0]

describe("hardenResponses tool schemas", () => {
  test("SendMessage keeps regex-constrained strings and both message forms", () => {
    const out = hardenedTool(sendMessageSchema)
    expect(out.parameters).toEqual(sendMessageSchema)
    expect(out.parameters.properties.to.type).toBe("string")
    expect(out.parameters.properties.to.properties).toBeUndefined()
    expect(out.parameters.properties.message.anyOf[0].type).toBe("string")
  })

  test("Agent keeps optional enum fields so omitted options stay omitted", () => {
    expect(hardenedTool(agentSchema).parameters).toEqual(agentSchema)
    expect(hardenedTool(agentSchema).parameters.required).toEqual(["prompt"])
  })

  test("Responses function tools explicitly opt out of strict mode", () => {
    for (const strict of [undefined, true, false]) {
      const out = hardenedTool(sendMessageSchema, { strict })
      expect(out.strict).toBe(false)
      expect(out.parameters).toEqual(sendMessageSchema)
    }
  })

  test("nested dictionaries, nullable unions and schema-named properties survive", () => {
    const parameters = {
      type: "object",
      properties: {
        dictionary: { type: "object", additionalProperties: { type: "string" } },
        empty: { type: "object", properties: {}, additionalProperties: false },
        value: { anyOf: [{ type: "number" }, { type: "null" }] },
        allOf: { type: "array", items: { type: "string", enum: ["a", "b"] } },
        properties: { type: "string", not: { const: "forbidden" } },
      },
      required: ["dictionary"],
    }
    expect(hardenedTool(parameters).parameters).toEqual(parameters)
    expect(hardenedTool({ type: "object" }).parameters).toEqual({ type: "object" })
  })

  test("built-in tools and function tools without parameters pass through", () => {
    const tools = [{ type: "web_search" }, { type: "function", name: "NoSchema" }]
    expect(JSON.parse(hardenResponses(JSON.stringify({ tools }))).tools).toEqual(tools)
  })
})

describe("hardenResponses", () => {
  test("drops previous_response_id while preserving complete conversation input", () => {
    const input = [{ role: "user", content: "hi" }]
    const out = JSON.parse(hardenResponses(JSON.stringify({ model: "m", input, previous_response_id: "resp_x" })))
    expect(out.previous_response_id).toBeUndefined()
    expect(out.input).toEqual(input)
  })

  test("non-JSON body passes through", () => {
    expect(hardenResponses("not json")).toBe("not json")
  })
})

describe("loader schema hardening", () => {
  test("string, Request and binary bodies preserve the real tool schema", async () => {
    const plugin = await (await import("./index.mjs")).SophnetAuthPlugin()
    const loader = await plugin.auth.loader(async () => ({ type: "api", key: "test-key" }))
    const realFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init })
      return new Response("ok")
    }
    try {
      const url = "https://www.sophnet.com/api/open-apis/v1/responses"
      const body = toolBody(sendMessageSchema)
      const signal = new AbortController().signal
      await loader.fetch(url, { method: "POST", body, signal, headers: { "content-length": String(body.length) } })
      await loader.fetch(new Request(url, { method: "POST", body, signal, headers: { "content-length": String(body.length) } }))
      await loader.fetch(url, { method: "POST", body: new TextEncoder().encode(body), signal })
      await loader.fetch(url, { method: "POST", body: new TextEncoder().encode(body).buffer, signal })
      const padded = new TextEncoder().encode(`x${body}x`)
      await loader.fetch(url, { method: "POST", body: padded.subarray(1, -1), signal })
      for (const call of calls) {
        const parsed = JSON.parse(typeof call.init.body === "string" ? call.init.body : new TextDecoder().decode(call.init.body))
        expect(parsed.tools[0].strict).toBe(false)
        expect(parsed.tools[0].parameters).toEqual(sendMessageSchema)
        expect(call.init.headers.has("content-length")).toBe(false)
        expect(call.init.headers.get("authorization")).toBe("Bearer test-key")
        expect(call.init.method).toBe("POST")
        expect(call.init.signal).toBeDefined()
      }
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe("loader Anthropic regression", () => {
  test("Request retains adaptive thinking, context stripping and cancellation", async () => {
    const plugin = await (await import("./index.mjs")).SophnetAuthPlugin()
    const loader = await plugin.auth.loader(async () => ({ type: "api", key: "test-key" }))
    const realFetch = globalThis.fetch
    let call
    globalThis.fetch = async (url, init) => {
      call = { url, init }
      return new Response("ok")
    }
    try {
      const request = new Request("https://www.sophnet.com/api/open-apis/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-sonnet-5-5-aws", thinking: { type: "enabled", budget_tokens: 8192 }, context_management: { edits: [] } }),
        signal: new AbortController().signal,
      })
      await loader.fetch(request)
      const body = JSON.parse(call.init.body)
      expect(call.url).toBe("https://www.sophnet.com/api/open-apis/anthropic/v1/messages")
      expect(body.thinking.type).toBe("adaptive")
      expect(body.output_config.effort).toBe("medium")
      expect(body.context_management).toBeUndefined()
      expect(call.init.signal).toBe(request.signal)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe("loader other endpoints", () => {
  test("binary Request bodies stay intact outside the JSON protocol endpoints", async () => {
    const plugin = await (await import("./index.mjs")).SophnetAuthPlugin()
    const loader = await plugin.auth.loader(async () => ({ type: "api", key: "test-key" }))
    const realFetch = globalThis.fetch
    let body
    globalThis.fetch = async (_url, init) => {
      body = init.body
      return new Response("ok")
    }
    try {
      const bytes = new Uint8Array([0, 255, 254, 128])
      await loader.fetch(new Request("https://www.sophnet.com/api/open-apis/v1/images/edits", { method: "POST", body: bytes }))
      expect(body).toEqual(bytes)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe("catalog", () => {
  test("every model id is unique", () => {
    const ids = MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("wire and npm agree", () => {
    for (const m of MODELS) {
      if (m.wire === "responses") expect(m.npm).toBe("@ai-sdk/openai")
      if (m.wire === "chat") expect(m.npm).toBe("@ai-sdk/openai-compatible")
      if (m.wire === "anthropic") expect(m.npm).toBe("@ai-sdk/anthropic")
      if (m.wire === "gemini") expect(m.npm).toBe("@ai-sdk/google")
    }
  })

  test("claude models are NOT on the responses wire (20004 upstream)", () => {
    for (const m of MODELS) {
      if (/^claude-/.test(m.id)) {
        expect(m.wire === "responses").toBe(false)
      }
    }
  })

  test("catalog is 20 models with Flash and Claude fallback channels", () => {
    expect(MODELS.length).toBe(20)
    expect(byId.get("gpt-6-luna")).toMatchObject({
      name: "GPT-6 Luna", wire: "responses", context: 1050000, output: 128000, images: true,
    })
    for (const id of ["claude-opus-4-8-aws", "qwen3.8-flash", "qwen3.8-max-0902", "glm-5.3-flash"]) {
      expect(byId.get(id)).toBeUndefined()
    }
    expect(byId.get("GLM-5.3")).toBeDefined()
    expect(byId.get("glm-5.3-flashx")).toBeDefined()
    expect(byId.get("gpt-5.5")).toBeUndefined()
    expect(byId.get("gpt-5.4")).toBeUndefined()
    expect(byId.get("gpt-5.3-codex")).toBeUndefined()
    expect(byId.get("DeepSeek-V4-Pro-0813")).toBeUndefined()
    expect(byId.get("DeepSeek-Flash")).toBeUndefined()
    expect(byId.get("DeepSeek-V4-Flash-Vision-Exp")).toBeUndefined()
    for (const id of ["DeepSeek-Flash-1017", "DeepSeek-V4.1-Flash-1017-global"]) {
      expect(byId.get(id)).toMatchObject({
        wire: "responses", context: 1000000, est: true,
      })
      expect(byId.get(id).efforts).toContain("low")
      expect(configModels()[id].id).toBe(id)
    }
  })

  test("V4.1 Flash 1017 carries the official limits and a real none tier", () => {
    expect(byId.get("DeepSeek-V4.1-Flash-1017")).toMatchObject({
      name: "DeepSeek V4.1 Flash 1017", wire: "responses", images: true,
      context: 1000000, output: 384000, cost: [1, 4, 0.02], est: false,
      efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    })
    const m = configModels()["DeepSeek-V4.1-Flash-1017"]
    expect(m.provider.npm).toBe("@ai-sdk/openai")
    expect(m.modalities.input).toEqual(["text", "image"])
    expect(m.attachment).toBe(true)
    expect(m.reasoning).toBe(true)
    expect(Object.keys(m.variants)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    expect(m.limit).toEqual({ context: 1000000, output: 384000 })
    expect(m.cost.note).toBeUndefined()
  })

  test("Claude catalog keeps channel fallbacks for each family on Messages", () => {
    const claude = MODELS.filter((m) => m.id.startsWith("claude-"))
    const families = ["claude-fable-5-1", "claude-sonnet-5-5", "claude-opus-5-5"]
    const channels = (id) => (id === "claude-fable-5-1"
      ? [id + "-cc", id, id + "-aws", id + "-awsb"]
      : [id + "-cc", id, id + "-aws"])
    expect(claude.map((m) => m.id)).toEqual(families.flatMap(channels))
    for (const m of claude) {
      expect(m.wire).toBe("anthropic")
      expect(m.npm).toBe("@ai-sdk/anthropic")
      expect(m.context).toBe(1000000)
      expect(m.output).toBe(128000)
      expect(m.efforts).toEqual(["low", "medium", "high", "xhigh", "max"])
      if (m.id.endsWith("-cc")) expect(m.name).toContain("(CC)")
      if (m.id.endsWith("-awsb")) expect(m.name).toContain("(AWS B)")
      else if (m.id.endsWith("-aws")) expect(m.name).toContain("(AWS)")
    }
  })

  test("kimi-k3.1-pro variants are text-only chat-wire models", () => {
    for (const id of ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"]) {
      expect(byId.get(id)).toMatchObject({
        wire: "chat", images: false, context: 1000000, output: 48000, est: false,
        efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      })
      expect(byId.get(id).npm).toBe("@ai-sdk/openai-compatible")
      expect(configModels()[id].modalities.input).toEqual(["text"])
    }
    expect(byId.get("kimi-k3.1-pro").cost).toEqual([13, 68, 1.3])
    expect(byId.get("kimi-k3.1-pro-highspeed").cost).toEqual([26, 136, 1.3])
    expect(byId.get("Kimi-K3")).toBeUndefined()
  })

  test("glm models never offer tiers GLM refuses (1210)", () => {
    for (const m of MODELS) {
      if (/^glm/i.test(m.id)) {
        for (const t of m.efforts) expect(["none", "minimal", "medium", "xhigh"]).not.toContain(t)
      }
    }
  })

  test("gpt-5.x never offer max (upstream refuses it); gpt-6.x probed OK on sophnet", () => {
    for (const id of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]) {
      expect(byId.get(id).efforts).toContain("max")
    }
  })

  test("byId resolves", () => {
    expect(byId.get("gpt-6.1-sol").wire).toBe("responses")
    expect(byId.get("claude-opus-5-5-cc").wire).toBe("anthropic")
  })
})

describe("hardenResponses summary strip", () => {
  test("Kimi loses reasoning.summary, gpt keeps it", () => {
    const mk = (model) => JSON.stringify({ model, reasoning: { effort: "high", summary: "auto" }, input: "hi" })
    for (const model of ["Kimi-K3", "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"]) {
      expect(JSON.parse(hardenResponses(mk(model))).reasoning.summary).toBeUndefined()
    }
    expect(JSON.parse(hardenResponses(mk("gpt-5.5"))).reasoning.summary).toBe("auto")
  })
})

describe("rewriteAdaptiveThinking", () => {
  const mk = (model) => JSON.stringify({ model, max_tokens: 4000, thinking: { type: "enabled", budget_tokens: 8192 }, messages: [] })
  test("claude >= 4.6: enabled+budget -> adaptive + output_config.effort", () => {
    for (const model of ["claude-opus-5-5", "claude-opus-5-5-aws", "claude-fable-5-1-aws", "claude-sonnet-5-5-cc"]) {
      const out = JSON.parse(_internal.rewriteAdaptiveThinking(mk(model)))
      expect(out.thinking.type).toBe("adaptive")
      expect(out.output_config.effort).toBe("medium")
    }
  })
  test("budget ladder maps to effort tiers", () => {
    expect(JSON.parse(_internal.rewriteAdaptiveThinking(JSON.stringify({ model: "claude-opus-5-5", thinking: { type: "enabled", budget_tokens: 1024 } }))).output_config.effort).toBe("low")
    expect(JSON.parse(_internal.rewriteAdaptiveThinking(JSON.stringify({ model: "claude-opus-5-5", thinking: { type: "enabled", budget_tokens: 32000 } }))).output_config.effort).toBe("max")
  })
  test("older claude and non-claude bodies untouched", () => {
    expect(JSON.parse(_internal.rewriteAdaptiveThinking(mk("claude-haiku-4-5-20251001"))).thinking.type).toBe("enabled")
    expect(JSON.parse(_internal.rewriteAdaptiveThinking(mk("claude-opus-4-5-20251101"))).thinking.type).toBe("enabled")
    expect(JSON.parse(_internal.rewriteAdaptiveThinking(mk("gpt-5.5"))).thinking.type).toBe("enabled")
  })
  test("non-enabled thinking passes through", () => {
    const b = JSON.stringify({ model: "claude-opus-5-5", thinking: { type: "adaptive" } })
    expect(_internal.rewriteAdaptiveThinking(b)).toBe(b)
  })
})

describe("stripContextManagement", () => {
  test("dropped for AWS ids, preserved for bare and all three CC channels", () => {
    const mk = (model) => JSON.stringify({ model, context_management: { edits: [] }, messages: [] })
    for (const model of ["claude-opus-5-5-aws", "claude-fable-5-1-awsb"]) {
      // (-cc accepts context_management natively, measured 2026-10-13)
      expect(JSON.parse(_internal.stripContextManagement(mk(model))).context_management).toBeUndefined()
    }
    expect(JSON.parse(_internal.stripContextManagement(mk("claude-opus-5-5"))).context_management).toEqual({ edits: [] })
    for (const model of ["claude-fable-5-1-cc", "claude-sonnet-5-5-cc", "claude-opus-5-5-cc"]) {
      expect(JSON.parse(_internal.stripContextManagement(mk(model))).context_management).toEqual({ edits: [] })
    }
  })
})

describe("provider.models", () => {
  const catalog = {
    "gpt-6.1-sol": { id: "gpt-6.1-sol" },
    "GLM-5.3": { id: "GLM-5.3" },
  }
  const withFetch = async (impl, run) => {
    const real = globalThis.fetch
    globalThis.fetch = impl
    try { return await run() } finally { globalThis.fetch = real }
  }
  const loadPlugin = async () => (await import("./index.mjs")).SophnetAuthPlugin()

  test("without an api auth the declared catalog is returned unchanged", async () => {
    const plugin = await loadPlugin()
    expect(await plugin.provider.models({ models: catalog }, {})).toBe(catalog)
    expect(await plugin.provider.models({ models: catalog }, { auth: { type: "oauth" } })).toBe(catalog)
  })

  test("intersects the catalog with the account's /v1/models", async () => {
    const plugin = await loadPlugin()
    const out = await withFetch(
      async () => new Response(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }, { id: "embedding-3" }] })),
      () => plugin.provider.models({ models: catalog }, { auth: { type: "api", key: "k" } }),
    )
    expect(Object.keys(out)).toEqual(["gpt-6.1-sol"])
  })

  test("matches ids case-insensitively", async () => {
    const plugin = await loadPlugin()
    const out = await withFetch(
      async () => new Response(JSON.stringify({ models: ["glm-5.3"] })),
      () => plugin.provider.models({ models: catalog }, { auth: { type: "api", key: "k" } }),
    )
    expect(Object.keys(out)).toEqual(["GLM-5.3"])
  })

  test("upstream failure keeps the declared catalog", async () => {
    const plugin = await loadPlugin()
    const out = await withFetch(
      async () => new Response("nope", { status: 500 }),
      () => plugin.provider.models({ models: catalog }, { auth: { type: "api", key: "k" } }),
    )
    expect(out).toBe(catalog)
  })

  test("a rejected token is reported as an expired sign-in", async () => {
    const plugin = await loadPlugin()
    await expect(withFetch(
      async () => new Response("", { status: 401 }),
      () => plugin.provider.models({ models: catalog }, { auth: { type: "api", key: "k" } }),
    )).rejects.toMatchObject({ signIn: "expired" })
  })
})

describe("auth.usage", () => {
  test("401 reports an expired sign-in", async () => {
    const plugin = await (await import("./index.mjs")).SophnetAuthPlugin()
    const real = globalThis.fetch
    globalThis.fetch = async () => new Response("", { status: 401 })
    try {
      expect(await plugin.auth.usage(async () => ({ type: "api", key: "k" }))).toEqual({ signIn: "expired" })
    } finally {
      globalThis.fetch = real
    }
  })
})
