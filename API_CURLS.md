# TwinSoul Backend — All API Curl Commands

> Replace `TOKEN` with the JWT token received after login/register.
> Replace `BASE_URL` with your server URL (e.g., `http://localhost:8000`)
> Replace IDs like `MSG_ID`, `RELATIONSHIP_ID`, etc. with actual MongoDB ObjectIds.

---

## 🔐 AUTH — `/api/auth`

### 1. Register
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Avinash",
    "nickname": "Avi",
    "email": "avi@example.com",
    "password": "123456",
    "relationshipStartDate": "2024-01-01"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Account created successfully",
  "token": "eyJhbGciOiJIUzI1...",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Avinash",
      "nickname": "Avi",
      "email": "avi@example.com",
      "profilePhoto": "",
      "coupleCode": "AB3XYZ",
      "connectionPassword": "4821",
      "isConnected": false
    }
  }
}
```

---

### 2. Login
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "avi@example.com",
    "password": "123456"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1...",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Avinash",
      "nickname": "Avi",
      "email": "avi@example.com",
      "coupleCode": "AB3XYZ",
      "connectionPassword": "4821",
      "isConnected": false,
      "partnerId": null,
      "relationshipId": null
    }
  }
}
```

---

### 3. Get Profile
```bash
curl -X GET http://localhost:8000/api/auth/profile \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Avinash",
      "nickname": "Avi",
      "email": "avi@example.com",
      "coupleCode": "AB3XYZ",
      "isConnected": true,
      "partnerId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "relationshipId": "64f1a2b3c4d5e6f7a8b9c0d3"
    }
  }
}
```

---

### 4. Update Profile
```bash
curl -X PUT http://localhost:8000/api/auth/profile \
  -H "Authorization: Bearer TOKEN" \
  -F "name=Avinash Kumar" \
  -F "nickname=Avi❤️" \
  -F "profilePhoto=@/path/to/photo.jpg"
```
**Response:**
```json
{
  "success": true,
  "message": "Profile updated",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Avinash Kumar",
      "nickname": "Avi❤️",
      "profilePhoto": "/uploads/photo-1234567890.jpg"
    }
  }
}
```

---

### 5. Regenerate Couple Code & Password
```bash
curl -X POST http://localhost:8000/api/auth/regenerate-codes \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "message": "New codes generated",
  "data": {
    "coupleCode": "ZX9QWE",
    "connectionPassword": "7392"
  }
}
```

---

### 6. Logout
```bash
curl -X POST http://localhost:8000/api/auth/logout \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## 💑 RELATIONSHIP — `/api/relationship`

### 7. Send Connection Request (Couple Code + Password)
```bash
curl -X POST http://localhost:8000/api/relationship/connect \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "coupleCode": "AB3XYZ",
    "connectionPassword": "4821"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Connection request sent. Waiting for both partners to approve.",
  "data": {
    "relationshipId": "64f1a2b3c4d5e6f7a8b9c0d3",
    "partnerId": "64f1a2b3c4d5e6f7a8b9c0d2",
    "partnerName": "Priya"
  }
}
```

---

### 8. Approve Connection
```bash
curl -X POST http://localhost:8000/api/relationship/approve \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "relationshipId": "64f1a2b3c4d5e6f7a8b9c0d3"
  }'
