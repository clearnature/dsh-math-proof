// 数学证明模式 — **预算与流量账本**回归（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/budget-check.mjs
// 期望最后一行：BUDGET_OK n/n
//
// 为什么单独立一套门禁：预算会**拦住工具调用**（`exit 2`）。这类「会挡人干活」的机制
// 一旦判定写错，用户看到的是「莫名其妙的拦截」，而且很难归因。所以这里把三件事钉死：
//   1. **规则表自洽**：阈值顺序、白名单与取证集不相交、分类正则可编译、夹紧区间合理；
//   2. **判定与纯函数行为**：软/硬刹车、原地打转、拦次数上限、warn 模式不拦、
//      「加只在撞墙、减只在有证据」、样本不足不动、夹紧不被突破、还债；
//   3. **投递契约**：Stop 钩子不能指望 `additionalContext` 被注入（官方桥不支持）——
//      静态断言 stop-reminder 已删除、budget-settle 不写 stdout、三个有效投递点都挂了钩子。
//
// 全程用 `MATH_PROOF_STATE_DIR` 指向临时目录——**绝不许碰用户的真实预算账本**。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as zlib from 'node:zlib'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const FIXTURE = join(HERE, 'fixtures', 'session-basic.jsonl')

const STATE = mkdtempSync(join(tmpdir(), 'math-proof-budget-state-'))
process.env.MATH_PROOF_STATE_DIR = STATE
const SESSIONS = mkdtempSync(join(tmpdir(), 'math-proof-budget-logs-'))
process.env.MATH_PROOF_SESSIONS_ROOT = SESSIONS

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${String(detail).slice(0, 160)}`}`)
  if (!cond) failures++
}
const section = (t) => results.push(`\n## ${t}`)
/** 跳过（老 Node 没有 zstd）：记为 ⏭ 而不是失败——但**必须如实说清为什么跳过**。 */
let skips = 0
const skip = (name, why) => {
  results.push(`⏭ ${name} — SKIP：${why}`)
  skips++
}

const ruleset = await import(join(PRESET, 'impl', 'ruleset.mjs'))
const traffic = await import(join(PRESET, 'impl', 'session-traffic.mjs'))
const policy = await import(join(PRESET, 'impl', 'budget-policy.mjs'))
const budgetPlugin = await import(join(PRESET, 'plugins', 'budget.mjs'))
const carry = await import(join(PRESET, 'hooks', 'carryover.mjs'))
const { BUDGET } = ruleset

const runHook = (file, payload, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [join(PRESET, 'hooks', file)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, MATH_PROOF_STATE_DIR: STATE, ...extraEnv },
  })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}
const resetState = () => {
  for (const f of readdirSync(STATE)) rmSync(join(STATE, f), { recursive: true, force: true })
}

