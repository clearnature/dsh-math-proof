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
export const RULESET_VERSION = 'r10'

/**
 * 「已验证」的**弱证据**：工具回执文本里出现这些标记才算机器出过声。
 *
 * ⚠ 口径必须说清（不许把弱证据当强证据）：
 *   · 这是**文本匹配**——模型抄一段样例文本也能命中，所以它只是**必要不充分**；
 *   · **强证据**是落盘产物：`~/.dsh/state/math-proof/receipts/`（编译回执，绑源码哈希）
 *     与 `oracle-receipts/`（绑脚本哈希 + stdout 哈希）。`session-traffic.mjs` 的
 *     `verifiedByFiles` 看的是「本回合时间窗内有没有**新写的**回执文件」——那是文件系统事实。
 *   · 两者取或：任一出声即算「有证据」；都没有 → 记 `unverified`（**不扣预算，也不减预算**）。
 */
export const RECEIPT = {
  /**
   * ⚠ 只收**高信号**标记：`exit 0` 这种**不收**——实测它几乎在每个回合的工具输出里都出现
   * （模型自己 echo、脚本回显都能命中），收进来等于「人人都有证据」= 门禁失效。
   * 收 `回执: \``（签发形态）而**不收** `回执: `（未签发形态是 `- 回执: ⚠ 未签发…`）。
   */
  patterns: [
    'CHECK_ALL_OK',
    'ALL_PASS',
    'BENCHMARK_PASS',
    'SCHEMA_LINT_OK',
    'EVAL_CHECK_OK',
    'KNOWLEDGE_OK',
    'DUP_OK',
    'CACHE_OK',
    'REFS_OK',
    'ROUTING_OK',
    'HOOKS_OK',
    'MARKET_OK',
    'PLUGINS_OK',
    'PUBLISH_OK',
    'RULESET_OK',
    'DOCS_OK',
    'SKILLS_REF_OK',
    'PATHS_OK',
    'INJECT_OK',
    'PROMPT_VARS_OK',
    'RELOAD_OK',
    'HOT_SECTION_OK',
    'BUDGET_OK',
    'ORACLE-MANIFEST',
    '✅ 退出 0',
    '回执: `',
  ],
  /** 回执落盘目录（相对 state 目录）。强证据。 */
  dirs: ['receipts', 'oracle-receipts'],
}

/**
 * **预算与流量管理**（冻结数值；回答「每次任务的预算能不能自己加减」）。
 *
 * 实测口径（2026-09-10，本机 26 会话 / 174 个有 usage 的回合，见 `scripts/traffic-report.mjs`）：
 *   · 单回合中位 **6.61M token**（p25 3.15M / p75 11.07M / p90 17.63M / max 84.14M）——差 5.6 倍；
 *   · 单回合步数中位 **16**（p90 52，max 325）；每步上下文中位 **49.2 万 token**；
 *   · 拆开看：input 8.2k / cacheRead **6.58M** / output **14.2k** —— **99.6% 的流量是「上下文被重复读」**，
 *     模型真正写出来的字只占 **0.9%**。
 *   ⇒ 三个结论直接决定本表：
 *     1. 流量 ≈ **步数 × 每步上下文**。所以预算的主控量是**步数**，不是 token；
 *     2. 「让模型少写字」几乎省不了流量（0.9%），别把它当杠杆；
 *     3. 用户要求「自己给自己加减 10%」必须挂在**步数**上，且必须**按任务类**——
 *        全局中位数对 5.6 倍的类间差异毫无意义。
 *
 * 自适应的三条纪律（防棘轮 / 防刷指标）：
 *   · **只在「已验证完成」时减 10%**——没证据的「完成」不算，不减；
 *   · **只在「撞到预算墙」时加 10%**——失败/中断**不加**（否则一个坏构建就能把预算养肥，见 clamp）；
 *   · 无论怎么调，都夹在 **[min, max] × 该类中位步数** 区间内；样本不足 `minSamples` 时**只记账不动手**。
 */
