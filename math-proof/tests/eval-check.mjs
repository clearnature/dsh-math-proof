// 数学证明模式 — eval 定义完整性校验（不执行模型，只守门）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/eval-check.mjs
// 期望最后一行：EVAL_CHECK_OK n/n
//
// 校验 evals.json 的结构与**覆盖**：
//   · 必填字段、id 连续、mode 非空
//   · 工具/技能名必须在 preset 里真实存在（防止笔误与「幽灵工具」）
//   · 覆盖全部 5 个工具与全部技能（防止作者漏场景）
//   · 至少 3 条 false-positive / tradeoff 场景（声明 avoid）
// 模型质量本身要跑真模型（headless 没有 preset 选择器，须在 GUI 会话里做）。

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const spec = JSON.parse(readFileSync(join(HERE, 'evals.json'), 'utf8'))

const TOOLS = ['proof_compile', 'proof_audit', 'proof_graph', 'proof_dag', 'prover_limits', 'proof_oracle']
const SKILLS = readdirSync(join(PRESET, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

const problems = []
const seenTools = new Set()
const seenSkills = new Set()
let fp = 0

spec.evals.forEach((e, i) => {
  const at = `eval ${e.id ?? `#${i + 1}`}（${e.name ?? '无名称'}）`
  if (e.id !== i + 1) problems.push(`${at}: id 应为 ${i + 1}，实为 ${e.id}`)
  for (const k of ['name', 'prompt', 'mode']) {
    if (typeof e[k] !== 'string' || e[k].trim() === '') problems.push(`${at}: 缺 ${k}`)
  }
  if (!Array.isArray(e.expect?.tools)) problems.push(`${at}: expect.tools 必须是数组`)
  if (!Array.isArray(e.expect?.skills) || e.expect.skills.length === 0) problems.push(`${at}: expect.skills 不能为空`)
  if (!Array.isArray(e.expect?.structure) || e.expect.structure.length === 0) problems.push(`${at}: expect.structure 不能为空`)
  if (!Array.isArray(e.avoid)) problems.push(`${at}: avoid 必须是数组（可为空）`)
  for (const t of e.expect?.tools ?? []) {
    if (!TOOLS.includes(t)) problems.push(`${at}: 未知工具 "${t}"`)
    else seenTools.add(t)
  }
  for (const s of e.expect?.skills ?? []) {
    if (!SKILLS.includes(s)) problems.push(`${at}: 未知技能 "${s}"`)
    else seenSkills.add(s)
  }
  if (Array.isArray(e.avoid) && e.avoid.length > 0) fp++
})

for (const t of TOOLS) if (!seenTools.has(t)) problems.push(`覆盖缺口：没有任何场景期望调用 ${t}`)
for (const s of SKILLS) if (!seenSkills.has(s)) problems.push(`覆盖缺口：没有任何场景期望加载技能 ${s}`)
if (fp < 3) problems.push(`false-positive 场景不足：需要 >= 3 条带 avoid 的场景，实为 ${fp}`)

console.log(`# evals.json 定义校验（${spec.evals.length} 条场景，冻结于 ${spec.frozenAt}）\n`)
console.log(`- 工具覆盖: ${TOOLS.filter((t) => seenTools.has(t)).length}/${TOOLS.length}`)
console.log(`- 技能覆盖: ${SKILLS.filter((s) => seenSkills.has(s)).length}/${SKILLS.length}`)
console.log(`- false-positive / tradeoff 场景: ${fp}`)
if (problems.length > 0) {
  console.log('\n## 问题')
  for (const p of problems) console.log(`- ${p}`)
}
const total = spec.evals.length + TOOLS.length + SKILLS.length + 1
const bad = problems.length
console.log(`\n${bad === 0 ? 'EVAL_CHECK_OK' : 'EVAL_CHECK_FAIL'} ${total - bad}/${total}`)
process.exit(bad === 0 ? 0 : 1)
