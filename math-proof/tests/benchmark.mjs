// 数学证明模式 — 冻结语料 benchmark（确定性：任何人重跑得到同一组数字）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/benchmark.mjs
// 期望最后一行：BENCHMARK_PASS n/n
//
// 为什么要有它：评分权重一旦改动，`check` 的历史趋势就会「漂移」而无人察觉。
// 本 benchmark 把 7 条冻结语料的**期望评分与扣分项**固定下来：改权重必须显式改语料，
// 而不是让分数悄悄变。它测的是**评分器的保真度**，不是模型质量（后者看 tests/evals.json）。

import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const corpus = JSON.parse(readFileSync(join(HERE, 'fixtures', 'corpus.json'), 'utf8'))
const dag = await import(join(PRESET, 'plugins', 'proof-dag.mjs'))
const dype = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))

/** 清掉某 workspace 在状态目录里的一切（benchmark 不留残渣）。 */
function purge(ws) {
  const h = createHash('sha1').update(String(ws)).digest('hex').slice(0, 12)
  const dir = join(homedir(), '.dsh', 'state', 'math-proof')
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`dag-${h}`) || f.startsWith(`history-${h}`)) rmSync(join(dir, f), { force: true })
  }
}

/** 把一条语料物化成临时 workspace。 */
function materialize(c) {
  const ws = mkdtempSync(join(tmpdir(), `math-proof-bench-${c.id}-`))
  for (const [mod, body] of Object.entries(c.modules ?? {})) {
    const file = join(ws, 'src', `${mod.replace(/\./g, '/')}.agda`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `module ${mod} where\n\n${body}\n`, 'utf8')
  }
  const nodes = {}
  for (const [id, n] of Object.entries(c.nodes ?? {})) {
    const node = { id, updatedAt: '2026-09-09T00:00:00.000Z', ...n }
    // receipt: "auto" → 用物化后的源码签发一条真实回执（等价于跑过 proof_compile）
    if (node.receipt === 'auto' || node.receipt === 'stale') {
      const file = join(ws, 'src', `${String(node.module).replace(/\./g, '/')}.agda`)
      // stale = 回执签的是「另一份内容」（模拟先编译、后改文件）
      const text = node.receipt === 'stale' ? `${readFileSync(file, 'utf8')}-- tampered\n` : readFileSync(file, 'utf8')
      const hash = dype.sourceHashOf(text)
      dype.writeReceipt({ sourceHash: hash, path: file, relPath: node.module, checker: 'agda', exitCode: 0, errors: 0, warnings: 0, ts: '2026-09-09T00:00:00.000Z' })
      writtenReceipts.push(join(dype.receiptDir(), `${hash}.json`))
      node.evidenceReceipt = hash
      node.evidenceVerified = node.receipt === 'auto'
      node.evidence = `回执 \`${hash.slice(0, 12)}…\` exit 0（工具签发）`
    }
    nodes[id] = node
  }
  dag.writeLedger({ workspace: ws, createdAt: '2026-09-09T00:00:00.000Z', nodes, journal: c.journal ?? [] })
  return ws
}

const rows = []
const writtenReceipts = []
let failures = 0
for (const c of corpus.cases) {
  const ws = materialize(c)
  try {
    const nodes = dag.readLedger(ws).nodes
    const journal = dag.readLedger(ws).journal
    const d = dag.diagnose(nodes, journal, ws, c.witness ?? null)
    const got = d.deductions.map((x) => `${x.reason}（−${x.points}）`)
    const scoreOk = d.score === c.expect.score
    const dedOk = JSON.stringify(got) === JSON.stringify(c.expect.deductions)
    const ok = scoreOk && dedOk
    if (!ok) failures++
    rows.push(
      `${ok ? '✅' : '❌'} ${c.id.padEnd(14)} 评分 ${String(d.score).padStart(3)}/100（期望 ${String(c.expect.score).padStart(3)}）` +
        (dedOk ? '' : `\n     实得扣分: ${got.join(' | ') || '（无）'}\n     期望扣分: ${c.expect.deductions.join(' | ') || '（无）'}`),
    )
  } finally {
    purge(ws)
    rmSync(ws, { recursive: true, force: true })
  }
}

// 清理本 benchmark 签发的回执（不留残渣）
for (const f of writtenReceipts) rmSync(f, { force: true })
try {
  rmdirSync(dype.receiptDir())
} catch {
  /* 目录非空或不存在：不是本 benchmark 的残渣 */
}

console.log(`# proof_dag 冻结语料 benchmark（${corpus.cases.length} 条，冻结于 ${corpus.frozenAt}）\n`)
console.log(rows.join('\n'))
console.log(`\n${failures === 0 ? 'BENCHMARK_PASS' : 'BENCHMARK_FAIL'} ${corpus.cases.length - failures}/${corpus.cases.length}`)
process.exit(failures === 0 ? 0 : 1)
