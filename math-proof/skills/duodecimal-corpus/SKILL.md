---
name: duodecimal-corpus
description: docs/duodecimal 全 24 份文档的完整索引与逐份要点（本体论/类型定义/代数结构/零冥族/CRT/关系图/证明状态/术语/代数复数/范数坍缩/展示群/严谨定义/FLT 裁决/证明链/立场文件/DC12 裁定/傅里叶/D₁₂/全绿清单/待核对清单/本源定位/量子扫描/README/外部参考）。动手前必读。 不触发（Do NOT trigger for）: 需要的是形式化定义而非文档索引（用 type-theory-presentation）、直接改代码。
whenToUse: 任何涉及 DC/C₁₂/R₁₂/GF(3)/GF(9)/展示群/零冥族/CRT/FLT/代数复数/范数坍缩/傅里叶/D₁₂/陈数/量子模块的表述、证明或文档任务；写代码前先按本索引定位并阅读原文。
---

# duodecimal-corpus：`docs/duodecimal/` 全库索引（24 份 / 4899 行）

> **本索引不替代原文。** 索引只用于定位与防遗漏；写证明或文档前必须读原文。
> 24 份已于 2026-09-09 逐份全文读完（无跳过，行数合计 = 4899）。

## 0. 目录速查

| # | 文件 | 行 | 定位 |
| --- | --- | --- | --- |
| 01 | `01-ontology.md` | 169 | **宪法级裁决**：DC 是本源，C₁₂/R₁₂/Doz 是投影 |
| 02 | `02-type-definitions.md` | 393 | 精确 Agda 类型定义（可执行） |
| 03 | `03-algebraic-structure.md` | 316 | 群/环/域层次 + 已证公理清单 |
| 04 | `04-zero-oblivion.md` | 246 | **零冥族**：四归零 = 周期闭合 |
| 05 | `05-crt-decomposition.md` | 228 | CRT 12 ≅ 3×4 + 投影同态 |
| 06 | `06-relationship-graph.md` | 209 | Mermaid 关系图 + 代数极接口 |
| 07 | `07-proof-status.md` | 186 | 证明状态 + 缺口清单（G/D/R） |
| 08 | `08-terminology.md` | 155 | **术语红线**（合法/非法对照） |
| 09 | `09-complex-numbers.md` | 459 | **代数复数**：5 种「复数」+ 禁 `Data.Complex` |
| 10 | `10-norm-collapse.md` | 291 | **范数坍缩**：勾股定理的精确边界 |
| 11 | `11-type-theory-presentation.md` | 212 | **类型论展示群**：律算框架群论基础 |
| 12 | `12-rigorous-type-theory.md` | 290 | **展示群严谨定义**（八要素 + 相位/时钟/归零） |
| 13 | `13-flt-analysis.md` | 293 | **FLT 元裁决**：无解性在 Archimedes 序的债务里 |
| 14 | `14-fermat-proof-path.md` | 178 | Fermat 离散投影链 DAG + 验证闸门 |
| 15 | `15-flt-mathematical-position.md` | 150 | 致数学界立场文件（T1–T12 + 边界） |
| 16 | `16-dc12-layer-adjudication.md` | 114 | DC12 论文 L0–L7 逐层裁定（L5 假 / L7 不可证） |
| 17 | `17-dc-fourier-analysis.md` | 90 | DC 傅里叶层（Parseval 闭环） |
| 18 | `18-dihedral-d12-analysis.md` | 91 | D₁₂ 半直积（库中首个非交换群） |
| 19a | `19-full-green-26-fix.md` | 141 | 全库全绿专项 + **编译内存纪律** |
| 19b | `19-review-list.md` | 76 | 待核对清单（假定理/建模未定型） |
| 20 | `20-dc-type-theory-positioning.md` | 121 | **本源元理论**：生成结构，不是投影对象 |
| 21 | `21-quantum-module-topology-scan.md` | 300 | 量子类模块与展示群本源对齐缺口 |
| — | `README.md` | 163 | 知识图谱总览 + 完成状态 |
| — | `reference-deepseek-chat.md` | 28 | 外部对话链接（**非权威**，仅参考） |

