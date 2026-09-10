// 数学证明模式 — proof-discipline 本地插件
//
// 一个 preset 自带的行，做两件事：
//   1. 向 systemPrompt 注册「证明纪律」提示段（order 100，紧接 persona 之后）；
//   2. 向 tools 注册 `proof_audit` 工具：对单个 Agda 模块做静态合规审计。
//
// 为什么不用 `@deepseek-ai/dsh-tools` 的 `defineTool`：
// preset 目录位于 harness 的 node_modules 走查范围之外（`~/.dsh/.agent-presets/`），
// 该文件里的裸包名 import 无法解析。因此本文件只使用 `node:` 内建模块，
// 并直接构造 registry 接受的 ToolDefinition 字面量
// （`parameters` 是最终 JSON Schema，`output.schema` 是最终 JSON Schema，
//  register 只对 output.schema 调用 assertSupportedJsonSchema）。
//
// 本行不 provide 任何 service，因此可以「裸露」在 preset 里，不需要 isolate realm。

// 并直接构造 registry 接受的 ToolDefinition 字面量
// （`parameters` 是最终 JSON Schema，`output.schema` 是最终 JSON Schema，
//
import { readFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { compileHistory } from './agda-engine.mjs'

export const name = 'proof-discipline'
export const inject = ['tools']

/** 证明纪律提示段。 */
// 纪律文本**热重载**：真身在 `impl/discipline.md`，每次装配 prompt 时重读（按 mtime 失效缓存）。
// 这样改纪律不需要新会话、不丢进度——但会改变缓存前缀（下一轮前缀缓存失效，属物理必然）。
const DISCIPLINE_FILE = new URL('../impl/discipline.md', import.meta.url)
const disciplineCache = { mtimeMs: 0, text: '' }
/** 读纪律文本（按文件 mtime 缓存；文件缺失时退回上次读到的文本）。 */
export function disciplineText() {
  try {
    const { mtimeMs } = statSync(DISCIPLINE_FILE)
    if (mtimeMs !== disciplineCache.mtimeMs) {
      disciplineCache.text = readFileSync(DISCIPLINE_FILE, 'utf8').trimEnd()
      disciplineCache.mtimeMs = mtimeMs
    }
    return disciplineCache.text
  } catch {
    return disciplineCache.text
  }
}

/** 模块加载时的纪律文本（供测试/审计使用；运行时以 `disciplineText()` 为准）。 */
export const DISCIPLINE = disciplineText()

/** 剥离 Agda 注释（`{- -}` 可嵌套，`--` 行注释），保留换行以维持行号。 */
function stripComments(source) {
  let out = ''
  let i = 0
  let block = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (block > 0) {
      if (two === '{-') { block++; out += '  '; i += 2; continue }
      if (two === '-}') { block--; out += '  '; i += 2; continue }
      out += source[i] === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (two === '{-') { block = 1; out += '  '; i += 2; continue }
    if (two === '--') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++ }
      continue
    }
    out += source[i]
    i++
  }
  return out
}

/**
 * 统计 `trans` 链的最大长度（同一表达式内 `trans` 的嵌套层数）。
 *
 * 括号帧记录本层括号内开启的 trans 数，`)` 归零；顶层 trans 以 `=` 为界重置，
 * 因此 `x = trans a (trans b (trans c d))` 报 3，
 * 而两条互不相关的 `x = trans a b` / `y = trans c d` 各报 1。
 */
function maxTransDepth(code) {
  const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_'\-]/.test(ch)
  const frames = []
  let topOpen = 0
  let active = 0
  let max = 0
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (ch === '(') { frames.push(0); continue }
    if (ch === ')') { active -= frames.pop() ?? 0; if (active < 0) active = 0; continue }
    if (ch === '=' && frames.length === 0) { active -= topOpen; topOpen = 0; if (active < 0) active = 0; continue }
    if (!/[A-Za-z_]/.test(ch) || isIdentChar(code[i - 1])) continue
    let j = i
    while (j < code.length && isIdentChar(code[j])) j++
    if (code.slice(i, j) === 'trans') {
      active++
      if (frames.length === 0) topOpen++
      else frames[frames.length - 1]++
      if (active > max) max = active
    }
    i = j - 1
  }
  return max
}

