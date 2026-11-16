import { Card, RoomSettings, SPECIAL_CARDS } from '../contracts';

export const findDeckCard = (settings: RoomSettings, value: string): Card | undefined =>
    settings.deck.cards.find((card) => card.value === value);

export const isVoteAllowed = (settings: RoomSettings, value: string): boolean =>
    findDeckCard(settings, value) !== undefined ||
    SPECIAL_CARDS.some((special) => special === value && settings.specialCards.includes(special));
