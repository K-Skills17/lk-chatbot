# LK Chatbot — Complete Setup & Training Guide

## Prerequisites (Already Done)

- [x] Railway project with PostgreSQL, Redis
- [x] Evolution API instance running on Railway
- [x] GitHub repo connected for auto-deploy

## Step 1: Verify Environment Variables on Railway

Go to your Railway service **Variables** tab and ensure ALL of these are set:

```
# Required
NODE_ENV=production
PORT=3000
API_KEY=<your-secure-api-key>           # For authenticating API calls
DATABASE_URL=<auto-from-railway>         # PostgreSQL plugin provides this
REDIS_URL=<auto-from-railway>            # Redis plugin provides this

# Evolution API
EVOLUTION_API_URL=<your-evolution-internal-url>  # e.g. http://evolution-api.railway.internal:8080
EVOLUTION_API_KEY=<your-evolution-api-key>       # Must match AUTHENTICATION_API_KEY in Evolution

# AI (at least one required)
ANTHROPIC_API_KEY=sk-ant-...             # Get from console.anthropic.com
AI_PRIMARY_PROVIDER=claude
AI_PRIMARY_MODEL=claude-haiku-4-5-20251001
AI_QUALIFICATION_MODEL=claude-sonnet-4-5-20250929

# Webhook (CRITICAL — this is how Evolution API talks to your app)
WEBHOOK_BASE_URL=https://your-app.up.railway.app   # Your Railway public URL
```

## Step 2: Verify Everything Is Connected

After deploying, hit your readiness endpoint:

```bash
curl https://your-app.up.railway.app/health/ready
```

You should see:
```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "evolution": "ok",
    "evolutionInstances": 0
  },
  "config": {
    "webhookUrl": "https://your-app.up.railway.app/webhook/evolution",
    "evolutionUrl": "http://evolution-api.railway.internal:8080",
    "aiProvider": "claude"
  }
}
```

If `evolution` shows `error`: check that `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` are correct.

## Step 3: Create Your First Business (Tenant)

This is how you "train" the chatbot for a specific business. The `aiConfig` object is the key — it contains ALL the knowledge the bot will use.

```bash
curl -X POST https://your-app.up.railway.app/api/tenants \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "businessName": "Dr. Ana Silva - Dermatologia",
    "whatsappNumber": "5511999887766",
    "timezone": "America/Sao_Paulo",
    "businessHours": {
      "start": "08:00",
      "end": "18:00",
      "days": [1, 2, 3, 4, 5]
    },
    "aiConfig": {
      "model": "claude",
      "temperature": 0.7,

      "businessDescription": "Clinica dermatologica especializada em tratamentos esteticos e clinicos. Localizada na Av. Paulista, Sao Paulo.",

      "services": [
        {
          "name": "Consulta Dermatologica",
          "description": "Avaliacao completa da pele com dermatoscopia",
          "price": "R$ 350"
        },
        {
          "name": "Limpeza de Pele",
          "description": "Limpeza profunda com extracao e mascara",
          "price": "R$ 250"
        },
        {
          "name": "Botox",
          "description": "Aplicacao de toxina botulinica para rugas",
          "price": "a partir de R$ 800"
        },
        {
          "name": "Peeling Quimico",
          "description": "Peeling para manchas, acne e rejuvenescimento",
          "price": "R$ 400 a R$ 1.200"
        }
      ],

      "faq": [
        {
          "question": "Vocês aceitam convênio?",
          "answer": "Aceitamos Unimed, Bradesco Saude e SulAmerica para consultas clinicas. Procedimentos esteticos sao particulares."
        },
        {
          "question": "Como funciona o estacionamento?",
          "answer": "Temos estacionamento conveniado no predio com 2h gratuitas para pacientes."
        },
        {
          "question": "Precisa de encaminhamento?",
          "answer": "Nao precisa de encaminhamento para consulta particular. Para convenio, verifique com sua operadora."
        },
        {
          "question": "Qual o tempo de espera para consulta?",
          "answer": "Geralmente conseguimos agendar dentro de 3-5 dias uteis."
        }
      ],

      "targetAudience": "Mulheres e homens de 25-60 anos, classe media-alta, preocupados com saude e estetica da pele",

      "tone": "friendly",

      "greeting": "Ola! Bem-vindo(a) a clinica da Dra. Ana Silva. Como posso ajudar voce hoje?",

      "closingMessage": "Obrigada pelo contato! Qualquer duvida, estamos aqui. Ate logo!",

      "qualificationCriteria": [
        { "label": "Tipo de tratamento desejado", "weight": 3 },
        { "label": "Urgencia (dor, desconforto, estetico)", "weight": 2 },
        { "label": "Possui convenio?", "weight": 1 },
        { "label": "Ja foi a um dermatologista antes?", "weight": 1 }
      ],

      "escalationRules": "Escale para humano se o paciente relatar sintomas graves (dor intensa, sangramento, reacao alergica) ou se pedir para falar com a doutora diretamente.",

      "forbiddenTopics": ["diagnostico medico", "receita de medicamento", "precos de concorrentes"]
    },
    "notificationConfig": {
      "newLead": true,
      "booking": true,
      "escalation": true,
      "ownerPhone": "5511999887766",
      "ownerEmail": "ana@clinicasilva.com.br"
    },
    "plan": "pro"
  }'
```

