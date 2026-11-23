#!/usr/bin/env python3
"""Write engine-app/src/fx/sizes.rs from capture-fx.mjs's fx-page.json: each
effect card's width, as MGL's page lays it out (gsFxShape)."""
import json, sys, os
page = json.load(open(sys.argv[1]))
out = os.path.join(os.path.dirname(__file__), '../../engine-app/src/fx/sizes.rs')
seen = {}
for k in page['kinds']:
    seen.setdefault(k['kind'], int(round(k['rect'][2])))
rows = '\n'.join(f'        "{k}" => {w},' for k, w in sorted(seen.items()))
open(out, 'w').write(f'''//! Each effect card's width, as MGL's page lays it out (`gsFxShape`: as wide
//! as its knobs three deep). Written by `tools/face-capture/fx-sizes.py` from
//! the capture (`capture-fx.mjs`); do not edit by hand.

/// The card's width for a slot of `kind`, in pixels (296 for one not captured).
pub fn card_width(kind: &str) -> u32 {{
    match kind {{
{rows}
        _ => 296,
    }}
}}
''')
print(len(seen), 'widths')
