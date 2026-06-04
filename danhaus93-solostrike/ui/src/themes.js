// ============================================================================
// SoloStrike Themes (v1.11.47)
// ============================================================================
// Single source of truth for all 8 theme palettes.
//
// Each theme defines:
//   - css           : object → CSS variable values applied via data-theme
//   - bg            : animated background uniforms (animated-bg-webgl.js)
//   - lightning     : The Strike core/glow/bloom triplet (lightning-webgl.js)
//   - nonce         : Nonce Field BTC_* triplets (nonce-field-webgl.js)
//   - ticker        : Hash Ticker hex/glyph colors (App.jsx drawTicker)
//   - constellation : Pulse mesh palette (constellation-cube.js)
//   - globe         : Globe texture colors (globe-webgl.js bakeWorldMapTexture)
//   - special       : optional flags ('lightMode': use 2D blueprint bg)
//
// The Classic Bitcoin theme reproduces the exact deployed colors — selecting
// it produces ZERO behavior change from the deployed dark theme. Other themes
// remap each anchor while preserving every shader's structural math.
// ============================================================================

export const THEMES = {
  classic: {
    id: 'classic',
    label: 'Classic Bitcoin',
    description: 'Currently deployed amber + Bitcoin orange',
    css: {
      '--bg-void':        '#060708',
      '--bg-deep':        '#0b0d0f',
      '--bg-surface':     '#101316',
      '--bg-raised':      '#161b20',
      '--bg-elevated':    '#1c2129',
      '--amber':          '#F5A623',
      '--amber-hot':      '#FF7A00',
      '--amber-dim':      '#6B4710',
      '--btc-orange':     '#F7931A',
      '--btc-orange-glow':'rgba(247,147,26,0.45)',
      '--cyan':           '#00FFD1',
      '--red':            '#FF3B3B',
      '--green':          '#39FF6A',
    },
    bg: {
      bgBase:    [0.045, 0.027, 0.006],
      blockBase: [0.26, 0.153, 0.027],
      blockPulse:[1.40, 0.830, 0.147],
      blockBevel:[0.32, 0.189, 0.034],
      topRadial: [0.18, 0.106, 0.019],
    },
    lightning: {
      core:  [1.0, 1.0, 0.95],
      glow:  [1.0, 0.9, 0.55],
      bloom: [0.95, 0.65, 0.18],
    },
    nonce: {
      bg:    [0.022, 0.018, 0.012],
      dim:   [0.140, 0.085, 0.022],
      mid:   [0.984, 0.580, 0.051],
      dark:  [0.480, 0.260, 0.030],
      light: [1.000, 0.820, 0.420],
    },
    ticker: {
      bg:         'rgba(20, 22, 26, 0.85)',
      head:       [240, 180, 80],
      trail:      [160, 110, 45],
      gold:       [255, 215, 90],
    },
    constellation: {
      ownHalo:     'rgba(255,200,120,VAR)',
      peerCube:    'rgba(255,200,120,VAR)',
      peerHighlight: 'rgba(255,255,240,VAR)',
      connect:     'rgba(255,200,130,VAR)',
      connectHi:   'rgba(255,255,235,VAR)',
    },
    globe: {
      ocean:    'rgb(15, 13, 9)',
      land:     'rgb(245,166,35)',
      landDeep: 'rgba(212,164,55,0.25)',
      polar:    'rgb(220, 200, 170)',
      cities:   'rgb(255, 240, 180)',
    },
      constellationCube: {
      own:  { top: [255,122,0], left: [245,166,35], right: [107,71,16], deep: [53,35,8] },
      peer: { top: [255,169,29], left: [247,147,26], right: [160,95,16], deep: [98,58,10] },
      flash: { ringRgb: [245,166,35], sparkInnerRgb: [255,122,0], idleRingRgb: [71,82,97] },
    },
  },

  galaxy: {
    id: 'galaxy',
    label: 'Galaxy',
    description: 'Cosmic purple + magenta',
    css: {
      '--bg-void':        '#0a0420',
      '--bg-deep':        '#11062e',
      '--bg-surface':     '#15082e',
      '--bg-raised':      '#1d0d40',
      '--bg-elevated':    '#26154e',
      '--amber':          '#C4B5FD',
      '--amber-hot':      '#F472B6',
      '--amber-dim':      '#6B5B95',
      '--btc-orange':     '#F472B6',
      '--btc-orange-glow':'rgba(244,114,182,0.45)',
      '--cyan':           '#67E8F9',
      '--red':            '#FB7185',
      '--green':          '#86EFAC',
    },
    bg: {
      bgBase:    [0.040, 0.018, 0.100],
      blockBase: [0.10, 0.04, 0.20],
      blockPulse:[0.30, 0.10, 0.45],
      blockBevel:[0.12, 0.05, 0.18],
      topRadial: [0.08, 0.04, 0.18],
    },
    lightning: {
      core:  [1.0, 0.95, 1.0],
      glow:  [0.95, 0.55, 0.95],
      bloom: [0.58, 0.18, 0.95],
    },
    nonce: {
      bg:    [0.04, 0.018, 0.10],
      dim:   [0.10, 0.04, 0.20],
      mid:   [0.95, 0.45, 0.72],
      dark:  [0.40, 0.20, 0.55],
      light: [0.95, 0.85, 1.00],
    },
    ticker: {
      bg:    'rgba(20, 15, 40, 0.85)',
      head:  [196, 181, 253],
      trail: [110, 80, 170],
      gold:  [251, 191, 36],
    },
    constellation: {
      ownHalo:     'rgba(244,114,182,VAR)',
      peerCube:    'rgba(196,181,253,VAR)',
      peerHighlight: 'rgba(255,255,255,VAR)',
      connect:     'rgba(196,181,253,VAR)',
      connectHi:   'rgba(251,191,36,VAR)',
    },
    globe: {
      ocean:    'rgb(15, 8, 30)',
      land:     'rgb(196,181,253)',
      landDeep: 'rgba(139,92,246,0.30)',
      polar:    'rgb(230, 220, 255)',
      cities:   'rgb(251, 191, 36)',
    },
      constellationCube: {
      own:  { top: [244,114,182], left: [196,181,253], right: [107,91,149], deep: [53,45,74] },
      peer: { top: [255,131,209], left: [244,114,182], right: [158,74,118], deep: [97,45,72] },
      flash: { ringRgb: [196,181,253], sparkInnerRgb: [244,114,182], idleRingRgb: [71,82,97] },
    },
  },

  matrix: {
    id: 'matrix',
    label: 'Matrix',
    description: 'CRT terminal · pure green',
    css: {
      '--bg-void':        '#000300',
      '--bg-deep':        '#000a02',
      '--bg-surface':     '#001a0d',
      '--bg-raised':      '#002214',
      '--bg-elevated':    '#002a1a',
      '--amber':          '#00FF41',
      '--amber-hot':      '#5EFFCC',
      '--amber-dim':      '#006B0A',
      '--btc-orange':     '#00FF41',
      '--btc-orange-glow':'rgba(0,255,65,0.45)',
      '--cyan':           '#5EFFCC',
      '--red':            '#FF4444',
      '--green':          '#00FF41',
    },
    bg: {
      bgBase:    [0.0, 0.02, 0.005],
      blockBase: [0.0, 0.10, 0.02],
      blockPulse:[0.0, 0.55, 0.10],
      blockBevel:[0.0, 0.06, 0.02],
      topRadial: [0.0, 0.05, 0.01],
    },
    lightning: {
      core:  [1.0, 1.0, 1.0],
      glow:  [0.55, 1.0, 0.55],
      bloom: [0.0, 1.0, 0.25],
    },
    nonce: {
      bg:    [0.0, 0.02, 0.0],
      dim:   [0.0, 0.10, 0.02],
      mid:   [0.0, 1.0, 0.25],
      dark:  [0.0, 0.40, 0.10],
      light: [0.5, 1.0, 0.6],
    },
    ticker: {
      bg:    'rgba(0, 15, 5, 0.85)',
      head:  [0, 255, 65],
      trail: [0, 150, 30],
      gold:  [255, 255, 255],
    },
    constellation: {
      ownHalo:     'rgba(0,255,65,VAR)',
      peerCube:    'rgba(0,255,65,VAR)',
      peerHighlight: 'rgba(255,255,255,VAR)',
      connect:     'rgba(0,255,65,VAR)',
      connectHi:   'rgba(255,255,255,VAR)',
    },
    globe: {
      ocean:    'rgb(0, 10, 4)',
      land:     'rgb(0, 255, 65)',
      landDeep: 'rgba(0,180,40,0.30)',
      polar:    'rgb(180, 255, 200)',
      cities:   'rgb(255, 255, 255)',
    },
      constellationCube: {
      own:  { top: [94,255,204], left: [0,255,65], right: [0,107,10], deep: [0,53,5] },
      peer: { top: [0,255,74], left: [0,255,65], right: [0,165,42], deep: [0,102,26] },
      flash: { ringRgb: [0,255,65], sparkInnerRgb: [94,255,204], idleRingRgb: [71,82,97] },
    },
  },

  synth: {
    id: 'synth',
    label: 'Synthwave',
    description: '80s neon · pink + cyan',
    css: {
      '--bg-void':        '#1a0b3a',
      '--bg-deep':        '#1e0d40',
      '--bg-surface':     '#211048',
      '--bg-raised':      '#2d1b4e',
      '--bg-elevated':    '#382258',
      // v1.11.47 contrast fix: was #FF006E / 4.44 ratio (below AA).
      // Brighter hot pink keeps the 80s neon identity, achieves 4.95 AA.
      '--amber':          '#FF338C',
      '--amber-hot':      '#FFFF00',
      '--amber-dim':      '#5b3d8e',
      '--btc-orange':     '#FF338C',
      '--btc-orange-glow':'rgba(255,51,140,0.55)',
      '--cyan':           '#00F5FF',
      '--red':            '#FF1744',
      '--green':          '#39FF14',
    },
    bg: {
      bgBase:    [0.050, 0.030, 0.120],
      blockBase: [0.18, 0.04, 0.22],
      blockPulse:[0.60, 0.05, 0.40],
      blockBevel:[0.20, 0.04, 0.22],
      topRadial: [0.12, 0.04, 0.20],
    },
    lightning: {
      core:  [1.0, 1.0, 0.0],
      glow:  [1.0, 0.0, 0.43],
      bloom: [0.0, 0.96, 1.0],
    },
    nonce: {
      bg:    [0.05, 0.03, 0.12],
      dim:   [0.18, 0.04, 0.22],
      mid:   [1.0, 0.0, 0.43],
      dark:  [0.55, 0.0, 0.32],
      light: [0.0, 0.96, 1.0],
    },
    ticker: {
      bg:    'rgba(13, 7, 40, 0.85)',
      head:  [0, 245, 255],
      trail: [255, 0, 110],
      gold:  [255, 255, 0],
    },
    constellation: {
      ownHalo:     'rgba(255,0,110,VAR)',
      peerCube:    'rgba(0,245,255,VAR)',
      peerHighlight: 'rgba(255,255,0,VAR)',
      connect:     'rgba(255,0,110,VAR)',
      connectHi:   'rgba(255,255,0,VAR)',
    },
    globe: {
      ocean:    'rgb(13, 7, 32)',
      land:     'rgb(255, 0, 110)',
      landDeep: 'rgba(0,245,255,0.30)',
      polar:    'rgb(255, 230, 250)',
      cities:   'rgb(255, 255, 0)',
    },
      constellationCube: {
      own:  { top: [255,255,0], left: [255,0,110], right: [91,61,142], deep: [45,30,71] },
      peer: { top: [255,0,126], left: [255,0,110], right: [165,0,71], deep: [102,0,44] },
      flash: { ringRgb: [255,0,110], sparkInnerRgb: [255,255,0], idleRingRgb: [71,82,97] },
    },
  },

  arctic: {
    id: 'arctic',
    label: 'Arctic',
    description: 'Cool ice blue · minimal',
    css: {
      '--bg-void':        '#0F1419',
      '--bg-deep':        '#131b25',
      '--bg-surface':     '#171f29',
      '--bg-raised':      '#1f2935',
      '--bg-elevated':    '#283443',
      '--amber':          '#7DD3FC',
      '--amber-hot':      '#E0F2FE',
      '--amber-dim':      '#1E40AF',
      '--btc-orange':     '#7DD3FC',
      '--btc-orange-glow':'rgba(125,211,252,0.45)',
      '--cyan':           '#67E8F9',
      '--red':            '#FCA5A5',
      '--green':          '#6EE7B7',
    },
    bg: {
      bgBase:    [0.058, 0.078, 0.098],
      blockBase: [0.10, 0.16, 0.22],
      blockPulse:[0.30, 0.55, 0.85],
      blockBevel:[0.12, 0.18, 0.24],
      topRadial: [0.06, 0.10, 0.16],
    },
    lightning: {
      core:  [1.0, 1.0, 1.0],
      glow:  [0.49, 0.83, 0.99],
      bloom: [0.12, 0.46, 0.85],
    },
    nonce: {
      bg:    [0.06, 0.08, 0.10],
      dim:   [0.10, 0.16, 0.22],
      mid:   [0.49, 0.83, 0.99],
      dark:  [0.06, 0.25, 0.55],
      light: [0.88, 0.95, 1.0],
    },
    ticker: {
      bg:    'rgba(19, 26, 36, 0.85)',
      head:  [125, 211, 252],
      trail: [55, 110, 160],
      gold:  [253, 230, 138],
    },
    constellation: {
      ownHalo:     'rgba(125,211,252,VAR)',
      peerCube:    'rgba(125,211,252,VAR)',
      peerHighlight: 'rgba(224,242,254,VAR)',
      connect:     'rgba(125,211,252,VAR)',
      connectHi:   'rgba(253,230,138,VAR)',
    },
    globe: {
      ocean:    'rgb(15, 20, 25)',
      land:     'rgb(125, 211, 252)',
      landDeep: 'rgba(56,189,248,0.25)',
      polar:    'rgb(240, 250, 255)',
      cities:   'rgb(253, 230, 138)',
    },
      constellationCube: {
      own:  { top: [224,242,254], left: [125,211,252], right: [30,64,175], deep: [15,32,87] },
      peer: { top: [143,242,255], left: [125,211,252], right: [81,137,163], deep: [50,84,100] },
      flash: { ringRgb: [125,211,252], sparkInnerRgb: [224,242,254], idleRingRgb: [71,82,97] },
    },
  },

  blood: {
    id: 'blood',
    label: 'Blood Moon',
    description: 'Crimson + ember',
    css: {
      '--bg-void':        '#0a0000',
      '--bg-deep':        '#150202',
      '--bg-surface':     '#1a0606',
      '--bg-raised':      '#220808',
      '--bg-elevated':    '#2c0c0c',
      '--amber':          '#FCA5A5',
      '--amber-hot':      '#F59E0B',
      '--amber-dim':      '#7F1D1D',
      // v1.11.47 contrast fix: was #DC2626 / 4.18 ratio (below AA).
      // Brighter ember keeps the "blood" identity but achieves 4.89 AA.
      '--btc-orange':     '#E53E3E',
      '--btc-orange-glow':'rgba(229,62,62,0.50)',
      '--cyan':           '#FCD34D',
      '--red':            '#EF4444',
      '--green':          '#84CC16',
    },
    bg: {
      bgBase:    [0.040, 0.0, 0.0],
      blockBase: [0.20, 0.04, 0.04],
      blockPulse:[0.65, 0.12, 0.04],
      blockBevel:[0.22, 0.05, 0.04],
      topRadial: [0.10, 0.02, 0.01],
    },
    lightning: {
      core:  [1.0, 1.0, 0.85],
      glow:  [1.0, 0.4, 0.15],
      bloom: [0.86, 0.15, 0.15],
    },
    nonce: {
      bg:    [0.06, 0.0, 0.0],
      dim:   [0.20, 0.04, 0.04],
      mid:   [0.86, 0.15, 0.15],
      dark:  [0.50, 0.10, 0.10],
      light: [0.96, 0.62, 0.04],
    },
    ticker: {
      bg:    'rgba(26, 6, 6, 0.85)',
      head:  [220, 38, 38],
      trail: [127, 29, 29],
      gold:  [252, 211, 77],
    },
    constellation: {
      ownHalo:     'rgba(220,38,38,VAR)',
      peerCube:    'rgba(245,158,11,VAR)',
      peerHighlight: 'rgba(252,211,77,VAR)',
      connect:     'rgba(220,38,38,VAR)',
      connectHi:   'rgba(252,211,77,VAR)',
    },
    globe: {
      ocean:    'rgb(15, 0, 0)',
      land:     'rgb(220, 38, 38)',
      landDeep: 'rgba(127,29,29,0.30)',
      polar:    'rgb(252, 211, 77)',
      cities:   'rgb(252, 211, 77)',
    },
      constellationCube: {
      own:  { top: [245,158,11], left: [252,165,165], right: [127,29,29], deep: [63,14,14] },
      peer: { top: [252,43,43], left: [220,38,38], right: [143,24,24], deep: [88,15,15] },
      flash: { ringRgb: [252,165,165], sparkInnerRgb: [245,158,11], idleRingRgb: [71,82,97] },
    },
  },

  paper: {
    id: 'paper',
    label: 'Paper Bright',
    description: 'Blueprint · battery friendly',
    css: {
      '--bg-void':        '#E8EFF5',
      '--bg-deep':        '#DDE6EF',
      '--bg-surface':     '#FFFFFF',
      '--bg-raised':      '#F4F7FB',
      '--bg-elevated':    '#FFFFFF',
      '--amber':          '#1E5C9E',
      '--amber-hot':      '#0D3D7A',
      '--amber-dim':      '#9CB4CC',
      '--btc-orange':     '#1E5C9E',
      '--btc-orange-glow':'rgba(30,92,158,0.30)',
      // v1.11.47 contrast fix: was #0E7490 / 4.25 ratio (below AA).
      // Darker teal achieves 6.63 AA against the light pill bg.
      '--cyan':           '#055569',
      '--red':            '#B91C1C',
      '--green':          '#15803D',
    },
    // v1.11.65: Paper now uses the shared drift-blocks shader in its light
    // (subtractive) branch — see animated-bg-webgl.js uLight. bgBase = paper
    // base; blockBase = the per-channel tint SUBTRACTED inside blocks (more
    // R/G than B, so blocks shift toward blueprint-blue); topRadial = top
    // darken tint. blockPulse/blockBevel are unused by the light branch.
    bg: {
      bgBase:    [0.91, 0.94, 0.96],
      blockBase: [0.28, 0.18, 0.07],
      blockPulse:[0.0, 0.0, 0.0],
      blockBevel:[0.0, 0.0, 0.0],
      topRadial: [0.05, 0.035, 0.015],
    },
    special: 'lightMode',
    lightning: {
      // v1.11.51: white-hot core + Paper Light blue halo, designed to
      // composite against the gray-blue lightning canvas bg (#C9D4E2)
      // set by CSS for [data-theme="paper"]. WebGL shader uses additive
      // blend so we need values bright enough to brighten that bg into a
      // crisp white spike with theme-blue halo around it.
      core:  [1.0, 1.0, 1.0],
      glow:  [0.12, 0.36, 0.62],
      bloom: [0.05, 0.24, 0.50],
      // v1.11.53: tightness multiplier for glow + bloom falloffs. 1.0 is
      // default (used by all dark themes). Higher = sharper bolts. On
      // Paper Light's pale bg the wide soft halos made each bolt segment
      // look like a smeary brush stroke; multiple forks overlapping their
      // halos looked like scribbles. 3.0 cuts the visible halo width to
      // ~1/sqrt(3) ≈ 58% of original, making bolts read as crisp lines.
      tightness: 3.0,
      // v1.11.60: every bolt gets a white-hot core (no darker mini-strikes),
      // so the bolts read uniformly bright on the pale background.
      whiteCore: true,
    },
    nonce: {
      bg:    [0.91, 0.94, 0.96],
      dim:   [0.82, 0.87, 0.93],
      mid:   [0.12, 0.36, 0.62],
      dark:  [0.07, 0.24, 0.48],
      light: [0.30, 0.58, 0.85],
    },
    ticker: {
      bg:    'rgba(232, 239, 245, 0.95)',
      head:  [30, 92, 158],
      trail: [105, 130, 165],
      gold:  [185, 28, 28],
    },
    constellation: {
      ownHalo:     'rgba(30,92,158,VAR)',
      peerCube:    'rgba(30,92,158,VAR)',
      peerHighlight: 'rgba(13,61,122,VAR)',
      connect:     'rgba(105,130,165,VAR)',
      connectHi:   'rgba(185,28,28,VAR)',
    },
    globe: {
      ocean:    'rgb(232, 239, 245)',
      land:     'rgb(30, 92, 158)',
      landDeep: 'rgba(105,130,165,0.4)',
      polar:    'rgb(245, 250, 255)',
      cities:   'rgb(185, 28, 28)',
    },
      constellationCube: {
      own:  { top: [13,61,122], left: [30,92,158], right: [156,180,204], deep: [78,90,102] },
      peer: { top: [34,105,181], left: [30,92,158], right: [19,59,102], deep: [12,36,63] },
      flash: { ringRgb: [30,92,158], sparkInnerRgb: [13,61,122], idleRingRgb: [71,82,97] },
    },
  },

  emerald: {
    id: 'emerald',
    label: 'Emerald',
    description: 'Luxe green + gold',
    css: {
      '--bg-void':        '#051914',
      '--bg-deep':        '#08221c',
      '--bg-surface':     '#0a2e26',
      '--bg-raised':      '#0d3a30',
      '--bg-elevated':    '#11473b',
      '--amber':          '#FCD34D',
      '--amber-hot':      '#FFFFFF',
      '--amber-dim':      '#047857',
      '--btc-orange':     '#10B981',
      '--btc-orange-glow':'rgba(16,185,129,0.45)',
      '--cyan':           '#34D399',
      '--red':            '#FB7185',
      '--green':          '#34D399',
    },
    bg: {
      bgBase:    [0.020, 0.100, 0.080],
      blockBase: [0.04, 0.18, 0.13],
      blockPulse:[0.50, 0.42, 0.10],
      blockBevel:[0.06, 0.18, 0.14],
      topRadial: [0.08, 0.12, 0.08],
    },
    lightning: {
      core:  [1.0, 1.0, 0.95],
      glow:  [0.99, 0.83, 0.30],
      bloom: [0.06, 0.73, 0.51],
    },
    nonce: {
      bg:    [0.02, 0.10, 0.08],
      dim:   [0.04, 0.18, 0.13],
      mid:   [0.99, 0.83, 0.30],
      dark:  [0.02, 0.47, 0.28],
      light: [1.0, 0.92, 0.55],
    },
    ticker: {
      bg:    'rgba(8, 40, 33, 0.85)',
      head:  [252, 211, 77],
      trail: [16, 140, 90],
      gold:  [255, 255, 255],
    },
    constellation: {
      ownHalo:     'rgba(252,211,77,VAR)',
      peerCube:    'rgba(16,185,129,VAR)',
      peerHighlight: 'rgba(255,255,255,VAR)',
      connect:     'rgba(16,185,129,VAR)',
      connectHi:   'rgba(252,211,77,VAR)',
    },
    globe: {
      ocean:    'rgb(5, 25, 20)',
      land:     'rgb(16, 185, 129)',
      landDeep: 'rgba(4,120,87,0.30)',
      polar:    'rgb(245, 255, 250)',
      cities:   'rgb(252, 211, 77)',
    },
      constellationCube: {
      own:  { top: [255,255,255], left: [252,211,77], right: [4,120,87], deep: [2,60,43] },
      peer: { top: [18,212,148], left: [16,185,129], right: [10,120,83], deep: [6,74,51] },
      flash: { ringRgb: [252,211,77], sparkInnerRgb: [255,255,255], idleRingRgb: [71,82,97] },
    },
  },
};

