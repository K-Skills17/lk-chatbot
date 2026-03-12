import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendMessage } from '../modules/whatsapp/message.sender';
import { getProvider, getModelForTier } from './ai.router';
import { buildSystemPrompt } from './prompts/system.prompt';
import { buildQualificationPrompt } from './prompts/qualification.prompt';
import { bookingService } from '../modules/booking/booking.service';
import { campaignService } from '../modules/campaign/campaign.service';
import { notificationService } from '../modules/notification/notification.service';
import { getSheetsClient } from '../modules/sheets/sheets.client';
import {
  MessageJobData,
  AiMessage,
  AiAction,
  ConversationContext,
  ModelTier,
} from './ai.types';

// ── Plan Limits ──────────────────────────────────────────────
const PLAN_LIMITS: Record<string, { messagesPerMonth: number | null; aiCostMonthlyUsd: number | null }> = {
  starter:    { messagesPerMonth: 1000,  aiCostMonthlyUsd: 50 },
  pro:        { messagesPerMonth: 10000, aiCostMonthlyUsd: 500 },
  enterprise: { messagesPerMonth: null,  aiCostMonthlyUsd: null }, // unlimited
};

const DEFAULT_CONTEXT: ConversationContext = {
  state: 'greeting',
  extractedData: {},
  qualificationComplete: false,
  messageCount: 0,
};

const MAX_HISTORY_MESSAGES = 20;

const OPT_OUT_KEYWORDS = ['sair', 'parar', 'pare', 'stop', 'cancelar', 'não quero mais'];

/** Main entry point — processes a single inbound message through the AI engine */
export async function processMessage(job: MessageJobData): Promise<void> {
  const { tenantId, contactId, conversationId, phone, text, messageType } = job;

  // 1. Load tenant
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') {
    logger.warn({ tenantId }, 'Skipping message for inactive/missing tenant');
    return;
  }

  // 1b. Check plan limits
  const limitExceeded = await checkPlanLimits(tenant);
  if (limitExceeded) {
    logger.warn({ tenantId, plan: tenant.plan, reason: limitExceeded }, 'Plan limit exceeded');
    await sendMessage({
      tenantId,
      conversationId,
      instanceName: tenant.evolutionInstanceId!,
      phone,
      text: 'Desculpe, nosso limite de atendimentos do mês foi atingido. Por favor, entre em contato novamente em breve ou fale com nossa equipe diretamente.',
    });
    return;
  }

  // 2. Load contact
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    logger.warn({ contactId }, 'Contact not found');
    return;
  }

  // 3. Check opt-out
  if (contact.optedOut) {
    logger.info({ phone }, 'Ignoring message from opted-out contact');
    return;
  }

  if (text && isOptOut(text)) {
    await handleOptOut(tenantId, contactId, conversationId, tenant.evolutionInstanceId!, phone);
    return;
  }

  // 4. Load conversation
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.status === 'closed') {
    logger.warn({ conversationId }, 'Conversation not found or closed');
    return;
  }

  // 5. Parse existing context or create default
  const context: ConversationContext = conversation.context
    ? { ...DEFAULT_CONTEXT, ...(conversation.context as Record<string, any>) }
    : { ...DEFAULT_CONTEXT };

  // 6. Handle non-text messages
  const aiConfig = tenant.aiConfig as Record<string, any>;
  const effectiveText = resolveMessageText(text, messageType);

  // 7. Load recent conversation history
  const history = await loadHistory(conversationId);

  // 8. Build system prompt (pass full aiConfig for business knowledge base)
  const bookingCfg = tenant.bookingConfig as Record<string, any> | null;
  const systemPrompt = buildSystemPrompt(
    {
      businessName: tenant.businessName,
      timezone: tenant.timezone,
      businessHours: tenant.businessHours as { start: string; end: string; days: number[] },
      calendlyUrl: bookingCfg?.calendlyUrl,
      aiConfig: {
        systemPrompt: aiConfig.systemPrompt,
        qualificationCriteria: aiConfig.qualificationCriteria ?? [],
        businessDescription: aiConfig.businessDescription,
        services: aiConfig.services,
        faq: aiConfig.faq,
        targetAudience: aiConfig.targetAudience,
        tone: aiConfig.tone,
        greeting: aiConfig.greeting,
        closingMessage: aiConfig.closingMessage,
        escalationRules: aiConfig.escalationRules,
        forbiddenTopics: aiConfig.forbiddenTopics,
      },
    },
    {
      name: contact.name,
      phone: contact.phone,
      leadScore: contact.leadScore,
      leadStatus: contact.leadStatus,
      qualificationData: contact.qualificationData as Record<string, any> | null,
    },
    context,
  );

  // 9. Select model tier and provider
  const providerName: 'claude' | 'openai' = aiConfig.model ?? env.AI_PRIMARY_PROVIDER;
  const tier: ModelTier = 'fast';
  const provider = getProvider(providerName);
  const model = getModelForTier(providerName, tier);

  // 10. Call AI
  const aiResponse = await provider.chat({
    systemPrompt,
    messages: [...history, { role: 'user', content: effectiveText }],
    model,
    temperature: aiConfig.temperature ?? 0.7,
  });

  // 11. Parse structured response
  const action = parseAiResponse(aiResponse.text);

  // 12. If qualification decision, run smart model for scoring
  if (
    action.nextState === 'qualified' &&
    !context.qualificationComplete
  ) {
    const qualResult = await runQualificationEvaluation(
      tenant,
      contact,
      context,
      history,
      providerName,
    );
    if (qualResult) {
      action.leadScore = qualResult.leadScore;
      action.leadStatus = qualResult.leadStatus as any;
      action.qualificationReasoning = qualResult.reasoning;
    }
  }

  // 13. Create booking if AI confirmed a date/time
  if (action.bookingDate && action.bookingTime && action.nextState === 'closed') {
    try {
      const scheduledAt = parseBookingDateTime(action.bookingDate, action.bookingTime, tenant.timezone);
      if (scheduledAt) {
        await bookingService.create({
          tenantId,
          contactId,
          scheduledAt,
          appointmentType: context.extractedData?.appointmentType ?? undefined,
          notes: `Agendado via chatbot. ${context.extractedData?.notes ?? ''}`.trim(),
        });
        action.leadStatus = 'booked';
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create booking from AI action');
    }
  }

  // 14. Send reply via WhatsApp
  await sendMessage({
    tenantId,
    conversationId,
    instanceName: tenant.evolutionInstanceId!,
    phone,
    text: action.replyText,
  });

  // 15. Update the outbound message with AI metadata and cost tracking
  const costUsd = calculateAiCost(model, aiResponse.inputTokens, aiResponse.outputTokens);
  await updateLastOutboundMessage(conversationId, model, aiResponse.totalTokens, costUsd);
  await trackTenantAiCost(tenantId, costUsd);

  // 16. Apply side effects
  await applySideEffects(tenantId, conversationId, contactId, phone, context, action);

  // 17. Increment monthly message counter for plan enforcement
  await incrementMessageCount(tenantId);

  logger.info(
    { phone, model, tokens: aiResponse.totalTokens, state: action.nextState ?? context.state },
    'Message processed successfully',
  );
}

