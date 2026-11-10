/**
 * Creates a portal login user for an existing tenant.
 *
 * Usage:
 *   npx tsx scripts/create-portal-user.ts <email> <password> <name> [tenantName]
 *
 * Examples:
 *   npx tsx scripts/create-portal-user.ts admin@lkdigital.com MinhaS3nha123 "LK Digital"
 *   npx tsx scripts/create-portal-user.ts admin@salon.com MinhaS3nha123 "Salon Owner" "Studio Afro Rosas"
 *
 * Run this once per tenant to create the owner login for the /portal dashboard.
 * If the email already exists, it resets the password instead.
 * If tenantName is omitted and there are multiple tenants, lists all tenants.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const [EMAIL, PASSWORD, NAME, TENANT_NAME] = process.argv.slice(2);

if (!EMAIL || !PASSWORD || !NAME) {
  console.error('Usage: npx tsx scripts/create-portal-user.ts <email> <password> <name> [tenantName]');
  console.error('Example: npx tsx scripts/create-portal-user.ts admin@lkdigital.com MinhaS3nha123 "LK Digital"');
  console.error('Example: npx tsx scripts/create-portal-user.ts admin@salon.com Pass123 "Owner" "Studio Afro Rosas"');
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
  // Find tenant by name if provided, otherwise use first active
  const allTenants = await prisma.tenant.findMany({
    where: { status: 'active' },
    select: { id: true, businessName: true },
    orderBy: { createdAt: 'asc' },
  });

  if (allTenants.length === 0) {
    console.error('No active tenant found. Run the seed-tenant script first.');
    process.exit(1);
  }

  let tenant = allTenants[0];

  if (TENANT_NAME) {
    const match = allTenants.find((t) =>
      t.businessName.toLowerCase().includes(TENANT_NAME.toLowerCase()),
    );
    if (!match) {
      console.error(`No tenant found matching: "${TENANT_NAME}"`);
      console.log('\nAvailable tenants:');
      allTenants.forEach((t) => console.log(`  - ${t.businessName} (${t.id})`));
      process.exit(1);
    }
    tenant = match;
  } else if (allTenants.length > 1) {
    console.error('Multiple tenants found. Specify the tenant name as the 4th argument:');
    allTenants.forEach((t) => console.log(`  - "${t.businessName}"`));
    console.error('\nExample:');
    console.error(`  npx tsx scripts/create-portal-user.ts ${EMAIL} ${PASSWORD} "${NAME}" "${allTenants[0].businessName}"`);
    process.exit(1);
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
