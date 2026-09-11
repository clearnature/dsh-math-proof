// 数学证明模式 — **交互式询问 Agda**（`proof_goals` 工具）
//
// 解决的问题：模型写 `{!!}` 之后，**不知道洞里要什么、上下文里有什么**——只能整模块编译、
// 看报错、猜，再编译。本工具把 Agda 的交互接口（`agda --interaction-json`）接进来，一次进程回答：
//   洞里是什么类型 / 上下文有哪些名字 / 表达式什么类型 / 这个项过不过 / 这个变量怎么分情况 / 自动搜索给什么候选。
//
// 为什么不用 `agda-language-server`（ALS）：见 `impl/agda-interaction.mjs` 头部（它支持的 Agda ≤2.8.0，
// 本机是 2.9.0-nightly，且该检出未构建；ALS 自己也是驱动这同一套 IOTCM 命令）。
//
// 两条硬纪律（写在工具描述里，也在这里）：
//   ① 本工具**只读**：交互命令不改磁盘（实测）——它给的是「如果这样写会怎样」，不是已完成的编辑；
//   ② 它**不签发任何回执**：证据只由 `proof_compile` 签发。`give/auto` 通过 ≠ 已证。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOALS_ACTIONS, buildCommands, parseStream, renderAuto, renderCase, renderContext, renderGive, renderGoals, renderInfer, renderNormalize } from '../impl/agda-interaction.mjs'
import { discoverCandidates, shellQuote } from './agda-engine.mjs'

export const name = 'agda-goals'
export const inject = ['shell', 'tools']

/** 交互式查询的默认超时（装载 + 查询；比整模块编译短——它不做完整检查）。 */
const DEFAULT_TIMEOUT_MS = 60000
/** 输出上限（Agda 的 `JSON> ` 流里含大量高亮信息，留够但不无限）。 */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/**
 * 候选 agda 列表：共享发现（`agda-engine` 的 `discoverCandidates`）+ **本工具自己的 PATH 兜底**。
 *
 * 为什么要自己扫 PATH：共享发现只认 `impl/local-paths.json` 的 `agdaBin` 与 `~/.local/bin/agda`（那是**本机配置**，
 * 属于使用者的事）；而 PATH 是**任何机器上都成立**的一条路。本工具只读地兜这一层，
 * 不改配置、也不改 `agda-engine` 的判定（编译裁决那条路仍然是它自己的规则）。
 */
export function agdaCandidates() {
  const out = []
  const seen = new Set()
  const push = (bin, source) => {
    if (typeof bin !== 'string' || bin === '' || seen.has(bin)) return
    if (!existsSync(bin)) return
    seen.add(bin)
    out.push({ kind: 'agda', bin, source })
  }
  for (const c of discoverCandidates()) if (c.kind === 'agda') push(c.bin, c.source)
  for (const dir of (process.env.PATH ?? '').split(':').filter((d) => d !== '')) push(join(dir, 'agda'), 'PATH')
  return out
}

/** 挑一个**可用的 agda**（dype 不支持交互协议，直接排除）。 */
async function pickAgda(ctx, exec, cwd) {
  for (const candidate of agdaCandidates()) {
    if (candidate.kind !== 'agda') continue
    const probe = await runShell(ctx, exec, `${shellQuote(candidate.bin)} --print-agda-data-dir`, cwd, 20000)
    const datadir = lastNonEmptyLine(`${probe.stdout?.text ?? ''}\n${probe.stderr?.text ?? ''}`)
    if (probe.exitCode === 0 && datadir !== '' && existsSync(datadir)) return { ...candidate, datadir }
  }
  return null
}

async function runShell(ctx, exec, command, workdir, timeoutMs) {
  const policy = ctx.get('sandboxPolicy')
  const sandboxPolicy = policy === undefined ? undefined : policy.resolve(exec?.agent === undefined ? {} : { session: exec.agent.session })
  const spec = ctx.shell.resolve({
    command,
    workdir,
    timeoutMs,
    stdoutMaxBytes: MAX_OUTPUT_BYTES,
    signal: exec?.signal,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  })
  return await ctx.shell.run(spec)
}

const lastNonEmptyLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .pop() ?? ''

