/**
 * outreach-sync.ts
 *
 * Fire-and-forget helper that notifies the LK Outreach Engine when a prospect
 * replies, books a call, or opts out.  This keeps the outreach DB in sync so
 * the admin panel shows accurate funnel stats.
 *
 * Requires two env vars (both optional — sync is silently skipped if absent):
 *   OUTREACH_SYNC_URL    = https://lk-outreach.vercel.app/api/internal/prospect-sync
 *   OUTREACH_SYNC_SECRET = (must match INTERNAL_WEBHOOK_SECRET in Vercel env)
 */

import { env } from '../config/env';
import { logger } from './logger';

export type OutreachEvent = 'replied' | 'call_booked' | 'opted_out';

/**
 * Notify the outreach engine about a prospect event.
 * Non-blocking — errors are logged but never thrown.
 */
export async function syncToOutreach(
  phone: string,
  event: OutreachEvent,
  notes?: string,
): Promise<void> {
  const url    = env.OUTREACH_SYNC_URL;
  const secret = env.OUTREACH_SYNC_SECRET;

  if (!url || !secret) return; // not configured — skip silently

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-outreach-secret': secret,
      },
      body: JSON.stringify({ phone, event, ...(notes ? { notes } : {}) }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn({ phone, event, status: res.status, body: text }, 'outreach-sync: non-OK response');
    } else {
      logger.debug({ phone, event }, 'outreach-sync: ok');
    }
  } catch (err: any) {
    logger.warn({ phone, event, err: err?.message }, 'outreach-sync: request failed');
  }
}
