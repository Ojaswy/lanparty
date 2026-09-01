/** Tiny WebAudio square-wave blips. Off by default; toggled from the taskbar. */

type Kind = "pass" | "fail" | "boot" | "click";

class Sound {
  enabled = false;
  private ctx: AudioContext | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    try {
      this.enabled = localStorage.getItem("lanparty.sound") === "1";
    } catch {
      /* ignore */
    }
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem("lanparty.sound", this.enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.enabled) this.play("click");
    for (const l of this.listeners) l();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.06, type: OscillatorType = "square"): void {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(ac.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  play(kind: Kind): void {
    if (!this.enabled) return;
    const ac = this.ac();
    if (!ac) return;
    const t = ac.currentTime;
    switch (kind) {
      case "pass":
        this.tone(ac, 523, t, 0.08);
        this.tone(ac, 659, t + 0.09, 0.08);
        this.tone(ac, 784, t + 0.18, 0.16);
        break;
      case "fail":
        this.tone(ac, 220, t, 0.12);
        this.tone(ac, 165, t + 0.13, 0.22);
        break;
      case "click":
        this.tone(ac, 880, t, 0.04, 0.04);
        break;
      case "boot": {
        // dial-up-ish: a couple of tones then a burst of noise
        this.tone(ac, 1200, t, 0.08, 0.04, "sine");
        this.tone(ac, 1600, t + 0.1, 0.08, 0.04, "sine");
        const len = Math.floor(ac.sampleRate * 0.25);
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = 0.03;
        src.connect(g).connect(ac.destination);
        src.start(t + 0.2);
        break;
      }
    }
  }
}

export const sound = new Sound();