## 1. 逐份要点

### 01-ontology.md（宪法级裁决）
- 四个名字必须分开：**DC**（`Trit × AlphaPower`，本源）/ **C₁₂**（`(Duodec,+12)`，加法投影）/ **R₁₂**（`(Duodec,+12,*12)`，环投影，有零因子）/ **Doz**（位值记数法）。
- README 宪法原文：十二进制 = 加法步进 Z/3 ⊕ 乘法旋转 ⟨α⟩；**不是** Z/12 环，**不是** A₄；`12 = 3×4 = char×ord(α)`。
- **禁止**再写笼统「基于 Z12 的代数极」；代数极 = DC 核 + 到 C₁₂/R₁₂ 的投影与判定。
- **V₄ ≠ C₄**：`⟨α⟩` 是 GF(9)* 的 C₄（有 90° 四阶元）；`(R₁₂)×={1,5,7,11}` 是 V₄（全 2 阶）。都叫「四象」= 把本源相位与环单位群焊死，错误。

### 02-type-definitions.md（精确类型定义）
- `Trit` 三态语义：T₀ 吸收态/加法单位、T₁ 平衡态/乘法单位、T₂ 表达态/T₁ 的逆。
- `AlphaPower`：a0=1(0°)、a1=α(90°)、a2=−1(180°)、a3=−α(270°)；`mulAlpha` 13 条子句（1 wildcard + 12，覆盖 16 组）；`alphaInv`。
- `DuodecPoint = Trit × AlphaPower`；`mixedOp (x,a)(y,b) = (x⊕y, mulAlpha a b)`；`duodec-e=(T₀,a0)`；`duodec-inv (x,a)=(negate x, alphaInv a)`。
- 公理证明风格：`mixedOp-assoc = cong₂ _,_ (⊕-assoc …) (mulAlpha-assoc …)`（分量级）。
- `toDuodec`/`fromDuodec` 往返 + `mixed-to-+12`；`*12` 来自整数模 12 乘法，**不是** `mulAlpha` 的投影。

### 03-algebraic-structure.md（层次）
- 层次链：GF(3) → GF(9)=GF(3)[α]/(α²+1) → DC（本源）→ C₁₂ → R₁₂ → Doz。
- GF(3) 已证：`⊕-assoc`(27)、`⊕-comm`(9)、`⊕-identity`、`⊕-inverse`、`⊗-assoc`(27)、`⊗-comm`(9)、`⊗-distrib`(27)。
- GF(3)* ≅ C₂（`⊗-self-inverse`）；GF(9)* 阶 8、生成元 **φ = 1+2α 阶 8**、子群链 ⟨−1⟩ ⊂ ⟨α⟩ ⊂ ⟨φ⟩。
- DC 已证：`mixedOp-assoc/comm/identity/inverse`；**无零因子**（`mulAlpha` 来自域子群）。
- C₁₂ 已证：`+1^12-id`、`+12-assoc/comm`(144)、`+12-inverse`；R₁₂：`zero-divisor-2×6/3×4`、`not-a-field`、单位群 V₄。

### 04-zero-oblivion.md（零冥族）
- **零不是「空」，是多维相位同时回到单位元的状态。**
- 四归零：加法 `⊕³=id`（损益消灭）/ 相位 `α⁴=a0`（旋转闭环）/ 联合 `mixedOp¹²=id`（双周期同步 = 十二）/ 和乐归零（仲吕：`n%144=0 ∧ n%46=0`）。
- `12` 不是「选了个好看的数」，是两个独立旋转同时回到原点的**最短时间**。
- **零因子 ≠ 零冥族**：前者是 R₁₂ 环乘法投影产物，后者是 DC 本源不动点。

