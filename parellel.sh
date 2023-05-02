docker build -t crawler .
batch_size=20
parallelism=5
for i in {1..$parallelism}; do
  container_id=$(docker run -d crawler)
  docker exec -it $container_id tmux new -s run -d
  docker exec -it $container_id tmux send-keys -t run "node app.js $((i*batch_size)) $(((i-1)*batch_size))" C-m
done
