import { describe, test, expect } from "bun:test"
import { sendMessageSchema, agentSchema } from "./schema-fixtures.mjs"

// Opt-in: these probes use the production gateway and incur model usage.
describe.skipIf(process.env.SOPHNET_LIVE_TESTS !== "1")("live Claude Code schema regression", () => {
  test("ten translated GPT-6.1 Sol tool calls preserve strings and optional enums", async () => {
    const base = process.env.SOPHNET_TEST_GATEWAY || "http://127.0.0.1:3425"
    const key = process.env.SOPHNET_TEST_GATEWAY_KEY || "magpie-claude"
    for (let i = 0; i < 10; i++) {
      if (i) await Bun.sleep(12000)
      const name = i % 2 ? "Agent" : "SendMessage"
      const parameters = name === "Agent" ? agentSchema : sendMessageSchema
      const prompt = name === "Agent"
        ? 'Call Agent once with prompt="schema regression OK". Omit model, effort and isolation.'
        : 'Call SendMessage once with to="schema-test-recipient" and message="schema regression OK" as plain strings.'
      const response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "sophnet/gpt-6.1-sol",
          max_tokens: 500,
          system: "These are simulated tools for schema regression testing. No tool will be executed.",
          messages: [{ role: "user", content: prompt }],
          tools: [{ name, description: "Simulated schema regression probe", input_schema: parameters }],
          tool_choice: { type: "tool", name },
        }),
        signal: AbortSignal.timeout(90000),
      })
      const body = await response.json()
      expect(response.status).toBe(200)
      const calls = body.content?.filter((part) => part.type === "tool_use")
      expect(calls?.length).toBe(1)
      expect(calls[0].name).toBe(name)
      if (name === "Agent") {
        expect(calls[0].input).toEqual({ prompt: "schema regression OK" })
      } else {
        expect(calls[0].input.to).toBe("schema-test-recipient")
        expect(calls[0].input.message).toBe("schema regression OK")
        expect(calls[0].input).not.toHaveProperty("_unused")
      }
      console.log(`schema sample ${i + 1}/10: ${name} HTTP ${response.status}, valid parameters`)
    }
  }, 1200000)
})

describe.skipIf(process.env.SOPHNET_LIVE_TESTS !== "1")("live streaming tool round trip", () => {
  test("SendMessage streams valid arguments and continues after a tool result", async () => {
    const base = process.env.SOPHNET_TEST_GATEWAY || "http://127.0.0.1:3425"
    const headers = {
      "content-type": "application/json",
      "x-api-key": process.env.SOPHNET_TEST_GATEWAY_KEY || "magpie-claude",
      "anthropic-version": "2023-06-01",
    }
    const messages = [{ role: "user", content: 'Call SendMessage once with to="schema-test-recipient" and message="schema regression OK" as plain strings. After the simulated tool result, reply exactly SCHEMA_OK.' }]
    const tools = [{ name: "SendMessage", description: "Simulated local regression tool", input_schema: sendMessageSchema }]
    const response = await fetch(`${base}/v1/messages`, {
      method: "POST", headers,
      body: JSON.stringify({ model: "sophnet/gpt-6.1-sol", max_tokens: 500, stream: true, messages, tools, tool_choice: { type: "tool", name: "SendMessage" } }),
      signal: AbortSignal.timeout(90000),
    })
    expect(response.status).toBe(200)
    const events = (await response.text()).split(/\r?\n/).filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)))
    expect(events.some((event) => event.type === "error")).toBe(false)
    const start = events.find((event) => event.type === "content_block_start" && event.content_block.type === "tool_use")
    expect(start?.content_block.name).toBe("SendMessage")
    const args = events.filter((event) => event.type === "content_block_delta" && event.index === start.index && event.delta.type === "input_json_delta").map((event) => event.delta.partial_json).join("")
    const input = JSON.parse(args)
    expect(input.to).toBe("schema-test-recipient")
    expect(input.message).toBe("schema regression OK")
    expect(events.find((event) => event.type === "message_delta")?.delta.stop_reason).toBe("tool_use")
    messages.push({ role: "assistant", content: [{ ...start.content_block, input }] })
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: start.content_block.id, content: "Simulated message validated; no delivery performed." }] })
    await Bun.sleep(12000)
    const continued = await fetch(`${base}/v1/messages`, {
      method: "POST", headers,
      body: JSON.stringify({ model: "sophnet/gpt-6.1-sol", max_tokens: 500, messages, tools, tool_choice: { type: "none" } }),
      signal: AbortSignal.timeout(90000),
    })
    expect(continued.status).toBe(200)
    const body = await continued.json()
    expect(body.content.filter((part) => part.type === "text").map((part) => part.text).join("").trim()).toBe("SCHEMA_OK")
    console.log("Streaming tool arguments and tool-result continuation: passed")
  }, 200000)
})
