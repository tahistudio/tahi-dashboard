import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { isFeatureKey } from '@/lib/feature-tree'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const ROOT = process.cwd()
const ALLOW_BY_DEFAULT_FEATURES = new Set(['overview', 'messages', 'help', 'sitemap'])

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
  authObjects: Set<string>
  authUserIds: Set<string>
  authOrgIds: Set<string>
  requestAuthNames: Set<string>
  sourceIndex?: SourceIndex
  aliases: Map<string, string>
  safeResponses: Set<string>
}

function analysisState(trustedAuth: readonly string[] = []): AnalysisState {
  return {
    responses: new Set(), results: new Set(), permissions: new Set(), identities: new Set(), cronSecrets: new Set(),
    authObjects: new Set(trustedAuth), authUserIds: new Set(), authOrgIds: new Set(), requestAuthNames: new Set(),
    aliases: new Map(), safeResponses: new Set(),
  }
}

function authPart(expression: ts.Expression, part: 'userId' | 'orgId', state: AnalysisState): boolean {
  const value = unwrap(expression)
  if (ts.isIdentifier(value)) return (part === 'userId' ? state.authUserIds : state.authOrgIds).has(value.text)
  return ts.isPropertyAccessExpression(value) && value.name.text === part
    && state.authObjects.has(expressionKey(value.expression) ?? '')
}

function authenticatedAuth(expression: ts.Expression | undefined, state: AnalysisState): boolean {
  if (!expression) return false
  const value = unwrap(expression)
  if (ts.isCallExpression(value)) {
    const imported = state.sourceIndex ? importedCall(state.sourceIndex, value) : undefined
    if (imported?.module === '@/lib/server-auth' && imported.name === 'getRequestAuth') return true
    if (imported?.module === '@/lib/recorder-device-auth' && imported.name === 'getRecorderDeviceAuth') return true
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return authenticatedAuth(value.left, state) && authenticatedAuth(value.right, state)
  }
  if (state.authObjects.has(expressionKey(value) ?? '')) return true
  if (!ts.isObjectLiteralExpression(value)) return false
  return (['userId', 'orgId'] as const).every(part => value.properties.some(property => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === part && authPart(property.name, part, state)
    return ts.isPropertyAssignment(property) && property.name.getText() === part && authPart(property.initializer, part, state)
  }))
}

function recordAuth(index: SourceIndex, declaration: ts.VariableDeclaration, state: AnalysisState): void {
  state.sourceIndex = index
  if (!declaration.initializer) return
  const value = unwrap(declaration.initializer)
  if (ts.isCallExpression(value) && value.expression.kind === ts.SyntaxKind.ImportKeyword
    && ts.isStringLiteral(value.arguments[0]) && value.arguments[0].text === '@/lib/server-auth'
    && ts.isObjectBindingPattern(declaration.name)) {
    for (const element of declaration.name.elements) {
      if (ts.isIdentifier(element.name)) index.imports.set(element.name.text, {
        module: '@/lib/server-auth', name: element.propertyName?.getText() ?? element.name.text,
      })
    }
  }
  const imported = ts.isCallExpression(value) ? importedCall(index, value) : undefined
  const fromRequest = imported?.module === '@/lib/server-auth' && imported.name === 'getRequestAuth'
  if (ts.isIdentifier(declaration.name)) {
    const alias = expressionKey(value)
    if (alias && (state.authObjects.has(alias) || state.permissions.has(alias))) state.aliases.set(declaration.name.text, alias)
    if (fromRequest || authenticatedAuth(value, state)) state.authObjects.add(declaration.name.text)
    if (authPart(value, 'userId', state)) state.authUserIds.add(declaration.name.text)
    if (authPart(value, 'orgId', state)) state.authOrgIds.add(declaration.name.text)
  } else if (ts.isObjectBindingPattern(declaration.name) && (fromRequest || authenticatedAuth(value, state))) {
    for (const element of declaration.name.elements) {
      if (!ts.isIdentifier(element.name)) continue
      const part = element.propertyName?.getText() ?? element.name.text
      if (part === 'userId') state.authUserIds.add(element.name.text)
      if (part === 'orgId') state.authOrgIds.add(element.name.text)
    }
  }
}

function forwardedAuth(declaration: Declaration, call: ts.CallExpression, state: AnalysisState): string[] {
  if (!ts.isFunctionDeclaration(declaration) && !ts.isArrowFunction(declaration) && !ts.isFunctionExpression(declaration)) return []
  return declaration.parameters.flatMap((parameter, index) => ts.isIdentifier(parameter.name)
    && authenticatedAuth(call.arguments[index], state) ? [parameter.name.text] : [])
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
  return ts.isIdentifier(callee) && !shadowedImport(index, callee.text, call) ? index.imports.get(callee.text) : undefined
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(element.name) : [])
}

function shadowedImport(index: SourceIndex, name: string, node: ts.Node): boolean {
  const imported = index.imports.get(name)
  if (!imported) return false
  let scope: ts.Node | undefined = node.parent
  while (scope) {
    if ((ts.isFunctionDeclaration(scope) || ts.isArrowFunction(scope) || ts.isFunctionExpression(scope))
      && scope.parameters.some(parameter => bindingNames(parameter.name).includes(name))) return true
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return true
        if (!ts.isVariableStatement(statement)) continue
        for (const binding of statement.declarationList.declarations) {
          if (!bindingNames(binding.name).includes(name)) continue
          const initializer = binding.initializer ? unwrap(binding.initializer) : undefined
          // A destructured dynamic import is the real module binding used by docs/seed.
          if (initializer && ts.isCallExpression(initializer) && initializer.expression.kind === ts.SyntaxKind.ImportKeyword
            && ts.isStringLiteral(initializer.arguments[0]) && initializer.arguments[0].text === imported.module
            && ts.isObjectBindingPattern(binding.name) && binding.name.elements.some(element =>
              ts.isIdentifier(element.name) && element.name.text === name
              && (element.propertyName?.getText() ?? element.name.text) === imported.name)) continue
          return true
        }
      }
    }
    scope = scope.parent
  }
  return false
}

function invalidateMutations(node: ts.Node, state: AnalysisState): void {
  const invalidate = (expression: ts.Expression): void => {
    const root = expressionKey(expression)?.split('.')[0]
    if (!root) return
    const affected = new Set([root])
    let changed = true
    while (changed) {
      changed = false
      for (const [alias, original] of state.aliases) {
        if ((affected.has(alias) || affected.has(original)) && (!affected.has(alias) || !affected.has(original))) {
          affected.add(alias); affected.add(original); changed = true
        }
      }
    }
    for (const name of affected) {
      state.authObjects.delete(name); state.authUserIds.delete(name); state.authOrgIds.delete(name)
      state.permissions.delete(name); state.responses.delete(name); state.results.delete(name)
      state.identities.delete(name); state.cronSecrets.delete(name); state.safeResponses.delete(name)
    }
  }
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionDeclaration(child) || ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return
    if (ts.isBinaryExpression(child) && child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && child.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const refreshed = child.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(child.left)
        && authenticatedAuth(child.right, state)
      invalidate(child.left)
      if (refreshed && ts.isIdentifier(child.left)) state.authObjects.add(child.left.text)
    }
    if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(child.operator)) invalidate(child.operand)
    if (ts.isDeleteExpression(child)) invalidate(child.expression)
    ts.forEachChild(child, visit)
  }
  visit(node)
}

function preparedPermission(expression: ts.Expression | undefined, state: AnalysisState): boolean {
  if (!expression) return true
  const value = unwrap(expression)
  return value.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(value) && value.text === 'undefined'
    || state.permissions.has(expressionKey(value) ?? '')
}

function denialCall(index: SourceIndex, expression: ts.Expression, state: AnalysisState): boolean {
  const value = unwrap(expression)
  if (!ts.isCallExpression(value)) return false
  const imported = importedCall(index, value)
  return imported?.module === '@/lib/require-feature' && imported.name === 'requireFeature'
    && authenticatedAuth(value.arguments[0], state) && preparedPermission(value.arguments[2], state)
}

function privilegedCondition(index: SourceIndex, expression: ts.Expression, state: AnalysisState): boolean {
  const value = unwrap(expression)
  if (permissionCondition(index, value, state)) return true
  if (ts.isBinaryExpression(value)) {
    if (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return privilegedCondition(index, value.left, state) || privilegedCondition(index, value.right, state)
    }
    if (value.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return privilegedCondition(index, value.left, state) && privilegedCondition(index, value.right, state)
    }
    if (value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && authPart(value.left, 'userId', state)) {
      const expected = unwrap(value.right)
      const imported = ts.isIdentifier(expected) ? index.imports.get(expected.text) : undefined
      return ts.isStringLiteral(expected) && expected.text === 'api-service'
        || imported?.module === '@/lib/team-identity' && imported.name === 'SERVICE_USER_ID'
    }
  }
  if (state.cronSecrets.has(expressionKey(value) ?? '')) return true
  if (ts.isCallExpression(value)) {
    const imported = importedCall(index, value)
    if (imported?.module === '@/lib/cron-runs' && imported.name === 'hasCronSecretAuth') return true
    if (ts.isIdentifier(value.expression) && value.expression.text === 'hasCronSecretAuth'
      && index.source.fileName.replaceAll('\\', '/').endsWith('/lib/cron-runs.ts')) {
      const helper = index.declarations.get('hasCronSecretAuth')
      return !!helper && callsNamed(index, helper, 'constantTimeEqual').length === 2
        && nodesWhere(helper, ts.isIfStatement).some(branch => ts.isPrefixUnaryExpression(unwrap(branch.expression))
          && expressionKey((unwrap(branch.expression) as ts.PrefixUnaryExpression).operand) === 'secret'
          && returns(branch.thenStatement).some(result => result.expression?.kind === ts.SyntaxKind.FalseKeyword))
    }
  }
  return false
}

