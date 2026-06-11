#!/bin/bash

# ============================================================
# SOULSYNC API — COMPLETE ROUTE TESTING SCRIPT
# ============================================================
# Usage: ./test_routes.sh
# Auto-starts the server, runs all tests, then stops it.
# ============================================================

BASE="http://localhost:8000/api"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass=0; fail=0
SERVER_PID=""
SERVER_LOG="/tmp/soulsync_server.log"

# ── Start server if not already running ─────────────────────
start_server() {
  if curl -s "$BASE/health" >/dev/null 2>&1; then
    echo -e "${GREEN}Server already running on port 8000${NC}"
    return
  fi
  echo -e "${CYAN}Starting SoulSync server...${NC}"
  node server.js > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  # Wait up to 15 seconds for server to be ready
  for i in $(seq 1 30); do
    if curl -s "$BASE/health" >/dev/null 2>&1; then
      echo -e "${GREEN}Server started (PID: $SERVER_PID) ✅${NC}"
      return
    fi
    sleep 0.5
  done

  echo -e "${RED}Server failed to start. Logs:${NC}"
  cat "$SERVER_LOG"
  exit 1
}

# ── Stop server on exit ──────────────────────────────────────
cleanup() {
  if [ ! -z "$SERVER_PID" ]; then
    echo -e "\n${CYAN}Stopping server (PID: $SERVER_PID)...${NC}"
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    rm -f "$SERVER_LOG"
  fi
}
trap cleanup EXIT

start_server

log_section() { echo -e "\n${CYAN}${BOLD}══════════════════════════════════════${NC}"; echo -e "${CYAN}${BOLD}  $1${NC}"; echo -e "${CYAN}${BOLD}══════════════════════════════════════${NC}"; }
log_test() { echo -e "${YELLOW}▶ TEST: $1${NC}"; }

check() {
  local label="$1"
  local response="$2"
  local expect="${3:-true}"
  if echo "$response" | grep -q "\"success\":$expect\|\"success\": $expect"; then
    echo -e "  ${GREEN}✅ PASS: $label${NC}"
    pass=$((pass+1))
  else
    echo -e "  ${RED}❌ FAIL: $label${NC}"
    echo -e "  ${RED}Response: $(echo $response | head -c 200)${NC}"
    fail=$((fail+1))
  fi
}

# ============================================================
log_section "1. HEALTH CHECK"
# ============================================================
log_test "Server health"
R=$(curl -s "$BASE/health")
check "GET /api/health" "$R"

# ============================================================
log_section "2. AUTH — USER REGISTRATION"
# ============================================================
TIMESTAMP=$(date +%s)

log_test "Register User 1 (Partner A)"
R=$(curl -s -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Avinash\",\"nickname\":\"Avi\",\"email\":\"avi_${TIMESTAMP}@test.com\",\"password\":\"Test@1234\",\"relationshipStartDate\":\"2024-01-01\"}")
check "POST /auth/register (User A)" "$R"
TOKEN_A=$(echo $R | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER_A_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)
COUPLE_CODE=$(echo $R | grep -o '"coupleCode":"[^"]*"' | cut -d'"' -f4)
CONN_PASS=$(echo $R | grep -o '"connectionPassword":"[^"]*"' | cut -d'"' -f4)
echo -e "  ${CYAN}Token A: ${TOKEN_A:0:30}...${NC}"
echo -e "  ${CYAN}Couple Code: $COUPLE_CODE | Password: $CONN_PASS${NC}"

log_test "Register User 2 (Partner B)"
R=$(curl -s -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Priya\",\"nickname\":\"Pri\",\"email\":\"priya_${TIMESTAMP}@test.com\",\"password\":\"Test@1234\"}")
check "POST /auth/register (User B)" "$R"
TOKEN_B=$(echo $R | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER_B_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Login User A"
R=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"avi_${TIMESTAMP}@test.com\",\"password\":\"Test@1234\"}")
check "POST /auth/login" "$R"

log_test "Login with wrong password"
R=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"avi_${TIMESTAMP}@test.com\",\"password\":\"WrongPass\"}")
check "POST /auth/login (wrong pwd returns 401)" "$R" "false"

log_test "Get Profile A"
R=$(curl -s "$BASE/auth/profile" -H "Authorization: Bearer $TOKEN_A")
check "GET /auth/profile" "$R"