```
**Response (both approved):**
```json
{
  "success": true,
  "message": "Connection approved! Your private space is ready.",
  "data": {
    "relationship": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "status": "active",
      "startDate": "2024-06-12T10:00:00.000Z"
    }
  }
}
```
**Response (waiting for other):**
```json
{
  "success": true,
  "message": "Approval recorded. Waiting for partner.",
  "data": { "relationship": { "status": "pending" } }
}
```

---

### 9. Get Pending Request
```bash
curl -X GET http://localhost:8000/api/relationship/pending \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "pending": {
      "relationshipId": "64f1a2b3c4d5e6f7a8b9c0d3",
      "requesterName": "Priya",
      "myApproved": false,
      "needsMyApproval": true
    }
  }
}
```

---

### 10. Dashboard
```bash
curl -X GET http://localhost:8000/api/relationship/dashboard \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "daysTogether": 162,
    "partner": {
      "name": "Priya",
      "nickname": "Piyu",
      "profilePhoto": "/uploads/priya.jpg",
      "isOnline": true
    },
    "loveTree": { "stage": "blooming", "points": 650 },
    "level": { "level": 5, "xp": 1200 },
    "recentPhotos": [],
    "recentMessages": []
  }
}
```

---

### 11. Relationship Info
```bash
curl -X GET http://localhost:8000/api/relationship/info \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "relationship": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "status": "active",
      "startDate": "2024-01-01T00:00:00.000Z",
      "user1": { "name": "Priya", "email": "priya@example.com" },
      "user2": { "name": "Avinash", "email": "avi@example.com" }
    }
  }
}
```

---

### 12. Leave Relationship
```bash
curl -X POST http://localhost:8000/api/relationship/leave \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "message": "Connection ended."
}
```

---

### 13. Cancel Leave
```bash
curl -X POST http://localhost:8000/api/relationship/cancel-leave \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "message": "Leave request cancelled. Stay together! ❤️"
}
```

---

### 14. Restore Relationship
```bash
curl -X POST http://localhost:8000/api/relationship/restore \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "relationshipId": "64f1a2b3c4d5e6f7a8b9c0d3" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Relationship restored successfully ❤️"
}
```

---

## 💬 CHAT — `/api/chat`

### 15. Get Messages
```bash
curl -X GET "http://localhost:8000/api/chat/messages?page=1&limit=50" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "_id": "MSG_ID",
        "content": "Hello baby ❤️",
        "type": "text",
        "senderId": { "name": "Avinash", "profilePhoto": "" },
        "isRead": true,
        "createdAt": "2024-06-12T10:00:00.000Z"
      }
    ],
    "total": 120,
    "page": 1
  }
}
```

---

### 16. Send Message (Text)
```bash
curl -X POST http://localhost:8000/api/chat/messages \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Miss you so much ❤️",
    "type": "text"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "messageId": "MSG_ID",
    "message": {
      "_id": "MSG_ID",
      "content": "Miss you so much ❤️",
      "type": "text",
      "senderId": { "name": "Avinash" },
      "createdAt": "2024-06-12T10:05:00.000Z"
    }
  }
}
```

---

### 17. Send Message (Media/Image)
```bash
curl -X POST http://localhost:8000/api/chat/messages \
  -H "Authorization: Bearer TOKEN" \
  -F "type=image" \
  -F "media=@/path/to/photo.jpg"
```
**Response:**
```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "message": {
      "type": "image",
      "mediaUrl": "/uploads/media-1234567890.jpg"
    }
  }
}
```

---

### 18. Delete Message
```bash
curl -X DELETE http://localhost:8000/api/chat/messages/MSG_ID \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Message deleted" }
```

---

### 19. React to Message
```bash
curl -X POST http://localhost:8000/api/chat/messages/MSG_ID/react \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "emoji": "❤️" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Reaction added",
  "data": { "reactions": [{ "userId": "USER_ID", "emoji": "❤️" }] }
}
```

---

### 20. Remove Reaction
```bash
curl -X DELETE http://localhost:8000/api/chat/messages/MSG_ID/react \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Reaction removed" }
```

---

### 21. Pin Message
```bash
curl -X PUT http://localhost:8000/api/chat/messages/MSG_ID/pin \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Message pinned", "data": { "isPinned": true } }
```

---

### 22. Favorite Message
```bash
curl -X PUT http://localhost:8000/api/chat/messages/MSG_ID/favorite \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Added to favorites" }
```

---

### 23. Mark All Messages Read
```bash
curl -X PUT http://localhost:8000/api/chat/messages/read \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Messages marked as read" }
```

---

### 24. Forward Message
```bash
curl -X POST http://localhost:8000/api/chat/messages/MSG_ID/forward \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Message forwarded" }
```

---

### 25. Search Messages
```bash
curl -X GET "http://localhost:8000/api/chat/messages/search?q=hello" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": { "messages": [{ "_id": "MSG_ID", "content": "hello baby" }] }
}
```

---

### 26. Get Favorite Messages
```bash
curl -X GET http://localhost:8000/api/chat/messages/favorites \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "data": { "messages": [] } }
```

---

### 27. Get Pinned Messages
```bash
curl -X GET http://localhost:8000/api/chat/messages/pinned \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "data": { "messages": [] } }
```

---

### 28. Get Secret Messages
```bash
curl -X GET http://localhost:8000/api/chat/messages/secret \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "data": { "messages": [] } }
```

---

## 📸 PHOTOS — `/api/photos`

### 29. Get All Photos
```bash
curl -X GET http://localhost:8000/api/photos \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "photos": [
      {
        "_id": "PHOTO_ID",
        "url": "/uploads/photo-123.jpg",
        "caption": "Our trip ❤️",
        "isFavorite": false
      }
    ]
  }
}
```

---

### 30. Upload Photo
```bash
curl -X POST http://localhost:8000/api/photos/upload \
  -H "Authorization: Bearer TOKEN" \
  -F "photo=@/path/to/photo.jpg" \
  -F "caption=Our first date 💕" \
  -F "location=Mumbai"
