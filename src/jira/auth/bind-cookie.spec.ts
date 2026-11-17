import { clearBindCookie, readBindCookie, serializeBindCookie } from './bind-cookie';

const BIND = 'A'.repeat(43);

describe('bind cookie', () => {
    it('serializes a restricted, short-lived cookie scoped to the Jira auth routes', () => {
        expect(serializeBindCookie(BIND, true)).toBe(
            `yak_jira_bind=${BIND}; Path=/api/auth/jira; Max-Age=600; HttpOnly; SameSite=Lax; Secure`,
        );
        expect(serializeBindCookie(BIND, false)).not.toContain('Secure');
    });

    it('clears the cookie with the same scope', () => {
        expect(clearBindCookie(true)).toBe(
            'yak_jira_bind=; Path=/api/auth/jira; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
        );
    });

    it('reads the value among other cookies', () => {
        expect(readBindCookie(`a=1; yak_jira_bind=${BIND}; b=2`)).toBe(BIND);
    });

    it.each([undefined, '', 'a=1', 'yak_jira_bind=', 'yak_jira_bind=curto', `yak_jira_bind=${'A'.repeat(44)}`])(
        'ignores a missing or malformed cookie %p',
        (header) => {
            expect(readBindCookie(header)).toBeUndefined();
        },
    );

    it('ignores an oversized cookie header', () => {
        expect(readBindCookie(`x=${'a'.repeat(5000)}; yak_jira_bind=${BIND}`)).toBeUndefined();
    });
});
