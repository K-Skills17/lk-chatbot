import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

/**
 * Calendly Webhook Handler
 *
 * Instead of using Google Calendar OAuth, tenants can just paste their
 * Calendly link in bookingConfig.calendlyUrl. The AI sends this link
 * to qualified leads. When someone books via Calendly, Calendly sends
 * a webhook here with the booking details.
 *
 * Setup:
 * 1. Go to https://calendly.com → Integrations → Webhooks
 * 2. Add webhook URL: https://your-domain.com/webhook/calendly
 * 3. Subscribe to: invitee.created
 * 4. Save your Calendly link in tenant bookingConfig:
 *    { "calendlyUrl": "https://calendly.com/your-name/30min" }
 */

interface CalendlyWebhookPayload {
  event: string; // "invitee.created" | "invitee.canceled"
  payload: {
    event_type?: { uuid?: string; name?: string };
    event?: {
      uuid?: string;
      start_time?: string;
      end_time?: string;
      name?: string;
      location?: { type?: string; location?: string };
    };
    invitee?: {
      uuid?: string;
      name?: string;
      email?: string;
      text_reminder_number?: string; // phone number
      timezone?: string;
    };
    questions_and_answers?: Array<{
      question: string;
      answer: string;
    }>;
    tracking?: {
      utm_source?: string;
      utm_medium?: string;
    };
  };
}

export function registerCalendlyWebhookRoutes(app: FastifyInstance): void {
  /**
   * POST /webhook/calendly
   *
   * Calendly calls this when someone books or cancels.
   * We match the lead by phone or email, create a booking record,
   * and notify the business owner.
   */
  app.post(
    '/webhook/calendly',
    async (request: FastifyRequest<{ Body: CalendlyWebhookPayload }>, reply: FastifyReply) => {
      const { event, payload } = request.body;

      if (!event || !payload) {
        return reply.code(400).send({ error: 'Invalid Calendly webhook payload' });
      }

      logger.info({ event }, 'Calendly webhook received');

      if (event === 'invitee.created') {
        await handleInviteeCreated(payload);
      } else if (event === 'invitee.canceled') {
        await handleInviteeCanceled(payload);
      }

      return reply.code(200).send({ received: true });
    },
  );
}

async function handleInviteeCreated(payload: CalendlyWebhookPayload['payload']): Promise<void> {
  const invitee = payload.invitee;
  const eventData = payload.event;

  if (!invitee || !eventData?.start_time) {
    logger.warn('Calendly invitee.created missing invitee or event data');
    return;
  }

  // Extract phone from questions/answers or text_reminder_number
  const phone = invitee.text_reminder_number ??
    payload.questions_and_answers?.find((q) =>
      q.question.toLowerCase().includes('telefone') ||
      q.question.toLowerCase().includes('phone') ||
      q.question.toLowerCase().includes('whatsapp'),
    )?.answer;

  const email = invitee.email;
  const name = invitee.name;
  const scheduledAt = new Date(eventData.start_time);

  // Try to find the contact by phone or email
  let contact = null;

  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, '');
    contact = await prisma.contact.findFirst({
      where: { phone: { contains: normalizedPhone } },
    });
  }

  if (!contact && email) {
    contact = await prisma.contact.findFirst({
      where: { email },
    });
  }

  if (!contact) {
    logger.info(
      { name, email, phone },
      'Calendly booking from unknown contact — no matching lead in database',
    );
    // Still try to notify the first active tenant
    const tenant = await prisma.tenant.findFirst({ where: { status: 'active' } });
    if (tenant) {
      await notificationService.notifyBooking(
        tenant.id,
        name ?? email ?? phone ?? 'Desconhecido',
        scheduledAt,
      ).catch((err) => logger.error({ err }, 'Failed to send Calendly booking notification'));
    }
    return;
  }

  // Create booking record linked to the contact
  const booking = await prisma.booking.create({
    data: {
      tenantId: contact.tenantId,
      contactId: contact.id,
      scheduledAt,
      durationMinutes: eventData.end_time
        ? Math.round((new Date(eventData.end_time).getTime() - scheduledAt.getTime()) / 60000)
        : 30,
      appointmentType: eventData.name ?? 'Calendly',
      status: 'confirmed',
      calendarEventId: payload.event?.uuid ?? null,
      notes: `Agendado via Calendly. ${name ? `Nome: ${name}` : ''} ${email ? `Email: ${email}` : ''}`.trim(),
    },
  });

  // Update contact status to booked
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      leadStatus: 'booked',
      email: email ?? undefined,
      name: name ?? undefined,
      lastContactAt: new Date(),
    },
  });

  // Close the conversation if it's still active
  await prisma.conversation.updateMany({
    where: { tenantId: contact.tenantId, contactId: contact.id, status: 'active' },
    data: {
      status: 'closed',
      closedAt: new Date(),
    },
  });

  // Notify business owner with all lead info
  await notificationService.notifyBooking(
    contact.tenantId,
    name ?? contact.name ?? contact.phone,
    scheduledAt,
  ).catch((err) => logger.error({ err }, 'Failed to send Calendly booking notification'));

  logger.info(
    { bookingId: booking.id, contactId: contact.id, scheduledAt },
    'Calendly booking created and contact updated to booked',
  );
}

async function handleInviteeCanceled(payload: CalendlyWebhookPayload['payload']): Promise<void> {
  const eventUuid = payload.event?.uuid;
  if (!eventUuid) return;

  // Find and cancel the booking by Calendly event ID
  const booking = await prisma.booking.findFirst({
    where: { calendarEventId: eventUuid },
  });

  if (booking) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'cancelled' },
    });
    logger.info({ bookingId: booking.id }, 'Calendly booking cancelled');
  }
}
