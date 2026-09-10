// 数学证明模式 — python-oracle 本地插件
//
// 注册 `proof_oracle` 工具：**跑 Python 精确整数 oracle 并签发回执**。
//
// 为什么需要它：「先算后验证」目前只靠纪律（「抽样不算」）——而线性场 `f = xᵢ` 上 `Δf ≡ 0`
// 会骗过抽样。本工具把这件事变成机器可查的事实：
//   · **工具亲自跑脚本**（不是模型贴一段输出），记录脚本哈希 + 参数 + stdout 哈希 + 退出码；
//   · 脚本必须打印一行结构化清单：
//       ORACLE-MANIFEST {"basis":"δ 基 × 相位 × 幅度","domain":36,"points":36,"claim":"…"}
//     `domain` = 声称的论域大小，`points` = 实际枚举点数；**points < domain 判为抽样**，不算验证；
//   · 回执与脚本内容哈希绑定：脚本一改，旧回执失效（同 `proof_compile` 回执的设计）；
//   · **共享库**：运行脚本时把 preset 的 `oracle-kit/` 加进 PYTHONPATH，脚本可
//     `from oracle_kit import …` 直接复用 GF(3)/T⁶/δ 基/CRT/覆盖清单，不必每次造轮子。
//
// 工具只有一个 `proof_oracle`，用 action 区分两件事（避免工具定义膨胀）：
//   action 省略 / "run"  → 跑脚本 + 签回执
//   "kit-list" / "kit-show" / "kit-lint" / "kit-add" / "kit-path" → 可复用件索引 / 查看 / 静态检查 / 沉淀 / 库路径
//
// 与 `agda-engine` 的分工：oracle 负责「命题是否为假 / 猜想是否成立」，Agda 负责「证明项是否合法」。
// **Python 永远不是裁决**，它只排掉假命题、约束猜想；裁决永远是 Agda。
//
// 本行不 provide 任何 service，可裸露在 preset 里；文件只 import `node:` 内建模块。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'python-oracle'
export const inject = ['shell', 'tools']

/** oracle 回执目录（与编译回执分开，便于分别统计）。 */
export function oracleDir() {
  return join(homedir(), '.dsh', 'state', 'math-proof', 'oracle-receipts')
}

/** 共享库目录（preset 自带，零依赖）。 */
export function kitDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'oracle-kit')
}

/** 运行期累积的算法条目落盘路径。 */
export function kitIndexPath() {
  return join(homedir(), '.dsh', 'state', 'math-proof', 'oracle-kit.json')
}

/**
 * 内置算法索引（种子）：本项目实际用过的可复用件。
 * 每条都必须写清「用途 / 签名 / 复杂度 / 何时用 / 证据」。
 */
