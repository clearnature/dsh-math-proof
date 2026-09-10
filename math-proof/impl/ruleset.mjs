// 数学证明模式 — **可热读的判定规则**（零依赖，只 import `node:` 内建模块）
//
// 为什么单独一个文件：工具插件的代码在 standing mount 时被加载一次，**改磁盘不会改变本进程里
// 已挂载的实例**。2026-09-10 的实际事故：会话里跑的 `proof_dag` 是旧规则（把同模块依赖、传递依赖、
// 未登记模块都算成断链 → 报 85/100、断链 25 条），而磁盘上的新规则算出来是 0 条。会话里无法自证，
// 只能靠人肉 diff 工具输出与磁盘源码。
//
// 本文件把**判定规则**（断链豁免、评分权重、postulate 分类、编译爆炸处方、草稿文件模式）抽出来，
// 由工具**每次调用重新 import**（带 `?v=<mtime>` 打破 ESM 缓存）→ 改规则**不需要重开会话**，
// 也不需要重挂载；同时把 `RULESET_VERSION` 与源码哈希写进每次输出，让分数可比、可追溯。
//
// 规矩：
//   · 改这里的**数值/开关/模式** → 立即生效（热）。改完请把 `RULESET_VERSION` 加一，否则
//     两次不同规则的分数会被当成同一条曲线。
//   · 改**工具本体**（`plugins/*.mjs` 的结构、schema、输出格式）→ 仍然需要重挂载；
//     这种情况由 `proof_dag action:"doctor"` 明确报「插件本体落后于磁盘」，不要装作没事。

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 规则语义版本：**规则一变就加一**（进输出日志，保证分数可比）。 */
export const RULESET_VERSION = 'r6'

/** 台账↔代码断链的判定开关。 */
export const DRIFT = {
  /** 同模块豁免：节点声明依赖的模块就是它自己的模块时不算断链（对象节点的常见情形）。 */
  exemptSameModule: true,
  /** 传递 import 搜索深度（超过就按纸面依赖处理）。 */
  transitiveDepth: 8,
  /** `relations` 里这些前缀算结构性依赖，参与断链核对（对象层喂养依赖图）。 */
  structuralRelationPrefixes: ['extends'],
}

/** 完整性评分权重（扣分制；冻结的只有这些数字，改它们要同时 bump RULESET_VERSION）。 */
export const SCORE = {
  cyclic: 25,
  dangling: 15,
  provenNoEvidence: 10,
  provenNoEvidenceCap: 30,
  unverified: 5,
  unverifiedCap: 20,
  missingModule: 10,
  missingModuleCap: 20,
  driftPer: 3,
  driftCap: 15,
  openDecision: 3,
  openDecisionCap: 9,
  undiagnosed: 3,
  undiagnosedCap: 9,
  unowned: 2,
  unownedCap: 6,
  witnessRewritten: 30,
  witnessShrunk: 30,
  witnessSuspicious: 10,
  witnessDirty: 3,
  /** proven 但模块含**未声明**的 postulate：这是「用公理冒充证明」，重罚。 */
  undeclaredPostulatePer: 20,
  undeclaredPostulateCap: 40,
  /** 声明为真缺口（kind:"gap"）仍标 proven：同罚。 */
  declaredGapProven: 20,
}

/**
 * postulate 分类口径（回答「`proven` 是否要求 0 postulate」）：
 *   · `rewrite`     —— 项目已论证的 REWRITE 语义设计（如 `div3k`/`mod3k`/`gf3Toℕ-A4-inv`）
 *   · `unreachable` —— Agda 强制检查下的已知无害项（如 `UnreachableClauses` 相关辅助）
 *   · `gap`         —— **真缺口**：还没证的断言
 * 门禁看的是**真缺口**，不是 postulate 总数；但「已声明豁免」必须有人类裁决（journal decision），
 * 否则算待裁决项——不让模型自己给自己发豁免。
 */
