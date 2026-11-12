import { describeError } from './describe-error';

describe('describeError', () => {
    it('keeps the error name and stack frames but drops the message', () => {
        const error = new TypeError('vote secret-value is invalid');

        const description = describeError(error);

        expect(description).toMatch(/^TypeError\n\s+at /);
        expect(description).toContain('describe-error.spec.ts');
        expect(description).not.toContain('secret-value');
    });

    it('drops every line of a multi-line message', () => {
        const error = new Error('first secret-line\nsecond secret-line');

        expect(describeError(error)).not.toContain('secret-line');
    });

    it('uses only the name when the error has no stack', () => {
        const error = new RangeError('secret-value');
        error.stack = undefined;

        expect(describeError(error)).toBe('RangeError');
    });

    it('does not reveal a thrown value that is not an Error', () => {
        expect(describeError('secret-value')).toBe('Non-error value of type string');
        expect(describeError({ token: 'secret-value' })).toBe('Non-error value of type object');
    });
});
