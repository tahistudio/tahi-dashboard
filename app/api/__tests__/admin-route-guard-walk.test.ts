import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { isFeatureKey } from '@/lib/feature-tree'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const ROOT = process.cwd()

// These methods intentionally authenticate a caller without a feature grant.
// Keep exceptions at method granularity: a new sibling must earn its own gate.
const EXCEPTIONS: Readonly<Record<string, string>> = {
  'GET /api/admin/permissions/me': 'Returns only the authenticated caller\'s resolved permissions so denied seats can render their navigation.',
  'GET /api/admin/mcp/identity': 'Requires the verified api-service identity; this is the worker\'s refresh-time profile check.',
  'GET /api/admin/activities': 'activityListWhere applies the clients, deals and leads feature grants and org scope in SQL before LIMIT.',
  'GET /api/admin/ai/briefing/cron': 'Scheduler diagnostics require a constant-time validated cron secret; no browser seat bypass exists.',
  'POST /api/admin/ai/briefing/cron': 'Scheduled briefing generation requires a constant-time validated cron secret; no browser seat bypass exists.',
  'GET /api/admin/cron/draft-approved-ideas': 'Retired endpoint returns a constant HTTP 410 response without reading or writing data.',
  'POST /api/admin/cron/draft-approved-ideas': 'Retired endpoint returns a constant HTTP 410 response without reading or writing data.',
  'POST /api/admin/docs/seed': 'A server-only CLI seed secret is the alternate identity; browser callers must pass the docs feature gate.',
  'GET /api/admin/impersonate/exit': 'Clears only this browser\'s preview cookies; an exit hatch must always remain available.',
  'POST /api/admin/impersonate/exit': 'Clears only this browser\'s preview cookies; an exit hatch must always remain available.',
  'GET /api/admin/impersonate/mode': 'Reads this browser\'s mode and recomputes its super-admin acting eligibility; no client data is returned.',
  'POST /api/admin/impersonate/mode': 'Disarming is always allowed; entering act mode requires resolveActEligibility to prove the super-admin role.',
  'GET /api/admin/integrations/google/callback': 'Public OAuth return consumes a single-use state nonce minted by the guarded integration start endpoint.',
  'GET /api/admin/integrations/xero/callback': 'Public OAuth return consumes a single-use state nonce minted by the guarded integration connect endpoint.',
  'GET /api/admin/notifications': 'Authenticated studio callers read only their own notification preferences, scoped by auth.userId.',
  'PATCH /api/admin/notifications': 'Authenticated studio callers update only their own notification preferences, scoped by auth.userId.',
  'GET /api/admin/profile': 'Authenticated studio callers read only their own roster profile, resolved from their authenticated identity.',
  'PATCH /api/admin/profile': 'Authenticated studio callers edit only their own permitted profile fields; role and access fields are not writable.',
  'GET /api/admin/search': 'Every result group checks its own feature grant and org fence; a single feature would hide otherwise allowed groups.',
  'POST /api/admin/team/accept-invite': 'Joining a seat requires a verified email bound to an expiring invite token claimed atomically once.',
  'GET /api/admin/team': 'The team feature gates employment details; other studio seats receive only the intentional lite picker projection.',
  'GET /api/admin/team-members': 'Intentional lite roster projection for assignment and mention pickers, authenticated studio seats only.',
}

// These reviewed helpers gate different sources in conditional branches or
// execute a guarded callback. Verify the real helper body, never its name alone.
const CONDITIONAL_HELPERS: Readonly<Record<string, readonly string[]>> = {
  '@/lib/activity-access': ['requireActivityLinks'],
  '@/lib/reply-draft-access': ['requireReplyDraftAccess'],
  '@/lib/recorder-devices': ['withRecorderDevicesContext'],
}

type Declaration = ts.FunctionDeclaration | ts.Expression
interface SourceIndex {
  source: ts.SourceFile
  declarations: Map<string, Declaration>
  imports: Map<string, { module: string; name: string }>
  exports: Map<string, Declaration>
}
type GuardKind = 'response' | 'result' | 'permissions' | 'identity'
interface AnalysisState {
  responses: Set<string>
  results: Set<string>
  permissions: Set<string>
  identities: Set<string>
  cronSecrets: Set<string>
}

