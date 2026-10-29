# sideby

sideby is an anonymous, text-only random chat app. People can enter optional topics to help find common ground, message in real time, leave or skip a chat, and report/block a stranger. No account or video is used.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000. Set `PORT` to use a different port.

## Checks

```sh
npm test
```

Reports are written to the server log; this demo does not include a staffed moderation dashboard or persistent user accounts. Chat messages are relayed between connected browsers and are not stored by the server.