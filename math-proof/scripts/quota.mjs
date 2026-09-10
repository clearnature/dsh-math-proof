// 数学证明模式 — **余额采样命令行**（零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/quota.mjs               # 看本机采样与趋势（不联网）
//   node ~/.dsh/.agent-presets/math-proof/scripts/quota.mjs --refresh     # 拉一次官方 GET /user/balance 再报
//   node .../quota.mjs --refresh --json                                  # 机器可读（给监控/告警吃）
//   node .../quota.mjs --baseline 100                                    # 设百分比基线（官方接口没有「总量」字段）
//
// 为什么要单独一个命令：余额是**钱**的维度、变化很慢，适合挂 cron；而钩子/turn 中途做网络 I/O
// 会让工具调用变慢且不可预期——所以「采样」和「消费」分开，`budget action:"quota"` 默认也只读缓存。
//
// 凭据来源（按序）：`--key-stdin`（从 stdin 读，避免进 shell 历史）→ `DEEPSEEK_API_KEY` 环境变量 →
// `.env`/harness 未启用时明确报错。**本脚本不解析 `~/.dsh/.credentials.yaml`** —— 那是 harness 的凭据存储，
// 由 harness 自己解析（工具侧走 `ctx.credentials.resolve`），脚本不复制这套模型、也不打印任何密钥。
//
// 端点（官方，2026-09-10 核对）：
//   GET {baseURL}/user/balance  →  {is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}
//   ⚠ 是**金额字符串**、**没有总量**；`total_quota/remaining_quota/used_quota` 这类字段并不存在。

import { readFileSync } from 'node:fs'

import {
  appendQuotaSample,
  burnRatePerHour,
  etaHours,
  fetchBalance,
  fmtMoney,
  loadQuota,
  quotaBaseline,
  renderQuotaReport,
  saveQuota,
} from '../impl/quota.mjs'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valueOf = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}

const wantJson = has('--json')
const wantRefresh = has('--refresh')
const wantHelp = has('--help') || has('-h')

if (wantHelp) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(0)
}

if (valueOf('--baseline') !== undefined) {
  const n = Number(valueOf('--baseline'))
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--baseline 需要一个正数（收到 ${valueOf('--baseline')}）`)
    process.exit(2)
  }
  const state = loadQuota()
  saveQuota({ ...state, baseline: n, baselineSource: `scripts/quota.mjs --baseline ${n}` })
  console.log(`基线已设为 ${n}（百分比按它算；官方接口没有「总量」字段）`)
}

if (wantRefresh) {
  let apiKey = String(process.env.DEEPSEEK_API_KEY ?? '')
  if (apiKey === '' && has('--key-stdin')) {
    try {
      apiKey = readFileSync(0, 'utf8').trim()
    } catch {
      apiKey = ''
    }
  }
  const result = await fetchBalance({ apiKey })
  if (!result.ok) {
    console.error(`拉取失败：${result.why}${result.keys === undefined ? '' : `（响应顶层键：${result.keys.join(',')}）`}`)
    if (!wantJson) console.error('提示：脚本只认官方 `GET /user/balance` 的返回形状；若你的网关返回别的结构，请以官方文档为准。')
    process.exit(1)
  }
  const p = result.primary
  appendQuotaSample({ currency: p.currency, total: p.total, granted: p.granted, toppedUp: p.toppedUp, source: apiKey === '' ? 'unknown' : 'env/--key-stdin', available: result.available })
  if (!wantJson) console.log(`已采样：${p.currency} ${p.total.toFixed(2)}（赠金 ${(p.granted ?? 0).toFixed(2)} / 充值 ${(p.toppedUp ?? 0).toFixed(2)}）`)
}

const state = loadQuota()
const last = state.samples.at(-1) ?? null
const base = quotaBaseline(state)
const rate = last === null ? null : burnRatePerHour(state.samples, last.currency)
const eta = last === null ? null : etaHours(state.samples, last.currency)

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        samples: state.samples.length,
        last,
        baseline: base,
        burnPerHour: rate === null ? null : Number(rate.perHour.toFixed(4)),
        etaHours: eta === null ? null : Number(eta.toFixed(2)),
        endpoint: 'GET /user/balance',
        caveat: '官方返回的是余额（钱），没有「总量」字段；百分比只在自定基线或历史最高余额下有意义',
      },
      null,
      2,
    ),
  )
} else {
  console.log(renderQuotaReport(state, { available: last?.available }))
  if (rate !== null && eta !== null) {
    console.log(`\n> 速率 ${fmtMoney(rate.perHour, rate.currency)}/小时 → 还能撑 ${eta.toFixed(1)} 小时`)
  }
}
