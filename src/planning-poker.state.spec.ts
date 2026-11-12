import { PlanningPokerState } from './planning-poker.state';

describe('PlanningPokerState', () => {
    let state: PlanningPokerState;

    beforeEach(() => {
        state = new PlanningPokerState();
    });

    it('lists only the users of the requested room', () => {
        state.join('s1', { id: 'ana', room: 'A' });
        state.join('s2', { id: 'bia', room: 'B' });

        expect(state.usersIn('A')).toEqual([{ id: 'ana', room: 'A' }]);
        expect(state.usersIn('B')).toEqual([{ id: 'bia', room: 'B' }]);
    });

    it('treats numeric and string room identifiers as the same room', () => {
        state.join('s1', { id: 1, room: 10 });

        expect(state.usersIn('10')).toEqual([{ id: 1, room: 10 }]);
    });

    it('keeps a single entry when the same user connects from two sockets', () => {
        state.join('s1', { id: 'ana', room: 'A' });
        state.join('s2', { id: 'ana', room: 'A', name: 'Ana' });

        expect(state.usersIn('A')).toEqual([{ id: 'ana', room: 'A', name: 'Ana' }]);
    });

    it('accepts reveal from any socket of a user connected twice', () => {
        state.join('s1', { id: 'ana', room: 'A' });
        state.join('s2', { id: 'ana', room: 'A' });

        expect(state.setRevealed('s2', true)).toBe('A');
        expect(state.isRevealed('A')).toBe(true);
    });

    it('only reports the last connection when every socket of the user left', () => {
        state.join('s1', { id: 'ana', room: 'A' });
        state.join('s2', { id: 'ana', room: 'A' });

        expect(state.leave('s1')).toEqual({ room: 'A', user: { id: 'ana', room: 'A' }, lastConnection: false });
        expect(state.usersIn('A')).toHaveLength(1);
        expect(state.leave('s2')).toEqual({ room: 'A', user: { id: 'ana', room: 'A' }, lastConnection: true });
        expect(state.usersIn('A')).toEqual([]);
    });

    it('returns undefined when an unknown socket leaves', () => {
        expect(state.leave('unknown')).toBeUndefined();
    });

    it('removes the user from the previous room when the socket joins another room', () => {
        state.join('s1', { id: 'ana', room: 'A' });

        const departure = state.join('s1', { id: 'ana', room: 'B' });

        expect(departure).toEqual({ room: 'A', user: { id: 'ana', room: 'A' }, lastConnection: true });
        expect(state.usersIn('A')).toEqual([]);
        expect(state.usersIn('B')).toEqual([{ id: 'ana', room: 'B' }]);
    });

    it('does not report a departure when the socket logs in again in the same room', () => {
        state.join('s1', { id: 'ana', room: 'A' });

        expect(state.join('s1', { id: 'ana', room: 'A', vote: 3 })).toBeUndefined();
        expect(state.usersIn('A')).toEqual([{ id: 'ana', room: 'A', vote: 3 }]);
    });

    it('updates the user bound to the socket keeping its id and room', () => {
        state.join('s1', { id: 'ana', room: 'A' });
        state.join('s2', { id: 'bia', room: 'A' });

        const updated = state.update('s1', { id: 'bia', room: 'B', vote: 5 });

        expect(updated).toEqual({ id: 'ana', room: 'A', vote: 5 });
        expect(state.usersIn('A')).toEqual([
            { id: 'ana', room: 'A', vote: 5 },
            { id: 'bia', room: 'A' },
        ]);
    });

    it('ignores updates and reveals from sockets without login', () => {
        expect(state.update('unknown', { vote: 1 })).toBeUndefined();
        expect(state.setRevealed('unknown', true)).toBeUndefined();
    });

    it('keeps reveal state per room and resets it once the room is empty', () => {
        state.join('s1', { id: 'ana', room: 'A' });
        state.join('s2', { id: 'bia', room: 'B' });
        state.setRevealed('s1', true);

        expect(state.isRevealed('A')).toBe(true);
        expect(state.isRevealed('B')).toBe(false);

        state.leave('s1');
        state.join('s3', { id: 'ana', room: 'A' });

        expect(state.isRevealed('A')).toBe(false);
    });
});
