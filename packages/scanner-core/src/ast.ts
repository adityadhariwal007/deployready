import { parse } from '@babel/parser';
import type { WalkResult, SourceAnalysis } from './types';

type NodeLike = {
  type?: string;
  [key: string]: unknown;
};

type LocationLike = {
  start?: { line?: number; column?: number };
  end?: { line?: number; column?: number };
};

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

function location(node: NodeLike): { line?: number; column?: number; endLine?: number; endColumn?: number } {
  const loc = node.loc as LocationLike | undefined;
  return {
    line: loc?.start?.line,
    column: loc?.start?.column === undefined ? undefined : loc.start.column + 1,
    endLine: loc?.end?.line,
    endColumn: loc?.end?.column === undefined ? undefined : loc.end.column + 1,
  };
}

function staticProperty(node: NodeLike): string | undefined {
  const property = node.property as NodeLike | undefined;
  if (!property) return undefined;
  if (!node.computed && property.type === 'Identifier' && typeof property.name === 'string') return property.name;
  if (node.computed && (property.type === 'StringLiteral' || property.type === 'Literal') && typeof property.value === 'string') return property.value;
  return undefined;
}

function isImportMeta(node: NodeLike | undefined): boolean {
  if (!node || node.type !== 'MetaProperty') return false;
  const meta = node.meta as NodeLike | undefined;
  const property = node.property as NodeLike | undefined;
  return meta?.name === 'import' && property?.name === 'meta';
}

function isImportMetaEnv(node: NodeLike | undefined): boolean {
  if (!node || node.type !== 'MemberExpression') return false;
  const object = node.object as NodeLike | undefined;
  return isImportMeta(object) && staticProperty(node) === 'env';
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extension(path));
}

function walkAst(node: unknown, visitor: (node: NodeLike) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visitor);
    return;
  }
  const value = node as NodeLike;
  if (typeof value.type !== 'string') return;
  visitor(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'comments' || key === 'tokens') continue;
    walkAst(child, visitor);
  }
}

function parseSource(text: string): NodeLike {
  return parse(text, {
    sourceType: 'unambiguous',
    errorRecovery: false,
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'importMeta'],
  }) as unknown as NodeLike;
}

function loopback(value: string): { protocol: string; host: string; port?: number } | undefined {
  const explicit = value.match(/((?:https?|wss?|ws|ftp):\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::(\d{1,5}))?(?=\/|[?#\s]|$)/i);
  const bare = explicit ? undefined : value.match(/(?:^|[^\w])(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::(\d{1,5}))?(?=\/|[?#\s]|$)/i);
  const match = explicit ?? bare;
  if (!match) return undefined;
  const host = explicit ? match[2] : match[1];
  const port = explicit ? match[3] : match[2];
  if (!host) return undefined;
  // A bare hostname is only a URL for this rule when it has a port or a path.
  if (!explicit && !port && !/\/|[?#]/.test(value.slice(match.index ?? 0))) return undefined;
  const result: { protocol: string; host: string; port?: number } = {
    protocol: explicit ? match[1].replace('://', '').toLowerCase() : 'bare',
    host: host.toLowerCase(),
  };
  if (port) result.port = Number(port);
  return result;
}

export function analyzeSources(walk: WalkResult): SourceAnalysis {
  const analysis: SourceAnalysis = {
    envNames: [],
    loopbackUrls: [],
    sourceFiles: [],
    parsedFiles: [],
    limitations: [],
  };
  const seenEnv = new Set<string>();
  const seenLoopback = new Set<string>();

  for (const [path, file] of walk.files) {
    if (!isSourceFile(path)) continue;
    analysis.sourceFiles.push(path);
    let ast: NodeLike;
    try {
      ast = parseSource(file.text);
    } catch {
      analysis.limitations.push({ reason: 'source-parse-failed', path, detail: 'Source syntax could not be parsed.' });
      continue;
    }
    analysis.parsedFiles.push(path);
    walkAst(ast, (node) => {
      if (node.type === 'MemberExpression') {
        const object = node.object as NodeLike | undefined;
        const name = staticProperty(node);
        if (isImportMetaEnv(object) && name?.startsWith('VITE_')) {
          const loc = location(node);
          const key = `${path}:${loc.line ?? 0}:${loc.column ?? 0}:${name}`;
          if (!seenEnv.has(key)) {
            seenEnv.add(key);
            analysis.envNames.push({ name, path, line: loc.line, column: loc.column });
          }
        }
      }

      if (node.type === 'VariableDeclarator' && isImportMetaEnv(node.init as NodeLike | undefined)) {
        const id = node.id as NodeLike | undefined;
        if (id?.type === 'ObjectPattern' && Array.isArray(id.properties)) {
          for (const property of id.properties as NodeLike[]) {
            if (property.type !== 'ObjectProperty' && property.type !== 'Property') continue;
            const name = property.key && typeof (property.key as NodeLike).name === 'string'
              ? (property.key as NodeLike).name as string
              : property.key && typeof (property.key as NodeLike).value === 'string'
                ? (property.key as NodeLike).value as string
                : undefined;
            if (!name?.startsWith('VITE_')) continue;
            const loc = location(property);
            const key = `${path}:${loc.line ?? 0}:${loc.column ?? 0}:${name}`;
            if (!seenEnv.has(key)) {
              seenEnv.add(key);
              analysis.envNames.push({ name, path, line: loc.line, column: loc.column });
            }
          }
        }
      }

      if (node.type === 'StringLiteral' || node.type === 'Literal' || node.type === 'DirectiveLiteral') {
        const value = typeof node.value === 'string' ? node.value : undefined;
        const match = value ? loopback(value) : undefined;
        if (match) {
          const loc = location(node);
          const key = `${path}:${loc.line ?? 0}:${loc.column ?? 0}:${match.protocol}:${match.host}:${match.port ?? ''}`;
          if (!seenLoopback.has(key)) {
            seenLoopback.add(key);
            analysis.loopbackUrls.push({ path, ...loc, ...match });
          }
        }
      }

      if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0) {
        const quasis = node.quasis as NodeLike[] | undefined;
        const value = quasis?.map((quasi) => {
          const cooked = (quasi.value as NodeLike | undefined)?.cooked;
          return typeof cooked === 'string' ? cooked : '';
        }).join('') ?? '';
        const match = loopback(value);
        if (match) {
          const loc = location(node);
          const key = `${path}:${loc.line ?? 0}:${loc.column ?? 0}:${match.protocol}:${match.host}:${match.port ?? ''}`;
          if (!seenLoopback.has(key)) {
            seenLoopback.add(key);
            analysis.loopbackUrls.push({ path, ...loc, ...match });
          }
        }
      }
    });
  }

  analysis.sourceFiles.sort();
  analysis.parsedFiles.sort();
  analysis.envNames.sort((a, b) => `${a.path}:${a.line}:${a.column}:${a.name}`.localeCompare(`${b.path}:${b.line}:${b.column}:${b.name}`));
  analysis.loopbackUrls.sort((a, b) => `${a.path}:${a.line}:${a.column}`.localeCompare(`${b.path}:${b.line}:${b.column}`));

  for (const skipped of walk.skippedFiles) {
    if (isSourceFile(skipped.path)) {
      analysis.limitations.push({ reason: 'source-file-skipped', path: skipped.path, detail: skipped.reason });
    }
  }
  return analysis;
}

export { isSourceFile };
