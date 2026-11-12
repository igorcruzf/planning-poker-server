import {
    cardValueSchema,
    DECK_PRESETS,
    DEFAULT_DECK,
    DEFAULT_DECK_PRESET_ID,
    deckSchema,
    SPECIAL_CARDS,
    voteValueSchema,
} from '../contracts';

const customDeck = (values: string[]) => ({ presetId: 'custom', cards: values.map((value) => ({ value })) });
const numberedValues = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));

describe('deck presets', () => {
    it('lists the 6 presets with their labels and values in order', () => {
        expect(DECK_PRESETS.map((preset) => [preset.label, preset.cards.map((card) => card.value)])).toEqual([
            ['Yakutsk', ['PP', 'P', 'M', 'G']],
            ['Camiseta (Jira)', ['PP', 'P', 'M', 'G', 'GG', 'XG']],
            ['Fibonacci', ['1', '2', '3', '5', '8', '13', '21']],
            ['Fibonacci modificado', ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100']],
            ['Potências de 2', ['1', '2', '4', '8', '16', '32']],
            ['Personalizado', []],
        ]);
    });

    it('uses Yakutsk as the default preset with its 4 exact meanings', () => {
        expect(DEFAULT_DECK_PRESET_ID).toBe('yakutsk');
        expect(DEFAULT_DECK).toEqual({
            presetId: 'yakutsk',
            cards: [
                { value: 'PP', meaning: 'até 3 dias' },
                { value: 'P', meaning: 'até 5 dias' },
                { value: 'M', meaning: 'até 10 dias' },
                { value: 'G', meaning: '10+ dias' },
            ],
        });
        expect(DECK_PRESETS[0]).toEqual({ id: 'yakutsk', label: 'Yakutsk', cards: DEFAULT_DECK.cards });
    });

    it('has no meaning in the "Camiseta (Jira)" preset', () => {
        const tshirt = DECK_PRESETS.find((preset) => preset.label === 'Camiseta (Jira)');

        expect(tshirt?.cards.every((card) => card.meaning === undefined)).toBe(true);
    });

    it.each(DECK_PRESETS.filter((preset) => preset.id !== 'custom'))('accepts the $label preset as a deck', (preset) => {
        expect(deckSchema.parse({ presetId: preset.id, cards: preset.cards })).toEqual({
            presetId: preset.id,
            cards: preset.cards,
        });
    });

    it('accepts edited meanings on a preset', () => {
        const cards = [
            { value: 'PP', meaning: 'até 2 dias' },
            { value: 'P', meaning: 'até 4 dias' },
            { value: 'M', meaning: 'até 8 dias' },
            { value: 'G' },
        ];

        expect(deckSchema.safeParse({ presetId: 'yakutsk', cards }).success).toBe(true);
    });

    it('rejects a preset whose values were changed', () => {
        const cards = [{ value: 'PP' }, { value: 'P' }, { value: 'M' }, { value: 'GG' }];

        expect(deckSchema.safeParse({ presetId: 'yakutsk', cards }).success).toBe(false);
    });
});

describe('custom deck', () => {
    it.each([2, 15])('accepts %i cards', (count) => {
        expect(deckSchema.safeParse(customDeck(numberedValues(count))).success).toBe(true);
    });

    it.each([1, 16])('rejects %i cards', (count) => {
        expect(deckSchema.safeParse(customDeck(numberedValues(count))).success).toBe(false);
    });

    it('accepts a value with 4 characters and rejects one with 5', () => {
        expect(deckSchema.safeParse(customDeck(['ABCD', 'B'])).success).toBe(true);
        expect(deckSchema.safeParse(customDeck(['ABCDE', 'B'])).success).toBe(false);
    });

    it('accepts a meaning with 40 characters and rejects one with 41', () => {
        const withMeaning = (meaning: string) => ({
            presetId: 'custom',
            cards: [{ value: 'A', meaning }, { value: 'B' }],
        });

        expect(deckSchema.safeParse(withMeaning('x'.repeat(40))).success).toBe(true);
        expect(deckSchema.safeParse(withMeaning('x'.repeat(41))).success).toBe(false);
    });

    it.each([[['', 'B']], [['   ', 'B']]])('rejects an empty value in %p', (values) => {
        expect(deckSchema.safeParse(customDeck(values)).success).toBe(false);
    });

    it('rejects a repeated value', () => {
        expect(deckSchema.safeParse(customDeck(['A', 'B', 'A'])).success).toBe(false);
    });

    it('rejects an unknown preset', () => {
        expect(deckSchema.safeParse({ presetId: 'poker', cards: [{ value: 'A' }, { value: 'B' }] }).success).toBe(
            false,
        );
    });
});

describe('special cards', () => {
    it('are "?" and Yakult', () => {
        expect(SPECIAL_CARDS).toEqual(['?', 'yakult']);
    });

    it.each(SPECIAL_CARDS)('keeps %p out of the deck values', (special) => {
        expect(cardValueSchema.safeParse(special).success).toBe(false);
        expect(deckSchema.safeParse(customDeck([special, 'B'])).success).toBe(false);
    });

    it.each(['?', 'yakult', 'M', '½'])('accepts %p as a vote value', (value) => {
        expect(voteValueSchema.parse(value)).toBe(value);
    });

    it.each(['', 'ABCDE', 'Yakult'])('rejects %p as a vote value', (value) => {
        expect(voteValueSchema.safeParse(value).success).toBe(false);
    });
});
