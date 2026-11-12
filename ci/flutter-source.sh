#!/usr/bin/env bash
set -euo pipefail

if [[ -f pubspec.yaml && -f pubspec.lock ]]; then
  printf '%s\n' .
  exit
fi

# This is the Flutter snapshot shared by the Academix mobile team.
source_dir=".academix-flutter"
source_repo="https://github.com/Santy28-Bv/Movil-Cursos.git"
source_commit="1e7303800abb8bf2d63b04cfe6a595ded94c61d6"

git init --quiet "$source_dir"
git -C "$source_dir" fetch --quiet --depth 1 --no-tags "$source_repo" "$source_commit"
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$source_commit" ]]
printf '%s\n' "$source_dir"
