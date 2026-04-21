import { API_URL } from '../lib/apiConfig';
import type { User } from '../types';
import { instrumentedFetch } from './apiService';

interface LoginResponse {
  user: User;
  token: string;
}

const getAuthUrl = () => {
  return API_URL || 'http://localhost:5000/api';
};

export const authAPI = {
  async login(phone: string, password: string): Promise<LoginResponse> {
    const url = `${getAuthUrl()}/auth/login`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone,
        password,
      }),
    };

    try {
      const { responseData } = await instrumentedFetch(url, options);

      // Validate response shape. If server returned plain text or empty body,
      // avoid returning an invalid LoginResponse which would lead to storing
      // `undefined` in localStorage and JSON.parse errors later.
      if (!responseData || typeof responseData !== 'object' || !responseData.user || !responseData.token) {
        // Provide helpful debug information when possible
        const debugVal = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        throw new Error('Invalid login response from server: ' + debugVal);
      }

      return responseData as LoginResponse;
    } catch (error: any) {
      if (error.responseData) {
        const { response, responseData } = error;
        let errorMessage = responseData.message || 'Login failed';

        if (response.status === 401) {
          errorMessage = 'Invalid phone number or password';
        } else if (response.status === 403) {
          errorMessage = 'Account is suspended';
        } else if (response.status === 404) {
          errorMessage = 'Server not found. Please check if the backend is running.';
        } else if (response.status === 0 || response.status >= 500) {
          errorMessage = 'Cannot connect to server. Please ensure the backend is running on port 5000.';
        }
        throw new Error(errorMessage);
      }

      if (error.message && error.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to server. Please ensure the backend is running on port 5000.');
      }

      throw new Error(error.message || 'Failed to connect to server');
    }
  },

  async register(fullName: string, phone: string, password: string, referralCode?: string): Promise<LoginResponse> {
    const url = `${getAuthUrl()}/auth/register`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fullName,
        phone,
        password,
        ...(referralCode && { referralCode }) // Only include if provided
      }),
    };

    try {
      const { responseData } = await instrumentedFetch(url, options);

      if (!responseData || typeof responseData !== 'object' || !responseData.user || !responseData.token) {
        const debugVal = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        throw new Error('Invalid register response from server: ' + debugVal);
      }

      return responseData as LoginResponse;
    } catch (error: any) {
      if (error.responseData) {
        const { response, responseData } = error;
        let errorMessage = responseData.message || 'Registration failed';

        if (response.status === 0 || response.status >= 500) {
          errorMessage = 'Cannot connect to server. Please ensure the backend is running on port 5000.';
        }
        throw new Error(errorMessage);
      }

      if (error.message && error.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to server. Please ensure the backend is running on port 5000.');
      }

      throw new Error(error.message || 'Failed to register');
    }
  },

  async getCurrentUser(): Promise<User> {
    const token = localStorage.getItem('ludo_token');
    const url = `${getAuthUrl()}/auth/me`;

    if (!token) {
      throw new Error('No authentication token');
    }

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    try {
      const { responseData } = await instrumentedFetch(url, options);
      return responseData;
    } catch (error: any) {
      if (error.responseData) {
        const { response } = error;
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Unauthorized: ${response.status}`);
        }
        if (response.status === 404) {
          throw new Error(`User not found: ${response.status}`);
        }
        if (response.status === 0) {
          throw new Error('Network error: Cannot connect to server');
        }
        throw new Error(`Failed to get user info: ${response.status}`);
      }

      if (error.message && (error.message.includes('401') || error.message.includes('403'))) {
        throw error;
      }
      if (error.message && error.message.includes('Failed to fetch')) {
        throw new Error('Network error: Cannot connect to server. Please ensure the backend is running.');
      }
      throw new Error(`Network error: ${error.message || 'Failed to connect to server'}`);
    }
  },

  async requestPasswordReset(phoneOrUsername: string): Promise<void> {
    const url = `${getAuthUrl()}/auth/forgot-password`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phoneOrUsername }),
    };

    try {
      await instrumentedFetch(url, options);
    } catch (error: any) {
      const errorMessage = error.responseData?.message || 'Failed to request password reset';
      throw new Error(errorMessage);
    }
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const url = `${getAuthUrl()}/auth/reset-password`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, newPassword }),
    };

    try {
      await instrumentedFetch(url, options);
    } catch (error: any) {
      const errorMessage = error.responseData?.message || 'Failed to reset password';
      throw new Error(errorMessage);
    }
  },

  async updatePhone(phone: string): Promise<void> {
    const token = localStorage.getItem('ludo_token');
    const url = `${getAuthUrl()}/auth/update-phone`;

    if (!token) {
      throw new Error('No authentication token');
    }

    const options = {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone }),
    };

    try {
      await instrumentedFetch(url, options);
    } catch (error: any) {
      const errorMessage = error.responseData?.error || error.responseData?.message || 'Failed to update phone number';
      throw new Error(errorMessage);
    }
  },
};

