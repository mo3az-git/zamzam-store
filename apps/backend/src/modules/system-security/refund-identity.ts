import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto"

export interface RefundIdentityInput {
  order_id: string
  return_request_id: string
  amount: string
  refund_method: "electronic_gateway" | "manual_bank_wire" | "vodafone_cash" | "cash_voucher"
  recipient: Record<string, string>
}

/** Stable identity precedes encryption; a fresh nonce is never replay identity. */
export function prepareRefundIdentity(input: RefundIdentityInput) {
  const hmacKey = process.env.HMAC_KEY
  const encryptionKey = process.env.REFUND_ENCRYPTION_KEY
  if (!hmacKey || Buffer.byteLength(hmacKey, "utf8") < 32) throw new Error("HMAC_KEY must contain at least 32 bytes")
  if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) throw new Error("REFUND_ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters")
  for (const value of [input.order_id, input.return_request_id, input.refund_method]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid refund identity component")
  }
  if (!/^(?:electronic_gateway|manual_bank_wire|vodafone_cash|cash_voucher)$/.test(input.refund_method)) throw new Error("Unsupported refund method")
  const amount = input.amount.match(/^(\d{1,10})(?:\.(\d{1,2}))?$/)
  if (!amount) throw new Error("Refund amount must use exact decimal major units")
  const normalizedAmount = BigInt(amount[1]).toString() + "." + (amount[2] || "").padEnd(2, "0")
  if (normalizedAmount === "0.00") throw new Error("Refund amount must be positive")
  const keys = Object.keys(input.recipient).sort()
  if (!keys.length) throw new Error("Recipient details are required")
  const normalized: Record<string, string> = Object.create(null)
  for (const key of keys) {
    const value = input.recipient[key]
    if (!key || typeof value !== "string" || !value.trim()) throw new Error("Recipient details must be nonempty strings")
    normalized[key] = value.normalize("NFC").trim()
  }
  const plaintext = JSON.stringify(normalized)
  const recipient_fingerprint = createHmac("sha256", hmacKey).update(plaintext).digest("hex")
  const request_hash = createHash("sha256").update([
    input.order_id, input.return_request_id, normalizedAmount, input.refund_method, recipient_fingerprint,
  ].join(":")).digest("hex")
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    recipient_fingerprint, request_hash,
    encrypted_recipient_details: {
      algorithm: "aes-256-gcm", nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
    },
  }
}
