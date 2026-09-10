---
name: group-first-proof
description: 投影层群结构工具 — 把展示群投影到 Agda 生态时，如何写成 Group 实例、同态交换图、穷举/代数链证明；含 Sovereign 群实例地图与诚实边界。第一原理见 type-theory-presentation。 不触发（Do NOT trigger for）: 展示群本体论/术语合法性判定（用 type-theory-presentation）、跨天阶段编排（用 long-horizon-discipline）。
whenToUse: 当任务涉及在 Sovereign Agda 库中新增/修复证明、把某个结构注册为 Group/AbelianGroup 实例、或需要选择证明策略（穷举/代数链/CRT 分解）时加载；涉及 DC/相位/时钟/归零/CRT 本体时先加载 type-theory-presentation。
---

# group-first-proof：投影层群结构工具（展示群的对接层）

> ⚠ **先读 `type-theory-presentation` 技能。**
> 律算框架的第一原理是**类型论展示群（生成结构）**，不是集合论群：
> 结构 = 生成方式（载体 + 生成元 + 关系 + 相位 + 时钟 + 归零 + 刚性），
> 见 `docs/duodecimal/{11,12,20}*.md`。本技能只处理**投影层**的问题：
> 当一个展示群需要与 Agda 生态（`Group` record、`Setoid`、Burnside 计数、表示论）对接时，
> 怎样把它写成内核能接受的结构与定律。

本技能的定位因此是**工具层**，不是第一原理：

- **可以**用 `Group` / `AbelianGroup` / `Ring` 实例、`≡-Reasoning`、穷举、CRT 分解去写证明；
- **不可以**用它们替代展示群定义，或把投影（`C₁₂` / `R₁₂` / `Doz`）当成本源（信息截断）；
- 涉及 DC / 相位 / 时钟 / 归零 / CRT 本体时，一律回到 `type-theory-presentation`。

编译机制、六类错误指纹与性能陷阱见 `proof-engineer` 技能。

## 0. 一句话主张（投影层）

把展示群**投影**到 Agda 生态时，先问：**这个投影要在哪一层被使用？**
然后写成依赖类型论里的 `record`：载体是字段，运算是字段，**定律也是字段**。
定理的形态随之固定——要么是结构内部的等式（定律），要么是两个结构之间的交换图（同态）。

> ⚠ 来源声明：`/home/yanli/文档/math/类型论/` 六份文档**没有**把「群」作为基本原理展开（无群作用、
> 群表示、∞-groupoid、一般商类型）。「群为第一原理」是本技能对文档的**综合与补充**，
> 其合法性来自本项目 `src/Sovereign/Algebra/UniversalAlgebra.agda` 已有的结构层级与实例，
> 而不是文档原话。引用时请区分「文档说过的」与「本技能主张的」。

## 1. 类型论底座（来自参考文档，可引用）

| 原则 | 精确表述 | 来源 |
| --- | --- | --- |
| 命题即类型，证明即程序 | "命题即类型，证明即程序。" | 类型论推理的发展史.txt |
| 构造性 | "一个命题为真，必须有一个具体的构造性证明。" | 类型论推理的发展史.txt |
| 相等性是主线 | "在依赖类型论的发展脉络中，理论演进的主线在于如何更自然且高效地处理相等性（Equality）。" | 依赖类型论与符号推理知识体系与神经符号集成研究报告.txt |
| 定义相等 vs 命题相等 | "标准的 MLTT 和 CiC 严格区分定义相等（Definitional Equality, 即基于 β/η-规约的算法可判定相等）与命题相等（Propositional Equality, 即由类型 a =_A b 表示的证明）。" | 同上 |
| 相等即路径 | "相等即路径（Paths），同伦等价可推导类型相等" | 同上 |
| 结构身份 | "结构身份原理（SIP）：同构结构可直接代换" | 同上 |
| 类型幻觉 | "现有的 LLM 容易在生成复杂依赖类型…时产生看似合理却无法通过内核类型检查的'类型幻觉'。" | 同上 |
| 神经提议，符号验证 | "神经提议，符号验证。" | 类型论推理的发展史.txt |

工程推论：

1. **能靠定义相等（β/η 归约）闭合的，不要写成命题相等。** 写成命题相等会引入 `trans` 链与额外引理。
2. **归约卡住时先查定义形式。** `.projᵢ` 停在复合项上 → 被调函数里可能有 `let`（见 `proof-engineer` 附录 10），不要先换证明策略。
3. **结构即签名。** 参考文档里唯一的「定律作为字段」范例是 Lean 的 `structure AgentState ... safety_proof : SecurityInvariant ...`（依赖证明项字段）；Agda 里对应的就是 `record Group` 的定律字段。
4. **使非法状态不可表达。** 若某个「非法配置」在数学上不该存在，优先把它编码成无法构造的索引/字段，而不是写一个运行时检查。

## 2. 群为第一原理：五步范式

