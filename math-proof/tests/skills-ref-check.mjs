// 数学证明模式 — 技能引用完整性门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/skills-ref-check.mjs
// 期望最后一行：SKILLS_REF_OK n/n
//
// 为什么要有它：**引用了一个没随包分发的技能 = 对用户死链**。
// 真实事故（2026-09-10）：persona 让模型「开工先加载 `proof-engineer` 技能（``~/.agents/skills/`（用户级技能目录）`）」，
// 但那个技能在**作者本机的用户级技能目录**里，别人 clone 仓库根本拿不到；同理
// `loop-engineer` / `code-reviewer` 也是本机才有。用户点出来的原话：
// 「你那些技能是依赖我们本地的技能但是没有打包到上游的」。
//
// 本门禁做两件事：
//   1. 抽出 preset 里所有**技能引用**（`加载 \`x\`` / `委托 \`x\`` / `\`x\` 技能` 等模式）；
//   2. 每个被引用的技能必须满足其一：
//      · 在 `skills/` 里随包分发；或
//      · 在 `tests/fixtures/external-skills.json` 的**显式白名单**里（说明为什么可以外部提供）。
//      否则失败——逼作者要么打包，要么把引用改成条件式（「若环境无该技能，用 `subagent` 按…委派」）。
//
// 顺带检查 frontmatter 规范：每个 `skills/*/SKILL.md` 必须自带 `name` 与 `description`
// （`whenToUse` 强烈建议有），且 name 与目录名一致——名字对不上，模型按描述路由时会找不到。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

// ── 待扫描的文件：提示词类（persona / 纪律 / 技能正文 / 钩子 / 插件描述）+ 评测场景 ──
const promptFiles = [join(PRESET, 'agent.cordis.yml'), join(PRESET, 'impl', 'discipline.md')]
for (const sub of ['skills', 'hooks', 'plugins']) {
  const dir = join(PRESET, sub)
  if (!existsSync(dir)) continue
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skillFile = join(dir, entry.name, 'SKILL.md')
      if (existsSync(skillFile)) promptFiles.push(skillFile)
      const refs = join(dir, entry.name, 'references')
      if (existsSync(refs)) for (const f of readdirSync(refs)) if (f.endsWith('.md')) promptFiles.push(join(refs, f))
      continue
    }
    if (entry.name.endsWith('.mjs')) promptFiles.push(join(dir, entry.name))
  }
}
const evalsFile = join(PRESET, 'tests', 'evals.json')
if (existsSync(evalsFile)) promptFiles.push(evalsFile)

// ── 1) 抽取技能引用 ───────────────────────────────────────────────────────
// 只认「技能语义」的引用模式，避免把工具名/符号名当成技能（曾经假阳性一堆）
const PATTERNS = [
  /(?:加载|委托|调用)\s*`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g,
  /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`\s*技能/g,
  /技能\s*`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g,
  /(?:技能|skill)\s*[：:是为]\s*`?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`?/g,
]
const referenced = new Map() // name → Set(file)
for (const file of promptFiles) {
  const text = readFileSync(file, 'utf8')
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (!referenced.has(m[1])) referenced.set(m[1], new Set())
      referenced.get(m[1]).add(file.slice(PRESET.length + 1))
    }
  }
}

// ── 2) 已分发的技能 + 显式外部白名单 ──────────────────────────────────────
const skillsDir = join(PRESET, 'skills')
const shipped = new Set(
  readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
    .map((e) => e.name),
)
const allowFile = join(HERE, 'fixtures', 'external-skills.json')
// `_` 开头的键是文档说明（_comment / _format），不是白名单条目
const allow = existsSync(allowFile)
  ? new Set(Object.keys(JSON.parse(readFileSync(allowFile, 'utf8'))).filter((k) => !k.startsWith('_')))
  : new Set()

ok('抽出技能引用', referenced.size > 0, `references=${referenced.size}`)
const missing = [...referenced.keys()].filter((n) => !shipped.has(n) && !allow.has(n)).sort()
ok(
  '所有被引用的技能都已随包分发或在显式白名单内',
  missing.length === 0,
  missing.map((n) => `${n}（引用于 ${[...referenced.get(n)].join(', ')}）`).join(' | '),
)

// 白名单里不该留「其实已经打包」的陈旧条目
const stale = [...allow].filter((n) => shipped.has(n))
ok('外部白名单无陈旧条目（已打包的应删掉）', stale.length === 0, stale.join(', '))

// ── 1.5) 本机技能目录交叉核对 ─────────────────────────────────────────────
// 为什么要有这条：作者/用户机器上的用户级技能目录（`~/.agents/skills`、`~/.reasonix/skills`、
// `~/.dsh/skills`）**别人不一定有**。若 preset 引用了那里的技能却没打包，对 clone 的人就是死链。
// 规则：本机装了、但**没随包分发**、又**没进白名单**的技能名，出现在操作性文件里 → 失败。
// 诚实边界：这条只在「本机存在这些目录」时生效（CI/新克隆上没有它们，退化为上一条的上下文检查）。
import { homedir } from 'node:os'
const localRoots = [join(homedir(), '.agents', 'skills'), join(homedir(), '.reasonix', 'skills'), join(homedir(), '.dsh', 'skills')]
const localSkills = new Set()
for (const root of localRoots) {
  if (!existsSync(root)) continue
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue
    if (existsSync(join(root, e.name, 'SKILL.md'))) localSkills.add(e.name)
  }
}
const operative = promptFiles.filter((f) => !f.endsWith('evals.json'))
// 先把操作性文件读进内存：988 个候选技能 × 70 个文件，逐个 re-read 会慢十倍
const operativeText = operative.map((f) => ({ rel: f.slice(PRESET.length + 1), lines: readFileSync(f, 'utf8').split('\n') }))
const crossHits = []
for (const name of localSkills) {
  if (shipped.has(name) || allow.has(name)) continue
  // 带连字符的技能名可以直接按词边界匹配；**单词名**（如 `implement`）会撞上普通英文词，
  // 所以单词名必须带反引号或出现在技能语境里才算引用（否则 plan-mode 的英文说明都会中枪）
  const wordRe = new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`)
  const ctxRe = new RegExp(`(?:技能|skill|加载|委托|subagent)[^\\n]{0,16}${name}|${name}[^\\n]{0,8}(?:技能|skill)`)
  for (const { rel, lines } of operativeText) {
    lines.forEach((line, i) => {
      const hit = name.includes('-') ? wordRe.test(line) : line.includes(`\`${name}\``) || ctxRe.test(line)
      if (hit) crossHits.push(`${name}（${rel}:${i + 1}）`)
    })
  }
}
ok(
  localSkills.size === 0
    ? '本机无用户级技能目录（CI/新克隆）→ 跳过交叉核对'
    : `本机用户级技能（${localSkills.size} 个）里没有被引用却未打包的`,
  crossHits.length === 0,
  crossHits.slice(0, 5).join(' | '),
)

