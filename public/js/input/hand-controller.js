// Routes interpreted hand input: pinches on the canvas become editor pointer
// events, pinches or dwell on UI controls become clicks, hold gestures become
// commands, and a fist pans the canvas. Owns the tracker and interpreter.

import { HandTracker } from './hand-tracker.js';
import { GestureInterpreter } from './gestures.js';
import { settings } from '../ui/settings.js';
import { logger } from '../ui/logger.js';

const CLICKABLE = 'button, [role="tab"], a[href], .tpl, label.check';

export class HandController extends EventTarget {
  constructor({ editor, canvas, video, hud, menu }) {
    super();
    this.editor = editor;
    this.canvas = canvas;
    this.hud = hud;
    this.menu = menu;
    this.tracker = new HandTracker(video);
    this.gestures = new GestureInterpreter(
      () => ({ reach: settings.get('reach'), smoothing: settings.get('smoothing'), pinch: settings.get('pinch') }),
      () => ({ w: innerWidth, h: innerHeight }),
    );
    this.active = false;
    this.state = null;
    this.capture = false;
    this.pressed = null;
    this.hoverEl = null;
    this.dwell = { el: null, start: 0, progress: 0, cooldown: null };
    this.lastPalm = null;
    this.aspect = 4 / 3;

    this.tracker.addEventListener('frame', (e) => this.onFrame(e.detail));
    this.tracker.addEventListener('status', (e) => this.dispatchEvent(new CustomEvent('status', { detail: e.detail })));
    this.gestures.addEventListener('down', (e) => this.onDown(e.detail));
    this.gestures.addEventListener('up', (e) => this.onUp(e.detail));
    this.gestures.addEventListener('cancel', () => this.onCancel('pinch lost'));
    this.gestures.addEventListener('lost', () => { this.onCancel('hand lost'); logger.log('hand-lost', { modality: 'hand' }); this.emitStatus(); });
    this.gestures.addEventListener('found', () => { logger.log('hand-found', { modality: 'hand' }); this.emitStatus(); });
    this.gestures.addEventListener('command', (e) => this.onCommand(e.detail));
  }

  async start() {
    await this.tracker.start();
    this.active = true;
    this.emitStatus();
  }

  stop() {
    this.tracker.stop();
    this.active = false;
    this.onCancel('stopped');
    this.gestures.reset();
    this.state = null;
    this.hud.draw(null, { menu: this.menu });
    this.emitStatus();
  }

  emitStatus() { this.dispatchEvent(new CustomEvent('status-change')); }

  local(p) {
    const r = this.canvas.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }

  elementAt(p) { return document.elementFromPoint(p.x, p.y); }

  useHand() {
    this.editor.modality = 'hand';
    logger.modality = 'hand';
  }

  onFrame(frame) {
    this.aspect = frame.aspect;
    const st = this.gestures.process(frame);
    this.state = st;
    if (st.present) {
      this.useHand();
      this.route(st);
    }
    this.hud.draw(st, {
      dwell: this.dwell.el ? this.dwell : null,
      menu: this.menu,
      virtualHand: settings.get('virtualHand'),
      capture: this.capture,
      aspect: this.aspect,
    });
    if (settings.get('minimap')) this.hud.drawMinimap(st, settings.get('reach'));
    this.dispatchEvent(new CustomEvent('frame', { detail: st }));
  }

  route(st) {
    const p = { x: st.x, y: st.y };
    if (this.menu.active) {
      const chosen = this.menu.update(p.x, p.y);
      if (chosen) this.chooseMenu(chosen, 'dwell');
      this.setHover(null);
      return;
    }
    if (st.grabbing) {
      if (this.lastPalm) this.editor.panBy(st.palm.x - this.lastPalm.x, st.palm.y - this.lastPalm.y);
      this.lastPalm = st.palm;
      return;
    }
    this.lastPalm = null;
    if (this.capture) {
      this.editor.pointerMove(this.local(p));
      return;
    }
    const el = this.elementAt(p);
    if (el === this.canvas) {
      this.setHover(null);
      this.editor.pointerMove(this.local(p));
      return;
    }
    if (this.editor.hover || this.editor.ghost) {
      this.editor.hover = null;
      this.editor.ghost = null;
      this.editor.render();
    }
    this.setHover(el);
    this.updateDwell(el, st);
  }

