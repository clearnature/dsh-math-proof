---
name: type-theory-presentation
description: 类型论展示群（生成结构）— 律算框架的第一原理。八要素定义（载体/生成元/关系/相位/时钟/归零/刚性/核对）、生成结构 vs 投影对象、信息截断禁令、相位不可约性元公理、术语红线、代码与文档索引。 不触发（Do NOT trigger for）: 单条引理的编译报错（用 agda-proof-engine）、投影层的 Group 实例化细节（用 group-first-proof）。
whenToUse: 任何涉及群、代数结构、DC、Z/12、C₁₂、R₁₂、GF(3)/GF(9)、相位、归零、展示群、CRT、orbit-stabilizer 的表述、证明或文档任务；动手前先加载。
---

# type-theory-presentation：类型论展示群（律算框架第一原理）

**权威定义**：`docs/duodecimal/11-type-theory-presentation.md`、`docs/duodecimal/12-rigorous-type-theory.md`、
`docs/duodecimal/20-dc-type-theory-positioning.md`。
**配套**：术语红线 `08-terminology.md`、本体论 `01-ontology.md`、零冥族 `04-zero-oblivion.md`、
相位不可约性 `memory/crt-wave-physics-not-modular-arithmetic.md`、缺口扫描 `21-quantum-module-topology-scan.md`。

> 行号以**当前源码**为准（文档中的行号可能过时，例如 docs 写 `DuodecClock.agda:206`，实际 `DuodecPoint` 在 `:210`）。引用前先 grep 核对。

## 0. 一句话

> **律算框架的群论是类型论展示群，不是集合论群。**

**结构 = 生成方式**：一个结构是什么，由它**怎么生成**决定（生成元 + 规则 + 来源 + 归零），
**不由"元素个数 / 形状 / 同构于什么"决定**。问「它等于 / 同构于 / 像什么群」是**投影视角**，不触及本源。

## 1. 定义：展示群八要素

| # | 要素 | 类型论形态 | DC 实例 | 代码锚点 |
| --- | --- | --- | --- | --- |
| 1 | **载体** | `record` / Σ-类型（乘积类型，非 `data`） | `DuodecPoint = Trit × AlphaPower` | `GroupTheory/DuodecClock.agda:210` |
| 2 | **生成元** | `data`（带代数来源标记） | `Trit`（GF(3) 加法）、`AlphaPower`（GF(9)⟨α⟩ 乘法） | `Base/Trit.agda:27`、`DuodecClock.agda:80` |
| 3 | **关系** | `record` 字段（**不是 HIT 构造子**） | `δ³=id`、`φ⁴=id`、`δφ=φδ`；`ZeroOblivion` 五字段 | `GroupTheory/DayanCore.agda:46`、`DCGroup.agda:120` |
| 4 | **相位** | 每元素**不可约**携带的 C₄ 位置 | `a0/a1/a2/a3` = 0°/90°/180°/270° | `DuodecClock.agda:80` |
| 5 | **时钟** | 迭代**过程**（非静态阶） | `mixedOp^12 p ≡ p` = 走钟一圈 | `DuodecClock.agda` `mixedOp-12-cycle` |
| 6 | **归零** | 周期闭合机制（四归零） | `⊕³` / `α⁴` / `mixedOp¹²` / 仲吕 12 | `DCGroup.agda:133` `dcZeroOblivion`（record 在 :120） |
| 7 | **刚性** | 自同构定义（Frobenius 诱导） | `σ_DC(t, αᵏ) = (t, α⁻ᵏ)` | `DCGroup.agda:100`、`GF9.agda:95` |
| 8 | **核对** | `refl` 仅确认定义自洽，**不产生结构** | 12 / 144 case `refl`（64 由代数链，非穷举） | — |

**最小公理基座（表现级 record）**：

```agda
record DayanCore : Set₁ where
  field
    Carrier : Set
    δ       : Carrier → Carrier   -- 加法生成元（⊕ 平移，特征 3）
    φ       : Carrier → Carrier   -- 乘法生成元（α，阶 4）
    δ³      : ∀ c → δ (δ (δ c)) ≡ c
    φ⁴      : ∀ c → φ (φ (φ (φ c))) ≡ c
    δφ-comm : ∀ c → δ (φ c) ≡ φ (δ c)
```

`DayanCore = ⟨δ, φ | δ³ = id, φ⁴ = id, δφ = φδ⟩`；
主定理 `dayan-joint-order-12 : ∀ c → iterate (δ ∘ φ) 12 c ≡ c`
（`iter-decompose` + `iter-δ-12` + `iter-φ-12`）。**12 = lcm(3,4) 是推论，不是定义**。

## 2. 生成结构 vs 投影对象

| 问题 | 投影视角（错） | 生成视角（对） |
| --- | --- | --- |
| 它是什么？ | 几个元素 / 形状 / 同构于谁 | 怎么生成（来源 + 生成元 + 规则 + 归零） |
| 12 从哪来？ | "群的阶是 12" | 两个独立节拍器（周期 3 与周期 4）同时归零的最小公共步数 |
| 身份由什么定？ | 元素个数 / 同构类 | 生成方式 |

