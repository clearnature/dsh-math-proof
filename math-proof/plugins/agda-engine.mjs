// 数学证明模式 — agda-engine 本地插件
//
// 注册 `proof_compile` 工具：为单个 Agda 模块做「编译 + 六类指纹分诊」。
//
// **裁决权在 Agda**：Agda（项目补丁版 `/opt/agda/agda`）是本项目的唯一裁决器；
// dype 是项目自研的**实验性内核**（大衍 DY-PE，尚不完善），当前只作生成/加速通道，
// **不能替代 Agda 的地位**。因此检查器优先级是 **agda 优先**；dype 只在调用方显式
// 传 `checker:"dype"` 时才使用，且报告会标注「非权威，需 Agda 复核」。
//
// 它比裸 `bash` 多做四件事：
//   1. 检查器发现：探测 agda（权威）与 dype（实验性）两个二进制，
//      用 `--print-agda-data-dir` 验证其 data dir 真实存在，跳过坏掉的构建。
//   2. 旗标纪律：命令行只加 `--guardedness`，绝不加 `--rewriting`（文件头 pragma 承载）。
//   3. 结构化分诊：把 Agda 的 `error: [ClassName]` 映射到项目六类指纹 A–F
//      与三类性能/规则问题，并给出对应修复提示。
//   4. 沙箱一致：经由 `ctx.shell` 执行并套用当前 session 的 sandbox 策略，
//      与 `tool-bash` 同一套 confinement。
//
// 本行不 provide 任何 service，可裸露在 preset 里；文件只 import `node:` 内建模块。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { RESULT_TRIAGE, loadRules } from '../impl/ruleset.mjs'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

export const name = 'agda-engine'
export const inject = ['shell', 'tools']

/** 大衍引擎源码根（本地数学证明软件）。 */
export const DYPE_ROOT = '/data/work/functional-programming/dype'

/** 单引号安全引用一个 shell 片段。 */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** 从 shell 输出中取最后一行非空文本。 */
function lastNonEmptyLine(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
  return lines.length === 0 ? '' : lines[lines.length - 1]
}

/** 有界递归扫描：在 depth 层内找出所有名为 target 的文件。 */
function scanForFile(root, target, depth) {
  const found = []
  if (depth < 0) return found
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === target) found.push(path)
    else if (entry.isDirectory() && depth > 0) found.push(...scanForFile(path, target, depth - 1))
  }
  return found
}

/**
 * 发现候选检查器，按「本地大衍引擎优先」排序。
 * @returns {{kind: string, bin: string, source: string}[]}
 */
export function discoverCandidates() {
  const home = process.env.HOME ?? ''
  const out = []
  const push = (kind, bin, source) => {
    if (typeof bin !== 'string' || bin === '') return
    if (!existsSync(bin)) return
    if (out.some((c) => c.bin === bin)) return
    out.push({ kind, bin, source })
  }

  // 1. PATH
  for (const dir of (process.env.PATH ?? '').split(':').filter((d) => d !== '')) {
    push('dype', join(dir, 'dype'), 'PATH')
  }
  // 2. 已知绝对路径（agda 用项目补丁版）
  push('agda', '/opt/agda/agda', 'known')
  push('agda', join(home, '.local/bin/agda'), 'known')
  push('dype', join(home, '.local/bin/dype'), 'known')
  push('dype', join(home, '.cabal/bin/dype'), 'known')
  // 3. cabal store（多一层 ghc-<ver>-<mode>）
  const store = join(home, '.local/state/cabal/store')
  try {
    for (const ghc of readdirSync(store, { withFileTypes: true })) {
      if (!ghc.isDirectory()) continue
      for (const entry of readdirSync(join(store, ghc.name), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('dype-core-')) {
          push('dype', join(store, ghc.name, entry.name, 'bin', 'dype'), 'cabal store')
        }
      }
    }
  } catch {
    /* 无 store 目录：忽略 */
  }
  // 4. dype 源码树的 dist-newstyle 构建产物（…/x/dype/build/dype/dype）
  for (const bin of scanForFile(join(DYPE_ROOT, 'dist-newstyle/build'), 'dype', 8)) {
    push('dype', bin, 'dist-newstyle')
  }
  // **Agda 优先**（唯一裁决）；dype 是实验性内核，排后
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'agda' ? -1 : 1))
}