// ── 2.5) 白名单技能：引用必须是**条件式**（不得预设别人环境里有） ─────────
// 为什么：白名单里的技能（第三方 / 通用）别人不一定有。如果正文写成「加载 `x`」「委托 `x`」，
// 读者会以为这是必需依赖。规则：每一处提及都必须带上条件语（若/如果/存在/否则/不随本仓库分发/可加载）。
const CONDITIONAL = /(若|如果|存在|否则|不随本仓库|可加载|可选|你的环境)/; 
const unconditional = []
for (const name of allow) {
  for (const file of promptFiles) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const hit = name.includes('-')
        ? new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`).test(line)
        : line.includes('`' + name + '`')
      if (!hit) return
      // 注释行（composition 的 # / mjs 的 //）是给维护者看的说明，不要求条件式
      if (/^\s*[#]/.test(line) || /^\s*\/\//.test(line)) return
      // 条件语可能落在相邻行（长句换行很常见）→ 看 ±1 行窗口
      const window = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join(' ')
      if (!CONDITIONAL.test(window)) unconditional.push(`${file.slice(PRESET.length + 1)}:${i + 1} → ${name}`)
    })
  }
}
ok(
  allow.size === 0 ? '无白名单技能（跳过条件式检查）' : `白名单技能的引用都是条件式（${[...allow].join(', ')}）`,
  unconditional.length === 0,
  unconditional.slice(0, 5).join(' | '),
)

// ── 3) 每个技能 frontmatter 规范 ──────────────────────────────────────────
for (const name of [...shipped].sort()) {
  const file = join(skillsDir, name, 'SKILL.md')
  const text = readFileSync(file, 'utf8')
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
  const declared = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  const hasDesc = /^description:\s*\S/m.test(fm)
  const hasWhen = /^whenToUse:\s*\S/m.test(fm)
  ok(`skills/${name}：frontmatter name 与目录名一致`, declared === name, `name=${declared}`)
  ok(`skills/${name}：有 description`, hasDesc)
  ok(`skills/${name}：有 whenToUse（路由用）`, hasWhen)
  // 「不触发」清单是路由纪律：避免与相邻技能抢触发
  ok(`skills/${name}：description 含「不触发」清单`, /不触发/.test(fm), '')
}

// ── 4) 提示词里不得再出现「作者本机的技能绝对路径」 ────────────────────────
const homePaths = []
for (const file of promptFiles) {
  const raw = readFileSync(file, 'utf8')
  // 注释不是提示词内容（composition 的注释会在装配时去掉）→ 先剥掉再扫
  const text = file.endsWith('.yml') ? raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    : file.endsWith('.mjs') ? raw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    : raw
  text.split('\n').forEach((line, i) => {
    if (/\.agents\/skills|\.reasonix\/skills|\.dsh\/skills/.test(line)) homePaths.push(`${file.slice(PRESET.length + 1)}:${i + 1}`)
  })
}
ok('提示词里没有指向作者本机技能目录的路径', homePaths.length === 0, homePaths.slice(0, 5).join(', '))

// ── 5) 评测覆盖：每个技能至少被一个场景期望（与 eval-check 同源，这里只报数） ─
if (existsSync(evalsFile)) {
  const evals = JSON.parse(readFileSync(evalsFile, 'utf8')).evals ?? []
  const covered = new Set(evals.flatMap((e) => e.expect?.skills ?? []))
  const uncovered = [...shipped].filter((s) => !covered.has(s))
  ok('每个技能都被至少一个评测场景期望', uncovered.length === 0, uncovered.join(', '))
}

console.log('# 技能引用完整性门禁（引用 / 分发 / frontmatter / 本机路径）\n')
console.log(`- 已分发技能：**${shipped.size}**｜被引用技能：**${referenced.size}**｜外部白名单：**${allow.size}**`)
console.log(`- 本机用户级技能目录可见：**${localSkills.size}** 个${localSkills.size === 0 ? '（CI/新克隆：交叉核对退化为上下文模式）' : '（交叉核对已启用）'}\n`)
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'SKILLS_REF_OK' : 'SKILLS_REF_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