log_test "Update Profile A"
R=$(curl -s -X PUT "$BASE/auth/profile" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Avinash Updated","nickname":"Avi2"}')
check "PUT /auth/profile" "$R"

log_test "Regenerate couple codes"
R=$(curl -s -X POST "$BASE/auth/regenerate-codes" -H "Authorization: Bearer $TOKEN_A")
check "POST /auth/regenerate-codes" "$R"
NEW_CODE=$(echo $R | grep -o '"coupleCode":"[^"]*"' | cut -d'"' -f4)
NEW_PASS=$(echo $R | grep -o '"connectionPassword":"[^"]*"' | cut -d'"' -f4)
if [ ! -z "$NEW_CODE" ]; then
  COUPLE_CODE=$NEW_CODE; CONN_PASS=$NEW_PASS
  echo -e "  ${CYAN}New Code: $COUPLE_CODE | New Pass: $CONN_PASS${NC}"
fi

# ============================================================
log_section "3. RELATIONSHIP — CONNECT & APPROVE"
# ============================================================
log_test "Partner B connects with code+password"
R=$(curl -s -X POST "$BASE/relationship/connect" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"coupleCode\":\"$COUPLE_CODE\",\"connectionPassword\":\"$CONN_PASS\"}")
check "POST /relationship/connect" "$R"
REL_ID=$(echo $R | grep -o '"relationshipId":"[^"]*"' | cut -d'"' -f4)
echo -e "  ${CYAN}Relationship ID: $REL_ID${NC}"

log_test "Partner A approves connection"
R=$(curl -s -X POST "$BASE/relationship/approve" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"relationshipId\":\"$REL_ID\"}")
check "POST /relationship/approve (User A)" "$R"

log_test "Partner B approves connection"
R=$(curl -s -X POST "$BASE/relationship/approve" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"relationshipId\":\"$REL_ID\"}")
check "POST /relationship/approve (User B)" "$R"

# Refresh tokens to get updated relationship info
log_test "Re-login User A (to get updated profile)"
R=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"avi_${TIMESTAMP}@test.com\",\"password\":\"Test@1234\"}")
TOKEN_A=$(echo $R | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

log_test "Re-login User B"
R=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"priya_${TIMESTAMP}@test.com\",\"password\":\"Test@1234\"}")
TOKEN_B=$(echo $R | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

log_test "Get Dashboard"
R=$(curl -s "$BASE/relationship/dashboard" -H "Authorization: Bearer $TOKEN_A")
check "GET /relationship/dashboard" "$R"

log_test "Get Relationship Info"
R=$(curl -s "$BASE/relationship/info" -H "Authorization: Bearer $TOKEN_A")
check "GET /relationship/info" "$R"

# ============================================================
log_section "4. CHAT — MESSAGES"
# ============================================================
log_test "Send text message"
R=$(curl -s -X POST "$BASE/chat/messages" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello my love! ❤️","type":"text"}')
check "POST /chat/messages (text)" "$R"
MSG_ID=$(echo $R | grep -o '"messageId":"[^"]*"' | cut -d'"' -f4)

log_test "Send reply message"
R=$(curl -s -X POST "$BASE/chat/messages" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"I miss you too! 🥺\",\"type\":\"text\",\"replyTo\":\"$MSG_ID\"}")
check "POST /chat/messages (reply)" "$R"

log_test "Send secret message"
R=$(curl -s -X POST "$BASE/chat/messages" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"content":"This is our secret 🤫","isSecret":true}')
check "POST /chat/messages (secret)" "$R"

log_test "Get messages"
R=$(curl -s "$BASE/chat/messages" -H "Authorization: Bearer $TOKEN_A")
check "GET /chat/messages" "$R"

log_test "React to message"
R=$(curl -s -X POST "$BASE/chat/messages/$MSG_ID/react" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"emoji":"❤️"}')
check "POST /chat/messages/:id/react" "$R"

log_test "Pin message"
R=$(curl -s -X PUT "$BASE/chat/messages/$MSG_ID/pin" -H "Authorization: Bearer $TOKEN_A")
check "PUT /chat/messages/:id/pin" "$R"

log_test "Favorite message"
R=$(curl -s -X PUT "$BASE/chat/messages/$MSG_ID/favorite" -H "Authorization: Bearer $TOKEN_A")
check "PUT /chat/messages/:id/favorite" "$R"

log_test "Get pinned messages"
R=$(curl -s "$BASE/chat/messages/pinned" -H "Authorization: Bearer $TOKEN_A")
check "GET /chat/messages/pinned" "$R"

log_test "Get favorite messages"
R=$(curl -s "$BASE/chat/messages/favorites" -H "Authorization: Bearer $TOKEN_A")
check "GET /chat/messages/favorites" "$R"

log_test "Get secret messages"
R=$(curl -s "$BASE/chat/messages/secret" -H "Authorization: Bearer $TOKEN_A")
check "GET /chat/messages/secret" "$R"

log_test "Search messages"
R=$(curl -s "$BASE/chat/messages/search?q=love" -H "Authorization: Bearer $TOKEN_A")
check "GET /chat/messages/search" "$R"

log_test "Mark messages as read"
R=$(curl -s -X PUT "$BASE/chat/messages/read" -H "Authorization: Bearer $TOKEN_B")
check "PUT /chat/messages/read" "$R"

log_test "Forward message"
R=$(curl -s -X POST "$BASE/chat/messages/$MSG_ID/forward" -H "Authorization: Bearer $TOKEN_A")
check "POST /chat/messages/:id/forward" "$R"

log_test "Remove reaction"
R=$(curl -s -X DELETE "$BASE/chat/messages/$MSG_ID/react" -H "Authorization: Bearer $TOKEN_B")
check "DELETE /chat/messages/:id/react" "$R"

# ============================================================
log_section "5. MUSIC ROOM"
# ============================================================
log_test "Get music session"
R=$(curl -s "$BASE/music/session" -H "Authorization: Bearer $TOKEN_A")
check "GET /music/session" "$R"

log_test "Set track and play"
R=$(curl -s -X POST "$BASE/music/session/playback" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"action":"set_track","track":{"title":"Perfect","artist":"Ed Sheeran","album":"÷","duration":263}}')
check "POST /music/session/playback (set_track)" "$R"

log_test "Pause music"
R=$(curl -s -X POST "$BASE/music/session/playback" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"action":"pause"}')
check "POST /music/session/playback (pause)" "$R"

log_test "Seek music"
R=$(curl -s -X POST "$BASE/music/session/playback" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"action":"seek","position":45}')
check "POST /music/session/playback (seek)" "$R"

log_test "Add to queue"
R=$(curl -s -X POST "$BASE/music/queue" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"track":{"title":"A Thousand Years","artist":"Christina Perri","duration":285}}')
check "POST /music/queue" "$R"

log_test "Get queue"
R=$(curl -s "$BASE/music/queue" -H "Authorization: Bearer $TOKEN_A")
check "GET /music/queue" "$R"

log_test "Get listening history"
R=$(curl -s "$BASE/music/history" -H "Authorization: Bearer $TOKEN_A")
check "GET /music/history" "$R"

log_test "Get recommendations"
R=$(curl -s "$BASE/music/recommendations" -H "Authorization: Bearer $TOKEN_A")
check "GET /music/recommendations" "$R"

log_test "Create playlist"
R=$(curl -s -X POST "$BASE/music/playlists" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Our Love Songs","description":"Songs that remind us of each other"}')
check "POST /music/playlists" "$R"
PLAYLIST_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Get playlists"
R=$(curl -s "$BASE/music/playlists" -H "Authorization: Bearer $TOKEN_A")
check "GET /music/playlists" "$R"

log_test "Add track to playlist"
R=$(curl -s -X POST "$BASE/music/playlists/$PLAYLIST_ID/tracks" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"track":{"title":"All of Me","artist":"John Legend","duration":269}}')
check "POST /music/playlists/:id/tracks" "$R"

log_test "Update playlist"
R=$(curl -s -X PUT "$BASE/music/playlists/$PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Our Love Songs Updated"}')
check "PUT /music/playlists/:id" "$R"

log_test "Remove from queue"
R=$(curl -s -X DELETE "$BASE/music/queue" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"index":0}')
check "DELETE /music/queue (by index)" "$R"

# ============================================================
log_section "6. PHOTO MEMORY VAULT"
# ============================================================
log_test "Create album"
R=$(curl -s -X POST "$BASE/photos/albums" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Our First Date","description":"Memories from our first date"}')
check "POST /photos/albums" "$R"
ALBUM_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Get albums"
R=$(curl -s "$BASE/photos/albums" -H "Authorization: Bearer $TOKEN_A")
check "GET /photos/albums" "$R"

log_test "Upload photo (test image)"
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > /tmp/test_photo.png
R=$(curl -s -X POST "$BASE/photos/upload" \
  -H "Authorization: Bearer $TOKEN_A" \
  -F "photo=@/tmp/test_photo.png" \
  -F "caption=Our special moment ❤️" \
  -F "albumId=$ALBUM_ID" \
  -F "locationName=Central Park" \
  -F "lat=40.7829" \
  -F "lng=-73.9654")
check "POST /photos/upload" "$R"
PHOTO_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Get photos"
R=$(curl -s "$BASE/photos/" -H "Authorization: Bearer $TOKEN_A")
check "GET /photos/" "$R"

log_test "Toggle photo favorite"
R=$(curl -s -X PUT "$BASE/photos/$PHOTO_ID/favorite" -H "Authorization: Bearer $TOKEN_A")
check "PUT /photos/:id/favorite" "$R"

log_test "Add comment to photo"
R=$(curl -s -X POST "$BASE/photos/$PHOTO_ID/comment" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"text":"This is so beautiful! 😍"}')
check "POST /photos/:id/comment" "$R"

log_test "Get favorite photos"
R=$(curl -s "$BASE/photos/favorites" -H "Authorization: Bearer $TOKEN_A")
check "GET /photos/favorites" "$R"

log_test "Search photos"
R=$(curl -s "$BASE/photos/search?q=special" -H "Authorization: Bearer $TOKEN_A")
check "GET /photos/search" "$R"

log_test "Get memory map"
R=$(curl -s "$BASE/photos/map" -H "Authorization: Bearer $TOKEN_A")
check "GET /photos/map" "$R"

log_test "Get album photos"
R=$(curl -s "$BASE/photos/albums/$ALBUM_ID/photos" -H "Authorization: Bearer $TOKEN_A")
check "GET /photos/albums/:id/photos" "$R"

log_test "Update album"
R=$(curl -s -X PUT "$BASE/photos/albums/$ALBUM_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Our First Date — Updated","description":"Updated memories"}')
check "PUT /photos/albums/:id" "$R"

# ============================================================
log_section "7. DIARY"
# ============================================================
log_test "Create shared diary entry"
R=$(curl -s -X POST "$BASE/diary" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"title":"Our First Day Together","content":"Today was magical. We walked hand in hand and everything felt perfect.","mood":"loved","isPrivate":false,"tags":["first-day","magical"]}')
check "POST /diary (shared)" "$R"
DIARY_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Create private diary entry"
R=$(curl -s -X POST "$BASE/diary" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"title":"My Secret Thoughts","content":"I was so nervous today but she smiled and everything was okay.","mood":"happy","isPrivate":true}')
check "POST /diary (private)" "$R"

log_test "Get all diary entries"
R=$(curl -s "$BASE/diary" -H "Authorization: Bearer $TOKEN_A")
check "GET /diary" "$R"

log_test "Get specific diary entry"
R=$(curl -s "$BASE/diary/$DIARY_ID" -H "Authorization: Bearer $TOKEN_A")
check "GET /diary/:id" "$R"

log_test "Get shared entries"
R=$(curl -s "$BASE/diary/shared" -H "Authorization: Bearer $TOKEN_B")
check "GET /diary/shared" "$R"

log_test "Get private entries"
R=$(curl -s "$BASE/diary/private" -H "Authorization: Bearer $TOKEN_A")
check "GET /diary/private" "$R"

log_test "Update diary entry"
R=$(curl -s -X PUT "$BASE/diary/$DIARY_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"title":"Our First Day Together (Updated)","mood":"loved"}')
check "PUT /diary/:id" "$R"

log_test "Favorite diary entry"
R=$(curl -s -X PUT "$BASE/diary/$DIARY_ID/favorite" -H "Authorization: Bearer $TOKEN_A")
check "PUT /diary/:id/favorite" "$R"

log_test "Search diary"
R=$(curl -s "$BASE/diary/search?q=magical" -H "Authorization: Bearer $TOKEN_A")
check "GET /diary/search" "$R"

log_test "Get calendar view"
R=$(curl -s "$BASE/diary/calendar?year=$(date +%Y)&month=$(date +%m)" -H "Authorization: Bearer $TOKEN_A")
check "GET /diary/calendar" "$R"

# ============================================================
log_section "8. SCHEDULED MESSAGES"
# ============================================================
FUTURE=$(date -v+1H '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || date -d "+1 hour" '+%Y-%m-%dT%H:%M:%S')

log_test "Schedule a message"
R=$(curl -s -X POST "$BASE/scheduled" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Good Morning my love! ❤️\",\"type\":\"text\",\"scheduledAt\":\"${FUTURE}\"}")
check "POST /scheduled" "$R"
SCHED_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Get scheduled messages"
R=$(curl -s "$BASE/scheduled" -H "Authorization: Bearer $TOKEN_A")
check "GET /scheduled" "$R"

log_test "Get upcoming messages"
R=$(curl -s "$BASE/scheduled/upcoming" -H "Authorization: Bearer $TOKEN_A")
check "GET /scheduled/upcoming" "$R"

log_test "Update scheduled message"
R=$(curl -s -X PUT "$BASE/scheduled/$SCHED_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Good Morning beautiful! 🌸\",\"scheduledAt\":\"${FUTURE}\"}")
check "PUT /scheduled/:id" "$R"

log_test "Cancel scheduled message"
R=$(curl -s -X DELETE "$BASE/scheduled/$SCHED_ID" -H "Authorization: Bearer $TOKEN_A")
check "DELETE /scheduled/:id" "$R"

# ============================================================
log_section "9. TIME CAPSULE"
# ============================================================
log_test "Create time capsule (7 days)"
R=$(curl -s -X POST "$BASE/capsule" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"title":"Our Wishes for the Future","note":"I wish for endless happiness together","unlockAfter":"7d"}')
check "POST /capsule (7d lock)" "$R"
CAPSULE_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Create time capsule (custom date)"
FUTURE_DATE=$(date -v+30d '+%Y-%m-%d' 2>/dev/null || date -d "+30 days" '+%Y-%m-%d')
R=$(curl -s -X POST "$BASE/capsule" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Anniversary Letter\",\"note\":\"Happy Anniversary!\",\"customDate\":\"${FUTURE_DATE}\"}")
check "POST /capsule (custom date)" "$R"

log_test "Get all capsules"
R=$(curl -s "$BASE/capsule" -H "Authorization: Bearer $TOKEN_A")
check "GET /capsule" "$R"

log_test "Try to unlock locked capsule (should fail)"
R=$(curl -s -X POST "$BASE/capsule/$CAPSULE_ID/unlock" -H "Authorization: Bearer $TOKEN_A")
check "POST /capsule/:id/unlock (still locked, expect fail)" "$R" "false"

# ============================================================
log_section "10. MOOD CHECK-IN"
# ============================================================
log_test "Check in mood (User A)"
R=$(curl -s -X POST "$BASE/mood/checkin" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"mood":"loved","note":"Feeling so happy today!"}')
check "POST /mood/checkin (User A)" "$R"

log_test "Check in mood (User B)"
R=$(curl -s -X POST "$BASE/mood/checkin" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"mood":"happy","note":"Great day!"}')
check "POST /mood/checkin (User B)" "$R"

log_test "Get today's mood"
R=$(curl -s "$BASE/mood/today" -H "Authorization: Bearer $TOKEN_A")
check "GET /mood/today" "$R"

log_test "Get mood history"
R=$(curl -s "$BASE/mood/history?days=7" -H "Authorization: Bearer $TOKEN_A")
check "GET /mood/history" "$R"

log_test "Get partner mood"
R=$(curl -s "$BASE/mood/partner" -H "Authorization: Bearer $TOKEN_A")
check "GET /mood/partner" "$R"

# ============================================================
log_section "11. MIDNIGHT MEMORY"
# ============================================================
log_test "Create midnight memory (User A)"
R=$(curl -s -X POST "$BASE/midnight" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"content":"She laughed so hard at my joke today 😂 It made my whole day."}')
check "POST /midnight (User A)" "$R"

log_test "Create midnight memory (User B)"
R=$(curl -s -X POST "$BASE/midnight" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"content":"He made me breakfast in bed today. I will never forget this. ❤️"}')
check "POST /midnight (User B)" "$R"

log_test "Get today's midnight memory"
R=$(curl -s "$BASE/midnight/today" -H "Authorization: Bearer $TOKEN_A")
check "GET /midnight/today" "$R"

log_test "Get midnight memory history"
R=$(curl -s "$BASE/midnight/history" -H "Authorization: Bearer $TOKEN_A")
check "GET /midnight/history" "$R"

log_test "Get memory for specific date"
TODAY=$(date '+%Y-%m-%d')
R=$(curl -s "$BASE/midnight/date/$TODAY" -H "Authorization: Bearer $TOKEN_A")
check "GET /midnight/date/:date" "$R"

# ============================================================
log_section "12. LOVE TREE"
# ============================================================
log_test "Get love tree"
R=$(curl -s "$BASE/lovetree" -H "Authorization: Bearer $TOKEN_A")
check "GET /lovetree" "$R"

log_test "Water the love tree"
R=$(curl -s -X POST "$BASE/lovetree/water" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"points":10,"category":"chatPoints"}')
check "POST /lovetree/water" "$R"

log_test "Add photo points to love tree"
R=$(curl -s -X POST "$BASE/lovetree/water" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"points":5,"category":"photoPoints"}')
check "POST /lovetree/water (photoPoints)" "$R"

# ============================================================
log_section "13. RELATIONSHIP LEVELS"
# ============================================================
log_test "Get relationship level"
R=$(curl -s "$BASE/levels" -H "Authorization: Bearer $TOKEN_A")
check "GET /levels" "$R"

log_test "Add XP"
R=$(curl -s -X POST "$BASE/levels/xp" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"xp":50}')
check "POST /levels/xp" "$R"

# ============================================================
log_section "14. TIMELINE"
# ============================================================
log_test "Get timeline"
R=$(curl -s "$BASE/timeline" -H "Authorization: Bearer $TOKEN_A")
check "GET /timeline" "$R"

log_test "Create custom timeline event"
R=$(curl -s -X POST "$BASE/timeline" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"First Movie Together\",\"description\":\"We watched Interstellar together\",\"eventDate\":\"$(date '+%Y-%m-%d')\",\"eventType\":\"custom\"}")
check "POST /timeline (custom event)" "$R"
EVENT_ID=$(echo $R | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

log_test "Delete timeline event"
R=$(curl -s -X DELETE "$BASE/timeline/$EVENT_ID" -H "Authorization: Bearer $TOKEN_A")
check "DELETE /timeline/:id" "$R"

# ============================================================
log_section "15. MINI GAMES"
# ============================================================
log_test "Get available games"
R=$(curl -s "$BASE/games" -H "Authorization: Bearer $TOKEN_A")
check "GET /games" "$R"

log_test "Spin the wheel"
R=$(curl -s "$BASE/games/spin" -H "Authorization: Bearer $TOKEN_A")
check "GET /games/spin" "$R"

log_test "Start Truth & Dare game"
R=$(curl -s -X POST "$BASE/games/start" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"gameType":"truth_dare"}')
check "POST /games/start (truth_dare)" "$R"
GAME_ID=$(echo $R | grep -o '"gameId":"[^"]*"' | cut -d'"' -f4)

log_test "Start This or That game"
R=$(curl -s -X POST "$BASE/games/start" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"gameType":"this_or_that"}')
check "POST /games/start (this_or_that)" "$R"
GAME_ID2=$(echo $R | grep -o '"gameId":"[^"]*"' | cut -d'"' -f4)

log_test "Submit game answer (User A)"
R=$(curl -s -X POST "$BASE/games/$GAME_ID2/answer" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"answer":"Beach"}')
check "POST /games/:id/answer (User A)" "$R"

log_test "Submit game answer (User B)"
R=$(curl -s -X POST "$BASE/games/$GAME_ID2/answer" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"answer":"Mountains"}')
check "POST /games/:id/answer (User B)" "$R"

log_test "Get game result"
R=$(curl -s "$BASE/games/$GAME_ID2/result" -H "Authorization: Bearer $TOKEN_A")
check "GET /games/:id/result" "$R"

# ============================================================
log_section "16. AI ASSISTANT"
# ============================================================
log_test "Get AI suggestions"
R=$(curl -s "$BASE/ai/suggestions" -H "Authorization: Bearer $TOKEN_A")
check "GET /ai/suggestions" "$R"

log_test "Get relationship insights"
R=$(curl -s "$BASE/ai/insights" -H "Authorization: Bearer $TOKEN_A")
check "GET /ai/insights" "$R"

log_test "Get reminders"
R=$(curl -s "$BASE/ai/reminders" -H "Authorization: Bearer $TOKEN_A")
check "GET /ai/reminders" "$R"

log_test "Get mood trends"
R=$(curl -s "$BASE/ai/mood-trends" -H "Authorization: Bearer $TOKEN_A")
check "GET /ai/mood-trends" "$R"

# ============================================================
log_section "17. NOTIFICATIONS"
# ============================================================
log_test "Get notifications"
R=$(curl -s "$BASE/notifications" -H "Authorization: Bearer $TOKEN_A")
check "GET /notifications" "$R"

log_test "Get unread notifications only"
R=$(curl -s "$BASE/notifications?unreadOnly=true" -H "Authorization: Bearer $TOKEN_A")
check "GET /notifications (unread only)" "$R"

log_test "Mark all notifications read"
R=$(curl -s -X PUT "$BASE/notifications/read-all" -H "Authorization: Bearer $TOKEN_A")
check "PUT /notifications/read-all" "$R"

log_test "Clear all notifications"
R=$(curl -s -X DELETE "$BASE/notifications/clear-all" -H "Authorization: Bearer $TOKEN_A")
check "DELETE /notifications/clear-all" "$R"

# ============================================================
log_section "18. PRESENCE & TOUCH FEATURES"
# ============================================================
log_test "Send heartbeat"
R=$(curl -s -X POST "$BASE/presence/heartbeat" -H "Authorization: Bearer $TOKEN_A")
check "POST /presence/heartbeat" "$R"

log_test "Get online status"
R=$(curl -s "$BASE/presence/status" -H "Authorization: Bearer $TOKEN_A")
check "GET /presence/status" "$R"

log_test "Touch presence — digital hand holding"
R=$(curl -s -X POST "$BASE/presence/touch" -H "Authorization: Bearer $TOKEN_A")
check "POST /presence/touch" "$R"

log_test "Heartbeat sync"
R=$(curl -s -X POST "$BASE/presence/heartbeat-sync" -H "Authorization: Bearer $TOKEN_A")
check "POST /presence/heartbeat-sync" "$R"

log_test "Set offline"
R=$(curl -s -X POST "$BASE/presence/offline" -H "Authorization: Bearer $TOKEN_A")
check "POST /presence/offline" "$R"

# ============================================================
log_section "19. GOODBYE / LEAVE SYSTEM"
# ============================================================
log_test "User A requests to leave"
R=$(curl -s -X POST "$BASE/relationship/leave" -H "Authorization: Bearer $TOKEN_A")
check "POST /relationship/leave (User A)" "$R"

log_test "User A cancels leave (Stay Together)"
R=$(curl -s -X POST "$BASE/relationship/cancel-leave" -H "Authorization: Bearer $TOKEN_A")
check "POST /relationship/cancel-leave" "$R"

# ============================================================
log_section "20. AUTH CLEANUP"
# ============================================================
log_test "Logout User A"
R=$(curl -s -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN_A")
check "POST /auth/logout (User A)" "$R"

log_test "Logout User B"
R=$(curl -s -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN_B")
check "POST /auth/logout (User B)" "$R"

log_test "Access protected route after logout (token still valid until expiry)"
R=$(curl -s "$BASE/auth/profile" -H "Authorization: Bearer $TOKEN_A")
check "GET /auth/profile (token still valid)" "$R"

log_test "Access without token (should fail)"
R=$(curl -s "$BASE/auth/profile")
check "GET /auth/profile (no token, expect fail)" "$R" "false"

# ============================================================
log_section "RESULTS SUMMARY"
# ============================================================
total=$((pass + fail))
echo -e "\n${BOLD}Total Tests:  $total${NC}"
echo -e "${GREEN}${BOLD}Passed:       $pass ✅${NC}"
echo -e "${RED}${BOLD}Failed:       $fail ❌${NC}"

if [ $fail -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}🎉 ALL TESTS PASSED! SoulSync API is fully functional ❤️${NC}\n"
else
  echo -e "\n${YELLOW}${BOLD}⚠️  Some tests failed. Check server logs for details.${NC}\n"
fi

# Cleanup test files
rm -f /tmp/test_photo.png