function unsafeEarlyExit(index: SourceIndex, node: ts.Node, state: AnalysisState): boolean {
  let unsafe = false
  const visit = (child: ts.Node, privileged = false): void => {
    if (unsafe || ts.isFunctionDeclaration(child) || ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return
    if (ts.isIfStatement(child)) {
      const condition = unwrap(child.expression)
      if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
        && (authPart(condition.operand, 'userId', state) || authPart(condition.operand, 'orgId', state) || studioDenial(index, condition, state))
        && returns(child.thenStatement).every(result => result.expression?.kind === ts.SyntaxKind.NullKeyword)) {
        if (child.elseStatement) visit(child.elseStatement, privileged)
        return
      }
      visit(child.thenStatement, privileged || privilegedCondition(index, child.expression, state))
      if (child.elseStatement) visit(child.elseStatement, privileged)
      return
    }
    if (ts.isReturnStatement(child)) {
      if (privileged) return
      const key = expressionKey(child.expression)
      if (key && (state.responses.has(key) || state.safeResponses.has(key))) return
      if (child.expression && ts.isObjectLiteralExpression(unwrap(child.expression))) {
        const properties = (unwrap(child.expression) as ts.ObjectLiteralExpression).properties
        if (properties.some(property => ts.isPropertyAssignment(property) && ['response', 'denied'].includes(property.name.getText())
          && ['400', '401', '403', '404', '409', '410', '422', '429', '500', '502', '503'].some(status => forbidden(property.initializer, status)))) return
      }
      if (['400', '401', '403', '404', '409', '410', '422', '429', '500', '502', '503'].some(status => forbidden(child.expression, status))) return
      unsafe = true
      return
    }
    ts.forEachChild(child, next => visit(next, privileged))
  }
  visit(node)
  return unsafe
}

function featureArgument(expression: ts.Expression | undefined, index?: SourceIndex, seen = new Set<string>(), restrictive = true): boolean {
  if (!expression) return false
  const value = unwrap(expression)
  if (ts.isStringLiteral(value)) return isFeatureKey(value.text) && (!restrictive || !ALLOW_BY_DEFAULT_FEATURES.has(value.text))
  if (ts.isConditionalExpression(value)) return featureArgument(value.whenTrue, index, seen, restrictive) && featureArgument(value.whenFalse, index, seen, restrictive)
  if (ts.isIdentifier(value) && index && !seen.has(value.text)) {
    const target = resolveDeclaration(index, value.text)
    if (target && !ts.isFunctionDeclaration(target.declaration)) {
      return featureArgument(target.declaration, target.index, new Set(seen).add(value.text), restrictive)
    }
  }
  return ts.isArrayLiteralExpression(value) && value.elements.length > 0
    && value.elements.every(element => featureArgument(element, index, seen, false))
    && (!restrictive || value.elements.some(element => featureArgument(element, index, seen)))
}

function guardKind(index: SourceIndex, expression: ts.Expression, visiting: Set<string>, state = analysisState()): GuardKind | undefined {
  const value = unwrap(expression)
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && guardKind(index, value.right, visiting, state) === 'permissions') return 'permissions'
  if (!ts.isCallExpression(value)) return undefined
  const imported = importedCall(index, value)
  if (imported?.name === 'requireFeature') {
    if (imported.module === '@/lib/require-feature' && authenticatedAuth(value.arguments[0], state)
      && preparedPermission(value.arguments[2], state) && featureArgument(value.arguments[1], index)) return 'response'
    if (imported.module === '@/lib/require-permission' && authenticatedAuth(value.arguments[1], state) && featureArgument(value.arguments[2], index)) return 'result'
    if (imported.module === '@/lib/require-feature'
      && ['/lib/activity-access.ts', '/lib/require-admin-resource.ts'].some(path => index.source.fileName.replaceAll('\\', '/').endsWith(path))
      && authenticatedAuth(value.arguments[0], state) && preparedPermission(value.arguments[2], state) && value.arguments[1]) return 'response'
    // Do not follow the generic implementation to treat a typo or empty key
    // list as a gate. Unmapped feature keys can intentionally default to allow.
    if (['@/lib/require-feature', '@/lib/require-permission'].includes(imported.module)) return undefined
  }
  if (imported?.module === '@/lib/require-admin' && imported.name === 'requireAdmin'
    && !preparedPermission(value.arguments[1], state)) return undefined
  if (imported?.module === '@/lib/require-permission' && imported.name === 'requireManagePermissions'
    && authenticatedAuth(value.arguments[1], state)) return 'result'
  if (imported?.module === '@/lib/require-migration-access' && imported.name === 'requireMigrationAccess'
    && authenticatedAuth(value.arguments[0], state)) return 'response'
  if (imported?.module === '@/lib/permissions' && imported.name === 'resolvePermissions'
    && authenticatedAuth(value.arguments[1], state)) return 'permissions'
  // This stronger founder-only gate is deliberately retained. Its null result
  // must be checked, just like a denied feature response must be returned.
  if (imported?.module === '@/lib/sitemap-auth' && imported.name === 'assertSitemapApiAccess') return 'identity'
  const callee = unwrap(value.expression)
  if (!ts.isIdentifier(callee)) return undefined
  const target = resolveDeclaration(index, callee.text)
  if (target && imported && CONDITIONAL_HELPERS[imported.module]?.includes(imported.name)) {
    let found = false
    const visit = (node: ts.Node): void => {
      if (ts.isBlock(node) && scanStatements(target.index, node.statements, visiting,
        analysisState(forwardedAuth(target.declaration, value, state)))) found = true
      if (!found) ts.forEachChild(node, visit)
    }
    visit(target.declaration)
    if (found) return 'response'
  }
  if (target && guarded(target.index, target.declaration, visiting, forwardedAuth(target.declaration, value, state))) {
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

function expressionKey(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined
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
  if (guardKind(index, condition, visiting, state) === 'response') return allowedReturns.some(result => forbidden(result.expression))
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
      || guardKind(index, denied.expression, new Set(), state) === 'permissions'
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
  state.sourceIndex = index
  for (const [name, imported] of index.imports) {
    if (imported.module === '@/lib/server-auth' && imported.name === 'getRequestAuth') state.requestAuthNames.add(name)
  }
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) invalidateMutations(statement, state)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue
        recordAuth(index, declaration, state)
        const kind = guardKind(index, declaration.initializer, visiting, state)
        if (ts.isIdentifier(declaration.name)) {
          if (denialCall(index, declaration.initializer, state)) state.safeResponses.add(declaration.name.text)
          const value = unwrap(declaration.initializer)
          if (!kind && ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
            const target = resolveDeclaration(index, value.expression.text)
            if (target && identityGuarded(target.index, target.declaration, visiting, forwardedAuth(target.declaration, value, state))
              && nodesWhere(target.declaration, ts.isReturnStatement).some(result => {
                if (!result.expression || !ts.isObjectLiteralExpression(unwrap(result.expression))) return false
                return (unwrap(result.expression) as ts.ObjectLiteralExpression).properties.some(property =>
                  ts.isPropertyAssignment(property) && property.name.getText() === 'response' && forbidden(property.initializer))
              })) state.safeResponses.add(`${declaration.name.text}.response`)
          }
          if (kind === 'response') state.responses.add(declaration.name.text)
          if (kind === 'result') state.results.add(declaration.name.text)
          if (kind === 'permissions') state.permissions.add(declaration.name.text)
          if (kind === 'identity') state.identities.add(declaration.name.text)
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
          ...state, responses: new Set(state.responses), results: new Set(state.results), permissions: new Set(state.permissions),
          identities: new Set(state.identities), cronSecrets: new Set(state.cronSecrets),
        })) return true
    }
    // A try block is unconditional; a guard inside an optional if/loop/callback
    // does not protect the method's other paths and is deliberately ignored.
    if (ts.isTryStatement(statement) && scanStatements(index, statement.tryBlock.statements, visiting, state)) return true
    if (ts.isReturnStatement(statement) && statement.expression) {
      const value = unwrap(statement.expression)
      if (ts.isCallExpression(value) && guardKind(index, value, visiting, state) === 'response') return true
      if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && guarded(index, value, visiting)) return true
    }
    if (unsafeEarlyExit(index, statement, state)) return false
  }
  return false
}

