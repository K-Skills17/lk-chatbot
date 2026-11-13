import { describe, it, expect, vi } from 'vitest';

// visual.analyzer imports env/logger; stub them so the pure formatter can be tested offline.
vi.mock('../config/env', () => ({ env: { ANTHROPIC_API_KEY: 'test' } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { getPromptForNiche, NICHE_PROMPTS } from '../ai/vision/visual.prompt';
import { formatAnalysisForConversation, VisualAnalysis } from '../ai/vision/visual.analyzer';
import { createTenantSchema } from '../modules/tenant/tenant.schema';

describe('getPromptForNiche', () => {
  it('selects the aesthetic_clinic prompt', () => {
    const cfg = getPromptForNiche('aesthetic_clinic');
    expect(cfg).toBe(NICHE_PROMPTS.aesthetic_clinic);
    expect(cfg).not.toBe(NICHE_PROMPTS.default);
  });

  it('selects the planned_furniture prompt', () => {
    const cfg = getPromptForNiche('planned_furniture');
    expect(cfg).toBe(NICHE_PROMPTS.planned_furniture);
    expect(cfg).not.toBe(NICHE_PROMPTS.default);
  });

  it('falls back to the generic prompt for unknown or missing types', () => {
    expect(getPromptForNiche(undefined)).toBe(NICHE_PROMPTS.default);
    expect(getPromptForNiche('aesthetic-clinic')).toBe(NICHE_PROMPTS.default);
  });

  it('keeps existing niches mapped', () => {
    for (const niche of ['hairstylist', 'tattoo', 'nail_studio', 'makeup']) {
      expect(getPromptForNiche(niche)).toBe(NICHE_PROMPTS[niche]);
    }
  });
});

describe('aesthetic_clinic prompt content', () => {
  const { systemPrompt, botInstructions } = NICHE_PROMPTS.aesthetic_clinic;

  it('forbids diagnosis, appearance judgement, age estimation and treatment indication', () => {
    expect(systemPrompt).toMatch(/diagnose/i);
    expect(systemPrompt).toMatch(/appearance/i);
    expect(systemPrompt).toMatch(/estimate age/i);
    expect(systemPrompt).toMatch(/dose/i);
    expect(systemPrompt).toMatch(/number of sessions/i);
    expect(botInstructions).toMatch(/NEVER diagnose/);
  });

  it('defers indication to an in-person evaluation and offers scheduling', () => {
    expect(systemPrompt).toMatch(/in-person evaluation/i);
    expect(botInstructions).toMatch(/in-person evaluation with the responsible professional/i);
    expect(botInstructions).toMatch(/schedule the evaluation/i);
  });

  it('refuses minors and intimate images', () => {
    expect(systemPrompt).toContain('"refused": "minor"');
    expect(systemPrompt).toContain('"refused": "intimate"');
  });

  it('has no diagnostic or time/complexity fields in its JSON schema', () => {
    expect(systemPrompt).not.toMatch(/"(skinType|estimatedAge|complexity|estimatedTime|treatment)"/);
  });
});

describe('formatAnalysisForConversation — aesthetic_clinic', () => {
  it('drops any non-whitelisted field the model may return', () => {
    const analysis: VisualAnalysis = {
      imageKind: 'rosto',
      description: 'Foto do rosto, de frente',
      summary: 'Obrigado pela foto. A indicação é definida na avaliação presencial.',
      followUpQuestions: ['Qual período fica melhor para você?'],
      // things the model must not produce, but might:
      styleName: 'Melasma',
      skinType: 'oleosa',
      estimatedAge: '45',
      complexity: 'complex',
      estimatedTime: '3 sessões',
      characteristics: ['rugas na testa'],
    };
    const text = formatAnalysisForConversation(analysis, 'aesthetic_clinic');
    expect(text).toContain('Tipo de imagem: rosto');
    expect(text).toContain('Qual período fica melhor para você?');
    expect(text).toMatch(/avaliação presencial/);
    for (const leaked of ['Melasma', 'oleosa', '45', 'complex', '3 sessões', 'rugas']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('formats refusals without describing the image', () => {
    const minor = formatAnalysisForConversation(
      { refused: 'minor', summary: '', followUpQuestions: [] },
      'aesthetic_clinic',
    );
    expect(minor).toMatch(/menor de idade/);
    expect(minor).toMatch(/responsável legal/);

    const intimate = formatAnalysisForConversation(
      { refused: 'intimate', summary: '', followUpQuestions: [] },
      'aesthetic_clinic',
    );
    expect(intimate).toMatch(/conteúdo íntimo/);
  });

  it('does not crash when the model omits followUpQuestions', () => {
    const text = formatAnalysisForConversation(
      { summary: 'ok' } as unknown as VisualAnalysis,
      'aesthetic_clinic',
    );
    expect(text).toContain('Resumo: ok');
  });
});

describe('formatAnalysisForConversation — planned_furniture', () => {
  it('includes room type, elements and project notes', () => {
    const text = formatAnalysisForConversation(
      {
        roomType: 'cozinha',
        description: 'Cozinha em L com janela',
        visibleElements: ['janela', 'pia'],
        projectNotes: 'Tubulação na parede da pia',
        summary: 'Entendi o espaço.',
        followUpQuestions: ['Qual a largura da parede da pia?'],
      },
      'planned_furniture',
    );
    expect(text).toContain('Ambiente: cozinha');
    expect(text).toContain('Elementos visíveis: janela, pia');
    expect(text).toContain('Notas para o projeto: Tubulação na parede da pia');
  });
});

describe('tenant schema', () => {
  it('keeps aiConfig.businessType instead of stripping it', () => {
    const ai = createTenantSchema.shape.aiConfig.parse({ businessType: 'aesthetic_clinic' });
    expect(ai.businessType).toBe('aesthetic_clinic');
  });
});
