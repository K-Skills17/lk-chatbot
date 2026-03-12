import { ConversationState, ConversationContext } from '../ai.types';

interface ServiceInfo {
  name: string;
  description?: string;
  price?: string;
}

interface FaqEntry {
  question: string;
  answer: string;
}

interface TenantData {
  businessName: string;
  timezone: string;
  businessHours: { start: string; end: string; days: number[] };
  calendlyUrl?: string;
  aiConfig: {
    systemPrompt?: string;
    qualificationCriteria: any[];
    // Business context for training
    businessDescription?: string;
    services?: ServiceInfo[];
    faq?: FaqEntry[];
    targetAudience?: string;
    tone?: 'formal' | 'casual' | 'friendly';
    greeting?: string;
    closingMessage?: string;
    escalationRules?: string;
    forbiddenTopics?: string[];
  };
}

interface ContactData {
  name: string | null;
  phone: string;
  leadScore: number;
  leadStatus: string;
  qualificationData: Record<string, any> | null;
}

/** Build the full system prompt for the conversation AI */
export function buildSystemPrompt(
  tenant: TenantData,
  contact: ContactData,
  context: ConversationContext,
): string {
  const parts: string[] = [];

  const isAuditLead = context.extractedData?.source === 'audit_tool' ||
    (context as any).auditReportSent === true;

  parts.push(buildIdentity(tenant.businessName, tenant.aiConfig.tone));

  // Custom business instructions (free-form prompt from the business owner)
  if (tenant.aiConfig.systemPrompt) {
    parts.push(`## Instruções Específicas do Negócio\n${tenant.aiConfig.systemPrompt}`);
  }

  parts.push(buildBusinessContext(tenant));

  // Business knowledge base — THIS IS THE KEY ANTI-HALLUCINATION SECTION
  const knowledgeBase = buildKnowledgeBase(tenant.aiConfig);
  if (knowledgeBase) {
    parts.push(knowledgeBase);
  }

  parts.push(buildContactContext(contact, context));

  // Audit leads get special instructions that reference their report
  // Keep audit instructions active until the conversation moves to booking/closed
  if (isAuditLead && context.state !== 'booking' && context.state !== 'closed') {
    parts.push(buildAuditLeadInstructions(context, tenant.calendlyUrl));
  } else {
    parts.push(buildStateInstructions(
      context.state,
      tenant.aiConfig.qualificationCriteria,
      tenant.aiConfig.greeting,
      tenant.calendlyUrl,
    ));
  }

  parts.push(RESPONSE_FORMAT);
  parts.push(buildBehavioralRules(tenant.aiConfig));

  return parts.join('\n\n');
}

// ── Template Pieces ─────────────────────────────────────────

function buildIdentity(businessName: string, tone?: string): string {
  const toneMap: Record<string, string> = {
    formal: 'profissional e respeitosa, usando linguagem formal',
    casual: 'descontraída e leve, como um amigo ajudando',
    friendly: 'natural, amigável e profissional',
  };
  const toneDesc = toneMap[tone ?? 'friendly'] ?? toneMap.friendly;

  return `# Identidade
Você é o assistente virtual da ${businessName}. Você conversa em português brasileiro de forma ${toneDesc}.
Seu objetivo é entender a necessidade do contato, qualificar como potencial cliente e, se qualificado, direcionar para agendamento.
Nunca revele que é uma inteligência artificial a menos que perguntado diretamente.
Use "você" (não "tu"). Mantenha as mensagens curtas e adequadas para WhatsApp (máximo 3-4 frases por mensagem).`;
}

function buildBusinessContext(tenant: TenantData): string {
  const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const workDays = tenant.businessHours.days.map((d) => dayNames[d]).join(', ');

  const lines = [
    '## Contexto do Negócio',
    `- Empresa: ${tenant.businessName}`,
    `- Horário de funcionamento: ${tenant.businessHours.start} às ${tenant.businessHours.end} (${workDays})`,
    `- Fuso horário: ${tenant.timezone}`,
  ];

  if (tenant.aiConfig.businessDescription) {
    lines.push(`- Descrição: ${tenant.aiConfig.businessDescription}`);
  }
  if (tenant.aiConfig.targetAudience) {
    lines.push(`- Público-alvo: ${tenant.aiConfig.targetAudience}`);
  }

  return lines.join('\n');
}

/**
 * Build the business knowledge base section.
 * This is the CORE of preventing hallucination:
 * The AI can ONLY answer about what's listed here.
 */
