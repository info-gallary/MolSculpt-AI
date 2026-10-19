// Builds the IEEE-style term paper (DOCX) from the figures and measured results.
// Usage: NODE_PATH=<dir containing docx> node paper/build_paper.cjs
/* eslint-disable max-len */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  SectionType, BorderStyle, ShadingType, LevelFormat, Footer, PageNumber, TabStopType, VerticalAlign,
  HorizontalPositionRelativeFrom, HorizontalPositionAlign, VerticalPositionRelativeFrom, VerticalPositionAlign, TextWrappingType,
} = require('docx');

const FIG = path.join(__dirname, 'figures');
const OUT = path.join(__dirname, 'Term_Paper_23BCE370_23BCE093.docx');

// ------------------------------------------------------------ page geometry (A4)
const PAGE = { width: 11906, height: 16838 };
const MARGIN = { top: 1080, bottom: 1300, left: 1008, right: 1008 };
const TEXT_W = PAGE.width - MARGIN.left - MARGIN.right; // 9890 dxa
const GAP = 360;
const COL_W = Math.floor((TEXT_W - GAP) / 2); // 4765 dxa
const FONT = 'Times New Roman';

// ------------------------------------------------------------ inline markup
// **bold**, *italic*, ^{sup}, _{sub}, `mono`, [[hl]] (yellow highlight)
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\^\{[^}]+\}|_\{[^}]+\}|`[^`]+`|\[\[[^\]]+\]\])/g;
  let last = 0;
  let m;
  const push = (t, extra = {}) => out.push(new TextRun({ text: t, font: FONT, ...base, ...extra }));
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('*')) push(tok.slice(1, -1), { italics: true });
    else if (tok.startsWith('^{')) push(tok.slice(2, -1), { superScript: true });
    else if (tok.startsWith('_{')) push(tok.slice(2, -1), { subScript: true });
    else if (tok.startsWith('`')) push(tok.slice(1, -1), { font: 'Consolas', size: (base.size ?? 20) - 2 });
    else push(tok.slice(2, -2), { highlight: 'yellow' });
    last = m.index + tok.length;
  }
  if (last < text.length) push(text.slice(last));
  return out;
}

const body = (text, opts = {}) => new Paragraph({
  children: runs(text, { size: 20 }),
  alignment: AlignmentType.JUSTIFIED,
  indent: opts.noIndent ? undefined : { firstLine: 202 },
  spacing: { after: 0, line: 240 },
});

