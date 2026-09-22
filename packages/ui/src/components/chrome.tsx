import type * as React from 'react';
import { cn } from '../utils';

const panelTones = {
  card: 'panel',
  plain: 'panel-plain',
  inset: 'panel-inset',
} as const;

export type PanelProps = React.HTMLAttributes<HTMLElement> & {
  /** Keep the original element when it carries a landmark role (section, aside, nav, …). */
  as?: React.ElementType;
  tone?: keyof typeof panelTones;
};

/**
 * Panel card: renders the shared `panel*` utilities (one CSS definition, used by
 * both this component and code surfaces such as `pre`/`code`).
 */
export function Panel({ as, tone = 'card', className, ...props }: PanelProps) {
  const Tag = (as ?? 'div') as React.ElementType;
  return <Tag className={cn('rounded-md', panelTones[tone], className)} {...props} />;
}