```
**Response:**
```json
{
  "success": true,
  "message": "Photo uploaded",
  "data": {
    "photo": {
      "_id": "PHOTO_ID",
      "url": "/uploads/photo-1234567890.jpg",
      "caption": "Our first date 💕"
    }
  }
}
```

---

### 31. Delete Photo
```bash
curl -X DELETE http://localhost:8000/api/photos/PHOTO_ID \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Photo deleted" }
```

---

### 32. Toggle Favorite Photo
```bash
curl -X PUT http://localhost:8000/api/photos/PHOTO_ID/favorite \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Added to favorites" }
```

---

### 33. Add Comment to Photo
```bash
curl -X POST http://localhost:8000/api/photos/PHOTO_ID/comment \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "text": "So beautiful! ❤️" }'
```
**Response:**
```json
{ "success": true, "message": "Comment added" }
```

---

### 34. Delete Comment
```bash
curl -X DELETE http://localhost:8000/api/photos/PHOTO_ID/comment/COMMENT_ID \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Comment deleted" }
```

---

### 35. Get Favorite Photos
```bash
curl -X GET http://localhost:8000/api/photos/favorites \
  -H "Authorization: Bearer TOKEN"
```

---

### 36. Search Photos
```bash
curl -X GET "http://localhost:8000/api/photos/search?q=trip" \
  -H "Authorization: Bearer TOKEN"
```

---

### 37. Memory Map
```bash
curl -X GET http://localhost:8000/api/photos/map \
  -H "Authorization: Bearer TOKEN"
```

---

### 38. Get Albums
```bash
curl -X GET http://localhost:8000/api/photos/albums \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "data": { "albums": [{ "_id": "ALBUM_ID", "name": "Goa Trip" }] } }
```

---

### 39. Create Album
```bash
curl -X POST http://localhost:8000/api/photos/albums \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Goa Trip 2024", "description": "Best vacation ever" }'
```
**Response:**
```json
{ "success": true, "message": "Album created", "data": { "album": { "_id": "ALBUM_ID", "name": "Goa Trip 2024" } } }
```

---

### 40. Update Album
```bash
curl -X PUT http://localhost:8000/api/photos/albums/ALBUM_ID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Goa Trip Updated" }'
```

---

### 41. Delete Album
```bash
curl -X DELETE http://localhost:8000/api/photos/albums/ALBUM_ID \
  -H "Authorization: Bearer TOKEN"
```

---

### 42. Get Album Photos
```bash
curl -X GET http://localhost:8000/api/photos/albums/ALBUM_ID/photos \
  -H "Authorization: Bearer TOKEN"
```

---

## 📔 DIARY — `/api/diary`

### 43. Create Diary Entry
```bash
curl -X POST http://localhost:8000/api/diary \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Best day ever",
    "content": "Today we went to the beach together...",
    "mood": "happy",
    "isPrivate": false,
    "tags": ["beach", "date"]
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Diary entry created",
  "data": {
    "entry": {
      "_id": "DIARY_ID",
      "title": "Best day ever",
      "mood": "happy",
      "isPrivate": false,
      "createdAt": "2024-06-12T10:00:00.000Z"
    }
  }
}
```

---

### 44. Get All Entries
```bash
curl -X GET "http://localhost:8000/api/diary?page=1&limit=20" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": { "entries": [], "total": 0 }
}
```

---

### 45. Get Single Entry
```bash
curl -X GET http://localhost:8000/api/diary/DIARY_ID \
  -H "Authorization: Bearer TOKEN"