// ── Helpers ─────────────────────────────────────────────────

function isOptOut(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some((kw) => normalized === kw || normalized.startsWith(kw + ' '));
}

async function handleOptOut(
  tenantId: string,
  contactId: string,
  conversationId: string,
  instanceName: string,
  phone: string,
): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { optedOut: true, optedOutAt: new Date() },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'closed', closedAt: new Date() },
  });

  await sendMessage({
    tenantId,
    conversationId,
    instanceName,
    phone,
    text: 'Entendido! Você não receberá mais mensagens. Se precisar de algo no futuro, é só mandar mensagem. Até mais! 👋',
  });

  logger.info({ phone }, 'Contact opted out');
}

function resolveMessageText(text: string | null, messageType: string): string {
  if (text) return text;

  switch (messageType) {
    case 'audio':
      return '[O contato enviou uma mensagem de áudio]';
    case 'image':
      return '[O contato enviou uma imagem]';
    case 'document':
      return '[O contato enviou um documento]';
    default:
      return '[O contato enviou uma mensagem não-textual]';
  }
}

async function loadHistory(conversationId: string): Promise<AiMessage[]> {
  // Fetch the LATEST N messages (desc), then reverse to chronological order
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: { direction: true, content: true },
  });

  return messages
    .reverse() // back to chronological order (oldest first)
    .filter((m) => m.content)
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content!,
    }));
}

function parseAiResponse(rawText: string): AiAction {
  const fallback: AiAction = {
    replyText: rawText,
    shouldEscalate: false,
  };

  try {
    // Try JSON inside markdown code fence
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return parseActionJson(jsonMatch[1], rawText);
    }

    // Try parsing entire text as JSON
    return parseActionJson(rawText, rawText);
  } catch {
    logger.warn('Failed to parse AI response as JSON, using raw text');
  }

  return fallback;
}

function parseActionJson(jsonStr: string, rawText: string): AiAction {
  const parsed = JSON.parse(jsonStr);
  return {
    replyText: parsed.replyText ?? rawText,
    nextState: parsed.nextState ?? undefined,
    extractedData: parsed.extractedData ?? undefined,
    leadScore: parsed.leadScore ?? undefined,
    leadStatus: parsed.leadStatus ?? undefined,
    shouldEscalate: parsed.shouldEscalate ?? false,
    qualificationReasoning: parsed.qualificationReasoning ?? undefined,
    bookingDate: parsed.bookingDate ?? undefined,
    bookingTime: parsed.bookingTime ?? undefined,
  };
}

