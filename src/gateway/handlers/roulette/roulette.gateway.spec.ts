import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Ack, PROTOCOL_VERSION, RouletteSpun } from '../../../contracts';
import { GatewayModule } from '../../gateway.module';
import { SocketIoTestClient, socketIoUrl } from '../../testing/socket-io-test-client';
import { rouletteArea } from './index';

@Module({ imports: [GatewayModule.forAreas([rouletteArea])] })
class RouletteGatewayTestModule {}

const NAMES = ['Ana', 'Bia', 'Caio'];
const QUIET_PERIOD_MS = 150;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe('roulette events over a real Socket.IO connection', () => {
    let app: INestApplication;
    const clients: SocketIoTestClient[] = [];

    const connect = async () => {
        const client = await SocketIoTestClient.connect(socketIoUrl(app), {
            auth: { protocolVersion: PROTOCOL_VERSION },
            timeoutMs: 3_000,
        });
        clients.push(client);
        return client;
    };
    const spin = (client: SocketIoTestClient, payload: unknown) =>
        client.emitWithAck('roulette:spin', payload) as Promise<Ack<unknown>>;

    beforeEach(async () => {
        app = await NestFactory.create(RouletteGatewayTestModule, { logger: false });
        await app.listen(0);
    });

    afterEach(async () => {
        await Promise.allSettled(clients.splice(0).map((client) => client.close()));
        await app.close();
    });

    it('answers a socket without a room with a null ack and the leader only in roulette:spun', async () => {
        const caller = await connect();

        const ack = await spin(caller, { mode: 'leader', names: NAMES });
        const spun = (await caller.waitFor('roulette:spun')) as RouletteSpun;

        expect(ack).toEqual({ ok: true, data: null });
        if (!('winner' in spun)) throw new Error('expected a leader result');
        expect(NAMES).toContain(spun.winner);
        expect(spun.cycleRestarted).toBe(false);
    });

    it('returns a permutation of the present names in speaking_order', async () => {
        const caller = await connect();

        await spin(caller, { mode: 'speaking_order', names: NAMES, absent: ['Bia'] });
        const spun = (await caller.waitFor('roulette:spun')) as RouletteSpun;

        if (!('order' in spun)) throw new Error('expected an order result');
        expect([...spun.order].sort()).toEqual(['Ana', 'Caio']);
    });

    it('never sends the result to another socket', async () => {
        const caller = await connect();
        const bystander = await connect();

        await spin(caller, { mode: 'leader', names: NAMES });
        await caller.waitFor('roulette:spun');
        await wait(QUIET_PERIOD_MS);

        expect(bystander.queued('roulette:spun')).toEqual([]);
    });

    it('rejects an invalid payload without sending a result', async () => {
        const caller = await connect();

        const ack = await spin(caller, { mode: 'leader', names: NAMES, absent: NAMES });
        await wait(QUIET_PERIOD_MS);

        expect(ack).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
        expect(caller.queued('roulette:spun')).toEqual([]);
    });

    it('rejects an unknown field in the payload', async () => {
        const caller = await connect();

        const ack = await spin(caller, { mode: 'leader', names: NAMES, extra: true });

        expect(ack).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    });

    it('limits the spins of one socket with rate_limited and retryAfterMs', async () => {
        const caller = await connect();
        const acks: Ack<unknown>[] = [];

        for (let attempt = 0; attempt < 60; attempt += 1) {
            acks.push(await spin(caller, { mode: 'leader', names: NAMES }));
        }

        const limited = acks.find((ack) => !ack.ok);
        expect(limited).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
        expect((limited as { error: { retryAfterMs: number } }).error.retryAfterMs).toBeGreaterThan(0);
    });
});
