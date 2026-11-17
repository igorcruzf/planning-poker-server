import { gatewayOptions } from './gateway.options';

describe('gatewayOptions', () => {
    const originalCorsOrigin = process.env.CORS_ORIGIN;

    afterEach(() => {
        if (originalCorsOrigin === undefined) {
            delete process.env.CORS_ORIGIN;
        } else {
            process.env.CORS_ORIGIN = originalCorsOrigin;
        }
    });

    it('allows the default front origin when CORS_ORIGIN is not set', () => {
        delete process.env.CORS_ORIGIN;

        expect(gatewayOptions().cors).toEqual({ origin: 'https://yak-planning-poker.onrender.com' });
    });

    it('allows the origins configured in CORS_ORIGIN', () => {
        process.env.CORS_ORIGIN = 'http://localhost:5173, http://localhost:5174';

        expect(gatewayOptions().cors).toEqual({ origin: ['http://localhost:5173', 'http://localhost:5174'] });
    });

    it('limits each message to 16 KB', () => {
        expect(gatewayOptions().maxHttpBufferSize).toBe(16 * 1024);
    });
});
