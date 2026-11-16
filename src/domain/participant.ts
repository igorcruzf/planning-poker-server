import { KIRO_SEAT_NAME_PREFIX, ParticipantRole, Presence } from '../contracts';

export interface Participant {
    readonly id: string;
    readonly ownerId: string | null;
    readonly tokenHash: string | null;
    name: string;
    role: ParticipantRole;
    presence: Presence;
    disconnectedAt: number | null;
    vote: string | null;
    rationale: string | null;
    umbrella: boolean;
}

export type ParticipantView = Readonly<Omit<Participant, 'tokenHash'>>;

export const isHuman = (participant: Pick<Participant, 'role'>): boolean => participant.role !== 'bot';

export const isPlayer = (participant: Pick<Participant, 'role'>): boolean => participant.role === 'player';

export const toParticipantView = (participant: Participant): ParticipantView => ({
    id: participant.id,
    ownerId: participant.ownerId,
    name: participant.name,
    role: participant.role,
    presence: participant.presence,
    disconnectedAt: participant.disconnectedAt,
    vote: participant.vote,
    rationale: participant.rationale,
    umbrella: participant.umbrella,
});

const CONFUSABLE_LETTERS: Readonly<Record<string, string>> = {
    '\u043a': 'k',
    '\u0456': 'i',
    '\u043e': 'o',
    '\u0440': 'p',
    '\u0441': 'c',
    '\u0435': 'e',
    '\u0430': 'a',
    '\u0445': 'x',
    '\u03ba': 'k',
    '\u03bf': 'o',
};
const INVISIBLE_OR_SPACE = /[\p{Cf}\p{Z}\s]/gu;
const CONFUSABLE_PATTERN = new RegExp(`[${Object.keys(CONFUSABLE_LETTERS).join('')}]`, 'gu');
export const nameSkeleton = (name: string): string =>
    name
        .normalize('NFKC')
        .toLowerCase()
        .replace(INVISIBLE_OR_SPACE, '')
        .replace(CONFUSABLE_PATTERN, (letter) => CONFUSABLE_LETTERS[letter]);
export const isReservedForKiro = (name: string): boolean =>
    nameSkeleton(name).startsWith(nameSkeleton(KIRO_SEAT_NAME_PREFIX));
