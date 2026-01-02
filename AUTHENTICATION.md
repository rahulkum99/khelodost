# Authentication & Authorization System

## Overview

This is a production-ready, highly secure role-based authentication and authorization system using JWT (JSON Web Tokens).

## Role Hierarchy

The system supports 6 roles with hierarchical permissions:

1. **User** (Level 1) - Basic user access
2. **Agent** (Level 2) - Agent level access
3. **Master** (Level 3) - Master level access
4. **Super Master** (Level 4) - Super master level access
5. **Admin** (Level 5) - Administrative access
6. **Super Admin** (Level 6) - Full system access

**Higher level roles automatically have access to lower level permissions.**

## Security Features

### ✅ Implemented Security Measures

1. **Password Security**
   - Bcrypt hashing with salt rounds (12)
   - Minimum 8 characters
   - Requires uppercase, lowercase, and number
   - Passwords never returned in API responses

2. **JWT Tokens**
   - Access tokens (15 minutes expiry)
   - Refresh tokens (7 days expiry)
   - Token rotation on refresh
   - Secure token storage

3. **Account Protection**
   - Account lockout after 5 failed login attempts (2 hours)
   - Login attempt tracking
   - Account activation status

4. **Rate Limiting**
   - Authentication routes: 5 requests per 15 minutes
   - General API: 100 requests per 15 minutes
   - Sensitive operations: 10 requests per hour

5. **Security Headers**
   - Helmet.js for security headers
   - CORS configuration
   - Content Security Policy

6. **Input Validation**
   - Express-validator for all inputs
   - Email format validation
   - Username format validation
   - Password strength validation

## API Endpoints

### Public Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "SecurePass123",
  "role": "user" // Optional, defaults to "user"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Refresh Token
```http
POST /api/auth/refresh-token
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Protected Endpoints (Require Authentication)

#### Get Profile
```http
GET /api/auth/profile
Authorization: Bearer <accessToken>
```

#### Update Profile
```http
PUT /api/auth/profile
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "phone": "+1234567890"
  }
}
```

#### Change Password
```http
PUT /api/auth/change-password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "currentPassword": "OldPass123",
  "newPassword": "NewPass123"
}
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <accessToken>
```

### Admin Endpoints (Require Admin Role or Higher)

#### Get All Users
```http
GET /api/user?page=1&limit=10&role=user&isActive=true&search=john
Authorization: Bearer <accessToken>
```

#### Get User by ID
```http
GET /api/user/:id
Authorization: Bearer <accessToken>
```

#### Create User
```http
POST /api/user
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "username": "newuser",
  "email": "newuser@example.com",
  "password": "SecurePass123",
  "role": "agent"
}
```

#### Update User
```http
PUT /api/user/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "role": "master",
  "isActive": true
}
```

#### Delete User
```http
DELETE /api/user/:id
Authorization: Bearer <accessToken>
```

#### Get User Statistics
```http
GET /api/user/stats
Authorization: Bearer <accessToken>
```

## Usage Examples

### Frontend Integration

#### Login
```javascript
const response = await fetch('http://localhost:5000/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'Password123'
  })
});

const data = await response.json();
localStorage.setItem('accessToken', data.data.accessToken);
localStorage.setItem('refreshToken', data.data.refreshToken);
```

#### Authenticated Request
```javascript
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('http://localhost:5000/api/auth/profile', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

#### Refresh Token
```javascript
const refreshToken = localStorage.getItem('refreshToken');

const response = await fetch('http://localhost:5000/api/auth/refresh-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ refreshToken })
});

const data = await response.json();
localStorage.setItem('accessToken', data.data.accessToken);
localStorage.setItem('refreshToken', data.data.refreshToken);
```

## Setup Instructions

### 1. Environment Variables

Create a `.env` file based on `.env.example`:

```env
PORT=5000
NODE_ENV=production
MONGO_URI=mongodb://localhost:27017/crickbackend
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-characters
JWT_EXPIRE=15m
JWT_REFRESH_EXPIRE=7d
CORS_ORIGIN=https://yourdomain.com
```

### 2. Create Super Admin

```bash
npm run create-admin
```

Or set environment variables:
```env
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_PASSWORD=SecurePassword123
```

### 3. Start Server

```bash
npm start
# or for development
npm run dev
```

## Middleware Usage

### Authentication Middleware
```javascript
const { authenticate } = require('./middlewares/auth.middleware');

router.get('/protected', authenticate, (req, res) => {
  // req.user is available here
  res.json({ user: req.user });
});
```

### Authorization Middleware
```javascript
const { authorize, requireMinRole } = require('./middlewares/authorize.middleware');
const { ROLES } = require('./models/User');

// Specific roles
router.get('/admin-only', authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN), handler);

// Minimum role level
router.get('/agent-or-higher', authenticate, requireMinRole(ROLES.AGENT), handler);
```

## Best Practices

1. **Always use HTTPS in production**
2. **Store refresh tokens securely** (HTTP-only cookies recommended)
3. **Implement token rotation** (already implemented)
4. **Monitor failed login attempts**
5. **Regular security audits**
6. **Keep dependencies updated**
7. **Use strong JWT secrets** (minimum 32 characters)
8. **Implement 2FA for sensitive accounts** (future enhancement)

## Security Checklist

- ✅ Password hashing with bcrypt
- ✅ JWT token authentication
- ✅ Refresh token rotation
- ✅ Account lockout mechanism
- ✅ Rate limiting
- ✅ Input validation
- ✅ Security headers
- ✅ CORS configuration
- ✅ Role-based access control
- ✅ Token expiry
- ✅ Secure password requirements

## Troubleshooting

### Token Expired
- Use refresh token endpoint to get new access token
- If refresh token expired, user must login again

### Account Locked
- Wait 2 hours or contact administrator
- Account unlocks automatically after lock period

### Invalid Credentials
- Check email/password
- Account may be locked after 5 failed attempts

## Support

For issues or questions, please check the code documentation or contact the development team.