function guarded(index: SourceIndex, declaration: Declaration, visiting = new Set<string>(), trustedAuth: readonly string[] = []): boolean {
  const key = `${index.source.fileName}:${declaration.pos}:${declaration.end}`
  if (visiting.has(key)) return false
  const next = new Set(visiting).add(key)
  if (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) {
    if (!declaration.body) return false
    if (!ts.isBlock(declaration.body)) return guardKind(index, declaration.body, next, analysisState(trustedAuth)) === 'response'
    return scanStatements(index, declaration.body.statements, next, analysisState(trustedAuth))
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

function nodesWhere<T extends ts.Node>(node: ts.Node, predicate: (child: ts.Node) => child is T): T[] {
  const found: T[] = []
  const visit = (child: ts.Node): void => {
    if (predicate(child)) found.push(child)
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function callsNamed(index: SourceIndex, node: ts.Node, name: string, module?: string): ts.CallExpression[] {
  return nodesWhere(node, ts.isCallExpression).filter(call => {
    if (module) { const imported = importedCall(index, call); return imported?.module === module && imported.name === name }
    const value = unwrap(call.expression)
    return ts.isIdentifier(value) && value.text === name || ts.isPropertyAccessExpression(value) && value.name.text === name
  })
}

function returnedStatus(node: ts.Node, status: string): boolean {
  return nodesWhere(node, ts.isReturnStatement).some(statement => forbidden(statement.expression, status))
}

/** Prove source-by-source gates on mixed overview payloads, including local read helpers. */
function querySourcesGuarded(index: SourceIndex, declaration: Declaration, trustedAuth: readonly string[] = [], trustedPermissions: readonly string[] = [], visiting = new Set<string>()): boolean {
  const key = `${index.source.fileName}:${declaration.pos}:${declaration.end}:queries`
  if (visiting.has(key)) return true
  const next = new Set(visiting).add(key)
  const state = analysisState(trustedAuth)
  state.sourceIndex = index
  for (const name of trustedPermissions) state.permissions.add(name)
  const featureFlags = new Map<string, string>()
  for (const binding of nodesWhere(declaration, ts.isVariableDeclaration)) {
    recordAuth(index, binding, state)
    if (!binding.initializer || !ts.isIdentifier(binding.name)) continue
    if (guardKind(index, binding.initializer, new Set(), state) === 'permissions') state.permissions.add(binding.name.text)
    const value = unwrap(binding.initializer)
    if (ts.isCallExpression(value)) {
      const imported = importedCall(index, value)
      if (imported?.module === '@/lib/permissions' && imported.name === 'can'
        && state.permissions.has(expressionKey(value.arguments[0]) ?? '') && ts.isStringLiteral(value.arguments[1])) {
        featureFlags.set(binding.name.text, value.arguments[1].text)
      }
    }
  }
  const featuresFor: Readonly<Record<string, string>> = {
    organisations: 'clients', requests: 'requests', requestParticipants: 'requests', tasks: 'tasks',
    activeTimers: 'time', messages: 'requests', invoices: 'invoices', subscriptions: 'clients',
    financialSnapshots: 'financial_reports', publishHistory: 'content_studio', automationLog: 'settings',
    leads: 'leads', caseStudySubmissions: 'clients', discoveryCalls: 'calls', contractDocuments: 'contracts',
  }
  const allowsFeature = (expression: ts.Expression, feature: string): boolean => {
    const value = unwrap(expression)
    if (ts.isIdentifier(value)) return featureFlags.get(value.text) === feature
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return allowsFeature(value.left, feature) || allowsFeature(value.right, feature)
    }
    if (!ts.isCallExpression(value)) return false
    const imported = importedCall(index, value)
    return imported?.module === '@/lib/permissions' && imported.name === 'can'
      && state.permissions.has(expressionKey(value.arguments[0]) ?? '')
      && ts.isStringLiteral(value.arguments[1]) && value.arguments[1].text === feature
  }
  const sourceFilter = (node: ts.Node, feature: string): boolean => {
    if (ts.isTaggedTemplateExpression(node) && ts.isNoSubstitutionTemplateLiteral(node.template)) return node.template.text.trim() === '0 = 1'
    if (!ts.isCallExpression(node)) return false
    const call = node
    const callee = unwrap(call.expression)
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'where') return !!call.arguments[0] && sourceFilter(call.arguments[0], feature)
    const imported = importedCall(index, call)
    if (imported?.module === 'drizzle-orm' && imported.name === 'and') return call.arguments.some(argument => sourceFilter(argument, feature))
    if (imported?.module === 'drizzle-orm' && imported.name === 'or') return call.arguments.length > 0 && call.arguments.every(argument => sourceFilter(argument, feature))
    if (imported?.module !== '@/lib/internal-route-access' || !state.permissions.has(expressionKey(call.arguments[0]) ?? '')) return false
    const filters = readSource(join(ROOT, 'lib/internal-route-access.ts'))
    const featureFilter = filters.exports.get('internalFeatureOrgFilter')
    if (!featureFilter || !nodesWhere(featureFilter, ts.isReturnStatement).some(result => {
      if (!result.expression || !ts.isConditionalExpression(result.expression)) return false
      const conditional = result.expression
      return callsNamed(filters, conditional.condition, 'can', '@/lib/permissions').some(condition =>
        expressionKey(condition.arguments[0]) === 'access' && expressionKey(condition.arguments[1]) === 'feature')
        && ts.isTaggedTemplateExpression(conditional.whenFalse) && ts.isNoSubstitutionTemplateLiteral(conditional.whenFalse.template)
        && conditional.whenFalse.template.text.trim() === '0 = 1'
    })) return false
    if (imported.name === 'internalFeatureOrgFilter') return ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === feature
    return imported.name === 'internalMessageFilter' && feature === 'requests'
      || imported.name === 'internalTimerFilter' && feature === 'time'
  }
  let queries = 0
  for (const from of callsNamed(index, declaration, 'from')) {
    const table = expressionKey(from.arguments[0])
    if (!table?.startsWith('schema.')) continue
    const name = table.slice(7)
    if (name === 'exchangeRates') continue
    let query: ts.Node = from
    while (query.parent && (ts.isPropertyAccessExpression(query.parent) || ts.isCallExpression(query.parent))) query = query.parent
    if (name === 'teamMembers') {
      if (!callsNamed(index, query, 'eq').some(call => expressionKey(call.arguments[0]) === 'schema.teamMembers.clerkUserId')) return false
      continue
    }
    const feature = featuresFor[name]
    if (!feature) return false
    queries++
    const where = callsNamed(index, query, 'where')
    if (where.some(call => sourceFilter(call, feature))) continue
    let parent: ts.Node | undefined = from.parent
    let conditional = false
    while (parent && parent !== declaration) {
      if (ts.isIfStatement(parent) && allowsFeature(parent.expression, feature)) { conditional = true; break }
      parent = parent.parent
    }
    if (!conditional) return false
  }
  for (const call of nodesWhere(declaration, ts.isCallExpression)) {
    const callee = unwrap(call.expression)
    if (!ts.isIdentifier(callee)) continue
    const helper = index.declarations.get(callee.text)
    if (!helper || !ts.isFunctionDeclaration(helper)) continue
    const permissionParams = helper.parameters.flatMap((parameter, argument) =>
      ts.isIdentifier(parameter.name) && state.permissions.has(expressionKey(call.arguments[argument]) ?? '') ? [parameter.name.text] : [])
    if (permissionParams.length && !querySourcesGuarded(index, helper, [], permissionParams, next)) return false
  }
  return queries > 0
}

function reviewedMixedSources(index: SourceIndex, declaration: Declaration, key: string): boolean {
  if (key === 'GET /api/admin/health') return reviewedLiveness(index, declaration)
  if (key === 'POST /api/admin/exchange-rates') return reviewedAlternateIdentity(index, declaration, key)
  const messaging = reviewedMessagingSources(index, declaration, key)
  if (messaging) return true
  if (['GET /api/admin/overview', 'GET /api/admin/overview/me', 'GET /api/admin/overview/replies-waiting', 'GET /api/admin/overview/wire'].includes(key)) {
    return querySourcesGuarded(index, declaration)
  }
  if (['GET /api/admin/overview/brief', 'POST /api/admin/overview/brief/refresh'].includes(key)) {
    const brief = readSource(join(ROOT, 'lib/overview-brief.ts'))
    const compute = brief.exports.get('computeBrief')
    if (!compute || !querySourcesGuarded(brief, compute, ['auth'])) return false
    const resolver = brief.exports.get('resolveBriefContext')
    if (!resolver) return false
    const fingerprint = callsNamed(brief, resolver, 'briefScopeFingerprint', '@/lib/brief-cache-key')
    const keys = callsNamed(brief, resolver, 'briefCacheKeyForFingerprint', '@/lib/brief-cache-key')
    const featureFilter = callsNamed(brief, resolver, 'can', '@/lib/permissions')
    const featureBinding = nodesWhere(resolver, ts.isVariableDeclaration).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'features')
    const featureList = featureBinding?.initializer ? unwrap(featureBinding.initializer) : undefined
    if (fingerprint.length !== 1 || keys.length !== 1 || featureFilter.length !== 1
      || expressionKey(fingerprint[0].arguments[0]) !== 'allowedOrgs' || expressionKey(fingerprint[0].arguments[1]) !== 'features'
      || expressionKey(keys[0].arguments[0]) !== 'BRIEF_CACHE_KEY' || keys[0].arguments[1] !== fingerprint[0]
      || expressionKey(featureFilter[0].arguments[0]) !== 'access' || expressionKey(featureFilter[0].arguments[1]) !== 'feature'
      || !featureList || !ts.isCallExpression(featureList) || expressionKey(featureList.expression) !== 'BRIEF_FEATURES.filter'
      || !featureList.arguments[0] || !ts.isArrowFunction(featureList.arguments[0]) || featureList.arguments[0].body !== featureFilter[0]
      || !nodesWhere(resolver, ts.isVariableDeclaration).some(binding => ts.isIdentifier(binding.name) && binding.name.text === 'cacheKey'
        && binding.initializer && unwrap(binding.initializer) === keys[0])
      || !callsNamed(brief, resolver, 'resolvePermissions', '@/lib/permissions').some(call => expressionKey(call.arguments[1]) === 'auth')
      || !callsNamed(brief, resolver, 'resolveAccessScoping', '@/lib/access-scoping').some(call => expressionKey(call.arguments[1]) === 'auth.userId')
      || !nodesWhere(resolver, ts.isReturnStatement).some(result => result.expression && ts.isObjectLiteralExpression(result.expression)
        && ['access', 'allowedOrgs', 'cacheKey'].every(name => result.expression && ts.isObjectLiteralExpression(result.expression)
          && result.expression.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === name)))) return false
    const contexts = callsNamed(index, declaration, 'resolveBriefContext', '@/lib/overview-brief')
    const computations = callsNamed(index, declaration, 'computeBrief', '@/lib/overview-brief')
    if (contexts.length !== 1 || computations.length !== 1 || expressionKey(computations[0].arguments[2]) !== 'context'
      || expressionKey(contexts[0].arguments[1]) !== expressionKey(computations[0].arguments[1])
      || !nodesWhere(declaration, ts.isVariableDeclaration).some(binding => ts.isIdentifier(binding.name) && binding.name.text === 'context'
        && binding.initializer && unwrap(binding.initializer) === contexts[0])
      || !nodesWhere(declaration, ts.isVariableDeclaration).some(binding => ts.isObjectBindingPattern(binding.name)
        && expressionKey(binding.initializer ?? ts.factory.createNull()) === 'context'
        && binding.name.elements.some(element => ts.isIdentifier(element.name) && element.name.text === 'cacheKey'))
      || !callsNamed(index, declaration, 'writeBriefCache', '@/lib/overview-brief').every(call => expressionKey(call.arguments[3]) === 'cacheKey')) return false
    if (key.startsWith('GET')) {
      const prepared = contexts[0].arguments[2]
      const denial = nodesWhere(declaration, ts.isIfStatement).find(branch => expressionKey(branch.expression) === 'denied'
        && returns(branch.thenStatement).some(result => expressionKey(result.expression ?? ts.factory.createNull()) === 'denied'))
      return identityGuarded(index, declaration) && expressionKey(contexts[0].arguments[1]) === 'auth'
        && nodesWhere(declaration, ts.isVariableDeclaration).some(binding => ts.isIdentifier(binding.name) && binding.name.text === 'access'
          && binding.initializer && callsNamed(index, binding, 'resolvePermissions', '@/lib/permissions').some(call => unwrap(binding.initializer!) === call
            && expressionKey(call.arguments[1]) === 'auth'))
        && nodesWhere(declaration, ts.isVariableDeclaration).some(binding => ts.isIdentifier(binding.name) && binding.name.text === 'allowedOrgs'
          && binding.initializer && callsNamed(index, binding, 'resolveAccessScoping', '@/lib/access-scoping').some(call => unwrap(binding.initializer!) === call
            && expressionKey(call.arguments[1]) === 'auth.userId'))
        && !!prepared && ts.isObjectLiteralExpression(prepared)
        && ['access', 'allowedOrgs'].every(name => prepared.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === name))
        && checkedNamedCalls(index, declaration, 'requireFeature') === 1
        && callsNamed(index, declaration, 'requireFeature', '@/lib/require-feature').some(call => expressionKey(call.arguments[0]) === 'auth'
          && ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === 'overview' && expressionKey(call.arguments[2]) === 'access')
        && !!denial && ['readBriefCache', 'computeBrief', 'writeBriefCache'].every(name =>
          callsNamed(index, declaration, name, '@/lib/overview-brief').every(call => call.pos > denial.end))
        && callsNamed(index, declaration, 'readBriefCache', '@/lib/overview-brief').some(call => expressionKey(call.arguments[1]) === 'cacheKey')
    }
    const session = nodesWhere(declaration, ts.isIfStatement).find(branch => expressionKey(branch.expression) === 'sessionAuth')
    const computeAuth = nodesWhere(declaration, ts.isVariableDeclaration).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'computeAuth')
    const identity = computeAuth?.initializer ? unwrap(computeAuth.initializer) : undefined
    return identityGuarded(index, declaration) && expressionKey(contexts[0].arguments[1]) === 'computeAuth'
      && !!identity && ts.isBinaryExpression(identity) && identity.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      && expressionKey(identity.left) === 'sessionAuth' && ts.isObjectLiteralExpression(identity.right)
      && identity.right.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText() === 'userId'
        && ts.isStringLiteral(property.initializer) && property.initializer.text === 'api-service')
      && identity.right.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText() === 'orgId'
        && ts.isBinaryExpression(property.initializer) && property.initializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        && expressionKey(property.initializer.left) === 'process.env.NEXT_PUBLIC_TAHI_ORG_ID' && property.initializer.right.kind === ts.SyntaxKind.NullKeyword)
      && contexts[0].arguments.length === 2 && !!session && checkedNamedCalls(index, session, 'requireFeature') === 1
      && callsNamed(index, session, 'requireFeature', '@/lib/require-feature').some(call => expressionKey(call.arguments[0]) === 'sessionAuth'
        && ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === 'overview' && expressionKey(call.arguments[2]) === 'context.access')
  }
  if (key === 'GET /api/admin/guide') {
    return [...index.imports.values()].every(value => ['@/lib/require-feature', '@/lib/server-auth', 'next/server', '@/lib/dashboard-guide'].includes(value.module))
      && callsNamed(index, declaration, 'guideSectionsFor', '@/lib/dashboard-guide').length === 1
  }
  if (key === 'POST /api/admin/cron/suggestion-digest') {
    return identityGuarded(index, declaration)
      && callsNamed(index, declaration, 'resolveAccessScoping', '@/lib/access-scoping').some(call => expressionKey(call.arguments[1]) === 'auth.userId')
      && nodesWhere(declaration, ts.isIfStatement).some(branch => returnedStatus(branch.thenStatement, '403')
        && ts.isPrefixUnaryExpression(unwrap(branch.expression))
        && expressionKey((unwrap(branch.expression) as ts.PrefixUnaryExpression).operand) === 'unrestricted')
  }
  if (key === 'POST /api/admin/crons/suggest-from-transcripts') {
    const manual = index.declarations.get('mayRunManually')
    return !!manual && identityGuarded(index, declaration)
      && ['tasks', 'requests'].every(feature => callsNamed(index, manual, 'can', '@/lib/permissions').some(call =>
        ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === feature))
      && callsNamed(index, manual, 'resolveAccessScoping', '@/lib/access-scoping').length === 1
      && nodesWhere(declaration, ts.isIfStatement).some(branch => returnedStatus(branch.thenStatement, '403')
        && callsNamed(index, branch.expression, 'mayRunManually').some(call => expressionKey(call.arguments[1]) === 'auth.userId'))
  }
  return false
}

