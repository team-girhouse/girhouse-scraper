import * as z from 'zod';
import { Env } from '@/libs/Env';
import { requireEnv } from '@/utils/Helpers';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Gemini's voice models, best first. Each has its own daily cap (100 lines on Tier 1, about
 * three demos), so a line moves to the next one once a model's cap runs out.
 * Only the 3.8 models take the style note; the older ones read the line plainly.
 */
const TTS_MODELS = [
  { model: 'gemini-3.8-flash-tts', style: true },
  { model: 'gemini-3.8-flash-lite-tts', style: true },
  { model: 'gemini-3.1-flash-tts-preview', style: false },
  { model: 'gemini-2.5-pro-preview-tts', style: false },
  { model: 'gemini-2.5-flash-preview-tts', style: false },
];

/** A line takes a few seconds; past this the call is dropped and the line asked again later. */
const CALL_TIMEOUT_MS = 60_000;

/** Gemini's answer when the project's requests a minute run out. */
const RATE_LIMITED = 429;

/** Thrown when Gemini asks to slow down: the line is asked again later, not given up on. */
export class GeminiRateLimitError extends Error {
  override name = 'GeminiRateLimitError';
}

const contentSchema = z.object({ type: z.string(), data: z.string().nullish() });

const responseSchema = z.object({
  steps: z.array(z.object({ type: z.string(), content: z.array(contentSchema).nullish() })),
});

type SpeakOptions = { text: string; voice: string; style: string };

/**
 * Says a line with one Gemini voice model.
 * @param options The call options.
 * @param model The model and whether it takes the style note.
 * @returns The voice as a WAV file.
 * @throws {GeminiRateLimitError} When the model's cap runs out.
 * @throws {Error} When the key is missing, Gemini refuses the line or sends no audio.
 */
const speakWithModel = async (options: SpeakOptions, model: (typeof TTS_MODELS)[number]) => {
  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': requireEnv('GEMINI_API_KEY', Env.GEMINI_API_KEY),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.model,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: options.text,
              ...(model.style && {
                annotations: [{ type: 'speech_metadata', style: options.style }],
              }),
            },
          ],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: options.voice }] },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (response.status === RATE_LIMITED) {
    throw new GeminiRateLimitError(`Gemini asked to slow down: ${await response.text()}`);
  }

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

/**
 * Says a line with one of Gemini's voices, on the first model whose cap has not run out.
 * @param options The call options.
 * @param options.text What is said, read word for word.
 * @param options.voice The Gemini voice, such as `Achird`.
 * @param options.style How it is said, in plain words.
 * @param models The models still to try, best first.
 * @returns The voice as a WAV file.
 * @throws {GeminiRateLimitError} When every model's cap has run out.
 * @throws {Error} When the key is missing, Gemini refuses the line or sends no audio.
 */
export const speakWithGemini = async (
  options: SpeakOptions,
  models = TTS_MODELS,
): Promise<Buffer> => {
  const [model, ...rest] = models;

  if (!model) {
    throw new GeminiRateLimitError('Every Gemini voice model is past its cap');
  }

  try {
    return await speakWithModel(options, model);
  } catch (error) {
    if (error instanceof GeminiRateLimitError) {
      return await speakWithGemini(options, rest);
    }

    throw error;
  }
};
