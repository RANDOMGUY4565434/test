const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { createChatServer } = require('../server');

let httpServer;
let address;
const clients = new Set();

before(async () => {
  ({ httpServer } = createChatServer({ reportLogger: { warn() {} } }));
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  for (const client of clients) client.disconnect();
  await new Promise((resolve) => httpServer.close(resolve));
});

function connectClient() {
  const client = createClient(address, { forceNew: true, reconnection: false });
  clients.add(client);
  return client;
}

function nextEvent(client, eventName, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), timeoutMs);
    client.once(eventName, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

test('serves the app and health endpoint', async () => {
  const [health, page] = await Promise.all([
    fetch(`${address}/api/health`),
    fetch(address),
  ]);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /sideby/);
});

test('requires age confirmation before entering the queue', async () => {
  const client = connectClient();
  await nextEvent(client, 'connect');
  const error = nextEvent(client, 'app-error');
  client.emit('start', { adultConfirmed: false });
  assert.match(await error, /18 or older/);
  const nextError = nextEvent(client, 'app-error');
  client.emit('next');
  assert.match(await nextError, /18 or older/);
  client.disconnect();
});

test('matches two chatters, relays text, and ends when one leaves', async () => {
  const first = connectClient();
  const second = connectClient();
  await Promise.all([nextEvent(first, 'connect'), nextEvent(second, 'connect')]);

  const waiting = nextEvent(first, 'queue-status');
  first.emit('start', { adultConfirmed: true, topics: ['books'] });
  await waiting;

  const firstMatched = nextEvent(first, 'matched');
  const secondMatched = nextEvent(second, 'matched');
  second.emit('start', { adultConfirmed: true, topics: ['books'] });
  assert.deepEqual((await firstMatched).sharedTopics, ['books']);
  assert.deepEqual((await secondMatched).sharedTopics, ['books']);

  const received = nextEvent(second, 'message');
  const sent = nextEvent(first, 'message-sent');
  first.emit('message', 'hello there');
  assert.equal((await received).text, 'hello there');
  assert.equal((await sent).text, 'hello there');

  const partnerLeft = nextEvent(second, 'partner-left');
  const firstWaiting = nextEvent(first, 'queue-status');
  first.emit('next');
  await partnerLeft;
  await firstWaiting;

  const firstRematched = nextEvent(first, 'matched');
  const secondRematched = nextEvent(second, 'matched');
  second.emit('next');
  await Promise.all([firstRematched, secondRematched]);

  const finalPartnerLeft = nextEvent(first, 'partner-left');
  second.emit('stop');
  await finalPartnerLeft;
  first.disconnect();
  second.disconnect();
});

test('reporting records the reason and prevents the blocked pair from rematching', async () => {
  const reporter = connectClient();
  const reported = connectClient();
  await Promise.all([nextEvent(reporter, 'connect'), nextEvent(reported, 'connect')]);
  const waiting = nextEvent(reporter, 'queue-status');
  reporter.emit('start', { adultConfirmed: true });
  await waiting;
  const reporterMatched = nextEvent(reporter, 'matched');
  const reportedMatched = nextEvent(reported, 'matched');
  reported.emit('start', { adultConfirmed: true });
  await Promise.all([reporterMatched, reportedMatched]);

  const reportAccepted = nextEvent(reporter, 'report-accepted');
  const left = nextEvent(reported, 'partner-left');
  reporter.emit('report', 'harassment');
  await Promise.all([reportAccepted, left]);

  const reporterWaiting = nextEvent(reporter, 'queue-status');
  const reportedWaiting = nextEvent(reported, 'queue-status');
  reporter.emit('next');
  reported.emit('next');
  await Promise.all([reporterWaiting, reportedWaiting]);
  reporter.disconnect();
  reported.disconnect();
});