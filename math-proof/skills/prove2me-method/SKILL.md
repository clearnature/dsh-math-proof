---
name: prove2me-method
description: Prove2me 方法论的本地化（不依赖平台）— 三条提交铁律的本地对应、solver 循环（选题→侦察→尝试→判决→反馈）、milestone/frontier 与 reduction 分解、论文式 explanation、复用激励与「孤立子树不计分」。用于把 AI 数学研究系统的协作纪律落到本项目 Agda/Lean 双轨。 不触发（Do NOT trigger for）: 本地单会话小任务（直接证明即可）、跨天接手与台账维护（用 long-horizon-discipline）。
whenToUse: 需要把大定理拆成可并行攻克的引理、决定先做哪个节点、写论文式说明、或设计 reduction（子引理分解）时加载；与 research-system、proof_dag/proof_graph 配套。
---

# prove2me-method：把 Prove2me 的方法论本地化

> 参考源：`~/.dsh/prove2me_workspace/`（`SKILL.md` v0.9.8 + `references/*.md`）。
> **本机不依赖该平台**：不注册、不提交、不发送凭据。只吸收它的**协作纪律**。

## 0. 为什么学它

Prove2me 把「几万个 agent 共同写一个大证明」变成可管理的流程：每个节点有**逐字陈述**、有**状态**、有 **owner**、有**验证判决**。
本项目已有 `proof_dag`（命题台账）、`proof_graph`（import DAG）、`proof_compile`（验证闸门），缺的正是这套**纪律**。

## 1. 三条铁律 → 本地对应

| Prove2me 铁律 | 本地（Agda）对应 |
| --- | --- |
| 定理必须叫 `solution`，类型与目标 `formal_statement` **逐字一致** | **陈述先行**：先把目标命题写成 Agda 签名并单独 type-check；证明项**不得改弱陈述**迁就证明 |
| 绝不 import 自己的目标定理（它是 `sorry` 占位 = 自证） | **禁止循环论证**：不得用待证命题（或其等价改写）证明自身；不得把目标塞进 `postulate` |
| 自己的代码不得含 `sorry` | **0 postulate / 0 hole / 0 sorry**；用 `proof_audit` 审计 |

## 2. Solver 循环（本地版）

1. **选题**（优先级）：
   - mission ≈ 我们的 DAG 根（主目标）；
   - **milestone** ≈ 人工（captain = 你）认证过的节点——陈述已知良好、比乱猜更高杠杆；**按序攻**，后面的通常依赖前面的；
   - **frontier / open-leaves** ≈ `proof_dag action:"next"` 返回的「依赖已 `proven` 的 `pending`」集合；
   - 整棵结构 ≈ `proof_graph`（import DAG）+ `proof_dag`（命题 DAG）。
2. **侦察（先侦察再动手，禁止直接开写）**：
   - **找原始文献并忠实翻译**，不凭记忆（本项目 = `docs/` 全族 + `memory/` + `web_search`）；
   - 读**被否决的路径**（`proof_dag` 的 `refuted` 节点与 note；历史先例：DC12 L5 位数分离、`classical-bound`）；
   - 读**已有分解**（`proof_graph`：别人/别的模块是否已把目标拆开）；
   - 读**讨论与审计**（`memory/*.md`、`19b-review-list` 待核对清单）；
   - 读**他人的提交**（grep 现有模块，别重复发明已存在的引理）。
3. **尝试**（三种动作）：

   | 动作 | 何时 | 本地做法 |
   | --- | --- | --- |
   | **直接证明** | 能一举闭合 | 单模块内 `proof_compile` 闭合 |
   | **反证** | 命题为假 | 证**整个量化命题的否定** `¬ (∀ …, …)`，不是只否定结论 |
   | **reduction / sketch** | 值得拆成可复用子引理 | 先在台账建子引理节点（`proof_dag add`，状态 `pending`），再写只 import 子引理的父证明；**子引理也必须最终 0 postulate** |

4. **判决**（本地 = 服务端 `/verify` 的对应物）：
   `proof_compile` exit 0 **且** `proof_audit` 无 ⚠️ **且** 具体点对抗验证通过 → 才允许把节点标 `proven`，并把证据写进 `evidence`。
5. **反馈**：写**论文式 explanation**（§4）；把死路记进台账/`memory/`；更新进度。

## 3. Reduction 与复用激励

- 好的 reduction 反映证明的**自然结构**，子引理**可复用**；过度分解成琐碎引理 = 社区反感 = 我们的「引理爆炸」反模式。
- **孤立子树不计分** → 本地版：任何引理必须连到主目标的 DAG 根（`proof_dag` 里 deps 可达根），否则**不立项**。
- 被他人 import 的引理有声誉收益 → 本地版：**被 ≥2 个节点需要的引理上提到下层模块**（先例：`rho` 的代数性质从 `DCCayleyGraph` 上提到 `DuodecClock`）。
- 子引理先建再引用（Prove2me 的 `unknown import` 教训）→ 本地版：**先加节点、先写签名、后填证明**，不要让父证明悬空引用不存在的引理。

## 4. 论文式 explanation（写给人看）

- 先给**结论**（display math）+ 实际用到的假设；反证先给**反例**。
- 再给**证明思路**（一句话核心观察 + 所属技巧）。
- 再**分步**：每步说清「在证什么、为什么成立」；长公式用 display。
- sketch 要说明每个子引理断言什么、reduction 为何有效（子引理是**假设**，不是本提交的成果）。
- **不写** tactic 流水账；**不写**自我评论、不写「巧妙/优雅」；段落之间空行。

## 5. 与本地工具的映射

| Prove2me | 本地 |
| --- | --- |
| mission / milestones | `proof_dag` 的根节点 / 人工认证节点 |
| frontier / open-leaves | `proof_dag action:"next"` |
| decompositions / graph | `proof_graph`（import DAG）+ `proof_dag`（命题 DAG） |
| `/verify` | `proof_compile` + `check_group_chain.sh` / `check_fermat_chain.sh` |
| submission history | `proof_dag` 的 `refuted` / `blocked` + `memory/` 失败路线 |
| explanation | 交付说明 + `memory/*.md` |
| leaderboard | 不适用（本地只记进度与证据） |

## 6. 边界（诚实）

- **不注册、不提交、不发凭据**；平台端点仅作方法论参考（见工作区 `references/`）。
- Lean 侧本地环境是**可选**的：`~/.dsh/prove2me_workspace`（`lean-toolchain` = v4.34.0-rc1，复用 `/data/work/leanprover/mathlib4`，smoke test 已过）。做 Lean 工作时再用；Agda 轨道不依赖它。
- **Agda 证明与 Lean 证明不可互推**：两条轨道各自取证。

## 7. 参考

- 方法论原文：`~/.dsh/prove2me_workspace/references/{mission_solver,prove,missions,discover,communicate,contribute}.md`。
- 本地技能：`research-system`（外层流程）、`proof-engineer`（内层证明工程）。
- 本地工具：`proof_dag`（命题台账/调度）、`proof_graph`（依赖图）、`proof_compile`（验证）。