### 05-crt-decomposition.md（CRT）
- `Z/12Z ≅ Z/3Z × Z/4Z`（gcd=1）；`π3`/`π4`/`crt12`；`x = (4a+9b) mod 12`。
- `crt12-roundtrip`（12 case refl）→ CRT 分解**无损**；`π3-homo-+`/`π3-homo-*`（各 144 case）→ π₃ 是**环同态**。
- π₄ 保持 `+12`：✅ **已解决 2026-09-09**（`Algebra/Pi4Homomorphism.agda`，0 postulate）。仍未解决：`crt12` 是否保持 `*12`？如何从 CRT 分量重构 `mulAlpha`？

### 06-relationship-graph.md（关系图）
- 六张 Mermaid 图：层次、零冥族、CRT、**代数极**（DC 核 + `asC₁₂`/`asR₁₂` 投影接口 + 四极判定）、模块依赖。
- 模块依赖：`Trit → GF9 → DC → Duodecimal → AlgebraicPoleUnified`；`DC → ZhonglvPhaseSync`。
- **代数极 ⊥ 拓扑极 / GF9 极 / 几何极** 四极正交（审计见 07 §7.1）。
- 物理对应：Trit 三态 = 驻波叠加；α 阶 4 = 90° 旋转；d0 = 黄钟（十二律起点）。

### 07-proof-status.md（证明状态）
- L0–L10 + DC 全部 0 postulate ✅；GF(3)/GF(9)/Duodecimal/DC 逐条证明清单与 case 数。
- **缺口**：G1 `ZeroOblivion` record（已在 DCGroup 落地）；G2 π₄ 同态性 ✅ **已闭合 2026-09-09**（`Pi4Homomorphism.agda`）；G3 CRT 与 `mulAlpha`；G4 `¬(mulAlpha 经 toDuodec = *12)`（**已在 DuodecClock 证 `mulAlpha-not-*12`**，见 14 §五）。
- 文档层缺口：D1 `AlgebraicPoleUnified` 本体字段与 README/DuodecClock 冲突；D2 `algebraic-chain-status` 自相矛盾（既写「L8=Z/12 完成」又写「Z/12 仅为投影」）；D3 代数极判据需改挂 DC；D4 早期「代数极基于 z12」表述需全文降级。
- 环论缺口：R1 理想格、R2 模与表示、R3 |A₄|=12 衔接。

### 08-terminology.md（术语红线）
- 核心术语表 + 数学对象表 + 运算表 + 映射表 + 元素表（a1=90°…）+ 性质表。
- **§7 合法/非法对照**：Z/12Z 本体 → DC 是核；模 12 环 → 3 加 × 4 乘；V₄=α 四阶 → V₄ 是 R₁₂ 单位群；代数极=z12 → DC 核 + 投影；DC 有零因子 → R₁₂ 才有；12 进制=位值制 → 位值制是 Doz。
- 缩写：DC/C₁₂/R₁₂/Doz/CRT/GF/AP（代数极）。

### 09-complex-numbers.md（代数复数）
- **本体系不使用连续统复数 ℂ**；「复数是代数数的连续统投影」。**严禁 `Data.Complex`**（违宪，见 19a 已删死 import）。
- 5 种「复数」：**GF(9)**（本源，有限域 9 元，有 Frobenius）、**Gaussian Z[i]**（范数正定 a²+b²）、**Eisenstein Z[ω]**（ω²=−1−ω，A₄ 特征标）、**Sqrt3 ℚ(√3)**（范数**不定** a²−3b²，能隙 Δ=√3）、**Sqrt2 ℚ(√2)**（素因子基底）。
- 能隙：`c3ToSqrt3` 把 ω 映到 −1/2+1/2√3（代数精确）；`energyGapSquared` refl；定点 **56632/65536**（Q16.16）。⚠ **库内矛盾**：`Base/Invariants.agda:41-47` 注释写 Δ=√3，但 56632/65536 = 0.8641 ≈ √3/2 ≠ √3（`元理论对析 §1` 第 7 条）——引用前核对。
- 非法/合法：能隙不是「无理数」而是 Sqrt3 元素；`i²=−1` 在本体系应写 `α²=−1≡2 (mod 3)`。

