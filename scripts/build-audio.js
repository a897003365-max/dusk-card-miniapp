#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE_RATE = 22050;
const MUSIC_BITRATE = 32;
const SFX_BITRATE = 16;
const MASTER_MUSIC = path.join(ROOT, 'docs/audio/masters/music');
const MASTER_SFX = path.join(ROOT, 'docs/audio/masters/sfx');
const MAIN_AUDIO = path.join(ROOT, 'assets/audio');
const SFX_AUDIO = path.join(MAIN_AUDIO, 'sfx');
const REGION_AUDIO = {
  street: path.join(ROOT, 'package-street/assets/audio'),
  bridge: path.join(ROOT, 'package-bridge/assets/audio'),
  market: path.join(ROOT, 'package-market/assets/audio'),
};

const PENTATONIC = [0, 2, 4, 7, 9];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const TWO_PI = Math.PI * 2;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function midi(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function note(rootMidi, degree, octave = 0, scale = PENTATONIC) {
  const octaveOffset = Math.floor(degree / scale.length) + octave;
  const scaleDegree = scale[((degree % scale.length) + scale.length) % scale.length];
  return midi(rootMidi + scaleDegree + octaveOffset * 12);
}

function oscillator(freq, time, kind) {
  return oscillatorAtPhase(TWO_PI * freq * time, kind);
}

function oscillatorAtPhase(phase, kind) {
  if (kind === 'bell') {
    return Math.sin(phase) * 0.58 + Math.sin(phase * 2.01) * 0.25 + Math.sin(phase * 3.96) * 0.12;
  }
  if (kind === 'marimba') {
    return Math.sin(phase) * 0.72 + Math.sin(phase * 2.01) * 0.19 + Math.sin(phase * 3.98) * 0.08;
  }
  if (kind === 'pluck') {
    return Math.sin(phase) * 0.68 + Math.sin(phase * 2.01) * 0.18 + Math.sin(phase * 4.01) * 0.07;
  }
  if (kind === 'bass') {
    return Math.sin(phase) * 0.82 + Math.sin(phase * 2.0) * 0.13;
  }
  if (kind === 'wood') {
    return Math.sin(phase) * 0.64 + Math.sin(phase * 2.7) * 0.20 + Math.sin(phase * 5.2) * 0.08;
  }
  if (kind === 'string') {
    return Math.sin(phase) * 0.78 + Math.sin(phase * 2.01) * 0.14 + Math.sin(phase * 3.01) * 0.05;
  }
  if (kind === 'body') {
    return Math.sin(phase) * 0.76 + Math.sin(phase * 2.18) * 0.17 + Math.sin(phase * 3.72) * 0.05;
  }
  if (kind === 'air') {
    return Math.sin(phase) * 0.62 + Math.sin(phase * 1.005) * 0.20 + Math.sin(phase * 2.01) * 0.08;
  }
  if (kind === 'drone') {
    return Math.sin(phase) * 0.74 + Math.sin(phase * 1.004) * 0.16 + Math.sin(phase * 2.0) * 0.07;
  }
  return Math.sin(phase) * 0.8 + Math.sin(phase * 2.0) * 0.12;
}

function addTone(buffer, start, duration, frequency, amplitude, kind = 'pluck', decay = 3.5) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  const attack = Math.min(0.018, duration * 0.18);
  const release = Math.min(0.10, duration * 0.30);
  for (let index = startSample; index < endSample; index += 1) {
    const time = (index / SAMPLE_RATE) - start;
    const progress = time / duration;
    const attackEnv = attack ? Math.min(1, time / attack) : 1;
    const releaseEnv = release ? Math.min(1, (duration - time) / release) : 1;
    const envelope = Math.max(0, attackEnv * releaseEnv * Math.exp(-decay * progress));
    buffer[index] += oscillator(frequency, time, kind) * amplitude * envelope;
  }
}

