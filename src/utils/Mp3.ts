import { Mp3Encoder } from '@breezystack/lamejs';

/** Plenty for one voice, and a few kilobytes a second. */
const VOICE_KBPS = 48;

/** lame encodes in blocks of this many samples. */
const BLOCK = 1152;

/** Quieter than this (about -40 dB) is silence at the ends of a voice. */
const SILENCE_LEVEL = 330;

/** Silence kept before and after the voice, in seconds, so it does not start abruptly. */
const SILENCE_PAD_SECONDS = 0.05;

/**
 * Finds the format and the samples of a WAV file, walking its chunks.
 * @param wav The file.
 * @returns The sample rate, the channels and where the samples are.
 * @throws {Error} When the file is not 16-bit PCM WAV.
 */
export const readWav = (wav: Buffer) => {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }

  let offset = 12;
  let format: { channels: number; sampleRate: number; bits: number } | null = null;

  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);

    if (id === 'fmt ') {
      format = {
        channels: wav.readUInt16LE(offset + 10),
        sampleRate: wav.readUInt32LE(offset + 12),
        bits: wav.readUInt16LE(offset + 22),
      };
    }

    if (id === 'data' && format?.bits === 16) {
      // Streamed files may claim more data than they hold
      const end = Math.min(offset + 8 + size, wav.length);

      return { ...format, start: offset + 8, end };
    }

    // Chunks are padded to an even size
    offset += 8 + size + (size % 2);
  }

  throw new Error('Not a 16-bit PCM WAV file');
};

/**
 * Reads what lame hands back as plain bytes: signed ones, whatever its types say.
 * @param part An encoded block.
 * @returns The same bytes.
 */
const toBytes = (part: ArrayBufferView) =>
  Buffer.from(part.buffer, part.byteOffset, part.byteLength);

/**
 * Cuts the silence the voice generator leaves before and after the words, keeping a breath.
 * @param samples The voice.
 * @param sampleRate Samples a second.
 * @returns The voice without its silent ends.
 */
export const trimSilence = (samples: Int16Array, sampleRate: number) => {
  const isSound = (sample: number) => Math.abs(sample) > SILENCE_LEVEL;
  const first = samples.findIndex(isSound);

  if (first === -1) {
    return samples;
  }

  const last = samples.findLastIndex(isSound);
  const pad = Math.round(SILENCE_PAD_SECONDS * sampleRate);

  return samples.subarray(Math.max(first - pad, 0), Math.min(last + pad + 1, samples.length));
};

/**
 * Encodes a mono voice as MP3, cutting its silent ends.
 * @param channel The 16-bit samples.
 * @param sampleRate Samples a second.
 * @returns The MP3 and its length in seconds.
 */
export const pcmToMp3 = (channel: Int16Array, sampleRate: number) => {
  const samples = trimSilence(channel, sampleRate);

  const encoder = new Mp3Encoder(1, sampleRate, VOICE_KBPS);
  const parts: Buffer[] = [];

  for (let index = 0; index < samples.length; index += BLOCK) {
    parts.push(toBytes(encoder.encodeBuffer(samples.subarray(index, index + BLOCK))));
  }

  parts.push(toBytes(encoder.flush()));

  return { data: Buffer.concat(parts), seconds: samples.length / sampleRate };
};

/**
 * Encodes a WAV voice as MP3, keeping one channel and cutting its silent ends.
 * @param wav The 16-bit PCM WAV file.
 * @returns The MP3 and its length in seconds.
 */
export const wavToMp3 = (wav: Buffer) => {
  const { channels, sampleRate, start, end } = readWav(wav);
  const frames = Math.floor((end - start) / (2 * channels));
  const channel = new Int16Array(frames);

  // A stereo file keeps its left channel: a voice is the same on both
  for (let frame = 0; frame < frames; frame += 1) {
    channel[frame] = wav.readInt16LE(start + frame * 2 * channels);
  }

  return pcmToMp3(channel, sampleRate);
};