export const POSTULATE = {
  kinds: ['rewrite', 'unreachable', 'gap'],
  /** 声明豁免是否需要一条（open 或已 resolve 的）人类裁决流水。 */
  requireHumanRuling: true,
}

/**
 * 工作区草稿/探针文件的收尾检查（诊断用过的临时件不该留在库里）。
 *
 * ⚠ 命名启发式**一定会误报**（本项目 `test/_test_*.agda` 与 `src/_rt.agda` 都是**有意保留**的真实模块）。
 * 所以规则是：先按模式取候选，**再用 git 跟踪状态过滤**——被跟踪的就不是草稿。
 * git 不可用（非仓库 / 无 shell）时**如实标注「未核对」**，不假装准确。
 */
export const SCRATCH = {
  patterns: [/^_Probe.*\.agda$/, /^_test_.*\.agda$/, /^_t[a-z0-9_]*\.agda$/, /\.agda~$/, /\.agda\.(bak|orig|rej)$/],
  /** 只扫这些子目录（相对工作区），避免遍历整棵 `_build/`。 */
  roots: ['src', 'test', 'tests', 'engineering', '.'],
  /** 深度上限：够覆盖常见布局，不会把大仓库翻一遍。 */
  maxDepth: 3,
  /** 明确要豁免的路径（相对工作区）。 */
  allow: [],
}

/**
 * 编译失败的结果级分诊（诊断行里没有的失败模式：进程被杀 / 堆爆 / 超时）。
 * 这些失败**不会**产生 `file:line: error:` 行，所以必须在结果层判。
 *
 * ⚠ 归因要精确（2026-09-10 实测更正）：
 *   · **不是**「界是字面量所以触发 `any?` 枚举」——`proj₁ (pigeonhole-fin (12 ^ 729) f)` 单独编译
 *     **3.2s exit 0**，字面量界本身不爆（Agda 不强制它）。
 *   · **真凶是「含具体数字递归的定义体」被展开**：`stateEnc = fromℕ< … (suc≤12 729 …)` 里的
 *     `enc12 729` 一旦展开就是 729 层递归。探针链：
 *       字面量界 + 未封装编码 → 346s 堆爆；只封界（`abstract N729`）+ 未封装编码 → **仍 339s 堆爆**；
 *       abstract 界 + postulate 玩具编码 → 3s exit 0；abstract 界 + 真实 stateEnc（注入 postulate）→ >75s 超时。
 *   · 所以**修法不是抬内存**（不是 OOM，是求值；抬 `+RTS -M` 只会让展开跑更久），
 *     而是**把界与所有相关定义连同它们的体封进同一个 `abstract` 块**，只对外暴露类型。
 *   · 超时要**分成两类**：stdlib 接口重建（环境，沙箱不可写 stdlib 目录）vs 定义体展开（真问题）。
 */