1. **找结构。** 先查 `Sovereign.Algebra.UniversalAlgebra` 的结构层级：
   `Semigroup` → `Monoid` → `Group` → `AbelianGroup` → `Ring` → `CommSemiring` → `IsField`。
   已注册实例：`DCGroup` / `DCAbelianGroup`（`GroupTheory/DCGroup.agda`）、
   `gf9-add : AbelianGroup GF9`（`UniversalAlgebra.agda:175`）、`gf729-additive-group`（`GF729.agda:577`）、
   `alpha-group`（`GroupTheory/FiniteGroupAxioms.agda:61`）。
2. **补定律，不补表格。** 能由置换/表示诱导的运算就**不要手写乘法表**。
   范例：`Structology/A4Group.agda` 的 `_⊗_ = fromPerm (perm x ∘ₚ perm y)`，
   结合律由 `perm-hom` + `_∙_` 代数推出，而不是 12×12×12 穷举。
3. **同态 = 交换图。** 写 `hom : ∀ x y → f (x · y) ≡ f x · f y`。
   **本库没有通用 `GroupHom` / `GroupIso` record**（唯一的同构类是同伦等价式 `_≃_`，
   `Structology/PlatonicTorusProjection.agda:69`）。要用就先声明是新增 record 还是写成 Π-类型命题。
4. **作用 = 同态到置换群。** 轨道/稳定子/不动点用有限穷举 + Burnside；
   真正的 Orbit–Stabilizer 等价见 `Structology/T6.agda:1035-1069`（`orbitStabilizer`，集合商）；⚠ 依赖 `postulate φ-respects`（`:976-977`），非 postulate-free。
5. **商 = 等价关系 + 运算良定义。** 现成范式：`QuotientT6A4`、`A4/Stab`。

## 3. Sovereign 群实例地图（符号以源码为准，先 grep 再断言）

> GF(3) 加法/乘法群与 GF(9) 加法群的符号表以 persona §二「投影层群实例地图」为**唯一事实源**，本表不重复（避免双份维护导致漂移）。

| 结构 | 模块 | 关键符号 |
| --- | --- | --- |
| Z/12Z 加法群 C₁₂ + CRT | `Algebra/Duodecimal.agda` | `Duodec` `_+12_` `π3` `π4` `crt12` `crt12-roundtrip` `not-a-field` |
| (Z/12Z)* ≅ V₄ | `Algebra/Duodecimal.agda:302-374` | `DuodecUnit` `_*u_` `inv-u` `u5²` `u7²` `u11²` |
| GF(9)* ≅ C₈（循环） | `Algebra/GF9.agda` | `GF9Star` `_*s_` `gen` `gen-generates-all:539` `galoisNorm` `norm-mul` |
| 12 阶「原生」群 Z/3 ⊕ ⟨α⟩ | `GroupTheory/DuodecClock.agda` | `DuodecPoint` `mixedOp` `duodec-e` `duodec-inv` `mixed-to-+12:299` |
| DC ≅ C₃ × C₄ | `GroupTheory/CyclicGroupStructure.agda` | `dc-period-structure:79` `dc-cyclic-structure:103` |
| 子群链 ⟨−1⟩ ⊂ ⟨α⟩ ⊂ ⟨φ⟩ | `GroupTheory/PhaseSubgroup.agda` | `alpha-order-exactly-4:68` `four-divides-eight:94` |
| Aut(DC) ≅ V₄ / 商 DC/⟨α⟩ | `GroupTheory/DuodecClockProperties.agda` | `aut5-squared:286` … `quot-alpha-kernel:325` |
| 短正合列 1→C₄→C₈→C₂→1（非分裂） | `GroupTheory/NormExactSequence.agda` | `gen-order-8:62` `norm-surjective:126` `nonsplitting:147` |
| Galois 群 ≅ C₂ | `GroupTheory/GaloisTheory.agda` | `sigma-involution:44` `sigma-injective:56` `sigma-equals-cube:60` |
| A₄（**Cubical**） | `Structology/A4Group.agda` | `A4` `perm:79` `_⊗_:210` `perm-hom:227` `assoc:364` `identity:371` `inverse:378` |
| A₄ 正则表示 / 非交换 / Cayley | `Structology/A4GroupAction.agda` | `regular-free:105` `regular-transitive:109` `regular-faithful:125` `non-abelian-witness:185` `no-injective-hom:219` |
| A₄ 表示论 / Burnside Σdim² | `Structology/A4Representations.agda` | `theorem-dimension-sum-of-squares:853` `character-at-identity:218` |
| S₃ ≅ GL(2,2) / SL(2,3) | `Structology/S3IsGL22.agda` `SL23Cayley.agda` | `mul-hom:106` `toMat:63` `orderOf` |
| 柏拉图立体对称群 | `Structology/Platonics.agda` | `PlatonicGroup:326` `tetrahedronGroup` … |
| T⁶ 平移群 / 轨道稳定子 | `Structology/T6.agda` | `orbitIso:1062` `orbitStabilizer:1068` |
| π₁(T⁶) ≅ (Z/3Z)⁶ | `HoTT/T6Homotopy.agda` | 万有覆盖 |
| 4320D G-轨道（⚠ 群公理为 postulate） | `Geometry/ProjectiveCore.agda` | `GElement:61` `g-mul:82` `g-id:66` `g-inv:86` |