function exported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

function indexSource(path: string, text: string): SourceIndex {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const index: SourceIndex = { source, declarations: new Map(), imports: new Map(), exports: new Map() }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) index.imports.set(binding.name.text, {
          module: statement.moduleSpecifier.text, name: binding.propertyName?.text ?? binding.name.text,
        })
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      index.declarations.set(statement.name.text, statement)
      if (exported(statement)) index.exports.set(statement.name.text, statement)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        index.declarations.set(declaration.name.text, declaration.initializer)
        if (exported(statement)) index.exports.set(declaration.name.text, declaration.initializer)
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        const original = specifier.propertyName?.text ?? specifier.name.text
        index.exports.set(specifier.name.text, ts.factory.createIdentifier(original))
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          index.imports.set(original, { module: statement.moduleSpecifier.text, name: original })
        }
      }
    }
  }
  return index
}

const sources = new Map<string, SourceIndex>()
function readSource(path: string): SourceIndex {
  const absolute = resolve(path)
  const cached = sources.get(absolute)
  if (cached) return cached
  const index = indexSource(absolute, readFileSync(absolute, 'utf8'))
  sources.set(absolute, index)
  return index
}

function importPath(index: SourceIndex, module: string): string | undefined {
  if (!module.startsWith('@/') && !module.startsWith('.')) return undefined
  const base = module.startsWith('@/') ? join(ROOT, module.slice(2)) : resolve(dirname(index.source.fileName), module)
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(path => existsSync(path) && statSync(path).isFile())
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) {
    expression = expression.expression
  }
  return expression
}

function importedCall(index: SourceIndex, call: ts.CallExpression): { module: string; name: string } | undefined {
  const callee = unwrap(call.expression)
  return ts.isIdentifier(callee) ? index.imports.get(callee.text) : undefined
}

function featureArgument(expression: ts.Expression | undefined, index?: SourceIndex, seen = new Set<string>()): boolean {
  if (!expression) return false
  const value = unwrap(expression)
  if (ts.isStringLiteral(value)) return isFeatureKey(value.text)
  if (ts.isConditionalExpression(value)) return featureArgument(value.whenTrue, index, seen) && featureArgument(value.whenFalse, index, seen)
  if (ts.isIdentifier(value) && index && !seen.has(value.text)) {
    const target = resolveDeclaration(index, value.text)
    if (target && !ts.isFunctionDeclaration(target.declaration)) {
      return featureArgument(target.declaration, target.index, new Set(seen).add(value.text))
    }
  }
  return ts.isArrayLiteralExpression(value) && value.elements.length > 0
    && value.elements.every(element => ts.isStringLiteral(element) && isFeatureKey(element.text))
}

