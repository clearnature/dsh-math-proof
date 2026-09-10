// 数学证明模式 — schema 静态检查（开发期自检，非模型工具）
//
// 用途：挂载前校验本 preset 四个本地插件注册的每个工具
//   1) parameters 是合法 JSON Schema（OpenAI 严格子集）
//   2) output.schema 属于 harness 支持子集且为 object 根
// 教训：`proof_dag` 曾因嵌套对象用了属性级 `required: true`（schemastery 风格），
//       而 registry 把 parameters 原样当 JSON Schema 发给模型 API → 整个会话报
//       `Invalid schema for function 'proof_dag': true is not of type "array"`。
//
// 运行：node ~/.dsh/.agent-presets/math-proof/scripts/lint-schemas.mjs
// 退出码：0 = 全部合法；1 = 存在违规
//
// 零外部依赖：只 import node: 内建模块与同目录插件。

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(HERE, '..', 'plugins')

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const ANNOT = new Set(['description', 'title', 'default', 'examples'])
const STRUCT = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf'])

/** 校验 parameters：严格 JSON Schema 子集。 */
function lintParameters(node, path, out) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    out.push(`${path}: 不是 schema 对象`)
    return
  }
  if (Object.hasOwn(node, 'required')) {
    if (!Array.isArray(node.required) || node.required.some((x) => typeof x !== 'string')) {
      out.push(`${path}.required 必须是字符串数组（收到 ${JSON.stringify(node.required)}）`)
    }
    if (node.type !== undefined && node.type !== 'object') {
      out.push(`${path}.required 只允许出现在 type:"object" 节点上`)
    }
  }
  if (Object.hasOwn(node, 'enum') && !Array.isArray(node.enum)) out.push(`${path}.enum 必须是数组`)
  if (node.type === 'array' && !Object.hasOwn(node, 'items')) out.push(`${path} type:"array" 缺少 items`)
  for (const key of Object.keys(node)) {
    if (!STRUCT.has(key) && !ANNOT.has(key)) out.push(`${path}.${key} 不是严格子集允许的键`)
  }
  if (node.type !== undefined && !TYPES.has(node.type)) out.push(`${path}.type 非法: ${String(node.type)}`)
  if (node.properties !== undefined) {
    if (node.type !== 'object') out.push(`${path}.properties 需要 type:"object"`)
    for (const [k, v] of Object.entries(node.properties)) lintParameters(v, `${path}.properties.${k}`, out)
  }
  if (node.items !== undefined) lintParameters(node.items, `${path}.items`, out)
  for (const [i, v] of (node.oneOf ?? []).entries()) lintParameters(v, `${path}.oneOf[${i}]`, out)
}

/** 校验 output.schema：harness 支持子集 + object 根（不 import harness 包，手写等价检查）。 */
function lintOutput(node, path, out) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    out.push(`${path}: 不是 schema 对象`)
    return
  }
  const hasType = Object.hasOwn(node, 'type')
  const hasOneOf = Object.hasOwn(node, 'oneOf')
  if (hasType && hasOneOf) out.push(`${path} 不能同时声明 type 与 oneOf`)
  if (!hasType && !hasOneOf) out.push(`${path} 必须声明 type 或 oneOf`)
  if (Object.hasOwn(node, 'required')) {
    if (!Array.isArray(node.required) || node.required.some((x) => typeof x !== 'string')) {
      out.push(`${path}.required 必须是字符串数组`)
    }
  }
  for (const key of Object.keys(node)) {
    if (!STRUCT.has(key) && !ANNOT.has(key)) out.push(`${path}.${key} 不是支持子集允许的键`)
  }
  if (node.type !== undefined && !TYPES.has(node.type)) out.push(`${path}.type 非法: ${String(node.type)}`)
  if (node.properties !== undefined) {
    for (const [k, v] of Object.entries(node.properties)) lintOutput(v, `${path}.properties.${k}`, out)
  }
  if (node.items !== undefined) lintOutput(node.items, `${path}.items`, out)
  for (const [i, v] of (node.oneOf ?? []).entries()) lintOutput(v, `${path}.oneOf[${i}]`, out)
}

let failures = 0
for (const file of readdirSync(PLUGIN_DIR).filter((f) => f.endsWith('.mjs')).sort()) {
  const mod = await import(join(PLUGIN_DIR, file))
  if (typeof mod.apply !== 'function') continue
  const tools = []
  mod.apply({
    tools: { register: (t) => { tools.push(t); return () => {} } },
    systemPrompt: { section: () => () => {} },
    effect: (fn) => { fn(); return () => {} },
    get: () => undefined,
  })
  for (const t of tools) {
    const out = []
    lintParameters(t.parameters, `${file}:${t.name}.parameters`, out)
    lintOutput(t.output.schema, `${file}:${t.name}.output.schema`, out)
    if (t.output.schema.type !== 'object') out.push(`${file}:${t.name}.output.schema 必须是 object 根`)
    if (out.length === 0) console.log(`✅ ${file} :: ${t.name}`)
    else { failures++; console.log(`❌ ${file} :: ${t.name}`); for (const m of out) console.log(`   - ${m}`) }
  }
}
console.log(failures === 0 ? '\nSCHEMA_LINT_OK' : `\nSCHEMA_LINT_FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
