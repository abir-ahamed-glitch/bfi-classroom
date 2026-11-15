import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './NotificationPreferences.css';

const categories = [
  ['notices', 'New notices', 'Announcements from the institute.'],
  ['materials', 'New course materials', 'Resources added to your courses.'],
  ['messages', 'Messages', 'Inbox badge and sounds for incoming messages.'],
  ['community', 'Community activity', 'Posts, replies, mentions and reactions.']
];

export default function NotificationPreferences() {
  const { notificationPreferences, refreshNotificationPreferences, saveNotificationPreference } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function retry() {
    setLoading(true);
    setError('');
    try {
      await refreshNotificationPreferences();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    refreshNotificationPreferences().catch(err => {
      if (active) setError(err.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refreshNotificationPreferences]);

  async function save(category, enabled) {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      await saveNotificationPreference(category, enabled);
      setStatus('Preference saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass-panel notification-preferences" aria-labelledby="notification-preferences-heading">
      <h3 id="notification-preferences-heading" className="font-display"><Bell size={20} aria-hidden="true" /> Notification preferences</h3>
      <p>Choose which in-app alerts you receive. Account, payment and urgent broadcast alerts stay enabled.</p>
      {notificationPreferences ? (
        <fieldset disabled={saving}>
          <legend className="notification-preferences-legend">In-app alerts</legend>
          {categories.map(([category, label, description]) => (
            <label key={category} className="notification-preference-row">
              <span>
                <strong id={'notification-label-' + category}>{label}</strong>
                <span id={'notification-description-' + category}>{description}</span>
              </span>
              <input type="checkbox" role="switch"
                aria-labelledby={'notification-label-' + category}
                aria-describedby={'notification-description-' + category}
                checked={notificationPreferences[category]}
                onChange={event => save(category, event.target.checked)} />
            </label>
          ))}
        </fieldset>
      ) : loading ? <p role="status">Loading preferences…</p> : (
        <button type="button" className="btn btn-secondary" onClick={retry}>Retry loading preferences</button>
      )}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
