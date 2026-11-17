import { httpUrlSchema, MCP_PATH, MCP_PRODUCTION_URL } from '../../../contracts';
export const KIRO_MCP_URL = 'KIRO_MCP_URL';
const PUBLIC_BASE_URL_VARIABLE = 'PUBLIC_BASE_URL';
export const resolveMcpUrl = (env: NodeJS.ProcessEnv): string => {
    const configured = env[PUBLIC_BASE_URL_VARIABLE]?.trim();
    if (!configured) return MCP_PRODUCTION_URL;
    const baseUrl = httpUrlSchema.safeParse(configured);
    if (!baseUrl.success) throw new Error(`${PUBLIC_BASE_URL_VARIABLE} must be an http(s) url without credentials`);
    return `${baseUrl.data.replace(/\/+$/, '')}${MCP_PATH}`;
};
