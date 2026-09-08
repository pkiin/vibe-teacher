export interface TabDef {
  id: string;
  label: string;
  badge?: number | string;
}

export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge !== undefined && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
