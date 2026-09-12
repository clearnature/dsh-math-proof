// 数学证明模式 — **DSH 升级兼容核验**（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/compat-check.mjs
// 期望最后一行：COMPAT_CHECK_OK n/n（或裸环境下的 COMPAT_CHECK_SKIP）
//
// 为什么要有这一套：用户问「DSH 从 0.1.2 升到 0.1.5 了，我们的插件兼容吗」——
// 这类问题**必须能一条命令回答**，而且要覆盖两层：
//   1. **host 侧契约还在不在**（钩子方言/瀑布/日志容器/投影/权限/挂载）→ 跑 `scripts/harness-compat.mjs`；
//   2. **我们自己的解析器扛不扛得住新格式**（0.1.5 的会话格式是 v3，而新会话在盘上就是 v3）
//      → 用 `tests/fixtures/session-v3.jsonl`（按 v2→v3 迁移器体现的差异构造）真的解析一遍。
//
// 裸 CI 没有 DSH store → host 侧那半 `COMPAT_SKIP`（跳过而不是假绿）；我们自己那半永远跑。

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const FIXTURES = join(HERE, 'fixtures')

const results = []
let failures = 0
let skips = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${String(detail).slice(0, 150)}`}`)
  if (!cond) failures++
}
const skipReasons = []
const skip = (name, why) => {
  results.push(`⏭ ${name} — SKIP：${why}`)
  skips++
  skipReasons.push(why) // 汇总行必须报**真实**原因
}
const section = (t) => results.push(`\n## ${t}`)

const traffic = await import(join(PRESET, 'impl', 'session-traffic.mjs'))

