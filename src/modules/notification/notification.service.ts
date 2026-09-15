import crypto from 'crypto';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { getNotificationQueue } from '../../jobs/queue.setup';

export type NotificationType = 'new_lead' | 'booking' | 'escalation' | 'daily_summary';
export type NotificationChannel = 'whatsapp' | 'email' | 'webhook' | 'telegram';

interface NotifyInput {
  tenantId: string;
  type: NotificationType;
  channel: NotificationChannel;
  recipient: string;
  content: string;
}

export class NotificationService {
  /** Create and enqueue a notification */
  async notify(input: NotifyInput): Promise<void> {
    const notification = await prisma.notification.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        type: input.type,
        channel: input.channel,
        recipient: input.recipient,
        content: input.content,
        status: 'pending',
      },
    });

    await getNotificationQueue().add('send-notification', {
      notificationId: notification.id,
      tenantId: input.tenantId,
      type: input.type,
      channel: input.channel,
      recipient: input.recipient,
      content: input.content,
    });

    logger.debug({ notificationId: notification.id, type: input.type }, 'Notification enqueued');
  }

  /** Send notifications for a new lead event */
  async notifyNewLead(tenantId: string, contactName: string, phone: string): Promise<void> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return;

    const notifyConfig = getNotifyConfig(tenant);
    if (!notifyConfig?.newLead) return;

    const content = `Novo lead: ${contactName || phone}\nTelefone: ${phone}`;

    await this.sendToOwnerChannels(tenantId, 'new_lead', content, notifyConfig);
  }

  /** Send notifications for a booking event */
  async notifyBooking(
    tenantId: string,
    contactName: string,
    scheduledAt: Date,
  ): Promise<void> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return;

    const notifyConfig = getNotifyConfig(tenant);
    if (!notifyConfig?.booking) return;

    const dateStr = scheduledAt.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const content = `Novo agendamento!\nCliente: ${contactName}\nData: ${dateStr}`;

    await this.sendToOwnerChannels(tenantId, 'booking', content, notifyConfig);
  }

  /** Send notifications for an escalation event */
  async notifyEscalation(
    tenantId: string,
    contactName: string,
    phone: string,
    reason?: string,
    leadContext?: { extractedData?: Record<string, any>; messageCount?: number },
  ): Promise<void> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return;

    const notifyConfig = getNotifyConfig(tenant);
    if (!notifyConfig?.escalation) return;

    const content = buildEscalationMessage(contactName, phone, reason, leadContext);

    await this.sendToOwnerChannels(tenantId, 'escalation', content, notifyConfig);
  }

  /** List notifications for a tenant */
  async listByTenant(tenantId: string, options?: { type?: string; limit?: number }) {
    return prisma.notification.findMany({
      where: {
        tenantId,
        ...(options?.type ? { type: options.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
  }

  /** Route notification to all configured owner channels */
  private async sendToOwnerChannels(
    tenantId: string,
    type: NotificationType,
    content: string,
    notifyConfig: any,
  ): Promise<void> {
    // WhatsApp notification to owner
    if (notifyConfig.ownerPhone) {
      await this.notify({
        tenantId,
        type,
        channel: 'whatsapp',
        recipient: notifyConfig.ownerPhone,
        content,
      });
    }

    // Email notification
    if (notifyConfig.ownerEmail) {
      await this.notify({
        tenantId,
        type,
        channel: 'email',
        recipient: notifyConfig.ownerEmail,
        content,
      });
    }

    // Webhook notification
    if (notifyConfig.webhookUrl) {
      await this.notify({
        tenantId,
        type,
        channel: 'webhook',
        recipient: notifyConfig.webhookUrl,
        content,
      });
    }

    // Telegram notification
    if (notifyConfig.telegramChatId) {
      await this.notify({
        tenantId,
        type,
        channel: 'telegram',
        recipient: String(notifyConfig.telegramChatId),
        content,
      });
    }
  }
}

/**
 * Build a rich escalation message that includes lead qualification context
 * so the recipient (receptionist/sales rep) doesn't start from zero.
 */
function buildEscalationMessage(
  contactName: string,
  phone: string,
  reason?: string,
  leadContext?: { extractedData?: Record<string, any>; messageCount?: number },
): string {
  const lines: string[] = [];

  lines.push('🔔 *Novo lead do Demo LK Digital*');
  lines.push('');

  // Identity
  const name = contactName || leadContext?.extractedData?.nome || leadContext?.extractedData?.name;
  if (name) lines.push(`*Nome:* ${name}`);

  // How far they got in the demo
  const msgCount = leadContext?.messageCount;
  if (msgCount != null) {
    const engagement = msgCount >= 6 ? 'Alto (percorreu o fluxo completo)' : msgCount >= 3 ? 'Médio' : 'Baixo (poucas mensagens)';
    lines.push(`*Engajamento:* ${engagement} — ${msgCount} trocas de mensagem`);
  }

  // Extracted qualification data — skip internal fields and the __start__ trigger
  const data = leadContext?.extractedData ?? {};
  const skipKeys = new Set(['_reasoning', 'source']);
  const labelMap: Record<string, string> = {
    nome: 'Nome',
    name: 'Nome',
    email: 'E-mail',
    tratamento: 'Interesse',
    servico: 'Serviço de interesse',
    urgencia: 'Urgência',
    paciente_novo: 'Paciente novo',
    tipo_paciente: 'Tipo',
    cadeiras: 'Cadeiras na clínica',
    num_cadeiras: 'Cadeiras',
    whatsapp_atual: 'Setup WhatsApp atual',
    decisor: 'É o decisor',
    is_owner: 'É o dono',
    orcamento: 'Orçamento',
    marketing_budget: 'Orçamento de marketing',
    dor_principal: 'Principal dor',
    contexto: 'Contexto',
    tipo_lead: 'Tipo de visitante',
  };

  const qualLines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (skipKeys.has(key) || key.startsWith('_') || !value) continue;
    if (typeof value === 'string' && value === '__start__') continue;
    const label = labelMap[key] ?? key;
    qualLines.push(`• *${label}:* ${value}`);
  }

  if (qualLines.length > 0) {
    lines.push('');
    lines.push('*Dados coletados no chat:*');
    lines.push(...qualLines);
  }

  if (reason) {
    lines.push('');
    lines.push(`*Motivo do encaminhamento:* ${reason}`);
  }

  lines.push('');
  lines.push('_Responda a essa mensagem para iniciar o atendimento._');

  return lines.join('\n');
}

/**
 * Extract notification config from the correct tenant field.
 * Checks `notificationConfig` (the dedicated field) first,
 * then falls back to `aiConfig.notifications` for backward compatibility.
 */
function getNotifyConfig(tenant: any): any {
  // Primary: dedicated notificationConfig column
  if (tenant.notificationConfig && typeof tenant.notificationConfig === 'object') {
    return tenant.notificationConfig;
  }
  // Fallback: nested inside aiConfig (legacy)
  return (tenant.aiConfig as any)?.notifications ?? null;
}

export const notificationService = new NotificationService();
