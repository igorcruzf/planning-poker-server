import { relative } from 'path';
import { CONTRACTS_DIR, contractFiles, readContract } from './contract-files';

const SEPARATOR = '[\\s_-]*';
const isolatedWords = (...words: string[]) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${words.join(SEPARATOR)}(?![\\p{L}\\p{N}])`, 'iu');

const POKER_HAND_NAMES: [string, RegExp][] = [
    ['royal flush', isolatedWords('royal', 'flush')],
    ['full house', isolatedWords('full', 'house')],
    ['quadra', isolatedWords('quadra')],
    ['trinca', isolatedWords('trinca')],
    ['dois pares', isolatedWords('dois', 'pares')],
    ['carta alta', isolatedWords('carta', 'alta')],
    ['par', isolatedWords('par')],
];

const splitCamelCase = (text: string) => text.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');

const pokerHandNamesIn = (text: string) =>
    POKER_HAND_NAMES.filter(([, pattern]) => pattern.test(splitCamelCase(text))).map(([name]) => name);

describe('errata E1 detector', () => {
    it.each(['Full House', 'fullHouse', 'FULL_HOUSE', 'royal-flush', 'Dois Pares', 'um par', 'isPar', 'Quadra', 'trinca', 'Carta Alta'])(
        'finds %p',
        (text) => {
            expect(pokerHandNamesIn(text)).not.toEqual([]);
        },
    );

    it.each(['parse', 'participant', 'PARTICIPANT_ID', 'para', 'quadrado', 'parcelas', 'comparar', 'cartas', 'alta'])(
        'ignores %p',
        (text) => {
            expect(pokerHandNamesIn(text)).toEqual([]);
        },
    );
});

describe('errata E1 in the contracts', () => {
    it('has contract files to check', () => {
        expect(contractFiles().length).toBeGreaterThan(0);
    });

    it.each(contractFiles().map((file) => [relative(CONTRACTS_DIR, file), file]))(
        '%s has no poker hand name',
        (_name, file) => {
            expect(pokerHandNamesIn(readContract(file))).toEqual([]);
        },
    );
});
