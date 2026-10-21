// API utility functions for frontend components
const API_BASE = '/api';

export class ApiClient {
  private static async request(endpoint: string, options: RequestInit = {}) {
    const url = `${API_BASE}${endpoint}`;
    
    const config: RequestInit = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    // Add auth token if available
    const token = localStorage.getItem('auth-token');
    const hasAuthorization = new Headers(options.headers).has('Authorization');
    if (token && !hasAuthorization) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${token}`,
      };
    }

    const response = await fetch(url, config);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'API request failed');
    }

    return response.json();
  }

  // Authentication
  static async login(email: string, password: string, userType: 'investor' | 'rwa-project') {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, userType }),
    });
  }

  // RWA Assets
  static async getAssets(params: {
    category?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.category) queryParams.set('category', params.category);
    if (params.limit) queryParams.set('limit', params.limit.toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    return this.request(`/rwa/assets${query ? `?${query}` : ''}`);
  }

  // Investment
  static async investInAsset(assetId: string, amount: number, paymentMethod: string) {
    return this.request(`/rwa/${assetId}/invest`, {
      method: 'POST',
      body: JSON.stringify({ amount, paymentMethod }),
    });
  }

  // KYC Verification: pass the Privy access token from usePrivy().getAccessToken()
  static async verifyKYC(inquiryId: string, privyAccessToken: string) {
    return this.request('/kyc/verify', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${privyAccessToken}` },
      body: JSON.stringify({ inquiryId }),
    });
  }

  // Health Check
  static async healthCheck() {
    return this.request('/health');
  }

  // Contact Form
  static async sendContactForm(formData: {
    name: string;
    email: string;
    company?: string;
    phone?: string;
    userType: 'investor' | 'originator' | 'general';
    subject: string;
    message: string;
  }) {
    return this.request('/contact/send', {
      method: 'POST',
      body: JSON.stringify(formData),
    });
  }
}

export default ApiClient;