/** 六类指纹 + 性能/规则类别的分诊表。 */
export const FINGERPRINTS = [
  {
    test: /\[InfectiveImport\]|\[SafeFlagPragma\]/,
    limit: 'infective-import',
    cls: 'D',
    fix: '命令行不加 --rewriting；文件头保留 {-# OPTIONS --rewriting --guardedness #-}（REWRITE 规则传染性检查）',
  },
  {
    test: /\[AmbiguousName\]/,
    limit: 'ambiguous-stdlib-names',
    cls: 'C',
    fix: 'renaming 冲突符号：Data.Fin 的 zero/suc → fzero/fsuc；Data.Integer/Rational 的 _+_ → _+ℤ_/_+ℚ_',
  },
  {
    test: /\[NotInScope\]/,
    cls: 'A/B',
    fix: 'stdlib 符号 → 补显式 using（Data.Bool/Data.Nat/Data.Sum.Base/Relation.Nullary.Negation）；Sovereign 符号 → 修正模块路径',
  },
  {
    test: /\[ParseError\]|\[NoParseForLHS\]|Could not parse the left-hand side/,
    limit: 'parse-lhs-fixity',
    cls: 'E',
    fix: '解析错误：`postulate ... where` 反模式、非法标识符（Data.X.Y.Trust → camelCase）、缺 fixity 声明（模式里的 `_,_` 需 `import Data.Product`；`⊕`/`⊗` 需 `infixl`）',
  },
  {
    test: /\[UnequalTypes\]|\[UnequalTerms\]|\[ConstructorDoesNotFit\]/,
    cls: 'F',
    fix: '类型层级 Set→Set₁；若 .projᵢ 卡在复合项 → 被调函数含 let 绑定，改 let-free 直接模式匹配',
  },
  {
    test: /\[UnsolvedConstraints\]/,
    limit: 'projection-stuck-let',
    cls: 'R',
    fix: 'REWRITE 规则缺失 / 递归归一化卡住 / 空洞未填充；大 Fin 递归改引用已编译模块 + fromℕ<',
  },
  {
    test: /\[FileNotFound\]/,
    cls: 'B',
    fix: '模块路径不存在：确认 .agda-lib 生效或补 -i 包含路径',
  },
  {
    test: /\[UnreachableClauses\]/,
    cls: 'W',
    fix: '已知且无害（Trit.agda:78 的 _⊗_ 第 10 子句）',
  },
]

/**
 * 结果级分诊：`Heap exhausted` / `Killed` / `timed out` 这类失败**不会**产生
 * `file:line: error:` 诊断行，只在进程输出与退出码上体现 → 必须在结果层判，
 * 否则模型看到的是「失败但没有指纹」，只能瞎试。
 * 规则表在 `impl/ruleset.mjs`（热读）。
 * @returns {{limit:string, prescription:string}|null}
 */
export function triageResult(result, output = '', table = RESULT_TRIAGE) {
  const text = `${output}\n${result?.timedOut === true ? 'timed out' : ''}\nexit code ${String(result?.exitCode ?? '')}`
  for (const rule of table) {
    if (rule.test.test(text)) return { limit: rule.limit, prescription: rule.prescription }
  }
  return null
}

/** 对一条诊断做指纹归类。 */
export function classify(label, message) {
  const text = `[${label ?? ''}] ${message ?? ''}`
  for (const fp of FINGERPRINTS) {
    if (fp.test.test(text)) return { cls: fp.cls, fix: fp.fix, limit: fp.limit }
  }
  if (/Heap exhausted|stack overflow|out of memory/i.test(text)) {
    return { cls: 'P', fix: '性能：大 Fin 递归 → 引用已编译模块 + fromℕ<；或补 REWRITE 规则', limit: 'agda-heap-cap' }
  }
  return { cls: '?', fix: '未归类：按 proof-engineer 六类指纹手工诊断' }
}

/**
 * 解析 Agda 诊断行。
 * 形如：`<file>:<line>.<col>-<col>: error: [ClassName]` 或 `warning: -W[no]Xxx`。
 * @returns {{file: string, line: number, col: string, severity: string, label: string, message: string}[]}
 */
