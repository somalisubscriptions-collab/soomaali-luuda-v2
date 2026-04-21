import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface CompleteProfileProps {
  onSuccess: () => void;
}

const CompleteProfile: React.FC<CompleteProfileProps> = ({ onSuccess }) => {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { updatePhone } = useAuth();

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
      await updatePhone(fullPhoneNumber);
      setSuccess('Profile completed successfully! Redirecting...');
      setTimeout(() => onSuccess(), 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to update phone number. Number might be in use.');
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
          position: relative;
          overflow: hidden;
        }

        /* Abstract decorative blobs */
        .auth-card::before {
          content: '';
          position: absolute;
          top: -40px;
          right: -40px;
          width: 120px;
          height: 120px;
          background: rgba(142, 68, 173, 0.4);
          filter: blur(40px);
          border-radius: 50%;
          z-index: 0;
        }

        .auth-card::after {
          content: '';
          position: absolute;
          bottom: -40px;
          left: -40px;
          width: 150px;
          height: 150px;
          background: rgba(41, 128, 185, 0.3);
          filter: blur(40px);
          border-radius: 50%;
          z-index: 0;
        }

        .auth-content {
          position: relative;
          z-index: 1;
        }

        .title {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -1px;
          margin-bottom: 8px;
          background: linear-gradient(to right, #fff, #b8b8d4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-align: center;
        }

        .subtitle {
          color: #8b8ba7;
          font-size: 15px;
          text-align: center;
          margin-bottom: 32px;
          line-height: 1.5;
        }

        .input-group {
          margin-bottom: 20px;
          position: relative;
        }

        .input-label {
          display: block;
          color: #aeb1d4;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .phone-input-wrapper {
          display: flex;
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          overflow: hidden;
          transition: all 0.2s ease;
        }

        .phone-input-wrapper:focus-within {
          border-color: #8e44ad;
          box-shadow: 0 0 0 3px rgba(142,68,173,0.15);
        }

        .phone-prefix {
          background: rgba(255,255,255,0.03);
          color: #fff;
          font-weight: 600;
          font-size: 16px;
          padding: 16px;
          border-right: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 60px;
        }

        .custom-input {
          flex: 1;
          background: transparent;
          border: none;
          color: #fff;
          font-size: 16px;
          font-weight: 500;
          padding: 16px;
          width: 100%;
          outline: none;
        }

        .custom-input::placeholder {
          color: rgba(255,255,255,0.25);
        }

        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #8e44ad, #2980b9);
          color: white;
          border: none;
          padding: 16px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 12px;
          position: relative;
          overflow: hidden;
        }

        .submit-btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 50%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
          transform: skewX(-20deg);
          animation: shine 3s infinite 1s;
        }

        @keyframes shine {
          0% { left: -100%; }
          20% { left: 200%; }
          100% { left: 200%; }
        }

        .submit-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(142,68,173,0.3);
        }

        .submit-btn:active {
          transform: translateY(1px);
        }

        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .error-message {
          background: rgba(231, 76, 60, 0.15);
          color: #ff6b6b;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 24px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          border: 1px solid rgba(231, 76, 60, 0.3);
        }

        .success-message {
          background: rgba(46, 204, 113, 0.15);
          color: #2ecc71;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 24px;
          text-align: center;
          border: 1px solid rgba(46, 204, 113, 0.3);
        }

        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: #fff;
          animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="auth-card">
        <div className="auth-content">
          <h1 className="title">Complete Profile</h1>
          <p className="subtitle">Please enter your Zaad / EVC Plus number to deposit and play.</p>

          {error && (
            <div className="error-message">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="success-message">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="input-label">Phone Number (Taleefan)</label>
              <div className="phone-input-wrapper">
                <div className="phone-prefix">+252</div>
                <input
                  type="tel"
                  className="custom-input"
                  placeholder="61XXXXXXX"
                  value={phone}
                  onChange={handlePhoneChange}
                  maxLength={10}
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="submit-btn"
              disabled={loading || phone.length < 7}
            >
              {loading ? <span className="spinner"></span> : 'Save & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CompleteProfile;
