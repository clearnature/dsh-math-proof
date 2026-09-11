---
name: research-system
description: AI 数学研究系统协议（外层流程）— 问题拆解 → 多路线并行探索 → 候选三筛 → 证明图 DAG → 形式化 → Generator/Critic/Repair/Verify 循环 → 数学记忆台账。把 OpenAI NS 式六层架构映射到本 harness 的 workflow/subagent/todo/goal 与本项目闸门/技能。 不触发（Do NOT trigger for）: 单条引理的即时证明（不必起外层流程）、纯工具链限制问题。
whenToUse: 面对一个非平凡数学目标（不是单条引理）时；需要拆解、并行探索、多 agent 编排、候选筛选、或把自然语言命题变成可验证依赖 DAG 时加载。
---

# research-system：AI 数学研究系统协议（外层）

## 0. 与内层流程的关系

| 层 | 内容 | 归属 |
| --- | --- | --- |
| **内层** | 单节点证明：策略选择、禁令、错误指纹、审计、编译 | `proof-engineer` + 「证明纪律」提示段 |
| **外层（本技能）** | 从数学问题到一棵可验证 DAG 的**发现流程** | 本技能 |

> **铁律**：外层任何产出，最终都必须落到内层的 **`proof_compile` exit 0 + 0 postulate/hole** 证据上。
> 没有内层证据的外层结论 = **猜想**，不是证明。

## 1. 六层架构 → 本 harness 映射

| 层 | OpenAI NS 系统 | 本 preset 的落法 |
| --- | --- | --- |
| 1 问题拆解 | Problem Decomposer | `todo_write` 子任务；每条子问题写成**可验证命题** |
| 2 多路线探索 | 万级 agent 并行 | `workflow` 扇出（`agent`/`pipeline`/`parallel`）+ `subagent` 深挖单路 |
| 3 搜索空间 | 百万候选 | 候选 ansatz/命题生成 → **三筛** → 只留可形式化者 |
| 4 证明图 | 依赖 DAG | `proof_graph` 工具建 DAG / 拓扑序 / 环检测 + 独立编译闸门 |
| 5 形式化 | Lean | Agda（本项目）+ `proof_compile`；先算后验证见 `compute-then-verify` |
| 6 验证 | Generator/Critic/Repair/Verify | 生成 → `code-reviewer`/对抗自检 → 批量修复协议（`agda-proof-engine` §5.9；若环境存在 `loop-engineer` 技能亦可委托，它不随本仓库分发）→ `proof_compile` + 闸门 |

## 1b. 双模式：先判断你在哪一模式

| | **形式化模式**（Claude FLT / Prove2Me） | **发现模式**（OpenAI NS） |
| --- | --- | --- |
| 前提 | 路线**已知**（如 Wiles 路线、本项目 Fermat 链） | 路线**未知** |
| 主任务 | DAG 分解 → 并行填充 → 复用 → 逐节点验证 | 候选搜索 → 三筛 → 反例淘汰 → 形式化 |
| 瓶颈 | 节点数量与依赖管理、证明复用 | 搜索空间与筛选成本 |
| 本项目落法 | `proof_dag` 台账 + 链式闸门 + `proof_graph` | 四路并行 + 三筛 + 反例路线 |
| 判据 | 「已有论文/模块能给出路线，只是没人形式化」 | 「连路线都要找」 |

**先声明模式**，再动手：形式化模式不要重复发明路线；发现模式不要假装路线已知。
多数真实任务是**混合**：局部发现 + 全局形式化。

## 2. 第 1 层：问题拆解

- 把大目标拆成**子问题**；每个子问题必须能写成一句**可判定或可证伪**的数学陈述。
- **陈述先行**：先在 Agda 里写签名（`lem : Type`），确认类型本身 type-check，再填证明项。
- 拆解产物 = 待证命题清单（进 `todo_write`）+ 依赖关系（进证明图）。
- 反模式：把「证明 X」当子任务（不可判定）。正确：「X ⟹ Y 的引理 L」当子任务。
- 拆解深度：每层子问题应能在**单模块**内闭合；跨模块的先画边、后排序。

## 3. 第 2 层：多路线并行探索