function guardKind(index: SourceIndex, expression: ts.Expression, visiting: Set<string>): GuardKind | undefined {
  const value = unwrap(expression)
  if (!ts.isCallExpression(value)) return undefined
  const imported = importedCall(index, value)
  if (imported?.name === 'requireFeature') {
    if (imported.module === '@/lib/require-feature' && featureArgument(value.arguments[1], index)) return 'response'
    if (imported.module === '@/lib/require-permission' && featureArgument(value.arguments[2], index)) return 'result'
    if (imported.module === '@/lib/require-feature'
      && ['/lib/activity-access.ts', '/lib/require-admin-resource.ts'].some(path => index.source.fileName.replaceAll('\\', '/').endsWith(path))
      && value.arguments[1]) return 'response'
    // Do not follow the generic implementation to treat a typo or empty key
    // list as a gate. Unmapped feature keys can intentionally default to allow.
    if (['@/lib/require-feature', '@/lib/require-permission'].includes(imported.module)) return undefined
  }
  if (imported?.module === '@/lib/require-permission' && imported.name === 'requireManagePermissions') return 'result'
  if (imported?.module === '@/lib/require-migration-access' && imported.name === 'requireMigrationAccess') return 'response'
  if (imported?.module === '@/lib/permissions' && imported.name === 'resolvePermissions') return 'permissions'
  // This stronger founder-only gate is deliberately retained. Its null result
  // must be checked, just like a denied feature response must be returned.
  if (imported?.module === '@/lib/sitemap-auth' && imported.name === 'assertSitemapApiAccess') return 'identity'
  const callee = unwrap(value.expression)
  if (!ts.isIdentifier(callee)) return undefined
  const target = resolveDeclaration(index, callee.text)
  if (target && imported && CONDITIONAL_HELPERS[imported.module]?.includes(imported.name)) {
    let found = false
    const visit = (node: ts.Node): void => {
      if (ts.isBlock(node) && scanStatements(target.index, node.statements, visiting, {
        responses: new Set(), results: new Set(), permissions: new Set(), identities: new Set(), cronSecrets: new Set(),
      })) found = true
      if (!found) ts.forEachChild(node, visit)
    }
    visit(target.declaration)
    if (found) return 'response'
  }
  if (target && guarded(target.index, target.declaration, visiting)) {
    let structuredResult = false
    const visit = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(unwrap(node.expression))) {
        const properties = (unwrap(node.expression) as ts.ObjectLiteralExpression).properties
        if (properties.some(property => ts.isPropertyAssignment(property) && property.name.getText() === 'ok')) structuredResult = true
      }
      ts.forEachChild(node, visit)
    }
    visit(target.declaration)
    return structuredResult ? 'result' : 'response'
  }
  return undefined
}

function resolveDeclaration(index: SourceIndex, name: string): { index: SourceIndex; declaration: Declaration } | undefined {
  const local = index.declarations.get(name)
  if (local) return { index, declaration: local }
  const imported = index.imports.get(name)
  if (!imported) return undefined
  const path = importPath(index, imported.module)
  if (!path) return undefined
  const targetIndex = readSource(path)
  const declaration = targetIndex.exports.get(imported.name)
  return declaration ? { index: targetIndex, declaration } : undefined
}

function expressionKey(expression: ts.Expression): string | undefined {
  const value = unwrap(expression)
  if (ts.isIdentifier(value)) return value.text
  if (ts.isPropertyAccessExpression(value)) {
    const owner = expressionKey(value.expression)
    return owner ? `${owner}.${value.name.text}` : undefined
  }
  return undefined
}

function returns(statement: ts.Statement): ts.ReturnStatement[] {
  if (ts.isReturnStatement(statement)) return [statement]
  if (ts.isBlock(statement)) return statement.statements.flatMap(returns)
  return []
}

function forbidden(expression: ts.Expression | undefined, status = '403'): boolean {
  if (!expression) return false
  const value = unwrap(expression)
  if (!ts.isCallExpression(value)) return false
  return value.arguments.some(argument => ts.isObjectLiteralExpression(argument) && argument.properties.some(property =>
    ts.isPropertyAssignment(property) && property.name.getText() === 'status'
      && ts.isNumericLiteral(property.initializer) && property.initializer.text === status))
}

