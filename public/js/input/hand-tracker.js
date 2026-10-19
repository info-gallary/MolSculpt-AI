// Webcam hand tracking with MediaPipe Hand Landmarker (21 landmarks / hand).
// Frames are processed on-device (WebAssembly + GPU); they are never drawn,
// stored or uploaded. Only landmark coordinates leave this module.

const VERSION = '0.10.35';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.running = false;
    this.landmarker = null;
    this.stream = null;
    this.delegate = null;
    this.stats = { fps: 0, inferMs: 0, frames: 0 };
    this.lastVideoTime = -1;
    this.lastFrameAt = 0;
  }

  async start() {
    if (!window.isSecureContext) throw new Error('Camera access needs https:// or http://localhost');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera API');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    if (!this.landmarker) {
      this.dispatchEvent(new CustomEvent('status', { detail: 'Loading hand model…' }));
      this.landmarker = await this.createLandmarker();
    }
    this.running = true;
    this.schedule();
  }

  async createLandmarker() {
    const { FilesetResolver, HandLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      const lm = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
      return lm;
    } catch {
      const lm = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
      return lm;
    }
  }

  schedule() {
    if (!this.running) return;
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(() => this.step());
    else requestAnimationFrame(() => this.step());
  }

  step() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      let result = null;
      try { result = this.landmarker.detectForVideo(v, t0); } catch { result = null; }
      const t1 = performance.now();
      const s = this.stats;
      s.inferMs = s.frames ? s.inferMs * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
      if (this.lastFrameAt) s.fps = s.fps * 0.9 + (1000 / Math.max(1, t1 - this.lastFrameAt)) * 0.1;
      this.lastFrameAt = t1;
      s.frames++;
      const handed = result?.handedness ?? result?.handednesses;
      this.dispatchEvent(new CustomEvent('frame', {
        detail: {
          landmarks: result?.landmarks?.[0] ?? null,
          handedness: handed?.[0]?.[0]?.categoryName ?? null,
          score: handed?.[0]?.[0]?.score ?? null,
          t: t1,
          aspect: v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3,
        },
      }));
    }
    this.schedule();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