> 「若问'它同构于什么/是几个元素/形状像什么'，就是丢弃生成方式、只看外壳——那是派生视角。
> 本源理论不从外壳出发。」（`20-dc-type-theory-positioning.md`）

## 3. 信息截断：集合论群丢了什么

| 丢失的信息 | 集合论群 | 类型论展示群 |
| --- | --- | --- |
| 生成元来源 | 丢失 | `Trit`（GF(3) 加法）+ `AlphaPower`（⟨α⟩ 乘法） |
| 关系体系 | 丢失 | `ZeroOblivion` 五字段（δ³/α⁴/联合/损益/单位） |
| 运算联合性 | 丢失 | `mixedOp` 的分量规则（一分量加法、一分量乘法） |
| Frobenius 刚性 | 丢失 | `galoisConjugate`（定义在 GF9，诱导到 DC） |
| 联合生成元 | 丢失 | `g = (T₁, a₁)` 显式构造 |
| 周期 12 | 只是"群阶" | `lcm(3,4)` 的**定理** |
| **相位状态** | 丢失（12 个无相位点） | 每元素携带 C₄ 位置（0°/90°/180°/270°） |
| **时钟读数** | 丢失（只剩群阶 12） | `mixedOp^12` = 走钟一圈的逐步演化 |
| **归零机制** | 丢失（只剩 `g¹²=e` 一条） | 四归零 = 周期闭合机制 |

> **反对信息截断**：把展示群降格为"12 元素 + 运算表"就是截断。
> 11/12 文档 2026-09-08 补正明确：相位与时钟**不是静态标签**，是核心维度；
> 早前把它们降格为标签「构成信息截断」。

**有损投影的判据**：`toDuodec : DuodecPoint → Duodec` 把 `Trit × AlphaPower` 压成 `Fin 12`，
丢弃特征 3 来源、⟨α⟩ 乘法结构、Frobenius 刚性、相位状态、时钟过程、归零机制。
**残骸呈 C₁₂ 形状恰是截断的证据**——它证明 DC 被剥掉本质后与裸循环群无法区分，**而非** DC 本质上就是 C₁₂。
投影方向 = 信息丢失方向。

## 4. 相位不可约性元公理

> **关联运算必须同时承载幅度（GF(3) 加法）与相位（C₄ 乘法）。**
> 任何将相位层约化为 {±1} 的商映射（C₄ → C₂ 非忠实，核为 {1, α, −α}）均**不构成合法的类型论同余**；
> 所导致的"信息丢失"是**结构性语义错配**，而非算法性的精度损失。

- 纤维丛结构：`DuodecPoint = (幅度 ∈ GF(3)) × (相位 ∈ ⟨α⟩ ≅ C₄)`——以 GF(3) 为底、C₄ 为纤维。
- 工程推论：
  1. `chern2Proof = refl`（让编译器暴力求值 144 格点×4 边证陈数=2）= **算术冒充证明**，弃。
  2. `AlphaElectricApprox = refl` 同类——数值边界断言不是证明。
  3. GF(3)-only 作为展示群基座是**结构不完备的**，扩展口在 DC/GF9 层。
  4. ~~`QuantumCorrespondence` 用 `Duodec+1` 当相位~~ **已修复（2026-09-09 核验）**：该模块现已 import `AlphaPower`/`mulAlpha`（`:27`）。

## 5. 术语红线（`08-terminology.md §7`）

| 非法（投影误当本源） | 合法 |
| --- | --- |
| Z/12Z 是涡旋代数本体 | DC（`Z/3 ⊕ ⟨α⟩`）是十二进制代数核；Z/12 加法是其群投影 |
| 十二进制 = 模 12 环 | 十二进制时钟 = 3 加 × 4 乘；模 12 环是另赋乘法的投影 |
| GF(3) 只是 Z/12 的阴影 | GF(3) 与 ⟨α⟩ **共同生成** DC；π₃ 是 DC/C₁₂ 落到 GF(3) 的投影 |
| 四象 V₄ = α 的 4 阶 | V₄ 是 R₁₂ 单位群；α 给的是 **C₄** |
| 代数极 = z12 | 代数极 = DC 核 + 到 C₁₂/R₁₂ 的投影与判定 |
| DuodecClock 有零因子 | DC **没有**零因子；R₁₂ 有（2×6=0, 3×4=0） |
| 零因子是本源概念 | 零因子是 R₁₂ 环乘法的投影产物 |
| 12 进制 = 以 12 为底的位值制 | 十二进制 = Trit ⊕ ⟨α⟩ 联合时钟；位值制是 Doz（记数法层） |

**禁止**再写笼统的「基于 Z12 的代数极」——必须写成 **DC / C₁₂ / R₁₂ / Doz** 之一。

### 5.1 五层对照：DC / DuodecClock / C₁₂ / R₁₂ / Doz

