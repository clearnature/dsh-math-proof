// 数学证明模式 — DSH 插件盘点：三平面 provenance（零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/plugins.mjs              # 三平面盘点
//   node .../plugins.mjs --host       # 只看宿主平面（启用 / 禁用）
//   node .../plugins.mjs --gaps       # 只看接管关系与能力缺口
//   node .../plugins.mjs --json       # 机器可读
//   node .../plugins.mjs --refresh-host  # 重跑 `dsh --profile web --dump-config`
//   node .../plugins.mjs --dump <file>   # 用指定 dump（测试/离线）
//   node .../plugins.mjs --all        # 追加未挂载长尾
//
// ── 为什么要分平面（这是本脚本存在的理由）──────────────────────────────────
//   同一个包名可能在三处出现，含义完全不同：
//     · 宿主组合里 `disabled: true`  → 宿主**不提供**，等某个 preset 提供
//     · 我们 preset 里同名的一行     → **我们在提供**（这才是「我们挂上了」）
//     · 出厂 `standard` / `minimal`  → 判断「宿主禁用了，本来该谁提供」
//   只按包名统计（老版本的做法）会把 26 个「等 preset 接管」的行算成「宿主已挂」，
//   从而得出**相反结论**。本脚本按 dump 里的真实 `disabled` 标志分类。
//
// 已装侧的候选判断表在本文件（唯一事实源）；市场侧（可装未装 / 版本线 / 前置条件）见
// `scripts/market.mjs`；共享事实层见 `impl/dsh-inventory.mjs`。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hostSets,
  installedPackages,
  loadHostRows,
  presetRows,
  shippedPresetProviders,
  targetVersion,
} from '../impl/dsh-inventory.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRESET = dirname(HERE)

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const AS_JSON = has('--json')
const ONLY_HOST = has('--host')
const ONLY_GAPS = has('--gaps')
const SHOW_ALL = has('--all')

const short = (n) => n.replace('@deepseek-ai/', '')

// ── 事实层 ──────────────────────────────────────────────────────────────────

const installed = installedPackages()
const target = targetVersion(installed)
const hostLoad = loadHostRows(PRESET, { refresh: has('--refresh-host'), dumpPath: opt('--dump') ?? null })
const preset = presetRows(PRESET)
const shipped = shippedPresetProviders()
// 计数口径与 `scripts/market.mjs` 一致：按包名去重（同名多行取「任一启用即启用」），只数 dsh 包
const hs = hostSets(hostLoad.rows)

/** 宿主按名字索引（同名多行时：任一启用即视为启用）。 */
const hostByName = new Map()
for (const r of hostLoad.rows) {
  if (!hostByName.has(r.name)) hostByName.set(r.name, [])
  hostByName.get(r.name).push(r)
}
const hostState = (name) => {
  const rows = hostByName.get(name)
  if (rows === undefined) return 'absent'
  return rows.some((r) => !r.disabled) ? 'enabled' : 'disabled'
}

/** 我们 preset 提供的包名（去重）与本地行。 */
const presetNames = new Set(preset.filter((r) => r.name.startsWith('@deepseek-ai/')).map((r) => r.name))
// 包名 vs spec：`@deepseek-ai/dsh-tool-subagent-control/list-agents` 是同一个包的子路径导出
const presetPkgs = new Set([...presetNames].map((n) => n.split('/').slice(0, 2).join('/')))
const presetLocal = preset.filter((r) => r.name.startsWith('./'))

/** 分类：宿主启用 / 宿主禁用-我们接管 / 宿主禁用-无人接管（区分出厂是否提供）/ 宿主没有。 */
const classified = [...new Set([...hostByName.keys(), ...presetNames])]
  .filter((n) => n.startsWith('@deepseek-ai/dsh-'))
  .sort()
  .map((name) => {
    const state = hostState(name)
    const ours = presetNames.has(name)
    const factory = [...(shipped.get(name) ?? [])].sort()
    return { name, state, ours, factory, gap: state === 'disabled' && !ours && factory.includes('standard') }
  })

const conflicts = classified.filter((c) => c.state === 'enabled' && c.ours)
const takeover = classified.filter((c) => c.state === 'disabled' && c.ours)
const hostEnabled = classified.filter((c) => c.state === 'enabled')
const gaps = classified.filter((c) => c.gap)
const factoryOnly = classified.filter(
  (c) => c.state === 'disabled' && !c.ours && c.factory.length > 0 && !c.factory.includes('standard'),
)

