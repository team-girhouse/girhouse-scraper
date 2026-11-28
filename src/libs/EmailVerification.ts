import { verifyEmail } from '@/services/MillionVerifier';
import { hasReoon, verifyEmailPower } from '@/services/Reoon';
import type { UsageOwner } from './Usage';
import { recordVerificationUsage } from './Usage';

/**
 * Checks whether an address can receive mail, asking Reoon when MillionVerifier cannot tell.
 * @param options The call options.
 * @param options.email The address to check.
 * @param options.owner Who the verifications are billed to.
 * @param options.recordId The lead or contact the address belongs to, so a retry is billed once.
 * @returns The verdict.
 */
export const verifyAddress = async (options: {
  email: string;
  owner: UsageOwner;
  recordId: string;
}) => {
  const usage = { ...options.owner, recordId: options.recordId, email: options.email };
  const verdict = await verifyEmail(options.email);

  await recordVerificationUsage({ ...usage, provider: 'millionverifier' });

  if (verdict !== 'unknown' || !hasReoon()) {
    return verdict;
  }

  const second = await verifyEmailPower(options.email);

  await recordVerificationUsage({ ...usage, provider: 'reoon' });

  return second;
};
