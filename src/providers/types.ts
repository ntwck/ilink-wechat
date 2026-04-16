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
  /**
   * Optional hook called by REST providers operating in async mode, invoked with
   * the requestId *before* the POST is dispatched.  Callers can use this to
   * pre-register the callback context so that an external server which calls
   * back before (or concurrently with) the HTTP ACK can still be matched to the
   * correct WeChat conversation.
   */
  onAsyncRequestId?: (requestId: string) => void;
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
  /**
   * When set, this response uses async callback mode.
   * The provider has already posted the request to the external server and received
   * an acknowledgement (HTTP 2xx).  The external server will call back later via the
   * bot's callback endpoint with this ID to deliver the actual reply text.
   *
   * The caller (dispatchWithExternalProvider) must register the send context in the
   * callback registry so that the callback server can deliver the reply.
   */
  pendingCallbackId?: string;
}

/** Interface for pluggable reply providers. */
export interface ReplyProvider {
  readonly type: string;
  generateReply(req: ExternalReplyRequest): Promise<ExternalReplyResponse>;
}
