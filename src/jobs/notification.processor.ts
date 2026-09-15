import crypto from 'crypto';
import { Job } from 'bullmq';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { sendMessage } from '../modules/whatsapp/message.sender';

interface NotificationJobData {
  notificationId: string;
  tenantId: string;
  type: string;
  channel: 'whatsapp' | 'email' | 'webhook' | 'telegram';
  recipient: string;
  content: string;
}

export async function notificationProcessor(job: Job<NotificationJobData>): Promise<void> {
  const { notificationId, tenantId, channel, recipient, content } = job.data;

  try {
    switch (channel) {
      case 'whatsapp':
        await sendWhatsAppNotification(tenantId, recipient, content);
        break;
      case 'email':
        await sendEmailNotification(recipient, job.data.type, content);
        break;
      case 'webhook':
        await sendWebhookNotification(recipient, job.data);
        break;
      case 'telegram':
        await sendTelegramNotification(recipient, content);
        break;
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'sent', sentAt: new Date() },
    });

    logger.info({ notificationId, channel, recipient }, 'Notification sent');
  } catch (err) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'failed' },
    });

    logger.error({ err, notificationId, channel }, 'Notification failed');
    throw err; // Let BullMQ retry
  }
}

async function sendWhatsAppNotification(
  tenantId: string,
  phone: string,
  content: string,
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.evolutionInstanceId) {
    throw new Error('Tenant has no Evolution instance');
  }

  // Find or create a conversation for the owner notification
  let conversation = await prisma.conversation.findFirst({
    where: { tenantId, status: 'active' },
    orderBy: { startedAt: 'desc' },
  });

  if (!conversation) {
    // Create a minimal contact + conversation for notifications
    const contact = await prisma.contact.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: {},
      create: { id: crypto.randomUUID(), tenantId, phone, name: 'Business Owner', leadStatus: 'new' },
    });

    conversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), tenantId, contactId: contact.id, status: 'active' },
    });
  }

  await sendMessage({
    tenantId,
    conversationId: conversation.id,
    instanceName: tenant.evolutionInstanceId,
    phone,
    text: `📋 *Notificação*\n\n${content}`,
  });
}

async function sendEmailNotification(
  to: string,
  type: string,
  content: string,
): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn('Email notification skipped — SMTP not configured');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const subjectMap: Record<string, string> = {
    new_lead: 'Novo Lead Recebido',
    booking: 'Novo Agendamento',
    escalation: 'Atendimento Escalado',
    daily_summary: 'Resumo Diário',
  };

  await transporter.sendMail({
    from: smtpUser,
    to,
    subject: subjectMap[type] ?? 'Notificação',
    text: content,
  });
}

async function sendTelegramNotification(
  chatId: string,
  content: string,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    const { logger } = await import('../utils/logger');
    logger.warn('Telegram notification skipped — TELEGRAM_BOT_TOKEN not configured');
    return;
  }

  await axios.post(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    { chat_id: chatId, text: content, parse_mode: 'Markdown' },
    { timeout: 10_000 },
  );
}

async function sendWebhookNotification(
  url: string,
  data: NotificationJobData,
): Promise<void> {
  await axios.post(url, {
    event: data.type,
    tenantId: data.tenantId,
    content: data.content,
    timestamp: new Date().toISOString(),
  }, { timeout: 10000 });
}
