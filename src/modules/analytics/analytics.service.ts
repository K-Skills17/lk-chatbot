import { prisma } from '../../config/database';

export interface DashboardOverview {
  contacts: {
    total: number;
    new: number;
    qualifying: number;
    qualified: number;
    booked: number;
    lost: number;
    optedOut: number;
  };
  conversations: {
    total: number;
    active: number;
    closed: number;
    escalated: number;
  };
  bookings: {
    total: number;
    confirmed: number;
    cancelled: number;
    completed: number;
    noShow: number;
    upcoming: number;
  };
  campaigns: {
    total: number;
    active: number;
    completed: number;
    totalSent: number;
    totalReplied: number;
    overallReplyRate: number;
  };
}

export interface LeadFunnel {
  stage: string;
  count: number;
  percentage: number;
}

export interface DailyMetric {
  date: string;
  newContacts: number;
  messagesIn: number;
  messagesOut: number;
  bookings: number;
}

export class AnalyticsService {
  /** Get full dashboard overview for a tenant */
  async getOverview(tenantId: string) {
    const [contacts, conversations, bookings, campaigns, tenant] = await Promise.all([
      this.getContactStats(tenantId),
      this.getConversationStats(tenantId),
      this.getBookingStats(tenantId),
      this.getCampaignStats(tenantId),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { monthlyAiCostUsd: true, aiCostLimitUsd: true, messagesThisMonth: true },
      }),
    ]);

    const conversionRate =
      contacts.total > 0 ? (contacts.qualified + contacts.booked) / contacts.total : 0;

    return {
      totalConversations: conversations.total,
      totalContacts: contacts.total,
      totalBookings: bookings.total,
      conversionRate,
      messagesLast30Days: tenant?.messagesThisMonth ?? 0,
      monthlyAiCost: tenant?.monthlyAiCostUsd ?? 0,
      aiCostLimit: tenant?.aiCostLimitUsd ?? 0,
      contacts,
      conversations,
      bookings,
      campaigns,
    };
  }

  /** Get lead funnel breakdown — returns flat object matching Dashboard.tsx */
  async getLeadFunnel(tenantId: string) {
    const statusCounts = await prisma.contact.groupBy({
      by: ['leadStatus'],
      where: { tenantId, optedOut: false },
      _count: true,
    });

    const countMap: Record<string, number> = {};
    for (const row of statusCounts) {
      countMap[row.leadStatus] = row._count;
    }

    return {
      newContacts: countMap['new'] ?? 0,
      qualifying: countMap['qualifying'] ?? 0,
      qualified: countMap['qualified'] ?? 0,
      booked: countMap['booked'] ?? 0,
    };
  }

  /** Get daily metrics for the last N days */
  async getDailyMetrics(tenantId: string, days = 30): Promise<DailyMetric[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // Get daily new contacts
    const newContacts = await prisma.$queryRawUnsafe<
      { date: string; count: bigint }[]
    >(
      `SELECT DATE(first_contact_at) as date, COUNT(*) as count
       FROM contacts WHERE tenant_id = $1 AND first_contact_at >= $2
       GROUP BY DATE(first_contact_at) ORDER BY date`,
      tenantId,
      since,
    );

    // Get daily messages
    const messages = await prisma.$queryRawUnsafe<
      { date: string; direction: string; count: bigint }[]
    >(
      `SELECT DATE(created_at) as date, direction, COUNT(*) as count
       FROM messages WHERE tenant_id = $1 AND created_at >= $2
       GROUP BY DATE(created_at), direction ORDER BY date`,
      tenantId,
      since,
    );

    // Get daily bookings
    const bookingsByDay = await prisma.$queryRawUnsafe<
      { date: string; count: bigint }[]
    >(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM bookings WHERE tenant_id = $1 AND created_at >= $2
       GROUP BY DATE(created_at) ORDER BY date`,
      tenantId,
      since,
    );

    // Build day-by-day map
    const metrics: Record<string, DailyMetric> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      metrics[key] = { date: key, newContacts: 0, messagesIn: 0, messagesOut: 0, bookings: 0 };
    }

    for (const row of newContacts) {
      const key = String(row.date).slice(0, 10);
      if (metrics[key]) metrics[key].newContacts = Number(row.count);
    }

    for (const row of messages) {
      const key = String(row.date).slice(0, 10);
      if (!metrics[key]) continue;
      if (row.direction === 'inbound') metrics[key].messagesIn = Number(row.count);
      else metrics[key].messagesOut = Number(row.count);
    }

    for (const row of bookingsByDay) {
      const key = String(row.date).slice(0, 10);
      if (metrics[key]) metrics[key].bookings = Number(row.count);
    }

    return Object.values(metrics);
  }

  // ── Private Helpers ─────────────────────────────────────────

  private async getContactStats(tenantId: string) {
    const statusCounts = await prisma.contact.groupBy({
      by: ['leadStatus'],
      where: { tenantId },
      _count: true,
    });

    const optedOutCount = await prisma.contact.count({
      where: { tenantId, optedOut: true },
    });

    const countMap: Record<string, number> = {};
    let total = 0;
    for (const row of statusCounts) {
      countMap[row.leadStatus] = row._count;
      total += row._count;
    }

    return {
      total,
      new: countMap['new'] ?? 0,
      qualifying: countMap['qualifying'] ?? 0,
      qualified: countMap['qualified'] ?? 0,
      booked: countMap['booked'] ?? 0,
      lost: countMap['lost'] ?? 0,
      optedOut: optedOutCount,
    };
  }

  private async getConversationStats(tenantId: string) {
    const statusCounts = await prisma.conversation.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });

    const countMap: Record<string, number> = {};
    let total = 0;
    for (const row of statusCounts) {
      countMap[row.status] = row._count;
      total += row._count;
    }

    return {
      total,
      active: countMap['active'] ?? 0,
      closed: countMap['closed'] ?? 0,
      escalated: countMap['escalated'] ?? 0,
    };
  }

  private async getBookingStats(tenantId: string) {
    const statusCounts = await prisma.booking.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });

    const upcomingCount = await prisma.booking.count({
      where: { tenantId, status: 'confirmed', scheduledAt: { gte: new Date() } },
    });

    const countMap: Record<string, number> = {};
    let total = 0;
    for (const row of statusCounts) {
      countMap[row.status] = row._count;
      total += row._count;
    }

    return {
      total,
      confirmed: countMap['confirmed'] ?? 0,
      cancelled: countMap['cancelled'] ?? 0,
      completed: countMap['completed'] ?? 0,
      noShow: countMap['no_show'] ?? 0,
      upcoming: upcomingCount,
    };
  }

  private async getCampaignStats(tenantId: string) {
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId },
      select: { status: true, sentCount: true, replyCount: true },
    });

    let totalSent = 0;
    let totalReplied = 0;
    let active = 0;
    let completed = 0;

    for (const c of campaigns) {
      totalSent += c.sentCount;
      totalReplied += c.replyCount;
      if (c.status === 'active') active++;
      if (c.status === 'completed') completed++;
    }

    return {
      total: campaigns.length,
      active,
      completed,
      totalSent,
      totalReplied,
      overallReplyRate: totalSent > 0 ? totalReplied / totalSent : 0,
    };
  }
}

export const analyticsService = new AnalyticsService();
