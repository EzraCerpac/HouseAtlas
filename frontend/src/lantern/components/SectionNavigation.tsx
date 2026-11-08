import type { ViewId } from '../state/store';
import { Icon } from './Icon';

const SECTIONS = [
  { id: 'atlas', label: 'Atlas', icon: 'atlas' },
  { id: 'upkeep', label: 'Upkeep', icon: 'upkeep' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'changes', label: 'Changes', icon: 'changes' },
] as const;

/** One navigation for authenticated and retained display shells. */
export function SectionNavigation({ view, onView, reviewCount = 0 }: {
  view: ViewId; onView(view: ViewId): void; reviewCount?: number;
}) {
  return <nav className="navrail" aria-label="Sections">{SECTIONS.map(section =>
    <button key={section.id} type="button" className={`nav-btn${view === section.id ? ' is-current' : ''}`}
      aria-current={view === section.id ? 'page' : undefined} onClick={() => onView(section.id)}>
      <Icon name={section.icon} size={20} /><span className="nav-label">{section.label}</span>
      {section.id === 'changes' && reviewCount > 0 && <span className="nav-badge" aria-label={`${reviewCount} to review`}>{reviewCount}</span>}
    </button>)}</nav>;
}
