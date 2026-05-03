import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface LoginProps {
  onSuccess: () => void;
  onSwitchToRegister: () => void;
  onSwitchToResetPassword?: () => void;
  googleAuthError?: string | null;
}

// The backend base URL — matches apiConfig.ts logic
const BACKEND_URL =
  import.meta.env.PROD
    ? 'https://api.laadhuu.online'
    : 'http://localhost:5000';

const Login: React.FC<LoginProps> = ({
  onSuccess,
  onSwitchToRegister,
  onSwitchToResetPassword,
  googleAuthError,
}) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const { login } = useAuth();

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setPhone(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (phone.length < 7) {
      setError('Phone number must be at least 7 digits');
      return;
    }

    setLoading(true);
    try {
      const fullPhoneNumber = '+252' + phone;
      await login(fullPhoneNumber, password);
      setSuccess('Login Successful! Redirecting...');
      setTimeout(() => onSuccess(), 1200);
    } catch (err: any) {
      const errorMsg = err.message || '';
      if (errorMsg.toLowerCase().includes('password') || errorMsg.toLowerCase().includes('invalid')) {
        setError('Numberka ama passwordka waa qalad. Fadlan hubi ama nagala soo xariir WhatsApp.');
      } else {
        setError(errorMsg || 'Failed to login. Please check your details.');
      }
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setGoogleLoading(true);
    window.location.href = `${BACKEND_URL}/api/auth/google`;
  };

  const displayError = error || googleAuthError;

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

        .google-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: #fff;
          color: #1f1f1f;
          font-weight: 600;
          font-size: 15px;
          padding: 14px 20px;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 12px rgba(0,0,0,0.2);
          letter-spacing: 0.01em;
        }
        .google-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
        .google-btn:active { transform: translateY(0); }
        .google-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }

        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 24px 0;
          color: rgba(255,255,255,0.3);
          font-size: 13px;
        }
        .divider::before, .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.12);
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
        }
        .auth-input::placeholder { color: rgba(255,255,255,0.25); }

        .password-input {
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
        .password-input:focus { border-color: rgba(99,102,241,0.8); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
        .password-input::placeholder { color: rgba(255,255,255,0.25); }

        .login-btn {
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
        .login-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(99,102,241,0.5); }
        .login-btn:active { transform: translateY(0); }
        .login-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

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

        .register-prompt {
          text-align: center;
          margin-top: 28px;
          color: rgba(255,255,255,0.4);
          font-size: 14px;
        }
        .register-link {
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
        .register-link:hover { color: #a5b4fc; text-decoration: underline; }

        .forgot-link {
          color: rgba(255,255,255,0.35);
          font-size: 12px;
          cursor: pointer;
          background: none;
          border: none;
          padding: 0;
          transition: color 0.2s;
        }
        .forgot-link:hover { color: rgba(255,255,255,0.6); text-decoration: underline; }

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
            style={{ height: '64px', width: 'auto', marginBottom: '16px' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <h1 style={{
            color: '#fff',
            fontSize: '26px',
            fontWeight: 800,
            margin: 0,
            letterSpacing: '-0.02em',
          }}>
            Ku soo dhawow 🎮
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', marginTop: '6px' }}>
            Sign in to play Somaali Luudo
          </p>
        </div>

        {/* Supported Payments Display */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px', fontWeight: 700 }}>
            Qaababka Lacag-bixinta
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <img src="/icons/evc.png" alt="EVC Plus" title="EVC Plus" style={{ height: '36px', width: '36px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/edahab.png" alt="eDahab" title="eDahab" style={{ height: '36px', width: '36px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/salaam.png" alt="Salaam Bank" title="Salaam Bank" style={{ height: '36px', width: '36px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/premier.png" alt="Premier Bank" title="Premier Bank" style={{ height: '36px', width: '36px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
            <img src="/icons/golis.png" alt="Golis" title="Golis" style={{ height: '36px', width: '36px', borderRadius: '8px', background: '#fff', padding: '3px', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
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
            marginBottom: '20px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
        >
          <span style={{ fontSize: '18px' }}>📺</span>
          Daawo Sida Loo Ciyaaro
        </button>

        {/* Google Button */}
        <button
          className="google-btn"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          id="google-login-btn"
        >
          {googleLoading ? (
            <span className="spinner" style={{ borderColor: 'rgba(0,0,0,0.2)', borderTopColor: '#4285f4' }} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {googleLoading ? 'Waad ku xirmeysaa...' : 'Ku xiro Gmail-kaaga'}
        </button>

        {/* Divider */}
        <div className="divider">or sign in with phone</div>

        {/* Error / Success */}
        {displayError && <div className="error-box">⚠️ {displayError}</div>}
        {success && <div className="success-box">✅ {success}</div>}

        {/* Login Form */}
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Phone Number</label>
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
                value={phone}
                onChange={handlePhoneChange}
                disabled={loading}
                required
                id="login-phone"
              />
            </div>
          </div>

          <div className="input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label className="input-label" style={{ margin: 0 }}>Password</label>
              {onSwitchToResetPassword && (
                <button type="button" className="forgot-link" onClick={onSwitchToResetPassword}>
                  Forgot password?
                </button>
              )}
            </div>
            <input
              type="password"
              className="password-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              id="login-password"
            />
          </div>

          <button
            type="submit"
            className="login-btn"
            disabled={loading || googleLoading}
            id="login-submit-btn"
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="spinner" />
                Logging in...
              </span>
            ) : 'Login →'}
          </button>
        </form>

        {/* Register prompt */}
        <div className="register-prompt">
          Ma xidhi akoon hore?{' '}
          <button
            type="button"
            className="register-link"
            onClick={onSwitchToRegister}
            id="switch-to-register-btn"
          >
            Register Now
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
          <div style={{ width: '100%', maxWidth: '400px', background: '#1a1a1a', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '15px', fontWeight: 700 }}>Sida Loo Sameeyo</h3>
              <button onClick={() => setShowTutorial(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, background: '#000' }}>
              <iframe 
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                src="https://www.youtube.com/embed/oHg5SJYRHA0"
                title="Tutorial Video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: 0 }}>
                Halkan waxaad ka baran kartaa sida loo ciyaaro iyo sida loo diiwaangaliyo.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
