import { isStructurallyEqual } from './structural-equality';

describe('isStructurallyEqual', () => {
    it('ignores the order of the keys but respects the order of arrays', () => {
        expect(isStructurallyEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
        expect(isStructurallyEqual([1, 2], [2, 1])).toBe(false);
    });

    it('treats an undefined property as absent', () => {
        expect(isStructurallyEqual({ value: 'P', meaning: undefined }, { value: 'P' })).toBe(true);
    });

    it('detects different values, different keys and different shapes', () => {
        expect(isStructurallyEqual({ a: 1 }, { a: 2 })).toBe(false);
        expect(isStructurallyEqual({ a: 1 }, { b: 1 })).toBe(false);
        expect(isStructurallyEqual({ a: 1 }, { a: 1, b: 1 })).toBe(false);
        expect(isStructurallyEqual([], {})).toBe(false);
        expect(isStructurallyEqual(null, {})).toBe(false);
        expect(isStructurallyEqual('P', 'P')).toBe(true);
    });
});
