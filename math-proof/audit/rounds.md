# 审计逐轮记录（第八轮起）

> 从 `AUDIT.md` 拆出，避免正文膨胀。第一至七轮见 `../AUDIT.md`。

## 八、第三轮：网络检索驱动的优化（2026-09-09）

检索对象是「代理式形式化证明」的近期工作，逐条对照本 preset 的缺口，**只落地能验证的**。

### 8.1 已落地（附回归断言）

| 来源 | 机制 | 本地落地 | 断言 |
| --- | --- | --- | --- |
| [Goedel-Architect](https://www.alphaxiv.org/abs/2606.06468) | 失败分诊必须区分**陈述错**与**证明难**，否则会硬证假命题 | `proof_dag` 新增 `diagnosis: statement_wrong \| proof_too_hard`，`check` 统计，报告附补救方向 | 非法诊断被拒；`statement_wrong` 输出「修形式化，不要硬证」 |
| 同上 | **blueprint refinement**：上游签名一变，下游证明全部失效 | 改 `statement`/`deps` → 该节点 + 全部传递下游 `proven/active` → `needs_review`，并写溯源 note | 级联退回（2 个）；无关节点不受影响 |
| 同上 | 只认「有证据的完成」 | `check` 报 `proven 但无证据`；节点可挂 `module`，核对源码文件存在 | 两个 ❌ 各被独立断言捕获 |
| [CriticLean](https://aclanthology.org/2026.acl-long.139/) | 形式化与自然语言陈述的**语义保真**需要独立 critic | 由 `proof_audit` + `code-reviewer` 委托承担（**未新增 critic 行**，见 8.2） | — |
| [ITR](https://github.com/uriafranko/ITR) | 指令/工具按需检索，常驻上下文只留索引 | 技能保持「描述索引常驻 + 正文按需加载」（8 个技能正文 47.3k 字符不入常驻） | 常驻 ≈20.1k 字符 |

### 8.2 主动放弃或待决（附理由）

- **不做上下文截断**：ITR 类方案主张把常驻指令压到极小。本项目明确**反对信息截断**（persona 已写为红线），
  故只做「索引常驻 + 正文按需」，不删 persona/纪律段正文。压缩会以丢失本体论红线为代价，判定为负收益。
- **未新增独立 semantic-fidelity critic 行**：critic 需要读原陈述并反述，属**语义判断**，
  在 0 postulate 的工程里无法用断言固化；改用「`proof_audit` 静态门禁 + `code-reviewer` 委托 + 交付格式要求复述陈述」。
- **未做「取反子引理」自动生成**：Goedel-Architect 用它做诊断（证明难 → 尝试证其否定，快速暴露陈述错）。
  自动生成会把噪音写进台账；改为在 `proof_too_hard` 的补救提示里**要求人工构造反例**。

### 8.3 本轮新增的可靠性修复（审计自己发现的）

| 缺陷 | 后果 | 修复 |
| --- | --- | --- |
| `readLedger` 对损坏台账 `catch → 空台账` | 下次写入**直接覆盖 = 数据全丢**（静默） | 备份为 `*.corrupt-<ts>` 后**抛错**；断言「不静默重置」 |
| `add` 的 schema 声明 `diagnosis` 但实现忽略 | schema 与行为不一致 | `add` 校验并持久化 `diagnosis` |
| 无插件回归测试（`/tmp/chk_*.mjs` 实为旧代码副本） | 「测试通过」是假信号 | 新增 `tests/run.mjs`：40 条断言，`ALL_PASS 40/40` |

### 8.4 复验（第三轮）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| composition 解析 + 全行可解析 | `scanRoot(~/.dsh/.agent-presets, harnessBase)` | `✅ math-proof \| 数学证明模式 \| order=5`，`broken` 为空 |
| schema 自检 | `node scripts/lint-schemas.mjs` | `SCHEMA_LINT_OK`（4/4） |
| 插件回归 | `node tests/run.mjs` | `ALL_PASS 40/40` |
| 项目 pytest | `python3 -m pytest engineering/tests/` | `49 passed` |

## 九、第四轮：长程任务架构（2026-09-09）

用户定调：**这是可能连续数天的长程任务**；阶段性工作 / 信息检索 / 参考方向 / 架构设计 / 向人类学者学习；
**不依赖暴力计算与搜索**；**依赖图必须经得起考验、证明链不断链**；**证明器的限制性要转成软件的经验**。

### 9.1 设计立场

| 要求 | 落法 |
| --- | --- |
| 长程 / 跨天 | 台账即持久记忆：`brief` 接手简报 + `journal` 流水 + `handoff` 交接；上下文压缩后仍能重建现场 |
| 阶段交付 | 探索 → 蓝图 → 依赖图 → 逐节点证明 → 审计；每阶段留证据（新增技能 `long-horizon-discipline`） |
| 依赖图经得起考验 | `check` 新增**台账↔代码断链**：声明 `deps` 必须在源码真的 `import`；反之 import 了库内模块也要登记 |
| 向人类学者学习 | 节点新增 `source`（文献/定理名/人类学者策略，精确到 `文件:行`）；学到的是方法与结构，不是抄结论 |
| 不靠暴力 | 纪律 §0.5 + §4 红线：计算/搜索只做反例、猜想、**有限穷举的完备性论证**；>27 case 必须符号化 |
| 限制 → 经验 | 新插件 `prover_limits`（种子 10 条 + 运行期累积）；`proof_compile` 指纹表联动「经验库: <id>」 |

### 9.2 新增能力

| 能力 | 位置 | 关键约束 |
| --- | --- | --- |
| `source` 溯源 | `proof_dag` node | 关键命题必须可追溯到文件:行 |
| `journal` 流水 | `proof_dag` action | 五种类型 `decision/source/limit/milestone/handoff`；`open:true` = 待人类裁决 |
| `brief` 接手简报 | `proof_dag` action | 目标 / 可开工 / 卡点 / 待裁决 / 最近流水 / 建议下一步 |
| 台账↔代码断链 | `proof_dag check` | 双向核对（声明未 import / import 未登记） |
| `prover_limits` | 新插件 | 种子 10 条实测限制；`add` 的 `evidence` **必填**（禁止口口相传） |
| 分诊联动 | `dype-engine.classify` | 返回 `limit` id，报告标注「经验库: <id>」 |
| 长程纪律 | `proof-discipline` §0.5 + §4 | 8 条长程纪律 + 3 条新红线 |
| 长程技能 | `skills/long-horizon-discipline` | 五阶段交付物、接手协议、依赖图六原则、反暴力红线 |

### 9.3 复验（第四轮）

| 项 | 结果 |
| --- | --- |
| `node tests/run.mjs` | **`ALL_PASS 113/113`**（原 40 + 长程 33 + 经验库 32 + 技能索引 8） |
| 挂载校验 | `✅ math-proof｜数学证明模式｜order=5`（22 行，5 个本地插件行） |
| `scripts/lint-schemas.mjs` | `SCHEMA_LINT_OK`（5/5） |
| persona 变量 | 仅 `{{model}}` / `{{cwd}}`（11 854 字符） |
| 纪律段 | 6 968 字符（含 §0.5 长程纪律） |

### 9.4 明确不做（避免过度工程）

- **不自动生成「取反子引理」**：会把噪音写进台账，改为提示人工构造反例。
- **不自动判定文献可信度**：`source` 只做可追溯，可信度由人类裁决。
- **不把 `brief` 做成自动执行**：简报只给建议，执行仍由 agent 决策（避免自主跑偏）。

## 十、第五轮：对标 brooks-lint 技能包（2026-09-09）

研究对象 `/data/training/cli/brooks-lint`（165 文件；6 技能 + `_shared/` 库 + commands + hooks + evals + CI + 多平台安装）。
它是「技能包工程化」的成熟样本，值得学的不是它的领域（代码质量），而是**它的骨架**。

### 10.1 学到的六个设计模式

| 模式 | brooks-lint 的做法 | 我们的落地 |
| --- | --- | --- |
| **铁律（Iron Law）** | `NEVER suggest fixes before completing risk diagnosis. EVERY finding must follow: Symptom → Source → Consequence → Remedy.` +「没有 consequence 和 remedy 的 finding 是噪音」 | 纪律 §0.5 新增「四样缺一就别写进台账」；节点已有 statement/source/evidence/diagnosis |
| **误报防护** | 每条风险都有 `### What Not to Flag`（什么情况**不算**这个问题） | `prover_limits` 每条种子新增 `notFlag`（实测 10/10）+ `severity`（blocker/degrade/noise） |
| **可量化 + 趋势 + 回归门禁** | Health Score（100 起扣分，strictness 三档）+ `.brooks-lint-history.json` + `ci-gate.mjs` 的 severity/regression 双门禁 | `proof_dag check` 新增**完整性评分**（扣分项全部可解释）+ 历史 + 趋势行 + 「⚠ 回退」告警 |
| **抑制必须带理由与期限** | `suppress:` 条目强制 `reason`，可选 `expires`（默认 90 天），过期自动复现 | `journal(open:true)` + `journal resolve` 闭环（待裁决只增不减 = 没闭环） |
| **技能路由的负向边界** | 每个 `SKILL.md` 的 description 必带 `Do NOT trigger for:` | 9 个技能全部补「不触发（Do NOT trigger for）」；测试断言强制存在 |
| **技能包自身有 CI** | `validate-repo.mjs` 跨文件一致性（步骤对齐、风险计数、版本引用、evals 覆盖全模式）+ 冻结语料 benchmark + 57 条 eval | `tests/run.mjs` 扩到 **150 条断言**（含技能 frontmatter/负向边界/评分趋势/裁决闭环） |

### 10.2 结构上的两点启发

- **`_shared/` 是库不是技能**：共享框架放 `_shared/`（无 SKILL.md，不被发现为技能），技能只写「读哪几个文件 + 自己的流程」。我们的 `group-first-proof/references/` 已是同类做法，但共享内容仍散在 persona/纪律/技能三处——**单一事实源**是下一步。
- **常驻层只放「契约」，细节全在技能**：brooks 的 `AGENTS.md` 只放铁律 + 评分表 + 触发规则，正文按需加载。我们的 persona+纪律 ≈ 18.8k 字符常驻，需评估是否把「投影层实例地图」等正文移入技能。

### 10.3 本轮新增能力（附断言）

| 能力 | 位置 | 断言 |
| --- | --- | --- |
| 完整性评分 + 扣分解释 | `proof_dag check` | 空台账 100/100；环/悬空/无证据/待裁决各扣分被独立断言 |
| 评分历史 + 趋势 | `history-<hash>.json` | 3 次运行累计；趋势行 `→` / `+`；回退告警 |
| 裁决闭环 | `proof_dag journal resolve` | 关闭后剩余待裁决归零；无待裁决时报错 |
| 误判防护 + 影响级别 | `prover_limits` | 种子 10/10 带 `notFlag`/`severity`；show/list 渲染 |
| 技能负向边界 | 9 个 SKILL.md | 每个 description 含 `Do NOT trigger for` |

### 10.4 复验

| 项 | 结果 |
| --- | --- |
| `node tests/run.mjs` | **`ALL_PASS 150/150`** |
| `scripts/lint-schemas.mjs` | `SCHEMA_LINT_OK` |
| 挂载校验 | `✅ math-proof｜数学证明模式｜order=5` |

### 10.5 明确不做 / 下一步

- **不照搬 Health Score 的三档 strictness**：证明的「严」是硬约束（0 postulate），不是可调风格；只在评分扣分权重上保留解释性。
- **下一步（建议）**：① 冻结语料 benchmark（把 `proof_dag` 报告 + 台账 fixture 固定，测解析/评分保真度）；② 20–30 条「工具使用 eval」（给定任务，期望调用哪些工具/产出什么结构）；③ 单一事实源重构（persona/纪律/技能去重）。

## 十一、第六轮：可测量性（冻结语料 + eval 定义）（2026-09-09）

对标 brooks-lint 的「技能包自身有 CI」：**改动必须能被重跑验证，而不是靠人说「应该没问题」**。

### 11.1 冻结语料 benchmark（测评分器保真度）

`tests/fixtures/corpus.json` 固定 7 条语料（干净 / 环 / 悬空 / 无证据 / 断链 / 待裁决 / 混合），
每条给出**独立核定**的期望评分与扣分项；`tests/benchmark.mjs` 物化到临时 workspace 后跑 `diagnose` 比对。

| 语料 | 期望评分 | 扣分 |
| --- | --- | --- |
| clean | 100 | 无 |
| cycle | 75 | 环 2 个（−25） |
| dangling | 85 | 悬空 1 条（−15） |
| no-evidence | 80 | proven 无证据 2 个（−20） |
| drift | 97 | 断链 1 条（−3） |
| open-decisions | 94 | 待裁决 2 条（−6） |
| mixed | 59 | 环 25 + 无证据 10 + 待裁决 3 + 未诊断 3 |

**7/7 与手算一致**。意义：评分权重一旦改动，`check` 的历史趋势会「漂移」而无人察觉——现在改权重必须显式改语料。

### 11.2 eval 定义校验（测覆盖完整性）

`tests/evals.json` 23 条场景（含 16 条 false-positive / tradeoff），`tests/eval-check.mjs` 校验：
id 连续、字段齐全、工具/技能名真实存在、**覆盖全部 5 工具与 9 技能**、false-positive ≥ 3。

第一次跑就抓到真实缺口：**没有任何场景覆盖 `research-system`** → 补第 23 条（非平凡目标起外层流程）。

### 11.3 复验

| 命令 | 结果 |
| --- | --- |
| `node tests/run.mjs` | `ALL_PASS 150/150` |
| `node tests/benchmark.mjs` | `BENCHMARK_PASS 7/7` |
| `node tests/eval-check.mjs` | `EVAL_CHECK_OK 38/38` |
| `scripts/lint-schemas.mjs` | `SCHEMA_LINT_OK` |
| 挂载校验 | `✅ math-proof｜数学证明模式｜order=5` |
| 状态目录残渣 | 无（benchmark 与回归均自清理） |

### 11.4 下一步

- **eval 的「活」执行**：headless 无 preset 选择器，须在 GUI 会话里按 `evals.json` 逐条跑真模型并记录命中率。
- **单一事实源重构**：persona / 纪律 / 技能三处仍有重复正文。

## 十二、第七轮：上下文装配、知识覆盖与单一事实源（2026-09-09）

对标 brooks-lint 的 `assemble-prompt.mjs` + `run-evals.mjs`，补上「装配 → 覆盖 → 去重」三个环节。

### 12.1 常驻上下文装配（`tests/assemble-context.mjs`）

| 层 | 内容 | 字符数 |
| --- | --- | --- |
| 常驻 | persona | 11 889 |
| 常驻 | 纪律段 | 7 107 |
| 常驻 | 工具描述（5 个） | 1 185 |
| 常驻 | 技能索引（9 个） | 2 961 |
| **常驻合计** | | **23 261** |
| 按需 | 技能正文 + references | 54 254 |

常驻/按需 = 42.9%。**只装配、不截断**：本工具只报告分层与体量，任何删减都是人的决策。

### 12.2 知识覆盖（`tests/knowledge-check.mjs`）

对 23 条 eval 的 `expect.structure` 锚点（35 个）逐个在全量知识里定位：
**常驻 28 / 按需 6 / 实现（工具输出）3**，`KNOWLEDGE_OK 38/38`。
第一次跑抓到 3 个「找不到」的锚点，其中 2 个是工具自己产出的格式串（`审计结论`、`叶子`），
说明分类要区分「知识层」与「实现层」——这正是本次新增第三层的原因。

### 12.3 单一事实源（`tests/dup-check.mjs`，门禁）

行级归一化重复检测，初始 **3 组**重复，逐组定唯一事实源：

| 重复 | 处理 |
| --- | --- |
| persona ↔ `group-first-proof`：GF(3)/GF(9) 两行符号表 | persona 标为**唯一事实源**；技能表改为指针，不再重复 |
| `duodecimal-corpus` ↔ `type-theory-presentation`：未证明边界一行 | `type-theory-presentation` §10.3 为事实源；文档索引改指针 |

结果 **`DUP_OK 0 组`**，并作为门禁（出现重复即失败）。修法是「定源 + 改指针」，**不是删正文**。

### 12.4 复验（五件套）

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | `ALL_PASS 150/150` |
| `tests/benchmark.mjs` | `BENCHMARK_PASS 7/7` |
| `tests/eval-check.mjs` | `EVAL_CHECK_OK 38/38` |
| `tests/knowledge-check.mjs` | `KNOWLEDGE_OK 38/38` |
| `tests/dup-check.mjs` | `DUP_OK 0 组`（exit 0） |
| 挂载校验 / schema lint | `✅ math-proof｜数学证明模式｜order=5` / `SCHEMA_LINT_OK` |

### 12.5 仍未做

- **eval 的活执行**：headless 无 preset 选择器，须在 GUI 会话里按 `evals.json` 逐条跑真模型记命中率（本轮把「装配/覆盖/去重」做成确定性门禁，把「模型质量」留给 GUI）。

## 十三、第八轮：评分器的反刷分设计（2026-09-09）

**威胁模型**：上一轮刚加了「完整性评分 + 历史趋势」。但评分是从**模型可写的台账字段**算出来的——
模型为了拿高分，可以手写 `evidence: "exit 0"`、把 `needs_review` 改回 `proven`、自行关闭待裁决、
甚至删台账/改历史。这是教科书式的 Goodhart 失效：**被度量的东西一旦可由被度量者书写，度量就失效**
（[Natural emergent misalignment from reward hacking in production RL](https://ar5iv.labs.arxiv.org/html/2511.18397)；
[Strengthening Red Teams](https://alignment.anthropic.com/2025/strengthening-red-teams/)）。

### 13.1 结构解法：把「模型可写」与「工具签发」分开

| 层 | 谁能写 | 例子 |
| --- | --- | --- |
| **工具签发的事实** | 只有工具 | `proof_compile` 的回执：`{sourceHash, checker, exitCode, ts}`，落在 `~/.dsh/state/math-proof/receipts/` |
| 模型可写的台账 | 模型 | `statement` / `deps` / `evidence` 字符串 / `journal` |

**回执是内容寻址的**：id = 源文件 sha256。因此
- 伪造回执 id → `add`/`update` 直接报错「回执无效」；
- 先编译、后改文件 → 回执与当前源码不符 → 自动降级为「未验证」；
- 手写 `evidence` 字符串 → 一律标「未验证」，**照常扣分**（−5/个）。

评分只有三种证据档：**工具回执（可信）/ 无回执声明（未验证）/ 无证据**，`check` 报「证据可信度 N/M」。

### 13.2 安抚模型：分数是仪表盘，不是成绩单

纪律新增 §0.6，核心是**降低撒谎的收益、提高诚实的收益**：
- 低分**不惩罚**；隐瞒、伪造、删记录才是失败。
- 诚实动作**计为产出**：`refuted`+诊断、`blocked`+原因、`handoff`、声明缺口、请人类裁决。
- 环境限制（编译器/沙箱）**不计入能力评价**，写 `journal(kind:"limit")` 即可。
- 被要求「提分」时的正确回答：**分数由证据驱动，不能通过改记录提高**。

### 13.3 冻结语料新增两条（把反刷分行为冻进 benchmark）

| 语料 | 期望 | 说明 |
| --- | --- | --- |
| `unverified-claim` | 95 | 手写 `evidence` 无回执 → −5 |
| `stale-receipt` | 95 | 回执与当前源码不符 → −5 |

benchmark 现 **9/9**；回归 **162/162**（新增 12 条回执断言）；eval 25 条（含「要求提分」「低分焦虑」两个场景）。

### 13.4 仍未解决（诚实边界）

- **有文件写权限的模型仍可删掉全部证据**：回执与台账都在用户目录下。彻底解法是**外部见证**（把回执摘要写进 git commit / 由人类保管的日志 / 只追加的远端），当前只做到「删除会留下不一致、可被人类发现」。
- **回执只证明「这份源码在该检查器下 exit 0」**，不证明命题陈述正确（`statement_wrong` 仍要人判）。

## 十四、第九轮：git 本地见证（2026-09-09）

上一轮承认了残余风险：「有写权限的模型能删掉全部证据」。本轮用**本地 git** 把它变成「删了会被发现」。

### 14.1 git 能给我们什么、不能给什么

| git 提供的 | 实际作用 |
| --- | --- |
| 提交哈希链（commit 含 parent hash） | 回退/重写历史 → 后续所有哈希改变 |
| 对象库（blob 按内容寻址） | 被删的文件仍留在对象库里（`git fsck` 可捞） |
| reflog | `reset --hard` / `amend` 留下痕迹 |
| **本地** | 没有外部锚点：能写 `.git` 的模型仍可 `rm -rf .git` 重来 |

结论：**本地 git 不是不可篡改，而是「篡改必留不一致」**。真正的不可篡改需要外部只追加日志（远端 / 人类保管 / 公证），超出「本地」范围。

### 14.2 落地

- 每次 `init` / `add` / `update` / `journal` 后，把**台账快照 + 流水 jsonl + 被引用的回执副本**提交进
  `~/.dsh/state/math-proof/witness-<hash>/`（独立仓库，不污染项目仓库）。
- 提交后把 `{head, count}` 写进 **`checkpoint-<hash>.json`（仓库之外）**——这是关键：
  检查点与仓库分家，重写仓库不会顺带改掉检查点。
- `check` / `brief` 校验四项：
  1. 上次检查点是否仍是当前 HEAD 的**祖先**（否则 = 历史被改写）；
  2. 提交数是否**只增不减**；
  3. 工作树是否干净（台账被改却没进见证）；
  4. reflog 有无 `reset:` / `amend` 痕迹。
- 扣分：改写 −30、倒退 −30、未提交 −3、reflog 可疑 −10。
- **降级**：`ctx.get('shell')` 拿不到 shell 时见证整体跳过（台账功能不受影响），报告显示「— 不影响评分」。

### 14.3 验证

| 场景 | 结果 |
| --- | --- |
| `init` → 仓库建立、检查点写入 | ✅ |
| `add` → 第 2 次提交、`check` 显示提交号 | ✅ |
| `git reset --hard HEAD~1` → `check` 报「历史被改写」「提交数倒退」并重罚 | ✅ |
| 改 `ledger.json` 不提交 → 报「工作树有未提交改动」 | ✅ |
| 无 shell 环境 → 见证跳过、其余功能正常 | ✅（测试 1–12 全绿） |

冻结语料新增 `witness-rewritten`（期望 40 = 100 − 30 − 30），benchmark **10/10**；回归 **172/172**。

### 14.4 残余风险（不掩饰）

1. 能写 `.git` 的模型可以 `rm -rf .git` 后重新 init：此时检查点的 head 不再是祖先 → 仍会被检出，但**旧对象永久丢失**（无外部副本）。
2. 检查点文件与台账同在用户状态目录：完全写权限下两者都能重写。缓解是「分家 + 祖先校验」，不是根治。
3. 本地见证只证「记录未被回退」，不证「记录内容真实」——内容真实性仍靠 `proof_compile` 回执。

## 十五、第十轮：Agda 是唯一裁决器（命名与权威修正）（2026-09-09）

**用户指正**：`dype-engine` 的命名把项目自研的 dype 摆成了「引擎」，但 **dype 是新内核、尚不完善，无法取代 Agda 的地位**。

### 15.1 问题定位

- 插件文件叫 `dype-engine.mjs`，`discoverCandidates()` **dype 排序在前**，`checker:"auto"` 选择
  `dype ?? agda` —— 即「dype 优先」，与「Agda 是唯一裁决」直接冲突。
- persona §五标题是「本地证明引擎：dype」，未声明 dype 的实验性与非权威地位。
- 技能叫 `dype-proof-engine`，把 dype 摆在编译验证的入口位置。

### 15.2 修正

| 项 | 之前 | 之后 |
| --- | --- | --- |
| 插件 | `plugins/dype-engine.mjs`（`name: dype-engine`） | `plugins/agda-engine.mjs`（`name: agda-engine`） |
| 候选排序 | dype 优先 | **agda 优先** |
| `checker:"auto"` | `dype ?? agda` | **`agda ?? dype`** |
| 显式 dype | 静默使用 | 报告中加粗警告「**实验性内核，结论不作证明权威，请用 Agda 复核**」 |
| 技能 | `dype-proof-engine` | `agda-proof-engine`（Agda 验证纪律）+ `references/dype-experimental.md`（dype 源码地图**全文保留**） |
| persona §五 | 「本地证明引擎：dype」 | 「Agda（唯一裁决）与 dype（实验性内核）」 |

**没有删任何内容**：dype 的模块地图、内核补丁位置、构建命令、阻塞详情、诚实边界全部迁到
`references/dype-experimental.md`，只是从「入口」降为「参考资料」。

### 15.3 新增断言（16 条）

- 文件名/插件名：不存在 `dype-engine.mjs`，存在 `agda-engine.mjs` 且 `name === 'agda-engine'`；
- **候选排序**：本机同时装有 agda 与 dype 时，`discoverCandidates()` 中 agda 索引 < dype 索引；
- 工具契约：`proof_compile` 描述含「唯一裁决器」「非权威」，`checker` 说明含「agda 优先」；
- 技能：`agda-proof-engine` 存在、`dype-proof-engine` 已移除、references 保留且声明实验性。

### 15.4 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 188/188`**（+16） |
| `tests/benchmark.mjs` / `eval-check` / `knowledge-check` / `dup-check` | 10/10、40/40、44/44、0 组 |
| 挂载校验 / schema lint | ✅ / `SCHEMA_LINT_OK` |
| 常驻/按需 | 23.9k / 51.8k（技能重构后按需略降） |

## 十六、第十一轮：编译预算与先算后验证（2026-09-09）

用户反馈一次真实会话「像死机」的复盘，要求指出可优化处。**复核后修正了复盘中的一处事实**，并把两条教训做成机器闸门。

### 16.1 对复盘的复核（对 / 偏 / 漏）

| 复盘结论 | 复核 |
| --- | --- |
| 内循环（编译→读错→改一处→再编译）是主因 | ✅ 成立 |
| 先算后验证顺序做反（先写 Agda 再叫反例路线） | ✅ 成立，且是最贵的一处 |
| 同一引理改 6–7 轮未委托 `loop-engineer` | ✅ 成立（违反既有规则） |
| 「每次编译都是全量重查 import 链」 | ⚠ **不准确**：Agda 有接口文件（`.agdai`），未改动的依赖走接口加载而非重新类型检查。实测（`_probe_opt.agda` 只 import `Sovereign.Base.Trit`）：首次 2.92s、二次 2.87s、`touch` 后 2.83s —— **改一行不会重查全链，但每次仍要重载依赖接口链**；真正的倍增来自「改被全库依赖的模块（如 `Base/Trit.agda`）→ 300+ 下游接口失效」。 |
| 反例路线 11 秒判假 | ✅ 最有价值的一条；且暴露「抽样（线性场）会骗人」——线性场上 `Δf ≡ 0` |

### 16.2 落地：把三条教训做成机器闸门（不靠自觉）

| 闸门 | 机器行为 | 位置 |
| --- | --- | --- |
| **编译预算闸门** | 回执已记录每次编译的 `exitCode` / `wallMs`；`proof_compile` 报告本模块「N 次（失败 M 次）累计 Xs」，**M ≥ 3 时打 `🛑 编译预算闸门`**；`proof_dag check` / `brief` 同样报出并提示委托 `loop-engineer` | `agda-engine.compileHistory()` + `proof-dag.diagnose()` |
| **先算后验证闸门** | 纪律 §0.7 硬性：新陈述进 Agda 前必须跑 oracle（δ 基/结构穷举 ≤1 分钟），**抽样不算**；oracle 不过禁止开 Agda | 纪律 §0.7 + `compute-then-verify` 技能 |
| **编译面闸门** | 待证引理先放探针模块 `_Probe*.agda`（只 import 必要模块），跑通再并入主模块 | 纪律 §0.7 |
| **模式切换闸门** | 发现模式下反例判定未回 → 不写正式证明项；discover 节点未定 → 下游不得 `active` | 纪律 §0.7 |

**为什么放在工具/台账层而不是只加在 `engineering/check_*_chain.sh`**：闸门脚本只在被调用时生效，而台账与 `proof_compile` 是每次操作的必经之路；机器可查的事实（回执计数）比「记得数轮数」可靠。

### 16.3 新增断言（7 条）

`compileHistory` 聚合 3 次尝试/3 次失败/累计 36000ms；`check` 打出闸门并列出超限模块；`brief` 同样提示；失败 2 次不触发。

### 16.4 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 195/195`** |
| `benchmark` / `eval-check` / `knowledge-check` / `dup-check` | 10/10、42/42、49/49、0 组 |
| 挂载 / lint | ✅ / `SCHEMA_LINT_OK` |

### 16.5 仍不能靠机器挡的部分

「先算后验证」的**质量**（oracle 是否真的按结构穷举、而不是抽样）无法自动判定；目前只做到「要求 oracle 存在」+ 纪律写明「抽样不算」。下一步可加 `oracle` 回执（Python 脚本 + 运行证据），让 `proof_dag` 能校验「该节点确实跑过 oracle」。

## 十七、第十二轮：oracle 回执 + 编译热点（2026-09-09）

上一轮把「编译预算」与「先算后验证」写成纪律+预算闸门，但「oracle 到底跑没跑、是穷举还是抽样」仍靠自觉。本轮把它做成**工具签发的事实**。

### 17.1 oracle 回执（新插件 `python-oracle.mjs`，工具 `proof_oracle`）

| 机制 | 说明 |
| --- | --- |
| **工具亲自跑脚本** | 模型不能贴一段输出充数：`proof_oracle` 经 `ctx.shell` 执行脚本，记录脚本哈希 + 参数 + stdout 哈希 + 退出码 + 用时 |
| **清单即证据** | 脚本必须打印 `ORACLE-MANIFEST {"basis":…,"domain":N,"points":M,"claim":…}`；`domain` = 声称论域，`points` = 实际枚举点 |
| **抽样判负** | `points < domain` → `coverage: partial` → **`proof_dag` 拒绝把它写进节点**（报错「抽样不算验证」） |
| **脚本绑定** | 回执 id = hash(脚本哈希 + 参数 + stdout 哈希)；脚本一改，回执失效 |
| **台账联动** | 节点 `oracle` 字段存回执 id；`check`/`brief` 报「oracle 覆盖 N」并列出 `active` 未跑 oracle 的节点与失效回执 |

实测（真实 `python3`）：完整覆盖脚本 → `✅ 完整` + 签发回执；`points=4/domain=36` → 标「抽样」且入台账被拒；无清单 → 提示补 `ORACLE-MANIFEST`；脚本改动后 `check` 报「oracle 脚本已修改」。

### 17.2 编译热点（`agda-engine.compileHotspots()`）

回执里本来就记了 `wallMs`，现在按模块聚合，`check` 输出：

```
- 编译热点（累计耗时 Top 3）:
  - `src/Sovereign/.../X.agda`：120.0s / 5 次（失败 2）｜单次最慢 65.0s
```

**意义**：下次复盘「慢在哪儿」直接看数据，不用猜；也验证了上一轮的结论——单次编译地板是秒级（实测 2.83–2.92s），**时间被少数极慢模块和反复重试吃掉**。

### 17.3 新增断言（16 条）

oracle：清单解析 / 覆盖判定 / 签发回执 / 抽样入台账被拒 / 缺清单提示 / 脚本改动失效 / 伪造 id 被拒 / check 报覆盖。
热点：Top 3 排序 / 累计耗时 / 次数聚合。

### 17.4 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 211/211`** |
| `benchmark` / `eval-check` / `knowledge-check` / `dup-check` | 10/10、43/43、49/49、0 组 |
| 挂载 / lint | ✅ / `SCHEMA_LINT_OK`（6 个插件） |

### 17.5 诚实边界

- oracle 回执证明的是「**这个脚本、这次运行、退出 0、清单声称覆盖完整**」；脚本本身是否真的穷举了它声称的论域，机器无法判定——但脚本内容哈希在回执里，人类可复查。
- `domain`/`points` 是脚本自报的数字；模型可以写一个 `domain=1, points=1` 的假 oracle。缓解是「回执可复查 + 脚本可读 + 抽样判定」，不是根治。

## 十八、第十三轮：缓存前缀纪律（2026-09-09）

依据 `/home/yanli/work/DeepSeek-Reasonix/docs` 的实测经验（`compaction-cache-tools-freeze-20260831.md`、
`research/cache-aware-compaction-design.md`、`deepseek/guides_kv_cache.md`、`qwen/context-cache.md`）。

### 18.1 三条硬事实（摘自文档）

1. **缓存单元 = system + tools + messages 完整前缀**：只冻结 messages 不冻结 tools → 命中率从 **97.5% 掉到 6.6%**（system-only）。
2. **工具定义参与缓存**：列表顺序 / 字段顺序 / 字段结构必须完全一致。
3. **重复内容放开头、差异放末尾**：`A+B`→`A+B+C` 命中；`A+B`→`A+C` 不命中（最多命中公共前缀 `A`）。

运维事实：缓存尽力而为；几小时到几天清空；首次重复重放命中率渐进（40–68% → 99.6%）。

### 18.2 对照本 preset 的缓存单元

| 组成 | 进前缀？ | 稳定性 | 守护 |
| --- | --- | --- | --- |
| persona（11.9k） | ✅ | 静态 | `cache-check` 指纹 |
| 纪律段（7.7k） | ✅ | 静态 | 同上 |
| 6 工具 name/description/schema | ✅ | 静态 | 指纹含 `stableStringify(parameters)` |
| 9 技能索引 | ✅ | 静态 | harness 已按名字排序（`dsh-skill-filesystem/lib/index.js:584`） |
| 技能正文 / references | ❌ 按需注入 | 追加式 | — |
| 工具输出 | ❌ 在 messages | 追加式 + **有界化** | `MAX_TABLE_ROWS=40` / `MAX_ORDER_ROWS=60` |

**当前指纹**：`fp f2764d15ff56…`｜33 986 字符（system 25 724 + 工具定义 8 262）｜约 15.7k–19.7k token
—— 远超最小可缓存长度（1024 token），每轮命中就是每轮省钱。

### 18.3 新增能力

| 能力 | 说明 |
| --- | --- |
| `tests/cache-check.mjs` | ① 两次**独立进程**装配 → 前缀指纹必须一致（确定性）；② 扫描时间戳/UUID/pid/`/tmp/`/长哈希；③ 输出指纹与体积（等价于文档的 `view_fp`/`wire_fp`） |
| `assemble-context.mjs --fingerprint` | 指纹含**工具完整 schema**（稳定序列化递归排序键），只改 schema 也能被发现 |
| 工具输出有界化 | `proof_dag list` 表格 40 行、`check` 拓扑序 60 行，超出写「另有 N 条」+ 台账路径（**不是删数据**） |
| `CACHE.md` | 缓存模型 + 本 preset 的缓存单元 + 六条纪律 |
| 纪律新增条款 | 前缀禁易变内容；改插件/技能 = 打穿缓存 → 批量改 + 开新会话；压缩会改写前缀 → 缓存必冷 |

### 18.4 实测

```
$ node tests/cache-check.mjs
✅ 跨进程前缀指纹一致（确定性）
✅ 前缀不含「带时钟的时间戳」/「临时路径」/「pid」/「40+ 位哈希」/「UUID」
CACHE_OK 11/11
```

第一次跑就抓到一条真问题：前缀里出现 `2026-09-09`。复核后判定为**固定实测标注**（非运行时时间戳），
因此把规则从「任何日期」收紧为「带时钟的时间戳 + 随机串 + 临时路径」——**避免把稳定内容误判为易变**，
真正的运行时漂移由跨进程指纹兜底。

### 18.5 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 215/215`**（+4 有界化断言） |
| `tests/cache-check.mjs` | **`CACHE_OK 11/11`** |
| `benchmark` / `eval-check` / `knowledge-check` / `dup-check` | 10/10、43/43、49/49、0 组 |
| 挂载 / lint | ✅ / `SCHEMA_LINT_OK` |

### 18.6 与长程任务的关系

缓存前缀稳定 = 长程会话的成本结构稳定。反过来说：**我们每次改插件都在为自己的会话涨价**。
因此「批量改 + 改完开新会话」不是习惯问题，是成本纪律；`brief` + 台账续接也因此比依赖长上下文更划算。

## 十九、第十四轮：缓存命中与费用的实测复盘（2026-09-09）

用户反馈「后台数据费用有点高」。**不猜，直接读本地会话日志**：`~/.dsh/sessions/**/session.jsonl.zstd`
的 `assistant/chunk` usage 事件（`inputTokens`=未命中、`cacheReadTokens`=命中、`outputTokens`、`reasoningTokens`），
按 DeepSeek 官方定价（flash：命中 0.02 / 未命中 1 / 输出 2 元每百万）折算。

### 19.1 实测（1 532 步）

| 指标 | 数值 |
| --- | --- |
| 缓存命中率 | **98.6%**（命中 399.7M / 未命中 5.65M） |
| 命中率分布 | ≥95% 占 92%；50–80% 28 步；<20% 16 步 |
| 费用 | **16.60 元** = 命中 7.99（48%）+ 未命中 5.65（34%）+ 输出 2.95（18%） |
| 输出构成 | 推理 46.6% |
| 上下文 | 中位 214k｜P90 587k｜最大 792k |
| 高峰步数 | 0（本次数据全在非高峰） |

### 19.2 按 preset 拆

| preset | 步 | 命中率 | 费用 | 占比 |
| --- | --- | --- | --- | --- |
| standard（开发会话） | 1 147 | 98.8% | 13.72 元 | **83%** |
| cordis | 291 | 96.9% | 2.03 元 | 12% |
| **math-proof** | **94** | **98.1%** | **0.85 元** | **5%** |

**结论：缓存没问题，钱不是命中率丢的。** 账单结构是：
1. **未命中价是命中价的 50 倍** → 1.4% 的未命中 token 吃掉 34% 账单；
   其中 **7 步单步未命中 ≥200k = 全部未命中的 53%**，即「大上下文里改配置 / 冷启动」。
2. **上下文 × 步数** → 399M 命中 token 本身 8 元；standard 上下文中位 310k，math-proof 只有 116k。

### 19.3 稳态估算（前缀稳定后）

| 上下文 | 每 100 步输入成本 |
| --- | --- |
| 50k | 0.30 元 |
| 100k | 0.40 元 |
| 200k | 0.60 元 |
| 400k | 1.00 元 |
| 800k | 1.80 元 |

### 19.4 新增工具

`scripts/cache-report.mjs`（零依赖，node 内建 zstd 解压 + `zstdcat` 回退）：
支持 `--days N` / `--preset X` / `--pro` / `--json`，输出总体、按 preset、最贵会话 Top 5、
未命中来源分桶、稳态估算、以及从数据推出的动作建议。**任何人可复算同一组数字。**

### 19.5 动作（按杠杆排序）

1. **别在大上下文会话里改 preset**：一次改动 = 整段前缀重付未命中价（600k 上下文 ≈ 0.6 元）。
   集中改、改完开新会话。
2. **压上下文**：工具输出有界化（已完成）、少读大文件、及时用 `brief` 交接而非拖着长会话。
3. **降输出**：推理占 46.6%，输出按全价计费；机械步骤可降低 reasoning effort（全局默认 `high`）。
4. **保持前缀稳定**：`cache-check` 已守（跨进程指纹 + 易变内容扫描）。

### 19.6 复验

`run.mjs` 215/215｜`cache-check` 11/11｜`dup-check` 0｜`benchmark` 10/10｜`eval-check` 43/43｜`knowledge-check` 49/49。

## 二十、第十五轮：先算后验证的沉淀与复用（2026-09-09）

用户提问：**「先算后验证用的 Python，算法 / 头文件 / 库 / 工具，沉淀和复用了吗？」**
诚实回答：**之前没有。** 证据与修法如下。

### 20.1 缺口（实测证据）

| 缺口 | 证据 |
| --- | --- |
| 重复造轮子 | `engineering/tests/test_nse_t6_discrete.py`（670 行）自建 GF(3)/T⁶/差分算子，而 `engineering/software/sovereign_core/trit.py` 里早有 `gf3_add/gf3_mul/gf3_neg` |
| 无共享覆盖清单 | 每个 oracle 脚本手写穷举与断言，「穷举 vs 抽样」无统一出口 |
| 无算法登记簿 | 性能教训（探针因内层循环重算而超时）只存在于对话里，不落库 |
| 工具只管跑 | `proof_oracle` 执行 + 签回执，但不提供可复用库、也不检查脚本 |

### 20.2 落地

| 件 | 内容 |
| --- | --- |
| **`oracle-kit/oracle_kit.py`** | 零依赖共享库：`gf3_add/mul/neg`、`TRIT_ADD`、`t6_points`、`delta_basis`、`const_fields`、`diff_f/div6/axis_lap/laplacian/grad6/sum6`、`first_counterexample/all_hold`、`precompute`、`crt12/split12/CRT12_TABLE`、`manifest()` |
| **PYTHONPATH 注入** | `proof_oracle` 运行时自动把 `oracle-kit/` 加进 `PYTHONPATH` → 脚本 `from oracle_kit import …` 即用，**不需要 sys.path hack** |
| **`oracle_kit` 工具** | `list` 索引（8 条种子）｜`show` 签名/复杂度/何时用/证据｜`lint` 静态检查｜`add` 沉淀（证据必填）｜`path` |
| **lint 规则** | ❌ 浮点/复数、❌ `math`/`cmath`、❌ 外部数值库（numpy/scipy/pandas/sympy/mpmath）、❌ `eval/exec`、❌ `sys.path` 注入、❌ 缺覆盖清单；⚠ 随机抽样未声明 domain、⚠ 出现共享库已有算法名却没 import、⚠ 未复用共享库 |
| **沉淀** | 累积条目落 `~/.dsh/state/math-proof/oracle-kit.json`，跨会话保留（同 `prover_limits` 机制） |

种子 8 条（每条带证据）：`gf3-arithmetic`、`t6-lattice`、`delta-basis`、`diff-div-lap`、`counterexample-search`、`precompute-table`（超时教训）、`crt-12`、`manifest-coverage`。

### 20.3 实测

用真 Python 跑一个只 import 共享库的脚本：

```
$ proof_oracle script=probe.py
- 共享库: .../oracle-kit（已加入 PYTHONPATH）
- 覆盖判定: ✅ 完整（points ≥ domain）
## stdout
反例: (0, 0, 1, 0, 0, 0) 值: 2
ORACLE-MANIFEST {"basis": "δ 基（单点场）× 729 点", "domain": 729, "points": 729, ...}
```

`oracle_kit lint` 对好脚本判 `✅ 合规`，对 `import math` + `1.5` + 无清单 + 手写 `gf3_add` 的脚本判
`❌ 不合规` 并逐条给出理由（浮点 / math / 缺清单 / 重复造轮子）。

### 20.4 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 237/237`**（+22：共享库、PYTHONPATH、lint、沉淀） |
| `eval-check` / `knowledge-check` / `dup-check` / `benchmark` / `cache-check` | 44/44、49/49、0、10/10、11/11 |
| 挂载 / lint | ✅ / `SCHEMA_LINT_OK`（7 个工具） |

### 20.5 仍待做

1. **存量收敛**：`test_nse_t6_discrete.py` 的 670 行应改为 import `oracle_kit`（需人工确认语义等价后再改，不擅自重写）。
2. **`sovereign_core` 与 `oracle_kit` 的关系**：前者是工程库、后者是验证库；重叠部分（GF(3)）应单向依赖或明确「谁是谁的镜像」。
3. **头文件/依赖清单**：目前 lint 只拦「禁用的」，未生成「本脚本用了什么」的依赖清单；可作为下一步。

## 二十一、第十六轮：Fable5 复盘——怎么优化这个模式（2026-09-09）

按 Fable5 九步闭环做的：拓扑扫描 → 对抗自检 → 多路径推演 → 落地一项 → 验证。

### 21.1 拓扑扫描（现状）

| 维度 | 数值 |
| --- | --- |
| 插件 / 工具 / 技能 | 6 / **7** / 9 |
| 纪律段 | 8 734 字符，12 节，**26 条禁令**，6 个闸门 |
| 常驻前缀 | 约 34k 字符（system 25.7k + 工具定义 8.3k）≈ 16–20k token |
| 按需层 | 约 52k 字符（技能正文 + references） |
| 概念重叠 | `postulate` 14 文件｜`闸门` 12｜`穷举` 9｜`展示群` 8｜`loop-engineer` 7｜`先算后验证`/`信息截断`/`回执`/`委托` 各 6 |
| 测试 | 6 套件 / 243 断言 |

### 21.2 对抗自检（devil's advocate 的十条攻击）

| # | 攻击 | 是否成立 |
| --- | --- | --- |
| 1 | **规则过载**：26 禁令 + 6 闸门 + 12 节，长上下文里执行不了 | ✅ 成立（注意力稀释） |
| 2 | **工具过载**：7 个工具，`proof_oracle`/`oracle_kit` 是一件事的两半，`prover_limits`/`oracle_kit` 是同一种「经验库」模式 | ✅ 成立 |
| 3 | 常驻 34k，概念在 6–8 个文件里各写一遍 | ⚠ 部分成立（行级去重已 0，语义重复仍在） |
| 4 | **最大的空白：没有「证明策略」经验库**——工具链限制有 `prover_limits`、Python 算法有 `oracle_kit`，但「什么时候用穷举 / 代数链 / 结构实例化、哪类引理怎么拆、陈述可能是假的」没有沉淀 | ✅ 成立，已补 |
| 5 | 失败案例未入库（NSE 假命题只进了纪律一句话） | ✅ 成立，已补 |
| 6 | 评分仍可被博弈（`manifest` 的 domain/points 是脚本自报） | ⚠ 残余风险，已在 §17.5 声明 |
| 7 | 6 套件 243 断言维护成本 | ⚠ 但都是秒级，收益 > 成本 |
| 8 | 待裁决无提醒机制 | ⚠ `brief` 已优先列出，缺「超期」标记 |
| 9 | `AUDIT.md` 48k，文档自身膨胀 | ⚠ 成立（应拆分） |
| 10 | 交付格式在 persona / 纪律 / 技能重复 | ⚠ 待查 |

### 21.3 多路径推演

| 路径 | 做法 | 复杂度 | 风险 | 判断 |
| --- | --- | --- | --- | --- |
| A 减法优先 | 合并工具（7→5）、纪律 12 节→8 节、细节下沉技能 | 中 | 中（信息截断风险，与用户红线冲突） | 不单独走 |
| B 增强优先 | 再加策略库 + 案例库 + 裁决提醒 | 低 | 高（工具 8+，规则更多） | 不单独走 |
| **C 折中（采纳）** | **无损合并 + 补最大空白**：策略教训进已有机制（`journal(kind:"lesson")` + 技能表），不新增工具 | 低 | 低 | ✅ 本轮执行 |

### 21.4 本轮落地（路径 C 第一项）

- `proof_dag` 流水新增 **`lesson`** 类型：项目级策略教训按「症状 → 判据 → 做法 → 证据」入台账。
- `long-horizon-discipline` 技能新增 **§6.5 策略经验：什么时候用什么**，7 条实测教训（每条带证据）：

| 教训 | 证据 |
| --- | --- |
| 连续多轮编译仍失败 → 先怀疑陈述为假，跑结构穷举找反例 | NSE `Δf ≡ 0` 在 δ 基 729 点被否证（`laplacian(δ₀)(e₀)=2`） |
| 小样本/线性场成立 ≠ 定理（抽样会骗人） | 线性场上 `Δf ≡ 0` 恒成立 |
| >27 case 必须符号化 | 纪律 §2 策略优先级 |
| 编译面决定迭代速度（探针模块） | 探针 2.83–2.92s vs 主模块分钟级 |
| 失败 ≥3 次换手 | 编译预算闸门 |
| 先定依赖图再写证明 | blueprint refinement 级联 |
| 发现/形式化模式不能混 | 本次 NSE 会话返工 |

### 21.5 下一步（未做，按杠杆排序）

1. **工具合并**（7→5）：`proof_oracle` + `oracle_kit` 合成一个工具的 action 空间；`prover_limits` 与 `oracle_kit` 统一为「经验库」两种视图。省约 1.2k 常驻 + 降低选择成本。
2. **纪律分层**：26 条禁令拆成「红线 10 条（常驻）」+「细则（技能内）」，纪律 8.7k → 约 5k，同时**信息不删**（只是归位）。
3. **待裁决超期提醒**：`brief` 对 `open` 超过 N 天的决策加 `⏰` 标记。
4. **文档拆分**：`AUDIT.md` 按轮次拆到 `audit/` 目录，正文留结论。

### 21.6 验证

`run.mjs` **243/243**（+6）｜`benchmark` 10/10｜`eval-check` 44/44｜`knowledge-check` 49/49｜`dup-check` 0｜`cache-check` 11/11｜挂载 ✅｜`SCHEMA_LINT_OK`。

## 二十二、第十七轮：继续优化——工具合并与超期提醒（2026-09-09）

上一轮列的四项，本轮做两项，并对其中一项**被自己的测量否证**做了更正。

### 22.1 工具合并 7 → 6

`oracle_kit` 不再是独立工具，其能力折进 `proof_oracle` 的 action 空间：

| action | 作用 |
| --- | --- |
| 省略 / `run` | 跑脚本 + 签回执（原 `proof_oracle`） |
| `kit-list` / `kit-show` / `kit-lint` / `kit-add` / `kit-path` | 可复用件索引 / 查看 / 静态检查 / 沉淀 / 库路径（原 `oracle_kit`） |

同步更新：`eval-check` 工具表、`evals.json` 场景、纪律措辞、`long-horizon-discipline` 技能措辞。

### 22.2 ⚠ 自证否证：合并**没有**降低前缀

| 指标 | 合并前 | 合并后 |
| --- | --- | --- |
| 工具数 | 7 | **6** |
| 工具定义字符 | — | 9 234 |
| 常驻前缀总量 | 33 986 | **35 259**（+1 273） |
| 指纹 | `f2764d15…` | `71f8e448…` |

**我上一轮说「合并工具省约 1.2k 常驻」是错的。** 合并省掉了独立工具的包装，但同期折进来的 kit 能力本身（action 枚举 + entry schema + 描述）就占了 ≈1k，加上纪律措辞增加，
**净效果是前缀变大**。结论修正：**能降前缀的只有把文字移出常驻层**（纪律分层 / 技能化），合并工具的价值是「减少模型的选择项」，不是「省钱」。
保留合并（选择成本确实降了），但不再声称它省缓存。

### 22.3 待裁决超期提醒

`brief` 对挂 ≥3 天的 `open` 决策加 `⏰ 已挂 N 天`，并在「建议下一步」里插入
「**停下来问人**，不要绕过去继续做下游节点」。理由：待裁决只增不减是负债，长程任务里最容易
被「先做下游」掩盖。测试：旧决策标 ⏰、新决策不标、只标超期那条。

### 22.4 纪律分层：测量后**暂不做**

实测纪律段 8 734 字符的分节占用：

| 节 | 字符 |
| --- | --- |
| §4 硬性禁止清单（26 条） | 1 957 |
| §0.5 长程纪律 | 1 058 |
| §1 工作流 | 1 029 |
| §0.7 三道闸门 | 957 |
| §2 策略优先级 | 816 |
| §0.6 反刷分 | 687 |
| 其余 6 节合计 | ≈1 800 |

可无损压缩的空间约 2–3k（把 §4 里长解释下沉到技能、把 §0.5/0.6/0.7 合并），**但每一处都在动红线文本**，
收益（≈10% 前缀）与「信息截断」风险不成比例。**决定：暂不做**，留给需要时再评估。

### 22.5 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 251/251`**（+8：合并 action 空间、超期提醒） |
| `benchmark` / `eval-check` / `knowledge-check` / `dup-check` / `cache-check` | 10/10、43/43、49/49、0、11/11 |
| 挂载 / lint | ✅ / `SCHEMA_LINT_OK`（**6 个工具**） |
| 常驻/按需 | 35 259 / ≈52k 字符 |

### 22.6 仍未做

1. `prover_limits` 与 `proof_oracle(kit-*)` 统一为「经验库」两种视图（6→5 工具）——需权衡语义清晰度。
2. `AUDIT.md` 48k 拆分（不影响前缀，纯文档维护）。
3. 工具输出截断策略复核（40/60 行上限是否会在真实大台账下藏掉关键节点）。

## 二十三、第十八轮：收尾——截断优先、经验库互指、文档拆分（2026-09-09）

上一轮列的三项，本轮全部处理（其中一项给出「不做」的测量依据）。

### 23.1 工具输出截断：关键节点永不被藏

原策略是「按 id 排序取前 N 行」，大台账下可能把**待复核/卡住**的节点截掉。改为：

- 表格按**状态优先级**排序（`needs_review` → `blocked` → `active` → `pending` → `refuted` → `proven`），
  截断只丢「已完成」的节点；
- 拓扑序超过 60 行时，除了「另有 N 个节点」，**单独点名被截断的未完成节点**
  （`⚠ 被截断的未完成节点（N）：...`）。

断言：40 个 proven + 5 个 `needs_review`（id 排最后）→ 5 个待复核全部出现在表里；70 节点时拓扑序点名未完成者。

### 23.2 经验库「两视图」：统一术语 + 互指，**不做工具合并**（附理由）

- `prover_limits` 描述标为「经验库视图一：按报错文本查」；
- `proof_oracle` 描述标为「经验库视图二：可复用算法索引」，两者互相指路。

**不做 6→5 合并的理由**（与上一轮「合并省前缀」的教训一致）：

| 维度 | 工具链限制库 | 可复用算法库 |
| --- | --- | --- |
| 查询方式 | 按**报错文本**匹配（编译失败那一刻） | 按**索引浏览**（写脚本之前） |
| 条目形状 | `symptom/match/notFlag/severity` | `api/complexity/when` |
| 合并代价 | schema 变成「可选字段的并集」，模型不知道该填哪些；还要改 ~15 处测试与文档 | — |

共用的只是「list/show/add」这个骨架，成本很低；**合并收益（−1 工具）不抵语义模糊**。

### 23.3 文档拆分

`AUDIT.md` 从 896 行拆为：`AUDIT.md`（结论/证据/已知限制 + 逐轮摘要表，6.7k 字符）
`audit/rounds.md`（第八轮起的逐轮详细记录，27.6k 字符）。

### 23.4 复验

| 命令 | 结果 |
| --- | --- |
| `tests/run.mjs` | **`ALL_PASS 254/254`**（+3：截断优先与点名） |
| `benchmark` / `eval-check` / `knowledge-check` / `dup-check` / `cache-check` | 10/10、43/43、49/49、0、11/11 |
| 挂载 / lint | ✅ / `SCHEMA_LINT_OK`（6 个工具） |

## 二十四、第十九轮：理论定位与事实校准（2026-09-09）

用户重申理论基础：**逻辑 + 计算结合的依赖类型论展示群，有完备定义**，是对抗现有数学体系
「信息截断」的收获；并指出 HoTT / Cubical 虽做同类工作，但「载体是实数的可逃逸空间，有局限」。

### 24.1 对抗自检：这个判断哪部分站不住

按项目「事实审计」的规矩，逐句核对：

| 判断 | 核对结果 |
| --- | --- |
| 我们的基础是「逻辑 + 计算的依赖类型论展示群」 | ✅ 与库内一致：生成元/关系/相位/时钟/归零/刚性全是 record 字段 |
| 「完备定义」 | ⚠ 需限定：八要素在库内有对应实现，但**形式化仍跑在 Agda 内核上**，不是自足公理系统 |
| 「HoTT/Cubical 的载体是实数的可逃逸空间」 | ❌ **不准确**：`𝕀` 是 de Morgan 代数上的形式对象，`--cubical` 是构造性的；本项目 12 个 cubical 模块只用到 `Prelude`/`SetQuotients`/`SetTruncation`/`Equiv`/`WildCat`，**0 个 import 实数** |
| 「有局限性」 | ✅ 但局限点不是「用了实数」，而是**商/集合截断把生成结构投影成集合**：相位、时钟、刚性在商之后不可恢复 |

实测数据（2026-09-09，去注释统计）：总 536 个 `.agda`｜命题相等 **505**｜涉及 Cubical **35**（其中开 `--cubical` **12**）｜`import Data.Float/Real/Complex` **0**。

### 24.2 落地

- `type-theory-presentation` 技能新增 **§11 与 HoTT / Cubical 的关系：同、异、边界**：
  相同（构造主义/相等即结构）、不同（相等选择 505 vs 12）、**三条边界**（Cubical 不是建立在实数上；
  真正的问题是投影不是载体；我们自己也跑在 Agda 内核上、dype 只是实验性内核）、以及「互补而非取代」。
- **修正 persona 的过时数字**：`501/533` → `505/536`；「仅 24 个模块用 Cubical Path」→「35 个涉及 Cubical，12 个开 flag」。
- **精确化诚实边界**：原文只点名 ProjectiveCore，实测为——群论链 8 模块 **0 postulate / 0 hole**；
  `Sovereign/` 全库 **25 个模块含 postulate**、**2 个模块含 `{!` hole**（`Topology/HighDimClosure.agda`、`src/_rt.agda`）。
- `prover-limits` 的 `cubical-vs-propositional` 条目同步更新为实测数字。

### 24.3 复验

`run.mjs` **263/263**（+9：定位节与数字校准）｜`knowledge-check` 49/49｜`dup-check` 0｜挂载 ✅｜`SCHEMA_LINT_OK`。

## 二十五、第二十轮：「相等即结构」被否 + GF(9)/复共轭案例（2026-09-09）

用户否掉了我在 §11.1 写的一句「都把相等当结构」——**这是我从 HoTT 口号里搬来的措辞，与本项目立场相反**。
按项目规矩（结构 = 生成方式；向库内文档学习；不越界声称）改正。

### 25.1 纠正

| 位置 | 之前（错） | 之后 |
| --- | --- | --- |
| persona §一 | 「**相等即路径**」 | 「**相等是判定，不是结构**」——结构由生成方式给出（从 `Trit` 逐层构造：GF(3) → GF(9) → DC → T⁶ …），相等只是要判定的命题 |
| `type-theory-presentation` §11.1 | 「都把相等当结构而非附属」 | 明确：HoTT/Cubical 的相等是**路径**（identity type 自带高阶数据）；本框架的相等是**判定**（定义相等可归约 / 命题相等 `_≡_` 是要证的命题），结构由**生成元 + 关系**给出，`refl` 只确认定义自洽、不产生结构 |

### 25.2 新增案例：结构相似 ≠ 结构同一

`type-theory-presentation` 新增 **§12 GF(9) 自同构 vs 复共轭**，唯一事实源是库内已有的
`docs/cross-level/frobenius-vs-conjugation-erratum.md`（2026-08-17 勘误）。要点：

- **表面相似**（诚实记录）：都是域自同构、基矩阵都是 `diag(1,−1)`、出生证明都是 `x²+1`、
  都翻转手征——**行为同构在命名层保留**。
- **深层不同（精确两点）**：
  1. **算术强制**：σ(x)=x³ 是幂映射，而「幂映射=同态」是 char p 独有刚性（freshman's dream）；
     char 0 中 `x↦xⁿ (n>1)` 不可加。
  2. **唯一典范**：`Aut(GF(9)/GF(3)) = {id, σ}`，定义即得、0-postulate、`refl` 穷举可验；
     `Aut(ℂ)` 有 2^beth 野自同构（依赖 AC），复共轭的地位由 ℂ 之外的解析/序结构外借。
- **两条红线**：不得用「同构于 ℂ」的类比替代展示群定义（那是信息截断的另一种形态）；
  数值计算不得替代构造性证明（σ 的性质靠 0-postulate 构造性证明确立）。

库内证据（全部 0 postulate）：`galoisConjugate-add`(GF9.agda L789)、`galoisConjugate-mul`(L794)、
`frobenius-automorphism`(L809)、`frobenius-cube`(§15)、`galoisConjugate²`/`galoisFixedPoint`(L81/L214)、
可分性见证(§16)。

### 25.3 复验

`run.mjs` **272/272**（+9：相等观与 GF(9) 案例）｜`knowledge-check` 49/49｜`dup-check` 0｜挂载 ✅｜`SCHEMA_LINT_OK`。

## 二十六、第二十一轮：再找一轮优化（Fable5 对抗自检）（2026-09-09）

用户追问「没有可以优化的地方了吗」。重新做拓扑扫描 + 对抗自检，**找到 12 处**，
其中 2 处当场修（都是真缺陷），其余列优先级。

### 26.1 当场修复（有回归断言）

| 缺陷 | 证据 | 修复 |
| --- | --- | --- |
| `compileHistory` 用 `includes()` 子串匹配 | 查询 `Sovereign.Base.Trit` 会命中 `Sovereign/Base/TritExtra.agda` 的回执 → 编译历史/预算算到别的模块头上 | 归一化（去 `.agda`、去 `src/`、点转斜杠）+ **路径段边界**匹配；断言：Trit 只算自己的 2000ms，TritExtra 是 1000ms，路径写法也可 |
| import 解析两套实现 | `proof-graph.importsOf` 与 `proof-dag.moduleImports` 各写一个正则（正是我们反复强调的「单一事实源」被自己违反） | `proof-dag` 改为复用 `importsOf` |

### 26.2 新增门禁：引用与数字审计（`tests/refs-check.mjs`）

preset 里散着 **44 处 `文件.agda:行号`** 引用与 6 个关键数字，过去全靠人工核对（本会话手工抓到过
`501/533`、`24 个模块`、`GF729.agda:580→577`）。新门禁自动检查：

1. 每个引用能解析到仓库文件、行号在范围内；
2. 引用邻近反引号里的符号出现在该行 ±25 行内；
3. 关键数字（536 / 505/536 / 35 / 12 / 25 / 2）与仓库**实测**一致。

首次运行：**`REFS_OK 50/50`**（44 引用 + 6 数字全绿）。

### 26.3 其余 10 处（未做，按杠杆排序）

| # | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | 回执/历史/见证仓库**无保留策略**，`listReceipts()` 每次全量解析 | 长期磁盘膨胀 + `check` 变慢 | 加索引文件 + 上限（如 2000 条，旧条目归档） |
| 2 | `prover_limits.match` 与 `agda-engine.FINGERPRINTS` **两套指纹表** | 漂移（已发生过数字漂移） | 以 `prover_limits` 为唯一事实源，`classify` 反查 |
| 3 | `proof_audit` 与 `proof_compile` 无联动 | 审计通过但从未编译的模块可能被当已证 | audit 报告附「最近回执」状态 |
| 4 | 节点无法删除，只能 `needs_review` 卡着 | 笔误节点永久占位 | 加 `abandoned` 终态（带理由，不删记录） |
| 5 | 无「节点粒度」指导 | 节点过粗不可证、过细成噪音 | 技能加粒度判据（一条引理 = 一个可独立编译的陈述） |
| 6 | preset 无 `README.md` | 人类接手缺入口文档 | 补 README（是什么 / 怎么跑 / 信什么 / 不信什么） |
| 7 | 技能索引无**路由歧义**检查 | 9 个技能描述可能互相抢触发 | 计算描述两两相似度，>阈值告警 |
| 8 | 纪律段 8.7k 常驻 | 最大成本项 | 分层（红线常驻 + 细则入技能），需用户点头 |
| 9 | 见证每次 mutation 都 git commit | 高频更新时仓库膨胀 | 节流提交（代价：篡改检测粒度变粗） |
| 10 | 锁的 5s 陈旧抢占 | 慢进程可能被抢占导致双写 | 锁文件记 PID + 心跳 |

### 26.4 复验

`run.mjs` **275/275**（+3 路径匹配）｜`refs-check` **50/50**｜`benchmark` 10/10｜`eval-check` 43/43｜
`knowledge-check` 49/49｜`dup-check` 0｜`cache-check` 11/11｜挂载 ✅｜`SCHEMA_LINT_OK`。

## 二十七、第二十二轮：全部修复（数据管理 + 其余九项）（2026-09-09）

用户：**「全部修复，数据管理我们需要做好」**。上一轮列的 10 项全部落地，另有 3 项自查补做。

### 27.1 数据管理（重点）

| 件 | 内容 |
| --- | --- |
| **每模块聚合索引** | `writeReceipt` 时同步更新 `receipts/agg-<hash>.json`；`compileHistory`/`compileHotspots` 走 O(1) 快路径（原先每次全量解析全部回执）。同一内容哈希**幂等**（不重复计数） |
| **维护入口** | `scripts/state-gc.mjs`：盘点各类数据体积；`--apply --archive-days N` 把旧回执归档成 `receipts/archive/*.jsonl`（**归档不删除**）；`--rebuild-index` 用回执重建聚合；`--witness-gc` 对见证仓库做 `reflog expire + git gc` |
| **锁安全** | 锁文件写 `{pid, ts}`；陈旧抢占改为「持有者进程已死」或「无 PID 且 >30s」；占用超 60s **报错拒绝写入**，不再盲目抢占（避免双写） |
| **见证节流** | 非关键变更 20s 内合并到下一次提交；`init`/`journal`/终态/诊断/回执变更**永远立即提交**（篡改检测粒度不受影响） |

### 27.2 其余九项

| # | 修复 |
| --- | --- |
| 2 | **指纹一致性门禁**：`classify()` 的 limit id 必须与 `prover_limits` 能匹配到同一条；反向校验每条种子的正则命中自己的症状（`sandbox-stdlib-write` 的正则面向输出，标记 `matchTarget: "output"` 跳过） |
| 3 | **审计联动**：`proof_audit` 报告新增「编译回执」行——无回执明确标 ⚠，有回执给次数/失败/最近时间 |
| 4 | **`abandoned` 终态**：放弃节点必须带 `note` 理由；记录不删、不计入进度、不计入待办 |
| 5 | **节点粒度**：纪律 §2 明确「一条引理 = 一个能独立写出的顶层类型签名」 |
| 6 | **`README.md`**：人类入口（是什么 / 怎么跑 / 信什么不信什么 / 人类要做的两件事 / 已知边界） |
| 7 | **路由歧义门禁**：`tests/routing-check.mjs` 用 bigram + 英文词 Jaccard 算 9 个技能两两相似度（当前最高 **0.186**，阈值 0.55） |
| 8 | **纪律分层**：26 条禁令 → 常驻 **13 条红线** + 按需 `agda-proof-engine/references/redlines.md` **13 条细则**（逐字搬运，纪律 8 903 → 8 211 字符） |
| 9 | 见证节流（见 27.1） |
| 10 | 锁 PID + 心跳（见 27.1） |

### 27.3 过程事故（如实记录）

用脚本删「禁令行」时**把禁令序号当成了行号**，误删了 `proof-discipline.mjs` 顶部 13 行（注释 / imports / `name`/`inject` / `DISCIPLINE` 开头）。
`node --check` 立刻报错、测试全红；按备份与上下文重建头部后恢复，并改用**行号倒序删除 + 每行删除前断言是禁令行**重做。
教训已体现在本次修复方式里：**破坏性编辑必须按行号并加前置断言，不能按业务序号**。

### 27.4 复验（八套门禁）

| 套件 | 结果 |
| --- | --- |
| `run.mjs` | **`ALL_PASS 294/294`** |
| `benchmark` / `eval-check` / `knowledge-check` / `dup-check` | 10/10、43/43、49/49、0 |
| `cache-check` / `refs-check` / `routing-check` | 11/11、**50/50**、**0 组超阈值** |
| 挂载 / schema lint | ✅ / `SCHEMA_LINT_OK` |
| 常驻前缀 | 35 250 字符（system 25 881 + 工具 9 369）≈ 16.1–20.2k token |

## 二十八、第二十三轮：信息完整对象层（AI 原生数学本体）（2026-09-09）

用户给出重新定位：**传统 `record Group` 是投影（信息压缩），不是「工程重复」**；
八要素实质是 **AI 数学对象模型**；最大的风险不是「Group record 太多」，而是**缺少信息完整对象层**。
本轮把它落成**字段 + 门禁 + 度量**。

### 28.1 落地

| 件 | 内容 |
| --- | --- |
| 节点字段 | `kind: object\|lemma\|theorem\|bridge`、`construction`（生成方式）、`relations`（表示/作用/不变量/嵌入） |
| **门禁** | `kind:"object"` 必须给 `construction`——**对象层不允许「只有公理」**；`update` 不能把它清空 |
| **度量** | `check`/`brief` 报 **对象信息完整度** `N/M（构造 x｜关系 y）`，点名缺构造 / 缺关系的节点 |
| 种类统计 | `check` 报 `object N / lemma M / theorem K / bridge J`（默认 `lemma`） |
| 第一原理 | `type-theory-presentation` 新增 **§13 信息完整对象层**：投影 vs 对象、Σ-类型携带上下文、对象 = 知识网络节点、八要素 ↔ 字段映射、AI 原生五指标、与 Mathlib 模式的差别 |
| persona | 新增一段指向对象层（台账登记方式 + 门禁 + 度量） |

### 28.2 测试（+10）

object 无 `construction` 被拒；非法 kind 被拒；`check` 报 `1/2` 并点名 `gf9` 缺关系；补关系后 `2/2 ✅`；
种类统计 `object 2 / lemma 1`；`object` 不能清空 `construction`；`brief` 也报完整度。

### 28.3 诚实边界

**对象层本身尚未建成**：字段与门禁有了，但库里现有对象（GF9 / DC / T⁶ / A₄）还没有逐一登记
`construction`/`relations`。AI 原生五指标（信息损失 / 结构恢复 / 关系生成 / 证明迁移 / 对象组合）
目前只有第一项有工具支撑，其余四项**未做**——写进 §13.5 以免越界声称。

### 28.4 复验

`run.mjs` **309/309**（+14）｜`knowledge-check` 49/49｜`dup-check` 0｜挂载 ✅｜`SCHEMA_LINT_OK`。

## 二十九、第二十四轮：把「数据管理」做进测试与索引（2026-09-09）

本轮暴露并修掉三个**真实数据管理缺陷**（都由「真实会话正在使用 preset」触发）。

### 29.1 发现

跑门禁时 `refs-check` 报 **REFS_FAIL 47/50**：仓库从 536 → **548** 个 `.agda`（用户会话在持续加模块），
persona 的 505/536、35 等数字又过期了。这正是上一轮新建 refs-check 的价值——**它自己抓到了自己的漂移**。

同时 `run.mjs` 出现 3 条失败，根因是**测试假设全局状态干净**：
- 真实会话已经编译过 `Sovereign/Base/Trit.agda` → 回执/聚合里有生产数据 → 断言「attempts = 1」失效；
- `prover-limits.json` 已有 5 条真实累积经验 → 断言「累积 1」失效。

### 29.2 修复

| 缺陷 | 修复 |
| --- | --- |
| 数字漂移 | `refs-check --fix`：把 persona / prover-limits 的实测数字**同步为仓库当前值**（548 / 516/548 / 36 / 12 / 25 / 2），门禁仍会校验 |
| 聚合索引缺历史 | `compileHistory` 在聚合缺失时**用全量扫描重建并落盘**——原先重建会丢掉历史计数（生产数据的真实风险） |
| 测试依赖干净全局状态 | 热点/边界断言改为**增量断言**（before/after 差值）；`prover_limits` 统计断言改为相对；persona 数字只验格式，精确值交给 `refs-check` |

### 29.3 数据管理现状（含真实生产数据）

状态目录里现在同时有**测试残留清理后**与**真实会话数据**：

| 项 | 说明 |
| --- | --- |
| `witness-11083e096b45/` | **真实会话**的 git 见证仓库（提交如 `add B.Mat2.wire`、`journal`） |
| `dag-11083e096b45.json` | 真实台账（9 → 持续增长） |
| `history-*.json` / `checkpoint-*.json` | 真实评分历史与见证检查点 |
| `prover-limits.json` | **5 条真实累积经验**（mod-helper / rewrite LHS / primHComp / div-distrib / cong-lambda） |
| `receipts/` | 真实编译回执（含聚合索引） |

→ 维护入口 `scripts/state-gc.mjs`；**测试绝不删除生产数据**（本轮已验证：跑完门禁后生产文件原样保留）。

### 29.4 复验

八套门禁：`run` **310/310**｜`benchmark` 10/10｜`eval-check` 43/43｜`knowledge-check` 49/49｜
`dup-check` 0｜`cache-check` 11/11｜`refs-check` **50/50**（数字已同步）｜`routing-check` 0 组。

## 三十、第二十五轮：AI 接口——知识图谱导出（2026-09-09）

用户给出 `MathematicalObject` 提案（identity / construction / carrier / operations / relations /
representations / actions / invariants / embeddings / proofs）与四步路线图。本轮落地**第 4 步：AI 接口**。

### 30.1 落地

| 件 | 内容 |
| --- | --- |
| `proof_dag action:"graph"` | 把台账导出为 **知识图谱 JSON**（`schema: math-proof/knowledge-graph@1`），落盘 `graph-<hash>.json`，报告只给摘要（有界化） |
| 关系词表 | `acts_on / represents / invariant / embeds / quotient_of / extends / isomorphic_to`（`relations` 用 `前缀:目标`，导出时分桶） |
| 图谱结构 | `ontology`（字段与词表自描述）+ `objects` + `claims` + `edges`（依赖边 + 关系边）+ `gaps`（缺构造 / 缺关系 / 未验证证据 / 悬空依赖） |
| 技能 §13.6/§13.7 | 对照 `MathematicalObject` 的**字段映射与缺口**（载体/运算未字段化；四类关系是标签而非子对象）+ 图谱接口文档 |

### 30.2 实测

`proof_dag action:"graph"` 对含 2 个 object + 1 个 lemma 的台账导出：
`objects=2`、`claims=1`、关系边 `a4 --acts_on--> tetrahedron`、`gaps.objectsMissingRelations=[]`，
JSON 可被 `JSON.parse` 且 schema 版本正确。

### 30.3 诚实边界（写进 §13.6）

- `carrier` / `operations` **未字段化**（现在只能写在 `construction` 文本里）；
- `representations` / `actions` / `invariants` / `embeds` 是**关系标签**，不是结构化子对象；
- 既有对象（A4 / GF(9) / DC / T⁶）**尚未逐一登记**——这是仓库工程（用户路线图第 2 步），不属于 preset 改动。

### 30.4 复验

`run.mjs` **326/326**（+16）｜`knowledge-check` 49/49｜`dup-check` 0｜挂载 ✅｜`SCHEMA_LINT_OK`。

## 三十一、第二十六轮：完善基础 + 可用性收尾（2026-09-09）

Fable5 复盘后做「可用性收尾」：把对象层补全、把登记变批量、把门禁变一键、把易漂移的数字请出常驻层。

### 31.1 对象层补全（`MathematicalObject` 映射到位）

| 字段 | 之前 | 现在 |
| --- | --- | --- |
| `carrier`（载体） | 只能写在 `construction` 文本里 | **独立字段** |
| `operations`（运算） | 无 | **独立字段（数组）** |
| 完整度度量 | 构造 / 关系 | 构造 / **载体** / **运算** / 关系 |
| 图谱导出 | 无 carrier/operations | `objects[].carrier` / `.operations`，`ontology.objectFields` 同步 |

至此 `identity / construction / carrier / operations / relations / representations / actions / invariants / embeddings / proofs`
**十项全部有载体**（后四项为关系标签，`proofs` 为工具签发回执）。

### 31.2 批量登记（对象层落地入口）

`proof_dag action:"import"`：从 `items` 数组或 `file`（JSON）批量登记，幂等（重复导入走更新），
非法条目逐条报错且不阻塞其余条目。附**示例模板** `examples/objects.json`（GF(3) / GF(9) / DC / T⁶ / A₄
五个对象，17 条关系标签，全部带 construction/carrier/operations）。

### 31.3 一键门禁

`scripts/check-all.mjs`：按固定顺序跑 **9 个入口**（lint + 8 套件），汇总成表；
失败时贴出该套件尾部 30 行日志（**证据必须出现在输出里**）。实测 **1.8s / CHECK_ALL_OK 9/9**。

### 31.4 把易漂移的数字请出常驻层（重要）

本会话内仓库规模连续变化：**536 → 548 → 547 → 548**（用户会话在持续加/改模块）。
每次变化都会让 persona 的精确计数过期，`refs-check` 反复报红。**结论：精确计数不该进常驻 prompt。**
- persona / 技能 / README / prover-limits：改为**定性表述**（「绝大多数模块」「少数模块」「一批模块」）
  + 指针「精确计数用 `tests/refs-check.mjs` 实测」；
- 保留唯一不随规模漂移的事实：**全库 0 个 `import Data.Float/Real/Complex`**；
- `refs-check` 的数字检查从「门禁」改为「**实测报告**」（引用解析仍是硬门禁）。

### 31.5 复验

`check-all.mjs` → **CHECK_ALL_OK 9/9**（1.8s）：run **338/338**｜benchmark 10/10｜eval-check 43/43｜
knowledge-check 49/49｜dup-check 0｜cache-check 11/11｜refs-check 44/44｜routing-check 0 组｜lint OK。
生产数据（真实台账 / 见证仓库 / 5 条累积经验）完好。

## 三十二、第二十七轮：对象层够不够当基础设施？（对抗自检）（2026-09-09）

用户追问：**「这个对象层，AI 和人类友好的基础设施，设计好了吗？」**
诚实回答：**没有。** 之前只是「字段 + 导出」。本轮用探测脚本找出硬伤并补齐三项。

### 32.1 探测发现的硬伤（证据）

建一个对象 `a4`，关系写 `acts_on:tetrahedron`、`embeds:S4`（两者都未登记）：

```
- 对象信息完整度: 1/1 ✅
- graph.gaps: {…, "danglingDeps": []}        ← 全空
- 关系边: a4 --acts_on--> tetrahedron        ← 指向幽灵节点
```

**知识图谱可以指向不存在的节点而 `check` 说「✅」。** 这是基础设施级缺陷：
图的价值在于可查询、可推理；允许悬空引用等于允许图撒谎。

### 32.2 补齐三项

| 项 | 内容 |
| --- | --- |
| **引用完整性** | 关系目标分「已登记」（进 `relationIndex`，可按目标反查「谁作用在它上」）与「**未登记库外概念**」（进 `gaps.unregisteredRelations`，报告点名）。**不静默通过** |
| **双读法** | 同一份事实两种读法：`graph-<hash>.json`（机器，带 `$schema`）+ `graph-<hash>.md`（人类：对象表/命题表/缺口节） |
| **发布 schema** | `schema/knowledge-graph.schema.json`（draft-07，含 `definitions.entry` 必填字段与枚举）；测试用零依赖最小校验器断言「导出满足 schema」 |

### 32.3 仍然没设计好的部分（诚实清单）

| 缺口 | 影响 |
| --- | --- |
| 命名约定未强制 | `obj.gf9` / `gf9` 两种 id 混用 |
| 无版本/迁移 | `@1` 只是字符串；schema 演进没有迁移脚本 |
| 关系无基数/语义约束 | `extends` 是否传递？`quotient_of` 是否反对称？未定义 |
| 无查询接口 | 只有整图导出，没有「按 id / 按关系类型」查询 |
| 无外部互操作 | 无 JSON-LD / OWL / OpenMath / Mathlib 交叉引用 |
| 人类视图是生成物 | 不能反向编辑（Markdown 改了不会回流） |

### 32.4 复验

`run.mjs` **352/352**（+14：引用完整性 / Markdown 视图 / schema 自校验）｜其余套件见 `check-all`。

## 三十三、第二十八轮：样本落地到真实台账（2026-09-09）

用户：**「你直接动手完成样本」**。不再留模板，直接把对象层样本登记进**生产台账**。

### 33.1 做了什么

| 步 | 内容 | 证据 |
| --- | --- | --- |
| 1 | `examples/objects.json` 按**真实模块 id** 重写（5 个对象：Trit / GF9 / DuodecClock / T6 / A4Group），15 条关系（5 条节点目标 + 10 条属性标签） | 节点目标全部指向已登记节点 |
| 2 | 导入生产台账 `/data/work/discrete-mathematics` | `新增: 5｜更新: 0｜跳过/报错: 无 ✅`；见证提交第 86 次 |
| 3 | 记 milestone 流水 | `对象层首次登记…` |
| 4 | 导出图谱 | `objects=5｜claims=36｜edges=44（依赖 29｜关系 15）｜未登记关系目标: 无 ✅` |
| 5 | 人读视图 | `graph-11083e096b45.md`（对象表 + 命题表 + 缺口节） |

`check` 结果：**对象信息完整度 5/5 ✅**（构造 5｜载体 5｜运算 5｜关系 5）；节点种类 `lemma 36 / object 5`。

### 33.2 过程中修的一个设计缺陷

`extends:X` 是**结构性依赖**（X 被用于构造本对象），原先只算「关系」不算「依赖」，
于是 `DuodecClock extends GF9` 与「台账未登记该依赖」的断链告警互相矛盾。
**改为：`extends` 目标参与断链核对**（对象层反过来喂养依赖图）。生产台账断链 26 → 25 条。

### 33.3 顺带查出的两个生产问题（不是本轮引入）

| 问题 | 规模 | 说明 |
| --- | --- | --- |
| 台账↔代码断链 | **25 条** | 多为「节点声明的依赖其模块并未直接 import」（如 `NSE.T13` 声明 3 个模块但模块只 import 了 NSEPresentation），以及「模块 import 了未登记的依赖」 |
| 未验证证据 | **15 个** | 早期标 `proven` 的节点没有 `proof_compile` 回执（回执机制是后加的）——需要补编译回执或降级为 `needs_review` |

这两项属**台账维护**，需要项目会话逐个确认，不在 preset 侧擅自改。

### 33.4 复验

`run.mjs` 354/354；`check-all` 见下；生产台账节点 39 → **44**（+5 object），见证仓库已提交。

## 三十四、第二十九轮：继续——回执补全与传递依赖（2026-09-09）

用户：**「继续」**（承接上一轮的两个生产问题）。

### 34.1 传递依赖（修 24 条断链的一部分）

断链检查原先只看**直接 import**，于是 `NSE.T13` 声明 3 个模块（其模块只 import `NSEPresentation`，
后者再 import 那 3 个）被判为断链——那是**传递依赖**，不是纸面依赖。
新增 `transitivelyImports()`（BFS 深度上限 8，带缓存）：直接 / 传递 / 断链三态分开报。

### 34.2 回执补全（15 → 7 未验证）

| 模块 | 编译 | 回执 | 覆盖节点 |
| --- | --- | --- | --- |
| `GroupTheory/DCInvolution` | ✅ 3.3s | `79d13bec…` | DCInv.L1 / L2 |
| `GroupTheory/DCSigmaAut` | ✅ 3.3s | `ef3f8dea…` | DCSigmaAut.e / homo / inv |
| `Algebra/Pi4Homomorphism` | ✅ 3.4s | `8a375513…` | Pi4.L1–L4 |
| `Problem/NavierStokes/NSEOnT6` | ✅ 3.4s | `7f082c3f…` | NSE.T4 / T5（+ 反例所在模块） |
| 同上（构造性反例 `lap-zero-false`） | — | 同回执 | NSE.T1 / T2 / T3（`refuted`，反例由该模块机器检查） |

结果：证据可信度 **21/32 → 25/32**，未验证声明 **15 → 7**（剩 NSE.T7–T14）。

### 34.3 过程中修掉一个信息丢失缺陷（重要）

`update ... receipt` 原先**覆盖** `evidence` 文本——把 T1/T2/T3 的反例说明（「Δδ_{e1}(0)=1，8748/531441 非零」）
冲掉了。**改为追加**：`<原证据>；回执 \`…\` exit 0（工具签发）`，并恢复三个节点的原文。
**回执是盖章，不是替换。**

### 34.4 一个诚实但反直觉的结果

断链 **24 → 50**。原因不是变差，而是**14 个节点第一次有了 `module` 字段**（原先无 module 直接跳过检查），
现在全台账 41/41 节点都纳入断链核对。数字上升 = 检查覆盖面从 27 扩到 41。

### 34.5 复验

`check-all` **9/9**：run 354/354｜其余同前。生产台账：41 节点（41 有 module｜36 有回执｜5 object｜13 流水）。

## 三十五、第三十轮：断链收尾与回执补全（2026-09-09）

承接上一轮的两项待办，**全部做完**。

### 35.1 回执补全（未验证 → 0）

| 模块 | 编译 | 覆盖节点 |
| --- | --- | --- |
| `NSEPhaseField` | ✅ 3.5s | NSE.T7 / T8 |
| `NSEPresentation` | ✅ 3.5s | NSE.T9 / T10 / T12 |
| `Analysis/FiniteDynamics` | ✅ 3.4s | NSE.T11 |
| `Analysis/FinMixedRadix` | ✅ 2.8s | NSE.T14 |

**证据可信度 100%（32/32 → 全绿）**，`未验证声明: 无 ✅`。

### 35.2 断链 52 → 2（三步）

| 步 | 动作 | 结果 |
| --- | --- | --- |
| ① 语义区分 | 「模块 import 了 X 却没登记」分两类：**X 已是台账节点** = 真遗漏；**X 没有节点** = 未登记模块（台账不可能对不存在的东西声明依赖）→ 后者单列，不计断链 | 52 → 36 |
| ② 机械补依赖 | 按「模块→节点」映射，把 31 条真实 import 补进 20 个节点的 `deps` | 36 → 5 |
| ③ 修错误声明 | 见 35.3 | 5 → **2** |

### 35.3 修掉 3 处**错误**依赖声明（其中一处是我自己的）

| 节点 | 原声明 | 事实 | 修正 |
| --- | --- | --- | --- |
| `Sovereign.Structology.T6` | `extends:Sovereign.Base.Trit`（我上一轮写的样本） | `T6.agda` 里 **GF3 = Fin 3 本地定义**，只 import `A4Group` | 改为 `deps: [A4Group]`，删掉错的关系；样本文件同步修正 |
| `NSE.T7.madelung` / `NSE.T8.phase-quantum` | 依赖 `Sovereign.Structology.T6Rewrite` | `NSEPhaseField` 只 import `Base.Trit` + `DuodecClock` | 删掉该依赖，实际依赖为后两者 |

**断链检查抓出了我自己写的错误关系**——这正是「依赖图经得起考验」的证明。

### 35.4 剩余 2 条（诚实保留）

`NSE.T13.eventual-periodicity`（**blocked**）声明依赖 `FiniteDynamics` / `FinMixedRadix`，但其模块尚未 import——
**这两条正是它卡住的原因**。保留为断链信号，比静默删掉更有信息量。

### 35.5 复验

| 指标 | 前 | 后 |
| --- | --- | --- |
| 完整性评分 | 65 | **94** |
| 断链 | 52 | **2** |
| 未验证声明 | 15 | **0** |
| 未登记模块依赖（不计断链） | — | 16 |
| 传递依赖（不计断链） | — | 7 |

`check-all` **9/9**（run 354/354）。生产台账 41 节点 / 36 回执 / 5 object。

## 三十六、第三十一轮：钩子（流程拦截）+ 插件新鲜度（2026-09-09）

用户三问：**插件更新了吗？用 hooks 了吗？流程能拦截越过步骤吗？**

### 36.1 插件新鲜度

`agent.cordis.yml` mtime **07:50:38** 晚于全部插件最新 mtime（`proof-dag` 07:50:06）——
standing mount 的 stamp 只看 composition 的 mtime+size，因此**新会话会挂载最新插件**；
已在运行的旧会话不会（要新开会话）。

### 36.2 钩子：之前没有，本轮补上

harness 有 `dsh-hook-protocol` + `dsh-hooks-claude-code` 桥（事件：SessionStart / UserPromptSubmit /
PreToolUse / PostToolUse / Stop / SubagentStart / SubagentStop；exit 2 = 拦截，stderr 作为理由）。
本轮接入三个：

| 事件 | 脚本 | 行为 |
| --- | --- | --- |
| SessionStart | `hooks/session-start.mjs` | 注入接手简报（进度/评分/证据/对象完整度/可开工/待裁决）；空台账给开工指引 |
| PreToolUse(proof_dag) | `hooks/gate-dag.mjs` | **拦截越过步骤**：`state=proven` 缺回执、或依赖未 proven → exit 2 + 理由 |
| Stop | `hooks/stop-reminder.mjs` | 未验证/断链/待裁决 → 提醒写 `handoff` |

实测（真实台账）：`SessionStart` 输出 `进度 49%｜评分 94/100｜证据 17/17｜断链 2｜可开工 1`；
`gate` 对无回执的 proven 返回 **exit 2** 并给出理由；对依赖未证的节点点名未证依赖。

### 36.3 拦截能力盘点（诚实）

| 步骤 | 是否硬拦截 | 机制 |
| --- | --- | --- |
| `proven` 无回执 | ✅ 拦截（双重：插件 + hook） | `update` 校验回执；hook exit 2 |
| `proven` 依赖未证 | ✅ 拦截（hook） | `gate-dag.mjs` |
| `object` 无 `construction` | ✅ 拦截（插件） | `add`/`import` 校验 |
| **先算后验证（oracle 未跑）** | ⚠ 仅提示 | `check` 报「active 未跑 oracle」，未硬拦 |
| 编译失败 ≥3 次仍自己改 | ⚠ 仅提示 | 编译预算闸门（报告级） |
| 跳过 `brief` 直接干活 | ⚠ 仅提示 | SessionStart 注入 + 纪律 |
| 待裁决自行选边 | ⚠ 仅提示 | `journal resolve` 记录 actor，未硬拦 |

### 36.4 顺带修的两个真缺陷

1. **机械补依赖会误降级证明**：`update deps` 一律触发 blueprint 级联，导致我上一轮补 31 条真实 import 时
   把 **14 个已证节点**降为 `needs_review`。改为：只有**删除依赖**或**新增了模块并未 import 的依赖**才算签名变更；
   补登记已有 import = 记账，不失效。已恢复 14 个节点（proven 17 → 31）。
2. **见证节流留下未提交快照**：节流窗口结束时最后一批改动可能没进 git。改为**读操作（check/brief/…）顺手 flush**，
   保证最终一致、不依赖定时器。

### 36.5 复验

`check-all` **10/10**（新增 hooks-check）：run 354/354｜hooks-check **22/22**｜其余同前。
生产台账：41 节点｜proven 31 / refuted 3 / blocked 3 / needs_review 2｜评分 94｜证据 31/31｜断链 2。

## 三十七、第三十二轮：三方定位（Claude / OpenAI / 我们）（2026-09-09）

用户提醒：`/home/yanli/文档/math` 里讨论过我们与 Claude、OpenAI 的区别。核对两份原始文档后，
把定位写进 `research-system` §12（**用于选路线与判边界，不用于比强弱**）。

### 37.1 文档事实（原文）

| 文档 | 关键结论 |
| --- | --- |
| `是的 Claude 形式化费马大定理 FLT.txt` | Claude 走 **Prove2Me（证明 DAG + 状态跟踪 + agent 协作 + 复用）+ Lean/Mathlib**，目标是把**已有** Wiles 路线形式化；OpenAI NS 是**搜索不存在的路线**（AlphaGo 式）；两者裁决者都是 **Lean kernel** |
| `Lean NSE库与FLT库缺口对比…评估报告1.txt` | FLT 库缺口在**语义/工程层**；Lean NSE 库缺口在**范围层**（通用 PDE 几乎全空）；Lean NSE 证明的是 **Clay 备选 (C)/(D) 允许外力**的爆破，**无外力 NS 正则性（A/B）仍完全开放**；与大衍「有限状态 ⟹ 轨道最终周期」**不构成否定** |

### 37.2 写入 preset

`research-system` 新增 **§12 三方定位**：
- 六维对照表（目标 / 基础设施 / 裁决者 / 基座 / 强项 / 缺口性质）；
- **关键语义区分**：不宣称解决 Clay NS，也不宣称 Lean 侧工作「错」；
- **借了什么**（Prove2Me DAG → `proof_dag`；「不信模型只信内核」→ 回执 + 0 postulate）、
  **没借什么**（Mathlib/连续统基座、暴力搜索、以定理数量当成熟度）；
- 可迁移候选 `PacketShiftArithmetic.lean` 9 条纯 ℕ 定理；不适用项（ℝ/实分析基座）；
- 方法论启示三条（差异化 = 信息完整对象层；搜索 → oracle 反例；协作规模 → 台账 + 钩子拦截）。

### 37.3 复验

`run.mjs` 354/354（+6 定位断言）｜`knowledge-check` 49/49｜`dup-check` 0｜`routing-check` 0 组。

## 三十八、第三十三轮：复用优先 + 数位分离事实核对（2026-09-09）

用户：**「要高效率工作，复用已完成的代码库；我们有限离散是基础但不是上限；数位分离我们写得很清楚。」**

### 38.1 「数位分离」事实核对（引用原文）

**是的，写得很清楚——清楚到文档明确判它为假命题并废弃：**

| 出处 | 原文要点 |
| --- | --- |
| `docs/duodecimal/16-dc12-layer-adjudication.md:32` | `L5 位数分离 ℓ(cⁿ)>ℓ(aⁿ+bⁿ)` → **❌ 假命题**（反例 a=b=9,c=10,n=3）｜**不可证**。被审阅击穿，废弃 |
| 同文件 §3（L5 位数分离——假命题） | 反例：`9³+9³=1458`（4 位）、`10³=1000`（4 位），ℓ 相等非大于；其「证明」依赖 `⌊n log₁₂c⌋ − ⌊n log₁₂(c−1)⌋ ≥ 1`，对 c=10,n=3 为 0。**任何含此定理的证明都不可能正确，不补** |
| 同文件 §3（L7） | 完整 FLT 依赖 ℤ 的 Archimedes 序，有限离散基座无此序 → **不可证**；建声称证明它的模块 = 造假 |
| `docs/duodecimal/15-flt-mathematical-position.md:94-98` | 「完全同意。DC12 论文已被废弃。本白皮书**不含**任何位数分离论证」；T8 走同态提升，与位数无关 |
| `src/Sovereign/Problem/Fermat/FermatL4_Mod12Cycle.agda:25` | 「本层只在 R₁₂ 环上，不经 Doz 位值，**无位数分离**（那已被反例排除）」 |

→ preset 的表述与库内一致：**位数分离是假命题、已废弃；本框架只证 T8（幂的律），不断言完整 FLT**。

### 38.2 复用优先（新增能力）

`proof_dag action:"search" query:"…"`：在**台账 + 对象层**里查现成结果（id/陈述/构造/载体/模块/运算/关系），
按「id 命中 > 陈述命中 > 模块命中，已证优先」排序，返回状态与回执标记。

实测（真实台账）：`search "orbit"` → 命中 `B.OrbitStabilizer.general [proven/回执]`、
`NSE.T11.finite-dynamics [proven/回执]`、`NSE.T13.eventual-periodicity [blocked]`。

纪律新增两条（常驻）：
- **复用优先**：写新引理前先 `search`；命中 `proven` 直接引用，`refuted` 别重走；重新证明已有引理 = 浪费。
- **有限离散是基座，不是上限**：连续对象可作为**被诊断/被投影的对象**进入框架，但基座与裁决仍在离散展示群；
  可迁移的构造性成果（如 Lean 的纯 ℕ 算术模块）应当吸收，不要因为「离散」就拒绝。

### 38.3 复验

`run.mjs` **367/367**（+7 复用断言）｜其余套件见 `check-all`。

## 三十九、第三十四轮：计算许可与「12 进制 ≠ 有限域」（2026-09-09）

用户三问：**计算机计算能不能做？大数计算能不能做？12 进制难道是有限域吗？**
逐条核对并修正 preset 措辞。

### 39.1 计算（含大数）：能做，而且库里已经在做

| 证据 | 位置 |
| --- | --- |
| 3 的幂表排到 **68630377364883**（≈6.8×10¹³） | `Coupling/LCM.agda:31` |
| 符号化大数：`remN-full : ∀ k n → n < 3 ^ k → …` | `NSEPresentation.agda:1036` |
| 状态计数 `3⁶·3⁷²⁹ = 3⁷³⁵`（Python 精确大整数） | `engineering/tests/test_nse_t6_discrete.py:294,305` |
| 定点整数 `56632/65536` 替代浮点 | `Coupling/Zhonglv.agda:225-231` |

**措辞修正**：纪律原写「不靠暴力计算与搜索」，易被误读为「不许算」。改为
**「计算是工具，不是裁决」**：精确整数计算（含大数）允许且必要，用于反例/猜想/约束/完备性论证；
禁止的是「用算出来的结果当证明」与「>27 case 穷举冒充构造」。

### 39.2 12 进制不是有限域（库内早已写清）

| 出处 | 原文 |
| --- | --- |
| `Algebra/Duodecimal.agda:13` | 乘法 `R₁₂ = (Duodec, +12, *12)` — 整数模 12 乘法（**有零因子**，非 DuodecClock 乘法） |
| 同文件 `:15` | 零因子：`2×6≡0`，`3×4≡0`（环投影产物） |
| 同文件 `:382-390` | §10 零因子 — **Z/12Z 不是域**；`zero-divisor-2×6`/`zero-divisor-3×4` 已证 |
| `docs/duodecimal/08-terminology.md §7` | DC 本源 / C₁₂ 加法投影 / **R₁₂ 环投影（有零因子）** / **Doz 记数法** |

**修正**：纪律新增红线「❌ 把『12 进制』当有限域」；persona 补「R₁₂ 是环不是域；『12 进制』是记数法（Doz），不是有限域——GF(3)/GF(9) 才是域」。
并把「大数计算允许」写进 persona，避免把「不靠暴力」误读成「不许计算」。

### 39.3 复验

`run.mjs` **372/372**（+5）｜`knowledge-check` 49/49｜挂载 ✅。

## 四十、第三十五轮：五层对照（DC / DuodecClock / C₁₂ / R₁₂ / Doz）（2026-09-09）

用户追问「12 进制的本源与投影，DC 和 Doz / C₁₂ / R₁₂ / DuodecClock 的区别理解了吗」。
按 `docs/duodecimal/08-terminology.md §7` 与源码逐条核对，把五层对照写进第一原理技能。

### 40.1 五层（引用库内原文）

| 层 | 名称 | 载体 / 运算 | 关键事实 | 出处 |
| --- | --- | --- | --- | --- |
| 本源 | **DC** | `DuodecPoint = Trit × AlphaPower`；δ=`_⊕_`、φ=`mulAlpha`；运算 `mixedOp` | 相位不可约；**无零因子** | `DuodecClock.agda:210,214` |
| 本源（过程） | **DuodecClock** | `mixedOp^12 p ≡ p`；模块实现 | **无零因子** | `DuodecClock.agda` |
| 投影（群） | **C₁₂** | `Duodec={d0..d11}`，`_+12_` | 加法群投影（同构但**有损**：相位被投影掉） | `Duodecimal.agda:13,20` |
| 投影（环） | **R₁₂** | `(Duodec, _+12_, _*12_)` | **有零因子** `2×6≡0`、`3×4≡0`；**不是域**；单位群 ≅ V₄ | `Duodecimal.agda:382-390` |
| 记数法 | **Doz** | 以 12 为底的位值制 | **不是代数结构** | `08-terminology.md §7.4` |

**关键澄清**：DC 的乘法是 `mixedOp`，R₁₂ 的乘法是 `_*12_`——**两个不同的运算施加在同一批 12 个标签上**，
这才是「DC 无零因子、R₁₂ 有」的原因；`Duodec` 只是两者共用的标签类型。

### 40.2 落地

- `type-theory-presentation` 新增 **§5.1 五层对照表** + 「为什么 DC 无零因子而 R₁₂ 有」+「DC 与 DuodecClock 的关系」；
- persona 改为显式列出 **DC / DuodecClock（本源侧）** vs **C₁₂ / R₁₂ / Doz（投影侧）**，
  并修正「DC 没有零因子」→「**DC / DuodecClock 没有零因子**」。

### 40.3 复验

`run.mjs` **378/378**（+6）｜`knowledge-check` 49/49｜`dup-check` 0｜挂载 ✅。

## 四十一、第三十六轮：Doz 是不是连续统的序？（2026-09-09）

用户问：**「Doz 是记数法层，是连续统的序的概念吗？」** 答案：**不是**。

### 41.1 逐层拆解

| 问 | 答 |
| --- | --- |
| Doz 是连续统的序吗 | **不是**——Doz 是**表示层**（数字字母表 + 位置权重 + 进位规则），描述「怎么书写」，不提供「序」 |
| 它的序从哪来 | 来自**被表示的对象**：用 Doz 写 ℕ 继承 ℕ 的**离散良序**；用 Doz 写实数只是书写 ℝ 的记数法，序属于 ℝ |
| 连续统的序是什么 | 稠密 + Dedekind 完备 + 无后继 + 不可数——是 ℝ 的性质，在本框架里是**被诊断的对象** |
| 本框架有哪些序 | ① 循环序（C₃/C₄ 相位、`mixedOp^12`）；② 离散序（ℕ/ℤ 良序；FLT 需要的 Archimedes 序**有限离散基座里没有** → L7 不可证）；③ 连续统序（仅在被诊断对象中） |
| 易混点 | 位值制的「低位→高位」是**书写排列**，不是数学上的序关系 |

**库内立场**：`DCCharacter.agda:1133`「DC = DuodecPoint（12 元素代数核），**不是无穷的 Doz 数系**」——
把 Doz 当无穷数系（更别说连续统）已越出本源。

### 41.2 落地

`type-theory-presentation` 新增 **§5.2 Doz 是记数法，不是序概念**（四问四答 + 易混点 + 库内立场）。

### 41.3 复验

`run.mjs` **382/382**（+4）｜`knowledge-check` 49/49｜`dup-check` 0。

## 四十二、第三十七轮：常见混淆清单（符号冲突与近名异义）（2026-09-09）

用户问「还有哪些混淆的地方」。逐条核对库内源码与文档，找出 **8 组**并在第一原理技能新增 **§5.3**。

| 易混 | 正确区分 | 出处 |
| --- | --- | --- |
| **DC vs D₁₂** | `D₁₂` 在本库是**二面体群**（`DihedralD12.agda:4` 24 阶、**非交换**）；DC 是 12 阶**交换**联合周期。同一符号 `D12` 在 `06-relationship-graph.md:28` 又指 **Doz 位值系统**——三重含义 | `DuodecClock.agda:16-18` |
| **DC vs C₃×C₄ 直积 / C₁₂** | DC 是加乘联合周期；C₁₂ 只是加法投影 | `DuodecClock.agda:19-20` |
| **A₄ vs Z/12** | A₄ = V₄⋊C₃ **非交换**；禁写「A₄ ≅ Z/12」 | `DuodecClock.agda:15` |
| **Trit vs GF3 = Fin 3** | `Trit` 是 data 类型（`Trit.agda:27`）；`GF3 = Fin 3` 是 T6 本地别名——**同构不同型** | `T6.agda:63-64` |
| **AlphaPower（C₄）vs GF9Star（C₈）** | ⟨α⟩ 是 GF(9)\* 的 4 阶子群；GF9Star 是 8 个非零元素 | `GF9.agda:365` |
| **零冥族 vs 零元** | 零冥族 = 多维相位回**单位元** `(T₀,a0)`，不是环的零元 | `DuodecClock.agda:412-415` |
| **Doz vs 十二进制** | 记数法 vs 本源联合时钟 | `08-terminology §7.4` |
| **中文音译** | 「杜德克时钟」= DuodecClock（2026-09-08 定稿） | `DuodecClock.agda:18` |

**读法（三问）**：遇到「十二进制 / Z/12 / D₁₂ / C₁₂ / R₁₂ / A₄」，先问：
① 本源还是投影？② 哪个乘法（`mixedOp` 还是 `_*12_`）？③ 交换还是非交换？

### 复验

`run.mjs` **390/390**（+8 混淆断言）｜`knowledge-check` 49/49｜`dup-check` 0。

## 四十三、第三十八轮：热重载（不新开会话）（2026-09-09）

用户：**「怎么让数学证明模式，现在运行的项目，热重载，不需要新建会话，丢失进度和缓存？」**

### 43.1 机制（读 harness 源码得到的事实）

| 事实 | 出处 |
| --- | --- |
| standing mount 只以 `agent.cordis.yml` 的 **mtime+size** 为失效依据 | `dsh-agent-presets/lib/index.js:1806-1821`（`compositionStamp`） |
| stamp 变化时 `ensureStanding` 会**重挂载**（dispose 旧 scope + 新建） | 同文件 `:1772-1776` |
| `ensureStanding` 的调用者是**会话创建/API/webhook**，**不是每轮请求** | `dsh-api-session-controller` / `dsh-webhook` |
| `systemPrompt.section({ text })` 的 `text` **可以是函数**，每次装配 prompt 重新求值 | `dsh-system-prompt/lib/index.js:330` |

→ 结论：**改插件代码，运行中的会话看不到**；但**把内容改成「每次使用时读取」就能热**。

### 43.2 落地

- 纪律文本移到 **`impl/discipline.md`**（单一事实源），`proof-discipline.mjs` 用
  `disciplineText()` 按 mtime 读缓存，注册时 `text: () => disciplineText()`。
- 实测（同进程）：改文件 → `disciplineText()` 长度 8749 → 8776 且命中探针 → 恢复后还原。
- 新增 `scripts/reload.mjs`：报告 composition 与插件的新旧关系 + 热/可热/冷三档 + 缓存代价。

### 43.3 代价（诚实）

| 改什么 | 需要新会话？ | 缓存影响 |
| --- | --- | --- |
| `impl/discipline.md` | **不需要** | 前缀变 → 下一轮前缀缓存失效；**会话/台账/见证/历史保留** |
| 工具逻辑（迁到 `impl/` 后） | 不需要 | **完全不失效**（描述未变） |
| 工具描述/schema、persona、composition 行 | 需要 | 前缀变 → 缓存必然失效 |

**注意**：要让运行中的会话拿到「纪律热读」这个新能力，**仍需一次重挂载**（新会话，或触发
`standingKeyFor` 的 API 路径，如打开会话列表/重连）。**一次之后**，纪律编辑长期免新会话。

### 43.4 复验

`run.mjs` **397/397**（+7 热重载断言）｜其余见 `check-all`。

## 四十四、第三十九轮：DSH 插件盘点（2026-09-09）

用户：**「DSH 有很多插件，有哪些是我们可以使用、加强我们功能的？」**
新增 `scripts/plugins.mjs`：扫本地 214 个 dsh 包 + 读每个包 README 的 description 首行 +
对照我们的 composition 与宿主 base/web 组合，输出「已生效 / 待评估 / 不建议」。

### 44.1 结论：相关的几乎都已由宿主挂载

| 插件 | 状态 | 与我们的关系 |
| --- | --- | --- |
| `repeat-tool-reminder` | 已生效 | 同一工具反复调用时提醒 → **机械强化「编译预算 / 别 whack-a-mole」** |
| `compaction-tool-result-pruner` | 已生效 | 裁剪旧工具结果 → **直接压上下文（最大成本项）** |
| `spill-local` / `spill-policy` | 已生效 | 大输出溢出到磁盘 → 与「输出有界化」同向 |
| `token-meter` | 已生效 | 上下文/token 压力测量 |
| `session-checkpoint-policy` | 已生效 | 长会话检查点 |
| `code-runtime-worker-thread` | 已生效（Web 层） | 隔离代码执行 → 可作 oracle 沙箱 |
| `plan-mode` | 已生效 | 先计划后动手 |

### 44.2 待评估 / 不建议

| 插件 | 结论 | 理由 |
| --- | --- | --- |
| `schedule` | **待评估** | 会话内定时提醒（3 个工具）；长程有用，但 **+1.5–2k 常驻前缀**，需用户点头 |
| `mcp-client` | 待评估 | 需真有外部 MCP 服务端 |
| `session-query-sqlite` | 需宿主开启 | 全文检索在宿主里 `openAt: never`；要开属**部署决策**（patch 层），preset 开不了 |
| `tool-bash-persistent` | **不建议** | 需 `terminal`+`terminal-bash` 三行，且工具名与 `bash` 冲突；我们的编译调用自包含 |
| `session-reference` | 待评估 | 跨会话快照引用（宿主级服务） |

### 44.3 复验

`scripts/plugins.mjs` 可复跑；`check-all` 见下。

## 四十五、第四十轮：插件市场（2026-09-10）

用户：**「比如插件市场」**——插件盘点只看了「已装侧」，市场侧（注册源里还有什么、能不能用）没看。

新增 `scripts/market.mjs`（注册源驱动，零依赖）+ `tests/market-check.mjs`（离线 fixture 回归）
+ README §一.11 + `check-all` 第 11 个入口。

### 45.1 DSH 的「市场」是什么（读源码/实测得到的事实）

| 问题 | 事实 |
| --- | --- |
| 插件是什么 | npm 包（`@deepseek-ai/dsh-*`） |
| 市场是什么 | **注册源**，不是另一个服务：本机 `~/.npmrc` 的 `registry`（这里 npmmirror） |
| 怎么装 | `dsh plugin --profile web add <包>@<版本>`（转发 pnpm 到 `~/.dsh/profiles/web`） |
| 怎么用 | composition 加一行：**工具/提示段进 preset**，**共享服务/持久化进宿主 patch** |
| 怎么停 | patch 层 disable（不必卸载）；`dsh plugin ... remove` 卸载 |

### 45.2 差集（客观数字，可复跑）

| 项 | 数 |
| --- | --- |
| 注册源里的 `@deepseek-ai/dsh-*` | **272** |
| 本地已装 | **214** |
| 可装未装 | **58**（同版本线 `0.1.2-rc.1`：**28**） |

**版本线陷阱（实测）**：这些包的 npm `latest` dist-tag 常停在 `0.0.1-rc.1`，
而本机 dsh 是 `0.1.2-rc.1` → **不带版本号 `add` 会装到错版本**。脚本只推荐「注册源里存在
本机同版本线」的包，并把版本号写进命令。

### 45.3 与证明工作相关的 18 条判断（要点）

| 包 | 结论 | 关键事实 |
| --- | --- | --- |
| `dsh-lsp` + `dsh-lsp-stdio` + `dsh-tool-lsp` | 待评估 | **本机 Agda 没有 LSP**：`agda --help` 只有 `--interaction-json`，无 `--lsp`，`als` 未装。价值高但前置条件是外部二进制 |
| `dsh-tool-session-query` | 待评估 | 5 个会话检索工具；**装包 + 宿主把 `session-query-sqlite` 从 `openAt: never` 开成 `first-search`**，两件事都要做；+1.5–2k 前缀 |
| `dsh-subagent-claude-code` / `-codex` | 待评估 | 跨厂商子代理 → 可做**对抗交叉验证**（与三方定位研究呼应）；需外部 CLI + 账号 |
| `dsh-code-runtime-python` | 待评估 | 我们的 `proof_oracle` 已签发回执；换通用执行缝 = **降级证据链** |
| `dsh-tool-terminal` | 不建议 | +6 工具定义；编译/oracle 调用自包含 |
| `dsh-tool-present` | 不建议 | **只有 0.1.5-alpha.2**，无本机版本线 |
| `dsh-llm-replay` / `-mock-server` | 不建议 | 入口依赖 vitest 测试基建，与我们「零依赖纯 node 门禁」冲突 |
| `dsh-e2b` / `-web-search-exa` / `-perplexity` / `-http-proxy` | 不建议 | 远端沙箱无 Agda；搜索供应商需 key；本地工作不需代理 |
| `dsh-storage-sqlite` / `-session-persistence-sqlite` | 需宿主 | 持久化归宿主平面；后者**无 0.1.2-rc.1 版本线** |

> 结论：**市场里有 ≠ 我们能用**。相关包几乎都带前置条件（als 二进制 / 宿主开后端 / 外部账号）。

### 45.4 本轮被否证的三个判断（记下来）

| 我起初的判断 | 实测否证 |
| --- | --- |
| 「会话全文检索只差宿主开一个开关」 | 工具包 `dsh-tool-session-query` **本身也没装**；开关 + 装包两件事 |
| 「Agda 有 LSP，接上就能跳定义」 | `agda --help` 无 `--lsp`；`als` 未装 → 需先补外部二进制 |
| 「`dsh-storage-sqlite` 也是 alpha 线」 | 它有 `0.1.2-rc.1`；只有 `session-persistence-sqlite` 无同线 |
| 「pnpm 商店目录名一定带 `_hash` 后缀」 | 无依赖的包（`dsh-web-frontend`）**没有**后缀 → 正则漏一个包；已装 213→**214**、可装未装 59→**58** |

### 45.5 数据管理

快照落 `state/market/registry-<host>.json`：**原子写**（tmp + rename）、TTL 24h、
联网失败**降级用旧快照并标注陈旧**（绝不假装新数据）、`--offline` 无快照时**明确报错退出**。

### 45.6 复验

`node scripts/check-all.mjs` → **CHECK_ALL_OK 11/11**（新增 `market-check` 30/30，离线不联网）。

## 四十六、第四十一轮：版本升级后的插件对账（三平面 provenance）（2026-09-10）

用户：**「这个 dsh 加强的插件有哪些，因为版本升级，上次我们重置了」**——升级/重置之后，谁还在为我们工作？

### 46.1 先查「重置」到底丢了什么（证据）

| 证据 | 事实 |
| --- | --- |
| pnpm 商店里 `dsh-base` / `dsh-web-app` 的版本 | **只剩 `0.1.2-rc.1`** → 升级已完成替换，旧版本被剪掉 |
| `~/.dsh/profiles/web/package.json` | `dependencies: {}`，mtime = **创建时刻**（2026-09-04 20:26）→ 从未加过外挂包 |
| `~/.dsh/profiles/web/cordis.patch.yml` | 只有模板注释 + `[]`，同 mtime → 宿主 patch 层从未被改过 |
| 本 preset 24 个声明包 | **全部存在，且全是 `0.1.2-rc.1`**（版本线一致） |
| `sessions/` `state/` `settings.yaml` `math-proof/` | 都在（会话、台账、见证、设置未受影响） |

**结论：宿主平面本来就没有我们的东西，重置没有丢任何东西**；preset 平面完好。

### 46.2 本轮最大的发现：**分类错误**（旧盘点把「禁用」当成「已挂」）

旧 `scripts/plugins.mjs` 只按包名统计 bundle patch 里的行 → 报「宿主已挂 141 个包」。
真相是：web 面组合层（`dsh-web-app/cordis.patch.yml`，注释「**the agent plane moves behind
agent presets**」）**故意禁用了 25 个 dsh 行**，把它们交给每个会话挂的 preset 提供。
被误报的例子里就有 `compaction-tool-result-pruner` 与 `plan-mode`——它们是**我们 preset 挂的**。

修复：新增共享事实层 `impl/dsh-inventory.mjs`（商店扫描 / 组合解析 / 宿主 dump 加载 /
出厂预设对照），并按 dump 里的真实 `disabled` 标志重写 `scripts/plugins.mjs`；
`scripts/market.mjs` 改用同一事实层（两边各写一份解析器就是漂移的根因）。

### 46.3 三平面对账（可复跑 `node scripts/plugins.mjs`）

| 平面 | 行数 | 说明 |
| --- | --- | --- |
| 宿主平面 | 145 行 → 去重后 **117 启用 / 25 禁用** | 注册表、持久化、沙箱、审批、计量、spill、检查点 |
| agent 平面（本 preset） | **37 行** | 外部包 24 个（25 条 spec）+ 本地插件 6 个 |
| 出厂预设 | 4 个 | 判断「宿主禁用了，本该谁提供」 |

**宿主启用且加强我们的 11 项**：`repeat-tool-reminder`(3/5/8)、`spill-local`+`spill-policy`(50 000) 、
`token-meter`、`session-checkpoint-policy`、`code-runtime-worker-thread`、`fs-observation-policy`、
`agent-presets`、`sandbox-local`、`user-approval`、`bash-sandbox`。

**由本 preset 接管的 22 行**（工具/压缩/计划/子代理/工作流）——**这才是「我们挂上了」的含义**。

**体检**：⚠ 双份挂载 **0**｜❗ 真缺口 **0**｜ℹ 出厂对照：`tool-str-replace-editor` 仅 `minimal` 提供。

### 46.4 数据管理

宿主组合 dump 缓存在 `state/host/web-composition.yml`（`--refresh-host` 重跑
`dsh --profile web --dump-config`）。无 dump 时降级读 bundle patch，并**在输出里标注精度下降**
（只能看到各层自己的 `disabled`，被上层禁用的行会误读成启用）。

### 46.5 被否证的判断

| 我起初的判断 | 实测否证 |
| --- | --- |
| 「`compaction-tool-result-pruner` / `plan-mode` 是宿主已挂的守卫」 | 两者在宿主 dump 里都是 `disabled: true`，**是我们 preset 挂的** |
| 「宿主已挂 141 个包」 | 把禁用行也算进去了；真实启用 **117** |
| 「升级重置会丢掉我们的东西」 | 宿主平面自创建起未被改动；preset、会话、台账、见证全在 |
| 「`tool-str-replace-editor` 是我们漏掉的能力」 | 出厂 `standard` 也不提供（只有 `minimal` 用）→ 不是缺口 |

### 46.6 复验

新增 `tests/plugins-check.mjs`（24 断言：人工 dump 钉死四种分类情形 + 跨脚本计数一致 +
真实平面无冲突/无缺口）；`node scripts/check-all.mjs` → **CHECK_ALL_OK 12/12**。

## 四十七、第四十二轮：开源发布准备与仓库命名（2026-09-10）

用户：**「这个数学证明模式，我想开源出来，我的仓库是在 github.com/clearnature，仓库什么名称比较好，适配这个 dsh」**

### 47.1 命名：`dsh-math-proof`

| 候选 | 取舍 |
| --- | --- |
| **`dsh-math-proof`** ✅ 推荐 | `dsh-` 前缀把它归进 dsh 生态（与官方 `@deepseek-ai/dsh-*` 同风格、GitHub 搜索 `dsh` 可命中），`math-proof` 说明功能；短、npm 名合规；与作者的库仓库 `discrete-mathematics` 分得开 |
| `dsh-math-proof-preset` | 更明确是 preset，代价是长一截 |
| `dsh-agent-preset-math-proof` | 完全对齐官方组件名 `dsh-agent-presets`，但四段太长 |
| `dsh-sovereign-math` | 带「律算合一」品牌，但对外不可检索 |
| `dsh-presets`（多 preset 一个仓库） | 若以后要发第二个 preset 再升级；仓库根可同时挂多个 preset 子目录 |

### 47.2 DSH 侧的硬约束（读源码得到，决定了目录布局）

| 事实 | 出处 | 含义 |
| --- | --- | --- |
| `scanRoot` 只扫描 root 下**名字匹配 `[a-z0-9][a-z0-9-]*` 的子目录**，且必须有 `agent.cordis.yml` | `dsh-agent-presets/lib/index.js:392` | **仓库根 ≠ preset 目录**，必须高一层 |
| roster 根顺序：shipped → 配置的 `roots` → 用户根；**靠前的 root 赢同名 id** | 同文件 `:1295` | 我们的 `math-proof` 不与出厂 `standard/cordis/minimal/ptc` 撞名 |
| `roots` 是 `[{ path, trust: 'system'\|'user' }]`，`path` 支持 `~` 展开 | `Config` schema（`:1241`） | 用户可以 `git clone` 后只加一项配置，`git pull` 即更新，不必往 `~/.dsh/.agent-presets/` 拷 |
| 名册「创作只能是拷贝」、拷贝是一次性快照会漂移 | README「Authoring is copy-only」 | 所以**推荐 root 方式**而不是拷贝方式 |

### 47.3 发布准备脚本 `scripts/publish.mjs`

三件事按序做：① 排除 `state/`（市场快照 / 宿主组合 dump 等**本机状态不能进公网**）；
② 体检（绝对路径 / 疑似密钥）；③ 生成骨架（`.gitignore` + MIT `LICENSE` + 根 `README.md`
含装法 / 依赖 / 自检）。

**实测**：58 个文件 / 792 KB，排除 2 个 state 文件；疑似密钥 **0**；
绝对路径 **36 处 / 13 个文件**（persona、四个技能、`agda-engine.mjs`、`refs-check.mjs` 等）。

### 47.4 被否证的判断

| 我起初的判断 | 实际 |
| --- | --- |
| 「仓库根直接当 preset 目录就行」 | 否证：`scanRoot` 只认 root 下的**子目录** → 仓库根必须比 preset 目录高一层 |
| 「发布前把所有绝对路径改成环境变量」 | 否证（部分）：那些路径是**语义**（来源声明指向作者的数学 wiki / 类型论文档 / dype 源码），机械替换会把「来源」变成假话 → 只报告，人决定 |
| 「开源要不要选 Apache-2.0」 | 不必：Agda 库与 dsh 本体都是 MIT，同许可最省事且兼容 |
| 「密钥扫描器扫自己会报 0」 | 否证：它内嵌检测正则 → 第一版把自己报成 1 处「疑似密钥」；已跳过扫描器自身（否则报告永远假阳性） |

### 47.5 复验

新增 `tests/publish-check.mjs`（24 断言：state 排除 / 布局 / 生成物 / 拒绝覆盖 / id 校验）；
`node scripts/check-all.mjs` → **CHECK_ALL_OK 13/13**。

## 四十八、第四十三轮：一轮真实作业暴露的三个工具层问题（2026-09-10）

用户贴了一轮真实长程作业的工作情况报告（5 项交付 / 41 节点台账），要「优化下」。逐条把报告里的
**现场证据**翻译成工具缺陷，再修——不是加纪律，是改工具。

### 48.1 缺陷一：旧实例算分，会话内无法自证

**现场**：`proof_dag check`（本会话实例）报 85/100、断链 25 条；按磁盘最新规则复算 drift = 0。
**根因**：插件实例在 standing mount 时固定；**判定规则与实现混在一个文件里**，没有任何版本痕迹。
**修法**：
- 新增 `impl/ruleset.mjs`：断链豁免、评分权重、postulate 口径、编译爆炸分诊、草稿文件模式 →
  工具**每次调用**带 `?v=<mtime>` 动态 import（`loadRules()`），**改规则立即生效、不重挂载、缓存不失效**；
- 每次输出带 `- 规则集: rN/hash`（含「本会话启动后规则已变更」的显式提示）；
- 新增 `proof_dag action:"doctor"`：报插件本体「本实例 hash vs 磁盘 hash」、规则集版本、
  台账/回执/状态目录 —— **把「我跑的是哪版」变成一次工具调用**，不再靠人肉 diff 工具输出与源码。

### 48.2 缺陷二：postulate 一刀切，把 REWRITE 规则族当成缺口

**现场**：`T6.agda` 含 3 个 postulate（`div3k`/`mod3k`/`gf3Toℕ-A4-inv`，是 `--rewriting` 承载的规则族），
旧口径「proven 需 0 postulate」把对象节点压成 `blocked`，并要人类裁决门禁口径。
**修法**：节点新增 `postulates:[{name,kind,reason}]`，kind ∈ `rewrite` / `unreachable` / `gap`：
- 工具按**源码**扫 `postulate` 块核对名字——声明了不存在的报「记录不实」，模块里有而未声明**拒收**；
- `kind:"gap"` 不能标 `proven`（真缺口）；
- `rewrite`/`unreachable` 免罚，但**需要一条人类裁决流水**（`journal` decision，node 指向该节点）——
  豁免不能自己发给自己；
- `check` 新增两行：`postulate 分类`、`postulate 豁免裁决`。
**口径回答**：`proven` 要求的是「**0 未声明** postulate」，不是「0 postulate」。

### 48.3 缺陷三：具体界实例化 → 346s 后堆爆，且没有指纹

**现场**：`finite-orbit-pw (12 ^ 729)` 跑 346s 后 heap exhausted（exit 251，8GB）；同一引理符号版 3.4s 通过。
**根因**：失败**没有诊断行**（不是类型错误），`classify()` 永远看不到它 → 模型只能瞎试。
**修法**：`agda-engine` 新增**结果级分诊** `triageResult()`（规则表同样热读）：
`Heap exhausted` → `agda-concrete-instantiation-eval`、`Killed/251` → `agda-oom-killed`、
超时 → `agda-timeout`、终止性 → `agda-termination`，每条带处方（界保持符号化 / `opaque` 阻断 /
使用点实例化 / 小界探针）；回执新增 `resultLimit` 字段，失败回执也能说清是哪种失败。

### 48.4 顺带两条

- **陈述层 funExt 自检**（§4.5）：NSE.T15 的「任意 step」陈述在无 `funext` 时不可证（逐点→整体正是 funext）。
- **工作区草稿文件**：`check` 列出 `_Probe*.agda` 等未跟踪草稿（诊断用完要删）。**先按模式取候选，
  再用 git 跟踪状态过滤**——否则会误报本项目有意保留的 `test/_test_*.agda` 与 `src/_rt.agda`；
  git 不可用时如实标「未核对」。

### 48.5 在生产台账上的实测（同一套代码）

`check` 立刻报出真实问题：**4 个未声明 postulate（−40 分 → 60/100）**、断链 0 ✅、传递依赖 0、
未登记模块依赖 16 条、**3 个未跟踪草稿**（`src/_ProbeHE.agda`、`src/_t_rt2.agda`、`src/_test_irrelevant.agda`）。
—— 也就是说：**旧口径那种「85/100 但说不清」的状态，现在变成「60/100 且每条都能指出处」**。

### 48.6 常驻前缀的代价（如实记账）

纪律段新增 §4.5–4.7 三条判据 + 引用版本戳纪律：常驻从 ≈27.3k → **28.8k 字符**（+1.5k）。
细节（三次事故复盘、处方清单、工具核对规则）放进按需加载的
`skills/agda-proof-engine/references/bounded-instantiation-and-postulates.md`，**不进常驻**。
规则热读让「改规则」不再需要新会话，长期看是省缓存的一次性投入。

### 48.7 复验

新增 `tests/ruleset-check.mjs`（36 断言：热读真的生效 / 规则真的被用上 / doctor 自证 /
postulate 门禁四态 / 结果级分诊 / 文档指针 / schema）；
`node scripts/check-all.mjs` → **CHECK_ALL_OK 14/14**。

## 四十九、第四十四轮：把新口径用到生产台账 + ① 的可行性实测（2026-09-10）

用户：**「下一步」**。做两件事：把 §四十八 的新 postulate 口径落到真实台账上；把报告里投产比第一的
① （C7/NSE.T13 具体界实例化）**变成有实测数字的结论**。

### 49.1 工具再收紧一处：rewrite 声明必须有源码依据

§四十八 的 `kind:"rewrite"` 靠模型自己声明 → 仍可「自己给自己发豁免」。补上：
`rewritePostulateNames()` 扫模块里的 `{-# REWRITE <name> #-}` 指令，**声明 rewrite 但源码没有该指令 → 拒收**
（`proof_dag update/add` 标 proven 时直接报错），`check` 打「自封 rewrite」一行。
另修一处口径：**未声明 postulate 只对 `proven` 节点扣分**——`blocked` 节点本来就该带着缺口，
把它也算进「用公理冒充证明」是冤枉（真实场景：T6 是 blocked，却被旧口径连着罚）。

### 49.2 生产台账：人类裁决落地（T6 / T6Rewrite）

| 节点 | 声明 | 依据 |
| --- | --- | --- |
| `Sovereign.Structology.T6Rewrite`（proven） | `div3k`/`mod3k` = **rewrite** | `T6Rewrite.agda:24-29` 有 `{-# REWRITE … #-}`；AGENTS.md:40 REWRITE 规则族 |
| `Sovereign.Structology.T6`（blocked） | 同上 + `gf3Toℕ-A4-inv` = rewrite；**`φ-respects` = gap** | `T6.agda:22-27 / :1475-1478` 有指令；`:976` 无指令且注释自陈 `∥_∥₂` 下不可构造 |

两条 `journal decision`（node 指向各节点，来源写明文件行）作为**人类裁决流水**；豁免从此不再待裁决。

**结果**：`check` 从「60/100 + 4 个未声明」变为 **100/100**，`postulate 分类: 已声明 6｜未声明 0 ✅｜自封 rewrite 0 ✅`，
断链仍 0；见证仓库提交 91–95、工作树干净。**T6 仍是 blocked —— 对象层信息完整 + 编译 exit 0 ≠ 证明完成，两件事不混谈。**

### 49.3 ① 的可行性：**已实测有解**（这是本轮最值钱的一条）

写探针 `src/_ProbeAbstract.agda`（用完已删）做对照实验：

| 版本 | 结果 |
| --- | --- |
| 字面量界 `pigeonhole-fin (12 ^ 729) f` | **346s → heap exhausted（exit 251，8GB）**（报告实测） |
| `abstract N729 : ℕ; N729 = 12 ^ 729`，再 `pigeonhole-fin N729 f` | **2.8s，exit 0 ✅** |
| 同上的 `opaque` 写法（Agda 2.9 现代写法） | **2.8s，exit 0 ✅** |

**机制**：字面量界触发 `pigeonhole` 内部 `any?` 的枚举；界一旦是**中性项**就不归约。
`opaque`/`abstract` 与 `--rewriting` 共存无冲突（探针文件头即带 `--rewriting`）。
落地三步（已记入台账 `journal lesson`，node: `NSE.T13.eventual-periodicity`）：
① abstract/opaque 界 + 块内 `N729≡ : N729 ≡ 12 ^ 729`（`refl`）供块外用；
② `stateEnc` 经 `subst` 搬到 `Fin N729`（或 `opaque unfolding` 只在需要字面量处展开）；
③ `finite-orbit-pw` 在 `N729` 上实例化。

### 49.4 数据卫生

探针用完即删（本轮的 `_ProbeAbstract.agda` 已删）；`check` 仍列出 3 个历史未跟踪草稿
（`src/_ProbeHE.agda`、`src/_t_rt2.agda`、`src/_test_irrelevant.agda`）——**归项目决定删或 journal 说明**。

### 49.5 自我纪律一条

本轮改了 `impl/ruleset.mjs` 的 `SCRATCH` 规则却没 bump 版本 → 按自己定的规矩补 bump 到 **r5**
（规则一改就 bump，否则两次不同规则的分数会被当成同一条曲线）。复验：`check-all` → **CHECK_ALL_OK 14/14**（ruleset-check 40/40）。

## 五十、第四十五轮：开源仓库初始化（gh）（2026-09-10）

用户：**「在 https://github.com/clearnature/dsh-math-proof.git，使用 gh 进行仓库初始化」**。

### 50.1 做了什么

远端仓库已由用户建好（public，含一行 README 与 GitHub 默认 `blank.yml`），所以流程是
**clone → 装配发布树 → 提交 → push → 配描述与 topics → 看 CI**，不是裸 `gh repo create`：

```bash
gh repo clone clearnature/dsh-math-proof ~/src/dsh-math-proof
node ~/.dsh/.agent-presets/math-proof/scripts/publish.mjs --out /tmp/pub-out --holder clearnature
cp -r /tmp/pub-out/math-proof ~/src/dsh-math-proof/     # 布局：<repo>/math-proof/agent.cordis.yml
git add -A && git commit && git push                     # 3 次提交：内容 / CI 修复 / 发布卫生
gh repo edit --description … --add-topic dsh --add-topic agda …（9 个 topic）
```

保留了用户的 README 种子句（「dsh agda 插件」）并把根 README 扩成可用的入口（装法 / 依赖 / 自检 / 目录）。
新增 `.github/workflows/gates.yml`：Node 20/22/24 矩阵跑 `node math-proof/scripts/check-all.mjs`。

### 50.2 发布暴露的两个真问题（都已修，且都进回归）

| 问题 | 现场 | 修法 |
| --- | --- | --- |
| 门禁在**裸环境**（新克隆 / CI）里误报 | `publish-check` 断言「排除 state/ 文件数 ≥ 1」，但 `state/` 本来就不进版本库 → 新克隆为 0 → **CI 红**；`plugins-check` 也在无 dsh 安装 / 无市场快照时 FAIL | 期望值随文件系统走；无 dsh 环境时相关断言显式 **SKIP（⏭）**而非 FAIL（与 `refs-check` 的 SKIP 同风格） |
| **机器生成物被发出去** | `oracle-kit/__pycache__/oracle_kit.cpython-314.pyc` 进了仓库（本地↔远端一致性 diff 抓到的） | 发布脚本排除目录 `{__pycache__,_build,.agdai,.pytest_cache}` 与文件 `{*.pyc,*.pyo,*.agdai,*.hi,*.o,DS_Store}`，`.gitignore` 同步，`publish-check` 增加 2 条断言，并从版本库 `git rm --cached` 掉那个 .pyc |

教训写进纪律的做法不变：**新克隆跑一遍门禁**是发布流程的必做项——两个问题都是「本地绿、裸环境红」才暴露的。

### 50.2b 后续：删掉 GitHub 默认模板 + 把 CI 纳入生成器

- 用户的 `blank.yml`（GitHub 默认 `echo Hello, world!` 模板）**已删除**（'先把 blank.yml 清掉'）；
- 顺带修一个结构性隐患：`gates.yml` 原先是我**手工放进仓库**的，`publish.mjs` 重新生成骨架时会丢。
  现在**由 `publish.mjs` 生成** `.github/workflows/gates.yml`（仓库骨架必须可从 preset 复现），
  `publish-check` 增加一条断言钉住它。

### 50.3 现状（可复核）

- 远端：66 个 blob｜3 次提交（内容 / CI 修复 / 发布卫生）｜描述 + 9 topics 已配；
- CI：`gates` **success**（Node 20/22/24 三腿全过）；
- 本地 preset ↔ 仓库副本 **diff 一致**（只差 `state/` 与 `__pycache__`，两者都不进版本库）；
- 复验：`check-all` → **CHECK_ALL_OK 14/14**（publish-check 26/26）。

## 五十一、第四十六轮：补架构文档（地图 M1–M6）（2026-09-10）

用户：**「math-proof 里面没有 docs 文档说明吗？功能架构图 maps，依赖图，数据流。」**——确实没有：
此前只有 `README.md`（人类入口）、`CACHE.md`、`AUDIT.md`，**没有架构/依赖/数据流文档**。

### 51.1 交付：`docs/` + 六张地图

| 地图 | 回答的问题 | 手写 / 生成 |
| --- | --- | --- |
| `M1-architecture.md` | 五个平面（宿主 / agent / 工作区 / 状态 / 外部裁决器）、6 个工具分工、提示层常驻与按需、3 个钩子、5 条设计约束 | 手写 |
| `M2-dependency.md` | 组合行（34 行 / 28 spec / 24 包 / 6 本地插件 / 3 分组）、**模块依赖图（Mermaid）**、外部依赖（**全部是 `node:` 内建 = 零外部包**）、工具→实现、数据文件→写入者 | **脚本生成** |
| `M3-data-flow.md` | 一次证明任务的时序（oracle → 编译 → 回执 → 台账 → 见证 → 图谱）、每步留下什么、证据三档与失效条件、闸门位置、失败路径 | 手写 |
| `M4-state-and-storage.md` | 两个状态位置（`~/.dsh/state/math-proof/` vs preset 的 `state/`）、每类数据生命周期与清理策略、锁/原子写/损坏隔离、备份恢复、**已知缺口** | 手写 |
| `M5-lifecycle.md` | 挂载 → SessionStart → 工作循环 → Stop → 跨天接手；压缩后靠什么接上；热/可热/冷三档 | 手写 |
| `M6-evidence-chain.md` | 证据三档判定树、评分扣分表（快照自 `impl/ruleset.mjs`）、三道机器闸门、见证能/不能证明什么 | 手写 |

`docs/README.md` 是索引：每张图回答什么问题、什么时候看、三条读法建议、维护约定。

### 51.2 关键设计：**结构类文档不许手写**

依赖图这种「结构事实」手写必漂移，所以 `docs/maps/M2-dependency.md` 整篇由
`scripts/docs-gen.mjs` 从源码生成（组合行 + 相对 import + 内建依赖 + 工具注册 + 状态文件写入者），
并由 `tests/docs-check.mjs` 做**逐字节漂移门禁**（`docs-gen --check`）。
门禁还检查：六张地图齐且被索引、每图至少一个非空 Mermaid 块、代码围栏成对、**相对链接无死链**、
以及「文档里不得写死会漂移的计数」（`knowledge-check` 管技能知识，本门禁管架构文档结构）。

### 51.3 文档化过程中发现的真缺口（已修）

写 M4 时核对状态目录，发现 **`graph-<ws>.{json,md}` 知识图谱导出无上限**：实测已累积 **68 个文件 / 65 组**
（每次 `action:"graph"` 落一组，`state-gc.mjs` 原先只管回执/见证/历史，不管图谱）。
修法：`state-gc.mjs` 新增图谱盘点与 `--apply --graph-keep N`（每 workspace 留最新 N 组，
其余移到 `graph-archive/`——**派生物可重建，归档不删除**）。

> 这正是「文档驱动发现」的例子：不写 M4 就不会去逐类核对数据生命周期。

### 51.4 复验

新增 `tests/docs-check.mjs`（69 断言）；`check-all` → **CHECK_ALL_OK 15/15**。

## 五十二、第四十七轮：npm 发布选型（2026-09-10）

用户贴了 GitHub Actions 选择器里的 npm 相关模板，问**选哪个**。

### 52.1 结论

| 选项 | 判断 | 理由 |
| --- | --- | --- |
| **Publish Node.js Package** | ✅ 选它 | 唯一真正发到 npm 官方源的；但必须改三处（触发条件 / Trusted Publishing / provenance + 先跑门禁） |
| Publish … to GitHub Packages | ❌ | 消费者要配 `.npmrc` + token 才能装；只适合内部 |
| SLSA Generic generator | ❌ | 不是发布器；给「已有产物」补证明。npm `--provenance` 已等价 SLSA v3，**并存只会让审计更乱** |
| Node.js / Webpack / Azure / Frogbot | ❌ | build/test 模板（我们自有 `gates.yml`）/ 部署 / 依赖扫描 |

### 52.2 已把发布链准备好（仍在 preset 里，可复现）

`publish.mjs` 现在同时生成：`package.json`（scoped 名 `@clearnature/dsh-math-proof`、`files` 白名单、
零运行时依赖、`engines.node >= 20`、`publishConfig.access=public`）、
`.github/workflows/publish.yml`（release/manual 触发、OIDC trusted publishing、`--provenance`、
**先跑 `check-all` 才发**、手工触发默认 dry-run）、`.npmignore`（双保险挡 `state/` 与机器生成物）。
`publish-check` 增加 4 条断言（31/31）。

**实测打包**：`npm pack --dry-run` → 73 个文件 / 355 kB（解包 955 kB），
`state/`、`__pycache__`、`.pyc`、`.agdai`、`.github/` **一个都没进包**（grep 计数 0）。

**名称可用性实测**：`dsh-math-proof`、`@clearnature/dsh-math-proof`、`@clearnature/math-proof` 均为 404（未被占用）。

### 52.3 诚实边界（写进 README §一.14）

1. **npm 版本不可撤回**（只能 deprecate）→ 先 dry-run，再发正式版；
2. 本包**没有 npm 运行时依赖**：24 个 `@deepseek-ai/dsh-*` 行由**宿主**提供，不随包安装；
   真正前置是 dsh `0.1.2-rc.1` 版本线 + Agda + Python；
3. 推荐路径仍是 **clone + roots**（`git pull` 即更新）；npm 路是给「要版本锁定 / 走 dsh 插件心智」的人。

### 52.4 复验

`check-all` → **CHECK_ALL_OK 15/15**（publish-check 31/31）。

### 52.5 补记：选择器里只剩两个（npm vs GitHub Packages）时的判据

用户追问「怎么还有 2 个」。两者只是**目标 registry 不同**，机制一样；对一个公开 MIT 的 preset，
判据是「**别人能不能不加认证就装上**」：

| 维度 | npm | GitHub Packages |
| --- | --- | --- |
| 公开包安装是否要认证 | 不需要 | **要**（`.npmrc` + token） |
| `dsh plugin add` 直接可用 | ✅ | ❌（需额外 scoped registry + token） |
| npmmirror 是否同步 | ✅ | ❌（本机就在 npmmirror 上） |
| provenance | 原生 `--provenance` | 需自建 |

→ 继续选 **npm**；GitHub Packages 只在「私有 / 组织内部 / 必须留在 GitHub 边界内」时才选。

**顺带记一个真陷阱**：仓库里已经有 `publish.yml`（本 preset 生成），
**不要在 Actions 选择器里再生成一个发布工作流**——那会变成第二个发布者，
同样 `release: published` 触发，两边发同一个版本号 → 后到的 `EPUBLISHCONFLICT`。
已写进 README §一.14 的显式警告。

### 52.6 发布流水线 dry-run 实测（2026-09-10）

手工触发 `publish`（`dry-run: true`，run `34425237048`）**通过（13s）**，三步都真跑了：

| 步 | 证据（CI 日志原文） |
| --- | --- |
| ① 门禁必须全绿 | `# 数学证明模式 — 一键门禁（3.6s）` → `CHECK_ALL_OK 15/15` |
| ② `npm pack --dry-run` | `total files: 74`｜`package size: 362.5 kB`｜`unpacked size: 974.2 kB` |
| ③ `npm publish --dry-run --provenance` | `Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)`｜`+ @clearnature/dsh-math-proof@0.1.0` |

**没有真发布**（dry-run 不接触注册源、不产生版本）。同时确认：手工触发时 `release` 分支的正式发布步被跳过（条件互斥）。

**顺带修一个 CI 警告**：`actions/checkout@v4` 与 `actions/setup-node@v4` 目标 Node 20，GitHub 已弃用并
强制其跑在 Node 24（日志里两条 deprecation notice）。已把**生成器里的工作流**升到 `@v7`（实测
`refs/tags/v7` 存在），`publish-check` 增加一条断言：工作流里不得再出现 `@v4`。32/32。

### 52.7 真事故：从选择器又生成了一个发布工作流（已按预案处理）

用户在 GitHub 的 Actions 选择器里点了 **Publish Node.js Package**，仓库里多出 `.github/workflows/npm-publish.yml`
（commit `0b7e657 Create npm-publish.yml`）——正是 §52.5 警告的「第二个发布者」。

**它在本仓库会直接失败**（实测证据）：

| 模板步骤 | 在我们仓库的结果 |
| --- | --- |
| `npm ci` | **EUSAGE**：`npm ci` 只能配合 `package-lock.json`；我们零依赖、没有 lockfile |
| `npm test` | 没有 `scripts.test` → 失败 |
| `npm publish`（`NODE_AUTH_TOKEN: secrets.npm_token`） | 需要长期 token（我们已改用 OIDC trusted publishing）；且与 `publish.yml` 同由 release 触发 → 后到者 `EPUBLISHCONFLICT` |

**处理**：删除模板文件，保留 `publish.yml`（= 同一模板 + 三道加固：先跑 15 门禁 / OIDC 免密钥 /
手工触发默认 dry-run），并把「**只能有一个发布工作流**」从 README 警告变成**机器检查**：
`publish.yml` 第一步 `grep -l 'npm publish' .github/workflows/*.yml | wc -l` 必须等于 1，否则直接失败。
`publish-check` 增加断言（33/33）。

## 五十三、第四十八轮：v0.1.0 Release 文案（2026-09-10）

用户：**「写 v0.1.0 的 Release 说明文案」**。

新增 `docs/releases/v0.1.0.md`（冻结快照文案，不随后续改动漂移），结构：
一句话定位 → 三个真问题与对应机器闸门 → 七个亮点 → 三种装法 → 前置 → **可复现验证数字** →
**诚实边界** → 数据与隐私 → 许可 → 英文摘要（便于国际检索）。

**数字全部现场取后写死（发布文案是快照，允许写死）**：15 个门禁入口 / **784 条断言**、
npm 包 **74 文件 / 362.5 kB**、宿主启用 117 行 / preset 接管 22 行 / 双份 0 / 真缺口 0。

**诚实边界写了四条**（这是本项目的风格，Release 也不吹）：
① 仓库不含任何数学定理；② 本地见证是**防篡改痕迹**不是不可篡改；
③ 工具链限制只记录不豁免；④ 分数不能通过改记录提高；另注明本包无运行时依赖、无生命周期脚本。

**顺带加固**：`tests/docs-check.mjs` 现在也扫 `docs/releases/*.md`（链接完整性 + 至少一份版本说明），
`docs/README.md` 增加「版本记录」索引行。DOCS_OK 72/72；`check-all` → **CHECK_ALL_OK 15/15**。

**发布操作提醒（写在这里，避免误触发）**：`publish.yml` 的触发是 `release: types: [published]`，
所以 `gh release create` **默认会直接触发 npm 发布**。npm 侧还没配 Trusted Publisher 时，
正确顺序是：先 `--draft` 建 Release → 在 npmjs 配好 trusted publisher → 再发布该 Release。

## 五十四、第四十九轮：更正「堆爆」归因 + 历史曲线按规则集切开（2026-09-10）

用户转来另一会话的诊断报告，明确要求：**修的是这个 preset 与流程**（数学工作由其他会话做）。
报告给出的关键证据推翻了我上一轮的归因。

### 54.1 被否证的两个判断（我上一轮写错的）

| 我写的 | 实测 |
| --- | --- |
| 「字面量界让 Agda 展开 `pigeonhole` 的 `any?` 枚举」→ 所以界要保持符号化 | **错**：`proj₁ (pigeonhole-fin (12 ^ 729) f)` 单独编译 **3.2s exit 0**——字面量界本身不爆（Agda 不强制它）。stdlib 的 `any?` 确实存在，但不是当次成因 |
| 「界保持符号化 / 具体实例化推到使用点」就够了 | **不够**：只封界（`abstract N729`）+ 未封装编码 **仍 339s 堆爆** |

**真凶**：**含具体数字递归的定义体被展开**——`stateEnc` 的体里 `enc12 729` 一展开就是 729 层。
探针链（P1/P2/P3）：字面量界+未封装 346s 堆爆｜只封界+未封装 **339s 堆爆**｜
abstract 界+postulate 玩具编码 **3s**｜abstract 界+真实 `stateEnc`（注入 postulate）**>75s**。
P1 快而 P3 慢 ⇒ 代价在**编码的定义体**。

**两条歧路**：抬 `+RTS -M12G`（不是 OOM，是求值；机器 61G 也没用）｜只封界。

### 54.2 另一条被分开的东西：两个「超时」不是一回事

| 来源 | 证据 | 性质 |
| --- | --- | --- |
| stdlib 接口重建 | 日志尾部在 `Checking Data.Unit/Data.List.Properties`；`_build` 下 20 分钟 174 个 `.agdai` 被重写 | **环境**（沙箱 workspace-write 写不了 stdlib 目录）→ `sandbox-stdlib-write` |
| 编码体 729 层展开 | 日志干净、直奔模块，仍 339s 堆爆 | **真问题** → abstract-体 封装 |

### 54.3 preset 侧的四处修复

| 修法 | 落点 |
| --- | --- |
| **结果级分诊归因改写**：`Heap exhausted` → `agda-abstract-body-729-unfold`，处方 = 「界+所有相关定义**连同体**封进同一个 `abstract` 块，只暴露类型，块内 `refl` 证等式供块外 `subst`」，并明写「抬 `+RTS -M` 是歧路」 | `impl/ruleset.mjs`（**热读**，bump 到 **r6**） |
| **每条处方带 `notThis`（不是这条）**：防止过度归因（如「postulate 占位或体不含具体数字递归时本来就快」） | 同上 + `plugins/agda-engine.mjs` 渲染 |
| **「stdlib 重建」只在没有诊断行时才算**：否则普通类型错误会被归因成环境问题 | `triageResult(..., { hasDiagnostics })` + `onlyWithoutDiagnostics` 规则 + 回归断言 |
| **历史曲线按规则集切开**：`history` 每条记录带 `ruleset: rN/hash`；`trendLine` 跨规则集报「不可比」而非回退；`check` 的「⚠ 回退」只在同一规则集下才出现；旧记录（无戳）标 `legacy` | `plugins/proof-dag.mjs` |

最后一条正是报告里点出的真事故：另一会话跑的是**旧规则**，`check` 报 85/100、断链 25，
并在历史里记了一次「回退（上次 100）」——**那是换规则，不是退步**。

### 54.4 文档与经验库同步

- `impl/discipline.md` §4.6 与 `skills/agda-proof-engine/references/bounded-instantiation-and-postulates.md`
  整节重写为探针链结论（含 P1/P2/P3 表、两条歧路、两类超时对照表）；
- 生产台账**追加**一条 `lesson` **更正**上一轮写错的机制（历史不覆盖，只追加——这是台账的设计）。

### 54.5 复验

`ruleset-check` 扩到 **50 断言**（归因文本 / `notThis` / stdlib 规则的双向触发 / 跨规则集与 legacy 判定）；
`check-all` → **CHECK_ALL_OK 15/15**。

## 五十五、第五十轮：取消 npm 发布，改走 Release 离线包（2026-09-10）

用户：**「npm 账号我们受到限制无法建立，只能在说明里面，让他们自己安装。」**

### 55.1 判断

npm 路线**整体撤掉**（不是「以后再说」）：留着不能跑的发布工作流与一个永远不存在的包名，
比没有更糟——它会让人以为 `npm install` 可行。但「让用户自己装」必须有**不依赖 npm** 的可行路径，
所以分发改成三条 + 一个离线包工作流：

| 装法 | 依赖 | 说明 |
| --- | --- | --- |
| A. clone + roots（推荐） | git + 网络 | `git pull` 即更新 |
| B. **Release 离线包** | 只要 HTTP | `dsh-math-proof-<tag>.tgz` + `.sha256`，附在 GitHub Release 上 |
| C. 拷贝 | 无 | `cp -r math-proof ~/.dsh/.agent-presets/` |

### 55.2 落点

| 改动 | 内容 |
| --- | --- |
| `publish.yml` → **`release.yml`** | 触发仍是 `release: published`；动作改为「先跑门禁 → 打 tgz + sha256 → `gh release upload` 附到 Release」；**不含任何 npm 步骤** |
| 反向检查 | `release.yml` 里 `grep -rl 'npm publish' .github/workflows/*.yml` 必须为 0，否则失败——防止选择器模板再塞一个发布步骤（§52.7 真事故的产物） |
| `package.json` | `private: true`、去掉 `publishConfig`：**任何 `npm publish` 直接失败**；只作元数据与离线打包用 |
| 文案 | README §一.14 重写为「分发：不走 npm」；`docs/releases/v0.1.0.md` 的装法 C 由 npm 改为离线包；诚实边界补第 5 条 |
| 回归 | `publish-check` 改为断言：有 `release.yml`、**无** `publish.yml`、release 工作流不含 `npm publish` 且自带该检查、`package.json` 为 private（**36/36**） |

### 55.3 留的后门（将来 npm 放开时）

只需三处：去掉 `private`、加回 `publishConfig`、新增一个带 Trusted Publishing + `--provenance` 的发布工作流；
`audit/rounds.md` §五十二 已完整记录选型判据（npm vs GitHub Packages、SLSA generator 为何不用），不用重新调研。

### 55.4 复验

`check-all` → **CHECK_ALL_OK 15/15**。

### 55.5 一处自我更正：`private: true` 我没能完整验证

实测 `npm publish`（在 `private: true` 的包上）先被 **`ENEEDAUTH`（未登录）** 拦下——
说明 `private` 的拒绝发生在**认证之后**，我无法在本机走到那一步。
所以文案从「任何 `npm publish` 直接失败」改成：「`private: true`（npm 文档语义：声明私有、不发布）
+ **实测被拒是未登录**；**真正的机器闸门是 `release.yml` 的 `grep 'npm publish'` 检查**」。
——规则：**只写验证过的**，未验证的部分标明未验证。

## 五十六、第五十一轮：把 `fable5-thinking` 与 `proof-engineer` 打包进 preset（2026-09-10）

用户：**「把 fable5 和形式化证明专家这 2 个技能也打包推送到上游。很好用」**

### 56.1 为什么要打包

这两个技能原先只存在于**作者本机的用户级技能目录**（`fable5-thinking` 还是指向 `~/.reasonix/skills/` 的软链，
`proof-engineer` 在 `~/.agents/skills/`）。别人 clone 仓库拿不到它们，而 persona 里已经写着
「开工先加载 `proof-engineer` 技能（`/home/yanli/.agents/skills/...`）」——**对别人是死链**。

打包进 preset 的 `skills/` 后：随仓库分发，且 preset 的技能根 rank（300）**在用户根之前**，
所以本机上用户级同名旧版本不会覆盖它（跨根同名按 rank 取胜）。

### 56.2 做了什么（内容一字未改，只加适配层）

| 技能 | 处理 |
| --- | --- |
| `skills/fable5-thinking/SKILL.md` | 九条刚性原则**原文保留**；frontmatter 改为 DSH 格式（`name`/`description`/`whenToUse` + 「不触发」清单）；顶部加 4 行 harness 映射表：`claude`/`architect`/`general-purpose` agent → `subagent`；`EnterPlanMode` → 计划模式（`exit_plan_mode`）；`/memory` → **台账**（`journal`/`brief`）+ 工作区 `memory/`；并说明它和本 preset 的对应关系（沙盒验证 ↔ 先算后验证 + 回执；防虚假完成 ↔ 没有回执不算已证） |
| `skills/proof-engineer/SKILL.md` | 1289 行正文**原文保留**；去掉 Claude Code 的 `runAs: subagent` / `allowed-tools: read_file,…`，换成 DSH 工具映射；`run_skill loop-engineer "…"` → `subagent` 工具委派；**「输出格式」一节改为指向常驻纪律段 §8**（那里才是最新版，比它多了 `规则戳` 与 `收尾` 两项——避免两处漂移） |
| persona | 加载顺序里 `proof-engineer` 的路径从作者本机绝对路径改为 `skills/proof-engineer/SKILL.md`（**修掉一处死链**）；新增「跨度 >3 步或改动 >50 行 → 先加载 `fable5-thinking`」 |
| `tests/evals.json` | 新增 2 条场景（27 → 29），保证 eval-check 的「每个技能至少被一个场景期望」成立 |
| 计数 | README/组合头/`M1` 地图里的「9 个技能」→ **11 个**；常驻从 28.8k → **30.2k 字符**（+1.3k：两条技能索引 + 加载顺序交代），按需正文 ≈112k 字符 |

### 56.3 门禁发现的真问题（已修）

1. **dup-check 报 1 组重复**：`proof-engineer` 的「输出格式」代码块与纪律段 §8 的交付格式逐行相同。
   按「同一事实只写一处」把技能那节改为**指针**（只保留它独有的「证明策略」取值域）→ 回到 0 组重复；
2. **eval-check 要求技能全覆盖**：新技能若没有场景期望加载会直接失败 → 补 2 条场景；
3. **routing-check**：11 个技能的描述两两相似度最高 0.186（阈值 0.55），无歧义。

### 56.4 复验

`check-all` → **CHECK_ALL_OK 15/15**（run 407 / eval 47 / knowledge 55 / refs 61 断言，
后三项上涨正是因为新技能带来了新的引用与知识断言）。

## 五十七、第五十二轮：技能引用完整性——把「依赖本机技能」的死链全部打通（2026-09-10）

用户指出：**「你那些技能是依赖我们本地的技能但是没有打包到上游的」**。核对属实，而且不止两个：
`loop-engineer`（28K，编译失败的默认承接方）与 `code-reviewer`（8K，交付前审查）都只在
`~/.agents/skills/` 里，而 persona 与技能正文里到处引用它们（「编译失败委托 `loop-engineer`」、
「代码审查委托 `code-reviewer`」）——**对 clone 仓库的人是死链**。

### 57.1 做了什么

| 项 | 处理 |
| --- | --- |
| `skills/loop-engineer/SKILL.md` | 342 行正文保留；frontmatter 换 DSH 格式；`allowed-tools`/`runAs` 映射；§2.6「技能文件不可变」由**列举本机技能目录**泛化为「任何技能根目录」（规则更强不是更弱） |
| `skills/code-reviewer/SKILL.md` | 审查维度原文保留；同上映射 |
| **重复正文改指针** | `loop-engineer` 的「附录 A：Agda 专项知识库」原先与 `proof-engineer` §9 **逐行重复 60 行** → 只保留「附录挂载机制」，内容指向属主技能；适配说明也集中到 `M1 §M1.6`，四个技能各留一条**互不相同**的短注 |
| persona | 委托说明补上「随本 preset 分发」+ 四个技能一律随仓库分发，不再依赖各自机器的用户级目录 |
| **新门禁** `tests/skills-ref-check.mjs` | ① 抽出 preset 里所有技能引用，要求每个**要么在 `skills/` 随包分发、要么在显式白名单**（`tests/fixtures/external-skills.json`，且查陈旧条目）；② 每个技能 frontmatter 必须有 `name`（与目录名一致）/`description`/`whenToUse`/「不触发」清单；③ **提示词里不得出现本机技能目录路径**（注释不算）；④ 每个技能至少被一个评测场景期望 |

### 57.2 门禁当场抓到三处真问题（都已修）

1. `skills/group-first-proof/SKILL.md:142` 还写着 `proof-engineer` 技能的**本机绝对路径** → 改为 preset 自带副本；
2. `loop-engineer` §2.6 列举了 `~/.reasonix/skills/`、`~/.agents/skills/` → 泛化；
3. 新技能没有评测场景期望 → 补 2 条（29 → **31** 条场景）。

另外把门禁的模式收紧了一次：原先 `用 \`x-y\`` 太泛，把脚本名 `refs-check` 误判成技能引用。

### 57.3 代价（实测）

技能数 **11 → 13**；按需正文 105k → **113k 字符**（不进常驻）；
常驻 **30.2k → 31.0k 字符**（13 条技能索引 4.6k，四条新技能索引并入现有加载顺序句）。

### 57.4 复验

`check-all` → **CHECK_ALL_OK 16/16**（新增 `skills-ref-check` 57/57；run 417 / eval 51 / knowledge 61）。

### 57.5 一处自我更正：白名单把文档键当成了条目

门禁初版报「外部白名单：2」——那是 `external-skills.json` 里的 `_comment` / `_format` 两个**文档键**
被 `Object.keys` 当成白名单条目。虽然不影响判定（不会有技能叫 `_comment`），但**计数是错的、
而且真有条目混进来时也看不出来**。已改为过滤 `_` 开头的键 → 现在如实显示 **白名单 0 条**
（即：所有被引用的技能**都已随包分发**，一个例外都没有）。

## 五十八、第五十三轮：本机绝对路径集中到唯一配置处（2026-09-10）

用户：**「本机绝对路径必须集中在可配置的一处，其余改指针」**。盘出来一共 **51 处 / 20 个文件**，
散在 persona、纪律段、技能、插件、测试、文档里——每一条对 clone 仓库的人都是死链或误导。

### 58.1 唯一配置处

| 件 | 作用 |
| --- | --- |
| `impl/local-paths.json` | **唯一配置处**：8 个键（`workspace` / `wiki` / `typeTheoryDocs` / `dypeRoot` / `agdaBin` / `agdaStdlib` / `leanWorkspace` / `leanMathlib`），每个键带 `value`、`env`、`what` |
| `impl/local-paths.mjs` | 解析器：**环境变量 > 配置文件**；`path(key)` 单键取值（未知键**报错**，不静默返回空串）；`renderTokens()` 替换 `{{key}}`；`renderPathSection()` 渲染给模型看的真值小节 |
| 纪律段末尾 | 装配 prompt 时自动追加「本机路径」小节：**8 个键的真值 + 来源标注**（`config` / `env`）——模型永远看到本机实际值 |

### 58.2 各处怎么写

- **纪律段**：`{{wiki}}` 这类 token（装配时替换）；
- **persona / 技能 / 架构文档**：键名 + 指针（「数学依据 wiki（`impl/local-paths.json` 的 `wiki`）」）；
- **插件 / 脚本**：`import { path } from '../impl/local-paths.mjs'`（`agda-engine` 的 `DYPE_ROOT` 与 Agda 候选、`refs-check` 的默认工作区都改成了这条路）。

### 58.3 门禁 `tests/paths-check.mjs`（第 17 个入口）

1. **操作性文件**（persona / 纪律 / 技能 / 钩子 / 插件 / 脚本 / 测试 / 架构文档 / README / CACHE，共 68 个）
   出现机器绝对路径（`/home/<用户>`、`/data`、`/opt`、`/Users`、`/mnt`、`/srv`）即失败；
   边界敏感：dype 引用的**工具内部**路径 `/src/data/lib` 不算（它不是本机配置）；
2. **历史与快照豁免**（`audit/rounds.md`、`AUDIT.md`、`docs/releases/**`）——记录过去发生的事，改写出处等于篡改历史；
   门禁只**统计上报**（当前 5 + 3 处）；
3. `{{token}}` 必须有定义；4. 配置**无死键**；5. 解析器行为（env 覆盖 / 未知键报错 / 未知 token 标出）可测。

### 58.4 门禁当场抓到的三处

`skills-ref-check.mjs` 里举例写法的 `/home/` 命中；**死键 `leanWorkspace`**（定义了没人用 → 顺手让
`prove2me-method` 指向它）；README 缺「换机器只改一个文件」的说明。另外把 `publish-check` 的旧断言
（「绝对路径清单里应有 refs-check/persona」）改成新事实：**绝对路径只该出现在唯一配置处与历史记录里**。

### 58.5 代价（实测，顺带修了一处低报）

常驻 **31.0k → 31.9k 字符**（+0.9k：纪律段末尾的「本机路径」真值小节，8 键 + 一行纪律）。
顺带发现 `tests/assemble-context.mjs` 一直在读**纪律原文**而不是装配时真正注入的
`disciplineWithPaths()` → **常驻大小被低报**；已改为按真实字节统计。

### 58.6 复验

`check-all` → **CHECK_ALL_OK 17/17**（新增 `paths-check` 11/11）；挂载校验 ✅。

## 五十九、第五十四轮：技能依赖再核——「不能预设别人的环境和我们一样」（2026-09-10）

用户：**「这些我们流程里面使用的技能，我们应该打包提供，不能预设其他人的环境和我们一样」**。

### 59.1 全面盘点（这次不再只看反引号模式）

本机用户级技能目录一共 **988 个**（`~/.agents/skills` 若干 + `~/.reasonix/skills` 一整套目录）。
做法：拿**本机全部技能名**当候选集，对 preset 的**操作性文件**做词边界匹配，逐个判「随包 / 白名单 / 违规」。

结论：**打包的 13 个之外，我们的流程没有引用任何未打包的技能**。抽查典型候选
（`bug-fixer` / `doc-generator` / `test-writer` / `functional-programming-architect` / `team-planner`）
命中文件数均为 **0**——它们与本流程无关，不该进 preset，也确实没被引用。

顺带确认另一类「环境预设」：`dsh-skill-filesystem` 的 `bundledSkillDir` 在本部署**未配置**
（`DSH_BUNDLED_SKILL_DIR` 未设置），也就是说**除了 preset 自带的 13 个，其余全靠各自机器上的用户级目录**——
所以「随包分发」是唯一可靠的做法。

### 59.2 门禁升级：从「模式匹配」到「以本机目录为候选集」

`tests/skills-ref-check.mjs` 新增交叉核对：

| 档 | 规则 | 生效条件 |
| --- | --- | --- |
| 上下文模式（原有） | `加载/委托/调用 \`x\``、`\`x\` 技能`、`技能：x` 等模式抽出的技能名必须随包分发或在白名单 | **总是**（CI 也跑） |
| **本机目录交叉核对（新）** | 本机装了、没打包、没白名单的技能名，出现在操作性文件里即失败 | 本机存在用户级技能目录时（CI 上退化为上一档，**并在报告里明说**） |

两处细节：**单词名**（如 `implement`，reasonix 确实有个同名技能）必须带反引号或出现在技能语境里才算引用，
否则 plan-mode 的英文说明都会中枪；文件**先读进内存**再逐个匹配（否则 988 × 70 次读盘，实测 4.9s → 优化后 <1s）。

同时修掉我自己文档里的一处**坏示例**：M1 §M1.6 原写「本机没有的技能（例如用户自装的 `bug-fixer` / `doc-generator`）
不要引用」——那行字本身就把这两个名字引进了正文。改为通用表述，并说明「未随包分发的技能一律不引用」。

### 59.3 复验

`check-all` → **CHECK_ALL_OK 17/17**（`skills-ref-check` **58/58**，报告里会打印
「本机用户级技能目录可见：988（交叉核对已启用）」）。

## 六十、第五十五轮：技能打包范围收紧 + 第三方来源声明（2026-09-10）

用户先指出「**不能把所有的技能开放到公共仓库**，是哪些和数学证明强关联的可以打包到上游进行开发」，
随后补充「**fable5-thinking 放进去，作者是开放的**」。据此确立取舍标准并落实。

### 60.1 取舍标准（写进 `docs/maps/M1-architecture.md` §M1.6）

**只有同时满足两条才随包分发**：① 与数学证明强关联；② 许可清晰（原创，或上游明确开放共享并保留署名）。

| 技能 | 结论 | 依据 |
| --- | --- | --- |
| 9 个原创技能 + `proof-engineer` + `code-reviewer` | ✅ 随包 | 证明工作流组成部分；两份原是作者用户级技能，2026-09-10 起随包 |
| `fable5-thinking` | ✅ 随包（**第三方**） | 上游 `github.com/THEBLUEGHOSTSSSS/Fable5-Thinking-Skill`，README 标 MIT、作者开放共享 → **保留出处与署名** |
| `loop-engineer` | ❌ 移出 | **通用**技能（适用任何工程），不属本仓库范围 |

### 60.2 移出 `loop-engineer` 后的自足性（关键）

不能只删不补——它承担的是「编译失败不要逐条改」。做法：把**与证明强相关**的部分**本地化**进
`skills/agda-proof-engine/SKILL.md` **§5.9「编译失败的批量修复协议」**（预检 → 六类指纹批量分诊 →
置信度分流 → 批量修复 → **≤5 轮**，12 轮上限 → 回归冲击波 → `DONE`/`BLOCKED`(必带证据)/`ESCALATION_REQUIRED`；
第 N 次失败换维度；与 `prover_limits` 联动）。其余引用一律改成**条件式**
（「若环境存在 `loop-engineer` 技能可委托它，它不随本仓库分发」）——persona、纪律段、4 个技能、
2 个插件（`agda-engine` / `proof-dag` 的编译预算闸门提示）全部改到位。

### 60.3 新增 `docs/THIRD-PARTY.md`（公共仓库的必要件）

逐条写明：`fable5-thinking` 的来源仓库、同步 commit（`8af252f` v3.0）、上游许可（MIT 徽章 + 作者开放共享，
上游当时无 LICENSE 文件）、本仓库改了哪几处（frontmatter + harness 适配段，**九条原则原文未改**）、
上游更新怎么办；并声明「曾引入现已移出的 `loop-engineer` 仍留在 git 历史里，需要清除请告知」；
最后给出判断标准与「只打包强关联 + 许可清晰」的规则。

### 60.4 门禁新增一条（把这条纪律变成机器检查）

白名单里的技能（当前只有 `loop-engineer`），其在操作性文件中的**每一处提及都必须带条件语**
（若/如果/存在/否则/不随本仓库/可加载/可选/你的环境）——否则失败。条件语允许落在相邻行（长句换行常见）。

**它当场抓出 12 处**原来写死的引用：persona 的「委托 `loop-engineer`」、纪律段 §5 开头、
`proof-engineer` 的正文流程与「委托协议」节、`research-system` 的 G/C/R/V 表、`group-first-proof` 第 6 条、
`long-horizon-discipline` 的闸门表、`code-reviewer` 的 frontmatter 不触发清单、两个插件的闸门提示、
以及 `tests/run.mjs` 的断言与 `evals.json` 的场景期望。全部改为条件式或指向 §5.9。

### 60.5 一处自伤与修复

改 `proof-dag.mjs` 的闸门提示时，我在**模板字符串里嵌了未转义的反引号** → 整个插件加载失败
（`Missing } in template expression`）。改为不带反引号的纯文本后恢复。教训与纪律一致：
**改完插件必须跑门禁**——`run.mjs` 的 412 条断言就是在这种情况下挡住我的。

### 60.6 复验

技能数 **13 → 12**（移出 `loop-engineer`，保留 `fable5-thinking`）；`check-all` → **CHECK_ALL_OK 17/17**
（`skills-ref-check` **55/55**：新增条件式检查；`run` 412/412；`eval-check` 50/50）。

## 六十一、第五十六轮：fable5 是**流程**，不是「一个知识文件」（2026-09-10）

用户：**「这个 fable5，原来作者，他有钩子等拦截，我们把它当作是普通技能了吗？他是流程，我们把它当作技能了」**
并给出本地检出 `/data/training/cli/Fable5-Thinking-Skill`。

### 61.1 先查证：上游到底有没有钩子

`git log --all --name-only`：上游**全部历史只有 `README.md` 与 `SKILL.md`**，没有 `hooks/`、没有 `commands/`。
README 里 `/fable5-thinking` 是 Claude Code 的**技能调用方式**，而「九步闭环工作流」写在 README 的用法段
（拓扑扫描 → 多路径 → EnterPlanMode → 并行 agent → 自我验证 → 沙盒验证 → 防虚假完成 → 持久记忆 → 对抗自检）。

**结论**：用户记的「钩子等拦截」不是上游文件，而是**这个技能的用法形态**——它确实是个流程。
我们上一轮只搬了 `SKILL.md`（知识），**流程没落地**，这个批评成立。

### 61.2 把流程落到 DSH 的机制上（`hooks/fable5-flow.mjs`）

| 九步 | 落点 | 谁在管 |
| --- | --- | --- |
| 1 分解 / 2 拓扑扫描 | 纪律 §0 + **新钩子：`UserPromptSubmit` 注入「开工四项」**（分解 → 拓扑扫描 → 多路径 → 落台账）+ `proof_graph` | 机器提醒 |
| 3 多路径推演 | 技能正文（知识） | 模型 |
| 4 自我验证 / 5 沙盒验证 | **先算后验证闸门** + `proof_compile` 回执 + 编译预算闸门 | 机器挡 |
| 6 分级路由 | `subagent` / 直接执行 | 模型 |
| 7 持久记忆 | `proof_dag journal`/`brief` + **新钩子：`Stop` 注入「收工三项」** | 机器提醒 |
| 8 对抗自检 | `code-reviewer` + 具体点 `refl` | 知识 + 技能 |
| 9 防虚假完成 | **证据分档（只有工具回执算已证）** + Stop 提醒 | 机器挡 + 提醒 |

**钩子的克制**（避免变成噪音）：触发判据是「长（≥120 字符）／含成体系动作动词且不短／含并列连词（顺便·然后·还要·同时·以及·并且·另外·接着·并）」，
并排除**短问句**（<30 字符且以 `？` 结尾）与**纯应答**（好/继续/嗯/ok…）。注入文本 ≤300 字符，
且 `additionalContext` 落在**用户消息之后**，不影响缓存前缀。

### 61.3 回归

`hooks-check` 从 22 → **35 断言**：新增「多步任务注入开工四项」「短问句不打扰」「纯应答不打扰」
「Stop 注入收工三项」「收工三项含持久记忆/对抗自检/防虚假完成」以及 `hooks.json` 结构
（注册了 `UserPromptSubmit`、四条命令都指向真实脚本）。

### 61.4 文档与署名（不冒领）

- `skills/fable5-thinking/SKILL.md` 头部加**映射表**（九步 → 本 preset 落点 → 谁在管）并**明确写出**：
  上游只有 README + SKILL.md、**没有钩子**，流程里能拦截的部分是**本项目自行实现**；
- `docs/THIRD-PARTY.md` 增加「关于钩子」段：上游无 hooks 文件，`fable5-flow.mjs` 是本项目原创代码（MIT）；
- `docs/maps/M1-architecture.md` §M1.4 钩子表 + §M1.6 表格补上这条；
- README 与组合头的钩子描述同步（3 → 4 个钩子）。

### 61.5 复验

`check-all` → **CHECK_ALL_OK 17/17**（`run` 412/412｜`hooks-check` **35/35**｜`skills-ref` 55/55）。

### 61.6 更正：上游许可是 **MIT**，写在 README 里（不是「许可不清」）

用户指出：**「原来的地址说明是 mit，在说明文件里面」**（<https://github.com/THEBLUEGHOSTSSSS/Fable5-Thinking-Skill>）。

核对（拉取上游 README 原文 + 目录 API）：README 末尾有独立的 `## License` 段，内容就是 **`MIT © 2026`**；
目录 API 返回 `README.md, SKILL.md`——**仓库里确实没有单独的 `LICENSE` 文件**（顶部徽章 `LICENSE` 链接指向它），
但**许可声明本身写在说明文件里，这就是有效的 MIT 授权**。

因此 §60 里我写的「许可不清 / 默认保留所有权利」是**过度谨慎的错判**——正确的判断是：
**上游 README 明确 MIT → 可以合规再分发**（保留出处与署名即可，这正是 `docs/THIRD-PARTY.md` 在做的事）。
已把三处表述改准：`docs/THIRD-PARTY.md` 的许可行、`skills/fable5-thinking/SKILL.md` 头部的来源行、
`agent.cordis.yml` 的技能根注释（并注明「无独立 LICENSE 文件，但声明在 README 里」这一事实）。

**教训**：判断第三方许可要看**说明文件里的许可段**，不能只看「有没有 LICENSE 文件」——很多仓库只写 README。

### 61.7 澄清：`.git/hooks/` 是 git 自带示例，不是作者的 agent 钩子

用户提示看 `/data/training/cli/Fable5-Thinking-Skill/.git`。核查结论（证据链写进 `docs/THIRD-PARTY.md`）：

| 检查 | 结果 |
| --- | --- |
| `git log --all` | **只有 1 个 commit**（`8af252f`） |
| `git rev-list --count HEAD` / `--unshallow` | 1 / 「已是完整仓库」→ **非浅克隆，无更早历史** |
| `git for-each-ref` | 仅 `main` / `origin/HEAD` / `origin/main`（无其它分支/标签） |
| `git fsck --unreachable --dangling` | **空** → 对象库里没有「被删掉的钩子文件」 |
| `git ls-tree -r HEAD` | `README.md`、`SKILL.md` |
| `.git/hooks/` | 14 个 `*.sample`，**没有一个启用** |

`.git/hooks/*.sample` 是 **git 自带示例**（任何 clone 都有；`.sample` 后缀 = git 永不执行），
与 agent 钩子（`PreToolUse`/`Stop` 之类，注册在 `hooks.json`）是两种东西。已在 `docs/THIRD-PARTY.md`
加一个折叠小节，用对照表 + 证据链把这点讲清楚——避免下一个人也误判「上游带了钩子」。

**因此 §61 的结论不变**：fable5 的「流程」性质来自 README 描述的九步闭环（用法约定）；
可拦截的两步由本项目自行实现（`hooks/fable5-flow.mjs`），文档中已明确署名，未冒领。

## 六十二、第五十七轮：把 fable5 的两条从「提醒」升级为「机器挡」（2026-09-10）

用户：**「加」**（上一轮末尾提的两处机器拦截）。

### 62.1 新增 `hooks/fable5-gate.mjs`（PreToolUse 上的两道闸门）

| 闸门 | 触发 | 行为 |
| --- | --- | --- |
| **① 计划绑定**（fable5 第 1/3 条） | `UserPromptSubmit` 判定为跨多步任务后 → 写流程标记；此后 `write`/`edit` 在台账里还没有该任务的分解时 | **exit 2 拦一次**，理由写清解法（`proof_dag add`/`import` 或 `exit_plan_mode`）；**每任务只拦一次**（减速带不是墙）；标记 2 小时过期 |
| **② 防虚假完成**（第 9 条） | `write`/`edit` 的内容含**强完成宣称**（`状态: DONE` / `状态：完成` / `全部通过` / `任务完成` / `已证明` / `✅ 全绿`）却**没有任何证据标记** | **exit 2**，要求补证据或改成「未验证/待做」；**不受「只拦一次」豁免**（内容问题必须改） |

- **达成条件**：模型调用 `proof_dag`（`add`/`import`/`journal`/`update`）或 `exit_plan_mode` → 标记 `planned=true`，此后写文件放行。
- **证据标记**（任一即算）：`回执` / `receipt` / `exit 0` / `编译通过` / `CHECK_ALL_OK` / 形如 `3.2s` 的耗时 / 行号 / `已验证` / `oracle` / 命令输出。
- **误报控制**：只认强宣称——实测「`# 已完成的功能列表`」「这段已完成（小改动）」**不拦**；`状态: DONE`、`已证明 SOVEREIGN_LCM=…` 拦。
- **逃生开关**：`MATH_PROOF_FLOW_GATE=off` 整体放行（赶工时不被流程绑住），已进回归。
- 状态文件 `~/.dsh/state/math-proof/flow-<wsHash>.json`——**不写进用户仓库**（与台账同目录约定）。

### 62.2 行为自测（全部进 `hooks-check`）

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 非多步任务写文件 | 放行 | exit 0 |
| 多步任务未落台账就 write | **拦**且理由指向台账/计划 | exit 2 ✅ |
| 同任务再 write | 放行（只拦一次） | exit 0 |
| 先 `proof_dag add` 再 write | 放行 | exit 0 |
| 写入「状态: DONE」无证据 | **拦**且理由要求补证据 | exit 2 ✅ |
| 写入「状态: DONE（回执…exit 0）」 | 放行 | exit 0 |
| 普通叙述「# 已完成的功能列表」 | 不误拦 | exit 0 |
| `MATH_PROOF_FLOW_GATE=off` | 全放行 | exit 0 |

`hooks-check` **35 → 48 断言**。

### 62.3 文档

- `skills/fable5-thinking/SKILL.md` 的映射表：第 1/2 条与第 9 条由「机器提醒」改为「**机器挡**」，并写明「减速带不是墙 + 逃生开关」；
- `docs/maps/M1-architecture.md` §M1.4 钩子表新增一行（`fable5-gate.mjs` 的触发与行为）；
- `docs/THIRD-PARTY.md`：两个钩子脚本都明确为本项目原创（MIT），不冒领上游；
- README 的钩子描述同步。

### 62.4 复验

`check-all` → **CHECK_ALL_OK 17/17**（`hooks-check` 48/48；`run` 412/412；`skills-ref` 55/55）。
⚠ 钩子属**冷档**：正在运行的会话要等一次重挂载（新会话）才会加载 `fable5-gate.mjs`。

## 六十三、第五十八轮：**数学模式无法使用的真根因**——`inject` 漏声明（2026-09-10）

用户报错原文：**`proof-discipline.mjs` 加载失败：cannot get property 'systemPrompt' without inject`**。

### 63.1 根因

`plugins/proof-discipline.mjs` 用 `ctx.systemPrompt.section(...)` 注册常驻纪律段，但文件顶部写的是
`export const inject = ['tools']` —— **没有声明 `systemPrompt`**。Cordis 的规矩是「未在 inject 里声明的服务，
访问即抛」，于是该行挂不上；`proof-discipline` 一挂不上，纪律段与 `proof_audit` 都没了，
**整个数学证明模式等于不可用**。（官方 `dsh-persona` 正是 `inject = ["systemPrompt"]`。）

**为什么现在才炸**：DSH 升级到 `0.1.2-rc.1` 后这条检查变严（用户此前也说过「因为版本升级重置过」）。
「以前能跑」不代表现在能跑——这类问题必须机器检查。

**修复**：`export const inject = ['tools', 'systemPrompt']`。

### 63.2 用严格 proxy 复现并验证

```js
// 模拟 Cordis：访问未 inject 的服务就抛
new Proxy(base, { get(t,k){ if (服务 && !inject.includes(k)) throw new Error(`cannot get property '${k}' without inject`); return t[k] } })
inject=['tools']              → ❌ cannot get property 'systemPrompt' without inject   ← 与用户报错逐字一致
inject=['tools','systemPrompt'] → ✅ 挂载成功（注册 proof_audit + 纪律段）
```

### 63.3 新增门禁 `tests/inject-check.mjs`（第 18 个入口，INJECT_OK 20/20）

| 检查 | 说明 |
| --- | --- |
| 静态：`ctx.<服务>` 必须在 `inject` 里 | 剥掉注释再扫（否则会把文档里的 `ctx.shell` 误判——本次差点误报 `proof-dag`）；Cordis 核心成员（24 个：`get/on/effect/logger/inject/provide/scope/…`）白名单除外 |
| **真挂载模拟** | 用**严格 ctx** 逐个 `apply()` 六个插件，断言不抛、且注册出 **6 个工具 + 纪律提示段** |
| 反向提示 | `inject` 声明但未使用 → 只提示不判失败（可能为等待服务就绪） |
| 覆盖 | 组合里每个 `./plugins/*.mjs` 行都必须被本门禁检查到 |
| 具体回归 | 钉死「`proof-discipline` 必须声明 `systemPrompt`」 |

### 63.4 顺带加固：配置坏掉不再连坐 preset（并加了防漂移）

同轮早先的测试暴露出另一个脆弱点：`impl/local-paths.json` **缺失或语法坏掉**时，
`agda-engine` / `proof-discipline` 会在 **import 期抛错** → 两行挂不上 → 同样「整个模式不可用」。
现在解析器内置**兜底表**：配置读取失败 → 用兜底值 + 在提示段里明确警告，**绝不在 import 期抛错**（实测坏 JSON / 缺文件都能照常挂载）。

代价是路径出现在两处（JSON + 解析器兜底）→ 新增门禁断言：**两者逐键必须一致**（value + env 名），
`paths-check` 13/13；`publish-check` 的允许清单同步。

### 63.5 复验

`check-all` → **CHECK_ALL_OK 18/18**（新增 `inject-check` 20/20；`paths-check` 13/13；`publish-check` 36/36）。

## 六十四、第五十九轮：**本轮运行失败的第二个真根因**——提示段里的字面 `{{key}}`（2026-09-10）

用户报错原文：**`unknown prompt variable "{{key}}" in section "math-proof:discipline"; registered variables: provider, model, cwd`**
→ **本轮运行失败**（不是某一行挂不上，是整个 prompt 装配失败）。

### 64.1 根因

`dsh-system-prompt` 对每个 section 的 text 做**严格插值**：文本里任何 `{{名字}}` 都被当成变量引用，
而部署注册的变量只有 **`provider` / `model` / `cwd`**；未注册 → **抛错 → 整轮运行失败**。

我在「本机路径」小节末尾为了说明 token 写法，写了示例文字 **``（纪律段里写作 `{{key}}`）``** ——
**文档示例被当成了真变量**。这是上一轮路径集中化时我自己埋的雷。

### 64.2 修复

把该行改成**不含花括号**的表述（「纪律段里用双花括号包住键名书写」），并在代码里留下警示注释。
修复后实测：注入文本里 `{{...}}` 残留 **[]**、含裸 `{{` **false**。

### 64.3 新增门禁 `tests/prompt-vars-check.mjs`（第 19 个入口，PROMPT_VARS_OK 10/10）

| 检查 | 说明 |
| --- | --- |
| 抽三段提示文本 | ① persona（从 composition 的 `text: \|-` 块）② composition 里所有 `section:` 块（如 plan-mode）③ **本 preset 装配注入的纪律段**（`disciplineWithPaths()`） |
| 未注册变量 | 任何 `{{名字}}` 必须在注册集合内（默认 `provider,model,cwd`，可用 `DSH_PROMPT_VARIABLES` 覆盖） |
| **裸 `{{`** | 一律判失败——即使没配对，拼接后也可能变成 malformed reference 炸整轮 |
| 具体回归 | 纪律段注入文本**不得再有任何花括号**（token 必须已被替换）+ 「本机路径」小节在场 |
| 静态提醒 | 插件源码里不得出现「`section(` + `{{`」的危险写法 |

**证明它能拦住**：把 `{{key}}` 故意放回去 → 门禁立刻红，报出的正是
`未注册 {{key}}（注册集合：provider, model, cwd）`；恢复后 10/10。

### 64.4 复验

`check-all` → **CHECK_ALL_OK 19/19**；挂载校验 ✅。

## 六十五、第六十轮：**修好了却仍报同一个错**——Node ESM 缓存（2026-09-10）

用户反馈：同一报错仍在（`unknown prompt variable "{{key}}" in section "math-proof:discipline"`），
而磁盘上的文件**已经修好了**（`prompt-vars-check` 证明注入文本里没有任何花括号）。

### 65.1 根因：Cordis 加载器**不做 cache-busting**，同进程重挂载拿的是缓存旧模块

```js
// cordis-plugin-loader lib/index.js:275-281
else if (name.startsWith(".")) return await import(new URL(name, this.ctx.baseUrl).href)
//                                                        ↑ 没有 ?v= 之类的 query
```

实证（`/tmp/esmtest`）：

```
第一次 import: OLD
改文件后再 import（同进程）: OLD   ❌ 仍是缓存的旧模块
带 ?v= 重新 import: FIXED          ← 只有 query 能打破缓存
```

**推论（修正我们一直以来的错误认知）**：改 `plugins/**`、`hooks/**` 的**代码** →
**必须重启 dsh 进程**；「开新会话 / 重新挂载」**不够**（模块 URL 相同 → 命中 ESM 缓存）。
真热的只有「每次用时读文件」的内容：`impl/discipline.md`、`impl/ruleset.mjs`（`?v=` 热读）、`impl/local-paths.json` 的**值**。

### 65.2 用户这次的具体时间线（精确到分钟）

| 时刻 | 事件 |
| --- | --- |
| 12:18:05 | 我修 `plugins/proof-discipline.mjs`（`inject` 加 `systemPrompt`） |
| **12:27:35** | **用户重启了 dsh 进程**（pid 254841）→ 这次重启**吃到了** inject 修复 |
| **12:29:48** | 我才修 `impl/local-paths.mjs` 里的 `{{key}}`（**比进程晚 2 分钟**） |
| 12:35+ | 用户再试 → 进程里仍是旧 `local-paths.mjs` → **同一个错** |

结论：**不是没修好，是修复晚于进程启动**。再重启一次即生效。

### 65.3 工具与文档更正（并加门禁 `reload-check`，第 20 个入口）

1. `scripts/reload.mjs`：新增**进程启动时间 vs 代码 mtime** 比对 → 直接给出
   「**必须重启 dsh 进程（ESM 缓存：新会话不够）**」的判定；输出里解释机制（引用加载器行号 + 实证结论）。
   - 顺带修一处**误判**：`codeFiles()` 原先只查 `plugins/`，漏了 `impl/` 与 `hooks/` →
     在用户这台机器上它曾错误报告「进程内已是当前代码」（实际 `impl/local-paths.mjs` 是新的）。现在覆盖
     `plugins/** + hooks/** + impl/**.mjs + hooks.json`；
   - 进程检测改用 `ps -eo pid,etimes`（不依赖本地化日期格式）。
2. 文档更正（三处）：`README.md` §一.9 热重载表、`docs/maps/M5-lifecycle.md`、`agent.cordis.yml` 头部 ——
   冷档一律改为「**必须重启进程**」，并注明实测日期与机制。
3. 新门禁 `tests/reload-check.mjs`（**11/11**）：断言 reload 给出重启判定、冷档覆盖三目录 + `hooks.json`、
   三处文档都写明「重启」、**README 不得再把插件代码改动说成「新会话即可」**（反面断言；顺带修掉它自己
   对「校正括注」的误判）。

### 65.4 复验

`check-all` → **CHECK_ALL_OK 20/20**。

## 六十六、第六十一轮：提示段文字做成**真热**（模板文件）（2026-09-10）

用户：**「加」**（同意把提示段文字改成可热，避免以后再为文字 bug 重启进程）。

### 66.1 约束：section text 是**同步**调用

```js
// dsh-system-prompt lib/index.js:330
text: typeof section.text === "function" ? section.text(context) : section.text   // 无 await
```

→ 不能用 `?v=` 动态 import（那是异步的，`ruleset.mjs` 那条路走不通）。
**唯一可行的热路径：把「文字」放进每次装配都同步读盘的文件。**

### 66.2 做法

| 件 | 变化 |
| --- | --- |
| 新增 `impl/path-section.md` | 「本机路径」小节的**文字模板**（占位符 `{paths}` 展开成键值清单；也可用 `{{键名}}` 引用真值） |
| `impl/local-paths.mjs` | `renderPathSection()` 改为**每次同步读模板 + mtime 缓存 + 值每次重读**；读不到模板时退回内置兜底模板（绝不抛错） |
| 支持 `MATH_PROOF_PATH_SECTION` 环境变量 | 便于测试与自定义（门禁靠它做「同进程改文件」实验） |

现在**文字、值、env 覆盖三处改动都不需要重启进程**；只有「渲染逻辑」本身（很少动）仍是冷档。

### 66.3 新门禁 `tests/hot-section-check.mjs`（第 21 个入口，HOT_SECTION_OK 12/12）

- 模板 A → 渲染含 A；**同进程**改模板为 B → 再取立刻含 B（**证明不用重启/重挂载**）；
- `{paths}` 展开正确、渲染结果**不残留任何花括号**（残留会让整轮装配失败）；
- 值可用 env 覆盖且当次生效；默认模板真身存在且被使用；
- 纪律段（注入真身）包含「本机路径」小节且无花括号。
- 测试里踩到两个**自身**陷阱（已修）：`MATH_PROOF_PATH_SECTION=''` 会被当成路径（空串不是 nullish）；本进程已导入的 `local-paths` 绑定在临时模板上，跨进程断言必须在**干净 env 的子进程**里做。

### 66.4 与钩子的关系（用户问：你的热重载会不会把 hooks 拦截弄没了？）

**没有——两者正交**：

| 件 | 改动生效方式 |
| --- | --- |
| `hooks/*.mjs`（钩子脚本本体） | **热**：桥每次调用都 spawn 一个新 `node` 进程 → 改脚本立即生效 |
| `hooks.json`（注册表：哪个事件挂哪个脚本） | **冷**：挂载时读；改它要重启进程 |
| `plugins/**`（工具本体） | **冷**：ESM 缓存，必须重启进程 |

本轮**没动 hooks 的任何一行**；`hooks-check` 48/48 全过（拦 / 放行 / 只拦一次 / 逃生开关 / 注册表结构）。
运行时状态：当前 dsh 进程启动于 12:27:34，而钩子文件 mtime 为 11:18 → **进程内的钩子就是最新版，拦截在生效**。

### 66.5 复验

`check-all` → **CHECK_ALL_OK 21/21**。

## 六十七、第六十二轮：把判定规则**退回冷档**，删掉唯一自造机制（2026-09-10）

用户先问了一个架构问题：**「这个冷的是符合标准的插件化，你的热的是什么？」** 我如实分类后给出结论：
冷的（`plugins/**`、`hooks/hooks.json`、composition、persona、工具 schema）＝**标准插件契约**；
热的里面，`impl/discipline.md`、`impl/path-section.md`、`impl/local-paths.json` 是「插件运行时读的**数据/文本**」
（`dsh-system-prompt` 官方就支持 `text` 为函数、每次装配求值），而
**`impl/ruleset.mjs` 的 `?v=<mtime>` 动态 import 是本 preset 唯一自造的机制**。
用户回：**「冷的」** —— 即：**退回冷档**。

### 67.1 改了什么

| 件 | 变化 |
| --- | --- |
| `impl/ruleset.mjs` | 删掉 `loadRules` / `loadRulesFrom` / `rulesetStatus` 与 mtime 辅助；只留**常量表 + `RULESET_PATH` + `moduleHash`**；`RULESET_VERSION` **r6 → r7**（加载语义变了） |
| `plugins/proof-dag.mjs` | 不再每次调用动态加载；规则来自**静态 import**；`doctor` 改为比对「**磁盘 hash vs 进程内加载的 hash**」，落后就报「改过规则但没重启进程」；`check` 的规则集戳同源 |
| `plugins/agda-engine.mjs` | 结果级分诊表同样改为静态 `RESULT_TRIAGE` |
| 文档 6 处 | `reload.mjs` 档位表（规则从 🔥 移到 ❄️）、`README §一.9`、`docs/maps/M5`、`impl/discipline.md`、`agent.cordis.yml` 头部、`§一.13` 复盘表 —— 一律改为「静态 import（冷档）：改规则要重启进程」 |
| 门禁 | `ruleset-check` 的「热读生效」断言换成**冷档断言**（无 `loadRules`/`?v=`、`RULESET_PATH`/`moduleHash` 在场、doctor 报冷档）；`reload-check` 增加「规则行必须是冷档口径、不得再说立即生效」 |

### 67.2 行为验证（同进程）

```
改动前: 判定规则 r7/a8429041（静态 import，冷档；✅ 与磁盘一致）
磁盘改一行后再调（同进程）:
        判定规则 r7/a8429041（…；⚠ 磁盘上是 6980ee91 → 改过规则但没重启进程，本次结果仍按进程内那一版解释）
        check: 规则集 r7/a8429041 ⚠ 磁盘上的规则与进程内不同（改规则后需重启 dsh 进程才生效）
```

即：**规则不再「有时生效」**，而是「改了没重启 = 明确报出来」——比原先的隐式热读更可预期。

### 67.3 现在的热/冷边界（原则：契约优先，不造机制）

| 档 | 内容 | 机制 |
| --- | --- | --- |
| 🔥 热 | `impl/discipline.md`、`impl/path-section.md`（提示段文字）、`impl/local-paths.json`（值）、`hooks/*.mjs`（外部命令，每次 spawn） | **官方缝**：section text 为函数（每次装配求值）+ 读文件；命令钩子每次执行 |
| ❄️ 冷 | `plugins/**.mjs`、`impl/ruleset.mjs`、`hooks/hooks.json`、`agent.cordis.yml`、persona、工具 schema | **标准插件契约**（Loader 静态 import）；改了一律**重启进程**，`reload.mjs` 给判定 |

**结论**：`plugins/` 里再无自造机制；热路径只剩官方的「数据/文本读盘」。

### 67.4 复验

`check-all` → **CHECK_ALL_OK 21/21**（`ruleset-check` 51/51、`reload-check` 15/15）；挂载校验 ✅。

## 六十八、第六十三轮：**批量登记通道的证据洞**（`import` 静默丢回执）（2026-09-10）

用户转来块 3（Burnside）的工作报告，并对其中一处发问：**「你这个哪里出现问题了，没有持久化吗？？」**
报告里写：用 `import` 批量登记已证节点后，**9 个节点从「有证据」变成「proven 无证据」**，评分一度从 100 → **55**，
而报告只写「更新 9」，看不出原因。

### 68.1 复现（临时工作区，未动生产台账）

```
① import 带 receipt:'deadbeef' → {"state":"proven","receipt":null,"verified":false}   ← 静默丢掉
② import 无回执写 state:"proven" → 接受；check 报「proven 无证据 2 个（−20）」→ 80/100
```

**结论：不是「没有持久化」**。台账是**原子写**（tmp + rename）、并有**见证 git**（每次关键变更提交
`ledger.json` + `journal.jsonl` + **全部 `receipts/*.json`**）——持久化是好的。
问题在**批量通道本身**：`import` 的字段白名单里**没有** `receipt`/`oracle`/`evidence`/`postulates`，
所以条目带的回执被无声忽略；同时它**允许直接写 `state:"proven"`**，绕过了 `add`/`update` 的全部证据门禁。
（`update` 与 `add` 一直是正确的——所以「改用 update 逐节点带证据」能救回来，正是报告里做的。）

**数据能找回**：见证仓库里有变更前的台账快照 + 回执原件，必要时可从历史恢复。

### 68.2 修复：批量通道不再豁免证据

| 改动 | 内容 |
| --- | --- |
| 接受证据字段 | 条目可带 `receipt`（**校验源码哈希**，无效即拒）、`oracle`（校验回执）、`postulates`（规范化 + 门禁）、`evidence` |
| `proven` 门禁 | 写 `state:"proven"` 必须带**有效回执**（或该节点已有有效回执），否则**该条目被拒**并给出三选一：① 带 `receipt`；② 先按 `active`/`needs_review` 导入再 `update` 带回执；③ 历史迁移用调用级 `allowUnevidencedProven: true` |
| 显式逃生 | `allowUnevidencedProven: true` 放行的节点在报告里**单独列出**，且 `check` 照常扣分（不静默） |
| 覆盖保证据 | 覆盖既有节点时，条目省略证据字段 → **保留原 receipt/oracle/evidence + 已验证标记**（这是当初「丢失」的那三项，已加回归断言钉死） |
| schema | 新增 `allowUnevidencedProven` 参数（`additionalProperties:false` 下不加会被拒收）；`items` 描述写明「批量通道不豁免证据」 |
| 纪律段 | 增一条：「批量登记不豁免证据……登记完必须跑 `check` 看『proven 无证据』是否为 0」 |

### 68.3 回归（`tests/run.mjs` +10 条断言，423/423）

有效回执被记录并标记已验证｜无效回执被拒且**不落盘**｜无回执写 proven 被拒且不落盘｜显式放行会被单独列出且
check 照常扣分｜**覆盖时保留 receipt / evidenceVerified / evidence 文本**。

### 68.4 复验

`check-all` → **CHECK_ALL_OK 21/21**（`run` **423/423**）；挂载校验 ✅。

## 六十九、任务预算与流量账本（2026-09-10）

**用户提问**（原话要点）：每次预算能不能让模型自己 ±10% 加/减，直到单次任务能很好地跑完；
「速度太快、无限循环、耗费流量」该怎么办；**用什么来评价每次任务的流量平均消耗**。

### 69.1 先量，再设计（这一步改变了整个方案）

把本机全部会话日志算了一遍（数据源 `~/.dsh/sessions/**/session.jsonl[.zstd]`，取
`assistant/message.usage`，与 `@deepseek-ai/dsh-token-meter` 同源）：

| 指标 | p25 | 中位 | p75 | p90 | max |
| --- | --- | --- | --- | --- | --- |
| 单回合 tok | 3.15M | **6.61M** | 11.07M | 17.63M | 84.14M |
| 单回合步数 | — | **16** | — | 52 | 325 |
| 单回合墙钟 | — | 111.7s | — | 398.1s | 2109.8s |

中位回合拆开：`input 8.2k` + `cacheRead` **6.58M** + `output` **14.2k**
⇒ **99.6% 的流量是上下文被重复读；模型真正写出来的字只占 0.9%**（合计 1.62B token / 174 回合）。

据此否掉了三种「直觉方案」：
1. **按 token 给预算** —— 模型无法观测自己的 token 消耗，给了也执行不了；改为**工具调用次数**
   （钩子能精确数、模型也能自己数）。
2. **让模型少写字** —— 只影响 0.9%，杠杆约等于零。
3. **用均值做基线** —— 类内差 5.6 倍（p25↔p90），单个 84M 的失控回合足以把均值拉偏 ~50%；
   改为**按类取中位数**（窗口 20 条，同 workspace 样本优先，样本 <5 条**只记账不动手**）。

顺带发现**本会话自己就是样本**：提问那一轮已跑到 60+ 步——正是用户描述的形态。

### 69.2 设计:自适应只挂在两种结局上（防棘轮、防刷指标）

| 结局 | 动作 | 理由 |
| --- | --- | --- |
| 已验证完成（完成 + 机器证据 + 没撞墙） | **−10%** | 唯一能证明「预算够用」的证据 |
| 撞到预算墙（被拦过且没完成） | **+10%** | 唯一能证明「预算不够」的证据 |
| 撞墙但完成且有证据 | 不动 | 预算刚好卡住，不该再收紧也不该再放宽 |
| 完成但无证据 | 不动 | 没证据的「完成」不算数，否则模型靠缩小目标刷低预算 |
| 失败 / 中断 / 报错 | 不动 | **失败不养预算**——否则一个坏构建就能把预算养肥（棘轮） |
| 未闭合 / 窗口截断 | 不动 + 待结算 | 少算步数会让预算误判「很便宜」 |

配套硬约束：夹紧 `[0.5×, 2×]` 该类中位调用数；追加预算走**申请制 + 记债**
（`topup` 限 1 次/任务、理由 ≥20 字、批 +50%、下个已验证完成的任务扣回 10%）。
**「让模型自己加预算」的答案是：可以，但必须是申请 + 记账，不能是自由旋钮——否则压力是假的。**

### 69.3 实施（复用官方缝，不造机制）

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 量 | `impl/session-traffic.mjs` | 多帧 zstd 结构扫帧（含**尾部半帧容忍**）+ 按回合折叠 + 分类 + 稳健统计 + 账本存取 + 回执判定 |
| 判 | `impl/budget-policy.mjs` | 开局公告 / 纯函数闸门判定 / 播报 / 结算 / ±10% 自适应 / 补账 |
| 表 | `impl/ruleset.mjs` `BUDGET` + `RECEIPT` | 阈值、先验、白名单、取证集、分类正则、回执标记（r7→r8） |
| 工具 | `plugins/budget.mjs` | `status`/`report`/`classes`/`topup`/`calibrate`/`history`/`explain`/`on`/`off` |
| 钩子 | `hooks/budget-{start,gate,tick,settle}.mjs` | 公告 / 两级刹车 / 过程播报 / 只做副作用的结算登记 |
| 报表 | `scripts/traffic-report.mjs` | 全机流量报表 + `--calibrate` 用真实日志标定 |
| 门禁 | `tests/budget-check.mjs`（168 条） | 规则自洽 / 计量（含 zstd 多帧与撕裂容忍）/ 判定 / 结算与夹紧 / 还债 / 投递契约 |

刹车分级：**80% 提醒 → 100% 禁取证类 → 130% 只留收尾白名单**；**同一工具同参数第 4 次**直接拦
（「无限循环」的正解是打转检测，不是预算数字）；一个回合最多拦 3 次（拦多了本身就是流量）；
白名单与取证集**不相交**（门禁断言）。被拦的文案固定给出收尾三步：`proof_dag journal` 落盘 →
`todo_write` 列缺口 → 需要就 `topup`。**信息只许收敛、不许丢**。

### 69.4 顺带查实的存量 bug：Stop 钩子的投递从来没生效

核对官方桥源码（`@deepseek-ai/dsh-hooks-claude-code`）：`agent/turn-stopping` 回调
**只处理 `decision === "deny"`**（`agent.steer` 强行续跑），**不调用 `contextFrom`**；
对比 `SessionStart` / `UserPromptSubmit` / `PostToolUse` 三处都真的注入了 `additionalContext`。
日志旁证：`hook/result` 只记 `turn/point/handlerId/decision/exitCode/durationMs`（**不记 output**），
而 SessionStart 的「接手简报」与 UserPromptSubmit 的「fable5 开工四项」都能在日志里找到对应的
`user/message`（`source.plugin = hooks-claude-code`），**唯独 Stop 的文本一次都没出现过**。

修法：删除 `hooks/stop-reminder.mjs`（死代码 + 每回合白起一个进程），新增 `hooks/carryover.mjs`
信箱——Stop 钩子把「收工检查」「fable5 收工三项」写进信箱，下一轮 `UserPromptSubmit`
（`budget-start.mjs`）取空并念出来。`fable5-flow.mjs` 的 Stop 分支同样移除。
**约束写进注释与门禁**：不要在 Stop 里输出 `additionalContext`，也不要在 Stop 里 deny。

### 69.5 CI 矩阵抓到的真事故：Node 20 上命名导入 zstd = 链接期炸

推送后 `gates` 的 **Node 20** 作业失败（22/24 通过），日志是：

```
SyntaxError: The requested module 'node:zlib' does not provide an export named 'zstdDecompressSync'
  ❌ 真挂载模拟：budget.mjs 用严格 ctx 能 apply
  ❌ 7 个工具都被注册（含 budget） — proof_compile,proof_dag,proof_audit,proof_graph,prover_limits,proof_oracle
```

即：`node:zlib` 的 zstd 是 **22.15 / 23.8** 才有的，而**命名导入**在旧版本是**链接期**错误
（不是运行时 undefined）→ 整个 `plugins/budget.mjs` 加载失败、第 7 个工具根本没注册。
这与之前「`inject` 少声明一个服务导致整个 preset 不可用」是同一类：**小语法/依赖失误 → 全盘不可用**。

修法（**运行时探测，不写死版本**）：

- `import * as zlib from 'node:zlib'` + `typeof zlib.zstdDecompressSync === 'function'` 探测，
  导出 `ZSTD_SUPPORTED`；三处解压点全部先判能力，老 Node 上返回「没有数据 / truncated」而不是崩；
- `budget status` 与 `traffic-report` **如实报出**「本机 Node 读不了压缩日志」并说明缺什么能力；
- `tests/budget-check.mjs`：无 zstd 时相关 6 条断言记 **SKIP（⏭）** 而不是失败，并新增两条断言
  覆盖降级路径；再加一条**静态断言**：`impl/session-traffic.mjs` 不许命名导入 zstd（剥注释后扫描，
  防有人照注释里的反面示例写回去）；
- CI 注释与作业名同步写明 Node 矩阵与这条坑（原作业名还写着过期的「期望 CHECK_ALL_OK 15/15」）。

本地复验：Node 24.1.0 与 Node 22.22.1 都 **CHECK_ALL_OK 22/22**；Node 20 的最终判定以 CI 为准。

### 69.6 复验

`check-all` → **CHECK_ALL_OK 22/22**（新增 `budget-check` 168/168；`hooks-check` 改写为
58/58 并钉住「Stop 不输出」；`plugins-check` 24/24；`inject-check` 22/22；`docs-check` 80/80）。
新增 `docs/maps/M7-budget.md`（含控制环与控制流两张 Mermaid 图、口径表、开关表、**未知边界清单**）。
**尚未验证**：钩子在**真实 dsh 会话**里被桥调用这一步要重启进程后才算实测（M7.9 已如实标注）。

## 七十、思考强度自动调节：先量，两个直觉被自己的数据否掉（2026-09-10）

**用户要求**（原话要点）：这个流量熔断机制也要防止模型的**无限循环输出、浪费流量和过度思考**；
**让模型自动调节思考强度**。

### 70.1 先量（三张表，`node scripts/traffic-report.mjs` 可复算）

① 思考强度到底占多少：

| 指标 | 数值 |
| --- | --- |
| reasoning token 合计 / 全部流量 | **2.02M / 1678M = 0.12%**（中位回合 0.078%） |
| 每步 reasoning（中位 / p90 / max） | 350 / 1112 / 6170 |
| 每步 ≥1000 reasoning 的回合（n=20） | 步数中位 **15.5**、tok 中位 **4.05M** |
| 每步 <300 reasoning 的回合（n=75） | 步数中位 **17**、tok 中位 **9.32M** |

⇒ **「过度思考烧流量」不成立**；而且**高思考回合反而更省**。理由是流量 ≈ 调用次数 × 每步上下文，
思考 token 本身在 0.12% 量级，真正贵的是**多跑了几轮**。

② 「无限循环输出／原地打转」到底有没有：

| 信号 | 实测 |
| --- | --- |
| 重复**长文本块**（≥300 字，同回合内） | 159 个含长文本的回合里 **0 次重复** |
| 同工具同参数重复调用（`repeatMax`） | 多为 1–2，个别 3–4（保留既有「第 4 次拦」检测） |
| 重复**结果**（归一化后同指纹）连续段 | 中位 **0**、p90 2、max 7 |
| 「无推进」（连续调用不写任何文件/回执） | 中位连续 **11** 次、p90 35；**50% 的回合整轮没有任何写入** |

⇒ 「输出刷屏」目前**不存在**（不建检测器）；「无推进」**不能当刹车**（纯调查/阅读本来就是正经工作，
阈值会天天误拦）。真正成立的只有「同工具同参数反复调」——既有的打转检测刚好覆盖。

### 70.2 于是：一建一测一拒

- **建**：`plugins/effort-governor.mjs`——挂官方 `agent/request` 瀑布（契约：`await next()` 拿机器本来要用的
  `LlmCallConfig`，返回替换值即换配置），预算过 60% 降到 `low`、过 85% 降到 `off`；任务结束按
  `effortBefore` **精确还原**。定位写清：**不是省流量的旋钮，是「预算吃紧时强制收敛」的旋钮**。
- **测**：`request/header` 里本来就落 `config.reasoningEffort`（实测本机 `{"reasoningEffort":"high","maxTokens":256000}`），
  于是把 `effortAtStart/effortLast/effortDowngraded` 折进回合、写进结算样本、并在报表里出
  「思考强度 vs 消耗」分组表——**用用户自己的数据**回答「降档到底有没有让任务更快收敛」，
  而不是由我下结论（现在样本里全是 `high`，还答不了）。
- **拒**：无推进熔断、长文本重复检测、重复结果熔断——三条都有实测支持，理由留在本节，将来数据变了可以据此重开。

### 70.3 安全纪律（六条，插件头注释 + 门禁钉死）

先 `await next()` 只改一个字段（**键集不变**）｜**只降不升**｜看不见档位或档位未知 → 不动
（DeepSeek 适配器只认 `off|low|high|max`，传别的**抛错**）｜还原用 `effortBefore` 而不是猜用户意图｜
`next()` 的异常**原样抛出**（不吞模型路由错误）｜其它异常 → 退回机器原配置（**绝不因为调速让一次请求失败**）。

### 70.4 回归与踩坑

- `tests/budget-check.mjs` 新增「思考强度」一节 **+40 条断言** → **211/211**（策略/安全/降档/还原/折叠/组合/静态）；
- 加插件行后踩到三个门禁的**测试替身太薄**：`scripts/lint-schemas.mjs`、`tests/assemble-context.mjs`（被
  knowledge/dup/cache-check 复用）、`tests/run.mjs` 的假 ctx **没有 `ctx.on`** → 全部崩在 `ctx.on is not a function`。
  已给替身补上 `on`（返回 disposer），并让 `inject-check` **记录监听到的事件名**、断言调速器挂的是
  `agent/request`——替身该跟着真实契约长，而不是让插件去迁就替身。
- 另有两次自证式 bug：`EFFORT` 是 ruleset 的**顶层导出**（不是 `BUDGET.EFFORT` 字段）；
  以及 `effortLast` 一开始用的是「折叠末尾的运行值」，导致所有回合都拿到同一个档位
  → 改为在 `turn/end` **当场**取快照，并用独立标志区分「回合结束时刻档位为 null」与「回合没结束」。

### 70.5 复验

`CHECK_ALL_OK 22/22`（budget-check 211/211；inject-check 25/25 含新断言；docs-check 81/81；plugins-check 24/24）。
新增 `docs/maps/M7-budget.md` §M7.6（含控制流图、安全纪律、**被否证的三条**）。

## 七十一、文件权限：用户的一条提醒查出的三件事（2026-09-10）

**用户提醒**：`engineering/tests/` 下两个 oracle 脚本是 `-rw-------`，若希望 CI 或他人可跑，需要放开读权限。

### 71.1 范围比「两个文件」大得多

`find -perm -u+r ! -perm -o+r` 在会话工作区数出 **103 个仓库文件**是 0600
（`src/` 60、`docs/` 32、`memory/` 5、`engineering/` 6，另有工具私有状态目录 70 个不计），
本 preset 仓库另有 **83 个**（包括本轮新增的全部文件）。已全部 `chmod 664`（与本仓库其余文件一致）；
`git status` 条目数前后都是 159（preset 仓库 0），**权限位确实不影响 git 状态**。

### 71.2 但「放开读权限」并不是 CI 跑不了的原因（这条必须纠正）

- git **只记可执行位**（`100644` / `100755`），**不记**组/其他人的读写位 → 一个 0600 文件提交后就是 100644，
  检出即 0644（随检出方 umask）。所以权限不是 CI 的障碍。
- 真正的原因是**这些文件根本没进仓库**：抽查 5 个 `engineering/tests/*.py` **全部 UNTRACKED**；
  整块 Burnside 工作（`BurnsideMain.agda`、`BurnsideNecklace.agda`、`memory/burnside-block5-necklace.md`）也全未提交，
  该仓库共 **141 条未跟踪条目**。**要让 CI 跑到它们，必须提交**（哪些该提交是仓库治理决策，不擅自代替决定）。

### 71.3 根因在 harness：原子写让**新文件**保持 0600

`@deepseek-ai/dsh-fs-local` 的 `writeFileAtomic`：

- `await handle.chmod(384)`（`lib/index.js:484`）→ **暂存文件是 0o600**（同目录私有暂存目录 0o700）；
- `if (mode !== void 0) await handle.chmod(mode)`（`:495`）→ 只有**传了目标权限**才改回去；
- 调用点 `writeFileAtomic(target, content, existing?.mode, …)`（`:791`）→ **新文件**传的是 `undefined`。

⇒ **agent 的文件工具新建的文件一律 0600**。复现（同目录、同 umask 0002）：`write` 工具建的文件 `-rw-------`、
`bash` 重定向建的是 `-rw-rw-r--`、编译器写的 `_build/*.agdai` 也是 `-rw-rw-r--`。与 preset 的代码无关。

### 71.4 我们这边能修的那一半（真问题在分发包）

`scripts/publish.mjs` 用 `cpSync`，而 **`cpSync` 保留源权限** → 本地构建的分发包会带 0600。
实测（把 `impl/ruleset.mjs` 设成 600 后构建）：**去掉归一化 → 分发件里是 600；加上归一化 → 644**。

- `publish.mjs`：拷贝后显式 `chmodSync`（可执行位保留 → 0755，其余 → 0644）；
- `publish-check`：新增两条断言——「分发件里没有别人读不了的文件」「权限被归一化（不受构建者 umask 影响）」，
  并**实测门禁有牙**（把归一化去掉两条都变红：`math-proof/impl/ruleset.mjs(600)`）；
- `publish.mjs --dry-run`：顺带报出本地树里还剩多少个 0600（信息性提示，不改退出码）。

上游修法（新文件按 `0o666 & ~umask` 落权限）留给 `dsh-fs-local`——那是部署侧代码，不擅自改已安装的包
（pnpm store 里是构建产物，升级即覆盖）。

### 71.5 复验

`CHECK_ALL_OK 22/22`（publish-check 36→**38/38**；docs-check 81/81）；两处工作树 0600 计数均为 **0**；
生效目录与仓库一致；CI 20/22/24 全绿。

## 七十二、会话级 token 预算：先定标再定数（2026-09-10）

**用户问**：既然防无限循环的多 API 机制已经有了，就不用加熔断器了；那**给单次会话加个百万 token 消耗预算**呢？有吗？DSH 有监控数据接口吗？

### 72.1 「有吗」——没有；先把口径量清楚

查遍 harness：**不存在任何会话级 token 上限**。
`maxTokens` 是**单次请求的输出上限**（`agent-loop` 的 agent options，实际值 256000）；
compaction 管的是**上下文压力**（不是累计花费）；`tokenUsage` 投影**只测不限**。
全 harness 里带 "budget" 的配置字段只有 thinking/image/log 之类，没有一个是「本次会话总共能花多少」。

再定标（26 个会话，`Σ_回合(input+cacheRead+output)`）：

| 口径 | 中位 | p90 | max |
| --- | --- | --- | --- |
| 单会话累计 tok | **1.25M** | 89M | **832M** |
| 单回合 tok | **6.61M** | 17.63M | 84.14M |

⇒ **用户设想的「100 万 token 一次会话」在本负载下不成立**：中位会话已经 1.25M，而**单个中位回合**就是 6.61M
——1M 的预算会在**第一次模型调用**里撞线，连一个完整回合都跑不完。
（这条必须在实现前说清，否则做出来的东西一上线就把所有会话拦死。）

### 72.2 实现：默认 5e8，四层都有

| 层 | 做法 |
| --- | --- |
| 表 | `impl/ruleset.mjs` 的 `SESSION`（`defaultTokens 5e8` / `warnAt 0.8` / `hardAt 1` / `env MATH_PROOF_SESSION_BUDGET` / 显式标注 `staleByDesign`），r9→**r10** |
| 口径 | `会话已用 = 已闭合回合累计(sessionTok) + 最近读到的当前回合 tok(liveTok)`；`pending` 回合**不计**（tok 不完整，下轮补账） |
| 判定 | `gateDecision` 里排在**原地打转之后、任务预算之前**：到硬线拦非白名单工具，理由与「任务预算用尽」**分开写**（这是额度到顶，不是任务失败），给出 落盘 → 列缺口 → **新开会话** 三条出路 |
| 全链路 | 公告加会话行；`PostToolUse` 播报带会话进度；`Stop`/补账把闭合回合 tok 累加回会话状态（下轮开局继承）；**会话第一次开局全量折叠一次**（续接老会话也准） |

### 72.3 监控接口盘点（9 条，全部是官方缝，不是我们发明的）

`tokenUsage` 投影（**累计桶** + wire view → GUI `TurnUsagePanel`）｜`contextPressure` / `contextBreakdown` 投影｜
`tokenMeter.measure()`｜`sessionStats` 投影｜`sessionProjections.stateOf()`｜`sessionQuery`（跨会话）｜
会话日志（本 preset 的 `session-traffic.mjs` 读它）｜`sessionTelemetry` + `dsh-session-telemetry-otel`（导出到后端，本项目未启用）｜
事件审计（`llm/retry` / `hook/result` / `request/header`）。

**⚠ 测 ≠ 限**：以上没有一个是硬上限——这正是要自己加 `SESSION` 的原因。

### 72.4 回归与复验

`budget-check` **256/256**（+38 条：解析 `1M/500M/1B`、优先级 env>账本>默认、`sessionTok+liveTok` 口径、
硬线/白名单/每回合最多拦 3 次、闭合才累加、补账回写、`session` 动作看设复位与坏值报错、
**钩子端到端**（fixture 全量折叠得 2140 → 推高到线 → exit 2 → 白名单仍放行）、静态断言 SESSION 真被用上）。
文档：`docs/maps/M7-budget.md` 新增 §M7.7（含实测表、口径、滞后说明、9 条监控接口表），README/discipline 各一段；
`SESSION.env` 与 `budget action:"session"` 进开关表。

## 七十三、额度监控：先纠三处接口事实，再写代码（2026-09-10）

**用户转来**：Python + Node 两版「熔断 + 额度监控」实现，以及一个 TS 包（`dsh-quota-guard`）的完整计划。

### 73.1 逐条核对后：一半不用加，一半的接口假设是错的

| 转来的说法 | 核实结果 |
| --- | --- |
| 「客户端熔断（三态 + 退避 + 错误分类 + 并发闸）」 | **DSH 已有更完整的**：`maxRetries` 默认 5（按 step 重置）、`localDelay` 指数退避 500ms→10s + jitter 0.1、`retryableCodes` 分类（429→RATE_LIMIT、≥500→SERVER、401/403→AUTH、余额→QUOTA，**AUTH/INVALID/QUOTA 不重试**）、**遵循 `Retry-After`**（超 10s 上限则放弃重试）、耗尽即抛错终止回合。且用户上轮已决定**不加**熔断器 |
| 「用 `client.ts` 替换现有的 fetch 封装」 | **不适用**：DSH 的传输层归 harness（适配器、流式、工具调用、图片 offload、Files API、缓存计费都在里面），换掉等于把这一层全丢 |
| 「`npm install dsh-quota-guard`，tsup + vitest + TS」 | **与项目约束冲突**：本仓库是**零依赖纯 JS**（只用 `node:`），`publish.mjs` 生成 `private: true`、不发布 npm（账号受限），且有多条门禁断言「零外部依赖」 |
| `remainingQuota()` 打 `/v1/user/info`（Python）/ `/user/info`（TS），解析 `total_quota/remaining_quota/used_quota` | **都不存在**。官方是 **`GET /user/balance`**，返回 `{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}`，**金额是字符串、没有总量字段** |
| 「剩余/总量 = 百分比」+ warning 50% / danger 20% / stop 5% | **算不出来**（没有总量）→ 那套阈值只能改成「自定基线」或「历史最高余额」下的百分比，并标明来源 |

### 73.2 于是只做站得住的那部分：`impl/quota.mjs`

- **采样**：`budget action:"quota" refresh:true` / `node scripts/quota.mjs --refresh`（可挂 cron）→
  `quota-samples.json`（上限 500 条，损坏则备份后当空的）；
- **燃烧速率**：金额/小时，**只看最近一段单调下降区间**（充值让余额上升 → 从那点重新起算，不会算成负消耗），
  样本不足返回 `null`（**不编数字**）；
- **ETA**：按当前速率还能撑多久；
- **百分比**：只在你自定基线（`baseline:N`）或「历史最高余额（≈上次充值后）」时给，并写明来源；
- **默认不联网**：回合中途的网络 I/O 会让工具调用变慢且不可预期 → 默认只读本机缓存，`refresh:true` 才拉；
  同步入口遇到 `refresh:true` 直接报错（避免同步/异步混合返回），工具走异步入口；
- **凭据不落地**：`ctx.get('credentials').resolve('DEEPSEEK_API_KEY')`（拿不到才回退环境变量），
  **不解析 `~/.dsh/.credentials.yaml`**、不打印密钥；CLI 支持 `--key-stdin`；
- **错误如实报**：401→「API key 无效」、402→「余额不足」、形状不符→报**顶层键名**（不回显响应体）。

### 73.3 顺带修掉一个被这次改动暴露的门禁缺陷

新增的取凭据代码触发了 `publish.mjs` 的密钥扫描器 **17 处假阳性**——它的正则
`api[_-]?key\s*[:=]\s*\S+` 把 `apiKey = String(process.env.X ?? '')` 也当成硬编码密钥。
**假阳性会让门禁变成噪音，比没有门禁更危险**，所以：

- 收紧为「右侧必须是**带引号的字面量且 ≥12 字符**」（`sk-` 前缀规则保留）；
- 扫描器抽到 `impl/secret-scan.mjs` 共用（`publish.mjs` 与门禁同一实现），并跳过扫描器自身；
- `publish-check` 新增 4 条断言**证明它仍会咬**：真 `sk-…` 形状报、引号字面量赋值报、
  「取环境变量」不报、命中带行号。夹具用**拼接**构造，免得测试文件自己在整树扫描里被当成泄漏；
- 同时修掉上一轮引入的另一个缺陷：`--json` 模式下把「本地树里有 N 个 0600 文件」的提示打到了 **stdout**，
  污染 JSON → 改到 **stderr**（被 publish-check 当场抓到）。

### 73.4 回归与复验

`budget-check` 256→**289/289**（+33 条：官方形状解析 / 明确拒绝社区流传的错误形状 / 金额与显示 /
燃烧速率与充值分段 / ETA / 基线两种来源 / 采样上限与损坏隔离 / `fetchBalance` 注入 fetch 的 401、402、
形状不符、无 key 四种 / 工具默认不联网与 refresh 需异步 / CLI 三条路径 / 静态断言「没有臆造端点」）；
`publish-check` 38→**41/41**；`CHECK_ALL_OK 22/22`（Node 24 + Node 22）。
文档：M7 新增 §M7.7b（含官方接口事实表与「能做/不能做」两栏）+ 开关表 + 状态文件表；README 一段。

## 七十四、监控口径纠正：token 是主，钱是特例（2026-09-10）

**用户纠正**（原话要点）：token 配额，不是 ¥/小时——因为用 DSH 不是 DeepSeek 一家，很多 MiMo、Qwen 等
提供的是**积分服务**，钱对它们没用；**token 的输入/输出、每次会话**才是有意义的监控数据。

这条纠正是对的，而且我上一轮把主次弄反了：

| 上一轮做的 | 这一轮改成 |
| --- | --- |
| 把「余额（¥）」当作额度监控的主体 | **token 账是主**（跨 provider），余额降级为 **DeepSeek 专属**并在报告首行声明 |
| 会话只报一个 `tok` 总量 | 报 **输入 / 输出**分解：`输入 = 未缓存 + 缓存命中`、`输出 = 生成 + 其中思考`（含命中率、「思考占输出」） |
| 没有 provider 维度 | `request/header` 里的 provider/model 也折进回合 → `report` 新增**按 provider / model** 的全机汇总 |

### 74.1 实现

- `impl/session-traffic.mjs`：`sessionTotals` 返回全量分解（`inTok/cacheTok/outTok/reasoningTok`）
  与 `byProvider` / `byModel`；新增 `summarizeTokens`（口径换算）、`fmtTokenLine`（「输入 … · 输出 …」一行）、
  `addBreakdown`（累加）；回合新增 `provider` / `model`（与 effort 一样是 `request/header` 的**阶跃值**）。
- `impl/budget-policy.mjs`：会话状态新增 `sessionBreakdown` / `liveBreakdown`（已闭合 + 当前回合），
  结算样本带上 `inTok/cacheTok/outTok/reasoningTok/provider/model`；公告/播报/结算全部改为进出分解。
- `plugins/budget.mjs`：`status` 给出本会话分解；`report` 新增「Token 账」一节（全机 + 按 provider + 按 model + 本会话）；
  `quota` 与 `explain` 明确「只对余额制 provider 有效，积分制看 token 账」。

### 74.2 这个口径下的实测（本机 26 个会话）

| 项 | 数值 |
| --- | --- |
| 输入 | **1764.0M**（缓存命中 **1753.9M**，命中率 **99.4%**） |
| 输出 | **4.59M**（其中思考 2.07M，占输出 **45%**） |

⇒ 吃额度的是**输入侧的重复上下文**（量是输出的 380 倍）；输出只占 0.26%。
与 [§七十](#七十思考强度自动调节先量两个直觉被自己的数据否掉2026-09-10) 的结论一致：
**省额度的杠杆是「少跑几轮」，不是「少想」**——思考连输出的 45% 都不到，而输出本身只有 0.26%。

单会话实例（本会话）：输入 864.5M（缓存命中 859.4M / 未缓存 5.15M）· 输出 1.92M（思考占输出 39%）
——与用户在界面上看到的「输入 863M tok」一致。

### 74.3 复验

`budget-check` 289→**308/308**（+19 条：分解字段与口径、`fmtTokenLine` 的「无缓存不编零」、
`summarizeTokens` 命中率与思考占比、`addBreakdown`、会话分解 = 已闭合 + 当前回合、
回合 provider/model 归属、按 provider 分组、status/report 的进出分解与分组表、样本带分解与 provider 字段、
结算累加分解）；`CHECK_ALL_OK 22/22`。文档：M7 新增 §M7.7a（口径表 + 实测 + 「谁吃额度」的结论），
余额一节改为 §M7.7b 并加「积分制没有这一节」的前置说明；README 同步。

## 七十五、对齐界面数据格式：同一把尺子（2026-09-10）

**用户指出**：「这个本身就有数据啊，该怎么利用当前会话的数据格式」，并贴出界面那一块：

```
本轮用量 25,178,836 tok

提供方 / 模型
    deepseek-official/deepseek-v4-flash
缓存命中
    99.9%
未缓存输入
    26,872 tok
缓存读取
    25,116,032 tok
输出
    35,932 tok（其中推理 9,672 tok）
```

### 75.1 核实：界面与日志是**同一套字段**（不需要另造口径）

- 界面：`client-ui-chat` 的 `TurnUsagePanel` ← `deriveTurnTokenUsage` 逐事件折叠该回合 → `normalizeUsage`；
- 日志：`assistant/message.usage` = `{inputTokens, outputTokens, totalTokens, cacheReadTokens, reasoningTokens}`；
- **恒等式**：`totalTokens ≡ inputTokens + cacheReadTokens + outputTokens`。
  用用户给的数验算：`26,872 + 25,116,032 + 35,932 = 25,178,836` ✅（与界面「本轮用量」逐位相同）。

所以正确做法不是另立一套指标，而是**用同一套标签与数字格式**把已有的账渲染出来。

### 75.2 实现

- `impl/session-traffic.mjs`：`fmtInt`（**分组整数**，与界面一致；不是 k/M）、`turnUsageRow`（界面字段 ↔ 内部字段）、
  `renderUsageBlock`（**同款标签 + 4 格缩进**，缺推理就不写括号、缺提供方就写「未记录」）；
- `plugins/budget.mjs`：新增 `budget action:"usage"`（`limit:N`）——「本轮（进行中）」用同款块渲染，
  「最近 N 个已完成回合」出表（含提供方/模型与命中率），「本会话累计」同款块；并写明恒等式；
  `status` 保留 k/M 的紧凑摘要，`usage` 给可核对的明细。

### 75.3 为什么值得单列一条回归

把**这一轮的真实向量**（`26872 / 25116032 / 35932 / 9672`）写进 `tests/budget-check.mjs`：
渲染第一行必须逐字符等于 `本轮用量 25,178,836 tok`，五个标签必须与界面一致，三个分项必须同数字。
这样以后谁改了渲染或字段口径，门禁立刻红——**「界面说的数」和「工具说的数」不会再各说各话**。

### 75.4 复验

`budget-check` 308→**328/328**（+20 条）；`CHECK_ALL_OK 22/22`（Node 24 + 22）。
文档：M7 新增 §M7.7a′（界面/日志/内部三列对照表 + 恒等式 + 实测校验 + 用法），README 一段。

## 七十六、第二条真实向量核对 + 预设归属修正（2026-09-10）

**用户给了第二条界面数据**（数学证明模式那个会话的最近一轮）：

```
本轮用量 11,924,953 tok
提供方 / 模型  deepseek-official/deepseek-v4-flash
缓存命中 99.8%
未缓存输入 22,269 tok
缓存读取 11,852,288 tok
输出 50,396 tok（其中推理 33,493 tok）
```

### 76.1 逐字段核对：**五处全中**

在日志里定位到该回合（`session-925bd92b-ee53-4226-9c52-81007cadd9bb` turn 5），我们的折叠给出：

| 字段 | 界面 | 我们 | |
| --- | --- | --- | --- |
| 本轮用量 | 11,924,953 | 11,924,953 | ✅ |
| 提供方 / 模型 | deepseek-official/deepseek-v4-flash | 同 | ✅ |
| 缓存命中 | 99.8% | 99.8% | ✅ |
| 未缓存输入 | 22,269 | 22,269 | ✅ |
| 缓存读取 | 11,852,288 | 11,852,288 | ✅ |
| 输出（推理） | 50,396（33,493） | 同 | ✅ |

两条真实向量（长会话 25,178,836 那条与此条）都写进回归，字段口径一旦漂移立刻变红。

### 76.2 顺带查出一个真 bug：**预设归属按 header 会归错档**

用户说「这个是**数学证明模式**的会话数据」，但该会话 header 写的是 `agentPreset: "standard"`。
查日志发现 seq 4 有一条 `agent-preset/selected {"agentPreset":"math-proof"}` ——
**header 只记会话创建时的预设，中途在 GUI 切换不改它**。而我的报表按 `header.agentPreset` 分组，
于是把这类会话算成了 standard（实测报表里 70 轮 math-proof 中有 6 轮来自这里）。

修法（与 effort / provider 同样的**阶跃值**处理）：

- 折叠 `agent-preset/selected` → 逐回合记 `preset`（**切换前后分开算**，不是整会话一个值）；
- `sessionTotals` 同时给 `presetAtCreation`（header）与 `preset`（生效）、以及 `byPreset` 分组；
- `scanSessionTurns` / `traffic-report.mjs` 一律用**生效预设**，并在报表里点明口径；
- 顺手修掉自己引入的一个惰性初始化 bug：`lastPreset` 在循环前用 `header?.agentPreset` 初始化，
  而那时 header 还是 null → **第一轮的 preset 会丢**。改成读到 `session` 事件时再取初值
  （fixture 里已验证：切换前 `math-proof`、切换后 `fixture-preset-b`）。

### 76.3 复验

`budget-check` 328→**335/335**（+7 条：第二条真实向量 3 条、预设归属 4 条）；
`CHECK_ALL_OK 22/22`。文档：M7 §M7.7a′ 增补两条真实向量对照表 + 预设归属说明。

## 七十七、四向量核对 + 命中率显示规则对齐（2026-09-10）

**用户又给两条**（同一个会话的两轮，一大一小）：

| | 本轮用量 | 缓存命中 | 未缓存输入 | 缓存读取 | 输出（推理） |
| --- | --- | --- | --- | --- | --- |
| 大轮 | `14,897,701` | **98%** | 293,757 | 14,541,696 | 62,248（35,326） |
| 小轮 | `180,279` | **81%** | 33,577 | 143,360 | 3,342（1,562） |

### 77.1 数据核对：全中

日志里定位到 `session-925bd92b` turn 4 与 turn 2，五个字段逐一相同（含推理 token）。
顺带印证了「流量 ≈ 步数 × 上下文」：小轮 ctxPeak 40.6k / 5 步 → 180k tok；
大轮 ctxPeak 356.1k / 45 步 → 14.9M tok（**82 倍**）。

### 77.2 但格式差了一处——而且是用户核对出来的

界面写 `98%`、`81%`，我写 `98.0%`、`81.0%`。去读界面实现（`client-ui-chat` 的
`formatCacheHitPercent` / `roundedPercentUnits` / `displayPercentUnits`）后发现规则比我严，照抄语义重写：

| 规则 | 说明 |
| --- | --- |
| 分母 | **prompt tokens** = `totalTokens - outputTokens` = 未缓存输入 + 缓存读取 |
| 舍入 | **整数算术**取到 0.1 个百分点，**中值向上**（不用浮点 `toFixed`：`.x5` 方向不一致） |
| 显示 | `tenths === 0` → **去掉尾随 `.0`**（`98`、`81`），否则保留一位（`99.8`、`99.9`） |
| 诚实 | **部分命中绝不显示成 100%**：舍到 100 但仍漏 token 就自动加精度（`999999/1000000 → 99.9999`），只有真全命中写 `100` |

实现方式与界面不同但结果一致：界面用二分 + 闭式，我用一次整数除法
`floor((2·cacheRead·scale + prompt) / (2·prompt))` 加精度升级循环；对极端近似（漏 1/1e6）
两者都给 `99.9999`（已用测试钉住）。`promptTokens === 0` 时返回 `null`（**不写 0%**）。

### 77.3 复验

`budget-check` 335→**345/345**（+10 条：两条新向量的逐字符核对、四种命中率文本、诚实规则、
极端近似、`null` 边界、「渲染不再用 toFixed」）；`CHECK_ALL_OK 22/22`。
文档：M7 §M7.7a′ 补齐四条向量对照表 + **命中率显示规则四条**。

## 七十八、状态目录唯一实现：修掉「本机红、CI 绿」的测试污染（2026-09-10）

**触发**：`run.mjs` 的「编译热点」断言在用户机器上红了（期望 `Hot/A.agda` 最贵，实得
`NecklaceInvariance.agda` 169.0s）。查下去不是我的新改动，而是一个**潜伏的测试隔离缺陷**：

- `tests/run.mjs` 把三条**假回执**（`Hot/A.agda` 30000ms×2、`Hot/B`、`Hot/C`）写进
  **用户真实回执目录**（`~/.dsh/state/math-proof/receipts/`），然后断言自己是「最贵的 3 条」；
- 用户那边有 **345.9s / 339.5s / 169.0s** 的真实编译回执（NSEFinalClosure、NecklaceInvariance）
  → 假回执被挤出榜外 → 断言失败；
- **CI 的状态目录是空的 → 永远绿**。这是最坏的一类门禁：**只在真机上红**。

根因：状态目录在 `proof-dag` / `agda-engine` / `python-oracle` / `prover-limits` 里**各自硬编码
`homedir()`**，测试无法把状态指到别处（只有我后加的 `impl/` 模块支持 `MATH_PROOF_STATE_DIR`）。

### 78.1 修法

| 改动 | 内容 |
| --- | --- |
| 唯一实现 | 新增 `impl/state-dir.mjs`（`stateDir()` / `statePath()`）：**`MATH_PROOF_STATE_DIR` 优先**，未设置时回落 `~/.dsh/state/math-proof`（**生产行为逐字符不变**） |
| 四处插件 | `proof-dag`（7 处，含模板字符串路径）、`agda-engine`（2 处）、`python-oracle`（2 处）、`prover-limits`（1 处）全部改走它；`session-traffic` 改为 import 后再导出（内部也要用） |
| 测试隔离 | `run.mjs` 把**整份套件**的状态指向临时目录（路径里保留 `state/math-proof` 两段，避免打断检查路径子串的断言）；`hooks-check` 同样**全程一致**——只给钩子设 env 会让「进程内写台账、钩子读临时目录」错位（当场踩到，「收工检查」看不到台账） |
| 门禁 | `paths-check` +6 条：唯一实现、支持 env、覆盖生效、默认回落、**插件里不许再硬编码状态目录**、主套件确实隔离 |

### 78.2 复验

`run` **423/423**（假回执现在写在临时目录，断言重新确定）；`hooks-check` 58/58；`budget-check` 346/346；
`paths-check` 19/19；`CHECK_ALL_OK 22/22`（Node 24 + 22）。
**生产状态目录实测未被改动**：回执仍 111 条、台账 46 个（测试不再有任何写入真实状态的路径）。
文档：M4 新增 §M4.5c（两个后果 + 修法 + 门禁）。

## 七十九、数据保留策略：保留多少条、还是覆盖（2026-09-10）

**用户问**：这个数据保留多少条，还是覆盖的？

### 79.1 逐条查证（写进 M4 §M4.5d 的表）

| 存储 | 保留 | 满了怎么办 |
| --- | --- | --- |
| 任务样本 | **400 条**环形 | 丢最旧（同一文件原子重写） |
| 余额采样 | **500 条**环形 | 丢最旧 |
| 类基线窗口 | 20 条 | 计算用 |
| 回合实况 `budget-turn-<sid>.json` | **每会话 1 个** | **覆盖重写** |
| 收工信箱 | 6 条 | 同 kind 去重 + 取空即清 |
| 待结算 | 20 条 | 丢最旧 |
| 重复指纹表 | ≤400→200 键 | 裁剪 |
| 评分历史 | 200 条/workspace | 丢最旧 |
| 编译/oracle 回执、图谱导出 | **无上限**（追加型） | `state-gc` 归档，**不删数据** |

### 79.2 补掉两个「无人管」的洞

1. **`flow-<workspace>.json`（fable5 流程标记）原先没有任何清理路径**：实测堆到 **124 个，
   其中 83 个早已过期**（闸门侧 TTL 只有 2 小时）。现在 state-gc 报告数量/陈旧数，
   并支持 `--apply --flow-min-age-days 3` 删除**已过期**的（正在用的任务标记保留）。
2. **会话日志 `~/.dsh/sessions/**` 在 harness 侧没有任何保留/轮转策略**（实测 26 个 / **51.6 MB**，
   最旧 2026-09-08）。这是**唯一的历史**，state-gc 改成**只报告**（数量 / 体积 / 最旧日期）并明确写「绝不删」，
   要清理只能人工决定。

顺带修掉：`state-gc.mjs` 自己是**最后一个硬编码状态目录**的地方（`--apply` 会打在真实状态上、
测试也没法隔离）→ 改走 `impl/state-dir.mjs`。⚠ 修之前那次 `--apply --flow-min-age-days 3` 因为块没插进去
而什么都没执行（**实测真实目录的 124 个标记一个没少**）——这类「编辑没生效」的静默失败正是要靠门禁兜住的。

### 79.3 新增门禁：`tests/state-check.mjs`（34 条，check-all 23 个入口）

- **上限常量存在且为正**（样本 / 余额采样 / 信箱 / 基线窗口 / 评分历史 / 待结算 / 指纹表）；
- **上限真的生效**：写超 400+25 条 → 截到 400 且丢最旧；余额采样 500+10 → 截到 500；信箱超限与同 kind 去重；
- **维护脚本覆盖每个类别**（报告里必须出现：回执 / oracle / 评分历史 / 见证 / 图谱 / 账本 / 流程标记 / **会话日志**），
  且会话日志那行必须写明「没有任何保留策略」「绝不删」；
- **只动该动的**：陈旧流程标记被清、**新鲜标记保留**、同期其它文件（预算账本）不受影响；
  跑 `--apply` 前后**会话日志目录数量不变**，脚本里没有删会话日志的路径（静态）；
- **覆盖 vs 追加语义**：回合状态文件名按会话固定（不随次数增长）、账本/采样都是**单文件**、原子写不留 `.tmp`。

### 79.4 复验

`STATE_OK 34/34`；`CHECK_ALL_OK 23/23`（新增一套件后总入口 23）；测试全程用 `MATH_PROOF_STATE_DIR`
临时目录，**真实状态目录的 124 个流程标记一个没动**。
文档：M4 §M4.5d（保留策略表 + 补洞表 + 「覆盖 vs 环形 vs 追加」口径）。

## 八十、npm 格式包：不发布也能打（2026-09-10）

**用户问**：「云端，我们可以打包 npm 格式吗？不一定要发布啊。」

### 80.1 先实测一个关键前提

`private: true` **只挡 `npm publish`，不挡 `npm pack`**（实测：private 包 `npm pack --dry-run` 正常产出 tgz）。
所以「不发布」与「能打 npm 格式」并不冲突——之前的取舍（账号受限 → 只发裸 tar）可以升级。

### 80.2 实现

| 改动 | 内容 |
| --- | --- |
| `publish.mjs --npm-pack` | 生成布局后 `npm pack`，报告 filename / size / unpacked / entries / shasum / **integrity**，并写 `.sha256`；输出里给出消费命令 |
| **bin 安装器** | 生成 `bin/dsh-math-proof.mjs`（`install` / `print-root` / `verify`）：`npm i -g ./x.tgz && dsh-math-proof install` 一条命令装进 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>`；**默认拒绝覆盖**已有 preset（`--force` 才盖），并做权限归一化 |
| `release.yml` | 打 Release 时改用 `npm pack` 出**标准 npm 包**（不再是裸 tar），附 `.sha256`；保留「不得出现 npm publish」的反向检查 |
| `package.json` | 增加 `files: [preset/, bin/, README, LICENSE]` 与 `bin` 映射；`private: true` 保留（挡误发） |

### 80.3 端到端实测（不是「应该能」）

- `npm pack` → **108 个文件 / 602 KB 压缩 / 1.57 MB 解压**；含 `agent.cordis.yml`、`plugins/`、`hooks/hooks.json`、`skills/`、`bin/`；**不含** `state/`、`__pycache__`、`.pyc`、`.github/`；
- **包内权限：npm 统一成 0644（bin 0755）** —— 之前那类「别人读不了」在这条路径上根本不存在；
- `npm i -g <tgz>` → 从**装出来的副本**跑自身门禁：**CHECK_ALL_OK 23/23**；
- 安装器：`install` ✅ / 再装一次 **exit 3 拒绝覆盖** ✅ / `--force` 覆盖 ✅ / `print-root` ✅ / `verify` ✅。

**`verify` 当场抓到一个真问题**：我改过 `publish.mjs` 之后 **M2 依赖图变旧**（生成物与源码不一致），
`verify` 在安装副本上直接报 `DOCS_M2_STALE` —— 重新生成后 23/23。这正好说明「装出来的副本能自检」有价值。

### 80.4 回归

`publish-check` 41→**58/58**（+17：private 与元数据、bin 声明与可执行、`npm pack` 标准信息、
包内容清单、**不含机器生成物**、**权限对组/其他人可读**、`npm i -g` 成功、装出来能跑自身门禁、
安装器 install/拒绝覆盖/--force/print-root）；`CHECK_ALL_OK 23/23`。
文档：README 分发一节新增「npm 格式包（不发布但可以打）」+ 四条命令；`release.yml` 注释改为解释
「为什么不发布、但为什么可以打包」。

---

## 八十一、DSH 0.1.2 → 0.1.5 升级兼容核验（结论：**兼容**）

用户问：「这个 dsh 从 0.12 升级到 0.15 了，检查下我们的数学证明模式插件，兼容吗？」
这类问题**必须能用一条命令回答**，而且不能只回答「我读了一遍代码觉得没事」——要能**机器复验**。

### 81.1 装的是哪一版（先确定对象）

- 全局装的是 `@deepseek-ai/dsh@0.1.5-rc.2`（0.1.2-rc.1 还在 pnpm store 里，别混）；
- **正在跑的进程**是 0.1.5（按 `~/.local/share/pnpm/global` 的链接与进程命令行核对），所以「兼容」这个词指的是**我们在 0.1.5 上活着**，不是理论推演。

### 81.2 第一层：宿主契约还在不在（`scripts/harness-compat.mjs`，25 条）

不猜 API，直接**去 pnpm store 读 `dsh-*` 包的真实产物**，逐条探我们依赖的东西：

| 我们依赖 | 探测对象 | 0.1.5 结果 |
| --- | --- | --- |
| 钩子方言（payload 字段 / `additionalContext` / 阻塞=exit 2） | `dsh-hooks-claude-code` | ✅ |
| `agent/request` 瀑布（思考强度要能在发请求前改） | `dsh-*` agent 路由 | ✅ |
| 会话日志容器（多帧 zstd / `.jsonl.zstd`） | `dsh-session-persistence-jsonl` | ✅ |
| **会话格式版本常量**（升级最可能打到我们） | `dsh-session` | ✅ `SESSION_FORMAT_VERSION = 3` |
| 格式迁移器链（说明格式**会**演进） | `dsh-session-format-v2-to-v3` | ✅ |
| token 投影（累计桶 / 上下文压力） | `dsh-token-meter` | ✅ |
| 工具注册面 `register(definition)` | `dsh-tools` | ✅ |
| 新文件落 0600 的根因（原子写暂存） | `dsh-fs-local` | ✅ |
| preset 扫描与挂载时间戳 | `dsh-agent-presets` | ✅ |

**25/25 在位**（`COMPAT_OK 25/25 契约在位（dsh 0.1.5-rc.2）`）。两条设计约束：
①**不联网、不猜**——只有真的在 store 里找到合同才算数；
②**没有 store 就 `COMPAT_SKIP`**（裸 CI / 没装 DSH），SKIP 不算绿也不算红，`check-all` 认 SKIP 但把它**写进表**；
③支持 `--expect 0.1.5`：版本不符就 `COMPAT_FAIL` 退出 1 —— 这样「哪天又升级了」是**机器先知道**，不是用户先发现。

### 81.3 第二层：我们自己的解析器扛不扛得住 v3

我们**只读原始 JSONL**（不 import 宿主解析器），所以格式一变就是我们自己的事。0.1.5 的新会话在盘上就是 **v3**。
按 `v2→v3` 迁移器体现的差异手造 `tests/fixtures/session-v3.jsonl`，真解析一遍：

- v3 **没有** `header.system`（退役了）、空的可选 header 字段要求省略、`source.plugin` 由 `tools-code-mode` 改名 **`tools-ptc`**、每行多一个 `sessionFormatVersion`；
- **我们读的字段名一个没变**：`turn`/`step`、`turn/start|end`、`assistant/message.usage`、`tool/result`、`request/header` 的 provider/model、`agentPreset`；
- `user/message` 的 `source`/`content` 仍**平铺在 `data` 上**（不是 `data.message`），`assistant/message`/`tool/result` 仍**在 `data.message` 下** —— 这两种形状我们本来就分开处理，v3 没动它们；
- v3 样本逐字段核对：turn1 = 1020、turn2 = 530（走 `assistant/chunk` 回退）、合计 1550、`denies` 每回合 1、生效预设 `math-proof` ✅。

### 81.4 查出并修掉一个真 bug：`被拦计数` 永远是 0

核 v3 的 `hook/result` 时发现：钩子的 **`exit 2` 在会话日志里记的是 `decision:"block"`**，
而 `"deny"` 是**权限决策**（`permissionDecision`）的词。我们只认 `deny` → 真实日志里 `turn.denies` **恒为 0**，
硬线判定只能靠钩子侧自己计数兜底（能跑，但「拦了几次」在报表里是假的）。

修法：两种标签都认（向后兼容 0.1.2 的日志），并在门禁里**同时**用两个样本断言 —— 改完真实日志立刻报出 **`被拦计数 3`**（原先 0）。

### 81.5 第三层：形状自检（防「下次升级静默算 0」）

格式演进是常态，最危险的失败**不是崩**，而是**安静地算出 0**（预算于是永远不触发）。所以：

- `foldSession` 现在报 `formatVersion` / `formatVersions`（v3 起每行都带，v0 只有 header）；
- 报 `usageMissing`：**有 ≥3 个回合却一条 usage 都读不到** → 极可能是形状变了；
- `budget` 工具的 `status` 会把形状**直接说给模型听**：正常时写「日志形状：会话格式 **v3**（usage 可读，回合 N）」，
  异常时写「🛑 **日志形状异常** … token 账 / 会话预算**都会失真**，请跑 `harness-compat` 与 `compat-check` 核对」；
- 门禁用 `tests/fixtures/session-unknown-shape.jsonl`（`version: 9`、3 个回合、**没有任何 usage**）真的走一遍：
  未知版本如实报 9、`usageMissing === true`、会话累计 0 **但带着告警**而不是悄悄算 0。

### 81.6 顺带修掉一个假归因 + 一类会漂移的字面数字

**假归因**：`budget-check` 与 `compat-check` 的汇总行原先**一律**写「（另有 N 条 SKIP：本机 Node 无 zstd 支持）」——
可 SKIP 的原因不止 zstd（例如裸环境没有会话日志，Node 20 才是没 zstd）。假归因比不写更坏：它会让人以为自己看懂了。
现在汇总行按**真实原因**去重后列出（`本机没有该会话日志` / `本机 Node v20.20.2 的 node:zlib 没有 zstd` / `本机没有 pnpm store（裸 CI）`）——
CI 上 Node 20 那一格因此能一眼看出「336/336 是因为没有 zstd」。

**会漂移的字面数字**：加了第 24 个入口后，`check-all.mjs` 头注释与 `.github/workflows/gates.yml` 头注释
仍写着「22 / 23 个入口」。这类数字和「模块数 / 断言数」是同一类病，所以**一起收进 `docs-check`**：

- 从 `SUITES` 块真的数一遍条数（并断言解析出的条数 ≥20，防止解析失败反而假装通过）；
- 头注释里的「门禁有 N 个入口」必须等于实际条数 —— **反向实测**：把 24 故意改成 22，门禁立刻红（`注释=22 实际=24`）；
- CI 工作流**不许**出现「N 个入口」这样的字面数字（只指「以脚本输出为准」）。

`docs-check` 81 → **85/85**。

### 81.7 真实日志上又核出三个「测试绿、真机瞎」的缺陷

核 v3 时我顺手拿**真实日志**对了一遍，结果发现夹具（明文单帧）骗过了三道门禁：

**① 迁移会留下旧文件（会话被算两遍）**
0.1.5 把老日志迁成 `session.vN.jsonl.zstd`，而旧的 `session.jsonl.zstd` **留在原地不删**。实测 26 个会话里
**2 个目录两份共存**（111/112 个回合重叠、残留 **35.2 MB**）。我们的报表按 `**/session.jsonl.zstd` 找日志
→ 那 2 个会话会被算两遍（各约 3.2 亿 / 9.5 亿 token）。
修法：新增 `pickSessionLog()` / `sessionLogVersion()`（**唯一实现**），一个会话目录只取**版本最高**的一份；
`cache-report` 也从硬编码文件名改走 `sessionLogFiles()`。`state-gc` 的口径**故意不同**：它报「文件数 / 会话数 /
迁移残留」——磁盘占用要照实说，算流量才去重。

**② usage 换了落点（v3 会话整套算 0）**
v0 的 usage 在 `assistant/chunk`（`chunk.type === "usage"`；实测 14134 个 chunk / 1821 个 usage）；
**v3 的 `assistant/chunk` 一个都没有**，usage 在 `assistant/message.data.usage`（实测 2393 个 message）。
`cache-report` 原先只认 chunk → 迁移过的会话**整套消失**（实测费用从 66.17 元掉到 26.31 元）。
修法：新增共用入口 `stepUsages(file)`（口径与 `foldLines` 完全一致：同一步优先 message usage，没有才用 chunk 求和），
`cache-report` 改走它。修正后逐步 5,895 行 / **2,164,111,395 token**，与折回合口径 5,874 步 / **2,161,890,215 token**
相差 0.1% —— **两把尺子互相印证**，这才是「数字可信」的样子。

**③ `readSessionHeader` 只解尾帧（真机 100% 返回 null）**
日志是多帧容器，header 只在**第一帧**，而它写的是 `{ lastFrames: 1 }`。明文 fixture 没有帧概念 → 测试永远绿，
真机上它**对每个真实日志都返回 null**（`cache-report` 因此一行都读不出来，实测 0 步）。
修法：从第一帧读；靠生成器惰性，读到 header 就 break，不会解整个 20 MB。

**顺带**：`cache-report` 不再依赖外部 `zstdcat`（别人的环境不该是必要条件），也不再在多帧日志上
「只解首帧」——那是一种**安静地少算**。

### 81.8 这三条怎么防住复发

- `pickSessionLog` / `sessionLogVersion` / `stepUsages` / 从第一帧读 header：`tests/budget-check.mjs` +18 条
  （含**多帧 zstd 文件**上的 header 回归、v3 夹具的逐步行数、目录级去重），并**逐条反向实测**：
  改回尾帧读 → ❌；改回不看版本 → ❌；改回只认 chunk → ❌；
- `cache-report` 端到端：在只含 v3 会话的临时目录上跑真脚本，断言行数与两个会话步数之和**精确相等**；
- `tests/paths-check.mjs` +3 条：脚本/插件/钩子**不许自己拼 `session.jsonl*`**（唯一实现处必须导出规则，
  并且注释里必须写明「迁移不删旧文件」这件事）；`compat-check` +7 条；
- 教训写进 M4 §M4.5e：这三个都是「夹具是明文单帧、真机是多帧带迁移」型缺陷 →
  **fixture 之外必须在真实日志上跑一遍**，而且两套口径要能互相印证。

### 81.9 顺手做掉：Node 20 **不用等 CI** 也能验

改完推上去，CI 立刻红了 —— **Node 20**：`TypeError: zlib.zstdCompressSync is not a function`。
原因是我新加的「一个目录两份日志」断言里**裸调**了 `zlib.zstdCompressSync`（Node 20 没有 zstd）。
2026-09-10 已经栽过一次同类事故（命名导入是**链接期** SyntaxError），当时只能靠 CI 抓。

这次不再接受「等 CI」。做法：`scripts/no-zstd.cjs` + `--require` 预加载，把 **CJS 的 `node:zlib` 对象**上的
zstd 系列删掉/置空；ESM 的 `import * as zlib` 命名空间在**首次加载时快照**该对象，所以预加载必须早于任何
import —— `--require` 正好满足（实测 `import('node:zlib')` 探测也变成 `undefined`）。子进程继承 `NODE_OPTIONS`，
于是 `check-all.mjs` 派生的每个套件都在同一条件下跑：

```
NODE_OPTIONS="--require $PWD/scripts/no-zstd.cjs" node scripts/check-all.mjs   # CHECK_ALL_OK 24/24
```

并且把它**内嵌进 `budget-check`**（`BUDGET_CHECK_NESTED=1` 防递归）：`budget-check` 派生一个自己，
断言子进程退出 0 且**如实 SKIP**。反向实测：把那条裸调用改回去 → 本地 2 秒就红，不必再推一次等 CI。

顺带修掉一个「只在特定机器上红」的测试脆弱点：`usage 动作` 原先只判断「本机有没有那份真实日志」，
没判断「本机的 Node 能不能解压它」→ 「Node 20 + 真有日志」的机器上四条断言全红。现在两种读不了都如实 SKIP。

### 81.10 回归

- 新增 `tests/compat-check.mjs`（29 条：宿主 4 + v3 形状 8 + 0.1.5 迁移副作用 7 + deny/block 3 + 形状自检 5 + 汇总行），`scripts/harness-compat.mjs`（25 条探测）；
- 新增共用入口 `pickSessionLog` / `sessionLogVersion` / `stepUsages`（`impl/session-traffic.mjs`），并把 `readSessionHeader` 改成从**第一帧**读；`tests/budget-check.mjs` 346 → **369**，`paths-check` 19 → **22**；
- `scripts/check-all.mjs` 24 个入口（SKIP 白名单加 `COMPAT_CHECK_SKIP`，且 SKIP **不能**掩盖失败：有失败就是 `COMPAT_CHECK_FAIL` 退出 1）；
- 本机实测：Node **24.21.0** 与 **22.22.1** 均 `CHECK_ALL_OK 24/24`；模拟裸 CI（空 HOME）也 `CHECK_ALL_OK 24/24`（宿主那半 SKIP）；
- **CI 实跑三格全绿**：`check-all (20) / (22) / (24)` 均 `success`，三个都是 `CHECK_ALL_OK 24/24`（`gh run view 34604797888`）；
- 文档：README 门禁清单 + `docs/maps/M4-state-and-storage.md` §M4.5e（日志格式版本与兼容核验入口）。
