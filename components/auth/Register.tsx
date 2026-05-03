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
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const { register } = useAuth();

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
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md">
        <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
          Create Account
        </h2>

        {/* Supported Payments Display */}
        <div className="text-center mb-6">
          <p className="text-gray-400 text-[10px] uppercase tracking-widest font-bold mb-3">
            Qaababka Lacag-bixinta
          </p>
          <div className="flex justify-center gap-3 flex-wrap items-center">
            <img src="/icons/evc.png" alt="EVC Plus" title="EVC Plus" className="h-9 w-9 rounded-[8px] bg-white p-[3px] object-contain shadow-sm border border-gray-100" />
            <img src="/icons/edahab.png" alt="eDahab" title="eDahab" className="h-9 w-9 rounded-[8px] bg-white p-[3px] object-contain shadow-sm border border-gray-100" />
            <img src="/icons/salaam.png" alt="Salaam Bank" title="Salaam Bank" className="h-9 w-9 rounded-[8px] bg-white p-[3px] object-contain shadow-sm border border-gray-100" />
            <img src="/icons/premier.png" alt="Premier Bank" title="Premier Bank" className="h-9 w-9 rounded-[8px] bg-white p-[3px] object-contain shadow-sm border border-gray-100" />
            <img src="/icons/golis.png" alt="Golis" title="Golis" className="h-9 w-9 rounded-[8px] bg-white p-[3px] object-contain shadow-sm border border-gray-100" />
          </div>
        </div>

        {/* Tutorial Button */}
        <button
          type="button"
          onClick={() => setShowTutorial(true)}
          className="w-full flex items-center justify-center gap-2 bg-cyan-50 border border-cyan-100 text-cyan-800 font-bold py-3 px-4 rounded-xl mb-6 hover:bg-cyan-100 transition-colors"
        >
          <span className="text-xl">📺</span>
          Daawo Sida Loo Ciyaaro
        </button>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-600 text-sm font-bold mb-2">
              Geli Magacaaga
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-cyan-500 outline-none"
              placeholder="Enter your full name"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-gray-600 text-sm font-bold mb-2">
              geli numberkaaga
            </label>
            <div className="flex items-center bg-gray-50 border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-cyan-500">
              <div className="flex items-center px-3 py-3 bg-gray-200 border-r border-gray-300">
                <span className="text-xl mr-2">🇸🇴</span>
                <span className="text-gray-800 font-medium">+252</span>
              </div>
              <input
                type="tel"
                inputMode="numeric"
                value={number}
                onChange={handlePhoneChange}
                className="flex-1 bg-gray-50 px-3 py-3 text-gray-900 outline-none"
                placeholder="Enter phone number"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-600 text-sm font-bold mb-2">Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-cyan-500 outline-none"
              placeholder="Enter password (min 6 characters)"
              required
              minLength={6}
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-gray-600 text-sm font-bold mb-2">Ku Celi passwordkaga markale</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-cyan-500 outline-none"
              placeholder="Confirm your password"
              required
              minLength={6}
              disabled={loading}
            />
          </div>

          {error && (
            <div className="bg-red-100 border border-red-300 rounded-lg p-3">
              <p className="text-red-700 text-sm text-center">{error}</p>
              {error.includes('Cannot connect to server') && (
                <p className="text-red-600 text-xs text-center mt-2">
                  💡 Make sure the backend server is running on port 5000
                </p>
              )}
            </div>
          )}

          {success && (
            <div className="bg-green-100 border border-green-300 rounded-lg p-3">
              <p className="text-green-700 text-sm text-center">{success}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-transform transform active:scale-95"
          >
            {loading ? 'Creating Account...' : 'Sameyso'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={onSwitchToLogin}
            className="text-gray-600 hover:text-cyan-600 text-sm underline"
          >
            Already have an account? Login
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
        <div className="fixed inset-0 bg-black/85 z-[9999] flex flex-col items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="m-0 text-gray-900 text-base font-bold">Sida Loo Sameeyo</h3>
              <button onClick={() => setShowTutorial(false)} className="bg-transparent border-none text-gray-400 text-2xl cursor-pointer leading-none hover:text-gray-600">&times;</button>
            </div>
            <div className="relative pb-[56.25%] h-0 bg-black">
              <iframe 
                className="absolute top-0 left-0 w-full h-full"
                src="https://www.youtube.com/embed/oHg5SJYRHA0"
                title="Tutorial Video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
            <div className="p-4 text-center">
              <p className="text-gray-500 text-sm m-0">
                Halkan waxaad ka baran kartaa sida loo ciyaaro iyo sida loo diiwaangaliyo.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Register;