### 10-norm-collapse.md（范数坍缩）
- `N : GF(9)× → GF(3)×`，**核 = ⟨α⟩ ≅ C₄**——四个相位元全坍缩到 1，**相位乘法信息 4→1 丢失**。
- 精确定位（防误读）：**不否定**整数 `3²+4²=5²`；「勾股不成立」指的是范数坍缩对**相位乘法结构**的投影丢失，不是否定整数等式。
- `norm-collapse-identity : embed-gf3 (galoisNorm x) ≡ x *gf9 galoisConjugate x`（范数 = 共轭对合并 = 信息去冗余）。
- 加法群范数像 {0,1,2} 满射；**乘法群范数像只有 {1}**（不满射）。

### 11-type-theory-presentation.md（展示群，第一原理）
- **律算框架的群论是类型论展示群，不是集合论群**；载体用 `record`/Σ、生成元用 `data`、关系用 `record` 字段、刚性从 GF9 诱导。
- **核心 = 载体 + 相位 + 时钟**（2026-09-08 补）；集合论群丢失生成来源/关系/Frobenius/联合周期/零冥族/**相位状态**/**时钟读数**。
- 对照表：传统群论 vs 类型论展示群（信息截断 vs 信息保留）。

### 12-rigorous-type-theory.md（严谨定义，权威）
- 定义 2.1–2.7：载体 Σ-类型 / 分量 `data` / `mixedOp` 联合性 / `ZeroOblivion` record 字段 / Frobenius 诱导 / **相位维度** / **时钟维度**。
- `refl` 定位：只确认定义自洽，**不产生结构**；数学刚性在定义层（C₄/σ/归零）。
- 信息对比表（10 行）+ 本体论层级 + 严谨性检查清单（11 项全 ✅）。
- **DC 不是 C₁₂**：`toDuodec` 是**有损投影**，残骸呈 C₁₂ 形状恰是截断证据。

### 13-flt-analysis.md（FLT 元裁决，P0）
- **FLT 不是本框架的定理**：它是 Archimedes 序结构的定理；本框架既不证也不证伪，而是指出「无解性」依赖 ℤ 的序（单调、夹逼、无穷递降），有限域中不存在。
- 离散投影：GF(3)× 幂坍缩为奇偶（n 奇 → 线性伪解 (1,1,2),(2,2,1)；n 偶 → 非零解 ∅，反例必 3|abc）；GF(9)× ≅ C₈ 幂周期 8。
- Claude/Lean 60478 模块 = 「为 ℤ 的序结构搭解析脚手架」的工程规模记录；`Checked 1052234 declarations with no errors`；公理仅 propext/Classical.choice/Quot.sound（按本宪法 = 红灯，Choice 禁用）。
- 判词：**「无解性」在 Archimedes 序的债务里，不在幂的律里。**

### 14-fermat-proof-path.md（证明链 DAG）
- 一命令闸门：`./engineering/check_fermat_chain.sh`（拓扑序 L0→L4，逐模块 0 postulate/hole）。
- 节点：L0 定义 / L1 GF(3)× 周期 / L2 mod-3 分类 / L3 GF(9)× C₈ / L4a ℕ 提升 / L4b R₁₂ 环；L2 与 L3 互不依赖。
- 边界声明：不断言 FLT 在 ℤ 无解；约束是**必要非充分**；**不混 C₄ 与 V₄**（`DuodecClock.mulAlpha-not-*12` 已证可引用）；不做位值分离。
- 群论闸门：`engineering/check_group_chain.sh`（8 模块全绿）。

### 15-flt-mathematical-position.md（致数学界）
- 已证 T1–T12，核心 **T8**：偶次 `aⁿ+bⁿ=cⁿ ⟹ 3|abc`（经环同态 `red₃` 提升到 ℤ）。
- 未证明边界：见 `type-theory-presentation` §10.3（完整 FLT / 偶次无整除假设的完全无解 / 进制改变可证性）。
- 回应 Q1–Q5：进制不改变数论性质；DC12 位数分离已废弃；模约束远不足以证无解；0 postulate ≠ 正确；不做行数竞赛。

