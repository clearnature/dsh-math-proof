# 依赖类型论 · 数学证明模式 知识库（六文档蒸馏）

> 用途：为「数学证明模式」AI agent 的 system prompt 提供可直接引用的事实层与措辞层。
> 来源代号（全部位于 `类型论文档（`impl/local-paths.json` 的 `typeTheoryDocs`）`）：
> - **[报告]** 依赖类型论与符号推理知识体系与神经符号集成研究报告.txt
> - **[史]** 类型论推理的发展史.txt
> - **[前沿]** 5 个核心前沿与工程落地方向.txt
> - **[体系]** 结构化的、可扩展的"依赖类型论与符号推理"知识体系.txt
> - **[大衍]** 这份融合了 大衍框架 依赖类型论.txt
> - **[triq]** 开源项目 triqchem lab discrete.txt
>
> 凡标 ⚠ 者为文档互相矛盾、术语松散或属推测性主张（非已证数学）。

---

## 1. 依赖类型论核心概念清单

| 概念 | 文档精确表述（逐条） | 出处 |
|---|---|---|
| 依赖类型论 DTT | "通过将类型与项紧密耦合，为构造性数学与程序形式化验证提供了坚实的逻辑基础" | [报告] |
| Curry–Howard 同构 | "命题即类型，证明即程序"；"命题 $P$ 映射为类型 $A$，证明 $p$ 映射为类型元素/程序 $e$"；"将'编写程序'与'构建证明'统一起来" | [史][报告] |
| 命题即类型 / 证明即项 | "在 Curry-Howard 同构下，命题对应于其所有有效证明项的集合类型，消解了传统模型论语义中对外部抽象世界的依赖" | [报告] |
| 联结词映射 | "合取 ($\times$)、析取 ($+$)、蕴涵 ($\rightarrow$)、真/假（$\mathbf{1}/\mathbf{0}$）" | [报告] |
| 直觉主义 / 构造性数学 | "基于数学构造主义，认为一个命题为真，必须有一个具体的构造性证明"；"排中律（Law of Excluded Middle）与双重否定消除律的限制" | [史][报告] |
| BHK 语义 | "Brouwer-Heyting-Kolmogorov (BHK) 构造性语义" | [报告][大衍] |
| 构造性存在性 | "构造性存在性（Constructive Existence）与算法抽取" | [报告] |
| 自然演绎 | "自然演绎（Natural Deduction）：引入律与消去律（$\beta/\eta$-归约）" | [报告] |
| 相继式演算 | "相继式演算（Sequent Calculus）：切消定理（Cut-Elimination）与结构规则" | [报告] |
| Π-类型（依赖积） | "依赖全称量化：$\Pi$-类型（依赖函数类型，$\prod_{x:A} B(x)$）" | [报告] |
| Σ-类型（依赖和） | "依赖存在量化：$\Sigma$-类型（依赖对类型/子类型，$\sum_{x:A} B(x)$）" | [报告] |
| W-类型 | "归纳数据类型：$W$-类型（良基树，Well-founded Trees）" | [报告] |
| 相等类型 / identity type | "均一相等类型（Identity Types, $a =_A b$）与 J-消去律" ⚠ 术语非常规（通译"恒等类型/相等类型"） | [报告] |
| definitional vs propositional equality | "标准的 MLTT 和 CiC 严格区分定义相等（Definitional Equality, 即基于 $\beta/\eta$-规约的算法可判定相等）与命题相等（Propositional Equality, 即由类型 $a =_A b$ 表示的证明）" | [报告] |
| 内延相等 | "命题相等与内延相等，区分 $\text{Prop}$ 与 $\text{Type}$" ⚠ 疑为 intensional equality 的松散译法 | [报告] |
| 宇宙层级 | "多层宇宙（Universes Hierarchy: $\text{Prop} \subset \text{Type}_0 \subset \text{Type}_1 \dots$）"；"累进性（Cumulativity）"；"区分非谓词性宇宙 $\text{Prop}$ 与谓词性宇宙 $\text{Type}_i$" | [报告] |
| 大小限制 | "避免 Girard 悖论的大小限制（Size Restrictions / Smallness）" | [报告] |
| 计算规范性 Canonicity | "具备强规范性（闭项必规约为正则形式）"；HoTT"破坏规范性（单价公理作为无计算内容的公理引入）"；CTT"恢复规范性（单价公理作为定理且具备直接计算归化律）" | [报告] |
| 归一化 / 可判定性 | CTT"其**归一化（Normalization）**和**可判定性**已获证明，且单价公理在其中是**可计算**的定理而非公理" | [史] |
| 函数外延性 | MLTT 命题相等"缺乏函数外延性"；OTT"能容纳**函数外延性、命题外延性**和**商归纳类型 (QITs)** 等公理" | [报告][史] |
| 传输 Transport | CiC"必须手动构造复杂的传输证明（Transport Proofs）"；CTT"自动沿着路径传输定理，计算展开式的 $\text{transp}$" | [报告] |
| 单价公理 Univalence | "弗沃斯基单价公理（Voevodsky's Univalence Axiom: $(A \simeq B) \simeq (A = B)$）"；"允许将类型之间的同伦等价直接转换为类型之间的相等" | [报告][史] |
| 高阶归纳类型 HITs | "高阶归纳类型（Higher Inductive Types, HITs，如 $S^1$, Quotients）" | [报告] |
| 同伦阶 h-levels | "引入同伦阶（$h$-levels：命题、集合、群胚等）分层宇宙体系" | [报告] |
| 区间对象 𝕀 / 面格 | "区间对象（Interval $\mathbb{I}$）与面格（Face Lattice）"；"区间变量（$i, j \in \mathbb{I}$）" | [报告][前沿] |
| 路径类型 Path Types | "将相等性重构为从区间 $\mathbb{I}$ 到类型的函数（即路径 Path）"；"路径类型（Path Types）作为基本图示，内置计算规约" | [报告] |
| CCHM 框架 | "CCHM 框架：将单价公理作为定理证明，恢复计算规范性（Canonicity）" | [报告] |
| 组合式路径合成 | "组合式路径合成（Path Composition）与 De Morgan 结构"；规化算子 $\text{transp}, \text{hcomp}$ | [报告][前沿] |
| 结构身份原理 SIP | "结构身份原理（SIP）：同构结构可直接代换" | [报告][大衍] |
| 逻辑单调性 | "传统依赖类型论（如 MLTT、CiC）建立在逻辑单调性之上——即在上下文 $\Gamma$ 中增加新的假设或公理，原本成立的类型判断仍然成立" | [报告] |
| 良基定义 | "将系统的状态转移函数严格限定在类型的良基定义中" | [triq] |
| 反射 Reflection | "通过将 Agda 的抽象语法树（AST）引用至元编程层，自动规化求解复杂的代数恒等式" | [triq] |
| 重写规则 --rewriting | "引入 REWRITE 规则，将高阶路径规化直接注入到 Agda 的规化引擎中" | [triq] |
| 0 postulate / 0 hole | "通过保持 0 postulates 和 0 holes 确保了内核逻辑推导的封闭完备性" ⚠"封闭完备性"非标准术语 | [triq] |
| 商归纳类型 QITs | "商归纳类型 (QITs)" | [史] |
| 会话类型 / 线性类型 | "会话类型 (Session Types) 用于保证并发系统的类型安全和无死锁等属性"；"线性类型 (Linear Types) 用于精确控制资源使用" | [史] |
| 观测类型论 OTT | "通过引入 `cast` 操作符处理等式"；"其高阶版本 (HOTT) 目标成为能表示所有数学的新框架" | [史] |
| 有向类型论 | "旨在将传统类型论中的对称相等类型，推广为非对称的'同类型'（Hom-types），以合成地推理（高阶）范畴" | [史] |
| 模态 / 定量 / 守卫类型论 | "定量类型论 (Quantitative Type Theory, QTT)，精确追踪变量使用次数，以捕获多项式时间等资源约束"；"守卫类型论 (Guarded Type Theory) 中推导 Löb 归纳法" | [史] |
| 显示类型论 / 动态 HoTT | "显示类型论 (Displayed Type Theory, dTT)，这是一种多模态 HoTT"；"动态同伦类型论 (DHoTT)，它引入时间参数" | [史] |
| 半单纯类型 | "定义半单纯类型 (Semi-simplicial Types) 这类无限相干结构" | [史] |
| 计算 UIP | "社区正在为其添加计算 UIP (Uniqueness of Identity Proofs) 的支持" | [史] |
| 未指定依赖类型论 UDTT | "未指定依赖类型论（Underspecified Dependent Type Theory, UDTT）"；"指代（Anaphora）与预设（Presupposition）被统一建模为未指定类型" | [报告] |
| 依赖类型语义 DTS | "依赖类型语义（Dependent Type Semantics, DTS）" | [报告] |
| 类型幻觉 | "看似合理却无法通过内核类型检查的'类型幻觉'" | [报告] |

