const http = require('http');

const options = {
    host: 'localhost',
    port: 3000,
    timeout: 2000,
    path: '/',
    method: 'GET'
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    if (res.statusCode === 200) {
        process.exit(0);
    } else {
        process.exit(1);
    }
});

req.on('error', (err) => {
    console.error('ERROR', err);
    process.exit(1);
});

req.end();