// ── 1) 规则表自洽 ──────────────────────────────────────────────────────────
section('规则表（BUDGET / RECEIPT）')
{
  ok('BUDGET.adjust 是 (0,1) 的步长', BUDGET.adjust > 0 && BUDGET.adjust < 1, String(BUDGET.adjust))
  ok('夹紧区间 min < 1 < max（否则预算无法覆盖中位数）', BUDGET.clamp.min < 1 && BUDGET.clamp.max > 1, JSON.stringify(BUDGET.clamp))
  ok('阈值顺序 warnAt < softAt < hardAt', BUDGET.warnAt < BUDGET.softAt && BUDGET.softAt < BUDGET.hardAt, `${BUDGET.warnAt}/${BUDGET.softAt}/${BUDGET.hardAt}`)
  ok('白名单与取证集**不相交**（收尾路径绝不能被自己掐断）', BUDGET.allowlist.every((t) => !BUDGET.evidenceTools.includes(t)), BUDGET.allowlist.filter((t) => BUDGET.evidenceTools.includes(t)).join(','))
  ok('白名单含 budget / proof_dag（记账与收尾的入口）', BUDGET.allowlist.includes('budget') && BUDGET.allowlist.includes('proof_dag'))
  ok('minSamples ≥ 2（样本太少不许自适应）', BUDGET.minSamples >= 2, String(BUDGET.minSamples))
  ok('historyMax 有界（状态文件不许无限增长）', BUDGET.historyMax > 0 && BUDGET.historyMax <= 5000, String(BUDGET.historyMax))
  const ids = BUDGET.classes.map((c) => c.id)
  ok('分类 id 唯一', new Set(ids).size === ids.length, ids.join(','))
  ok('每个类的正则都能编译', BUDGET.classes.every((c) => c.match === '' || (() => { try { new RegExp(c.match, 'i'); return true } catch { return false } })()))
  ok('每个类都有正整数先验预算', BUDGET.classes.every((c) => Number.isInteger(c.calls) && c.calls > 0), BUDGET.classes.map((c) => `${c.id}:${c.calls}`).join(' '))
  ok('defaultClass / longDefaultClass 都在表里', ids.includes(BUDGET.defaultClass) && ids.includes(BUDGET.longDefaultClass), `${BUDGET.defaultClass}/${BUDGET.longDefaultClass}`)
  ok('topup 参数合理（限次 ≥1、理由 ≥10 字、还债比例 (0,1)）', BUDGET.topup.maxPerTask >= 1 && BUDGET.topup.minReasonChars >= 10 && BUDGET.topup.debtRepayRatio > 0 && BUDGET.topup.debtRepayRatio < 1)
  ok('墙钟上限存在且为正（default）', BUDGET.wallMs.default > 0, String(BUDGET.wallMs.default))
  ok('RECEIPT 不收低信号标记 `exit 0`（否则人人都有证据 = 门禁失效）', !ruleset.RECEIPT.patterns.includes('exit 0') && !ruleset.RECEIPT.patterns.includes('exit=0'))
  ok('RECEIPT 收签发形态 `回执: \\``、不收未签发形态', ruleset.RECEIPT.patterns.includes('回执: `'))
  ok('RECEIPT.dirs 指向 receipts / oracle-receipts', ruleset.RECEIPT.dirs.includes('receipts') && ruleset.RECEIPT.dirs.includes('oracle-receipts'))
  ok('规则集版本已 bump（新增 BUDGET 表 → r8 起）', Number(String(ruleset.RULESET_VERSION).slice(1)) >= 8, ruleset.RULESET_VERSION)
  const src = readFileSync(join(PRESET, 'impl', 'session-traffic.mjs'), 'utf8')
  ok('流量模块零外部依赖（只 node: 与 ./ruleset.mjs）', !/from '(?!node:|\.\/ruleset\.mjs)/.test(src))
  // 2026-09-10 CI（Node 20）真实事故：`import { zstdDecompressSync } from 'node:zlib'` 在 Node 20 上
  // 是**链接期** SyntaxError → `plugins/budget.mjs` 整个挂不上、第 7 个工具不注册。
  // 剥注释再查：注释里**故意**引用了那种写法作为文档（与 ruleset-check 同一手法）
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')
  const codeSrc = stripComments(src)
  ok('不许命名导入 zstd（Node 20 上会链接期炸掉整个插件）', !/import\s*\{[^}]*zstd/i.test(codeSrc), (codeSrc.match(/import[^\n]*zstd[^\n]*/i) ?? [''])[0])
  ok('zstd 能力是运行时探测的（ZSTD_SUPPORTED）', /export const ZSTD_SUPPORTED/.test(src) && /typeof zlib\.zstdDecompressSync === 'function'/.test(src))
  const pluginSrc = readFileSync(join(PRESET, 'plugins', 'budget.mjs'), 'utf8')
  ok(
    'budget 插件不直接碰 zstd（只用 impl 层的 ZSTD_SUPPORTED 报告能力）',
    !/from 'node:zlib'/.test(pluginSrc) && !/zstdCompress|zstdDecompress/.test(pluginSrc) && /ZSTD_SUPPORTED/.test(pluginSrc),
    (pluginSrc.match(/import[^\n]*zlib[^\n]*/) ?? [''])[0],
  )
  ok('预算策略模块零外部依赖', !/from '(?!node:|\.\/ruleset\.mjs|\.\/session-traffic\.mjs)/.test(readFileSync(join(PRESET, 'impl', 'budget-policy.mjs'), 'utf8')))
}

// ── 2) 计量（fixture 折叠 / zstd 多帧 / 尾读）──────────────────────────────
section('计量（session-traffic）')
{
  const { header, turns } = traffic.foldSession(FIXTURE)
  ok('读出头（id / preset）', header?.id === 'fixture-session' && header?.agentPreset === 'math-proof', JSON.stringify(header))
  ok('折出 3 个回合', turns.length === 3, String(turns.length))
  const [t1, t2, t3] = turns
  ok('turn1：2 步 / tok 320 / 1 次调用 / completed', t1.steps === 2 && t1.tok === 320 && t1.toolCalls === 1 && t1.reason === 'completed' && t1.open === false, JSON.stringify({ s: t1.steps, tok: t1.tok, c: t1.toolCalls, r: t1.reason }))
  ok('turn1：tok = input+cacheRead+output', t1.tok === t1.inTok + t1.cacheTok + t1.outTok, `${t1.inTok}+${t1.cacheTok}+${t1.outTok}`)
  ok('turn1：命中回执标记（CHECK_ALL_OK）', t1.receipts.includes('CHECK_ALL_OK'), t1.receipts.join(','))
  ok('turn1：人类提示词被归到该回合', t1.prompt === null || typeof t1.prompt === 'string')
  ok('turn2：aborted + 1 次 deny + 重复调用 3 次', t2.reason === 'aborted' && t2.denies === 1 && t2.repeatMax === 3, JSON.stringify({ r: t2.reason, d: t2.denies, rep: t2.repeatMax }))
  ok('turn3：未闭合（open）且缺 turn/end', t3.open === true && t3.reason === null)
  ok('turn3：**缺 assistant/message** 时回退到 chunk 求和（400+20）', t3.tok === 420 && t3.steps === 1, JSON.stringify({ tok: t3.tok, steps: t3.steps }))

  // zstd 多帧：把 fixture 切成 3 段各自压成独立帧再拼接（模拟官方持久化的容器）
  // Node < 22.15 没有 `node:zlib` 的 zstd → 这些断言 SKIP（模块本身必须仍能加载，见下）
  const zstd = typeof zlib.zstdCompressSync === 'function' ? zlib : null
  const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l !== '')
  const chunkSize = Math.ceil(lines.length / 3)
  const frames = []
  if (zstd !== null) {
    for (let i = 0; i < lines.length; i += chunkSize) frames.push(zstd.zstdCompressSync(Buffer.from(`${lines.slice(i, i + chunkSize).join('\n')}\n`, 'utf8')))
  }
  const zpath = join(SESSIONS, 'multi-frame.jsonl.zstd')
  if (zstd !== null) writeFileSync(zpath, Buffer.concat(frames))
  // 没有 zstd 时也要写一个「像 zstd 的文件」（magic + 垃圾），好让降级断言走**真分支**
  // （否则 !existsSync 会先短路，测不到「有 magic 但解不了」这条路）
  else writeFileSync(zpath, Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.alloc(64, 7)]))
  if (zstd === null) {
    skip('zstd 多帧 / 尾读 / 尾部撕裂 6 条断言', `本机 Node ${process.version} 的 node:zlib 没有 zstd（需要 ≥22.15）；模块已降级为「读不了压缩日志」而不是崩溃`)
    ok('缺 zstd 时 foldSession 仍返回 0 回合（不抛）', traffic.foldSession(zpath).turns.length === 0)
    ok('缺 zstd 时 foldLastTurn 标记 truncated 而不是假装有数据', traffic.foldLastTurn(zpath).truncated === true)
  } else {
    const zf = traffic.foldSession(zpath)
    ok('zstd 多帧：帧数=3 且结构扫描认得', traffic.scanZstdFrames(readFileSync(zpath)).frames.length === 3, String(traffic.scanZstdFrames(readFileSync(zpath)).frames.length))
    ok('zstd 多帧：折叠结果与明文一致', JSON.stringify(zf.turns.map((t) => [t.turn, t.steps, t.tok])) === JSON.stringify(turns.map((t) => [t.turn, t.steps, t.tok])), JSON.stringify(zf.turns.map((t) => [t.turn, t.steps, t.tok])))
    const tail = traffic.foldLastTurn(zpath)
    ok('foldLastTurn 只留最后一个回合且与全读一致', tail.turns.length === 1 && tail.turns[0].tok === 420 && tail.truncated === false, JSON.stringify(tail.turns.map((t) => t.tok)))
    const win = traffic.foldSessionWindow(zpath, { fromTurn: 2 })
    ok('foldSessionWindow(fromTurn=2) 与全读的 turn2 一致', win.turns[0]?.turn === 2 && win.turns[0]?.tok === 900 && win.truncated === false, JSON.stringify(win.turns.map((t) => [t.turn, t.tok])))

    // 尾部撕裂：截掉最后一帧的一半（模拟正在写入的日志）
    const all = readFileSync(zpath)
    const torn = join(SESSIONS, 'torn.jsonl.zstd')
    writeFileSync(torn, all.subarray(0, all.length - Math.floor(frames[2].length / 2)))
    const tornFold = traffic.foldSession(torn)
    ok('尾部半帧：不抛异常，且前面两个回合完整可读', tornFold.turns.length >= 2 && tornFold.turns[0].tok === 320, `${tornFold.turns.length} 个回合`)
    const scan = traffic.scanZstdFrames(readFileSync(torn))
    ok('尾部半帧：扫描器标出 tornStart 而不是报错', scan.frames.length === 2 && typeof scan.tornStart === 'number', JSON.stringify({ n: scan.frames.length, torn: scan.tornStart }))
  }
  ok('缺文件：返回 0 个回合（不抛）', traffic.foldSession(join(SESSIONS, 'nope.jsonl')).turns.length === 0)

  // 统计与分类
  ok('median：空数组 → null', traffic.median([]) === null)
  ok('median：偶数个取中间两个平均', traffic.median([1, 2, 3, 4]) === 2.5)
  ok('percentile：p90 取最近邻（样本少时不插值）', traffic.percentile([1, 2, 3], 0.9) === 3, String(traffic.percentile([1, 2, 3], 0.9)))
  const cls = [
    ['修一下这个编译错误', 'compile'],
    ['帮我证一下这个引理', 'proof'],
    ['为什么这里会 OOM', 'diagnose'],
    ['更新 README 文档', 'docs'],
    ['实现全新的批量导入', 'build'],
    ['好', 'chat'],
  ]
  for (const [text, want] of cls) ok(`classifyTask(${JSON.stringify(text)}) → ${want}`, traffic.classifyTask(text) === want, traffic.classifyTask(text))
  ok('长提示词且无关键词 → 兜底到 longDefaultClass', traffic.classifyTask('嗯'.repeat(BUDGET.longPromptChars + 1)) === BUDGET.longDefaultClass)
  ok('同一「工具+参数」指纹稳定', traffic.callFingerprint('read', '{"file":"a"}') === traffic.callFingerprint('read', '{"file":"a"}'))
  ok('不同参数指纹不同', traffic.callFingerprint('read', '{"file":"a"}') !== traffic.callFingerprint('read', '{"file":"b"}'))
}