export function parseDiagnostics(text) {
  const out = []
  const lines = String(text ?? '').split('\n')
  const head =
    /^(.+?):(\d+)\.(\d+)-(\d+):\s*(error|warning):\s*(?:\[([^\]]+)\]|(-W(?:\[no\])?[A-Za-z0-9_]+))?\s*(.*)$/
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i].trim())
    if (m === null) continue
    let message = m[8] ?? ''
    // 诊断正文常在后继缩进行
    let j = i + 1
    while (j < lines.length && /^\s+\S/.test(lines[j]) && !head.test(lines[j].trim())) {
      message += (message === '' ? '' : ' ') + lines[j].trim()
      if (message.length > 240) break
      j++
    }
    out.push({
      file: m[1],
      line: Number(m[2]),
      col: `${m[3]}-${m[4]}`,
      severity: m[5],
      label: m[6] ?? m[7] ?? '',
      message: message.slice(0, 240),
    })
  }
  return out
}

/** 通过 ctx.shell 运行一条命令（套用 session 的 sandbox 策略）。 */
async function runShell(ctx, exec, command, workdir, timeoutMs) {
  const policy = ctx.get('sandboxPolicy')
  const sandboxPolicy =
    policy === undefined ? undefined : policy.resolve(exec?.agent === undefined ? {} : { session: exec.agent.session })
  const spec = ctx.shell.resolve({
    command,
    workdir,
    timeoutMs,
    stdoutMaxBytes: 512 * 1024,
    signal: exec?.signal,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  })
  return await ctx.shell.run(spec)
}

/** 探测一个检查器：版本 + data dir 是否真实存在。 */
async function probeChecker(ctx, exec, candidate, cwd) {
  const result = await runShell(ctx, exec, `${shellQuote(candidate.bin)} --print-agda-data-dir`, cwd, 20000)
  const text = `${result.stdout?.text ?? ''}\n${result.stderr?.text ?? ''}`
  const datadir = lastNonEmptyLine(text)
  const usable = result.exitCode === 0 && datadir !== '' && existsSync(datadir)
  return {
    ...candidate,
    usable,
    datadir,
    reason: usable
      ? `data dir OK (${datadir})`
      : result.exitCode !== 0
        ? `探测失败 (exit ${String(result.exitCode)}): ${lastNonEmptyLine(text).slice(0, 120)}`
        : `data dir 不存在: ${datadir}（该构建是在 Docker 内以 /src 为前缀编译的，需重新 ` +
          `\`make build && make dev-link\`，或以 root 建 /src → ${DYPE_ROOT}/src 软链）`,
  }
}

/**
 * 回执目录（工具签发的事实，与模型可写的台账分开放）。
 */
export function receiptDir() {
  return join(homedir(), '.dsh', 'state', 'math-proof', 'receipts')
}

/** 源文件内容哈希（回执的 id 就是它——内容寻址，改一个字符就失效）。 */
export function sourceHashOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 写一条编译回执（**只有编译工具能写**；模型写不了它，只能引用它）。
 * @returns 回执 id（= 源文件内容哈希）。
 */
export function writeReceipt(record) {
  const dir = receiptDir()
  mkdirSync(dir, { recursive: true })
  const id = record.sourceHash
  const file = join(dir, `${id}.json`)
  const existed = existsSync(file)
  writeFileSync(file, `${JSON.stringify({ ...record, id }, null, 2)}\n`, 'utf8')
  // 幂等：同一内容哈希 = 同一份源码 = 同一次编译，重复写不重复计数
  if (!existed) bumpAgg(record)
  return id
}

