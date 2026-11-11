import crypto from 'crypto';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getProvider, getModelForTier } from '../../ai/ai.router';
import { buildSystemPrompt } from '../../ai/prompts/system.prompt';
import { bookingService } from '../booking/booking.service';
import { notificationService } from '../notification/notification.service';
import { analyzeVisualReference, formatAnalysisForConversation } from '../../ai/vision/visual.analyzer';
import {
  AiMessage,
  AiAction,
  ConversationContext,
  ModelTier,
} from '../../ai/ai.types';
import { buildQualificationPrompt } from '../../ai/prompts/qualification.prompt';
import { parseEnvelope } from '../../concierge/envelope';
import { v4 as uuid } from 'uuid';

const DEFAULT_CONTEXT: ConversationContext = {
  state: 'greeting',
  extractedData: {},
  qualificationComplete: false,
  messageCount: 0,
};

const MAX_HISTORY_MESSAGES = 20;

// ── Session Management ──────────────────────────────────────

export interface WebChatSession {
  sessionId: string;
  conversationId: string;
  contactId: string;
  tenantId: string;
}

/**
 * Create or resume a web chat session.
 * Uses a sessionId (stored in browser localStorage) to find the existing
 * contact + conversation, or creates new ones.
 */
export async function getOrCreateSession(
  tenantId: string,
  sessionId?: string,
): Promise<WebChatSession> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') {
    throw new Error('Tenant not found or inactive');
  }

  // Try to resume existing session
  if (sessionId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: sessionId, tenantId, channel: 'web' },
      include: { contact: true },
    });
    if (existing && existing.status !== 'closed') {
      return {
        sessionId: existing.id,
        conversationId: existing.id,
        contactId: existing.contactId,
        tenantId,
      };
    }
  }

  // Create new anonymous web contact
  const contactId = uuid();
  const conversationId = uuid();
  const webPhone = `web-${contactId.slice(0, 8)}`; // placeholder phone for web visitors

  await prisma.contact.create({
    data: {
      id: contactId,
      tenantId,
      phone: webPhone,
      channel: 'web',
      leadStatus: 'new',
    },
  });

  await prisma.conversation.create({
    data: {
      id: conversationId,
      tenantId,
      contactId,
      channel: 'web',
      status: 'active',
      context: DEFAULT_CONTEXT as any,
    },
  });

  return {
    sessionId: conversationId,
    conversationId,
    contactId,
    tenantId,
  };
}

// ── Message Processing ──────────────────────────────────────

export interface WebChatResponse {
  reply: string;
  sessionId: string;
}

/**
 * Process a web chat message synchronously through the AI engine
 * and return the response directly (no WhatsApp sending).
 */
