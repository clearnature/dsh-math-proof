---
name: meta-diagnosis
description: 元诊断体系 — 三重完备性标尺（几何闭包/原生共轭/描述完备）、连续统病态与病态量度（挂谷 63.5 / FLT ≈20000+）、三个千禧年编译器初诊（PvNP/NS/YM 的 TypeError）、经典理论红灯审查 4 类、病态检测规则与诚实边界。 不触发（Do NOT trigger for）: 已判定在离散基座内的常规证明（用 proof-engineer）、工具链报错（用 prover_limits 查经验库）。
whenToUse: 任何涉及连续统/极限/ε-δ/不可数/测度、千禧年问题、经典理论诊断、挂谷/FLT/NS/YM/RH 的任务；判断「该不该换离散基座」时加载。
---

# meta-diagnosis：元诊断体系

**来源**：`docs/重构数学体系进展报告.md §五`、`docs/Kakeya-元诊断-连续统病态vs离散自愈.md`、
`docs/Kakeya-形式化验证报告.md`、`docs/经典理论红灯审查诊断手册.md`、
`docs/{PNP,NavierStokes,YangMills}/*-三重完备性编译器初诊.md`、`docs/元理论对析-事实核查修正版.md`。

## 0. 定位：元理论编译器

> 大衍不是「另一种物理/数学理论」，而是**元理论编译器**：输入 = 直觉层合理内核 + 物理层唯象数据；
> 输出 = 0-postulate 编译通过的**代数宪法**；过滤 = 一切无法机器验证的形而上学外壳。

- **裁决线 = Agda 编译通过的那一刻**；此前一切（直觉深度、数据广度）都是待编译原料，不是真理本身。
- **「编译」≠「验证」**：为某个直觉提供代数实现路径，不构成对该直觉原始理论全部主张的确认。

## 1. 三重完备性标尺

| 标尺 | 连续统 ℝⁿ | 离散 GF(3)ⁿ/GF(9) | 判据 |
| --- | --- | --- | --- |
| **几何闭包** | ❌ ε→0 逃逸，测度可泄漏为 0（Besicovitch） | ✅ 硬下界（Dvir：`\|K\| ≥ C_n·3ⁿ`；GF(3)² 例 `\|K\|≥5`） | 空间是否紧致闭合 |
| **原生共轭** | ❌ 特征 0 无 Frobenius | ✅ `σ(x)=x³`，`Gal(GF(9)/GF(3)) ≅ C₂` | 是否有代数刚性 |
| **描述完备** | ❌ `Sⁿ⁻¹` 不可数、无法构造 `M_F` | ✅ `\|ℙ¹(GF(3))\| = 4` 精确有限、`M_F` 可构造 | 方向空间是否有限、能否全局编码 |

形式化（`Sovereign.Problem.Kakeya.KakeyaPathology`）：

```agda
record Diagnosis (B : Set) : Set where
  field geometric-closure : ℕ        -- 0=无闭包(病态), >0=有硬下界
        native-conjugation : ℕ       -- 0=无共轭(病态), >0=有共轭
        descriptive-completeness : ℕ -- 0=不可数(病态), >0=有限

continuum-diagnosis = 0 , 0 , 0        -- 三重缺失
continuum-triple-failure = refl , refl , refl
discrete-diagnosis  = 5 , 2 , 4        -- 三重自愈（Dvir 下界 / Gal ≅ C₂ / ℙ¹(GF(3))）
```

## 2. 病态量度

```
病态量度 = 连续统证明页数 / 离散证明页数
```

| 案例 | 连续统侧 | 离散侧 | 病态量度 |
| --- | --- | --- | --- |
| **挂谷** | 王虹-Zahl 2025，127 页 | Dvir 2009，2 页 | **63.5**（`pathology-ratio-exceeds-1 : 2*63+1 ≡ 127`，refl） |
| **FLT** | Claude/Lean 60478 模块 | 3 个 refl 级定理（GF(3)× 周期 2 / GF(9)× 周期 8 / n 偶 ⟹ 3\|abc） | **≈20000+** |

判据：比值越大 = 命题越贴近离散基座、连续统偿还的债务越庞大。

## 3. 三个千禧年编译器初诊（TypeError 清单）