---

## 2. 群为基本原理 / 代数结构的类型论表述

**⚠ 关键缺口（必须先告知调用方）：六份文档并未把"群"作为基本原理展开，也没有"群作用""群表示""表示论""∞-groupoid"这些条目。** 与群/代数结构相关的全部素材如下，逐条保留原措辞：

### 2.1 群、群胚、同伦群
- 群胚（唯一出现，作为 h-level 例子）："引入同伦阶（$h$-levels：命题、集合、群胚等）分层宇宙体系，天然支持更高阶同伦计算" [报告]。
- 高阶同伦群（唯一出现）："当处理复杂代数结构或高阶同伦群时，内核类型检查的时间复杂度极高" [报告]。
- 基本群（DTT-Bench Level 3 任务示例）："计算圆环 $S^1$ 的基本群为 $\mathbb{Z}$、沿着等价路径传输代数结构定理" [前沿]。
- 12 阶交换群："DC=C₃×C₄ (12阶交换群)"，归入"代数基座类 (Algebraic) | 群、环、域、格" [大衍]。
- 有限结构对称性："离散判定、有限结构对称性、矩阵行列式非奇异" [大衍]。
- **"群作用""群表示""表示论""∞-groupoid" 在六文档中零出现**（[大衍] 的 "NM-DEKL3∞" 之 ∞ 是类型逻辑命名，不是 ∞-groupoid）。

### 2.2 相等性即结构（文档真正的"结构原理"主线）
- "在依赖类型论的发展脉络中，理论演进的主线在于如何更自然且高效地处理相等性（Equality）。" [报告]
- "相等即路径（Paths），同伦等价可推导类型相等" [报告]。
- "单价公理 (Univalence Axiom) 将数学中'结构等价'与'相等'的概念统一起来" [史]。
- 结构身份原理 SIP："同构结构可直接代换"；对照 CiC"需编写大量的传输函数（Transport）与结构转化" [报告]。
- MLTT"需手动证明同构，无法直接沿着等价传输定理" [报告]。
- 对称→非对称："旨在将传统类型论中的对称相等类型，推广为非对称的'同类型'（Hom-types）" [史]。