/** 读回执（不存在返回 null）。 */
export function readReceipt(id) {
  const file = join(receiptDir(), `${String(id)}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 列出全部编译回执（按时间升序）。用于统计「同一模块编译了多少次、失败几次、共花多久」。
 * 损坏的回执跳过，不影响调用方。
 */
/** 路径归一化（去 .agda、去 src/、点转斜杠）——聚合与查询共用一套规则。 */
export function normModulePath(v) {
  return String(v ?? '')
    .replace(/\.agda$/, '')
    .replace(/^.*?\/src\//, '')
    .replace(/^src\//, '')
    .replace(/\./g, '/')
    .replace(/^\/+|\/+$/g, '')
}

/** 每模块聚合文件路径（`agg-<sha1(归一化路径)[:12]>.json`）。 */
export function aggPathFor(relPathOrModule) {
  const key = normModulePath(relPathOrModule)
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
  return join(receiptDir(), `agg-${hash}.json`)
}

/**
 * 更新某模块的聚合索引（读-改-写，原子 rename）。
 * 目的：`compileHistory`/`compileHotspots` 不再每次解析全部回执——长期运行下这是 O(N) 退化点。
 */
function bumpAgg(record) {
  const key = normModulePath(record.relPath ?? record.path)
  if (key === '') return
  const file = aggPathFor(key)
  let agg = { module: key, label: record.relPath ?? `${key}.agda`, attempts: 0, failures: 0, totalMs: 0, maxMs: 0, lastTs: null, lastExit: null }
  try {
    if (existsSync(file)) agg = { ...agg, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    /* 损坏则重建 */
  }
  const ms = Number(record.wallMs) || 0
  agg.attempts += 1
  if (record.exitCode !== 0) agg.failures += 1
  agg.totalMs += ms
  agg.maxMs = Math.max(agg.maxMs ?? 0, ms)
  agg.lastTs = record.ts ?? null
  agg.lastExit = record.exitCode ?? null
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(agg)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch {
    /* 聚合失败不影响回执本体 */
  }
}

/** 读某模块聚合（不存在返回 null）。 */
export function readAgg(relPathOrModule) {
  const file = aggPathFor(relPathOrModule)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function listReceipts() {
  const dir = receiptDir()
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      if (r !== null && typeof r === 'object') out.push(r)
    } catch {
      /* 跳过损坏回执 */
    }
  }
  return out.sort((a, b) => String(a.ts ?? '').localeCompare(String(b.ts ?? '')))
}

/**
 * 按模块路径聚合回执历史：`{ attempts, failures, totalMs, lastTs, lastExit }`。
 * `relPath` 与 `path` 都参与匹配（调用方传源码相对路径或模块名均可）。
 */
export function compileHistory(relPathOrModule) {
  // 归一化：去掉 .agda 后缀、去掉 src/ 前缀、点号转斜杠——然后**按路径段边界**匹配。
  // 教训：早先用 includes() 子串匹配，查询 `Sovereign.Base.Trit` 会误命中
  // `Sovereign/Base/TritExtra.agda`，把别的模块的编译历史算到本模块头上。
  const norm = (v) =>
    String(v ?? '')
      .replace(/\.agda$/, '')
      .replace(/^.*?\/src\//, '')
      .replace(/^src\//, '')
      .replace(/\./g, '/')
      .replace(/^\/+|\/+$/g, '')
  const needle = normModulePath(relPathOrModule)
  // 快路径：每模块聚合文件（O(1)）
  const agg = readAgg(needle)
  if (agg !== null && (agg.module === needle || String(agg.module).endsWith(`/${needle}`))) {
    return { attempts: agg.attempts, failures: agg.failures, totalMs: agg.totalMs, lastTs: agg.lastTs, lastExit: agg.lastExit }
  }
  const hit = listReceipts().filter((r) => {
    for (const raw of [r.relPath, r.path]) {
      const p = norm(raw)
      if (p === needle || p.endsWith(`/${needle}`)) return true
    }
    return false
  })
  if (hit.length === 0) return { attempts: 0, failures: 0, totalMs: 0, lastTs: null, lastExit: null }
  // 聚合缺失时**用全量扫描重建**并落盘：否则下次读到的新聚合会丢掉历史计数（真实数据管理缺陷）
  if (agg === null) {
    const rebuilt = {
      module: needle,
      label: hit[hit.length - 1].relPath ?? `${needle}.agda`,
      attempts: hit.length,
      failures: hit.filter((r) => r.exitCode !== 0).length,
      totalMs: hit.reduce((n, r) => n + (Number(r.wallMs) || 0), 0),
      maxMs: hit.reduce((n, r) => Math.max(n, Number(r.wallMs) || 0), 0),
      lastTs: hit[hit.length - 1].ts ?? null,
      lastExit: hit[hit.length - 1].exitCode ?? null,
    }
    try {
      const file = aggPathFor(needle)
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify(rebuilt)}\n`, 'utf8')
      renameSync(tmp, file)
    } catch {
      /* 重建失败不影响返回值 */
    }
  }
  const last = hit[hit.length - 1]
  return {
    attempts: hit.length,
    failures: hit.filter((r) => r.exitCode !== 0).length,
    totalMs: hit.reduce((n, r) => n + (Number(r.wallMs) || 0), 0),
    lastTs: last.ts ?? null,
    lastExit: last.exitCode ?? null,
  }
}