export const RESULT_TRIAGE = [
  {
    test: /Heap exhausted|out of memory|OOM/i,
    limit: 'agda-abstract-body-729-unfold',
    prescription:
      '**定义体被展开**（不是「界是字面量」）：真凶通常是含**具体数字递归**的定义体（如 `stateEnc` 里的 `enc12 729`）被展开成几百层。' +
      '修法：把界与**所有相关定义连同它们的体**封进**同一个 `abstract` 块**，只对外暴露类型（如 `PresField → Fin N729`），块内用 `refl` 证 `N729 ≡ 12 ^ 729` 供块外 `subst`。' +
      '**只封界不够**（实测 `abstract N729` + 未封装的编码仍 339s 堆爆）。抬 `+RTS -M` 是歧路——这不是 OOM，是求值。',
    // 反例（避免过度归因）：体里没有具体数字递归、或编码用 postulate 占位时，本来就不慢
    notThis: '编码体不含具体数字递归（如纯 `∀ n` 形式），或该定义已用 postulate/opaque 占位——那本来就快，不是这条',
  },
  {
    test: /exit code 251|Killed|SIGKILL|signal 9/i,
    limit: 'agda-oom-killed',
    prescription:
      '进程被杀（多为内存）：先按「定义体展开」处理（见 `agda-abstract-body-729-unfold` 的处方）；确需放宽资源再用 `+RTS -M<n>G`，并**先确认不是求值问题**。',
    notThis: '机器本身内存紧张（他进程占用）时也会被杀——先看 `free -g` 再归因',
  },
  {
    test: /timed out|timeout/i,
    limit: 'agda-timeout',
    prescription:
      '**超时先分两类，别混**：① **stdlib 接口重建**——日志尾部在 `Checking Data.*`、`_build` 下大量 `.agdai` 被重写；成因是沙箱（workspace-write）写不了 stdlib 目录 → 接口失效 → 重新编译。属**环境**问题（见 `sandbox-stdlib-write`），不要当成证明慢。' +
      '② **定义体展开**——日志干净、直奔你的模块 → 真问题，按 `agda-abstract-body-729-unfold` 处方封装。',
    notThis: '整轮都在检查 stdlib 接口时，超时与你的证明无关',
  },
  {
    // 只在「失败但没有诊断行」时给——否则会把普通类型错误也归因成环境问题
    test: /Checking Data\.[A-Za-z.]+/,
    onlyWithoutDiagnostics: true,
    limit: 'sandbox-stdlib-write',
    prescription:
      '出现大量 `Checking Data.*` → **stdlib 接口在重建**：沙箱不可写 stdlib 目录导致接口失效（`_build` 下大量 `.agdai` 被重写即为证据）。这是环境问题，已记 `prover_limits: sandbox-stdlib-write`；改用可写策略或复用已编译产物。',
    notThis: '首次编译本来就会检查依赖模块——只有在「本该命中缓存却大量重建」时才算',
  },
  {
    test: /Termination checking failed|\[Termination\]/i,
    limit: 'agda-termination',
    prescription: '终止性检查：把递归改写到**结构更小的参数**上，或抽出对终止检查友好的辅助函数（不要用 `{-# TERMINATING #-}` 糊过去）。',
    notThis: '用 `--terminating` 友好写法重写后仍报错，才说明是真正的递归结构问题',
  },
]

/** 规则模块自身的路径与哈希。 */
export const RULESET_PATH = fileURLToPath(import.meta.url)

/** 任意文件的短哈希（8 位）；读不到返回 `null`。 */
export function moduleHash(file) {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8)
  } catch {
    return null
  }
}

/** 文件 mtimeMs；读不到返回 0。 */
function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/**
 * 重新加载规则（**热**）。带 `?v=<mtime>` 打破 ESM 模块缓存：
 * 同一个 mtime 只会加载一次，改了文件立刻换新实例。
 * @returns {Promise<{version:string,hash:string|null,mtime:number,rules:object}>}
 */
export async function loadRules() {
  return loadRulesFrom(RULESET_PATH)
}

/**
 * 同 `loadRules`，但可指定文件——**为了测试「热读真的生效」**：写一份临时规则文件，
 * 改一次内容再加载，断言第二次拿到的是新值（不是 ESM 缓存里的旧模块）。
 * @param {string} file
 */
export async function loadRulesFrom(file) {
  const mtime = mtimeOf(file)
  const mod = await import(`${pathToFileURL(file).href}?v=${String(mtime)}`)
  return { version: mod.RULESET_VERSION, hash: moduleHash(file), mtime, rules: mod }
}

/**
 * 判定规则集是否变化（用来在输出里如实标注）。
 * @param {{hash:string|null}} loaded 挂载时加载的规则集
 * @param {{hash:string|null}} live 本次调用加载的规则集
 */
export function rulesetStatus(loaded, live) {
  if (loaded?.hash === null || loaded?.hash === undefined) return 'unknown'
  return loaded.hash === live.hash ? 'current' : 'changed'
}