```

---

### 46. Update Diary Entry
```bash
curl -X PUT http://localhost:8000/api/diary/DIARY_ID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Updated title", "mood": "loved" }'
```

---

### 47. Delete Diary Entry
```bash
curl -X DELETE http://localhost:8000/api/diary/DIARY_ID \
  -H "Authorization: Bearer TOKEN"
```

---

### 48. Toggle Favorite Diary Entry
```bash
curl -X PUT http://localhost:8000/api/diary/DIARY_ID/favorite \
  -H "Authorization: Bearer TOKEN"
```

---

### 49. Get Private Entries
```bash
curl -X GET http://localhost:8000/api/diary/private \
  -H "Authorization: Bearer TOKEN"
```

---

### 50. Get Shared Entries
```bash
curl -X GET http://localhost:8000/api/diary/shared \
  -H "Authorization: Bearer TOKEN"
```

---

### 51. Search Diary
```bash
curl -X GET "http://localhost:8000/api/diary/search?q=beach" \
  -H "Authorization: Bearer TOKEN"
```

---

### 52. Calendar View
```bash
curl -X GET "http://localhost:8000/api/diary/calendar?year=2024&month=6" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": { "entries": [], "year": 2024, "month": 6 }
}
```

---

## 😊 MOOD — `/api/mood`

### 53. Mood Check-in
```bash
curl -X POST http://localhost:8000/api/mood/checkin \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mood": "happy",
    "note": "Feeling great today!"
  }'
```
> mood values: `happy`, `loved`, `missing`, `sad`, `relaxed`

**Response:**
```json
{
  "success": true,
  "message": "Mood checked in ❤️",
  "data": {
    "entry": {
      "_id": "MOOD_ID",
      "mood": "happy",
      "note": "Feeling great today!",
      "date": "2024-06-12"
    }
  }
}
```

---

### 54. Get Today's Mood
```bash
curl -X GET http://localhost:8000/api/mood/today \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "myMood": { "mood": "happy", "note": "Feeling great" },
    "partnerMood": { "mood": "loved", "note": "Missing you" }
  }
}
```

---

### 55. Mood History
```bash
curl -X GET "http://localhost:8000/api/mood/history?days=30" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "myHistory": [{ "mood": "happy", "date": "2024-06-12" }],
    "partnerHistory": []
  }
}
```

---

### 56. Partner's Mood
```bash
curl -X GET http://localhost:8000/api/mood/partner \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": { "partnerMood": { "mood": "loved", "note": "Missing you baby" } }
}
```

---

## 🌙 MIDNIGHT MEMORY — `/api/midnight`

### 57. Create Tonight's Memory
```bash
curl -X POST http://localhost:8000/api/midnight \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Today you made me smile by surprising me 😊" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Tonight's smile saved ✨",
  "data": { "entry": { "_id": "MM_ID", "content": "...", "date": "2024-06-12" } }
}
```

---

### 58. Get Today's Entry
```bash
curl -X GET http://localhost:8000/api/midnight/today \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "myEntry": { "content": "You made me smile..." },
    "partnerEntry": { "content": "I love you so much" }
  }
}
```

---

### 59. Get History
```bash
curl -X GET "http://localhost:8000/api/midnight/history?page=1&limit=30" \
  -H "Authorization: Bearer TOKEN"