/**
 * 编译热点：按模块聚合回执的 wallMs，返回最贵的 N 个（默认 3）。
 * 目的：让「时间花在哪」变成可查数据，而不是靠猜。
 */
export function compileHotspots(limit = 3) {
  const dir = receiptDir()
  // 快路径：直接读每模块聚合文件
  if (existsSync(dir)) {
    const aggs = []
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('agg-') || !f.endsWith('.json')) continue
      try {
        const a = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        if (a !== null && typeof a === 'object') aggs.push(a)
      } catch {
        /* 跳过损坏聚合 */
      }
    }
    if (aggs.length > 0) {
      return aggs
        .map((a) => ({ module: a.label ?? a.module, attempts: a.attempts ?? 0, failures: a.failures ?? 0, totalMs: a.totalMs ?? 0, maxMs: a.maxMs ?? 0 }))
        .sort((x, y) => y.totalMs - x.totalMs)
        .slice(0, Math.max(0, limit))
    }
  }
  const byModule = new Map()
  for (const r of listReceipts()) {
    const key = String(r.relPath ?? r.path ?? '?')
    if (!byModule.has(key)) byModule.set(key, { module: key, attempts: 0, failures: 0, totalMs: 0, maxMs: 0 })
    const m = byModule.get(key)
    const ms = Number(r.wallMs) || 0
    m.attempts += 1
    if (r.exitCode !== 0) m.failures += 1
    m.totalMs += ms
    m.maxMs = Math.max(m.maxMs, ms)
  }
  return [...byModule.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, Math.max(0, limit))
}

/**
 * 校验回执：必须存在、exit 0、且**当前源码内容仍与回执一致**。
 * 这条是防「改文件冒充已证」的关键——文件一改，旧回执立刻失效。
 */
export function verifyReceipt(id, currentSourceText) {
  const r = readReceipt(id)
  if (r === null) return { ok: false, why: '回执不存在' }
  if (r.exitCode !== 0) return { ok: false, why: `回执退出码 ${r.exitCode}（非 0）` }
  if (typeof currentSourceText === 'string' && currentSourceText !== '') {
    const now = sourceHashOf(currentSourceText)
    if (now !== r.sourceHash) return { ok: false, why: '回执与当前源码不符（文件已修改）' }
  }
  return { ok: true, receipt: r }
}

/** 编译一个模块并返回分诊报告。
 * @param ctx - preset 行上下文（含 shell / tools）。
 * @param args - `{ path, checker?, timeoutMs?, extraArgs? }`。
 * @param exec - 工具执行上下文（agent / signal）。
 */
