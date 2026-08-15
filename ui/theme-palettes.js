// The palette library, ported from Emovis.
//
// Each entry was transcribed there from a Figma palette card: the title is the
// card's title and the hex values are the ones printed on its swatches, not
// sampled from the image — so what is written is what the card asserts.
//
// These ship with the program and are `readOnly`: previewable and duplicable,
// never edited or deleted, so a palette someone builds on can never be pulled
// out from under them.

// ─────────────────────────────────────────────────────────────────────────────
// Themes that state their colours instead of deriving them.
//
// A palette gives five hexes and the engine works out sixty tokens from them.
// That is the right trade for a palette nobody designed for this program, and
// the wrong one for a theme somebody did: derivation cannot be argued with, and
// in this interface it produces results that look arbitrary however good the
// palette is. So an entry may carry `tokens` instead, and those are written
// verbatim.
//
// A direct theme states only what it means to change. Anything it leaves out —
// the status colours, every line and shadow, the two waveform colours — falls
// back to the stylesheet's own `:root`, because `Theme.apply` clears the map
// before it writes. That is deliberate: `--good`, `--warn` and `--bad` carry
// meaning rather than style, and a theme has no business repainting them.

/// The interface's own colours, in green.
///
/// Same theme, one hue over: every surface, text step and accent from `app.css`
/// with hue 250 → 152, and the deep end pushed deeper. The lightness ladder is
/// held to within half a percent of the blue original at every step, so the
/// contrast structure the panels were designed against is unchanged and only
/// the colour moves — which is what "based on the one we've got" has to mean if
/// it is to mean anything.
///
/// **The bottom two steps are at the sRGB floor.** At L=7.5% the gamut has no
/// room for chroma: raising it from 0.020 to 0.060 moves the value by one bit,
/// #000200 to #000300. So the deepest black is green by construction rather
/// than visibly, and the green becomes plain from `--surface` upward. Depth
/// there is set by lightness alone, and lifting it is the only way to make the
/// very darkest step read greener.
const CONIFER = {
  id: 'conifer',
  name: 'Conifer',
  direct: true,
  dark: true,
  // For the swatch strip only — the ground, two raised steps, the accent and
  // the brightest text, which is what the row is trying to show you.
  colors: ['#000602', '#040c05', '#0d1610', '#4fcc5b', '#ecf0ec'],
  tokens: {
    // Eight surfaces. oklch(L C 152), chroma tapering as they rise so the deep
    // ground is unmistakably green and the raised panels do not go to moss.
    '--sink':       '#000200',  // oklch(7.5% 0.030 152)
    '--well':       '#000401',  // oklch(9%   0.028 152)
    '--bg':         '#000602',  // oklch(11%  0.026 152)
    '--surface-0':  '#020903',  // oklch(12.5% 0.024 152)
    '--surface':    '#040c05',  // oklch(14%  0.022 152)
    '--surface-2':  '#060f08',  // oklch(15.5% 0.021 152)
    '--surface-2h': '#09120b',  // oklch(17%  0.020 152)
    '--surface-3':  '#0d1610',  // oklch(19%  0.019 152)

    // Four text steps. Barely tinted — text is for reading, and a green cast
    // strong enough to notice is one you have to read through all day.
    '--text':        '#ecf0ec', // oklch(95% 0.006 152)
    '--text-2':      '#c6ccc7', // oklch(84% 0.010 152)
    '--text-dim':    '#98a19a', // oklch(70% 0.014 152)
    '--text-dimmer': '#7a837c', // oklch(60% 0.016 152)

    // The accent, and the one judgement call in the theme.
    //
    // In the blue original the accent *is* the blue waveform colour — both are
    // oklch(70% 0.16 230), exactly. Going green would put the accent on top of
    // `--good` and `--wave-2` instead, which are both oklch(72% 0.15 155): a
    // selection would then be the same colour as a waveform and as the meter
    // saying a level is safe. So this sits brighter, more saturated and seven
    // degrees warmer — same family, its own voice.
    '--accent':      '#4fcc5b', // oklch(75% 0.190 145)
  },
};

