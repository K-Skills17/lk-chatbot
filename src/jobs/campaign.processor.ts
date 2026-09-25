import crypto from 'crypto';
import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { sendMessage } from '../modules/whatsapp/message.sender';
import { isWithinBusinessHours } from '../utils/timezone.utils';
import { CampaignSendJobData } from '../modules/campaign/campaign.types';

export async function campaignProcessor(job: Job<CampaignSendJobData>): Promise<void> {
  const {
    campaignId,
    campaignContactId,
    tenantId,
    contactId,
    phone,
    contactName,
    messageTemplate,
  } = job.data;

  // 1. Load tenant
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') {
    logger.warn({ tenantId }, 'Tenant inactive/missing for campaign send');
    await markFailed(campaignContactId);
    return;
  }

  if (!tenant.evolutionInstanceId) {
    logger.warn({ tenantId }, 'No Evolution instance for campaign send');
    await markFailed(campaignContactId);
    return;
  }

  // 2. Re-check business hours
  const businessHours = tenant.businessHours as { start: string; end: string; days: number[] };
  if (!isWithinBusinessHours(tenant.timezone, businessHours)) {
    throw new Error('Outside business hours — BullMQ will retry with backoff');
  }

  // 3. Re-check contact opt-out
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.optedOut) {
    logger.info({ phone, campaignId }, 'Contact opted out or not found, skipping');
    await prisma.campaignContact.update({
      where: { id: campaignContactId },
      data: { status: 'opted_out' },
    });
    return;
  }

  // 4. Idempotency guard
  const campaignContact = await prisma.campaignContact.findUnique({
    where: { id: campaignContactId },
  });
  if (!campaignContact || campaignContact.status !== 'pending') {
    logger.debug({ campaignContactId }, 'CampaignContact already processed, skipping');
    return;
  }

  // 5. Template substitution
  const text = substituteTemplate(messageTemplate, {
    nome: contactName ?? '',
    telefone: phone,
    empresa: tenant.businessName,
  });

  // 6. Find or create Conversation
  let conversation = await prisma.conversation.findFirst({
    where: { tenantId, contactId, status: 'active' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        contactId,
        status: 'active',
        context: {
          state: 'greeting',
          extractedData: { source: 'campaign', campaignId, campaignMessage: text },
          qualificationComplete: false,
          messageCount: 0,
        },
      },
    });
  }

  // 7. Send message
  try {
    await sendMessage({
      tenantId,
      conversationId: conversation.id,
      instanceName: tenant.evolutionInstanceId,
      phone,
      text,
      delay: randomCampaignDelay(),
    });
  } catch (err) {
    logger.error({ err, phone, campaignId }, 'Failed to send campaign message');
    await markFailed(campaignContactId);
    throw err; // Let BullMQ retry
  }

  // 8. Update CampaignContact status
  await prisma.campaignContact.update({
    where: { id: campaignContactId },
    data: { status: 'sent', sentAt: new Date() },
  });

  // 9. Increment sentCount atomically
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { sentCount: { increment: 1 } },
  });

  // 10. Update contact.lastContactAt
  await prisma.contact.update({
    where: { id: contactId },
    data: { lastContactAt: new Date() },
  });

  logger.info({ campaignId, phone }, 'Campaign message sent');
}

// ── Helpers ─────────────────────────────────────────────────

function substituteTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return vars[key] ?? _match;
  });
}

function randomCampaignDelay(): number {
  // 2-5 seconds — slightly longer than standard 1-3s to reduce ban risk
  return Math.floor(Math.random() * 3000) + 2000;
}

async function markFailed(campaignContactId: string): Promise<void> {
  await prisma.campaignContact.update({
    where: { id: campaignContactId },
    data: { status: 'failed' },
  });
}
