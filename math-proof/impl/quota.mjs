// 数学证明模式 — **DeepSeek 余额采样与趋势**（零依赖，只用 `node:` 内建）
//
// 为什么单独成一个模块：用户要「额度监控」，而额度只能从**官方余额接口**拿。
//
// ⚠ 先把口径写死（2026-09-10 核对官方文档 https://api-docs.deepseek.com/zh-cn/api/get-user-balance/）：
//   · 端点是 **`GET /user/balance`**（**不是** `/v1/user/info`，也不是 `/user/info`）；
//   · 返回形如：
//       { "is_available": true,
//         "balance_infos": [ { "currency": "CNY", "total_balance": "110.00",
//                              "granted_balance": "10.00", "topped_up_balance": "100.00" } ] }
//   · 它是**钱**（字符串金额），**不是 token 配额**；而且**没有「总量」字段**。
//   ⇒ 所以「剩余 / 总量 = 百分比」这种算法**在官方接口上根本算不出来**（社区流传的
//     `total_quota` / `remaining_quota` / `used_quota` 字段在官方响应里不存在）。
//     本模块因此只做三件能站住的事：
//       ① **采样**（时间序列，落盘有界）；
//       ② **燃烧速率**（金额/小时，只看最近一段**单调下降**区间，充值时不会算成负消耗）；
//       ③ **ETA**（按当前速率还能撑多久）。
//     百分比只在**用户自己声明基线**（`baseline`）或「历史最高余额」时才给，并明确标注来源。
//
// 另：token 侧的额度**已经**由 `SESSION`（会话 token 预算）管——那边用的是官方 usage，
// 精确且不花钱；余额这边是**钱**的维度，两者互补。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { stateDir } from './session-traffic.mjs'

/** 官方余额端点（相对 baseURL）。 */
export const BALANCE_PATH = '/user/balance'

/** 官方默认 baseURL（可用 `DEEPSEEK_BASE_URL` 覆盖）。 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** 采样保留上限（数据管理：状态文件必须有界）。 */
export const SAMPLES_MAX = 500

/** 采样落盘路径。 */
export function quotaSamplesPath() {
  return join(stateDir(), 'quota-samples.json')
}

/** 金额字符串 → 数值（保留两位小数）；解析不了返回 null，**不猜**。 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').trim()
  if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * 解析官方余额响应。
 * **只认官方形状**；不认识就如实说「不认识」，并把顶层键名列出来（不 dump 整个 body）。
 * @returns `{ ok: true, available, entries: [{currency,total,granted,toppedUp}], primary }`
 *          或 `{ ok: false, why, keys? }`
 */
export function parseBalance(json) {
  if (json === null || typeof json !== 'object') return { ok: false, why: '响应不是对象' }
  const infos = json.balance_infos
  if (!Array.isArray(infos) || infos.length === 0) {
    return { ok: false, why: '响应里没有 balance_infos 数组（可能不是官方余额接口）', keys: Object.keys(json).slice(0, 8) }
  }
  const entries = []
  for (const raw of infos) {
    if (raw === null || typeof raw !== 'object') continue
    const total = parseAmount(raw.total_balance)
    if (total === null) continue
    entries.push({
      currency: String(raw.currency ?? '—'),
      total,
      granted: parseAmount(raw.granted_balance),
      toppedUp: parseAmount(raw.topped_up_balance),
    })
  }
  if (entries.length === 0) return { ok: false, why: 'balance_infos 里没有可解析的 total_balance', keys: Object.keys(json).slice(0, 8) }
  const primary = entries.find((e) => e.currency === 'CNY') ?? entries[0]
  return { ok: true, available: json.is_available !== false, entries, primary }
}

