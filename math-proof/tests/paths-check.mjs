// 数学证明模式 — 本机路径集中化门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/paths-check.mjs
// 期望最后一行：PATHS_OK n/n
//
// 规矩（用户 2026-09-10 定）：**本机绝对路径必须集中在可配置的一处，其余改指针。**
//   唯一配置处 = `impl/local-paths.json`（可用环境变量 `SOVEREIGN_*` 覆盖）。
//
// 本门禁做五件事：
//   1. **操作性文件**（persona / 纪律段 / 技能 / 钩子 / 插件 / 脚本 / 测试 / 架构文档 / README）
//      里不得出现机器绝对路径（`/home/<用户>`、`/data`、`/opt`、`/Users`、`/mnt`、`/srv`）；
//      唯一例外是 `impl/local-paths.json` 本身。
//   2. **历史与快照**（`audit/rounds.md`、`AUDIT.md`、`docs/releases/**`）**豁免**——
//      记录过去发生的事，改写出处的路径等于篡改历史；报告里只统计数量。
//   3. 纪律段里的 `{{key}}` token 必须都能在配置里找到（未知键 = 提示词里会出现占位符残留）。
//   4. 配置里的每个键至少要**被用到一次**（token、键名引用或代码读取），杜绝死键。
//   5. 解析器行为：env 覆盖优先级、未知键报错（可测的行为，而不是「应该没问题」）。
//
// 允许的写法：纪律段用 `{{workspace}}`（装配时替换）；技能/文档用「键名 + 指向 `impl/local-paths.json`」；
// 代码 `import { path } from '../impl/local-paths.mjs'` 取真值。
// **不允许**：把路径抄进正文、注释、文档或测试默认值里。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { builtinDefaults, path as localPath, pathKeys, renderTokens, resolvePaths } from '../impl/local-paths.mjs'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
// 允许出现绝对路径的两个地方：JSON（唯一配置处）与解析器模块（内置兜底，防「配置坏了连坐 preset」）。
// 两者必须**逐键一致**——本门禁会核对，避免两处漂移。
const CONFIG_FILES = new Set(['impl/local-paths.json', 'impl/local-paths.mjs'])
const CONFIG_REL = 'impl/local-paths.json'

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

// 机器根：必须以路径边界开头（`/src/data/lib` 这种**工具内部**路径不算——它不是本机配置）
const MACHINE = /(?:^|[^A-Za-z0-9_/])(\/(?:home|Users|opt|data|mnt|srv)\/[A-Za-z0-9._\u4e00-\u9fff/-]*)/g

const EXEMPT_HISTORY = ['audit/rounds.md', 'AUDIT.md']
const isHistory = (rel) => EXEMPT_HISTORY.includes(rel) || rel.startsWith('docs/releases/')

/** 收集候选文件。 */
function collect(rel) {
  const abs = join(PRESET, rel)
  if (!existsSync(abs)) return []
  const st = readdirSync(abs, { withFileTypes: true })
  const out = []
  for (const e of st) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (['state', 'node_modules', '.git', '__pycache__', 'fixtures'].includes(e.name)) continue
      out.push(...collect(child))
      continue
    }
    if (/\.(md|mjs|yml|json)$/.test(e.name)) out.push(child)
  }
  return out
}

const operativeFiles = [
  'agent.cordis.yml',
  ...collect('impl').filter((f) => !CONFIG_FILES.has(f)),
  ...collect('skills'),
  ...collect('hooks'),
  ...collect('plugins'),
  ...collect('scripts'),
  ...collect('tests').filter((f) => !isHistory(f)),
  ...collect('docs').filter((f) => !isHistory(f)),
  'README.md',
  'CACHE.md',
]

// ── 1) 操作性文件不得含机器绝对路径 ──────────────────────────────────────
const violations = []
for (const rel of operativeFiles) {
  const text = readFileSync(join(PRESET, rel), 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 注释不是提示词内容，但**仍不该抄路径**（脚本/插件注释里的路径会误导读者）——除扫描器自身
    if (rel === 'scripts/publish.mjs' || rel === 'tests/paths-check.mjs') continue
    for (const m of line.matchAll(MACHINE)) {
      // 举例性质的占位写法放行：/home/<用户>…
      if (/\/home\/<[^>]*>/.test(m[1])) continue
      violations.push(`${rel}:${i + 1} → ${m[1]}`)
    }
  }
}
ok(
  `操作性文件里没有机器绝对路径（${operativeFiles.length} 个文件）`,
  violations.length === 0,
  violations.slice(0, 6).join(' | ') + (violations.length > 6 ? ` …共 ${violations.length} 处` : ''),
)

