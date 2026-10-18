import { describe, test, expect } from "bun:test"
import { SophnetAuthPlugin, _internal } from "./index.mjs"

const history = () => [
  { role: "user", content: "保留口令 SWITCH_OK" },
  { type: "function_call", call_id: "call_from_deepseek", name: "Read", arguments: '{"file_path":"/tmp/probe"}' },
  { type: "function_call_output", call_id: "call_from_deepseek", output: "version=0.1.0" },
  { role: "user", content: "回复口令和 version" },
]
const hardened = (model, input = history()) => JSON.parse(_internal.hardenResponses(JSON.stringify({ model, input })))
const ids = (body) => body.input.filter((item) => item.call_id).map((item) => item.call_id)

describe("Responses 历史工具 ID 隔离", () => {
  test("跨模型回放不再携带原模型的工具 ID", () => {
    const input = history()
    const body = hardened("gpt-6.1-sol", input)
    expect(ids(body)[0]).not.toBe("call_from_deepseek")
    expect(ids(body)[0]).toBe(ids(body)[1])
    expect(body.input.map(({ call_id, ...item }) => item)).toEqual(input.map(({ call_id, ...item }) => item))
    expect(input[1].call_id).toBe("call_from_deepseek")
  })

  test("同模型重复请求稳定，切回原模型恢复相同映射", () => {
    const deepseek = ids(hardened("DeepSeek-Flash"))
    const gpt = ids(hardened("gpt-6.1-sol"))
    expect(deepseek).not.toEqual(gpt)
    expect(ids(hardened("DeepSeek-Flash"))).toEqual(deepseek)
    expect(ids(hardened("gpt-6.1-sol"))).toEqual(gpt)
    expect(deepseek[0]).toMatch(/^call_[A-Za-z0-9_-]{1,59}$/)
  })

  test("并行工具、重复结果和新增工具保持配对及既有映射", () => {
    const input = history()
    input.push(
      { type: "function_call", call_id: "call_second", name: "Read", arguments: "{}" },
      { type: "function_call_output", call_id: "call_second", output: "second" },
      { type: "function_call_output", call_id: "call_from_deepseek", output: "replayed" },
    )
    const out = ids(hardened("gpt-6.1-sol", input))
    expect(out[0]).toBe(out[1])
    expect(out[2]).toBe(out[3])
    expect(out[0]).toBe(out[4])
    expect(out[0]).not.toBe(out[2])
    expect(out[0]).toBe(ids(hardened("gpt-6.1-sol"))[0])
  })

  test("不同 ID 和模型边界不会因拼接而混淆，长 ID 输出仍有界", () => {
    const withId = (id) => [{ type: "function_call", call_id: id, name: "Read", arguments: "{}" }]
    expect(ids(hardened("a", withId("bc")))).not.toEqual(ids(hardened("ab", withId("c"))))
    const long = ids(hardened("gpt-6.1-sol", withId("调用".repeat(1000))))[0]
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long).toMatch(/^call_[A-Za-z0-9_-]+$/)
  })

  test("字符串 input、非函数项目和缺少 ID 的项目不被改写", () => {
    const input = [
      { type: "reasoning", id: "rs_original", encrypted_content: "sealed" },
      { type: "custom_tool_call", call_id: "custom_original", input: "text" },
      { type: "function_call", name: "Read", arguments: "{}" },
      { type: "function_call_output", call_id: "", output: "empty" },
    ]
    expect(hardened("gpt-6.1-sol", input).input).toEqual(input)
    expect(hardened("gpt-6.1-sol", "hi").input).toBe("hi")
  })

  test("仍删除显式 previous_response_id", () => {
    const out = JSON.parse(_internal.hardenResponses(JSON.stringify({
      model: "gpt-6.1-sol", input: history(), previous_response_id: "resp_from_deepseek",
    })))
    expect(out.previous_response_id).toBeUndefined()
    expect(ids(out)[0]).not.toBe("call_from_deepseek")
  })
})

describe("loader 跨模型工具续轮回归", () => {
  test("流式响应的新工具 ID 原样返回，Request 信号和内容长度正确", async () => {
    const plugin = await SophnetAuthPlugin()
    const loader = await plugin.auth.loader(async () => ({ type: "api", key: "offline-test-key" }))
    const originalFetch = globalThis.fetch
    const sse = 'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_new_from_model"}}\n\n'
    const upstream = new Response(sse, { headers: { "content-type": "text/event-stream" } })
    const request = new Request("https://www.sophnet.com/api/open-apis/v1/responses", {
      method: "POST", body: JSON.stringify({ model: "gpt-6.1-sol", input: history(), stream: true }),
      headers: { "content-length": "1" }, signal: new AbortController().signal,
    })
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body)
      expect(body.stream).toBe(true)
      expect(ids(body)[0]).not.toBe("call_from_deepseek")
      expect(init.headers.has("content-length")).toBe(false)
      expect(init.signal).toBe(request.signal)
      return upstream
    }
    try {
      const response = await loader.fetch(request)
      expect(response).toBe(upstream)
      expect(await response.text()).toBe(sse)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("实际发送路径在 A→B→A 和并发重复回放中隔离 ID", async () => {
    const plugin = await SophnetAuthPlugin()
    const loader = await plugin.auth.loader(async () => ({ type: "api", key: "offline-test-key" }))
    const originalFetch = globalThis.fetch
    const owners = new Map([["call_from_deepseek", "DeepSeek-Flash"]])
    const sent = []
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body)
      sent.push(body)
      expect(body.previous_response_id).toBeUndefined()
      for (const id of ids(body)) {
        const previous = owners.get(id)
        if (previous && previous !== body.model) {
          return new Response(JSON.stringify({ message: `previous_response_id model mismatch: current=${body.model}, previous=${previous}` }), { status: 400 })
        }
        owners.set(id, body.model)
      }
      return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "SWITCH_OK" }] }] }))
    }
    try {
      const url = "https://www.sophnet.com/api/open-apis/v1/responses"
      for (const model of ["DeepSeek-Flash", "gpt-6.1-sol", "DeepSeek-Flash"]) {
        const body = JSON.stringify({ model, input: history(), previous_response_id: "resp_old" })
        const response = await loader.fetch(new Request(url, { method: "POST", body }))
        expect(response.status).toBe(200)
      }
      const body = JSON.stringify({ model: "gpt-6.1-sol", input: history() })
      const responses = await Promise.all([
        loader.fetch(url, { method: "POST", body }),
        loader.fetch(url, { method: "POST", body: new TextEncoder().encode(body) }),
        loader.fetch(url, { method: "POST", body: new TextEncoder().encode(body).buffer }),
      ])
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
      expect(ids(sent[0])).toEqual(ids(sent[2]))
      expect(ids(sent[1])).toEqual(ids(sent[3]))
      expect(ids(sent[3])).toEqual(ids(sent[4]))
      expect(ids(sent[4])).toEqual(ids(sent[5]))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
