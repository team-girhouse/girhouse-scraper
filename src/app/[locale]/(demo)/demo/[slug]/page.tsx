import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import * as z from 'zod';
import { demoProgressCookie } from '@/components/demo/DemoProgress';
import type { DemoTourProps } from '@/components/demo/DemoTour';
import { DemoTour } from '@/components/demo/DemoTour';
import { DemoVsl } from '@/components/demo/vsl/DemoVsl';
import { VideoPending } from '@/components/demo/vsl/VideoPending';
import { loadDemoReviews } from '@/libs/DemoReviews';
import { getDemoPage } from '@/libs/Demos';
import { getDemoPhotos, getDemoVoices } from '@/libs/DemoVsl';
import enMessages from '@/locales/en.json';
import { AppConfig } from '@/utils/AppConfig';
import { readableTextColor } from '@/utils/Colors';
import { demoLanguageOf } from '@/utils/DemoLanguage';
import { DEMO_STEPS } from '@/utils/DemoStats';
import { DemoSlugValidation } from '@/validations/DemoValidation';

type DemoPageProps = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Google photos the landing preview can use: the hero and the "about" section. */
const PHOTO_COUNT = 2;

/**
 * Loads a demo from its slug, or answers with a 404 page.
 * @param slug The slug in the URL.
 * @returns The demo, its conversation and the organization's settings.
 */
const requireDemo = async (slug: string) => {
  const page = DemoSlugValidation.safeParse(slug).success ? await getDemoPage(slug) : null;

  if (!page) {
    notFound();
  }

  return page;
};

/**
 * Reads where this browser stopped on the demo last time, so a reload opens straight there.
 * @param slug The demo slug.
 * @returns The progress cookie, or null on a first visit.
 */
const readSavedProgress = async (slug: string) => {
  const cookieStore = await cookies();

  return cookieStore.get(demoProgressCookie(slug))?.value ?? null;
};

/**
 * Picks the locale a demo shows in: the route's, unless the team asked for English.
 * @param locale The route locale.
 * @param guidance What the team wrote for the demo.
 * @returns The locale of its texts.
 */
const demoLocaleOf = (locale: string, guidance: string | null) =>
  demoLanguageOf(guidance) === 'en' ? 'en' : locale;

/**
 * Gives an English demo its own texts: the demo host always serves the Italian route.
 * @param props Component props.
 * @param props.locale The locale of the demo's texts.
 * @param props.children The page.
 * @returns The page, with the English texts when it needs them.
 */
const DemoLanguageScope = (props: {
  locale: string;
  children: React.ReactNode;
}): React.ReactNode =>
  props.locale === 'en' ? (
    <NextIntlClientProvider
      locale="en"
      timeZone={AppConfig.timeZone}
      messages={{ DemoPage: enMessages.DemoPage }}
    >
      {props.children}
    </NextIntlClientProvider>
  ) : (
    props.children
  );

export async function generateMetadata(props: DemoPageProps): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const page = await requireDemo(slug);
  const t = await getTranslations({
    locale: demoLocaleOf(locale, page.demo.guidance),
    namespace: 'DemoPage',
  });

  return {
    // Absolute, so the lead sees the brand rather than the dashboard's name
    title: {
      absolute: `${t('meta_title', { company: page.demo.data.company })} · ${AppConfig.brandName}`,
    },
    robots: { index: false, follow: false },
  };
}

export default async function DemoPage(props: DemoPageProps) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);

  const { demo, settings } = await requireDemo(slug);
  // "lingua: inglese" in the team's guidance shows this one demo in English
  const demoLocale = demoLocaleOf(locale, demo.guidance);
  const format = await getFormatter({ locale: demoLocale });
  const { data } = demo;
  const searchParams = await props.searchParams;
  // Opened from the dashboard: nothing is tracked
  const isPreview = searchParams.anteprima === '1';
  const step = z.coerce.number().int().min(1).max(DEMO_STEPS).safeParse(searchParams.passo);
  // The "from the start" link copied from the dashboard: the scene this browser saved is ignored
  const isRestart = searchParams.ricomincia === '1';

  const { reviews, details } = await loadDemoReviews({
    data,
    formatWhen: (date) => format.dateTime(date, { month: 'long', year: 'numeric' }),
  });
  const { directory } = data;

  // Every build or rebuild of the demo starts its countdown again
  const increaseOn = new Date(demo.generatedAt.getTime() + settings.priceIncreaseDays * 86_400_000);

  // The business's colour tints every step through these variables
  const brandStyle: Record<string, string> = {
    '--demo-primary': data.primaryColor,
    '--demo-on-primary': readableTextColor(data.primaryColor),
  };

  // Links already sent may name version A or B; a new demo only has its video
  const version =
    demo.version !== 'c' && (searchParams.versione === 'a' || searchParams.versione === 'b')
      ? searchParams.versione
      : demo.version;
  // Version B shows once its script is written; until then the link keeps version A
  const vsl = version === 'a' ? null : demo.vsl;
  // Version C has no older version to fall back on, so its link waits for the voice
  const isPending = version === 'c' && (!vsl || vsl.voice === 'pending');

  const tourProps: DemoTourProps = {
    slug,
    track: !isPreview,
    initialStep: step.success ? step.data : null,
    savedProgress: isRestart ? null : await readSavedProgress(slug),
    data,
    reviews,
    photos: [
      ...(details?.photos ?? []).slice(0, PHOTO_COUNT).map((photo, index) => ({
        src: `/api/demo/${slug}/photo/${index}`,
        author: photo.authorAttributions.at(0)?.displayName ?? null,
      })),
      ...(data.images?.photos ?? []).map((src) => ({ src, author: null })),
      ...(directory?.photos ?? []).map((src) => ({ src, author: null })),
    ],
    pricing: {
      price: settings.monthlyPrice,
      newPrice: settings.newMonthlyPrice,
      slots: settings.onboardingSlotsPerMonth,
      increaseOn: increaseOn.toISOString(),
      increaseLabel: format.dateTime(increaseOn, {
        day: 'numeric',
        month: 'long',
        timeZone: AppConfig.timeZone,
      }),
    },
    whatsappNumber: settings.whatsappBusinessNumber,
  };

  return (
    <DemoLanguageScope locale={demoLocale}>
      <div
        style={brandStyle}
        className="min-h-svh bg-gradient-to-b from-amber-50/70 via-white to-white"
      >
        {isPending && <VideoPending company={data.company} />}
        {!isPending && vsl && (
          <DemoVsl
            {...tourProps}
            vsl={vsl}
            voices={await getDemoVoices(demo.id)}
            vslPhotos={await getDemoPhotos(demo.id)}
          />
        )}
        {!isPending && !vsl && <DemoTour {...tourProps} />}
      </div>
    </DemoLanguageScope>
  );
}
