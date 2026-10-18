---
status: accepted
---

# A Node.js program on the PC, with the dashboard as a web page

F1 25 sends its Telemetry Feed as UDP, and a web browser cannot receive UDP. So a small Node.js (TypeScript) program on the gaming PC does several jobs:

- receives the Telemetry Feed
- saves every Recorded Lap
- does any Forwarding
- streams live values over a WebSocket to a web page that the tablet opens over the home network

We chose this over a native tablet app, which could receive the game's UDP data directly. Our way, recordings and Lap Analysis stay on the PC, one responsive web page works on the tablet, a phone and the PC monitor, and nothing has to be installed on the tablet.

## Considered Options

- **Native tablet app (iPad or Android).** It could receive the game's data directly with no PC program, but recordings would live on the tablet, it would only run on one platform, and Lap Analysis would need a second app on the PC.
- **Python program instead of Node.js.** It would work just as well, but the web page is written in TypeScript anyway, so Node.js keeps the whole app in one language.

## Consequences

- The tablet opens a plain `http://` address on the local network, which browsers do not treat as a secure page. Browser features that need a secure page, such as keeping the screen awake, will not work. Either set the tablet's auto-lock to "never" while racing, or add HTTPS or another workaround later.
- Windows Firewall must allow incoming UDP on the game's telemetry port (20777 by default) and incoming TCP on the web page's port.