/** Kilobits a second of MPEG-1 and MPEG-2 Layer III, by the header's bitrate index. */
const MPEG1_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

const MPEG2_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Samples a second, by the header's version bits and then its rate index. */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  0: [11_025, 12_000, 8000],
};

/**
 * Reads a run of bits from a byte.
 * @param byte The byte.
 * @param from The lowest bit, 0 being the rightmost.
 * @param count How many bits.
 * @returns Their value.
 */
const bitsOf = (byte: number, from: number, count: number) =>
  Math.floor(byte / 2 ** from) % 2 ** count;

/** The ID3 tag's header: "ID3", version, flags and the size of what follows. */
const ID3_HEADER_BYTES = 10;

/**
 * Skips the ID3 tag an MP3 file may start with.
 * @param mp3 The file.
 * @returns Where the first frame starts.
 */
const skipId3 = (mp3: Buffer) => {
  if (mp3.length < ID3_HEADER_BYTES || mp3.toString('ascii', 0, 3) !== 'ID3') {
    return 0;
  }

  // Seven bits a byte, so the size never looks like a frame start
  const size = [6, 7, 8, 9].reduce((sum, index) => sum * 128 + mp3.readUInt8(index), 0);
  const hasFooter = bitsOf(mp3.readUInt8(5), 4, 1) === 1;

  return ID3_HEADER_BYTES + size + (hasFooter ? ID3_HEADER_BYTES : 0);
};

/**
 * Reads one Layer III frame header.
 * @param mp3 The file.
 * @param offset Where the frame starts.
 * @returns The frame's size in bytes and length in seconds, or null when no frame starts there.
 */
const readFrame = (mp3: Buffer, offset: number) => {
  const flags = mp3.readUInt8(offset + 1);
  const rates = mp3.readUInt8(offset + 2);
  // Eleven set bits start a frame, and Layer III is 01 in bits 1-2
  const isFrame =
    mp3.readUInt8(offset) === 0xff && bitsOf(flags, 5, 3) === 7 && bitsOf(flags, 1, 2) === 1;

  if (!isFrame) {
    return null;
  }

  const version = bitsOf(flags, 3, 2);
  const isMpeg1 = version === 3;
  const kbps = (isMpeg1 ? MPEG1_KBPS : MPEG2_KBPS)[bitsOf(rates, 4, 4)];
  const sampleRate = SAMPLE_RATES[version]?.[bitsOf(rates, 2, 2)];

  if (!kbps || !sampleRate) {
    return null;
  }

  const samples = isMpeg1 ? 1152 : 576;
  const padding = bitsOf(rates, 1, 1);

  return {
    bytes: Math.floor((samples / 8) * ((kbps * 1000) / sampleRate)) + padding,
    seconds: samples / sampleRate,
  };
};

/**
 * Measures an MP3 voice by walking its frames, so it works whatever the bitrate.
 * @param mp3 The file.
 * @returns Its length in seconds.
 * @throws {Error} When the file holds no MP3 frames.
 */
export const mp3Seconds = (mp3: Buffer) => {
  let offset = skipId3(mp3);
  let seconds = 0;
  let frames = 0;

  while (offset + 4 <= mp3.length) {
    const frame = readFrame(mp3, offset);

    if (frame) {
      seconds += frame.seconds;
      frames += 1;
      offset += frame.bytes;
    } else {
      // Junk between frames: look for the next one
      offset += 1;
    }
  }

  if (frames === 0) {
    throw new Error('Not an MP3 file');
  }

  return seconds;
};

/**
 * Readies a voice the generator made: a WAV is encoded as MP3, an MP3 is kept as it is.
 * @param file The WAV or MP3 file.
 * @returns The MP3 and its length in seconds.
 * @throws {Error} When the file is neither.
 */
export const voiceToMp3 = (file: Buffer) =>
  file.toString('ascii', 0, 4) === 'RIFF'
    ? wavToMp3(file)
    : { data: file, seconds: mp3Seconds(file) };
