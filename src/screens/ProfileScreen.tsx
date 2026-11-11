import { AppState } from '../state/useAppState';
import SettingsScreen from './SettingsScreen';

/**
 * The Me tab (UI simplify Job 10): Profile, My progress and Settings in one
 * page. The profile summary (MeSummary) sits on top of the Settings rows;
 * each Settings page opens in place and goes back to Me. Friends and circles
 * live on Community; the full milestone list is "All milestones" (the old
 * My progress screen).
 */
export default function ProfileScreen({ state }: { state: AppState }) {
  return <SettingsScreen state={state} asMe />;
}
