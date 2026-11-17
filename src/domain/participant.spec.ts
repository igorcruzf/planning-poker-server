import { isReservedForKiro, nameSkeleton } from './participant';

const FORGED_NAMES: Readonly<Record<string, string>> = {
    plain: 'Kiro do Ana',
    'combining acute': 'Kiro\u0301 do Ana',
    'precomposed diaeresis': 'K\u00efro do Ana',
    'hangul filler': 'Kiro\u3164do Ana',
    'hangul choseong filler': 'Kiro\u115fdo Ana',
    'hangul jungseong filler': 'Kiro\u1160do Ana',
    'dotless i': 'Ki\u0131ro do Ana',
    'dotted capital i': 'K\u0130ro do Ana',
    'cyrillic o': 'Kiro d\u043e Ana',
    'greek iota': 'K\u03b9ro do Ana',
    'greek omicron': 'Kir\u03bf do Ana',
    kra: '\u0138iro do Ana',
    'kelvin sign': '\u212airo do Ana',
    'combining grapheme joiner': 'Kiro\u034f do Ana',
    'zero width joiner': 'Kiro\u200d do Ana',
    'variation selector': 'Kiro\ufe0f do Ana',
    'braille blank': 'Kiro\u2800do Ana',
    'no-break space': 'Kiro\u00a0do Ana',
    'ideographic space': 'Kiro\u3000do Ana',
    'soft hyphen': 'Ki\u00adro do Ana',
    'mongolian vowel separator': 'Kiro\u180edo Ana',
    'full width letters': '\uff2b\uff49\uff52\uff4f do Ana',
};

describe('Reserved Kiro prefix', () => {
    it.each(Object.entries(FORGED_NAMES))('refuses %s', (_label, name) => {
        expect(isReservedForKiro(name)).toBe(true);
    });

    it.each(['Kiroto', 'Kira do Ana', 'Jose', 'José', 'Kiko do Ana', 'Do Kiro'])('accepts %s', (name) => {
        expect(isReservedForKiro(name)).toBe(false);
    });
});

describe('Name skeleton used for uniqueness', () => {
    it('keeps accented names distinct from their plain counterparts', () => {
        expect(nameSkeleton('José')).not.toBe(nameSkeleton('Jose'));
    });

    it('still folds case, width and invisible characters', () => {
        expect(nameSkeleton('J o\u200bsé')).toBe(nameSkeleton('JOSÉ'));
    });
});
