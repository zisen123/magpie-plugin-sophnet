export const sendMessageSchema = {
  type: "object",
  properties: {
    to: { type: "string", allOf: [{ pattern: "^[^\\n\\r]*$" }, { pattern: "^[\\s\\S]{0,500}$" }] },
    summary: { type: "string", maxLength: 200 },
    message: {
      anyOf: [
        { type: "string" },
        { oneOf: [
          { type: "object", properties: { type: { type: "string", const: "shutdown_request" }, reason: { type: "string" } }, required: ["type"], additionalProperties: false },
          { type: "object", properties: { type: { type: "string", const: "shutdown_response" }, request_id: { type: "string" }, approve: { type: "boolean" } }, required: ["type", "request_id", "approve"], additionalProperties: false },
        ] },
      ],
    },
    notify_when_idle: { type: "boolean" },
  },
  required: ["to", "message"],
  additionalProperties: false,
}

export const agentSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    model: { type: "string", enum: ["sonnet", "opus", "haiku", "fable"] },
    effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
    isolation: { type: "string", enum: ["worktree", "remote"] },
  },
  required: ["prompt"],
}

