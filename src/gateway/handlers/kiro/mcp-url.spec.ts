import { MCP_PATH, MCP_PRODUCTION_URL } from '../../../contracts';
import { resolveMcpUrl } from './mcp-url';
describe('resolveMcpUrl', () => {
    it('uses the production url when PUBLIC_BASE_URL is not set', () => {
        expect(resolveMcpUrl({})).toBe(MCP_PRODUCTION_URL);
        expect(resolveMcpUrl({ PUBLIC_BASE_URL: '   ' })).toBe(MCP_PRODUCTION_URL);
    });
    it('appends the mcp path to PUBLIC_BASE_URL', () => {
        expect(resolveMcpUrl({ PUBLIC_BASE_URL: 'http://localhost:3001' })).toBe(`http://localhost:3001${MCP_PATH}`);
        expect(resolveMcpUrl({ PUBLIC_BASE_URL: 'https://poker.example.com/' })).toBe(
            `https://poker.example.com${MCP_PATH}`,
        );
    });
    it.each(['not a url', 'javascript:alert(1)', 'https://user:pass@example.com', 'ftp://example.com'])(
        'rejects the invalid PUBLIC_BASE_URL %s',
        (value) => {
            expect(() => resolveMcpUrl({ PUBLIC_BASE_URL: value })).toThrow('PUBLIC_BASE_URL');
        },
    );
});
