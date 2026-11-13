import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getPromptForNiche } from './visual.prompt';

export interface VisualAnalysis {
  // Common fields across all niches
  styleName?: string;
  lookName?: string;
  description?: string;
  characteristics?: string[];
  keyElements?: string[];
  estimatedTime?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  followUpQuestions: string[];
  summary: string;
  // Niche-specific fields (present depending on businessType)
  [key: string]: unknown;
  error?: string;
  /** aesthetic_clinic only: set when the image must not be analysed */
  refused?: 'minor' | 'intimate' | string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Analyzes a reference image using Claude Vision.
 * The businessType parameter selects the right niche-specific analysis prompt
 * (hairstylist, tattoo, nail_studio, makeup, aesthetic_clinic, planned_furniture,
 * or generic default).
 *
 * Returns structured analysis data, or null if the call fails.
 */
export async function analyzeVisualReference(
  imageBase64: string,
  mimeType: string,
  businessType?: string,
): Promise<VisualAnalysis | null> {
  try {
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const normalizedMime = validMimeTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    const { systemPrompt } = getPromptForNiche(businessType);

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: normalizedMime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: 'Please analyze this reference photo.',
            },
          ],
        },
      ],
    }, { timeout: 30_000 });

    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // Strip markdown code fences if present
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? [null, rawText];
    const parsed: VisualAnalysis = JSON.parse(jsonMatch[1] ?? rawText);

    logger.info(
      {
        niche: businessType ?? 'default',
        name: parsed.styleName ?? parsed.lookName ?? String(parsed.description ?? '').slice(0, 40),
        complexity: parsed.complexity,
      },
      'Visual reference analysis completed',
    );

    return parsed;
  } catch (err) {
    logger.error({ err, businessType }, 'Visual reference analysis failed');
    return null;
  }
}

/**
 * Formats a VisualAnalysis into a human-readable text block.
 * This text is injected into the conversation engine as the "user message"
 * when a client sends a reference photo.
 */
export function formatAnalysisForConversation(
  analysis: VisualAnalysis,
  businessType?: string,
): string {
  if (businessType === 'aesthetic_clinic') {
    return formatAestheticClinicAnalysis(analysis);
  }

  if (analysis.error) {
    return '[Cliente enviou uma imagem que não corresponde ao tipo de serviço]';
  }

  const lines: string[] = ['[Cliente enviou foto de referência]', ''];

  const name = analysis.styleName ?? analysis.lookName ?? analysis.description;
  if (name) lines.push(`Referência identificada: ${name}`);
  if (analysis.estimatedTime) lines.push(`Tempo estimado: ${analysis.estimatedTime}`);
  if (analysis.complexity) lines.push(`Complexidade: ${analysis.complexity}`);

  const details = analysis.characteristics ?? analysis.keyElements ?? [];
  if (details.length > 0) lines.push(`Detalhes: ${details.join(', ')}`);

  // Niche-specific extras
  if (businessType === 'hairstylist') {
    if (analysis.hairLength) lines.push(`Comprimento: ${analysis.hairLength as string}`);
    if (analysis.colorNotes) lines.push(`Cor: ${analysis.colorNotes as string}`);
    if (Array.isArray(analysis.accessoriesNoted) && (analysis.accessoriesNoted as string[]).length > 0) {
      lines.push(`Acessórios: ${(analysis.accessoriesNoted as string[]).join(', ')}`);
    }
    if (analysis.stylistNotes) lines.push(`Notas técnicas: ${analysis.stylistNotes as string}`);
  } else if (businessType === 'tattoo') {
    if (analysis.estimatedSize) lines.push(`Tamanho estimado: ${analysis.estimatedSize as string}`);
    if (analysis.colorNotes) lines.push(`Cor: ${analysis.colorNotes as string}`);
    if (analysis.placementSuggestion) lines.push(`Posicionamento: ${analysis.placementSuggestion as string}`);
    if (analysis.artistNotes) lines.push(`Notas técnicas: ${analysis.artistNotes as string}`);
  } else if (businessType === 'nail_studio') {
    if (analysis.nailShape) lines.push(`Formato: ${analysis.nailShape as string}`);
    if (analysis.nailLength) lines.push(`Comprimento: ${analysis.nailLength as string}`);
    if (analysis.colorScheme) lines.push(`Cores: ${analysis.colorScheme as string}`);
    if (Array.isArray(analysis.artDetails) && (analysis.artDetails as string[]).length > 0) {
      lines.push(`Arte: ${(analysis.artDetails as string[]).join(', ')}`);
    }
    if (analysis.techNotes) lines.push(`Notas técnicas: ${analysis.techNotes as string}`);
  } else if (businessType === 'makeup') {
    if (analysis.occasion) lines.push(`Ocasião: ${analysis.occasion as string}`);
    if (analysis.colorPalette) lines.push(`Paleta: ${analysis.colorPalette as string}`);
    if (Array.isArray(analysis.keyProducts) && (analysis.keyProducts as string[]).length > 0) {
      lines.push(`Foco: ${(analysis.keyProducts as string[]).join(', ')}`);
    }
    if (analysis.artistNotes) lines.push(`Notas técnicas: ${analysis.artistNotes as string}`);
  } else if (businessType === 'planned_furniture') {
    if (analysis.roomType) lines.push(`Ambiente: ${analysis.roomType as string}`);
    if (Array.isArray(analysis.visibleElements) && (analysis.visibleElements as string[]).length > 0) {
      lines.push(`Elementos visíveis: ${(analysis.visibleElements as string[]).join(', ')}`);
    }
    if (analysis.styleNotes) lines.push(`Estilo: ${analysis.styleNotes as string}`);
    if (analysis.projectNotes) lines.push(`Notas para o projeto: ${analysis.projectNotes as string}`);
  }

  lines.push('', `Resumo: ${analysis.summary}`);

  if (Array.isArray(analysis.followUpQuestions) && analysis.followUpQuestions.length > 0) {
    lines.push('', 'Perguntas sugeridas:');
    for (const q of analysis.followUpQuestions) {
      lines.push(`- ${q}`);
    }
  }

  return lines.join('\n');
}

