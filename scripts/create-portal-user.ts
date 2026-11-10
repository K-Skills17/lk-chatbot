/**
 * Creates a portal login user for an existing tenant.
 *
 * Usage:
 *   npx tsx scripts/create-portal-user.ts <email> <password> <name>
 *
 * Example:
 *   npx tsx scripts/create-portal-user.ts admin@lkdigital.com MinhaS3nha123 "LK Digital"
 *
 * Run this once per tenant to create the owner login for the /portal dashboard.
 * If the email already exists, it resets the password instead.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const [EMAIL, PASSWORD, NAME] = process.argv.slice(2);

if (!EMAIL || !PASSWORD || !NAME) {
  console.error('Usage: npx tsx scripts/create-portal-user.ts <email> <password> <name>');
  console.error('Example: npx tsx scripts/create-portal-user.ts admin@lkdigital.com MinhaS3nha123 "LK Digital"');
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
  // Find the tenant (first active one, or list all if multiple)
  const tenants = await prisma.tenant.findMany({
    where: { status: 'active' },
    select: { id: true, businessName: true },
    orderBy: { createdAt: 'asc' },
  });

  if (tenants.length === 0) {
    console.error('No active tenant found. Run the seed-tenant script first.');
    process.exit(1);
  }

  const tenant = tenants[0];
  if (tenants.length > 1) {
    console.log('Multiple tenants found — using first active tenant:');
    tenants.forEach((t, i) => console.log(`  ${i === 0 ? '→' : ' '} ${t.businessName} (${t.id})`));
    console.log('');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // Upsert: create or reset password if email exists
  const existing = await prisma.tenantUser.findUnique({ where: { email: EMAIL } });

  if (existing) {
    await prisma.tenantUser.update({
      where: { email: EMAIL },
      data: { passwordHash, name: NAME },
    });
    console.log(`Password reset for existing user: ${EMAIL}`);
  } else {
    await prisma.tenantUser.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        email: EMAIL,
        passwordHash,
        name: NAME,
        role: 'owner',
      },
    });
    console.log(`Portal user created!`);
  }

  console.log('');
  console.log(`  Tenant:   ${tenant.businessName}`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  Role:     owner`);
  console.log('');
  console.log('Go to: YOUR_RAILWAY_URL/portal and log in.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
