import { useEffect, useState, useSyncExternalStore } from 'react';
import { getApiActivity, onApiActivity } from '../api/client';
import { ko } from '../i18n/ko';

const idle = { reads: 0, writes: 0 };
export function NetworkActivity() {
  const activity = useSyncExternalStore(onApiActivity, getApiActivity, () => idle);
  const active = activity.reads + activity.writes > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 350);
    return () => clearTimeout(timer);
  }, [active]);
  if (!visible || !active) return null;
  return <div className="network-activity" role="status" aria-live="polite"><span className="activity-dot" aria-hidden="true" />{activity.writes ? ko.work.networkWrite : ko.work.networkRead}</div>;
}