export const KIT_SEED = [
  {
    id: 'gf3-arithmetic',
    kind: '算法',
    purpose: 'GF(3) 加法/乘法/逆元与 3×3 加法表',
    api: 'gf3_add / gf3_mul / gf3_neg / TRIT_ADD',
    complexity: 'O(1)（查表）',
    when: '任何 GF(3) 或 Trit 层运算；**别再用 `(a+b)%3` 手写**，也别忘了 TRIT_ADD 查表更快',
    evidence: 'sovereign_core/trit.py 已有同款；oracle_kit 统一提供',
  },
  {
    id: 't6-lattice',
    kind: '算法',
    purpose: 'T⁶ = (Z/3)⁶ 的 729 点枚举',
    api: 't6_points() / DIM',
    complexity: 'O(3⁶) = 729，一次生成可复用',
    when: '任何 T⁶ 上的全称断言；不要在多处重复 `itertools.product`',
    evidence: 'NSEOnT6.agda §1 载体；本库与 Agda 口径一致',
  },
  {
    id: 'delta-basis',
    kind: '穷举基',
    purpose: 'δ 基（点处为 1 的场）——结构穷举，替代线性场抽样',
    api: 'delta_basis(n) / const_fields(n)',
    complexity: 'O(3ⁿ) 个基元',
    when: '**每个新陈述进 Agda 前**：先用 δ 基找反例；线性场 `f = xᵢ` 上很多算子恒 0，会骗过抽样',
    evidence: 'Δf≡0 在线性场上成立、在 δ 基上被 729 点穷举否证（反例 laplacian(δ₀)(e₀)=2）',
  },
  {
    id: 'diff-div-lap',
    kind: '算法',
    purpose: '前向差分 / 散度 / 单轴二阶差分 / laplacian / 梯度（六分量复用三轴）',
    api: 'diff_f / div6 / axis_lap / laplacian / grad6 / sum6',
    complexity: 'O(1) 每次求值；全 T⁶ 穷举 O(3⁶)',
    when: '离散 NSE / 环面算子核对；**逐行镜像 Agda 定义**（含 sum6 右嵌套顺序）',
    evidence: 'engineering/tests/test_nse_t6_discrete.py 曾自建同款 670 行 → 应收敛到本库',
  },
  {
    id: 'counterexample-search',
    kind: '算法',
    purpose: '全称断言 → 精确反例',
    api: 'first_counterexample(points, pred) / all_hold(points, pred)',
    complexity: 'O(|points|)',
    when: '任何「对所有 x 成立」的陈述；**先找反例再谈证明**',
    evidence: 'A1–A5 原始陈述经 729 点穷举被否证，各给出精确反例',
  },
  {
    id: 'precompute-table',
    kind: '性能',
    purpose: '预计算成表，避免内层循环重复构造',
    api: 'precompute(fn, points)',
    complexity: '空间换时间',
    when: '探针/穷举脚本里出现「在 x 循环里重新构造场或表」时——**这是最常见的超时原因**',
    evidence: '计算路线探针因 `incompressible_from_potentials` 在内层循环重算而超时，改平表后通过',
  },
  {
    id: 'crt-12',
    kind: '算法',
    purpose: 'CRT 12 ↔ 3×4 合并/拆分与 12 项查表',
    api: 'crt12(a3,a4) / split12(x) / CRT12_TABLE',
    complexity: 'O(12)（查表 O(1)）',
    when: '十二律 / Z/12 投影层计算；与 `Algebra/Duodecimal.agda` 的 crt12 对齐',
    evidence: 'sovereign_core + Duodecimal.agda；crt12-roundtrip 已有 Agda 证明',
  },
  {
    id: 'manifest-coverage',
    kind: '纪律',
    purpose: '覆盖清单：把「穷举还是抽样」变成机器可判定',
    api: 'manifest(basis, domain, points, claim)',
    complexity: 'O(1)',
    when: '**每个 oracle 脚本结尾必须调用**；points < domain 会被 proof_oracle 判为抽样并拒绝入台账',
    evidence: 'proof_oracle 的 coverage 判定；`unverified-claim` 冻结语料',
  },
]

/** 读累积条目（损坏则备份后返回空）。 */
export function readKitExtra() {
  const path = kitIndexPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  } catch {
    const bak = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(path, bak)
    } catch {
      /* 备份失败不掩盖 */
    }
    return []
  }
}

/** 写累积条目（原子）。 */
export function writeKitExtra(entries) {
  const path = kitIndexPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries }, null, 2)}
