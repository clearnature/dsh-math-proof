// 数学证明模式 — 提示段变量门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/prompt-vars-check.mjs
// 期望最后一行：PROMPT_VARS_OK n/n
//
// 为什么要有它（真实事故 2026-09-10）：
//   `impl/local-paths.mjs` 的「本机路径」小节里，我为了说明 token 写法写了示例文字 **`{{key}}`** ——
//   结果 `dsh-system-prompt` 对每个 section 的 text 做**严格插值**，把 `{{key}}` 当成变量引用，
//   而注册变量只有 `provider` / `model` / `cwd` → 抛
//   **`unknown prompt variable "{{key}}" in section "math-proof:discipline"` → 整轮运行失败**。
//
// 规则（本门禁强制）：
//   1. **我们贡献的每个提示段文本**里，出现的 `{{名字}}` 必须在部署注册的变量集合内；
//   2. **不允许裸 `{{`**（即使没有配对的 `}}`，也可能在拼接后变成「malformed reference」而炸整轮）；
//   3. 纪律段经过本 preset 的 token 替换（`{{wiki}}` → 真值）后，**不得再有任何花括号**。
//
// 部署的注册变量若变化，改下面的 REGISTERED（或设 DSH_PROMPT_VARIABLES 覆盖），
// 报错信息里会原样列出当下的注册集合，便于对照。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

/** 部署注册的提示变量（来自 dsh-system-prompt 的报错信息；可用环境变量覆盖）。 */
const REGISTERED = new Set(
  (process.env.DSH_PROMPT_VARIABLES ?? 'provider,model,cwd')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== ''),
)

/** 从一个文本里抽出 `{{name}}` 引用与裸 `{{`。 */
function inspect(label, text) {
  const refs = [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1])
  const unknown = refs.filter((n) => !REGISTERED.has(n))
  // 裸 `{{`：任何出现（无论是否配对）都危险
  const bareOpen = (text.match(/\{\{/g) ?? []).length
  const paired = refs.length
  return { label, refs, unknown, bareOpen, paired, bare: bareOpen - paired }
}

const texts = []

// ── 1) persona（agent.cordis.yml 的 persona 行 text 块）──────────────────
{
  const comp = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')
  const m = /\n\s*text:\s*\|-\n([\s\S]*?)\n\n(?=\S|\s*-\s*id:)/.exec(comp)
  if (m !== null) texts.push(inspect('persona（agent.cordis.yml）', m[1]))
  else results.push('⏵ 未从 composition 里解析出 persona text 块（跳过该段检查）')

  // ── 2) composition 里所有 section: 块（如 plan-mode 的提示段）──────────
  for (const sm of comp.matchAll(/\n\s*section:\s*[>|]-?\n([\s\S]*?)(?=\n\s{0,8}\S)/g)) {
    texts.push(inspect('composition section 块', sm[1]))
  }
}

// ── 3) 纪律段：本 preset 自己装配注入的那一段（含 path 小节）──────────────
{
  const mod = await import(join(PRESET, 'plugins', 'proof-discipline.mjs'))
  texts.push(inspect('section "math-proof:discipline"', mod.disciplineWithPaths()))
}

// ── 判定 ────────────────────────────────────────────────────────────────
ok('至少检查到 2 段提示文本', texts.length >= 2, `${texts.length} 段`)
for (const t of texts) {
  ok(
    `${t.label}：无未注册的 {{变量}}`,
    t.unknown.length === 0,
    t.unknown.length === 0 ? '' : `未注册 ${t.unknown.map((x) => `{{${x}}}`).join(', ')}（注册集合：${[...REGISTERED].join(', ')}）`,
  )
  ok(`${t.label}：无裸 {{`, t.bare === 0, t.bare === 0 ? '' : `裸 {{ ${t.bare} 处`)
}

// ── 具体回归：钉死本次事故 ───────────────────────────────────────────────
{
  const disc = (await import(join(PRESET, 'plugins', 'proof-discipline.mjs'))).disciplineWithPaths()
  ok('纪律段注入文本已不含任何花括号（token 已替换）', !disc.includes('{{') && !disc.includes('}}'), '')
  ok('「本机路径」小节在场（说明路径集中化生效）', disc.includes('本机路径'), '')
}

// ── 静态提醒：插件里作为 section text 的字符串不得含花括号 ────────────────
{
  const hits = []
  for (const f of ['proof-discipline.mjs']) {
    const src = readFileSync(join(PRESET, 'plugins', f), 'utf8')
    for (const line of src.split('\n')) {
      // 只看非注释行里带 section( 且带 {{ 的写法
      if (/^\s*(\/\/|\*)/.test(line)) continue
      if (line.includes('section(') && line.includes('{{')) hits.push(`${f}: ${line.trim().slice(0, 80)}`)
    }
  }
  ok('插件源码里没有「section + 花括号」的危险写法', hits.length === 0, hits.join(' | '))
}

console.log('# 提示段变量门禁（未注册的 {{variable}} 会让整轮运行失败）\n')
console.log(`- 注册变量：**${[...REGISTERED].join(', ')}**｜检查文本 **${texts.length}** 段\n`)
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'PROMPT_VARS_OK' : 'PROMPT_VARS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