### 2.3 抽象代数结构的类型论表述
- DTT-Bench Level 2："宇宙层级限制、多重依赖约束、抽象代数结构"；语料来源 "Lean 4 Mathlib4"；任务示例"测度空间中的测度可加性证明、拓扑空间连续性推断" [前沿]。
- 范畴与结构类："函子、自然变换、拓扑斯 | Giry monad（概率）、Sheaf逻辑、结构身份原理（SIP）、函子语义" [大衍]。
- "用函子（Functors）等范畴论概念为AI和机器学习提供新理论基础" [史]。
- HoTT 内部构造："多项式函子和操作子（Operads）"、"外延态射"、"非循环类型" [史]。

### 2.4 结构 = record + laws as fields（文档中唯一显式范例）
[前沿] 给出的 Lean 4 代码是六文档中唯一"结构签名（signature）+ 定律作为字段（law as field）"的编码：

```lean
def SecurityInvariant (env_state : EnvHash) (permissions : AuthContext) : Prop :=
  (permissions.is_trusted = true) ∧ (env_state.is_sanitized = true)

structure AgentState (env_state : EnvHash) (permissions : AuthContext) where
  state_data : ByteVector
  safety_proof : SecurityInvariant env_state permissions -- 依赖证明项
```
即：**依赖记录类型（structure）中，不变量/定律以依赖证明项字段（safety_proof）形式携带，构造该结构即强制提交证明**。

### 2.5 商（quotient）
- 商归纳类型 QITs（OTT 容纳）[史]。
- LCM 商空间："利用手征共轭与最小公倍数（LCM）商空间计算状态演化" [triq]。
- CRT 同构作为"沿等价路径自动传输代数性质"的商/分解实例（见 §4）。
- **无"商类型（quotient types）"作为独立概念的条目**，仅有 QITs 与 LCM 商空间。

---

## 3. 证明工程 / 形式化验证方法论

### 3.1 构造性优先，但接受有限穷举与判定过程
- 立场："一个命题为真，必须有一个具体的构造性证明" [史]。
- 工程侧承认的"暴力/穷举/判定"：
  - "CRT分块加速、GNN规化预测、HTPS/MCTS树搜索、高斯消元判定" [大衍]。
  - "59,049穷举验证"（L4 数据与评测层）[大衍]。
  - "矩阵行列式非奇异"作为可判定判据 [大衍]。
  - "反例构造（3-to-1坍缩）"、"大衍GF(3)/GF(9)反例、全局矩阵判据、鸽巢原理" [大衍]。
  - "37+ 组 Scholar Loop 实验验证（覆盖陈数守恒、$\sqrt{3}$ 能隙、极限环跳跃等）…利用外部数据驱动（Python/Rust 仿真）生成约束，反向指导 Agda 代码库进行形式化推演与补全" [triq]。
- ⚠ 方法学张力：文档同时倡导构造主义与依赖穷举/数值仿真反哺形式化（双轨制），并非纯构造性路线。

### 3.2 归一化策略
- 反射证明：项目"包含 347 个基于 Agda Reflection 的反射证明（共计 3261 行代码）"；"自动规化求解复杂的代数恒等式" [triq]。
- REWRITE 注入：T6.agda 等核心模块"引入 REWRITE 规则，将高阶路径规化直接注入到 Agda 的规化引擎中" [triq]。
- 神经加速规化：GNN 预测最优规化顺序（"Minimizing Term Size"）；"Redex 优先级评估"；"弱首头范式（WHNF）规化队列" [前沿]。
- Cubical 规化算子：$\text{transp}$、$\text{hcomp}$、面条件（Face Conditions $r=0, r=1$）[前沿][报告]。
- 目标：解决"高维路径的规化与合成会导致等价展开项呈指数级膨胀" [报告]。

### 3.3 反射 / 元编程
- Agda："基于模式匹配与 Hole 交互，依靠 External Reflection，缺乏高级自动化 Tactics Engine" [报告]。
- Agda 反射成果见 §3.2 [triq]。
- Lean 4："完全实现自托管，提供强大的元编程（Macro/Elab）、Aesop 策略与 SMT 桥接"；"原生集成了高度灵活的元编程接口（Elaborator / Macro System），允许 AI 开发者以极低的成本挂载外部神经网络架构" [报告]。
- ⚠ 张力：[报告] 称 Agda"缺乏高级自动化策略引擎"且"大规模自动证明搜索…在 Agda 上的实现难度较高"，而 [triq] 恰恰把 430+ 文件 Agda 库当作 DTT-Bench Level 3 语料与反射范式样板。二者不构成逻辑矛盾（reflection ≠ tactics），但对"在哪条轨道上做 AI for Math"的结论相反。

### 3.4 决策过程 / 自动化
- Coq："支持 Ltac, Ltac2, SSreflect，以及外部 Sledgehammer (CoqHammer) 深度求解"；"Ltac2 策略引擎和 SSReflect 框架能够处理极其复杂的组合爆破与代数推导" [报告]。
- Lean 4："Aesop 策略与 SMT 桥接" [报告]。
- LLM + 符号求解器："将其转换为 SMT-LIB 标准语言，驱动 Z3、Vampire 或 CVC5 求解器进行自动求解，最后反向映射为依赖类型论证明项的工程回路"；"大模型负责语义理解与模糊归纳，符号求解器负责无误的推导逻辑验证" [报告]。
- 可微逻辑："打破现有 Logic Tensor Networks (LTN) 和 DeepProbLog 仅限于一阶逻辑（FOL）的局限，开发支持 $\Pi$-类型与 $\Sigma$-类型的实数语义解释器" [报告]（🟠 推测）。

