// 数学证明模式 — 插件盘点脚本回归（零依赖，离线，不联网）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/plugins-check.mjs
// 期望最后一行：PLUGINS_OK n/n
//
// 为什么这么测：`scripts/plugins.mjs` 的核心价值是**分类**——同一个包名在宿主禁用 / preset 接管 /
// 无人提供三种情形下含义完全相反。上一版只按包名统计，把 26 个「宿主显式禁用、等 preset 接管」
// 的行算成「宿主已挂」，得出了**相反结论**。所以这里用人工构造的 dump 把四种情形钉死：
//   1. 宿主禁用 + 我们声明        → 接管
//   2. 宿主禁用 + 无人声明 + 出厂 standard 有 → 真缺口
//   3. 宿主禁用 + 出厂也没有      → 静默
//   4. 宿主启用 + 我们声明        → ⚠ 双份告警
// 另加一条跨脚本一致性断言：`plugins.mjs` 与 `market.mjs` 报的宿主计数必须一致（就是这条曾经漂移）。

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const PLUGINS = join(PRESET, 'scripts', 'plugins.mjs')
const MARKET = join(PRESET, 'scripts', 'market.mjs')
const DUMP = join(HERE, 'fixtures', 'host-dump.yml')

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120000 })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

// ── 1) fixture dump：分类正确性 ────────────────────────────────────────────
const json = run(PLUGINS, ['--dump', DUMP, '--json'])
ok('--json 退出 0', json.code === 0, `exit ${json.code} ${json.err.slice(0, 200)}`)

let snap = null
try {
  snap = JSON.parse(json.out)
  ok('--json 可解析', true)
} catch (err) {
  ok('--json 可解析', false, String(err.message))
}

if (snap !== null) {
  ok('用指定 dump（不联网、不重跑 dsh）', snap.hostSource === 'dump' && snap.hostDump === DUMP, `${snap.hostSource} ${snap.hostDump}`)
  ok('宿主行数 = fixture 行数', snap.counts.hostRows === 8, String(snap.counts.hostRows))
  ok('计数只数 dsh 包（cordis:group / cordis-plugin-hmr 不进）', snap.counts.hostEnabled === 2 && snap.counts.hostDisabled === 4, `enabled=${snap.counts.hostEnabled} disabled=${snap.counts.hostDisabled}`)

  // 情形 1：宿主禁用 + 我们声明 → 接管
  ok(
    '宿主禁用 + 我们声明 → 记入接管',
    snap.takeover.includes('@deepseek-ai/dsh-tool-fs') && snap.takeover.includes('@deepseek-ai/dsh-plan-mode'),
    snap.takeover.join(' '),
  )

  // 情形 4：宿主启用 + 我们声明 → 双份告警
  ok('宿主启用 + 我们声明 → 记入冲突', snap.conflicts.includes('@deepseek-ai/dsh-compaction-basic'), snap.conflicts.join(' '))

  // 情形 3：宿主禁用 + 出厂也不提供 → 不进缺口
  ok('宿主禁用 + 出厂也不提供 → 不算缺口', !snap.gaps.includes('@deepseek-ai/dsh-skill-badge'), snap.gaps.join(' '))

  // 情形 2/对照：tool-str-replace-editor 只有 minimal 提供 → 出厂对照，不是缺口
  ok('仅 minimal 提供的行 → 不算缺口', !snap.gaps.includes('@deepseek-ai/dsh-tool-str-replace-editor'), snap.gaps.join(' '))
  // 出厂预设对照需要本机有 dsh 安装（`dsh-agent-presets` 的 presets/ 目录）；
  // 新克隆 / CI 里没有 → 跳过，而不是误报失败
  if (snap.counts.installed > 0) {
    const fo = snap.factoryOnly.find((f) => f.name === '@deepseek-ai/dsh-tool-str-replace-editor')
    ok('仅 minimal 提供的行 → 记入出厂对照', fo !== undefined && fo.factory.includes('minimal'), JSON.stringify(snap.factoryOnly))
  } else {
    results.push('⏭ 本机无 dsh 安装（新克隆 / CI）→ 出厂预设对照检查跳过')
  }

  ok('本地插件行单独列出（6 个）', snap.counts.presetLocal === 6, String(snap.counts.presetLocal))
  ok('外部包名去重计数（24 包 / 25 spec）', snap.counts.presetPackages === 24 && snap.counts.presetExternalSpecs === 25, `${snap.counts.presetPackages}/${snap.counts.presetExternalSpecs}`)
}