`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 种子 + 累积（同 id 累积覆盖）。 */
export function allKitEntries() {
  const byId = new Map(KIT_SEED.map((e) => [e.id, { ...e, origin: 'seed' }]))
  for (const e of readKitExtra()) byId.set(String(e.id), { ...e, origin: 'accumulated' })
  return [...byId.values()]
}

/** 静态检查 oracle 脚本：禁浮点/复数/外部数值库；必须给出覆盖清单；警惕抽样。 */
export function lintOracleScript(text) {
  const findings = []
  const code = String(text).replace(/#.*$/gm, '')
  const add = (level, name, detail) => findings.push({ level, name, detail })
  const forbid = [
    { re: /\b(?:import|from)\s+(?:numpy|scipy|pandas|sympy|mpmath)\b/, name: '外部数值库', detail: '零外部依赖纪律：用整数/标准库重写' },
    { re: /\b(?:float|complex)\s*\(|\b\d+\.\d+(?:[eE][-+]?\d+)?\b/, name: '浮点/复数', detail: '宪法禁浮点：改用整数或 Fraction/定点整数比' },
    { re: /\b(?:import|from)\s+(?:math|cmath)\b/, name: 'math/cmath', detail: 'math 只返回浮点：用整数算法替代' },
    { re: /\beval\s*\(|\bexec\s*\(/, name: 'eval/exec', detail: '禁止动态执行' },
    { re: /\bsys\.path\.(?:insert|append)\s*\(/, name: 'sys.path 注入', detail: 'proof_oracle 已把 oracle-kit 放进 PYTHONPATH，不需要手改 sys.path' },
  ]
  for (const f of forbid) {
    const m = f.re.exec(code)
    if (m !== null) add('❌', f.name, `命中 ${JSON.stringify(m[0])}：${f.detail}`)
  }
  const hasManifest = /manifest\s*\(|ORACLE-MANIFEST/.test(code)
  if (!hasManifest) {
    add('❌', '覆盖清单', '缺少 manifest(...) 或 ORACLE-MANIFEST：无法判定穷举/抽样')
  }
  if (/import\s+random|random\./.test(code) && !/domain\s*=/.test(code)) {
    add('⚠', '随机抽样', '用了 random 却没声明 domain：抽样不算验证（要么穷举，要么显式声明并让 points < domain 被标记）')
  }
  if (/oracle_kit/.test(code) === false && /(gf3|t6_points|delta_basis|laplacian|div6|crt12|precompute)/.test(code)) {
    add('⚠', '疑似重复造轮子', '出现了 oracle_kit 已有的算法名，但没 import oracle_kit——先 `oracle_kit list` 看能否复用')
  }
  if (!/from\s+oracle_kit\s+import|import\s+oracle_kit/.test(code)) {
    add('⚠', '未复用共享库', '建议 `from oracle_kit import …` 复用 GF(3)/T⁶/δ 基/CRT/manifest')
  }
  return findings
}

/** 内容哈希（脚本 / stdout 都用它）。 */
export function hashOf(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 回执 id：脚本哈希 + 参数 + stdout 哈希（同一脚本同一输出 → 同一 id，可复现）。 */
export function oracleReceiptId(scriptHash, args, stdoutHash) {
  return hashOf(`${scriptHash}|${args.join(' ')}|${stdoutHash}`)
}

/** 写 oracle 回执（**只有本工具能写**）。 */
export function writeOracleReceipt(record) {
  const dir = oracleDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record.id
}

/** 读 oracle 回执（不存在返回 null）。 */
export function readOracleReceipt(id) {
  const file = join(oracleDir(), `${String(id)}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 校验 oracle 回执：必须存在、exit 0、覆盖完整（points >= domain）、
 * 且**脚本内容仍与回执一致**（脚本被改 → 旧回执失效）。
 */
export function verifyOracleReceipt(id, currentScriptText) {
  const r = readOracleReceipt(id)
  if (r === null) return { ok: false, why: 'oracle 回执不存在' }
  if (r.exitCode !== 0) return { ok: false, why: `oracle 退出码 ${r.exitCode}（非 0）` }
  if (r.coverage !== 'full') return { ok: false, why: `覆盖不完整（points ${r.points} < domain ${r.domain}）：抽样不算验证` }
  if (typeof currentScriptText === 'string' && currentScriptText !== '') {
    if (hashOf(currentScriptText) !== r.scriptHash) return { ok: false, why: 'oracle 脚本已修改（回执失效）' }
  }
  return { ok: true, receipt: r }
}

