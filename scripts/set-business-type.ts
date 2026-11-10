/**
 * Set the businessType on a tenant's aiConfig to enable niche-specific
 * visual image analysis (Claude Vision).
 *
 * Usage:
 *   npx tsx scripts/set-business-type.ts <businessName> <businessType>
 *
 * Examples:
 *   npx tsx scripts/set-business-type.ts "Studio Afro Rosas" hairstylist
 *   npx tsx scripts/set-business-type.ts "Tattoo SP" tattoo
 *   npx tsx scripts/set-business-type.ts "Nail Art Studio" nail_studio
 *   npx tsx scripts/set-business-type.ts "Maquiagem Pro" makeup
 *
 * Supported businessType values:
 *   hairstylist | tattoo | nail_studio | makeup
 *   (omit to reset to generic visual analysis)
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const BUSINESS_NAME = process.argv[2];
const BUSINESS_TYPE = process.argv[3];

if (!BUSINESS_NAME) {
  console.error('Usage: npx tsx scripts/set-business-type.ts "<businessName>" <businessType>');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? '';
const sep = dbUrl.includes('?') ? '&' : '?';
const url = `${dbUrl}${sep}schema=lk_chatbot`;
const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool, { schema: 'lk_chatbot' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { businessName: { contains: BUSINESS_NAME, mode: 'insensitive' } },
  });

  if (!tenant) {
    console.error(`No tenant found matching: "${BUSINESS_NAME}"`);
    console.log('\nAvailable tenants:');
    const all = await prisma.tenant.findMany({ select: { id: true, businessName: true, status: true } });
    for (const t of all) {
      console.log(`  - ${t.businessName} (${t.id}) [${t.status}]`);
    }
    process.exit(1);
  }

  const currentConfig = (tenant.aiConfig as Record<string, any>) ?? {};
  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      aiConfig: {
        ...currentConfig,
        ...(BUSINESS_TYPE ? { businessType: BUSINESS_TYPE } : { businessType: undefined }),
      },
    },
  });

  const newConfig = updated.aiConfig as Record<string, any>;
  console.log(`\nTenant: ${tenant.businessName} (${tenant.id})`);
  console.log(`businessType set to: ${newConfig.businessType ?? '(none — generic mode)'}`);
  console.log('\nDone. The bot will now use the niche-specific visual analysis prompt.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
