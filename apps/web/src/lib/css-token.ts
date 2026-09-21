/**
 * Resolve a design token (`--name`) to a concrete `rgb(...)` string.
 *
 * Third-party widgets that take colors as values rather than CSS (xterm's theme
 * is the one we use) cannot read `hsl(var(--token))` themselves. Probing the
 * computed style keeps the token authoritative instead of pasting a hex value
 * into the component, which the design-system rule forbids.
 */
export function cssTokenColor(name: string, fallback = 'rgb(0, 0, 0)'): string {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.style.cssText = `display:none;color:hsl(var(${name}))`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved === '' ? fallback : resolved;
}
