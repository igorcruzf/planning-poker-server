import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { httpUrlSchema, KIRO_RATIONALE_MAX_LENGTH, KIRO_TOOL_NAMES, MCP_PATH, MCP_PRODUCTION_URL } from '../contracts';
const POWER_DIRECTORY = join(__dirname, '..', '..', 'kiro-power');
const SKILL_NAME = 'estimar-card-yak';
const readText = (...segments: string[]) => readFileSync(join(POWER_DIRECTORY, ...segments), 'utf8');
const readJson = (...segments: string[]): unknown => JSON.parse(readText(...segments));
const pluginSchema = z.object({
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().min(1),
    mcp: z.string().min(1),
    skills: z.array(z.string().min(1)).min(1),
});
const mcpConfigSchema = z.object({
    mcpServers: z.record(z.string(), z.strictObject({ url: httpUrlSchema })),
});
const skillText = () => readText('skills', SKILL_NAME, 'SKILL.md');
describe('Kiro Power', () => {
    it('declares the required fields in plugin.json and points to files that exist', () => {
        const plugin = pluginSchema.parse(readJson('plugin.json'));
        expect(existsSync(join(POWER_DIRECTORY, plugin.mcp))).toBe(true);
        plugin.skills.forEach((skill) => expect(existsSync(join(POWER_DIRECTORY, skill, 'SKILL.md'))).toBe(true));
        expect(plugin.skills).toContain(`skills/${SKILL_NAME}`);
    });
    it('points mcp.json to the production MCP endpoint and nothing else', () => {
        const { mcpServers } = mcpConfigSchema.parse(readJson('mcp.json'));
        expect(Object.keys(mcpServers)).toEqual(['yakpoker']);
        expect(mcpServers.yakpoker.url).toBe(MCP_PRODUCTION_URL);
        expect(new URL(mcpServers.yakpoker.url).pathname).toBe(MCP_PATH);
        expect(new URL(mcpServers.yakpoker.url).protocol).toBe('https:');
    });
    it('has a skill with front matter whose name matches the folder', () => {
        const [, header, body] = skillText().split(/^---$/m);
        expect(header).toMatch(new RegExp(`^name: ${SKILL_NAME}$`, 'm'));
        expect(header).toMatch(/^description: .{20,}$/m);
        expect(body.trim().length).toBeGreaterThan(0);
    });
    it('teaches every tool of the MCP and the two modes in Portuguese', () => {
        const text = skillText();
        KIRO_TOOL_NAMES.forEach((tool) => expect(text).toContain(`\`${tool}`));
        expect(text).toContain('Modo manual (padrão)');
        expect(text).toContain('Modo acompanhar a mesa');
        expect(text).toContain('quebrar o card');
        expect(text).toContain(`${KIRO_RATIONALE_MAX_LENGTH} caracteres`);
        expect(text).toContain('90 segundos');
    });
    it('carries no secrets and no URL besides the public endpoint', () => {
        const everything = ['plugin.json', 'mcp.json', join('skills', SKILL_NAME, 'SKILL.md')]
            .map((file) => readText(file))
            .join('\n');
        const urls = everything.match(/https?:\/\/[^\s"')]+/g) ?? [];
        expect(urls.every((url) => url === MCP_PRODUCTION_URL)).toBe(true);
        expect(everything).not.toMatch(/localhost|127\.0\.0\.1|\.intranet\.|\.internal/i);
        expect(everything).not.toMatch(/(api[_-]?key|secret|password|senha|bearer)\s*[:=]/i);
        expect(everything).not.toMatch(/[A-Za-z0-9_-]{43}/);
    });
});
