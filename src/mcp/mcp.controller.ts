import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { McpSessionHub } from './mcp-session-hub';
import type { McpRequest, McpResponse } from './mcp-session-hub';
const MCP_ROUTE = 'mcp';
@Controller(MCP_ROUTE)
export class McpController {
    constructor(private readonly hub: McpSessionHub) {}
    @Post()
    post(@Req() req: McpRequest, @Res() res: McpResponse, @Body() body: unknown): Promise<void> {
        return this.hub.handle(req, res, body);
    }
    @Get()
    get(@Req() req: McpRequest, @Res() res: McpResponse): Promise<void> {
        return this.hub.handle(req, res, undefined);
    }
    @Delete()
    delete(@Req() req: McpRequest, @Res() res: McpResponse): Promise<void> {
        return this.hub.handle(req, res, undefined);
    }
}
