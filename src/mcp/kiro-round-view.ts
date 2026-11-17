import { GetRoundOutput, KiroRound } from '../contracts';
import { isPlayer } from '../domain/participant';
import { Room } from '../domain/room';
import { RoundMarker } from './kiro-session';
export const roundMarkerOf = (room: Room): RoundMarker => ({
    roundId: room.roundId,
    issueKey: room.currentIssue?.key ?? null,
});
const issueOf = (room: Room): GetRoundOutput['issue'] => {
    const current = room.currentIssue;
    const described = room.jira?.currentIssue;
    if (!current || !described || described.key !== current.key) return null;
    return {
        key: current.key,
        summary: current.summary,
        issueType: described.issueType,
        url: described.url,
    };
};
const roundOf = (room: Room): KiroRound => {
    const base = { id: room.roundId };
    if (room.phase === 'revealed') {
        return {
            ...base,
            phase: 'revealed',
            votes: room.ballots.filter(isPlayer).map(({ name, value }) => ({ name, value })),
            finalEstimate: room.finalEstimate?.value ?? null,
        };
    }
    if (room.phase === 'countdown' && room.countdown) {
        return { ...base, phase: 'countdown', revealAt: room.countdown.revealAt };
    }
    return { ...base, phase: 'voting' };
};
export const roundViewFor = (room: Room, seatId: string, roomName: string): GetRoundOutput => {
    const seat = room.findParticipant(seatId);
    const { deck, specialCards, kiroCountsAsPlayer } = room.settings;
    return {
        roomName,
        issue: issueOf(room),
        deck: {
            cards: deck.cards.map(({ value, meaning }) => (meaning === undefined ? { value } : { value, meaning })),
            specialCards,
        },
        kiroCountsAsPlayer,
        yourVote: seat?.vote ? { value: seat.vote, rationale: seat.rationale ?? '' } : null,
        round: roundOf(room),
    };
};