export const THEME_IDS = ['classic', 'galaxy', 'matrix', 'synth', 'arctic', 'blood', 'paper', 'emerald'];
export const DEFAULT_THEME_ID = 'classic';
export const LS_THEME_KEY = 'ss_theme_v1';

export function getThemeById(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME_ID];
}

export function loadTheme() {
  try {
    const v = localStorage.getItem(LS_THEME_KEY);
    if (v && THEMES[v]) return v;
  } catch {}
  return DEFAULT_THEME_ID;
}

export function saveTheme(id) {
  try { localStorage.setItem(LS_THEME_KEY, String(id)); } catch {}
}

// Apply theme by setting the data-theme attribute on <html>. CSS variables
// are defined in global.css under :root[data-theme="..."] blocks. JS does
// not set inline styles — that way the CSS is the single source of truth
// for chrome colors. The theme object's css property here is only used by
// the ThemesTab picker UI to render preview swatches without needing to
// query computed styles.
export function applyThemeCSS(themeId) {
  const theme = getThemeById(themeId);
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme.id);
}

// v1.11.47: update the <meta name="theme-color"> tag so iOS Safari, PWAs,
// and Android task switcher show the theme's primary color in the OS chrome
// (status bar background when SoloStrike is installed to home screen, splash
// screen tint, Chrome tab strip). The tag exists in index.html with a static
// default (#F5A623); we mutate its content attribute at runtime so it follows
// the active theme. Falls back to creating the meta tag if missing.
//
// Choosing the color: theme.css['--amber'] is the primary accent in every
// theme. For Paper Light (light mode), we want a darker accent that reads
// well as a status bar background, so we use the deeper blueprint blue.
export function applyThemeColorMeta(themeId) {
  if (typeof document === 'undefined') return;
  const theme = getThemeById(themeId);
  // Every theme's --amber is engineered to read well as a status bar
  // background (Paper Light's --amber is already a deep blueprint blue
  // #1E5C9E; the dark themes use bright accents that contrast with white
  // OS text). Fallback to Classic amber on any unexpected error.
  const color = (theme && theme.css && theme.css['--amber']) || '#F5A623';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}
