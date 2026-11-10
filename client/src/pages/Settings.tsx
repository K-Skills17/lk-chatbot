import { useEffect, useState } from 'react'
import { tenant as tenantApi, auth as authApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import Card from '../components/Card'
import Badge from '../components/Badge'
import Spinner from '../components/Spinner'

const BUSINESS_TYPES = [
  { value: '', label: 'Generico (qualquer negocio)' },
  { value: 'hairstylist', label: 'Salao de Cabelo / Trancista' },
  { value: 'tattoo', label: 'Estudio de Tatuagem' },
  { value: 'nail_studio', label: 'Estudio de Unhas' },
  { value: 'makeup', label: 'Maquiagem' },
]

const TONES = [
  { value: 'friendly', label: 'Amigavel e profissional' },
  { value: 'casual', label: 'Descontraido (como um amigo)' },
  { value: 'formal', label: 'Formal e respeitoso' },
]

export default function Settings() {
  const { user } = useAuth()
  const [tenantData, setTenantData] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Password form
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')

  // New user form
  const [showAddUser, setShowAddUser] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newUserPw, setNewUserPw] = useState('')
  const [newRole, setNewRole] = useState('staff')
  const [addError, setAddError] = useState('')

  // Notification config form
  const [notifPhone, setNotifPhone] = useState('')
  const [notifEmail, setNotifEmail] = useState('')
  const [notifTelegram, setNotifTelegram] = useState('')
  const [notifNewLead, setNotifNewLead] = useState(true)
  const [notifBooking, setNotifBooking] = useState(true)
  const [notifEscalation, setNotifEscalation] = useState(true)
  const [notifMsg, setNotifMsg] = useState('')
  const [notifError, setNotifError] = useState('')

  // Bot / AI config form
  const [botType, setBotType] = useState('')
  const [botTone, setBotTone] = useState('friendly')
  const [botDescription, setBotDescription] = useState('')
  const [botGreeting, setBotGreeting] = useState('')
  const [botMsg, setBotMsg] = useState('')
  const [botError, setBotError] = useState('')

  const fetchData = () => {
    const promises: Promise<any>[] = [tenantApi.get()]
    if (user?.role === 'owner') promises.push(authApi.listUsers())

    Promise.all(promises)
      .then(([t, u]) => {
        setTenantData(t)
        if (u) setUsers(u.users || [])
        const nc = t?.notificationConfig || {}
        setNotifPhone(nc.ownerPhone || '')
        setNotifEmail(nc.ownerEmail || '')
        setNotifTelegram(nc.telegramChatId || '')
        setNotifNewLead(nc.newLead !== false)
        setNotifBooking(nc.booking !== false)
        setNotifEscalation(nc.escalation !== false)
        const ac = t?.aiConfig || {}
        setBotType(ac.businessType || '')
        setBotTone(ac.tone || 'friendly')
        setBotDescription(ac.businessDescription || '')
        setBotGreeting(ac.greeting || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwMsg('')
    setPwError('')
    try {
      await authApi.changePassword(currentPw, newPw)
      setPwMsg('Senha alterada com sucesso!')
      setCurrentPw('')
      setNewPw('')
    } catch (err: any) {
      setPwError(err.message || 'Erro ao alterar senha')
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    try {
      await authApi.register({
        tenantId: user!.tenantId,
        email: newEmail,
        password: newUserPw,
        name: newName,
        role: newRole,
      })
      setShowAddUser(false)
      setNewEmail('')
      setNewName('')
      setNewUserPw('')
      fetchData()
    } catch (err: any) {
      setAddError(err.message || 'Erro ao adicionar usuario')
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Remover este usuario?')) return
    await authApi.deleteUser(userId)
    fetchData()
  }

  const handleSaveBotConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setBotMsg('')
    setBotError('')
    try {
      await tenantApi.update({
        aiConfig: {
          ...(botType ? { businessType: botType } : { businessType: null }),
          tone: botTone,
          ...(botDescription ? { businessDescription: botDescription } : {}),
          ...(botGreeting ? { greeting: botGreeting } : {}),
        },
      })
      setBotMsg('Configuracoes do bot salvas!')
    } catch (err: any) {
      setBotError(err.message || 'Erro ao salvar')
    }
  }

  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotifMsg('')
    setNotifError('')
    try {
      await tenantApi.update({
        notificationConfig: {
          newLead: notifNewLead,
          booking: notifBooking,
          escalation: notifEscalation,
          ownerPhone: notifPhone || undefined,
          ownerEmail: notifEmail || undefined,
          telegramChatId: notifTelegram || undefined,
        },
      })
      setNotifMsg('Configuracoes salvas!')
    } catch (err: any) {
      setNotifError(err.message || 'Erro ao salvar')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Configuracoes</h1>

      {/* Tenant info */}
      {tenantData && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Informacoes da Clinica</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Nome</p>
              <p className="font-medium text-gray-900">{tenantData.businessName}</p>
            </div>
            <div>
              <p className="text-gray-500">WhatsApp</p>
              <p className="font-medium text-gray-900">{tenantData.whatsappNumber}</p>
            </div>
            <div>
              <p className="text-gray-500">Plano</p>
              <Badge variant="blue">{tenantData.plan}</Badge>
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <Badge variant={tenantData.status === 'active' ? 'green' : 'yellow'}>
                {tenantData.status}
              </Badge>
            </div>
            <div>
              <p className="text-gray-500">Fuso Horario</p>
              <p className="font-medium text-gray-900">{tenantData.timezone}</p>
            </div>
            <div>
              <p className="text-gray-500">Criado em</p>
              <p className="font-medium text-gray-900">
                {new Date(tenantData.createdAt).toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Change password */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Alterar Senha</h2>
        <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
          {pwMsg && (
            <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">{pwMsg}</p>
          )}
          {pwError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{pwError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha atual</label>
            <input
              type="password"
              required
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Alterar Senha
          </button>
        </form>
      </Card>

      {/* Team management (owner only) */}
      {user?.role === 'owner' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Equipe</h2>
            <button
              onClick={() => setShowAddUser(!showAddUser)}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {showAddUser ? 'Cancelar' : 'Adicionar'}
            </button>
          </div>

          {showAddUser && (
            <form onSubmit={handleAddUser} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
              {addError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{addError}</p>
              )}
              <input
                type="text"
                required
                placeholder="Nome"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
              />
              <input
                type="email"
                required
                placeholder="Email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Senha (min. 8 caracteres)"
                value={newUserPw}
                onChange={(e) => setNewUserPw(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                <option value="staff">Equipe</option>
                <option value="owner">Proprietario</option>
              </select>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Criar Usuario
              </button>
            </form>
          )}

          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between py-3 px-1 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {u.name} {u.id === user?.id && <span className="text-gray-400">(voce)</span>}
                  </p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={u.role === 'owner' ? 'purple' : 'gray'}>
                    {u.role === 'owner' ? 'Proprietario' : 'Equipe'}
                  </Badge>
                  {u.id !== user?.id && (
                    <button
                      onClick={() => handleDeleteUser(u.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Bot / AI config */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Configuracao do Bot</h2>
        <p className="text-sm text-gray-500 mb-4">
          Defina o nicho e o comportamento do assistente de IA para este negocio.
        </p>
        <form onSubmit={handleSaveBotConfig} className="max-w-md space-y-4">
          {botMsg && (
            <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">{botMsg}</p>
          )}
          {botError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{botError}</p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Negocio (Nicho)
            </label>
            <select
              value={botType}
              onChange={(e) => setBotType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {BUSINESS_TYPES.map((bt) => (
                <option key={bt.value} value={bt.value}>{bt.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Salao de cabelo, tatuagem e unhas ativam analise de fotos de referencia por IA.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tom do Bot</label>
            <select
              value={botTone}
              onChange={(e) => setBotTone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descricao do Negocio
            </label>
            <textarea
              value={botDescription}
              onChange={(e) => setBotDescription(e.target.value)}
              rows={3}
              placeholder="Ex: Estudio especializado em tranças afro, box braids e penteados naturais no centro de Sao Paulo."
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Saudacao Inicial (opcional)
            </label>
            <input
              type="text"
              value={botGreeting}
              onChange={(e) => setBotGreeting(e.target.value)}
              placeholder="Ex: Ola! Bem-vinda ao Studio Afro Rosas. Como posso te ajudar?"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Salvar Configuracoes do Bot
          </button>
        </form>
      </Card>

      {/* Notification config */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Notificacoes de Leads</h2>
        <form onSubmit={handleSaveNotifications} className="max-w-md space-y-4">
          {notifMsg && (
            <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">{notifMsg}</p>
          )}
          {notifError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{notifError}</p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Telegram Chat ID
            </label>
            <input
              type="text"
              value={notifTelegram}
              onChange={(e) => setNotifTelegram(e.target.value)}
              placeholder="Ex: -1001234567890"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">Mande uma mensagem para @userinfobot no Telegram para obter seu Chat ID</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp do Responsavel (com codigo do pais)
            </label>
            <input
              type="text"
              value={notifPhone}
              onChange={(e) => setNotifPhone(e.target.value)}
              placeholder="Ex: 5511999999999"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email do Responsavel</label>
            <input
              type="email"
              value={notifEmail}
              onChange={(e) => setNotifEmail(e.target.value)}
              placeholder="voce@email.com"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Notificar quando:</p>
            {[
              { label: 'Novo lead', value: notifNewLead, set: setNotifNewLead },
              { label: 'Novo agendamento', value: notifBooking, set: setNotifBooking },
              { label: 'Escalacao para humano', value: notifEscalation, set: setNotifEscalation },
            ].map(({ label, value, set }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Salvar Notificacoes
          </button>
        </form>
      </Card>
    </div>
  )
}