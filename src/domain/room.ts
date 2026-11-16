import { randomBytes } from 'node:crypto';
import {
    CardState,
    DISCONNECTED_PLAYER_GRACE_MS,
    HistoryEntry,
    HumanRole,
    JiraRoomState,
    KIRO_MAX_PER_OWNER,
    KIRO_MAX_PER_ROOM,
    KIRO_RATIONALE_MAX_LENGTH,
    KIRO_SEAT_NAME_PREFIX,
    ROOM_IDLE_TTL_MS,
    RoomCreatePayload,
    RoomJoinPayload,
    RoomSettings,
    roomSettingsPatchSchema,
    RoomSettingsPatch,
    RoundPhase,
} from '../contracts';
import { Clock } from './clock';
import { findDeckCard, isVoteAllowed } from './deck-rules';
import { DomainError, domainErrors } from './domain-error';
import { KiroInviteBook } from './kiro-invite-book';
import { isHuman, isPlayer, normalizeName, Participant } from './participant';
import { generateSecret, hashSecret, secretMatchesHash } from './secrets';

export interface RoomDependencies {
    readonly clock: Clock;
    readonly serverInstanceId: string;
}

export type JoinRequest = Pick<RoomJoinPayload, 'name' | 'role' | 'sessionToken'>;
export type CurrentIssue = { key: string; summary: string };
export type RoundTarget = { roundId: number };
export type RevealRequest = RoundTarget & { confirmMissingVotes: boolean };
export type VoteRequest = RoundTarget & { value: string | null };
export type FinalizeRequest = RoundTarget & { value: string };
export type PhaseOutcome = { phase: RoundPhase };

const PARTICIPANT_ID_BYTES = 9;
const PARTICIPANT_ID_PREFIX = 'p-';

export class Room {
    readonly createdAt: number;
    readonly name: string;
    private _settings: RoomSettings;
    private readonly roster: Participant[] = [];
    private readonly invites = new KiroInviteBook();
    private _facilitatorId: string | null = null;
    private _roundId = 1;
    private _phase: RoundPhase = 'voting';
    private _countdown: { revealAt: number; countdownMs: number } | null = null;
    private _revealedAt: number | null = null;
    private _finalEstimate: CardState | null = null;
    private _history: HistoryEntry[] = [];
    private _currentIssue: CurrentIssue | null = null;
    private _jira: JiraRoomState | null = null;
    private _emptiedAt: number | null = null;

    constructor(
        private readonly dependencies: RoomDependencies,
        readonly code: string,
        payload: Pick<RoomCreatePayload, 'roomName' | 'settings'>,
    ) {
        this.name = payload.roomName;
        this._settings = structuredClone(payload.settings);
        this.createdAt = dependencies.clock.now();
    }

    get serverInstanceId(): string {
        return this.dependencies.serverInstanceId;
    }

    get settings(): RoomSettings {
        return this._settings;
    }

    get participants(): readonly Participant[] {
        return this.roster;
    }

    get facilitatorId(): string | null {
        return this._facilitatorId;
    }

    get roundId(): number {
        return this._roundId;
    }

    get phase(): RoundPhase {
        return this._phase;
    }

    get countdown(): { revealAt: number; countdownMs: number } | null {
        return this._countdown;
    }

    get revealedAt(): number | null {
        return this._revealedAt;
    }

    get finalEstimate(): CardState | null {
        return this._finalEstimate;
    }

    get history(): readonly HistoryEntry[] {
        return this._history;
    }

    get currentIssue(): CurrentIssue | null {
        return this._currentIssue;
    }

    get jira(): JiraRoomState | null {
        return this._jira;
    }

    get emptiedAt(): number | null {
        return this._emptiedAt;
    }

    isExpired(now: number): boolean {
        return this._emptiedAt !== null && now - this._emptiedAt >= ROOM_IDLE_TTL_MS;
    }

    findParticipant(participantId: string): Participant | undefined {
        return this.roster.find((participant) => participant.id === participantId);
    }

    requireParticipant(participantId: string): Participant {
        const participant = this.findParticipant(participantId);
        if (!participant) throw domainErrors.forbidden('not_in_room');
        return participant;
    }