function checkedNamedCalls(index: SourceIndex, node: ts.Node, name: string): number {
  let checked = 0
  for (const block of nodesWhere(node, ts.isBlock)) {
    const state = analysisState()
    for (const statement of block.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const binding of statement.declarationList.declarations) {
          if (!binding.initializer || !ts.isIdentifier(binding.name)) continue
          const call = unwrap(binding.initializer)
          if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === name) state.responses.add(binding.name.text)
        }
      }
      if (ts.isIfStatement(statement) && checkedResponse(index, statement, state, new Set())) checked++
    }
  }
  return checked
}

function requestParentGuard(): boolean {
  const parent = readSource(join(ROOT, 'app/api/admin/conversations/_access.ts'))
  const access = parent.exports.get('requireConversationAccess')
  if (!access) return false
  const requestBranch = nodesWhere(access, ts.isIfStatement).find(branch => expressionKey(branch.expression) === 'conversation.requestId')
  if (!requestBranch || !ts.isBlock(requestBranch.thenStatement)) return false
  const requestFunction = ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, requestBranch.thenStatement)
  return guarded(parent, requestFunction, new Set(), ['auth'])
    && callsNamed(parent, access, 'isOrgInScope').length >= 2
    && nodesWhere(access, ts.isIfStatement).some(branch => expressionKey((ts.isPrefixUnaryExpression(unwrap(branch.expression))
      ? (unwrap(branch.expression) as ts.PrefixUnaryExpression).operand : branch.expression)) === 'participant'
      && denialReturn(branch.thenStatement))
}