// ── 3) 开局与公告 ─────────────────────────────────────────────────────────
section('开局（startTurn / 公告）')
{
  resetState()
  const started = policy.startTurn({ sessionId: 'sess-a', transcript: FIXTURE, cwd: '/w', prompt: '帮我证一下这个引理' })
  ok('分类落在 proof', started.state.class === 'proof', started.state.class)
  ok('公告含预算数字与「工具调用次数」口径', started.text.includes(String(started.state.budget)) && started.text.includes('工具调用'), started.text.slice(0, 60))
  ok('公告明写「被拦不是失败」的收尾路径', started.text.includes('不是失败') && started.text.includes('未完成项'))
  ok('公告给出 topup 申请方式与记债比例', started.text.includes('topup') && started.text.includes('记债'))
  ok('公告标明先验/实测（不假装标定）', started.text.includes('先验') || started.text.includes('中位'))
  ok('回合号从 1 开始并写盘', started.state.turn === 1 && existsSync(traffic.turnStatePath('sess-a')))
  const again = policy.startTurn({ sessionId: 'sess-a', transcript: FIXTURE, cwd: '/w', prompt: '再证一个' })
  ok('同会话再来一次 → 回合号递增、计数归零', again.state.turn === 2 && again.state.used === 0, `${again.state.turn}/${again.state.used}`)
  ok('显式指定分类时标注 classSource=declared', policy.startTurn({ sessionId: 'sess-b', transcript: FIXTURE, cwd: '/w', prompt: 'x', classId: 'docs' }).state.classSource === 'declared')

  const off = policy.startTurn({ sessionId: 'sess-c', transcript: FIXTURE, cwd: '/w', prompt: 'x' }, )
  void off
  process.env.MATH_PROOF_BUDGET = 'off'
  const offNow = policy.startTurn({ sessionId: 'sess-d', transcript: FIXTURE, cwd: '/w', prompt: '帮我证一下这个引理' })
  ok('MATH_PROOF_BUDGET=off → 不公告、模式 off', offNow.text === '' && offNow.mode === 'off', JSON.stringify({ mode: offNow.mode, len: offNow.text.length }))
  delete process.env.MATH_PROOF_BUDGET
  process.env.MATH_PROOF_BUDGET = 'warn'
  const warn = policy.startTurn({ sessionId: 'sess-e', transcript: FIXTURE, cwd: '/w', prompt: '帮我证一下这个引理' })
  ok('MATH_PROOF_BUDGET=warn → warn 模式且公告注明', warn.mode === 'warn' && warn.text.includes('warn'), warn.mode)
  delete process.env.MATH_PROOF_BUDGET
}