```

---

### 60. Get Memory by Date
```bash
curl -X GET http://localhost:8000/api/midnight/date/2024-06-12 \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "myEntry": { "content": "..." },
    "partnerEntry": null,
    "date": "2024-06-12"
  }
}
```

---

## ⏰ SCHEDULED MESSAGES — `/api/scheduled`

### 61. Get All Scheduled Messages
```bash
curl -X GET http://localhost:8000/api/scheduled \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": { "messages": [{ "_id": "SCH_ID", "content": "Good morning!", "scheduledAt": "2024-06-13T06:00:00.000Z" }] }
}
```

---

### 62. Schedule a Message
```bash
curl -X POST http://localhost:8000/api/scheduled \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Good morning baby! ☀️",
    "type": "text",
    "scheduledAt": "2024-06-13T06:00:00.000Z"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Message scheduled",
  "data": { "message": { "_id": "SCH_ID", "scheduledAt": "2024-06-13T06:00:00.000Z" } }
}
```

---

### 63. Get Upcoming Scheduled Messages
```bash
curl -X GET http://localhost:8000/api/scheduled/upcoming \
  -H "Authorization: Bearer TOKEN"
```

---

### 64. Update Scheduled Message
```bash
curl -X PUT http://localhost:8000/api/scheduled/SCH_ID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Updated message", "scheduledAt": "2024-06-13T07:00:00.000Z" }'
```

---

### 65. Cancel Scheduled Message
```bash
curl -X DELETE http://localhost:8000/api/scheduled/SCH_ID \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Scheduled message cancelled" }
```

---

## 💌 TIME CAPSULE — `/api/capsule`

### 66. Get All Capsules
```bash
curl -X GET http://localhost:8000/api/capsule \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "capsules": [
      {
        "_id": "CAP_ID",
        "title": "Our first year",
        "unlockAt": "2025-06-12T00:00:00.000Z",
        "isUnlocked": false,
        "canUnlock": false
      }
    ]
  }
}
```

---

### 67. Create Time Capsule
```bash
curl -X POST http://localhost:8000/api/capsule \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Our first anniversary",
    "note": "Remember this day forever...",
    "unlockAfter": "1y"
  }'
```
> `unlockAfter` values: `7d`, `30d`, `1y`  
> OR use `customDate`: `"customDate": "2025-12-31"`

**Response:**
```json
{
  "success": true,
  "message": "Time capsule created and locked 🔒",
  "data": { "capsule": { "_id": "CAP_ID", "title": "Our first anniversary", "unlockAt": "2025-06-12T..." } }
}
```

---

### 68. Unlock Capsule
```bash
curl -X POST http://localhost:8000/api/capsule/CAP_ID/unlock \
  -H "Authorization: Bearer TOKEN"
```
**Response (success):**
```json
{ "success": true, "message": "Time capsule unlocked! 🎉", "data": { "capsule": { "note": "Remember this day..." } } }
```
**Response (still locked):**
```json
{ "success": false, "message": "Capsule is still locked for 180 more day(s)" }
```

---

### 69. Delete Capsule
```bash
curl -X DELETE http://localhost:8000/api/capsule/CAP_ID \
  -H "Authorization: Bearer TOKEN"
