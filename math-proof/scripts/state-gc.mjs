// 数学证明模式 — 状态目录维护（数据管理，零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/state-gc.mjs                 # 只报告（默认 dry-run）
//   node ... --apply --archive-days 90    # 把 90 天前的回执归档成 jsonl 并删除原件
//   node ... --apply --rebuild-index      # 用回执重建每模块聚合索引
//   node ... --apply --witness-gc         # 对每个见证仓库做 git gc（压缩历史）
//   node ... --json                       # 机器可读输出
//
// 状态目录里有什么、为什么要管：
//   receipts/           编译回执（内容寻址，一次编译一条）+ agg-*.json（每模块聚合）
//   oracle-receipts/    oracle 回执（脚本哈希 + stdout 哈希）
//   history-*.json      评分历史（已限 200 条）
//   witness-*/          每个 workspace 一个 git 见证仓库（每次关键变更一个 commit）
//   checkpoint-*.json   见证检查点
// 长期运行的风险：回执无限增长、见证仓库快照累积、聚合索引与回执脱节。
// 本脚本是唯一的维护入口——**归档不删除**（数据留档，热目录瘦身）。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? d : argv[i + 1]
}
const APPLY = argv.includes('--apply')
const REBUILD = argv.includes('--rebuild-index')
const WITNESS_GC = argv.includes('--witness-gc')
const DAYS = Number(flag('archive-days', 0)) || 0
const AS_JSON = argv.includes('--json')

const STATE = join(homedir(), '.dsh', 'state', 'math-proof')
if (!existsSync(STATE)) {
  console.log('state-gc: 状态目录不存在，无事可做')
  process.exit(0)
}

const dirSize = (dir) => {
  let bytes = 0
  let files = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          bytes += statSync(p).size
          files += 1
        } catch {
          /* 忽略消失的文件 */
        }
      }
    }
  }
  walk(dir)
  return { bytes, files }
}

// ── 1. 现状盘点 ────────────────────────────────────────────────────────────
const entries = readdirSync(STATE)
const report = {
  state: STATE,
  receipts: { files: 0, bytes: 0, aggs: 0, oldest: null },
  oracle: { files: 0, bytes: 0 },
  history: { files: 0, bytes: 0 },
  witness: { repos: 0, bytes: 0 },
  checkpoints: 0,
  ledgers: 0,
}
for (const e of entries) {
  const p = join(STATE, e)
  const st = statSync(p)
  if (e === 'receipts' && st.isDirectory()) {
    const all = readdirSync(p)
    report.receipts.aggs = all.filter((f) => f.startsWith('agg-')).length
    let oldest = null
    for (const f of all) {
      if (!f.endsWith('.json') || f.startsWith('agg-')) continue
      report.receipts.files += 1
      report.receipts.bytes += statSync(join(p, f)).size
      try {
        const ts = JSON.parse(readFileSync(join(p, f), 'utf8')).ts
        if (typeof ts === 'string' && (oldest === null || ts < oldest)) oldest = ts
      } catch {
        /* 损坏回执 */
      }
    }
    report.receipts.oldest = oldest
  } else if (e === 'oracle-receipts' && st.isDirectory()) {
    const s = dirSize(p)
    report.oracle.files = s.files
    report.oracle.bytes = s.bytes
  } else if (e.startsWith('history-')) {
    report.history.files += 1
    report.history.bytes += st.size
  } else if (e.startsWith('witness-') && st.isDirectory()) {
    const s = dirSize(p)
    report.witness.repos += 1
    report.witness.bytes += s.bytes
  } else if (e.startsWith('checkpoint-')) {
    report.checkpoints += 1
  } else if (e.startsWith('dag-') && e.endsWith('.json')) {
    report.ledgers += 1
  }
}

// ── 2. 归档旧回执（默认不动）───────────────────────────────────────────────
const archived = { receipts: 0, oracle: 0 }
if (APPLY && DAYS > 0) {
  const cutoff = Date.now() - DAYS * 86400000
  const archive = (dir, prefix) => {
    if (!existsSync(dir)) return 0
    mkdirSync(join(dir, 'archive'), { recursive: true })
    let n = 0
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('agg-')) continue
      const p = join(dir, f)
      let ts = null
      try {
        ts = Date.parse(String(JSON.parse(readFileSync(p, 'utf8')).ts ?? ''))
      } catch {
        continue
      }
      if (!Number.isFinite(ts) || ts >= cutoff) continue
      const month = new Date(ts).toISOString().slice(0, 7)
      const target = join(dir, 'archive', `${prefix}-${month}.jsonl`)
      appendFileSync(target, `${readFileSync(p, 'utf8').trim()}\n`, 'utf8')
      rmSync(p, { force: true })
      n += 1
    }
    return n
  }
  archived.receipts = archive(join(STATE, 'receipts'), 'compile')
  archived.oracle = archive(join(STATE, 'oracle-receipts'), 'oracle')
}

