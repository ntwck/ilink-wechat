/**
 * Types shared between the provider interface and its implementations.
 * A "provider" is the component that generates a reply to an inbound WeChat message.
 * The OpenClaw path (default) delegates to dispatchReplyFromConfig; external paths
 * call a user-supplied REST endpoint or WebSocket server instead.
 */

/** Inbound message data passed to an external reply provider. */
export interface ExternalReplyRequest {
  /** WeChat sender user ID */
  from: string;
  /** Text body (empty string for pure-media messages) */
  body: string;
  /** WeChat context token — round-trip, must be echoed in the reply */
  contextToken?: string;
  /** Local path to the downloaded + decrypted media attachment */
  mediaPath?: string;
  /** MIME type of the media attachment (e.g. "image/*", "audio/wav") */
  mediaType?: string;
  /** Bot account ID */
  accountId: string;
}

/** Reply produced by an external provider. */
export interface ExternalReplyResponse {
  /** Text to send back; empty/undefined means no text reply */
  text?: string;
  /**
   * Media URL or absolute file path to attach.
   * Interpreted the same way as mediaUrl in the outbound channel handler:
   *   - http(s):// URL → downloaded first, then uploaded to CDN
   *   - absolute path or file:// URL → uploaded directly to CDN
   */
  mediaUrl?: string;
}

/** Interface for pluggable reply providers. */
export interface ReplyProvider {
  readonly type: string;
  generateReply(req: ExternalReplyRequest): Promise<ExternalReplyResponse>;
}