// ── 判断表：宿主启用、对我们有直接增益的插件（人工核过「它在加强什么」）──────
const HOST_VALUE = [
  ['@deepseek-ai/dsh-repeat-tool-reminder', '同一工具反复调用时提醒（阈值 3/5/8）→ 机械强化「编译预算 / 别 whack-a-mole」'],
  ['@deepseek-ai/dsh-spill-local', '大工具输出溢出到磁盘，只把摘要留在上下文 → 直接压最贵的成本项'],
  ['@deepseek-ai/dsh-spill-policy', 'spill 阈值策略（实测 `maxInlineBytes: 50000`）'],
  ['@deepseek-ai/dsh-token-meter', '上下文 / token 压力计量 → 配合 `scripts/cache-report.mjs` 看钱花在哪'],
  ['@deepseek-ai/dsh-session-checkpoint-policy', '长会话检查点策略（证明工作常常连续数天）'],
  ['@deepseek-ai/dsh-code-runtime-worker-thread', '代码执行隔离在 worker 线程 → oracle 的沙箱执行路径'],
  ['@deepseek-ai/dsh-fs-observation-policy', '读后写 / 先读再改策略 → 防止「没读就改」毁掉证明文件'],
  ['@deepseek-ai/dsh-agent-presets', 'preset 名册：本 preset 就是被它挂载的（`default` 见 dump）'],
  ['@deepseek-ai/dsh-sandbox-local', '文件沙箱（read-only / workspace-write / danger-full-access 三档）'],
  ['@deepseek-ai/dsh-user-approval', '审批栈（本会话关闭了审批提示，策略仍在宿主）'],
  ['@deepseek-ai/dsh-bash-sandbox', 'bash 调用的沙箱包装 → 编译命令也受策略约束'],
]

// ── 判断表：装了但没挂 / 需要决策（候选）──────────────────────────────────
const CANDIDATES = [
  ['@deepseek-ai/dsh-schedule', '待评估', '会话内定时提醒（3 个工具）。注意：**客户端行 `ui-schedule` 与宿主 Schedule 服务在出厂图里是显式关闭的**，要开得过一个 overlay，不只加 preset 一行；再加 +1.5–2k 常驻前缀'],
  ['@deepseek-ai/dsh-mcp-client', '待评估', '接外部 MCP 服务（外部 CAS / 定理库）；需要真有可用的 MCP 服务端'],
  ['@deepseek-ai/dsh-session-reference', '待评估', '跨会话快照引用（宿主级服务）：可让新会话读旧会话的证明上下文'],
  ['@deepseek-ai/dsh-session-query-sqlite', '需宿主开启', '行**是启用的**，但配置 `openAt: never` → 不落盘。要开得改宿主 patch；**并且**模型侧工具包 `dsh-tool-session-query` 本地没装'],
  ['@deepseek-ai/dsh-tool-bash-persistent', '不建议', '持久 shell 需要 `terminal` + `terminal-bash` 三行，且与 `tool-bash` 语义重叠；我们的编译调用自包含'],
  ['@deepseek-ai/dsh-skill-badge', '不建议', '出厂 base 自己就 `disabled: true`——不是我们关的，是有意不挂'],
]

// ── 输出 ────────────────────────────────────────────────────────────────────

const valueRows = HOST_VALUE.filter(([n]) => installed.has(n))

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        hostSource: hostLoad.source,
        hostDump: hostLoad.path,
        hostError: hostLoad.error,
        targetVersion: target,
        counts: {
          hostRows: hostLoad.rows.length,
          hostEnabled: hs.enabled.size,
          hostDisabled: hs.disabled.size,
          presetRows: preset.length,
          presetPackages: presetPkgs.size,
          presetExternalSpecs: presetNames.size,
          presetLocal: presetLocal.length,
          installed: installed.size,
          takeover: takeover.length,
          conflicts: conflicts.length,
          gaps: gaps.length,
          factoryOnly: factoryOnly.length,
        },
        conflicts: conflicts.map((c) => c.name),
        takeover: takeover.map((c) => c.name),
        gaps: gaps.map((c) => c.name),
        factoryOnly: factoryOnly.map((c) => ({ name: c.name, factory: c.factory })),
        hostEnabled: hostEnabled.map((c) => c.name),
        customRows: presetLocal.map((r) => r.name),
        candidates: CANDIDATES.map(([name, verdict, why]) => ({ name, verdict, why, installed: installed.has(name) })),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