// ── 3. 重建聚合索引 ───────────────────────────────────────────────────────
let rebuilt = 0
if (APPLY && REBUILD) {
  const dir = join(STATE, 'receipts')
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('agg-')) rmSync(join(dir, f), { force: true })
    }
    const byModule = new Map()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('agg-')) continue
      let r
      try {
        r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      } catch {
        continue
      }
      const key = String(r.relPath ?? r.path ?? '')
        .replace(/\.agda$/, '')
        .replace(/^.*?\/src\//, '')
        .replace(/^src\//, '')
        .replace(/\./g, '/')
      if (key === '') continue
      if (!byModule.has(key)) byModule.set(key, { module: key, label: r.relPath ?? `${key}.agda`, attempts: 0, failures: 0, totalMs: 0, maxMs: 0, lastTs: null, lastExit: null })
      const a = byModule.get(key)
      const ms = Number(r.wallMs) || 0
      a.attempts += 1
      if (r.exitCode !== 0) a.failures += 1
      a.totalMs += ms
      a.maxMs = Math.max(a.maxMs, ms)
      if (a.lastTs === null || String(r.ts) > String(a.lastTs)) {
        a.lastTs = r.ts ?? null
        a.lastExit = r.exitCode ?? null
      }
    }
    for (const [key, a] of byModule) {
      const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
      const tmp = join(dir, `agg-${hash}.json.tmp`)
      writeFileSync(tmp, `${JSON.stringify(a)}\n`, 'utf8')
      renameSync(tmp, join(dir, `agg-${hash}.json`))
      rebuilt += 1
    }
  }
}

// ── 4. 见证仓库压缩 ───────────────────────────────────────────────────────
let witnessGc = 0
if (APPLY && WITNESS_GC) {
  for (const e of entries) {
    if (!e.startsWith('witness-')) continue
    const dir = join(STATE, e)
    if (!existsSync(join(dir, '.git'))) continue
    spawnSync('git', ['reflog', 'expire', '--expire=90.days', '--all'], { cwd: dir, stdio: 'ignore' })
    const r = spawnSync('git', ['gc', '--prune=now', '--quiet'], { cwd: dir, stdio: 'ignore' })
    if (r.status === 0) witnessGc += 1
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ ...report, applied: APPLY, archived, rebuilt, witnessGc }, null, 2))
  process.exit(0)
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`
console.log(`# 状态目录维护（${STATE}）\n`)
console.log(`| 类别 | 数量 | 体积 | 说明 |`)
console.log(`| --- | --- | --- | --- |`)
console.log(`| 编译回执 | ${report.receipts.files} 条（聚合 ${report.receipts.aggs} 个） | ${mb(report.receipts.bytes)} | 最旧 ${report.receipts.oldest?.slice(0, 10) ?? '—'} |`)
console.log(`| oracle 回执 | ${report.oracle.files} 条 | ${mb(report.oracle.bytes)} | 脚本 + stdout 哈希 |`)
console.log(`| 评分历史 | ${report.history.files} 个 | ${mb(report.history.bytes)} | 每 workspace 上限 200 条 |`)
console.log(`| 见证仓库 | ${report.witness.repos} 个 | ${mb(report.witness.bytes)} | 每次关键变更一个 commit |`)
console.log(`| 检查点 / 台账 | ${report.checkpoints} / ${report.ledgers} | — | — |`)
console.log('')
if (!APPLY) {
  console.log('（dry-run）常用维护：')
  console.log('  --apply --archive-days 90   归档 90 天前的回执（写入 receipts/archive/*.jsonl，不删数据）')
  console.log('  --apply --rebuild-index     用回执重建每模块聚合索引（聚合与回执脱节时用）')
  console.log('  --apply --witness-gc        压缩见证仓库历史（reflog expire + git gc）')
} else {
  console.log(`已执行：归档编译回执 ${archived.receipts} 条 / oracle 回执 ${archived.oracle} 条｜重建聚合 ${rebuilt} 个｜见证仓库压缩 ${witnessGc} 个`)
}
console.log(`\nSTATE_GC_OK（${APPLY ? '已应用' : 'dry-run'}）`)
