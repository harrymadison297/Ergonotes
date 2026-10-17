// What every capture of sound needs, whether it is a record (run.ts) or a dictation (components/Recorder.tsx):
// which format the browser can write, one mixer for all the sources, and a level for the meter.

const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** The first format the browser's MediaRecorder can write, best first; undefined lets the browser choose. */
export const pickAudioMime = (supported: (type: string) => boolean = t => MediaRecorder.isTypeSupported(t)): string | undefined =>
  AUDIO_MIMES.find(supported);

/** How loud the samples are, 0 to 1: the peak distance from silence (128) in a byte time-domain buffer. */
export function peakLevel(samples: Uint8Array): number {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
  return Math.min(1, peak / 64);
}

export interface Mixer {
  ctx: AudioContext;
  /** one mono track with all the sources in it */
  stream: MediaStream;
  /** the current level, 0 to 1 */
  level(): number;
}

/** All the sources go through one mixer, so what is recorded is one track whatever was captured (ADR 0011: mono). */
export function openMixer(sources: MediaStream[]): Mixer {
  const ctx = new AudioContext();
  void ctx.resume();
  const out = ctx.createMediaStreamDestination();
  out.channelCount = 1;
  out.channelCountMode = 'explicit';
  out.channelInterpretation = 'speakers';
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  for (const st of sources) {
    const src = ctx.createMediaStreamSource(st);
    src.connect(out);
    src.connect(analyser);
  }
  const buf = new Uint8Array(analyser.fftSize);
  return { ctx, stream: out.stream, level: () => { analyser.getByteTimeDomainData(buf); return peakLevel(buf); } };
}