const THEME_PALETTES = [
  CONIFER,
  { id: 'cocoa-topaz-noonday', name: 'Cocoa topaz noonday', colors: ['#742f14', '#5a84ac', '#c7ac9f', '#fc9c44', '#5c3c2c'] },
  { id: 'amber-walnut-morning', name: 'Amber walnut morning', colors: ['#ebefee', '#ccb499', '#c8906d', '#bb6c43', '#4a413c'] },
  { id: 'driftwood-pearl-morning', name: 'Driftwood pearl morning', colors: ['#bc7b6f', '#5a322a', '#e4a499', '#718a9e', '#cccdc7'] },
  { id: 'rose-quartz-evening', name: 'Rose quartz evening', colors: ['#64242f', '#b44446', '#fc8f8f', '#dfd9d8'] },
  { id: 'ink-wash', name: 'Ink wash', colors: ['#252525', '#cfcfcf', '#7d7d7d', '#545454'] },
  { id: 'sorbet', name: 'Sorbet', colors: ['#cccccc', '#edecec', '#b7c396', '#fefefe', '#e0e7d7', '#ba9a91'] },
  { id: 'vichy', name: 'Vichy', colors: ['#bbbfbf', '#878787', '#05ad98', '#ffffff'] },
  { id: 'yacht-club', name: 'Yacht club', colors: ['#f2f0ef', '#bbbdbc', '#245f73', '#733e24'] },
  { id: 'frozen-mist', name: 'Frozen mist', colors: ['#7c7d75', '#adaca7', '#fcf8d8', '#d9dadf', '#dd700b'] },
  { id: 'copper-aquamarine-dream', name: 'Copper aquamarine dream', colors: ['#dcaa89', '#30525c', '#c35627', '#d6794d', '#4c848d', '#bfb9b5'] },
  { id: 'sandstone-aquamarine-serinity', name: 'Sandstone aquamarine serinity', colors: ['#bc6c50', '#304c53', '#ddad9c', '#5a2f25', '#afe0e7'] },
  { id: 'fireside', name: 'Fireside', colors: ['#e76814', '#d8d4bc', '#891a10', '#dc8236', '#b8210f', '#714236'] },
  { id: 'woodland', name: 'Woodland', colors: ['#9f7560', '#9e9e9e', '#aad31e', '#d4af9f', '#525034'] },
  { id: 'seashell-garnet-afternoon', name: 'Seashell garnet afternoon', colors: ['#f6c992', '#30525c', '#acc0d3', '#d396a6', '#09a1a1', '#5484a4'] },
  { id: 'graphite', name: 'Graphite', colors: ['#c1c0c2', '#f5e9e7', '#837d68', '#8a9db1', '#ecc5c6'] },
  { id: 'jade-pebble-morning', name: 'Jade pebble morning', colors: ['#7b9669', '#e6e6e6', '#6c8480', '#bac8b1', '#404e3b'] },
  { id: 'pearl', name: 'Pearl', colors: ['#e9e3de', '#a5937b', '#e3c49b', '#666161', '#af9ac9'] },
  { id: 'calcite', name: 'Calcite', colors: ['#dddcdb', '#fd7b41', '#edbf9b', '#3c4044'] },
  { id: 'neutral-elegance', name: 'Neutral elegance', colors: ['#ffdbbb', '#ccbeb1', '#997e67', '#664930'] },
  { id: 'honey-opal-sunset', name: 'Honey opal sunset', colors: ['#ecb914', '#f6d579', '#9d8108', '#cbb8a0', '#4f3d35'] },
  { id: 'urban-slate', name: 'Urban slate', colors: ['#e9e6e7', '#5e5653', '#7b7f8a', '#ab978c', '#6b7c98'] },
  { id: 'marina', name: 'Marina', colors: ['#fff1e7', '#b5d2e6', '#326080', '#805232'] },
  { id: 'tropical-jade-sunrise', name: 'Tropical jade sunrise', colors: ['#fca47c', '#23ced9', '#f9d779', '#a1cca6', '#097c87'] },
  { id: 'sapphire-nightfall-whisper', name: 'Sapphire nightfall whisper', colors: ['#0474c4', '#5379ae', '#2c444c', '#a8c4ec', '#06457f', '#262b40'] },
  { id: 'sage-peridot-morning', name: 'Sage peridot morning', colors: ['#345c32', '#9cac54', '#a7f0dd', '#97cd97'] },
  { id: 'lapis-velvet-evening', name: 'Lapis velvet evening', colors: ['#213885', '#ecdfd2', '#5f3475', '#081849', '#cccacc', '#893172'] },
  { id: 'neptune', name: 'Neptune', colors: ['#8fd9fb', '#4ab5b5', '#6d8bc0', '#525aff'] },
  { id: 'festive-eve', name: 'Festive eve', colors: ['#2323ff', '#24aeff', '#c04aff', '#7e3dff'] },
  { id: 'turquoise-amber-autumn', name: 'Turquoise amber autumn', colors: ['#304c64', '#26788e', '#a4ccd4', '#e2480c', '#631b08'] },
  { id: 'amethyst-dawn-haze', name: 'Amethyst dawn haze', colors: ['#341c67', '#472f5b', '#c4aef4', '#cca4b4', '#dcce40'] },
  { id: 'terrazzo', name: 'Terrazzo', colors: ['#edbd95', '#374f4e', '#d1801e', '#daccc4', '#aa8552'] },
  { id: 'frosted-aura', name: 'Frosted aura', colors: ['#5c7e8f', '#a2a2a2', '#d4dde2', '#ffffff'] },
  { id: 'sapphire-ash-morning', name: 'Sapphire ash morning', colors: ['#35627a', '#e5aea9', '#b46258', '#a6a9d0', '#f5f5f5', '#8e9a98'] },
  { id: 'tropical-heat', name: 'Tropical heat', colors: ['#00cec8', '#fcefc3', '#ff9c5f', '#eb4203'] },
  { id: 'moon-dust', name: 'Moon dust', colors: ['#d3d3ff', '#ceb5ff', '#8ec1de', '#80a8ff'] },
  { id: 'emerald-lavender-lake', name: 'Emerald lavender lake', colors: ['#248c54', '#89618e', '#95dce4'] },
  { id: 'sea-side', name: 'Sea Side', colors: ['#26648e', '#4f8fc0', '#53d2dc', '#ffe3b3'] },
  { id: 'velvet', name: 'Velvet', colors: ['#313866', '#50409a', '#964ec2', '#ff7bbf'] },
  { id: 'cove', name: 'Cove', colors: ['#006bbb', '#30a0e0', '#ffc872', '#ffe3b3'] },
  { id: 'turtle', name: 'Turtle', colors: ['#e5efc1', '#a2d5ab', '#39aea9', '#557b83'] },
  { id: 'sunrise', name: 'Sunrise', colors: ['#5f236b', '#be375f', '#ed8554', '#f5eb6d'] },
  { id: 'rose', name: 'Rose', colors: ['#cc184e', '#e84575', '#f76cae', '#ffe3b3'] },
  { id: 'fruits-basket', name: 'Fruits Basket', colors: ['#e984a2', '#b9cc95', '#f8d49b', '#f8e6cb'] },
  { id: 'pink-la', name: 'Pink LA', colors: ['#7827e6', '#8d39ec', '#aa4ff6', '#ea80fc'] },
  { id: 'periwinkle', name: 'Periwinkle', colors: ['#9a9cea', '#a2b9ee', '#a2dcee', '#adeee2'] },
  { id: 'strawberry', name: 'Strawberry', colors: ['#f14666', '#ee8980', '#ffcdaa', '#9cb898'] },
  { id: 'sharp-edge', name: 'Sharp edge', colors: ['#898989', '#d9d9d9', '#ff4d4d', '#4dffbc'] },
];