function parseBookingDateTime(dateStr: string, timeStr: string, timezone: string): Date | null {
  try {
    // Build an ISO-like string and interpret it in the tenant's timezone.
    // e.g. "2026-02-15" + "14:30" + "America/Sao_Paulo"
    // We construct a date string and use toLocaleString to reverse-map the timezone offset.
    const isoStr = `${dateStr}T${timeStr}:00`;

    // Parse as if in the given timezone by computing the UTC offset
    const localDate = new Date(isoStr); // parsed as local (server TZ)
    if (isNaN(localDate.getTime())) return null;

    // Get the time in the target timezone, then compute the offset
    const inTz = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
    const inUtc = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMs = inUtc.getTime() - inTz.getTime();

    // The desired UTC time is: the naive datetime + the timezone offset
    const naiveMs = localDate.getTime();
    const utcDate = new Date(naiveMs + offsetMs);
    if (isNaN(utcDate.getTime())) return null;
    return utcDate;
  } catch {
    return null;
  }
}

async function runQualificationEvaluation(
  tenant: any,
  contact: any,
  context: ConversationContext,
  history: AiMessage[],
  providerName: 'claude' | 'openai',
): Promise<{ leadScore: number; leadStatus: string; reasoning: string } | null> {
  try {
    const provider = getProvider(providerName);
    const model = getModelForTier(providerName, 'smart');

    const summary = history
      .map((m) => `${m.role === 'user' ? 'Contato' : 'Assistente'}: ${m.content}`)
      .join('\n');

    const prompt = buildQualificationPrompt({
      businessName: tenant.businessName,
      criteria: (tenant.aiConfig as any).qualificationCriteria ?? [],
      contactName: contact.name,
      extractedData: context.extractedData,
      conversationSummary: summary,
    });

    const response = await provider.chat({
      systemPrompt: 'Você é um avaliador de leads. Responda apenas com JSON.',
      messages: [{ role: 'user', content: prompt }],
      model,
      temperature: 0.3,
    });

    const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : response.text);

    return {
      leadScore: parsed.leadScore,
      leadStatus: parsed.leadStatus,
      reasoning: parsed.reasoning,
    };
  } catch (err) {
    logger.error({ err }, 'Qualification evaluation failed');
    return null;
  }
}

async function updateLastOutboundMessage(
  conversationId: string,
  model: string,
  tokens: number,
  costUsd: number,
): Promise<void> {
  const lastMsg = await prisma.message.findFirst({
    where: { conversationId, direction: 'outbound' },
    orderBy: { createdAt: 'desc' },
  });

  if (lastMsg) {
    await prisma.message.update({
      where: { id: lastMsg.id },
      data: { aiModelUsed: model, aiTokensUsed: tokens, aiCostUsd: costUsd },
    });
  }
}

/** Calculate AI cost in USD based on model pricing per 1M tokens */
function calculateAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-20241022':  { input: 1.0, output: 5.0 },
    'gpt-4o-mini':                { input: 0.15, output: 0.60 },
    'gpt-4o':                     { input: 2.50, output: 10.0 },
  };
  const rates = pricing[model] ?? { input: 3.0, output: 15.0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/** Track cumulative AI cost on the tenant, resetting monthly */
async function trackTenantAiCost(tenantId: string, costUsd: number): Promise<void> {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { costResetMonth: true, monthlyAiCostUsd: true },
  });
  if (!tenant) return;

  if (tenant.costResetMonth !== currentMonth) {
    // New month — reset counter
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { monthlyAiCostUsd: costUsd, costResetMonth: currentMonth },
    });
  } else {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { monthlyAiCostUsd: { increment: costUsd } },
    });
  }
}

/** Check if the tenant has exceeded their plan limits. Returns a reason string or null. */
async function checkPlanLimits(tenant: {
  plan: string;
  messagesThisMonth: number;
  messageMonthStart: string | null;
  monthlyAiCostUsd: number;
  costResetMonth: string | null;
}): Promise<string | null> {
  const limits = PLAN_LIMITS[tenant.plan] ?? PLAN_LIMITS.starter;
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Check message limit
  if (limits.messagesPerMonth !== null) {
    const count = tenant.messageMonthStart === currentMonth ? tenant.messagesThisMonth : 0;
    if (count >= limits.messagesPerMonth) {
      return `messages: ${count}/${limits.messagesPerMonth}`;
    }
  }

  // Check AI cost limit
  if (limits.aiCostMonthlyUsd !== null) {
    const cost = tenant.costResetMonth === currentMonth ? tenant.monthlyAiCostUsd : 0;
    if (cost >= limits.aiCostMonthlyUsd) {
      return `ai_cost: $${cost.toFixed(2)}/$${limits.aiCostMonthlyUsd}`;
    }
  }

  return null;
}

