import { useEffect, useState } from 'react'
import { portalAdmin } from '../lib/api'
import { Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

const BUSINESS_TYPES = [
  { value: '', label: 'Genérico (padrão)' },
  { value: 'hairstylist', label: 'Cabeleireiro / Trancista' },
  { value: 'tattoo', label: 'Tatuagem' },
  { value: 'nail_studio', label: 'Nail Studio' },
  { value: 'makeup', label: 'Maquiagem' },
]

const STATUS_OPTIONS = ['active', 'onboarding', 'suspended']
const PLAN_OPTIONS = ['starter', 'pro', 'enterprise']

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  onboarding: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
}

function Badge({ value, colorMap }: { value: string; colorMap: Record<string, string> }) {
  const color = colorMap[value] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {value}
    </span>
  )
}

interface PortalUser {
  id: string
  email: string
  name: string
  role: string
  lastLoginAt: string | null
}

interface Tenant {
  id: string
  businessName: string
  whatsappNumber: string | null
  status: string
  plan: string
  aiConfig: any
  createdAt: string
  users: PortalUser[]
}

interface NewTenantForm {
  businessName: string
  whatsappNumber: string
  portalEmail: string
  portalPassword: string
  plan: string
  businessType: string
}

const emptyForm: NewTenantForm = {
  businessName: '',
  whatsappNumber: '',
  portalEmail: '',
  portalPassword: '',
  plan: 'starter',
  businessType: '',
}

