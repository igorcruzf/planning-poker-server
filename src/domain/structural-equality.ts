const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const definedKeys = (record: Record<string, unknown>): string[] =>
    Object.keys(record).filter((key) => record[key] !== undefined);

export const isStructurallyEqual = (left: unknown, right: unknown): boolean => {
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((item, index) => isStructurallyEqual(item, right[index]))
        );
    }
    if (!isRecord(left) || !isRecord(right)) return left === right;
    const keys = definedKeys(left);
    return keys.length === definedKeys(right).length && keys.every((key) => isStructurallyEqual(left[key], right[key]));
};
