---
description: UI must follow docs/design-system.md tokens and reuse packages/ui components.
globs:
  - 'apps/web/**/*'
  - 'packages/ui/**/*'
  - 'packages/config/**/*'
---

# UI design system

- Source of truth: `docs/design-system.md`. All colors via CSS vars; NEVER hard-code hex/hsl in components — add a var and document it in §2 of that file.
- Check `packages/ui` before building any component; domain components used by 2+ features live there.
- Icons: `lucide-react` only. Fonts: system stack + ui-monospace (no webfont dep in P0).
- New shared component → `packages/ui` + export from index. New token → CSS vars + design-system.md §2.
- Forms: `react-hook-form` + `zod` validated against `packages/protocol` schemas.
