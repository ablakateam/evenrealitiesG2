/**
 * Wrap raw PCM 16kHz mono 16-bit LE bytes in a minimal WAV header.
 * Whisper accepts WAV directly; raw PCM requires a container.
 *
 * The HUD streams 16kHz mono PCM (per the G2 SDK contract); we just need to
 * prefix the standard 44-byte RIFF/WAVE/fmt/data header.
 */
export interface WavOptions {
  sampleRate?: number; // default 16000
  channels?: number; // default 1
  bitsPerSample?: number; // default 16
}

export function wrapPcmAsWav(pcm: Buffer, opts: WavOptions = {}): Buffer {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  let offset = 0;
  header.write('RIFF', offset);
  offset += 4;
  header.writeUInt32LE(fileSize, offset);
  offset += 4;
  header.write('WAVE', offset);
  offset += 4;
  header.write('fmt ', offset);
  offset += 4;
  header.writeUInt32LE(16, offset); // fmt chunk size
  offset += 4;
  header.writeUInt16LE(1, offset); // PCM format
  offset += 2;
  header.writeUInt16LE(channels, offset);
  offset += 2;
  header.writeUInt32LE(sampleRate, offset);
  offset += 4;
  header.writeUInt32LE(byteRate, offset);
  offset += 4;
  header.writeUInt16LE(blockAlign, offset);
  offset += 2;
  header.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  header.write('data', offset);
  offset += 4;
  header.writeUInt32LE(dataSize, offset);

  return Buffer.concat([header, pcm]);
}
