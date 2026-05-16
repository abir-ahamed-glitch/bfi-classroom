import { BookUser } from 'lucide-react';

export default function Directory() {
  return (
    <div className="page-container container fade-in" style={{ paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 className="text-gradient font-display" style={{ fontSize: '2.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <BookUser size={36} color="var(--accent-primary)" />
            Alumni Directory
          </h1>
          <p className="subtitle" style={{ marginTop: '0.5rem' }}>
            Connect with your peers and past alumni from BFI.
          </p>
        </div>
      </div>
      
      <div className="glass-panel" style={{ padding: '5rem 2rem', textAlign: 'center' }}>
        <BookUser size={64} style={{ margin: '0 auto 1.5rem auto', opacity: 0.2, color: 'var(--text-muted)' }} />
        <h2 className="font-display" style={{ fontSize: '1.8rem', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>Coming Soon</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>This section is currently under development.</p>
      </div>
    </div>
  );
}
