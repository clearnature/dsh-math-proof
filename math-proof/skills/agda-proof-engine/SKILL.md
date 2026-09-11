---
name: agda-proof-engine
description: Agda 验证纪律与工具链 — **Agda 是唯一裁决器**（项目补丁版 项目补丁版 Agda（`impl/local-paths.json` 的 `agdaBin`））；含 proof_compile 检查器优先级（agda 优先）、--guardedness 旗标纪律、六类错误指纹分诊与经验库联动、回执签发与证据、沙箱/堆限制陷阱；dype（项目自研实验性内核，尚不完善，不能替代 Agda）的源码地图见 references/dype-experimental.md。 不触发（Do NOT trigger for）: 工具链固有限制的判定（用 prover_limits query）、证明架构与阶段设计（用 long-horizon-discipline）。
whenToUse: 需要编译验证 Agda 证明、修编译错误、选择检查器、理解回执与证据、或遇到 --rewriting/沙箱/堆限制等工具链问题时加载；涉及 dype 源码/构建时先读 references/dype-experimental.md。
---

# agda-proof-engine：Agda 验证纪律与工具链

## 0. 一句话

**Agda 是唯一裁决器。** 证明通过 = 项目补丁版 Agda 编译 exit 0 + 0 postulate/hole/sorry。
dype 是项目自研的**实验性内核**（尚不完善），当前只作生成/加速通道，**不能替代 Agda 的地位**。

## 1. 检查器与旗标（硬纪律）

- **优先级**：`agda`（`项目补丁版 Agda（`impl/local-paths.json` 的 `agdaBin`）`，项目补丁版）→ 仅当 Agda 不可用时才回退 dype；
  dype 只在你**显式**传 `checker:"dype"` 时使用，且报告会标「非权威，需 Agda 复核」。
- 命令行**只加 `--guardedness`**，**绝不加 `--rewriting`**（重写规则由文件头 pragma 承载）。
- 编译验证用 `proof_compile`（自动发现 + data-dir 校验 + 指纹分诊 + 签发回执）；
  交付前用 `proof_audit` 做静态合规审计。
- **没有编译证据不要声称证明通过**；`postulate` 可编译通过但语义未证。

## 2. 六类指纹分诊（错误 → 类别 → 经验库）

`proof_compile` 把 `error: [ClassName]` 映射为 A–F 与性能/规则类，并在命中工具链限制时
标注「经验库: `<id>`」——**先 `prover_limits query "<报错原文>"`，不要把限制当成自己的证明失败**。

| 类 | 指纹 | 典型修法 |
| --- | --- | --- |
| A/B | `NotInScope` / `FileNotFound` | 补 `using`；修模块路径 |
| C | `AmbiguousName` | `renaming`（`zero/suc`、`_+_`） |
| D | `InfectiveImport` | 命令行不加 `--rewriting`，文件头保留 pragma |
| E | `ParseError` / `NoParseForLHS` | 补 `import Data.Product using (_,_)`；算子补 `infixl` |
| F | `UnequalTypes` / `ConstructorDoesNotFit` | 宇宙层级；`.projᵢ` 卡住 → 被调函数含 `let`，改 let-free |
| R/P | `UnsolvedConstraints` / `Heap exhausted` | 补 REWRITE 规则；大 Fin 递归引用已编译模块 + `fromℕ<`；堆上限按基线 RSS 标定 |

## 3. 回执与证据（反刷分）

`proof_compile` 成功时签发**回执**（源文件 sha256 + 检查器 + 退出码 + 时间，落 `~/.dsh/state/math-proof/receipts/`）。
`proof_dag` 只认回执为「已验证」证据：伪造回执报错、**编译后改文件回执即失效**、手写 `evidence` 一律标「未验证」。
因此**别用改记录的方式提高分数**（见纪律 §0.6）。

## 4. 环境陷阱（限制 ≠ 你的失败）

