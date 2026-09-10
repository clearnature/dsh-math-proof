---
name: compute-then-verify
description: 先算后验证（zcode 提议）— Python 精确整数计算作猜想生成器/约束来源/对抗验证器，Agda 为唯一裁决；含无信息截断检查、构造主义 witness、可复现脚本纪律，以及「本项目用 Agda 而非 Lean」的立场。 不触发（Do NOT trigger for）: 无需计算即可直接构造的证明（不要为「先算」而算）、把 Python 结果当裁决的场景。
whenToUse: 需要先探索规律/找反例/核对大规模枚举时；写 Agda 证明前用 Python 定型陈述，或证明后用 Python 全域交叉验证时加载。
---

# compute-then-verify：先算后验证

## 0. 一句话

**先算**（Python 枚举 / 核对 / 找反例）**→ 后验**（Agda 形式化证明）**→ 再用算**（全域交叉验证）。
Python 产出的是**证据**；Agda 产出的是**证明**。二者不可互换。

## 1. 三角色（Python 永远不是证明）

| 角色 | 做什么 | 不做什么 |
| --- | --- | --- |
| **猜想生成器** | 枚举小规模实例、观察规律 → 形成陈述 | 不把「算到 10⁶ 都对」当定理 |
| **约束来源** | 生成必要条件 / 不变量，指导证明方向 | 不替代构造性证明 |
| **对抗验证器** | 全域穷举找反例；证明后在具体点/全域交叉比对 | 不做最终裁决 |

## 2. 纪律（硬约束）

1. **精确整数**：只用 `int` / `Fraction`；**禁浮点**（宪法）。无理数用定点整数比。
2. **可复现**：脚本 + 输入 + 版本可重跑；输出写成测试或报告作为证据。
3. **无信息截断**：模型必须保留全部结构分量（如 DC 的幅度 `Trit` + 相位 `C₄`）；任何有损投影（`C₄→C₂`、只留幅度）只能作为**被检查的对象**，不得作为输入。
4. **语义对齐**：Python 标签必须与 Agda 构造子语义逐一对齐并显式写出映射。例：Agda 索引语义 `T₀=0, T₁=1, T₂=2, ⊕=(a+b)%3`；项目 Python 层的 `T0=-1/T1=0/T2=+1` 是**另一套标签**，混用即截断。
5. **Agda 是唯一裁决**：Python 通过 ≠ 证明；`proof_compile` exit 0 + 0 postulate/hole 才是。
6. **反例优先**：算出来与猜想不符时，先怀疑猜想（历史先例：DC12 L5 位数分离、`classical-bound` 36 反例）。

## 3. 流程（五步）

1. **算**：写最小 Python 脚本，枚举/穷举，观察规律或找反例。
2. **定型**：把观察写成**一句可判定/可证伪的陈述**；先在 Agda 写签名并 type-check（陈述先行）。
3. **证**：按证明纪律选策略（展示群 / CRT 正交分解 / 代数链 / ≤27 穷举 / 归纳）。
4. **判**：`proof_compile` + `proof_audit` + 具体点对抗验证。
5. **回算**：Python **全域**穷举再跑一遍作为**独立**交叉验证（不是证明），把结果写进 `proof_dag` 的 `evidence`。

## 4. 落点（本项目）

- Python 轨道：`engineering/software/sovereign_core/`（**零外部依赖**；宪法禁浮点，但 `magnetic_civilization.py` 仍有 `float` 残留——属待清理项，见 `wuxing.py:8`）；交叉验证测试放 `engineering/tests/`。
- 运行：仓库根 `python3 -m pytest engineering/tests/`（当前 **43 passed**，含 DC 交叉验证 14 条）。
- **已落实例**：`engineering/tests/test_dc_crosscheck.py`
  - π₄ 同态 **144 对全域穷举**；DC 群公理（assoc/comm/identity/inverse）；`duodec-inv` 对合；联合周期 12；
  - **无信息截断五类检查**：载体是全积、只留幅度非单射、`C₄→C₂` 非单射、相位纤维恰 3、全整数。
- 对应 Agda 定理：`Algebra/Pi4Homomorphism.agda`、`GroupTheory/DCInvolution.agda`、`GroupTheory/DuodecClock.agda`。

## 5. 构造主义与展示群

- **构造主义**：Python 给出的 witness / 构造 → Agda 把它变成**项**；计算不替代证明义务，只产生候选。
- **展示群**：先算后验证同样受展示群定义约束——**结构 = 生成方式**；计算必须保留生成来源（谁来自 GF(3) 加法、谁来自 ⟨α⟩ 乘法），不得把 DC 压成 12 个无结构点。
- **无信息截断**：见 §2.3；有损投影是**检查对象**（`test_c4_to_c2_projection_is_lossy`），不是输入。

## 6. 为什么本项目用 Agda 而不是 Lean（立场）

| 维度 | Agda（本项目） | Lean 4 |
| --- | --- | --- |
| 依赖类型论原生性 | 直接写类型/项，无 tactic 魔法；**证明项即数学对象** | Elab/Tactic 层强大，但证明常经自动化生成 |
| 构造主义 | 默认直觉主义；postulate 可逐条审计 | 标准库/生态接受 `Classical.choice`、`propext`（与本宪法冲突 = 红灯） |
| 规约控制 | `--rewriting` 精确注入 REWRITE；Cubical 原生路径/商 | 强，但重写与归一化控制不如 Agda 细 |
| 审计性 | 0 postulate / 0 hole 可逐模块扫描 + 链闸门 | Mathlib 巨大，公理依赖需 `#print axioms` 追踪 |
| 本项目承载 | 展示群 / 相位 / 时钟 / 归零 / CRT 全部 Agda 化 | 仅作**方法论参考**（Prove2me）与可选交叉轨道 |

**结论**：Lean 4 生态强、工程成熟；但本框架的**构造主义 + 无 Choice + 展示群信息保留**要求，Agda 更契合。Lean 只作参考，不作裁决。

## 7. 常见反模式

- ❌ 用 Python 结果当「证明」（算术冒充证明）。
- ❌ 用浮点/近似做「验证」。
- ❌ 把有损投影（`C₄→C₂`、只留幅度）当模型输入 → 结构性语义错配。
- ❌ 混用两套 `Trit` 标签（Agda 索引 vs Python `-1/0/+1`）。
- ❌ 只在几个点算过就宣称全域成立（要么全域穷举，要么给出证明）。