    join(request: JoinRequest): { participantId: string; sessionToken: string } {
        if (request.sessionToken !== undefined) return this.reconnect(request.sessionToken);
        if (request.role === 'spectator' && !this._settings.allowSpectators) throw domainErrors.spectatorsDisabled();
        this.assertNameAvailable(request.name);
        const sessionToken = generateSecret();
        const participant = this.seat({ name: request.name, role: request.role, tokenHash: hashSecret(sessionToken) });
        this._facilitatorId ??= participant.id;
        this.refreshOccupancy();
        return { participantId: participant.id, sessionToken };
    }

    markConnected(participantId: string): void {
        const participant = this.requireParticipant(participantId);
        participant.presence = 'connected';
        participant.disconnectedAt = null;
        this.refreshOccupancy();
    }

    markDisconnected(participantId: string): void {
        const participant = this.requireParticipant(participantId);
        participant.presence = 'disconnected';
        participant.disconnectedAt = this.dependencies.clock.now();
        this.refreshOccupancy();
    }

    leave(participantId: string): void {
        const leaving = this.requireParticipant(participantId);
        this.removeParticipant(leaving);
        if (isHuman(leaving)) {
            this.roster.filter((seat) => seat.ownerId === leaving.id).forEach((seat) => this.removeParticipant(seat));
            this.invites.discardOwner(leaving.id);
        }
        if (this._facilitatorId === leaving.id) this._facilitatorId = this.nextFacilitatorId();
        this.refreshOccupancy();
    }

    setRole(participantId: string, role: HumanRole): void {
        const participant = this.requireHuman(participantId);
        if (participant.role === role) return;
        if (role === 'spectator' && !this._settings.allowSpectators) throw domainErrors.spectatorsDisabled();
        participant.role = role;
        if (role === 'spectator') participant.vote = null;
    }

    transferFacilitator(actorId: string, targetId: string): void {
        this.requireFacilitator(actorId);
        const target = this.findParticipant(targetId);
        if (!target || !isHuman(target)) throw domainErrors.invalidTarget();
        this._facilitatorId = target.id;
    }

    updateSettings(actorId: string, patch: RoomSettingsPatch): void {
        this.requireFacilitator(actorId);
        const parsed = roomSettingsPatchSchema.safeParse(patch);
        if (!parsed.success) throw this.invalidSettings();
        this._settings = { ...this._settings, ...structuredClone(parsed.data) };
        this.roster
            .filter((participant) => participant.vote !== null && !isVoteAllowed(this._settings, participant.vote))
            .forEach((participant) => this.clearVote(participant));
    }

    setCurrentIssue(actorId: string, issue: CurrentIssue | null): void {
        this.requireFacilitator(actorId);
        this._currentIssue = issue ? { ...issue } : null;
    }

    setJiraState(jira: JiraRoomState | null): void {
        this._jira = jira ? structuredClone(jira) : null;
    }

    pendingVoterIds(): string[] {
        const now = this.dependencies.clock.now();
        return this.roster
            .filter(isPlayer)
            .filter((player) => player.vote === null && this.countsAsPresent(player, now))
            .map((player) => player.id);
    }

    vote(actorId: string, request: VoteRequest): PhaseOutcome {
        const actor = this.requirePlayer(actorId);
        this.assertCurrentRound(request.roundId);
        this.assertPhase('voting');
        if (request.value !== null && !isVoteAllowed(this._settings, request.value)) throw domainErrors.invalidVote();
        actor.vote = request.value;
        if (request.value !== null && this._settings.autoReveal && this.pendingVoterIds().length === 0) {
            return this.beginReveal();
        }
        return { phase: this._phase };
    }

    reveal(actorId: string, request: RevealRequest): PhaseOutcome {
        const actor = this.requirePlayer(actorId);
        this.assertCurrentRound(request.roundId);
        if (this._phase !== 'voting') return { phase: this._phase };
        const pending = this.pendingVoterIds();
        if (pending.length > 0) {
            if (actor.id !== this._facilitatorId) throw domainErrors.forbidden('facilitator_only');
            if (!request.confirmMissingVotes) throw domainErrors.votesPending(this.namedParticipants(pending));
        }
        return this.beginReveal();
    }

