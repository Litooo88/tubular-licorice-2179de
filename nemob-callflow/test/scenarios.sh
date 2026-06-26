#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
CALLER="${CALLER:-+46701112233}"
TO="${TO:-+46101385498}"

post_form() {
  local path="$1"
  local data="$2"
  curl -fsS -X POST "$BASE_URL$path" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "$data"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $label"
    echo "Expected to find: $needle"
    echo "Response: $haystack"
    exit 1
  fi
  echo "PASS: $label"
}

echo "Scenario 1: office-hours IVR option 1 -> Verkstaden workshop"
resp=$(post_form "/route/from-ivr" "callid=test-1&from=$CALLER&to=$TO&result=1")
assert_contains "$resp" '"/dial/workshop' "routes option 1 to Verkstaden dial"

echo "Scenario 2: Verkstaden misses -> Sebastian fallback"
resp=$(post_form "/dial/workshop?callid=test-2&from=$CALLER&ivr_choice=1" "callid=test-2&from=$CALLER&to=$TO")
assert_contains "$resp" '"/dial/sebastian-fallback' "Verkstaden dial has Sebastian fallback"

echo "Scenario 3: both miss -> voicemail"
resp=$(post_form "/dial/sebastian-fallback?callid=test-3&from=$CALLER&ivr_choice=1" "callid=test-3&from=$CALLER&to=$TO")
assert_contains "$resp" '"/voicemail' "Sebastian fallback has voicemail next"

echo "Scenario 4: IVR option 2 -> Sebastian sales"
resp=$(post_form "/route/from-ivr" "callid=test-4&from=$CALLER&to=$TO&result=2")
assert_contains "$resp" '"/dial/sebastian' "routes option 2 to Sebastian dial"

echo "Scenario 5: voicemail record action"
resp=$(post_form "/voicemail?callid=test-5&from=$CALLER&ivr_choice=outside_hours" "callid=test-5&from=$CALLER&to=$TO")
assert_contains "$resp" '"/record' "voicemail prompt chains to record"
resp=$(post_form "/record?callid=test-5&from=$CALLER&ivr_choice=outside_hours" "callid=test-5&from=$CALLER&to=$TO")
assert_contains "$resp" '"record"' "record action returned"
assert_contains "$resp" '"timelimit":90' "record timelimit is 90 seconds"

echo "All scenario response checks passed."
echo "D1 assertion example after wrangler dev: wrangler d1 execute nemob-callflow --local --command \"SELECT * FROM call_log ORDER BY id DESC LIMIT 10\""