export const BUDGET = {
  /** 计量单位：**一个 turn**（UserPromptSubmit → Stop）。 */
  unit: 'turn',
  /** 计量单位说明：预算按**工具调用次数**计（钩子能精确数、模型也能自己数）。 */
  counterUnit: 'tool-call',
  /** 一次结算的调整步长（用户口径：±10%）。 */
  adjust: 0.1,
  /** 夹紧区间：相对该类**中位调用数**的倍数（0.5×–2×）。棘轮的物理上限就在这里。 */
  clamp: { min: 0.5, max: 2 },
  /** 基线 = 该类最近 `window` 条样本的中位**工具调用数**（不用均值：单次 84M 的失控能把均值拉偏 ~50%）。 */
  window: 20,
  /** 少于这么多条样本 → 只记账，不调整、不刹车（数据不足时不动手）。 */
  minSamples: 5,
  /** 历史样本上限（数据管理：状态文件必须有界，超出丢最旧）。 */
  historyMax: 400,
  /** 提醒线：用到这个比例就在工具结果里回一句（不拦）。 */
  warnAt: 0.8,
  /** 两级刹车：`softAt` 起禁**取证类**工具；`hardAt` 起只留白名单（收尾路径）。 */
  softAt: 1,
  hardAt: 1.3,
  /** 每 N 次工具调用回一次「已用/剩余」（少打扰）。 */
  tickEvery: 5,
  /** 同一「工具 + 参数」重复到第几次判为原地打转。 */
  repeatAt: 3,
  /** 白名单：预算耗尽后**仍然允许**的工具——收尾与记账的路，绝不能被预算掐断。 */
  allowlist: ['budget', 'proof_dag', 'proof_oracle', 'todo_write', 'ask_user_question', 'skill', 'proof_graph'],
  /** 取证类工具：soft 刹车先掐这些（停止找新证据，先交出已有结论）。 */
  evidenceTools: ['read', 'glob', 'grep', 'bash', 'web_search', 'web_fetch', 'subagent', 'subagent_fork', 'workflow', 'task', 'jobs'],
  /**
   * 追加预算（回答「可以让模型自己加预算吗」）：
   * **可以，但走申请制 + 记债**——不能是自由旋钮，否则「压力」是假的。
   */
  topup: {
    /** 每任务最多申请次数。 */
    maxPerTask: 1,
    /** 批准额度 = 当前预算 × 该比例。 */
    grantRatio: 0.5,
    /** 理由的最短长度（要有实质内容，不是「继续」）。 */
    minReasonChars: 20,
    /** 记债：下个**已验证完成**的任务先按该比例扣回。 */
    debtRepayRatio: 0.1,
  },
  /** 墙钟上限（毫秒）：0 = 不限。防「步数没超但一步卡很久」。 */
  wallMs: { default: 1200000, chat: 180000 },
  /**
   * 任务分类（**顺序即优先级**，第一条命中即用）。
   * `calls` 是**先验**（不是实测值）：实测值由 `scripts/traffic-report.mjs --calibrate`
   * 写进 `~/.dsh/state/math-proof/budget-profile.json`，运行时以 profile 为准。
   * `requireReceipt`：这类任务的「完成」是否必须有机器证据才算数（chat/docs 本质上没有回执）。
   */
  classes: [
    {
      id: 'compile',
      label: '编译/类型错误修复',
      match: '编译|报错|类型错误|修(一下)?(这个)?(bug|错误)|InfectiveImport|UnsolvedConstraint|exit [1-9]|不通过|跑不过',
      calls: 30,
      requireReceipt: true,
    },
    { id: 'proof', label: '写/改形式化证明', match: '证明|定理|引理|形式化|Agda|postulate|证一下|补证|证完|invariant|同构', calls: 38, requireReceipt: true },
    { id: 'diagnose', label: '排查/审计/定位', match: '排查|为什么|为何|定位|诊断|根因|审计|核对|检查一下|复盘|怎么会', calls: 26, requireReceipt: false },
    { id: 'docs', label: '文档/报告/整理', match: '文档|说明|README|报告|注释|整理|成文|索引|maps?|发布说明', calls: 26, requireReceipt: false },
    {
      id: 'build',
      label: '实现/重构/批量改造',
      match: '实现|重构|迁移|新增|接入|改造|集成|批量|端到端|接上|跑通|落地|优化|升级',
      calls: 32,
      requireReceipt: true,
    },
    { id: 'chat', label: '短问答', match: '', calls: 6, requireReceipt: false },
  ],
  /** 一条都没命中时的兜底类 + 「算长任务」的字符数阈值（长提示词默认按 build 处理）。 */
  defaultClass: 'chat',
  longPromptChars: 60,
  /** 兜底：都没命中且提示词很长 → 按这个类走。 */
  longDefaultClass: 'build',
}

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

