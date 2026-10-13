import { describe, test, expect } from "bun:test"
import { _internal } from "./index.mjs"

const { foldCombinators, strictify, hardenResponses, MODELS, byId } = _internal

describe("foldCombinators", () => {
  test("scalar anyOf collapses to first non-null type, nullable noted", () => {
    const out = foldCombinators({ anyOf: [{ type: "number" }, { type: "null" }], description: "ms" })
    expect(out.type).toBe("number")
    expect(out.description).toContain("nullable")
    expect(out.anyOf).toBeUndefined()
  })

  test("object branches merge properties and union required", () => {
    const out = foldCombinators({
      oneOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
      ],
    })
    expect(out.type).toBe("object")
    expect(Object.keys(out.properties).sort()).toEqual(["a", "b"])
    expect(out.required.sort()).toEqual(["a", "b"])
    expect(out.oneOf).toBeUndefined()
  })

  test("nested combinators fold recursively", () => {
    const out = foldCombinators({
      type: "object",
      properties: { x: { anyOf: [{ type: "string" }, { type: "null" }] } },
    })
    expect(out.properties.x.type).toBe("string")
  })

  test("enum is dropped (structured outputs forbids it)", () => {
    const out = foldCombinators({ type: "string", enum: ["a", "b"] })
    expect(out.enum).toBeUndefined()
    expect(out.type).toBe("string")
  })
})

describe("strictify", () => {
  test("object nodes get properties, additionalProperties:false, full required", () => {
    const out = strictify({
      type: "object",
      properties: { cmd: { type: "string" }, nested: { type: "object", properties: { x: { type: "string" } } } },
      required: ["cmd"],
    })
    expect(out.additionalProperties).toBe(false)
    expect(out.required).toEqual(["cmd", "nested"])
    expect(out.properties.nested.additionalProperties).toBe(false)
    expect(out.properties.nested.required).toEqual(["x"])
  })

  test("propertyless object gains a placeholder property", () => {
    const out = strictify({ type: "object", properties: {} })
    expect(Object.keys(out.properties).length).toBeGreaterThan(0)
  })
})

describe("hardenResponses", () => {
  test("strips strict key and sanitizes tool schemas", () => {
    const body = JSON.stringify({
      model: "gpt-5.5",
      tools: [{
        type: "function", name: "Foo", strict: false,
        parameters: { type: "object", properties: { bar: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["bar"] },
      }],
    })
    const out = JSON.parse(hardenResponses(body))
    expect("strict" in out.tools[0]).toBe(false)
    expect(out.tools[0].parameters.properties.bar.anyOf).toBeUndefined()
    expect(out.tools[0].parameters.additionalProperties).toBe(false)
  })

  test("drops previous_response_id", () => {
    const out = JSON.parse(hardenResponses(JSON.stringify({ model: "m", input: [], previous_response_id: "resp_x" })))
    expect(out.previous_response_id).toBeUndefined()
  })

  test("non-JSON body passes through", () => {
    expect(hardenResponses("not json")).toBe("not json")
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

  test("catalog is 15 models (13 measured + 5 next-gen, minus retired gpt-5.x)", () => {
    expect(MODELS.length).toBe(15)
    expect(byId.get("gpt-5.5")).toBeUndefined()
    expect(byId.get("gpt-5.4")).toBeUndefined()
    expect(byId.get("gpt-5.3-codex")).toBeUndefined()
  })

  test("glm models never offer tiers GLM refuses (1210)", () => {
    for (const m of MODELS) {
      if (/^glm/i.test(m.id)) {
        for (const t of m.efforts) expect(["none", "minimal", "medium", "xhigh"]).not.toContain(t)
      }
    }
  })

  test("gpt-5.x never offer max (upstream refuses it); gpt-6.x probed OK on sophnet", () => {
    for (const id of ["gpt-6.1-sol", "gpt-6-astra"]) {
      expect(byId.get(id).efforts).toContain("max")
    }
  })

  test("byId resolves", () => {
    expect(byId.get("gpt-6.1-sol").wire).toBe("responses")
    expect(byId.get("claude-opus-5-5-aws").wire).toBe("anthropic")
  })
})

describe("hardenResponses summary strip", () => {
  test("Kimi loses reasoning.summary, gpt keeps it", () => {
    const mk = (model) => JSON.stringify({ model, reasoning: { effort: "high", summary: "auto" }, input: "hi" })
    expect(JSON.parse(hardenResponses(mk("Kimi-K3"))).reasoning.summary).toBeUndefined()
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
  test("dropped for -aws/-cc ids, kept for bare", () => {
    const mk = (model) => JSON.stringify({ model, context_management: { edits: [] }, messages: [] })
    for (const model of ["claude-opus-5-5-aws", "claude-sonnet-5-5-cc", "claude-fable-5-1-awsb"]) {
      expect(JSON.parse(_internal.stripContextManagement(mk(model))).context_management).toBeUndefined()
    }
    expect(JSON.parse(_internal.stripContextManagement(mk("claude-opus-5-5"))).context_management).toEqual({ edits: [] })
  })
})