export async function compileModule(ctx, args, exec) {
  const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
  const requested = typeof args?.path === 'string' ? args.path.trim() : ''
  if (requested === '') throw new Error('proof_compile: `path` must be a non-empty string')
  const checker = typeof args?.checker === 'string' ? args.checker : 'auto'
  if (!['auto', 'dype', 'agda'].includes(checker)) {
    throw new Error('proof_compile: `checker` must be one of auto | dype | agda')
  }
  const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs) || 600000, 1000), 1800000)
  const extraArgs = Array.isArray(args?.extraArgs)
    ? args.extraArgs.filter((a) => typeof a === 'string' && a !== '' && a !== '--rewriting')
    : []
  const target = isAbsolute(requested) ? requested : resolvePath(cwd, requested)
  if (!existsSync(target)) throw new Error(`proof_compile: no such file: ${target}`)

  const probed = []
  for (const candidate of discoverCandidates()) {
    probed.push(await probeChecker(ctx, exec, candidate, cwd))
  }
  const usable = probed.filter((p) => p.usable)
  const wanted =
    checker === 'auto'
      ? (usable.find((p) => p.kind === 'agda') ?? usable.find((p) => p.kind === 'dype'))
      : usable.find((p) => p.kind === checker)
  if (wanted === undefined) {
    const why = probed.length === 0 ? '未发现任何 dype / agda 二进制' : probed.map((p) => `${p.kind} ${p.bin}: ${p.reason}`).join('\n- ')
    return { report: `# proof_compile: ${target}\n\n**无法编译：没有可用检查器**\n\n- ${why}` }
  }

  // 结果级分诊表**热读**（改 `impl/ruleset.mjs` 立刻生效，不用重开会话）
  const triageTable = await loadRules()
    .then((live) => live.rules.RESULT_TRIAGE)
    .catch(() => RESULT_TRIAGE)
  const command = [shellQuote(wanted.bin), '--guardedness', ...extraArgs.map(shellQuote), shellQuote(target)].join(' ')
  const started = Date.now()
  const result = await runShell(ctx, exec, command, cwd, timeoutMs)
  const wallMs = Date.now() - started
  const output = `${result.stdout?.text ?? ''}\n${result.stderr?.text ?? ''}`
  const diagnostics = parseDiagnostics(output)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')
  const passed = result.exitCode === 0 && errors.length === 0 && !result.timedOut
  // 工具签发回执：成功与失败都记（失败回执是「试过」的证据，不能当已证）
  let receiptId = null
  try {
    const sourceText = readFileSync(target, 'utf8')
    receiptId = writeReceipt({
      sourceHash: sourceHashOf(sourceText),
      path: target,
      relPath: requested,
      checker: wanted.kind,
      checkerBin: wanted.bin,
      command,
      exitCode: result.exitCode === null ? -1 : result.exitCode,
      errors: errors.length,
      warnings: warnings.length,
      wallMs,
      ts: new Date().toISOString(),
      sandbox: result.sandbox?.mode ?? null,
      // 结果级失败指纹（堆爆/被杀/超时）：失败回执也要能说清是哪种失败
      resultLimit: passed ? null : (triageResult(result, output, triageTable)?.limit ?? null),
    })
  } catch {
    /* 回执失败不影响编译结论，但报告里会显示「无回执」 */
  }

  const lines = []
  lines.push(`# proof_compile: ${target}`)
  lines.push('')
  lines.push(`**结果: ${passed ? '✅ 编译通过' : result.timedOut ? '⏱️ 超时' : '❌ 失败'}**`)
  lines.push('')
  lines.push(`- 检查器: \`${wanted.kind}\` → \`${wanted.bin}\` (${wanted.source}；${wanted.reason})`)
  if (wanted.kind === 'dype') {
    lines.push('- ⚠ **dype 是实验性内核（项目自研，尚不完善）：本结论不作证明权威，请用 Agda 复核**')
  }
  lines.push(`- 命令: \`${command}\``)
  lines.push(`- 工作目录: \`${cwd}\``)
  lines.push(`- 退出码: ${String(result.exitCode)}；用时: ${(wallMs / 1000).toFixed(1)}s`)
  lines.push(`- 回执: ${receiptId === null ? '⚠ 未签发（无法作为已证证据）' : `\`${receiptId}\`（把它写进 \`proof_dag\` 的 \`receipt\` 字段；源码一改即失效）`}`)
  const hist = compileHistory(requested)
  if (hist.attempts > 0) {
    lines.push(
      `- 本模块编译历史: ${hist.attempts} 次（失败 ${hist.failures} 次）｜累计 ${(hist.totalMs / 1000).toFixed(1)}s`,
    )
    // 编译预算闸门：同一模块累计失败 ≥3 次 → 停止 whack-a-mole，强制委托
    if (hist.failures >= 3) {
      lines.push(
        `- 🛑 **编译预算闸门**：本模块已累计失败 ${hist.failures} 次 → 停止逐条改错，**委托 \`loop-engineer\`**（纪律 §1 第 9 条），或改用「探针模块」缩小编译面。`,
      )
    }
  }
  if (result.sandbox !== undefined) {
    lines.push(`- 沙箱: ${result.sandbox.mode}${result.sandbox.denied ? '（拒绝）' : ''}`)
  }
  if (result.timedOut) lines.push(`- ⚠️ 超过 ${timeoutMs} ms 被终止：疑似归一化爆炸（大 Fin 递归 / mod-helper 展开）`)
  // 结果级分诊：堆爆 / 被杀 / 超时 没有诊断行，只有处方能救
  const triage = passed ? null : triageResult(result, output, triageTable)
  if (triage !== null) {
    lines.push(`- 🧭 **结果级分诊 \`${triage.limit}\`**：${triage.prescription}`)
    lines.push(`  - 记录用：把它写进 \`proof_dag journal\`（kind: limit, source: ${requested}）或 \`prover_limits\` 经验库，别让下一个人再撞一次`)
  }
  const skipped = probed.filter((p) => !p.usable)
  if (skipped.length > 0) {
    lines.push('')
    lines.push('## 被跳过的检查器')
    for (const s of skipped) lines.push(`- \`${s.kind}\` ${s.bin} — ${s.reason}`)
  }
  lines.push('')
  lines.push(`## 错误 (${errors.length})`)
  if (errors.length === 0) {
    lines.push('无。')
  } else {
    lines.push('| # | 位置 | 类 | 标签 | 修复提示 |')
    lines.push('| --- | --- | --- | --- | --- |')
    errors.slice(0, 12).forEach((d, i) => {
      const c = classify(d.label, d.message)
      lines.push(`| ${i + 1} | \`${d.file}:${d.line}.${d.col}\` | ${c.cls} | \`${d.label}\` | ${c.fix}${c.limit === undefined ? '' : `（经验库: \`${c.limit}\`）`} |`)
    })
    if (errors.length > 12) lines.push(`| … | | | | 另有 ${errors.length - 12} 条，见下方原始输出 |`)
  }
  lines.push('')
  lines.push(`## 警告 (${warnings.length})`)
  if (warnings.length === 0) {
    lines.push('无。')
  } else {
    const byLabel = new Map()
    for (const w of warnings) byLabel.set(w.label, (byLabel.get(w.label) ?? 0) + 1)
    for (const [label, count] of [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      lines.push(`- \`${label}\` × ${count}`)
    }
  }
  if (!passed) {
    lines.push('')
    lines.push('## 下一步')
    lines.push('- 按上表指纹修复；同类错误批量处理，不要逐条 whack-a-mole。')
    lines.push('- 表中带「经验库」标记的错误是**工具链固有限制**：先 `prover_limits query "<报错原文>"`，不要把限制当成自己的证明失败。')
    lines.push('- 编译错误闭环修复委托 `loop-engineer`；修复后重跑本工具确认 exit 0。')
    lines.push('- 声称证明通过前必须有本工具或 `agda` 的 exit 0 证据。')
    const tail = output.split('\n').filter((l) => l.trim() !== '').slice(-25).join('\n')
    lines.push('')
    lines.push('## 原始输出（末尾 25 行）')
    lines.push('```')
    lines.push(tail)
    lines.push('```')
  }
  return { report: lines.join('\n') }
}

/**
 * 注册 `proof_compile` 工具。
 * @param ctx - preset 行上下文。
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'proof_compile',
    description:
      '编译单个 Agda 模块并做六类指纹分诊。**Agda 是唯一裁决器**（项目补丁版 `/opt/agda/agda` 优先）；dype 是项目自研实验性内核，仅在显式 `checker:"dype"` 时使用且结论非权威。自动发现可用检查器、验证其 data dir，以 `--guardedness` 执行（绝不加 --rewriting），把 `error: [ClassName]` 归类为 A–F 指纹 + 性能/规则类并给出修复提示；成功时签发**回执**（供 proof_dag 记证据）。经 ctx.shell 运行，套用当前 session 的 sandbox 策略。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Agda 模块路径（绝对路径或相对 session workspace，如 src/Sovereign/Algebra/UniversalAlgebra.agda）。',
        },
        checker: {
          type: 'string',
          enum: ['auto', 'dype', 'agda'],
          description: 'auto（默认）= **agda 优先**（唯一裁决器），agda 不可用才回退 dype；agda = 强制项目补丁版；dype = 强制实验性内核（结论非权威，需 Agda 复核）。',
        },
        timeoutMs: {
          type: 'integer',
          description: '超时毫秒，默认 600000，上限 1800000。',
        },
        extraArgs: {
          type: 'array',
          items: { type: 'string' },
          description: '追加给检查器的参数（例如 -i src）。--rewriting 会被忽略（旗标纪律）。',
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
      return await compileModule(ctx, args === null || typeof args !== 'object' ? {} : args, exec)
    },
  })
}
