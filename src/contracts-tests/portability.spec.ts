import { dirname, extname, relative, resolve } from 'path';
import * as ts from 'typescript';
import { CONTRACTS_DIR, contractFiles, readContract } from './contract-files';

const FRONT_COMPILER_OPTIONS = {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    moduleDetection: 'force',
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    erasableSyntaxOnly: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    noUncheckedSideEffectImports: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
};

const BACK_COMPILER_OPTIONS = {
    target: 'ES2023',
    module: 'nodenext',
    moduleResolution: 'nodenext',
    isolatedModules: true,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
};

const FORBIDDEN_GLOBALS = ['process', 'Buffer', 'crypto', 'require', 'module', '__dirname', 'global'];

const files = contractFiles();
const relativeName = (file: string) => relative(CONTRACTS_DIR, file);

const diagnosticsFor = (compilerOptions: object) => {
    const { options, errors } = ts.convertCompilerOptionsFromJson(compilerOptions, CONTRACTS_DIR);
    const program = ts.createProgram(files, options);
    return [...errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        return diagnostic.file ? `${relativeName(diagnostic.file.fileName)}: ${message}` : message;
    });
};

const nodesOf = (sourceFile: ts.SourceFile): ts.Node[] => {
    const nodes: ts.Node[] = [];
    const visit = (node: ts.Node) => {
        nodes.push(node);
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return nodes;
};

const sourceFileOf = (file: string) =>
    ts.createSourceFile(file, readContract(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

describe('contracts portability', () => {
    it('contains only .ts code files and no tests', () => {
        const names = files.map(relativeName);

        expect(names.length).toBeGreaterThan(0);
        expect(names.filter((name) => extname(name) !== '.ts')).toEqual([]);
        expect(names.filter((name) => /\.(spec|test)\.ts$/.test(name))).toEqual([]);
        expect(names).toContain('index.ts');
    });

    it.each(files.map((file) => [relativeName(file), file]))(
        '%s imports only zod or relative files inside the folder, without extension',
        (_name, file) => {
            const imports = ts.preProcessFile(readContract(file), true, true).importedFiles.map((entry) => entry.fileName);
            const invalid = imports.filter((specifier) => {
                if (specifier === 'zod') {
                    return false;
                }
                const target = resolve(dirname(file), specifier);
                const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
                const staysInside = !relative(CONTRACTS_DIR, target).startsWith('..');
                return !isRelative || !staysInside || extname(specifier) !== '' || !files.includes(`${target}.ts`);
            });

            expect(invalid).toEqual([]);
        },
    );

    it.each(files.map((file) => [relativeName(file), file]))(
        '%s uses no Node global and no decorator',
        (_name, file) => {
            const offending = nodesOf(sourceFileOf(file))
                .filter(
                    (node) =>
                        ts.isDecorator(node) || (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.includes(node.text)),
                )
                .map((node) => node.getText());

            expect(offending).toEqual([]);
        },
    );

    it.each(files.map((file) => [relativeName(file), file]))(
        '%s does not start with a comment containing "gerado"',
        (_name, file) => {
            const text = readContract(file);
            const leadingComments = (ts.getLeadingCommentRanges(text, 0) ?? []).map(({ pos, end }) =>
                text.slice(pos, end),
            );

            expect(leadingComments.filter((comment) => /gerado/i.test(comment))).toEqual([]);
        },
    );

    it('compiles without diagnostics with the front compiler options', () => {
        expect(diagnosticsFor(FRONT_COMPILER_OPTIONS)).toEqual([]);
    }, 60_000);

    it('compiles without diagnostics with the back module options and no Node types', () => {
        expect(diagnosticsFor(BACK_COMPILER_OPTIONS)).toEqual([]);
    }, 60_000);
});
