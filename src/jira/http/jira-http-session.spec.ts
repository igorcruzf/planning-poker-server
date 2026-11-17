import { JIRA_SESSION_HEADER } from '../../contracts';
import { createJiraCall } from '../api/jira-call';
import { JiraAppException } from '../auth/jira-app.exception';
import { applyJiraSessionHeaders, openJiraCall } from './jira-http-session';

describe('openJiraCall', () => {
    it('opens a call with the blob of the Authorization header', () => {
        expect(openJiraCall('Bearer abc_DEF-1')).toEqual({ blob: 'abc_DEF-1' });
    });

    it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer inválido!'])(
        'asks to reconnect for the header %p',
        (header) => {
            expect(() => openJiraCall(header)).toThrow(JiraAppException);
            try {
                openJiraCall(header);
            } catch (error) {
                expect((error as JiraAppException).error).toEqual({ code: 'jira_reconnect_required' });
            }
        },
    );
});

describe('applyJiraSessionHeaders', () => {
    const response = () => {
        const headers: Record<string, string> = {};
        return { headers, setHeader: (name: string, value: string) => void (headers[name] = value) };
    };

    it('sets no-store always', () => {
        const target = response();

        applyJiraSessionHeaders(target, createJiraCall('blob-1'));

        expect(target.headers).toEqual({ 'Cache-Control': 'no-store' });
    });

    it('returns the rotated blob in X-Yak-Jira-Session', () => {
        const target = response();
        const call = createJiraCall('blob-1');
        call.refreshedBlob = 'blob-2';

        applyJiraSessionHeaders(target, call);

        expect(target.headers).toEqual({ 'Cache-Control': 'no-store', [JIRA_SESSION_HEADER]: 'blob-2' });
    });
});