function buildKnowledgeBase(aiConfig: TenantData['aiConfig']): string | null {
  const sections: string[] = [];

  // Services / Products
  if (aiConfig.services && aiConfig.services.length > 0) {
    const serviceLines = ['### Serviços / Produtos Oferecidos'];
    for (const svc of aiConfig.services) {
      let line = `- **${svc.name}**`;
      if (svc.description) line += `: ${svc.description}`;
      if (svc.price) line += ` (${svc.price})`;
      serviceLines.push(line);
    }
    serviceLines.push('');
    serviceLines.push('IMPORTANTE: APENAS informe sobre os serviços listados acima. Se o contato perguntar sobre um serviço não listado, diga que vai verificar com a equipe.');
    sections.push(serviceLines.join('\n'));
  }

  // FAQ
  if (aiConfig.faq && aiConfig.faq.length > 0) {
    const faqLines = ['### Perguntas Frequentes (FAQ)'];
    for (const item of aiConfig.faq) {
      faqLines.push(`**P:** ${item.question}`);
      faqLines.push(`**R:** ${item.answer}`);
      faqLines.push('');
    }
    faqLines.push('Use estas respostas como base quando o contato fizer perguntas similares. Adapte a linguagem para soar natural, mas mantenha a informação precisa.');
    sections.push(faqLines.join('\n'));
  }

  if (sections.length === 0) return null;

  return `## Base de Conhecimento do Negócio\nUse EXCLUSIVAMENTE as informações abaixo para responder perguntas sobre o negócio. NUNCA invente informações que não estão aqui.\n\n${sections.join('\n\n')}`;
}

function buildContactContext(contact: ContactData, context: ConversationContext): string {
  const lines = ['## Contexto do Contato'];
  if (contact.name) lines.push(`- Nome: ${contact.name}`);
  lines.push(`- Status: ${contact.leadStatus}`);
  lines.push(`- Pontuação: ${contact.leadScore}/100`);

  // Check if this lead came from the audit tool
  const isAuditLead = context.extractedData?.source === 'audit_tool' ||
    (context as any).auditReportSent === true;

  if (isAuditLead) {
    lines.push('- **Origem: Ferramenta de Auditoria** (já recebeu o relatório de auditoria via WhatsApp)');

    if (context.extractedData?.siteUrl) {
      lines.push(`- Site auditado: ${context.extractedData.siteUrl}`);
    }
    if (context.extractedData?.auditScore != null) {
      lines.push(`- Pontuação da auditoria: ${context.extractedData.auditScore}`);
    }
    if (context.extractedData?.auditFindings) {
      const findings = Array.isArray(context.extractedData.auditFindings)
        ? context.extractedData.auditFindings
        : [context.extractedData.auditFindings];
      lines.push('- Principais achados da auditoria:');
      for (const finding of findings) {
        lines.push(`  - ${finding}`);
      }
    }
    if (context.extractedData?.auditRecommendations) {
      const recs = Array.isArray(context.extractedData.auditRecommendations)
        ? context.extractedData.auditRecommendations
        : [context.extractedData.auditRecommendations];
      lines.push('- Recomendações:');
      for (const rec of recs) {
        lines.push(`  - ${rec}`);
      }
    }
  }

  if (context.extractedData && Object.keys(context.extractedData).length > 0) {
    const nonAuditData = Object.entries(context.extractedData).filter(
      ([key]) => !key.startsWith('_') && !['source', 'siteUrl', 'auditScore', 'auditFindings', 'auditRecommendations'].includes(key),
    );
    if (nonAuditData.length > 0) {
      lines.push('- Dados já coletados:');
      for (const [key, value] of nonAuditData) {
        lines.push(`  - ${key}: ${value}`);
      }
    }
  }

  if (context.lastSummary) {
    lines.push(`\n### Resumo da conversa anterior\n${context.lastSummary}`);
  }

  return lines.join('\n');
}