| 层 | 名称 | 载体 / 运算 | 与 DC 的关系 | 关键事实 |
| --- | --- | --- | --- | --- |
| **本源** | **DC**（展示群） | `DuodecPoint = Trit × AlphaPower`（3×4=12）；生成元 δ=`_⊕_`、φ=`mulAlpha`；运算 **`mixedOp`** | — | 相位不可约；**无零因子** |
| **本源（过程）** | **DuodecClock** | 同上；`mixedOp^12 p ≡ p`（走钟一圈）；模块 `GroupTheory/DuodecClock.agda` | DC 的**时钟过程 / 模块实现**（同侧，不是投影） | **无零因子**；`duodec-e` / `duodec-inv` |
| **投影（加法群）** | **C₁₂** | `Duodec = {d0..d11}`，`_+12_` | 加法**群投影**（与 DC 群同构，但**有损**） | 相位被投影掉；`π3` / `π4` / `crt12` |
| **投影（环）** | **R₁₂** | `(Duodec, _+12_, _*12_)` | **另赋乘法**的环投影 | **有零因子** `2×6≡0`、`3×4≡0`；**不是域**；单位群 `{1,5,7,11} ≅ V₄` |
| **记数法** | **Doz** | 以 12 为底的位值制 | **不是代数结构，也不是序概念** | 只是写法；与「联合时钟」无关；**DC 是 12 元素代数核，不是无穷的 Doz 数系**（`DCCharacter.agda:1133`） |

**为什么 DC 无零因子而 R₁₂ 有**：DC 的乘法是 `mixedOp`（Trit 加法 × AlphaPower 乘法，无零因子）；
R₁₂ 的乘法是 `_*12_`（模 12 整数乘法）——**两个不同的运算施加在同一批 12 个标签上**。
`2×6≡0`、`3×4≡0` 是 `_*12_` 的产物（`Duodecimal.agda:382-390` 已证），不是 DC 的性质。

**DC 与 DuodecClock 的关系**：DC 是**展示群结构**（生成元 + 关系）；DuodecClock 是它在库里的
**时钟过程实现**（`mixedOp` 迭代 + `mixedOp-12-cycle`）。二者都在本源侧、都无零因子；
`Duodec` 只是两者共用的**12 个标签类型**，C₁₂/R₁₂ 才是加在标签上的投影运算。

### 5.2 Doz 是记数法，**不是序概念**

| 问 | 答 |
| --- | --- |
| Doz 是连续统的序吗？ | **不是。** Doz 是**表示层**（位值制 = 数字字母表 + 位置权重 + 进位规则），它描述「怎么书写」，不提供「序」。 |
| 那它的序从哪来？ | 来自**被表示的对象**。用 Doz 写 ℕ，继承的是 ℕ 的**离散良序**（每个数唯一后继，无稠密性）；用 Doz 写实数（`0.a₁a₂…`）只是书写 ℝ 的记数法，序属于 ℝ，不属于记数法。 |
| 连续统的序是什么？ | **稠密 + Dedekind 完备 + 无后继函数 + 不可数**——这是 ℝ 的性质，在本框架里是**被诊断的对象**（挂谷病态、连续统 NS），不是基座。 |
| 本框架有哪些「序」？ | ① 循环序：C₃/C₄ 相位（0°/90°/180°/270°）与时钟迭代（`mixedOp^12`）；② 离散序：ℕ/ℤ 的良序（FLT 需要的 Archimedes 序——**有限离散基座里没有**，这是 L7 不可证的原因）；③ 连续统序：只在被诊断对象中出现。 |
| 容易混的一点 | 位值制里「低位→高位」的**书写排列**不是数学上的序关系（order relation）；别把排版顺序当成序结构。 |

**库内立场**：`DCCharacter.agda:1133` 明确「DC = DuodecPoint（12 元素代数核），**不是无穷的 Doz 数系**」——
把 Doz 当成无穷数系（更别说连续统）就已经越出本源。

## 6. 归零四相（`04-zero-oblivion.md`）

零不是「空」，是**多维相位同时回到单位元**的状态：

1. **加法归零** `⊕³ = id`（损益消灭：`T₁ ⊕ T₂ = T₀`）
2. **相位归零** `α⁴ = a₀`（旋转闭环：90°×4 = 360°）
3. **联合归零** `mixedOp¹² = id`（双周期同步 = 十二 = 走钟一圈回 `d0`）
4. **和乐归零**（仲吕闭合：极向 144 步与环向 46 步同时归零）

时钟（走的过程）与归零（回到单位元的闭合）是**配对维度**：没有归零，时钟走不回原点，周期 12 无从成立。

## 7. `refl` 的定位（`12-rigorous-type-theory.md §2.4`）

`refl` 是**定义性相等的确认**，不是数学内容的构造：

- 是标量/序：只在"两词项定义性相同"这条线上核对，无方向、无层次；
- **不产生结构**：相位（C₄ 旋转）、共轭性、Frobenius 自同构、归零闭合**全部由类型与定义承载**
  （`data AlphaPower`、`mulAlpha`、`galoisConjugate`、`sigmaDC`、`mixedOp` 本身）；
- 与「算术求值冒充证明」是同一类误用——`refl` 是验证，不是构造。

故展示群定义中**不写**「证明 = refl 穷举（构造性程序）」。

## 8. CRT 的本体论（`memory/crt-wave-physics-not-modular-arithmetic.md`）

本框架的 CRT 是**物理波系统**（双振子拍频 + 谐波 + 驻波 + 基频谐振），**不是**代数同余定理：

