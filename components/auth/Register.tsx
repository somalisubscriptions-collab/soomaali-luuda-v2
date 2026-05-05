import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

interface RegisterProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

const Register: React.FC<RegisterProps> = ({ onSuccess, onSwitchToLogin }) => {
  const [fullName, setFullName] = useState('');
  const [number, setNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeVideo, setActiveVideo] = useState<{ id: number, title: string, enTitle: string, src: string, icon: string } | null>(null);
  const { register } = useAuth();

  const tutorialList = [
    { id: 1, title: 'Sidee loo sameestaa gameka?', enTitle: 'How to create an account?', src: '/icons/how-to-sign-up.mp4', icon: '📝' },
    { id: 2, title: 'Sidee lacag loo dhigtaa?', enTitle: 'How to deposit money?', src: '/icons/how-to-deposit.mp4', icon: '💰' },
    { id: 3, title: 'Sida lacagta loola baxo', enTitle: 'How to withdraw money', src: '/icons/how-to-withdraw.mp4', icon: '💸' },
  ];

  // Check for referral code in URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    if (refCode) {
      setReferralCode(refCode.toUpperCase());
    }
  }, []);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, ''); // Only allow digits
    setNumber(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!fullName.trim()) {
      setError('Full name is required');
      return;
    }

    if (!number.trim()) {
      setError('Phone number is required');
      return;
    }

    if (number.length < 7) {
      setError('Phone number must be at least 7 digits');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      // Send full number with country code
      const fullPhoneNumber = '+252' + number;
      // Pass referral code to backend (even if empty, backend handles it)
      await register(fullName, fullPhoneNumber, password, referralCode || undefined);
      setSuccess('Registration successful! Redirecting...');
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0c29 0%, #1a1a4e 50%, #0f0c29 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .auth-card {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 24px;
          padding: 40px 36px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 32px 80px rgba(0,0,0,0.6);
        }

        .input-group { margin-bottom: 16px; }
        .input-label {
          display: block;
          color: rgba(255,255,255,0.6);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .phone-row {
          display: flex;
          align-items: center;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          overflow: hidden;
          transition: border-color 0.2s;
        }
        .phone-row:focus-within { border-color: rgba(99,102,241,0.8); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
        .phone-prefix {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 14px 14px;
          background: rgba(255,255,255,0.05);
          border-right: 1px solid rgba(255,255,255,0.10);
          color: rgba(255,255,255,0.8);
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
        }

        .auth-input {
          flex: 1;
          background: transparent;
          border: none;
          padding: 14px 14px;
          color: #fff;
          font-size: 15px;
          outline: none;
          width: 100%;
          box-sizing: border-box;
        }
        .auth-input::placeholder { color: rgba(255,255,255,0.25); }

        .form-input {
          width: 100%;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          padding: 14px 16px;
          color: #fff;
          font-size: 15px;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }
        .form-input:focus { border-color: rgba(99,102,241,0.8); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
        .form-input::placeholder { color: rgba(255,255,255,0.25); }

        .register-btn {
          width: 100%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white;
          font-weight: 700;
          font-size: 15px;
          padding: 14px 20px;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 20px rgba(99,102,241,0.4);
          letter-spacing: 0.02em;
          margin-top: 4px;
        }
        .register-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(99,102,241,0.5); }
        .register-btn:active { transform: translateY(0); }
        .register-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .error-box {
          background: rgba(239,68,68,0.12);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 16px;
          color: #fca5a5;
          font-size: 13px;
          line-height: 1.5;
          text-align: center;
        }
        .success-box {
          background: rgba(34,197,94,0.12);
          border: 1px solid rgba(34,197,94,0.3);
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 16px;
          color: #86efac;
          font-size: 13px;
          text-align: center;
        }

        .login-prompt {
          text-align: center;
          margin-top: 28px;
          color: rgba(255,255,255,0.4);
          font-size: 14px;
        }
        .login-link {
          color: #818cf8;
          font-weight: 700;
          cursor: pointer;
          background: none;
          border: none;
          font-size: 14px;
          text-decoration: none;
          transition: color 0.2s;
          padding: 0;
        }
        .login-link:hover { color: #a5b4fc; text-decoration: underline; }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="auth-card">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img
            src="/icons/laddea.png"
            alt="Laadhuu"
            style={{ height: '56px', width: 'auto', marginBottom: '16px' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <h1 style={{
            color: '#fff',
            fontSize: '24px',
            fontWeight: 800,
            margin: 0,
            letterSpacing: '-0.02em',
          }}>
            Sameyso Akoon 🎮
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', marginTop: '6px' }}>
            Ku soo dhawow Somaali Luudo
          </p>
        </div>

        {/* Supported Payments Display */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px', fontWeight: 700 }}>
            Qaababka Lacag-bixinta
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <img src="/icons/evc.png" alt="EVC Plus" title="EVC Plus" style={{ height: '32px', width: '32px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/edahab.png" alt="eDahab" title="eDahab" style={{ height: '32px', width: '32px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/salaam.png" alt="Salaam Bank" title="Salaam Bank" style={{ height: '32px', width: '32px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/premier.png" alt="Premier Bank" title="Premier Bank" style={{ height: '32px', width: '32px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/golis.png" alt="Golis" title="Golis" style={{ height: '32px', width: '32px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
          </div>
        </div>

        {/* Tutorial Button */}
        <button
          type="button"
          onClick={() => setShowTutorial(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            width: '100%', background: 'rgba(255, 255, 255, 0.08)', color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.15)', padding: '12px', borderRadius: '12px',
            marginBottom: '24px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
        >
          <span style={{ fontSize: '18px' }}>📺</span>
          Sida loo isticmaalo (Tutorial)
        </button>

        {/* Error / Success */}
        {error && <div className="error-box">⚠️ {error}</div>}
        {success && <div className="success-box">✅ {success}</div>}

        {/* Register Form */}
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Magacaaga oo buuxa</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="form-input"
              placeholder="Enter your full name"
              required
              disabled={loading}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Numberkaaga Phone-ka</label>
            <div className="phone-row">
              <div className="phone-prefix">
                <span>🇸🇴</span>
                <span>+252</span>
              </div>
              <input
                type="tel"
                inputMode="numeric"
                className="auth-input"
                placeholder="61 234 5678"
                value={number}
                onChange={handlePhoneChange}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                minLength={6}
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Confirm</label>
              <input
                type="password"
                className="form-input"
                placeholder="Repeat"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                required
                minLength={6}
              />
            </div>
          </div>

          {/* Optional Referral Code */}
          <div className="input-group">
            <label className="input-label">Referral Code (Optional)</label>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              className="form-input"
              placeholder="Enter referral code"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="register-btn"
            disabled={loading}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="spinner" />
                Sameynaya...
              </span>
            ) : 'Sameyso Akoon →'}
          </button>
        </form>

        {/* Login prompt */}
        <div className="login-prompt">
          Ma leedahay akoon?{' '}
          <button
            type="button"
            className="login-link"
            onClick={onSwitchToLogin}
          >
            Login Now
          </button>
        </div>
      </div>

      {/* ── FLOATING TELEGRAM SUPPORT BUTTON ── */}
      <a 
        href="https://t.me/Somlaandhuu" 
        target="_blank" 
        rel="noopener noreferrer"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'linear-gradient(135deg, #0088cc 0%, #00a2ff 100%)',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '30px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 8px 25px rgba(0, 136, 204, 0.4)',
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: '14px',
          zIndex: 1000,
          transition: 'transform 0.2s ease',
        }}
        onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-3px)'}
        onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
      >
        <video 
          src="/icons/customer-service.mp4" 
          autoPlay 
          loop 
          muted 
          playsInline
          style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '50%', flexShrink: 0, marginLeft: '-4px', mixBlendMode: 'multiply' }} 
        />
        <span style={{ letterSpacing: '0.02em' }}>Caawinaad?</span>
      </a>

      {/* ── TUTORIAL MODAL ── */}
      {showTutorial && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '20px', backdropFilter: 'blur(5px)'
        }}>
          <div style={{ width: '100%', maxWidth: '400px', background: '#1a1a1a', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
            
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
              {activeVideo ? (
                <button onClick={() => setActiveVideo(null)} style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '14px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', padding: 0 }}>
                  <span>←</span> Dib u noqo
                </button>
              ) : (
                <h3 style={{ margin: 0, color: '#fff', fontSize: '16px', fontWeight: 700 }}>🎥 Qeybta Caawinaada</h3>
              )}
              <button onClick={() => { setShowTutorial(false); setActiveVideo(null); }} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>

            {activeVideo ? (
              <div style={{ overflowY: 'auto' }}>
                <div style={{ width: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <video 
                    style={{ width: '100%', maxHeight: '50vh', objectFit: 'contain' }}
                    src={activeVideo.src}
                    controls
                    autoPlay
                    playsInline
                  />
                </div>
                <div style={{ padding: '16px', textAlign: 'center' }}>
                  <h4 style={{ color: '#fff', margin: '0 0 8px 0', fontSize: '15px' }}>{activeVideo.title}</h4>
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px', overflowY: 'auto' }}>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: '0 0 16px 0', textAlign: 'center' }}>
                  Dooro muuqaalka aad rabto in aad daawato:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {tutorialList.map((tut) => (
                    <div 
                      key={tut.id} 
                      onClick={() => setActiveVideo(tut)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '16px', padding: '16px',
                        background: 'linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)', 
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '16px', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(145deg, rgba(99,102,241,0.15) 0%, rgba(255,255,255,0.03) 100%)';
                        e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 25px rgba(99,102,241,0.2)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)';
                      }}
                    >
                      <div style={{ 
                        fontSize: '26px', width: '52px', height: '52px', flexShrink: 0,
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))', 
                        borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(139,92,246,0.3)', boxShadow: 'inset 0 2px 10px rgba(255,255,255,0.1)'
                      }}>
                        {tut.icon}
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em', marginBottom: '4px' }}>{tut.title}</div>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, marginBottom: '10px' }}>{tut.enTitle}</div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ 
                            background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', 
                            padding: '4px 10px', borderRadius: '20px', fontSize: '10px', 
                            fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                            display: 'flex', alignItems: 'center', gap: '4px'
                          }}>
                            <span style={{ fontSize: '12px' }}>▶</span> Daawo
                          </span>
                        </div>
                      </div>
                      <div style={{ 
                        width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8', fontSize: '20px', transition: 'all 0.3s'
                      }}>
                        ›
                      </div>
                    </div>
                  ))}
                </div>

                {/* Support Footer */}
                <div style={{
                  marginTop: '24px',
                  padding: '16px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  <p style={{
                    fontSize: '13px',
                    color: 'rgba(255,255,255,0.6)',
                    lineHeight: '1.6',
                    textAlign: 'center',
                    margin: 0
                  }}>
                    <span style={{ fontWeight: 800, color: '#fff', display: 'block', marginBottom: '4px' }}>Ma u baahan tahay caawinaad?</span>
                    Hadii cabasho ama wax aad fahmi weysay ay jiraan lasoo xariir telegraamkeena <a href="https://t.me/Somlaandhuu" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', fontWeight: 700, textDecoration: 'none' }}>@Somlaandhuu</a> ama soo wac <a href="tel:0610251014" style={{ color: '#818cf8', fontWeight: 700, textDecoration: 'none' }}>0610251014</a>
                  </p>
                </div>
              </div>
            )}
            
          </div>
        </div>
      )}
    </div>

  );
};

export default Register;