/** 提取顶层 postulate 声明的名字。 */
function postulateNames(code) {
  const names = []
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^\s*postulate\b/.test(line)) continue
    const indent = line.match(/^\s*/)[0].length
    const inline = line.replace(/^\s*postulate\b/, '').match(/^\s*([^\s:{}()]+)\s*:/)
    if (inline) names.push(inline[1])
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (next.trim() === '') continue
      const nextIndent = next.match(/^\s*/)[0].length
      if (nextIndent <= indent) break
      const m = next.match(/^\s*([^\s:{}()]+)\s*:/)
      if (m) names.push(m[1])
    }
  }
  return names
}

/** 对单个 Agda 模块做静态合规审计，返回 markdown 报告。 */
export function auditModule(path, source) {
  const code = stripComments(source)
  const lines = source.split('\n')
  const findings = []
  const notes = []
  const mark = (ok, label, detail) => {
    findings.push(`| ${ok ? '✅' : '⚠️'} | ${label} | ${detail} |`)
  }

  // OPTIONS pragma
  const opt = source.match(/\{-#\s*OPTIONS([^#]*)#-\}/)
  const flags = opt === null ? '' : opt[1].trim()
  mark(opt !== null, 'OPTIONS pragma', opt === null ? '缺失 `{-# OPTIONS ... #-}`' : `\`${flags}\``)
  if (flags !== '') {
    notes.push(`- flags: ${flags}`)
    if (!/--guardedness/.test(flags)) notes.push('- ⚠️ 缺少 `--guardedness`（库标准）')
    if (/--cubical/.test(flags)) notes.push('- ℹ️ 含 `--cubical`：确认真的需要 `∥_∥₂`/`_/_`/`isSet`/`PathP`')
  }

  // 模块名与头部文档
  const mod = source.match(/^\s*module\s+([\w.]+)/m)
  mark(mod !== null, '模块声明', mod === null ? '未找到 `module` 声明' : `\`${mod[1]}\``)
  const headDoc = /^--\s*\|/m.test(source.slice(0, 4000))
  mark(headDoc, '头部文档注释', headDoc ? '含 `-- |` 模块说明' : '建议补 `-- | Sovereign.X.Y` 与核心原则')

  // postulate / hole / sorry
  const postulates = postulateNames(code)
  mark(postulates.length === 0, 'postulate', postulates.length === 0 ? '0 个（构造性闭合）' : `${postulates.length} 个: ${postulates.join(', ')}`)
  const holes = (code.match(/\{!/g) ?? []).length
  const bareQ = (code.match(/(^|[\s(])\?([\s)]|$)/g) ?? []).length
  mark(holes === 0 && bareQ === 0, 'hole', holes === 0 && bareQ === 0 ? '0 个' : `{! !} × ${holes}，裸 \`?\` × ${bareQ}`)
  const sorry = (code.match(/\bsorry\b/g) ?? []).length
  mark(sorry === 0, 'sorry', sorry === 0 ? '0 个' : `${sorry} 个`)

  // 浮点 / 超越函数禁令（词边界同时排除 `-`/`'` 连接的标识符，避免 pi-helper 误报）
  const banned = []
  const boundary = (word) => new RegExp(`(?<![A-Za-z0-9_'\\-])${word}(?![A-Za-z0-9_'\\-])`)
  for (const label of ['Float', 'Double', 'primFloat', 'pi', 'sqrt', 'cos', 'sin']) {
    if (boundary(label).test(code)) banned.push(label)
  }
  mark(banned.length === 0, '代数污染', banned.length === 0 ? '未发现浮点/超越函数' : `发现: ${banned.join(', ')}`)

  // fixity
  const usesOplus = /⊕/.test(code)
  const usesOtimes = /⊗/.test(code)
  const fixOplus = /infix\w*\s+\d+\s+_⊕_/.test(code)
  const fixOtimes = /infix\w*\s+\d+\s+_⊗_/.test(code)
  if (usesOplus || usesOtimes) {
    const missing = []
    if (usesOplus && !fixOplus) missing.push('`infixl 6 _⊕_`')
    if (usesOtimes && !fixOtimes) missing.push('`infixl 7 _⊗_`')
    mark(missing.length === 0, 'fixity 声明', missing.length === 0 ? '⊕/⊗ 均有 infix 声明' : `缺失: ${missing.join(', ')}`)
  } else {
    mark(true, 'fixity 声明', '本模块未使用 ⊕/⊗')
  }

  // let 绑定（域运算 let-free 纪律）
  const lets = (code.match(/\blet\b/g) ?? []).length
  mark(lets === 0, 'let 绑定', lets === 0 ? 'let-free' : `${lets} 处 \`let\`；确认不在域乘法/环运算/坐标映射中（会破坏复合项归约）`)

  // trans 嵌套
  const depth = maxTransDepth(code)
  mark(depth <= 3, 'trans 嵌套深度', `最大 ${depth}（纪律上限 3；超过须分离为具名引理）`)

  // 导入规范
  const imports = code.match(/^\s*open import .*$/gm) ?? []
  const noUsing = imports.filter((l) => !/\busing\b/.test(l))
  mark(noUsing.length === 0, '显式导入', imports.length === 0 ? '无 open import' : `${imports.length} 条导入，其中 ${noUsing.length} 条未用 \`using\``)

  // 结构计数
  const dataCount = (code.match(/^\s*(data|record)\s+\S+/gm) ?? []).length
  const rewriteCount = (source.match(/\{-#\s*REWRITE/g) ?? []).length
  const codeLines = lines.filter((l, i) => code.split('\n')[i]?.trim() !== '').length
  notes.push(`- 行数: ${lines.length}（有效代码行 ${codeLines}）；data/record 声明 ${dataCount}；REWRITE 规则 ${rewriteCount}`)

  const warn = findings.filter((f) => f.startsWith('| ⚠️')).length
  const verdict = warn === 0 ? '合规' : `需关注（${warn} 项）`
  // 与编译回执联动：审计通过 ≠ 编译过；没有回执就说清楚
  let receiptLine = '- 编译回执: —（未查）'
  try {
    const modMatch = /^\s*module\s+([\w.]+)/m.exec(code)
    if (modMatch !== null) {
      const hist = compileHistory(modMatch[1])
      receiptLine =
        hist.attempts === 0
          ? `- 编译回执: ⚠ 无（\`${modMatch[1]}\` 从未经 \`proof_compile\` 验证）`
          : `- 编译回执: ${hist.failures === 0 ? '✅' : '⚠'} 共 ${hist.attempts} 次（失败 ${hist.failures}）｜最近 ${String(hist.lastTs ?? '').slice(0, 19)}｜累计 ${(hist.totalMs / 1000).toFixed(1)}s`
    }
  } catch {
    /* 回执查询失败不影响审计 */
  }
  return [
    `# proof_audit: ${path}`,
    '',
    `**审计结论: ${verdict}**`,
    '',
    '| 结果 | 检查项 | 详情 |',
    '| --- | --- | --- |',
    ...findings,
    '',
    '## 统计',
    ...notes,
    receiptLine,
  ].join('\n')
}

/**
 * 注册「证明纪律」提示段与 `proof_audit` 工具。
 * @param ctx - preset 行上下文（agent scope）。
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'math-proof:discipline', order: 100, text: () => disciplineText() }),
    'math-proof.discipline',
  )

  ctx.tools.register({
    name: 'proof_audit',
    description:
      '对单个 Agda 模块做静态合规审计：OPTIONS flags、postulate/hole/sorry 计数、浮点与超越函数禁令、⊕/⊗ fixity、let 绑定、trans 嵌套深度、显式导入、data/record 与 REWRITE 统计。返回 markdown 报告。只读，不编译；编译用 bash 跑 `agda --guardedness <Module>.agda`。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Agda 模块路径。绝对路径，或相对于当前 session workspace 的相对路径（如 src/Sovereign/Structology/A4Group.agda）。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['report'],
        properties: { report: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.report }]
      },
    },
    async execute(args, exec) {
      const input = args === null || typeof args !== 'object' ? {} : args
      if (typeof input.path !== 'string' || input.path.trim() === '') {
        throw new Error('proof_audit: `path` must be a non-empty string')
      }
      const cwd = exec?.agent?.session?.header?.cwd
      const target = isAbsolute(input.path) ? input.path : resolve(cwd ?? process.cwd(), input.path)
      let source
      try {
        source = await readFile(target, 'utf8')
      } catch (error) {
        throw new Error(`proof_audit: cannot read ${target}: ${error?.message ?? String(error)}`)
      }
      return { report: auditModule(target, source) }
    },
  })
}
