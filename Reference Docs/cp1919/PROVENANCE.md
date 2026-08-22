# CP 1919 — the pulses themselves

`pulsar.csv` — **80 rows × 300 columns**, plain numbers, no header.

Successive radio pulses from **CP 1919** (now PSR B1919+21), the first pulsar
discovered. One row is one pulse; the pulses arrive every 1.337 seconds. The
columns are samples across the pulse window, so a row read left to right is one
pulse in time.

Digitised by Borgar Þorsteinsson from the plot in

> Craft, H. D. (1970). *Radio Observations of the Pulse Profiles and Dispersion
> Measures of Twelve Pulsars.* PhD thesis, Cornell University.

which is the figure Peter Saville cropped for the *Unknown Pleasures* sleeve in
1979. **This is the data, not the sleeve** — measurements of a rotating neutron
star, which are facts and nobody's artwork.

Fetched 22 Aug 2026 from
<https://gist.githubusercontent.com/borgar/31c1e476b8e92a11d7e9/raw/pulsar.csv>.

## What is in it

| | |
|---|---|
| rows | 80 |
| samples per row | 300 |
| range | −6.05 … 74.31, arbitrary flux units |
| tallest pulse | row 44, peaking at 74.3 |
| typical row peak | 15 … 40 |

**Normalise globally, never per row.** The dynamic range is the point: most rows
peak between fifteen and forty and one reaches seventy-four. Scaling each row to
its own maximum would flatten that into eighty equal humps and throw away the
single most recognisable thing about the picture — the one enormous pulse near
the middle with the quieter ones crowding around it.