### 3.5 神经符号集成（三阶段路线图）
- 总纲："神经提议，符号验证" [史]。
- 短期（1-2 年，浅/中层桥接）："LLM 策略生成与自动补全（如 Lean-Copilot、LeanDojo）"；"大模型与符号求解器协同"；"限定域自动形式化（Autoformalization）" [报告]。
- 中期（3-5 年，深度混合）："神经引导的高阶证明树搜索：推广 Thor 与 HyperTree Proof Search (HTPS) 架构"；"利用图神经网络（GNN）或 Transformer 编码依赖类型论的抽象语法树（AST）…指导蒙特卡洛树搜索（MCTS）或蒙特卡洛超树搜索（HTPS）展开"；"依赖类型语义（DTS）与几何嵌入融合"；"可微逻辑编程（LTN / DeepProbLog）向依赖类型论的推广" [报告]。
- 长期（5-10 年，原生范式）："原生可微立方类型论（Differentiable Cubical Type Theory）"；"动态演化非单调类型系统（KOS-TL / NM-DEKL3$\infty$）" [报告]（🟠 推测）。
- Soundness 隔离原则（可直接写进 system prompt）："GNN 仅作为启发式 Oracle 挂载在 Cubical 类型检查器的弱首头范式（WHNF）规化队列中。GNN 建议规化路径，但内核仍须执行严格的确定性等价判断。即使 GNN 预测错误，也仅会增加化简耗时，绝不破坏类型系统的逻辑完备性与 Soundness。" [前沿] ⚠"逻辑完备性"与 Soundness 混用。

### 3.6 人机协作证明 / 证明搜索 / 反例搜索
- 证明搜索系统：wani、Neural Wani、Nester、Thor、HTPS、GPT-f、LeanDojo、Lean-Copilot、MCTS [报告][史]。
- "Neural Wani：一个针对依赖类型论 (DTT) 的自动定理证明器，利用神经网络预测下一步推理规则，以加速证明搜索" [史]。
- "Nester：一种神经符号类型推理方法，通过将类型推理分解为子任务，在保持模型轻量化的同时，显著提升类型推断准确率" [史]。
- 反例搜索：反例构造（3-to-1坍缩）、GF(3)/GF(9) 反例、鸽巢原理 [大衍]。
- 引理自动合成是公认未解："如何让 AI 自主创造全新的、具有高度泛化价值的依赖类型引理，是突破 AI for Math 瓶颈的终极挑战之一" [报告]。

### 3.7 验证协议 / 形式化抽取工作流
四步管道 [报告]：
1. 文本句法解析与依存结构抽取（CCG Parser 如 lightblue / 专用 LLM）→ AST；
2. 未指定依赖类型语义表征（UDTT）构建：实体映射为 $\text{Entity}$，$n$ 元谓词映射为 $\text{Entity}^n \rightarrow \text{Type}$；
3. 神经几何嵌入与动态逻辑公理注入：检查 $\text{Type}$ 归属，知识缺失时调用双曲空间流形分类器，测地线夹角 $\Xi(u,v) \le \psi(u)$，转为"动态公理（Dynamic Axioms）"注入推导上下文 $\Gamma$；
4. 知行逻辑（KOS-TL）多层变迁与目标代码编译：L0 Core 静态真理层 → L1 Kernel 动态变迁层（小步运算语义）→ L2 Runtime 物理执行层（Elaborator 生成 Lean 4/Coq 可编译代码）。
工具链：CCG Parser(lightblue)/LLM Autoformalizer → UDTT Engine/DTS Core → Hyperbolic Entailment Cones/LTN → wani/Lean 4 + Aesop/Thor → KOS-TL Runtime/Coq/Lean 4 Extractor。

DTT-Bench 三元组协议 [前沿]：⟨ 自然语言描述, 非形式化逻辑推导步骤, 可被编译检查的 DTT 形式化代码 ⟩；三级难度（Level 1 基础 DTT；Level 2 进阶 CiC；Level 3 同伦/立方）。
指标 [前沿]：Kernel Pass@k（内核无错编译通过率）、No-Axiomatic-Sourcing Rate（是否含未证明假设或 sorry 占位符）、Type Dependency Depth Index (TDDI)（嵌套 Π/Σ 绑定深度与路径类型维度）。

### 3.8 对抗防御协议（类型安全边界）
- "将 AI 模型的行为规范与状态转移规则（如协议组中的不变量约束）直接编码为 Agda 中的类型断言。当神经网络或外部 Agent 生成决策策略时，必须提交能够在 src/Sovereign/Engine/ 状态机中通过类型检查的证明项。" [triq]
- "当攻击者注入恶意提示词…时，输入指令无法构造出有效的证明项 cmd_proof : ValidCommandProof input_cmd auth" [前沿]。
- "由于类型检查器（Elaborator）在运行前或小步演进（$\beta, \delta$ 规化）阶段强制检查证明项，任何非法状态转换均无法在类型系统中通过编译，从而在逻辑层面上免疫对抗性攻击" [前沿]。

