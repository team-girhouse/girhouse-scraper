import { describe, expect, it } from 'vitest';
import { mp3Seconds, trimSilence, voiceToMp3, wavToMp3 } from './Mp3';

/**
 * Builds a 16-bit PCM WAV of a tone.
 * @param options The tone.
 * @param options.seconds Its length.
 * @param options.sampleRate Samples a second.
 * @param options.channels Mono or stereo.
 * @returns The file.
 */
const toneWav = (options: { seconds: number; sampleRate: number; channels: number }) => {
  const frames = options.seconds * options.sampleRate;
  const data = Buffer.alloc(frames * 2 * options.channels);

  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin((frame / options.sampleRate) * 2 * Math.PI * 440) * 8000);

    for (let channel = 0; channel < options.channels; channel += 1) {
      data.writeInt16LE(sample, (frame * options.channels + channel) * 2);
    }
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(options.channels, 22);
  header.writeUInt32LE(options.sampleRate, 24);
  header.writeUInt32LE(options.sampleRate * 2 * options.channels, 28);
  header.writeUInt16LE(2 * options.channels, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
};

describe('Mp3', () => {
  it('encodes a WAV voice as MP3 frames', () => {
    const { data } = wavToMp3(toneWav({ seconds: 1, sampleRate: 24_000, channels: 1 }));

    // Every MP3 frame starts with eleven set bits
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBeGreaterThanOrEqual(0xe0);
  });

  it('reads the length of the voice', () => {
    expect(wavToMp3(toneWav({ seconds: 2, sampleRate: 24_000, channels: 2 })).seconds).toBe(2);
  });

  it('shrinks the voice', () => {
    const wav = toneWav({ seconds: 2, sampleRate: 24_000, channels: 1 });

    expect(wavToMp3(wav).data.length).toBeLessThan(wav.length / 4);
  });

  it('rejects a file that is not WAV', () => {
    expect(() => wavToMp3(Buffer.from('not a wav file at all, really'))).toThrow('Not a WAV');
  });

  describe('MP3 voices', () => {
    const mp3 = wavToMp3(toneWav({ seconds: 2, sampleRate: 24_000, channels: 1 })).data;

    it('measures an MP3 by its frames', () => {
      // lame adds a few frames of padding around the samples
      expect(mp3Seconds(mp3)).toBeGreaterThan(1.9);
      expect(mp3Seconds(mp3)).toBeLessThan(2.2);
    });

    it('skips the ID3 tag before the frames', () => {
      const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);

      expect(mp3Seconds(Buffer.concat([tag, mp3]))).toBe(mp3Seconds(mp3));
    });

    it('keeps an MP3 voice as it is', () => {
      expect(voiceToMp3(mp3)).toStrictEqual({ data: mp3, seconds: mp3Seconds(mp3) });
    });

    it('encodes a WAV voice', () => {
      expect(voiceToMp3(toneWav({ seconds: 1, sampleRate: 24_000, channels: 1 })).seconds).toBe(1);
    });

    it('rejects a file that is neither', () => {
      expect(() => voiceToMp3(Buffer.from('not a voice at all, really'))).toThrow('Not an MP3');
    });
  });

  describe('Silence', () => {
    const voice = Int16Array.from([0, 0, 0, 0, 5000, -4000, 3000, 0, 0, 0]);

    it('cuts the silent ends of a voice, keeping a breath', () => {
      // One sample of padding at this rate
      expect([...trimSilence(voice, 20)]).toStrictEqual([0, 5000, -4000, 3000, 0]);
    });

    it('keeps a silent file as it is', () => {
      expect(trimSilence(new Int16Array(5), 20)).toHaveLength(5);
    });
  });
});