/** 问一次 Agda（一个进程：装载 + 一条查询）。 */
async function ask(ctx, exec, { bin, lines, cwd, timeoutMs }) {
  // 用**带引号的 heredoc** 喂 stdin：命令里含双引号/括号，heredoc 不插值，最不容易被 shell 改写。
  const command = `${shellQuote(bin)} --interaction-json <<'MATH_PROOF_IOTCM'\n${lines.join('\n')}\nMATH_PROOF_IOTCM`
  const result = await runShell(ctx, exec, command, cwd, timeoutMs)
  return { parsed: parseStream(result.stdout?.text ?? ''), stderr: result.stderr?.text ?? '', exitCode: result.exitCode, timedOut: result.timedOut === true }
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'proof_goals',
    description:
      '交互式询问 Agda（`agda --interaction-json`）：**洞里要什么、上下文有什么、这个项过不过、变量怎么分情况、自动搜索给什么候选**。' +
      'action: list（洞清单+各自目标类型，默认）/ context（某洞的目标与**上下文名字**）/ infer（表达式在该洞的类型）/ give（在该洞试一个项：不通过会给出**期望 vs 实际类型**，比整模块编译快得多）/ case（对变量分情况，直接给出可粘贴的**子句**）/ auto（Agda proof search 给候选）/ normalize（范式——两边范式相同通常 `refl` 就能闭合）。' +
      '**只读且不签发证据**：交互命令不改磁盘，本工具也不签回执——写进文件后仍要 `proof_compile`。' +
      '适用场景：写证明项卡住、不知道洞的上下文、想先试探再落盘。整模块判定仍走 `proof_compile`（Agda 是唯一裁决器）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Agda 模块文件（相对 cwd 或绝对路径），如 src/Sovereign/Base/Trit.agda。' },
        action: { type: 'string', enum: GOALS_ACTIONS, description: 'list 洞清单（默认）/ context 目标+上下文 / infer 类型推断 / give 试探一个项 / case 分情况 / auto 自动搜索 / normalize 归一化。' },
        goal: { type: 'number', description: '洞 id（context/infer/give/case 用；默认 0）。id 从 `action:"list"` 的输出里拿。' },
        expr: { type: 'string', description: 'infer/give/normalize 的表达式，如 `x , x`、`suc x`。' },
        on: { type: 'string', description: 'case 用：要分情况的**变量名**（必须是该洞上下文里的名字）。' },
        timeoutMs: { type: 'number', description: `超时（毫秒），默认 ${DEFAULT_TIMEOUT_MS}。` },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['report'],
        properties: { report: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.report }]
      },
    },
    async execute(args, exec) {
      const a = args === null || typeof args !== 'object' ? {} : args
      const action = typeof a.action === 'string' && a.action !== '' ? a.action : 'list'
      const requested = String(a.path ?? '').trim()
      if (requested === '') throw new Error('proof_goals: `path` 必给（要问的 Agda 模块文件）')
      if (!GOALS_ACTIONS.includes(action)) throw new Error(`proof_goals: unknown action "${action}" (expected ${GOALS_ACTIONS.join(' | ')})`)
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const target = isAbsolute(requested) ? requested : resolvePath(cwd, requested)
      if (!existsSync(target)) throw new Error(`proof_goals: no such file: ${target}`)
      if (requested.includes('"')) throw new Error('proof_goals: 路径里含双引号，IOTCM 无法表达——请用不含双引号的路径')

      const timeoutMs = Number.isFinite(a.timeoutMs) && a.timeoutMs > 0 ? a.timeoutMs : DEFAULT_TIMEOUT_MS
      const checker = await pickAgda(ctx, exec, dirname(target) === '' ? cwd : dirname(target))
      if (checker === null) {
        return {
          report: [
            `# proof_goals: ${requested}`,
            '',
            '**无法查询：没有可用的 Agda**（交互协议只有 Agda 支持；`dype` 是实验性内核，没有这套接口）。',
            '',
            '- 检查路径与可用性：`node scripts/doctor.mjs --toolchain`（或看你自己的 Agda 安装）',
            '- 注意：本工具驱动的是 `agda --interaction-json`。`agda-language-server`（ALS）**不能**当后端：',
            '  ALS 0.2.7 支持的 Agda 是 2.6.4.3 / 2.7.0.1 / 2.8.0，而常见的项目构建是 2.9.0-nightly；',
            '  ALS 自己也是驱动这套 IOTCM 命令的 LSP 前端（将来若为 2.9.0 构建出 ALS，可换后端而不改工具签名）。',
          ].join('\n'),
        }
      }

      const { lines, needs } = buildCommands({ action, path: requested, goal: a.goal ?? 0, expr: a.expr ?? '', on: a.on ?? '' })
      if (needs.length > 0) throw new Error(`proof_goals: ${needs.join('；')}`)

      const { parsed, stderr, exitCode, timedOut } = await ask(ctx, exec, { bin: checker.bin, lines, cwd, timeoutMs })
      const meta = { path: requested, action, goal: a.goal ?? 0, expr: a.expr ?? '', on: a.on ?? '', checker: checker.bin }

      let report = null
      if (action === 'list') report = renderGoals(parsed, meta)
      else if (action === 'context') report = renderContext(parsed, meta)
      else if (action === 'infer') report = renderInfer(parsed, meta)
      else if (action === 'give') report = renderGive(parsed, meta)
      else if (action === 'case') report = renderCase(parsed, meta)
      else if (action === 'auto') report = renderAuto(parsed, meta)
      else report = renderNormalize(parsed, meta)

      const notes = []
      if (timedOut) notes.push(`- ⏱ 超时（${timeoutMs}ms）：交互查询会在**装载**时做类型检查，慢的是装载不是查询——大模块请配合 .agdai 缓存，或先看 proof_compile 的编译历史。`)
      if (exitCode !== 0 && exitCode !== null) notes.push(`- 退出码 ${exitCode}`)
      if (stderr.trim() !== '') notes.push(`- stderr: ${stderr.trim().split('\n').slice(-3).join(' / ').slice(0, 300)}`)
      if ((parsed.raw ?? []).length > 0) notes.push(`- 非 JSON 输出（原样保留）：${parsed.raw.join(' / ').slice(0, 300)}`)
      if (notes.length > 0) report = `${report}\n\n## 运行备注\n${notes.join('\n')}`
      return { report }
    },
  })
}
