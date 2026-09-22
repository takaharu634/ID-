"use client";

export type UiSound = "click" | "slide" | "pop" | "success";

type AudioWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (audioContext && audioContext.state !== "closed") return audioContext;
  const audioWindow = window as AudioWindow;
  const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioContext = new AudioContextCtor();
  return audioContext;
}

function renderSound(context: AudioContext, kind: UiSound) {
  const profiles = {
    click: { from: 1550, to: 620, duration: 0.028, tone: 0.018, noise: 0.026, cutoff: 1700 },
    slide: { from: 1250, to: 430, duration: 0.045, tone: 0.022, noise: 0.034, cutoff: 1250 },
    pop: { from: 1950, to: 780, duration: 0.024, tone: 0.017, noise: 0.029, cutoff: 2100 },
    success: { from: 1450, to: 540, duration: 0.034, tone: 0.021, noise: 0.03, cutoff: 1500 },
  } as const;

  const makeClick = (profile: typeof profiles[UiSound], delay = 0) => {
    const start = context.currentTime + delay;
    const end = start + profile.duration;
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    const noiseSource = context.createBufferSource();
    const noiseGain = context.createGain();
    const highpass = context.createBiquadFilter();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(profile.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(profile.to, end);
    toneGain.gain.setValueAtTime(profile.tone, start);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(toneGain);
    toneGain.connect(context.destination);

    const frameCount = Math.max(1, Math.ceil(context.sampleRate * profile.duration));
    const noiseBuffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
    }
    noiseSource.buffer = noiseBuffer;
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(profile.cutoff, start);
    noiseGain.gain.setValueAtTime(profile.noise, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, end);
    noiseSource.connect(highpass);
    highpass.connect(noiseGain);
    noiseGain.connect(context.destination);

    oscillator.start(start);
    oscillator.stop(end);
    noiseSource.start(start);
    noiseSource.stop(end);
  };

  makeClick(profiles[kind]);
  if (kind === "success") makeClick(profiles.pop, 0.065);
}

export function playUiSound(kind: UiSound, muted = false) {
  if (muted || typeof window === "undefined") return;
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    context.resume().then(() => renderSound(context, kind)).catch(() => undefined);
    return;
  }
  renderSound(context, kind);
}
