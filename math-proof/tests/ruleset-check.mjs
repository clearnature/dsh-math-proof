// 数学证明模式 — 判定规则与工具自证回归（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/ruleset-check.mjs
// 期望最后一行：RULESET_OK n/n
//
// 为什么这么测：2026-09-10 的真实事故是「会话里的工具实例用旧规则算分」——
// 旧实例报 85/100、断链 25 条，磁盘新规则算出 0 条，而会话里**无法自证**，只能人肉 diff。
// 本测试钉死四件事：
//   1. **热读真的生效**：改规则文件后重新加载，拿到的是新值（不是 ESM 缓存里的旧模块）；
//   2. **规则真的被用上**：`diagnose` 的扣分随传入的规则变化（断链豁免 / 评分权重）；
//   3. **doctor 自证**：输出含插件本体哈希 / 规则集版本 / 状态目录，且能报出「落后于磁盘」；
//   4. **postulate 门禁**：未声明拒收、gap 拒收、声明不存在的名字被报、声明后放行。

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

const ruleset = await import(join(PRESET, 'impl', 'ruleset.mjs'))
const dag = await import(join(PRESET, 'plugins', 'proof-dag.mjs'))
const engine = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))

// ── 1) 热读：改规则文件后必须拿到新值 ──────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'math-proof-rules-'))
  try {
    const file = join(dir, 'rules.mjs')
    writeFileSync(file, 'export const RULESET_VERSION = "t1"\nexport const SCORE = { cyclic: 1 }\n')
    const before = await ruleset.loadRulesFrom(file)
    ok('loadRulesFrom 返回版本与哈希', before.version === 't1' && typeof before.hash === 'string', JSON.stringify({ v: before.version, h: before.hash }))
    await sleep(1100) // mtime 秒级分辨率：确保下次 mtime 确实变了
    writeFileSync(file, 'export const RULESET_VERSION = "t2"\nexport const SCORE = { cyclic: 99 }\n')
    const after = await ruleset.loadRulesFrom(file)
    ok('改规则后拿到新版本（ESM 缓存被打破）', after.version === 't2', after.version)
    ok('改规则后新数值生效', after.rules.SCORE.cyclic === 99, String(after.rules.SCORE.cyclic))
    ok('哈希随内容变化', before.hash !== after.hash)
    ok('rulesetStatus 能判「变了」', ruleset.rulesetStatus(before, after) === 'changed')
    ok('rulesetStatus 对同版返回 current', ruleset.rulesetStatus(after, after) === 'current')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// 真规则文件可加载且有版本
{
  const live = await ruleset.loadRules()
  ok('真规则集可加载（版本非空）', typeof live.version === 'string' && live.version !== '', live.version)
  ok('真规则集含四张表', ['DRIFT', 'SCORE', 'POSTULATE', 'RESULT_TRIAGE'].every((k) => live.rules[k] !== undefined))
}

// ── 2) 规则真的被 diagnose 用上 ────────────────────────────────────────────
{
  const ws = mkdtempSync(join(tmpdir(), 'math-proof-rulesws-'))
  try {
    mkdirSync(join(ws, 'src', 'Sovereign'), { recursive: true })
    // 模块只 import Data.Nat；节点却声明依赖另一个模块 → 断链
    writeFileSync(join(ws, 'src', 'Sovereign', 'M.agda'), 'module Sovereign.M where\n\nimport Data.Nat\n')
    const nodes = {
      A: { id: 'A', statement: 's', module: 'Sovereign.M', deps: ['B'], state: 'proven' },
      B: { id: 'B', statement: 's', module: 'Sovereign.N', deps: [], state: 'pending' },
    }
    const strict = { ...ruleset, DRIFT: { ...ruleset.DRIFT, exemptSameModule: false }, SCORE: { ...ruleset.SCORE, driftPer: 7, driftCap: 100 } }
    const d = dag.diagnose(nodes, [], ws, null, strict)
    const driftDed = d.deductions.find((x) => x.reason.includes('断链'))
    ok('断链被检出并按传入权重扣分', driftDed !== undefined && driftDed.points === 7, JSON.stringify(d.deductions))
    // 同模块豁免：B 的模块改成跟 A 一样 → 断链消失
    const nodesSame = { ...nodes, B: { ...nodes.B, module: 'Sovereign.M' } }
    const dSame = dag.diagnose(nodesSame, [], ws, null, ruleset)
    ok('同模块豁免生效（声明依赖自己的模块不算断链）', dSame.drift.length === 0, JSON.stringify(dSame.drift))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ── 3) postulate 门禁 ──────────────────────────────────────────────────────
{
  const ws = mkdtempSync(join(tmpdir(), 'math-proof-post-'))
  try {
    mkdirSync(join(ws, 'src', 'Sovereign'), { recursive: true })
    const mod = 'Sovereign.T6Like'
    writeFileSync(
      join(ws, 'src', 'Sovereign', 'T6Like.agda'),
      'module Sovereign.T6Like where\n\npostulate\n  div3k : Set\n  mod3k : Set\n  gf3Toℕ-A4-inv : Set\n  φ-respects : Set\n\ntheoremX : Set\ntheoremX = Set\n',
    )
    const names = dag.postulateNames(readFileSync(join(ws, 'src', 'Sovereign', 'T6Like.agda'), 'utf8'))
    ok('postulateNames 扫出 4 个名字', names.length === 4, names.join(','))
    ok('postulateNames 认 Unicode 标识符（ℕ / φ）', names.includes('gf3Toℕ-A4-inv') && names.includes('φ-respects'), names.join(','))

    const noDecl = dag.postulateGate(ws, mod, undefined)
    ok('未声明 postulate → 拒收', typeof noDecl === 'string' && noDecl.includes('未声明种类'), String(noDecl).slice(0, 80))
    const gap = dag.postulateGate(ws, mod, [{ name: 'div3k', kind: 'gap' }])
    ok('声明为 gap → 拒收（真缺口不能 proven）', typeof gap === 'string' && gap.includes('真缺口'), String(gap).slice(0, 80))
    const partial = dag.postulateGate(ws, mod, [{ name: 'div3k', kind: 'rewrite' }])
    ok('只声明一部分 → 仍拒收', typeof partial === 'string', String(partial).slice(0, 60))
    // 声明齐全但 rewrite 无源码依据 → 仍拒收（见下方「自封 rewrite」用例）
    // 源码核对：声明为 rewrite 必须有 `{-# REWRITE name #-}` 指令（不许自封豁免）
    const backed = dag.rewritePostulateNames(readFileSync(join(ws, 'src', 'Sovereign', 'T6Like.agda'), 'utf8'))
    ok('rewritePostulateNames 只认有没有 REWRITE 指令', backed.size === 0, [...backed].join(','))
    const selfGranted = dag.postulateGate(ws, mod, [
      { name: 'div3k', kind: 'rewrite', reason: '我说是就是' },
      { name: 'mod3k', kind: 'rewrite', reason: '同上' },
      { name: 'gf3Toℕ-A4-inv', kind: 'rewrite', reason: '同上' },
      { name: 'φ-respects', kind: 'unreachable', reason: '已知无害' },
    ])
    ok('自封 rewrite（源码无指令）→ 拒收', typeof selfGranted === 'string' && selfGranted.includes('REWRITE'), String(selfGranted).slice(0, 90))
    // 补上 REWRITE 指令后放行
    writeFileSync(
      join(ws, 'src', 'Sovereign', 'T6Like.agda'),
      'module Sovereign.T6Like where\n\npostulate\n  div3k : Set\n  mod3k : Set\n  gf3Toℕ-A4-inv : Set\n  φ-respects : Set\n\n{-# REWRITE div3k #-}\n{-# REWRITE mod3k #-}\n{-# REWRITE gf3Toℕ-A4-inv #-}\n',
    )
    const backedNow = dag.rewritePostulateNames(readFileSync(join(ws, 'src', 'Sovereign', 'T6Like.agda'), 'utf8'))
    ok('加上 REWRITE 指令后被认到', backedNow.size === 3, [...backedNow].join(','))
    ok('有源码依据的 rewrite 声明 → 放行', dag.postulateGate(ws, mod, [
      { name: 'div3k', kind: 'rewrite' },
      { name: 'mod3k', kind: 'rewrite' },
      { name: 'gf3Toℕ-A4-inv', kind: 'rewrite' },
      { name: 'φ-respects', kind: 'unreachable' },
    ]) === null)
    ok('normalizePostulates 拒绝非法 kind', (() => {
      try {
        dag.normalizePostulates([{ name: 'x', kind: 'bogus' }])
        return false
      } catch {
        return true
      }
    })())
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ── 4) check 输出：版本戳 / postulate 分类 / 草稿文件 ──────────────────────
{
  const ws = mkdtempSync(join(tmpdir(), 'math-proof-check-'))
  try {
    mkdirSync(join(ws, 'src'), { recursive: true })
    writeFileSync(join(ws, 'src', '_ProbeX.agda'), 'module _ProbeX where\n')
    const out = await dag.runDag(ws, { action: 'check' }, null, null)
    ok('check 输出带规则集戳（历史也带，便于按规则集切开）', /规则集: `r\d+\/[0-9a-f]+`/.test(out), out.split('\n').filter((l) => l.includes('规则集')).join('|'))
    ok('check 报 postulate 分类行', out.includes('postulate 分类'))
    ok('check 报 postulate 豁免裁决行', out.includes('postulate 豁免裁决'))
    ok('check 报草稿/探针文件', out.includes('工作区草稿/探针文件') && out.includes('_ProbeX.agda'), out.split('\n').filter((l) => l.includes('草稿')).join('|'))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ── 5) doctor 自证 ─────────────────────────────────────────────────────────
{
  const ws = mkdtempSync(join(tmpdir(), 'math-proof-doctor-'))
  try {
    const out = await dag.runDag(ws, { action: 'doctor' }, null, null)
    ok('doctor 退出并可读', typeof out === 'string' && out.includes('doctor'))
    ok('doctor 报插件本体哈希（本实例 vs 磁盘）', /插件本体.*本实例 \*\*[0-9a-f]{8}\*\* \/ 磁盘 \*\*[0-9a-f]{8}\*\*/.test(out), out.split('\n')[2] ?? '')
    ok('doctor 报规则集版本', /判定规则.*\*\*r\d+\/[0-9a-f]+\*\*/.test(out), out.split('\n')[3] ?? '')
    ok('doctor 报台账路径与状态目录', out.includes('台账:') && out.includes('state/math-proof'))
    ok('doctor 明确「一致/落后」结论', out.includes('✅ 一致') || out.includes('⚠ **落后于磁盘**'))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ── 6) 结果级分诊（堆爆 / 被杀 / 超时）────────────────────────────────────
{
  const heap = engine.triageResult({ exitCode: 251, stdout: { text: 'Heap exhausted; current heap size 8G' }, stderr: { text: '' } }, 'Heap exhausted')
  ok('堆爆 → abstract-体 处方（**不是**字面量界归因）', heap?.limit === 'agda-abstract-body-729-unfold', JSON.stringify(heap))
  ok('处方指出修法：定义与体一起封进 abstract 块', /abstract/.test(heap?.prescription ?? ''))
  ok('处方明确「抬 +RTS -M 是歧路」', /歧路/.test(heap?.prescription ?? ''))
  ok('每条处方带「不是这条」的反例（防过度归因）', typeof heap?.notThis === 'string' && heap.notThis.length > 10, String(heap?.notThis).slice(0, 40))
  // 「stdlib 接口重建」只在**没有诊断行**时才算（否则普通类型错误会被归因成环境问题）
  const stdlibOut = { exitCode: 1, stdout: { text: 'Checking Data.List.Properties' }, stderr: { text: '' } }
  ok('stdlib 重建规则：无诊断行时触发', engine.triageResult(stdlibOut, 'Checking Data.List.Properties')?.limit === 'sandbox-stdlib-write')
  ok('stdlib 重建规则：有诊断行时不触发', engine.triageResult(stdlibOut, 'Checking Data.List.Properties', undefined, { hasDiagnostics: true }) === null)
  const killed = engine.triageResult({ exitCode: -1, stdout: { text: 'Killed' }, stderr: { text: '' } }, 'Killed')
  ok('被杀 → oom 处方', killed?.limit === 'agda-oom-killed', JSON.stringify(killed))
  const to = engine.triageResult({ exitCode: null, timedOut: true, stdout: { text: '' }, stderr: { text: '' } }, '')
  ok('超时 → timeout 处方', to?.limit === 'agda-timeout', JSON.stringify(to))
  const fine = engine.triageResult({ exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } }, 'ok')
  ok('成功 → 无处方', fine === null)
  // 历史/趋势：跨规则集不可比（真事故：旧规则 85 分被记成「回退」）
  ok(
    'trendLine 跨规则集标记不可比',
    /跨规则集不可比/.test(dag.trendLine([{ score: 100, ruleset: 'r4/aaa' }, { score: 85, ruleset: 'r5/bbb' }])),
    dag.trendLine([{ score: 100, ruleset: 'r4/aaa' }, { score: 85, ruleset: 'r5/bbb' }]),
  )
  ok('trendLine 同规则集仍报趋势', /→/.test(dag.trendLine([{ score: 90, ruleset: 'r5/bbb' }, { score: 85, ruleset: 'r5/bbb' }])))
  ok('rulesetChangedSinceLastRun 能识别切换', dag.rulesetChangedSinceLastRun([{ score: 100, ruleset: 'r4/aaa' }], 'r6/ccc')?.from === 'r4/aaa')
  ok('rulesetChangedSinceLastRun 同版返回 null', dag.rulesetChangedSinceLastRun([{ score: 100, ruleset: 'r6/ccc' }], 'r6/ccc') === null)
  // 旧记录（本字段是后加的）也要判为不可比，但原因是「legacy」而不是某个版本号
  const legacy = dag.rulesetChangedSinceLastRun([{ score: 85 }], 'r6/ccc')
  ok('无规则集戳的旧记录 → 标 legacy 不可比', legacy?.legacy === true && /legacy/.test(legacy.from), JSON.stringify(legacy))
  ok('trendLine 对 legacy 记录也报不可比', /跨规则集不可比/.test(dag.trendLine([{ score: 100 }, { score: 85, ruleset: 'r6/ccc' }])))
  // 热表可覆盖：传自定义表
  const custom = engine.triageResult({ exitCode: 1, stdout: { text: 'zzz' }, stderr: { text: '' } }, 'zzz', [{ test: /zzz/, limit: 'custom', prescription: 'x' }])
  ok('分诊表可被热表覆盖', custom?.limit === 'custom')
}

// ── 7) 文档一致性：纪律段必须指向新增的 reference ──────────────────────────
{
  const disc = readFileSync(join(PRESET, 'impl', 'discipline.md'), 'utf8')
  ok('纪律段给出三判据一节', disc.includes('陈述层自检') && disc.includes('postulate 口径'))
  ok('纪律段指向事故复盘 reference', disc.includes('bounded-instantiation-and-postulates.md'))
  const skill = readFileSync(join(PRESET, 'skills', 'agda-proof-engine', 'SKILL.md'), 'utf8')
  ok('技能索引指向同一 reference', skill.includes('bounded-instantiation-and-postulates.md'))
  ok('纪律段要求引用分数带版本戳', disc.includes('版本戳') && disc.includes('doctor'))
  // lint 门禁存在（插件 schema 变化最容易炸）
  const lint = spawnSync(process.execPath, [join(PRESET, 'scripts', 'lint-schemas.mjs')], { encoding: 'utf8' })
  ok('schema 自检通过', lint.status === 0 && (lint.stdout ?? '').includes('SCHEMA_LINT_OK'), (lint.stdout ?? '').slice(-120))
}

console.log('# 判定规则 / 工具自证 / postulate 门禁 回归\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'RULESET_OK' : 'RULESET_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