export async function processWebMessage(
  session: WebChatSession,
  text: string,
  imageBase64?: string,
  imageMimeType?: string,
): Promise<WebChatResponse> {
  const { tenantId, contactId, conversationId } = session;

  // Load tenant
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') {
    throw new Error('Tenant not found or inactive');
  }

  // Load contact
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new Error('Contact not found');

  // Load conversation
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new Error('Conversation not found');

  // Parse context
  const context: ConversationContext = conversation.context
    ? { ...DEFAULT_CONTEXT, ...(conversation.context as Record<string, any>) }
    : { ...DEFAULT_CONTEXT };

  // Save inbound message
  await prisma.message.create({
    data: {
      id: crypto.randomUUID(),
      conversationId,
      tenantId,
      direction: 'inbound',
      messageType: imageBase64 ? 'image' : 'text',
      content: text || (imageBase64 ? '[imagem]' : ''),
      status: 'sent',
    },
  });

  // Load conversation history
  const history = await loadHistory(conversationId);

  // If image was sent, analyze it via Claude Vision and prepend to user text
  let effectiveText = text;
  if (imageBase64) {
    try {
      const businessType = (tenant.aiConfig as any).businessType as string | undefined;
      const analysis = await analyzeVisualReference(imageBase64, imageMimeType ?? 'image/jpeg', businessType);
      if (!analysis) throw new Error('Image analysis returned null');
      const analysisText = formatAnalysisForConversation(analysis, businessType);
      effectiveText = text ? `${analysisText}\n\n${text}` : analysisText;
    } catch (err) {
      logger.error({ err }, 'Web chat: image analysis failed, falling back to text only');
      effectiveText = text || '[O usuário enviou uma imagem que não pôde ser analisada]';
    }
  }

  // Build system prompt
  const aiConfig = tenant.aiConfig as Record<string, any>;
  const systemPrompt = buildSystemPrompt(
    {
      businessName: tenant.businessName,
      timezone: tenant.timezone,
      businessHours: tenant.businessHours as { start: string; end: string; days: number[] },
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

  // Call AI
  const providerName: 'claude' | 'openai' = aiConfig.model ?? env.AI_PRIMARY_PROVIDER;
  const tier: ModelTier = 'fast';
  const provider = getProvider(providerName);
  const model = getModelForTier(providerName, tier);

  const aiResponse = await provider.chat({
    systemPrompt,
    messages: [...history, { role: 'user', content: effectiveText }],
    model,
    temperature: aiConfig.temperature ?? 0.7,
  });

  // Parse AI response via concierge envelope (same as WhatsApp engine)
  const envelope = parseEnvelope(aiResponse.text);
  const replyText = envelope.reply;

  // Map envelope to AiAction for side effects
  const aiAction: AiAction = {
    replyText,
    nextState: envelope.stage as any,
    extractedData: envelope.qualification as any,
    leadScore: undefined,
    leadStatus: undefined,
    shouldEscalate: envelope.action === 'encaminhar',
    bookingDate: envelope.bookingDate,
    bookingTime: envelope.bookingTime,
  };

  // Qualification evaluation if needed
  if (aiAction.nextState === 'qualified' && !context.qualificationComplete) {
    const qualResult = await runQualificationEvaluation(tenant, contact, context, history, providerName);
    if (qualResult) {
      aiAction.leadScore = qualResult.leadScore;
      aiAction.leadStatus = qualResult.leadStatus as any;
      aiAction.qualificationReasoning = qualResult.reasoning;
    }
  }

  // Create booking if AI confirmed a date/time
  const action = envelope.action;
  if (action === 'agendar' && envelope.bookingDate && envelope.bookingTime) {
    try {
      const scheduledAt = parseBookingDateTime(envelope.bookingDate, envelope.bookingTime, tenant.timezone);
      if (scheduledAt) {
        const booking = await bookingService.create({
          tenantId,
          contactId,
          scheduledAt,
          appointmentType: context.extractedData?.appointmentType ?? undefined,
          notes: `Agendado via chat do site. ${envelope.handoff_summary ?? ''}`.trim(),
        });
        aiAction.leadStatus = 'booked';

        if (booking.meetLink && !replyText.includes(booking.meetLink)) {
          aiAction.replyText += `\n\nLink da reunião: ${booking.meetLink}`;
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create booking from web chat');
    }
  }

  // Save outbound message
  const costUsd = calculateAiCost(model, aiResponse.inputTokens, aiResponse.outputTokens);
  await prisma.message.create({
    data: {
      id: crypto.randomUUID(),
      conversationId,
      tenantId,
      direction: 'outbound',
      messageType: 'text',
      content: aiAction.replyText,
      aiModelUsed: model,
      aiTokensUsed: aiResponse.totalTokens,
      aiCostUsd: costUsd,
      status: 'sent',
    },
  });

  // Apply side effects (update context, contact, notifications)
  await applySideEffects(tenantId, conversationId, contactId, context, aiAction);

  // Track cost
  await trackTenantAiCost(tenantId, costUsd);

  logger.info(
    { conversationId, model, tokens: aiResponse.totalTokens, state: aiAction.nextState ?? context.state, action },
    'Web chat message processed',
  );

  return {
    reply: aiAction.replyText,
    sessionId: conversationId,
  };
}

/**
 * Get message history for a web chat session.
 */
export async function getMessages(
  conversationId: string,
  tenantId: string,
): Promise<{ role: 'user' | 'assistant'; content: string; createdAt: Date }[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId, tenantId },
    orderBy: { createdAt: 'asc' },
    select: { direction: true, content: true, createdAt: true },
  });

  return messages
    .filter((m) => m.content)
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content!,
      createdAt: m.createdAt,
    }));
}