export default function Admin() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Create tenant modal
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewTenantForm>(emptyForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Expanded tenant row
  const [expanded, setExpanded] = useState<string | null>(null)

  // Per-tenant edit state
  const [editState, setEditState] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({})

  // Reset portal password
  const [resetState, setResetState] = useState<Record<string, { email: string; password: string }>>({})
  const [resetting, setResetting] = useState<string | null>(null)
  const [resetMsg, setResetMsg] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await portalAdmin.listTenants()
      setTenants(data.tenants)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate() {
    setCreateError('')
    if (!form.businessName || !form.whatsappNumber || !form.portalEmail || !form.portalPassword) {
      setCreateError('Preencha todos os campos obrigatórios.')
      return
    }
    setCreating(true)
    try {
      await portalAdmin.createTenant({
        businessName: form.businessName,
        whatsappNumber: form.whatsappNumber,
        portalEmail: form.portalEmail,
        portalPassword: form.portalPassword,
        plan: form.plan,
        businessType: form.businessType || undefined,
      })
      setShowCreate(false)
      setForm(emptyForm)
      await load()
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveTenant(tenantId: string) {
    setSaving(tenantId)
    setSaveMsg((s) => ({ ...s, [tenantId]: '' }))
    try {
      await portalAdmin.updateTenant(tenantId, editState[tenantId] ?? {})
      setSaveMsg((s) => ({ ...s, [tenantId]: 'Salvo!' }))
      await load()
      setTimeout(() => setSaveMsg((s) => ({ ...s, [tenantId]: '' })), 2000)
    } catch (e: any) {
      setSaveMsg((s) => ({ ...s, [tenantId]: e.message }))
    } finally {
      setSaving(null)
    }
  }

  async function handleResetPassword(tenantId: string) {
    const { email, password } = resetState[tenantId] ?? {}
    if (!email || !password) return
    setResetting(tenantId)
    setResetMsg((s) => ({ ...s, [tenantId]: '' }))
    try {
      await portalAdmin.upsertPortalUser(tenantId, { email, password })
      setResetMsg((s) => ({ ...s, [tenantId]: 'Acesso atualizado!' }))
      setResetState((s) => ({ ...s, [tenantId]: { email: '', password: '' } }))
      await load()
      setTimeout(() => setResetMsg((s) => ({ ...s, [tenantId]: '' })), 2000)
    } catch (e: any) {
      setResetMsg((s) => ({ ...s, [tenantId]: e.message }))
    } finally {
      setResetting(null)
    }
  }

  function getEdit(tenantId: string, field: string, fallback: any) {
    return editState[tenantId]?.[field] ?? fallback
  }

  function setEdit(tenantId: string, field: string, value: any) {
    setEditState((s) => ({ ...s, [tenantId]: { ...(s[tenantId] ?? {}), [field]: value } }))
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin — Tenants</h1>
          <p className="text-sm text-gray-500 mt-1">Gerencie todos os clientes da plataforma</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Novo Tenant
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Create Tenant Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Novo Tenant</h2>

            {createError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{createError}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nome do Negócio *</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Studio Afro Rosas"
                  value={form.businessName}
                  onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Número WhatsApp * (DDI+DDD+número)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5521999999999"
                  value={form.whatsappNumber}
                  onChange={(e) => setForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email do Portal *</label>
                <input
                  type="email"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="admin@cliente.com"
                  value={form.portalEmail}
                  onChange={(e) => setForm((f) => ({ ...f, portalEmail: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Senha do Portal * (mín. 8 caracteres)</label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                  value={form.portalPassword}
                  onChange={(e) => setForm((f) => ({ ...f, portalPassword: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Plano</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.plan}
                    onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
                  >
                    {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Negócio</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.businessType}
                    onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value }))}
                  >
                    {BUSINESS_TYPES.map((bt) => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowCreate(false); setForm(emptyForm); setCreateError('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Criando...' : 'Criar Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tenant List */}
      {loading ? (
        <div className="text-sm text-gray-500 py-8 text-center">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => {
            const isExpanded = expanded === t.id
            const businessType = (t.aiConfig as any)?.businessType ?? ''

            return (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Row header */}
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{t.businessName}</span>
                      <Badge value={t.status} colorMap={STATUS_COLORS} />
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{t.plan}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span>{t.whatsappNumber ?? 'Sem número'}</span>
                      <span>{t.users.length > 0 ? t.users[0].email : 'Sem login portal'}</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-5 bg-gray-50">
                    {/* Config section */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Configurações</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            value={getEdit(t.id, 'status', t.status)}
                            onChange={(e) => setEdit(t.id, 'status', e.target.value)}
                          >
                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Plano</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            value={getEdit(t.id, 'plan', t.plan)}
                            onChange={(e) => setEdit(t.id, 'plan', e.target.value)}
                          >
                            {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Negócio (Visão)</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            value={getEdit(t.id, 'businessType', businessType)}
                            onChange={(e) => setEdit(t.id, 'businessType', e.target.value)}
                          >
                            {BUSINESS_TYPES.map((bt) => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          onClick={() => handleSaveTenant(t.id)}
                          disabled={saving === t.id}
                          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {saving === t.id ? 'Salvando...' : 'Salvar Configurações'}
                        </button>
                        {saveMsg[t.id] && (
                          <span className="text-sm text-green-600">{saveMsg[t.id]}</span>
                        )}
                      </div>
                    </div>

                    {/* Portal access section */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Acesso ao Portal</h3>
                      {t.users.length > 0 && (
                        <div className="mb-3 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2">
                          {t.users.map((u) => (
                            <div key={u.id} className="flex items-center gap-2">
                              <span className="font-medium">{u.email}</span>
                              <span className="text-gray-400">({u.role})</span>
                              {u.lastLoginAt && <span className="text-gray-400">· Último login: {new Date(u.lastLoginAt).toLocaleDateString('pt-BR')}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            {t.users.length > 0 ? 'Novo email (ou existente para reset)' : 'Email do portal'}
                          </label>
                          <input
                            type="email"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            placeholder="admin@cliente.com"
                            value={resetState[t.id]?.email ?? ''}
                            onChange={(e) => setResetState((s) => ({ ...s, [t.id]: { ...(s[t.id] ?? {}), email: e.target.value, password: s[t.id]?.password ?? '' } }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Nova senha</label>
                          <input
                            type="password"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            placeholder="••••••••"
                            value={resetState[t.id]?.password ?? ''}
                            onChange={(e) => setResetState((s) => ({ ...s, [t.id]: { ...(s[t.id] ?? {}), password: e.target.value, email: s[t.id]?.email ?? '' } }))}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          onClick={() => handleResetPassword(t.id)}
                          disabled={resetting === t.id}
                          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {resetting === t.id ? 'Salvando...' : t.users.length > 0 ? 'Atualizar Acesso' : 'Criar Acesso'}
                        </button>
                        {resetMsg[t.id] && (
                          <span className="text-sm text-green-600">{resetMsg[t.id]}</span>
                        )}
                      </div>
                    </div>

                    {/* Tenant ID */}
                    <div className="text-xs text-gray-400 font-mono">ID: {t.id}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
