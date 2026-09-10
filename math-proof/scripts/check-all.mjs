// 数学证明模式 — 一键门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/scripts/check-all.mjs
// 退出码 0 = 全部通过；非 0 = 有套件失败（并打印失败套件的尾部输出）。
//
// 为什么需要它：门禁有 19 个入口（lint + 18 套件）。日常「改完跑一遍」不该记命令，
// 也不该漏跑。本脚本按固定顺序执行、汇总成一张表，并把失败套件的尾部日志原样贴出
// （禁止「我跑过了」式声称——证据必须出现在输出里）。

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const SUITES = [
  ['lint', join(PRESET, 'scripts', 'lint-schemas.mjs'), 'SCHEMA_LINT_OK'],
  ['run', join(PRESET, 'tests', 'run.mjs'), 'ALL_PASS'],
  ['benchmark', join(PRESET, 'tests', 'benchmark.mjs'), 'BENCHMARK_PASS'],
  ['eval-check', join(PRESET, 'tests', 'eval-check.mjs'), 'EVAL_CHECK_OK'],
  ['knowledge-check', join(PRESET, 'tests', 'knowledge-check.mjs'), 'KNOWLEDGE_OK'],
  ['dup-check', join(PRESET, 'tests', 'dup-check.mjs'), 'DUP_OK'],
  ['cache-check', join(PRESET, 'tests', 'cache-check.mjs'), 'CACHE_OK'],
  ['refs-check', join(PRESET, 'tests', 'refs-check.mjs'), 'REFS_OK'],
  ['routing-check', join(PRESET, 'tests', 'routing-check.mjs'), 'ROUTING_OK'],
  ['hooks-check', join(PRESET, 'tests', 'hooks-check.mjs'), 'HOOKS_OK'],
  ['market-check', join(PRESET, 'tests', 'market-check.mjs'), 'MARKET_OK'],
  ['plugins-check', join(PRESET, 'tests', 'plugins-check.mjs'), 'PLUGINS_OK'],
  ['publish-check', join(PRESET, 'tests', 'publish-check.mjs'), 'PUBLISH_OK'],
  ['ruleset-check', join(PRESET, 'tests', 'ruleset-check.mjs'), 'RULESET_OK'],
  ['docs-check', join(PRESET, 'tests', 'docs-check.mjs'), 'DOCS_OK'],
  ['skills-ref-check', join(PRESET, 'tests', 'skills-ref-check.mjs'), 'SKILLS_REF_OK'],
  ['paths-check', join(PRESET, 'tests', 'paths-check.mjs'), 'PATHS_OK'],
  ['inject-check', join(PRESET, 'tests', 'inject-check.mjs'), 'INJECT_OK'],
  ['prompt-vars-check', join(PRESET, 'tests', 'prompt-vars-check.mjs'), 'PROMPT_VARS_OK'],
]

const rows = []
const failures = []
const started = Date.now()
for (const [name, file, marker] of SUITES) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const ms = Date.now() - t0
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const last = out.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? ''
  // refs-check 在无仓库时会 SKIP，也算通过
  const ok = r.status === 0 && (last.includes(marker) || last.includes('REFS_SKIP'))
  rows.push(`| ${ok ? '✅' : '❌'} | ${name} | ${(ms / 1000).toFixed(1)}s | ${last.slice(0, 96)} |`)
  if (!ok) failures.push({ name, out })
}

console.log(`# 数学证明模式 — 一键门禁（${((Date.now() - started) / 1000).toFixed(1)}s）\n`)
console.log('| 结果 | 套件 | 用时 | 末行 |')
console.log('| --- | --- | --- | --- |')
console.log(rows.join('\n'))

if (failures.length > 0) {
  console.log('\n## 失败详情（尾部 30 行）')
  for (const f of failures) {
    console.log(`\n### ${f.name}`)
    console.log('```')
    console.log(f.out.trim().split('\n').slice(-30).join('\n'))
    console.log('```')
  }
  console.log(`\nCHECK_ALL_FAIL ${SUITES.length - failures.length}/${SUITES.length}`)
  process.exit(1)
}
console.log(`\nCHECK_ALL_OK ${SUITES.length}/${SUITES.length}`)
console.log('> 挂载校验（需 harness 内部）：见 composition 头部注释或 README。')
