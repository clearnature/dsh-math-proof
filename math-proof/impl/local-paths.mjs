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

/** 读原始配置（含 env 名与说明）。 */
export function readPathConfig() {
  const raw = JSON.parse(readFileSync(PATHS_FILE, 'utf8'))
  return { envPrefix: raw._envPrefix ?? '', paths: raw.paths ?? {} }
}

/**
 * 解析后的路径表：`{ key: { value, source, what, env } }`。
 * `source` ∈ `env` | `config`——**来源要可见**，否则「为什么这个路径和配置文件里不一样」会变成谜。
 */
export function resolvePaths(env = process.env) {
  const { envPrefix, paths } = readPathConfig()
  const out = {}
  for (const [key, spec] of Object.entries(paths)) {
    const envName = spec.env ?? `${envPrefix}${key.toUpperCase()}`
    const fromEnv = typeof env[envName] === 'string' && env[envName] !== '' ? env[envName] : null
    out[key] = {
      value: fromEnv ?? String(spec.value ?? ''),
      source: fromEnv === null ? 'config' : 'env',
      env: envName,
      what: String(spec.what ?? ''),
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
  const lines = [heading, '']
  for (const [key, v] of Object.entries(table)) {
    const src = v.source === 'env' ? `（env \`${v.env}\` 覆盖）` : ''
    lines.push(`- **${key}** = \`${v.value}\`${src} —— ${v.what}`)
  }
  lines.push('')
  lines.push('> 这些值只写在 `impl/local-paths.json`；别处一律引用键名（纪律段里写作 `{{key}}`）。改机器/改目录只动那一个文件，或用环境变量覆盖。')
  return lines.join('\n')
}

/** 键名清单（门禁与文档用）。 */
export function pathKeys() {
  return Object.keys(readPathConfig().paths)
}