固定五条路线（每条一个 agent/一路，prompt 必须自带输出 schema）：

| 路线 | 做什么 | 产出 |
| --- | --- | --- |
| **构造路线** | 候选结构/ansatz：展示群表述、CRT 分解、Frobenius 共轭、半直积、M_F 编码… | 候选命题 + 预期证明策略 |
| **文献路线** | `docs/` 全族（duodecimal 24 份 + wiki + 宪法）+ grep 已有模块 + 外部检索 | **可引用锚点**（`文件:行`） |
| **反例路线** | 主动找假命题（历史教训：DC12 L5 位数分离、`classical-bound` 36 反例） | 反例 witness 或「未找到」 |
| **形式化路线** | 把构造路线的候选转成 Agda 陈述并试探类型检查 | 可编译的陈述（签名）或失败原因 |
| **计算路线**（先算后验证） | Python 精确整数枚举/穷举 → 观察规律、找反例、生成约束 | 可复现脚本 + 证据（**不是证明**），见 `compute-then-verify` |

编排纪律：

- `workflow` 的 `agent(prompt, { schema })` 让每路返回**结构化结果**，不要散文。
- 多阶段用 `pipeline()`（无屏障、单路失败不拖累全队），只在真正需要全量汇合时用 `parallel()`。
- 每路预算写进 prompt：「只做 X、输出 schema、不要改文件」。
- **任何一路的结论都要有第二路证据**（交叉验证）；汇总时去重。
- 深挖单路用 `subagent`/`subagent_fork`；需要长时间自治迭代用 `ralph`（仅当明确需要）。

## 4. 第 3 层：搜索空间与三筛

候选必须过**三筛**才进形式化：

1. **律筛**：符合本框架的律（展示群/相位不可约/无零因子/离散基座）？
2. **约束筛**：不违反已知定理与边界（不混 C₄/V₄、不越界声称 FLT/YM、不引 `Choice`）？
3. **可判定筛**：能否在有限论域上穷举或构造？（**>27 case 必须符号化**）

未过筛的候选写入**候选台账**（含否决理由），不要静默丢弃——否决理由本身是资产。

## 5. 第 4 层：证明图（DAG）

- **节点 = 可验证命题**（一条顶层定理或一个模块）；**边 = import / 依赖**。
- **状态机**（`proof_dag` 工具）：`pending → active → proven | refuted | blocked | needs_review`。
- **所有权**：每个 `active` 节点只应有一个 `owner`（agent 名），避免两路各证一遍。
- **分解**：`proof_dag action:"plan"` 把目标变成**义务骨架**（不是替你证明）：给 `statement` 按形状表出义务（双向等价→正/反两方向；存在→witness+性质；ℕ/Fin/List→base+step；record→载体+定律；相等→先 `refl` 再链），给 `items` 则做结构纪律校验（缺「怎么验证」/悬空依赖/成环/没写组合节点/自带 `proven` → 红）。**先看后写**：默认只渲染，`commit:true` 才落盘，且一律 `pending`。
- **调度**：`proof_dag action:"next"` 返回「依赖已 `proven` 的 `pending` 节点」= 当前可开工集合；这是 Prove2Me 式 DAG 调度的本地最小实现。
- **体检**：`proof_dag action:"check"` → 环检测 / 悬空依赖 / 无 owner 的 active / 进度百分比 / 拓扑序。
- **静态依赖图**：`proof_graph`（`paths: [...]`）→ leaf-first 编译顺序 + 环 + 未解析依赖。
- **证明复用与下层化**：同一引理被 ≥2 个节点需要时，**上提到下层模块**（如 `rho` 的代数性质从 `DCCayleyGraph` 上提到 `DuodecClock`），并在台账里把下游节点的 deps 改指到新位置——这是「证明复用」，不是复制粘贴。
- **CI/Merge 类比**：节点 = PR，`proof_compile` = CI，链式闸门 = 全量回归；**只有 exit 0 + 0 postulate/hole 才允许把节点标 `proven`**，证据写进 `evidence` 字段。
- 台账落盘 `~/.dsh/state/math-proof/dag-<workspace-hash>.json`，**不写进项目仓库**。
- 现成范式：`engineering/check_fermat_chain.sh`（L0→L4）、`engineering/check_group_chain.sh`（8 模块）。

