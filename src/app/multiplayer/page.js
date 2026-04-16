'use client';

export default function MultiplayerLanding() {
  return (
    <div className="container">
      <div className="screen" style={{ textAlign: 'center' }}>
        <h1>NearMe <span style={{ fontSize: 14, color: '#999', fontWeight: 'normal' }}>v0.5.0</span></h1>
        <p className="subtitle">Play with friends and family!</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 15, maxWidth: 300, margin: '30px auto' }}>
          <a href="/multiplayer/host">
            <button style={{ width: '100%' }}>Host a Game</button>
          </a>
          <a href="/multiplayer/join">
            <button style={{ width: '100%', background: '#764ba2' }}>Join a Game</button>
          </a>
        </div>

        <div style={{ marginTop: 20 }}>
          <a href="/" style={{ color: '#667eea', fontSize: 14 }}>&larr; Play solo instead</a>
        </div>
      </div>
    </div>
  );
}