### 3.9 工具/系统清单（文档实际点名者）
Agda（MLTT；Cubical Agda 基于 CTT；External Reflection；agda-stdlib、cubical 库；Agda 2.9.0、cubical 0.9）、Coq（CiC；Prop vs Set/Type；Ltac/Ltac2/SSReflect；CoqHammer/Sledgehammer；CompCert、Iris、Mathematical Components、Coq StdLib）、Lean 4（CiC + 经典逻辑扩展，支持排中律与选择公理；自托管；Macro/Elab；Aesop；SMT 桥接；Mathlib/Mathlib4、Condensed Math）、Arend、Navya-Nyāya CTT 编码、wani、Neural Wani、Nester、GPT-f、LeanDojo、Lean-Copilot、Thor、HTPS、MCTS、DeepProbLog、NeurASP、LTN、LNN、∂ILP、Z3、Vampire、CVC5、SMT-LIB、lightblue（CCG parser）、Neo4j/Obsidian（知识图谱工具）。
**⚠ Isabelle 在六文档中零出现**（勿从外部知识补入并归于文档）。

---

## 4. 大衍 / triqchem-lab 框架与类型论的融合点

### 4.1 大衍四维正交分类体系 [大衍]
- 总纲：融合"**大衍框架（离散雅可比）**"、"**依赖类型论（DTT）**"、"**神经符号集成（NeSy）**"；"这套四维分类法已将您知识图谱中的所有 190+ 话题全部纳入可计算、可查询的架构中"。
- 第一维（知识层级）：L0 哲学与元数学层——"BHK语义、Curry-Howard同构、排中律限制、大衍'遁去的一'哲学"；L1 形式逻辑与类型论层——"MLTT (Π/Σ/W)、HoTT (单价/HITs)、CTT (区间/面格)、DC=C₃×C₄"；L2 算法与复杂性层——"CRT分块加速、GNN规化预测、HTPS/MCTS树搜索、高斯消元判定"；L3 工程与互操作层——"Lean 4 元编程、PyTorch FFI、零拷贝张量共享、KOS-TL运行时"；L4 数据与评测层——"DTT-Bench、Kernel Pass@k、TDDI指数、59,049穷举验证"。
- 第二维（数学结构）：代数基座类——"群、环、域、格 | DC=C₃×C₄ (12阶交换群)、GF(3)/GF(9)、特征3坍缩、CRT (Z/12Z)"；逻辑与证明论类——"直觉主义逻辑、相继式演算、自然演绎、KOS-TL L0静态真理层"、"演绎闭包、单调性维持、反例构造（3-to-1坍缩）"；几何与拓扑类——"双曲空间超锥体、HoTT路径空间、CTT区间对象𝕀、4320D旋转闭包"、"等价传输、高维同伦计算、连续与离散的对应（投影）"；范畴与结构类——"Giry monad（概率）、Sheaf逻辑、结构身份原理（SIP）、函子语义"。
- 第三维（工程/AI 生命周期）：数据工程类——"程序化合成逻辑数据、DTT-Bench三元组、非结构化文本→UDTT映射"；模型与算法类——"GNN编码器、Neural DTS双曲分类器、Thor/HTPS神经引导搜索、可微逻辑编程"；基础设施与FFI类——"Lean 4 C API绑定、PyTorch at::Tensor外部指针、零拷贝传输协议"；验证与安全类——"Agda 0-postulate证明、Cubical类型检查器、KOS-TL对抗免疫类型签名"；评估与监控类——"Kernel Pass@k、No-Axiomatic Rate、CTT规化耗时统计"。
- 第四维（确定性/风险）：✅ 已形式化/已证明 ~40%——"大衍GF(3)/GF(9)反例、全局矩阵判据、鸽巢原理、FFI内存共享设计"；🟡 理论可导/待工程实现 ~30%——"GNN加速规化、概率测度类型语义、KOS-TL完整编译器"；🟠 假说/前沿探索 ~20%——"原生可微Cubical类型论、NM-DEKL3∞非单调演化、引理自动发明"；🔴 开放难题/已知鸿沟 ~10%——"自然语言→高阶依赖类型的形式化鸿沟、CTT指数级空间爆破"。
- 交叉检索标签约定：`(层级:L2)`、`(结构:Geometric)`、`(工程:Algorithm)`、`(状态:🟡)`。

### 4.2 triqchem-lab / discrete-mathematics 的类型论呈现 [triq]
- 项目定位："triqchem-lab/discrete-mathematics（项目名称：'律算合一 — 离散数学形式化验证'）是一个将依赖类型论、同伦/立方类型论（HoTT/CTT）、反射元编程（Reflection）以及硬件/离散系统形式化深度结合的工程落地案例。"
- T⁶ 环面："项目将中国剩余定理（CRT）谐波与离散环面 $T^6$（包含 $144 \times 46 = 6624$ 个节点的极向与环向缠绕）建模为 src/Sovereign/HoTT/ 中的纤维束（Fiber Bundles）与同伦类型。"
- CRT / 单价传输："利用 Cubical Agda 中的 Path 类型与单价公理，直接证明了 CRT 同构关系 $\mathbb{Z}/M \cong \mathbb{Z}/65536 \times \mathbb{Z}/177147$（其中模数 $M = 3^{11} \times 2^{16} = 11609505792$）。在 CTT 中，这一同构可以沿着等价路径自动传输代数性质，极大地简化了双振荡器谐波谱的推导过程。"
  - ✅ 数学核对：$3^{11}=177147$、$2^{16}=65536$、$177147\times65536=11{,}609{,}505{,}792=M$，$\gcd(2^{16},3^{11})=1$，CRT 分解成立。$144\times46=6624$ 亦正确。
