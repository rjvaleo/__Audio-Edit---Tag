#!/usr/bin/env python3
"""Read the CP 1919 pulses, draw them, and say what they are made of.

Kept because the numbers below decide whether the stack can be *synthesised* —
eighty rows is four seconds of scrolling at the room's poll rate, and a loop
that visibly repeats every four seconds is a loop you notice.
"""
import sys, statistics as st

def load(path):
    rows = []
    for ln in open(path):
        ln = ln.strip()
        if ln:
            rows.append([float(x) for x in ln.split(',')])
    return rows

def svg(rows, path, W=1000, H=1400, pad=60, over=10.0, stroke=1.6):
    n, m = len(rows), len(rows[0])
    lo = min(v for r in rows for v in r)
    hi = max(v for r in rows for v in r)
    # **Global, never per row.** Most rows peak between fifteen and forty and one
    # reaches seventy-four; scaling each to its own maximum makes eighty equal
    # humps and throws away the one thing everybody recognises.
    span = hi - lo
    top, bot = pad, H - pad
    gap = (bot - top) / (n - 1)
    amp = gap * over          # how many row-gaps the tallest pulse reaches
    x = lambda i: pad + (W - 2 * pad) * i / (m - 1)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#000"/>']
    # Back to front: the first row is furthest, and each one after it paints over
    # what is behind. The fill is what does the hiding.
    for j, r in enumerate(rows):
        base = top + gap * j
        pts = [f'{x(i):.2f},{base - amp * (v - lo) / span:.2f}' for i, v in enumerate(r)]
        area = f'{x(0):.2f},{base:.2f} ' + ' '.join(pts) + f' {x(m-1):.2f},{base:.2f}'
        out.append(f'<polygon points="{area}" fill="#000"/>')
        out.append(f'<polyline points="{" ".join(pts)}" fill="none" '
                   f'stroke="#fff" stroke-width="{stroke}" '
                   f'stroke-linejoin="round" stroke-linecap="round"/>')
    out.append('</svg>')
    open(path, 'w').write('\n'.join(out))

def describe(rows):
    n, m = len(rows), len(rows[0])
    flat = [v for r in rows for v in r]
    # The tails are baseline: no pulse reaches the first or last tenth.
    tails = [v for r in rows for v in r[:m // 10] + r[-m // 10:]]
    peaks = [max(r) for r in rows]
    where = [r.index(max(r)) / (m - 1) for r in rows]
    # Width at half height, in samples, as a crude pulse-shape measure.
    widths = []
    for r in rows:
        p = max(r); half = p / 2
        widths.append(sum(1 for v in r if v > half))
    print(f"rows {n} x {m}   range {min(flat):.2f} .. {max(flat):.2f}")
    print()
    print("BASELINE (the flat tails)")
    print(f"  mean {st.mean(tails):+.3f}   sd {st.pstdev(tails):.3f}"
          f"   min {min(tails):.2f}  max {max(tails):.2f}")
    print()
    print("PULSE HEIGHT")
    print(f"  mean {st.mean(peaks):.1f}   sd {st.pstdev(peaks):.1f}"
          f"   min {min(peaks):.1f}  max {max(peaks):.1f}")
    print(f"  ratio tallest/median {max(peaks)/st.median(peaks):.1f}x")
    print()
    print("WHERE THE PULSE SITS  (0 = left edge, 1 = right)")
    print(f"  mean {st.mean(where):.3f}   sd {st.pstdev(where):.3f}"
          f"   min {min(where):.3f}  max {max(where):.3f}")
    print()
    print("PULSE WIDTH at half height, in samples of 300")
    print(f"  mean {st.mean(widths):.1f}   sd {st.pstdev(widths):.1f}"
          f"   min {min(widths)}  max {max(widths)}")
    print()
    # Is a row predictable from the one before it, or independent?
    lag = []
    for a, b in zip(rows, rows[1:]):
        ma, mb = st.mean(a), st.mean(b)
        na = sum((v - ma) ** 2 for v in a) ** 0.5
        nb = sum((v - mb) ** 2 for v in b) ** 0.5
        if na and nb:
            lag.append(sum((p - ma) * (q - mb) for p, q in zip(a, b)) / (na * nb))
    print("ROW-TO-ROW CORRELATION  (1 = each pulse repeats the last, 0 = independent)")
    print(f"  mean {st.mean(lag):+.3f}   sd {st.pstdev(lag):.3f}")

if __name__ == '__main__':
    rows = load(sys.argv[1])
    svg(rows, sys.argv[2])
    describe(rows)

def emit_js(rows, path):
    """The rows, and the statistics the synthesiser is built from, as JS.

    Generated rather than typed: eighty rows of three hundred numbers is a pile
    of magic numbers nobody can check, and the statistics have to be measured
    from the same data they describe or the synthesised rows will not sit
    alongside the real ones.
    """
    import statistics as st
    n, m = len(rows), len(rows[0])
    lo = min(v for r in rows for v in r); hi = max(v for r in rows for v in r)
    prof = [st.mean(r[i] for r in rows) for i in range(m)]
    tails = [v for r in rows for v in r[:m // 10] + r[-m // 10:]]
    peaks = [max(r) for r in rows]
    where = [r.index(max(r)) / (m - 1) for r in rows]
    widths = []
    for r in rows:
        half = max(r) / 2
        widths.append(sum(1 for v in r if v > half) / m)
    q = lambda xs: [round(v, 4) for v in xs]
    out = []
    out.append("// The CP 1919 pulses, and what they are made of.")
    out.append("//")
    out.append("// GENERATED by `tools/cp1919.py` from `Reference Docs/cp1919/pulsar.csv`.")
    out.append("// Do not edit by hand — re-run the script. See `docs/RIDGELINE.md`.")
    out.append("//")
    out.append("// Craft, H. D. (1970), digitised by Borgar Thorsteinsson. The data is")
    out.append("// measurements of a rotating neutron star; it is not the album sleeve.")
    out.append("")
    out.append(f"const RIDGE_ROWS = {n};")
    out.append(f"const RIDGE_POINTS = {m};")
    out.append(f"const RIDGE_MIN = {lo:.4f};")
    out.append(f"const RIDGE_MAX = {hi:.4f};")
    out.append("")
    out.append("/// The average pulse: the backbone every row is a variation on.")
    out.append("/// Each row correlates with it at +0.907, and 77 of the 80 above 0.8.")
    out.append(f"const RIDGE_PROFILE = {q(prof)};")
    out.append("")
    out.append("/// What the per-row parameters actually spread over. Drawn near")
    out.append("/// independently — the row-to-row correlation of +0.817 is the shared")
    out.append("/// backbone showing through, not memory. See `docs/RIDGELINE.md`.")
    out.append("const RIDGE_STATS = {")
    out.append(f"  baselineSd: {st.pstdev(tails):.4f},")
    out.append(f"  heightMean: {st.mean(peaks):.3f}, heightSd: {st.pstdev(peaks):.3f},")
    out.append(f"  heightMin: {min(peaks):.3f}, heightMax: {max(peaks):.3f},")
    out.append(f"  posMean: {st.mean(where):.4f}, posSd: {st.pstdev(where):.4f},")
    out.append(f"  widthMean: {st.mean(widths):.4f}, widthSd: {st.pstdev(widths):.4f},")
    out.append("};")
    out.append("")
    out.append("/// The eighty pulses themselves, in their own units.")
    out.append("const RIDGE_DATA = [")
    for r in rows:
        out.append("  [" + ",".join(f"{v:g}" for v in r) + "],")
    out.append("];")
    out.append("")
    open(path, 'w').write("\n".join(out))