/** 解析脚本输出里的 ORACLE-MANIFEST 行（取最后一次出现）。 */
export function parseManifest(stdout) {
  const re = /^ORACLE-MANIFEST\s+(\{.*\})\s*$/gm
  let last = null
  let m
  while ((m = re.exec(String(stdout))) !== null) last = m[1]
  if (last === null) return { found: false }
  try {
    const o = JSON.parse(last)
    return {
      found: true,
      basis: typeof o.basis === 'string' ? o.basis : null,
      domain: Number.isFinite(Number(o.domain)) ? Number(o.domain) : null,
      points: Number.isFinite(Number(o.points)) ? Number(o.points) : null,
      claim: typeof o.claim === 'string' ? o.claim : null,
    }
  } catch (e) {
    return { found: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 经 ctx.shell 运行（套用 session 的 sandbox 策略）。 */
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

/** 简单 shell 引用（脚本路径可能含空格）。 */
export function quote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/**
 * 跑一个 Python oracle 并签发回执。
 * @param ctx - preset 行上下文（含 shell）。
 * @param args - `{ script, args?, timeoutMs?, python? }`。
 * @param exec - 工具执行上下文。
 */
export async function runOracle(ctx, args, exec) {
  const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
  const script = typeof args?.script === 'string' ? args.script.trim() : ''
  if (script === '') throw new Error('proof_oracle: `script` must be a non-empty path')
  const target = isAbsolute(script) ? script : resolvePath(cwd, script)
  if (!existsSync(target)) throw new Error(`proof_oracle: no such script: ${target}`)
  const extra = Array.isArray(args?.args) ? args.args.filter((a) => typeof a === 'string') : []
  const python = typeof args?.python === 'string' && args.python.trim() !== '' ? args.python.trim() : 'python3'
  const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs) || 120000, 1000), 1800000)
  const scriptText = readFileSync(target, 'utf8')
  const scriptHash = hashOf(scriptText)
  const command = [`PYTHONPATH=${quote(kitDir())}:$PYTHONPATH`, python, quote(target), ...extra.map(quote)].join(' ')
  const started = Date.now()
  const result = await runShell(ctx, exec, command, cwd, timeoutMs)
  const wallMs = Date.now() - started
  const stdout = result.stdout?.text ?? ''
  const stderr = result.stderr?.text ?? ''
  const exitCode = result.exitCode === null ? -1 : result.exitCode
  const manifest = parseManifest(stdout)
  const stdoutHash = hashOf(stdout)
  const id = oracleReceiptId(scriptHash, extra, stdoutHash)
  const full = manifest.found && manifest.points !== null && manifest.domain !== null && manifest.points >= manifest.domain && manifest.domain > 0
  const coverage = full ? 'full' : 'partial'

  writeOracleReceipt({
    id,
    script: target,
    relScript: script,
    scriptHash,
    args: extra,
    command,
    python,
    exitCode,
    timedOut: result.timedOut === true,
    wallMs,
    stdoutHash,
    stdoutTail: stdout.slice(-2000),
    stderrTail: stderr.slice(-1000),
    basis: manifest.basis,
    domain: manifest.domain,
    points: manifest.points,
    claim: manifest.claim,
    coverage,
    ts: new Date().toISOString(),
  })

  const lines = []
  lines.push(`# proof_oracle: ${script}`)
  lines.push('')
  lines.push(`**结果: ${exitCode === 0 ? '✅ 退出 0' : `❌ 退出 ${exitCode}`}${result.timedOut ? '（超时）' : ''}**`)
  lines.push('')
  lines.push(`- 命令: \`${command}\``)
  lines.push(`- 脚本哈希: \`${scriptHash.slice(0, 12)}…\`（脚本一改，回执失效）`)
  lines.push(`- 用时: ${(wallMs / 1000).toFixed(2)}s`)
  lines.push(`- 回执: \`${id}\``)
  lines.push(`- 共享库: \`${kitDir()}\`（已加入 PYTHONPATH；脚本可 \`from oracle_kit import …\`）`)
  lines.push('')
  if (!manifest.found) {
    lines.push('## ⚠ 没有 ORACLE-MANIFEST')
    lines.push('脚本必须打印一行结构化清单，否则无法判断「是穷举还是抽样」：')
    lines.push('')
    lines.push('```')
    lines.push('print(\'ORACLE-MANIFEST {"basis":"δ 基 × 相位 × 幅度","domain":36,"points":36,"claim":"Δf≡0 在 36 点成立"}\')')
    lines.push('```')
  } else {
    lines.push('## 清单')
    lines.push(`- 穷举基: ${manifest.basis ?? '（未声明）'}`)
    lines.push(`- 论域: ${manifest.domain ?? '?'}｜实际枚举: ${manifest.points ?? '?'}`)
    lines.push(`- 断言: ${manifest.claim ?? '—'}`)
    lines.push(
      `- 覆盖判定: ${coverage === 'full' ? '✅ 完整（points ≥ domain）' : `⚠ **抽样**（points ${manifest.points} < domain ${manifest.domain}）→ 不算验证`}`,
    )
    if (exitCode !== 0) lines.push('- ⚠ 退出码非 0：oracle 失败（可能是找到了反例——这是有价值的结论，请记 `refuted`）')
  }
  if (stdout.trim() !== '') {
    lines.push('')
    lines.push('## stdout（尾部 2000 字符）')
    lines.push('```')
    lines.push(stdout.slice(-2000))
    lines.push('```')
  }
  if (stderr.trim() !== '') {
    lines.push('')
    lines.push('## stderr（尾部）')
    lines.push('```')
    lines.push(stderr.slice(-1200))
    lines.push('```')
  }
  lines.push('')
  lines.push('> 把回执 id 写进 `proof_dag` 节点的 `oracle` 字段；**oracle 只排假命题/给约束，裁决永远是 Agda**。')
  return { report: lines.join('\n'), receiptId: id, coverage }
}