```
T1 = 65536 = 2¹⁶   振子1（二进制周期）      T2 = 177147 = 3¹¹  振子2（三进制周期）
M = T1·T2 = 11609505792  拍频波长           X₀ = 5148246160    基频
6624 = 144×46  全息闭合 = 谐振相位对齐（不是算术 LCM）
驻波节点 dr=9 (=144) 空间剖分；巡游路径 dr=1 (=46) 时域传播
orbitStabilizer : Orbit x ≃ A4/Stab x（T6.agda:1068；依赖 postulate φ-respects:976）
```

- **代码事实（2026-09-09 核验，与 memory 文件冲突）**：`Orbit x = Σ T6Lattice (λ y → ∥ A4OrbitEquiv x y ∥₂)`（`T6.agda:937-938`）是 **A₄-轨道**（≤12 元），不是 729 格点；且库里**已证** `orbitIso : Iso (Orbit x) (A4/Stab x)`（:1062）、`orbitStabilizer-path : Orbit x ≡ A4/Stab x`（:1065）、`orbitStabilizer : Orbit x ≃ A4/Stab x`（:1068）。
- ⚠ 该等价**不是 postulate-free**：`orbitStabilizer←` 依赖 `φ-respects`（`T6.agda:976-977`）。
- ⚠ **`memory/crt-wave-physics-not-modular-arithmetic.md:52-57` 与代码冲突**（memory 说「不是等式、不是同构、是谱域转换」「Orbit = 729 格点」）——按项目权威层级（Agda 库 > 文档）以代码为准；若保留 memory 口径，需人类裁决。
- 涉及 CRT / orbit-stabilizer / 144 / 46 / 6624 / √3 时，**先问"这是物理波系统中的哪个角色"**，再动手写证明；
  不要默认"这是代数模运算"然后堆 Path 等式。

## 9. 代码与文档索引

**代码**（`src/Sovereign/`）：

| 模块 | 角色 |
| --- | --- |
| `Algebra/GroupTheory/DuodecClock.agda` | **本源定义**（`DuodecPoint`、`AlphaPower`、`mixedOp`、`mixedOp-12-cycle`） |
| `Algebra/GroupTheory/DayanCore.agda` | **表现级公理基座** `DayanCore` + 抽象主定理 |
| `Algebra/GroupTheory/DCGroup.agda` | `Group` 注册、`ZeroOblivion` 实例、`sigmaDC`、`jointGenerator` |
| `Algebra/Duodecimal.agda` | **投影层**（`Duodec`、`+12`、`*12`、`π3`/`π4`/`crt12`） |
| `Algebra/GF9.agda` | 相位域 `GF(9) = GF(3)[α]/(α²+1)`、`galoisConjugate`、`GF9Star` |
| `Base/Trit.agda` | 幅度域 GF(3)（`⊕`/`⊗`/`negate`） |
| `Algebra/GroupTheory/{CyclicGroupStructure,PhaseSubgroup,NormExactSequence,DuodecClockProperties,GaloisTheory}.agda` | 周期/子群/正合列/自同构 |
| `Algebra/Character/DCCharacter.agda`、`Algebra/Spectral/DCCayleyGraph.agda` | 特征标/Parseval、Cayley 图与谱 |
| `Algebra/Dihedral/DihedralD12.agda` | `D₁₂ = DC ⋊ ⟨ρ⟩`（24 阶，库中首个非交换群） |
| `Coupling/ZhonglvPhaseSync.agda` | 和乐归零（仲吕闭合） |

**文档**：`docs/duodecimal/` **全 24 份**（逐份要点见 `duodecimal-corpus` 技能；权威定义 `11`/`12`/`20`，术语红线 `08`，本体论 `01`，零冥族 `04`，代数复数 `09`，范数坍缩 `10`，FLT 裁决 `13`/`15`/`16`，证明状态 `07`，全绿/待核对 `19a`/`19b`）；
`docs/离散代数群宪法.md`（离散 Frobenius-Galois 群宪法）；
`docs/群论红灯审查-离散全息修复.md`；`memory/crt-wave-physics-not-modular-arithmetic.md`。

## 10. 三条跨文档裁决（会直接改变写法）

### 10.1 代数复数（`09-complex-numbers.md`）
- **本体系不用连续统复数 ℂ**；「复数是代数数的连续统投影」。**严禁 `Data.Complex`**（违宪）。
- 5 种「复数」：**GF(9)**（本源，有 Frobenius）/ **Gaussian Z[i]**（范数正定）/ **Eisenstein Z[ω]**（A₄ 特征标）/ **Sqrt3 ℚ(√3)**（范数**不定**，能隙 Δ=√3）/ **Sqrt2 ℚ(√2)**（素因子基底）。
- 能隙 √3 写 `Sqrt3` 代数数，不写「无理数」。⚠ 库内矛盾：`Base/Invariants.agda:41-47` 注释 Δ=√3，定点值 56632/65536 ≈ √3/2 ≠ √3，引用前核对。