/** 读采样（损坏 → 备份后当空的；**不静默丢数据**）。 */
export function loadQuota(path = quotaSamplesPath()) {
  const empty = { version: 1, samples: [], baseline: null, baselineSource: null }
  if (!existsSync(path)) return empty
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return empty
    return {
      version: 1,
      samples: Array.isArray(parsed.samples) ? parsed.samples.filter((s) => s !== null && typeof s === 'object') : [],
      baseline: typeof parsed.baseline === 'number' ? parsed.baseline : null,
      baselineSource: typeof parsed.baselineSource === 'string' ? parsed.baselineSource : null,
    }
  } catch {
    const bak = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(path, bak)
    } catch {
      /* 备份失败也不掩盖 */
    }
    return empty
  }
}

/** 原子写采样（超出上限丢最旧）。 */
export function saveQuota(state, path = quotaSamplesPath()) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  const next = {
    version: 1,
    baseline: typeof state.baseline === 'number' ? state.baseline : null,
    baselineSource: typeof state.baselineSource === 'string' ? state.baselineSource : null,
    samples: (state.samples ?? []).slice(-SAMPLES_MAX),
  }
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 追加一条采样。 */
export function appendQuotaSample(entry, path = quotaSamplesPath()) {
  const state = loadQuota(path)
  state.samples = [...state.samples, { at: new Date().toISOString(), ...entry }]
  saveQuota(state, path)
  return state
}

/**
 * 燃烧速率（金额/小时）。
 *
 * 口径：只看**最近一段单调下降**的区间（遇到充值/余额上升就从那里重新起算），
 * 再用**首末两点**算速率（不做线性回归——样本点少时回归会给出更好看但不真实的数）。
 * 样本不足或区间时长 ≤ 0 → `null`（**不编数字**）。
 */
export function burnRatePerHour(samples, currency) {
  const list = (samples ?? []).filter((s) => s !== null && typeof s === 'object' && (currency === undefined || s.currency === currency) && typeof s.total === 'number')
  if (list.length < 2) return null
  let start = 0
  for (let i = list.length - 1; i > 0; i--) {
    if (list[i].total > list[i - 1].total) {
      start = i
      break
    }
  }
  const window = list.slice(start)
  if (window.length < 2) return null
  const first = window[0]
  const last = window[window.length - 1]
  const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0) return null
  const spent = first.total - last.total
  if (spent <= 0) return null
  return { perHour: spent / hours, currency: last.currency, from: first.at, to: last.at, samples: window.length }
}

/** 按当前速率估算还能撑多久（小时）；无法估算返回 null。 */
export function etaHours(samples, currency) {
  const list = (samples ?? []).filter((s) => s !== null && typeof s === 'object' && (currency === undefined || s.currency === currency) && typeof s.total === 'number')
  if (list.length === 0) return null
  const rate = burnRatePerHour(list, currency)
  if (rate === null || rate.perHour <= 0) return null
  return list[list.length - 1].total / rate.perHour
}

/** 百分比基线：用户声明的优先，否则用「历史最高余额」（≈ 上次充值后的余额）。 */
export function quotaBaseline(state) {
  if (typeof state?.baseline === 'number' && state.baseline > 0) return { value: state.baseline, source: state.baselineSource ?? 'declared' }
  const totals = (state?.samples ?? []).map((s) => s?.total).filter((n) => typeof n === 'number')
  if (totals.length === 0) return null
  return { value: Math.max(...totals), source: 'max-observed（历史最高余额 ≈ 上次充值后）' }
}