/** 执行一次 oracle_kit 操作。 */
export function runKit(args) {
  const input = args === null || typeof args !== 'object' ? {} : args
  const action = typeof input.action === 'string' && input.action !== '' ? input.action : 'list'
  const ACTIONS = ['list', 'show', 'lint', 'add', 'path']
  if (!ACTIONS.includes(action)) {
    throw new Error(`oracle_kit: unknown action "${action}" (expected ${ACTIONS.join(' | ')})`)
  }
  const all = allKitEntries()

  if (action === 'path') {
    return `# oracle_kit: path\n\n- 共享库目录: \`${kitDir()}\`\n- 脚本内直接 \`from oracle_kit import …\`（proof_oracle 运行时会加入 PYTHONPATH）`
  }

  if (action === 'list') {
    return [
      '# oracle_kit: list（可复用算法与模式）',
      '',
      `- 条目: ${all.length}（种子 ${KIT_SEED.length} / 累积 ${all.length - KIT_SEED.length}）`,
      `- 库目录: \`${kitDir()}\``,
      '',
      ...all.map((e) => `- \`${e.id}\`（${e.kind}）${String(e.purpose).slice(0, 70)}`),
      '',
      '> 写 oracle 脚本前先看这里；用 `show` 看签名与何时用，用 `lint` 检查脚本。',
    ].join('\n')
  }

  if (action === 'show') {
    const id = String(input.id ?? '').trim()
    if (id === '') throw new Error('oracle_kit show: `id` required')
    const e = all.find((x) => x.id === id)
    if (e === undefined) throw new Error(`oracle_kit show: unknown id "${id}"`)
    return [
      `# oracle_kit: show \`${id}\``,
      '',
      `- 类型: ${e.kind}｜来源: ${e.origin ?? 'seed'}`,
      `- 用途: ${e.purpose}`,
      `- API: \`${e.api}\``,
      `- 复杂度: ${e.complexity}`,
      `- 何时用: ${e.when}`,
      `- 证据: ${e.evidence}`,
    ].join('\n')
  }

  if (action === 'lint') {
    const script = String(input.script ?? '').trim()
    if (script === '') throw new Error('oracle_kit lint: `script` required（相对或绝对路径）')
    const target = isAbsolute(script) ? script : resolvePath(process.cwd(), script)
    if (!existsSync(target)) throw new Error(`oracle_kit lint: no such script: ${target}`)
    const text = readFileSync(target, 'utf8')
    const findings = lintOracleScript(text)
    const bad = findings.filter((f) => f.level === '❌').length
    const warn = findings.filter((f) => f.level === '⚠').length
    const verdict = bad > 0 ? `❌ 不合规（${bad} 项禁止）` : warn > 0 ? `⚠ 可用但有 ${warn} 项建议` : '✅ 合规'
    return [
      `# oracle_kit: lint \`${script}\``,
      '',
      `**结论: ${verdict}**`,
      '',
      ...(findings.length === 0 ? ['- 无问题 ✅'] : findings.map((f) => `- ${f.level} **${f.name}**: ${f.detail}`)),
      '',
      `> 合规脚本：\`from oracle_kit import …\` + 结尾 \`manifest(basis, domain, points, claim)\`。`,
    ].join('\n')
  }

  // add
  const entry = input.entry
  if (entry === null || typeof entry !== 'object') throw new Error('oracle_kit add: `entry` object required')
  const id = String(entry.id ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(id)) {
    throw new Error('oracle_kit add: `entry.id` must be kebab-case (3–41 chars)')
  }
  for (const key of ['purpose', 'api', 'when', 'evidence']) {
    if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
      throw new Error(`oracle_kit add: \`entry.${key}\` required（沉淀必须带证据与用法）`)
    }
  }
  const extra = readKitExtra().filter((e) => e.id !== id)
  extra.push({
    id,
    kind: String(entry.kind ?? '算法'),
    purpose: entry.purpose.trim(),
    api: entry.api.trim(),
    complexity: String(entry.complexity ?? '—'),
    when: entry.when.trim(),
    evidence: entry.evidence.trim(),
    addedAt: new Date().toISOString(),
  })
  const path = writeKitExtra(extra)
  return [
    `# oracle_kit: add \`${id}\` ✅`,
    '',
    `- 用途: ${entry.purpose.trim().slice(0, 120)}`,
    `- API: \`${entry.api.trim()}\``,
    `- 证据: ${entry.evidence.trim().slice(0, 120)}`,
    `- 落盘: \`${path}\`（累积 ${extra.length} 条）`,
    '',
    '> 若它是**可执行代码**，请同时把实现加进 `oracle-kit/oracle_kit.py`（本工具只登记索引）。',
  ].join('\n')
}