### 10.2 范数坍缩（`10-norm-collapse.md`）
- `N : GF(9)× → GF(3)×` 的**核 = ⟨α⟩ ≅ C₄**：四个相位元全坍缩到 1，**相位乘法信息 4→1 丢失**。
- 精确边界：**不否定**整数 `3²+4²=5²`；「勾股不成立」只指范数坍缩对**相位乘法结构**的投影丢失。
- `norm-collapse-identity : embed-gf3 (galoisNorm x) ≡ x *gf9 galoisConjugate x`（范数 = 共轭对合并）。

### 10.3 FLT 边界（`13-flt-analysis.md` + `15` + `16`）
- **FLT 不是本框架的定理**：无解性依赖 ℤ 的 **Archimedes 序**（单调、夹逼、无穷递降），有限域中不存在。本框架只形式化「**幂的律**」。
- 已证核心 **T8**：偶次 `aⁿ+bⁿ=cⁿ ⟹ 3|abc`（`FermatL4_NatLift.flt-even-nat-zero-channel`，经环同态 `red₃ : ℕ → Trit` 在 **ℕ 层**证明；`docs/duodecimal/15` 以 ℤ 叙述，Agda 陈述是 ℕ）。
- **明确未证明**：完整 FLT；偶次无整除假设的完全无解；「进制改变可证性」。
- **DC12 论文 L5 位数分离是假命题**（反例 a=b=9, c=10, n=3）；**L7 不可证**。原则：**不为凑编号制造假证明**。
- 本链闸门：`./engineering/check_fermat_chain.sh`；群论闸门 `./engineering/check_group_chain.sh`。

## 11. 工程红线（`19a`/`19b`）

- **编译加堆限制作安全网**，但上限按机器标定：本机实测 `-M6G` 误杀（DuodecClock/DCGroup/DayanCore/Kakeya* 3s 内 Heap exhausted），`-M8G` 起通过。判「展开 bug」看**同模块基线 RSS**（无限制跑一次），不是撞上限即 bug。
- **编译通过 ≠ 物理正确**；待核对项不得当作已证。修复原则：不删改物理定义；真命题可证，假命题裁剪。
- **`refl` 不是构造**：暴力求值/算术冒充证明一律弃（`chern2Proof = refl` 类）。

## 12. 已知缺口（`21-quantum-module-topology-scan.md`）

- 量子类 11 模块多数已用 GF9 共轭；`QuantumCorrespondence` 已挂 `mulAlpha`（2026-09-09 核验），其余**未显式挂 DuodecClock 本源**。
- `Quantum/Entanglement` 仍是纯 GF3（`⊗`-语义错配源头）。
- ~~`QuantumCorrespondence` 相位停在投影层~~ **已修复**（`:27` import `mulAlpha`）。
- **对齐原则**：纠缠 = GF9 Frobenius 共轭对 `(α, σα)`；相位 = GF9⟨α⟩ `mulAlpha`；叠加 = GF3 `⊕`。

## 13. 工作纪律

1. **先读 docs 再动手**：任何群/代数表述任务，先读 `11`/`12`/`20` + `08` + `01` + `04` + `09` + `10` + memory 文件，再写代码或文档。全 24 份的定位见 `duodecimal-corpus` 技能。
2. 写 `Z12 / C₁₂ / R₁₂ / Doz` 必须明确它是**投影**，且**不得**作为本源。
3. 相位与时钟是核心维度，**不得**降格为静态标签（信息截断）。
4. 集合论群 / `Group` 实例是**投影层工具**（用于与 Agda 生态对接），不能替代展示群定义。
5. 声称「同构」前先问：这是**同构**还是**有损投影**？
6. 每个断言都要能指到代码或文档锚点；没有锚点就标为待核。
7. 不越界声称：FLT / 完整商群定理 / 谱定理等超出本基座的内容，按 `15`/`16` 的边界声明处理。

---

## 11. 与 HoTT / Cubical 的关系：同、异、边界

同伦类型论（HoTT）与立方体类型论（Cubical）做的是同一类工作，但**取舍不同**。为避免越界声称，
这里给出本项目实测的边界（数据 2026-09-09，去注释后统计）。

### 11.1 相同

- 都是依赖类型论、构造主义、命题即类型、证明即项。
- 都是依赖类型论、构造主义、命题即类型、证明即项。
- **相等观不同（本框架不认同「相等即结构」）**：HoTT/Cubical 的相等是**路径**（identity type 自带高阶数据）；
  本框架的相等是**判定**——定义相等可归约、命题相等 `_≡_` 是要证的命题，
  而结构由**生成方式**给出（`δ³=id`、`φ⁴=id`、`δφ=φδ` 是 record 字段，即生成元 + 关系），
  `refl` 只确认定义自洽，**不产生结构**。

### 11.2 不同（本框架的取舍）

| 维度 | 本框架（展示群） | HoTT / Cubical |
| --- | --- | --- |
| 相等 | 默认命题相等 `_≡_`（绝大多数模块） | 路径 `PathP`（少数模块开 `--cubical`，只在需要 `∥_∥₂`/`_/_`/`_≃_` 时） |
| 结构的定义 | **有限离散展示**：载体 + 生成元 + 关系 + 相位 + 时钟 + 归零 + 刚性，全是 record 一等字段 | 常用**商 / 集合截断**得到集合（`A4/Stab`、`∥_∥₂`） |
| 实数 | 全库 **0 个** `import Data.Float/Real/Complex`；无理数用代数数 + 定点整数比 | 理论本身不需要 ℝ（见 11.3），但应用层常引入分析 |
| 时钟/过程 | `mixedOp^12 p ≡ p`（走钟一圈是**过程**，不是静态等式） | 通常表述为路径/同伦，过程性需要额外编码 |