function reviewedMessagingSources(index: SourceIndex, declaration: Declaration, key: string): boolean {
  const legacyMessages = ['GET /api/admin/conversations/[id]/messages', 'POST /api/admin/conversations/[id]/messages', 'PATCH /api/admin/conversations/[id]/messages']
  if (legacyMessages.includes(key)) {
    return requestParentGuard() && callsNamed(index, declaration, 'requireConversationAccess').length === 1
      && nodesWhere(declaration, ts.isIfStatement).some(branch => ts.isPrefixUnaryExpression(unwrap(branch.expression))
        && expressionKey((unwrap(branch.expression) as ts.PrefixUnaryExpression).operand) === 'access.ok'
        && returns(branch.thenStatement).some(result => expressionKey(result.expression ?? ts.factory.createNull()) === 'access.response'))
  }
  if (key === 'GET /api/admin/conversations') {
    const requestGate = nodesWhere(declaration, ts.isVariableDeclaration).find(binding =>
      ts.isIdentifier(binding.name) && binding.name.text === 'requestDenied' && binding.initializer
      && callsNamed(index, binding, 'requireFeature', '@/lib/require-feature').some(call => ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === 'requests'))
    const filter = nodesWhere(declaration, ts.isIfStatement).find(branch => expressionKey(branch.expression) === 'requestDenied')
    return !!requestGate && !!filter && nodesWhere(filter.thenStatement, ts.isTemplateSpan).some(span => expressionKey(span.expression) === 'schema.conversations.requestId')
      && callsNamed(index, declaration, 'scopedOrgIds', '@/lib/access-scope').length === 1
      && callsNamed(index, declaration, 'isOrgInScope').length >= 1
      && callsNamed(index, declaration, 'eq').some(call => expressionKey(call.arguments[0]) === 'schema.conversationParticipants.participantId')
  }
  if (key === 'POST /api/admin/conversations') {
    const requestBranch = nodesWhere(declaration, ts.isIfStatement).find(branch => expressionKey(branch.expression) === 'requestId')
    return !!requestBranch && checkedNamedCalls(index, requestBranch, 'requireFeature') >= 1
      && callsNamed(index, requestBranch, 'requireFeature', '@/lib/require-feature').some(call => ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === 'requests')
      && callsNamed(index, declaration, 'isOrgInScope').length >= 2
      && checkedNamedCalls(index, declaration, 'requireAccessToOrg') >= 1
  }
  const modern = ['GET /api/admin/messages', 'GET /api/admin/messages/[source]/[id]', 'POST /api/admin/messages/[source]/[id]', 'POST /api/admin/messages/[source]/[id]/read']
  if (!modern.includes(key)) return false
  const shared = readSource(join(ROOT, 'app/api/admin/messages/_shared.ts'))
  const gate = shared.exports.get('gateAdminMessages')
  if (!gate || !identityGuarded(shared, gate)) return false
  const sourceFeature = callsNamed(shared, gate, 'requireFeature', '@/lib/require-feature').find(call => call.arguments[1] && ts.isConditionalExpression(call.arguments[1]))
  if (!sourceFeature || !ts.isConditionalExpression(sourceFeature.arguments[1])
    || !featureArgument(sourceFeature.arguments[1].whenTrue, shared)
    || !callsNamed(shared, gate, 'requireFeature', '@/lib/require-feature').some(call => ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === 'requests')) return false
  if (key === 'GET /api/admin/messages') {
    return callsNamed(index, declaration, 'inboxOrgIds').length === 1
      && callsNamed(index, declaration, 'requireRequestFeature').length === 1
      && nodesWhere(declaration, ts.isPropertyAssignment).some(property => property.name.getText() === 'requestsEnabled'
        && callsNamed(index, property, 'requireRequestFeature').length === 1)
  }
  if (!callsNamed(index, declaration, 'gateAdminMessages').some(call => expressionKey(call.arguments[1]) === 'source')) return false
  if (key.endsWith('/read')) {
    return checkedNamedCalls(index, declaration, 'refuseOutOfScope') >= 2
      && checkedNamedCalls(index, declaration, 'requireRequestFeature') >= 1
  }
  const resolver = index.declarations.get('resolveThread')
  return !!resolver && checkedNamedCalls(index, resolver, 'refuseOutOfScope') >= 3
    && checkedNamedCalls(index, resolver, 'requireRequestFeature') >= 1
    && callsNamed(index, declaration, 'resolveThread').length === 1
}

function reviewedAlternateIdentity(index: SourceIndex, declaration: Declaration, key: string): boolean {
  if (key === 'GET /api/admin/health') return reviewedLiveness(index, declaration)
  const calls = nodesWhere(declaration, ts.isCallExpression)
  const branches = nodesWhere(declaration, ts.isIfStatement)
  if (key === 'POST /api/admin/exchange-rates') {
    const browser = branches.find(branch => {
      const condition = unwrap(branch.expression)
      if (!ts.isPrefixUnaryExpression(condition) || condition.operator !== ts.SyntaxKind.ExclamationToken) return false
      const call = unwrap(condition.operand)
      if (!ts.isCallExpression(call)) return false
      const imported = importedCall(index, call)
      return imported?.module === '@/lib/cron-runs' && imported.name === 'hasCronSecretAuth'
        && call.arguments.length === 1 && expressionKey(call.arguments[0]) === 'req'
    })
    if (!browser || !ts.isBlock(browser.thenStatement) || !ts.isFunctionDeclaration(declaration)
      || declaration.body?.statements[0] !== browser) return false
    const browserFunction = ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, browser.thenStatement)
    return identityGuarded(index, browserFunction) && guarded(index, browserFunction)
      && checkedNamedCalls(index, browserFunction, 'requireFeature') === 1
      && callsNamed(index, browserFunction, 'requireFeature', '@/lib/require-feature').some(call =>
        ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === 'financial_reports')
  }
  if (['GET /api/admin/cron/draft-approved-ideas', 'POST /api/admin/cron/draft-approved-ideas'].includes(key)) {
    return returnedStatus(declaration, '410') && calls.length === 1 && [...index.imports.values()].every(value => value.module === 'next/server')
  }
  if (['GET /api/admin/impersonate/exit', 'POST /api/admin/impersonate/exit'].includes(key)) {
    const clear = index.declarations.get('clear')
    return !!clear && callsNamed(index, declaration, 'clear').length === 1
      && [...index.imports.values()].every(value => ['next/server', '@/lib/preview-cookie'].includes(value.module))
      && callsNamed(index, clear, 'set').length === 2
      && callsNamed(index, clear, 'set').every(call => call.arguments[1]?.kind === ts.SyntaxKind.StringLiteral
        && (call.arguments[1] as ts.StringLiteral).text === '' && ts.isObjectLiteralExpression(call.arguments[2])
        && call.arguments[2].properties.some(property => ts.isPropertyAssignment(property)
          && property.name.getText() === 'maxAge' && ts.isNumericLiteral(property.initializer) && property.initializer.text === '0'))
  }
  if (['GET /api/admin/integrations/google/callback', 'GET /api/admin/integrations/xero/callback'].includes(key)) {
    const invalidState = branches.find(branch => ts.isPrefixUnaryExpression(unwrap(branch.expression))
      && expressionKey((unwrap(branch.expression) as ts.PrefixUnaryExpression).operand) === 'stateValid')
    const stateBinding = nodesWhere(declaration, ts.isVariableDeclaration).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'stateValid')
    const expiryBinding = nodesWhere(declaration, ts.isVariableDeclaration).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'notExpired')
    const expiry = expiryBinding?.initializer ? unwrap(expiryBinding.initializer) : undefined
    const validExpiry = !!expiry && ts.isConditionalExpression(expiry) && expressionKey(expiry.condition) === 'stored.expiresAt'
      && expiry.whenFalse.kind === ts.SyntaxKind.FalseKeyword && ts.isBinaryExpression(expiry.whenTrue)
      && expiry.whenTrue.operatorToken.kind === ts.SyntaxKind.GreaterThanToken
      && ts.isCallExpression(expiry.whenTrue.left) && expressionKey(expiry.whenTrue.left.expression) === 'Date.parse'
      && expressionKey(expiry.whenTrue.left.arguments[0]) === 'stored.expiresAt'
      && ts.isCallExpression(expiry.whenTrue.right) && expressionKey(expiry.whenTrue.right.expression) === 'Date.now'
    const terms = (expression: ts.Expression): ts.Expression[] => {
      const value = unwrap(expression)
      return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ? [...terms(value.left), ...terms(value.right)] : [value]
    }
    const assignments = nodesWhere(declaration, ts.isBinaryExpression).filter(expression => expressionKey(expression.left) === 'stateValid'
      && expression.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && expression.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
    let consumedNonce = false
    const validAssignments = assignments.length > 0 && assignments.every(assignment => {
      if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
      if (unwrap(assignment.right).kind === ts.SyntaxKind.FalseKeyword) return true
      const guards = terms(assignment.right)
      const nonce = guards.some(expression => ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        && expressionKey(expression.left) === 'stored.nonce' && expressionKey(expression.right) === 'returnedState')
      const expires = validExpiry && guards.some(expression => expressionKey(expression) === 'notExpired')
      if (nonce && expires) consumedNonce = true
      return nonce && expires
    })
    const consume = calls.find(call => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'delete'
      && expressionKey(call.arguments[0]) === 'schema.settings')
    const exchange = calls.find(call => ts.isIdentifier(call.expression) && call.expression.text === 'fetch')
    return !!invalidState && returns(invalidState.thenStatement).some(result => forbidden(result.expression, '400'))
      && stateBinding?.initializer?.kind === ts.SyntaxKind.FalseKeyword && validAssignments && consumedNonce
      && !!consume && !!exchange && consume.pos < invalidState.pos && invalidState.end < exchange.pos
  }
  if (key === 'GET /api/admin/permissions/me') {
    return callsNamed(index, declaration, 'getRequestAuth', '@/lib/server-auth').length === 1
      && branches.some(branch => ts.isPrefixUnaryExpression(unwrap(branch.expression))
        && expressionKey((unwrap(branch.expression) as ts.PrefixUnaryExpression).operand) === 'auth.userId'
        && returnedStatus(branch.thenStatement, '401'))
      && callsNamed(index, declaration, 'resolvePermissions', '@/lib/permissions').some(call => expressionKey(call.arguments[1]) === 'auth')
      && !calls.some(call => ts.isPropertyAccessExpression(call.expression) && ['insert', 'update', 'delete'].includes(call.expression.name.text))
  }
  if (key === 'POST /api/admin/team/accept-invite') {
    return callsNamed(index, declaration, 'getRequestAuth', '@/lib/server-auth').length === 1
      && callsNamed(index, declaration, 'resolveInvite', '@/lib/onboarding-invites').length === 1
      && branches.some(branch => returnedStatus(branch.thenStatement, '403')
        && nodesWhere(branch.expression, ts.isBinaryExpression).some(expression => expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
          && expressionKey(expression.left) === 'userEmail' && ts.isCallExpression(expression.right)
          && expressionKey(expression.right.expression) === 'invite.contactEmail.toLowerCase'))
      && branches.some(branch => expressionKey(branch.expression) === 'invite.expired' && returnedStatus(branch.thenStatement, '410'))
      && callsNamed(index, declaration, 'isNull').some(call => expressionKey(call.arguments[0]) === 'schema.onboardingInvites.usedAt')
  }
  if (key === 'POST /api/admin/docs/seed') {
    const secret = nodesWhere(declaration, ts.isVariableDeclaration).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'seedSecret')
    const keyBinding = nodesWhere(declaration, ts.isVariableDeclaration).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'keyOk')
    const browser = branches.find(branch => ts.isPrefixUnaryExpression(unwrap(branch.expression))
      && expressionKey((unwrap(branch.expression) as ts.PrefixUnaryExpression).operand) === 'keyOk')
    if (!secret?.initializer || expressionKey(secret.initializer) !== 'process.env.TAHI_API_TOKEN' || !keyBinding || !browser) return false
    const checkedSecret = callsNamed(index, keyBinding, 'timingSafeEqual').some(call => expressionKey(call.arguments[0]) === 'seedKey'
      && expressionKey(call.arguments[1]) === 'seedSecret')
    const browserFunction = ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined,
      ts.isBlock(browser.thenStatement) ? browser.thenStatement : ts.factory.createBlock([browser.thenStatement]))
    return checkedSecret && identityGuarded(index, browserFunction)
  }
  return false
}

