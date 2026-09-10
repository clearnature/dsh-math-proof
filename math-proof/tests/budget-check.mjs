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

/** 剥注释（静态扫描用：注释里常引用反面写法作为文档）。 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

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
  ok('折出 4 个回合', turns.length === 4, String(turns.length))
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
    ok('zstd 多帧：思考强度折叠也一致', JSON.stringify(zf.turns.map((t) => [t.effortAtStart, t.effortLast])) === JSON.stringify(turns.map((t) => [t.effortAtStart, t.effortLast])), JSON.stringify(zf.turns.map((t) => [t.effortAtStart, t.effortLast])))
    const tail = traffic.foldLastTurn(zpath)
    ok('foldLastTurn 只留最后一个回合且与全读一致', tail.turns.length === 1 && tail.turns[0].tok === 500 && tail.truncated === false, JSON.stringify(tail.turns.map((t) => t.tok)))
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

// ── 4.5) 思考强度（折叠 + 调速策略 + 安全纪律）─────────────────────────────
section('思考强度（EFFORT / planEffort / govern）')
{
  const gov = await import(join(PRESET, 'plugins', 'effort-governor.mjs'))
  const { turns: fx } = traffic.foldSession(FIXTURE) // 本节的块作用域里重新折一次（上节的 turns 在别的块里）
  const L = ruleset.EFFORT.ladder
  ok('EFFORT 梯子顺序：max → high → low → off（序号越大 = 想得越少）', JSON.stringify(L) === JSON.stringify(['max', 'high', 'low', 'off']), L.join('>'))
  ok('rungs 按比例降序排列（先命中更严的那条）', ruleset.EFFORT.rungs.every((r, i, a) => i === 0 || a[i - 1].atRatio > r.atRatio), JSON.stringify(ruleset.EFFORT.rungs.map((r) => r.atRatio)))
  ok('rungs 的档位都在梯子上且都不是顶档', ruleset.EFFORT.rungs.every((r) => L.includes(r.effort) && r.effort !== L[0]), ruleset.EFFORT.rungs.map((r) => r.effort).join(','))
  ok('classDefault 的档位合法（或 null = 不干预）', Object.values(ruleset.EFFORT.classDefault).every((v) => v === null || L.includes(v)), JSON.stringify(ruleset.EFFORT.classDefault))
  ok('各档位阈值都在 (0,1] 内', ruleset.EFFORT.rungs.every((r) => r.atRatio > 0 && r.atRatio <= 1), ruleset.EFFORT.rungs.map((r) => r.atRatio).join(','))
  ok('effortRank 反映「想得多少」的方向', policy.effortRank('max') < policy.effortRank('high') && policy.effortRank('high') < policy.effortRank('low') && policy.effortRank('low') < policy.effortRank('off'))
  ok('未知档位 rank = -1', policy.effortRank('ultra') === -1 && policy.effortRank(undefined) === -1)

  const st = (over = {}) => ({ session: 'e', class: 'build', budget: 20, granted: 0, used: 0, effortOwned: false, effortBefore: null, effortSet: null, ...over })
  const plan = (used, seed, over = {}) => policy.planEffort({ state: st({ used, ...over }), seedEffort: seed })
  ok('未过线 → 不动（保持 seed）', plan(2, 'high').effort === null && plan(2, 'high').why.includes('未过线'), plan(2, 'high').why)
  ok('过 60%：high → low', plan(13, 'high').effort === 'low', JSON.stringify(plan(13, 'high')))
  ok('过 85%：high → off', plan(18, 'high').effort === 'off', JSON.stringify(plan(18, 'high')))
  ok('过 85%：max → off（跨档也能一口气降到底）', plan(18, 'max').effort === 'off', JSON.stringify(plan(18, 'max')))
  ok('**只降不升**：已经是 low，过 60% 不再动', plan(13, 'low').effort === null && plan(13, 'low').why.includes('只降不升'), plan(13, 'low').why)
  ok('**只降不升**：已经是 off，过 85% 不再动', plan(18, 'off').effort === null, plan(18, 'off').why)
  ok('看不到档位（部署没开思考/换适配器）→ 不动', plan(18, undefined).effort === null && plan(18, undefined).why.includes('看不到'), plan(18, undefined).why)
  ok('未知档位 → 不动（乱传会让适配器抛 UNSUPPORTED_REASONING_EFFORT）', plan(18, 'ultra').effort === null && plan(18, 'ultra').why.includes('未知档位'), plan(18, 'ultra').why)
  ok('没有回合状态 → 不动', policy.planEffort({ state: null, seedEffort: 'high' }).effort === null)
  ok('过线时不还原（先收敛）', plan(13, 'low', { effortOwned: true, effortBefore: 'high', effortSet: 'low' }).effort === null)
  ok('未过线且我们改过 → 还原到改之前那一档', plan(2, 'low', { effortOwned: true, effortBefore: 'high', effortSet: 'low' }).effort === 'high', JSON.stringify(plan(2, 'low', { effortOwned: true, effortBefore: 'high', effortSet: 'low' })))
  ok('未过线但我们**没**改过 → 不动（不猜用户想要哪档）', plan(2, 'low', { effortOwned: false }).effort === null)

  ok('noteEffort：首次降档记录「改之前是什么」', (() => { const s2 = st(); policy.noteEffort(s2, { effort: 'low', rung: '0.6', why: 'x' }, 'high'); return s2.effortOwned === true && s2.effortBefore === 'high' && s2.effortSet === 'low' })())
  ok('noteEffort：还原后交还所有权', (() => { const s2 = st({ effortOwned: true, effortBefore: 'high', effortSet: 'low' }); policy.noteEffort(s2, { effort: null, rung: null, why: 'x' }, 'low'); return s2.effortOwned === false && s2.effortSet === null })())
  ok('noteEffort：过线保持时不动所有权', (() => { const s2 = st({ effortOwned: true, effortBefore: 'high', effortSet: 'low' }); policy.noteEffort(s2, { effort: null, rung: '0.6', why: 'x' }, 'low'); return s2.effortOwned === true && s2.effortSet === 'low' })())

  // govern：插件层的最终防线
  const seed = { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 1000 }
  ok('govern：未过线 → **同一个对象**返回（不改配置）', gov.govern(seed, st({ used: 1 }), 'brake').config === seed)
  const changed = gov.govern(seed, st({ used: 18 }), 'brake').config
  ok('govern：过线 → 只改 reasoningEffort', changed.reasoningEffort === 'off' && changed.provider === 'p' && changed.model === 'm' && changed.maxTokens === 1000, JSON.stringify(changed))
  ok('govern：只改一个字段（键集不变）', JSON.stringify(Object.keys(changed).sort()) === JSON.stringify(Object.keys(seed).sort()), Object.keys(changed).join(','))
  ok('govern：warn 模式不调速（只记账）', gov.govern(seed, st({ used: 18 }), 'warn').config === seed)
  ok('govern：off 模式不调速', gov.govern(seed, st({ used: 18 }), 'off').config === seed)
  ok('govern：seed 没有档位 → 原样返回', gov.govern({ provider: 'p', model: 'm' }, st({ used: 18 }), 'brake').config.reasoningEffort === undefined)

  // 折叠：把 request/header 的档位按「运行值」归到回合
  ok('折叠：turn4 起始 low → 结束 off（被降档过）', fx[3].effortAtStart === 'low' && fx[3].effortLast === 'off' && fx[3].effortDowngraded === true, JSON.stringify({ a: fx[3].effortAtStart, b: fx[3].effortLast }))
  ok('折叠：turn3 记录了两次档位变化（high → low）', JSON.stringify(fx[2].efforts) === JSON.stringify(['high', 'low']), JSON.stringify(fx[2].efforts))
  ok('折叠：档位是**运行值**（早于首个 header 的回合不该拿到末尾的值）', fx[0].effortAtStart === null && fx[0].effortLast === null, JSON.stringify({ a: fx[0].effortAtStart, b: fx[0].effortLast }))
  ok('折叠：不把 request/header 整体留在回合对象里（只留 provider/model/effort 这些标量）', fx[3].header === undefined && typeof fx[3].provider === 'string' && typeof fx[3].model === 'string' && fx[3].model.length < 40, JSON.stringify({ header: fx[3].header, keys: Object.keys(fx[3]).length }))

  // 端到端：从 apply 抓监听器，用假 next 驱动一遍（本地能做到的、最接近真 harness 的验证）
  {
    resetState()
    policy.startTurn({ sessionId: 'gov1', transcript: FIXTURE, cwd: '/w', prompt: '帮我证一下这个引理' })
    policy.writeTurn({ ...policy.readTurn('gov1'), budget: 20, used: 18 })
    const listeners = []
    gov.apply({ on: (n, fn) => { listeners.push([n, fn]); return () => {} }, get: () => undefined })
    ok('apply 注册了 agent/request 监听器', listeners.length === 1 && listeners[0][0] === 'agent/request', JSON.stringify(listeners.map((l) => l[0])))
    const seed = { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 1000 }
    const got = await listeners[0][1]({ agent: { id: 'gov1' }, turn: 1, step: 1 }, async () => seed)
    ok('端到端：预算 90% 时把档位降到 off（其余字段不动）', got.reasoningEffort === 'off' && got.provider === 'p' && got.maxTokens === 1000, JSON.stringify(got))
    const after = policy.readTurn('gov1')
    ok('端到端：状态记下「我们改过 + 改之前是 high」', after.effortOwned === true && after.effortBefore === 'high' && after.effortSet === 'off', JSON.stringify({ o: after.effortOwned, b: after.effortBefore, s: after.effortSet }))
    policy.writeTurn({ ...after, used: 1 })
    const got2 = await listeners[0][1]({ agent: { id: 'gov1' } }, async () => ({ ...seed, reasoningEffort: 'off' }))
    ok('端到端：新任务未过线 → 还原到改之前那一档', got2.reasoningEffort === 'high', JSON.stringify(got2))
    let threw = null
    try {
      await listeners[0][1]({ agent: { id: 'gov1' } }, async () => { throw new Error('route failure') })
    } catch (e) {
      threw = e
    }
    ok('端到端：next() 的异常原样抛出（不吞模型路由错误）', threw !== null && threw.message === 'route failure', String(threw))
    const untouched = await listeners[0][1]({ agent: { id: 'never-started' } }, async () => seed)
    ok('端到端：没有回合状态的会话 → 配置原样返回（同一个对象）', untouched === seed)
    const noAgent = await listeners[0][1]({}, async () => seed)
    ok('端到端：payload 没有 agent → 原样返回（不猜会话）', noAgent === seed)
  }

  // 组合与依赖
  const composition = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')
  ok('组合里注册了 effort-governor 行', /name: '\.\/plugins\/effort-governor\.mjs'/.test(composition))
  const govSrc = readFileSync(join(PRESET, 'plugins', 'effort-governor.mjs'), 'utf8')
  ok('调速器零外部依赖', !/from '(?!\.\.\/impl\/)/.test(stripComments(govSrc)), (govSrc.match(/from '[^']+'/g) ?? []).join(' '))
  ok('调速器监听的是官方 agent/request 瀑布', /ctx\.on\('agent\/request'/.test(govSrc) && /await next\(\)/.test(govSrc))
  ok('调速器把 next() 的 seed 传进判定（不凭空造配置）', /const seed = await next\(\)/.test(govSrc) && /govern\(seed, state, mode\)/.test(govSrc))
  ok('调速器源码里没有自造 provider/model（只改档位）', !/provider:|model:/.test(stripComments(govSrc)))
  ok('调速器不碰 next() 的异常（不吞模型路由错误）', !/try \{\s*const seed = await next\(\)/.test(govSrc))
  ok('调速器有兜底：异常时退回原配置', /catch \{\s*\n[\s\S]{0,200}return seed/.test(govSrc))
}

// ── 4.8) 会话 token 预算（跨回合总闸）──────────────────────────────────────
section('会话 token 预算（SESSION / 总闸）')
{
  const S = ruleset.SESSION
  ok('SESSION 默认预算是「会话量级」而不是「单回合量级」（> 1e8）', S.defaultTokens >= 1e8, String(S.defaultTokens))
  ok('SESSION 提醒线 < 硬线', S.warnAt < S.hardAt, `${S.warnAt}/${S.hardAt}`)
  ok('SESSION 环境变量名可配置', typeof S.env === 'string' && S.env.startsWith('MATH_PROOF_'), S.env)
  ok('如实标注「按设计会滞后」', S.staleByDesign === true)

  ok('parseTokenAmount：1M/500M/1B/纯数字', policy.parseTokenAmount('1M') === 1e6 && policy.parseTokenAmount('500M') === 5e8 && policy.parseTokenAmount('1B') === 1e9 && policy.parseTokenAmount('250000000') === 250000000, [policy.parseTokenAmount('1M'), policy.parseTokenAmount('1B')].join(','))
  ok('parseTokenAmount：坏值一律 null（不猜）', policy.parseTokenAmount('abc') === null && policy.parseTokenAmount('0') === null && policy.parseTokenAmount('') === null && policy.parseTokenAmount(-5) === null)

  ok('无 env 无账本 → 默认值', policy.sessionBudgetTokens(null).tokens === S.defaultTokens, policy.sessionBudgetTokens(null).source)
  ok('账本可覆盖默认', policy.sessionBudgetTokens({ sessionBudget: { tokens: 123456789 } }).tokens === 123456789)
  process.env[S.env] = '1M'
  ok('env 优先于账本', policy.sessionBudgetTokens({ sessionBudget: { tokens: 123456789 } }).tokens === 1e6, policy.sessionBudgetTokens({ sessionBudget: { tokens: 1 } }).source)
  delete process.env[S.env]

  const st0 = { sessionTok: 300_000_000, liveTok: 20_000_000, sessionBudget: 500_000_000 }
  ok('sessionUsed = 已闭合累计 + 当前回合', policy.sessionUsed(st0) === 320_000_000, String(policy.sessionUsed(st0)))
  ok('sessionRatio 按预算算', Math.abs(policy.sessionRatio(st0, null) - 0.64) < 1e-9, String(policy.sessionRatio(st0, null)))

  // startTurn：携带与继承
  resetState()
  const s1 = policy.startTurn({ sessionId: 'sess-budget', transcript: FIXTURE, cwd: '/w', prompt: '帮我证一下这个引理', sessionTok: 400_000_000, sessionBudget: 500_000_000 })
  ok('开局写入会话累计与预算', s1.state.sessionTok === 400_000_000 && s1.state.sessionBudget === 500_000_000, JSON.stringify({ t: s1.state.sessionTok, b: s1.state.sessionBudget }))
  ok('公告含「会话预算」行（带已用/总量/百分比）', /会话预算.*400\.00M.*500\.00M.*80\.0%/.test(s1.text.replace(/\n/g, ' ')), s1.text.split('\n').find((l) => l.includes('会话预算')) ?? '')
  const s2 = policy.startTurn({ sessionId: 'sess-budget', transcript: FIXTURE, cwd: '/w', prompt: '再来一个' })
  ok('下一回合继承会话累计（钩子不必每回合全量折叠）', s2.state.sessionTok === 400_000_000, String(s2.state.sessionTok))

  // gateDecision：会话硬线优先，白名单豁免，最多拦 3 次
  const base = { session: 'x', turn: 1, class: 'build', budget: 20, granted: 0, used: 0, denied: 0, budgetDenied: 0, sessionDenied: 0, repeat: {}, repeatDenied: 0, startedAt: 1000, sessionTok: 0, liveTok: 0, sessionBudget: 500_000_000 }
  const g = (over, tool = 'bash', mode = 'brake') => policy.gateDecision({ state: { ...base, ...over }, mode, toolName: tool, toolInput: { command: 'x' }, now: 2000 })
  ok('会话未到线：不因会话拦截', g({ sessionTok: 100_000_000 }).action === 'allow')
  let d = g({ sessionTok: 500_000_000 })
  ok('会话到硬线 → 拦（kind=session）', d.action === 'deny' && d.kind === 'session', JSON.stringify({ a: d.action, k: d.kind }))
  ok('会话刹车理由给两个数字 + 「新开会话」出路', /500\.00M/.test(d.reason) && d.reason.includes('新开一个会话') && d.reason.includes('journal'), d.reason.split('\n')[0])
  ok('会话硬线也放行白名单（收尾路径不许被掐）', g({ sessionTok: 500_000_000 }, 'proof_dag').action === 'allow')
  ok('会话拦截同样最多 3 次（拦多了本身是流量）', g({ sessionTok: 500_000_000, sessionDenied: 3 }).action === 'allow')
  ok('warn 模式不拦（只记账）', g({ sessionTok: 999_000_000 }, 'bash', 'warn').action === 'allow')
  ok('当前回合 liveTok 计入会话用量（不必等回合结算）', policy.sessionUsed({ sessionTok: 400_000_000, liveTok: 120_000_000 }) === 520_000_000)
  ok('会话用量用 liveTok 也能触发硬线', g({ sessionTok: 400_000_000, liveTok: 120_000_000 }).kind === 'session')

  // settle：只把**已闭合**的回合计入会话累计
  {
    resetState()
    const prof = traffic.blankProfile()
    const state = { session: 'fx', turn: 1, class: 'chat', budget: 10, used: 1, denied: 0, startedAt: Date.now() - 30_000, transcript: FIXTURE, cwd: '/w', sessionTok: 1000, liveTok: 500, sessionBudget: 1e9 }
    const r = policy.settleTurn({ profile: prof, state, fromTurn: 1 })
    ok('结算闭合回合 → sessionTok 累加该回合 tok、liveTok 归零', state.sessionTok === 1000 + 320 && state.liveTok === 0, JSON.stringify({ t: state.sessionTok, l: state.liveTok }))
    ok('样本里记下会话累计（可追溯）', r.sample.sessionTokAfter === 1320 && r.sample.sessionBudget === 1e9, JSON.stringify({ a: r.sample.sessionTokAfter, b: r.sample.sessionBudget }))
    const state2 = { session: 'fx', turn: 2, class: 'chat', budget: 10, used: 1, denied: 0, startedAt: Date.now() - 5_000, transcript: FIXTURE, cwd: '/w', sessionTok: 1000, liveTok: 500, sessionBudget: 1e9 }
    policy.settleTurn({ profile: prof, state: state2, fromTurn: 3 })
    ok('未闭合（pending）→ **不**计入会话累计（tok 还不完整）', state2.sessionTok === 1000 && state2.liveTok === 500, JSON.stringify({ t: state2.sessionTok, l: state2.liveTok }))
  }

  // 补账时把 tok 累加回该会话的回合状态（下轮开局继承）
  {
    resetState()
    const prof = traffic.blankProfile()
    prof.pending = [{ session: 'sfx', hookTurn: 2, logTurn: 2, class: 'build', startedAt: Date.now() - 60_000, used: 3, denied: 1, transcript: FIXTURE, attempts: 1 }]
    traffic.saveProfile(prof)
    policy.writeTurn({ session: 'sfx', turn: 2, class: 'build', budget: 20, used: 3, denied: 1, startedAt: 1, transcript: FIXTURE, sessionTok: 5000, liveTok: 700, sessionBudget: 1e9 })
    const rec = policy.reconcilePending({})
    const after = policy.readTurn('sfx')
    ok('补账把已结算回合的 tok 累加进会话状态', after.sessionTok === 5000 + 900 && after.liveTok === 0, JSON.stringify({ t: after.sessionTok, l: after.liveTok }))
    ok('补账结果仍带结算播报', typeof rec.done[0].text === 'string' && rec.done[0].text.includes('结算'), String(rec.done[0].text).slice(0, 40))
  }

  // 工具：看 / 设 / 复位
  {
    resetState()
    const view = budgetPlugin.runBudget({ action: 'session' })
    ok('session：查看当前预算与来源', view.includes('当前预算') && view.includes('默认'), view.split('\n')[2] ?? '')
    ok('session：写明 1M 在本负载下会在第一次调用就撞线', view.includes('6.61M') || view.includes('第一次模型调用'), view.split('\n').slice(-2).join(' '))
    const set1 = budgetPlugin.runBudget({ action: 'session', tokens: '1B' })
    ok('session：可设 1B', set1.includes('1000.00M') && traffic.loadProfile().sessionBudget.tokens === 1e9, set1.split('\n')[0])
    const tiny = budgetPlugin.runBudget({ action: 'session', tokens: '1M' })
    ok('session：设 1M 会明确警告「低于单个中位回合」', tiny.includes('⚠') && tiny.includes('6.61M'), tiny.split('\n').slice(-1)[0])
    ok('session：reset 恢复默认', budgetPlugin.runBudget({ action: 'session', tokens: 'reset' }).includes('默认') && traffic.loadProfile().sessionBudget.tokens === S.defaultTokens)
    const bad = (() => { try { budgetPlugin.runBudget({ action: 'session', tokens: 'abc' }); return null } catch (e) { return String(e.message) } })()
    ok('session：坏值报错（不静默取默认）', bad !== null && bad.includes('无法解析'), String(bad))
  }

  // 钩子端到端：同一回合里会话到线 → exit 2
  {
    resetState()
    const ws2 = mkdtempSync(join(tmpdir(), 'math-proof-sess-ws-'))
    runHook('budget-start.mjs', { session_id: 'h2', transcript_path: FIXTURE, cwd: ws2, hook_event_name: 'UserPromptSubmit', prompt: '帮我证一下这个引理' })
    const st = policy.readTurn('h2')
    ok('开局钩子在无先前状态时**全量折叠**初始化会话累计（fixture 合计 2140）', st.sessionTok === 2140, String(st.sessionTok))
    policy.writeTurn({ ...st, sessionTok: st.sessionBudget })
    const denied = runHook('budget-gate.mjs', { session_id: 'h2', cwd: ws2, hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'x' } })
    ok('会话到线 → 钩子 exit 2 且理由是会话预算', denied.code === 2 && denied.err.includes('会话预算用尽'), `${denied.code} ${denied.err.split('\n')[0]}`)
    const allowed = runHook('budget-gate.mjs', { session_id: 'h2', cwd: ws2, hook_event_name: 'PreToolUse', tool_name: 'proof_dag', tool_input: { action: 'journal' } })
    ok('会话到线时收尾路径仍放行', allowed.code === 0, String(allowed.code))
    rmSync(ws2, { recursive: true, force: true })
  }

  // token 分解账（跨 provider 通用）——用户点的正是「输入 / 输出」这个维度
  {
    const { turns: fxAll } = traffic.foldSession(FIXTURE)
    const sum = (k) => fxAll.reduce((a, x) => a + (x[k] ?? 0), 0)
    const totals = traffic.sessionTotals(FIXTURE)
    ok('sessionTotals 给出全量分解（输入/缓存/输出/思考）', totals.inTok === sum('inTok') && totals.cacheTok === sum('cacheTok') && totals.outTok === sum('outTok') && totals.reasoningTok === sum('reasoningTok'), JSON.stringify(totals).slice(0, 120))
    ok('sessionTotals：tok = 未缓存输入 + 缓存读 + 输出', totals.tok === totals.inTok + totals.cacheTok + totals.outTok, `${totals.tok} vs ${totals.inTok + totals.cacheTok + totals.outTok}`)
    const line = traffic.fmtTokenLine(totals)
    ok('fmtTokenLine 输出「输入 … · 输出 …」两段（含缓存命中率）', /输入 \*\*/.test(line) && /输出 \*\*/.test(line) && line.includes('命中率'), line)
    ok('fmtTokenLine：无缓存时也不写「缓存命中」（不编零）', !traffic.fmtTokenLine({ inTok: 100, cacheTok: 0, outTok: 10, reasoningTok: 0 }).includes('缓存命中'))
    const sm = traffic.summarizeTokens({ inTok: 5, cacheTok: 95, outTok: 10, reasoningTok: 4 })
    ok('summarizeTokens 口径：输入 = 未缓存 + 缓存读', sm.input === 100 && sm.output === 10 && sm.total === 110)
    ok('summarizeTokens：命中率与「思考占输出」', Math.abs(sm.cacheHitRate - 0.95) < 1e-9 && Math.abs(sm.reasoningOfOutput - 0.4) < 1e-9, JSON.stringify(sm))
    ok('addBreakdown 逐字段相加', JSON.stringify(traffic.addBreakdown({ tok: 1, inTok: 2, cacheTok: 3, outTok: 4, reasoningTok: 5 }, { tok: 10, inTok: 20, cacheTok: 30, outTok: 40, reasoningTok: 50 })) === JSON.stringify({ tok: 11, inTok: 22, cacheTok: 33, outTok: 44, reasoningTok: 55 }))
    ok('会话分解账 = 已闭合 + 当前回合', (() => { const s2 = { sessionBreakdown: { tok: 10, inTok: 6, cacheTok: 2, outTok: 2, reasoningTok: 1 }, liveBreakdown: { tok: 5, inTok: 3, cacheTok: 1, outTok: 1, reasoningTok: 0 } }; return policy.sessionBreakdown(s2).tok === 15 && policy.sessionBreakdown(s2).inTok === 9 })())

    // fixture 的 request/header 里带 provider/model → 回合应能归属
    ok('回合带上 provider / model（来自 request/header，阶跃值）', fxAll[3].provider === 'fix' && fxAll[3].model === 'fix-model', JSON.stringify({ p: fxAll[3].provider, m: fxAll[3].model }))
    ok('按 provider 分组统计存在（全机报表要用）', totals.byProvider.fix?.tok === 920 && totals.byProvider['—']?.tok === 1220, JSON.stringify(totals.byProvider))

    // 状态与样本
    resetState()
    const st = policy.startTurn({ sessionId: 'bd1', transcript: FIXTURE, cwd: '/w', prompt: 'x', sessionTok: 400e6, sessionBreakdown: { tok: 400e6, inTok: 5e6, cacheTok: 393e6, outTok: 2e6, reasoningTok: 0.8e6 } })
    ok('公告里同时给出 token 总量与输入/输出分解', st.text.includes('会话预算') && st.text.includes('输入') && st.text.includes('输出'), st.text.split('\n').find((l) => l.includes('会话预算'))?.slice(0, 80) ?? '')
    ok('公告标注「跨 provider 通用」', st.text.includes('跨 provider 通用'))
    const stt = budgetPlugin.runBudget({ action: 'status', sessionId: 'bd1', cwd: '/w' })
    ok('status 给出输入（缓存命中/未缓存）+ 输出（其中思考）', /输入 \*\*/.test(stt) && stt.includes('缓存命中') && stt.includes('其中思考'), stt.split('\n').find((l) => l.includes('输入')) ?? '')
    // report 走 `sessionLogFiles()`（`<root>/<workspace>/<session>/session.jsonl*`），测试里补一套布局
    mkdirSync(join(SESSIONS, 'ws-report', 'sess-report'), { recursive: true })
    writeFileSync(join(SESSIONS, 'ws-report', 'sess-report', 'session.jsonl'), readFileSync(FIXTURE))
    const rep = budgetPlugin.runBudget({ action: 'report', cwd: '/w', sessionId: 'bd1' })
    ok('report 有「Token 账」一节并说明数据来源', rep.includes('## Token 账') && rep.includes('assistant/message.usage'), rep.slice(rep.indexOf('## Token 账'), rep.indexOf('## Token 账') + 60))
    ok('report 按 provider 与 model 分组（扫到 1 个会话）', rep.includes('| provider |') && rep.includes('| model |') && rep.includes('全机 1 个会话'), rep.slice(rep.indexOf('| provider |'), rep.indexOf('| provider |') + 40))
    ok('report 给出本会话的输入/输出', rep.includes('**本会话**') && /输入 \*\*/.test(rep), rep.split('\n').find((l) => l.includes('本会话'))?.slice(0, 60) ?? '')

    // 与界面**逐字符同格式**：拿一个真实回合（用户在界面上看到的那一轮）当测试向量
    {
      const guiTurn = { inTok: 26872, cacheTok: 25116032, outTok: 35932, reasoningTok: 9672, tok: 26872 + 25116032 + 35932, provider: 'deepseek-official', model: 'deepseek-v4-flash', steps: 12, toolCalls: 11 }
      ok('fmtInt 用分组整数（与界面一致，不是 k/M）', traffic.fmtInt(25178836) === '25,178,836' && traffic.fmtInt(26872) === '26,872', `${traffic.fmtInt(25178836)}`)
      ok('算术恒等式：本轮用量 = 未缓存输入 + 缓存读取 + 输出', guiTurn.inTok + guiTurn.cacheTok + guiTurn.outTok === guiTurn.tok && guiTurn.tok === 25178836, String(guiTurn.tok))
      const block = traffic.renderUsageBlock(guiTurn, { title: '本轮用量', withSteps: true })
      ok('渲染出界面那一块的第一行（本轮用量 + 分组数字）', block.split('\n')[0] === '本轮用量 25,178,836 tok', block.split('\n')[0])
      for (const label of ['提供方 / 模型', '缓存命中', '未缓存输入', '缓存读取', '输出']) {
        ok(`标签与界面一致：${label}`, block.includes(`${label}\n`), block.slice(0, 60))
      }
      ok('提供方 / 模型 行是 `provider/model` 且缩进 4 格', block.includes('\n    deepseek-official/deepseek-v4-flash\n'), block.split('\n').slice(2, 4).join('|'))
      ok('缓存命中按 inputTokens+cacheReadTokens 算 → 99.9%', block.includes('\n    99.9%\n'), block.split('\n')[5])
      ok('三个分项的数字与界面逐个一致', block.includes('26,872 tok') && block.includes('25,116,032 tok'), block.split('\n').filter((l) => l.includes('tok')).join(' | '))
      ok('输出行带「其中推理」（推理为 0 时不写）', block.includes('35,932 tok（其中推理 9,672 tok）') && !traffic.renderUsageBlock({ inTok: 1, cacheTok: 2, outTok: 3, reasoningTok: 0, tok: 6 }).includes('其中推理'))
      ok('提供方缺失时如实写「未记录」', traffic.renderUsageBlock({ inTok: 1, cacheTok: 0, outTok: 1, tok: 2 }).includes('未记录'))
      ok('turnUsageRow 与界面字段一一对应', (() => { const u = traffic.turnUsageRow(guiTurn); return u.total === 25178836 && u.uncachedInput === 26872 && u.cacheRead === 25116032 && u.output === 35932 && u.reasoning === 9672 && Math.abs(u.cacheHitRate - 0.99893) < 1e-4 })())
      // 与日志折叠的一致性：fixture turn1 的渲染结果等于它自己的 tok（也是界面会显示的那个数）
      const fx1 = fxAll[0]
      const b1 = traffic.renderUsageBlock(fx1)
      ok('日志折叠出来的回合也能渲染（且总量等于该回合 tok）', b1.includes(`本轮用量 ${traffic.fmtInt(fx1.tok)} tok`) && fx1.tok === fx1.inTok + fx1.cacheTok + fx1.outTok, b1.split('\n')[0])
    }

    // 结算样本带上分解与 provider（报表要按 provider 归类）
    const prof2 = traffic.blankProfile()
    const st2 = { session: 'bd2', turn: 1, class: 'chat', budget: 10, used: 1, denied: 0, startedAt: Date.now() - 30_000, transcript: FIXTURE, cwd: '/w', sessionTok: 1000, sessionBudget: 1e9, sessionBreakdown: { tok: 0, inTok: 0, cacheTok: 0, outTok: 0, reasoningTok: 0 } }
    const r2 = policy.settleTurn({ profile: prof2, state: st2, fromTurn: 1 })
    ok('结算样本带上分解（输入/缓存/输出）', r2.sample.inTok === 180 && r2.sample.outTok === 30 && r2.sample.cacheTok === 110, JSON.stringify({ i: r2.sample.inTok, o: r2.sample.outTok, c: r2.sample.cacheTok }))
    ok('结算样本**带 provider/model 字段**（该回合早于首个 request/header → 值为 null，是如实反映）', 'provider' in r2.sample && 'model' in r2.sample && r2.sample.provider === null, JSON.stringify({ p: r2.sample.provider, m: r2.sample.model }))
    ok('结算把回合分解累加进会话账', st2.sessionBreakdown.tok === 320 && st2.sessionBreakdown.inTok === 180 && st2.sessionBreakdown.cacheTok === 110, JSON.stringify(st2.sessionBreakdown))
  }

  // usage 动作：本轮 / 最近若干轮 / 会话累计（与界面同格式）
  {
    resetState()
    const live = process.env.HOME + '/.dsh/sessions/--data-work-discrete-mathematics--/session-10a4b85c-9308-4f17-bc06-8ca2210339d1/session.jsonl.zstd'
    const hasLive = existsSync(live)
    if (!hasLive) {
      skip('usage 动作（需要真实会话日志）', '本机没有该会话日志')
    } else {
      policy.startTurn({ sessionId: 'u9', transcript: live, cwd: '/w', prompt: 'x' })
      const out = budgetPlugin.runBudget({ action: 'usage', sessionId: 'u9', cwd: '/w', limit: 3 })
      ok('usage：给出「本轮」块（围栏 + 界面同格式）', out.includes('## 本轮') && out.includes('```') && /本轮用量 [\d,]+ tok/.test(out), out.split('\n').slice(0, 6).join(' / '))
      ok('usage：给出最近若干轮的表格（含提供方/模型列）', out.includes('## 最近 3 个已完成回合') && out.includes('| 提供方 / 模型 |'), out.split('\n').find((l) => l.includes('| 轮次')) ?? '')
      ok('usage：给出会话累计块', out.includes('## 本会话累计') && /会话累计 [\d,]+ tok/.test(out), out.split('\n').find((l) => l.includes('会话累计')) ?? '')
      ok('usage：明确写出恒等式（与界面同一把尺子）', out.includes('未缓存输入 + 缓存读取 + 输出'), out.split('\n').slice(-1)[0])
      const noCtx = budgetPlugin.runBudget({ action: 'usage', sessionId: 'no-such-session', cwd: '/w' })
      ok('usage：没有会话上下文时如实说明（不硬编）', noCtx.includes('拿不到会话日志路径') || noCtx.includes('还没有带用量的回合'), noCtx.split('\n')[2] ?? '')
    }
  }

  // 静态：SESSION 真的被用上（而不是只写在表里）
  const polSrc = readFileSync(join(PRESET, 'impl', 'budget-policy.mjs'), 'utf8')
  ok('gateDecision 里真的判了会话硬线', /sRatio >= SESSION\.hardAt/.test(polSrc))
  ok('公告与播报都带会话进度', /会话预算/.test(polSrc) && /会话 \$\{fmtTok/.test(polSrc))
}

