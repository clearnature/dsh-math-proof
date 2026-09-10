// 数学证明模式 — 插件依赖注入门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/inject-check.mjs
// 期望最后一行：INJECT_OK n/n
//
// 为什么要有它（真实事故 2026-09-10）：`proof-discipline.mjs` 用 `ctx.systemPrompt.section()`
// 注册纪律段，但 `inject` 只声明了 `['tools']` → Cordis 抛
// **`cannot get property 'systemPrompt' without inject`** → 该行挂不上 → **整个数学证明模式无法使用**。
// 这条检查在 dsh 升级（0.1.2-rc.1）后变严：**未在 `inject` 里声明的服务，访问即抛错**。
// 「以前能跑」不代表现在能跑——所以必须机器检查，而不是靠记性。
//
// 规则：
//   1. 插件里每个 `ctx.<服务>` 访问，其名字必须在 `export const inject` 里声明；
//   2. Cordis 的**核心成员**（get/on/effect/logger/inject/set/provide/scope/isolate/plugin/$/root/fiber…）
//      不算服务，不需要声明；
//   3. 注释里的 `ctx.xxx` 不算（曾因此误判过）；
//   4. 声明了却没用到 → 只提示（可能是为了等待服务就绪，不判失败）；
//   5. 读可选服务应写 `ctx.get('x')` 并判 undefined——这条只做提示。

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

/** Cordis 上下文的核心成员：不是服务，无需 inject。 */
const CORE = new Set([
  'get', 'set', 'on', 'once', 'off', 'emit', 'parallel', 'waterfall', 'bail',
  'effect', 'inject', 'provide', 'scope', 'isolate', 'plugin', 'registry',
  'logger', 'root', 'fiber', 'baseUrl', 'config', 'schema', '$', 'name',
])

/** 去掉注释，避免把文档里提到的 `ctx.x` 当成真实访问。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const files = readdirSync(join(PRESET, 'plugins')).filter((f) => f.endsWith('.mjs')).sort()
ok('发现插件文件', files.length > 0, `${files.length} 个`)

const declaredCount = new Map()
for (const file of files) {
  const raw = readFileSync(join(PRESET, 'plugins', file), 'utf8')
  const code = stripComments(raw)
  const injectRaw = /export const inject\s*=\s*\[([^\]]*)\]/.exec(code)?.[1] ?? ''
  const declared = new Set(
    injectRaw
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s !== ''),
  )
  declaredCount.set(file, declared)

  // 本插件里真实访问的服务（排除核心成员）
  const used = new Set()
  for (const m of code.matchAll(/ctx\.([a-zA-Z_$][\w$]*)/g)) {
    if (!CORE.has(m[1])) used.add(m[1])
  }

  const missing = [...used].filter((s) => !declared.has(s)).sort()
  ok(
    `${file}：访问的服务都已 inject 声明`,
    missing.length === 0,
    missing.length === 0 ? '' : `缺少 ${missing.join(', ')} → 挂载时会抛 "cannot get property '${missing[0]}' without inject"`,
  )

  const unused = [...declared].filter((s) => !used.has(s)).sort()
  if (unused.length > 0) results.push(`⏵ ${file}：inject 声明但未直接使用（可能为等待服务就绪）：${unused.join(', ')}`)

  // 可选服务应走 ctx.get
  const directOptional = [...used].filter((s) => /shell|sandboxPolicy|sessionProjections/.test(s) && declared.has(s))
  if (directOptional.length > 0) {
    results.push(`⏵ ${file}：直接注入 ${directOptional.join(', ')}（若服务可能缺席，改用 ctx.get 并判 undefined 更稳）`)
  }
}

// ── 真挂载模拟：用**严格 ctx**（访问未 inject 的服务就抛，与 Cordis 行为一致）────────
// 这条是端到端的：不只静态看声明，而是真的调用 apply()，把「运行时才炸」的坑也挡住。
const mountResults = []
for (const file of files) {
  const declared = declaredCount.get(file) ?? new Set()
  const registered = { tools: [], sections: [] }
  const services = {
    tools: { register: (t) => registered.tools.push(t?.name ?? '(无名)') },
    systemPrompt: { section: (sec) => { registered.sections.push(sec?.name ?? '(无名)'); return () => {} } },
    shell: { resolve: (spec) => spec, run: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) },
    sandboxPolicy: { resolve: () => undefined },
    sessionProjections: { register: () => () => {} },
    skills: { register: () => () => {} },
  }
  const base = {
    get: () => undefined, on: () => () => {}, effect: (fn) => { const d = typeof fn === 'function' ? fn() : undefined; return typeof d === 'function' ? d : () => {} },
    inject: (deps, fn) => fn({ get: () => undefined }), logger: { warn() {}, info() {}, error() {} }, root: {}, fiber: {},
  }
  const ctx = new Proxy(base, {
    get(t, key) {
      if (typeof key === 'symbol' || key in t) return t[key]
      if (!declared.has(key)) throw new Error(`cannot get property '${key}' without inject`)
      return services[key]
    },
  })
  try {
    const mod = await import(join(PRESET, 'plugins', file))
    const r = typeof mod.apply === 'function' ? mod.apply(ctx) : undefined
    if (r !== undefined && typeof r.then === 'function') await r
    mountResults.push({ file, ok: true, tools: registered.tools, sections: registered.sections })
  } catch (err) {
    mountResults.push({ file, ok: false, error: String(err?.message ?? err) })
  }
}
for (const r of mountResults) {
  ok(`真挂载模拟：${r.file} 用严格 ctx 能 apply`, r.ok, r.ok ? '' : r.error)
}
{
  const allTools = mountResults.filter((r) => r.ok).flatMap((r) => r.tools)
  const allSections = mountResults.filter((r) => r.ok).flatMap((r) => r.sections)
  ok('6 个工具都被注册', allTools.length === 6 && new Set(allTools).size === 6, allTools.join(','))
  ok('纪律提示段被注册', allSections.includes('math-proof:discipline'), allSections.join(','))
}

// ── 具体回归：把「真实事故」钉死 ─────────────────────────────────────────
{
  const text = readFileSync(join(PRESET, 'plugins', 'proof-discipline.mjs'), 'utf8')
  const inject = /export const inject\s*=\s*\[([^\]]*)\]/.exec(text)?.[1] ?? ''
  ok('proof-discipline 声明了 systemPrompt（注册提示段的硬前提）', inject.includes('systemPrompt'), inject.trim())
  ok('proof-discipline 仍然声明 tools', inject.includes('tools'), inject.trim())
}

// ── 组合行覆盖：每个本地插件行都在检查范围内 ─────────────────────────────
{
  const comp = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')
  const localRows = [...comp.matchAll(/name:\s*'\.\/plugins\/([^']+)'/g)].map((m) => m[1])
  const unchecked = [...new Set(localRows)].filter((f) => !files.includes(f))
  ok('所有本地插件行都被本门禁覆盖', unchecked.length === 0, unchecked.join(', '))
}

console.log('# 插件依赖注入门禁（ctx.<服务> 必须 inject 声明）\n')
console.log(`- 插件 **${files.length}** 个｜核心成员白名单 **${CORE.size}** 个\n`)
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'INJECT_OK' : 'INJECT_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
