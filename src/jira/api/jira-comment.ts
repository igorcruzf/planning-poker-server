export interface JiraAdfDocument {
    type: 'doc';
    version: 1;
    content: { type: 'paragraph'; content: { type: 'text'; text: string }[] }[];
}

export const toAdfDocument = (text: string): JiraAdfDocument => ({
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

export interface JiraResultComment {
    size: string;
    meaning?: string;
    votes: { value: string; count: number }[];
    consensusPercent: number;
    kiroGuess?: string;
}

export const buildResultComment = ({ size, meaning, votes, consensusPercent, kiroGuess }: JiraResultComment): string =>
    [
        'YakPoker',
        `Size definido: ${size}${meaning ? ` (${meaning})` : ''}`,
        `Votos: ${votes.map(({ value, count }) => `${value} ×${count}`).join(', ')}`,
        `Consenso ${consensusPercent}%`,
        ...(kiroGuess ? [`Palpite do Kiro: ${kiroGuess}`] : []),
    ].join(' · ');