// ── 4) 拦截判定（纯函数）──────────────────────────────────────────────────
section('拦截判定（gateDecision）')
{
  const mk = (over = {}) => ({ session: 'g', turn: 1, class: 'build', budget: 10, granted: 0, used: 0, denied: 0, budgetDenied: 0, repeat: {}, repeatDenied: 0, startedAt: 1000, ...over })
  const gate = (state, tool, toolInput = {}, mode = 'brake', extra = {}) => policy.gateDecision({ state, mode, toolName: tool, toolInput, now: state.startedAt + 1000, ...extra })

  let st = mk()
  let d = gate(st, 'read', { file: 'a' })
  ok('预算充足 → 放行、计数 +1', d.action === 'allow' && d.state.used === 1, JSON.stringify({ a: d.action, u: d.state.used }))
  ok('白名单工具被识别', policy.isAllowlisted('proof_dag') && !policy.isAllowlisted('bash'))
  ok('取证类工具被识别', policy.isEvidenceTool('read') && policy.isEvidenceTool('bash') && !policy.isEvidenceTool('edit'))

  st = mk({ used: 10 }) // 10/10 = 1.0× > softAt
  d = gate(st, 'read', { file: 'x' })
  ok('软线（1.0×）拦取证类', d.action === 'deny' && d.kind === 'soft', JSON.stringify({ a: d.action, k: d.kind }))
  ok('软线理由里有数字与收尾三步', /11\/10|10\/10/.test(d.reason) && d.reason.includes('journal') && d.reason.includes('topup'), d.reason.split('\n')[0])
  st = mk({ used: 10 })
  ok('软线**不**拦 edit/write（让人把活干完）', gate(st, 'edit', { file: 'a' }).action === 'allow')
  st = mk({ used: 10 })
  ok('软线不拦白名单（proof_dag）', gate(st, 'proof_dag', { action: 'journal' }).action === 'allow')

  st = mk({ used: 13 }) // 1.3× → 硬线判定是 > hardAt，故用 14
  st = mk({ used: 14 })
  d = gate(st, 'edit', { file: 'a' })
  ok('硬线（>1.3×）连 edit 也拦', d.action === 'deny' && d.kind === 'hard', JSON.stringify({ a: d.action, k: d.kind }))
  st = mk({ used: 14 })
  ok('硬线仍放行白名单（收尾入口不许被掐）', gate(st, 'proof_oracle', { action: 'run' }).action === 'allow')

  st = mk({ used: 10, budgetDenied: 3 })
  ok('一个回合最多拦 3 次，之后放行（拦多了本身就是流量）', gate(st, 'read', { file: 'q' }).action === 'allow')

  st = mk()
  const args = { command: 'ls' }
  const kinds = []
  for (let i = 0; i < 8; i++) kinds.push(gate(st, 'bash', args).kind)
  ok('原地打转：前 3 次放行、第 4 次起拦（repeat）', kinds[2] === 'pass' && kinds[3] === 'repeat' && kinds[4] === 'repeat', kinds.join(','))
  ok('原地打转最多拦 3 次（拦多了本身就是流量），之后放行', kinds[5] === 'repeat' && kinds.slice(6).every((k) => k === 'pass'), kinds.join(','))
  st = mk()
  const kinds2 = []
  for (let i = 0; i < 4; i++) kinds2.push(gate(st, 'todo_write', { items: [] }).kind)
  ok('todo_write 豁免打转判定（本来就会重复调）', kinds2.every((k) => k === 'pass'), kinds2.join(','))
  st = mk()
  for (let i = 0; i < 4; i++) gate(st, 'bash', args)
  ok('打转命中次数被记录（repeatDenied）', st.repeatDenied === 1, String(st.repeatDenied))

  st = mk({ used: 99 })
  ok('warn 模式永不拦（只记账）', gate(st, 'read', {}, 'warn').action === 'allow')
  st = mk({ used: 1, startedAt: 0 })
  d = policy.gateDecision({ state: st, mode: 'brake', toolName: 'read', toolInput: {}, now: 10 * 60 * 1000, wallLimitMs: 1000 })
  ok('墙钟到点 → 按硬线拦（wall）', d.action === 'deny' && d.kind === 'wall', JSON.stringify({ a: d.action, k: d.kind }))
  ok('无回合状态 → 直接放行（钩子没开局就不介入）', policy.gateDecision({ state: null, toolName: 'bash' }).action === 'allow')
  ok('重复指纹表有界（超过 400 个键会被裁剪）', (() => { const s = mk(); for (let i = 0; i < 430; i++) gate(s, 'read', { i }); return Object.keys(s.repeat).length <= 300 })())
}

// ── 5) 过程播报 ───────────────────────────────────────────────────────────
section('过程播报（shouldTick / tickText）')
{
  const st = { class: 'build', budget: 10, granted: 0, used: 1, startedAt: Date.now(), tickAt: 0, warned: false }
  ok('未到 tickEvery 且未过提醒线 → 不播报', policy.shouldTick(st, 'brake') === false, String(st.used))
  st.used = BUDGET.tickEvery
  ok('到 tickEvery → 播报', policy.shouldTick(st, 'brake') === true)
  const txt = policy.tickText({ state: st, mode: 'brake', live: { tok: 6_600_000, steps: 16, repeatMax: 2, baselineTok: 6_600_000 } })
  ok('播报含已用/预算、tok、墙钟', txt.includes(`/${10}`) && txt.includes('6.60M') && txt.includes('min'), txt.slice(0, 80))
  ok('播报是**一行**（不塞多行上下文）', !txt.includes('\n'), JSON.stringify(txt.slice(0, 40)))
  ok('播报后 tickAt 前进（不会每次都念）', st.tickAt === BUDGET.tickEvery)
  st.used = 9
  const warnText = policy.tickText({ state: st, mode: 'brake' })
  ok('跨提醒线 → 带 ⚠ 收敛提示，并置 warned', warnText.includes('⚠') && st.warned === true, warnText.slice(0, 80))
  ok('提醒只念一次（第二次返回 null）', policy.tickText({ state: st, mode: 'brake' }) === null)
  ok('off 模式不播报', policy.shouldTick({ ...st, warned: false }, 'off') === false)
  ok('fmtTok 显示 k/M', policy.fmtTok(1500) === '1.5k' && policy.fmtTok(6_600_000) === '6.60M' && policy.fmtTok(12) === '12')
}