```

---

## 🌳 LOVE TREE — `/api/lovetree`

### 70. Get Tree Status
```bash
curl -X GET http://localhost:8000/api/lovetree \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "tree": {
      "stage": "blooming",
      "points": 650,
      "chatPoints": 200,
      "diaryPoints": 50,
      "checkinPoints": 100,
      "lastWatered": "2024-06-12T10:00:00.000Z"
    }
  }
}
```

---

### 71. Water Tree (Add Points)
```bash
curl -X POST http://localhost:8000/api/lovetree/water \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "points": 10 }'
```
**Response:**
```json
{ "success": true, "message": "Tree watered 🌱", "data": { "tree": { "points": 660, "stage": "blooming" } } }
```

---

## 🎮 GAMES — `/api/games`

### 72. Get Available Games
```bash
curl -X GET http://localhost:8000/api/games \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": { "games": [{ "type": "quiz", "title": "How well do you know me?" }] }
}
```

---

### 73. Start Game
```bash
curl -X POST http://localhost:8000/api/games/start \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "type": "quiz" }'
```
**Response:**
```json
{ "success": true, "data": { "game": { "_id": "GAME_ID", "question": "What's my favorite color?" } } }
```

---

### 74. Spin the Wheel
```bash
curl -X GET http://localhost:8000/api/games/spin \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "data": { "result": "Cook dinner together tonight! 🍳" } }
```

---

### 75. Submit Answer
```bash
curl -X POST http://localhost:8000/api/games/GAME_ID/answer \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "answer": "Blue" }'
```

---

### 76. Get Game Result
```bash
curl -X GET http://localhost:8000/api/games/GAME_ID/result \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "data": { "score": 8, "total": 10, "xpEarned": 50 } }
```

---

## 📊 LEVELS — `/api/levels`

### 77. Get Level & XP
```bash
curl -X GET http://localhost:8000/api/levels \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "level": {
      "level": 5,
      "xp": 1200,
      "xpToNextLevel": 300,
      "badge": "Deeply Connected 💞"
    }
  }
}
```

---

### 78. Add XP
```bash
curl -X POST http://localhost:8000/api/levels/xp \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "xp": 50, "reason": "Completed quiz" }'
```
**Response:**
```json
{ "success": true, "message": "XP added", "data": { "newXP": 1250, "level": 5 } }
```

---

## 🎵 MUSIC — `/api/music`

### 79. Get Session
```bash
curl -X GET http://localhost:8000/api/music/session \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "session": {
      "currentTrack": { "title": "Tum Hi Ho", "artist": "Arijit Singh" },
      "isPlaying": true,
      "position": 45
    }
  }
}
```

---

### 80. Update Playback
```bash
curl -X POST http://localhost:8000/api/music/session/playback \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "isPlaying": true, "position": 45, "trackId": "TRACK_ID" }'
```

---

### 81. Get Queue
```bash
curl -X GET http://localhost:8000/api/music/queue \
  -H "Authorization: Bearer TOKEN"
```

---

### 82. Add to Queue
```bash
curl -X POST http://localhost:8000/api/music/queue \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "trackId": "TRACK_ID", "title": "Tum Hi Ho", "artist": "Arijit Singh" }'
```

---

### 83. Remove from Queue
```bash
curl -X DELETE http://localhost:8000/api/music/queue \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "trackId": "TRACK_ID" }'
```

---

### 84. Clear Queue
```bash
curl -X DELETE http://localhost:8000/api/music/queue/clear \
  -H "Authorization: Bearer TOKEN"
```

---

### 85. Get Music History
```bash
curl -X GET http://localhost:8000/api/music/history \
  -H "Authorization: Bearer TOKEN"
```

---

### 86. Get Recommendations
```bash
curl -X GET http://localhost:8000/api/music/recommendations \
  -H "Authorization: Bearer TOKEN"
```

---

### 87. Get Playlists
```bash
curl -X GET http://localhost:8000/api/music/playlists \
  -H "Authorization: Bearer TOKEN"
```

---

### 88. Create Playlist
```bash
curl -X POST http://localhost:8000/api/music/playlists \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Our Love Songs 💕", "description": "Songs that remind us of each other" }'
```
**Response:**
```json
{ "success": true, "data": { "playlist": { "_id": "PL_ID", "name": "Our Love Songs 💕" } } }
```

---

### 89. Update Playlist
```bash
curl -X PUT http://localhost:8000/api/music/playlists/PL_ID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Updated Playlist Name" }'
```

---

### 90. Delete Playlist
```bash
curl -X DELETE http://localhost:8000/api/music/playlists/PL_ID \
  -H "Authorization: Bearer TOKEN"
```

---

### 91. Add Track to Playlist
```bash
curl -X POST http://localhost:8000/api/music/playlists/PL_ID/tracks \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "trackId": "TRACK_ID", "title": "Tum Hi Ho", "artist": "Arijit Singh" }'
```

---

## 🔔 NOTIFICATIONS — `/api/notifications`

### 92. Get All Notifications
```bash
curl -X GET "http://localhost:8000/api/notifications?page=1&limit=20&unreadOnly=false" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "_id": "NOTIF_ID",
        "type": "connection",
        "title": "Connection Request 💕",
        "body": "Priya wants to connect with you!",
        "isRead": false,
        "createdAt": "2024-06-12T10:00:00.000Z"
      }
    ],
    "unreadCount": 3
  }
}
```

---

### 93. Mark All Read
```bash
curl -X PUT http://localhost:8000/api/notifications/read-all \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "All notifications marked as read" }
```

---

### 94. Clear All Notifications
```bash
curl -X DELETE http://localhost:8000/api/notifications/clear-all \
  -H "Authorization: Bearer TOKEN"
