import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Clock } from '../domain/clock';
import { CancelTimer, Scheduler } from '../gateway/session/scheduler';
import { RateLimiter } from '../gateway/session/rate-limiter';
import { createKiroMcpServer } from './kiro-mcp-server';
import { KiroSession } from './kiro-session';
import { KiroTableService } from './kiro-table.service';
import {
    MCP_ADDRESS_INITIALIZE_LIMIT,
    MCP_ADDRESS_MAX_LENGTH,
    MCP_CALL_LIMIT,
    MCP_JOIN_ATTEMPT_LIMIT,
    MCP_MAX_BODY_BYTES,
    MCP_MAX_SESSIONS,
    MCP_SESSION_IDLE_MS,
} from './mcp-limits';
export type McpRequest = IncomingMessage;
export type McpResponse = ServerResponse;
interface OpenSession {
    id: string | null;
    readonly session: KiroSession;
    readonly server: McpServer;
    readonly transport: StreamableHTTPServerTransport;
    cancelIdle: CancelTimer;
    released: boolean;
}
const SESSION_HEADER = 'mcp-session-id';
const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const JSON_RPC_SERVER_ERROR = -32000;
const MILLISECONDS_PER_SECOND = 1000;
const NO_OP = () => undefined;
@Injectable()
export class McpSessionHub implements OnModuleDestroy {
    private readonly logger = new Logger(McpSessionHub.name);
    private readonly sessions = new Map<string, OpenSession>();
    private readonly callLimiter: RateLimiter;
    private readonly joinLimiter: RateLimiter;
    private readonly initializeLimiter: RateLimiter;
    private opening = 0;
    constructor(
        private readonly table: KiroTableService,
        private readonly scheduler: Scheduler,
        clock: Clock,
    ) {
        this.callLimiter = new RateLimiter(MCP_CALL_LIMIT, clock);
        this.joinLimiter = new RateLimiter(MCP_JOIN_ATTEMPT_LIMIT, clock);
        this.initializeLimiter = new RateLimiter(MCP_ADDRESS_INITIALIZE_LIMIT, clock);
    }
    get openSessions(): number {
        return this.sessions.size;
    }
    async handle(req: McpRequest, res: McpResponse, body: unknown): Promise<void> {
        if (isTooLarge(req, body)) return reply(res, 413, 'Corpo grande demais');
        const sessionId = headerOf(req, SESSION_HEADER);
        if (sessionId !== undefined) return this.forward(sessionId, req, res, body);
        if (req.method !== 'POST' || !isInitializeRequest(body)) return reply(res, 400, 'Sessão MCP ausente');
        const retryAfterMs = this.initializeLimiter.consume(addressOf(req));
        if (retryAfterMs !== null) return reply(res, 429, 'Muitas tentativas', retryAfterMs);
        if (this.sessions.size + this.opening >= MCP_MAX_SESSIONS) return reply(res, 503, 'Sem vagas no momento');
        await this.open(req, res, body);
    }
    onModuleDestroy(): void {
        [...this.sessions.values()].forEach((open) => this.release(open));
    }
    private async forward(sessionId: string, req: McpRequest, res: McpResponse, body: unknown): Promise<void> {
        const open = this.sessions.get(sessionId);
        if (!open) return reply(res, 404, 'Sessão MCP não encontrada');
        this.touch(open);
        await open.transport.handleRequest(req, res, body);
    }
    private async open(req: McpRequest, res: McpResponse, body: unknown): Promise<void> {
        this.opening += 1;
        const session = new KiroSession();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (id) => this.register(id, open),
        });
        const server = createKiroMcpServer(this.table, session, {
            admit: (tool) => this.admit(open, tool === 'join_table'),
        });
        const open: OpenSession = { id: null, session, server, transport, cancelIdle: NO_OP, released: false };
        transport.onclose = () => this.release(open);
        session.onClose(() => {
            this.scheduler.after(0, () => this.release(open));
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } finally {
            this.opening -= 1;
            if (open.id === null) this.release(open);
        }
    }
    private register(id: string, open: OpenSession): void {
        open.id = id;
        this.sessions.set(id, open);
        this.touch(open);
    }
    private admit(open: OpenSession, isJoin: boolean): number | null {
        const key = open.id ?? '';
        const waits = [this.callLimiter.consume(key), isJoin ? this.joinLimiter.consume(key) : null];
        const blocked = waits.filter((wait): wait is number => wait !== null);
        return blocked.length > 0 ? Math.max(...blocked) : null;
    }
    private touch(open: OpenSession): void {
        open.cancelIdle();
        open.cancelIdle = this.scheduler.after(MCP_SESSION_IDLE_MS, () => this.release(open));
    }
    private release(open: OpenSession): void {
        if (open.released) return;
        open.released = true;
        open.cancelIdle();
        if (open.id !== null) {
            this.sessions.delete(open.id);
            this.callLimiter.release(open.id);
            this.joinLimiter.release(open.id);
        }
        this.leaveSeat(open.session);
        void open.server.close().catch(() => this.logger.warn('failed to close an MCP session cleanly'));
    }
    private leaveSeat(session: KiroSession): void {
        try {
            if (session.seat && !session.isClosed) this.table.leave(session);
        } catch {
            this.logger.warn('could not free a Kiro seat while closing the session');
        } finally {
            session.close();
        }
    }
}
const headerOf = (req: McpRequest, name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
};
const addressOf = (req: McpRequest): string => {
    const forwarded = headerOf(req, FORWARDED_FOR_HEADER)?.split(',').pop()?.trim();
    return (forwarded || req.socket.remoteAddress || 'unknown').slice(0, MCP_ADDRESS_MAX_LENGTH);
};
const isTooLarge = (req: McpRequest, body: unknown): boolean => {
    const declared = Number(headerOf(req, 'content-length'));
    if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) return true;
    return body !== undefined && Buffer.byteLength(JSON.stringify(body) ?? '') > MCP_MAX_BODY_BYTES;
};
const reply = (res: McpResponse, status: number, message: string, retryAfterMs?: number): void => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    if (retryAfterMs !== undefined) res.setHeader('Retry-After', Math.ceil(retryAfterMs / MILLISECONDS_PER_SECOND));
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: JSON_RPC_SERVER_ERROR, message }, id: null }));
};
