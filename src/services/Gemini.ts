import * as z from 'zod';
import { Env } from '@/libs/Env';
import { requireEnv } from '@/utils/Helpers';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** The newest Gemini voice model, the one Kie ran before its Gemini voices stopped on 25/11. */
const TTS_MODEL = 'gemini-3.8-flash-tts';

/** A line takes a few seconds; past this the call is dropped and the line asked again later. */
const CALL_TIMEOUT_MS = 60_000;

const contentSchema = z.object({ type: z.string(), data: z.string().nullish() });

const responseSchema = z.object({
  steps: z.array(z.object({ type: z.string(), content: z.array(contentSchema).nullish() })),
});

/**
 * Says a line with one of Gemini's voices.
 * @param options The call options.
 * @param options.text What is said, read word for word.
 * @param options.voice The Gemini voice, such as `Achird`.
 * @param options.style How it is said, in plain words.
 * @returns The voice as a WAV file.
 * @throws {Error} When the key is missing, Gemini refuses the line or sends no audio.
 */
export const speakWithGemini = async (options: { text: string; voice: string; style: string }) => {
  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': requireEnv('GEMINI_API_KEY', Env.GEMINI_API_KEY),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: options.text,
              annotations: [{ type: 'speech_metadata', style: options.style }],
            },
          ],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: options.voice }] },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Gemini answered ${response.status}: ${await response.text()}`);
  }

  const body = responseSchema.parse(await response.json());
  const audio = body.steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .findLast((content) => content.type === 'audio' && content.data);

  if (!audio?.data) {
    throw new Error('Gemini sent no audio');
  }

  return Buffer.from(audio.data, 'base64');
};