// ── 6) 结算与自适应 ───────────────────────────────────────────────────────
section('结算与自适应（settleTurn / adjustBudget）')
{
  const mkProfile = (samples = [], budgets = {}, debt = 0) => ({ ...traffic.blankProfile(), samples, budgets, debt })
  const sample = (over = {}) => ({
    at: new Date().toISOString(), session: 's', cwd: '/w', class: 'build', calls: 20, hookUsed: 20, steps: 12, tok: 5_000_000,
    reason: 'completed', denies: 0, countable: true, receipts: { text: true, files: 0, names: [] }, outcome: 'verified', ...over,
  })
  // 先攒够样本（n ≥ minSamples）让自适应可以动手
  const enough = (cls = 'build', calls = 20) => Array.from({ length: BUDGET.minSamples }, () => sample({ class: cls, calls, outcome: 'verified' }))

  ok('结论文本区分「无证据」与「已验证」', policy.renderSettlement(sample({ outcome: 'ok-unevidenced', receipts: { text: false, files: 0, names: [] } }), { applied: false, next: 20, why: 'x' }, mkProfile()).includes('无机器证据'))

  let p = mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } })
  let a = policy.adjustBudget({ profile: p, sample: sample({ outcome: 'verified', reason: 'completed' }) })
  ok('已验证完成 → 减 10%（20→18）', a.applied === true && a.next === 18, JSON.stringify(a))
  a = policy.adjustBudget({ profile: mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } }), sample: sample({ outcome: 'wall', reason: 'aborted', denies: 2 }) })
  ok('撞墙（未完成）→ 加 10%（20→22）', a.applied === true && a.next === 22, JSON.stringify(a))
  a = policy.adjustBudget({ profile: mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } }), sample: sample({ outcome: 'wall-verified', reason: 'completed' }) })
  ok('撞墙但完成且有证据 → 不动（预算刚好卡住）', a.applied === false, JSON.stringify(a))
  a = policy.adjustBudget({ profile: mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } }), sample: sample({ outcome: 'ok-unevidenced', receipts: { text: false, files: 0, names: [] } }) })
  ok('完成但无证据 → 不动（没证据的完成不算数）', a.applied === false, JSON.stringify(a))
  a = policy.adjustBudget({ profile: mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } }), sample: sample({ outcome: 'failed', reason: 'error' }) })
  ok('失败 → 不动（不拿失败养预算）', a.applied === false, JSON.stringify(a))
  a = policy.adjustBudget({ profile: mkProfile([sample()], { build: { calls: 20, at: 'x', why: 'x' } }), sample: sample({ outcome: 'wall', reason: 'aborted' }) })
  ok('样本不足 minSamples → 只记账不动手', a.applied === false && a.why.includes('数据不足'), a.why)
  a = policy.adjustBudget({ profile: mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } }), sample: sample({ outcome: 'verified', countable: false, why: '截断' }) })
  ok('不可计数的样本 → 不动', a.applied === false && a.why.includes('不可计数'), a.why)

  // 夹紧：连续加不越上限、连续减不破下限
  {
    const samples = enough() // 中位 20 → 区间 [10, 40]
    let calls = 20
    for (let i = 0; i < 12; i++) {
      const prof = mkProfile(samples, { build: { calls, at: 'x', why: 'x' } })
      calls = policy.adjustBudget({ profile: prof, sample: sample({ outcome: 'wall', reason: 'aborted' }) }).next
    }
    ok('连续撞墙：夹在上限 2× 中位（40）', calls === 40, String(calls))
    let down = 20
    for (let i = 0; i < 12; i++) {
      const prof = mkProfile(samples, { build: { calls: down, at: 'x', why: 'x' } })
      down = policy.adjustBudget({ profile: prof, sample: sample({ outcome: 'verified' }) }).next
    }
    ok('连续完成：夹在下限 0.5× 中位（10）', down === 10, String(down))
  }

  // 还债：topup 后的第一个已验证完成要额外扣
  {
    const prof = mkProfile(enough(), { build: { calls: 20, at: 'x', why: 'x' } }, 1)
    const a2 = policy.adjustBudget({ profile: prof, sample: sample({ outcome: 'verified' }) })
    ok('有债时已验证完成 → 额外扣（20 → 16）', a2.applied === true && a2.next === 16, JSON.stringify(a2))
    ok('还债后债务减一', prof.debt === 0, String(prof.debt))
    ok('还债说明进 why', a2.why.includes('还债'), a2.why)
  }

  // 端到端：用 fixture 的 turn2（aborted + deny）结算
  {
    resetState()
    const prof = mkProfile(enough(), { build: { calls: 30, at: 'x', why: 'x' } })
    const state = { session: 'fx', turn: 7, class: 'build', budget: 30, used: 3, denied: 1, startedAt: Date.now() - 60_000, transcript: FIXTURE, cwd: '/w' }
    const r = policy.settleTurn({ profile: prof, state, fromTurn: 2 })
    ok('从日志按回合号取窗口：结算到 turn2（aborted + 1 deny）', r.sample.logTurn === 2 && r.sample.reason === 'aborted', JSON.stringify({ t: r.sample.logTurn, r: r.sample.reason }))
    ok('该回合判定为 wall（撞墙未完成）', r.outcome === 'wall', r.outcome)
    ok('样本进账（samples +1）', r.profile.samples.length === enough().length + 1, String(r.profile.samples.length))
    ok('结算播报含调用/步数/tok/基线', r.text.includes('工具调用') && r.text.includes('基线'), r.text.slice(0, 80))
  }

  // 端到端：已验证完成 → 减预算；无新回执文件 + 无回执标记 → 不减
  {
    resetState()
    const prof = mkProfile(enough('chat', 12), { chat: { calls: 10, at: 'x', why: 'x' } })
    const state = { session: 'fx2', turn: 3, class: 'chat', budget: 10, used: 1, denied: 0, startedAt: Date.now() - 30_000, transcript: FIXTURE, cwd: '/w' }
    const r = policy.settleTurn({ profile: prof, state, fromTurn: 1 })
    ok('turn1（completed + CHECK_ALL_OK）→ verified', r.outcome === 'verified', r.outcome)
    ok('verified → chat 类预算 10 → 9（中位 12，下限 6 不挡）', r.adjustment.applied === true && r.adjustment.next === 9, JSON.stringify(r.adjustment))
  }

  // 未闭合 → pending，且不调整
  {
    resetState()
    const prof = mkProfile(enough('chat', 12), { chat: { calls: 10, at: 'x', why: 'x' } })
    const state = { session: 'fx3', turn: 4, class: 'chat', budget: 10, used: 1, denied: 0, startedAt: Date.now() - 5_000, transcript: FIXTURE, cwd: '/w' }
    const r = policy.settleTurn({ profile: prof, state, fromTurn: 3 })
    ok('未闭合回合 → pending（不动预算）', r.outcome === 'pending' && r.adjustment.applied === false, JSON.stringify({ o: r.outcome, a: r.adjustment.applied }))
    ok('pending 被登记（含回合号，供下轮补账）', r.profile.pending.length === 1 && r.profile.pending[0].logTurn === 3, JSON.stringify(r.profile.pending))
  }

  // 强证据：时间窗内新落盘的回执文件
  {
    resetState()
    mkdirSync(join(STATE, 'receipts'), { recursive: true })
    const startedAt = Date.now() - 10_000
    writeFileSync(join(STATE, 'receipts', 'deadbeef.json'), '{}')
    const prof = mkProfile(enough(), { build: { calls: 30, at: 'x', why: 'x' } })
    const state = { session: 'fx4', turn: 5, class: 'build', budget: 30, used: 1, denied: 0, startedAt, transcript: FIXTURE, cwd: '/w' }
    const r = policy.settleTurn({ profile: prof, state, fromTurn: 1 })
    ok('新落盘回执文件算强证据（files ≥ 1）', r.sample.receipts.files >= 1, JSON.stringify(r.sample.receipts))
    ok('强证据 + completed → verified', r.outcome === 'verified', r.outcome)
    ok('新回执文件的名字被记进样本（可追溯）', Array.isArray(r.sample.receipts.names) && r.sample.receipts.names.length >= 1, JSON.stringify(r.sample.receipts.names))
    rmSync(join(STATE, 'receipts'), { recursive: true, force: true })
  }

  // 补账：pending → reconcile
  {
    resetState()
    const prof = mkProfile(enough(), {})
    prof.pending = [{ session: 'p', hookTurn: 2, logTurn: 2, class: 'build', startedAt: Date.now() - 60_000, used: 3, denied: 1, transcript: FIXTURE, attempts: 1 }]
    traffic.saveProfile(prof)
    const rec = policy.reconcilePending({})
    ok('补账成功并清空 pending', rec.done.length === 1 && rec.done[0].outcome === 'wall' && rec.profile.pending.length === 0, JSON.stringify(rec.done))
    ok('补账带结算播报（下轮开局会念）', typeof rec.done[0].text === 'string' && rec.done[0].text.includes('结算'), String(rec.done[0].text).slice(0, 40))
  }
  {
    resetState()
    const prof = mkProfile([], {})
    prof.pending = [{ session: 'p', logTurn: undefined, class: 'build', startedAt: 1, used: 0, denied: 0, transcript: join(SESSIONS, 'missing.jsonl'), attempts: 1 }]
    traffic.saveProfile(prof)
    const rec = policy.reconcilePending({})
    ok('补不上的 pending 记 attempts 并在 3 次后丢弃', rec.done[0].outcome === 'pending-again' && rec.profile.pending[0]?.attempts === 2, JSON.stringify(rec.done))
  }
}

