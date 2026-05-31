/**
 * Shared schema constants used by both blog-schema.ts and
 * glossary-schema.ts. Single source of truth for Tahi org info +
 * author profiles so the two generators stay aligned and we don't
 * ship inconsistent Organization/Person nodes across content types.
 */

export const TAHI_ORG_ID = 'https://www.tahi.studio/#organization'
export const TAHI_LOGO_URL_CONST: string | null = 'https://cdn.prod.website-files.com/68124c3b4cfbe0b7add051c7/684d9a3c28430b73ff22d3e1_Light%20Icon%20with%20Background%20Padding%20(1).png'
export const TAHI_FOUNDING_DATE = '2023-01-01'
export const TAHI_AREAS_SERVED = ['United Kingdom', 'New Zealand', 'United States', 'Australia']
export const TAHI_LOCATION_CREATED = 'Wellington, New Zealand'
export const TAHI_CONTACT_EMAIL = 'business@tahi.studio'

export const TAHI_KNOWS_ABOUT = [
  'Webflow',
  'Enterprise Web Design',
  'Design Systems',
  'Webflow Migration',
  'Web Accessibility',
  'Sustainable Web',
  'B2B SaaS Websites',
]

export interface AuthorProfile {
  jobTitle: string
  description?: string
  imageUrl?: string
  linkedinUrl?: string
  xUrl?: string
  nationality?: string
  /** Legal / alternate name when the byline differs from it. */
  alternateName?: string
}

export const AUTHOR_PROFILES: Record<string, AuthorProfile> = {
  'Liam Miller': {
    jobTitle: 'Co-Founder and CEO',
    description: 'Co-Founder and CEO of Tahi Studio, a New Zealand Webflow agency. Builds production Webflow sites for B2B SaaS and enterprise marketing teams, with a focus on performance, design systems, and accessibility.',
    imageUrl: 'https://cdn.prod.website-files.com/683b25a978bfb921944c89bf/69bb3724f39337cf91c1b06c_688dfab3c8e03e6e612141c7_Liam%2520Profile.png',
    linkedinUrl: 'https://nz.linkedin.com/in/liammillerdev',
    nationality: 'New Zealand',
  },
  'Staci Bonnie': {
    jobTitle: 'Co-Founder and Head of Design',
    description: 'Co-Founder and Head of Design at Tahi Studio. Designs brand systems and Webflow templates for enterprise and SaaS clients, with a focus on craft, accessibility, and sustainable web.',
    imageUrl: 'https://cdn.prod.website-files.com/683b25a978bfb921944c89bf/69bb3724f39337cf91c1b072_68a6de99797cec6da2544932_Staci%2520Profile%2520Image.png',
    // linkedinUrl: TODO — paste Staci's LinkedIn here when confirmed.
    nationality: 'New Zealand',
    alternateName: 'Staci Miller',
  },
}

export const AUTHOR_KNOWS_ABOUT: Record<string, string[]> = {
  'Liam Miller': [
    'Enterprise Webflow',
    'Webflow Development',
    'B2B SaaS Websites',
    'Webflow Migration',
    'Design Systems',
    'Web Performance',
    'Headless CMS',
  ],
  'Staci Bonnie': [
    'Web Design',
    'Brand Identity',
    'Design Systems',
    'Webflow Design',
    'UX Design',
    'Accessibility',
    'Sustainable Web Design',
  ],
}

/** Pre-built Organization node used by all generators so the @id is
 *  identical across content types and Google merges them cleanly. */
function buildTahiOrgNode(): Record<string, unknown> {
  const logoUrl = process.env.TAHI_LOGO_URL || TAHI_LOGO_URL_CONST
  const org: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': TAHI_ORG_ID,
    name: 'Tahi Studio',
    legalName: 'Tahi Studio Limited',
    url: 'https://www.tahi.studio/',
    foundingDate: TAHI_FOUNDING_DATE,
    sameAs: [
      'https://www.linkedin.com/company/tahi-studio',
    ],
    knowsAbout: TAHI_KNOWS_ABOUT,
    knowsLanguage: ['en'],
    areaServed: TAHI_AREAS_SERVED.map(name => ({ '@type': 'Country', name })),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Business inquiries',
      email: TAHI_CONTACT_EMAIL,
      availableLanguage: ['English'],
    },
  }
  if (logoUrl && logoUrl.trim()) {
    org.logo = { '@type': 'ImageObject', url: logoUrl }
  }
  return org
}

export const TAHI_ORG_NODE = buildTahiOrgNode()
