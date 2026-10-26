import { useEffect } from 'react';

interface SoundSettings { animation: boolean; muted: boolean; music: number; effects: number; }
const DEFAULTS: SoundSettings = { animation: true, muted: false, music: 35, effects: 60 };
function settings(): SoundSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('five-arrays-v2-settings') ?? '{}') }; } catch { return DEFAULTS; }
}
/** Original synthesized pentatonic score. Audio consumes committed UI events only. */
export function AudioController() {
  useEffect(() => {
    let context: AudioContext | null = null;
    let musicGain: GainNode | null = null;
    let effectGain: GainNode | null = null;
    let beat = 0;
    let scene = 'menu';
    let timer: ReturnType<typeof setInterval> | undefined;
    const melody = [62, 0, 69, 72, 74, 0, 72, 69, 67, 0, 65, 67, 69, 0, 62, 0, 65, 0, 67, 69, 72, 0, 69, 67, 65, 0, 62, 60, 62, 0, 0, 0];
    const updateVolume = () => {
      if (!context || !musicGain || !effectGain) return;
      const s = settings();
      const quiet = s.muted || document.hidden;
      musicGain.gain.setTargetAtTime(quiet ? 0 : Math.pow(Math.min(100, Math.max(0, s.music)) / 100, 2) * 0.20, context.currentTime, 0.12);
      effectGain.gain.setTargetAtTime(quiet ? 0 : Math.pow(Math.min(100, Math.max(0, s.effects)) / 100, 2) * 0.38, context.currentTime, 0.04);
    };
    const note = (midi: number, duration: number, output: GainNode, offset = 0, shape: OscillatorType = 'triangle') => {
      if (!context) return;
      const at = context.currentTime + offset;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = shape;
      oscillator.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      envelope.gain.setValueAtTime(0.001, at);
      envelope.gain.exponentialRampToValueAtTime(0.6, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(envelope); envelope.connect(output);
      oscillator.start(at); oscillator.stop(at + duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    };
    const begin = () => {
      try {
        if (!context) {
          context = new AudioContext();
          musicGain = context.createGain(); effectGain = context.createGain();
          musicGain.connect(context.destination); effectGain.connect(context.destination);
          updateVolume();
          timer = setInterval(() => {
            if (!context || !musicGain || document.hidden || settings().muted) return;
            const pitch = melody[beat % melody.length] ?? 0;
            const battle = scene === 'battle';
            if (pitch) note(pitch - (scene === 'market' ? 12 : 0), battle ? 0.75 : 1.35, musicGain);
            if (beat % 8 === 0) note(38 + (beat % 16 === 0 ? 0 : 5), 2.8, musicGain, 0, 'sine');
            if (battle && beat % 4 === 0) note(26, 0.13, musicGain, 0, 'sine');
            beat++;
          }, 430);
        }
        if (context.state === 'suspended') void context.resume().catch(() => undefined);
      } catch { /* Audio has an equivalent visual cue; unsupported audio never blocks a command. */ }
    };
    const sound = (event: Event) => {
      begin(); updateVolume();
      if (!effectGain) return;
      const kind = (event as CustomEvent<{ kind: string }>).detail?.kind;
      const phrases: Record<string, number[]> = { play: [38, 50, 62], discard: [69, 62], reward: [62, 65, 69], buy: [74, 81], win: [62, 65, 69, 74, 81], lose: [62, 60, 53], click: [81] };
      for (const [i, midi] of (phrases[kind ?? 'click'] ?? [74]).entries()) note(midi, kind === 'win' ? 0.9 : 0.25, effectGain, i * 0.075);
    };
    const phase = (event: Event) => { scene = (event as CustomEvent<{ phase: string }>).detail?.phase ?? 'menu'; };
    document.addEventListener('pointerdown', begin);
    document.addEventListener('keydown', begin);
    document.addEventListener('visibilitychange', updateVolume);
    window.addEventListener('v2:sound', sound);
    window.addEventListener('v2:settings', updateVolume);
    window.addEventListener('v2:phase', phase);
    return () => {
      document.removeEventListener('pointerdown', begin); document.removeEventListener('keydown', begin);
      document.removeEventListener('visibilitychange', updateVolume);
      window.removeEventListener('v2:sound', sound); window.removeEventListener('v2:settings', updateVolume); window.removeEventListener('v2:phase', phase);
      if (timer) clearInterval(timer);
      if (context) void context.close().catch(() => undefined);
    };
  }, []);
  return null;
}