    finishCountdown(roundId: number): PhaseOutcome {
        if (roundId !== this._roundId || this._phase !== 'countdown') return { phase: this._phase };
        return this.finishReveal();
    }

    reset(actorId: string, request: RoundTarget): void {
        this.requirePlayer(actorId);
        this.assertCurrentRound(request.roundId);
        this.roster.forEach((participant) => this.clearVote(participant));
        this._roundId += 1;
        this._phase = 'voting';
        this._countdown = null;
        this._revealedAt = null;
        this._finalEstimate = null;
    }

    finalize(actorId: string, request: FinalizeRequest): void {
        this.requireFacilitator(actorId);
        this.assertCurrentRound(request.roundId);
        this.assertPhase('revealed');
        const card = findDeckCard(this._settings, request.value);
        if (!card) throw domainErrors.invalidVote();
        this._finalEstimate = structuredClone(card);
        this._history = this._history.map((entry) =>
            entry.roundId === this._roundId ? { ...entry, finalEstimate: structuredClone(card) } : entry,
        );
    }

    createKiroInvite(ownerId: string): { inviteCode: string; expiresAt: number } {
        const owner = this.requireHuman(ownerId);
        if (!this._settings.allowKiro) throw domainErrors.kiroDisabled();
        this.assertKiroSeatAvailable(owner.id);
        return this.invites.issue(owner.id, this.dependencies.clock.now());
    }

    hasKiroInvite(inviteCode: string): boolean {
        return this.invites.ownerOf(inviteCode, this.dependencies.clock.now()) !== null;
    }

    redeemKiroInvite(inviteCode: string): { participantId: string; seatName: string } {
        const ownerId = this.invites.ownerOf(inviteCode, this.dependencies.clock.now());
        const owner = ownerId === null ? undefined : this.findParticipant(ownerId);
        if (!owner) throw domainErrors.inviteInvalid();
        if (!this._settings.allowKiro) throw domainErrors.kiroDisabled();
        this.assertKiroSeatAvailable(owner.id);
        const seatName = `${KIRO_SEAT_NAME_PREFIX}${owner.name}`;
        this.assertNameAvailable(seatName);
        const seat = this.seat({ name: seatName, role: 'bot', ownerId: owner.id });
        this.invites.consume(inviteCode);
        return { participantId: seat.id, seatName };
    }

    castKiroVote(botId: string, request: { value: string; rationale: string }): PhaseOutcome {
        const bot = this.findParticipant(botId);
        if (!bot || bot.role !== 'bot') throw domainErrors.forbidden('not_in_room');
        this.assertPhase('voting');
        if (!isVoteAllowed(this._settings, request.value)) throw domainErrors.invalidVote();
        const rationale = request.rationale.trim();
        if (rationale.length === 0 || rationale.length > KIRO_RATIONALE_MAX_LENGTH) throw this.invalidRationale();
        bot.vote = request.value;
        bot.rationale = rationale;
        return { phase: this._phase };
    }

    private reconnect(sessionToken: string): { participantId: string; sessionToken: string } {
        const participant = this.roster.find(
            (candidate) => candidate.tokenHash !== null && secretMatchesHash(sessionToken, candidate.tokenHash),
        );
        if (!participant) throw domainErrors.sessionTokenInvalid();
        this.markConnected(participant.id);
        return { participantId: participant.id, sessionToken };
    }

    private seat(details: Pick<Participant, 'name' | 'role'> & Partial<Pick<Participant, 'ownerId' | 'tokenHash'>>) {
        const participant: Participant = {
            id: `${PARTICIPANT_ID_PREFIX}${randomBytes(PARTICIPANT_ID_BYTES).toString('base64url')}`,
            ownerId: details.ownerId ?? null,
            tokenHash: details.tokenHash ?? null,
            name: details.name,
            role: details.role,
            presence: 'connected',
            disconnectedAt: null,
            vote: null,
            rationale: null,
            umbrella: false,
        };
        this.roster.push(participant);
        return participant;
    }

    private removeParticipant(participant: Participant): void {
        this.roster.splice(this.roster.indexOf(participant), 1);
    }

