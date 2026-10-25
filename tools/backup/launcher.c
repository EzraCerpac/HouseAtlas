// Stable launcher for the scheduled iCloud backup. macOS privacy controls
// attribute iCloud Drive access to the program launchd starts, and platform
// binaries such as /bin/sh are denied without a prompt. This tiny binary is
// built once and kept at a fixed path, so the owner grants iCloud Drive access
// to it a single time and the backup script it spawns inherits that grant.
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>

extern char **environ;

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s program [arguments...]\n", argv[0]);
    return 64;
  }
  pid_t pid;
  int status;
  int rc = posix_spawn(&pid, argv[1], NULL, NULL, argv + 1, environ);
  if (rc != 0) {
    fprintf(stderr, "houseatlas-backup: cannot start %s (error %d)\n", argv[1], rc);
    return 70;
  }
  while (waitpid(pid, &status, 0) < 0) {
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
