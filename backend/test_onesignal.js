const axios = require('axios');

const ONESIGNAL_APP_ID = '0416f4a4-ca9d-42c6-8106-eb44fa34f0ab';
const ONESIGNAL_API_KEY = 'os_v2_app_aqlpjjgktvbmnaig5ncpunhqvnjfdxdpvmge265rltebtneuyy3thdrcss2gnuwaqhe7kc6yckuu3ohidrqy4pw23qr4jbzhq6g6qvi';

async function test() {
  try {
    const notificationBody = {
      app_id: ONESIGNAL_APP_ID,
      included_segments: ['Subscribed Users'],
      headings: { en: 'Test Title' },
      contents: { en: 'Test Message' },
      url: 'https://laadhuu.online'
    };

    const response = await axios.get(
      `https://onesignal.com/api/v1/apps/${ONESIGNAL_APP_ID}`,
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