## 6. 第 5 层：形式化

- 自然语言 → Agda 陈述（**先签名，后证明项**）。
- 陈述必须**忠实**：不改弱命题迁就证明（历史教训：假 refl、`chern2Proof = refl`、位数分离）。
- 目标 0 postulate / 0 hole / 0 sorry；证据 = `proof_compile` exit 0 + `proof_audit` 无 ⚠️。
- 无法形式化的陈述：明确标为「元诊断立场 / 诠释」，**不得**称已证（`元理论对析 §4`）。

## 7. 第 6 层：验证循环（G/C/R/V）

```
Generator(本 agent) → Critic(code-reviewer / 对抗自检) → Repair(批量修复协议，见 agda-proof-engine §5.9；若环境存在 loop-engineer 亦可委托，不随本仓库分发) → Verify(proof_compile + 闸门)
```

- **Critic 必须主动攻击**：找反例、找隐藏前提、查证明项是否真闭合、查是否越界声称。
- 每轮把错误指纹写进修复记录；同类错误批量处理（不要逐条 whack-a-mole）。
- 终止条件：`proof_compile` exit 0 + `proof_audit` 无 ⚠️ + **对抗验证在具体点通过**（原点/生成元/混合点/同态/结合律）。

## 8. 数学记忆（持久化）

- **机器可读台账**：`proof_dag`（`~/.dsh/state/math-proof/dag-<hash>.json`）——节点 + 状态 + owner + evidence，跨会话存活。
- **人可读记忆**：按仓库约定写 `memory/*.md`（frontmatter `name/description/type`）：
  - **猜想台账**：候选命题 + 状态（已证 / 已否 / 待证 / 待核对）
  - **失败路线**：为什么失败（避免重复劳动）
  - **可引用锚点**：`文件:行`
  - **开放缺口**：下一步
- **开工先读**：`PROJECT_MEMORY.md`、`memory/*.md`、相关 `docs/`、`proof_dag action:"list"`。
- 未写入记忆的结论，下一轮会重犯（本项目已有先例：重复发明已存在的引理）。

## 9. 规模纪律（防「大规模」变成「大规模重复」）

- 并行不是目的：**每条路线必须产出可验证增量**（新引理 / 反例 / 锚点 / 可编译陈述）。
- **先小后大**：单 agent 走通一条路线 → 再 fan-out。
- 汇总去重；同一引理不要两路各证一遍。
- 算力预算写进 prompt；超预算返回**部分结果 + 缺口**，不要空转。

## 10. 与本项目宪法的对齐

- **离散基座优先**：先跑 `meta-diagnosis` 三重完备性标尺，判病态则换基座。
- 禁 `Choice` / 排中律 / 浮点；0 postulate。
- 不越界声称（完整 FLT、YM 通用质量间隙、谱定理均未形式化）。
- **编译通过 ≠ 物理正确**；待核对项单列。

## 11. 与 Prove2me 方法论的对应

Prove2me（`~/.dsh/prove2me_workspace`）把「大规模协作证明」工程化的三条纪律，已本地化进 `prove2me-method` 技能：

- **三条铁律** → 陈述先行 / 禁止循环论证（不得用待证命题证自身）/ 0 postulate·hole·sorry。
- **milestone / frontier** → `proof_dag` 的人工认证节点 / `action:"next"` 的可开工集合。
- **侦察先于尝试** → 先读被否决路径（`refuted` + note）、已有分解、讨论与审计、他人提交。
- **reduction 复用激励** → 子引理先建节点再引用；被 ≥2 节点需要的引理**上提下层**；孤立子树不立项。
- **论文式 explanation** → 交付说明与 `memory/*.md` 按论文结构写，不写 tactic 流水账。

完整版见 `prove2me-method` 技能。

---

## 12. 三方定位：Claude FLT / OpenAI NS / 大衍（我们）

> 依据：`类型论文档（`impl/local-paths.json` 的 `typeTheoryDocs`）/是的 Claude 形式化费马大定理 FLT.txt` 与
> `Lean NSE库与FLT库缺口对比…评估报告1.txt`（本项目自己的对照分析）。
> 本节回答「我们和别人到底差在哪」——**用于选路线与判边界，不用于比较谁更强**。