function reviewedLiveness(index: SourceIndex, declaration: Declaration): boolean {
  if (!ts.isFunctionDeclaration(declaration) || !declaration.body) return false
  const timestamp = declaration.body.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations] : []).find(binding => ts.isIdentifier(binding.name) && binding.name.text === 'timestamp')
  if (!timestamp?.initializer || !ts.isCallExpression(timestamp.initializer)
    || !ts.isPropertyAccessExpression(timestamp.initializer.expression) || timestamp.initializer.expression.name.text !== 'toISOString'
    || !ts.isNewExpression(timestamp.initializer.expression.expression)
    || expressionKey(timestamp.initializer.expression.expression.expression) !== 'Date') return false
  const state = analysisState()
  for (const statement of declaration.body.statements) {
    if (ts.isVariableStatement(statement)) for (const binding of statement.declarationList.declarations) recordAuth(index, binding, state)
    if (!ts.isIfStatement(statement) || !studioDenial(index, statement.expression, state)) continue
    const exits = returns(statement.thenStatement)
    if (exits.length !== 1 || !exits[0].expression || !ts.isCallExpression(exits[0].expression)) return false
    const payload = exits[0].expression.arguments[0]
    if (!payload || !ts.isObjectLiteralExpression(payload) || payload.properties.length !== 2
      || !payload.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText() === 'ok' && property.initializer.kind === ts.SyntaxKind.TrueKeyword)
      || !payload.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === 'timestamp')) return false
    const remaining = ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined,
      ts.factory.createBlock(declaration.body.statements.filter(candidate => candidate !== statement)))
    return guarded(index, remaining) && identityGuarded(index, remaining)
  }
  return false
}

function denialReturn(statement: ts.Statement): boolean {
  if (ts.isThrowStatement(statement) && ts.isNewExpression(statement.expression)) {
    return statement.expression.arguments?.some(argument => ts.isNumericLiteral(argument) && ['401', '403'].includes(argument.text)) === true
  }
  return returns(statement).some(result => {
    if (forbidden(result.expression) || forbidden(result.expression, '401') || forbidden(result.expression, '404')) return true
    if (!result.expression || !ts.isObjectLiteralExpression(unwrap(result.expression))) return false
    return (unwrap(result.expression) as ts.ObjectLiteralExpression).properties.some(property =>
      ts.isPropertyAssignment(property) && ['response', 'denied'].includes(property.name.getText())
      && (forbidden(property.initializer) || forbidden(property.initializer, '401')))
  })
}

function studioDenial(index: SourceIndex, expression: ts.Expression, state: AnalysisState): boolean {
  const value = unwrap(expression)
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    && authPart(value.left, 'userId', state)) {
    const expected = unwrap(value.right)
    const imported = ts.isIdentifier(expected) ? index.imports.get(expected.text) : undefined
    return ts.isStringLiteral(expected) && expected.text === 'api-service'
      || imported?.module === '@/lib/team-identity' && imported.name === 'SERVICE_USER_ID'
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return studioDenial(index, value.left, state) || studioDenial(index, value.right, state)
  }
  if (!ts.isPrefixUnaryExpression(value) || value.operator !== ts.SyntaxKind.ExclamationToken) return false
  const operand = unwrap(value.operand)
  if (!ts.isCallExpression(operand)) return state.cronSecrets.has(expressionKey(operand) ?? '')
  const imported = importedCall(index, operand)
  if (imported?.module === '@/lib/server-auth' && imported.name === 'isTahiAdmin') {
    return !!operand.arguments[0] && authPart(operand.arguments[0], 'orgId', state)
  }
  return imported?.module === '@/lib/cron-runs' && imported.name === 'hasCronSecretAuth'
}