- L0–L8 九层类型架构 ↔ KOS-TL 三层语义："L0–L2（物理与代数基础层）：从 x86-64 ADC 硬件信号（L0）映射至 $\text{GF}(3)$ 三进制位（L1）以及 $\mathbb{Z}/3^{11}\mathbb{Z}$ 位置制（L2），完成了'物理比特到代数类型'的语义提升。"
- L3–L6："在 Coupling/ 和 MetaStructure/ 模块中，利用手征共轭与最小公倍数（LCM）商空间计算状态演化，将系统的状态转移函数严格限定在类型的良基定义中。"
- L7–L8："在类型系统中表达全局陈数（Chern Number $C = \pm 2$）拓扑死锁守恒律与 46 个驻波点拓扑观察，实现了'使非法物理状态不可表达'（Make Illegal States Unrepresentable）。"
- 反射/重写：见 §3.2；"虽然牺牲了绝对的 --safe 选项，但通过保持 0 postulates 和 0 holes 确保了内核逻辑推导的封闭完备性"。
- AI 宪法与双轨验证："项目包含 src/Sovereign/AI/Constitution 模块，并基于 Scholar Loop 实验引擎通过了 Rust 与 Python 端的多语言交叉校验"。
- 语料价值："拥有 430+ 个 Agda 源文件以及深度依赖类型结构，完全可以作为构建高阶依赖类型论自动形式化数据集（DTT-Bench Level 3）的真实高质量语料库"。
- 复刻建议："项目在 src/Sovereign/Structology/ 和 Arithmetic/ 中展现的大规模反射证明组织方式，可以直接复刻到 Lean 4 的 Elab 元编程框架中"。

### 4.3 类型论层如何呈现大衍要素（文档口径）
| 大衍要素 | 文档中的类型论呈现 |
|---|---|
| GF(3)/GF(9)、三进制 | "映射至 $\text{GF}(3)$ 三进制位（L1）以及 $\mathbb{Z}/3^{11}\mathbb{Z}$ 位置制（L2）" [triq]；"GF(3)/GF(9)、特征3坍缩" [大衍] |
| T⁶ 环面 | "离散环面 $T^6$（包含 $144 \times 46 = 6624$ 个节点的极向与环向缠绕）建模为…纤维束与同伦类型" [triq] |
| CRT | "CRT (Z/12Z)" [大衍]；"CRT 谐波"与 $\mathbb{Z}/M \cong \mathbb{Z}/65536 \times \mathbb{Z}/177147$ [triq]；"CRT分块加速" [大衍] |
| 144 / 46 | 仅作为 $144\times46=6624$ 节点与"46 个驻波点拓扑观察" [triq]；**"POLAR=144""TORUS=46" 字样不在六文档中**（见 AGENTS.md） |
| 陈数 | "全局陈数（Chern Number $C = \pm 2$）拓扑死锁守恒律" [triq]；"陈数守恒" [triq] |
| 12 阶交换群 | "DC=C₃×C₄ (12阶交换群)" [大衍] |
| 十二律 / 仲吕 / SOVEREIGN_LCM / A₄ / 幻方 / 纳音 / 五行 | **六文档零出现**（仅见于工作区 AGENTS.md）；不可声称文档已覆盖 |
| 离散雅可比 | "大衍框架（离散雅可比）" [大衍]；"Jacobian" 未在文档展开 |

---

## 5. 可直接引用的金句（verbatim）

1. "命题即类型，证明即程序。" —— [史]
2. "一个逻辑命题对应一个类型，而该命题的一个证明则对应一个具有该类型的程序。" —— [史]
3. "它揭示了程序与数学证明之间的深刻联系。" —— [史]
4. "一个命题为真，必须有一个具体的构造性证明。" —— [史]
5. "在依赖类型论的发展脉络中，理论演进的主线在于如何更自然且高效地处理相等性（Equality）。" —— [报告]
6. "标准的 MLTT 和 CiC 严格区分定义相等（Definitional Equality, 即基于 $\beta/\eta$-规约的算法可判定相等）与命题相等（Propositional Equality, 即由类型 $a =_A b$ 表示的证明）。" —— [报告]
7. "相等即路径（Paths），同伦等价可推导类型相等" —— [报告]
8. "单价公理…允许将类型之间的同伦等价直接转换为类型之间的相等，从根本上实现了基于同构的数学推导与代码复用。" —— [报告]
9. "闭项…在存在单价公理的情况下可能卡在公理节点，而无法规约为具体的自然数数值。" —— [报告]
10. "在 CTT 中，单价公理变成了可被严格证明的定理，且赋予了确切的计算规化规则。" —— [报告]
11. "结构身份原理（SIP）：同构结构可直接代换" —— [报告]
12. "神经提议，符号验证。" —— [史]
13. "大模型负责语义理解与模糊归纳，符号求解器负责无误的推导逻辑验证。" —— [报告]
14. "GNN 建议规化路径，但内核仍须执行严格的确定性等价判断。即使 GNN 预测错误，也仅会增加化简耗时，绝不破坏类型系统的逻辑完备性与 Soundness。" —— [前沿]
15. "使非法状态不可表达（Make Illegal States Unrepresentable）。" —— [报告][前沿][triq]
16. "当攻击者注入恶意提示词…时，输入指令无法构造出有效的证明项。" —— [前沿]
17. "通过保持 0 postulates 和 0 holes 确保了内核逻辑推导的封闭完备性。" —— [triq]
18. "在 CTT 中，这一同构可以沿着等价路径自动传输代数性质。" —— [triq]
19. "现有的 LLM 容易在生成复杂依赖类型（如包含依赖限制的子类型）时产生看似合理却无法通过内核类型检查的'类型幻觉'。" —— [报告]
20. "类型论…正演变为一个横跨基础数学、逻辑学与计算机科学，并积极向AI领域输出核心思想的基础性学科。" —— [史]
21. "将 AI 模型的行为规范与状态转移规则（如协议组中的不变量约束）直接编码为 Agda 中的类型断言。" —— [triq]

