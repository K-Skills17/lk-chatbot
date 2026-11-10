/**
 * Onboard a new tenant with a portal login in one command.
 *
 * Usage:
 *   npx tsx scripts/onboard-tenant.ts <businessName> <whatsappNumber> <portalEmail> <portalPassword>
 *
 * Example:
 *   npx tsx scripts/onboard-tenant.ts "Studio Afro Rosas" 5511999999999 admin@afrosas.com Senha123
 *
 * This creates:
 *   1. A new active tenant with basic AI config
 *   2. A portal owner login for /portal
 *
 * After running, log in to /portal and use Settings to configure the bot.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const [BUSINESS_NAME, WHATSAPP_NUMBER, EMAIL, PASSWORD] = process.argv.slice(2);

if (!BUSINESS_NAME || !WHATSAPP_NUMBER || !EMAIL || !PASSWORD) {
  console.error('Usage: npx tsx scripts/onboard-tenant.ts <businessName> <whatsappNumber> <portalEmail> <portalPassword>');
  console.error('Example: npx tsx scripts/onboard-tenant.ts "Studio Afro Rosas" 5511999999999 admin@afrosas.com Senha123');
  process.exit(1);
}

if (PASSWORD.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? '';
const sep = dbUrl.includes('?') ? '&' : '?';
const url = `${dbUrl}${sep}schema=lk_chatbot`;
const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool, { schema: 'lk_chatbot' });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Check for existing tenant with same name or number
  const existing = await prisma.tenant.findFirst({
    where: {
      OR: [
        { businessName: BUSINESS_NAME },
        { whatsappNumber: WHATSAPP_NUMBER },
      ],
    },
  });

  if (existing) {
    console.error(`Tenant already exists: "${existing.businessName}" (${existing.id})`);
    console.error('Use the Settings page in /portal to update config, or create-portal-user.ts to add a login.');
    process.exit(1);
  }

  const instanceName = `${BUSINESS_NAME.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

  // 1. Create tenant
  const tenant = await prisma.tenant.create({
    data: {
      businessName: BUSINESS_NAME,
      whatsappNumber: WHATSAPP_NUMBER,
      evolutionInstanceId: instanceName,
      timezone: 'America/Sao_Paulo',
      businessHours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      aiConfig: {
        model: 'claude',
        temperature: 0.7,
        tone: 'friendly',
        businessDescription: `Assistente virtual de ${BUSINESS_NAME}.`,
        greeting: `Olá! Bem-vindo ao ${BUSINESS_NAME}. Como posso ajudar?`,
      },
      plan: 'starter',
      status: 'active',
    },
  });

  // 2. Create portal user
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await prisma.tenantUser.create({
    data: {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      email: EMAIL,
      passwordHash,
      name: BUSINESS_NAME,
      role: 'owner',
    },
  });

  console.log('');
  console.log('=== Tenant Onboarded Successfully ===');
  console.log(`  Tenant:   ${tenant.businessName}`);
  console.log(`  ID:       ${tenant.id}`);
  console.log(`  Phone:    ${tenant.whatsappNumber}`);
  console.log(`  Instance: ${tenant.evolutionInstanceId}`);
  console.log('');
  console.log('=== Portal Login ===');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('  1. Connect the WhatsApp number in Evolution API (scan QR code)');
  console.log('  2. Log in to /portal and configure the bot in Settings');
  console.log('  3. Set the Evolution instance webhook to point to this server');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
