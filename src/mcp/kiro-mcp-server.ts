import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError, KIRO_TOOLS, KiroToolName } from '../contracts';
import { DomainError, domainErrors } from '../domain/domain-error';
import { KiroSession } from './kiro-session';
import { KiroTableService } from './kiro-table.service';
export interface ToolGuard {
    admit(tool: KiroToolName): number | null;
}
const SERVER_INFO = { name: 'yakpoker', version: '1.0.0' };
const TOOL_DESCRIPTIONS: Record<KiroToolName, string> = {
    join_table: 'Entra na mesa do YakPoker com o convite gerado pela pessoa e cria o assento do Kiro.',
    get_round:
        'Mostra o card atual, o baralho com a régua da sala e a fase da rodada. Não mostra votos antes da revelação.',
    wait_for_round: 'Espera uma rodada nova ou a troca de card, por no máximo 90 segundos, e devolve o estado da mesa.',
    cast_vote: 'Vota com uma justificativa curta (até 280 caracteres). Pode trocar o voto até a revelação.',
    leave_table: 'Sai da mesa e libera o assento do Kiro.',
};
const logger = new Logger('KiroMcp');
const textOf = (payload: unknown) => ({ type: 'text' as const, text: JSON.stringify(payload) });
const success = <Output extends Record<string, unknown>>(output: Output) => ({
    content: [textOf(output)],
    structuredContent: output,
});
const failure = (error: AppError) => ({ isError: true, content: [textOf(error)] });
const appErrorOf = (error: unknown): AppError => {
    if (error instanceof DomainError) return error.error;
    logger.error(`unexpected failure in a tool call (${error instanceof Error ? error.name : 'unknown'})`);
    return domainErrors.internal().error;
};
export const createKiroMcpServer = (table: KiroTableService, session: KiroSession, guard: ToolGuard): McpServer => {
    const server = new McpServer(SERVER_INFO);
    const run = async <Output extends Record<string, unknown>>(
        tool: KiroToolName,
        action: () => Output | Promise<Output>,
    ) => {
        const retryAfterMs = guard.admit(tool);
        if (retryAfterMs !== null) return failure({ code: 'rate_limited', retryAfterMs });
        try {
            return success(await action());
        } catch (error) {
            return failure(appErrorOf(error));
        }
    };
    server.registerTool(
        'join_table',
        { description: TOOL_DESCRIPTIONS.join_table, ...schemasOf(KIRO_TOOLS.join_table) },
        ({ invite }) => run('join_table', () => table.join(session, invite)),
    );
    server.registerTool(
        'get_round',
        { description: TOOL_DESCRIPTIONS.get_round, ...schemasOf(KIRO_TOOLS.get_round) },
        () => run('get_round', () => table.getRound(session)),
    );
    server.registerTool(
        'wait_for_round',
        { description: TOOL_DESCRIPTIONS.wait_for_round, ...schemasOf(KIRO_TOOLS.wait_for_round) },
        ({ timeout_s }) => run('wait_for_round', () => table.waitForRound(session, timeout_s)),
    );
    server.registerTool(
        'cast_vote',
        { description: TOOL_DESCRIPTIONS.cast_vote, ...schemasOf(KIRO_TOOLS.cast_vote) },
        (input) => run('cast_vote', () => table.castVote(session, input)),
    );
    server.registerTool(
        'leave_table',
        { description: TOOL_DESCRIPTIONS.leave_table, ...schemasOf(KIRO_TOOLS.leave_table) },
        () => run('leave_table', () => table.leave(session)),
    );
    return server;
};
function schemasOf<Input extends z.ZodObject, Output extends z.ZodObject>(tool: { input: Input; output: Output }) {
    return { inputSchema: tool.input, outputSchema: tool.output };
}