---

## 6. 术语对照表（Chinese ↔ English，取自文档）

| 中文 | English |
|---|---|
| 依赖类型论 | Dependent Type Theory (DTT) |
| 马丁-洛夫类型论 / 直觉主义类型论 | Martin-Löf Type Theory (MLTT) / Intuitionistic Type Theory (ITT) |
| 归纳构造演算 | Calculus of Inductive Constructions (CiC) |
| 构造演算 | Calculus of Constructions (CoC) |
| 同伦类型论 | Homotopy Type Theory (HoTT) |
| 立方类型论 | Cubical Type Theory (CTT) |
| 观测类型论 | Observational Type Theory (OTT) |
| 有向类型论 | Directed Type Theory |
| 显示类型论 | Displayed Type Theory (dTT) |
| 动态同伦类型论 | Dynamic Homotopy Type Theory (DHoTT) |
| 模态类型论 | Modal Type Theory |
| 定量类型论 | Quantitative Type Theory (QTT) |
| 守卫类型论 | Guarded Type Theory |
| 模糊构造性类型论 | Fuzzy Constructive Type Theory |
| 简单类型论 / 分支类型论 | Simple Type Theory (STT) / Ramified Type Theory (RTT) |
| 简单类型λ演算 | Simply Typed Lambda Calculus |
| Curry-Howard 同构 | Curry–Howard Isomorphism |
| 命题即类型 / 证明即程序 | Propositions-as-Types / Proofs-as-Programs |
| BHK 构造性语义 | Brouwer–Heyting–Kolmogorov semantics |
| 自然演绎 | Natural Deduction |
| 相继式演算 | Sequent Calculus |
| 切消定理 | Cut-Elimination |
| 引入律 / 消去律 | Introduction / Elimination Rules |
| β/η-归约 | β/η-Reduction |
| 依赖类型 | Dependent Types |
| 依赖函数类型 / 依赖积 | Π-type / dependent product |
| 依赖对类型 / 依赖和 | Σ-type / dependent sum |
| 归纳数据类型 | Inductive Data Types |
| 共归纳类型 | Coinductive Types |
| W-类型 / 良基树 | W-type / Well-founded Trees |
| 相等类型 / 恒等类型 | Identity Types |
| J-消去律 | J-eliminator |
| 定义相等 | Definitional Equality |
| 命题相等 | Propositional Equality |
| 内延相等 | intensional equality（文档用词） |
| 函数外延性 / 命题外延性 | Function / Propositional Extensionality |
| 宇宙 / 宇宙层级 | Universe / Universe Hierarchy |
| 累进性 | Cumulativity |
| 非谓词性 / 谓词性 | Impredicative / Predicative |
| 大小限制 | Size Restrictions / Smallness |
| 计算规范性 | Canonicity |
| 强规范性 | Strong Normalization |
| 归一化 | Normalization |
| 可判定性 | Decidability |
| 传输 | Transport |
| 结构身份原理 | Structure Identity Principle (SIP) |
| 单价公理 | Univalence Axiom |
| 同伦等价 | Homotopy Equivalence |
| 高阶归纳类型 | Higher Inductive Types (HITs) |
| 商归纳类型 | Quotient Inductive Types (QITs) |
| 路径类型 | Path Types |
| 区间对象 | Interval |
| 面格 | Face Lattice |
| CCHM 框架 | CCHM framework |
| De Morgan 结构 | De Morgan Structure |
| 路径合成 | Path Composition |
| 同伦阶 | h-levels |
| 群胚 | Groupoid |
| 弱首头范式 | Weak Head Normal Form (WHNF) |
| 规化 / 化简策略 | Normalization / Reduction Strategy |
| 反射 / 反射证明 | Reflection / Reflection-based Proofs |
| 重写规则 | REWRITE rules |
| 元编程 | Metaprogramming |
| 策略 / 策略引擎 | Tactic / Tactic Engine |
| 展开算子 | Elaborator |
| 小步运算语义 | Small-step Operational Semantics |
| 单调性 / 非单调性 | Monotonicity / Non-monotonicity |
| 会话类型 / 线性类型 | Session Types / Linear Types |
| 操作子 / 多项式函子 | Operads / Polynomial Functors |
| 半单纯类型 | Semi-simplicial Types |
| 同类型 | Hom-types |
| 组合范畴语法 | Combinatory Categorial Grammar (CCG) |
| 抽象语法树 | Abstract Syntax Tree (AST) |
| 未指定依赖类型论 | Underspecified Dependent Type Theory (UDTT) |
| 依赖类型语义 | Dependent Type Semantics (DTS) |
| 自动形式化 / 自动形式化鸿沟 | Autoformalization / Autoformalization Gap |
| 神经符号推理 | Neuro-Symbolic Reasoning |
| 神经引导定理证明 | Neural Theorem Proving |
| 混合树搜索 | HyperTree Proof Search (HTPS) |
| 蒙特卡洛树搜索 | Monte Carlo Tree Search (MCTS) |
| 可微逻辑编程 | Differentiable Logic Programming |
| 逻辑张量网络 | Logic Tensor Networks (LTN) |
| 软符号 | Soft Symbols |
| 双曲蕴涵锥 / 超锥体 | Hyperbolic Entailment Cones / Hypercone |
| 测地线夹角 | Geodesic Angle |
| 动态公理 / 软公理注入 | Dynamic Axioms / Soft Axiom Injection |
| 概率测度类型 | Probabilistic Measure Type |
| 知行逻辑 | KOS-TL (Knowledge Operation System Type Logic) |
| 非单调演化依赖类型逻辑 | NM-DEKL3∞ |
| 静态真理层 / 动态变迁层 / 物理执行层 | L0 Core / L1 Kernel / L2 Runtime |
| 使非法状态不可表达 | Make Illegal States Unrepresentable |
| 对抗性提示词攻击 | Jailbreak / Prompt Injection |
| 类型幻觉 | Type Hallucination |
| 内核通过率 | Kernel Pass@k |
| 无公理来源率 | No-Axiomatic-Sourcing Rate |
| 类型依赖深度指数 | Type Dependency Depth Index (TDDI) |
| 证明助理 / 交互式定理证明器 | Proof Assistant / Interactive Theorem Prover (ITP) |
| 符号求解器 / SMT 求解器 | Symbolic Solver / SMT Solver |
| 满足性模理论 | Satisfiability Modulo Theories (SMT) |
| 中国剩余定理 | Chinese Remainder Theorem (CRT) |
| 最小公倍数 | Least Common Multiple (LCM) |
| 陈数 | Chern Number |
| 纤维束 | Fiber Bundles |
| 离散环面 | Discrete Torus |
| 极向 / 环向 | Poloidal / Toroidal |
| 驻波点 | Standing-wave points |
| 三进制 | Ternary |
| 特征3坍缩 | Characteristic-3 collapse |
| 离散雅可比 | Discrete Jacobian |
| 鸽巢原理 | Pigeonhole Principle |
| 反例构造 | Counterexample Construction |
| 穷举验证 | Exhaustive Verification |
| 良基定义 | Well-founded Definition |
| 自托管 | Self-hosted |
| 外部对象 | External Class |
| 零拷贝 | Zero-copy |
| 异构语法图 | Heterogeneous Abstract Syntax Graph (HASG) |
| 图 Transformer / 图神经网络 | Graph Transformer / Graph Neural Network (GNN) |
| 结构等价 | Structural Equivalence |
| 范畴 / 函子 / 自然变换 / 拓扑斯 | Category / Functor / Natural Transformation / Topos |
| Sheaf 逻辑 | Sheaf Logic |
| 商空间 | Quotient Space |