- **沙箱**：链闸门写 stdlib `_build` 被拒 → `exit=42`（权限问题，不是类型错误）；改用 `proof_compile` 逐模块验证。
- **堆限制**：`+RTS -M<n>G` 上限必须按机器基线 RSS 标定（本机 `-M6G` 误杀、`-M8G` 起通过）。
- 限制条目与证据见 `prover_limits`；新限制用 `prover_limits add`（**evidence 必填**）。

## 5. dype（实验性内核，不可替代 Agda）

- dype = Agda 内核替换 + 大衍证明生成引擎（`.dy → .agda → agda verify`）。
- 当前**不可用于日常验证**：二进制 data-dir 烙死为 `/src/data`（不存在）→ 任何编译 exit 1；
  且 `Verify/Pipeline` 最终仍调用 PATH 上的 `agda` 做验证。
- 所以：**生成/加速可以看 dype，裁决必须用 Agda**。
- 源码地图、内核补丁位置、构建命令、阻塞详情与诚实边界：
  → `references/dype-experimental.md`

## 5.5 有界实例化 / 陈述层 / postulate 口径

- 界（`Fin k`、`12 ^ k`）**保持符号化**，具体实例化推到使用点；堆爆先怀疑「证明项在具体界上被求值」。
- 无 `funext` 时函数相等只能写逐点形式；「任意 step」这类陈述不可证。
- `proven` 要求 **0 未声明 postulate**（不是 0 postulate）：逐个声明 `rewrite`/`unreachable`/`gap`。
- 三次事故复盘、处方清单、工具核对规则：
  → `references/bounded-instantiation-and-postulates.md`

## 5.9 编译失败的批量修复协议（本 preset 自带；不依赖外部技能）

> 这一节是**编译失败时的标准循环**。它原先由用户级技能 `loop-engineer`（通用迭代修复引擎）承担，
> 但那是**通用**技能、与本仓库「数学证明」的范围不符，**不随本仓库分发**——所以把与证明工作强相关的
> 部分本地化到这里。若你的环境里存在 `loop-engineer`，可以委托它；没有也完全能按本节执行。

**何时进入**：同一模块累计编译失败 ≥3 次（`proof_compile` / `proof_dag check` 会打 🛑 编译预算闸门），
或一次修改引出多个同类错误。

**循环（硬性规则）**

| 步 | 动作 |
| --- | --- |
| ① 预检 | 文件头 OPTIONS、导入是否有据、是否 `postulate ... where` 反模式（见 §2 指纹表） |
| ② 分诊 | 用 `proof_compile` 的指纹分诊（A–F + 性能/规则类）给每个错误归类；**同一类批量改，不要逐条改** |
| ③ 置信度分流 | 高（指纹完全匹配）→ 直接应用处方；中（部分匹配）→ 生成 2–3 个候选，按**侵入性从低到高**依次试；低（无对应项 / Internal Error）→ **立即停**，报 `ESCALATION_REQUIRED` |
| ④ 批量修复 | 一次改一类；**禁止连续两次用完全相同的修复动作**（原地打转） |
| ⑤ 重编译 | 每轮后重编译；**最多 5 轮**，超过即标 `BLOCKED` 并交人（12 轮是绝对上限） |
| ⑥ 回归冲击波 | 改到**公共底层模块**（`Base/Trit.agda` 这类被 300+ 模块依赖的）、编译选项、构建脚本时，必须跑最小回归集（`engineering/check_*_chain.sh` 或相关模块编译） |
| ⑦ 交付 | 返回 `DONE` / `BLOCKED`（**必带证据**：错误原文 + 已试过的修复 + 指纹分类）/ `ESCALATION_REQUIRED` |

