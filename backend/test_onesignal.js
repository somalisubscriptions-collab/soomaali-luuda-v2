const https = require('https');

const data = JSON.stringify({
  app_id: '0416f4a4-ca9d-42c6-8106-eb44fa34f0ab',
  included_segments: ['Subscribed Users'],
  contents: { en: 'Test' }
});

const options = {
  hostname: 'api.onesignal.com',
  port: 443,
  path: '/notifications',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Basic os_v2_app_aqlpjjgktvbmnaig5ncpunhqvoxemxnx4j2e2wvnwmdifmmssqurcqznmwhhhf4jrkwqutkgo4wf36fgyvqrossks5yksaf3zh2mrvq'
  }
};

const req = https.request(options, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('Response:', body));
});

req.on('error', error => console.error(error));
req.write(data);
req.end();
