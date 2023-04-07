#!/usr/bin/env bash

node app.js & my_prog_pid="$!" | tee out.txt
echo $my_prog_pid
FILE="out.txt"
LAST_MODIFIED=$(stat -f "%m" $FILE)

while true; do
  sleep 15
  CURRENT_MODIFIED=$(stat -f "%m" $FILE)
  if [ $LAST_MODIFIED -eq $CURRENT_MODIFIED ]; then
    echo "File not modified in the last 15 seconds. Terminating program."
    break
    exit
  fi
  LAST_MODIFIED=$CURRENT_MODIFIED
done

kill -9 "$my_prog_pid"
exit 0