### 12.1 三条不同轨道

| 维度 | Claude FLT | OpenAI NS（Lean 侧） | 大衍（本项目） |
| --- | --- | --- | --- |
| 目标 | 把**已有**数学路线形式化（Wiles 路线） | 搜索**不存在**的证明路线 | 建**信息完整对象层** + 有限离散展示群的构造性证明 |
| 基础设施 | Prove2Me（证明 DAG + 状态跟踪 + agent 协作 + 复用）+ Lean 4/Mathlib | 搜索空间 + 候选结构 | `proof_dag`（DAG/状态/复用，已本地化）+ Agda 内核 |
| 裁决者 | Lean kernel（**不相信模型**） | Lean kernel | Agda kernel（0 postulate，可逐模块审计） |
| 基座 | 代数数论 / 算术几何 | 连续统分析 ℝ | **有限离散**：GF(3) → GF(9) → DC → T⁶ |
| 强项 | 协作规模（几十个 agent 写一个证明） | 探索未知 | 信息完整性 + 构造性 + 可审计 |
| 缺口性质 | **语义/工程层**（机器生成命名、注释缺失、无语义校验工具） | **范围层**（通用 PDE 理论几乎全空） | **结构层**（对象层刚起步） |

### 12.2 关键语义区分（避免越界声称）

- Claude FLT：形式化**已有**定理；其价值在协作基础设施，不在发现新数学。
- Lean NSE 库证明的是 **Clay 备选陈述 (C)/(D) 允许外力** 下的爆破（精心构造的周期外力驱动）。
- **无外力 NS 全局正则性（Clay 原始 A/B）仍然完全开放**——Lean 侧的爆破证明**不构成**对它的回答。
- 大衍的命题是「**有限状态空间 ⟹ 任何确定性演化轨道最终周期（无有限时间爆聚）**」，
  对手是**自主无外力系统**。二者在**假设前提与物理范畴**上处于不同语义轨道，**互不构成否定**。
  → 因此本项目**既不宣称解决 Clay NS**，也不宣称 Lean 侧的工作「错」。

### 12.3 借了什么、没借什么

| 借 | 落法 |
| --- | --- |
| Prove2Me 的证明 DAG / 状态 / 复用 | `proof_dag`：节点状态机 + `next` 调度 + `graph` 知识图谱 |
| 「不相信模型，只信内核」 | `proof_compile` 回执 + 0 postulate 审计 + 证据三档 |
| 「失败要分诊」 | `diagnosis: statement_wrong / proof_too_hard` |

| 没借 | 原因 |
| --- | --- |
| 以 Mathlib / 连续统为基座 | 本框架的基座是有限离散展示群；连续统只在被诊断的对象里出现 |
| 以暴力搜索替代构造 | 搜索只做反例发现与猜想生成（`proof_oracle`），裁决永远是 Agda |
| 以「定理数量」当成熟度 | 我们的成熟度指标是**信息完整度 + 证据可信度 + 断链数** |

**可迁移候选（A 档）**：Lean `Euler/PacketShiftArithmetic.lean` 的 **9 条纯 ℕ 算术定理**
（不依赖任何连续统假设，Lean 侧用 `omega` 闭合）——可翻译为 Agda 离散位移算术的基础设施。
**不适用**：以 ℝ/实分析为基座的模块（Leray–Hopf、BKM、全局正则性等）不能直接搬。

### 12.4 对我们的方法论启示

1. **差异化不是「更大的库」，而是信息完整对象层**——对象的 `construction`/`carrier`/`operations`/`relations`
   是别人不记的东西（见 `type-theory-presentation` §13）。
2. **OpenAI 式的搜索**在我们这里被**构造性 + oracle 反例搜索**替代：oracle 只排假命题，
   不替我们证明；「枚举到没找到反例」不算证明。
3. **Claude 式的协作规模**在我们这里被**台账 + 状态机 + 钩子拦截**替代：
   长程靠 `brief`/`journal`/`handoff` 续接，流程靠 `PreToolUse` 硬拦。