/** Increment the monthly message counter, resetting if the month changed */
async function incrementMessageCount(tenantId: string): Promise<void> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { messageMonthStart: true },
  });
  if (!tenant) return;

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
}

async function applySideEffects(
  tenantId: string,
  conversationId: string,
  contactId: string,
  phone: string,
  currentContext: ConversationContext,
  action: AiAction,
): Promise<void> {
  // Update conversation context
  const updatedContext: ConversationContext = {
    ...currentContext,
    state: action.nextState ?? currentContext.state,
    extractedData: {
      ...currentContext.extractedData,
      ...(action.extractedData ?? {}),
    },
    qualificationComplete:
      action.leadStatus === 'qualified' || action.leadStatus === 'lost'
        ? true
        : currentContext.qualificationComplete,
    messageCount: currentContext.messageCount + 1,
  };

  const conversationUpdate: Record<string, any> = {
    context: updatedContext,
    lastMessageAt: new Date(),
  };

  if (action.nextState === 'closed') {
    conversationUpdate.status = 'closed';
    conversationUpdate.closedAt = new Date();
  }
  if (action.shouldEscalate) {
    conversationUpdate.status = 'escalated';
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: conversationUpdate,
  });

  // Update contact if lead data changed
  const contactUpdate: Record<string, any> = {};

  if (action.leadScore != null) {
    contactUpdate.leadScore = action.leadScore;
  }
  if (action.leadStatus) {
    contactUpdate.leadStatus = action.leadStatus;
  }
  if (action.qualificationReasoning || action.extractedData) {
    const existing =
      ((
        await prisma.contact.findUnique({
          where: { id: contactId },
          select: { qualificationData: true },
        })
      )?.qualificationData as Record<string, any>) ?? {};

    contactUpdate.qualificationData = {
      ...existing,
      ...(action.extractedData ?? {}),
      ...(action.qualificationReasoning
        ? { _reasoning: action.qualificationReasoning }
        : {}),
    };
  }

  if (Object.keys(contactUpdate).length > 0) {
    contactUpdate.lastContactAt = new Date();
    await prisma.contact.update({
      where: { id: contactId },
      data: contactUpdate,
    });
  }

  // Track campaign funnel progression
  if (action.leadStatus === 'qualified' || action.leadStatus === 'booked') {
    await trackCampaignFunnel(contactId, action.leadStatus);
  }

  // Export lead to Google Sheets if configured
  if (action.leadStatus === 'qualified' || action.leadStatus === 'booked') {
    try {
      const tenantData = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { bookingConfig: true },
      });
      const sheetsClient = getSheetsClient(tenantData?.bookingConfig);
      if (sheetsClient) {
        const contactData = await prisma.contact.findUnique({ where: { id: contactId } });
        if (contactData) {
          await sheetsClient.ensureHeaders();
          await sheetsClient.appendLead({
            date: new Date().toLocaleDateString('pt-BR'),
            name: contactData.name ?? '',
            phone: contactData.phone,
            email: contactData.email ?? undefined,
            leadScore: action.leadScore ?? contactData.leadScore,
            leadStatus: action.leadStatus,
            source: updatedContext.extractedData?.source ?? 'whatsapp',
            qualificationData: contactData.qualificationData
              ? JSON.stringify(contactData.qualificationData)
              : undefined,
          });
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to export lead to Google Sheets');
    }
  }

  // Send notifications (non-blocking)
  try {
    const contactName = action.extractedData?.nome ?? '';

    if (action.shouldEscalate) {
      await notificationService.notifyEscalation(tenantId, contactName, phone);
    }

    if (action.leadStatus === 'qualified' && currentContext.messageCount <= 2) {
      await notificationService.notifyNewLead(tenantId, contactName, phone);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to send notification');
  }
}

async function trackCampaignFunnel(
  contactId: string,
  newStatus: 'qualified' | 'booked',
): Promise<void> {
  try {
    const campaignContacts = await prisma.campaignContact.findMany({
      where: { contactId, status: 'replied' },
    });

    for (const cc of campaignContacts) {
      if (newStatus === 'qualified') {
        await campaignService.incrementQualifiedCount(cc.campaignId);
      } else if (newStatus === 'booked') {
        await campaignService.incrementBookedCount(cc.campaignId);
      }
    }
  } catch (err) {
    logger.error({ err, contactId, newStatus }, 'Failed to track campaign funnel');
  }
}
