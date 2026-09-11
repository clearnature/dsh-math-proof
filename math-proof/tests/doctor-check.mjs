// 数学证明模式 — **挂载副本体检（doctor）门禁**（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/doctor-check.mjs
// 期望最后一行：DOCTOR_CHECK_OK n/n
//
// 为什么要给 doctor 再写一套门禁：体检脚本自己**最容易变成安慰剂**——
// 它要能对真实的坏副本变红，否则「跑过了 doctor」这句话毫无价值。
// 所以这里每一条都是**先把副本弄坏、再断言 doctor 报红**（负向实测），最后再断言它没改任何东西。

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const DOCTOR = join(PRESET, 'scripts', 'doctor.mjs')

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${String(detail).slice(0, 180)}`}`)
  if (!cond) failures++
}

const run = (args, opts = {}) =>
  spawnSync(process.execPath, [opts.doctor ?? DOCTOR, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// ── 1) 正本：仓库自己这一份必须干净 ────────────────────────────────────────
{
  const r = run([])
  const last = (r.stdout ?? '').trim().split('\n').pop() ?? ''
  ok('doctor 在本 preset 上退出 0', r.status === 0, last || (r.stderr ?? '').slice(0, 160))
  ok('输出最后一行是 DOCTOR_OK', last.startsWith('DOCTOR_OK'), last)
  ok('体检项覆盖：钩子目标 / 组合引用 / 插件加载 / 技能名 / 名册元数据', /钩子目标文件存在/.test(r.stdout ?? '') && /组合引用存在/.test(r.stdout ?? '') && /插件可加载/.test(r.stdout ?? '') && /技能名与目录名一致/.test(r.stdout ?? '') && /preset.yml 有 name/.test(r.stdout ?? ''))
  ok('doctor 只读：不写 state、不生成文件（输出里没有「写入」字样）', !/写入|已生成|wrote/i.test(r.stdout ?? ''), '')
}

// ── 2) --json 可解析 ──────────────────────────────────────────────────────
{
  const r = run(['--json'])
  let parsed = null
  try {
    parsed = JSON.parse(r.stdout ?? '')
  } catch {
    /* 下面断言会报 */
  }
  ok('--json 输出可被 JSON.parse', parsed !== null && typeof parsed === 'object', (r.stdout ?? '').slice(0, 80))
  ok('--json 带 verdict / root / results', parsed?.verdict === 'DOCTOR_OK' && typeof parsed?.root === 'string' && Array.isArray(parsed?.results), JSON.stringify(parsed?.verdict))
  ok('--json 不往 stdout 混人读文本', (r.stdout ?? '').trim().startsWith('{'), (r.stdout ?? '').slice(0, 40))
}

// ── 3) 负向：把副本弄坏，doctor 必须红 ─────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'math-proof-doctor-'))
const COPY = join(TMP, 'preset')
cpSync(PRESET, COPY, { recursive: true, filter: (src) => !/[/\\](state|__pycache__|node_modules|\.git)([/\\]|$)/.test(src) })

const runCopy = (args = []) => run(['--root', COPY, ...args], { doctor: join(COPY, 'scripts', 'doctor.mjs') })
const restore = (rel) => cpSync(join(PRESET, rel), join(COPY, rel))

{
  const base = runCopy()
  ok('副本基线：干干净净时 doctor 绿', (base.stdout ?? '').trim().split('\n').pop()?.startsWith('DOCTOR_OK') === true, (base.stdout ?? '').trim().split('\n').pop() ?? '')

  // (a) 2026-09-10 真实事故：hooks.json 指向已删除的 stop-reminder.mjs
  {
    const f = join(COPY, 'hooks', 'hooks.json')
    const cfg = JSON.parse(readFileSync(f, 'utf8'))
    cfg.hooks.Stop[0].hooks[0].command = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop-reminder.mjs"'
    writeFileSync(f, JSON.stringify(cfg, null, 1))
    const r = runCopy()
    ok('复发事故：钩子指向已删除的文件 → 红', r.status === 1 && /❌ \[Stop\] 钩子目标文件存在：hooks\/stop-reminder\.mjs/.test(r.stdout ?? ''), (r.stdout ?? '').split('\n').filter((l) => l.startsWith('❌')).join('｜'))
    restore('hooks/hooks.json')
  }

  // (b) hooks.json 整体坏掉（宿主读不了 = 会话起不来）
  {
    writeFileSync(join(COPY, 'hooks', 'hooks.json'), '{ this is not json')
    const r = runCopy()
    ok('hooks.json 坏了 → 红且说得出原因', r.status === 1 && /hooks\.json 能解析/.test(r.stdout ?? ''), '')
    restore('hooks/hooks.json')
  }

  // (c) 组合引用的本地插件不存在
  {
    const f = join(COPY, 'agent.cordis.yml')
    const yml = readFileSync(f, 'utf8').replace("./plugins/budget.mjs", './plugins/budget-missing.mjs')
    writeFileSync(f, yml)
    const r = runCopy()
    ok('组合引用的插件不存在 → 红', r.status === 1 && /组合引用存在：plugins\/budget-missing\.mjs/.test(r.stdout ?? ''), '')
    restore('agent.cordis.yml')
  }

  // (d) 插件语法坏了（挂载期就是整个会话起不来）
  {
    writeFileSync(join(COPY, 'plugins', 'budget.mjs'), 'export const name = (\n')
    const r = runCopy()
    ok('插件加载不了 → 红', r.status === 1 && /插件可加载：budget\.mjs/.test(r.stdout ?? ''), '')
    restore('plugins/budget.mjs')
  }

  // (e) 技能名与目录名不一致（模型 `skill` 调用会报 unknown）
  {
    const f = join(COPY, 'skills', 'proof-engineer', 'SKILL.md')
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^name:.*$/m, 'name: proof-engineer-TYPO'))
    const r = runCopy()
    ok('技能名与目录名不一致 → 红', r.status === 1 && /技能名与目录名一致：proof-engineer/.test(r.stdout ?? ''), '')
    restore('skills/proof-engineer/SKILL.md')
  }

  // (f) 缺一个骨架目录
  {
    rmSync(join(COPY, 'impl'), { recursive: true, force: true })
    const r = runCopy()
    ok('缺骨架（impl/）→ 红', r.status === 1 && /骨架存在：impl/.test(r.stdout ?? ''), '')
    cpSync(join(PRESET, 'impl'), join(COPY, 'impl'), { recursive: true })
  }

  // 坏掉的都还原后，必须回到绿（否则说明前面的「红」是别的原因）
  {
    const r = runCopy()
    ok('逐项还原后回到绿（证明红是这些注入的）', (r.stdout ?? '').trim().split('\n').pop()?.startsWith('DOCTOR_OK') === true, (r.stdout ?? '').trim().split('\n').pop() ?? '')
  }

  // (g) --vs 漂移：副本少一个文件 → 红；--allow-drift → 只报不红
  {
    rmSync(join(COPY, 'scripts', 'traffic-report.mjs'), { force: true })
    const r = runCopy(['--vs', PRESET])
    ok('副本落后于源仓库（少文件）→ 红', r.status === 1 && /与源仓库一致/.test(r.stdout ?? '') && /漏同步 1/.test(r.stdout ?? ''), (r.stdout ?? '').split('\n').filter((l) => l.startsWith('❌')).join('｜'))
    const r2 = runCopy(['--vs', PRESET, '--allow-drift'])
    ok('--allow-drift：漂移只报不判红', r2.status === 0 && /与源仓库一致/.test(r2.stdout ?? ''), (r2.stdout ?? '').trim().split('\n').pop() ?? '')
    restore('scripts/traffic-report.mjs')
  }

  // (h) doctor 不改副本：跑完之后逐文件比对（只读承诺要能被验证）
  {
    const before = new Map()
    const walk = (base, dir = '') => {
      for (const e of readdirSync(join(base, dir), { withFileTypes: true })) {
        const rel = dir === '' ? e.name : `${dir}/${e.name}`
        if (e.isDirectory()) walk(base, rel)
        else before.set(rel, statSync(join(base, rel)).size)
      }
    }
    walk(COPY)
    runCopy()
    let changed = 0
    for (const [rel, size] of before) if (!existsSync(join(COPY, rel)) || statSync(join(COPY, rel)).size !== size) changed++
    ok('doctor 是只读的（跑完副本逐文件大小不变）', changed === 0, `变了 ${changed} 个`)
  }
}

rmSync(TMP, { recursive: true, force: true })

console.log('# 挂载副本体检（doctor）门禁\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'DOCTOR_CHECK_OK' : 'DOCTOR_CHECK_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