| 问题 | TypeError | 几何闭包 | 原生共轭 | 全局编码 | 初诊结论 |
| --- | --- | --- | --- | --- | --- |
| **P vs NP** | `BarrierTrilemmaWithoutDiscreteGlobalEncoding` | 🟢 **天然满足**（七问题唯一） | 🟡 概念不适用 | ❌ 三重屏障（BGS 可相对化 / 自然证明 / 代数化） | 困难在**认知屏障**，不在基座——「不知道怎么证」≠「基座不允许证」 |
| **Navier-Stokes** | `ContinuousDissipationWithoutDiscreteBarrier` | ❌ 非紧 ℝ³ | ❌ 无 Galois 类比 | ❌ 仅"奇性集测度为零" | 连续统自身是**奇性制造者**；但 `Problem/NavierStokes/NSE.agda` 已有 GF(3) 离散 0-postulate 实现（七问题唯一） |
| **Yang-Mills** | `UVDivergenceWithoutDiscreteCompactification` | ❌ UV 发散 | ❌ 连续无穷维李代数 | ❌ 存在性与间隙互为前提 | 格点上可判、**连续极限待证**；通用质量间隙**未形式化**（第四波目标） |

七问题对照（`YangMills-初诊 §五`）：RH / BSD / Langlands / Hodge / NS / YM 三重全 ❌；**仅 P vs NP 几何闭包 🟢**。
NS 与 YM 方法同构（小尺度病态 → 离散化），差异：NS 直接抛弃连续统、YM 仍需受控极限。

## 4. 经典理论红灯审查（4 类）

| 分支 | 病态 | TypeError | 离散修复 |
| --- | --- | --- | --- |
| 奇异同调 | 连续单纯形、链群无限维 | `ContinuousSpectrumInHomology` | `jac_ChainComplex`（GF(9) 有限矩阵） |
| 高阶同伦群 | 连续软路径、同伦膨胀 | `HomotopyInflationWithoutGaloisLock` | 有限置换 + `σ(x)=x³` 代数锁 |
| 指数映射 | `exp` 连续流、特征 0 无刚性 | `SoftExponentialWithoutFrobenius` | `jac_LieGroup`（σ 替代 exp） |
| 无限维表示 / 根系 | 非紧 Hilbert、根系无穷远逃逸 | `RootSystemEscapeAtInfinity` | `Aut(T⁶/GF(9))` 有限群、特征标表封顶 |
| N×N 行列式 | `O(N!)`、系数爆炸 | `CombinatorialExplosionAndContinuousLeakage` | CRT 分解 `jac_CRTDet`（N×N → 3×3+4×4） |
| 黎曼猜想 | ζ 是非紧 ℂ 上超越函数 | `MissingGlobalSpectralOperator` + `MissingFrobeniusRigidity` | 基座类型失配（诊断，非修补） |

## 5. 病态检测规则（写证明前先扫）

出现以下信号 → **连续统病态** → 应切换离散基座：

- ε-δ / 极限 / 无限细分
- 不可数覆盖 / 非紧致空间
- 测度为零但非空集（Besicovitch 型）
- 需要「无穷 q-展开表」（Wiles 式）或无限维表示
- 出现 `Choice` / 排中律 / 非构造性存在论证（本宪法 = 红灯）

**共轭锁定**：必须用 **GF(9)** 而非 GF(2)——GF(2) 无非平凡自同构，无法诊断「共轭缺失」；
`σ(x)=x³` 是复共轭的离散投影。

## 6. 诚实边界（防过度声称，`元理论对析 §4`）

- 库内形式化的是 **Dvir 下界的 GF(3) 实例**（`KakeyaGF3`），**不是 Dvir 全定理的重证**。
- 「连续统仅是离散代数刚性在宏观观察下的投影显现」= **元诊断立场，非 Agda 定理**。
- 「127 页 vs 2 页」= 外部事实（Wang-Zahl 2025 127pp；Dvir 2009 2pp）+ 框架立场，**非证明强度的等价比较**。
- 挂谷 4 模块全绿：`KakeyaGF3` / `KakeyaGF9` / `KakeyaMF` / `KakeyaPathology`。
- 通用 YM 质量间隙、完整 FLT、谱定理均**未形式化**。

## 7. 库内已发现的数值矛盾（引用前必须核对）

- `Base/Invariants.agda:41-47` 注释写 **Δ=√3**，但定点值 **56632/65536 = 0.8641 ≈ √3/2，不是 √3**（`元理论对析 §1` 第 7 条）→ 引用前修注释或标注 √3/2。
- `±2¹⁰ → ±16 (mod 216)` 是**数学错误**（2¹⁰=1024≡160）；真实锚点 `CRT.sqCongruence : 16² ≡ 40 (mod 216)`。
- `StankovRatio = 268/10000` 是**经验常数，非推导值**（三轮核查：项目一手文档命名"斯坦科夫比例"，无推导）。
- 「跨 19 个数量级复现」超出库内证据（仅 ρ_crit≈0.38 注释级）。

## 8. 与其他技能的关系

- `type-theory-presentation` — 展示群第一原理（为什么 DC 是本源）。
- `duodecimal-corpus` — `docs/duodecimal` 全 24 份索引（含 FLT 裁决 13/15/16）。
- 本技能 — 诊断层：**判断一个问题该不该在连续统上做**，以及换基座后的正确陈述形态。