console.log('# DSH 插件盘点：三平面 provenance\n')
console.log(
  `- 宿主组合：**${hostLoad.rows.length}** 行｜dsh 包名去重后启用 **${hs.enabled.size}** / 禁用 **${hs.disabled.size}**｜来源 \`${hostLoad.source}\`${hostLoad.path !== null ? `（\`${hostLoad.path}\`）` : ''}`,
)
if (hostLoad.error !== null) console.log(`- ⚠ ${hostLoad.error}`)
console.log(
  `- 本 preset：**${preset.length}** 行（外部包 ${presetPkgs.size} 个 / ${presetNames.size} 条 spec / 本地插件 ${presetLocal.length}）｜本机 dsh 版本线 **${target}**`,
)
console.log(
  `- 宿主显式禁用、**由本 preset 接管**：**${takeover.length}** 行｜⚠ 双份（宿主启用且 preset 也声明）：**${conflicts.length}**｜❗ 真缺口：**${gaps.length}**`,
)
console.log('')

if (!ONLY_GAPS) {
  console.log('## 一、宿主平面：升级后自动恢复、正在加强我们的（不需要我们做任何事）\n')
  console.log('| 插件 | 它怎么加强证明工作 | 状态 |')
  console.log('| --- | --- | --- |')
  for (const [n, why] of valueRows) {
    console.log(`| \`${short(n)}\` | ${why} | ${hostState(n) === 'enabled' ? '✅ 启用' : `⚠ ${hostState(n)}`} |`)
  }
  console.log('')

  console.log('## 二、宿主**故意禁用**、由本 preset 接管的行\n')
  console.log('> web 面组合层写着「the agent plane moves behind agent presets」：这些行属于单个 agent，')
  console.log('> 宿主面禁用它们，交给每个会话挂的 preset 提供。**它们不是「宿主已挂」，是我们自己挂的。**\n')
  console.log(`本 preset 接管 **${takeover.length}** 行：`)
  console.log(takeover.map((c) => `\`${short(c.name)}\``).join('、'))
  console.log('')
  console.log(`本 preset 自带的本地插件行 **${presetLocal.length}** 个（我们写的）：`)
  for (const r of presetLocal) {
    let head = ''
    try {
      head = readFileSync(join(PRESET, r.name), 'utf8').split('\n')[0].replace(/^\/\/\s*/, '').slice(0, 90)
    } catch {
      head = '(读不到)'
    }
    console.log(`- \`${r.name}\`${r.disabled ? '（禁用）' : ''} — ${head}`)
  }
  console.log('')
}

if (!ONLY_HOST) {
  console.log('## 三、能力缺口与出厂对照\n')
  if (conflicts.length > 0) {
    console.log('### ⚠ 双份挂载（宿主启用 + preset 也声明 → 可能注册两次）\n')
    for (const c of conflicts) console.log(`- \`${short(c.name)}\``)
    console.log('')
  } else {
    console.log('- ✅ **无双份挂载**：宿主启用集与 preset 声明集不相交。\n')
  }
  if (gaps.length > 0) {
    console.log('### ❗ 真缺口（宿主禁用 + 我们没接，**且出厂 `standard` 提供**）\n')
    for (const c of gaps) console.log(`- \`${short(c.name)}\` — 出厂 standard/cordis/ptc 都有，我们没有`)
    console.log('')
  } else {
    console.log('- ✅ **无真缺口**：宿主禁用且出厂 `standard` 提供的行，我们全都接了。\n')
  }
  if (factoryOnly.length > 0) {
    console.log('### ℹ 宿主禁用、出厂也只在别的 preset 里提供（对照，不是缺口）\n')
    for (const c of factoryOnly) console.log(`- \`${short(c.name)}\` — 出厂仅 ${c.factory.join('/')} 提供`)
    console.log('')
  }

  console.log('## 四、装了但没挂 / 待你决策\n')
  console.log('| 插件 | 结论 | 说明 |')
  console.log('| --- | --- | --- |')
  for (const [n, verdict, why] of CANDIDATES) {
    console.log(`| \`${short(n)}\`${installed.has(n) ? '' : '（未装）'} | **${verdict}** | ${why} |`)
  }
  console.log('')
  console.log('> 市场侧（可装未装 58 个、版本线、安装命令）见 `scripts/market.mjs`。')
  console.log('')
}

if (SHOW_ALL) {
  const known = new Set([...HOST_VALUE.map(([n]) => n), ...CANDIDATES.map(([n]) => n), ...presetNames, ...hostByName.keys()])
  const rest = [...installed.keys()].filter((n) => !known.has(n)).sort()
  console.log(`## 五、其余已装 dsh 包（${rest.length}）——宿主/UI/传输层，与证明流程无关\n`)
  for (const n of rest) console.log(`- \`${short(n)}\` — ${installed.get(n).desc.slice(0, 88)}`)
  console.log('')
}

console.log('> 复跑即可复现：`node scripts/plugins.mjs`（宿主 dump 缓存在 `state/host/web-composition.yml`，')
console.log('> `--refresh-host` 重跑 `dsh --profile web --dump-config`）。')