### 11.3 边界一：Cubical **不是**「建立在实数上」

- 区间 `𝕀` 是 de Morgan 代数上的**形式对象**，不是实数区间；`--cubical` 是构造性的。
- 本项目 12 个 cubical 模块只用到 `Cubical.Foundations.Prelude`、`HITs.SetQuotients`（`_/_`）、
  `HITs.SetTruncation`（`∥_∥₂`）、`Foundations.Equiv`（`_≃_`）、`WildCat`——**没有引入 ℝ**。
- 所以准确说法是：**它们的相等语义带几何/连续直觉**，而不是「载体是实数」。

### 11.4 边界二：真正的问题是「投影」而不是「载体」

商 / 集合截断把生成方式压成「元素集合」：`A4/Stab`、`∥_∥₂` 得到的是集合，
**相位（C₄ 位置）、时钟（`mixedOp^12`）、刚性（Frobenius）在商之后不可恢复**。
这才是本框架说的「信息截断」的准确含义——不是「用了 ℝ」，而是**把生成结构投影掉**。

推论：若要用 HoTT/Cubical 表达生成结构，应当用 **HIT 的构造子**（生成元 + 关系路径）
而不是事后商；否则同样丢结构。

### 11.5 边界三：我们自己的边界

- 本框架的形式化**仍跑在 Agda 内核上**（Agda 2.9 + Cubical 0.9 库），并未另造类型论。
  「完备定义」指展示群八要素在库内有对应实现，**不是**「公理系统自足」。
- dype 是项目自研的**实验性内核**（不完善），不构成独立基础；裁决永远是 Agda。
- 诚实数据：群论链 8 模块 0 postulate / 0 hole；`Sovereign/` 全库有一批模块含 postulate、个别含 `{!`（精确计数用 `refs-check` 现场取）。

### 11.6 互补而非取代

Cubical 的 `_/_` 恰好用于商结构的良定义（本库用它表达 `A4/Stab`）；
展示群八要素可以看作对 HIT 生成子的一种**工程化清单**（把「哪些结构分量必须显式保留」写死）。

---

## 12. 结构相似 ≠ 结构同一：GF(9) 自同构 vs 复共轭（案例）

> **唯一事实源**：`docs/cross-level/frobenius-vs-conjugation-erratum.md`（2026-08-17 勘误，含旧表述作废记录）。
> 本节是它的压缩版；引用细节请回原文。

### 12.1 表面上它们很像（所以最容易被误当「同一结构」）

| 维度 | 复共轭（ℂ/ℝ） | GF(9) Frobenius σ |
| --- | --- | --- |
| 域自同构？ | **是**（保加、保乘、固定 ℝ） | 是 |
| 出生证明 | `ℝ[x]/(x²+1)` | `GF(3)[x]/(x²+1)` |
| 基矩阵 | `diag(1,−1)` | `diag(1,−1)` |
| 行为 | 翻转手征（反全纯） | 翻转 α 手征（α ↔ −α） |

**行为同构在命名层是保留的**（都翻转手征）——诚实记下来，不否认相似。

### 12.2 深层结构完全不同（精确到两点）

1. **算术强制**：σ(x)=x³ 是**幂映射**，而「幂映射=同态」是 char p 独有的刚性
   （`(x+y)³ = x³+y³`，freshman's dream）；char 0 中任何 `x↦xⁿ (n>1)` 都不可加。
2. **唯一典范**：`Aut(GF(9)/GF(3)) = {id, σ}`，定义即得、0-postulate、可 `refl` 穷举验证；
   而 `Aut(ℂ)` 有 **2^beth 个野自同构**（依赖选择公理，不可构造），
   复共轭的特殊地位是**由 ℂ 之外的解析/序结构外借**挑出来的。

| 维度 | 复共轭 | σ |
| --- | --- | --- |
| 与幂映射关系 | 不是幂映射（char 0 幂映射不可加） | **就是幂映射** |
| 自同构群 | 2^beth（野、依赖 AC） | **{id, σ}**（唯一、典范） |
| 验证方式 | 不可穷举 | 0-postulate，`refl` 穷举 |

**库内证据**（全部 0 postulate）：`galoisConjugate-add`（GF9.agda L789）、`galoisConjugate-mul`（L794）、
`frobenius-automorphism`（L809）、`frobenius-cube`（§15）、`galoisConjugate²`/`galoisFixedPoint`（L81/L214）、
可分性见证（§16：`alpha-distinct-neg-alpha`、`formal-derivative-at-alpha-nonzero`）。

### 12.3 两条红线

- **不得用「同构于 ℂ / 类似复数」的类比替代展示群定义**——结构相似不是结构同一；
  用类比替换生成方式，就是**信息截断的另一种形态**。