// ── 2) 历史/快照只统计，不改写 ───────────────────────────────────────────
const historyHits = []
for (const rel of [...EXEMPT_HISTORY, ...collect('docs').filter(isHistory)]) {
  const abs = join(PRESET, rel)
  if (!existsSync(abs)) continue
  const n = [...readFileSync(abs, 'utf8').matchAll(MACHINE)].length
  if (n > 0) historyHits.push(`${rel}:${n}`)
}
results.push(`⏵ 历史/快照豁免（不改写）：${historyHits.join(' , ') || '无'}`)

// ── 2.5) 兜底表与配置文件必须一致（防两处漂移）────────────────────────────
{
  const raw = JSON.parse(readFileSync(join(PRESET, CONFIG_REL), 'utf8'))
  const jsonPaths = raw.paths ?? {}
  const builtin = builtinDefaults()
  const drift = []
  for (const [key, spec] of Object.entries(jsonPaths)) {
    const b = builtin[key]
    if (b === undefined) {
      drift.push(`${key}（兜底表里没有）`)
      continue
    }
    if (b.value !== spec.value) drift.push(`${key}: json=${spec.value} ≠ 兜底=${b.value}`)
    if (b.env !== spec.env) drift.push(`${key}: env 名不一致`)
  }
  ok('解析器内置兜底与 local-paths.json 逐键一致（防两处漂移）', drift.length === 0, drift.slice(0, 3).join(' | '))
  ok('兜底表覆盖 JSON 的所有键', Object.keys(jsonPaths).every((k) => k in builtin), Object.keys(jsonPaths).filter((k) => !(k in builtin)).join(','))
}

// ── 3) 纪律段的 token 必须都有定义 ───────────────────────────────────────
const discipline = readFileSync(join(PRESET, 'impl', 'discipline.md'), 'utf8')
const rendered = renderTokens(discipline, {})
ok('纪律段的 {{token}} 全部有定义', rendered.missing.length === 0, rendered.missing.join(', '))
ok('纪律段至少用了一个路径 token（否则说明又抄回路径了）', rendered.used.length > 0, rendered.used.join(', '))

// ── 4) 配置的每个键都被用到（无死键） ────────────────────────────────────
const keys = pathKeys()
const haystack = [...operativeFiles.map((f) => readFileSync(join(PRESET, f), 'utf8')), discipline].join('\n')
const unused = keys.filter((k) => {
  const asToken = haystack.includes(`{{${k}}}`)
  const asKey = new RegExp(`[\`'"（(]${k}[\`'"）)]`).test(haystack) || haystack.includes(`\`${k}\``)
  return !asToken && !asKey
})
ok('配置里没有死键（每个键都被引用）', unused.length === 0, unused.join(', '))

// ── 5) 解析器行为 ────────────────────────────────────────────────────────
const base = resolvePaths({})
ok('默认解析：全部键有值且来源为 config', keys.every((k) => base[k].value !== '' && base[k].source === 'config'))
const overridden = resolvePaths({ [base.workspace.env]: '/tmp/elsewhere' })
ok('env 覆盖优先于配置文件', overridden.workspace.value === '/tmp/elsewhere' && overridden.workspace.source === 'env', overridden.workspace.value)
let threw = false
try {
  localPath('no-such-key', {})
} catch {
  threw = true
}
ok('未知键直接报错（不静默返回空串）', threw)
const unknownTok = renderTokens('看看 {{not_a_key}}', {})
ok('未知 token 被标出而不是静默替换', unknownTok.missing.includes('not_a_key') && /未知路径键/.test(unknownTok.text))

// ── 6) 文档说明「唯一配置处」 ────────────────────────────────────────────
const m1 = existsSync(join(PRESET, 'docs/maps/M1-architecture.md')) ? readFileSync(join(PRESET, 'docs/maps/M1-architecture.md'), 'utf8') : ''
ok('M1 架构图说明路径集中化政策', m1.includes('local-paths.json'), '')
const readme = readFileSync(join(PRESET, 'README.md'), 'utf8')
ok('README 说明「换机器只改一个文件 / 可用环境变量覆盖」', /local-paths\.json/.test(readme) && /SOVEREIGN_/.test(readme), '')

