// 数学证明模式 — 常驻上下文装配（确定性，零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/assemble-context.mjs [--write]
//
// 它回答一个问题：**这个 preset 到底往模型上下文里塞了什么？**
//   · 常驻层（每个会话都发）：persona + 纪律段 + 工具名与描述 + 技能索引（name/description/whenToUse）
//   · 按需层（触发技能才读）：技能正文 + references + 经验库种子
// 把两层分开统计，才能判断「常驻是否过重、按需是否可达」。
//
// 这是 brooks-lint `assemble-prompt.mjs` 的对应物：先能装配，才谈得上测路由。

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

/**
 * 从 composition 里抽 persona 正文（`- id: persona` → 缩进块）。
 *
 * ⚠ 字段名是 host 契约：`dsh-persona` 0.1.5 起必填 **`prefix`**；旧字段 `text` 会让挂载期
 * 直接失败（`$.prefix missing required value`）→ 整份 preset 起不来。这里只认 `prefix`，
 * 且在发现旧字段时**把原因写进报错**：下次 host 改字段名，装配器立刻告诉我们。
 */
export function personaText() {
  const lines = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.trim() === '- id: persona')
  if (start === -1) throw new Error('assemble: composition 里找不到 persona 行')
  let i = start
  while (i < lines.length && !/^\s{4}prefix:\s*\|-?\s*$/.test(lines[i])) i++
  if (i === lines.length) {
    const legacy = lines.slice(start, start + 14).some((l) => /^\s{4}text:/.test(l))
    throw new Error(legacy ? 'assemble: persona 行还在用 `text:`——`dsh-persona` 0.1.5 起必填 `prefix:`（旧字段会让整份 preset 挂载失败）' : 'assemble: persona 行里找不到 `prefix:` 块')
  }
  const out = []
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j]
    if (line.trim() !== '' && !/^\s{6}/.test(line)) break
    out.push(line.startsWith('      ') ? line.slice(6) : '')
  }
  return out.join('\n').trimEnd()
}

/** 收集工具名与描述（apply 只注册，不执行）。 */
async function toolDescriptions() {
  const files = readdirSync(join(PRESET, 'plugins')).filter((f) => f.endsWith('.mjs')).sort()
  const out = []
  for (const f of files) {
    const mod = await import(join(PRESET, 'plugins', f))
    if (typeof mod.apply !== 'function') continue
    const tools = []
    mod.apply({
      tools: { register: (t) => { tools.push(t); return () => {} } },
    on: () => () => {},
      effect: (fn) => { fn(); return () => {} },
      systemPrompt: { section: (d) => d },
    })
    for (const t of tools) out.push({ file: f, name: t.name, description: t.description, parameters: t.parameters, outputSchema: t.output?.schema })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 技能索引与正文。 */
function skills() {
  const dir = join(PRESET, 'skills')
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name, 'SKILL.md'), 'utf8')
      const fm = /^---\n([\s\S]*?)\n---/.exec(text)
      const field = (k) => (fm === null ? '' : (new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm[1])?.[1] ?? '').trim())
      const refs = readdirSync(join(dir, name))
        .filter((f) => f.endsWith('.md') && f !== 'SKILL.md')
        .map((f) => ({ file: f, text: readFileSync(join(dir, name, f), 'utf8') }))
      return { name, description: field('description'), whenToUse: field('whenToUse'), body: text, refs }
    })
}

/** 稳定序列化（递归排序键），保证同一 schema 永远同一字节。 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** 装配常驻上下文（模型每个会话都会看到的文本）。 */
export async function assemble() {
  const persona = personaText()
  // 装配时真实注入的是「纪律正文 + 本机路径真值小节」（见 proof-discipline.disciplineWithPaths），
  // 统计必须按真实字节算，否则常驻大小会低报
  const discMod = await import(join(PRESET, 'plugins', 'proof-discipline.mjs'))
  const disc = discMod.disciplineWithPaths()
  const tools = await toolDescriptions()
  const sk = skills()
  const skillIndex = sk.map((s) => `- ${s.name}: ${s.description}${s.whenToUse === '' ? '' : `（何时用: ${s.whenToUse}）`}`).join('\n')
  const resident = [
    '## persona',
    persona,
    '',
    '## 纪律段',
    disc,
    '',
    '## 工具',
    tools.map((t) => `- ${t.name}: ${t.description}`).join('\n'),
    '',
    '## 技能索引',
    skillIndex,
  ].join('\n')
  // 缓存单元 = system 文本 + 工具定义（名字/描述/schema）。工具定义参与缓存计算，
  // 所以指纹必须包含它——只改 schema 不改描述，同样会打穿前缀。
  const toolWire = tools
    .map((t) => `${t.name}\u0000${t.description ?? ''}\u0000${stableStringify(t.parameters ?? null)}\u0000${stableStringify(t.outputSchema ?? null)}`)
    .join('\u0001')
  return { resident, persona, disc, tools, skills: sk, skillIndex, cacheable: `${resident}\u0002${toolWire}` }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const a = await assemble()
  // --fingerprint：只打印常驻前缀的指纹与体积（供缓存稳定性检查比对）
  if (process.argv.includes('--fingerprint')) {
    const { createHash } = await import('node:crypto')
    const fp = createHash('sha256').update(a.cacheable, 'utf8').digest('hex')
    console.log(
      JSON.stringify({ fp, chars: a.cacheable.length, residentChars: a.resident.length, tools: a.tools.length, skills: a.skills.length }),
    )
    process.exit(0)
  }
  const onDemand = a.skills.reduce((n, s) => n + s.body.length + s.refs.reduce((m, r) => m + r.text.length, 0), 0)
  console.log('# 常驻上下文装配（数学证明模式）\n')
  console.log('| 层 | 内容 | 字符数 |')
  console.log('| --- | --- | --- |')
  console.log(`| 常驻 | persona | ${a.persona.length} |`)
  console.log(`| 常驻 | 纪律段 | ${a.disc.length} |`)
  console.log(`| 常驻 | 工具（${a.tools.length} 个：${a.tools.map((t) => t.name).join(', ')}） | ${a.tools.reduce((n, t) => n + t.description.length, 0)} |`)
  console.log(`| 常驻 | 技能索引（${a.skills.length} 个） | ${a.skillIndex.length} |`)
  console.log(`| **常驻合计** | | **${a.resident.length}** |`)
  console.log(`| 按需 | 技能正文 + references | ${onDemand} |`)
  console.log(`\n- 常驻/按需比: ${(a.resident.length / Math.max(1, onDemand) * 100).toFixed(1)}%`)
  if (process.argv.includes('--write')) {
    const out = join(HERE, 'fixtures', 'resident-context.md')
    writeFileSync(out, `${a.resident}\n`, 'utf8')
    console.log(`- 已写出: ${out}`)
  }
}
