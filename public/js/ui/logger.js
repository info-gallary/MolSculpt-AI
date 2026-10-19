// Interaction logger: every editing action and recognised gesture is recorded
// with a timestamp and the modality that produced it. The study module
// aggregates these events into per-trial metrics.

class InteractionLog extends EventTarget {
  constructor() {
    super();
    this.modality = 'mouse';
    this.events = [];
  }

  log(type, data = {}) {
    const e = { t: Math.round(performance.now()), wall: new Date().toISOString(), modality: data.modality ?? this.modality, type, ...data };
    this.events.push(e);
    if (this.events.length > 20000) this.events.splice(0, 5000);
    this.dispatchEvent(new CustomEvent('event', { detail: e }));
    return e;
  }
}

export const logger = new InteractionLog();
