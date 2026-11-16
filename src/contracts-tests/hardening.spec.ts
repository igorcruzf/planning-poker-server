import {
    DECK_PRESETS,
    DEFAULT_DECK,
    DEFAULT_ROOM_SETTINGS,
    httpUrlSchema,
    INVALID_PAYLOAD_MAX_ISSUES,
    INVALID_PAYLOAD_TEXT_MAX_LENGTH,
    invalidPayloadErrorSchema,
    JIRA_ASSIGNEE_MAX_LENGTH,
    JIRA_DESCRIPTION_HTML_MAX_LENGTH,
    JIRA_STATUS_MAX_LENGTH,
    JIRA_SUMMARY_MAX_LENGTH,
    jiraAgendaRequestSchema,
    jiraIssueSchema,
    jiraSessionResponseSchema,
    personNameSchema,
    roomCreatePayloadSchema,
    roomSettingsInputSchema,
    rouletteSpinPayloadSchema,
} from '../contracts';

describe('defaults sem referência compartilhada', () => {
    it('devolve baralho e cartas especiais distintos a cada parse', () => {
        const first = roomSettingsInputSchema.parse({});
        const second = roomSettingsInputSchema.parse({});
        expect(first.deck.cards).not.toBe(second.deck.cards);
        expect(first.deck.cards[0]).not.toBe(second.deck.cards[0]);
        expect(first.specialCards).not.toBe(second.specialCards);
    });

    it('não vaza mutação para outras chamadas nem para a constante', () => {
        const first = roomSettingsInputSchema.parse({});
        first.deck.cards.push({ value: 'X' });
        first.specialCards.splice(0);
        const second = roomSettingsInputSchema.parse({});
        expect(second.deck.cards).toHaveLength(DEFAULT_ROOM_SETTINGS.deck.cards.length);
        expect(second.specialCards).toEqual(['?', 'yakult']);
        expect(DEFAULT_ROOM_SETTINGS.deck.cards).toHaveLength(4);
    });

    it('room:create sem settings devolve cartas próprias', () => {
        const payload = { roomName: 'Sala', participantName: 'Ana' };
        const first = roomCreatePayloadSchema.parse(payload);
        const second = roomCreatePayloadSchema.parse(payload);
        expect(first.settings.deck.cards).not.toBe(second.settings.deck.cards);
        expect(first.settings.deck.cards).not.toBe(DEFAULT_ROOM_SETTINGS.deck.cards);
    });

    it('a roleta devolve listas distintas', () => {
        const payload = { mode: 'leader', names: ['Ana', 'Leo'] };
        const first = rouletteSpinPayloadSchema.parse(payload);
        const second = rouletteSpinPayloadSchema.parse(payload);
        expect(first.absent).not.toBe(second.absent);
        expect(first.alreadyDrawn).not.toBe(second.alreadyDrawn);
    });

    it('congela fundo as constantes exportadas', () => {
        expect(() => (DEFAULT_ROOM_SETTINGS.deck.cards as unknown[]).push({ value: 'X' })).toThrow(TypeError);
        expect(() => (DEFAULT_ROOM_SETTINGS.specialCards as unknown[]).pop()).toThrow(TypeError);
        expect(() => ((DEFAULT_DECK.cards[0] as { value: string }).value = 'Z')).toThrow(TypeError);
        expect(() => ((DECK_PRESETS[0]!.cards[0] as { value: string }).value = 'Z')).toThrow(TypeError);
        expect(() => (DECK_PRESETS as unknown[]).pop()).toThrow(TypeError);
    });
});

