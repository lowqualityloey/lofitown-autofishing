#!/usr/bin/env bash
# AutoFish launcher: one command, one terminal, nothing to remember.
#
#   ./run.sh
#
# It picks a free port (8731 if nothing has it), starts fishserve.js, waits until it actually
# answers, then prints the two things a human needs:
#   1. the install page URL - open it once and drag/click the bookmarklet
#   2. the raw javascript: URL - paste it as a bookmark if dragging is awkward
#
# Keep this terminal open while fishing. Ctrl-C stops the server (and the panel in the game tab
# will stop being able to reach it - click the bookmarklet again after the next start).
set -euo pipefail

cd "$(dirname "$0")"

die() { echo "run.sh: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || die "node is not installed (or not on PATH)"

# First free port at or above 8731, so an existing bookmarklet keeps working when possible.
PORT="$(node -e '
const net = require("net");
const tryPort = (p) => new Promise((res) => {
  const s = net.createServer();
  s.once("error", () => res(false));
  s.listen(p, "0.0.0.0", () => s.close(() => res(true)));
});
(async () => {
  for (let p = 8731; p <= 8790; p++) if (await tryPort(p)) { console.log(p); return; }
  console.log(0);
})();
')" || die "could not probe for a free port"
[ "$PORT" != "0" ] || die "no free port between 8731 and 8790"

STARTED=0
cleanup() {
  if [ "$STARTED" = "1" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

FISHSERVE_PORT="$PORT" node fishserve.js &
SERVER_PID=$!
STARTED=1

# Ready means it serves the bot file, not just that the process exists.
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/autofish.js" -o /dev/null 2>/dev/null; then
    READY=1
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || die "fishserve exited while starting up - run 'node fishserve.js' to see why"
  sleep 0.2
done
[ "${READY:-0}" = "1" ] || die "fishserve did not answer on port $PORT after 12s"

ORIGIN="http://127.0.0.1:$PORT"
BOOKMARKLET="javascript:(()=>{if(window.__panel&&window.__panel.mounted)return;const s=document.createElement('script');s.src='$ORIGIN/panel.js?'+Date.now();s.onerror=()=>alert('AutoFish: fishserve is not running');document.documentElement.appendChild(s)})()"

cat <<EOF

  AutoFish is up on port $PORT  (pid $SERVER_PID)

  1. Open once, then drag the button to your bookmarks bar:
       $ORIGIN/install

  2. On https://app.lofi.town click that bookmark, then press Start in the panel.

     No dragging? Copy this whole line into a new bookmark's URL field:

$BOOKMARKLET

  Catch log: $ORIGIN/recent  -  the CSV is catches.csv
  Ctrl-C here stops the server. The panel dies with it, so click the bookmarklet again
  after the next ./run.sh.

EOF

wait "$SERVER_PID"
