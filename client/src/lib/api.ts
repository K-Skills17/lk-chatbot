const BASE = ''

function getToken(): string | null {
  return localStorage.getItem('lk_token')
}

function getTenantId(): string | null {
  return localStorage.getItem('lk_tenant_id')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401) {
    localStorage.removeItem('lk_token')
    localStorage.removeItem('lk_tenant_id')
    localStorage.removeItem('lk_user')
    window.location.href = '/portal/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// Helper to build tenant-scoped paths
function t(path: string): string {
  const tenantId = getTenantId()
  return `/api/tenants/${tenantId}${path}`
}

// ─── Auth ────────────────────────────────────────
export const auth = {
  login: (email: string, password: string) =>
    request<{ user: any; token: string; expiresIn: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<any>('/api/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listUsers: () => request<{ users: any[] }>('/api/auth/users'),
  deleteUser: (userId: string) =>
    request<void>(`/api/auth/users/${userId}`, { method: 'DELETE' }),
  register: (data: { tenantId: string; email: string; password: string; name: string; role?: string }) =>
    request<any>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ─── Analytics ───────────────────────────────────
export const analytics = {
  overview: () => request<any>(t('/analytics/overview')),
  funnel: () => request<any>(t('/analytics/funnel')),
  daily: (days = 30) => request<any>(t(`/analytics/daily?days=${days}`)),
}

// ─── Bookings ────────────────────────────────────
export const bookings = {
  list: () => request<any>(t('/bookings')),
  cancel: (id: string) =>
    request<any>(t(`/bookings/${id}/cancel`), { method: 'POST' }),
  complete: (id: string) =>
    request<any>(t(`/bookings/${id}/complete`), { method: 'POST' }),
}

// ─── Contacts / Leads ────────────────────────────
export const contacts = {
  list: (page = 1, limit = 50) =>
    request<{ contacts: any[]; total: number }>(t(`/contacts?page=${page}&limit=${limit}`)),
}

// ─── Reviews ─────────────────────────────────────
export const reviews = {
  list: (page = 1, limit = 20) =>
    request<{ reviews: any[]; total: number }>(t(`/reviews?page=${page}&limit=${limit}`)),
  stats: () => request<any>(t('/reviews/stats')),
}

// ─── Campaigns ───────────────────────────────────
export const campaigns = {
  list: () => request<any>(t('/campaigns')),
  get: (id: string) => request<any>(t(`/campaigns/${id}`)),
  create: (data: any) =>
    request<any>(t('/campaigns'), { method: 'POST', body: JSON.stringify(data) }),
  start: (id: string) =>
    request<any>(t(`/campaigns/${id}/start`), { method: 'POST' }),
  pause: (id: string) =>
    request<any>(t(`/campaigns/${id}/pause`), { method: 'POST' }),
  analytics: (id: string) => request<any>(t(`/campaigns/${id}/analytics`)),
}

// ─── Billing ─────────────────────────────────────
export const billing = {
  overview: () => request<any>(t('/billing')),
  checkout: (plan: string) =>
    request<{ url: string }>(t('/billing/checkout'), {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),
  portal: () =>
    request<{ url: string }>(t('/billing/portal'), { method: 'POST' }),
  invoices: () => request<any>(t('/billing/invoices')),
}

// ─── Tenant / Settings ───────────────────────────
export const tenant = {
  get: () => request<any>(t('')),
  update: (data: any) =>
    request<any>(t(''), { method: 'PATCH', body: JSON.stringify(data) }),
}

// ─── Portal Admin (superadmin only) ──────────────
export const portalAdmin = {
  listTenants: () =>
    request<{ tenants: any[] }>('/api/portal-admin/tenants'),
  createTenant: (data: {
    businessName: string;
    whatsappNumber: string;
    portalEmail: string;
    portalPassword: string;
    plan?: string;
    businessType?: string;
  }) =>
    request<any>('/api/portal-admin/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTenant: (tenantId: string, data: { status?: string; plan?: string; businessType?: string; whatsappNumber?: string }) =>
    request<any>(`/api/portal-admin/tenants/${tenantId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  upsertPortalUser: (tenantId: string, data: { email: string; password: string; name?: string }) =>
    request<any>(`/api/portal-admin/tenants/${tenantId}/portal-user`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
