import { Job } from 'bullmq';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { sendMessage } from '../whatsapp/message.sender';

export interface DiagnosticJobData {
  tenantId: string;
  patientPhone: string;
  patientName: string | null;
  diagnostic: {
    type: string;
    summary: string;
    findings?: Array<{
      area: string;
      condition: string;
      severity?: string;
    }>;
    recommendedActions?: string[];
    urgency?: 'routine' | 'soon' | 'urgent';
  };
  timestamp: string;
}

/**
 * BullMQ processor — formats diagnostic results and sends via WhatsApp.
 *
 * Also upserts the contact and stores audit data in qualificationData
 * so the AI conversation engine can reference it when the patient replies.
 */
export async function diagnosticProcessor(job: Job<DiagnosticJobData>): Promise<void> {
  const { tenantId, patientPhone, patientName, diagnostic, timestamp } = job.data;

  logger.info(
    { jobId: job.id, tenantId, phone: patientPhone, type: diagnostic.type },
    'Diagnostic processor started',
  );

  try {
    // 1. Load tenant
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.status !== 'active') {
      logger.warn({ tenantId }, 'Diagnostic processor: tenant not found or inactive');
      return;
    }

    if (!tenant.evolutionInstanceId) {
      logger.warn({ tenantId }, 'Diagnostic processor: tenant has no WhatsApp instance');
      return;
    }

    // 2. Check plan message limit (same logic as conversation engine)
    const currentMonth = new Date().toISOString().slice(0, 7);
    const PLAN_MSG_LIMITS: Record<string, number | null> = {
      starter: 1000,
      pro: 10000,
      enterprise: null,
    };
    const msgLimit = PLAN_MSG_LIMITS[tenant.plan] ?? 1000;
    if (msgLimit !== null) {
      const count = tenant.messageMonthStart === currentMonth ? tenant.messagesThisMonth : 0;
      if (count >= msgLimit) {
        logger.warn({ tenantId, plan: tenant.plan }, 'Diagnostic: plan message limit reached');
        return;
      }
    }

    // 3. Upsert contact — store diagnostic data so AI can reference it later
    const contact = await prisma.contact.upsert({
      where: { tenantId_phone: { tenantId, phone: patientPhone } },
      update: {
        lastContactAt: new Date(),
        name: patientName ?? undefined,
        qualificationData: {
          audit: {
            type: diagnostic.type,
            summary: diagnostic.summary,
            findings: diagnostic.findings ?? [],
            recommendedActions: diagnostic.recommendedActions ?? [],
            urgency: diagnostic.urgency ?? 'routine',
            receivedAt: timestamp,
          },
        },
      },
      create: {
        tenantId,
        phone: patientPhone,
        name: patientName,
        channel: 'whatsapp',
        leadStatus: 'qualifying',
        tags: ['diagnostic-tool'],
        qualificationData: {
          audit: {
            type: diagnostic.type,
            summary: diagnostic.summary,
            findings: diagnostic.findings ?? [],
            recommendedActions: diagnostic.recommendedActions ?? [],
            urgency: diagnostic.urgency ?? 'routine',
            receivedAt: timestamp,
          },
        },
      },
    });

    logger.info({ contactId: contact.id, phone: patientPhone }, 'Diagnostic: contact upserted');

    // 4. Check opt-out
    if (contact.optedOut) {
      logger.info({ phone: patientPhone }, 'Diagnostic: contact opted out, skipping');
      return;
    }

    // 5. Close any existing active conversation (diagnostic starts fresh context)
    await prisma.conversation.updateMany({
      where: { tenantId, contactId: contact.id, status: 'active' },
      data: { status: 'closed', closedAt: new Date() },
    });

    // 6. Create conversation with diagnostic context so AI knows the report was sent
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        status: 'active',
        context: {
          state: 'qualifying',
          extractedData: {
            source: 'diagnostic_tool',
            diagnosticType: diagnostic.type,
            diagnosticSummary: diagnostic.summary,
            urgency: diagnostic.urgency ?? 'routine',
            recommendedActions: diagnostic.recommendedActions ?? [],
          },
          qualificationComplete: false,
          messageCount: 0,
          auditReportSent: true,
        },
      },
    });

    logger.info({ conversationId: conversation.id }, 'Diagnostic: conversation created');

    // 7. Format and send WhatsApp message
    const messageText = formatDiagnosticMessage(tenant.businessName, patientName, diagnostic);

    logger.info(
      { instanceName: tenant.evolutionInstanceId, phone: patientPhone, messageLength: messageText.length },
      'Diagnostic: sending WhatsApp message',
    );

    await sendMessage({
      tenantId,
      conversationId: conversation.id,
      instanceName: tenant.evolutionInstanceId,
      phone: patientPhone,
      text: messageText,
    });

    // 8. Increment monthly message counter
    if (tenant.messageMonthStart !== currentMonth) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { messagesThisMonth: 1, messageMonthStart: currentMonth },
      });
    } else {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { messagesThisMonth: { increment: 1 } },
      });
    }

    logger.info(
      { tenantId, phone: patientPhone, type: diagnostic.type, urgency: diagnostic.urgency },
      'Diagnostic report sent via WhatsApp',
    );
  } catch (err) {
    logger.error(
      { err, jobId: job.id, tenantId, phone: patientPhone },
      'Diagnostic processor failed',
    );
    throw err; // Let BullMQ handle retries
  }
}

// ── Message Formatting ──────────────────────────────────────

function formatDiagnosticMessage(
  businessName: string,
  patientName: string | null,
  diagnostic: DiagnosticJobData['diagnostic'],
): string {
  const greeting = patientName
    ? `Ola, ${patientName}! Aqui e a equipe da *${businessName}*.`
    : `Ola! Aqui e a equipe da *${businessName}*.`;

  const urgencyLabels: Record<string, string> = {
    routine: 'rotina',
    soon: 'em breve',
    urgent: 'urgente',
  };
  const urgencyLabel = urgencyLabels[diagnostic.urgency ?? 'routine'];

  let message = `${greeting}\n\nRecebemos o resultado do seu exame de *${diagnostic.type}*.`;
  message += `\nPrioridade: *${urgencyLabel}*\n`;
  message += `\n${diagnostic.summary}`;

  if (diagnostic.recommendedActions && diagnostic.recommendedActions.length > 0) {
    message += `\n\n*Proximos passos recomendados:*`;
    for (const action of diagnostic.recommendedActions) {
      message += `\n- ${action}`;
    }
  }

  message += `\n\nGostaria de agendar uma consulta para conversarmos sobre os resultados? Responda *sim* para agendarmos o melhor horario para voce.`;

  return message;
}