/**
 * Aesthetic clinics: only whitelisted, neutral fields reach the conversation.
 * Anything else the model may have returned (skin type, age, conditions,
 * treatments, time/complexity estimates) is dropped on purpose — see
 * CFM Resolução 2.336/2023 (no indication outside an in-person evaluation).
 */
function formatAestheticClinicAnalysis(analysis: VisualAnalysis): string {
  const policyReminder =
    'Lembrete: não comentar a aparência, não diagnosticar e não indicar tratamento; ' +
    'a indicação é definida somente na avaliação presencial com o profissional responsável. ' +
    'Oferecer o agendamento da avaliação.';

  if (analysis.refused === 'minor') {
    return [
      '[Cliente enviou uma imagem que não pode ser analisada: possível menor de idade]',
      'Não descrever a imagem. Informar com educação que não analisamos fotos de menores de idade ' +
        'e oferecer avaliação presencial com a presença de um responsável legal.',
    ].join('\n');
  }
  if (analysis.refused) {
    return [
      '[Cliente enviou uma imagem que não pode ser analisada: conteúdo íntimo]',
      'Não descrever a imagem. Informar com educação que não analisamos imagens íntimas ' +
        'e oferecer a avaliação presencial.',
    ].join('\n');
  }
  if (analysis.error) {
    return `[Cliente enviou uma imagem]\n${policyReminder}`;
  }

  const lines: string[] = ['[Cliente enviou uma foto]', ''];
  if (typeof analysis.imageKind === 'string' && analysis.imageKind) {
    lines.push(`Tipo de imagem: ${analysis.imageKind}`);
  }
  if (typeof analysis.summary === 'string' && analysis.summary) {
    lines.push('', `Resumo: ${analysis.summary}`);
  }
  if (Array.isArray(analysis.followUpQuestions) && analysis.followUpQuestions.length > 0) {
    lines.push('', 'Perguntas sugeridas:');
    for (const q of analysis.followUpQuestions) lines.push(`- ${q}`);
  }
  lines.push('', policyReminder);
  return lines.join('\n');
}
