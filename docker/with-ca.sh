#!/bin/sh
# Runs a command. If an extra certificate file was given as a build secret (id "extra_ca"), Node
# trusts it too. Only needed on networks that re-sign HTTPS traffic; normal builds ignore this.
if [ -f /run/secrets/extra_ca ]; then
  export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca
fi
exec "$@"
