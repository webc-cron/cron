#!/usr/bin/env bash

set -e
DIR=$(realpath $0) && DIR=${DIR%/*}
cd $DIR
set -a
PATH=$(dirname $DIR)/bin:$PATH
set +a
set -x

# clone_or_pull.sh git@gitcode.com:js0/ssl.git

bun i

./main.js

# ./rsync.js

# cd ssl
#
# git add . && git commit -m. && git push || true
