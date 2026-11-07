#!/usr/bin/env bash
# One-shot deploy: create the GitHub repo, push, enable Pages, wait for the build,
# and verify the live site. Reads the token from $GH_TOKEN (never written to disk).
#
#   GH_TOKEN=ghp_xxx ./deploy-to-github.sh [repo-name] [private|public]
set -uo pipefail

REPO="${1:-bionic-visual-programming-environment}"
VIS="${2:-public}"
API="https://api.github.com"
STATUS="000"
BODY=""

if [ -z "${GH_TOKEN:-}" ]; then
  printf '\033[31m✗ GH_TOKEN is not set.\033[0m\n'
  printf '  Run it like:  GH_TOKEN=ghp_xxx ./deploy-to-github.sh\n'
  exit 2
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# api METHOD PATH [JSON] — sets the globals $STATUS and $BODY.
# Deliberately not called inside $(...): a subshell would swallow both.
api() {
  local method="$1" path="$2" json="${3:-}" out
  if [ -n "$json" ]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -d "$json" "$API$path") || out=$'\n000'
  else
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$API$path") || out=$'\n000'
  fi
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

field() { printf '%s' "${1:-}" | sed -n "s/.*\"$2\"[:][[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# ── 1. Who are we? ────────────────────────────────────────────────────────────
say "Validating token"
api GET /user
if [ "$STATUS" != "200" ]; then
  bad "Token rejected (HTTP $STATUS): $(field "$BODY" message)"
  exit 1
fi
OWNER=$(field "$BODY" login)
ok "Authenticated as $OWNER"

SCOPES=$(curl -sS -I -H "Authorization: Bearer $GH_TOKEN" "$API/user" 2>/dev/null \
  | grep -i '^x-oauth-scopes:' | tr -d '\r' || true)
if [ -n "$SCOPES" ]; then echo "  $SCOPES"; else echo "  (fine-grained token — no scope header, which is normal)"; fi

# ── 2. Create the repository ──────────────────────────────────────────────────
say "Creating repository $OWNER/$REPO ($VIS)"
PRIV=false; [ "$VIS" = private ] && PRIV=true
api POST /user/repos "$(printf '{"name":"%s","description":"Neural Studio - a bionic visual programming environment","private":%s,"has_issues":true,"has_wiki":false}' "$REPO" "$PRIV")"
case "$STATUS" in
  201) ok "Created" ;;
  422) ok "Already exists — pushing into it" ;;
  *)   bad "Could not create (HTTP $STATUS): $(field "$BODY" message)"
       printf '  → Create it by hand at https://github.com/new, then re-run.\n'; exit 1 ;;
esac

# ── 3. Point package.json at the real repo, then push ─────────────────────────
cd "$DIR"
if grep -q 'USERNAME' package.json; then
  python3 - "$OWNER" "$REPO" <<'PY'
import json, sys, collections
owner, repo = sys.argv[1], sys.argv[2]
d = json.load(open('package.json'), object_pairs_hook=collections.OrderedDict)
d['homepage'] = f'https://{owner}.github.io/{repo}/'
d['repository'] = {'type': 'git', 'url': f'https://github.com/{owner}/{repo}.git'}
open('package.json', 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
PY
  git add package.json
  git -c user.name="Neural Studio" -c user.email="dev@local" \
      commit -q -m "Point package.json at $OWNER/$REPO"
  ok "Set homepage + repository in package.json"
fi

say "Pushing main"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$REPO.git"
if git push -q --set-upstream "https://x-access-token:$GH_TOKEN@github.com/$OWNER/$REPO.git" main 2>/tmp/push.err; then
  ok "Pushed $(git rev-parse --short HEAD) to $OWNER/$REPO"
else
  bad "Push failed:"; sed 's/^/    /' /tmp/push.err | head -8
  printf '  → If it mentions "workflow scope", add Workflows: write to the token.\n'; exit 1
fi

# ── 4. Enable Pages (the step a workflow's GITHUB_TOKEN can never do) ─────────
say "Enabling GitHub Pages"
api POST "/repos/$OWNER/$REPO/pages" '{"build_type":"workflow"}'
case "$STATUS" in
  201) ok "Pages created, source: GitHub Actions" ;;
  409) ok "Pages already enabled" ;;
  *)   bad "HTTP $STATUS: $(field "$BODY" message)"
       printf '  → Flip it manually: https://github.com/%s/%s/settings/pages\n' "$OWNER" "$REPO" ;;
esac

# ── 5. Wait for the workflow ──────────────────────────────────────────────────
say "Waiting for the deploy workflow"
RUN_ID=""
for i in $(seq 1 60); do
  api GET "/repos/$OWNER/$REPO/actions/runs?per_page=1"
  RUN_ID=$(printf '%s' "$BODY" | grep -o '"id":[0-9]\{6,\}' | head -1 | cut -d: -f2)
  if [ -z "$RUN_ID" ]; then
    [ "$i" = 1 ] && echo "  no runs yet — dispatching the workflow"
    api POST "/repos/$OWNER/$REPO/actions/workflows/deploy.yml/dispatches" '{"ref":"main"}'
    sleep 6; continue
  fi
  api GET "/repos/$OWNER/$REPO/actions/runs/$RUN_ID"
  STATE=$(field "$BODY" status)
  CONC=$(printf '%s' "$BODY" | sed -n 's/.*"conclusion":\([^,}]*\).*/\1/p' | head -1 | tr -d '"')
  printf '  run %s: %s%s\n' "$RUN_ID" "${STATE:-?}" "${CONC:+/$CONC}"
  if [ "$STATE" = "completed" ]; then
    if [ "${CONC:-}" = "success" ]; then ok "Workflow succeeded"
    else bad "Workflow concluded: ${CONC:-unknown}"
         printf '  → Logs: https://github.com/%s/%s/actions/runs/%s\n' "$OWNER" "$REPO" "$RUN_ID"
         exit 1; fi
    break
  fi
  sleep 10
done

# ── 6. Verify the live site ───────────────────────────────────────────────────
say "Verifying the live site"
api GET "/repos/$OWNER/$REPO/pages"
URL=$(field "$BODY" html_url)
[ -z "$URL" ] && URL="https://$OWNER.github.io/$REPO/"

CODE="000"
for i in $(seq 1 20); do
  CODE=$(curl -sS -L -o /tmp/live.html -w '%{http_code}' "$URL" 2>/dev/null) || CODE="000"
  [ "$CODE" = "200" ] && break
  sleep 6
done

if [ "$CODE" = "200" ]; then
  ok "HTTP 200 — $(wc -c < /tmp/live.html) bytes"
  if grep -q 'Neural Studio' /tmp/live.html; then ok "Page contains the app"; else bad "Unexpected page content"; fi
  printf '\n\033[1;32m🎉 Live at %s\033[0m\n' "$URL"
else
  bad "Not live yet (HTTP $CODE). First Pages publish can take a minute or two."
  printf '  Check https://github.com/%s/%s/actions\n' "$OWNER" "$REPO"
fi
