const redis = require('redis');

const client = redis.createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:6379`
});

client.on('error', (err) => console.log('Redis error:', err));

const connect = async () => await client.connect();

module.exports = { client, connect };
