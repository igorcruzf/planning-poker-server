import { z } from 'zod';
import { boundedTextSchema, hasUniqueItems } from './primitives';

export const CARD_VALUE_MAX_LENGTH = 4;
export const CARD_MEANING_MAX_LENGTH = 40;
export const DECK_MIN_CARDS = 2;
export const DECK_MAX_CARDS = 15;

export const specialCardSchema = z.enum(['?', 'yakult']);
export type SpecialCard = z.infer<typeof specialCardSchema>;
export const SPECIAL_CARDS = specialCardSchema.options;

const isSpecialCard = (value: string) => specialCardSchema.safeParse(value).success;

export const cardValueSchema = boundedTextSchema(CARD_VALUE_MAX_LENGTH).refine((value) => !isSpecialCard(value), {
    message: 'Reserved for a special card',
});
export type CardValue = z.infer<typeof cardValueSchema>;

export const cardMeaningSchema = boundedTextSchema(CARD_MEANING_MAX_LENGTH);

export const cardSchema = z.strictObject({ value: cardValueSchema, meaning: cardMeaningSchema.optional() });
export type Card = z.infer<typeof cardSchema>;

export const voteValueSchema = z.union([specialCardSchema, cardValueSchema]);
export type VoteValue = z.infer<typeof voteValueSchema>;

export const deckPresetIdSchema = z.enum([
    'yakutsk',
    'tshirt',
    'fibonacci',
    'modified_fibonacci',
    'powers_of_two',
    'custom',
]);
export type DeckPresetId = z.infer<typeof deckPresetIdSchema>;

export type DeckPreset = {
    readonly id: DeckPresetId;
    readonly label: string;
    readonly cards: readonly Readonly<Card>[];
};

const cardsWithoutMeaning = (...values: string[]): Card[] => values.map((value) => ({ value }));

export const DECK_PRESETS: readonly DeckPreset[] = [
    {
        id: 'yakutsk',
        label: 'Yakutsk',
        cards: [
            { value: 'PP', meaning: 'até 3 dias' },
            { value: 'P', meaning: 'até 5 dias' },
            { value: 'M', meaning: 'até 10 dias' },
            { value: 'G', meaning: '10+ dias' },
        ],
    },
    { id: 'tshirt', label: 'Camiseta (Jira)', cards: cardsWithoutMeaning('PP', 'P', 'M', 'G', 'GG', 'XG') },
    { id: 'fibonacci', label: 'Fibonacci', cards: cardsWithoutMeaning('1', '2', '3', '5', '8', '13', '21') },
    {
        id: 'modified_fibonacci',
        label: 'Fibonacci modificado',
        cards: cardsWithoutMeaning('0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100'),
    },
    { id: 'powers_of_two', label: 'Potências de 2', cards: cardsWithoutMeaning('1', '2', '4', '8', '16', '32') },
    { id: 'custom', label: 'Personalizado', cards: [] },
];

export const DEFAULT_DECK_PRESET_ID: DeckPresetId = 'yakutsk';

const presetCards = (presetId: DeckPresetId): readonly Readonly<Card>[] =>
    DECK_PRESETS.find((preset) => preset.id === presetId)?.cards ?? [];

const hasUniqueValues = (cards: readonly Card[]) => hasUniqueItems(cards.map((card) => card.value));

const haveSameValues = (expected: readonly Readonly<Card>[], actual: readonly Card[]) =>
    expected.length === actual.length && expected.every((card, index) => card.value === actual[index]?.value);

const keepsPresetValues = ({ presetId, cards }: { presetId: DeckPresetId; cards: readonly Card[] }) =>
    presetId === 'custom' || haveSameValues(presetCards(presetId), cards);

export const deckSchema = z
    .strictObject({
        presetId: deckPresetIdSchema,
        cards: z
            .array(cardSchema)
            .min(DECK_MIN_CARDS)
            .max(DECK_MAX_CARDS)
            .refine(hasUniqueValues, { message: 'Card values must be unique' }),
    })
    .refine(keepsPresetValues, { message: 'Card values must match the preset', path: ['cards'] });
export type Deck = z.infer<typeof deckSchema>;

export const DEFAULT_DECK: Deck = {
    presetId: DEFAULT_DECK_PRESET_ID,
    cards: presetCards(DEFAULT_DECK_PRESET_ID).map((card) => ({ ...card })),
};

export const cardStateSchema = z.object({ value: z.string(), meaning: z.string().optional() });
export type CardState = z.infer<typeof cardStateSchema>;

export const deckStateSchema = z.object({ presetId: deckPresetIdSchema, cards: z.array(cardStateSchema) });
export type DeckState = z.infer<typeof deckStateSchema>;