**迭代第 N 次失败时换维度**（不要重复同一维度）：1 低侵入修复 → 2 换维度（补导入 ⇄ 改结构 ⇄ 改编译选项）
→ 3 查隐式污染（flag 传染 / 环境变量）→ 4 拆原子单元（破坏联合归一化）→ 5 深度重构（类型层级 / 模块拆分）
→ 6-8 跨模块级联 → 9+ 放弃自动修复，输出完整诊断链。

**与经验库联动**：每轮失败指纹都该沉淀进 `prover_limits`（`症状 → 判据 → 做法 → 证据`），
`BLOCKED` 的条目尤其要写清「已经排除了什么」——下一个人不该重走同一条死路。

**能耗红线**：单次编译 ≥120s 进入「性能急救」：拆大块、分离联合编译单元（本库实测：符号化界 3.4s vs
具体界实例化 346s 堆爆，见 `references/bounded-instantiation-and-postulates.md`）。

## 5.95 写证明项时先问 Agda（`proof_goals`，`agda --interaction-json`）

**不要**写完就整模块编译、看报错、再猜。交互接口能一次回答：洞里要什么、上下文有什么、这个项过不过。

| action | 回答什么 | 什么时候用 |
| --- | --- | --- |
| `list`（默认） | 洞清单：每个洞的**位置 + 目标类型** | 接手别人的文件 / 刚写下 `{!!}` |
| `context` | 某洞的**目标类型 + 上下文**（名字: 类型） | 写项之前——**上下文里的名字就是你能直接用的项** |
| `infer` | 表达式在该洞的类型 | 不确定某个表达式的类型时 |
| `give` | 在该洞**试一个项**：不通过会给出**期望类型 vs 实际类型** | 试探比整模块编译快得多（一次进程，不落盘） |
| `case` | 对变量分情况，直接给出**可粘贴的子句** | 写 `with`/嵌套 case 之前（避免手写漏 case） |
| `auto` | Agda proof search 的候选（`Cmd_autoAll`） | 构造性/组合型目标；**对需要归纳或新引理的目标通常空手，这是正常的** |
| `normalize` | 表达式的范式 | 判定相等：**两边范式相同通常 `refl` 就能闭合** |

两条硬事实：
- 本工具**只读**：交互命令只在 Agda 内存里生效（实测不改磁盘）——它回答「如果这样写会怎样」；
- 它**不签发回执**：`give`/`auto` 通过 ≠ 已证。证据只由 `proof_compile` 签发（写进文件 → 编译 → 回执 → `proof_dag` 记 `receipt`）。

**为什么不接 `agda-language-server`（ALS）**：ALS 0.2.7 支持的 Agda 是 2.6.4.3 / 2.7.0.1 / 2.8.0，而本项目构建是 **2.9.0-nightly**；
且 ALS 自己就是驱动这同一套 IOTCM 命令的 LSP 前端。将来若为 2.9.0 构建出 ALS，**后端可替换而工具签名不变**——
对应关系（LSP agda-mode 请求 ↔ 本工具 action）：`agda/goalTypeContext` ↔ `context`、`agda/goalType` ↔ `list`、
`agda/infer` ↔ `infer`、`agda/give` ↔ `give`、`agda/makeCase` ↔ `case`、`agda/auto` ↔ `auto`、`agda/compute` ↔ `normalize`。

## 6. 工具分工

| 工具 | 用途 |
| --- | --- |
| `proof_compile` | 编译 + 指纹分诊 + 签发回执（Agda 优先） |
| `proof_goals` | **交互式问 Agda**（洞/上下文/试项/分情况/自动搜索/范式；只读、不签回执） |
| `proof_audit` | 静态合规审计（postulate/hole/浮点/fixity/`let`/`trans` 深度） |
| `prover_limits` | 工具链限制经验库（先 query 再决定） |
| `proof_dag` | 台账/证据/评分/见证（回执写进 `receipt` 字段） |

编译错误闭环按本文件 §5.9 执行（若环境存在 `loop-engineer` 技能可委托它，它不随本仓库分发）；证明策略见 `proof-engineer` 技能。
