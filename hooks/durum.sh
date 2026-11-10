#!/bin/bash
# Claude Code hook'u: oturum Pano içindeyse olayı Pano'ya bildirir, değilse hiçbir şey yapmaz.
[ -z "$PANO_AGENT_ID" ] || [ -z "$PANO_PORT" ] && { cat >/dev/null; exit 0; }
curl -s -m 2 -o /dev/null \
  -H "X-Pano-Jeton: $PANO_JETON" -H "X-Pano-Ajan: $PANO_AGENT_ID" -H "Content-Type: application/json" \
  --data-binary @- "http://127.0.0.1:$PANO_PORT/olay" 2>/dev/null
exit 0
