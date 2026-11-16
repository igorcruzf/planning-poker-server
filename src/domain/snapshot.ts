import { ParticipantState, RoomState, RoundState } from '../contracts';
import { isHuman, isPlayer, ParticipantView } from './participant';
import { Room } from './room';

export const ANONYMOUS_VIEWER_ID = 'anonymous';

export const snapshotFor = (room: Room, viewerId: string | null): RoomState => {
    const viewer = viewerId === null ? undefined : room.findParticipant(viewerId);
    return structuredClone({
        serverInstanceId: room.serverInstanceId,
        room: { code: room.code, name: room.name, createdAt: room.createdAt },
        settings: room.settings,
        participants: room.participants.map((participant) => participantState(room, participant)),
        round: roundState(room),
        history: [...room.history],
        jira: room.jira,
        self: { participantId: viewer?.id ?? ANONYMOUS_VIEWER_ID, vote: viewer?.vote ?? null },
    });
};

const participantState = (room: Room, participant: ParticipantView): ParticipantState => {
    const common = {
        id: participant.id,
        name: participant.name,
        isFacilitator: participant.id === room.facilitatorId,
        presence: participant.presence,
        hasVoted: participant.vote !== null,
        umbrella: participant.umbrella,
    };
    if (isHuman(participant)) return { ...common, role: participant.role as 'player' | 'spectator' };
    return { ...common, role: 'bot', ownerId: participant.ownerId! };
};

const roundState = (room: Room): RoundState => {
    const base = { id: room.roundId, issueKey: room.currentIssue?.key ?? null };
    if (room.phase === 'revealed') return revealedRoundState(room, base);
    const voting = { ...base, pendingVoterIds: room.pendingVoterIds() };
    if (room.phase === 'countdown' && room.countdown) return { ...voting, phase: 'countdown', ...room.countdown };
    return { ...voting, phase: 'voting' };
};

const revealedRoundState = (room: Room, base: { id: number; issueKey: string | null }): RoundState => {
    const voted = room.participants.filter((participant) => participant.vote !== null);
    return {
        ...base,
        phase: 'revealed',
        revealedAt: room.revealedAt ?? room.createdAt,
        votes: voted
            .filter(isPlayer)
            .map((player) => ({ participantId: player.id, name: player.name, value: player.vote! })),
        kiroGuesses: voted
            .filter((participant) => participant.role === 'bot')
            .map((bot) => ({ participantId: bot.id, name: bot.name, value: bot.vote!, rationale: bot.rationale ?? '' })),
        finalEstimate: room.finalEstimate?.value ?? null,
    };
};