let secNo = 0;
let subNo = 0;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const heading = (title) => {
  subNo = 0;
  const label = `${ROMAN[secNo++]}. ${title}`;
  return new Paragraph({
    children: [new TextRun({ text: label, font: FONT, size: 20, smallCaps: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 90 },
    keepNext: true,
  });
};
const sub = (title) => new Paragraph({
  children: [new TextRun({ text: `${String.fromCharCode(65 + subNo++)}. ${title}`, font: FONT, size: 20, italics: true })],
  spacing: { before: 120, after: 50 },
  keepNext: true,
});

const bullets = (items) => items.map((t) => new Paragraph({
  children: runs(t, { size: 20 }),
  numbering: { reference: 'bullets', level: 0 },
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 20, line: 240 },
}));

// Display equation: centred with a right-aligned number "(n)".
let eqNo = 0;
const eq = (text) => new Paragraph({
  children: [
    new TextRun({ text: '\t', font: FONT }),
    ...runs(text, { size: 19, italics: true }),
    new TextRun({ text: `\t(${++eqNo})`, font: FONT, size: 20 }),
  ],
  tabStops: [{ type: TabStopType.CENTER, position: Math.floor(COL_W / 2) }, { type: TabStopType.RIGHT, position: COL_W }],
  spacing: { before: 60, after: 60 },
});

function figure(num, file, widthPx, caption, { full = false } = {}) {
  const buf = fs.readFileSync(path.join(FIG, file));
  const { w, h } = pngSize(buf);
  const height = Math.round((widthPx * h) / w);
  return [
    new Paragraph({
      children: [new ImageRun({ type: 'png', data: buf, transformation: { width: widthPx, height } })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 40 },
      keepNext: true,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Fig. ${num}. `, font: FONT, size: 16 }), ...runs(caption, { size: 16 })],
      alignment: full ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
      spacing: { after: 140 },
    }),
  ];
}
// Page-wide figure (caption baked into the PNG) floating at the top of the page.
function floating(file) {
  const buf = fs.readFileSync(path.join(FIG, file));
  const { w, h } = pngSize(buf);
  const width = Math.round((TEXT_W / 1440) * 96);
  return new ImageRun({
    type: 'png',
    data: buf,
    transformation: { width, height: Math.round((width * h) / w) },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.CENTER },
      verticalPosition: { relative: VerticalPositionRelativeFrom.MARGIN, align: VerticalPositionAlign.TOP },
      wrap: { type: TextWrappingType.TOP_AND_BOTTOM },
      margins: { bottom: 182880 },
    },
  });
}
const bodyWithFloat = (file, text) => new Paragraph({
  children: [floating(file), ...runs(text, { size: 20 })],
  alignment: AlignmentType.JUSTIFIED,
  indent: { firstLine: 202 },
  spacing: { after: 0, line: 240 },
});

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

let tabNo = 0;
const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
function table(title, header, rows, widths, { total = COL_W, fontSize = 15 } = {}) {
  const scale = total / widths.reduce((s, x) => s + x, 0);
  const cw = widths.map((x) => Math.floor(x * scale));
  cw[cw.length - 1] = total - cw.slice(0, -1).reduce((s, x) => s + x, 0);
  const cell = (text, i, isHead, isLast) => new TableCell({
    width: { size: cw[i], type: WidthType.DXA },
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: isHead ? thin : none,
      bottom: isHead || isLast ? thin : none,
      left: none,
      right: none,
    },
    shading: isHead ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EDEFF2' } : undefined,
    children: [new Paragraph({
      children: runs(String(text), { size: fontSize, bold: isHead }),
      alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
      spacing: { after: 0, line: 220 },
    })],
  });
  const t = new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: cw,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true, false)) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => cell(c, i, false, ri === rows.length - 1)) })),
    ],
  });
  return [
    new Paragraph({
      children: [new TextRun({ text: `TABLE ${ROMAN[tabNo++]}`, font: FONT, size: 16 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 0 },
      keepNext: true,
    }),
    new Paragraph({
      children: [new TextRun({ text: title, font: FONT, size: 16, smallCaps: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      keepNext: true,
    }),
    t,
    new Paragraph({ children: [], spacing: { after: 100 } }),
  ];
}

// ------------------------------------------------------------ data
const esol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evaluation', 'results', 'esol_summary.json'), 'utf8'));
const bench = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evaluation', 'results', 'benchmark_summary.json'), 'utf8'));
const lat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evaluation', 'results', 'agent_tool_latency.json'), 'utf8'));
const euro = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evaluation', 'results', 'one_euro.json'), 'utf8'));
const pct = (x) => `${x.toFixed(x === 100 ? 0 : 2)}%`;
const totals = lat.runs.map((r) => r.total_ms);
const meanTotal = (totals.reduce((a, b) => a + b, 0) / totals.length / 1000).toFixed(1);
const minTotal = (Math.min(...totals) / 1000).toFixed(1);
const maxTotal = (Math.max(...totals) / 1000).toFixed(1);
const t = lat.per_tool;
const fo = euro.rows.find((r) => r.min_cutoff_hz === 1.2);

// ------------------------------------------------------------ front matter
const title = new Paragraph({
  children: [new TextRun({ text: 'MolSculpt: A Touchless Hand-Gesture Interface for Building Organic Molecules with a Tool-Using AI Agent for Compound Characterisation', font: FONT, size: 46 })],
  alignment: AlignmentType.CENTER,
  spacing: { after: 220, line: 260 },
});

const authorCell = (name, roll) => new TableCell({
  width: { size: Math.floor(TEXT_W / 2), type: WidthType.DXA },
  borders: { top: none, bottom: none, left: none, right: none },
  children: [
    new Paragraph({ children: [new TextRun({ text: name, font: FONT, size: 22 })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: `Roll No. ${roll}`, font: FONT, size: 20, bold: true })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: 'Department of Computer Science and Engineering', font: FONT, size: 20, italics: true })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: 'Institute of Technology, Nirma University', font: FONT, size: 20 })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: 'Ahmedabad, Gujarat, India', font: FONT, size: 20 })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: `${roll.toLowerCase()}@nirmauni.ac.in`, font: FONT, size: 18 })], alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
  ],
});
const authors = new Table({
  width: { size: TEXT_W, type: WidthType.DXA },
  columnWidths: [Math.floor(TEXT_W / 2), TEXT_W - Math.floor(TEXT_W / 2)],
  rows: [new TableRow({ children: [authorCell('Nisarg Vashi', '23BCE370'), authorCell('Heli Shah', '23BCE093')] })],
});

const abstractText = `Molecular editors used in chemistry education and early-stage drug discovery remain bound to the mouse and keyboard. We present MolSculpt, a browser-based system in which users construct organic molecules with bare-hand mid-air gestures captured by an ordinary webcam, and then delegate the characterisation of the drawn compound to a tool-using large-language-model (LLM) agent served by Groq. Hand tracking runs on-device with MediaPipe and the camera image is never displayed or transmitted. The interaction design targets the known weaknesses of mid-air input (low precision, unintended activation and arm fatigue) through pinch selection with hysteresis, hold gestures gated on hand stillness, speed-adaptive 1€ filtering, a reach box that raises the control–display gain, enlarged activation areas, angle and atom snapping, a radial element menu and continuous feedforward. A modality-independent editor lets gestures, mouse, touch and voice drive identical operations. An in-browser cheminformatics engine written for this work recomputes properties after every edit; on the ${esol.n_compared} molecules of the ESOL data set it reproduces the RDKit values of molecular formula, molecular weight, Crippen logP, molar refractivity, topological polar surface area, hydrogen-bond counts, rotatable bonds and aromatic rings exactly, with a median analysis time of ${esol.js_median_analysis_ms.toFixed(2)} ms. The agent follows a reason-and-act loop over six tools (local descriptors, PubChem identity, similarity and hazard retrieval, structural alerts and drug-likeness rules), streams its trace to the user and returns a schema-validated report whose suggested analogues are re-checked locally and can be loaded back onto the canvas. We report technical and analytical evaluations and contribute an instrumented protocol for a comparative user study.`;

const abstract = new Paragraph({
  children: [new TextRun({ text: 'Abstract—', font: FONT, size: 18, bold: true, italics: true }), new TextRun({ text: abstractText, font: FONT, size: 18, bold: true })],
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 100 },
});
const indexTerms = new Paragraph({
  children: [new TextRun({ text: 'Index Terms—', font: FONT, size: 18, bold: true, italics: true }), new TextRun({ text: 'human–computer interaction, mid-air gestures, hand tracking, natural user interfaces, multimodal interaction, molecular editing, cheminformatics, LLM agents, drug discovery.', font: FONT, size: 18, bold: true })],
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 120 },
});

// ------------------------------------------------------------ sections
const S1 = [
  heading('Introduction'),
  body('Drawing chemical structures is a basic activity in chemistry teaching and in medicinal chemistry, where ideas for new compounds are sketched, evaluated and iterated. Mainstream molecular editors such as JSME [28] follow the WIMP paradigm: a palette of elements, a mouse for placing atoms and bonds, and menus for everything else. This works well at a desk, but there are settings where a touchless alternative is attractive: shared kiosks and laboratory benches where users wear gloves, classrooms where a teacher demonstrates at a projected screen away from the keyboard, and users for whom fine mouse control is difficult. Commodity webcams combined with on-device hand-landmark models [1], [2] have made bare-hand input feasible without gloves, markers or depth sensors [3], [4].'),
  body('Mid-air input has well-documented problems. Without a physical button there is no clean separation between looking or pointing and acting, the "Midas touch" problem first described for gaze [5]; tracked hands jitter and drift; and holding the arm up quickly causes fatigue [6]. Structure drawing magnifies these problems because atoms and bonds must be placed precisely and in large numbers.'),
  body('A second need arises once a structure is drawn: users want to know what it is and whether it is interesting. Is it a known compound? Is it drug-like? Is it hazardous? Answering these questions requires several calculations and database look-ups. Language-model agents that call external tools [21], [22] have been applied to chemistry [23], [24] and can orchestrate such steps and explain the result in natural language, but they may hallucinate and their reasoning is opaque. For an interactive system this raises the human–AI interaction questions of transparency, verifiability and control [20].'),
  body('This paper presents **MolSculpt**, which addresses both needs in one interface. Our contributions are:'),
  ...bullets([
    'An interaction design for touchless structure construction that combines a small gesture vocabulary with assistive techniques against imprecision, accidental activation and fatigue (Section III).',
    'A modality-independent editing model through which hand gestures, mouse, touch, keyboard and voice drive the same operations, with feedforward previews and valence-aware error prevention (Sections III–V).',
    'A dependency-free in-browser cheminformatics engine that agrees exactly with RDKit [27] on 1,128 molecules for all reported descriptors except two cage ring counts (Section VI-A).',
    'ChemAgent, a tool-grounded agent on Groq whose every step is streamed to the user, whose report is schema-validated and whose suggested analogues are verified locally and can be loaded back for further editing (Section V-D).',
    'A technical and analytical evaluation (validity, responsiveness, filter characteristics, Fitts\'s-law and heuristic analyses) and built-in instrumentation for a comparative user study (Section VI).',
  ]),
];

const S2 = [
  heading('Related Work'),
  sub('Molecular editors and immersive molecular interaction'),
  body('Line notations such as SMILES [26] and toolkits such as RDKit [27] underpin most chemistry software, and web editors such as JSME [28] brought structure drawing to the browser. Immersive systems let users manipulate molecules in virtual reality, for example interactive molecular dynamics with tracked controllers [29]. Most such systems focus on visualising and manipulating existing three-dimensional structures, whereas MolSculpt targets authoring new two-dimensional structures with an ordinary webcam.'),
  sub('Vision-based hand-gesture interaction'),
  body('Surveys of vision-based gesture recognition [3], [4] list robustness, gesture vocabulary design and user fatigue as recurring challenges. MediaPipe [2] and its hand-landmark pipeline [1] provide 21 three-dimensional landmarks per hand in real time on commodity hardware. Wobbrock et al. showed the value of designing gesture sets around users\' expectations [13]. Jacob\'s analysis of the Midas-touch problem [5] motivates explicit confirmation gestures and dwell thresholds, and consumed endurance [6] quantifies the arm fatigue of mid-air interaction. For noisy pointing input, the 1€ filter [7] adapts its cut-off frequency to speed. Target acquisition follows Fitts\'s law [8], [9]; enlarging the activation area of targets, as in the bubble cursor [10], and pie menus that place options at equal short distances [11] reduce the index of difficulty. Bolt\'s "Put-that-there" [12] combined pointing with speech, which we also support.'),
  sub('LLM agents and cheminformatics for drug discovery'),
  body('ReAct interleaves reasoning traces with actions [21] and Toolformer showed that models can learn to call tools [22]. ChemCrow augmented an LLM with expert chemistry tools [23] and Coscientist planned and executed experiments autonomously [24]. Groq serves open-weight models on its LPU, a tensor-streaming architecture designed for low-latency inference [40], [41], [45], which matters when an agent is part of an interactive loop. The tools in our agent implement established medicinal-chemistry heuristics: Lipinski\'s rule of five [32], the Veber [33], Egan [34] and Ghose [35] filters, lead-likeness [36], Wildman–Crippen logP [30], topological polar surface area (TPSA) [31], ESOL solubility [37], and Brenk [38] and PAINS [39] structural alerts. Identity, similarity and hazard data come from PubChem [25].'),
];

const S3 = [
  heading('Interaction Design'),
  sub('Design goals'),
  body('From the target settings and the limitations above we derived eight design goals:'),
  ...bullets([
    '**DG1 Hardware-free:** a laptop webcam suffices; no gloves, markers or depth camera.',
    '**DG2 Precision from imprecise input:** the system, not the user, makes drawings tidy.',
    '**DG3 No accidental activation:** resting or moving the hand must never trigger a command.',
    '**DG4 Low physical effort:** small hand movements, a rest pose and short sessions.',
    '**DG5 Continuous feedback and feedforward:** users should see what a gesture will do before doing it [15].',
    '**DG6 Privacy by design:** video stays on the device and is not even shown by default.',
    '**DG7 Transparent, verifiable AI:** agent steps visible, claims grounded in tools, output checked.',
    '**DG8 Multimodal fallback:** every action is also available by mouse, touch, keyboard or voice.',
  ]),
  sub('Gesture vocabulary'),
  body('The vocabulary (Table I) is deliberately small. A single manipulative gesture, the thumb–index pinch, plays the role of the mouse button and is the closest analogue to grasping. Four static poses map to frequent commands with familiar meanings: thumbs-up for "go", a fist for grabbing and moving, victory for undo, and three raised fingers for the radial element menu (Fig. 5). The open palm, the most natural rest posture, is mapped to nothing at all, so users can relax at any time (DG3, DG4). Commands fire only after a pose has been held while the hand is still, and dwell clicking is restricted to explicit controls; dwell is never active on the canvas, where an accidental activation would modify the molecule.'),
  ...table('Gesture vocabulary of MolSculpt',
    ['Gesture', 'Recognition rule', 'Action'],
    [
      ['Point / move', 'thumb–index midpoint, filtered', 'move cursor; hover preview'],
      ['Pinch tap', 'd < 0.30 then d > 0.44', 'place atom, grow chain, cycle bond, press control'],
      ['Pinch drag', 'pinch held while moving', 'draw bond (snapped), move atom, erase'],
      ['Three fingers', 'index, middle, ring extended; 0.65 s still', 'radial element menu at cursor'],
      ['Victory ✌', 'index, middle extended; 0.7 s still', 'undo (repeats every 0.9 s)'],
      ['Thumbs-up 👍', 'fingers curled, thumb up; 0.9 s still', 'analyse with ChemAgent'],
      ['Fist ✊', 'all fingers curled, 0.15 s', 'grab and pan canvas'],
      ['Open palm ✋', 'all fingers extended', 'rest (no action)'],
      ['Dwell', 'cursor on control for 0.9 s', 'click control (UI only)'],
    ],
    [2.1, 3.2, 3.3]),
  sub('Compensating for imprecise mid-air input'),
  body('Several mechanisms move precision from the hand into the system (DG2). The cursor is the midpoint of the thumb and index tips rather than the index tip, so it barely moves when the fingers close into a pinch, and the press and release points are taken from the cursor history 70 ms earlier. A *reach box* maps the central 60% of the camera image to the full screen, raising the control–display gain to 1/0.6 ≈ 1.67 relative to the camera field and reducing the arm travel needed to cross the screen (DG4). Atoms have an activation radius of 30 px in hand mode (18 px with the mouse) although they are drawn with a radius of 11.5 px, an expansion in the spirit of the bubble cursor [10]. Bonds are drawn with a fixed length and snap to multiples of 30°; their end snaps magnetically to an existing atom within 40 px, which also makes ring closure easy. Pinching an atom of the selected element grows the chain in the best free direction, alternating sides so that chains zig-zag as in textbook drawings; most acyclic molecules can therefore be built by repeated pinching on the newest atom with no dragging at all. Ring templates fuse onto an atom or bond on the side away from existing substituents and choose a Kekulé pattern compatible with the double bonds already present.'),
  body('Error prevention follows the chemistry. Before adding a bond or increasing its order the editor checks the valence of both atoms and refuses with an explanatory toast and an error earcon; bond-order cycling skips orders that would break a valence. Changes that are still allowed but leave an atom over-valent (e.g. replacing a carbon by an oxygen) are flagged with a dashed red ring and a message in the properties panel. A nitro group drawn in the common pentavalent form is silently interpreted in its charge-separated form.'),
  sub('Feedback and feedforward'),
  bodyWithFloat('float-arch.png', 'The overlay draws the cursor in distinct states (hovering, pinched, capturing a drag, panning), a ring that fills during dwell, and a larger labelled ring that fills while a hold gesture is being recognised, so the user can abort by moving or changing pose. A semi-transparent *virtual hand* rendered from the landmarks follows the cursor, and a mini-map shows the hand skeleton inside the reach box, giving users a sense of where their hand is in the camera field without showing any video (DG6). On the canvas, a ghost atom marks where a pinch would place an atom, and hovering an atom previews the bond a pinch would grow; when drawing, the snapped bond and target atom are shown dashed before release. Earcons and short toasts confirm each recognised action. The properties panel is recomputed after every edit and supports brushing and linking: hovering a functional group or structural alert highlights its atoms on the canvas (Fig. 1).'),
  sub('Human–AI collaboration'),
  body('The agent is never invoked implicitly; it runs when the user holds a thumbs-up, presses the button or says "analyse". While it works, every tool call and result is streamed into a trace with timings, and after completion the trace collapses under the heading "How this answer was produced" so that the report stays prominent but the provenance remains one click away (DG7). The system prompt requires every number and identifier to come from a tool and every prediction to be labelled as such, and treats tool output as data rather than instructions. Suggested analogues are parsed by the local engine; invalid or unchanged structures are discarded, and the remainder are shown with their property changes and a button that loads them onto the canvas, closing a mixed-initiative design loop. Follow-up questions can be asked in a chat that keeps the report as context. Synthesis information is kept conceptual, and the agent declines to provide synthesis information for hazardous or controlled substances.'),
];

const S4 = [
  heading('System Architecture'),
  body('MolSculpt is a web application with a small local server (Fig. 2). Everything that touches the camera runs in the browser: the MediaPipe Hand Landmarker (WebAssembly with a GPU delegate and a CPU fallback) produces landmarks, the gesture interpreter turns them into a filtered cursor and discrete events, and the hand controller routes these either to the editor (when over the canvas) or to user-interface controls. Mouse and touch events, keyboard shortcuts and Web Speech commands are routed to the same editor interface. The cheminformatics engine is a set of plain ECMAScript modules imported both by the browser and by the server, so the numbers shown in the panel and those seen by the agent are identical. The Node.js server has no third-party dependencies; it serves the application, keeps the Groq API key out of the browser and runs the agent, streaming its events with Server-Sent Events. Without a key, a deterministic pipeline runs the same tools and produces a template report.'),
];

const S5a = [
  heading('Implementation'),
  sub('Hand tracking and gesture recognition'),
  bodyWithFloat('float-pipeline.png', 'Landmarks *L*_{0}…*L*_{20} are mirrored horizontally and their *x* coordinates scaled by the image aspect ratio so that distances are isotropic. With the palm scale *s* = ‖*L*_{0} − *L*_{9}‖ (wrist to middle-finger knuckle), the pinch measure and the extension ratio of finger *f* are'),
  eq('d = ‖L_{4} − L_{8}‖ / s,     ρ_{f} = ‖L_{0} − L_{tip(f)}‖ / ‖L_{0} − L_{mcp(f)}‖.'),
  body('A finger counts as extended for ρ_{f} > 1.5 and curled for ρ_{f} < 1.3. A pinch begins when *d* < θ = 0.30 and the index finger is not curled (ρ_{index} > 1.15, which rejects the thumb resting on a fist) and ends when *d* > θ + 0.14; either transition must persist for two frames. The pipeline is summarised in Fig. 3. The pointer *p* (thumb–index midpoint) is mapped from the reach box of width *r* to screen coordinates'),
  eq('X = W · clamp((p_{x} − (0.5 − r/2)) / r, 0, 1),'),
  body('and analogously for *Y* with height 0.9*r*, then smoothed by the 1€ filter [7], an exponential smoother whose cut-off rises with the filtered speed:'),
  eq('x̂_{i} = α x_{i} + (1 − α) x̂_{i−1},   α = 1 / (1 + 1/(2π f_{c} T_{e})),'),
  eq('f_{c} = f_{min} + β |dx̂/dt|,'),
  body('where *T*_{e} is the frame period. We use *f*_{min} = 1.2 Hz (user-adjustable) and β = 0.012. A pose must be classified identically for three consecutive frames before it becomes current; its hold timer restarts whenever the cursor moves faster than 420 px/s. If the hand disappears for more than 250 ms during a pinch, the drag is cancelled and the molecule restored rather than committed.'),
];

const S5b = [
  sub('Modality-independent editor'),
  body('All modalities drive five calls (hover, down, move, up, cancel) plus commands (undo, redo, tool and element selection, fit, analyse). Their meaning depends on the active tool: *draw* (tap to place or grow, drag to bond, tap a bond to cycle its order), *ring*, *move* (drag atoms or pan), *erase* (tap or scrub) and *charge*. Every committed change pushes a snapshot onto a 150-step undo history and is logged with its modality, which is what makes the study instrumentation of Section VI-F possible. Hit radii and snapping distances are larger when the last input came from the hand.'),
  sub('Cheminformatics engine'),
  body('Molecules are graphs of atoms and Kekulé bonds. Implicit hydrogens follow a valence model in which charged atoms take the valences of their isoelectronic neighbour (e.g. N^{+} behaves like C). Rings are perceived as a symmetrised smallest set of smallest rings, selected from Horton candidate cycles [42] by Gaussian elimination over GF(2). Aromaticity follows RDKit\'s model: each ring atom is assigned the number of π electrons it can donate, single rings and combinations of fused rings are tested against Hückel\'s 4*n* + 2 rule, and only perimeter bonds of fused combinations become aromatic. A SMILES parser [26] kekulises aromatic input by backtracking matching, and the writer orders atoms by Morgan-like ranks [43]. A compact SMARTS matcher (atomic primitives, logic operators, ring closures and recursive SMARTS) evaluates the 101 Wildman–Crippen atom types [30] (logP and molar refractivity), RDKit\'s strict rotatable-bond definition, 47 functional-group patterns and 20 structural alerts adapted from [38], [39]. TPSA follows Ertl et al. [31]; ESOL [37] is computed as log *S* = 0.16 − 0.63 clogP − 0.0062 MW + 0.066 RB − 0.74 AP. A Weisfeiler–Lehman graph signature [44] recognises when the canvas matches a target molecule, independently of drawing order and Kekulé form. A 2-D layout routine places imported or suggested structures; the 37 library molecules use RDKit depictions.'),
  sub('ChemAgent'),
  body('The agent runs a reason-and-act loop [21] (Fig. 4) against Groq\'s OpenAI-compatible chat-completions endpoint with function calling. The default model is `openai/gpt-oss-120b` [41]; any tool-capable Groq model can be selected. Each round sends the conversation and six tool schemas (Table II); tool calls returned in one round are executed in parallel and their JSON results (at most 6 kB each) are appended. After at most six rounds, or as soon as the model stops calling tools, its final message must be a JSON report with 16 fields: name, IUPAC name, PubChem CID, class, summary, key characteristics, physicochemical interpretation, drug-likeness verdict and explanation, biological activity, applications, safety level and notes, a conceptual synthesis idea, up to three suggested analogues, confidence and caveats. If the message is not valid JSON, one more call in JSON mode is made. The server normalises the report (types, lengths, allowed values, fallbacks computed from the local rules) and validates analogues as described above. The PubChem lookup resolves each structure to the lowest CID sharing its InChIKey, which avoids landing on duplicate tautomer records, and the hazard tool reports only GHS statements given by at least half of the notifiers, because PubChem aggregates rare notifications that would otherwise overstate hazards. Temperature is 0.2; latency and token usage of every run are logged. Fig. 6 shows the resulting report card.'),
  ...table('Tools available to ChemAgent',
    ['Tool', 'Source', 'Returns'],
    [
      ['compute_descriptors', 'local engine', 'formula, MW, logP, TPSA, HBD/HBA, rings, Fsp3, ESOL, groups'],
      ['pubchem_lookup', 'PubChem PUG-REST', 'CID, name, IUPAC, XLogP, synonyms, descriptions'],
      ['find_similar_compounds', 'PubChem 2-D similarity', 'up to five known analogues'],
      ['check_structural_alerts', 'local SMARTS', 'alerts with severity and rationale'],
      ['assess_drug_likeness', 'local rules', 'Ro5, Veber, Egan, Ghose, lead-likeness, verdict'],
      ['get_safety_data', 'PubChem PUG-View', 'predominant GHS hazard statements, level'],
    ],
    [2.4, 2.0, 3.6]),
  sub('Study instrumentation'),
  body('A study mode presents timed construction tasks, shows the target structure and ends each trial automatically when the graph signature of the canvas equals that of the target. For every trial it stores completion time and counts of edits, undos, erasures, warnings, pinches, dwell clicks, gesture commands, menu selections, cancelled drags and tracking losses, together with the modalities used. The System Usability Scale [18] and the raw NASA-TLX [19] are administered in the application, and all data can be exported as CSV and JSON (Fig. 9).'),
];

const S6 = [
  heading('Evaluation'),
  body(`We evaluated what can be measured without participants: the validity of the chemistry, the responsiveness of the system, the behaviour of the gesture logic, and analytical (Fitts's-law and heuristic) assessments. Measurements were taken on a laptop with an Intel Core i5-13450HX, 24 GB RAM and an NVIDIA RTX 3050 laptop GPU under Windows 11, using Node.js 22.7 and RDKit ${esol.rdkit_version}. A user study is designed but has not yet been run (Section VI-F).`),
  sub('Validity of the cheminformatics engine'),
  body(`We compared the engine against RDKit on two sets: a curated benchmark of ${bench.n_compared} molecules (simple organics, heteroaromatics and drugs such as atorvastatin, imatinib and morphine) and all ${esol.n_compared} molecules of the public ESOL solubility data set [37]. Every SMILES was parsed successfully. Table III shows that formula, heavy atoms, hydrogen-bond donors and acceptors (Lipinski definitions), rotatable bonds and aromatic rings agree for every molecule, and that molecular weight, exact mass, Crippen logP, molar refractivity, TPSA and fraction of sp^{3} carbons agree to four decimal places (Fig. 7). The only disagreements are the ring counts of two polychlorinated cage compounds (Kepone and Mirex), for which RDKit's symmetrisation heuristic reports one ring more than the cyclomatic number. All SMILES written by the engine re-parse in RDKit to the same canonical structure (stereochemistry is outside the scope of the editor).`),
  ...table('Agreement of MolSculpt with RDKit',
    ['Descriptor', `Benchmark (n = ${bench.n_compared})`, `ESOL set (n = ${esol.n_compared})`],
    [
      ['Molecular formula', pct(bench.exact_agreement_pct.formula), pct(esol.exact_agreement_pct.formula)],
      ['Heavy atoms', pct(bench.exact_agreement_pct.heavy_atoms), pct(esol.exact_agreement_pct.heavy_atoms)],
      ['H-bond donors / acceptors', pct(bench.exact_agreement_pct.hbd), pct(esol.exact_agreement_pct.hbd)],
      ['Rotatable bonds', pct(bench.exact_agreement_pct.rotb), pct(esol.exact_agreement_pct.rotb)],
      ['Rings (SSSR)', pct(bench.exact_agreement_pct.rings), pct(esol.exact_agreement_pct.rings)],
      ['Aromatic rings', pct(bench.exact_agreement_pct.aromatic_rings), pct(esol.exact_agreement_pct.aromatic_rings)],
      ['SMILES round trip', pct(bench.exact_agreement_pct.roundtrip), pct(esol.exact_agreement_pct.roundtrip)],
      ['MW, exact mass (max |Δ|)', '< 0.0001', '< 0.0001'],
      ['Crippen logP, MR (max |Δ|)', '< 0.0001', '< 0.0001'],
      ['TPSA, Fsp3 (max |Δ|)', '< 0.0001', '< 0.0001'],
    ],
    [3.2, 2.2, 2.2]),
  ...figure(7, 'plot-agreement.png', 300, `Crippen logP and TPSA computed by MolSculpt versus RDKit for the ${esol.n_compared} ESOL molecules; all points lie on the identity line.`),
  body(`The ESOL equation evaluated with our Crippen logP predicts measured solubility with RMSE ${esol.esol_vs_measured.molsculpt_esol.rmse.toFixed(2)} log units and R^{2} = ${esol.esol_vs_measured.molsculpt_esol.r2.toFixed(3)} (Fig. 8), compared with RMSE ${esol.esol_vs_measured.published_esol.rmse.toFixed(2)} and R^{2} = ${esol.esol_vs_measured.published_esol.r2.toFixed(3)} for the published ESOL predictions, which use a different logP model. The estimate is therefore suitable for the coarse solubility classes the interface shows, not for quantitative prediction.`),
  ...figure(8, 'plot-esol.png', 270, 'ESOL solubility computed by MolSculpt versus measured aqueous solubility (ESOL data set).'),
  sub('Responsiveness'),
  body(`Nielsen's response-time limits [17] require feedback within about 0.1 s for direct manipulation and within 1 s to keep the flow of thought, while about 10 s is the limit for keeping attention on a task. A full analysis (perception, descriptors, groups, alerts, SMILES and signature) takes a median ${esol.js_median_analysis_ms.toFixed(2)} ms and a mean ${esol.js_mean_analysis_ms.toFixed(2)} ms per molecule on the ESOL set, so the properties panel updates within the same frame as each gesture. Table IV lists the latency of each agent tool for ten structures (eight drugs and two hypothetical analogues) with an empty cache. Local tools take at most ${Math.max(t.compute_descriptors.max_ms, t.check_structural_alerts.max_ms, t.assess_drug_likeness.max_ms)} ms; network calls to PubChem dominate. The complete deterministic pipeline took ${meanTotal} s on average (${minTotal}–${maxTotal} s) and identified all eight drugs, while both hypothetical structures were reported as unregistered and triggered the similarity search. LLM inference adds to this; it is logged per run but was not measured here because no Groq key was used during development. Because the agent's latency can exceed the 1 s limit, the streamed trace provides continuous progress feedback.`),
  ...table('Latency of agent tools (ms, n = 10 structures, cold cache)',
    ['Tool', 'Mean', 'Median', 'Max'],
    [
      ['compute_descriptors', t.compute_descriptors.mean_ms, t.compute_descriptors.median_ms, t.compute_descriptors.max_ms],
      ['check_structural_alerts', t.check_structural_alerts.mean_ms, t.check_structural_alerts.median_ms, t.check_structural_alerts.max_ms],
      ['assess_drug_likeness', t.assess_drug_likeness.mean_ms, t.assess_drug_likeness.median_ms, t.assess_drug_likeness.max_ms],
      ['pubchem_lookup', t.pubchem_lookup.mean_ms, t.pubchem_lookup.median_ms, t.pubchem_lookup.max_ms],
      [`get_safety_data (n = ${t.get_safety_data.n})`, t.get_safety_data.mean_ms, t.get_safety_data.median_ms, t.get_safety_data.max_ms],
      [`find_similar_compounds (n = ${t.find_similar_compounds.n})`, t.find_similar_compounds.mean_ms, t.find_similar_compounds.median_ms, t.find_similar_compounds.max_ms],
    ],
    [3.6, 1.2, 1.2, 1.2]),
  body('Hand-tracking throughput depends on the camera and GPU of the user\'s machine and is displayed live in the interface (frames per second and inference time per frame); it should be reported from the participants\' sessions rather than from our headless test environment, whose software rendering is not representative.'),
];

const S6b = [
  sub('Behaviour of the gesture logic'),
  body('The interaction logic is covered by 30 automated tests (14 for the chemistry engine, 11 for gestures and voice, 5 for the server and an agent loop driven by a scripted mock of the Groq API). The gesture tests feed synthetic 21-point hands and verify that: static poses are classified correctly; a pinch produces exactly one press and one release and a single noisy frame is ignored; holding a victory pose still fires undo exactly once, whereas the same pose with a moving hand fires nothing; 120 frames of an open palm trigger no command; losing the hand during a pinch cancels the drag; and the reach box yields the intended control–display gain. These tests verify the logic, not recognition accuracy on real hands, which depends on MediaPipe and on users.'),
  body(`Table V characterises the cursor filter on a synthetic 30 Hz signal with uniform ±5 px jitter (raw SD ${euro.raw_jitter_sd_px} px). At the default setting the filter removes ${fo.jitter_reduction_pct}% of the jitter while lagging only ${fo.lag_px_at_1200px_s} px behind a hand moving at 1200 px/s; a fixed low-pass filter with the same cut-off (β = 0) would lag ${fo.lag_px_at_1200px_s_no_beta} px. This combination of steadiness at rest and responsiveness in motion is the reason for using the 1€ filter.`),
  ...table('Cursor filter: jitter and lag (synthetic, 30 Hz)',
    ['f_min (Hz)', 'Jitter SD (px)', 'Reduction', 'Lag @300 px/s', 'Lag @1200 px/s', 'Lag, β = 0'],
    euro.rows.map((r) => [r.min_cutoff_hz, r.jitter_sd_px, `${r.jitter_reduction_pct}%`, r.lag_px_at_300px_s, r.lag_px_at_1200px_s, r.lag_px_at_1200px_s_no_beta]),
    [1.1, 1.2, 1.1, 1.2, 1.3, 1.1], { fontSize: 14 }),
  sub('Fitts\'s-law analysis'),
  body('Movement time grows linearly with the index of difficulty ID = log_{2}(D/W + 1) [8], [9]. Without fitting device constants, Table VI compares the ID of key selections in the interface geometry (1440 × 900 window). Expanding the activation area of atoms from the drawn 23 px to 60 px lowers the ID of selecting an atom 200 px away by 35%, and magnetic snapping lowers the ID of hitting a bond end further. Choosing an element from the radial menu, which opens at the cursor with eight slices about 70 px wide at a radius of 89 px, has an ID of 1.18 bits, versus 3.88 bits for travelling from the canvas centre to the palette, and it avoids the return trip to the canvas. The thumbs-up gesture replaces a 3.7-bit pointing movement to the analyse button by a 0.9 s hold that requires no pointing.'),
  ...table('Index of difficulty of selected interactions',
    ['Interaction', 'D (px)', 'W (px)', 'ID (bits)'],
    [
      ['Atom, drawn size', 200, 23, '3.28'],
      ['Atom, hand activation area', 200, 60, '2.12'],
      ['Bond end with magnetic snap', 200, 80, '1.81'],
      ['Element: palette from canvas centre', 606, 44, '3.88'],
      ['Element: radial menu at cursor', 89, 70, '1.18'],
      ['Analyse button from canvas centre', 651, 54, '3.71'],
    ],
    [3.6, 1.1, 1.1, 1.1]),
  sub('Heuristic evaluation'),
  body('We reviewed the design against Nielsen\'s ten heuristics [16]. Table VII lists the main supporting features and the open issues we found. Because the reviewers are also the designers, this assessment is preliminary and must be complemented by independent evaluators and users.'),
  ...table('Heuristic review (summary)',
    ['Heuristic', 'Supporting features', 'Open issue'],
    [
      ['Visibility of status', 'pose chip, fps/latency, cursor states, progress rings, live trace', 'tracking quality shown only as present/absent'],
      ['Match with real world', 'pinch = grasp, fist = grab, 👍 = go; CPK colours', 'three-finger menu pose is arbitrary'],
      ['User control', 'undo by ✌, cancel on hand loss, rest pose, Esc', 'no multi-atom selection'],
      ['Consistency', 'one editor for all modalities; same radial menu by gesture and right-click', 'F = fluorine, Shift+F = fit'],
      ['Error prevention', 'valence checks, snapping, stillness gating, no dwell on canvas', 'element change may still over-valence'],
      ['Recognition vs recall', 'gesture legend, ghost previews, menu shows options', 'poses must be learned once'],
      ['Flexibility', 'keyboard, voice, tap-to-grow, rings, library, SMILES import', 'no user-defined fragments'],
      ['Minimalist design', 'camera hidden, collapsible trace', 'dense right panel'],
      ['Error recovery', 'red markers with explanations, refusal toasts', 'no automatic repair suggestion'],
      ['Help', 'first-use gesture guide, tooltips, README', 'no interactive tutorial'],
    ],
    [2.1, 3.6, 2.6], { fontSize: 14 }),
  sub('User-study protocol'),
  body('The planned study compares hand-gesture input with the mouse in a within-subjects design with counterbalanced order and at least 12 participants with basic chemistry knowledge. After a five-minute familiarisation with the gesture guide, each participant performs tasks T1–T5 of increasing complexity (ethanol, acetone, benzene, acetic acid, paracetamol) in each condition, then completes SUS [18] and raw NASA-TLX [19]; a short interview collects qualitative feedback, and a final task asks participants to analyse their paracetamol with ChemAgent and rate their trust in the report. The application records all measures automatically (Fig. 9). We will test completion time and error counts with paired *t*-tests or Wilcoxon signed-rank tests (α = 0.05), and report SUS against the commonly used benchmark of 68. We expect the mouse to be faster for the more complex tasks (H1), error counts to be comparable thanks to the assistive techniques (H2), SUS above 68 for the gesture condition (H3) and higher physical demand for gestures (H4).'),
  ...figure(9, 'fig-study.png', 290, 'Built-in study mode: participant and condition, tasks T1–T5 with automatic completion detection, SUS and NASA-TLX questionnaires, and export of trials and logs.'),
];

const S7 = [
  heading('Discussion and Limitations'),
  body('The evaluation establishes that the system computes what it displays correctly and fast enough for direct manipulation, and that its interaction logic behaves as designed. It does not yet show that people can build molecules faster, more accurately or more comfortably by hand than with a mouse; we in fact expect the mouse to be faster for experienced users at a desk. The value of the gesture interface lies in situations where the mouse is unavailable or undesirable, and in its suitability for demonstration and teaching.'),
  body('Several limitations remain. Gesture thresholds were set by hand and may need personal calibration; recognition depends on lighting, background and MediaPipe\'s robustness across hands and skin tones. Mid-air use remains tiring over long sessions despite the reach box and the rest pose [6]. The editor is two-dimensional and does not represent stereochemistry. The language model can still produce inaccurate statements; grounding, labelling of predictions, schema validation and the visible trace reduce but do not eliminate this risk, so reports are advisory and should be checked by a chemist. The PubChem hazard data are aggregated notifications and the ESOL estimate is coarse. Voice recognition relies on the browser\'s cloud speech service, unlike hand tracking, which is entirely local.'),
  body('Future work includes the user study described above, two-handed gestures for zooming and rotating, gaze-plus-pinch selection, learned and personalised pose classifiers, stereochemistry and three-dimensional conformer views, additional agent tools such as retrosynthesis planning with safety filtering, and evaluation with users with motor impairments.'),
];

const S8 = [
  heading('Conclusion'),
  body('MolSculpt shows that a commodity webcam, on-device hand tracking and careful interaction design are sufficient for building organic molecules in mid air, and that a tool-grounded LLM agent can turn the drawn structure into an explained characterisation within seconds. The key design decisions were a minimal gesture vocabulary with a safe rest pose, hold gestures gated on stillness, assistive snapping and target expansion, continuous feedforward, a single editing model shared by all modalities, a local chemistry engine that matches RDKit exactly, and an agent whose evidence and reasoning steps remain visible to the user. The instrumented study mode makes the planned comparison with conventional input straightforward to run.'),
];

const REFS = [
  'F. Zhang, V. Bazarevsky, A. Vakunov, A. Tkachenka, G. Sung, C.-L. Chang, and M. Grundmann, "MediaPipe Hands: On-device real-time hand tracking," arXiv:2006.10214, 2020.',
  'C. Lugaresi et al., "MediaPipe: A framework for building perception pipelines," arXiv:1906.08172, 2019.',
  'J. P. Wachs, M. Kölsch, H. Stern, and Y. Edan, "Vision-based hand-gesture applications," *Commun. ACM*, vol. 54, no. 2, pp. 60–71, 2011.',
  'S. S. Rautaray and A. Agrawal, "Vision based hand gesture recognition for human computer interaction: A survey," *Artif. Intell. Rev.*, vol. 43, no. 1, pp. 1–54, 2015.',
  'R. J. K. Jacob, "What you look at is what you get: Eye movement-based interaction techniques," in *Proc. CHI \'90*, 1990, pp. 11–18.',
  'J. D. Hincapié-Ramos, X. Guo, P. Moghadasian, and P. Irani, "Consumed endurance: A metric to quantify arm fatigue of mid-air interactions," in *Proc. CHI \'14*, 2014, pp. 1063–1072.',
  'G. Casiez, N. Roussel, and D. Vogel, "1€ filter: A simple speed-based low-pass filter for noisy input in interactive systems," in *Proc. CHI \'12*, 2012, pp. 2527–2530.',
  'P. M. Fitts, "The information capacity of the human motor system in controlling the amplitude of movement," *J. Exp. Psychol.*, vol. 47, no. 6, pp. 381–391, 1954.',
  'I. S. MacKenzie, "Fitts\' law as a research and design tool in human-computer interaction," *Hum.-Comput. Interact.*, vol. 7, no. 1, pp. 91–139, 1992.',
  'T. Grossman and R. Balakrishnan, "The bubble cursor: Enhancing target acquisition by dynamic resizing of the cursor\'s activation area," in *Proc. CHI \'05*, 2005, pp. 281–290.',
  'J. Callahan, D. Hopkins, M. Weiser, and B. Shneiderman, "An empirical comparison of pie vs. linear menus," in *Proc. CHI \'88*, 1988, pp. 95–100.',
  'R. A. Bolt, "\'Put-that-there\': Voice and gesture at the graphics interface," *Comput. Graph.*, vol. 14, no. 3, pp. 262–270, 1980.',
  'J. O. Wobbrock, M. R. Morris, and A. D. Wilson, "User-defined gestures for surface computing," in *Proc. CHI \'09*, 2009, pp. 1083–1092.',
  'B. Shneiderman, "Direct manipulation: A step beyond programming languages," *Computer*, vol. 16, no. 8, pp. 57–69, 1983.',
  'D. A. Norman, *The Design of Everyday Things*, rev. ed. New York, NY, USA: Basic Books, 2013.',
  'J. Nielsen, "Enhancing the explanatory power of usability heuristics," in *Proc. CHI \'94*, 1994, pp. 152–158.',
  'J. Nielsen, *Usability Engineering*. Boston, MA, USA: Academic Press, 1993.',
  'J. Brooke, "SUS: A \'quick and dirty\' usability scale," in *Usability Evaluation in Industry*, P. W. Jordan, B. Thomas, B. A. Weerdmeester, and I. L. McClelland, Eds. London, U.K.: Taylor & Francis, 1996, pp. 189–194.',
  'S. G. Hart and L. E. Staveland, "Development of NASA-TLX (Task Load Index): Results of empirical and theoretical research," *Adv. Psychol.*, vol. 52, pp. 139–183, 1988.',
  'S. Amershi et al., "Guidelines for human-AI interaction," in *Proc. CHI \'19*, 2019, paper 3, pp. 1–13.',
  'S. Yao, J. Zhao, D. Yu, N. Du, I. Shafran, K. Narasimhan, and Y. Cao, "ReAct: Synergizing reasoning and acting in language models," in *Proc. ICLR*, 2023.',
  'T. Schick et al., "Toolformer: Language models can teach themselves to use tools," in *Proc. NeurIPS*, 2023.',
  'A. M. Bran, S. Cox, O. Schilter, C. Baldassari, A. D. White, and P. Schwaller, "Augmenting large language models with chemistry tools," *Nat. Mach. Intell.*, vol. 6, pp. 525–535, 2024.',
  'D. A. Boiko, R. MacKnight, B. Kline, and G. Gomes, "Autonomous chemical research with large language models," *Nature*, vol. 624, pp. 570–578, 2023.',
  'S. Kim et al., "PubChem 2023 update," *Nucleic Acids Res.*, vol. 51, no. D1, pp. D1373–D1380, 2023.',
  'D. Weininger, "SMILES, a chemical language and information system. 1. Introduction to methodology and encoding rules," *J. Chem. Inf. Comput. Sci.*, vol. 28, no. 1, pp. 31–36, 1988.',
  'G. Landrum et al., "RDKit: Open-source cheminformatics," version 2026.09.1. [Online]. Available: https://www.rdkit.org',
  'B. Bienfait and P. Ertl, "JSME: A free molecule editor in JavaScript," *J. Cheminform.*, vol. 5, art. 24, 2013.',
  'M. O\'Connor et al., "Sampling molecular conformations and dynamics in a multiuser virtual reality framework," *Sci. Adv.*, vol. 4, no. 6, art. eaat2731, 2018.',
  'S. A. Wildman and G. M. Crippen, "Prediction of physicochemical parameters by atomic contributions," *J. Chem. Inf. Comput. Sci.*, vol. 39, no. 5, pp. 868–873, 1999.',
  'P. Ertl, B. Rohde, and P. Selzer, "Fast calculation of molecular polar surface area as a sum of fragment-based contributions and its application to the prediction of drug transport properties," *J. Med. Chem.*, vol. 43, no. 20, pp. 3714–3717, 2000.',
  'C. A. Lipinski, F. Lombardo, B. W. Dominy, and P. J. Feeney, "Experimental and computational approaches to estimate solubility and permeability in drug discovery and development settings," *Adv. Drug Deliv. Rev.*, vol. 23, no. 1–3, pp. 3–25, 1997.',
  'D. F. Veber, S. R. Johnson, H.-Y. Cheng, B. R. Smith, K. W. Ward, and K. D. Kopple, "Molecular properties that influence the oral bioavailability of drug candidates," *J. Med. Chem.*, vol. 45, no. 12, pp. 2615–2623, 2002.',
  'W. J. Egan, K. M. Merz, and J. J. Baldwin, "Prediction of drug absorption using multivariate statistics," *J. Med. Chem.*, vol. 43, no. 21, pp. 3867–3877, 2000.',
  'A. K. Ghose, V. N. Viswanadhan, and J. J. Wendoloski, "A knowledge-based approach in designing combinatorial or medicinal chemistry libraries for drug discovery. 1. A qualitative and quantitative characterization of known drug databases," *J. Comb. Chem.*, vol. 1, no. 1, pp. 55–68, 1999.',
  'S. J. Teague, A. M. Davis, P. D. Leeson, and T. Oprea, "The design of leadlike combinatorial libraries," *Angew. Chem. Int. Ed.*, vol. 38, no. 24, pp. 3743–3748, 1999.',
  'J. S. Delaney, "ESOL: Estimating aqueous solubility directly from molecular structure," *J. Chem. Inf. Comput. Sci.*, vol. 44, no. 3, pp. 1000–1005, 2004.',
  'R. Brenk et al., "Lessons learnt from assembling screening libraries for drug discovery for neglected diseases," *ChemMedChem*, vol. 3, no. 3, pp. 435–444, 2008.',
  'J. B. Baell and G. A. Holloway, "New substructure filters for removal of pan assay interference compounds (PAINS) from screening libraries and for their exclusion in bioassays," *J. Med. Chem.*, vol. 53, no. 7, pp. 2719–2740, 2010.',
  'D. Abts et al., "Think fast: A tensor streaming processor (TSP) for accelerating deep learning workloads," in *Proc. ISCA*, 2020, pp. 145–158.',
  'OpenAI, "gpt-oss-120b & gpt-oss-20b model card," Aug. 2025.',
  'J. D. Horton, "A polynomial-time algorithm to find the shortest cycle basis of a graph," *SIAM J. Comput.*, vol. 16, no. 2, pp. 358–366, 1987.',
  'H. L. Morgan, "The generation of a unique machine description for chemical structures—A technique developed at Chemical Abstracts Service," *J. Chem. Doc.*, vol. 5, no. 2, pp. 107–113, 1965.',
  'B. Weisfeiler and A. Leman, "The reduction of a graph to a canonical form and the algebra which appears therein," *Nauchno-Tekhnicheskaya Informatsia*, ser. 2, no. 9, pp. 12–16, 1968.',
  'Groq, "GroqCloud documentation: Supported models." [Online]. Available: https://console.groq.com/docs/models (accessed Oct. 2026).',
];

const refHeading = new Paragraph({
  children: [new TextRun({ text: 'References', font: FONT, size: 20, smallCaps: true })],
  alignment: AlignmentType.CENTER,
  spacing: { before: 200, after: 80 },
  keepNext: true,
});
const refs = REFS.map((r, i) => new Paragraph({
  children: [new TextRun({ text: `[${i + 1}]\t`, font: FONT, size: 16 }), ...runs(r, { size: 16 })],
  tabStops: [{ type: TabStopType.LEFT, position: 400 }],
  indent: { left: 400, hanging: 400 },
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 20, line: 220 },
}));

// ------------------------------------------------------------ assemble
const pageProps = { page: { size: PAGE, margin: MARGIN } };
const twoCol = { ...pageProps, type: SectionType.CONTINUOUS, column: { count: 2, space: GAP, equalWidth: true } };
const footer = { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 })] })] }) };

