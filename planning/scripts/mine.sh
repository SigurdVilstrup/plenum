#!/usr/bin/env bash
# Mine local git repositories for the facts Plenum claims to surface.
# Read-only: no fetch, no checkout. Numbers reflect the refs as they sit on disk.
#
#   scripts/mine.sh [root] [days]      default: ~/Dev/Repositories, 90
#
# Output is Markdown on stdout. Agent markers: Co-authored-by / Made-with /
# Generated-with trailers naming Claude, Cursor, Copilot, Codex, GPT, Gemini,
# Muse, Devin or Aider; or an author name matching the same. Both are conventions,
# which is also why the memo treats authorship as the weakest of the three facts.
set -u
ROOT=${1:-$HOME/Dev/Repositories}
DAYS=${2:-90}
SINCE="$DAYS days ago"
AGENT_RE='(claude|cursor|copilot|codex|gpt|openai|anthropic|gemini|muse|devin|aider)'

is_agent() { # $1 = sha ; prints 1 if author or trailers look agent-made
  git log -1 --format='%an%n%ae%n%(trailers)' "$1" \
    | rg -qi "^(co-authored-by|made-with|generated-with|assisted-by):.*$AGENT_RE|^[^:]*$AGENT_RE[^:]*$" && echo 1 || echo 0
}

default_branch() {
  local b
  b=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  [ -n "$b" ] && { echo "$b"; return; }
  for c in main master develop; do git show-ref -q "refs/remotes/origin/$c" && { echo "$c"; return; }; done
  git rev-parse --abbrev-ref HEAD
}

seen=""
printf '| Repo | Last fetch | Commits %dd | Agent-marked | On %s direct | of which agent | Merges into %s | Behind at merge (median / max) | Reverts | Reverts of agent work <48h |\n' "$DAYS" main main
printf '|---|---|---:|---:|---:|---:|---:|---|---:|---:|\n'

for d in "$ROOT"/*/; do
  d=${d%/}
  git -C "$d" rev-parse --git-dir >/dev/null 2>&1 || continue
  common=$(git -C "$d" rev-parse --git-common-dir 2>/dev/null); common=$(cd "$d" && cd "$common" && pwd)
  case " $seen " in *" $common "*) continue;; esac; seen="$seen $common"
  cd "$d" || continue
  name=$(basename "$d")
  main=$(default_branch)
  ref="refs/remotes/origin/$main"; git show-ref -q "$ref" || ref="$main"
  fetched=$(stat -f '%Sm' -t '%Y-%m-%d' "$common/FETCH_HEAD" 2>/dev/null || echo never)

  git rev-parse -q --verify HEAD >/dev/null 2>&1 || { printf '| %s | %s | 0 | | | | | | | |\n' "$name" "$fetched"; continue; }
  total=$(git rev-list --all --since="$SINCE" --count)
  [ "$total" -eq 0 ] && { printf '| %s | %s | 0 | | | | | | | |\n' "$name" "$fetched"; continue; }

  agent=0
  for s in $(git rev-list --all --since="$SINCE" --no-merges); do [ "$(is_agent "$s")" = 1 ] && agent=$((agent+1)); done

  # Non-merge commits on the first-parent line of main: pushed straight to main
  # (or squash-merged there; the two look the same locally, see the note below).
  direct=0; direct_agent=0
  for s in $(git rev-list --first-parent --no-merges --since="$SINCE" "$ref"); do
    direct=$((direct+1)); [ "$(is_agent "$s")" = 1 ] && direct_agent=$((direct_agent+1))
  done

  # Merge commits on main: how many commits did main have that the branch lacked?
  behinds=""
  merges=0
  for m in $(git rev-list --first-parent --merges --since="$SINCE" "$ref"); do
    p1=$(git rev-parse "$m^1"); p2=$(git rev-parse "$m^2" 2>/dev/null) || continue
    merges=$((merges+1))
    behinds="$behinds $(git rev-list --count "$p2..$p1")"
  done
  if [ "$merges" -gt 0 ]; then
    sorted=$(echo $behinds | tr ' ' '\n' | sort -n)
    median=$(echo "$sorted" | awk '{a[NR]=$1} END{print (NR%2)?a[(NR+1)/2]:(a[NR/2]+a[NR/2+1])/2}')
    max=$(echo "$sorted" | tail -1)
    over20=$(echo "$sorted" | awk '$1>20' | wc -l | tr -d ' ')
    behind_cell="$median / $max ($over20 over 20)"
  else behind_cell="no merge commits"; fi

  reverts=0; agent_reverts=0
  for r in $(git rev-list --all --since="$SINCE" --grep='^Revert'); do
    reverts=$((reverts+1))
    target=$(git log -1 --format=%b "$r" | rg -o 'reverts commit ([0-9a-f]{7,40})' -r '$1' | head -1)
    [ -z "$target" ] && continue
    git cat-file -e "$target" 2>/dev/null || continue
    [ "$(is_agent "$target")" = 1 ] || continue
    t1=$(git log -1 --format=%ct "$target"); t2=$(git log -1 --format=%ct "$r")
    [ $((t2 - t1)) -le 172800 ] && agent_reverts=$((agent_reverts+1))
  done

  printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
    "$name" "$fetched" "$total" "$agent" "$direct" "$direct_agent" "$merges" "$behind_cell" "$reverts" "$agent_reverts"
done

echo
echo "### Worktrees right now"
echo
echo '| Repo | Worktree | Branch | Dirty | Behind main | Merged into main | Last commit |'
echo '|---|---|---|---|---:|---|---|'
seen=""
for d in "$ROOT"/*/; do
  d=${d%/}
  git -C "$d" rev-parse --git-dir >/dev/null 2>&1 || continue
  common=$(git -C "$d" rev-parse --git-common-dir 2>/dev/null); common=$(cd "$d" && cd "$common" && pwd)
  case " $seen " in *" $common "*) continue;; esac; seen="$seen $common"
  cd "$d" || continue
  name=$(basename "$d"); main=$(default_branch)
  ref="refs/remotes/origin/$main"; git show-ref -q "$ref" || ref="$main"
  git worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{print w"\t"$2} /^detached/{print w"\t(detached)"}' | while IFS=$'\t' read -r wt br; do
    br=${br#refs/heads/}
    dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [ "$br" = "(detached)" ]; then behind=-; merged=-; else
      behind=$(git rev-list --count "$br..$ref" 2>/dev/null || echo '?')
      if git merge-base --is-ancestor "$br" "$ref" 2>/dev/null; then merged=yes
      elif [ -n "$(git cherry "$ref" "$br" 2>/dev/null | rg -v '^\+' )" ] && [ -z "$(git cherry "$ref" "$br" 2>/dev/null | rg '^\+')" ]; then merged="yes (squash)"
      else merged=no; fi
    fi
    age=$(git -C "$wt" log -1 --format=%cr 2>/dev/null)
    printf '| %s | %s | %s | %s files | %s | %s | %s |\n' "$name" "${wt/#$HOME/~}" "$br" "$dirty" "$behind" "$merged" "$age"
  done
done

printf '\n%s\n' \
'Notes on method. "On main direct" counts non-merge commits on the first-parent line of main.' \
'Locally a squash merge and a push straight to main look the same, so this is an upper bound;' \
'scripts/prs.sh splits it using PR numbers in subjects. "Behind at merge" needs a merge commit;' \
'squash-only repositories show "no merge commits". Agent detection is by trailer and author' \
'name, which is exactly as reliable as the agents'"'"' habits.'
