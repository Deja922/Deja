# Deja Billing + Account MVP (Beta Launch)

Last updated: 2026-06-11
Owner: Product/Engineering
Target launch: before 2026-06-12

Current rollout note:

1. Public beta at this stage is free (no billing turned on yet).
2. This document defines the account/payment-ready architecture for future activation.

## 1) Scope

This MVP covers:

1. 24h free trial with anti-abuse baseline.
2. Paid monthly subscription (low-price beta tier).
3. WeChat Pay + Alipay checkout.
4. License issuance after payment via webhook.
5. CLI redemption flow (`deja license:redeem <code>`).

Out of scope for this launch:

1. Complex invoicing.
2. Team seat management.
3. Automatic recurring deduction.
4. Full customer portal.

## 2) Product decisions

1. Trial policy:
   - 24h full feature trial.
   - Requires light account (OTP).
   - One trial per account + device fingerprint.
2. Pricing:
   - Beta early-bird: `19 RMB / month`.
   - Planned standard: `29 RMB / month` after beta.
3. License model:
   - Keep signed offline license key for local verification.
   - Add server redemption API to obtain key from paid/trial entitlement.

## 3) Core state machine

### Account state

1. `new`: user record created, not verified.
2. `verified`: OTP verified.
3. `suspended`: risk-control/manual block.

### Entitlement state

1. `trial_active`: now < trial_end.
2. `trial_expired`: now >= trial_end and no paid plan.
3. `paid_active`: now < paid_end.
4. `paid_expired`: now >= paid_end.
5. `revoked`: refund/chargeback/fraud.

Transitions:

1. `verified -> trial_active` via trial start.
2. `trial_active -> paid_active` via successful payment webhook.
3. `paid_active -> paid_expired` by time.
4. Any active -> `revoked` by admin/risk event.

## 4) Data model (MVP tables)

## `users`

1. `id` (uuid, pk)
2. `email` (nullable, unique)
3. `phone` (nullable, unique)
4. `status` (`new|verified|suspended`)
5. `created_at`, `updated_at`

## `devices`

1. `id` (uuid, pk)
2. `user_id` (fk users.id)
3. `device_fingerprint` (string, indexed)
4. `first_seen_at`, `last_seen_at`
5. `platform`, `hostname_hash`, `risk_score`

## `trials`

1. `id` (uuid, pk)
2. `user_id` (fk users.id)
3. `device_id` (fk devices.id)
4. `start_at`
5. `end_at`
6. `status` (`active|expired|revoked`)

Uniqueness constraints:

1. one active/expired trial per `user_id`
2. one active/expired trial per `device_id`

## `orders`

1. `id` (uuid, pk)
2. `user_id` (fk users.id)
3. `plan_code` (`beta_monthly`)
4. `amount_cents` (int)
5. `currency` (`CNY`)
6. `status` (`pending|paid|failed|refunded|closed`)
7. `provider` (`wechat|alipay`)
8. `provider_order_id` (unique)
9. `created_at`, `paid_at`

## `entitlements`

1. `id` (uuid, pk)
2. `user_id` (fk users.id)
3. `source` (`trial|order`)
4. `source_id` (trial/order id)
5. `tier` (`free|pro`)
6. `start_at`
7. `end_at`
8. `status` (`active|expired|revoked`)

## `license_keys`

1. `id` (uuid, pk)
2. `user_id` (fk users.id)
3. `entitlement_id` (fk entitlements.id)
4. `key_hash` (sha256, unique)
5. `issued_at`
6. `expires_at`
7. `status` (`active|revoked`)

## `redeem_codes`

1. `code` (string, pk)
2. `user_id` (fk users.id, nullable before bind)
3. `entitlement_id` (fk entitlements.id)
4. `status` (`new|used|expired|revoked`)
5. `used_at`
6. `expire_at`

## 5) API contract (MVP)

## `POST /v1/auth/otp/send`

Request:

```json
{ "phone": "13800138000" }
```

Response:

```json
{ "ok": true, "requestId": "otp_req_xxx" }
```

## `POST /v1/auth/otp/verify`

Request:

```json
{ "phone": "13800138000", "code": "123456" }
```

Response:

```json
{ "ok": true, "token": "jwt_or_session", "userId": "uuid" }
```

## `POST /v1/trial/start`

Auth required.

Request:

```json
{ "deviceFingerprint": "deja_abcd1234..." }
```

Response:

```json
{
  "ok": true,
  "status": "trial_active",
  "trialEndAt": 1760000000000,
  "redeemCode": "DJTRIAL-XXXXXX"
}
```

Possible blocked response:

```json
{ "ok": false, "code": "TRIAL_ALREADY_USED", "message": "Trial already used for this account or device." }
```

## `POST /v1/checkout/create`

Auth required.

Request:

```json
{ "planCode": "beta_monthly", "channel": "wechat" }
```

Response:

```json
{
  "ok": true,
  "orderId": "ord_xxx",
  "channel": "wechat",
  "payUrl": "https://.../cashier",
  "qrCodeUrl": "https://.../qrcode.png",
  "expireAt": 1760000000000
}
```

## `POST /v1/pay/webhook/wechat`
## `POST /v1/pay/webhook/alipay`

Provider-signed callbacks.

Server action:

1. Verify callback signature.
2. Mark `orders.status=paid`.
3. Create/extend entitlement.
4. Issue license key (signed key).
5. Create redeem code (or directly notify frontend).

## `POST /v1/licenses/redeem`

Request:

```json
{
  "code": "DJPAID-XXXXXX",
  "deviceId": "deja_abcd1234",
  "email": "user@example.com"
}
```

Success response:

```json
{
  "ok": true,
  "licenseKey": "DEJA-xxxxx.yyyyy",
  "tier": "pro",
  "expiresAt": 1760000000000
}
```

Failure response:

```json
{ "ok": false, "code": "CODE_INVALID_OR_USED", "message": "Redeem code is invalid or already used." }
```

## `GET /v1/licenses/status`

Request headers:

1. `Authorization: Bearer <token>` or `X-License-Key`

Response:

```json
{
  "ok": true,
  "state": "paid_active",
  "tier": "pro",
  "expiresAt": 1760000000000
}
```

## 6) Payment integration strategy

For launch speed:

1. Use one aggregator checkout that supports WeChat + Alipay.
2. Keep one internal order model and map external provider IDs.
3. Webhook idempotency key = `provider + provider_order_id + paid_event_id`.

## 7) CLI UX

Commands:

1. Existing:
   - `deja license:activate <key>`
2. New:
   - `deja license:redeem <code> [--endpoint ...] [--email ...] [--phone ...]`

CLI redeem flow:

1. POST code + device id to redeem endpoint.
2. Receive signed license key.
3. Validate key locally (existing RSA verify).
4. Save key to `~/.deja/license.json`.
5. Show tier and expiry.

## 8) Risk controls (minimum)

1. Trial one-time constraints on both account and device fingerprint.
2. OTP rate limits:
   - per phone per hour
   - per IP per hour
3. Redeem code single-use.
4. Payment callback signature verification required.
5. Refund/chargeback triggers entitlement revoke.

## 9) Launch checklist (engineering)

1. API endpoints online in staging + production.
2. Webhook signature tests for WeChat/Alipay.
3. CLI `license:redeem` integration tested with mock + staging.
4. Dashboard/status reflects updated license state after redeem.
5. 24h trial edge-case tests:
   - repeated uninstall/reinstall
   - same account new device
   - same device new account
