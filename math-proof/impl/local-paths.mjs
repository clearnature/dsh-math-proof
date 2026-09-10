// 数学证明模式 — 本机路径**唯一解析处**（零依赖）
//
// 设计：路径只写在 `impl/local-paths.json`；其它地方一律用**键名**引用——
//   · 纪律段里写 `{{wiki}}` 这种 token，由本模块在装配 prompt 时替换成真值；
//   · 技能正文（由 dsh 的技能加载器直接读取，不经我们的插件）写「键名 + 指向本文件」；
//   · 插件与脚本 import 本模块拿值（而不是写死字符串）。
//
// 覆盖顺序：**环境变量 > JSON 里的 value**（换机器不用改仓库，`SOVEREIGN_REPO=... ` 即可）。
// 门禁 `tests/paths-check.mjs` 强制「操作性文件里不得出现机器绝对路径」，本文件是唯一例外。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PATHS_FILE = join(HERE, 'local-paths.json')

/**
 * **内置兜底**（与 `local-paths.json` 同值）。
 *
 * 为什么必须有它：`local-paths.json` 一旦**缺失或语法坏掉**，原先的实现会在 import 期抛错——
 * 而 `agda-engine.mjs` / `proof-discipline.mjs` 都在模块顶层取路径 → **两行挂不上 → 整个 preset 不可用**。
 * 配置坏掉是「配置问题」，不该连坐整个 preset。所以：解析失败 → 用这里的兜底值 + 明确报告，
 * 绝不在 import 期抛错。
 */
const DEFAULTS = {
  workspace: { value: '/data/work/discrete-mathematics', env: 'SOVEREIGN_REPO', what: '数学证明库（工作区）' },
  wiki: { value: '/data/work/docs/wiki', env: 'SOVEREIGN_WIKI', what: '数学依据 wiki' },
  typeTheoryDocs: { value: '/home/yanli/文档/math/类型论', env: 'SOVEREIGN_TT_DOCS', what: '依赖类型论原始文档' },
  dypeRoot: { value: '/data/work/functional-programming/dype', env: 'SOVEREIGN_DYPE', what: 'dype 源码（实验性内核，不作裁决）' },
  agdaBin: { value: '/opt/agda/agda', env: 'SOVEREIGN_AGDA', what: 'Agda 二进制' },
  agdaStdlib: { value: '/data/work/functional-programming/agda-stdlib', env: 'SOVEREIGN_STDLIB', what: 'stdlib 源码' },
  leanWorkspace: { value: '/home/yanli/.dsh/prove2me_workspace', env: 'SOVEREIGN_LEAN_WS', what: 'Lean 可选工作区' },
  leanMathlib: { value: '/data/work/leanprover/mathlib4', env: 'SOVEREIGN_MATHLIB', what: 'mathlib4 检出' },
}

/**
 * 读原始配置。**永不抛错**：文件缺失/JSON 坏掉 → 返回空表 + `error` 说明（调用方用内置兜底）。
 * @returns {{envPrefix: string, paths: object, error: string|null}}
 */
export function readPathConfig() {
  try {
    const raw = JSON.parse(readFileSync(PATHS_FILE, 'utf8'))
    const paths = raw?.paths
    if (paths === null || typeof paths !== 'object' || Object.keys(paths).length === 0) {
      return { envPrefix: String(raw?._envPrefix ?? ''), paths: {}, error: `${PATHS_FILE} 里没有 paths 表` }
    }
    return { envPrefix: String(raw._envPrefix ?? ''), paths, error: null }
  } catch (err) {
    return { envPrefix: '', paths: {}, error: `读 ${PATHS_FILE} 失败：${String(err?.message ?? err)}` }
  }
}

/**
 * 解析后的路径表：`{ key: { value, source, what, env } }`。
 * `source` ∈ `env` | `config`——**来源要可见**，否则「为什么这个路径和配置文件里不一样」会变成谜。
 */
export function resolvePaths(env = process.env) {
  const { envPrefix, paths } = readPathConfig()
  const keys = [...new Set([...Object.keys(DEFAULTS), ...Object.keys(paths)])]
  const out = {}
  for (const key of keys) {
    const spec = paths[key] ?? DEFAULTS[key] ?? {}
    const fallback = DEFAULTS[key]
    const source = paths[key] !== undefined ? 'config' : 'fallback'
    const envName = spec.env ?? fallback?.env ?? `${envPrefix}${key.toUpperCase()}`
    const fromEnv = typeof env[envName] === 'string' && env[envName] !== '' ? env[envName] : null
    out[key] = {
      value: fromEnv ?? String(spec.value ?? fallback?.value ?? ''),
      source: fromEnv === null ? source : 'env',
      env: envName,
      what: String(spec.what ?? fallback?.what ?? ''),
    }
  }
  return out
}

/** 单键取值（解析后的字符串；键不存在抛错——静默返回空串会让失败变成谜）。 */
export function path(key, env = process.env) {
  const table = resolvePaths(env)
  if (table[key] === undefined) {
    throw new Error(`local-paths: 未知路径键 "${key}"（可用：${Object.keys(table).join(', ')}）`)
  }
  return table[key].value
}

/**
 * 把文本里的 `{{key}}` 替换成解析后的真值。
 * 未知键**不静默**：替换成 `«未知路径键 key»` 并报告出来，方便门禁与人工发现。
 * @returns {{ text: string, missing: string[], used: string[] }}
 */
export function renderTokens(text, env = process.env) {
  const table = resolvePaths(env)
  const missing = []
  const used = []
  const out = String(text ?? '').replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_all, key) => {
    used.push(key)
    if (table[key] === undefined) {
      missing.push(key)
      return `«未知路径键 ${key}»`
    }
    return table[key].value
  })
  return { text: out, missing: [...new Set(missing)], used: [...new Set(used)] }
}

/**
 * 渲染成给模型看的「本机路径」小节（进常驻前缀，所以极简：键 → 值 + 来源标注）。
 * 变化频率低、内容短，且**只在路径真的变了**才改字节 → 对缓存前缀友好。
 */
export function renderPathSection(env = process.env, heading = '### 本机路径（唯一配置处：`impl/local-paths.json`）') {
  const table = resolvePaths(env)
  const { error } = readPathConfig()
  const lines = [heading, '']
  if (error !== null) {
    lines.push(`> ⚠ **配置文件读取失败，正在使用内置兜底值**：${error}`)
    lines.push(`> 修好 \`impl/local-paths.json\`（或用 \`SOVEREIGN_*\` 环境变量覆盖）即可恢复；本 preset 不会因为配置文件坏掉而挂不上。`)
    lines.push('')
  }
  for (const [key, v] of Object.entries(table)) {
    const src = v.source === 'env' ? `（env \`${v.env}\` 覆盖）` : ''
    lines.push(`- **${key}** = \`${v.value}\`${src} —— ${v.what}`)
  }
  lines.push('')
  lines.push('> 这些值只写在 `impl/local-paths.json`；别处一律引用键名（纪律段里写作 `{{key}}`）。改机器/改目录只动那一个文件，或用环境变量覆盖。')
  return lines.join('\n')
}

/** 内置兜底表（供门禁核对「兜底与 JSON 必须一致」，防止两处漂移）。 */
export function builtinDefaults() {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { value: v.value, env: v.env, what: v.what }]))
}

/** 键名清单（门禁与文档用）。 */
export function pathKeys() {
  return Object.keys(readPathConfig().paths)
}