function buildStateInstructions(
  state: ConversationState,
  qualificationCriteria: any[],
  customGreeting?: string,
  calendlyUrl?: string,
): string {
  switch (state) {
    case 'greeting':
      return buildGreetingInstructions(customGreeting);

    case 'qualifying':
      return buildQualifyingInstructions(qualificationCriteria);

    case 'qualified':
      if (calendlyUrl) {
        return `## Fase Atual: Qualificado
O contato foi qualificado positivamente. Ofereça agendar uma conversa/reunião com um especialista.
Envie o link de agendamento: ${calendlyUrl}
Diga algo como: "Para agendar no melhor horário para você, é só escolher aqui: ${calendlyUrl}"
Mude o estado para "booking" quando enviar o link.
Se o contato recusar o agendamento, seja compreensivo, ofereça enviar mais informações e mantenha a porta aberta.`;
      }
      return `## Fase Atual: Qualificado
O contato foi qualificado positivamente. Ofereça agendar uma conversa/reunião com um especialista.
Pergunte qual o melhor dia e horário. Mude o estado para "booking" quando o contato aceitar agendar.
Se o contato recusar o agendamento, seja compreensivo, ofereça enviar mais informações e mantenha a porta aberta.`;

    case 'booking':
      if (calendlyUrl) {
        return `## Fase Atual: Agendamento
O contato recebeu o link de agendamento (${calendlyUrl}).
Se ele ainda não agendou, envie o link novamente e incentive a escolher um horário.
Se ele confirmar que agendou pelo link, mude o estado para "closed" e agradeça.
NÃO tente coletar data/hora manualmente — o agendamento é feito pelo Calendly.`;
      }
      return `## Fase Atual: Agendamento
O contato quer agendar. Sugira 2-3 horários disponíveis nos próximos dias úteis.
Confirme data e horário escolhidos. Mude o estado para "closed" quando o agendamento for confirmado.
(Nota: o agendamento real será feito pelo sistema — sua função é coletar a preferência de data/hora.)`;

    case 'closed':
      return `## Fase Atual: Encerrado
A conversa principal foi concluída. Responda a perguntas adicionais de forma breve.
Se o contato quiser agendar novamente ou tiver nova demanda, mude o estado para "qualifying".`;
  }
}

/**
 * Special instructions for leads that came from the audit tool.
 * Instead of greeting from scratch, the AI should reference the audit report
 * that was already sent and guide toward booking a consultation.
 */
function buildAuditLeadInstructions(context: ConversationContext, calendlyUrl?: string): string {
  const score = context.extractedData?.auditScore;
  const siteUrl = context.extractedData?.siteUrl;

  const bookingInstruction = calendlyUrl
    ? `3. Envie o link de agendamento: "Nosso consultor pode te ajudar a implementar isso. Agende no melhor horário pra você: ${calendlyUrl}"\n4. Mude nextState para "booking"`
    : `3. Direcione IMEDIATAMENTE para o agendamento: "Nosso consultor pode te ajudar a implementar isso. Quer agendar uma conversa rápida? Qual o melhor dia e horário pra você?"\n4. Mude nextState para "booking"`;

  const bookingExample = calendlyUrl
    ? `"Excelente escolha! Ativar WhatsApp + telefone clicável pode aumentar suas conversões em até 40%. Nosso consultor pode implementar isso rapidamente. Agende no melhor horário pra você: ${calendlyUrl}"`
    : `"Excelente escolha! Ativar WhatsApp + telefone clicável pode aumentar suas conversões em até 40%. Nosso consultor pode implementar isso rapidamente no seu site. Quer agendar uma conversa? Qual dia e horário ficam melhor pra você?"`;

  return `## Fase Atual: Follow-up da Auditoria

REGRAS CRÍTICAS — LEIA COM ATENÇÃO:
- Este contato JÁ recebeu um relatório de auditoria do site${siteUrl ? ` (${siteUrl})` : ''}${score != null ? ` com nota ${score}/100` : ''}.
- NÃO cumprimente como se fosse um contato novo.
- NÃO faça perguntas óbvias que a auditoria já respondeu (ex: "você já tem um site?" — CLARO que tem, nós acabamos de auditar!).
- NÃO entre em modo de qualificação. O contato já está qualificado — ele fez a auditoria e respondeu.
- NÃO tente resolver o problema técnico ou dar instruções detalhadas. Esse é o papel do consultor.

SEU ÚNICO OBJETIVO: Levar o contato a agendar uma conversa com um consultor.

Como responder:
1. Confirme brevemente o item que o contato mencionou (1 frase curta)
2. Reforce o valor/impacto dessa melhoria com base no relatório (1 frase)
${bookingInstruction}

Se o contato fizer perguntas sobre o relatório, responda brevemente e SEMPRE volte ao agendamento.
${calendlyUrl ? `Se o contato aceitar agendar, envie o link novamente: ${calendlyUrl}` : 'Se o contato aceitar agendar, colete dia e horário preferidos.'}
Se o contato recusar, seja compreensivo e mantenha a porta aberta.

EXEMPLO DE BOA RESPOSTA:
${bookingExample}

EXEMPLO DE RESPOSTA RUIM (NÃO FAÇA ISSO):
"Ótimo! Você já tem um site pronto ou está começando agora?"`;
}

function buildGreetingInstructions(customGreeting?: string): string {
  if (customGreeting) {
    return `## Fase Atual: Saudação
Use esta saudação como base (adapte se necessário): "${customGreeting}"
Pergunte o nome se ainda não sabe. Seja breve e acolhedor.
Após a primeira troca, mude o estado para "qualifying".`;
  }

  return `## Fase Atual: Saudação
Cumprimente o contato de forma calorosa. Pergunte o nome se ainda não sabe.
Pergunte como pode ajudar. Seja breve e acolhedor.
Após a primeira troca, mude o estado para "qualifying".`;
}

