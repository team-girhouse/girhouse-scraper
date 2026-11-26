'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** How long the button says the link was copied. */
const COPIED_MS = 2000;

/**
 * Copies the demo link that opens from the first scene, for a lead who could not find
 * their way back to the start.
 * @param props Component props.
 * @param props.url The demo link with `ricomincia=1`.
 * @returns The button and what it does.
 */
export const CopyRestartLinkButton = (props: { url: string }) => {
  const t = useTranslations('ConversationDemoCard');
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(props.url);
            setState('copied');
            setTimeout(() => {
              setState('idle');
            }, COPIED_MS);
          } catch {
            setState('error');
          }
        }}
      >
        {state === 'copied' ? <Check /> : <Copy />}
        {state === 'copied' ? t('restart_link_copied') : t('copy_restart_link')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {state === 'error' ? t('error_copy_link') : t('hint_restart_link')}
      </p>
    </div>
  );
};