function identityGuarded(index: SourceIndex, declaration: Declaration, visiting = new Set<string>(), trustedAuth: readonly string[] = []): boolean {
  const key = `${index.source.fileName}:${declaration.pos}:${declaration.end}:studio`
  if (visiting.has(key)) return false
  const next = new Set(visiting).add(key)
  const state = analysisState(trustedAuth)
  state.sourceIndex = index
  for (const [name, imported] of index.imports) {
    if (imported.module === '@/lib/server-auth' && imported.name === 'getRequestAuth') state.requestAuthNames.add(name)
  }
  const callKind = (expression: ts.Expression): GuardKind | undefined => {
    const call = unwrap(expression)
    if (!ts.isCallExpression(call)) return undefined
    const callee = unwrap(call.expression)
    if (!ts.isIdentifier(callee)) return undefined
    const target = resolveDeclaration(index, callee.text)
    if (!target) return undefined
    const imported = importedCall(index, call)
    let verified = identityGuarded(target.index, target.declaration, next, forwardedAuth(target.declaration, call, state))
    if (!verified && imported && CONDITIONAL_HELPERS[imported.module]?.includes(imported.name)) {
      const visit = (node: ts.Node): void => {
        if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && identityGuarded(target.index, node, next)) verified = true
        if (!verified) ts.forEachChild(node, visit)
      }
      visit(target.declaration)
    }
    if (!verified) return undefined
    if (importedCall(index, call)?.name === 'assertSitemapApiAccess') return 'identity'
    let structured = false
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ['ok', 'denied'].includes(node.name.getText())) structured = true
      ts.forEachChild(node, visit)
    }
    visit(target.declaration)
    return structured ? 'result' : 'response'
  }
  const scan = (statements: readonly ts.Statement[]): boolean => {
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement)) invalidateMutations(statement, state)
      if (ts.isVariableStatement(statement)) {
        for (const binding of statement.declarationList.declarations) {
          recordAuth(index, binding, state)
          if (!binding.initializer) continue
          const kind = callKind(binding.initializer)
          if ((guardKind(index, binding.initializer, next, state) === 'response' || denialCall(index, binding.initializer, state))
            && ts.isIdentifier(binding.name)) state.safeResponses.add(binding.name.text)
          if (ts.isObjectBindingPattern(binding.name) && kind === 'result') {
            for (const element of binding.name.elements) {
              if ((element.propertyName?.getText() ?? element.name.getText()) === 'denied' && ts.isIdentifier(element.name)) state.responses.add(element.name.text)
            }
          }
          if (!ts.isIdentifier(binding.name)) continue
          if (kind === 'response') state.responses.add(binding.name.text)
          if (kind === 'result') state.results.add(binding.name.text)
          if (kind === 'identity') state.identities.add(binding.name.text)
          const value = unwrap(binding.initializer)
          const imported = ts.isCallExpression(value) ? importedCall(index, value) : undefined
          if (imported?.module === '@/lib/cron-runs' && imported.name === 'hasCronSecretAuth') state.cronSecrets.add(binding.name.text)
        }
      }
      if (ts.isIfStatement(statement)) {
        if (studioDenial(index, statement.expression, state) && (denialReturn(statement.thenStatement)
          || returns(statement.thenStatement).some(result => result.expression?.kind === ts.SyntaxKind.NullKeyword))) return true
        const conditionKey = expressionKey(statement.expression)
        const delegatedDenial = conditionKey && state.responses.has(conditionKey)
          || ts.isPrefixUnaryExpression(unwrap(statement.expression))
            && (state.results.has((expressionKey((unwrap(statement.expression) as ts.PrefixUnaryExpression).operand) ?? '').replace(/\.ok$/, ''))
              || state.identities.has(expressionKey((unwrap(statement.expression) as ts.PrefixUnaryExpression).operand) ?? ''))
        if (delegatedDenial && checkedResponse(index, statement, state, next)) return true
        const condition = unwrap(statement.expression)
        if (ts.isPrefixUnaryExpression(condition) && state.cronSecrets.has(expressionKey(condition.operand) ?? '')
          && ts.isBlock(statement.thenStatement) && scan(statement.thenStatement.statements)) return true
      }
      if (ts.isTryStatement(statement) && scan(statement.tryBlock.statements)) return true
      if (ts.isReturnStatement(statement) && statement.expression) {
        const value = unwrap(statement.expression)
        if (ts.isCallExpression(value) && callKind(value)) return true
        if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && identityGuarded(index, value, next, trustedAuth)) return true
      }
      if (unsafeEarlyExit(index, statement, state)) return false
    }
    return false
  }
  if (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) {
    if (!declaration.body) return false
    return ts.isBlock(declaration.body) ? scan(declaration.body.statements) : !!callKind(declaration.body)
  }
  const value = unwrap(declaration)
  if (ts.isIdentifier(value)) {
    const target = resolveDeclaration(index, value.text)
    return !!target && identityGuarded(target.index, target.declaration, next, trustedAuth)
  }
  if (ts.isCallExpression(value)) {
    const callee = unwrap(value.expression)
    const target = ts.isIdentifier(callee) ? resolveDeclaration(index, callee.text) : undefined
    return !!target && identityGuarded(target.index, target.declaration, next, forwardedAuth(target.declaration, value, state))
  }
  return false
}

function sample(text: string): SourceIndex {
  return indexSource(join(ROOT, 'app', 'api', '__guard_sample__.ts'), text)
}