### 16-dc12-layer-adjudication.md（DC12 裁定）
- **L5 位数分离是假命题**：反例 a=b=9, c=10, n=3（9³+9³=1458 与 10³=1000 同为 **4 位**）→ 任何含此定理的证明都不可能正确。
- **L7 主定理不可证**（= 完整 FLT，需 Archimedes 序）→ **建声称证明它的 Agda 模块 = 造假**，用白皮书 + 边界声明替代。
- L4 真内核已补 `FermatL4_Mod12Cycle`；L6 低位约束由 `FermatL4_NatLift` 承接。
- 原则：**不为凑满 L0–L7 编号而制造假证明**；编号与数学冲突时以数学为准。

### 17-dc-fourier-analysis.md（傅里叶层）
- 载体 `Z12Sys = ℚ(ζ₁₂)`（4 维 ℚ 基，坐标全定点整数比，禁浮点）；**Sqrt3 容不下单位根**（ζ₃³ 计算否证）。
- 特征同态性 1728 case refl；正交性 132+24；自内积 12；对偶完备性。
- 主定理 `parseval : Σ_x|f(x)|² = (1/12)·Σ_k|f̂(k)|²`（0 postulate 0 hole），组装用 `sumF` 结构归纳，**无 144 项字面树重排**。
- 遗留边界：谱定理（对称矩阵对角化）未形式化；泛 Parseval（任意有限阿贝尔群）未泛化。

### 18-dihedral-d12-analysis.md（D₁₂）
- **D₁₂ = DC ⋊_ρ C₂**（24 阶，库中**首个非交换群**）；`r¹²=1, s²=1, srs=r⁻¹`（`rho-conjugation` 是**机器检查的定理**，非商掉的 axiom）。
- 依赖类型论亮点：`data DihedralElement = rotate DuodecPoint | reflect DuodecPoint`——半直积纤维**信息全保留，无商化**。
- 非交换性是构造性 witness；短正合列 1→DC→D₁₂→C₂→1 用纤维结构表达（DC 正规 = 结构事实）。
- 已按修复路径入库（commit 7fa4d99），0 postulate 0 hole。

### 19a-full-green-26-fix.md（全绿专项）
- 26 失败模块两类：stdlib 2.4 迁移断裂 + 未完成草稿；修复模式（`_mod_`→`_%_`、`fromℕ`→`fromℕ<`、假 refl → 真证…）。
- ⚠ **编译内存纪律**：加 `agda +RTS -M<cap> -RTS --guardedness` 作安全网——无限制编译时自定义 REWRITE 触发的归一化展开可吃满整机内存（61G）。但 **cap 要按机器标定**：本机（2026-09-09 实测）`-M6G` 会误杀 `DuodecClock`/`DCGroup`/`DayanCore`/`Kakeya*`（3s 内 Heap exhausted），`-M8G` 起通过；判「展开 bug」应看**同模块基线 RSS**（无限制跑一次测），不是撞上限即 bug。
- 突破模式：许多「未完成证明」的核心定理**定义性 refl 可闭合**，前提是识别正确数学对象（删假命题 + 奇偶分派穷举）。
- `CRTHarmonics` OOM 根因 = 大系数 `mod-helper` 展开；解法 = REWRITE（`XuanwuAbsorption mod46k` 先例）。

### 19b-review-list.md（待核对清单）
- 修复原则：**不删改物理定义；编译通过 ≠ 物理正确；真命题可证，假命题裁剪。**
- A 类建模未定型（FineStructureMapping / Resonance 5 处 / CRTHarmonics / TopologyLevels 陈数建模错配：`chern2Connection` 在 plaquette 曲率和下总涡量 = 0 ≠ 声称 +2）。
- B 类接口失效（Integration 旧 StateMachine API / TorusClosure 占位）。
- C 类已裁定假定理（Entanglement `classical-bound`：GF(3) 起点层无 α 相位 → 不是「做不到」而是**公理选错**；HamiltonianDiscrete `mass-gap-theorem` 方向错）。
- D 类草稿矛盾块（T6Homotopy `fromℕ` 冒充 Fin 729；WuXingTransition SphereA4 占位）。

