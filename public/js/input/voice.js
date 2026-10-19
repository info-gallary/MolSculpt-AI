// Voice commands via the Web Speech API (Chrome / Edge). Complements gestures
// in the spirit of Bolt's "Put-that-there": point with the hand, name the
// element or action with the voice.

const ELEMENT_WORDS = {
  carbon: 'C', nitrogen: 'N', oxygen: 'O', hydrogen: 'H', sulfur: 'S', sulphur: 'S',
  phosphorus: 'P', phosphorous: 'P', fluorine: 'F', chlorine: 'Cl', bromine: 'Br', iodine: 'I',
};

const PATTERNS = [
  [/\b(single)\b/, { type: 'bond', value: 1 }],
  [/\b(double)\b/, { type: 'bond', value: 2 }],
  [/\b(triple)\b/, { type: 'bond', value: 3 }],
  [/\b(benzene|phenyl|aromatic ring)\b/, { type: 'ring', value: 'benzene' }],
  [/\b(cyclohexane|six ring)\b/, { type: 'ring', value: 'cyclohexane' }],
  [/\b(cyclopentane|five ring)\b/, { type: 'ring', value: 'cyclopentane' }],
  [/\b(undo|go back)\b/, { type: 'command', value: 'undo' }],
  [/\b(redo)\b/, { type: 'command', value: 'redo' }],
  [/\b(clear|reset canvas)\b/, { type: 'command', value: 'clear' }],
  [/\b(analy[sz]e|characteri[sz]e|what is this)\b/, { type: 'command', value: 'analyze' }],
  [/\b(read|speak) (the )?(report|summary)\b/, { type: 'command', value: 'read' }],
  [/\b(fit|center|centre)\b/, { type: 'command', value: 'fit' }],
  [/\b(erase|eraser|delete|remove)\b/, { type: 'tool', value: 'erase' }],
  [/\b(move|drag)\b/, { type: 'tool', value: 'move' }],
  [/\b(draw|pen)\b/, { type: 'tool', value: 'draw' }],
  [/\b(charge)\b/, { type: 'tool', value: 'charge' }],
  [/\b(library|templates)\b/, { type: 'command', value: 'library' }],
  [/\b(help|guide)\b/, { type: 'command', value: 'help' }],
];

/** Map a transcript to zero or more commands. Exported for tests. */
export function parseVoice(transcript) {
  const text = ` ${transcript.toLowerCase().replace(/[^a-z ]/g, ' ')} `;
  const out = [];
  for (const [word, el] of Object.entries(ELEMENT_WORDS)) {
    if (text.includes(` ${word} `)) out.push({ type: 'element', value: el, word });
  }
  for (const [re, cmd] of PATTERNS) if (re.test(text)) out.push({ ...cmd, word: text.match(re)[0].trim() });
  return out;
}

export class VoiceControl extends EventTarget {
  constructor() {
    super();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(SR);
    this.enabled = false;
    if (!SR) return;
    this.rec = new SR();
    this.rec.lang = 'en-US';
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const transcript = e.results[i][0].transcript;
        const commands = parseVoice(transcript);
        this.dispatchEvent(new CustomEvent('heard', { detail: { transcript, commands } }));
      }
    };
    this.rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.enabled = false;
        this.dispatchEvent(new CustomEvent('error', { detail: 'Microphone permission denied' }));
      }
    };
    // Chrome ends recognition after silence; restart while enabled.
    this.rec.onend = () => { if (this.enabled) { try { this.rec.start(); } catch { /* already started */ } } };
  }

  start() {
    if (!this.supported) throw new Error('Speech recognition is not supported in this browser');
    this.enabled = true;
    try { this.rec.start(); } catch { /* already running */ }
  }

  stop() {
    this.enabled = false;
    try { this.rec?.stop(); } catch { /* not running */ }
  }
}