describe('admin HTTP method guard walk', () => {
  it.each([
    { name: 'checked session guards', studio: true, feature: 'checked', key: 'financial_reports', early: false, accepted: true },
    { name: 'missing studio identity', studio: false, feature: 'checked', key: 'financial_reports', early: false, accepted: false },
    { name: 'unchecked feature denial', studio: true, feature: 'unchecked', key: 'financial_reports', early: false, accepted: false },
    { name: 'missing feature guard', studio: true, feature: 'missing', key: 'financial_reports', early: false, accepted: false },
    { name: 'an unrelated feature guard', studio: true, feature: 'checked', key: 'tasks', early: false, accepted: false },
    { name: 'an early successful return', studio: true, feature: 'checked', key: 'financial_reports', early: true, accepted: false },
  ])('reviews the exchange-rate cron identity with $name', ({ studio, feature, key, early, accepted }) => {
    const index = sample(`
      import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
      import { hasCronSecretAuth } from '@/lib/cron-runs'
      import { requireFeature } from '@/lib/require-feature'
      export async function POST(req: Request) {
        ${early ? 'return Response.json({ secret: true })' : ''}
        if (!hasCronSecretAuth(req)) {
          const auth = await getRequestAuth(req)
          ${studio ? "if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })" : ''}
          ${feature === 'missing' ? '' : `const denied = await requireFeature(auth, '${key}')`}
          ${feature === 'checked' ? 'if (denied) return denied' : ''}
        }
        return Response.json({ ok: true })
      }
    `)
    const declaration = index.exports.get('POST')!
    expect(reviewedAlternateIdentity(index, declaration, 'POST /api/admin/exchange-rates')).toBe(accepted)
    expect(reviewedMixedSources(index, declaration, 'POST /api/admin/exchange-rates')).toBe(accepted)
  })

  it.each([
    { name: 'the shared prepared context', before: '', after: '', accepted: true },
    { name: 'missing prepared context', before: 'auth, { access, allowedOrgs }', after: 'auth', accepted: false },
    { name: 'forged prepared permissions', before: 'auth, { access, allowedOrgs }', after: 'auth, { access: {}, allowedOrgs }', accepted: false },
    { name: 'missing compute context', before: 'computeBrief(drizzle, auth, context)', after: 'computeBrief(drizzle, auth)', accepted: false },
    { name: 'a mismatched compute context', before: 'computeBrief(drizzle, auth, context)', after: 'computeBrief(drizzle, auth, otherContext)', accepted: false },
    { name: 'an unscoped cache read', before: 'readBriefCache(drizzle, cacheKey)', after: 'readBriefCache(drizzle)', accepted: false },
    { name: 'an early cache read', before: "const denied = await requireFeature(auth, 'overview', access)", after: "await readBriefCache(drizzle, cacheKey)\n  const denied = await requireFeature(auth, 'overview', access)", accepted: false },
  ])('reviews the brief with $name', ({ before, after, accepted }) => {
    const source = readFileSync(join(ROOT, 'app/api/admin/overview/brief/route.ts'), 'utf8')
    const index = sample(before ? source.replace(before, after) : source)
    expect(reviewedMixedSources(index, index.exports.get('GET')!, 'GET /api/admin/overview/brief')).toBe(accepted)
  })

  it.each([
    { name: 'mutated service identity after a real studio check', identity: true, body: `
      const auth = await getRequestAuth(req)
      if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
      auth.userId = 'api-service'
      const denied = await requireFeature(auth, 'tasks')
      if (denied) return denied
    ` },
    { name: 'forged optional prepared permissions', identity: true, body: `
      const auth = await getRequestAuth(req)
      if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
      const denied = await requireFeature(auth, 'tasks', { isSuperAdmin: true })
      if (denied) return denied
    ` },
    { name: 'locally shadowed request authentication', identity: false, body: `
      const getRequestAuth = async () => ({ userId: 'api-service', orgId: 'org_tahi' })
      const auth = await getRequestAuth(req)
      if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
      const denied = await requireFeature(auth, 'tasks')
      if (denied) return denied
    ` },
    { name: 'an early successful return before both guards', identity: false, body: `
      if (req.url.includes('bypass')) return Response.json({ secret: true })
      const auth = await getRequestAuth(req)
      if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
      const denied = await requireFeature(auth, 'tasks')
      if (denied) return denied
    ` },
    { name: 'auth mutation through an alias', identity: true, body: `
      const auth = await getRequestAuth(req)
      const alias = auth
      if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
      alias.userId = 'api-service'
      const denied = await requireFeature(auth, 'tasks')
      if (denied) return denied
    ` },
    { name: 'auth mutation before the studio check', identity: false, body: `
      const auth = await getRequestAuth(req)
      auth.orgId = 'org_tahi'
      if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
      const denied = await requireFeature(auth, 'tasks')
      if (denied) return denied
    ` },
  ])('rejects $name', ({ body, identity }) => {
    const index = sample(`
      import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
      import { requireFeature } from '@/lib/require-feature'
      export async function GET(req: Request) { ${body}; return Response.json({ secret: true }) }
    `)
    expect(guarded(index, index.exports.get('GET')!)).toBe(false)
    expect(identityGuarded(index, index.exports.get('GET')!)).toBe(identity)
  })

  it('accepts prepared permissions only when resolved from authenticated auth', () => {
    const index = sample(`
      import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
      import { resolvePermissions } from '@/lib/permissions'
      import { requireFeature } from '@/lib/require-feature'
      export async function GET(req: Request) {
        const auth = await getRequestAuth(req)
        if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
        const access = await resolvePermissions(database, auth)
        const denied = await requireFeature(auth, 'tasks', access)
        if (denied) return denied
        return Response.json({ items: [] })
      }
      export async function POST(req: Request) {
        const auth = await getRequestAuth(req)
        if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
        const access = await resolvePermissions(database, auth)
        access.isSuperAdmin = true
        const denied = await requireFeature(auth, 'tasks', access)
        if (denied) return denied
        return Response.json({ secret: true })
      }
    `)
    expect(guarded(index, index.exports.get('GET')!)).toBe(true)
    expect(guarded(index, index.exports.get('POST')!)).toBe(false)
    expect(identityGuarded(index, index.exports.get('GET')!)).toBe(true)
    expect(identityGuarded(index, index.exports.get('POST')!)).toBe(true)
  })

  it('requires nonce and expiry to determine the consumed OAuth state result', () => {
    const invalid = sample(`
      export async function GET(req: Request) {
        const returnedState = url.searchParams.get('state')
        const stored = JSON.parse(stateRow.value)
        await stateDb.delete(schema.settings)
        const unusedNonce = stored.nonce === returnedState
        const unusedExpiry = Date.parse(stored.expiresAt) > Date.now()
        const stateValid = true
        if (!stateValid) return Response.json({}, { status: 400 })
        return fetch('https://oauth.example/token')
      }
    `)
    const valid = sample(`
      export async function GET(req: Request) {
        const returnedState = url.searchParams.get('state')
        const stored = JSON.parse(stateRow.value)
        await stateDb.delete(schema.settings)
        let stateValid = false
        const notExpired = stored.expiresAt ? Date.parse(stored.expiresAt) > Date.now() : false
        stateValid = stored.nonce === returnedState && notExpired
        if (!stateValid) return Response.json({}, { status: 400 })
        return fetch('https://oauth.example/token')
      }
    `)
    expect(reviewedAlternateIdentity(invalid, invalid.exports.get('GET')!, 'GET /api/admin/integrations/google/callback')).toBe(false)
    expect(reviewedAlternateIdentity(valid, valid.exports.get('GET')!, 'GET /api/admin/integrations/google/callback')).toBe(true)
  })

  it('requires every SQL OR branch to preserve its feature fence', () => {
    const index = sample(`
      import { getRequestAuth } from '@/lib/server-auth'
      import { resolvePermissions } from '@/lib/permissions'
      import { internalFeatureOrgFilter } from '@/lib/internal-route-access'
      import { and, or, sql } from 'drizzle-orm'
      export async function GET(req: Request) {
        const auth = await getRequestAuth(req)
        const access = await resolvePermissions(database, auth)
        return database.select().from(schema.requests).where(or(internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId), sql\`1 = 1\`))
      }
      export async function POST(req: Request) {
        const auth = await getRequestAuth(req)
        const access = await resolvePermissions(database, auth)
        return database.select().from(schema.requests).where(and(internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId), sql\`1 = 1\`))
      }
      export async function PATCH(req: Request) {
        const auth = await getRequestAuth(req)
        const access = await resolvePermissions(database, auth)
        return database.select().from(schema.requests).where(or(internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId), internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId)))
      }
    `)
    expect(querySourcesGuarded(index, index.exports.get('GET')!)).toBe(false)
    expect(querySourcesGuarded(index, index.exports.get('POST')!)).toBe(true)
    expect(querySourcesGuarded(index, index.exports.get('PATCH')!)).toBe(true)
  })

  it.each(['overview', 'messages', 'help', 'sitemap'])('rejects %s as the only feature gate', feature => {
    const index = sample(`
      import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
      import { requireFeature } from '@/lib/require-feature'
      export async function GET(req: Request) {
        const auth = await getRequestAuth(req)
        if (!isTahiAdmin(auth.orgId)) return Response.json({}, { status: 403 })
        const denied = await requireFeature(auth, '${feature}')
        if (denied) return denied
        return Response.json({ secret: 'unfiltered' })
      }
    `)
    expect(identityGuarded(index, index.exports.get('GET')!)).toBe(true)
    expect(guarded(index, index.exports.get('GET')!)).toBe(false)
  })

  it('rejects forged guard auth, unverified identity arguments, and a feature gate without studio identity', () => {
    const index = sample(`
      import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
      import { requireFeature } from '@/lib/require-feature'
      import { requireAdmin } from '@/lib/require-admin'
      export async function GET(req: Request) {
        const auth = await getRequestAuth(req)
        const denied = await requireFeature({ userId: 'api-service', orgId: 'org_tahi' }, 'tasks')
        if (denied) return denied
        return Response.json({})
      }
      export async function POST(req: Request) {
        const auth = await getRequestAuth(req)
        const denied = await requireAdmin({ userId: 'api-service', orgId: 'org_tahi' })
        if (denied) return denied
        return Response.json({})
      }
      export async function PUT(req: Request) {
        const auth = await getRequestAuth(req)
        const denied = await requireFeature(auth, 'tasks')
        if (denied) return denied
        return Response.json({})
      }
      export async function DELETE(req: Request) {
        const auth = await getRequestAuth(req)
        if (!isTahiAdmin('org_tahi')) return Response.json({}, { status: 403 })
        const denied = await requireFeature(auth, 'tasks')
        if (denied) return denied
        return Response.json({})
      }
      export async function PATCH(req: Request) {
        const { userId: actor, orgId: studio } = await getRequestAuth(req)
        if (!isTahiAdmin(studio)) return Response.json({}, { status: 403 })
        const denied = await requireFeature({ userId: actor, orgId: studio }, 'tasks')
        if (denied) return denied
        return Response.json({})
      }
    `)
    for (const method of ['GET', 'POST']) expect(guarded(index, index.exports.get(method)!), method).toBe(false)
    for (const method of ['PUT', 'DELETE']) expect(identityGuarded(index, index.exports.get(method)!), method).toBe(false)
    expect(guarded(index, index.exports.get('PATCH')!)).toBe(true)
    expect(identityGuarded(index, index.exports.get('PATCH')!)).toBe(true)
  })

  it('requires mixed-source filters to be consumed by the real query, with authenticated resolved permissions', () => {
    const index = sample(`
      import { getRequestAuth } from '@/lib/server-auth'
      import { resolvePermissions } from '@/lib/permissions'
      import { internalFeatureOrgFilter } from '@/lib/internal-route-access'
      export async function GET(req: Request) {
        const auth = await getRequestAuth(req)
        const access = await resolvePermissions(database, auth)
        const unused = internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId)
        return database.select().from(schema.requests).where(eq(schema.requests.id, id))
      }
      export async function POST(req: Request) {
        const access = await resolvePermissions(database, { userId: 'api-service', orgId: 'org_tahi' })
        return database.select().from(schema.requests).where(internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId))
      }
      export async function PATCH(req: Request) {
        const auth = await getRequestAuth(req)
        const access = await resolvePermissions(database, auth)
        return database.select().from(schema.requests).where(internalFeatureOrgFilter(access, 'requests', scope, schema.requests.orgId))
      }
    `)
    expect(querySourcesGuarded(index, index.exports.get('GET')!)).toBe(false)
    expect(querySourcesGuarded(index, index.exports.get('POST')!)).toBe(false)
    expect(querySourcesGuarded(index, index.exports.get('PATCH')!)).toBe(true)
  })

  it('requires a verified studio identity or reviewed alternate identity before every admin method', () => {
    const gaps: string[] = []
    for (const path of routeFiles(join(ROOT, 'app', 'api', 'admin'))) {
      const index = readSource(path)
      const pathname = `/${relative(join(ROOT, 'app'), path).replaceAll('\\', '/').replace(/\/route\.ts$/, '')}`
      for (const [method, declaration] of index.exports) {
        if (!METHODS.has(method)) continue
        const key = `${method} ${pathname}`
        if (!identityGuarded(index, declaration) && !reviewedAlternateIdentity(index, declaration, key)) gaps.push(key)
      }
    }
    expect(gaps, `Admin identity gaps:\n${gaps.join('\n')}`).toEqual([])
  })
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
        if (guarded(index, declaration) || reviewedMixedSources(index, declaration, key)) {
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
      import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
      export async function GET(req: Request) {
        const auth = await getRequestAuth(req)
        const denied = await requireFeature(auth, 'tasks')
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
      import { getRequestAuth } from '@/lib/server-auth'
      export const GET = defineAdminRoute(async () => Response.json({}), { feature: 'tasks' })
      export const POST = defineAdminRoute(async () => Response.json({}))
      export async function PUT(req: Request) {
        const auth = await getRequestAuth(req)
        const access = await resolvePermissions(database, auth)
        if (!access.canManagePermissions) return Response.json({}, { status: 403 })
        return Response.json({})
      }
      export async function PATCH() {
        const access = { isAdmin: true }
        if (!access.isAdmin) return Response.json({}, { status: 403 })
        return Response.json({})
      }
      export async function DELETE(req: Request) {
        const auth = await getRequestAuth(req)
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
