import { buildResultComment, toAdfDocument } from './jira-comment';

describe('buildResultComment', () => {
    it('builds the E1 text with the size meaning, votes, consensus and the Kiro guess', () => {
        const text = buildResultComment({
            size: 'M',
            meaning: 'até 10 dias',
            votes: [
                { value: 'M', count: 5 },
                { value: 'G', count: 1 },
                { value: 'P', count: 1 },
            ],
            consensusPercent: 71,
            kiroGuess: 'M',
        });

        expect(text).toBe(
            'YakPoker · Size definido: M (até 10 dias) · Votos: M ×5, G ×1, P ×1 · Consenso 71% · Palpite do Kiro: M',
        );
    });

    it('omits the meaning and the Kiro guess when absent', () => {
        const text = buildResultComment({
            size: '5',
            votes: [{ value: '5', count: 3 }],
            consensusPercent: 100,
        });

        expect(text).toBe('YakPoker · Size definido: 5 · Votos: 5 ×3 · Consenso 100%');
    });

    it('never names a poker hand', () => {
        const text = buildResultComment({ size: 'M', votes: [{ value: 'M', count: 2 }], consensusPercent: 100 });

        expect(text).not.toMatch(/full house|flush|quadra|trinca|par\b/i);
    });
});

describe('toAdfDocument', () => {
    it('wraps the text in a single paragraph', () => {
        expect(toAdfDocument('olá')).toEqual({
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'olá' }] }],
        });
    });
});
