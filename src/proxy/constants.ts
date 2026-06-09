// Protocol block types that must be preserved verbatim when resending to the API.
// These are NOT user-visible content — they are protocol state that the API
// requires to be passed back exactly as received (thinking mode chain).
export const PROTOCOL_BLOCK_TYPES = new Set(["thinking", "signature", "redacted_thinking"]);

// Token threshold below which requests are forwarded without compression
export const COMPRESSION_THRESHOLD = 200;