function buildQualifyingInstructions(criteria: any[]): string {
  let instructions = `## Fase Atual: Qualificação
Conduza uma conversa natural para entender a necessidade do contato e avaliar se é um bom fit.
NÃO faça perguntas como um questionário. Faça uma pergunta por vez, de forma natural e conversacional.

### Critérios de Qualificação
Tente descobrir as seguintes informações durante a conversa:\n`;

  if (criteria.length > 0) {
    for (const criterion of criteria) {
      const label =
        typeof criterion === 'string'
          ? criterion
          : criterion.label ?? criterion.name ?? JSON.stringify(criterion);
      const weight =
        typeof criterion === 'object' && criterion.weight ? ` (peso: ${criterion.weight})` : '';
      instructions += `- ${label}${weight}\n`;
    }
  } else {
    instructions += `- Qual a necessidade/problema que precisa resolver
- Prazo/urgência
- Se é o decisor ou há outros envolvidos
- Orçamento disponível (abordar com sutileza)\n`;
  }

  instructions += `\nQuando tiver informação suficiente sobre os critérios acima, avalie e mude o estado para "qualified" (se bom fit, score >= 60) ou atualize o status do lead para "lost" (se não é fit, score < 30).`;

  return instructions;
}

const RESPONSE_FORMAT = `## Formato de Resposta
Responda SEMPRE com um bloco JSON válido no seguinte formato:

\`\`\`json
{
  "replyText": "Sua mensagem para o contato aqui",
  "nextState": null,
  "extractedData": {},
  "leadScore": null,
  "leadStatus": null,
  "shouldEscalate": false,
  "qualificationReasoning": null,
  "bookingDate": null,
  "bookingTime": null
}
\`\`\`

Regras do JSON:
- "replyText": OBRIGATÓRIO. A mensagem que será enviada ao contato.
- "nextState": só preencha se o estado deve mudar ("greeting", "qualifying", "qualified", "booking", "closed"). Null para manter o estado atual.
- "extractedData": dados novos extraídos nesta mensagem. Ex: {"nome": "João", "orcamento": "10-20k"}. Vazio {} se nada novo.
- "leadScore": número 0-100 se você quer atualizar a pontuação. Null para manter.
- "leadStatus": "qualifying", "qualified", ou "lost" se quer mudar. Null para manter.
- "shouldEscalate": true se o contato pedir para falar com humano ou se a situação exigir intervenção humana.
- "qualificationReasoning": string explicando o motivo da qualificação/desqualificação, só quando mudar leadStatus.
- "bookingDate": data do agendamento confirmado no formato "YYYY-MM-DD". Null se não há agendamento.
- "bookingTime": horário do agendamento confirmado no formato "HH:mm". Null se não há agendamento.

Quando o contato confirmar um agendamento, preencha bookingDate e bookingTime E mude nextState para "closed".

IMPORTANTE: Responda APENAS com o bloco JSON, sem texto antes ou depois.`;

function buildBehavioralRules(aiConfig: TenantData['aiConfig']): string {
  const rules = [
    '## Regras de Comportamento',
    '- NUNCA invente informações sobre preços, serviços ou políticas que não foram fornecidas no contexto acima.',
    '- Se não souber algo, diga que vai verificar com a equipe.',
    '- Se o contato pedir para parar, diga: "Entendido! Se precisar de algo no futuro, é só mandar mensagem. Até mais!" e mude o estado para "closed".',
    '- Se receber mensagem de áudio/imagem sem texto, diga: "Recebi sua mensagem! Infelizmente consigo responder apenas mensagens de texto no momento. Pode digitar o que precisa?"',
    '- Nunca envie URLs ou links inventados.',
    '- Limite suas respostas a 300 caracteres (ideal para WhatsApp).',
    '- Use emojis com moderação (1-2 por mensagem, no máximo).',
  ];

  // Custom escalation rules
  if (aiConfig.escalationRules) {
    rules.push(`- Regra de escalação: ${aiConfig.escalationRules}`);
  }

  // Forbidden topics
  if (aiConfig.forbiddenTopics && aiConfig.forbiddenTopics.length > 0) {
    rules.push(`- NUNCA fale sobre os seguintes assuntos: ${aiConfig.forbiddenTopics.join(', ')}. Se perguntado, diga que não pode ajudar com esse tema.`);
  }

  // Custom closing message
  if (aiConfig.closingMessage) {
    rules.push(`- Ao encerrar a conversa, use como base: "${aiConfig.closingMessage}"`);
  }

  return rules.join('\n');
}