- **数值计算不得替代构造性证明**：σ 的性质靠 0-postulate 的构造性证明（`refl` 穷举）确立，
  不靠浮点近似或复数库「算出来像」；Python/数值只作**反例搜索与约束**，裁决永远是 Agda。

### 12.4 从 trit 长出来的结构

本框架的结构是**自下而上构造**的：`Trit`（GF(3)）→ `GF(9)`（二次扩张，α²=−1）→ `DC`（δ/φ 联合生成）
→ `T⁶`（(Z/3)⁶）……每一步都由上一步的**生成元 + 关系**定义。
不是「先给一个集合，再附加运算」；所以**换一个同构载体不改变结构，但换掉生成方式就换掉了结构**。

---

## 13. 信息完整对象层：AI 原生数学本体（待建，已落字段与门禁）

### 13.1 问题的性质：不是「工程重复」，是「信息压缩」

传统形式化把具体对象压成抽象接口：

```
S₃ 置换群 / A₄ 旋转群 / GL(2,F) / 群作用
        |  压缩（投影）
        v
(Group G)  =  载体 + 运算 + 公理        ← 最小公理接口
```

丢掉的是：**它从哪来、为什么运算是这个运算、和谁等价、作用在什么上、有哪些生成结构、如何嵌入别的结构**。
所以「三套 Group record 没有桥」暴露的不是重复劳动，而是**信息压缩**：抽象 `Group` 已经不知道对象是怎么生成的，
于是 Burnside/Lagrange 这类定理必须由人补齐 action / finite / decidable 等假设——**假设就是信息损失的补偿**。

### 13.2 依赖类型论的优势：类型携带上下文

- 传统：`A4 : Group` → 机器只知道「满足群公理的某个东西」。
- 依赖类型：把对象写成 **Σ-类型 / record 的完整字段**，类型本身携带
  「元素是什么 / 运算怎么生成 / 为什么满足群 / 如何作用 / 与哪些对象关联」。
- **对 AI 的意义**：模型不必重新猜「这是不是置换群」——类型里已经写着。这正是「让代码保留数学的信息」。

### 13.3 对象 = 知识网络节点

```
Object = {
  identity        身份（它是什么）
  construction    生成方式（载体 + 生成元 + 关系）★ 不可省
  operations      运算
  relations       与其他对象的关系（表示 / 作用 / 不变量 / 嵌入）★ 不可省
  representations 表示 / 投影
  transformations 自同构 / 作用
  invariants      不变量
  proofs          定律证明项
}
```

展示群八要素 ↔ 对象字段的映射：

| 八要素 | 对象字段 |
| --- | --- |
| 载体 / 生成元 / 关系 | `construction` |
| 相位 / 时钟 / 归零 | `construction` + `operations`（过程性） |
| 刚性（Frobenius） | `transformations` |
| 核对（`refl`） | `proofs` |

### 13.4 落地：字段 + 门禁 + 度量（本轮已实现）

| 件 | 内容 |
| --- | --- |
| `proof_dag` 节点字段 | `kind: object \| lemma \| theorem \| bridge`、`construction`、`relations` |
| 门禁 | `kind:"object"` **必须给 `construction`**（不允许「只有公理的对象」）；`update` 不能把它清空 |
| 度量 | `check`/`brief` 报 **对象信息完整度** `N/M（构造 x｜关系 y）`，并点名缺构造 / 缺关系的节点 |
| 种类统计 | `check` 报 `object N / lemma M / theorem K / bridge J` |

**注意**：这层现在只有**字段与门禁**，对象层本身尚未建成——库里现有对象（GF9/DC/T⁶/A₄）还没有逐一登记
`construction`/`relations`。这是下一阶段的工程。

### 13.5 评价指标（AI 原生数学，而非传统库工程）

| 指标 | 问题 | 我们的现状 |
| --- | --- | --- |
| 信息损失 | 一个对象丢了多少生成信息？ | 有 `construction` 字段与门禁，尚未全面登记 |
| 结构恢复 | 能否从类型自动恢复生成方式？ | 未做（需把八要素写成类型） |
| 关系生成 | 能否自动推导「谁作用在谁上」？ | 未做（`relations` 目前是人工登记） |
| 证明迁移 | 换表示/投影后证明能否迁移？ | 未做（`needs_review` 级联只是失效，不是迁移） |
| 对象组合 | 组合两个对象是否自然？ | 未做 |

**与 Mathlib 模式的差别**：Mathlib 是 `Definition / Lemma / Theorem` 的百科全书；
本方向更像 `Object（含语义与生成）+ 关系 + 生成规则 + AI Reasoner`。
两者不冲突——**先有对象层，才谈得上让 AI 在对象之间发现新关系**。

### 13.6 对象字段映射与缺口（对照 `MathematicalObject` 提案）

| 提案字段 | 我们现在的载体 | 状态 |
| --- | --- | --- |
| `identity` | 节点 `id` | ✅ |
| `construction` | 节点 `construction`（**object 必填**） | ✅ |
| `carrier` / `operations` | 暂写在 `construction` 文本里 | ⚠ 未字段化 |
| `relations` | 节点 `relations`（分桶，见下） | ✅ |
| `representations` | `relations.represents:*` | ✅ 标签 |
| `actions` | `relations.acts_on:*` | ✅ 标签 |
| `invariants` | `relations.invariant:*` | ✅ 标签 |
| `embeddings` | `relations.embeds:*` | ✅ 标签 |
| `proofs` | `evidence` + `proof_compile` 回执（工具签发） | ✅ |

