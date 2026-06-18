let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;

  audioContext ??= new window.AudioContext();
  return audioContext;
}

export function prepareRemoveSound() {
  const context = getAudioContext();
  if (context?.state !== "suspended") return;

  void context.resume().catch(() => undefined);
}

export function prepareSuccessSound() {
  prepareRemoveSound();
}

export function playSuccessSound() {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    void context.resume().catch(() => undefined);
  }

  const startAt = context.currentTime;
  const notes = [523.25, 659.25, 783.99];

  notes.forEach((frequency, index) => {
    const noteStart = startAt + index * 0.075;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.08, noteStart + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.18);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.2);
  });
}

export function playRemoveSound() {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    void context.resume().catch(() => undefined);
  }

  const startAt = context.currentTime;
  const duration = 0.52;
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  const scrape = context.createBufferSource();
  const scrapeFilter = context.createBiquadFilter();
  const scrapeGain = context.createGain();
  const clinkOne = context.createOscillator();
  const clinkOneGain = context.createGain();
  const clinkTwo = context.createOscillator();
  const clinkTwoGain = context.createGain();
  const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const samples = noiseBuffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    const progress = index / samples.length;
    const rustle = Math.sin(progress * Math.PI * 9) * 0.35 + 0.65;
    const fade = Math.max(0, 1 - progress);
    samples[index] = (Math.random() * 2 - 1) * rustle * fade;
  }

  thud.type = "sine";
  thud.frequency.setValueAtTime(135, startAt);
  thud.frequency.exponentialRampToValueAtTime(46, startAt + 0.24);
  thudGain.gain.setValueAtTime(0.0001, startAt);
  thudGain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.016);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.28);

  scrape.buffer = noiseBuffer;
  scrapeFilter.type = "bandpass";
  scrapeFilter.frequency.setValueAtTime(2600, startAt + 0.02);
  scrapeFilter.frequency.exponentialRampToValueAtTime(620, startAt + duration);
  scrapeFilter.Q.setValueAtTime(1.2, startAt);
  scrapeGain.gain.setValueAtTime(0.0001, startAt + 0.02);
  scrapeGain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.055);
  scrapeGain.gain.exponentialRampToValueAtTime(0.035, startAt + 0.28);
  scrapeGain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  clinkOne.type = "triangle";
  clinkOne.frequency.setValueAtTime(1250, startAt + 0.11);
  clinkOne.frequency.exponentialRampToValueAtTime(780, startAt + 0.22);
  clinkOneGain.gain.setValueAtTime(0.0001, startAt + 0.1);
  clinkOneGain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.115);
  clinkOneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24);

  clinkTwo.type = "square";
  clinkTwo.frequency.setValueAtTime(840, startAt + 0.24);
  clinkTwo.frequency.exponentialRampToValueAtTime(430, startAt + 0.39);
  clinkTwoGain.gain.setValueAtTime(0.0001, startAt + 0.23);
  clinkTwoGain.gain.exponentialRampToValueAtTime(0.035, startAt + 0.255);
  clinkTwoGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);

  thud.connect(thudGain);
  thudGain.connect(context.destination);
  scrape.connect(scrapeFilter);
  scrapeFilter.connect(scrapeGain);
  scrapeGain.connect(context.destination);
  clinkOne.connect(clinkOneGain);
  clinkOneGain.connect(context.destination);
  clinkTwo.connect(clinkTwoGain);
  clinkTwoGain.connect(context.destination);

  thud.start(startAt);
  scrape.start(startAt + 0.02);
  clinkOne.start(startAt + 0.1);
  clinkTwo.start(startAt + 0.23);
  thud.stop(startAt + 0.3);
  scrape.stop(startAt + duration);
  clinkOne.stop(startAt + 0.25);
  clinkTwo.stop(startAt + 0.43);
}
