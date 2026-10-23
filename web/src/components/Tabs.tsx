export interface TabDef {
  id: string;
  label: string;
  badge?: number | string;
}

export function Tabs({ tabs, active, onChange, className = '' }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={`tabs ${className}`} role="tablist" onKeyDown={(event) => {
      const index = tabs.findIndex((tab) => tab.id === active);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      const tab = tabs[next];
      if (!tab) return;
      event.preventDefault();
      onChange(tab.id);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" tabIndex={active === t.id ? 0 : -1} aria-selected={active === t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge !== undefined && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