// ── 7) 追加预算（申请制 + 记债）────────────────────────────────────────────
section('追加预算（topup）')
{
  resetState()
  policy.startTurn({ sessionId: 'tp', transcript: FIXTURE, cwd: '/w', prompt: '帮我证一下这个引理' })
  const short = (() => { try { budgetPlugin.runBudget({ action: 'topup', reason: '继续', sessionId: 'tp', cwd: '/w' }); return null } catch (e) { return String(e.message) } })()
  ok('理由太短 → 拒收（并说清要写什么）', short !== null && short.includes('理由太短') && short.includes('关键证据'), String(short))
  const out1 = budgetPlugin.runBudget({ action: 'topup', reason: '还差 T6 模块的编译回执，拿到它就能把 Prove 状态改成 proven 并收工', sessionId: 'tp', cwd: '/w' })
  ok('理由充分 → 批准并说明加了多久', out1.includes('已批准') && out1.includes('→'), out1.split('\n')[2] ?? '')
  const st = policy.readTurn('tp')
  ok('追加写入回合状态（granted > 0、topup = 1）', st.granted > 0 && st.topup === 1, JSON.stringify({ g: st.granted, t: st.topup }))
  ok('有效预算变大', policy.effectiveCalls(st) === st.budget + st.granted, String(policy.effectiveCalls(st)))
  ok('债务 +1（下个已验证完成的任务扣回）', traffic.loadProfile().debt === 1, String(traffic.loadProfile().debt))
  const again = (() => { try { budgetPlugin.runBudget({ action: 'topup', reason: '还想再要一点预算，因为真的还没查完这个模块的全部依赖与调用点', sessionId: 'tp', cwd: '/w' }); return null } catch (e) { return String(e.message) } })()
  ok('每任务限 1 次 → 第二次拒收', again !== null && again.includes('已申请过'), String(again))
  ok('批准后 gate 用「预算+追加」算比例', policy.gateDecision({ state: { ...st, used: 1 }, mode: 'brake', toolName: 'read', toolInput: {} }).action === 'allow')
}