// ── 4.9) 额度（余额）监控：官方接口是「钱」不是「token 配额」───────────────
section('额度监控（quota：余额采样与趋势）')
{
  const quota = await import(join(PRESET, 'impl', 'quota.mjs'))
  const official = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] }
  const p1 = quota.parseBalance(official)
  ok('解析官方形状（金额是**字符串**）', p1.ok && p1.primary.currency === 'CNY' && p1.primary.total === 110 && p1.primary.granted === 10 && p1.primary.toppedUp === 100, JSON.stringify(p1).slice(0, 120))
  ok('官方 `is_available` 被带上', p1.available === true)
  const p2 = quota.parseBalance({ total_quota: 100, remaining_quota: 60, used_quota: 40 })
  ok('**社区流传的错误形状被明确拒绝**（不猜字段）', p2.ok === false && p2.keys.includes('total_quota'), JSON.stringify(p2))
  ok('多币种时优先 CNY', quota.parseBalance({ balance_infos: [{ currency: 'USD', total_balance: '1.00' }, { currency: 'CNY', total_balance: '7.00' }] }).primary.currency === 'CNY')
  ok('parseAmount：只认十进制数字串（不认科学计数法）', quota.parseAmount('110.00') === 110 && quota.parseAmount('0') === 0 && quota.parseAmount('1e3') === null && quota.parseAmount('abc') === null && quota.parseAmount('') === null)
  ok('fmtMoney 带币种符号', quota.fmtMoney(110, 'CNY') === '¥110.00' && quota.fmtMoney(3.5, 'USD') === '$3.50' && quota.fmtMoney(null, 'CNY') === '—')
  ok('端点常量是官方 `/user/balance`（不是 /v1/user/info）', quota.BALANCE_PATH === '/user/balance')
  const quotaSrc = readFileSync(join(PRESET, 'impl', 'quota.mjs'), 'utf8')
  // 剥注释再查：注释里**故意**列出了那两个错端点作为警告（与前面几处同一手法）
  ok('额度模块里没有出现 /v1/user/info 之类臆造端点（剥注释后）', !/\/v1\/user\/info|user\/info/.test(stripComments(quotaSrc)), (stripComments(quotaSrc).match(/[^\n]*user\/info[^\n]*/) ?? [''])[0])

  // 燃烧速率与 ETA（纯函数，用合成样本）
  const at = (h) => new Date(Date.UTC(2026, 8, 10, 0, h * 60)).toISOString()
  const series = [{ at: at(0), currency: 'CNY', total: 30 }, { at: at(1), currency: 'CNY', total: 27 }, { at: at(2), currency: 'CNY', total: 24 }]
  const rate = quota.burnRatePerHour(series, 'CNY')
  ok('燃烧速率：2 小时花 6 → 3.00/小时', rate !== null && Math.abs(rate.perHour - 3) < 1e-9, JSON.stringify(rate))
  ok('ETA：剩 24 / 3 每小时 → 8 小时', Math.abs(quota.etaHours(series, 'CNY') - 8) < 1e-9, String(quota.etaHours(series, 'CNY')))
  const topped = [...series, { at: at(3), currency: 'CNY', total: 100 }, { at: at(4), currency: 'CNY', total: 98 }]
  const rate2 = quota.burnRatePerHour(topped, 'CNY')
  ok('充值后**只算最近的单调下降段**（充值不会被算成负消耗）', rate2 !== null && Math.abs(rate2.perHour - 2) < 1e-9 && rate2.samples === 2, JSON.stringify(rate2))
  ok('样本不足（<2）→ 速率 null（不编数字）', quota.burnRatePerHour([{ at: at(0), currency: 'CNY', total: 30 }], 'CNY') === null)
  ok('余额没下降 → 速率 null', quota.burnRatePerHour([{ at: at(0), currency: 'CNY', total: 30 }, { at: at(1), currency: 'CNY', total: 30 }], 'CNY') === null)

  // 基线与落盘
  ok('基线：用户声明优先', quota.quotaBaseline({ baseline: 50, baselineSource: 'x', samples: [{ total: 100 }] }).value === 50)
  ok('基线：否则用历史最高余额（≈上次充值后）', quota.quotaBaseline({ baseline: null, samples: [{ total: 30 }, { total: 100 }, { total: 80 }] }).value === 100)
  resetState()
  for (let i = 0; i < 5; i++) quota.appendQuotaSample({ currency: 'CNY', total: 100 - i, source: 'test' })
  ok('采样落盘并读回', quota.loadQuota().samples.length === 5 && quota.loadQuota().samples[0].total === 100, String(quota.loadQuota().samples.length))
  ok('采样上限生效（数据管理：文件有界）', (() => { const many = { version: 1, baseline: null, samples: Array.from({ length: quota.SAMPLES_MAX + 20 }, (_, i) => ({ at: at(0), currency: 'CNY', total: i })) }; quota.saveQuota(many); return quota.loadQuota().samples.length === quota.SAMPLES_MAX })())
  writeFileSync(quota.quotaSamplesPath(), '{坏 JSON')
  ok('采样文件损坏 → 备份后当空的（不静默丢证据）', quota.loadQuota().samples.length === 0 && readdirSync(STATE).some((f) => f.includes('corrupt-')))

  // fetchBalance（注入 fetch，不联网）
  const okFetch = async () => ({ ok: true, status: 200, json: async () => official })
  const r1 = await quota.fetchBalance({ apiKey: 'sk-test', fetchImpl: okFetch })
  ok('fetchBalance：官方响应 → ok', r1.ok === true && r1.primary.total === 110)
  const r401 = await quota.fetchBalance({ apiKey: 'sk-test', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) })
  ok('fetchBalance：401 → 明确「API key 无效」（不回显响应体）', r401.ok === false && r401.why.includes('401') && r401.why.includes('API key 无效'), r401.why)
  const r402 = await quota.fetchBalance({ apiKey: 'sk-test', fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({}) }) })
  ok('fetchBalance：402 → 明确「余额不足」', r402.ok === false && r402.why.includes('余额不足'), r402.why)
  const rShape = await quota.fetchBalance({ apiKey: 'sk-test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ total_quota: 1 }) }) })
  ok('fetchBalance：形状不符 → 报出顶层键而不是硬解', rShape.ok === false && rShape.keys.includes('total_quota'), JSON.stringify(rShape))
  const rNoKey = await quota.fetchBalance({ apiKey: '' })
  ok('fetchBalance：没有 key → 不请求、直接说清', rNoKey.ok === false && rNoKey.why.includes('没有可用的 API key'))

  // 工具：默认不联网；refresh 需异步；异步路径可注入 fetch
  resetState()
  const offline = budgetPlugin.runBudget({ action: 'quota' }, { get: () => undefined })
  ok('quota 动作：默认**不联网**（无采样时给出采样命令）', offline.includes('还没有采样') && offline.includes('/user/balance'), offline.split('\n')[2] ?? '')
  ok('quota 动作：同步入口拒绝 refresh（避免同步/异步混合）', (() => { try { budgetPlugin.runBudget({ action: 'quota', refresh: true }); return false } catch (e) { return String(e.message).includes('异步入口') } })())
  const refreshed = await budgetPlugin.runQuotaAsync({ refresh: true }, { get: () => undefined }, { apiKey: 'sk-test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => official }) })
  ok('quota 异步路径：拉到并落盘一条采样', refreshed.includes('已采样') && quota.loadQuota().samples.length === 1, refreshed.split('\n').slice(-2).join(' '))
  ok('quota 报告：有采样后给出余额与燃烧速率说明', refreshed.includes('最新余额') && (refreshed.includes('样本不足') || refreshed.includes('小时')), refreshed.split('\n')[2] ?? '')
  ok('quota 报告：明说百分比需要自定基线（官方没有总量字段）', refreshed.includes('没有总量字段') || refreshed.includes('基线'), refreshed.split('\n').find((l) => l.includes('基线')) ?? '')
  ok('quota：设基线后百分比按基线算', (() => { const out = budgetPlugin.runBudget({ action: 'quota', baseline: 200 }, { get: () => undefined }); return out.includes('基线') && quota.loadQuota().baseline === 200 })())

  // CLI
  const cli = spawnSync(process.execPath, [join(PRESET, 'scripts', 'quota.mjs')], { encoding: 'utf8', env: { ...process.env, MATH_PROOF_STATE_DIR: STATE } })
  ok('CLI：无采样时 exit 0 并说明官方端点', cli.status === 0 && (cli.stdout ?? '').includes('/user/balance'), (cli.stdout ?? '').slice(0, 80))
  const cliRefresh = spawnSync(process.execPath, [join(PRESET, 'scripts', 'quota.mjs'), '--refresh'], { encoding: 'utf8', env: { ...process.env, MATH_PROOF_STATE_DIR: STATE, DEEPSEEK_API_KEY: '' } })
  ok('CLI：无凭据 refresh → exit 1 且提示以官方文档为准', cliRefresh.status === 1 && (cliRefresh.stderr ?? '').includes('官方'), (cliRefresh.stderr ?? '').slice(0, 80))
  const cliJson = spawnSync(process.execPath, [join(PRESET, 'scripts', 'quota.mjs'), '--json'], { encoding: 'utf8', env: { ...process.env, MATH_PROOF_STATE_DIR: STATE } })
  ok('CLI：--json 输出带 caveat（免得别人误以为有「总量」）', cliJson.status === 0 && JSON.parse(cliJson.stdout).caveat.includes('没有「总量」字段'), cliJson.stdout.slice(0, 60))
  const cliSrc = stripComments(readFileSync(join(PRESET, 'scripts', 'quota.mjs'), 'utf8'))
  ok('CLI：脚本不解析 harness 的凭据文件（不复制凭据模型，剥注释后）', !cliSrc.includes('.credentials.yaml') && !/readFileSync\([^)]*credentials/.test(cliSrc))
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