**Save the `id` from the response** — you'll need it for the next steps.

## Step 4: Connect WhatsApp

### 4a. Get QR Code
```bash
curl -X POST https://your-app.up.railway.app/api/tenants/TENANT_ID/connect \
  -H "x-api-key: YOUR_API_KEY"
```

This returns a QR code. Scan it with the business's WhatsApp.

### 4b. Check Connection Status
```bash
curl https://your-app.up.railway.app/api/tenants/TENANT_ID/status \
  -H "x-api-key: YOUR_API_KEY"
```

When `state` is `"open"`, the WhatsApp is connected and the tenant is automatically activated.

### 4c. Configure Webhook (if messages aren't flowing)
```bash
curl -X POST https://your-app.up.railway.app/api/tenants/TENANT_ID/webhook \
  -H "x-api-key: YOUR_API_KEY"
```

This manually sets the webhook URL on the Evolution API instance.

## Step 5: Test the Flow

Send a WhatsApp message to the connected number. You should see:

1. Evolution API receives the message
2. Webhook fires to `POST /webhook/evolution`
3. Message is stored in the database
4. AI processes the message and generates a response
5. Response is sent back via WhatsApp

## How to Train the Chatbot for a NEW Business

Use `PATCH /api/tenants/:id` to update the business context at any time:

```bash
curl -X PATCH https://your-app.up.railway.app/api/tenants/TENANT_ID \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "aiConfig": {
      "model": "claude",
      "temperature": 0.7,
      "businessDescription": "YOUR BUSINESS DESCRIPTION",
      "services": [
        { "name": "Service 1", "description": "What it is", "price": "R$ 100" }
      ],
      "faq": [
        { "question": "Common question?", "answer": "The answer" }
      ],
      "qualificationCriteria": [
        { "label": "What to qualify on", "weight": 3 }
      ],
      "tone": "friendly",
      "greeting": "Custom greeting message",
      "forbiddenTopics": ["topics to avoid"]
    }
  }'
```

### What Each Field Does

| Field | Purpose | Anti-Hallucination Effect |
|-------|---------|--------------------------|
| `businessDescription` | Tells the bot who the business is | Bot only talks about this business |
| `services` | List of products/services with prices | Bot ONLY mentions these services. Won't invent prices. |
| `faq` | Pre-approved answers to common questions | Bot uses these exact answers instead of making things up |
| `qualificationCriteria` | What makes a good lead | Bot asks about these specific things |
| `tone` | `formal`, `casual`, or `friendly` | Controls language style |
| `greeting` | First message when someone contacts | Consistent brand voice |
| `closingMessage` | Goodbye message | Professional sign-off |
| `escalationRules` | When to hand off to human | Prevents bot from handling sensitive topics |
| `forbiddenTopics` | Topics the bot must refuse | Hard block on dangerous/irrelevant topics |

## Niche-Specific Image Analysis (`aiConfig.businessType`)