    private assertNameAvailable(name: string): void {
        const wanted = normalizeName(name);
        if (this.roster.some((participant) => normalizeName(participant.name) === wanted)) {
            throw domainErrors.nameTaken();
        }
    }

    private assertKiroSeatAvailable(ownerId: string): void {
        const seats = this.roster.filter((participant) => participant.role === 'bot');
        if (seats.filter((seat) => seat.ownerId === ownerId).length >= KIRO_MAX_PER_OWNER) {
            throw domainErrors.kiroLimitPerOwner();
        }
        if (seats.length >= KIRO_MAX_PER_ROOM) throw domainErrors.kiroLimitPerRoom();
    }

    private requireHuman(participantId: string): Participant {
        const participant = this.requireParticipant(participantId);
        if (!isHuman(participant)) throw domainErrors.forbidden('not_in_room');
        return participant;
    }

    private requirePlayer(participantId: string): Participant {
        const participant = this.requireParticipant(participantId);
        if (!isPlayer(participant)) throw domainErrors.forbidden('players_only');
        return participant;
    }

    private requireFacilitator(participantId: string): void {
        this.requireParticipant(participantId);
        if (participantId !== this._facilitatorId) throw domainErrors.forbidden('facilitator_only');
    }

    private assertCurrentRound(roundId: number): void {
        if (roundId !== this._roundId) throw domainErrors.roundStale();
    }

    private assertPhase(expected: RoundPhase): void {
        if (this._phase !== expected) throw domainErrors.wrongPhase(this._phase);
    }

    private countsAsPresent(player: Participant, now: number): boolean {
        return (
            player.presence === 'connected' ||
            (player.disconnectedAt !== null && now - player.disconnectedAt < DISCONNECTED_PLAYER_GRACE_MS)
        );
    }

    private namedParticipants(participantIds: string[]) {
        return participantIds.map((participantId) => ({
            participantId,
            name: this.requireParticipant(participantId).name,
        }));
    }

    private beginReveal(): PhaseOutcome {
        const countdownMs = this._settings.countdownSeconds * 1000;
        if (countdownMs === 0) return this.finishReveal();
        this._phase = 'countdown';
        this._countdown = { revealAt: this.dependencies.clock.now() + countdownMs, countdownMs };
        return { phase: this._phase };
    }

    private finishReveal(): PhaseOutcome {
        this._phase = 'revealed';
        this._countdown = null;
        this._revealedAt = this.dependencies.clock.now();
        this._history = [...this._history, this.historyEntry(this._revealedAt)];
        return { phase: this._phase };
    }

    private historyEntry(revealedAt: number): HistoryEntry {
        const named = (participants: Participant[]) =>
            participants.map((participant) => ({ name: participant.name, value: participant.vote! }));
        const voted = this.roster.filter((participant) => participant.vote !== null);
        return {
            roundId: this._roundId,
            issue: this._currentIssue ? { ...this._currentIssue } : null,
            finalEstimate: null,
            votes: named(voted.filter(isPlayer)),
            kiroGuesses: named(voted.filter((participant) => participant.role === 'bot')),
            kiroCountedAsPlayer: this._settings.kiroCountsAsPlayer,
            revealedAt,
        };
    }

    private clearVote(participant: Participant): void {
        participant.vote = null;
        participant.rationale = null;
    }

    private nextFacilitatorId(): string | null {
        const humans = this.roster.filter(isHuman);
        return (humans.find((human) => human.presence === 'connected') ?? humans[0])?.id ?? null;
    }

    private refreshOccupancy(): void {
        const occupied = this.roster.some((participant) => isHuman(participant) && participant.presence === 'connected');
        this._emptiedAt = occupied ? null : (this._emptiedAt ?? this.dependencies.clock.now());
    }

    private invalidSettings(): DomainError {
        return new DomainError({ code: 'invalid_payload', issues: [{ path: 'settings', message: 'invalid_settings' }] });
    }

    private invalidRationale(): DomainError {
        return new DomainError({ code: 'invalid_payload', issues: [{ path: 'rationale', message: 'invalid_rationale' }] });
    }
}