---

## 附注：矛盾、松散与推测性主张（供 prompt 撰写时规避）

1. **Agda 自动化定位冲突**：[报告] 称 Agda"缺乏高级自动化 Tactics Engine"、"大规模自动证明搜索…在 Agda 上的实现难度较高"；[triq] 却以 430+ 文件 Agda 库 + 347 个反射证明作为 DTT-Bench Level 3 样板。二者不构成严格矛盾（reflection 与 tactic 不同层），但结论方向相反，引用时须限定语境。
2. **源文件计数不一致**：[triq] "430+ 个 Agda 源文件" vs 工作区 AGENTS.md "512 个 .agda 文件"；文档未给出核对方法。属项目自报数据，未经独立验证。
3. **引用可核验性差**：[报告] 的文献含占位符 "[cite: N]"；"Chen, P. (2026). KOS-TL … arXiv:2601.01143 / arXiv:2603.01366" 为未来年份且 arXiv 编号不可核验；"Kobayashi, H., Daido, H., & Bekki, D. (2026/2021)" 年份自相矛盾。**不得作为已确立学术事实引用。**
4. **术语混用**：[前沿] "绝不破坏类型系统的逻辑完备性与 Soundness" 把 completeness 与 soundness 并置；[triq] "封闭完备性" 非标准术语；[报告] "均一相等类型""内延相等" 非常规译名。引用时建议替换为标准术语并加注。
5. **非单调演化与类型论一致性冲突**：[报告] 长期方向主张"允许类型系统在接受外部环境信号时动态更新其公理体系"，但同一文档挑战二明确承认这会与"不破坏类型检查器全局一致性（Consistency）"冲突。属内部张力，非已解决设计。
6. **概率依赖类型语义自相矛盾**：[前沿] 给出测度空间类型与 $\sum_{x:A}B(x)$ 边缘化公式，属 🟡/🟠；而 [报告] 挑战三声明"如何建立能够将连续张量表征无损、可微地映射为高阶依赖类型证明项的理论桥梁，目前尚无统一的解法"。**同一文档集既提出方案又宣告未解**，引用须标注推测性。
7. **原生可微立方类型论、KOS-TL 完整编译器、引理自动发明**：文档自评 🟠 假说/前沿探索，收敛性/逻辑完备性未定论。
8. **穷举 vs 构造**：文档倡导构造主义，同时接受 59,049 穷举、高斯消元判定、Python/Rust 仿真反哺。属工程双轨制，不应表述为"纯构造性证明"。
9. **"群为基本原理"未被文档支持**：六文档无群作用、群表示、表示论、∞-groupoid、一般商类型的类型论表述；仅有的群相关材料见 §2.1。若 system prompt 需要"群"作为基本原理，必须另行补充来源，不能声称出自这六份文档。
10. **十二律 / 仲吕 / SOVEREIGN_LCM / A₄ / 幻方 / 五行 / 纳音 / POLAR=144 / TORUS=46**：六文档零出现（见工作区 AGENTS.md）。文档中与数字相关的仅 $144\times46=6624$、46 个驻波点、$3^{11}\times2^{16}=11609505792$、59,049、4320D、$C=\pm2$、12 阶交换群 DC=C₃×C₄。
11. **Isabelle 未被提及**：文档对比的证明助理只有 Agda / Coq / Lean 4（另有 Arend、Cubical Agda）。不得把 Isabelle 归入本文档依据。