function checkedResponse(index: SourceIndex, statement: ts.IfStatement, state: AnalysisState, visiting: Set<string>): boolean {
  const condition = unwrap(statement.expression)
  const key = expressionKey(condition)
  const allowedReturns = returns(statement.thenStatement)
  // Mixed pickers may require any one of several features, then filter each
  // result source separately. Every term must be an actual feature denial.
  const responseTerms = (expression: ts.Expression): string[] | undefined => {
    const value = unwrap(expression)
    const term = expressionKey(value)
    if (term && state.responses.has(term)) return [term]
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = responseTerms(value.left)
      const right = responseTerms(value.right)
      return left && right ? [...left, ...right] : undefined
    }
    return undefined
  }
  const terms = responseTerms(condition)
  if (terms && allowedReturns.some(result => result.expression && terms.includes(expressionKey(result.expression) ?? ''))) return true
  if (key && state.responses.has(key)) return allowedReturns.some(result => {
    if (!result.expression) return false
    const value = unwrap(result.expression)
    if (expressionKey(value) === key) return true
    return ts.isObjectLiteralExpression(value) && value.properties.some(property =>
      ts.isPropertyAssignment(property) && ['response', 'denied'].includes(property.name.getText()) && expressionKey(property.initializer) === key)
  })
  if (key?.endsWith('.denied') && state.results.has(key.slice(0, -7))) {
    return allowedReturns.some(result => expressionKey(result.expression ?? ts.factory.createNull()) === key)
  }
  if (guardKind(index, condition, visiting) === 'response') return allowedReturns.some(result => forbidden(result.expression))
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
    && state.identities.has(expressionKey(condition.operand) ?? '')) {
    if (allowedReturns.some(result => forbidden(result.expression, '404') || forbidden(result.expression))) return true
    const statements = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement]
    return statements.some(result => {
      if (!ts.isExpressionStatement(result) || !ts.isCallExpression(result.expression)) return false
      const imported = importedCall(index, result.expression)
      return imported?.module === 'next/navigation' && imported.name === 'notFound'
    })
  }
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = unwrap(condition.operand)
    if (ts.isPropertyAccessExpression(operand) && operand.name.text === 'ok') {
      const owner = expressionKey(operand.expression)
      return !!owner && state.results.has(owner) && allowedReturns.some(result =>
        result.expression && expressionKey(result.expression) === `${owner}.response`)
    }
  }
  return false
}

function permissionCondition(index: SourceIndex, expression: ts.Expression, state: AnalysisState): boolean {
  const denied = unwrap(expression)
  let relevant = false
  if (ts.isPropertyAccessExpression(denied) && ['isAdmin', 'isSuperAdmin', 'canManagePermissions'].includes(denied.name.text)) {
    relevant = state.permissions.has(expressionKey(denied.expression) ?? '')
      || guardKind(index, denied.expression, new Set()) === 'permissions'
  } else if (ts.isCallExpression(denied)) {
    const imported = importedCall(index, denied)
    relevant = imported?.module === '@/lib/permissions' && imported.name === 'can'
      && !!denied.arguments[0] && state.permissions.has(expressionKey(denied.arguments[0]) ?? '') && featureArgument(denied.arguments[1], index)
  }
  return relevant
}

function checkedPermission(index: SourceIndex, statement: ts.IfStatement, state: AnalysisState): boolean {
  const condition = unwrap(statement.expression)
  return ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
    && permissionCondition(index, condition.operand, state)
    && (returns(statement.thenStatement).some(result => forbidden(result.expression))
      || (ts.isThrowStatement(statement.thenStatement) && ts.isNewExpression(statement.thenStatement.expression)
        && statement.thenStatement.expression.arguments?.some(argument => ts.isNumericLiteral(argument) && argument.text === '403') === true))
}

