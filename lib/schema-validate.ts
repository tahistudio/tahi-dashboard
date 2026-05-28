/**
 * JSON-LD structural validator — Phase I · Slice 9.
 *
 * Catches the schema.org / Rich-Results errors our generator could emit
 * BEFORE the markup ships to Webflow, so backfilled + freshly-drafted
 * posts don't fail validation in the wild.
 *
 * This is a pragmatic structural linter for the @types we actually emit
 * (Article, FAQPage, HowTo, Organization, Person, BreadcrumbList,
 * SpeakableSpecification), encoding Google's Rich Results requirements +
 * common schema.org gotchas (bad dates, empty required fields, dangling
 * @id references). It is NOT a full schema.org engine — for the
 * authoritative verdict we also surface Google's own rich-results result
 * from the GSC URL Inspection API per live URL (see health scan).
 */

export interface SchemaIssue {
  severity: 'error' | 'warning'
  node: string            // e.g. 'Article', 'FAQPage#faq-2'
  field: string
  message: string
}

export interface SchemaValidationResult {
  valid: boolean          // false if any error-severity issues
  errors: SchemaIssue[]
  warnings: SchemaIssue[]
}

interface GraphNode {
  '@type'?: string | string[]
  '@id'?: string
  [k: string]: unknown
}

function isIsoDate(v: unknown): boolean {
  if (typeof v !== 'string' || v.trim() === '') return false
  // Accept full ISO 8601 (date or datetime). Date.parse is lenient, so
  // also require it look like a date string.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return false
  return !Number.isNaN(Date.parse(v))
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function typeOf(node: GraphNode): string {
  const t = node['@type']
  return Array.isArray(t) ? (t[0] ?? '') : (t ?? '')
}

/** Validate a JSON-LD string (expects a single object, optionally with a
 *  @graph array of nodes). */
export function validateJsonLd(jsonLdString: string): SchemaValidationResult {
  const errors: SchemaIssue[] = []
  const warnings: SchemaIssue[] = []
  const push = (severity: 'error' | 'warning', node: string, field: string, message: string) => {
    (severity === 'error' ? errors : warnings).push({ severity, node, field, message })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonLdString)
  } catch (err) {
    return {
      valid: false,
      errors: [{ severity: 'error', node: 'root', field: 'json', message: `Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}` }],
      warnings: [],
    }
  }

  const root = parsed as { '@graph'?: GraphNode[] } & GraphNode
  const nodes: GraphNode[] = Array.isArray(root['@graph']) ? root['@graph'] : [root]
  if (nodes.length === 0) {
    return { valid: false, errors: [{ severity: 'error', node: 'root', field: '@graph', message: 'No nodes' }], warnings: [] }
  }

  // Collect declared @ids so we can flag dangling references.
  const declaredIds = new Set<string>()
  for (const n of nodes) if (n['@id']) declaredIds.add(n['@id'])

  const refOk = (ref: unknown): boolean => {
    if (ref == null) return true
    if (typeof ref === 'object' && ref !== null) {
      const id = (ref as GraphNode)['@id']
      // A nested object with its own @type is self-contained; a bare @id
      // ref must resolve to a declared node.
      if ((ref as GraphNode)['@type']) return true
      if (typeof id === 'string') return declaredIds.has(id)
    }
    return true
  }

  for (const node of nodes) {
    const t = typeOf(node)
    const label = node['@id'] ? `${t}` : t

    if (!t) {
      push('error', 'unknown', '@type', 'Node missing @type')
      continue
    }

    switch (t) {
      case 'Article':
      case 'BlogPosting': {
        if (!nonEmptyString(node.headline)) push('error', label, 'headline', 'Required headline missing/empty')
        if (typeof node.headline === 'string' && node.headline.length > 110) push('warning', label, 'headline', 'headline > 110 chars (Google truncates)')
        if (!node.image) push('error', label, 'image', 'Required image missing')
        if (!isIsoDate(node.datePublished)) push('error', label, 'datePublished', `datePublished not ISO 8601: "${String(node.datePublished)}"`)
        if (node.dateModified != null && !isIsoDate(node.dateModified)) push('error', label, 'dateModified', `dateModified not ISO 8601: "${String(node.dateModified)}"`)
        if (!node.author) push('error', label, 'author', 'Required author missing')
        else if (!refOk(node.author)) push('error', label, 'author', 'author @id does not resolve to a node in @graph')
        if (node.publisher && !refOk(node.publisher)) push('error', label, 'publisher', 'publisher @id does not resolve')
        break
      }
      case 'FAQPage': {
        const me = node.mainEntity
        if (!Array.isArray(me) || me.length === 0) {
          push('error', label, 'mainEntity', 'FAQPage has no questions')
        } else {
          me.forEach((q, i) => {
            const qn = q as GraphNode
            if (typeOf(qn) !== 'Question') push('error', `${label}#q${i + 1}`, '@type', 'mainEntity item is not a Question')
            if (!nonEmptyString(qn.name)) push('error', `${label}#q${i + 1}`, 'name', 'Question missing name')
            const ans = qn.acceptedAnswer as GraphNode | undefined
            if (!ans || typeOf(ans) !== 'Answer' || !nonEmptyString(ans.text)) {
              push('error', `${label}#q${i + 1}`, 'acceptedAnswer', 'Question missing acceptedAnswer.text')
            }
          })
        }
        break
      }
      case 'HowTo': {
        if (!nonEmptyString(node.name)) push('error', label, 'name', 'HowTo missing name')
        const step = node.step
        if (!Array.isArray(step) || step.length === 0) push('error', label, 'step', 'HowTo has no steps')
        break
      }
      case 'Organization': {
        if (!nonEmptyString(node.name)) push('error', label, 'name', 'Organization missing name')
        if (!nonEmptyString(node.url)) push('warning', label, 'url', 'Organization missing url')
        break
      }
      case 'Person': {
        if (!nonEmptyString(node.name)) push('error', label, 'name', 'Person missing name')
        break
      }
      case 'BreadcrumbList': {
        const items = node.itemListElement
        if (!Array.isArray(items) || items.length === 0) push('error', label, 'itemListElement', 'BreadcrumbList has no items')
        else items.forEach((it, i) => {
          const li = it as GraphNode
          if (li.position == null) push('warning', `${label}#${i + 1}`, 'position', 'ListItem missing position')
          if (!li.item && !li.name) push('error', `${label}#${i + 1}`, 'item', 'ListItem missing item/name')
        })
        break
      }
      case 'SpeakableSpecification': {
        // schema.org marks speakable as pending; Google supports it but the
        // standalone schema.org validator flags it. Downgrade to warning so
        // it doesn't block, but surface it.
        push('warning', label, 'speakable', 'SpeakableSpecification is in the schema.org pending namespace — validator.schema.org flags it as unrecognised. Safe for Google, ignore the schema.org warning or drop the node.')
        break
      }
      default:
        // Unknown type — not necessarily wrong, just not checked.
        break
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
