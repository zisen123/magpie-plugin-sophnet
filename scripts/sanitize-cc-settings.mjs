#!/usr/bin/env bun
// Clean up what magpie's Claude Code rewrite keeps re-adding:
//   1. the four ANTHROPIC_DEFAULT_*_MODEL tier vars (they mint 4 duplicate
//      picker entries and duplicate the main model)
//   2. CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY (the discovery layer
//      re-adds models the static picker already lists)
//   3. any availableModels / modelPicker entries whose ids are gone from
//      the plugin catalog (pass the catalog dir or run from the repo root)
// Idempotent: safe to run after every `magpie claude <model>`.
import { readFileSync, writeFileSync } from "node:fs"

const settingsPath = `${process.env.HOME}/.claude/settings.json`
const s = JSON.parse(readFileSync(settingsPath, "utf8"))
const env = s.env ?? {}

const TIER_KEYS = [
  "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
]
let changed = []
for (const k of TIER_KEYS) if (k in env) { delete env[k]; changed.push(k) }
if ("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY" in env) {
  delete env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY
  changed.push("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY")
}
s.env = env

// prune stale ids
const pluginDir = new URL("..", import.meta.url).pathname
const { MODELS } = await import(pluginDir + "models.mjs")
const live = new Set(MODELS.map((m) => `sophnet/${m.id}[1m]`).concat(MODELS.map((m) => `sophnet/${m.id}`)))
if (Array.isArray(s.availableModels)) {
  const before = s.availableModels.length
  s.availableModels = s.availableModels.filter((a) => !a.startsWith("sophnet/") || live.has(a))
  if (s.availableModels.length !== before) changed.push(`availableModels ${before}->${s.availableModels.length}`)
}
if (s.modelPicker?.options) {
  const before = s.modelPicker.options.length
  s.modelPicker.options = s.modelPicker.options.filter((o) => !o.model?.startsWith("sophnet/") || live.has(o.model))
  if (s.modelPicker.options.length !== before) changed.push(`modelPicker ${before}->${s.modelPicker.options.length}`)
}

writeFileSync(settingsPath, JSON.stringify(s, null, 2))
console.log(changed.length ? "cleaned: " + changed.join(", ") : "already clean")
