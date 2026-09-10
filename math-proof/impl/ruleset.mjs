// 数学证明模式 — **判定规则**（零依赖，只 import `node:` 内建模块）
//
// 定位：这是**被插件静态 import 的普通模块**（冷档），不是「热读数据」。
// 2026-09-10 决策（用户：「冷的」）：**退回冷档**——原先用 `?v=<mtime>` 动态 import 破除 ESM 缓存实现
// 「改规则立即生效」，那是本 preset 唯一自造的机制；按「契约优先、不造机制」的原则删掉。
//
// 现在的规矩：
//   · 改本文件的**任何内容**（权重 / 处方 / 分诊表）→ **必须重启 dsh 进程**（Cordis 用无 query 的
//     `import(url)`，Node 的 ESM 缓存按 URL 在进程内固化，同进程重挂载拿不到新模块）；
//   · 改动后请 bump `RULESET_VERSION`——分数与断链数带 `规则集 rN/hash` 戳，跨版本不可比；
//   · `proof_dag action:"doctor"` 会比对「本文件磁盘 hash vs 进程内加载的 hash」，落后就明确报出来。
//
// 为什么要独立成一个模块（而不是塞进插件）：这些规则被 `proof-dag` 与 `agda-engine` 共用，
// 且它们是**数值与开关**，集中一处便于门禁核对（`tests/ruleset-check.mjs`）。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 规则语义版本：**规则一变就加一**（进输出日志，保证分数可比）。 */
export const RULESET_VERSION = 'r7'

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

/** 规则模块自身的路径与哈希（`doctor` 用它比对「磁盘 vs 进程内」）。 */
export const RULESET_PATH = fileURLToPath(import.meta.url)

/** 任意文件的短哈希（8 位）；读不到返回 `null`。 */
export function moduleHash(file) {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8)
  } catch {
    return null
  }
}