/** 注册 `proof_oracle` 工具。 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'proof_oracle',
    description:
      '先算后验证的 oracle 工具（经验库视图二：可复用算法；视图一是 `prover_limits` 的工具链限制库）。`action:"run"`（默认，给 `script`）跑 Python 精确整数脚本并签发**回执**：工具亲自执行、记录脚本哈希/退出码/用时；脚本须打印 `ORACLE-MANIFEST {\"basis\",\"domain\",\"points\",\"claim\"}`，**points < domain 判为抽样、不算验证**。运行时自动把 preset 的 `oracle-kit/` 加入 PYTHONPATH，脚本可直接 `from oracle_kit import …` 复用 GF(3)/T⁶/δ 基/CRT/反例搜索/预计算/manifest。另有 `kit-list`（索引）/`kit-show`/`kit-lint`（禁浮点、外部数值库、缺清单）/`kit-add`（证据必填）/`kit-path`。Python 只排假命题、给约束，裁决永远是 Agda。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'kit-list', 'kit-show', 'kit-lint', 'kit-add', 'kit-path'],
          description: 'run（默认）跑脚本签回执 / kit-list 可复用件索引 / kit-show 查看 / kit-lint 静态检查 / kit-add 沉淀（证据必填）/ kit-path 库路径。',
        },
        script: { type: 'string', description: 'run / kit-lint 用：Python 脚本路径。' },
        id: { type: 'string', description: 'kit-show 用：条目 id。' },
        entry: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'purpose', 'api', 'when', 'evidence'],
          properties: {
            id: { type: 'string', description: 'kebab-case id。' },
            kind: { type: 'string', description: '算法 / 穷举基 / 性能 / 纪律。' },
            purpose: { type: 'string', description: '一句话用途。' },
            api: { type: 'string', description: 'API 或函数签名。' },
            complexity: { type: 'string', description: '复杂度（可选）。' },
            when: { type: 'string', description: '何时用（含什么时候别用）。' },
            evidence: { type: 'string', description: '实测证据（必填）。' },
          },
          description: 'kit-add 的条目对象。',
        },
        args: { type: 'array', items: { type: 'string' }, description: '传给脚本的参数（可选）。' },
        python: { type: 'string', description: 'Python 解释器，默认 python3。' },
        timeoutMs: { type: 'number', description: '超时毫秒，默认 120000（≤1 分钟为宜——oracle 要快）。' },
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
      const action = typeof input.action === 'string' && input.action !== '' ? input.action : 'run'
      if (action !== 'run') {
        const kitAction = action === 'kit-list' ? 'list' : action === 'kit-show' ? 'show' : action === 'kit-lint' ? 'lint' : action === 'kit-add' ? 'add' : 'path'
        return { report: runKit({ ...input, action: kitAction }) }
      }
      const { report } = await runOracle(ctx, input, exec)
      return { report }
    },
  })

}