**诚实边界**：载体与运算还没有独立字段（现在只能写在 `construction` 里）；
`representations` / `actions` / `invariants` / `embeds` 目前是**关系标签**而非结构化子对象；
A4 等既有对象尚未逐一登记。

### 13.7 AI 接口：知识图谱导出（`proof_dag action:"graph"`）

```
$ proof_dag action="graph"
- 文件: ~/.dsh/state/math-proof/graph-<hash>.json
- 对象: N（缺构造 x｜缺关系 y）
- 命题: M（lemma / theorem / bridge）
- 边: E（依赖 D｜关系 R）
- 未验证证据 / 悬空依赖 / 未归类关系  → 逐项列出
```

导出的 JSON（`schema: "math-proof/knowledge-graph@1"`）结构：

```json
{
  "ontology": { "objectFields": [...], "relationKinds": [...], "nodeKinds": [...] },
  "objects": [{ "id","kind","statement","construction","relations":{ "acts_on":[], "represents":[],
                "invariant":[], "embeds":[], "quotient_of":[], "extends":[], "isomorphic_to":[], "other":[] },
                "deps":[], "source":null, "evidence":"verified-receipt|unverified|null" }],
  "claims":  [...],
  "edges":   [{ "from","to","kind" }],
  "gaps":    { "objectsMissingConstruction":[], "objectsMissingRelations":[],
               "unverifiedEvidence":[], "danglingDeps":[] }
}
```

**双读法（同一份事实）**：`graph-<hash>.json` 给机器（带 `$schema` 指向
`schema/knowledge-graph.schema.json`），`graph-<hash>.md` 给人（对象表 + 命题表 + 缺口节）。

**引用完整性**：关系目标分两类——已登记的（进 `relationIndex`，按目标可反查「谁作用在它上」）
与**未登记的库外概念**（进 `gaps.unregisteredRelations`，报告里点名）。
**不静默通过**：知识图谱不允许指向幽灵节点而无人发现。


**下一步（未做，属仓库工程）**：把 A4 / GF(9) / DC / T⁶ 等既有对象逐一登记为 `kind:"object"` 节点
（填 `construction` 与关系标签），再把 `carrier`/`operations` 从文本提升为结构化字段。

### 5.3 常见混淆清单（符号冲突与近名异义）

| 易混 | 正确区分 | 出处 |
| --- | --- | --- |
| **DC vs D₁₂** | `D₁₂` 在本库是**二面体群**（`DihedralD12.agda:4` 24 阶、**非交换**）；DC 是 **12 阶交换**联合周期。**同一符号 D₁₂ 在群里另有所指**——本库文档里 `D12` 也指 Doz 位值系统（`06-relationship-graph.md:28`），**勿混** | `DuodecClock.agda:16-18` |
| **DC vs C₃×C₄ 直积 / C₁₂ 循环群** | DC 是**加乘联合周期**（加法步进 Z/3 ⊕ 乘法旋转 ⟨α⟩）；C₁₂ 只是其**加法投影**；写「DC ≅ C₃×C₄ 直积」或「DC = C₁₂」都是投影误当本源 | `DuodecClock.agda:19-20` |
| **A₄ vs Z/12 / 十二进制** | 禁写「A₄ ≅ Z/12」或「A₄ 是十二进制」：A₄ = V₄⋊C₃，**非交换**（12 阶） | `DuodecClock.agda:15` |
| **Trit vs GF3 = Fin 3** | `Trit` 是 `Base/Trit.agda:27` 的 **data 类型**；`GF3 = Fin 3` 是 `T6.agda:63-64` 的**本地别名**——**同构但不是同一类型**，跨模块混用会类型错误 | 两文件 |
| **AlphaPower（C₄）vs GF9Star（C₈）** | `⟨α⟩` 是 GF(9)\* 的 **4 阶子群**（`AlphaPower`）；`GF9Star` 是 GF(9)\* 的 **8 个非零元素**（≅ C₈）。别把「相位群」当成「乘法群全体」 | `GF9.agda:365` |
| **零冥族 vs 零元** | 零冥族 = **多维相位同时回到单位元** `(T₀, a0)`（`mixedOp^12 = id`）；**不是**环的零元，也不是「什么都没有」 | `DuodecClock.agda:412-415` |
| **Doz vs 十二进制** | Doz 是记数法（表示层）；十二进制（本源）= Trit ⊕ ⟨α⟩ 联合时钟 | `08-terminology.md §7.4` |
| **中文音译** | 「**杜德克时钟**」= DuodecClock（2026-09-08 定稿）；写中文时用它，别写「十二进制群」 | `DuodecClock.agda:18` |

**读法**：遇到「十二进制 / Z/12 / D₁₂ / C₁₂ / R₁₂ / A₄」这类词，先问三件事：
① 说的是**本源**还是**投影**？② 用的是哪个**乘法**（`mixedOp` 还是 `_*12_`）？③ 交换还是非交换？

