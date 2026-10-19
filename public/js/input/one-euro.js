// 1€ filter (G. Casiez, N. Roussel, D. Vogel, CHI 2012): an adaptive low-pass
// filter whose cut-off rises with speed, so the cursor is steady when the hand
// is still (low jitter) yet responsive when it moves fast (low lag).

class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

const smoothing = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.tPrev = null;
  }

  /** @param {number} value  @param {number} t timestamp in seconds */
  filter(value, t) {
    if (this.tPrev === null) {
      this.tPrev = t;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const derivative = (value - this.x.y) / dt;
    const edx = this.dx.filter(derivative, smoothing(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, smoothing(cutoff, dt));
  }
}

export class OneEuroFilter2D {
  constructor(opts) {
    this.fx = new OneEuroFilter(opts);
    this.fy = new OneEuroFilter(opts);
  }

  set minCutoff(v) { this.fx.minCutoff = v; this.fy.minCutoff = v; }

  reset() { this.fx.reset(); this.fy.reset(); }

  filter(x, y, t) { return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) }; }
}
