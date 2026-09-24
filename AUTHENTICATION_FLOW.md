# Authentication Flow Diagram

## Overview

The schedule sync now supports multiple authentication methods, automatically choosing the best one for your environment.

## Authentication Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│  Start: Need Firestore Access Token                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ Is Cloud Runtime?    │
                 │ (Cloud Functions/Run)│
                 └──────────────────────┘
                   │                  │
                YES│                  │NO
                   ▼                  │
        ┌────────────────────┐       │
        │ Try Metadata Server│       │
        └────────────────────┘       │
                   │                  │
            ┌──────┴──────┐          │
         SUCCESS        FAIL          │
            │              │          │
            ▼              ▼          │
    ┌─────────────┐       └──────────┘
    │   DONE ✅   │              │
    └─────────────┘              ▼
                    ┌──────────────────────────────────┐
                    │ Check GOOGLE_APPLICATION_        │
                    │ CREDENTIALS env var              │
                    └──────────────────────────────────┘
                                  │
                         ┌────────┴────────┐
                      EXISTS            NOT SET
                         │                  │
                         ▼                  │
            ┌─────────────────────────┐    │
            │ Load Service Account    │    │
            │ Key File (.json)        │    │
            └─────────────────────────┘    │
                         │                  │
                    ┌────┴────┐             │
                 VALID     INVALID          │
                    │         │             │
                    ▼         │             │
        ┌────────────────┐   │             │
        │ Parse private  │   │             │
        │ key & email    │   │             │
        └────────────────┘   │             │
                    │         │             │
                    ▼         │             │
        ┌────────────────┐   │             │
        │ Create JWT     │   │             │
        │ (node crypto)  │   │             │
        └────────────────┘   │             │
                    │         │             │
                    ▼         │             │
        ┌────────────────┐   │             │
        │ Exchange JWT   │   │             │
        │ for OAuth2     │   │             │
        │ access token   │   │             │
        └────────────────┘   │             │
                    │         │             │
            ┌───────┴───────┐ │             │
         SUCCESS         FAIL │             │
            │              │  │             │
            ▼              └──┘             │
    ┌─────────────┐          │             │
    │   DONE ✅   │          └─────────────┘
    └─────────────┘                    │
                                       ▼
                            ┌────────────────────┐
                            │ Try gcloud CLI     │
                            │ (local development)│
                            └────────────────────┘
                                       │
                                ┌──────┴──────┐
                             SUCCESS       FAIL
                                │             │
                                ▼             ▼
                        ┌─────────────┐  ┌────────────┐
                        │   DONE ✅   │  │  ERROR ❌  │
                        └─────────────┘  └────────────┘
```

## Environment-Specific Flows

### Cloud Functions / Cloud Run

```
Cloud Runtime ✅
    │
    ├─► Metadata Server (automatic)
    │       │
    │       └─► Access Token ✅
    │
    └─► No configuration needed!
```

**Why it works:**
- Cloud Functions/Run have built-in service identity
- Metadata server provides automatic authentication
- No credentials needed in environment variables

---

### Android / Termux

```
Android Device (Termux)
    │
    ├─► No metadata server ❌
    │
    ├─► GOOGLE_APPLICATION_CREDENTIALS
    │       │
    │       └─► Service Account Key File
    │               │
    │               ├─► Read JSON file
    │               ├─► Sign JWT with private key
    │               └─► Exchange for OAuth2 token ✅
    │
    └─► gcloud CLI not available ❌
```

**Why service account key is needed:**
- No metadata server on Android
- gcloud CLI not available in Termux
- Service account key is the standard alternative

---

### Local Development (Computer)

```
Local Computer
    │
    ├─► No metadata server ❌
    │
    ├─► GOOGLE_APPLICATION_CREDENTIALS set?
    │   │
    │   YES─► Service Account Key File ✅
    │   │
    │   NO─┐
    │      │
    └──────┴─► gcloud CLI
                    │
                    ├─► gcloud auth login
                    └─► Access Token ✅
```

**Why it's flexible:**
- Can use either service account key OR gcloud CLI
- Service account key works everywhere
- gcloud CLI is convenient for development

---

## JWT Exchange Flow (Service Account)

```
Service Account Key File
         │
         ├─► Contains:
         │   • private_key (RSA)
         │   • client_email
         │   • project_id
         │
         ▼
┌─────────────────────┐
│ Create JWT Claim:   │
│ • iss: email        │
│ • scope: datastore  │
│ • aud: oauth2       │
│ • exp: now + 1h     │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Sign JWT with       │
│ RS256 algorithm     │
│ using private key   │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ POST to:            │
│ oauth2.googleapis   │
│   .com/token        │
│                     │
│ grant_type=jwt      │
│ assertion=<JWT>     │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Response:           │
│ {                   │
│   access_token,     │
│   token_type,       │
│   expires_in: 3600  │
│ }                   │
└─────────────────────┘
         │
         ▼
    Access Token ✅
```

## Error Handling

```
Any Authentication Method Fails
         │
         ▼
┌─────────────────────────────────┐
│ Check Error Type:               │
│                                 │
│ • CONSUMER_INVALID             │
│   → Permissions issue          │
│                                 │
│ • NOT_FOUND                    │
│   → Database doesn't exist     │
│                                 │
│ • Invalid key file             │
│   → Corrupted or wrong format  │
│                                 │
│ • gcloud not found             │
│   → CLI not installed          │
│                                 │
│ • Network error                │
│   → Connectivity issue         │
└─────────────────────────────────┘
         │
         ▼
   Show helpful error message
   with troubleshooting steps
```

## Testing Your Setup

```
Run: node test-firestore-auth.js
         │
         ├─► Check Environment Variables
         │   • GOOGLE_CLOUD_PROJECT
         │   • GOOGLE_APPLICATION_CREDENTIALS
         │   • GEMINI_API_KEY
         │
         ├─► Validate Service Account Key
         │   • File exists
         │   • Correct permissions (600)
         │   • Valid JSON structure
         │   • Has required fields
         │
         ├─► Test Token Generation
         │   • Can create JWT
         │   • Can exchange for token
         │   • Token format valid
         │
         └─► Test Firestore API
             • Make authenticated request
             • Check HTTP status
             • Verify response
             │
             └─► Report Success or Failure ✅/❌
```

## Security Considerations

```
Service Account Key File
         │
         ├─► Permissions: 600 (read-only by owner)
         ├─► Location: Outside of git repository
         ├─► Never commit to version control
         └─► Rotate periodically
```

## Summary

| Environment | Method | Setup Required |
|-------------|--------|----------------|
| Cloud Functions/Run | Metadata Server | None (automatic) |
| Android/Termux | Service Account Key | Create key, transfer file |
| Local Dev (with key) | Service Account Key | Create key once |
| Local Dev (with gcloud) | gcloud CLI | Run `gcloud auth login` |

**Key Takeaway:** Service account key file works everywhere and is the recommended method for Android/Termux.

