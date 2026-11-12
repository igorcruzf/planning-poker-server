import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'net';
import { AppModule } from '../app.module';

describe('HealthController', () => {
    let app: INestApplication;

    beforeAll(async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0, '127.0.0.1');
    });

    afterAll(async () => {
        await app.close();
    });

    it('responds with status ok and no-store cache policy on GET /health', async () => {
        const { port } = app.getHttpServer().address() as AddressInfo;

        const res = await fetch(`http://127.0.0.1:${port}/health`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});
