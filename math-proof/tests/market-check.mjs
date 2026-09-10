// 数学证明模式 — 插件市场脚本回归（零依赖，离线，不联网）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/market-check.mjs
// 期望最后一行：MARKET_OK n/n
//
// 为什么这么测：`scripts/market.mjs` 要联网，网络不能进回归。所以本测试用**固定快照**
// （`tests/fixtures/market-fixture.json`）走 `--offline --cache` 路径，验证的是**渲染与判断逻辑**：
//   · 快照解析、计数、差集（市场有 / 本地已装）
//   · 版本线判定（同版本线 / 无本机版本线）——期望值从输出里的 `targetVersion` 反推，不写死
//   · 相关性表只命中市场里真实存在的包，且**不**给无关包编造结论
//   · `--search` / `--missing` / `--json` 三种输出都可用
//   · 快照缺失时**明确报错退出**，不静默给空结果

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const SCRIPT = join(PRESET, 'scripts', 'market.mjs')
const FIXTURE = join(HERE, 'fixtures', 'market-fixture.json')
const FIXTURE_SNAP = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const FIXTURE_NAMES = Object.keys(FIXTURE_SNAP.packages)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

/** 跑脚本，返回 {code, out, err}。 */
const run = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

// ── 1) JSON 模式：结构 + 计数 + 差集 ────────────────────────────────────────
const json = run(['--offline', '--cache', FIXTURE, '--json'])
ok('--json 退出 0', json.code === 0, `exit ${json.code} ${json.err.slice(0, 200)}`)

let snap = null
try {
  snap = JSON.parse(json.out)
  ok('--json 输出可解析', true)
} catch (err) {
  ok('--json 输出可解析', false, String(err.message))
}

if (snap !== null) {
  ok('注册源如实反映', snap.registry === 'https://fixture.invalid', snap.registry)
  ok('过期快照被标注为陈旧（不假装新数据）', snap.stale === true, `stale=${snap.stale}`)
  ok('市场计数 = fixture 包数', snap.counts.market === 4, String(snap.counts.market))

  const missingNames = new Set(snap.missing.map((m) => m.name))
  const alreadyInstalled = FIXTURE_NAMES.filter((n) => !missingNames.has(n))
  ok(
    '差集自洽（missing ∪ 已装 = 市场）',
    missingNames.size + alreadyInstalled.length === FIXTURE_NAMES.length,
    `missing=${missingNames.size} installed=${alreadyInstalled.length}`,
  )
  ok('差集只含 fixture 里的包', [...missingNames].every((n) => FIXTURE_NAMES.includes(n)), [...missingNames].join(','))

  // ── 2) 版本线判定：与 fixture 的 versions 逐条对齐 ────────────────────
  const target = snap.targetVersion
  const expectSameLine = (n) => target !== '' && (FIXTURE_SNAP.packages[n]?.versions ?? []).includes(target)
  ok(
    '每条 missing 的 sameLine 与 fixture versions 一致',
    snap.missing.every((m) => m.sameLine === expectSameLine(m.name)),
    snap.missing.map((m) => `${m.name}:${m.sameLine}/${expectSameLine(m.name)}`).join(' '),
  )
  ok('同版本线计数 ≤ 可装未装', snap.counts.missingSameLine <= snap.counts.missing, `${snap.counts.missingSameLine} / ${snap.counts.missing}`)
  if (target !== '') {
    ok('无本机版本线的包被标出', snap.missing.some((m) => m.sameLine === false), `target=${target}`)
  }

  // ── 3) 相关性表：只命中市场里存在的包，且不给无关包编造结论 ────────────
  const relevant = new Set(snap.relevant.map((r) => r.name))
  ok('相关表含 dsh-lsp', relevant.has('@deepseek-ai/dsh-lsp'))
  ok('相关表含 dsh-tool-session-query', relevant.has('@deepseek-ai/dsh-tool-session-query'))
  ok('相关表含 dsh-tool-present', relevant.has('@deepseek-ai/dsh-tool-present'))
  ok('无关包不进相关表', !relevant.has('@deepseek-ai/dsh-fixture-only-package'), [...relevant].join(','))
  ok('相关表每条都有结论 / 理由 / 成本', snap.relevant.every((r) => r.verdict !== '' && r.why !== '' && r.cost !== ''))
  ok('LSP 一族标记为「不全在市场」', snap.relevant.find((r) => r.name === '@deepseek-ai/dsh-lsp')?.inMarket === false)
}

// ── 4) 文本模式：概览 / --search / --missing 都能跑 ────────────────────────
const text = run(['--offline', '--cache', FIXTURE])
ok('概览退出 0', text.code === 0, `exit ${text.code}`)
ok('概览标注陈旧快照', text.out.includes('陈旧'), text.out.slice(0, 300))
ok('概览给出安装命令', text.out.includes('dsh plugin --profile web add'))
ok('概览强调版本必须钉住', text.out.includes('latest dist-tag'))
ok('概览指向已装侧唯一事实源', text.out.includes('plugins.mjs'))

const search = run(['--offline', '--cache', FIXTURE, '--search', 'fixture-only'])
ok('--search 退出 0', search.code === 0, `exit ${search.code}`)
ok('--search 命中 fixture 包', search.out.includes('dsh-fixture-only-package'), search.out.slice(0, 200))
ok('--search 标注未装', search.out.includes('未装'))

const missing = run(['--offline', '--cache', FIXTURE, '--missing'])
ok('--missing 退出 0', missing.code === 0, `exit ${missing.code}`)
ok('--missing 列出全部可装未装', missing.out.includes('dsh-fixture-only-package'))

// ── 5) 无快照：必须明确失败，不静默 ────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'math-proof-market-'))
try {
  const noCache = run(['--offline', '--cache', join(tmp, 'nope.json')])
  ok('无快照 + --offline → 非 0 退出', noCache.code !== 0, `exit ${noCache.code}`)
  ok('无快照报错说明快照路径', /快照/.test(`${noCache.out}${noCache.err}`), `${noCache.out}${noCache.err}`.slice(0, 200))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ── 6) 真实快照（若已生成）必须可解析 ──────────────────────────────────────
const realCacheDir = join(PRESET, 'state', 'market')
if (existsSync(realCacheDir)) {
  const files = readdirSync(realCacheDir).filter((f) => f.endsWith('.json'))
  ok('真实快照存在', files.length > 0, files.join(','))
  for (const f of files) {
    const one = run(['--offline', '--cache', join(realCacheDir, f), '--json'])
    ok(`真实快照 ${f} 可解析`, one.code === 0, `exit ${one.code}`)
  }
} else {
  results.push('⏭ state/market 尚无快照（联网跑一次即生成）')
}

console.log('# 插件市场脚本回归（离线 fixture）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'MARKET_OK' : 'MARKET_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