function scanStatements(index: SourceIndex, statements: ts.NodeArray<ts.Statement>, visiting: Set<string>, state: AnalysisState): boolean {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue
        const kind = guardKind(index, declaration.initializer, visiting)
        if (ts.isIdentifier(declaration.name)) {
          if (kind === 'response') state.responses.add(declaration.name.text)
          if (kind === 'result') state.results.add(declaration.name.text)
          if (kind === 'permissions') state.permissions.add(declaration.name.text)
          if (kind === 'identity') state.identities.add(declaration.name.text)
          const value = unwrap(declaration.initializer)
          if (ts.isCallExpression(value)) {
            const imported = importedCall(index, value)
            if (imported?.module === '@/lib/cron-runs' && imported.name === 'hasCronSecretAuth') state.cronSecrets.add(declaration.name.text)
          }
        } else if (ts.isObjectBindingPattern(declaration.name) && kind === 'result') {
          for (const element of declaration.name.elements) {
            if ((element.propertyName?.getText() ?? element.name.getText()) === 'denied' && ts.isIdentifier(element.name)) state.responses.add(element.name.text)
            if ((element.propertyName?.getText() ?? element.name.getText()) === 'access' && ts.isIdentifier(element.name)) state.permissions.add(element.name.text)
          }
        }
      }
    }
    if (ts.isIfStatement(statement) && (checkedResponse(index, statement, state, visiting) || checkedPermission(index, statement, state))) return true
    // A guard helper can return null only on an explicitly privileged role,
    // then finish with a forbidden response for everybody else.
    if (ts.isIfStatement(statement) && permissionCondition(index, statement.expression, state)
      && returns(statement.thenStatement).some(result => result.expression?.kind === ts.SyntaxKind.NullKeyword)
      && statements.some(result => ts.isReturnStatement(result) && forbidden(result.expression))) return true
    if (ts.isIfStatement(statement)) {
      const condition = unwrap(statement.expression)
      if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
        && state.cronSecrets.has(expressionKey(condition.operand) ?? '') && ts.isBlock(statement.thenStatement)
        && scanStatements(index, statement.thenStatement.statements, visiting, {
          responses: new Set(state.responses), results: new Set(state.results), permissions: new Set(state.permissions),
          identities: new Set(state.identities), cronSecrets: new Set(state.cronSecrets),
        })) return true
    }
    // A try block is unconditional; a guard inside an optional if/loop/callback
    // does not protect the method's other paths and is deliberately ignored.
    if (ts.isTryStatement(statement) && scanStatements(index, statement.tryBlock.statements, visiting, state)) return true
    if (ts.isReturnStatement(statement) && statement.expression) {
      const value = unwrap(statement.expression)
      if (ts.isCallExpression(value) && guardKind(index, value, visiting) === 'response') return true
      if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && guarded(index, value, visiting)) return true
    }
  }
  return false
}

function guarded(index: SourceIndex, declaration: Declaration, visiting = new Set<string>()): boolean {
  const key = `${index.source.fileName}:${declaration.pos}:${declaration.end}`
  if (visiting.has(key)) return false
  const next = new Set(visiting).add(key)
  if (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) {
    if (!declaration.body) return false
    if (!ts.isBlock(declaration.body)) return guardKind(index, declaration.body, next) === 'response'
    return scanStatements(index, declaration.body.statements, next, {
      responses: new Set(), results: new Set(), permissions: new Set(), identities: new Set(), cronSecrets: new Set(),
    })
  }
  const value = unwrap(declaration)
  if (ts.isIdentifier(value)) {
    const target = resolveDeclaration(index, value.text)
    return !!target && guarded(target.index, target.declaration, next)
  }
  if (ts.isCallExpression(value)) {
    const imported = importedCall(index, value)
    if (imported?.module === '@/lib/api-route' && imported.name === 'defineAdminRoute') {
      const options = value.arguments[1]
      if (options && ts.isObjectLiteralExpression(options) && options.properties.some(property =>
        ts.isPropertyAssignment(property) && property.name.getText() === 'feature' && featureArgument(property.initializer, index))) return true
      const handler = value.arguments[0]
      return !!handler && guarded(index, handler, next)
    }
    const callee = unwrap(value.expression)
    if (ts.isIdentifier(callee)) {
      const target = resolveDeclaration(index, callee.text)
      return !!target && guarded(target.index, target.declaration, next)
    }
  }
  return false
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : []
  })
}

function sample(text: string): SourceIndex {
  return indexSource(join(ROOT, 'app', 'api', '__guard_sample__.ts'), text)
}

