require('dotenv').config({path:'.env'});
const http = require('http');
const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/admin/students/leads',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + require('jsonwebtoken').sign({id: 1, role: 'admin'}, require('./server/config/security.js').getJwtSecret())
  }
}, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Length:', JSON.parse(data).length));
});
req.on('error', console.error);
req.end();