// ── 1) host 侧契约（脚本自检；裸环境 SKIP）─────────────────────────────────
section('host 侧契约（scripts/harness-compat.mjs）')
{
  const r = spawnSync(process.execPath, [join(PRESET, 'scripts', 'harness-compat.mjs')], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const last = out.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? ''
  if (last.includes('COMPAT_SKIP')) {
    skip('host 侧契约 25 项', '本机没有 pnpm store（裸 CI）')
  } else {
    ok('兼容脚本退出 0（所有依赖的 host 契约都在位）', r.status === 0 && last.includes('COMPAT_OK'), last)
    ok('脚本报告本机 dsh 版本', /本机 dsh: \*\*0\.\d+\.\d+/.test(out), (out.match(/本机 dsh: \*\*[^*]+\*\*/) ?? [''])[0])
    ok('脚本列出涉及的包版本', /涉及的包版本:/.test(out), '')
    ok('脚本覆盖「会话格式版本」这一条（升级最可能影响我们）', out.includes('会话格式版本') && (r.status !== 0 || out.includes('✅ dsh-session')), '')
    // 2026-09-13 事故：契约都在位，但**我们行里的字段名过期了**（persona 的 text → prefix）
    ok('脚本覆盖「persona 必填字段」这一条（行 config 的字段名也是 host 契约）', out.includes('persona 配置必填字段'), '')
    ok('脚本用装在本机的包**真解析**我们的组合行 config', /## 我们的组合行 config/.test(out) && /校验了 \d+ 条/.test(out), (out.match(/- 校验了.*/) ?? [''])[0])
    ok('组合行 config 全部通过（0 失败）', /失败 0/.test(out) && r.status === 0, (out.match(/- 校验了.*/) ?? [''])[0])
  }
  // 版本期望不匹配时必须红（防止「升级了却没人发现」）
  const wrong = spawnSync(process.execPath, [join(PRESET, 'scripts', 'harness-compat.mjs'), '--expect', '0.0.1'], { encoding: 'utf8' })
  if (last.includes('COMPAT_SKIP')) {
    skip('版本期望不匹配 → 红', '裸环境')
  } else {
    ok('--expect 版本不匹配时脚本变红（升级可被机器发现）', wrong.status === 1 && (wrong.stdout ?? '').includes('COMPAT_FAIL'), `exit ${wrong.status}`)
  }
}

// ── 1b) 静态：我们自己的组合行不许用过期字段（裸 CI 也跑这一半）─────────────
section('组合行字段名（静态；不依赖本机 harness）')
{
  const yml = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')
  const personaRow = /- id: persona\n([\s\S]*?)(?=\n- id: )/.exec(yml)?.[1] ?? ''
  ok('persona 行存在', personaRow !== '', '')
  ok('persona 行用 `prefix:`（0.1.5 起必填；旧的 `text:` 会让整份 preset 挂载失败）', /\n\s+prefix: \|-/.test(personaRow), (personaRow.match(/\n\s+(text|prefix): [|>-]?/) ?? [''])[0])
  ok('persona 行不再出现 `text:` 字段', !/\n\s+text: [|>-]/.test(personaRow), '')
  ok('注释里写明为什么（下一个人不会再改回去）', personaRow.includes('$.prefix missing required value'), '')
}

// ── 2) 会话格式 v3（0.1.5 起新会话在盘上就是 v3）───────────────────────────
section('会话格式 v3 形状（我们直接读原始 JSONL）')
{
  const v3 = join(FIXTURES, 'session-v3.jsonl')
  ok('v3 形状样本存在', existsSync(v3))
  const folded = traffic.foldSession(v3)
  const totals = traffic.sessionTotals(v3)
  ok('识别出会话格式版本 = 3', folded.formatVersion === 3 && JSON.stringify(folded.formatVersions) === '[3]', JSON.stringify({ v: folded.formatVersion, set: folded.formatVersions }))
  ok('v3 形状**没有**触发「usage 缺失」告警', folded.usageMissing === false)
  ok('v3 的 `assistant/message.usage` 字段名与 v0 相同（逐字段读出来）', folded.turns[0].tok === 1020 && folded.turns[0].inTok === 100 && folded.turns[0].cacheTok === 900 && folded.turns[0].outTok === 20, JSON.stringify({ tok: folded.turns[0].tok, i: folded.turns[0].inTok, c: folded.turns[0].cacheTok, o: folded.turns[0].outTok }))
  ok('v3 的 `assistant/chunk` 回退路径仍可用（turn2 无 message 记录 → 530）', folded.turns[1].tok === 530 && folded.turns[1].steps === 1, JSON.stringify({ tok: folded.turns[1].tok, steps: folded.turns[1].steps }))
  ok('v3 的 `request/header`（无 header.system）仍能取到 provider/model', folded.turns[0].provider === 'deepseek-official' && folded.turns[0].model === 'deepseek-v4-flash', `${folded.turns[0].provider}/${folded.turns[0].model}`)
  ok('v3 的 `user/message`（source 在 data 上）仍能取到人类提示词', String(folded.turns[0].prompt ?? '').includes('断链'), String(folded.turns[0].prompt ?? '').slice(0, 20))
  ok('v3 的生效预设仍可归属', folded.presetEffective === 'math-proof' && totals.preset === 'math-proof', String(totals.preset))
  ok('v3 会话的 token 分解合计正确（1550）', totals.tok === 1550 && totals.inTok === 150 && totals.cacheTok === 1350 && totals.outTok === 50, JSON.stringify(totals).slice(0, 90))
}

// ── 3) 被拦计数的标签（exit 2 在协议里记作 block，不是 deny）───────────────
section('被拦计数：deny / block 两种标签都要认')
{
  const folded = traffic.foldSession(join(FIXTURES, 'session-v3.jsonl'))
  ok('v3 样本里的 `decision:"block"` 被计入 denies', folded.turns.every((t) => t.denies === 1), folded.turns.map((t) => t.denies).join(','))
  const v0 = traffic.foldSession(join(FIXTURES, 'session-basic.jsonl'))
  ok('旧样本里的 `decision:"deny"` 仍被计入（向后兼容）', v0.turns[1].denies === 1, String(v0.turns[1].denies))
  const src = readFileSync(join(PRESET, 'impl', 'session-traffic.mjs'), 'utf8')
  ok('实现里两种标签都认（不是只认 deny）', /decision === 'deny' \|\| e\.data\?\.decision === 'block'/.test(src), '')
}

// ── 3b) 0.1.5 迁移的**副作用**：文件名带版本 + 旧文件不删 + usage 换落点 ──────
// 这三条都是在**真实日志**上核出来的（2026-09-11：26 个会话 / 2 个目录两份共存 / 共 35.2 MB 残留）。
section('0.1.5 迁移的副作用（真实日志核对）')
{
  const v3file = join(FIXTURES, 'session-v3.jsonl')
  const v3 = traffic.foldSession(v3file)
  ok('文件名带版本：`session.v3.jsonl.zstd` → v3；legacy `session.jsonl.zstd` → v0', traffic.sessionLogVersion('session.v3.jsonl.zstd')?.version === 3 && traffic.sessionLogVersion('session.jsonl.zstd')?.version === 0)
  ok('一个目录里的两份日志只取**版本最高**那份（迁移不删旧文件 → 否则同一会话算两遍）', traffic.pickSessionLog(['session.jsonl.zstd', 'session.v3.jsonl.zstd']) === 'session.v3.jsonl.zstd')
  const chunkLines = readFileSync(join(FIXTURES, 'session-basic.jsonl'), 'utf8').split('\n')
  const v3Lines = readFileSync(v3file, 'utf8').split('\n')
  ok('v0 的 usage 在 `assistant/chunk`（fixture 里确实有 usage chunk）', chunkLines.some((l) => l.includes('"type":"usage"') || l.includes('"type": "usage"')))
  ok('v3 的 usage 在 `assistant/message.data.usage`（fixture 里 message 带 usage）', v3Lines.some((l) => l.includes('"usage"') && l.includes('assistant/message')))
  ok('v3 折叠出 token（不是静默 0）', v3.turns.some((t) => (t.tok ?? 0) > 0), JSON.stringify(v3.turns.map((t) => t.tok)))
  ok('逐步 usage：v3 也能逐步读出（`assistant/chunk` 在 v3 里是 0 个）', traffic.stepUsages(v3file).length > 0, String(traffic.stepUsages(v3file).length))
  ok('逐步 usage：v0 也能逐步读出', traffic.stepUsages(join(FIXTURES, 'session-basic.jsonl')).length > 0)
}

// ── 4) 形状自检：未来格式真的变了要**报出来**，不能静默算 0 ─────────────────
section('形状自检（防「升级后静默算 0 流量」）')
{
  const broken = join(FIXTURES, 'session-unknown-shape.jsonl')
  ok('「不认识的新形状」样本存在', existsSync(broken))
  const folded = traffic.foldSession(broken)
  ok('未知版本被如实报出（不假装认识）', folded.formatVersion === 9, String(folded.formatVersion))
  ok('有回合但读不到 usage → `usageMissing` 告警为真', folded.usageMissing === true)
  ok('会话累计为 0（因为确实读不到），但**带着告警**而不是悄悄算 0', traffic.sessionTotals(broken).tok === 0 && traffic.sessionTotals(broken).usageMissing === true, JSON.stringify(traffic.sessionTotals(broken)).slice(0, 80))
  const src = readFileSync(join(PRESET, 'plugins', 'budget.mjs'), 'utf8')
  ok('budget 工具会把「数量与均值可能失真」这类形状告警报给模型', /usageMissing/.test(src), '')
}

console.log('# DSH 升级兼容核验\n')
console.log(results.join('\n'))
const passed = results.filter((r) => r.startsWith('✅')).length
const judged = results.filter((r) => /^[✅❌]/.test(r)).length
const verdict = failures === 0 ? (skips > 0 ? 'COMPAT_CHECK_SKIP' : 'COMPAT_CHECK_OK') : 'COMPAT_CHECK_FAIL'
console.log(`\n${verdict} ${passed}/${judged}${skips > 0 ? `（${skips} 条 SKIP：${[...new Set(skipReasons)].join('；')}）` : ''}`)
process.exit(failures === 0 ? 0 : 1)