  setHover(el) {
    const target = el?.closest?.(`${CLICKABLE}, .chips button`) ?? null;
    if (target === this.hoverEl) return;
    this.hoverEl?.classList.remove('dwell-hover');
    this.hoverEl?.dispatchEvent(new CustomEvent('hand-leave'));
    this.hoverEl = target;
    target?.classList.add('dwell-hover');
    target?.dispatchEvent(new CustomEvent('hand-enter'));
  }

  updateDwell(el, st) {
    const d = this.dwell;
    const target = st.pinching ? null : el?.closest?.('[data-dwell]') ?? null;
    if (target && (target.disabled || target === d.cooldown)) { d.el = null; d.progress = 0; return; }
    if (!target) { d.el = null; d.progress = 0; d.cooldown = null; return; }
    const now = performance.now();
    if (target !== d.el) { d.el = target; d.start = now; d.cooldown = null; }
    d.progress = Math.min(1, (now - d.start) / settings.get('dwellMs'));
    if (d.progress >= 1) {
      logger.log('dwell-click', { modality: 'hand', target: target.id || target.textContent.trim().slice(0, 30) });
      target.click();
      d.cooldown = target;
      d.el = null;
      d.progress = 0;
      this.dispatchEvent(new CustomEvent('click-feedback'));
    }
  }

  onDown(p) {
    this.useHand();
    logger.log('pinch-down', { modality: 'hand' });
    if (this.menu.active) {
      const i = this.menu.indexAt(p.x, p.y);
      if (i >= 0) this.chooseMenu(this.menu.items[i], 'pinch');
      else { this.menu.close(); logger.log('menu-close', { modality: 'hand' }); }
      return;
    }
    const el = this.elementAt(p);
    if (el === this.canvas) {
      this.capture = true;
      this.editor.pointerDown(this.local(p));
    } else {
      this.pressed = el?.closest?.(CLICKABLE) ?? null;
    }
  }

  onUp(p) {
    logger.log('pinch-up', { modality: 'hand' });
    if (this.capture) {
      this.capture = false;
      this.editor.pointerUp(this.local(p));
      return;
    }
    const el = this.elementAt(p)?.closest?.(CLICKABLE);
    if (this.pressed && el === this.pressed && !this.pressed.disabled) {
      logger.log('pinch-click', { modality: 'hand', target: el.id || el.textContent.trim().slice(0, 30) });
      el.click();
      this.dwell.cooldown = el;
      this.dispatchEvent(new CustomEvent('click-feedback'));
    }
    this.pressed = null;
  }

  onCancel(reason) {
    if (this.capture) {
      this.capture = false;
      this.editor.pointerCancel();
      logger.log('drag-cancelled', { modality: 'hand', reason });
    }
    this.pressed = null;
    this.dwell.el = null;
    this.setHover(null);
  }

  onCommand({ name }) {
    logger.log('gesture-command', { modality: 'hand', command: name });
    if (name === 'grab-start') { this.onCancel('grab'); this.lastPalm = null; return; }
    if (name === 'grab-end') { this.lastPalm = null; return; }
    if (name === 'menu') {
      if (this.capture || document.querySelector('dialog[open]')) return;
      const s = this.state ?? { x: innerWidth / 2, y: innerHeight / 2 };
      this.menu.open(s.x, s.y);
      logger.log('menu-open', { modality: 'hand' });
      return;
    }
    this.dispatchEvent(new CustomEvent('command', { detail: { name } }));
  }

  chooseMenu(item, how) {
    this.menu.close();
    logger.log('menu-select', { modality: 'hand', element: item.key, how });
    this.dispatchEvent(new CustomEvent('menu-select', { detail: item }));
  }
}
