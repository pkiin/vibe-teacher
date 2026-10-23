import { useDisplay, type Theme } from '../context/DisplayContext';
import { ko } from '../i18n/ko';

export function ThemePicker() {
  const { prefs, update } = useDisplay();
  return <select aria-label={ko.theme.label} value={prefs.theme} onChange={(event) => update({ theme: event.target.value as Theme })}>
    <option value="system">{ko.theme.system}</option><option value="light">{ko.theme.light}</option><option value="dark">{ko.theme.dark}</option>
  </select>;
}
