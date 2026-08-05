---
name: Mercosul Protocol
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#43474f'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#737780'
  outline-variant: '#c3c6d1'
  surface-tint: '#3a5f94'
  primary: '#001e40'
  on-primary: '#ffffff'
  primary-container: '#003366'
  on-primary-container: '#799dd6'
  inverse-primary: '#a7c8ff'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#1b1f22'
  on-tertiary: '#ffffff'
  tertiary-container: '#313437'
  on-tertiary-container: '#999ca0'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#a7c8ff'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#1f477b'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e0e2e6'
  tertiary-fixed-dim: '#c4c7ca'
  on-tertiary-fixed: '#191c1f'
  on-tertiary-fixed-variant: '#44474a'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-ncm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: 0.1em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style
This design system is engineered for high-stakes regulatory and trade compliance. The brand personality is authoritative, precise, and transparent, prioritizing data density and cognitive clarity over decorative elements.

The style is **Modern Corporate**, utilizing a disciplined architectural approach to layout. It features a high-contrast environment with a focus on "Data-First" presentation. Visual flourishes are stripped away in favor of structural integrity, utilizing generous whitespace to prevent information fatigue during prolonged research sessions. The emotional response should be one of confidence, efficiency, and institutional trust.

## Colors
The palette is anchored by a deep professional blue, used exclusively for primary actions and brand identifiers to maintain focus. 

- **Primary (#003366):** Used for key interaction points, active states, and navigation headers. It conveys stability.
- **Surface & Backgrounds:** The interface utilizes a pure white (#FFFFFF) for content cards and a very light grey (#F9FAFB) for application backgrounds to define depth without using shadows.
- **Typography & Borders:** Dark Grey (#1A1A1A) is used for maximum legibility in body text. Medium greys are reserved for structural borders and secondary metadata.
- **Status Indicators:** Success, Warning, and Error states must use functional colors that meet WCAG AA contrast requirements against white backgrounds.

## Typography
Inter is the sole typeface for this design system to ensure a systematic and utilitarian feel. 

- **Hierarchy:** Use bold weights for NCM codes and classification titles to ensure they are the first thing a user sees.
- **NCM Codes:** For the 8-digit NCM numbers, use the `code-ncm` style which features increased letter spacing to prevent misreading individual digits.
- **Labels:** Small caps or uppercase labels with slight tracking are used for form headers and table headers to distinguish them from dynamic user data.

## Layout & Spacing
The system utilizes a **12-column Fixed Grid** for desktop views, centered in the viewport. The base spacing scale is a strict 4px increment system.

- **Data Density:** While the design is "clean," it is not sparse. Use 16px (4 units) for internal component padding and 24px (6 units) for gaps between major sections.
- **Margins:** Desktop views require a minimum 40px side margin to maintain the professional "document" feel.
- **Reflow:** On mobile devices, the 12-column grid collapses to a single column with 16px horizontal margins. Complex data tables should transition to "card-stack" views or implement horizontal scrolling with sticky primary columns (NCM code column).

## Elevation & Depth
To maintain a serious, non-futuristic aesthetic, this design system avoids heavy shadows and blurs.

- **Low-Contrast Outlines:** Depth is achieved through 1px solid borders (#E5E7EB).
- **Tonal Layers:** The primary canvas is #F9FAFB. Content sections are housed in White (#FFFFFF) containers with a subtle border. 
- **Active States:** No "lift" effect on hover. Instead, use subtle background color shifts (e.g., White to #F3F4F6) to indicate interactivity.
- **Modals:** Use a solid 50% opacity black overlay for modals, with the modal container itself having a slightly thicker 2px border in Primary Blue to indicate focus.

## Shapes
The shape language is "Soft" but leans toward sharp. A 4px (0.25rem) radius is the standard for almost all elements including input fields, buttons, and cards.

- **Buttons/Inputs:** 4px radius. This maintains a professional, geometric rigor without the aggression of 0px corners.
- **Data Tags:** Status tags (e.g., "Active", "Repealed") may use a slightly higher radius (8px) to distinguish them from interactive buttons.
- **Consistency:** Never use pill-shaped (fully rounded) elements, as they detract from the serious nature of the consultation tool.

## Components
- **Input Fields:** Use 1px solid borders in #D1D5DB. On focus, the border transitions to Primary Blue (#003366) with a 2px thickness. Labels must always be visible above the field (no floating labels).
- **Primary Buttons:** Solid #003366 background with White text. Use 14px Bold All-caps for the label. The hover state is a slightly darker navy.
- **NCM Result Items:** These are white containers with a 1px border. The NCM code is positioned top-left in the `code-ncm` style. Descriptions use `body-md` in #1A1A1A.
- **Data Tables:** Striped rows are permitted for high-density data, using #F9FAFB for alternating rows. Headers should be sticky with a #1A1A1A background and white text.
- **Breadcrumbs:** Essential for NCM navigation (Section > Chapter > Subheading). Use `body-sm` with a chevron separator.
- **Search Bar:** A prominent component. High-contrast, 48px height, with a search icon positioned to the left and a clear "Search" button attached to the right.