function addSustain(buffer, start, duration, frequency, amplitude, kind = 'string', options = {}) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  const attack = options.attack === undefined ? Math.min(0.22, duration * 0.28) : options.attack;
  const release = options.release === undefined ? Math.min(0.38, duration * 0.30) : options.release;
  const vibratoDepth = options.vibratoDepth === undefined ? 0.0025 : options.vibratoDepth;
  const vibratoRate = options.vibratoRate === undefined ? 4.4 : options.vibratoRate;
  let phase = 0;
  for (let index = startSample; index < endSample; index += 1) {
    const time = (index / SAMPLE_RATE) - start;
    const attackEnv = attack ? Math.min(1, time / attack) : 1;
    const releaseEnv = release ? Math.min(1, (duration - time) / release) : 1;
    const smoothAttack = attackEnv * attackEnv * (3 - 2 * attackEnv);
    const smoothRelease = releaseEnv * releaseEnv * (3 - 2 * releaseEnv);
    const vibrato = 1 + vibratoDepth * Math.sin(TWO_PI * vibratoRate * time);
    phase += TWO_PI * frequency * vibrato / SAMPLE_RATE;
    const breath = 0.94 + 0.06 * Math.sin(TWO_PI * 0.23 * time + frequency * 0.001);
    buffer[index] += oscillatorAtPhase(phase, kind) * amplitude * smoothAttack * smoothRelease * breath;
  }
}

function addBreathNoise(buffer, start, duration, amplitude, seed = 1, filter = 0.985) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  let state = seed >>> 0;
  let previous = 0;
  for (let index = startSample; index < endSample; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const random = ((state >>> 8) / 0xFFFFFF) * 2 - 1;
    const time = (index / SAMPLE_RATE) - start;
    const progress = time / duration;
    const edge = Math.min(1, time / 0.45) * Math.min(1, (duration - time) / 0.65);
    const filtered = previous * filter + random * (1 - filter);
    previous = filtered;
    const swell = 0.72 + 0.28 * Math.sin(TWO_PI * 0.17 * time + 0.6);
    buffer[index] += filtered * amplitude * edge * swell;
  }
}

function addSweep(buffer, start, duration, fromFrequency, toFrequency, amplitude, kind = 'pluck') {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  const attack = Math.min(0.02, duration * 0.16);
  const release = Math.min(0.10, duration * 0.30);
  let phase = 0;
  for (let index = startSample; index < endSample; index += 1) {
    const time = (index / SAMPLE_RATE) - start;
    const progress = clamp(time / duration, 0, 1);
    const frequency = fromFrequency * Math.pow(toFrequency / fromFrequency, progress);
    const envelope = Math.max(0, Math.min(1, time / attack) * Math.min(1, (duration - time) / release) * (1 - progress * 0.35));
    phase += TWO_PI * frequency / SAMPLE_RATE;
    buffer[index] += oscillatorAtPhase(phase, kind) * amplitude * envelope;
  }
}

function addNoise(buffer, start, duration, amplitude, seed = 1, filter = 0.82) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(buffer.length, Math.ceil((start + duration) * SAMPLE_RATE));
  let state = seed >>> 0;
  let previous = 0;
  for (let index = startSample; index < endSample; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const random = ((state >>> 8) / 0xFFFFFF) * 2 - 1;
    const time = (index / SAMPLE_RATE) - start;
    const progress = time / duration;
    const envelope = Math.min(1, time / 0.02) * Math.min(1, (duration - time) / 0.08);
    const filtered = previous * filter + random * (1 - filter);
    previous = filtered;
    buffer[index] += filtered * amplitude * envelope;
  }
}

function soften(buffer, peak = 0.4) {
  let max = 0;
  for (const value of buffer) max = Math.max(max, Math.abs(value));
  if (max > 0) {
    const scale = peak / max;
    for (let index = 0; index < buffer.length; index += 1) buffer[index] *= scale;
  }
  const fadeSamples = Math.min(Math.floor(SAMPLE_RATE * 0.08), Math.floor(buffer.length / 2));
  for (let index = 0; index < fadeSamples; index += 1) {
    const fadeIn = 0.5 - Math.cos(Math.PI * index / fadeSamples) * 0.5;
    buffer[index] *= fadeIn;
    buffer[buffer.length - 1 - index] *= fadeIn;
  }
}