/** 拉一次余额（网络）。`fetchImpl` 可注入以便测试。 */
export async function fetchBalance(options = {}) {
  const baseUrl = String(options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const apiKey = String(options.apiKey ?? '')
  if (apiKey === '') return { ok: false, why: '没有可用的 API key（credentials.resolve 与 DEEPSEEK_API_KEY 都没拿到）' }
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, why: '本进程没有 fetch（Node < 18？）' }
  const timeoutMs = Number(options.timeoutMs ?? 15000)
  try {
    const resp = await doFetch(`${baseUrl}${BALANCE_PATH}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!resp.ok) {
      // 只报状态码，**不回显响应体**（可能含账号信息）
      return { ok: false, why: `HTTP ${resp.status}${resp.status === 401 ? '（API key 无效）' : resp.status === 402 ? '（余额不足）' : ''}` }
    }
    const json = await resp.json()
    const parsed = parseBalance(json)
    if (!parsed.ok) return { ok: false, why: parsed.why, keys: parsed.keys }
    return { ok: true, ...parsed, baseUrl }
  } catch (e) {
    return { ok: false, why: `请求失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 金额显示（两位小数，带币种符号）。 */
export function fmtMoney(n, currency) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  return `${symbol}${n.toFixed(2)}${symbol === '' ? ` ${currency ?? ''}`.trimEnd() : ''}`
}

/** 渲染一份人类可读的额度报告。 */
export function renderQuotaReport(state, extra = {}) {
  const lines = [
    '# budget: quota（**DeepSeek 专属**：余额是「钱」，不是 token 配额）',
    '',
    '> ⚠ 这一条**只对 DeepSeek 这类余额制 provider 有效**。MiMo / Qwen 等**积分制**服务既没有 `/user/balance`，',
    '> 「钱」也没有意义——那边该看的是 **token 账**（`budget action:"report"` 的「Token 账」一节，跨 provider 通用）。',
    '',
  ]
  const samples = state.samples ?? []
  if (samples.length === 0) {
    lines.push('- **还没有采样**：`budget action:"quota" refresh:true`（或 `node scripts/quota.mjs --refresh`）拉一次。')
    lines.push('- 端点：`GET /user/balance`（官方）；返回金额字符串，**没有总量字段** → 百分比需要自定基线。')
    return lines.join('\n')
  }
  const last = samples[samples.length - 1]
  const base = quotaBaseline(state)
  lines.push(`- 数据来源：DeepSeek 官方 \`GET ${BALANCE_PATH}\`（**金额字符串、没有总量字段**；其他 provider 无此接口）`)
  lines.push(`- 最新余额：**${fmtMoney(last.total, last.currency)}**（${last.at}，来源 ${last.source ?? '—'}）`)
  if (typeof last.granted === 'number' || typeof last.toppedUp === 'number') {
    lines.push(`  - 其中赠金 ${fmtMoney(last.granted, last.currency)}｜充值 ${fmtMoney(last.toppedUp, last.currency)}`)
  }
  if (extra.available === false) lines.push('- ⚠ 官方 `is_available=false`：当前账户**不能调用**（先充值）')
  if (base !== null) {
    const used = Math.max(0, base.value - last.total)
    lines.push(`- 基线：${fmtMoney(base.value, last.currency)}（${base.source}）→ 已用 **${((used / base.value) * 100).toFixed(1)}%**（剩余 ${(((base.value - used) / base.value) * 100).toFixed(1)}%）`)
    lines.push('  > ⚠ 这是**你自己声明的基线**，不是官方给的「总量」——官方接口没有总量字段。')
  }
  const rate = burnRatePerHour(samples, last.currency)
  if (rate === null) {
    lines.push(`- 燃烧速率：**样本不足**（至少两次不同时刻的采样；当前 ${samples.length} 条）`)
  } else {
    lines.push(`- 燃烧速率：**${fmtMoney(rate.perHour, rate.currency)}/小时**（${rate.from.slice(5, 16)} → ${rate.to.slice(5, 16)}，${rate.samples} 个采样点，只看最近一段单调下降区间）`)
    const eta = etaHours(samples, last.currency)
    if (eta !== null) {
      lines.push(`- 按此速率：还能撑 **${eta.toFixed(1)} 小时**（≈ ${(eta / 24).toFixed(1)} 天）`)
      if (eta < 24) lines.push('  - ⚠ 不足一天：先处理关键任务，或充值')
    }
  }
  lines.push(`- 采样历史：${samples.length} 条（上限 ${SAMPLES_MAX}）｜落盘 \`${quotaSamplesPath()}\``)
  lines.push('- 采样命令：`budget action:"quota" refresh:true`｜`node scripts/quota.mjs --refresh`（可挂 cron）')
  return lines.join('\n')
}