// ── 8) 状态文件有界与损坏恢复 ─────────────────────────────────────────────
section('状态文件（有界 / 损坏恢复）')
{
  resetState()
  const prof = traffic.blankProfile()
  prof.samples = Array.from({ length: BUDGET.historyMax + 50 }, (_, i) => ({ at: 'x', class: 'chat', calls: i, countable: true }))
  traffic.saveProfile(prof)
  const back = traffic.loadProfile()
  ok(`样本上限 ${BUDGET.historyMax} 生效（超出丢最旧）`, back.samples.length === BUDGET.historyMax && back.samples[0].calls === 50, `${back.samples.length}/${back.samples[0]?.calls}`)
  writeFileSync(traffic.profilePath(), '{ 这不是 JSON')
  const recovered = traffic.loadProfile()
  ok('账本损坏 → 备份后返回空账本（不静默丢证据）', recovered.samples.length === 0 && readdirSync(STATE).some((f) => f.includes('corrupt-')), readdirSync(STATE).join(','))
  ok('空账本有完整字段（不会被 undefined 炸）', recovered.samples.length === 0 && recovered.budgets !== undefined && recovered.pending !== undefined && recovered.enabled === true)
}

// ── 9) 信箱（Stop 的话由下轮投递）─────────────────────────────────────────
section('信箱（carryover）')
{
  const ws = '/w-carry'
  ok('投递空信箱 → 空数组', carry.takeCarry(ws).length === 0)
  carry.appendCarry(ws, { kind: 'wrapup', text: 'A' })
  carry.appendCarry(ws, { kind: 'ledger', text: 'B' })
  const got = carry.takeCarry(ws)
  ok('投递两条并按序取出', got.map((x) => x.text).join('') === 'AB', JSON.stringify(got.map((x) => x.text)))
  ok('取过一次就清空（不会每轮重复念）', carry.takeCarry(ws).length === 0)
  carry.appendCarry(ws, { kind: 'ledger', text: 'B1' })
  carry.appendCarry(ws, { kind: 'ledger', text: 'B2' })
  const dedup = carry.takeCarry(ws)
  ok('同 kind 只留最新一条（不堆积重复留言）', dedup.length === 1 && dedup[0].text === 'B2', JSON.stringify(dedup.map((x) => x.text)))
  writeFileSync(carry.carryPath(ws), '{坏')
  ok('信箱损坏 → 当空的（不抛）', carry.readCarry(ws).items.length === 0)
}

// ── 10) 钩子契约（含「Stop 不能指望投递」）────────────────────────────────
section('钩子契约')
{
  const hooksDir = join(PRESET, 'hooks')
  const cfg = JSON.parse(readFileSync(join(hooksDir, 'hooks.json'), 'utf8'))
  const names = Object.keys(cfg.hooks ?? {})
  const all = Object.values(cfg.hooks).flat().flatMap((g) => g.hooks ?? [])
  ok('hooks.json 含 5 个点（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop）', names.length === 5, names.join(','))
  for (const c of all) {
    const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([\w.-]+)/.exec(c.command)
    ok(`命令指向存在的脚本 ${m?.[1] ?? c.command.slice(0, 30)}`, m !== undefined && existsSync(join(hooksDir, m[1])), c.command)
  }
  ok('已删除 stop-reminder.mjs（Stop 的 additionalContext 不会被注入 → 那是死代码）', !existsSync(join(hooksDir, 'stop-reminder.mjs')))
  const settleSrc = readFileSync(join(hooksDir, 'budget-settle.mjs'), 'utf8')
  ok('budget-settle 不往 stdout 写 hookSpecificOutput（Stop 投不出去）', !settleSrc.includes('hookSpecificOutput'))
  ok('budget-settle 明确记下这条约束（避免以后有人又去写）', settleSrc.includes('不注入') || settleSrc.includes('没人听'))
  ok('budget-start 在 UserPromptSubmit 上投递 additionalContext', readFileSync(join(hooksDir, 'budget-start.mjs'), 'utf8').includes('hookSpecificOutput'))
  ok('budget-tick 在 PostToolUse 上投递（不拦）', readFileSync(join(hooksDir, 'budget-tick.mjs'), 'utf8').includes('PostToolUse'))
  const fable5 = readFileSync(join(hooksDir, 'fable5-flow.mjs'), 'utf8')
  ok('fable5-flow 的 Stop 分支已移除（原先那段话从没进过上下文）', !fable5.includes("name = 'Stop'") && fable5.includes("event !== 'Stop'"))
  ok('PostToolUse 已注册（否则过程播报无处投递）', names.includes('PostToolUse'))

  // 真跑一遍钩子进程（含异常路径）
  resetState()
  const ws = mkdtempSync(join(tmpdir(), 'math-proof-budget-ws-'))
  const start = runHook('budget-start.mjs', { session_id: 'h1', transcript_path: FIXTURE, cwd: ws, hook_event_name: 'UserPromptSubmit', prompt: '帮我证一下这个引理' })
  ok('budget-start：exit 0 且注入预算公告', start.code === 0 && start.out.includes('本任务预算') && start.out.includes('工具调用'), start.out.slice(0, 120))
  const gateOk = runHook('budget-gate.mjs', { session_id: 'h1', cwd: ws, hook_event_name: 'PreToolUse', tool_name: 'read', tool_input: { file: 'a' } })
  ok('budget-gate：预算充足 → exit 0 不拦', gateOk.code === 0, `${gateOk.code} ${gateOk.err.slice(0, 60)}`)
  const tick = runHook('budget-tick.mjs', { session_id: 'h1', cwd: ws, hook_event_name: 'PostToolUse', tool_name: 'read', tool_input: {}, tool_response: 'ok' })
  ok('budget-tick：未到播报点 → exit 0 且不说话', tick.code === 0 && tick.out === '', `${tick.code} ${tick.out.slice(0, 60)}`)
  // 把状态推到硬线之上再拦
  const st = policy.readTurn('h1')
  policy.writeTurn({ ...st, used: st.budget * 2 })
  const gateDeny = runHook('budget-gate.mjs', { session_id: 'h1', cwd: ws, hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'x' } })
  ok('budget-gate：越线 → exit 2 + stderr 给收尾路径', gateDeny.code === 2 && gateDeny.err.includes('budget') && gateDeny.err.includes('journal'), `${gateDeny.code} ${gateDeny.err.slice(0, 80)}`)
  const gateAllow = runHook('budget-gate.mjs', { session_id: 'h1', cwd: ws, hook_event_name: 'PreToolUse', tool_name: 'proof_dag', tool_input: { action: 'journal' } })
  ok('budget-gate：越线但白名单（proof_dag journal）仍放行', gateAllow.code === 0, String(gateAllow.code))
  const noState = runHook('budget-gate.mjs', { session_id: 'never-started', cwd: ws, hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: {} })
  ok('budget-gate：没有回合状态 → 放行（不介入别人的会话）', noState.code === 0)
  const settle = runHook('budget-settle.mjs', { session_id: 'h1', transcript_path: FIXTURE, cwd: ws, hook_event_name: 'Stop' })
  ok('budget-settle：exit 0 且**不输出任何模型可见内容**', settle.code === 0 && settle.out === '', `${settle.code} ${settle.out.slice(0, 60)}`)
  ok('budget-settle 把 fable5 收工三项写进了信箱', carry.takeCarry(ws).some((i) => i.text.includes('收工三项')))
  const bad = spawnSync(process.execPath, [join(hooksDir, 'budget-gate.mjs')], { input: 'not json', encoding: 'utf8', env: { ...process.env, MATH_PROOF_STATE_DIR: STATE } })
  ok('budget-gate：stdin 不是 JSON → 仍然 exit 0（失败放行）', bad.status === 0, String(bad.status))
  rmSync(ws, { recursive: true, force: true })
}