### 20-dc-type-theory-positioning.md（本源元理论）
- **杜德克时钟是本源理论**：身份由**生成方式**决定（两个代数域来源 + 联合 + 归零），不由元素个数/形状决定。
- `DayanCore` record = 生成器/规则系统：`Carrier`/`δ`/`φ`/`δ³`/`φ⁴`/`δφ-comm`——**结构 = 生成方式**，全部在场。
- 元理论规定：物理态必须携带两个独立域的联合状态；**相位不可约**；生成即身份；归零闭合。
- 类型论是「为『结构由生成定义』而生的」（归纳类型 = 生成规则，record = 结构打包）。

### 21-quantum-module-topology-scan.md（量子模块扫描）
- 标尺：叠加 = GF3 ⊕；纠缠 = GF9 `galoisConjugate` 共轭对 (α, σα)；相位 = GF9⟨α⟩ `mulAlpha` / `mixedOp` 走钟。
- **投影红线**：`Duodec/Z12` 的 `+1` 是加法投影，**不是**本源相位；用 `Duodec+1` 当相位 = 投影当本源（`QuantumCorrespondence` 犯此错）。
- 三类：A 类 5 个（已用 GF9 但未挂 DC）；B 类混合（QuantumMotor A₄ / QuantumBridge 待核）；C 类纯 GF3。
- **注意（2026-09-09 核验）**：`QuantumCorrespondence` 已改为 import `AlphaPower`/`mulAlpha`（`QuantumCorrespondence.agda:27`），`Quantum/Entanglement` 已加 GF9 共轭层（`:26`、§8）——`21` 文档 §2/§3/§4 的旧缺口描述与 §6 的已完成记录**自相矛盾**，引用时以代码为准。
- 对齐原则：纠缠 = GF9 Frobenius 共轭对；相位 = GF9⟨α⟩ `mulAlpha`；叠加 = GF3 ⊕。

### README.md
- 十二进制 = 多层代数结构，核心 `12 = 3×4`；文件结构与优先级（P0/P1/P2）。
- 宪法一句话 + 本体论立场（离散先于连续，**不要说「范式反转」**）。
- 完成状态表（含 2026-09-07 修正：Dihedral 草稿误标 ✅ 的更正）。

### reference-deepseek-chat.md
- 仅一个外部 DeepSeek 对话链接（2026-08-25 保存）。**非权威**，不得作为证明依据；引用前须与本库文档/代码交叉验证。

## 2. 红线汇总（跨文档）

1. **DC 是本源**；C₁₂/R₁₂/Doz 是投影；禁止笼统「Z12 代数极」。
2. **相位不可约**：C₄→C₂ 非忠实商不是合法同余（结构性语义错配）。
3. **反对信息截断**：展示群 ≠ 「12 元素 + 运算表」；相位/时钟不是静态标签。
4. **不混 C₄ 与 V₄**；`*12 ≠ mulAlpha`（`mulAlpha-not-*12` 已证）。
5. **禁 `Data.Complex`**；无理数用代数数（Sqrt3/Sqrt2 定点整数比）。
6. **`refl` 不是构造**：算术求值/暴力穷举 ≠ 证明；假命题不能靠 refl 变真。
7. **FLT 边界**：本框架只证「幂的律」（T1–T12）；不断言完整 FLT；L5 位数分离已废。
8. **不为凑编号造假证明**；编号与数学冲突以数学为准。
9. **编译加堆限制**作安全网，但 cap 按机器标定（本机 `-M6G` 误杀、`-M8G` 起通过）；判展开 bug 看基线 RSS。
10. **编译通过 ≠ 物理正确**；待核对项不得当作已证。

## 3. 相关技能

- `type-theory-presentation` — 第一原理（展示群八要素、生成结构、相位/时钟、术语红线）。
- `group-first-proof` — 投影层群结构工具（`Group` 实例、证明策略）。
- `proof-engineer` — 编译机制、六类错误指纹、性能陷阱。
- `agda-proof-engine` — Agda 验证纪律与工具链；dype（实验性内核）源码地图见其 `references/dype-experimental.md`。
