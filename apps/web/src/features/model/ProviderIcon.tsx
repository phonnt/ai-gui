import { brandFor, fallbackHue } from './providerIcons';

interface ProviderIconProps {
  provider: string;
  className?: string;
}

/** Brand SVG when known, else a deterministic initial-letter badge. */
export function ProviderIcon({ provider, className }: ProviderIconProps) {
  const brand = brandFor(provider);
  if (brand) {
    return (
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label={brand.title}
        className={className ?? 'size-4 shrink-0'}
        fill={`#${brand.hex}`}
      >
        <path d={brand.path} />
      </svg>
    );
  }
  const initial = (provider.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `hsl(${fallbackHue(provider)} 60% 45%)` }}
      className={
        className ??
        'flex size-4 shrink-0 items-center justify-center rounded-md text-meta font-strong text-white'
      }
    >
      {initial}
    </span>
  );
}