// ── 11) budget 工具 ───────────────────────────────────────────────────────
section('budget 工具')
{
  resetState()
  policy.startTurn({ sessionId: 'tool1', transcript: FIXTURE, cwd: '/tmp/ws-fixture', prompt: '帮我证一下这个引理' })
  const status = budgetPlugin.runBudget({ action: 'status', sessionId: 'tool1', cwd: '/tmp/ws-fixture' })
  ok('status：报模式/类/调用数/墙钟', status.includes('模式') && status.includes('本回合') && status.includes('调用'), status.slice(0, 80))
  ok('status：给出日志实测（步数/tok）', status.includes('日志实测') && status.includes('步数'), status.split('\n').find((l) => l.includes('日志实测')) ?? '')
  const report = budgetPlugin.runBudget({ action: 'report', cwd: '/tmp/ws-fixture' })
  ok('report：列出全部任务类', BUDGET.classes.every((c) => report.includes(`\`${c.id}\``)), report.slice(0, 60))
  ok('report：未标定时说明「先验」而不是假装实测', report.includes('先验') && report.includes('尚未标定'))
  const classes = budgetPlugin.runBudget({ action: 'classes' })
  ok('classes：显示判定正则与是否要回执', classes.includes('判定正则') && classes.includes('要回执'), classes.slice(0, 60))
  const explain = budgetPlugin.runBudget({ action: 'explain' })
  ok('explain：说明计量口径（工具调用次数 + tok 公式）', explain.includes('工具调用次数') && explain.includes('cacheRead'))
  ok('explain：写明 ±10% 的两种触发与「失败不动」', explain.includes('撞到预算墙') && explain.includes('已验证完成') && explain.includes('失败'))
  ok('explain：写明夹紧与记债', explain.includes('夹紧') && explain.includes('记债'))
  ok('explain：写明开关（env / 账本）', explain.includes('MATH_PROOF_BUDGET'))
  const hist = budgetPlugin.runBudget({ action: 'history' })
  ok('history：无样本时给出可执行下一步', hist.includes('还没有样本'))
  const off = budgetPlugin.runBudget({ action: 'off' })
  ok('off：切到 warn 模式（只提醒不拦）', off.includes('warn') && traffic.loadProfile().enabled === false, off.split('\n')[2] ?? '')
  ok('on：切回刹车', budgetPlugin.runBudget({ action: 'on' }).includes('brake'))
  const badAction = (() => { try { budgetPlugin.runBudget({ action: 'nope' }); return null } catch (e) { return String(e.message) } })()
  ok('未知 action → 报错并列出可选项', badAction !== null && badAction.includes('unknown action'), String(badAction))

  // calibrate：dryRun 不写盘
  mkdirSync(join(SESSIONS, 'ws1', 'sess1'), { recursive: true })
  writeFileSync(join(SESSIONS, 'ws1', 'sess1', 'session.jsonl'), readFileSync(FIXTURE))
  const before = JSON.stringify(traffic.loadProfile().budgets ?? {})
  const dry = budgetPlugin.runBudget({ action: 'calibrate', dryRun: true })
  ok('calibrate dryRun：出表但不动账本', dry.includes('dryRun') && JSON.stringify(traffic.loadProfile().budgets ?? {}) === before, dry.slice(0, 60))
  ok('calibrate：扫到 fixture 会话', dry.includes('会话日志'), dry.split('\n')[2] ?? '')
}

// ── 12) 报表脚本 ──────────────────────────────────────────────────────────
section('traffic-report 脚本')
{
  const r = spawnSync(process.execPath, [join(PRESET, 'scripts', 'traffic-report.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, MATH_PROOF_SESSIONS_ROOT: SESSIONS },
  })
  ok('能跑通并输出表头', r.status === 0 && (r.stdout ?? '').includes('单回合'), (r.stdout ?? '').slice(0, 120) || (r.stderr ?? '').slice(0, 120))
  ok('输出里带「口径」说明（中位数不是均值）', (r.stdout ?? '').includes('中位'), (r.stdout ?? '').slice(-200))
}

console.log('# 预算与流量账本回归\n')
console.log(results.join('\n'))
const passed = results.filter((r) => r.startsWith('✅')).length
const judged = results.filter((r) => /^[✅❌]/.test(r)).length
console.log(`\n${failures === 0 ? 'BUDGET_OK' : 'BUDGET_FAIL'} ${passed}/${judged}${skips > 0 ? `（另有 ${skips} 条 SKIP：本机 Node 无 zstd 支持）` : ''}`)
try {
  rmSync(STATE, { recursive: true, force: true })
  rmSync(SESSIONS, { recursive: true, force: true })
} catch {
  /* 清理失败不影响判定 */
}
process.exit(failures === 0 ? 0 : 1)
