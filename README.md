# TrustIQ ERP Backend

Multi-tenant Node.js + Express + MongoDB backend.

## Setup

npm install

Copy .env.example to .env and set MONGO_URI and JWT_SECRET.

npm run create:developer
npm run dev

## Core rules

- One application
- One MongoDB
- Multiple traders/tenants
- Developer/support can select a tenant using `x-tenant-id`
- Normal tenant users are automatically scoped to their own tenant
- Every business document stores `tenantId`
- Business sequences are tenant scoped
- Soft delete and audit log foundation

## APIs

GET /api/health
POST /api/auth/login
GET /api/auth/me
GET /api/tenants
POST /api/tenants
POST /api/tenants/:tenantId/users
GET/POST/PUT/DELETE /api/customers
GET/POST/PUT/DELETE /api/ledgers

For developer/support requests to tenant-scoped APIs, send:

Authorization: Bearer TOKEN
x-tenant-id: TENANT_OBJECT_ID