```

---

### 95. Mark Single Notification Read
```bash
curl -X PUT http://localhost:8000/api/notifications/NOTIF_ID/read \
  -H "Authorization: Bearer TOKEN"
```

---

### 96. Delete Notification
```bash
curl -X DELETE http://localhost:8000/api/notifications/NOTIF_ID \
  -H "Authorization: Bearer TOKEN"
```

---

## 🟢 PRESENCE — `/api/presence`

### 97. Send Heartbeat (Keep Online)
```bash
curl -X POST http://localhost:8000/api/presence/heartbeat \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Heartbeat recorded" }
```

---

### 98. Get Partner Online Status
```bash
curl -X GET http://localhost:8000/api/presence/status \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "partner": {
      "isOnline": true,
      "lastSeen": "2024-06-12T10:00:00.000Z"
    }
  }
}
```

---

### 99. Set Offline
```bash
curl -X POST http://localhost:8000/api/presence/offline \
  -H "Authorization: Bearer TOKEN"
```

---

### 100. Send Touch
```bash
curl -X POST http://localhost:8000/api/presence/touch \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Touch sent 💕" }
```

---

### 101. Heartbeat Sync
```bash
curl -X POST http://localhost:8000/api/presence/heartbeat-sync \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "bpm": 72 }'
```

---

## 🤖 AI — `/api/ai`

### 102. Get Suggestions
```bash
curl -X GET http://localhost:8000/api/ai/suggestions \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "suggestions": [
      "Plan a movie night at home 🎬",
      "Cook your partner's favorite meal tonight 🍝",
      "Write a love letter and hide it somewhere ❤️"
    ]
  }
}
```

---

### 103. Get Insights
```bash
curl -X GET http://localhost:8000/api/ai/insights \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "insights": {
      "chatActivity": "You two chat most in the evenings",
      "moodTrend": "Both moods have been positive this week",
      "milestone": "162 days together! 🎉"
    }
  }
}
```

---

### 104. Get Reminders
```bash
curl -X GET http://localhost:8000/api/ai/reminders \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "reminders": [
      "Your anniversary is in 12 days 🎂",
      "You haven't written a diary entry this week 📖"
    ]
  }
}
```

---

### 105. Get Mood Trends
```bash
curl -X GET http://localhost:8000/api/ai/mood-trends \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "trends": {
      "myAvgMood": "happy",
      "partnerAvgMood": "loved",
      "bestDay": "Saturday",
      "lowDay": "Monday"
    }
  }
}
```

---

## 📅 TIMELINE — `/api/timeline`

### 106. Get Timeline
```bash
curl -X GET "http://localhost:8000/api/timeline?page=1&limit=30" \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "_id": "EVT_ID",
        "title": "First Connection ❤️",
        "eventType": "first_connection",
        "eventDate": "2024-01-01T00:00:00.000Z",
        "isAutoGenerated": true
      }
    ],
    "total": 5
  }
}
```

---

### 107. Create Timeline Event
```bash
curl -X POST http://localhost:8000/api/timeline \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Our first trip together",
    "description": "Went to Goa for 3 days!",
    "eventDate": "2024-03-15",
    "eventType": "custom"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Timeline event created",
  "data": {
    "event": {
      "_id": "EVT_ID",
      "title": "Our first trip together",
      "eventDate": "2024-03-15T00:00:00.000Z"
    }
  }
}
```

---

### 108. Delete Timeline Event
```bash
curl -X DELETE http://localhost:8000/api/timeline/EVT_ID \
  -H "Authorization: Bearer TOKEN"
```
**Response:**
```json
{ "success": true, "message": "Timeline event deleted" }
```

---

## ❌ Error Responses (Common)

### Unauthorized (No/Invalid Token)
```json
{ "success": false, "message": "Not authorized" }
```

### Not in Relationship
```json
{ "success": false, "message": "Not in a relationship" }
```

### Not Found
```json
{ "success": false, "message": "Resource not found" }
```

### Validation Error
```json
{ "success": false, "message": "All fields are required" }
```