// ── 7) 状态目录唯一实现（2026-09-10 事故：插件各自硬编码 → 测试污染真实状态）──────
{
  const stateDirSrc = readFileSync(join(PRESET, 'impl', 'state-dir.mjs'), 'utf8')
  ok('状态目录有唯一实现 impl/state-dir.mjs', stateDirSrc.includes('export function stateDir'))
  ok('状态目录支持 MATH_PROOF_STATE_DIR 覆盖（测试隔离 / 换环境）', stateDirSrc.includes('MATH_PROOF_STATE_DIR'))
  const stateModule = await import(join(PRESET, 'impl', 'state-dir.mjs'))
  const saved = process.env.MATH_PROOF_STATE_DIR
  process.env.MATH_PROOF_STATE_DIR = '/tmp/state-override-probe'
  const overridden = stateModule.stateDir()
  delete process.env.MATH_PROOF_STATE_DIR
  const fallback = stateModule.stateDir()
  if (saved !== undefined) process.env.MATH_PROOF_STATE_DIR = saved
  ok('env 覆盖生效', overridden === '/tmp/state-override-probe', overridden)
  ok('未设置时回落到 ~/.dsh/state/math-proof（生产行为不变）', fallback.endsWith('/.dsh/state/math-proof'), fallback)
  // 插件里不许再硬编码状态目录（否则测试又会绕过覆盖去写真实状态）
  // ⚠ 插件**和钩子**都要查：2026-09-10 实测 `hooks/fable5-flow.mjs` 也硬编码了状态目录，
  // 于是测试（设了 MATH_PROOF_STATE_DIR）写的流程标记照样落进**用户真实目录**。
  const offenders = []
  for (const sub of ['plugins', 'hooks', 'scripts']) {
    for (const f of readdirSync(join(PRESET, sub)).filter((x) => x.endsWith('.mjs'))) {
      const text = readFileSync(join(PRESET, sub, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/[^\n]*/gm, '')
      if (/\.dsh['"]\s*,\s*['"]state['"]\s*,\s*['"]math-proof['"]/.test(text)) offenders.push(`${sub}/${f}`)
    }
  }
  ok('插件 / 钩子 / 脚本里都没有硬编码状态目录（一律走 impl/state-dir.mjs）', offenders.length === 0, offenders.join(','))
  const runner = readFileSync(join(PRESET, 'tests', 'run.mjs'), 'utf8')
  ok('主回归套件把状态指向临时目录（不写用户真实状态）', runner.includes('MATH_PROOF_STATE_DIR'))
}

// ── 6) 会话日志的**文件名规则**也只有一处实现 ──────────────────────────────
// 2026-09-11 真实事故：0.1.5 把老日志迁成 `session.v3.jsonl.zstd` 而**不删**旧的
// `session.jsonl.zstd`（实测 26 个会话里 2 个目录两份共存，111/112 个回合重叠）。
// 谁自己拼文件名，谁就会把同一会话算两遍、或在新会话上算 0。
{
  const offenders = []
  for (const sub of ['plugins', 'hooks', 'scripts']) {
    for (const f of readdirSync(join(PRESET, sub)).filter((x) => x.endsWith('.mjs'))) {
      const text = readFileSync(join(PRESET, sub, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/[^\n]*/gm, '')
      if (/['"]session\.jsonl/.test(text)) offenders.push(`${sub}/${f}`)
    }
  }
  ok('脚本 / 插件 / 钩子不自己拼会话日志文件名（走 impl 的 sessionLogFiles / pickSessionLog / sessionLogVersion）', offenders.length === 0, offenders.join(','))
  const impl = readFileSync(join(PRESET, 'impl', 'session-traffic.mjs'), 'utf8')
  ok('唯一实现处导出了文件名规则（pickSessionLog / sessionLogVersion）', /export function pickSessionLog/.test(impl) && /export function sessionLogVersion/.test(impl))
  ok('唯一实现处说明了「迁移会留下旧文件」这件事（不然下一个人会再踩）', /session\.v3\.jsonl\.zstd/.test(impl) && /留在原地/.test(impl))
}

console.log('# 本机路径集中化门禁（唯一配置处 / token / 死键 / 解析器行为）\n')
console.log(`- 操作性文件 **${operativeFiles.length}**｜配置键 **${keys.size ?? keys.length}**｜历史豁免文件 **${historyHits.length}**\n`)
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'PATHS_OK' : 'PATHS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
