limit=${1:-100}
offset=${2:-0}
echo $limit
echo $offset
node app.js $((limit)) $((offset))  & my_prog_pid="$!" | tee out.txt
echo $my_prog_pid
FILE="out.txt"
LAST_MODIFIED=$(stat -c "%Y" $FILE)

while true; do
  sleep 120
  CURRENT_MODIFIED=$(stat -c "%Y" $FILE)
  if [ $LAST_MODIFIED -eq $CURRENT_MODIFIED ]; then
    echo "File not modified in the last 2 minutes. Terminating program."
    break
    exit
  fi
  LAST_MODIFIED=$CURRENT_MODIFIED
done

kill -9 "$my_prog_pid"
exit 0