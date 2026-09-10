"""oracle_kit — 先算后验证的共享 Python 库（零外部依赖，全整数精确运算）

为什么存在：oracle 脚本不该每次从零造轮子。本项目已经吃过一次亏——
`engineering/tests/test_nse_t6_discrete.py`（670 行）自建了 GF(3)/T⁶/差分算子，
而 `engineering/software/sovereign_core/trit.py` 里早就有 `gf3_add/gf3_mul/gf3_neg`。
本库把「可复用的算法 + 穷举基 + 覆盖清单 + 性能模式」集中到一处。

用法（`proof_oracle` 运行时会把本目录加入 PYTHONPATH，直接 import 即可）：

    from oracle_kit import t6_points, delta_basis, manifest, first_counterexample

    pts = t6_points()                      # 729 点，全整数
    for f in delta_basis(6):               # δ 基，不是「线性场抽样」
        cex = first_counterexample(pts, lambda x: laplacian(f, x) == 0)
        if cex is not None:
            print("反例:", cex)

    manifest(basis="δ 基 × 729 点", domain=len(pts), points=len(pts),
             claim="laplacian(f) ≡ 0 对所有 f、所有 x 成立")

纪律：
  · **禁浮点 / 禁复数**（宪法约束）——本库只做整数运算；
  · 穷举必须给出 `domain`（论域大小）与 `points`（实际枚举点数）；`points < domain` 即抽样；
  · Python 产出的是**证据**，裁决永远是 Agda。
"""

from __future__ import annotations

import itertools

# ── GF(3)：三进制域 ────────────────────────────────────────────────────────


def gf3_add(a: int, b: int) -> int:
    """GF(3) 加法（a + b mod 3）。"""
    return (a + b) % 3


def gf3_mul(a: int, b: int) -> int:
    """GF(3) 乘法（a * b mod 3）。"""
    return (a * b) % 3


def gf3_neg(a: int) -> int:
    """GF(3) 加法逆元（−a mod 3）。"""
    return (-a) % 3


TRIT_ADD = tuple(tuple((a + b) % 3 for b in range(3)) for a in range(3))
"""3×3 加法表：`TRIT_ADD[a][b]`。预计算比每次取模快一个量级。"""


def shift3(a: int) -> int:
    """+1 mod 3（前向移位 S）。"""
    return (a + 1) % 3


# ── T⁶ = (Z/3)⁶：729 点 ────────────────────────────────────────────────────

DIM = 6


def t6_points():
    """T⁶ 的全部 729 个点（元组，整数）。"""
    return list(itertools.product(range(3), repeat=DIM))


def delta_basis(n: int = DIM):
    """δ 基：每个点处取 1、其余取 0 的场（**结构穷举的基**，不是线性场抽样）。

    线性场 `f = xᵢ` 上很多算子恒为 0，会骗过抽样；δ 基能立刻暴露反例。
    """
    for p in itertools.product(range(3), repeat=n):
        yield (lambda x, p=p: 1 if x == p else 0)


def const_fields(n: int = DIM):
    """常数场（幅度基），与 δ 基一起构成最小完备族。"""
    for c in range(3):
        yield (lambda x, c=c: c)


def diff_f(i: int, f, x) -> int:
    """前向差分 D_i f(x) = f(x + e_i) − f(x)（GF(3)）。"""
    y = list(x)
    y[i] = shift3(y[i])
    return gf3_add(f(tuple(y)), gf3_neg(f(x)))


def sum6(a, b, c, d, e, f):
    """右嵌套六项和（镜像 Agda `sum6`）。"""
    return gf3_add(a, gf3_add(b, gf3_add(c, gf3_add(d, gf3_add(e, f)))))


def div6(v, x) -> int:
    """散度：分量 1,2,3 用轴 0,1,2；分量 4,5,6 复用轴 0,1,2。"""
    return sum6(
        diff_f(0, v[0], x), diff_f(1, v[1], x), diff_f(2, v[2], x),
        diff_f(0, v[3], x), diff_f(1, v[4], x), diff_f(2, v[5], x),
    )


def axis_lap(i: int, f, x) -> int:
    """单轴二阶差分 D_i(D_i f)(x)。"""
    return diff_f(i, lambda y: diff_f(i, f, y), x)


def laplacian(f, x) -> int:
    """laplacian = 2·Σ_{i<3} axisLap i（特征 3 下 2 = −1）。"""
    s = 0
    for i in range(3):
        s = gf3_add(s, axis_lap(i, f, x))
    return gf3_mul(2, s)


def grad6(f, x):
    """梯度：六分量复用三轴 (D₀,D₁,D₂,D₀,D₁,D₂)。"""
    return tuple(diff_f(i % 3, f, x) for i in range(6))


# ── 穷举与反例 ─────────────────────────────────────────────────────────────


def first_counterexample(points, pred):
    """返回第一个不满足 `pred` 的点（精确反例），全通过返回 None。"""
    for x in points:
        if not pred(x):
            return x
    return None


def all_hold(points, pred) -> bool:
    """全称断言是否在 `points` 上成立（注意：points 必须等于声明的论域）。"""
    return first_counterexample(points, pred) is None


def precompute(fn, points):
    """把函数预计算成字典表（`table[x]`），避免在循环里重复调用。

    教训：`计算路线` 的探针曾因在内层循环里反复构造场而超时——
    先建表、再遍历，是 oracle 脚本的第一性能纪律。
    """
    return {x: fn(x) for x in points}


# ── CRT：12 ↔ 3 × 4 ───────────────────────────────────────────────────────


def crt12(a3: int, a4: int) -> int:
    """CRT 合并 (mod 3, mod 4) → mod 12（唯一解）。"""
    for x in range(12):
        if x % 3 == a3 % 3 and x % 4 == a4 % 4:
            return x
    raise AssertionError("CRT 无解（不应发生）")


def split12(x: int):
    """mod 12 → (mod 3, mod 4)。"""
    return (x % 3, x % 4)


CRT12_TABLE = tuple(crt12(a, b) for a in range(3) for b in range(4))
"""12 项 CRT 查表（规范代表元），与 `Algebra/Duodecimal.agda` 的 `crt12` 对齐。"""


# ── 覆盖清单（`proof_oracle` 据此判定「穷举 vs 抽样」）────────────────────


def manifest(basis: str, domain: int, points: int, claim: str) -> None:
    """打印结构化清单。`points < domain` 会被 `proof_oracle` 判为抽样、不算验证。

    参数：
      basis  — 穷举基（如「δ 基 × 729 点」「12 项 CRT 表」）
      domain — 声称的论域大小（必须是你真正想覆盖的全部情形数）
      points — 实际枚举点数
      claim  — 一句话断言（写清楚「在什么上成立什么」）
    """
    import json

    if not isinstance(domain, int) or not isinstance(points, int):
        raise TypeError("manifest: domain / points 必须是整数")
    if domain <= 0:
        raise ValueError("manifest: domain 必须为正整数")
    print(
        "ORACLE-MANIFEST "
        + json.dumps(
            {"basis": basis, "domain": domain, "points": points, "claim": claim},
            ensure_ascii=False,
        )
    )
