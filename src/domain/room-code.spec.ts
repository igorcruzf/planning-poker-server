import { ROOM_CODE_SUFFIX_ALPHABET, ROOM_CODE_SUFFIX_LENGTH, roomCodeSchema } from '../contracts';
import { RandomRoomCodeGenerator } from './room-code';

describe('RandomRoomCodeGenerator', () => {
    const generator = new RandomRoomCodeGenerator();

    it('generates codes accepted by the room code contract', () => {
        for (let attempt = 0; attempt < 200; attempt++) {
            expect(roomCodeSchema.safeParse(generator.generate()).success).toBe(true);
        }
    });

    it('uses the prefix, the 8-symbol suffix and only the contract alphabet', () => {
        const code = generator.generate();
        const suffix = code.slice('yak-'.length);
        expect(code.startsWith('yak-')).toBe(true);
        expect(suffix).toHaveLength(ROOM_CODE_SUFFIX_LENGTH);
        expect([...suffix].every((symbol) => ROOM_CODE_SUFFIX_ALPHABET.includes(symbol))).toBe(true);
    });

    it('does not repeat codes in a large sample', () => {
        const codes = new Set(Array.from({ length: 2000 }, () => generator.generate()));
        expect(codes.size).toBe(2000);
    });
});