describe('invalid_payload limitado', () => {
    const error = (issues: { path: string; message: string }[]) => ({ code: 'invalid_payload', issues });

    it('aceita até o máximo de issues', () => {
        const issues = Array.from({ length: INVALID_PAYLOAD_MAX_ISSUES }, () => ({ path: 'a', message: 'm' }));
        expect(invalidPayloadErrorSchema.safeParse(error(issues)).success).toBe(true);
    });

    it('recusa issues demais (payload com 1000 chaves extras)', () => {
        const issues = Array.from({ length: 1000 }, (_, index) => ({ path: `k${index}`, message: 'm' }));
        expect(invalidPayloadErrorSchema.safeParse(error(issues)).success).toBe(false);
    });

    it('recusa path e message acima do limite', () => {
        const long = 'a'.repeat(INVALID_PAYLOAD_TEXT_MAX_LENGTH + 1);
        expect(invalidPayloadErrorSchema.safeParse(error([{ path: long, message: 'm' }])).success).toBe(false);
        expect(invalidPayloadErrorSchema.safeParse(error([{ path: 'a', message: long }])).success).toBe(false);
    });

    it('aceita texto com quebra de linha e HTML dentro do limite, para a BE-G1 não repassar', () => {
        const hostile = 'a\nb<script>';
        expect(invalidPayloadErrorSchema.safeParse(error([{ path: hostile, message: hostile }])).success).toBe(true);
    });
});

describe('texto do card do Jira limitado', () => {
    const issue = {
        key: 'YAK-1',
        summary: 'Resumo',
        issueType: 'Story',
        status: 'Open',
        size: null,
        url: 'https://acme.atlassian.net/browse/YAK-1',
        assignee: null,
        descriptionHtml: '<p>ok</p>',
        sizeField: null,
    };

    it('aceita descrição no limite e recusa acima', () => {
        const at = { ...issue, descriptionHtml: 'a'.repeat(JIRA_DESCRIPTION_HTML_MAX_LENGTH) };
        const over = { ...issue, descriptionHtml: 'a'.repeat(JIRA_DESCRIPTION_HTML_MAX_LENGTH + 1) };
        expect(JIRA_DESCRIPTION_HTML_MAX_LENGTH).toBe(50000);
        expect(jiraIssueSchema.safeParse(at).success).toBe(true);
        expect(jiraIssueSchema.safeParse(over).success).toBe(false);
    });

    it.each([
        ['summary', JIRA_SUMMARY_MAX_LENGTH],
        ['status', JIRA_STATUS_MAX_LENGTH],
        ['assignee', JIRA_ASSIGNEE_MAX_LENGTH],
    ])('recusa %s acima do limite', (field, max) => {
        expect(jiraIssueSchema.safeParse({ ...issue, [field]: 'a'.repeat(max) }).success).toBe(true);
        expect(jiraIssueSchema.safeParse({ ...issue, [field]: 'a'.repeat(max + 1) }).success).toBe(false);
    });
});

describe('nome de pessoa sem caracteres de formatação', () => {
    it.each([['\u200B\u200B'], ['Ana\u200B'], ['\u202EAna'], ['An\u0007a'], ['Ana\u2066'], ['An\uFEFFa'], ['Ana\u200E']])('rejeita %j', (name) => {
        expect(personNameSchema.safeParse(name).success).toBe(false);
    });
    it.each([['👨\u200D👩\u200D👧'], ['🏳\uFE0F\u200D🌈'], ['می\u200Cخواهم']])('aceita ZWJ e ZWNJ em %j', (name) => {
        expect(personNameSchema.safeParse(name).success).toBe(true);
    });

    it('mantém nomes comuns com acento', () => {
        expect(personNameSchema.parse('  Júlia  ')).toBe('Júlia');
    });
});

describe('url sem credenciais', () => {
    it.each([['https://user:senha@acme.atlassian.net'], ['http://x@y.com/']])('rejeita %s', (url) => {
        expect(httpUrlSchema.safeParse(url).success).toBe(false);
        expect(jiraSessionResponseSchema.safeParse({ siteUrl: url }).success).toBe(false);
    });

    it('aceita url normal', () => {
        expect(httpUrlSchema.safeParse('https://acme.atlassian.net/browse/YAK-1').success).toBe(true);
    });
});

describe('keys do Jira sem duplicata', () => {
    it('rejeita chaves repetidas, mesmo com caixa diferente', () => {
        expect(jiraAgendaRequestSchema.safeParse({ type: 'keys', keys: ['A-1', 'a-1'] }).success).toBe(false);
    });

    it('aceita chaves distintas', () => {
        expect(jiraAgendaRequestSchema.safeParse({ type: 'keys', keys: ['A-1', 'A-2'] }).success).toBe(true);
    });
});