// ── Internal Helpers (mirrored from conversation.engine.ts) ──

async function loadHistory(conversationId: string): Promise<AiMessage[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: { direction: true, content: true },
  });

  return messages
    .reverse()
    .filter((m) => m.content)
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content!,
    }));
}

function parseAiResponse(rawText: string): AiAction {
  const fallback: AiAction = { replyText: rawText, shouldEscalate: false };
  try {
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return parseActionJson(jsonMatch[1], rawText);
    return parseActionJson(rawText, rawText);
  } catch {
    logger.warn('Web chat: failed to parse AI response as JSON, using raw text');
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
    const isoStr = `${dateStr}T${timeStr}:00`;
    const localDate = new Date(isoStr);
    if (isNaN(localDate.getTime())) return null;
    const inTz = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
    const inUtc = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMs = inUtc.getTime() - inTz.getTime();
    const utcDate = new Date(localDate.getTime() + offsetMs);
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
    return { leadScore: parsed.leadScore, leadStatus: parsed.leadStatus, reasoning: parsed.reasoning };
  } catch (err) {
    logger.error({ err }, 'Web chat qualification evaluation failed');
    return null;
  }
}

function calculateAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4o': { input: 2.50, output: 10.0 },
  };
  const rates = pricing[model] ?? { input: 3.0, output: 15.0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

async function trackTenantAiCost(tenantId: string, costUsd: number): Promise<void> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { costResetMonth: true, monthlyAiCostUsd: true },
  });
  if (!tenant) return;
  if (tenant.costResetMonth !== currentMonth) {
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

async function applySideEffects(
  tenantId: string,
  conversationId: string,
  contactId: string,
  currentContext: ConversationContext,
  action: AiAction,
): Promise<void> {
  const updatedContext: ConversationContext = {
    ...currentContext,
    state: action.nextState ?? currentContext.state,
    extractedData: { ...currentContext.extractedData, ...(action.extractedData ?? {}) },
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

  // Update contact
  const contactUpdate: Record<string, any> = {};
  if (action.leadScore != null) contactUpdate.leadScore = action.leadScore;
  if (action.leadStatus) contactUpdate.leadStatus = action.leadStatus;
  if (action.extractedData?.nome) contactUpdate.name = action.extractedData.nome;
  if (action.extractedData?.email) contactUpdate.email = action.extractedData.email;
  if (action.qualificationReasoning || action.extractedData) {
    const existing =
      ((await prisma.contact.findUnique({ where: { id: contactId }, select: { qualificationData: true } }))
        ?.qualificationData as Record<string, any>) ?? {};
    contactUpdate.qualificationData = {
      ...existing,
      ...(action.extractedData ?? {}),
      ...(action.qualificationReasoning ? { _reasoning: action.qualificationReasoning } : {}),
    };
  }
  if (Object.keys(contactUpdate).length > 0) {
    contactUpdate.lastContactAt = new Date();
    await prisma.contact.update({ where: { id: contactId }, data: contactUpdate });
  }

  // Notifications
  try {
    const contactName = action.extractedData?.nome ?? action.extractedData?.name ?? '';
    if (action.shouldEscalate) {
      await notificationService.notifyEscalation(
        tenantId,
        contactName,
        'web-demo',
        undefined,
        { extractedData: updatedContext.extractedData, messageCount: updatedContext.messageCount },
      );
    }
    if (action.leadStatus === 'qualified' && currentContext.messageCount <= 2) {
      await notificationService.notifyNewLead(tenantId, contactName, 'web-demo');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to send notification for web chat');
  }
}