When a client sends a photo (WhatsApp or web chat), it is analysed by Claude Vision
(`src/ai/vision/visual.analyzer.ts`). The prompt is chosen by the tenant's
`aiConfig.businessType` (`src/ai/vision/visual.prompt.ts`, `NICHE_PROMPTS`), and the same
value injects niche-specific rules into the chat system prompt.

| `businessType` | Use for | Behaviour |
|---|---|---|
| `hairstylist` | Hair salons, braids | Identifies the style, time, complexity |
| `tattoo` | Tattoo studios | Style, size, placement |
| `nail_studio` | Nail studios | Shape, length, nail art |
| `makeup` | Makeup artists | Look, occasion, palette |
| `aesthetic_clinic` | Aesthetic / medical-aesthetic clinics | Acknowledges the photo neutrally. **Never** diagnoses, judges appearance, estimates age or suggests a treatment, dose or number of sessions. States that any indication is defined in an in-person evaluation with the responsible professional (CFM Res. 2.336/2023) and offers to schedule it. Refuses photos of minors and intimate images. |
| `planned_furniture` | Móveis planejados | Describes the room, asks for measurements and needs, guides to a measurement visit or quote. Never gives a price from a photo. |
| *(unset / unknown)* | Everything else | Generic "describe what you see" prompt |

> **Required:** the Vitrini72 **estética demo** and **ÁUREA** tenants MUST have
> `aiConfig.businessType = "aesthetic_clinic"`. Without it they fall back to the generic
> prompt, which may comment on the visitor's face/skin or imply a treatment indication.
> The value is **not validated** — a typo (e.g. `aesthetic-clinic`) silently falls back to
> generic, so verify it after setting.

**Option A — script** (matches tenant by partial `businessName`):

```bash
npx tsx scripts/set-business-type.ts "ÁUREA" aesthetic_clinic
npx tsx scripts/set-business-type.ts "Estética" aesthetic_clinic
npx tsx scripts/set-business-type.ts "Planejados" planned_furniture
```

**Option B — portal admin API** (superadmin JWT):

```bash
curl -X PATCH https://YOUR-APP/api/portal-admin/tenants/TENANT_ID \
  -H "Authorization: Bearer SUPERADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"businessType": "aesthetic_clinic"}'
```

**Option C — at creation:** include `"businessType": "aesthetic_clinic"` inside `aiConfig`
in the `POST /api/tenants` body (Step 3).

Verify with `GET /api/portal-admin/tenants` — the tenant's `aiConfig.businessType` must
read exactly `aesthetic_clinic`. Pass an empty value to the script to reset to generic.

## Troubleshooting

### Messages not arriving at my app
1. Check `GET /health/ready` — is `evolution` showing `ok`?
2. Run `POST /api/tenants/:id/webhook` to reconfigure the webhook
3. Verify `WEBHOOK_BASE_URL` in Railway env vars is your public URL (with `https://`)

### Bot not responding
1. Check that `ANTHROPIC_API_KEY` is set and valid
2. Check that the tenant status is `active` (not `onboarding` or `suspended`)
3. Check Railway logs for errors

### Bot is hallucinating / making up information
1. Add more `services` entries with accurate prices
2. Add `faq` entries for common questions
3. Add `forbiddenTopics` for things the bot shouldn't discuss
4. Set a specific `businessDescription`

### WhatsApp disconnected
1. Run `POST /api/tenants/:id/connect` to get a new QR code
2. Scan with the business's WhatsApp
3. Run `POST /api/tenants/:id/webhook` after connecting

## API Reference (Quick)

All API routes require `x-api-key` header.

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/tenants` | Create a business |
| `GET` | `/api/tenants` | List all businesses |
| `GET` | `/api/tenants/:id` | Get business details |
| `PATCH` | `/api/tenants/:id` | Update business / retrain bot |
| `DELETE` | `/api/tenants/:id` | Delete a business |
| `POST` | `/api/tenants/:id/connect` | Get WhatsApp QR code |
| `GET` | `/api/tenants/:id/status` | Check WhatsApp connection |
| `POST` | `/api/tenants/:id/webhook` | Reconfigure webhook |
| `GET` | `/health` | Basic health check |
| `GET` | `/health/ready` | Full system diagnostics |
