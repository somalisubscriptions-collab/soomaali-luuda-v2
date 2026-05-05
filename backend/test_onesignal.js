const axios = require('axios');

const ONESIGNAL_APP_ID = '0416f4a4-ca9d-42c6-8106-eb44fa34f0ab';
const ONESIGNAL_API_KEY = 'os_v2_app_aqlpjjgktvbmnaig5ncpunhqvotbzj3axr4uji5gd2dqxp2ad5cm3fvebqspyw62sbbfvr2mdpoyjvdvfrgfyxfzrmhby4t7vbdhopq';

async function test() {
  try {
    const notificationBody = {
      app_id: ONESIGNAL_APP_ID,
      included_segments: ['Subscribed Users'],
      headings: { en: 'Test Title' },
      contents: { en: 'Test Message' },
      url: 'https://laadhuu.online'
    };

    const response = await axios.post(
      'https://api.onesignal.com/notifications',
      notificationBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_API_KEY}`
        }
      }
    );

    console.log('✅ Broadcast sent:', response.data);
  } catch (error) {
    const detail = error.response?.data || error.message || 'Unknown error';
    console.error('Broadcast notification error:', JSON.stringify(detail, null, 2));
  }
}

test();