// ── 2) fixture dump：文本模式的告警必须出现在输出里 ────────────────────────
const gapsText = run(PLUGINS, ['--dump', DUMP, '--gaps'])
ok('--gaps 退出 0', gapsText.code === 0, `exit ${gapsText.code}`)
ok('--gaps 报出双份挂载', gapsText.out.includes('双份挂载'), gapsText.out.slice(0, 200))
ok('--gaps 报出无真缺口', gapsText.out.includes('无真缺口'))
ok('--gaps 报出出厂对照', gapsText.out.includes('出厂仅') || gapsText.out.includes('无真缺口'))

const hostText = run(PLUGINS, ['--dump', DUMP, '--host'])
ok('--host 退出 0', hostText.code === 0)
ok('--host 说明「宿主禁用 = preset 接管」', hostText.out.includes('由本 preset 接管') && hostText.out.includes('不是「宿主已挂」'))
ok('--host 列出本地插件', hostText.out.includes('./plugins/proof-dag.mjs'))

// ── 3) 缺失 dump：必须诚实降级标注，不假装数据是新的 ──────────────────────
const noDump = run(PLUGINS, ['--dump', join(HERE, 'fixtures', 'nonexistent-dump.yml'), '--json'])
if (noDump.code === 0) {
  const s = JSON.parse(noDump.out)
  ok('无 dump 时如实标注来源与警告', s.hostSource === 'bundle-patch' && typeof s.hostError === 'string', `${s.hostSource}`)
} else {
  ok('无 dump 时不崩溃（非 0 需有说明）', noDump.err !== '' || noDump.out !== '', `exit ${noDump.code}`)
}

// ── 4) 跨脚本一致性：两个脚本报的宿主计数必须相同（曾经漂移过这里）────────
const realPlugins = run(PLUGINS, ['--json'])
const realMarket = run(MARKET, ['--offline', '--json'])
if (realPlugins.code === 0 && realMarket.code === 0) {
  const a = JSON.parse(realPlugins.out)
  const b = JSON.parse(realMarket.out)
  if (a.hostSource === 'dump' || a.hostSource === 'dump-live' || a.hostSource === 'dump-stale') {
    ok(
      'plugins.mjs 与 market.mjs 的宿主启用/禁用计数一致',
      a.counts.hostEnabled === b.counts.hostEnabled && a.counts.hostDisabled === b.counts.hostDisabled,
      `plugins=${a.counts.hostEnabled}/${a.counts.hostDisabled} market=${b.counts.hostEnabled}/${b.counts.hostDisabled}`,
    )
  } else {
    results.push('⏭ 无宿主 dump，跨脚本一致性检查跳过')
  }
} else if (realPlugins.code === 0 && realMarket.code !== 0 && !existsSync(join(PRESET, 'state', 'market'))) {
  // 新克隆 / CI 没有市场快照 → `market.mjs --offline` 按设计失败；跳过跨脚本一致性检查
  results.push('⏭ 无市场快照（新克隆 / CI）→ 跨脚本计数一致性检查跳过')
} else {
  ok('两个脚本都能跑通 --json', false, `plugins=${realPlugins.code} market=${realMarket.code}`)
}

// ── 5) 真实 preset：宿主启用集与 preset 声明集不得相交 ────────────────────
const realRows = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')
ok('真实 composition 非空', realRows.includes('- id:') && realRows.length > 1000)
if (snap !== null && snap.hostSource !== 'bundle-patch') {
  const realJson = JSON.parse(run(PLUGINS, ['--json']).out)
  ok('真实宿主平面无双份挂载', realJson.counts.conflicts === 0, JSON.stringify(realJson.conflicts))
  ok('真实宿主平面无真缺口', realJson.counts.gaps === 0, JSON.stringify(realJson.gaps))
}

console.log('# 插件盘点脚本回归（三平面分类 + 跨脚本一致）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'PLUGINS_OK' : 'PLUGINS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
