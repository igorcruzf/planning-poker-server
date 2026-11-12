import { clearVote, HIDDEN_VOTE, hideVote } from './vote';

describe('vote', () => {
    it('replaces an existing vote with the hidden marker', () => {
        expect(hideVote({ id: 'ana', room: 'A', votedValue: 'G' })).toEqual({
            id: 'ana',
            room: 'A',
            votedValue: HIDDEN_VOTE,
        });
    });

    it('keeps users without vote unchanged so the front still sees them as pending', () => {
        expect(hideVote({ id: 'ana', room: 'A', votedValue: '' })).toEqual({ id: 'ana', room: 'A', votedValue: '' });
        expect(hideVote({ id: 'ana', room: 'A' })).toEqual({ id: 'ana', room: 'A' });
    });

    it('does not mutate the original user', () => {
        const user = { id: 'ana', room: 'A', votedValue: 'G' };

        hideVote(user);
        clearVote(user);

        expect(user.votedValue).toBe('G');
    });

    it('clears the vote', () => {
        expect(clearVote({ id: 'ana', room: 'A', votedValue: 'M' })).toEqual({ id: 'ana', room: 'A', votedValue: '' });
    });
});