结构词汇表本体：`Algebra/UniversalAlgebra.agda` — `Semigroup:43` `Monoid:49` `Group:58`
`AbelianGroup:70` `Ring:75` `CommSemiring:97` `IsField:115`。

## 4. 证明策略优先级（与 `proof-engineer` 一致，遇阻塞按序下移）

1. 结构实例化 + 群为第一原理（本技能）。
2. CRT 正交分解：`Z/12Z ≅ Z/3Z × Z/4Z`，12 项操作 → 3+4 分量（≤5 步），复用 `crt12` / `π3` / `π4` / `crt12-roundtrip`。
3. 代数推导链 `≡-Reasoning`，每步一个具名引理。
4. 穷举：有限且 **≤27 case**，先用单位元/对称性约化。
5. 否定证明 `¬ P` + `λ ()`。
6. `postulate` 防火墙（仅无限论域 / 编译器级限制 / 实验锚定待闭合，必须标注）。

**>27 case 的穷举是暴力计算，不是构造性证明** → 符号化改造（let-free + 半线性/线性基展开，
`Semilinear` / `Linear` + `semilinear-ext3` / `linear-ext3`）。

**未来态锚定**（PR #8611）：锁定目标态（RHS / Delta）做正交分解，不从源端（LHS / Gamma）逐项剥离。

## 5. 诚实边界（不得越界声称）

- `Geometry/ProjectiveCore.agda:130-137` 的 `g-id-left` / `g-id-right` / `g-inv-left` / `g-assoc`
  以及轨道关系 `~g-refl` / `~g-sym` / `~g-trans` **是 postulate** —— 4320D 轨道叙事建立在其上。
- `Structology/T6.agda` 有 **3 个 postulate 块**：`div3k`/`mod3k`（:22-24，REWRITE LHS）、`φ-respects`（:976-977）、`gf3Toℕ-A4-inv`（:1475-1477，REWRITE）。
- **A₄ 不是 `Group` 实例**：定律是独立函数、用 Cubical `_≡_`。混用 PropEq `_≡_` 会 `UnequalTerms`。
- 本库**没有**通用 Lagrange / Sylow / Cayley 定理、也没有通用同构定理（`G/ker ≅ im`）；
  Burnside 多为 ℕ 算术实例，真正的 Orbit–Stabilizer 只有 `T6.agda` 一处。
- GF(9) 未注册 `Monoid` / `IsField` 实例（只有 `gf9-add`）。
- 全库无 `--safe`：健康标准是 **exit 0 + 0 postulate + 0 hole + 0 meta**。
- Cubical 与 PropEq 互操作：`T6.agda` 把 Cubical 的 `_≡_` 重命名为 `_≡ᶜ_` 才能与 PropEq 共存。

## 6. 验证协议

1. 单模块编译：`proof_compile`（自动选可用检查器 + 六类指纹分诊）；手工等价命令为
   `agda --guardedness <Module>.agda`（命令行**不加** `--rewriting`；文件头保留 pragma）。
2. 群论链门禁：`engineering/check_group_chain.sh`（`DuodecClock … DayanCore` 8 模块；exit 2 = postulate/hole 泄漏）。⚠ 在 `workspace-write` 沙箱下会因 stdlib 接口目录只读而 exit=42（权限问题非类型错误）→ 改用 `proof_compile` 逐模块验证。
3. 全库门禁：`engineering/check_all_modules_parallel.sh`。
4. 静态审计：`proof_audit`（本 preset 自带工具）→ postulate/hole/sorry、浮点禁令、fixity、`let`、`trans` 深度、显式导入。
5. **对抗验证**：构造性定理必须在具体点（原点 / 生成元 / 混合点 / 同态 / 结合律）用独立 `refl` 计算交叉比对。
6. 编译失败 → 委托 `loop-engineer`，不要逐错误修复。

## 7. 参考资源

- 本技能自带：`references/type-theory-knowledge-base.md` —— 六份类型论文档的完整蒸馏
  （概念清单、术语对照表、金句、矛盾与推测性主张清单）。
- 本地证明引擎：`agda-proof-engine` 技能（Agda 是唯一裁决；dype 为实验性内核，见其 references）。
- 项目数学依据：`/data/work/docs/wiki/`。
- 原始文档：`/home/yanli/文档/math/类型论/`。
- 编译与错误指纹：`proof-engineer` 技能（`/home/yanli/.agents/skills/proof-engineer/SKILL.md`）。