function writeWav(file, buffer) {
  const pcm = Buffer.alloc(buffer.length * 2);
  for (let index = 0; index < buffer.length; index += 1) {
    pcm.writeInt16LE(Math.round(clamp(buffer[index], -1, 1) * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

function encodeMp3(input, output, bitrate) {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-ac', '1', '-ar', String(SAMPLE_RATE), '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`, output,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${output}: ${result.stderr || result.error}`);
}

function makeTrack(duration, recipe, peak = 0.4) {
  const buffer = new Float32Array(Math.round(duration * SAMPLE_RATE));
  recipe(buffer, duration);
  soften(buffer, peak);
  return buffer;
}

function addSequence(buffer, start, values, step, rootMidi, kind, octave = 0, duration = step * 0.75, amplitude = 0.14) {
  values.forEach((value, index) => {
    if (value === null) return;
    addTone(buffer, start + index * step, duration, note(rootMidi, value, octave), amplitude, kind, kind === 'bell' ? 1.8 : 3.6);
  });
}

function addPhrase(buffer, start, events, beat, rootMidi, kind, octave = 0, amplitude = 0.10, decay = 2.8, scale = PENTATONIC) {
  let cursor = start;
  events.forEach((event) => {
    const beats = event && event.beats !== undefined ? event.beats : 1;
    if (event && event.degree !== undefined) {
      const toneDuration = Math.max(0.10, beat * beats * 0.86);
      const toneOctave = event.octave === undefined ? octave : event.octave;
      const toneAmplitude = amplitude * (event.amplitude === undefined ? 1 : event.amplitude);
      addTone(buffer, cursor, toneDuration, note(rootMidi, event.degree, toneOctave, scale), toneAmplitude, kind, decay);
    }
    cursor += beat * beats;
  });
}

function addChord(buffer, start, duration, rootMidi, intervals, amplitude, kind = 'string') {
  intervals.forEach((interval, index) => {
    const toneAmplitude = amplitude * (index === 0 ? 1 : 0.58);
    addSustain(buffer, start, duration, midi(rootMidi + interval), toneAmplitude, kind, {
      attack: Math.min(0.30, duration * 0.28),
      release: Math.min(0.46, duration * 0.32),
      vibratoDepth: kind === 'air' ? 0.0016 : 0.0022,
    });
  });
}

function musicRecipe(name, duration) {
  return makeTrack(duration, (buffer, length) => {
    if (name === 'town') {
      const root = 62;
      const beat = 0.75;
      const bar = beat * 4;
      const chords = [
        [62, [0, 4, 7]], [59, [0, 3, 7]], [57, [0, 4, 7]],
        [55, [0, 4, 7]], [62, [0, 4, 7]], [57, [0, 4, 7]],
      ];
      chords.forEach(([chordRoot, intervals], index) => {
        const start = index * bar;
        addChord(buffer, start, bar, chordRoot, intervals, 0.027, 'air');
        addSustain(buffer, start, bar, midi(chordRoot - 24), 0.060, 'body', { attack: 0.18, release: 0.32, vibratoDepth: 0.0012 });
        if (index % 2 === 0) addTone(buffer, start + 0.02, 0.18, midi(chordRoot - 12), 0.045, 'wood', 4.8);
      });
      const phraseA = [
        { degree: 0, beats: 1.25 }, { degree: 2, beats: 0.75 }, { degree: 4, beats: 1 }, { beats: 1 },
        { degree: 3, beats: 1.25 }, { degree: 2, beats: 0.75 }, { degree: 1, beats: 1 }, { beats: 1 },
      ];
      const phraseB = [
        { degree: 0, beats: 0.75 }, { degree: 1, beats: 0.75 }, { degree: 3, beats: 1.25 }, { beats: 0.75 },
        { degree: 4, beats: 1 }, { degree: 2, beats: 0.75 }, { degree: 0, beats: 1.25 }, { beats: 1.5 },
      ];
      addPhrase(buffer, 0.08, phraseA, beat, root, 'wood', 0, 0.105, 2.55);
      addPhrase(buffer, 6.08, phraseA, beat, root, 'string', 0, 0.087, 2.75);
      addPhrase(buffer, 12.00, phraseB, beat, root, 'wood', 0, 0.102, 2.65);
    } else if (name === 'letter') {
      const root = 64;
      const beat = 0.75;
      const bar = beat * 4;
      const chords = [
        [64, [0, 4, 7]], [61, [0, 3, 7]], [57, [0, 4, 7]],
        [59, [0, 4, 7]], [64, [0, 4, 7]], [57, [0, 4, 7]],
      ];
      addBreathNoise(buffer, 0, length, 0.006, 0x1E77E2, 0.988);
      chords.forEach(([chordRoot, intervals], index) => {
        const start = index * bar;
        addChord(buffer, start, bar, chordRoot, intervals, 0.022, 'air');
        addSustain(buffer, start, bar, midi(chordRoot - 24), 0.043, 'drone', { attack: 0.28, release: 0.45, vibratoDepth: 0.0015 });
        if (index === 0 || index === 2 || index === 4) {
          addSustain(buffer, start + 1.28, 1.35, midi(chordRoot + 12), 0.023, 'string', { attack: 0.22, release: 0.30 });
        }
      });
      const phraseA = [
        { degree: 0, beats: 1.5 }, { degree: 2, beats: 0.75 }, { beats: 1.25 },
        { degree: 4, beats: 1.5 }, { degree: 3, beats: 1 }, { beats: 2 },
      ];
      const phraseB = [
        { degree: 4, beats: 1.25, octave: 1 }, { beats: 1 }, { degree: 3, beats: 1.25 },
        { degree: 2, beats: 0.5 }, { beats: 1.5 }, { degree: 0, beats: 2.5 },
      ];
      addPhrase(buffer, 0.20, phraseA, beat, root, 'string', 0, 0.075, 2.1);
      addPhrase(buffer, 6.20, phraseA, beat, root, 'wood', 0, 0.062, 2.35);
      addPhrase(buffer, 12.00, phraseB, beat, root, 'string', 0, 0.070, 2.2);
    } else if (name === 'boss') {
      const root = 57;
      const beat = 0.875;
      const bar = beat * 4;
      const chords = [
        [57, [0, 3, 7]], [53, [0, 4, 7]], [50, [0, 5, 7]], [57, [0, 3, 7]],
      ];
      addBreathNoise(buffer, 0, length, 0.0035, 0xB055, 0.99);
      chords.forEach(([chordRoot, intervals], index) => {
        const start = index * bar;
        addChord(buffer, start, bar, chordRoot, intervals, 0.030, 'drone');
        addSustain(buffer, start, bar, midi(chordRoot - 24), 0.073, 'body', { attack: 0.16, release: 0.28, vibratoDepth: 0.0011 });
        addTone(buffer, start + 0.01, 0.22, midi(chordRoot - 12), 0.065, 'wood', 3.6);
        if (index === 1 || index === 3) addTone(buffer, start + beat * 2, 0.18, midi(chordRoot - 12), 0.036, 'wood', 4.2);
      });
      const phrase = [
        { degree: 0, beats: 1.5, octave: -1 }, { degree: 1, beats: 0.5, octave: -1 }, { beats: 1 },
        { degree: 3, beats: 1, octave: -1 }, { degree: 2, beats: 1, octave: -1 }, { beats: 1 }, { degree: 1, beats: 1, octave: -1 },
        { degree: 0, beats: 1.5 }, { beats: 1 }, { degree: -1, beats: 1 }, { degree: 1, beats: 1 }, { beats: 1 },
        { degree: 2, beats: 1 }, { degree: 1, beats: 1 }, { degree: 0, beats: 1.5, octave: -1 },
      ];
      addPhrase(buffer, 0, phrase, beat, root, 'wood', 0, 0.105, 2.35, NATURAL_MINOR);
      addSustain(buffer, bar * 2 + beat * 2.1, 1.2, midi(root + 12), 0.020, 'string', { attack: 0.24, release: 0.38, vibratoDepth: 0.002 });
    } else if (name === 'street') {
      const root = 67;
      const beat = 0.75;
      const bar = beat * 4;
      const chords = [
        [67, [0, 4, 7]], [62, [0, 4, 7]], [64, [0, 3, 7]], [60, [0, 4, 7]],
        [67, [0, 4, 7]], [62, [0, 4, 7]], [60, [0, 4, 7]], [67, [0, 4, 7]],
      ];
      chords.forEach(([chordRoot, intervals], index) => {
        const start = index * bar;
        addChord(buffer, start, bar, chordRoot, intervals, 0.024, 'string');
        addSustain(buffer, start, bar, midi(chordRoot - 24), 0.048, 'body', { attack: 0.16, release: 0.30, vibratoDepth: 0.0016 });
        if (index % 2 === 0) addTone(buffer, start + 0.02, 0.14, midi(chordRoot - 12), 0.035, 'wood', 4.5);
        if (index % 2 === 1) addTone(buffer, start + beat * 2, 0.12, midi(chordRoot - 12), 0.020, 'wood', 4.8);
      });
      const phraseA = [
        { degree: 0, beats: 1 }, { degree: 2, beats: 0.5 }, { degree: 4, beats: 0.75 }, { beats: 1.75 },
        { degree: 3, beats: 1 }, { degree: 2, beats: 0.5 }, { degree: 1, beats: 1 }, { beats: 1.5 },
      ];
      const phraseB = [
        { degree: 4, beats: 1 }, { degree: 3, beats: 0.75 }, { beats: 0.75 }, { degree: 2, beats: 1.25 },
        { degree: 0, beats: 0.75 }, { degree: 1, beats: 0.75 }, { degree: 3, beats: 1 }, { beats: 1.75 },
      ];
      addPhrase(buffer, 0.08, phraseA, beat, root, 'wood', 0, 0.103, 2.55);
      addPhrase(buffer, 6.00, phraseA, beat, root, 'string', 0, 0.083, 2.80);
      addPhrase(buffer, 12.00, phraseB, beat, root, 'wood', 0, 0.100, 2.60);
      addPhrase(buffer, 18.00, phraseB, beat, root, 'string', 0, 0.082, 2.85);
    } else if (name === 'bridge') {
      const root = 62;
      const beat = 0.75;
      const bar = beat * 4;
      const chords = [
        [62, [0, 3, 7]], [58, [0, 4, 7]], [53, [0, 4, 7]], [60, [0, 3, 7]],
        [62, [0, 3, 7]], [58, [0, 4, 7]], [60, [0, 3, 7]], [62, [0, 3, 7]],
      ];
      addBreathNoise(buffer, 0, length, 0.010, 0xBADC0DE, 0.988);
      chords.forEach(([chordRoot, intervals], index) => {
        const start = index * bar;
        addChord(buffer, start, bar, chordRoot, intervals, 0.023, 'air');
        addSustain(buffer, start, bar, midi(chordRoot - 24), 0.037, 'drone', { attack: 0.34, release: 0.48, vibratoDepth: 0.0018 });
        if (index === 1 || index === 5) addSustain(buffer, start + beat * 1.5, beat * 1.9, midi(chordRoot + 12), 0.020, 'air', { attack: 0.28, release: 0.36 });
      });
      const phraseA = [
        { degree: 0, beats: 1.5 }, { beats: 1.25 }, { degree: 2, beats: 0.75 }, { degree: 4, beats: 1.25 },
        { beats: 1 }, { degree: 3, beats: 0.75 }, { degree: 1, beats: 1.5 },
      ];
      const phraseB = [
        { degree: 3, beats: 1 }, { beats: 1.5 }, { degree: 4, beats: 1.5 }, { degree: 2, beats: 1 },
        { beats: 1 }, { degree: 0, beats: 2 },
      ];
      addPhrase(buffer, 0.16, phraseA, beat, root, 'string', 0, 0.070, 2.25, NATURAL_MINOR);
      addPhrase(buffer, 6.16, phraseB, beat, root, 'wood', 0, 0.060, 2.45, NATURAL_MINOR);
      addPhrase(buffer, 12.00, phraseA, beat, root, 'string', 0, 0.066, 2.30, NATURAL_MINOR);
      addPhrase(buffer, 18.00, phraseB, beat, root, 'wood', 0, 0.058, 2.50, NATURAL_MINOR);
    } else if (name === 'market') {
      const root = 69;
      const beat = 0.75;
      const bar = beat * 4;
      const chords = [
        [69, [0, 4, 7]], [64, [0, 4, 7]], [66, [0, 3, 7]], [62, [0, 4, 7]],
        [69, [0, 4, 7]], [64, [0, 4, 7]], [62, [0, 4, 7]], [69, [0, 4, 7]],
      ];
      addBreathNoise(buffer, 0, length, 0.003, 0xA11CE, 0.990);
      chords.forEach(([chordRoot, intervals], index) => {
        const start = index * bar;
        addChord(buffer, start, bar, chordRoot, intervals, 0.024, 'string');
        addSustain(buffer, start, bar, midi(chordRoot - 24), 0.052, 'body', { attack: 0.14, release: 0.28, vibratoDepth: 0.0015 });
        addTone(buffer, start + 0.02, 0.13, midi(chordRoot - 12), 0.030, 'wood', 4.8);
        if (index % 2 === 1) addTone(buffer, start + beat * 3, 0.11, midi(chordRoot - 12), 0.018, 'wood', 5.0);
      });
      const phrase = [
        { degree: 0, beats: 0.5 }, { degree: 2, beats: 0.5 }, { degree: 4, beats: 0.75 }, { beats: 0.75 },
        { degree: 3, beats: 0.5 }, { degree: 2, beats: 0.5 }, { degree: 1, beats: 0.75 }, { beats: 0.75 },
        { degree: 4, beats: 1 }, { degree: 3, beats: 0.75 }, { degree: 2, beats: 0.75 }, { beats: 0.5 },
      ];
      addPhrase(buffer, 0.08, phrase, beat, root, 'wood', 0, 0.095, 2.45);
      addPhrase(buffer, 6.00, phrase, beat, root, 'string', 0, 0.077, 2.65);
      addPhrase(buffer, 12.00, phrase, beat, root, 'wood', 0, 0.092, 2.50);
      addPhrase(buffer, 18.00, phrase, beat, root, 'string', 0, 0.075, 2.70);
      addPhrase(buffer, 3.00, [
        { degree: 3, beats: 1.25 }, { beats: 1.5 }, { degree: 1, beats: 1.25 }, { beats: 2 },
      ], beat, root, 'string', 1, 0.032, 2.2);
      addPhrase(buffer, 15.00, [
        { degree: 4, beats: 1.25 }, { beats: 1.5 }, { degree: 2, beats: 1.25 }, { beats: 2 },
      ], beat, root, 'string', 1, 0.029, 2.3);
    }
  }, 0.4);
}

function effectRecipe(name, duration) {
  const peak = name === 'select' ? 0.28 : name === 'attack' ? 0.38 : (name === 'victory' || name === 'defeat') ? 0.34 : 0.45;
  return makeTrack(duration, (buffer) => {
    const root = 62;
    if (name === 'select') addTone(buffer, 0.01, 0.13, note(root, 2), 0.28, 'pluck', 4.5);
    if (name === 'card') { addNoise(buffer, 0.01, 0.15, 0.12, 11, 0.70); addTone(buffer, 0.04, 0.18, note(root, 0), 0.16, 'pluck', 5); }
    if (name === 'attack') { addSweep(buffer, 0.02, 0.34, note(root, 0, 0), note(root, 4, 1), 0.25, 'pluck'); addTone(buffer, 0.28, 0.16, note(root, 2, 1), 0.12, 'bell', 4); }
    if (name === 'hit') { addTone(buffer, 0.01, 0.18, midi(52), 0.30, 'bass', 5); addNoise(buffer, 0.01, 0.12, 0.08, 23, 0.65); }
    if (name === 'guard') { addTone(buffer, 0.01, 0.20, note(root, 0), 0.20, 'wood', 4); addTone(buffer, 0.10, 0.28, note(root, 4, 1), 0.12, 'bell', 3); }
    if (name === 'heal') { addSequence(buffer, 0.02, [0, 2, 4], 0.16, root, 'bell', 1, 0.42, 0.18); }
    if (name === 'buff') { addSweep(buffer, 0.01, 0.55, note(root, 0), note(root, 4, 1), 0.16, 'bell'); addTone(buffer, 0.25, 0.45, note(root, 2, 1), 0.10, 'bell', 2.5); }
    if (name === 'debuff') { addSweep(buffer, 0.01, 0.45, note(root, 4, 1), note(root, 0), 0.18, 'bell'); addTone(buffer, 0.18, 0.30, midi(48), 0.08, 'bass', 3); }
    if (name === 'shuffle') { addNoise(buffer, 0.01, duration - 0.02, 0.18, 37, 0.55); addNoise(buffer, 0.18, 0.18, 0.09, 41, 0.60); }
    if (name === 'summon') { addSweep(buffer, 0.02, 0.60, note(root, 0), note(root, 4, 1), 0.14, 'pad'); addSequence(buffer, 0.35, [0, 2, 4], 0.11, root, 'bell', 1, 0.35, 0.11); }
    if (name === 'rare') { addSequence(buffer, 0.02, [0, 2, 4, 7, 9], 0.10, root, 'bell', 1, 0.30, 0.14); }
    if (name === 'reward') { addSequence(buffer, 0.02, [4, 2, 0, 4], 0.13, root, 'bell', 1, 0.34, 0.15); }
    if (name === 'chest') { addSweep(buffer, 0.02, 0.70, note(root, 0), note(root, 4, 1), 0.12, 'wood'); addTone(buffer, 0.58, 0.35, note(root, 4, 1), 0.15, 'bell', 2.5); }
    if (name === 'victory') {
      // A soft wooden postmark, then a held closing chord. The pauses keep it ceremonial rather than arcade-like.
      addTone(buffer, 0.02, 0.16, midi(50), 0.17, 'body', 4.8);
      addNoise(buffer, 0.02, 0.20, 0.048, 0x504F57, 0.90);
      addTone(buffer, 0.28, 0.28, note(root, 0), 0.10, 'wood', 3.5);
      addTone(buffer, 0.50, 0.30, note(root, 2), 0.085, 'wood', 3.2);
      addChord(buffer, 0.42, 1.22, root, [0, 4, 7], 0.095, 'string');
      addSustain(buffer, 0.72, 0.92, midi(root + 12), 0.030, 'air', { attack: 0.20, release: 0.34, vibratoDepth: 0.0015 });
      addTone(buffer, 1.23, 0.28, note(root, 4), 0.055, 'wood', 2.7);
    }
    if (name === 'defeat') {
      // Two low, separated breaths leave a clear pause before the final downward resolve.
      addSustain(buffer, 0.02, 0.42, midi(50), 0.13, 'body', { attack: 0.04, release: 0.18, vibratoDepth: 0.0012 });
      addSustain(buffer, 0.62, 0.42, midi(46), 0.105, 'body', { attack: 0.05, release: 0.18, vibratoDepth: 0.0012 });
      addBreathNoise(buffer, 0.02, 1.43, 0.004, 0xDEFEE7, 0.99);
      addSustain(buffer, 1.17, 0.35, midi(43), 0.085, 'string', { attack: 0.05, release: 0.26, vibratoDepth: 0.0014 });
    }
    if (name === 'phase') { addTone(buffer, 0.02, 0.32, midi(43), 0.18, 'bass', 2.4); addSweep(buffer, 0.15, 0.65, note(root, 0), note(root, 4, 1), 0.12, 'bell'); }
  }, peak);
}

function build() {
  ensureDir(MASTER_MUSIC);
  ensureDir(MASTER_SFX);
  ensureDir(MAIN_AUDIO);
  ensureDir(SFX_AUDIO);
  Object.values(REGION_AUDIO).forEach(ensureDir);

  const music = [
    ['town', 18, path.join(MAIN_AUDIO, 'town.mp3')],
    ['letter', 18, path.join(MAIN_AUDIO, 'letter.mp3')],
    ['boss', 14, path.join(MAIN_AUDIO, 'boss.mp3')],
    ['street', 24, path.join(REGION_AUDIO.street, 'theme.mp3')],
    ['bridge', 24, path.join(REGION_AUDIO.bridge, 'theme.mp3')],
    ['market', 24, path.join(REGION_AUDIO.market, 'theme.mp3')],
  ];
  const effects = [
    ['select', 0.18], ['card', 0.32], ['attack', 0.50], ['hit', 0.22],
    ['guard', 0.30], ['heal', 0.60], ['buff', 0.70], ['debuff', 0.50],
    ['shuffle', 0.80], ['summon', 0.90], ['rare', 0.75], ['reward', 0.70],
    ['chest', 1.00], ['victory', 1.80], ['defeat', 1.60], ['phase', 1.00],
  ];
  const report = [];
  for (const [name, duration, output] of music) {
    const wav = path.join(MASTER_MUSIC, `${name}.wav`);
    writeWav(wav, musicRecipe(name, duration));
    encodeMp3(wav, output, MUSIC_BITRATE);
    report.push({ type: 'music', name, duration, bitrate: MUSIC_BITRATE, wav, mp3: output, bytes: fs.statSync(output).size });
  }
  for (const [name, duration] of effects) {
    const wav = path.join(MASTER_SFX, `${name}.wav`);
    const output = path.join(SFX_AUDIO, `${name}.mp3`);
    writeWav(wav, effectRecipe(name, duration));
    encodeMp3(wav, output, SFX_BITRATE);
    report.push({ type: 'effect', name, duration, bitrate: SFX_BITRATE, wav, mp3: output, bytes: fs.statSync(output).size });
  }
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) build();

module.exports = { build };