const doc = new Document({
  creator: 'Nisarg Vashi (23BCE370), Heli Shah (23BCE093)',
  title: 'MolSculpt term paper',
  description: 'HCI term paper: touchless hand-gesture molecule builder with a Groq-powered agent',
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 200 } } } }],
    }],
  },
  sections: [
    {
      properties: { ...pageProps, column: { count: 1 } },
      footers: footer,
      children: [
        title,
        authors,
        ...figure(1, 'fig-hud.png', 640, 'MolSculpt with hand tracking: the user holds a victory pose (the orange ring shows the hold progress towards undo), a virtual hand follows the cursor, the mini-map shows the hand skeleton inside the reach box without any camera image, and the properties panel updates live. The hand in this figure is rendered from synthetic landmarks for illustration.', { full: true }),
      ],
    },
    {
      properties: twoCol,
      footers: footer,
      children: [
        abstract, indexTerms, ...S1, ...S2, ...S3, ...S4, ...S5a, ...S5b,
        ...figure(4, 'diagram-loop.png', 250, 'ChemAgent reason-and-act loop with streamed trace.'),
        ...figure(5, 'crop-radial.png', 250, 'Radial element menu opened at the cursor (three-finger hold or right-click); the hovered slice fills as the dwell progresses.'),
        ...figure(6, 'crop-report-head.png', 250, 'Report card of the AI Chemist for caffeine (deterministic mode shown).'),
        ...S6, ...S6b, ...S7, ...S8, refHeading, ...refs,
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`wrote ${OUT}`);
});
