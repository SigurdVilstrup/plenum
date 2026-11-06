#!/usr/bin/env bash
# Pull request facts for one GitHub repository over the last N days, via gh.
#
#   scripts/prs.sh MobaroIT/mobaro [days] [local-clone]
#
# Prints: merged PR count, cycle time (opened to merged), merge method, agent-
# prefixed branches, direct pushes to main (commits on main with no PR number),
# and force pushes on a sample of the 60 most recent PRs. Read-only.
set -u
REPO=${1:?owner/repo}; DAYS=${2:-90}; CLONE=${3:-}
SINCE=$(date -v-"$DAYS"d +%Y-%m-%d)
TMP=$(mktemp -d)

gh api --paginate "repos/$REPO/pulls?state=closed&per_page=100&sort=updated&direction=desc" \
  --jq '.[] | select(.merged_at != null and .merged_at >= "'"$SINCE"'") | [.number, .created_at, .merged_at, .user.login, .head.ref, .merge_commit_sha] | @tsv' \
  > "$TMP/prs.tsv"

python3 - "$TMP/prs.tsv" <<'PY'
import csv, sys, statistics, datetime as dt, collections
rows = list(csv.reader(open(sys.argv[1]), delimiter='\t'))
h = sorted((dt.datetime.fromisoformat(r[2].replace('Z','+00:00')) - dt.datetime.fromisoformat(r[1].replace('Z','+00:00'))).total_seconds()/3600 for r in rows)
print(f"merged PRs: {len(h)}")
if h:
    print(f"cycle time, hours: median {statistics.median(h):.1f}, p75 {h[int(len(h)*.75)]:.1f}, p90 {h[int(len(h)*.9)]:.1f}, max {h[-1]:.0f}")
    print(f"merged under 1h: {sum(x<1 for x in h)}, under 24h: {sum(x<24 for x in h)}, over 7d: {sum(x>168 for x in h)}")
print("by author:", collections.Counter(r[3] for r in rows).most_common(8))
print("agent-prefixed branches (cursor/, claude/, copilot/):", sum(r[4].startswith(('cursor/','claude/','copilot/')) for r in rows))
PY

if [ -n "$CLONE" ]; then
  sq=0; mg=0
  while IFS=$'\t' read -r _ _ _ _ _ sha; do
    p=$(git -C "$CLONE" cat-file -p "$sha" 2>/dev/null | grep -c '^parent ')
    if [ "$p" = "2" ]; then mg=$((mg+1)); else sq=$((sq+1)); fi
  done < "$TMP/prs.tsv"
  echo "merge method: squash or rebase $sq, merge commit $mg"
  direct=$(git -C "$CLONE" rev-list --first-parent --no-merges --since="$DAYS days ago" origin/HEAD --format=%s | grep -v '^commit' | grep -vc '(#[0-9]\+)')
  echo "commits on main with no PR number (pushed straight to main): $direct"
fi

n=0; fp=0; prs_fp=0
for num in $(cut -f1 "$TMP/prs.tsv" | head -60); do
  c=$(gh api --paginate "repos/$REPO/issues/$num/timeline?per_page=100" --jq '[.[] | select(.event=="head_ref_force_pushed")] | length' 2>/dev/null | paste -sd+ - | bc)
  n=$((n+1)); fp=$((fp+${c:-0})); [ "${c:-0}" -gt 0 ] && prs_fp=$((prs_fp+1))
done
echo "force pushes: $fp events across $n sampled PRs, $prs_fp PRs with at least one"
rm -rf "$TMP"