describe('admin HTTP method guard walk', () => {
  it('requires every method to enforce a feature or resolved role, with explicit intentional exceptions', () => {
    const seenExceptions = new Set<string>()
    const gaps: string[] = []
    let methods = 0
    for (const path of routeFiles(join(ROOT, 'app', 'api', 'admin'))) {
      const index = readSource(path)
      const pathname = `/${relative(join(ROOT, 'app'), path).replaceAll('\\', '/').replace(/\/route\.ts$/, '')}`
      for (const [method, declaration] of index.exports) {
        if (!METHODS.has(method)) continue
        methods += 1
        const key = `${method} ${pathname}`
        if (guarded(index, declaration)) {
          // Exceptions must disappear when the endpoint gains a normal gate.
          if (EXCEPTIONS[key]) gaps.push(`${key}: stale exception, method now has a recognised gate`)
        } else if (EXCEPTIONS[key]) {
          expect(EXCEPTIONS[key].length, key).toBeGreaterThan(20)
          seenExceptions.add(key)
        } else gaps.push(key)
      }
    }
    expect(methods).toBeGreaterThan(300)
    expect(gaps, `Unguarded admin HTTP methods:\n${gaps.join('\n')}`).toEqual([])
    expect([...seenExceptions].sort(), 'Remove missing or obsolete exceptions').toEqual(Object.keys(EXCEPTIONS).sort())
  })

  it('ignores imports and comments, checks siblings independently, and requires returning a feature denial', () => {
    const index = sample(`
      import { requireFeature } from '@/lib/require-feature'
      import { isTahiAdmin } from '@/lib/server-auth'
      export async function GET(req: Request) {
        const denied = await requireFeature({ userId: 'user', orgId: 'org' }, 'tasks')
        if (denied) return denied
        return Response.json({ items: [] })
      }
      export async function POST() {
        // requireFeature and access.isAdmin are not executable guards.
        if (!isTahiAdmin('org')) return Response.json({}, { status: 403 })
        return Response.json({ success: true })
      }
      export async function PUT() {
        await requireFeature({ userId: 'user', orgId: 'org' }, 'tasks')
        return Response.json({ success: true })
      }
      export async function DELETE() {
        if (Math.random() > 0.5) {
          const denied = await requireFeature({ userId: 'user', orgId: 'org' }, 'tasks')
          if (denied) return denied
        }
        return Response.json({ success: true })
      }
      export async function PATCH() {
        const denied = await requireFeature({ userId: 'user', orgId: 'org' }, 'typo_not_a_feature')
        if (denied) return denied
        return Response.json({ success: true })
      }
    `)
    expect(guarded(index, index.exports.get('GET')!)).toBe(true)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) expect(guarded(index, index.exports.get(method)!), method).toBe(false)
  })

  it('checks wrapper options and resolved permission denials rather than property mentions', () => {
    const index = sample(`
      import { defineAdminRoute } from '@/lib/api-route'
      import { resolvePermissions } from '@/lib/permissions'
      import { requireFeature } from '@/lib/require-feature'
      export const GET = defineAdminRoute(async () => Response.json({}), { feature: 'tasks' })
      export const POST = defineAdminRoute(async () => Response.json({}))
      export async function PUT() {
        const access = await resolvePermissions(database, auth)
        if (!access.canManagePermissions) return Response.json({}, { status: 403 })
        return Response.json({})
      }
      export async function PATCH() {
        const access = { isAdmin: true }
        if (!access.isAdmin) return Response.json({}, { status: 403 })
        return Response.json({})
      }
      export async function DELETE() {
        const tasksDenied = await requireFeature(auth, 'tasks')
        const requestsDenied = await requireFeature(auth, 'requests')
        if (tasksDenied && requestsDenied) return tasksDenied
        return Response.json({})
      }
      export async function OPTIONS() {
        const denied = await requireFeature(auth, 'tasks')
        if (denied && Math.random() > 0.5) return denied
        return Response.json({})
      }
    `)
    for (const method of ['GET', 'PUT', 'DELETE']) expect(guarded(index, index.exports.get(method)!), method).toBe(true)
    for (const method of ['POST', 'PATCH', 'OPTIONS']) expect(guarded(index, index.exports.get(method)!), method).toBe(false)
  })

  it('follows local and imported delegated handlers instead of trusting a helper name', () => {
    const index = sample(`
      import { GET as permissionsSubjects } from '@/app/api/admin/permissions/subjects/route'
      import { GET as ownPermissions } from '@/app/api/admin/permissions/me/route'
      export async function GET(req: Request) { return permissionsSubjects(req) }
      export async function POST(req: Request) { return ownPermissions(req) }
      export async function PUT(req: Request) { return GET(req) }
      export async function PATCH(req: Request) { return POST(req) }
    `)
    for (const method of ['GET', 'PUT']) expect(guarded(index, index.exports.get(method)!), method).toBe(true)
    for (const method of ['POST', 'PATCH']) expect(guarded(index, index.exports.get(method)!), method).toBe(false)
  })
})
