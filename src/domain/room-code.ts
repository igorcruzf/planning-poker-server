import { randomInt } from 'node:crypto';
import { ROOM_CODE_PREFIX, ROOM_CODE_SUFFIX_ALPHABET, ROOM_CODE_SUFFIX_LENGTH } from '../contracts';

export abstract class RoomCodeGenerator {
    abstract generate(): string;
}

export class RandomRoomCodeGenerator extends RoomCodeGenerator {
    generate(): string {
        const suffix = Array.from(
            { length: ROOM_CODE_SUFFIX_LENGTH },
            () => ROOM_CODE_SUFFIX_ALPHABET[randomInt(ROOM_CODE_SUFFIX_ALPHABET.length)],
        );
        return `${ROOM_CODE_PREFIX}${suffix.join('')}`;
    }
}