/**
 * **思考强度（reasoning effort）自动调节**——回答「让模型自动调节思考强度」。
 *
 * 先说实测（2026-09-10，本机 176 个有 usage 的回合，`scripts/traffic-report.mjs` 可复算）：
 *   · reasoning token 合计 **2.00M**，占全部流量 **0.12%**（中位回合里只占 0.078%）；
 *   · **高思考回合反而更省**：每步 reasoning ≥1000 的回合（n=20）步数中位 15.5、tok 中位 4.05M；
 *     每步 <300 的回合（n=75）步数中位 17、tok 中位 9.32M。
 *
 * ⇒ 所以本表**不是「省流量」的开关**（省不到），它是**「预算吃紧时强制收敛」的开关**：
 *   流量 ≈ 调用次数 × 每步上下文（99.6% 是上下文重复读），真正决定花销的是**还要跑多少轮**。
 *   预算过半后降一档思考，是为了让模型少绕路、早点交出结论，而不是为了少写几个思考 token。
 *
 * 安全规则（**必须逐条遵守，否则会把正常请求打挂**）：
 *   1. **只降不升**：绝不超过该类默认档（否则就成了「多想」旋钮，反而涨流量）；
 *   2. **看不懂就不动**：`next()` 给的 config 若没有 `reasoningEffort`（部署关了思考、或走别的适配器）
 *      → 原样返回，什么都不改；
 *   3. 适配器只认 `off|low|high|max`（实测 `dsh-llm-deepseek` 的 `reasoningEffort()` 会**抛错**），
 *      `off` 永远合法；`low/high/max` 要求部署开了思考；
 *   4. 任何不确定 → 返回原 config。**绝不因为调节思考强度让一次请求失败。**
 */
export const EFFORT = {
  /** 档位从「想得多」到「想得少」；`null` 表示不改（保持原样）。 */
  ladder: ['max', 'high', 'low', 'off'],
  /**
   * 按「已用预算比例」选档：命中第一条即用。
   * `ratio` 是**已用调用数 / 有效预算**（与刹车同一把尺子）。
   */
  rungs: [
    { atRatio: 0.85, effort: 'off', why: '预算 ≥85%：思考关掉，直接把结论与未完成项写出来' },
    { atRatio: 0.6, effort: 'low', why: '预算 ≥60%：降到 low，少绕路、先收敛' },
  ],
  /** 各类任务的**默认档**（预算宽裕时用；`null` = 不干预，尊重用户/会话设置）。 */
  classDefault: { chat: null, docs: null, diagnose: null, compile: 'high', proof: 'high', build: 'high' },
  /** 每步思考的实测中位（仅用于报表对照，不参与判定）。 */
  observedReasoningPerStepMedian: 346,
}

/**
 * **单次会话的 token 消耗预算**（回答「给会话加个百万 token 预算」）。
 *
 * 为什么单位是 **token** 而不是钱：DSH 不只对接 DeepSeek——MiMo / Qwen 等**积分制**服务没有
 * 「余额」接口，「钱」对它们没有意义；而 **token 用量是每个适配器都必须给的**（`assistant/message.usage`），
 * 是唯一能跨 provider 对齐的额度单位。钱只作为 DeepSeek 一家的补充信息（`impl/quota.mjs`）。
 *
 * 先看实测（2026-09-10，本机 26 个会话；每会话累计 `tok = Σ_回合(input+cacheRead+output)`）：
 *
 * | 口径 | 数值 |
 * | --- | --- |
 * | 单会话累计 tok | 中位 **1.25M**｜p90 **89M**｜max **832M** |
 * | 两个真实长会话 | **832M**（103 回合）、**707M**（41 回合） |
 * | 单回合 tok | 中位 **6.61M**、p90 17.63M |
 *
 * ⇒ **「100 万 token 一次会话」在这个负载下不成立**：中位会话已经 1.25M，而**单个中位回合**
 * 就是 6.61M——1M 的预算会在**第一次模型调用**里就撞线（连一次完整回合都跑不完）。
 * 所以默认值取 **5 亿**（≈ 实测最长会话的 60%，也 ≈ 75 个中位回合），并按「用法」而不是按口味：
 *   · 想当**成本闸**（防跑飞）：5e8 起；
 *   · 想当**上下文/单任务闸**：那本来就不是会话预算，用 `BUDGET`（按调用次数）更合适；
 *   · 真要 1M：`MATH_PROOF_SESSION_BUDGET=1M` 也能设，但要明白它会在第一次调用就停。
 */
export const SESSION = {
  /** 默认会话预算（token）。 */
  defaultTokens: 500_000_000,
  /** 提醒线（只提醒不拦）。 */
  warnAt: 0.8,
  /** 硬线：到线只留收尾白名单（与 `BUDGET.allowlist` 同一份）。 */
  hardAt: 1,
  /** 覆盖用的环境变量（支持 `1M` / `500M` / `1B` / 纯数字）。 */
  env: 'MATH_PROOF_SESSION_BUDGET',
  /**
   * ⚠ 已知滞后：硬线判定用「已闭合回合累计 + 最近一次读到的当前回合 tok」。
   * 当前回合的 tok 由 PostToolUse 每 N 次调用刷新一次（读日志有成本），
   * 所以**判定可能落后一个刷新周期**——宁可晚一点拦，也不要每一步都读日志。
   */
  staleByDesign: true,
}

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
